using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using System.Threading.Channels;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Win32;
using Moshe.Core;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;
using Whisper.net;

namespace Moshe;

/// <summary>
/// <c>mosheShell.voice</c> (docs/VOICE.md): Whisper, through whisper.cpp, hearing
/// what is said, on this PC and offline. The microphone's sound goes through a pause
/// gate, the page's own rule (Moshe.Core/PauseGate.cs), which cuts it into utterances
/// at each pause; Whisper writes each one down, with the page's words as its prompt,
/// and it goes to the page as <c>mosheVoice.final</c>. The Mac's is mac/Moshe/Voice.swift,
/// with Apple's dictation. With no model on this PC there is no <c>mosheShell.voice</c>,
/// and the page listens with its own Whisper.
/// </summary>
sealed class VoiceService(ShellWindow owner)
{
    Listener? listener;
    string[] words = [];
    int pause = 700;
    string lang = "en";

    public static bool Available => VoiceModels.Current != null;

    /// <summary>The page's part of <c>window.mosheShell</c>, added only where there is a model to listen with.</summary>
    public const string Script = """
          voice: Object.freeze({
            start: (o) => call('voiceStart', { lang: String((o && o.lang) || 'en'), words: Array.isArray(o && o.words) ? o.words.map(String).slice(0, 300) : [], pause: Number(o && o.pause) || 700 }),
            stop: () => call('voiceStop', {}),
            language: (lang) => call('voiceLanguage', { lang: String(lang) }),
          }),
        """;

    public bool Listening => listener != null;

    public async Task<JsonNode?> Answer(string op, JsonObject args)
    {
        switch (op)
        {
            case "voiceStart":
                words = (args["words"] as JsonArray)?.Select(J.Text).OfType<string>().ToArray() ?? [];
                pause = Math.Clamp(J.Int(args["pause"]) is var p && p > 0 ? p : 700, 200, 5000);
                await Start(J.Text(args["lang"]) ?? "en");
                break;
            case "voiceLanguage":
                if (listener != null)
                {
                    // the page doesn't wait for this one: a language Whisper can't hear here stops listening, and says so
                    try { await Start(J.Text(args["lang"]) ?? "en"); }
                    catch (Exception e)
                    {
                        Log.Write($"voice: {e.Message}");
                        Send("state", "error");
                    }
                }
                break;
            default:
                Stop();
                break;
        }
        return true;
    }

    async Task Start(string language)
    {
        Stop();
        lang = language;
        var l = new Listener(this);
        listener = l;
        try { await l.Start(lang, words, pause); }
        catch (Exception)
        {
            if (listener == l) Stop(quiet: true);
            throw;
        }
    }

    /// <summary>Listening again as it was, with the model chosen now (View › Voice Model).</summary>
    public async Task Restart()
    {
        if (listener == null) return;
        try { await Start(lang); }
        catch (Exception e)
        {
            Log.Write($"voice: {e.Message}");
            Send("state", "error");
        }
    }

    public void Stop(bool quiet = false)
    {
        var l = listener;
        listener = null;
        if (l == null) return;
        l.Stop();
        if (!quiet) Send("state", "off");
    }

    /// <summary><c>window.mosheVoice.fn(args…)</c> in the page, from any thread.</summary>
    public void Send(string fn, params JsonNode?[] args) =>
        owner.Script($"window.mosheVoice && window.mosheVoice.{fn}(...{new JsonArray(args).ToJsonString()})");

    /// <summary>A Listener still the one listening: what it hears goes to the page only then.</summary>
    public bool IsCurrent(Listener l) => listener == l;
}

/// <summary>
/// One spell of listening: the microphone (or the self-test's file), the pause gate,
/// and Whisper writing down one utterance at a time, in the order they were said.
/// </summary>
sealed class Listener(VoiceService service)
{
    readonly Utterances cutter = new();
    readonly Channel<float[]> queue = Channel.CreateUnbounded<float[]>(new() { SingleReader = true });
    readonly CancellationTokenSource stopping = new();
    WaveIn? mic;
    bool speaking;
    int pending;
    string label = "";

    public async Task Start(string lang, string[] words, int pauseMs)
    {
        if (lang != "en")
            throw new ShellError("Moshe's Whisper here hears English only. For Hebrew, choose “Whisper, on This Computer” in Settings › Voice.");
        var (model, path) = VoiceModels.Current ?? throw new ShellError("Whisper's model isn't on this PC");
        cutter.PauseMs = pauseMs;
        label = model.Label;
        service.Send("state", "loading", 0);
        var factory = await Task.Run(() => VoiceModels.Factory(path));
        service.Send("state", "loading", 100);
        var prompt = Utterances.Prompt(words);
        WhisperProcessor Processor(int context)
        {
            var builder = factory.CreateBuilder()
                .WithLanguage("en")
                .WithNoContext()                               // each utterance on its own, with the prompt alone before it
                .WithThreads(Math.Clamp(Environment.ProcessorCount / 2, 2, 8));
            if (context > 0) builder = builder.WithAudioContextSize(context);
            if (prompt.Length > 0) builder = builder.WithPrompt(prompt);
            return builder.Build();
        }
        // the quick one for all but the longest utterances, the whole 30 s window for those
        var (quick, whole) = (Processor(model.Context), Processor(0));
        _ = Task.Run(() => Write(quick, whole, model.Context));
        if (App.Options.VoiceFile is { } file)
        {
            label += ", from a file";
            Play(file);
        }
        else OpenMic();
        service.Send("state", "listening");
    }

    public void Stop()
    {
        if (stopping.IsCancellationRequested) return;
        stopping.Cancel();
        try { mic?.StopRecording(); } catch (Exception) { }
        mic?.Dispose();
        mic = null;
        queue.Writer.TryComplete();
    }

    bool Gone => stopping.IsCancellationRequested || !service.IsCurrent(this);

    string Idle() => speaking ? "hearing" : pending > 0 ? "working" : "listening";

    /// <summary>Sound, 16 kHz mono: through the gate, and each utterance into the queue for Whisper. On the sound's own thread.</summary>
    void Hear(ReadOnlySpan<float> sound)
    {
        List<Utterances.Cut> cuts;
        lock (cutter) cuts = cutter.Take(sound);
        if (Gone) return;
        foreach (var cut in cuts)
        {
            switch (cut.Kind)
            {
                case PauseGate.Kind.Level:
                    service.Send("level", Math.Round(cut.Level, 3));
                    break;
                case PauseGate.Kind.Start:
                    speaking = true;
                    service.Send("state", "hearing");
                    break;
                case PauseGate.Kind.Short:
                    speaking = false;
                    service.Send("state", Idle());
                    break;
                case PauseGate.Kind.End:
                    speaking = false;
                    Interlocked.Increment(ref pending);
                    queue.Writer.TryWrite(cut.Sound!);
                    service.Send("state", "working");
                    break;
            }
        }
    }

    /// <summary>Whisper, one utterance after another: what it wrote, cleaned, to the page.</summary>
    async Task Write(WhisperProcessor quick, WhisperProcessor whole, int context)
    {
        static async Task<string> Written(WhisperProcessor processor, float[] padded)
        {
            var parts = new List<string>();
            try
            {
                // never cancelled half-way: whisper.cpp finishes the utterance, and a stopped listener drops it
                await foreach (var segment in processor.ProcessAsync(padded)) parts.Add(segment.Text);
            }
            catch (Exception e) { Log.Write($"voice: Whisper: {e.Message}"); }
            return Utterances.Clean(string.Join(" ", parts));
        }
        try
        {
            await foreach (var sound in queue.Reader.ReadAllAsync())
            {
                var clock = Stopwatch.StartNew();
                var padded = Utterances.ForWhisper(sound);
                var cut = Utterances.Fits(padded.Length, context);
                var text = await Written(cut ? quick : whole, padded);
                // cut down, whisper.cpp may write only a stop for a word said on its own ("Two."): the whole window, then
                if (cut && text.Length == 0) text = await Written(whole, padded);
                Interlocked.Decrement(ref pending);
                if (Gone) continue;
                var how = $"{label} · {sound.Length / (double)Utterances.Rate:0.0} s of speech, words in {clock.Elapsed.TotalSeconds:0.0} s";
                if (text.Length == 0) service.Send("partial", "");
                else service.Send("final", text, new JsonObject { ["how"] = how, ["alternatives"] = new JsonArray() });
                service.Send("state", Idle());
            }
        }
        finally
        {
            await quick.DisposeAsync();
            await whole.DisposeAsync();
        }
    }

    // ---- the sound: the microphone, or for the self-test a file

    void OpenMic()
    {
        if (MicrophoneBlocked())
            throw new ShellError("Windows keeps the microphone from desktop apps: Settings › Privacy & security › Microphone › Let desktop apps access your microphone.");
        if (WaveIn.DeviceCount == 0) throw new ShellError("No microphone found.");
        // the default microphone, as Windows' own sound settings choose it, at the rate Whisper hears at
        mic = new WaveIn { DeviceNumber = -1, WaveFormat = new WaveFormat(Utterances.Rate, 16, 1), BufferMilliseconds = 50, NumberOfBuffers = 4 };
        var floats = new float[Utterances.Rate];
        mic.DataAvailable += (_, e) =>
        {
            var n = Math.Min(e.BytesRecorded / 2, floats.Length);
            for (var i = 0; i < n; i++) floats[i] = BitConverter.ToInt16(e.Buffer, i * 2) / 32768f;
            Hear(floats.AsSpan(0, n));
        };
        mic.RecordingStopped += (_, e) =>
        {
            if (e.Exception == null || Gone) return;
            Log.Write($"voice: the microphone stopped: {e.Exception.Message}");
            service.Send("state", "error");
        };
        try { mic.StartRecording(); }
        catch (Exception e) { throw new ShellError($"The microphone didn't start: {e.Message}"); }
    }

    /// <summary>The self-test's sound: a WAV, played in at the pace it was spoken, as if into the microphone.</summary>
    void Play(string file) => _ = Task.Run(async () =>
    {
        try
        {
            using var reader = new WaveFileReader(file);
            var samples = reader.ToSampleProvider();
            if (samples.WaveFormat.Channels == 2) samples = samples.ToMono();
            if (samples.WaveFormat.SampleRate != Utterances.Rate) samples = new WdlResamplingSampleProvider(samples, Utterances.Rate);
            var buffer = new float[Utterances.Rate / 20];
            var clock = Stopwatch.StartNew();
            var played = 0.0;
            int n;
            while (!stopping.IsCancellationRequested && (n = samples.Read(buffer)) > 0)
            {
                Hear(buffer.AsSpan(0, n));
                played += n / (double)Utterances.Rate;
                var ahead = played - clock.Elapsed.TotalSeconds;
                if (ahead > 0) await Task.Delay(TimeSpan.FromSeconds(ahead));
            }
        }
        catch (Exception e)
        {
            Log.Write($"voice: the file: {e.Message}");
            service.Send("state", "error");
        }
    });

    /// <summary>Whether Windows' privacy settings keep the microphone from this app (Settings › Privacy &amp; security › Microphone).</summary>
    static bool MicrophoneBlocked()
    {
        const string store = @"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone";
        static bool Denied(RegistryKey hive, string key) => (hive.OpenSubKey(key)?.GetValue("Value") as string) == "Deny";
        try { return Denied(Registry.LocalMachine, store) || Denied(Registry.CurrentUser, store) || Denied(Registry.CurrentUser, store + @"\NonPackaged"); }
        catch (Exception) { return false; }
    }
}

/// <summary>
/// Whisper's models: base.en, built in (Models\ beside Moshe.exe), and small.en,
/// which hears more exactly and takes longer to, built in or fetched once into
/// %LOCALAPPDATA%\Moshe\Models. View › Voice Model chooses.
/// </summary>
static class VoiceModels
{
    /// <summary>A model; <c>Context</c> is its quick encoder's audio_ctx (Utterances.Fits), as small as it still hears as well with.</summary>
    public sealed record Model(string Key, string Label, string File, long Bytes, string Sha256, int Context);

    public static readonly Model Base = new("base.en", "Whisper base.en", "ggml-base.en.bin", 147_964_211, "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002", 512);
    public static readonly Model Small = new("small.en", "Whisper small.en", "ggml-small.en.bin", 487_614_201, "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d", 768);

    static string Fetched => Path.Join(App.DataDir, "Models");

    public static string? PathOf(Model m) =>
        new[] { Path.Join(AppContext.BaseDirectory, "Models", m.File), Path.Join(Fetched, m.File) }.FirstOrDefault(File.Exists);

    public static Model Chosen => (App.Options.VoiceModel ?? Library.VoiceModel) == Small.Key ? Small : Base;

    /// <summary>The model to listen with: the one chosen, or if it isn't here the other.</summary>
    public static (Model Model, string Path)? Current =>
        new[] { Chosen, Chosen == Base ? Small : Base }.Select(m => (m, PathOf(m))).Where(x => x.Item2 != null).Select(x => ((Model, string)?)(x.m, x.Item2!)).FirstOrDefault();

    static readonly Dictionary<string, WhisperFactory> Loaded = [];

    /// <summary>The model, loaded once for every window.</summary>
    public static WhisperFactory Factory(string path)
    {
        lock (Loaded)
        {
            if (!Loaded.TryGetValue(path, out var factory)) Loaded[path] = factory = WhisperFactory.FromPath(path);
            return factory;
        }
    }

    /// <summary>A model from Hugging Face, checked against its SHA-256 before it is used.</summary>
    public static async Task Fetch(Model m, IProgress<double> progress, CancellationToken cancel)
    {
        Directory.CreateDirectory(Fetched);
        var part = Path.Join(Fetched, m.File + ".part");
        using var http = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
        using var response = await http.GetAsync($"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{m.File}", HttpCompletionOption.ResponseHeadersRead, cancel);
        response.EnsureSuccessStatusCode();
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        await using (var from = await response.Content.ReadAsStreamAsync(cancel))
        await using (var to = File.Create(part))
        {
            var buffer = new byte[1 << 16];
            long got = 0;
            int n;
            while ((n = await from.ReadAsync(buffer, cancel)) > 0)
            {
                await to.WriteAsync(buffer.AsMemory(0, n), cancel);
                hash.AppendData(buffer, 0, n);
                got += n;
                progress.Report(Math.Min(1, got / (double)m.Bytes));
            }
        }
        if (Convert.ToHexStringLower(hash.GetHashAndReset()) != m.Sha256)
        {
            File.Delete(part);
            throw new ShellError($"What came wasn't {m.File}; nothing was kept.");
        }
        File.Move(part, Path.Join(Fetched, m.File), overwrite: true);
    }

    /// <summary>View › Voice Model: the one to listen with, small.en fetched first if it isn't here, with a word about the size.</summary>
    public static async Task Choose(ShellWindow owner, Model m)
    {
        if (m == Small && PathOf(Small) == null && !await FetchAsked(owner, Small)) return;
        Library.VoiceModel = m.Key;
        foreach (var window in ShellWindow.All) await window.Voice.Restart();
    }

    static async Task<bool> FetchAsked(ShellWindow owner, Model m)
    {
        var bar = new ProgressBar { Minimum = 0, Maximum = 100, Visibility = Visibility.Collapsed };
        var said = new TextBlock
        {
            TextWrapping = TextWrapping.Wrap,
            Text = $"{m.Label} hears more exactly than base.en, and takes two or three times as long to write each sentence down. "
                + $"It is {m.Bytes / 1_000_000} MB, fetched once from Hugging Face; then voice works offline with it.",
        };
        var panel = new StackPanel { Spacing = 12 };
        panel.Children.Add(said);
        panel.Children.Add(bar);
        var dialog = new ContentDialog
        {
            XamlRoot = owner.DialogRoot,
            Title = $"Fetch {m.Label}?",
            Content = panel,
            PrimaryButtonText = "Fetch",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Primary,
        };
        var cancel = new CancellationTokenSource();
        var done = false;
        dialog.PrimaryButtonClick += async (_, e) =>
        {
            e.Cancel = true;                    // stays open, with the progress, until it is all here
            dialog.IsPrimaryButtonEnabled = false;
            bar.Visibility = Visibility.Visible;
            var progress = new Progress<double>(p => bar.Value = p * 100);
            try
            {
                await Fetch(m, progress, cancel.Token);
                done = true;
                dialog.Hide();
            }
            catch (OperationCanceledException) { }
            catch (Exception x)
            {
                Log.Write($"voice: fetching {m.File}: {x.Message}");
                said.Text = $"It didn't come: {x.Message}";
                bar.Visibility = Visibility.Collapsed;
                dialog.IsPrimaryButtonEnabled = true;
            }
        };
        await dialog.ShowAsync();
        cancel.Cancel();
        return done;
    }
}
