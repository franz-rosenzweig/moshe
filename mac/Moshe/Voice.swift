import AVFoundation
import Speech
import WebKit

/// `mosheShell.voice` (docs/VOICE.md): the Mac's own speech recognition for the
/// page. Apple's on-device dictation (macOS 26 and later) hears what is said;
/// a pause detector, the page's own rule, cuts it into utterances at each
/// pause; and each utterance goes to the page as `mosheVoice.final`, with the
/// guess so far as `mosheVoice.partial`. Older Macs offer nothing here, and the
/// page listens with Whisper instead.
@MainActor
final class VoiceService {
    weak var webView: WKWebView?
    private var listener: AnyObject?       // an AppleListener, on macOS 26 and later
    private var words: [String] = []
    private var pause = 700

    static var available: Bool { if #available(macOS 26, *) { return true } else { return false } }

    /// The page's part of `window.mosheShell`, added only where the Mac can listen.
    static let script = """
        voice: Object.freeze({
          start: (o) => call('voiceStart', { lang: String((o && o.lang) || 'en'), words: Array.isArray(o && o.words) ? o.words.map(String).slice(0, 300) : [], pause: Number(o && o.pause) || 700 }),
          stop: () => call('voiceStop', {}),
          language: (lang) => call('voiceLanguage', { lang: String(lang) }),
        }),
    """

    func answer(_ op: String, _ args: [String: Any]) async throws -> Any {
        switch op {
        case "voiceStart":
            words = (args["words"] as? [String]) ?? []
            pause = (args["pause"] as? Int) ?? 700
            try await start(lang: args["lang"] as? String ?? "en")
        case "voiceLanguage": if listener != nil { try await start(lang: args["lang"] as? String ?? "en") }
        default: stop()
        }
        return true
    }

    private func start(lang: String) async throws {
        guard #available(macOS 26, *) else { throw ShellError("This Mac's dictation needs macOS 26") }
        stop()
        let l = AppleListener(service: self)
        listener = l
        do { try await l.start(lang: lang, words: words, pauseMs: pause) } catch { stop(); throw error }
    }

    func stop() {
        if #available(macOS 26, *) { (listener as? AppleListener)?.stop() }
        if listener != nil { send("state", "off") }
        listener = nil
    }

    /// For a test: what would go to the page, without a page.
    var sink: ((String, [Any]) -> Void)?

    /// window.mosheVoice.fn(args…) in the page.
    func send(_ fn: String, _ args: Any...) {
        if let sink { sink(fn, args); return }
        guard let web = webView, let data = try? JSONSerialization.data(withJSONObject: args, options: [.fragmentsAllowed]),
              let list = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.mosheVoice && window.mosheVoice.\(fn)(...\(list))", completionHandler: nil)
    }
}

/// Where speech starts and where it pauses, from the sound alone: a running guess at
/// the room's noise, speech when the sound rises well above it, an utterance's end at
/// the first pause of `pauseMs`. The same rule as the page's (voice/vad-worklet.js).
/// It runs where the audio comes in, off the main thread.
final class PauseGate: @unchecked Sendable {
    enum Event { case start, end(at: Double), level(Float) }
    private var noise: Float = 0.004, speaking = false, voiced = 0, quiet = 0.0, spoken = 0.0, ticks = 0
    private(set) var time = 0.0            // seconds of audio seen
    var pauseMs = 700.0
    let minMs = 250.0, maxMs = 15000.0

    /// Samples of one channel; returns what happened in them.
    func take(_ samples: UnsafeBufferPointer<Float>, rate: Double) -> [Event] {
        var out: [Event] = []
        let n = max(1, Int(rate * 0.02))                   // 20 ms blocks
        let ms = Double(n) / rate * 1000
        var i = 0
        while i + n <= samples.count {
            var s: Float = 0
            for j in i..<(i + n) { s += samples[j] * samples[j] }
            let rms = (s / Float(n)).squareRoot()
            i += n
            time += Double(n) / rate
            ticks += 1
            if ticks % 5 == 0 { out.append(.level(min(1, rms * 14))) }
            noise = rms < noise ? noise * 0.9 + rms * 0.1 : noise * 0.999 + rms * 0.001
            let on = max(noise * 3, 0.01), off = max(noise * 2, 0.007)
            if !speaking {
                if rms > on { voiced += 1; if voiced >= 3 { speaking = true; quiet = 0; spoken = 0; out.append(.start) } } else { voiced = 0 }
                continue
            }
            spoken += ms
            quiet = rms < off ? quiet + ms : 0
            if quiet >= pauseMs || spoken >= maxMs {
                speaking = false; voiced = 0
                if spoken - quiet >= minMs { out.append(.end(at: time - quiet / 1000 + 0.15)) }
            }
        }
        time += Double(samples.count - i) / rate
        return out
    }
}

@available(macOS 26, *)
@MainActor
private final class AppleListener {
    private unowned let service: VoiceService
    private let engine = AVAudioEngine()
    private var analyzer: SpeechAnalyzer?
    private var feed: AsyncStream<AnalyzerInput>.Continuation?
    private var results: Task<Void, Never>?
    private var fileTask: Task<Void, Never>?
    private let gate = PauseGate()
    private var finals: [(start: Double, text: String, others: [String])] = []
    private var volatile = ""
    private var label = "Apple’s dictation"
    private var stopped = false

    init(service: VoiceService) { self.service = service }

    func start(lang: String, words: [String], pauseMs: Int) async throws {
        gate.pauseMs = Double(pauseMs)
        let wanted = Locale(identifier: lang == "he" ? "he-IL" : "en-US")
        guard let locale = await DictationTranscriber.supportedLocale(equivalentTo: wanted) else {
            throw ShellError("Apple’s dictation has no \(lang == "he" ? "Hebrew" : "English") on this Mac. Choose Whisper in Settings › Voice.")
        }
        let transcriber = DictationTranscriber(locale: locale, contentHints: [], transcriptionOptions: [.punctuation],
                                               reportingOptions: [.volatileResults, .frequentFinalization, .alternativeTranscriptions], attributeOptions: [])
        // the model is downloaded once, by the system
        if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
            service.send("state", "loading", 0)
            let watch = request.progress.observe(\.fractionCompleted) { [weak service] p, _ in
                let pct = Int(p.fractionCompleted * 100)
                Task { @MainActor in service?.send("state", "loading", pct) }
            }
            defer { watch.invalidate() }
            try await request.downloadAndInstall()
        }
        let analyzer = SpeechAnalyzer(modules: [transcriber], options: .init(priority: .userInitiated, modelRetention: .processLifetime))
        guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) else {
            throw ShellError("Apple’s dictation has no audio format to take")
        }
        try await analyzer.prepareToAnalyze(in: format)
        if !words.isEmpty {
            let context = AnalysisContext()
            context.contextualStrings[.general] = words
            try await analyzer.setContext(context)
        }
        let (stream, feed) = AsyncStream<AnalyzerInput>.makeStream()
        self.feed = feed
        self.analyzer = analyzer
        try await analyzer.start(inputSequence: stream)
        results = Task { [weak self] in
            do { for try await r in transcriber.results { self?.heard(r) } } catch { /* stopped */ }
        }
        if let file = UserDefaults.standard.string(forKey: "SelfTestVoiceFile") {
            label = "Apple’s dictation, from a file"
            try play(URL(fileURLWithPath: file), to: format)
        } else {
            try await openMic(to: format)
        }
        service.send("state", "listening")
    }

    func stop() {
        stopped = true
        if engine.isRunning { engine.stop() }
        engine.inputNode.removeTap(onBus: 0)
        fileTask?.cancel()
        feed?.finish()
        results?.cancel()
        let a = analyzer
        Task { await a?.cancelAndFinishNow() }
        analyzer = nil
    }

    // ---- what Apple's dictation hears

    /// Apple's dictation writes "new paragraph" and "new line" as the breaks themselves: the page wants the words.
    private static func words(_ s: AttributedString) -> String {
        let raw = String(s.characters).trimmingCharacters(in: .whitespaces)
        let breaks = raw.filter(\.isNewline).count
        return !raw.isEmpty && breaks == raw.count ? (breaks > 1 ? "new paragraph" : "new line") : raw.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func heard(_ r: DictationTranscriber.Result) {
        let text = Self.words(r.text)
        if r.isFinal {
            // its other guesses too: "highlight that" may come second to "I like that"
            let others = r.alternatives.map(Self.words).filter { !$0.isEmpty && $0 != text }
            if !text.isEmpty { finals.append((r.range.start.seconds, text, others)) }
            volatile = ""
        } else {
            volatile = text
        }
        let guess = (finals.map(\.text) + [volatile]).filter { !$0.isEmpty }.joined(separator: " ")
        if !guess.isEmpty { service.send("partial", guess) }
    }

    /// A pause: everything said before it is one utterance, handed to the page.
    private func cut(at t: Double) {
        guard let analyzer else { return }
        let t0 = Date()
        Task { @MainActor in
            try? await analyzer.finalize(through: CMTime(seconds: t, preferredTimescale: 1000))
            try? await Task.sleep(nanoseconds: 80_000_000)        // the last results, delivered
            let mine = finals.filter { $0.start < t }
            finals.removeAll { $0.start < t }
            let text = mine.map(\.text).joined(separator: " ")
            guard !stopped else { return }
            if text.isEmpty { service.send("partial", ""); return }
            let how = String(format: "%@ · words %.1f s after the pause", label, Date().timeIntervalSince(t0))
            // other guesses only for an utterance heard as one piece: they are guesses at all of it
            service.send("final", text, ["how": how, "alternatives": mine.count == 1 ? Array(mine[0].others.prefix(4)) : []])
        }
    }

    private func events(_ list: [PauseGate.Event]) {
        for e in list {
            switch e {
            case .start: service.send("state", "hearing")
            case .end(let at): service.send("state", "listening"); cut(at: at)
            case .level(let v): service.send("level", Double(v))
            }
        }
    }

    // ---- the audio: the microphone, or for the self-test a file

    /// The microphone's sound into the analyzer's format, and through the pause detector on the way.
    private func openMic(to format: AVAudioFormat) async throws {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: break
        case .notDetermined:
            guard await AVCaptureDevice.requestAccess(for: .audio) else { throw ShellError("The microphone isn’t allowed for Moshe") }
        default: throw ShellError("The microphone isn’t allowed for Moshe: System Settings › Privacy & Security › Microphone")
        }
        let input = engine.inputNode, inFormat = input.outputFormat(forBus: 0)
        guard let converter = AVAudioConverter(from: inFormat, to: format) else { throw ShellError("No way to convert the microphone’s sound") }
        let gate = self.gate, feed = self.feed
        input.installTap(onBus: 0, bufferSize: 4096, format: inFormat) { [weak self] buffer, _ in
            let list = Self.process(buffer, gate: gate, converter: converter, to: format, feed: feed)
            if !list.isEmpty { Task { @MainActor in self?.events(list) } }
        }
        engine.prepare()
        try engine.start()
    }

    /// The self-test's sound: a file, played in at the pace it was spoken.
    private func play(_ url: URL, to format: AVAudioFormat) throws {
        let file = try AVAudioFile(forReading: url)
        guard let converter = AVAudioConverter(from: file.processingFormat, to: format) else { throw ShellError("No way to convert the file") }
        let gate = self.gate, feed = self.feed, chunk: AVAudioFrameCount = 4096
        let seconds = Double(chunk) / file.processingFormat.sampleRate
        fileTask = Task.detached { [weak self] in
            while !Task.isCancelled, file.framePosition < file.length,
                  let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: chunk) {
                guard (try? file.read(into: buffer, frameCount: chunk)) != nil, buffer.frameLength > 0 else { break }
                let list = Self.process(buffer, gate: gate, converter: converter, to: format, feed: feed)
                if !list.isEmpty { await self?.events(list) }
                try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            }
        }
    }

    /// One buffer of sound: through the pause detector, then converted and fed to the analyzer.
    nonisolated private static func process(_ buffer: AVAudioPCMBuffer, gate: PauseGate, converter: AVAudioConverter,
                                            to format: AVAudioFormat, feed: AsyncStream<AnalyzerInput>.Continuation?) -> [PauseGate.Event] {
        var list: [PauseGate.Event] = []
        if let ch = buffer.floatChannelData {
            list = gate.take(UnsafeBufferPointer(start: ch[0], count: Int(buffer.frameLength)), rate: buffer.format.sampleRate)
        }
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * format.sampleRate / buffer.format.sampleRate) + 32
        guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return list }
        var given = false
        var error: NSError?
        converter.convert(to: out, error: &error) { _, status in
            if given { status.pointee = .noDataNow; return nil }
            given = true
            status.pointee = .haveData
            return buffer
        }
        if error == nil, out.frameLength > 0 { feed?.yield(AnalyzerInput(buffer: out)) }
        return list
    }
}
