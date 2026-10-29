using System.Text.Json.Nodes;

namespace Moshe;

/// <summary>
/// The command line: nothing, for a person; the self-test's switches for windows/selftest.ps1.
/// --voice-file is a WAV that voice hears instead of the microphone; --voice-model base.en
/// or small.en listens with that one, whatever View › Voice Model says.
/// </summary>
public sealed record Options(bool SelfTest, string? Data, string? Folder, string? Out, string? SaveDir, bool DevTools, string? VoiceFile, string? VoiceModel)
{
    public static Options Parse(string[] args)
    {
        string? Value(string name)
        {
            var i = Array.IndexOf(args, name);
            return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
        }
        return new(args.Contains("--selftest"), Value("--data"), Value("--folder"), Value("--out"), Value("--save-dir"), args.Contains("--devtools"),
            Value("--voice-file"), Value("--voice-model"));
    }
}

/// <summary>moshe.log, beside the settings: what went wrong where nobody saw it.</summary>
static class Log
{
    static readonly object Gate = new();

    public static void Write(string line)
    {
        System.Diagnostics.Debug.WriteLine(line);
        try
        {
            lock (Gate) File.AppendAllText(Path.Join(App.DataDir, "moshe.log"), $"{DateTime.Now:O} {line}{Environment.NewLine}");
        }
        catch (Exception) { }
    }
}

/// <summary>The browser, for anything that is not the app. The self-test only notes it.</summary>
static class Outside
{
    public static readonly List<Uri> Opened = [];

    public static void Open(Uri url)
    {
        Opened.Add(url);
        if (!App.Options.SelfTest) _ = Windows.System.Launcher.LaunchUriAsync(url);
    }
}

/// <summary>The little JSON the window and the page pass each other.</summary>
static class J
{
    public static string? Text(JsonNode? node) => node is JsonValue v && v.TryGetValue(out string? s) ? s : null;

    public static int Int(JsonNode? node) =>
        node is JsonValue v ? (v.TryGetValue(out int i) ? i : v.TryGetValue(out double d) ? (int)d : 0) : 0;

    public static bool Bool(JsonNode? node) => node is JsonValue v && v.TryGetValue(out bool b) && b;

    public static JsonObject Ok(JsonNode? value) => new() { ["ok"] = value };

    /// <summary>A string as a JavaScript (and JSON) literal.</summary>
    public static string Quote(string s) => JsonValue.Create(s)!.ToJsonString();
}

sealed class ShellError(string message) : Exception(message);
