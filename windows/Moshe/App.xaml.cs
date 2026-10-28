using Microsoft.UI.Xaml;
using Microsoft.Web.WebView2.Core;

namespace Moshe;

/// <summary>
/// Moshe for Windows: the web app in <c>frontend/</c>, running on a folder of
/// Markdown on this PC (docs/BRIDGE.md), in a window that is all page under a
/// menu bar. Everything a person writes in is the page; this adds the window, the
/// menus, the folder and the few things a page can't do (ShellServices). The
/// Mac's is mac/Moshe.
/// </summary>
public partial class App : Application
{
    public static Options Options { get; private set; } = Options.Parse([]);

    /// <summary>The settings, the page's own storage and the log: %LOCALAPPDATA%\Moshe, or --data for the self-test.</summary>
    public static string DataDir { get; private set; } = "";

    public static string Version { get; } =
        typeof(App).Assembly.GetName().Version is { } v ? $"{v.Major}.{v.Minor}.{v.Build}" : "0";

    static Task<CoreWebView2Environment>? web;

    /// <summary>
    /// One WebView2 environment for every window, its data beside the settings
    /// rather than beside the app, with Windows 11's thin scrollbars that widen
    /// under the pointer instead of a browser's.
    /// </summary>
    public static Task<CoreWebView2Environment> WebEnvironment =>
        web ??= CoreWebView2Environment.CreateWithOptionsAsync("", Path.Join(DataDir, "WebView2"),
            new CoreWebView2EnvironmentOptions { ScrollBarStyle = CoreWebView2ScrollbarStyle.FluentOverlay }).AsTask();

    public App()
    {
        InitializeComponent();
        UnhandledException += (_, e) => Log.Write($"unhandled: {e.Exception}");
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        Options = Options.Parse(Environment.GetCommandLineArgs().Skip(1).ToArray());
        DataDir = Options.Data ?? Path.Join(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Moshe");
        Directory.CreateDirectory(DataDir);
        // no white flash before the page has drawn, in a dark theme
        Environment.SetEnvironmentVariable("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "0");
        Library.Load();
        if (Options.SelfTest) SelfTest.Start();
        ShellWindow.Open();
    }
}
