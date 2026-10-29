using System.Text.Json;

namespace Moshe;

/// <summary>
/// Where the library lives (mac/Moshe/Library.swift). Moshe's is a folder on this
/// PC, read and written by the page through FolderBridge (docs/BRIDGE.md), which
/// is the default; a Moshe server's own page is the other way, with no bridge.
/// Kept in settings.json beside the page's own data.
/// </summary>
static class Library
{
    internal sealed class Settings
    {
        public string Mode { get; set; } = "folder";      // "folder" | "server"
        public string? Folder { get; set; }               // a path
        public string? Server { get; set; }
        public int[]? Window { get; set; }                 // x, y, width, height, maximised: the first window's place
        public string? VoiceModel { get; set; }            // "base.en" | "small.en": what voice listens with (Voice.cs)
    }

    static Settings settings = new();
    static string SettingsFile => Path.Join(App.DataDir, "settings.json");

    public static void Load()
    {
        try { settings = JsonSerializer.Deserialize<Settings>(File.ReadAllText(SettingsFile)) ?? new(); }
        catch (Exception) { settings = new(); }
        // the self-test's scratch folder
        if (App.Options.Folder is { } folder)
        {
            settings.Folder = Path.GetFullPath(folder);
            settings.Mode = "folder";
        }
    }

    static void Save()
    {
        try { File.WriteAllText(SettingsFile, JsonSerializer.Serialize(settings, new JsonSerializerOptions { WriteIndented = true })); }
        catch (Exception e) { Log.Write($"settings: {e.Message}"); }
    }

    public static string Mode => settings.Mode;

    /// <summary>The folder chosen, whatever the mode, if it is still there.</summary>
    public static string? Folder => settings.Folder is { Length: > 0 } f && Directory.Exists(f) ? f : null;

    /// <summary>The folder was chosen once and has gone (a drive not plugged in, a folder moved).</summary>
    public static bool FolderMissing => settings.Folder is { Length: > 0 } && Folder == null;

    /// <summary>The built web app beside Moshe.exe (the project copies frontend/dist there as web/).</summary>
    public static string? WebBundle { get; } =
        File.Exists(Path.Join(AppContext.BaseDirectory, "web", "index.html")) ? Path.Join(AppContext.BaseDirectory, "web") : null;

    public static bool UsesFolder => Mode == "folder" && Folder != null && WebBundle != null;

    /// <summary>The server: the address typed in Use the Server…. None before that.</summary>
    public static Uri? Server =>
        settings.Server is { Length: > 0 } s && Uri.TryCreate(s.EndsWith('/') ? s : s + "/", UriKind.Absolute, out var url) ? url : null;

    /// <summary>The page, served from inside the app in folder mode (AppScheme).</summary>
    public static Uri AppStart { get; } = new(AppScheme.Origin + "/");

    /// <summary>Where a window opens. (Server mode without a server can't last: the window asks.)</summary>
    public static Uri StartUri => UsesFolder ? AppStart : Server ?? AppStart;

    /// <summary>A page the app treats as its own: from inside the app, or the server's.</summary>
    public static bool IsOurs(Uri url) => SameOrigin(url, AppStart) || (Server is { } server && SameOrigin(url, server));

    static bool SameOrigin(Uri a, Uri b) =>
        a.Scheme == b.Scheme && string.Equals(a.Host, b.Host, StringComparison.OrdinalIgnoreCase) && a.Port == b.Port;

    /// <summary>The library moved (another folder, the server): every window loads again.</summary>
    public static event Action? Moved;

    public static void UseFolder(string path)
    {
        settings.Folder = path;
        settings.Mode = "folder";
        Save();
        Moved?.Invoke();
    }

    public static void UseServer()
    {
        settings.Mode = "server";
        Save();
        Moved?.Invoke();
    }

    /// <summary>The first run's choices, made before any page has loaded: nothing to load again.</summary>
    public static void Choose(string mode, string? folder = null)
    {
        settings.Mode = mode;
        if (folder != null) settings.Folder = folder;
        Save();
    }

    public static void SetServer(Uri url)
    {
        settings.Server = url.AbsoluteUri;
        Save();
    }

    public static int[]? WindowPlace
    {
        get => settings.Window;
        set { settings.Window = value; Save(); }
    }

    public static string? VoiceModel
    {
        get => settings.VoiceModel;
        set { settings.VoiceModel = value; Save(); }
    }
}
