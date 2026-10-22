import AppKit
import PDFKit
import UniformTypeIdentifiers
import WebKit

/// `window.mosheShell` (docs/BRIDGE.md, 5): what a writing app needs from the
/// Mac that a page cannot do well — a paginated PDF, a save panel, the share
/// sheet, the browser for a link. Each call is a message with a reply, so the
/// page's promise settles when the panel closes.
@MainActor
final class ShellServices: NSObject, WKScriptMessageHandlerWithReply {
    weak var webView: WKWebView?

    /// Defined before the page's own scripts run, so the page finds it at once.
    static let script = """
    (() => {
      const call = (op, args) => window.webkit.messageHandlers.mosheShell.postMessage({ op, args });
      window.mosheShell = Object.freeze({
        savePdf: (html, fileName) => call('savePdf', { html: String(html), fileName: String(fileName || 'Export.pdf') }),
        saveFile: (fileName, base64, mime) => call('saveFile', { fileName: String(fileName), base64: String(base64), mime: String(mime || '') }),
        share: (fileName, base64, mime) => call('share', { fileName: String(fileName), base64: String(base64), mime: String(mime || '') }),
        openExternal: (url) => call('openExternal', { url: String(url) }),
        copy: (what) => call('copy', { text: String((what && what.text) || ''), html: what && what.html ? String(what.html) : '' }),
        print: (html, fileName) => call('print', { html: String(html), fileName: String(fileName || 'Print') }),
        sharePdf: (html, fileName) => call('sharePdf', { html: String(html), fileName: String(fileName || 'Export.pdf') }),
      });
    })();
    """

    /// For the self-test: -SelfTestSaveDir DIR saves there without a panel.
    private var testDir: URL? {
        UserDefaults.standard.string(forKey: "SelfTestSaveDir").map { URL(fileURLWithPath: $0, isDirectory: true) }
    }

    nonisolated func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                                           replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        MainActor.assumeIsolated {
            guard message.frameInfo.isMainFrame, let url = webView?.url, Library.isOurs(url) else {
                return replyHandler(nil, "only the app's own page may use the shell")
            }
            guard let body = message.body as? [String: Any], let op = body["op"] as? String else {
                return replyHandler(nil, "not a shell message")
            }
            let args = body["args"] as? [String: Any] ?? [:]
            Task { @MainActor in
                do {
                    replyHandler(try await self.answer(op, args), nil)
                } catch {
                    replyHandler(nil, error.localizedDescription)
                }
            }
        }
    }

    private func answer(_ op: String, _ args: [String: Any]) async throws -> Any {
        switch op {
        case "savePdf":
            guard let html = args["html"] as? String else { throw ShellError("no HTML to print") }
            let name = Self.withExtension(args["fileName"] as? String ?? "Export", "pdf")
            guard let target = await chooseDestination(name, type: .pdf) else { return false }
            try await PDFMaker.save(html: html, to: target)
            return true
        case "saveFile":
            let name = args["fileName"] as? String ?? "Export"
            let data = try Self.bytes(args)
            let type = UTType(filenameExtension: (name as NSString).pathExtension)
                ?? (args["mime"] as? String).flatMap { UTType(mimeType: $0) }
            guard let target = await chooseDestination(name, type: type) else { return false }
            try data.write(to: target, options: .atomic)
            return true
        case "share":
            let name = Self.safeName(args["fileName"] as? String ?? "Export")
            let data = try Self.bytes(args)
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent("Moshe Share/\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let file = dir.appendingPathComponent(name)
            try data.write(to: file, options: .atomic)
            return showShare(file)
        case "copy":
            // Copy as HTML / Rich Text: both kinds on the clipboard, for whatever it is pasted into
            let text = args["text"] as? String ?? "", html = args["html"] as? String ?? ""
            let pb = NSPasteboard.general
            pb.clearContents()
            if !html.isEmpty {
                pb.setString(html, forType: .html)
                if let data = html.data(using: .utf8),
                   let rich = NSAttributedString(html: data, options: [.characterEncoding: String.Encoding.utf8.rawValue], documentAttributes: nil),
                   let rtf = rich.rtf(from: NSRange(location: 0, length: rich.length)) {
                    pb.setData(rtf, forType: .rtf)
                }
            }
            pb.setString(text, forType: .string)
            return true
        case "print":
            // the PDF as Save would make it (its pages, page numbers and all), then the print panel
            guard let html = args["html"] as? String else { throw ShellError("nothing to print") }
            let name = Self.withExtension(args["fileName"] as? String ?? "Print", "pdf")
            let file = try Self.scratch(name)
            try await PDFMaker.save(html: html, to: file)
            if let testDir { try? FileManager.default.removeItem(at: testDir.appendingPathComponent("printed-" + name))
                try FileManager.default.copyItem(at: file, to: testDir.appendingPathComponent("printed-" + name)); return true }
            return await PDFMaker.print(file, from: webView?.window)
        case "sharePdf":
            guard let html = args["html"] as? String else { throw ShellError("nothing to share") }
            let file = try Self.scratch(Self.withExtension(args["fileName"] as? String ?? "Export", "pdf"))
            try await PDFMaker.save(html: html, to: file)
            return showShare(file)
        case "openExternal":
            guard let s = args["url"] as? String, let url = URL(string: s),
                  ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") else { return false }
            Outside.open(url)
            return true
        default:
            throw ShellError("no such shell call: \(op)")
        }
    }

    /// The share picker for a file, beside the pointer (the page's Share button was just pressed there).
    private func showShare(_ file: URL) -> Bool {
        if testDir != nil { return true }
        guard let view = webView, let window = view.window else { return false }
        let at = window.convertPoint(fromScreen: NSEvent.mouseLocation)
        let point = view.convert(at, from: nil)
        NSSharingServicePicker(items: [file]).show(relativeTo: NSRect(x: point.x, y: point.y, width: 1, height: 1),
                                                   of: view, preferredEdge: .minY)
        return true
    }

    /// A file of that name in a folder of its own under the temporary directory.
    private static func scratch(_ name: String) throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("Moshe Share/\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent(safeName(name))
    }

    /// A save panel for `name`, as a sheet on the window. Nil if cancelled.
    private func chooseDestination(_ name: String, type: UTType?) async -> URL? {
        if let testDir { return testDir.appendingPathComponent(Self.safeName(name)) }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = Self.safeName(name)
        panel.canCreateDirectories = true
        panel.isExtensionHidden = false
        if let type { panel.allowedContentTypes = [type] }
        guard let window = webView?.window else { return panel.runModal() == .OK ? panel.url : nil }
        let response = await panel.beginSheetModal(for: window)
        return response == .OK ? panel.url : nil
    }

    private static func bytes(_ args: [String: Any]) throws -> Data {
        guard let b = args["base64"] as? String, let data = Data(base64Encoded: b, options: .ignoreUnknownCharacters) else {
            throw ShellError("the file's bytes did not arrive")
        }
        return data
    }

    static func safeName(_ name: String) -> String {
        let cleaned = name.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? "Export" : cleaned
    }

    static func withExtension(_ name: String, _ ext: String) -> String {
        (name as NSString).pathExtension.lowercased() == ext ? name : name + "." + ext
    }
}

struct ShellError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

/// The export's print-ready HTML as a paginated PDF: an offscreen web view
/// prints it, as ⌘P would, straight to a file. The HTML's `@page` gives the
/// paper and the margins. `createPDF` alone would make one tall page.
@MainActor
final class PDFMaker: NSObject, WKNavigationDelegate {
    private var loaded: CheckedContinuation<Void, Error>?
    private var printed: CheckedContinuation<Bool, Never>?

    static func save(html: String, to url: URL) async throws {
        try await PDFMaker().save(html: html, to: url)
    }

    /// A PDF through the print panel, its pages as they are. False if cancelled.
    static func print(_ file: URL, from window: NSWindow?) async -> Bool {
        guard let doc = PDFDocument(url: file), let first = doc.page(at: 0) else { return false }
        let info = NSPrintInfo.shared.copy() as! NSPrintInfo
        info.paperSize = first.bounds(for: .mediaBox).size
        info.topMargin = 0; info.bottomMargin = 0; info.leftMargin = 0; info.rightMargin = 0
        guard let op = doc.printOperation(for: info, scalingMode: .pageScaleNone, autoRotate: true) else { return false }
        op.jobTitle = file.deletingPathExtension().lastPathComponent
        op.showsPrintPanel = true
        op.showsProgressPanel = true
        let maker = PDFMaker()
        return await withCheckedContinuation { (c: CheckedContinuation<Bool, Never>) in
            maker.printed = c
            if let window {
                op.runModal(for: window, delegate: maker, didRun: #selector(printOperationDidRun(_:success:contextInfo:)), contextInfo: nil)
            } else {
                c.resume(returning: op.run())
                maker.printed = nil
            }
        }
    }

    /// Paper sizes by the names the export writes (engine/src/export/html.js).
    static let papers: [String: NSSize] = [
        "a4": NSSize(width: 595.28, height: 841.89), "letter": NSSize(width: 612, height: 792),
        "a5": NSSize(width: 419.53, height: 595.28), "legal": NSSize(width: 612, height: 1008),
    ]

    /// `@page { size: A4; margin: 72pt 72pt 72pt 72pt; … }`: the paper and the
    /// margins, top right bottom left, in points.
    static func page(_ html: String) -> (paper: NSSize, margins: NSEdgeInsets) {
        var paper = papers["a4"]!
        var margins = NSEdgeInsets(top: 72, left: 72, bottom: 72, right: 72)
        guard let rule = html.range(of: #"@page\s*\{[^}]*"#, options: .regularExpression) else { return (paper, margins) }
        let text = String(html[rule])
        if let m = text.range(of: #"size:\s*([^;}]+)"#, options: .regularExpression) {
            let value = text[m].dropFirst(5).trimmingCharacters(in: .whitespaces).lowercased()
            let words = value.split(separator: " ").map(String.init)
            if let named = words.first.flatMap({ papers[$0] }) {
                paper = words.contains("landscape") ? NSSize(width: named.height, height: named.width) : named
            } else if words.count == 2, let w = points(words[0]), let h = points(words[1]) {
                paper = NSSize(width: w, height: h)
            }
        }
        if let m = text.range(of: #"(?<![-\w])margin:\s*([^;}]+)"#, options: .regularExpression) {
            let value = String(text[m]).split(separator: ":", maxSplits: 1).last.map(String.init) ?? ""
            let v = value.split(separator: " ").compactMap { points(String($0)) }
            switch v.count {
            case 1: margins = NSEdgeInsets(top: v[0], left: v[0], bottom: v[0], right: v[0])
            case 2: margins = NSEdgeInsets(top: v[0], left: v[1], bottom: v[0], right: v[1])
            case 3: margins = NSEdgeInsets(top: v[0], left: v[1], bottom: v[2], right: v[1])
            case 4...: margins = NSEdgeInsets(top: v[0], left: v[3], bottom: v[2], right: v[1])
            default: break
            }
        }
        return (paper, margins)
    }

    /// A CSS length in points: pt, px, in, mm, cm.
    static func points(_ s: String) -> CGFloat? {
        let units: [(String, CGFloat)] = [("pt", 1), ("px", 0.75), ("in", 72), ("mm", 72 / 25.4), ("cm", 72 / 2.54)]
        for (unit, factor) in units where s.hasSuffix(unit) {
            return Double(s.dropLast(unit.count)).map { CGFloat($0) * factor }
        }
        return Double(s).map { CGFloat($0) }
    }

    private func save(html: String, to url: URL) async throws {
        let (paper, margins) = Self.page(html)
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        // images the sheets use come from the library, as in the editor
        var base = Library.startURL
        if Library.usesFolder, let web = Library.webBundle {
            config.setURLSchemeHandler(AppScheme(root: web, library: Library.folder), forURLScheme: AppScheme.scheme)
            base = Library.appOrigin
        }
        let frame = NSRect(x: 0, y: 0, width: paper.width, height: paper.height)
        let view = WKWebView(frame: frame, configuration: config)
        view.navigationDelegate = self
        // Printing wants the view in a window. This one is never shown.
        let window = NSWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = view
        defer { window.contentView = nil; window.close() }

        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
            loaded = c
            view.loadHTMLString(html, baseURL: base)
        }
        // the fonts and the pictures, before the pages are cut
        _ = try? await view.callAsyncJavaScript("""
            await document.fonts.ready;
            await Promise.all([...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; })));
            return true;
            """, contentWorld: .page)

        let info = NSPrintInfo(dictionary: [
            .jobDisposition: NSPrintInfo.JobDisposition.save,
            .jobSavingURL: url,
        ])
        info.paperSize = paper
        info.orientation = paper.width > paper.height ? .landscape : .portrait
        // WebKit lays the text out in @page's margins itself (the self-test
        // measures it); the paper's own stay at nothing, or they would count twice
        info.topMargin = 0
        info.bottomMargin = 0
        info.leftMargin = 0
        info.rightMargin = 0
        info.horizontalPagination = .automatic
        info.verticalPagination = .automatic
        info.isHorizontallyCentered = false
        info.isVerticallyCentered = false

        let op = view.printOperation(with: info)
        op.showsPrintPanel = false
        op.showsProgressPanel = false
        op.view?.frame = frame
        let ok = await withCheckedContinuation { (c: CheckedContinuation<Bool, Never>) in
            printed = c
            op.runModal(for: window, delegate: self, didRun: #selector(printOperationDidRun(_:success:contextInfo:)), contextInfo: nil)
        }
        guard ok, FileManager.default.fileExists(atPath: url.path) else { throw ShellError("the PDF could not be made") }
        Self.stamp(url, boxes: Self.marginBoxes(html), margins: margins)
    }

    // MARK: page numbers

    /// A header or footer @page asks for (`@bottom-center { content: counter(page); … }`),
    /// which WebKit's printing leaves out: drawn onto the pages afterwards.
    struct MarginBox {
        let place: String                    // "bottom-center", "top-right", …
        let parts: [String]                  // text, or "\u{0}page" / "\u{0}pages" for the counters
        let font: NSFont
        let color: NSColor

        func text(page: Int, of pages: Int) -> String {
            parts.map { $0 == "\u{0}page" ? String(page) : $0 == "\u{0}pages" ? String(pages) : $0 }.joined()
        }
    }

    static func marginBoxes(_ html: String) -> [MarginBox] {
        guard let rule = html.range(of: #"@page\s*\{"#, options: .regularExpression) else { return [] }
        let rest = String(html[rule.upperBound...])
        guard let re = try? NSRegularExpression(pattern: #"@((?:top|bottom)-(?:left|center|right))\s*\{([^}]*)\}"#) else { return [] }
        return re.matches(in: rest, range: NSRange(rest.startIndex..., in: rest)).compactMap { m in
            guard let place = Range(m.range(at: 1), in: rest), let body = Range(m.range(at: 2), in: rest) else { return nil }
            let decls = declarations(String(rest[body]))
            guard let content = decls["content"] else { return nil }
            let size = decls["font-size"].flatMap(points) ?? 9
            let families = (decls["font-family"] ?? "").split(separator: ",").map { $0.trimmingCharacters(in: CharacterSet(charactersIn: " \"'")) }
            let font = families.lazy.compactMap { NSFont(name: $0, size: size) }.first ?? NSFont.systemFont(ofSize: size)
            return MarginBox(place: String(rest[place]), parts: contentParts(content), font: font, color: color(decls["color"]) ?? .darkGray)
        }
    }

    /// `a: b; c: "d; e"` as a dictionary, minding quotes.
    private static func declarations(_ body: String) -> [String: String] {
        var out: [String: String] = [:], current = "", quote: Character? = nil, escaped = false
        func flush() {
            let parts = current.split(separator: ":", maxSplits: 1)
            if parts.count == 2 { out[parts[0].trimmingCharacters(in: .whitespaces).lowercased()] = parts[1].trimmingCharacters(in: .whitespaces) }
            current = ""
        }
        for ch in body {
            if escaped { escaped = false; current.append(ch); continue }
            if ch == "\\" { escaped = true; current.append(ch); continue }
            if let q = quote { if ch == q { quote = nil }; current.append(ch); continue }
            if ch == "\"" || ch == "'" { quote = ch; current.append(ch); continue }
            if ch == ";" { flush(); continue }
            current.append(ch)
        }
        flush()
        return out
    }

    /// `"Author / " "Title / " counter(page)` → its pieces, the CSS escapes undone.
    private static func contentParts(_ content: String) -> [String] {
        var parts: [String] = [], i = content.startIndex
        while i < content.endIndex {
            let ch = content[i]
            if ch == "\"" || ch == "'" {
                var s = "", j = content.index(after: i)
                while j < content.endIndex && content[j] != ch {
                    if content[j] == "\\", content.index(after: j) < content.endIndex {
                        j = content.index(after: j)
                        // \3c and other hex escapes, ended by a space
                        var hex = ""
                        while j < content.endIndex, hex.count < 6, content[j].isHexDigit { hex.append(content[j]); j = content.index(after: j) }
                        if !hex.isEmpty, let v = UInt32(hex, radix: 16), let u = Unicode.Scalar(v) {
                            s.unicodeScalars.append(u)
                            if j < content.endIndex && content[j] == " " { j = content.index(after: j) }
                            continue
                        }
                    }
                    if j < content.endIndex { s.append(content[j]); j = content.index(after: j) }
                }
                parts.append(s)
                i = j < content.endIndex ? content.index(after: j) : j
            } else if content[i...].hasPrefix("counter(pages)") {
                parts.append("\u{0}pages"); i = content.index(i, offsetBy: 14)
            } else if content[i...].hasPrefix("counter(page)") {
                parts.append("\u{0}page"); i = content.index(i, offsetBy: 13)
            } else {
                i = content.index(after: i)
            }
        }
        return parts
    }

    private static func color(_ css: String?) -> NSColor? {
        guard var hex = css?.trimmingCharacters(in: .whitespaces), hex.hasPrefix("#") else { return nil }
        hex.removeFirst()
        if hex.count == 3 { hex = hex.map { "\($0)\($0)" }.joined() }
        guard hex.count == 6, let v = UInt32(hex, radix: 16) else { return nil }
        return NSColor(srgbRed: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255, blue: CGFloat(v & 0xff) / 255, alpha: 1)
    }

    /// The boxes drawn onto every page of the PDF at `url`, in @page's margins.
    static func stamp(_ url: URL, boxes: [MarginBox], margins: NSEdgeInsets) {
        guard !boxes.isEmpty, let doc = PDFDocument(url: url) else { return }
        let pages = doc.pageCount
        let stamped = PDFDocument()
        for i in 0..<pages {
            guard let original = doc.page(at: i), let data = original.dataRepresentation,
                  let copy = PDFDocument(data: data)?.page(at: 0) else { continue }
            let page = StampedPage()
            page.source = copy
            page.labels = boxes.map { ($0, $0.text(page: i + 1, of: pages)) }
            page.margins = margins
            page.setBounds(copy.bounds(for: .mediaBox), for: .mediaBox)
            for a in copy.annotations { page.addAnnotation(a) }
            stamped.insert(page, at: stamped.pageCount)
        }
        if stamped.pageCount == pages { stamped.write(to: url) }
    }

    @objc private func printOperationDidRun(_ op: NSPrintOperation, success: Bool, contextInfo: UnsafeMutableRawPointer?) {
        printed?.resume(returning: success)
        printed = nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded?.resume()
        loaded = nil
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        loaded?.resume(throwing: error)
        loaded = nil
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        loaded?.resume(throwing: error)
        loaded = nil
    }
}

/// A printed page with a header or footer drawn on it (PDFMaker.stamp).
final class StampedPage: PDFPage {
    var source: PDFPage?
    var labels: [(PDFMaker.MarginBox, String)] = []
    var margins = NSEdgeInsets()

    override func draw(with box: PDFDisplayBox, to context: CGContext) {
        source?.draw(with: box, to: context)
        let bounds = self.bounds(for: box)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
        for (b, text) in labels {
            let s = NSAttributedString(string: text, attributes: [.font: b.font, .foregroundColor: b.color])
            let size = s.size()
            let left = bounds.minX + margins.left, right = bounds.maxX - margins.right
            let x: CGFloat = b.place.hasSuffix("left") ? left : b.place.hasSuffix("right") ? right - size.width : (left + right - size.width) / 2
            let y: CGFloat = b.place.hasPrefix("top") ? bounds.maxY - margins.top / 2 - size.height / 2 : bounds.minY + margins.bottom / 2 - size.height / 2
            s.draw(at: NSPoint(x: x, y: y))
        }
        NSGraphicsContext.restoreGraphicsState()
    }
}
