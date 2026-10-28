using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;
using Microsoft.UI;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Microsoft.Web.WebView2.Core;
using Windows.Graphics;
using Windows.Storage.Pickers;
using WinRT.Interop;

namespace Moshe;

/// <summary>
/// One Moshe window: a Mica title bar holding the menus (Menus), the way a
/// Windows 11 app has them, over the page, which draws everything else. The
/// Mac's is MosheWindowController in mac/Moshe/Window.swift.
/// </summary>
public sealed partial class ShellWindow : Window
{
    /// <summary>Every open window, the way the menus and the self-test find one.</summary>
    public static readonly List<ShellWindow> All = [];

    public IntPtr Handle { get; }
    WebView2? web;
    CoreWebView2Environment? environment;
    FolderBridge? bridge;
    readonly ShellServices services;
    readonly Menus menus;
    bool started;
    bool shellFull, pageFull;             // full screen by F11 or the menu; by the page itself (the Fullscreen API)
    ulong opening;                        // the navigation to the app's own page, whose failure is worth a word
    RectInt32 normal;                     // where the window is when it is neither maximised nor full screen

    public static ShellWindow Open()
    {
        var window = new ShellWindow();
        All.Add(window);
        window.Activate();
        return window;
    }

    ShellWindow()
    {
        InitializeComponent();
        Title = "Moshe";
        Handle = WindowNative.GetWindowHandle(this);
        services = new ShellServices(this);
        menus = new Menus(this, Menu);
        var icon = Path.Join(AppContext.BaseDirectory, "Assets", "Moshe.ico");
        if (File.Exists(icon)) AppWindow.SetIcon(icon);
        MakeTitleBar();
        Place();
        AppWindow.Changed += (_, e) =>
        {
            if ((e.DidPositionChange || e.DidSizeChange) && AppWindow.Presenter is OverlappedPresenter { State: OverlappedPresenterState.Restored })
                normal = new RectInt32(AppWindow.Position.X, AppWindow.Position.Y, AppWindow.Size.Width, AppWindow.Size.Height);
            if (e.DidSizeChange) FitTitleBar();
            if (e.DidPresenterChange) Presented();
        };
        Root.Loaded += async (_, _) =>
        {
            FitTitleBar();
            await StartAsync();
        };
        Activated += (_, e) =>
        {
            var active = e.WindowActivationState != WindowActivationState.Deactivated;
            // as any Windows title bar: dimmer while another window is in front
            TitleText.Opacity = AppIcon.Opacity = active ? 1 : 0.5;
            if (active) menus.Refresh();
        };
        Library.Moved += Reload;
        Closed += (_, _) =>
        {
            SavePlace();
            Library.Moved -= Reload;
            Teardown();
            All.Remove(this);
        };
    }

    // ---- the title bar ---------------------------------------------------------------

    /// <summary>
    /// The page's window runs to the top under Mica, as Windows 11's own apps do:
    /// the icon, the menus and the library's name in one row, the system's own
    /// caption buttons (and their Snap Layouts) at the right of it.
    /// </summary>
    void MakeTitleBar()
    {
        SystemBackdrop = new MicaBackdrop();
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(DragArea);
        var bar = AppWindow.TitleBar;
        bar.PreferredHeightOption = TitleBarHeightOption.Tall;
        bar.ButtonBackgroundColor = Colors.Transparent;
        bar.ButtonInactiveBackgroundColor = Colors.Transparent;
        PaintCaptionButtons();
        Root.ActualThemeChanged += (_, _) => PaintCaptionButtons();
        var png = Library.WebBundle == null ? null : Path.Join(Library.WebBundle, "icons", "icon-192.png");
        if (png != null && File.Exists(png)) AppIcon.Source = new BitmapImage(new Uri(png));
    }

    /// <summary>The caption buttons in the theme's colours, light or dark, as the system's own title bars have them.</summary>
    void PaintCaptionButtons()
    {
        var dark = Root.ActualTheme == ElementTheme.Dark;
        var bar = AppWindow.TitleBar;
        var ink = dark ? Colors.White : Colors.Black;
        bar.ButtonForegroundColor = ink;
        bar.ButtonHoverForegroundColor = ink;
        bar.ButtonPressedForegroundColor = ink;
        bar.ButtonHoverBackgroundColor = dark ? ColorHelper.FromArgb(0x15, 0xFF, 0xFF, 0xFF) : ColorHelper.FromArgb(0x09, 0, 0, 0);
        bar.ButtonPressedBackgroundColor = dark ? ColorHelper.FromArgb(0x0B, 0xFF, 0xFF, 0xFF) : ColorHelper.FromArgb(0x06, 0, 0, 0);
        bar.ButtonInactiveForegroundColor = dark ? ColorHelper.FromArgb(0x5D, 0xFF, 0xFF, 0xFF) : ColorHelper.FromArgb(0x5C, 0, 0, 0);
    }

    /// <summary>Room for the caption buttons, which the system draws over the row.</summary>
    void FitTitleBar()
    {
        var scale = Root.XamlRoot?.RasterizationScale ?? GetDpiForWindow(Handle) / 96.0;
        if (scale <= 0) return;
        LeftPad.Width = new GridLength(AppWindow.TitleBar.LeftInset / scale);
        RightPad.Width = new GridLength(AppWindow.TitleBar.RightInset / scale);
    }

    /// <summary>The window's name, in the title bar and the taskbar: the library's, then Moshe, as Windows names a document's window.</summary>
    void NameWindow()
    {
        var library = Library.UsesFolder && Library.Folder is { } folder ? Path.GetFileName(Path.TrimEndingDirectorySeparator(folder))
            : Library.Server?.Host;
        Title = TitleText.Text = string.IsNullOrEmpty(library) ? "Moshe" : $"{library} - Moshe";
    }

    async Task StartAsync()
    {
        if (started) return;
        started = true;
        // first run, or the folder has gone: ask for one, or the server, or quit
        if (!await EnsureChosenAsync())
        {
            // the first window's Quit quits; another window with nothing to show just closes
            if (All.Count > 1) Close();
            else Application.Current.Exit();
            return;
        }
        await MakeWebViewAsync();
        if (App.Options.SelfTest && All.Count == 1) await SelfTest.Run(this);
    }

    // ---- the page --------------------------------------------------------------------

    /// <summary>
    /// The web view for the library as it is now: the page from inside the app
    /// with the folder behind it, or the server's page. Made again when the library moves.
    /// </summary>
    async Task MakeWebViewAsync()
    {
        NameWindow();
        try { environment = await App.WebEnvironment; }
        catch (Exception e)
        {
            Log.Write($"no WebView2: {e}");
            Problem("Moshe needs the Microsoft Edge WebView2 Runtime",
                "It comes with Windows 11 and recent Windows 10. Install it from https://go.microsoft.com/fwlink/p/?LinkId=2124703, then open Moshe again.");
            return;
        }
        var view = new WebView2();
        Grid.SetRow(view, 1);
        Root.Children.Add(view);
        web = view;
        await view.EnsureCoreWebView2Async(environment);
        var core = view.CoreWebView2;
        var settings = core.Settings;
        settings.AreBrowserAcceleratorKeysEnabled = false;   // Ctrl+P, Ctrl+F, Ctrl+R… are the page's keys, not the browser's
        settings.IsStatusBarEnabled = false;
        // Zoom control stays on: off, WebView2 keeps Ctrl+Plus and Ctrl+Minus from the
        // page. Scripts.Shell turns them, and Ctrl and the wheel, into the page's own
        // text size (View › Zoom), so the browser never zooms the whole window.
        settings.IsPinchZoomEnabled = false;
        settings.IsSwipeNavigationEnabled = false;
        settings.IsGeneralAutofillEnabled = false;
        settings.IsPasswordAutosaveEnabled = false;
        settings.AreDevToolsEnabled = App.Options.DevTools || App.Options.SelfTest;
        // lets the page tell it is inside the shell (docs/BRIDGE.md, 1)
        settings.UserAgent = $"{settings.UserAgent} Moshe/{App.Version} (Windows shell)";

        var storage = Library.UsesFolder;
        var origins = new List<string> { AppScheme.Origin };
        if (Library.Server is { } server) origins.Add(server.GetLeftPart(UriPartial.Authority));
        await core.AddScriptToExecuteOnDocumentCreatedAsync(Scripts.Shell(origins, storage));
        core.WebMessageReceived += OnMessage;
        core.NavigationStarting += OnNavigationStarting;
        core.NavigationCompleted += OnNavigationCompleted;
        core.NewWindowRequested += OnNewWindowRequested;
        core.ProcessFailed += OnProcessFailed;
        core.ContextMenuRequested += OnContextMenuRequested;
        core.ContainsFullScreenElementChanged += (_, _) =>
        {
            pageFull = core.ContainsFullScreenElement;
            ApplyFullScreen();
        };
        if (storage)
        {
            new AppScheme(Library.WebBundle!, Library.Folder, environment).Attach(core);
            bridge = new FolderBridge(Library.Folder!, Reply, Nudge, Asked);
            bridge.StartWatching();
        }
        core.Navigate(Library.StartUri.AbsoluteUri);
    }

    /// <summary>The library moved: the page again, from where it lives now.</summary>
    public async void Reload()
    {
        Teardown();
        try { await MakeWebViewAsync(); }
        catch (Exception e) { Log.Write($"reload: {e}"); }
    }

    void Teardown()
    {
        bridge?.Dispose();
        bridge = null;
        // a page that was full screen goes with its web view
        if (pageFull)
        {
            pageFull = false;
            ApplyFullScreen();
        }
        if (web == null) return;
        Root.Children.Remove(web);
        try { web.Close(); } catch (Exception) { }
        web = null;
    }

    /// <summary>Where the window shows something instead of the page.</summary>
    void Problem(string title, string text)
    {
        var panel = new StackPanel { Spacing = 12, Margin = new Thickness(48), MaxWidth = 560, VerticalAlignment = VerticalAlignment.Center };
        panel.Children.Add(new TextBlock { Text = title, Style = (Style)Application.Current.Resources["SubtitleTextBlockStyle"], TextWrapping = TextWrapping.Wrap });
        panel.Children.Add(new TextBlock { Text = text, TextWrapping = TextWrapping.Wrap, IsTextSelectionEnabled = true });
        Grid.SetRow(panel, 1);
        Root.Children.Add(panel);
    }

    public Uri? Source => web?.Source;

    public IEnumerable<string> MenuTitles => menus.Titles;

    // ---- messages between the page and the window --------------------------------------

    void OnMessage(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        // only the app's own page, never anything else loaded into the window
        if (!Uri.TryCreate(e.Source, UriKind.Absolute, out var source) || !Library.IsOurs(source)) return;
        JsonObject? message;
        try { message = JsonNode.Parse(e.WebMessageAsJson) as JsonObject; }
        catch (Exception) { return; }
        if (message == null) return;
        switch (J.Text(message["channel"]))
        {
            case "storage" when bridge != null && source.AbsoluteUri.StartsWith(AppScheme.Origin + "/", StringComparison.OrdinalIgnoreCase):
                bridge.Receive(J.Int(message["id"]), J.Text(message["json"]) ?? "");
                break;
            case "shell":
                services.Handle(J.Int(message["id"]), J.Text(message["op"]) ?? "", message["args"] as JsonObject ?? new JsonObject());
                break;
            case "window":
                switch (J.Text(message["what"]))
                {
                    case "close": Close(); break;
                    case "newWindow": Open(); break;
                    case "fullScreen": ToggleFullScreen(); break;
                    case "menu": menus.Open(J.Text(message["letter"])); break;     // Alt, or Alt and a menu's letter
                    case "zoom":                                                     // Ctrl and +, -, 0 or the wheel
                        var step = J.Int(message["step"]);
                        Command(step > 0 ? "zoomIn" : step < 0 ? "zoomOut" : "zoomReset");
                        break;
                }
                break;
        }
    }

    /// <summary>A message to the page, from any thread.</summary>
    public void Post(JsonObject message)
    {
        var json = message.ToJsonString();
        DispatcherQueue.TryEnqueue(() =>
        {
            try { web?.CoreWebView2?.PostWebMessageAsJson(json); }
            catch (Exception e) { Log.Write($"post: {e.Message}"); }
        });
    }

    void Reply(int id, JsonObject answer) => Post(new JsonObject { ["channel"] = "storage", ["id"] = id, ["reply"] = answer });

    void Nudge() => DispatcherQueue.TryEnqueue(() =>
        _ = web?.CoreWebView2?.ExecuteScriptAsync("window.__mosheFilesChanged && window.__mosheFilesChanged()"));

    /// <summary>The bridge's pick and useServer: the picker is the window's; the reply goes when it closes, then the reload.</summary>
    async void Asked(int id, string op)
    {
        if (op == "pick")
        {
            var chosen = await ChooseFolderAsync();
            Reply(id, J.Ok(new JsonObject { ["changed"] = chosen != null }));
            if (chosen != null) Library.UseFolder(chosen);
            return;
        }
        if (Library.Server == null && !await AskServerAsync())
        {
            Reply(id, J.Ok(null));
            return;
        }
        Reply(id, J.Ok(null));
        Library.UseServer();
    }

    /// <summary>Run one of the page's commands (App.svelte, window.mosheCommand), with the keyboard back in the page.</summary>
    public void Command(string name, JsonNode? arg = null)
    {
        FocusPage();
        var a = arg?.ToJsonString() ?? "undefined";
        _ = web?.CoreWebView2?.ExecuteScriptAsync($"window.mosheCommand ? window.mosheCommand({J.Quote(name)}, {a}) : false");
    }

    /// <summary>The keyboard to the page: after a menu, so typing goes on where it was.</summary>
    public void FocusPage() => web?.Focus(FocusState.Programmatic);

    /// <summary>window.mosheMenuState() (docs/MENUS.md), or null before the page has one.</summary>
    public async Task<JsonObject?> MenuState()
    {
        if (web?.CoreWebView2 is not { } core) return null;
        try { return JsonNode.Parse(await core.ExecuteScriptAsync("window.mosheMenuState ? window.mosheMenuState() : null")) as JsonObject; }
        catch (Exception) { return null; }
    }

    /// <summary>
    /// A key pressed in the page as if on the keyboard (DevTools' Input domain), so
    /// Cut, Copy, Paste and Select All in the menu do just what their keys do.
    /// <paramref name="modifiers"/>: 1 Alt, 2 Ctrl, 8 Shift.
    /// </summary>
    public async void Key(string key, string code, int virtualKey, int modifiers)
    {
        if (web?.CoreWebView2 is not { } core) return;
        web.Focus(FocusState.Programmatic);
        foreach (var type in new[] { "rawKeyDown", "keyUp" })
            await core.CallDevToolsProtocolMethodAsync("Input.dispatchKeyEvent", new JsonObject
            {
                ["type"] = type, ["modifiers"] = modifiers, ["key"] = key, ["code"] = code,
                ["windowsVirtualKeyCode"] = virtualKey, ["nativeVirtualKeyCode"] = virtualKey,
            }.ToJsonString());
    }

    /// <summary>The mouse wheel turned over the page (DevTools' Input domain), for the self-test.</summary>
    public async Task Wheel(double deltaY, int modifiers)
    {
        if (web?.CoreWebView2 is not { } core) return;
        await core.CallDevToolsProtocolMethodAsync("Input.dispatchMouseEvent", new JsonObject
        {
            ["type"] = "mouseWheel", ["x"] = 300, ["y"] = 300, ["deltaX"] = 0, ["deltaY"] = deltaY, ["modifiers"] = modifiers,
        }.ToJsonString());
    }

    /// <summary>An expression in the page, a promise awaited, the value as JSON (for the self-test); <paramref name="gesture"/> as if a person had clicked.</summary>
    public async Task<JsonNode?> Evaluate(string expression, bool gesture = false)
    {
        var core = web?.CoreWebView2 ?? throw new InvalidOperationException("no page yet");
        var json = await core.CallDevToolsProtocolMethodAsync("Runtime.evaluate",
            new JsonObject { ["expression"] = expression, ["awaitPromise"] = true, ["returnByValue"] = true, ["userGesture"] = gesture }.ToJsonString());
        var result = JsonNode.Parse(json);
        if (result?["exceptionDetails"] is { } problem)
            throw new Exception(problem["exception"]?["description"]?.ToString() ?? problem.ToJsonString());
        return result?["result"]?["value"]?.DeepClone();
    }

    // ---- what loads in the window ---------------------------------------------------------

    /// <summary>The window only ever shows the app. A link anywhere else — in the text, Ctrl-click on an address — opens in the browser.</summary>
    void OnNavigationStarting(CoreWebView2 sender, CoreWebView2NavigationStartingEventArgs e)
    {
        if (Uri.TryCreate(e.Uri, UriKind.Absolute, out var target) && (Library.IsOurs(target) || target.Scheme is "about" or "data"))
        {
            opening = e.NavigationId;
            return;
        }
        e.Cancel = true;
        // and a file dropped where the page didn't take it isn't opened in place of the app
        if (target?.Scheme is "http" or "https" or "mailto") Outside.Open(target);
    }

    void OnNavigationCompleted(CoreWebView2 sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        if (e.IsSuccess || e.NavigationId != opening || e.WebErrorStatus == CoreWebView2WebErrorStatus.OperationCanceled) return;
        var place = Library.UsesFolder ? "the app's own page" : Library.Server?.AbsoluteUri ?? "the server";
        Log.Write($"could not open {place}: {e.WebErrorStatus}");
        sender.NavigateToString(Unreachable(place, e.WebErrorStatus.ToString()));
    }

    /// <summary>window.open and target=_blank: the browser, or for the app's own pages another window.</summary>
    void OnNewWindowRequested(CoreWebView2 sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        e.Handled = true;
        if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var target)) return;
        if (Library.IsOurs(target)) Open();
        else if (target.Scheme is "http" or "https" or "mailto") Outside.Open(target);
    }

    void OnProcessFailed(CoreWebView2 sender, CoreWebView2ProcessFailedEventArgs e)
    {
        Log.Write($"the page's process failed: {e.ProcessFailedKind}");
        // WebView2's page process went away (memory, a crash): bring the page back;
        // the whole browser gone: a web view again
        if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessExited) sender.Reload();
        else if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited) DispatcherQueue.TryEnqueue(Reload);
    }

    static readonly HashSet<string> Unwanted =
        ["back", "forward", "reload", "saveAs", "print", "createQrCode", "share", "webCapture", "openLinkInNewWindow", "saveLinkAs", "copyLinkToHighlight"];

    /// <summary>
    /// The page's right-click menu, without what belongs to a browser, and in the
    /// editor with the formatting a Windows writing app has there: after the
    /// spelling suggestions, before Cut, Copy and Paste.
    /// </summary>
    async void OnContextMenuRequested(CoreWebView2 sender, CoreWebView2ContextMenuRequestedEventArgs e)
    {
        var items = e.MenuItems;
        for (var i = items.Count - 1; i >= 0; i--)
            if (Unwanted.Contains(items[i].Name)) items.RemoveAt(i);
        if (e.ContextMenuTarget.IsEditable && environment != null)
        {
            var deferral = e.GetDeferral();
            try
            {
                // the sheet's own text, not a search box or a field in a panel
                if (await sender.ExecuteScriptAsync("!!(document.activeElement && document.activeElement.isContentEditable)") == "true")
                {
                    var at = items.Select((item, i) => (item, i)).FirstOrDefault(x => x.item.Name is "cut" or "copy" or "paste").i;
                    if (at == 0 && items.Count > 0 && items[0].Name is not ("cut" or "copy" or "paste")) at = items.Count;
                    var formatting = Formatting();
                    for (var i = formatting.Count - 1; i >= 0; i--) items.Insert(at, formatting[i]);
                }
            }
            catch (Exception x) { Log.Write($"context menu: {x.Message}"); }
            finally
            {
                Tidy(items);
                deferral.Complete();
            }
        }
        else Tidy(items);
    }

    /// <summary>No separator left at an end of the menu, or beside another.</summary>
    static void Tidy(IList<CoreWebView2ContextMenuItem> items)
    {
        for (var i = items.Count - 1; i >= 0; i--)
            if (items[i].Kind == CoreWebView2ContextMenuItemKind.Separator
                && (i == 0 || i == items.Count - 1 || items[i - 1].Kind == CoreWebView2ContextMenuItemKind.Separator))
                items.RemoveAt(i);
    }

    /// <summary>The editor's right-click formatting: the page's own commands (docs/MENUS.md, Markup and Insert).</summary>
    List<CoreWebView2ContextMenuItem> Formatting()
    {
        CoreWebView2ContextMenuItem Item(string label, string command, JsonNode? arg = null)
        {
            var item = environment!.CreateContextMenuItem(label, null, CoreWebView2ContextMenuItemKind.Command);
            item.CustomItemSelected += (_, _) => Command(command, arg);
            return item;
        }
        CoreWebView2ContextMenuItem Sub(string label, params CoreWebView2ContextMenuItem[] children)
        {
            var sub = environment!.CreateContextMenuItem(label, null, CoreWebView2ContextMenuItemKind.Submenu);
            foreach (var child in children) sub.Children.Add(child);
            return sub;
        }
        CoreWebView2ContextMenuItem Line() => environment!.CreateContextMenuItem("", null, CoreWebView2ContextMenuItemKind.Separator);
        return
        [
            Line(),
            Item("Strong", "strong"), Item("Emphasis", "emphasis"), Item("Code", "code"), Item("Link", "link"),
            Sub("Mark", Item("Mark", "mark"), Item("Delete", "markDelete"), Item("Insert", "markInsert"), Item("Comment", "comment")),
            Sub("Heading", Item("Title", "heading", 1), Item("Heading", "heading", 2), Item("Subheading", "heading", 3), Item("Paragraph", "heading", 0)),
            Sub("Insert", Item("Footnote", "insert", "footnote"), Item("Image", "insert", "image"), Item("Table", "insert", "table"),
                Item("Equation", "insert", "equation"), Item("Divider", "insert", "divider")),
            Item("Clear Markup", "clearMarkup"),
            Line(),
        ];
    }

    // ---- full screen ---------------------------------------------------------------------

    public bool IsFullScreen => AppWindow.Presenter.Kind == AppWindowPresenterKind.FullScreen;
    public bool TitleShown => TitleRow.Visibility == Visibility.Visible;

    /// <summary>
    /// F11 and View › Full Screen. Out of full screen is out, whichever way it
    /// came: the page's own full screen too, so nothing is left half-way.
    /// </summary>
    public void ToggleFullScreen()
    {
        if (shellFull || pageFull || IsFullScreen)
        {
            shellFull = false;
            if (pageFull) _ = web?.CoreWebView2?.ExecuteScriptAsync("document.fullscreenElement && document.exitFullscreen()");
            pageFull = false;
        }
        else shellFull = true;
        ApplyFullScreen();
    }

    /// <summary>One state from the two ways in: full screen while either wants it, the title bar exactly when not.</summary>
    void ApplyFullScreen()
    {
        var want = shellFull || pageFull;
        if (want != IsFullScreen) AppWindow.SetPresenter(want ? AppWindowPresenterKind.FullScreen : AppWindowPresenterKind.Overlapped);
        Presented();
        if (want) Hint(pageFull && !shellFull ? "Press Esc to exit full screen" : "Press F11 to exit full screen");
    }

    /// <summary>
    /// The presenter changed, by us or by Windows (Win+↓ takes a window out of full
    /// screen): the title bar follows what the window really is.
    /// </summary>
    void Presented()
    {
        if (!IsFullScreen && (shellFull || pageFull))
        {
            shellFull = false;
            if (pageFull) _ = web?.CoreWebView2?.ExecuteScriptAsync("document.fullscreenElement && document.exitFullscreen()");
            pageFull = false;
        }
        TitleRow.Visibility = IsFullScreen ? Visibility.Collapsed : Visibility.Visible;
    }

    Border? hint;

    /// <summary>A word at the top for three seconds, as Windows' browsers say how to leave full screen.</summary>
    void Hint(string text)
    {
        if (hint != null) Root.Children.Remove(hint);
        hint = new Border
        {
            Background = new SolidColorBrush(ColorHelper.FromArgb(0xE6, 0x2B, 0x2B, 0x2B)),
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(16, 10, 16, 10),
            Margin = new Thickness(0, 24, 0, 0),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Top,
            IsHitTestVisible = false,
            Child = new TextBlock { Text = text, Foreground = new SolidColorBrush(Colors.White) },
        };
        Grid.SetRowSpan(hint, 2);
        Root.Children.Add(hint);
        var shown = hint;
        hintTimer?.Stop();
        hintTimer = DispatcherQueue.CreateTimer();
        hintTimer.Interval = TimeSpan.FromSeconds(3);
        hintTimer.IsRepeating = false;
        hintTimer.Tick += (_, _) =>
        {
            Root.Children.Remove(shown);
            if (hint == shown) hint = null;
        };
        hintTimer.Start();
    }

    Microsoft.UI.Dispatching.DispatcherQueueTimer? hintTimer;

    static string Unreachable(string place, string why)
    {
        static string Esc(string s) => s.Replace("&", "&amp;").Replace("<", "&lt;");
        return $$"""
            <!doctype html><meta charset="utf-8"><style>
            body{font:14px "Segoe UI Variable Text","Segoe UI",sans-serif;color:#555;display:flex;height:100vh;margin:0;align-items:center;justify-content:center;text-align:center}
            @media (prefers-color-scheme:dark){body{color:#bbb;background:#202020} }
            h1{font-size:18px;font-weight:600;color:inherit}
            </style><div><h1>Moshe could not open {{Esc(place)}}</h1><p>{{Esc(why)}}</p>
            <p>Choose a library folder or another server from the File menu.</p></div>
            """;
    }

    // ---- choosing the library ---------------------------------------------------------------

    /// <summary>First run, or the folder has gone: ask for one. False to quit.</summary>
    async Task<bool> EnsureChosenAsync()
    {
        // server mode with no server to open
        if (Library.Mode == "server" && Library.Server == null) Library.Choose("folder");
        if (Library.Mode != "folder" || Library.Folder != null) return true;
        if (Library.WebBundle == null)
        {
            // a build without the web app can only be a server's window
            if (Library.Server == null && !await AskServerAsync()) return false;
            Library.Choose("server");
            return true;
        }
        if (All.Count > 1 || App.Options.SelfTest) return Library.Folder != null;   // one window asks
        while (true)
        {
            var dialog = new ContentDialog
            {
                XamlRoot = Root.XamlRoot,
                Title = Library.FolderMissing ? "Moshe can't find your library folder" : "Moshe keeps your writing in a folder",
                Content = new TextBlock
                {
                    TextWrapping = TextWrapping.Wrap,
                    Text = "Choose the folder your sheets live in: a folder in your Obsidian vault, or any folder Syncthing or OneDrive "
                        + "keeps in step. An empty folder starts an empty library. Or open the library on a Moshe server instead.",
                },
                PrimaryButtonText = "Choose Folder…",
                SecondaryButtonText = Library.Server == null ? "Use a Server…" : "Use the Server",
                CloseButtonText = "Quit",
                DefaultButton = ContentDialogButton.Primary,
            };
            switch (await dialog.ShowAsync())
            {
                case ContentDialogResult.Primary:
                    if (await ChooseFolderAsync() is { } folder)
                    {
                        Library.Choose("folder", folder);
                        return true;
                    }
                    continue;
                case ContentDialogResult.Secondary:
                    if (Library.Server == null && !await AskServerAsync()) continue;
                    Library.Choose("server");
                    return true;
                default:
                    return false;
            }
        }
    }

    /// <summary>The folder picker. Null if cancelled.</summary>
    public async Task<string?> ChooseFolderAsync()
    {
        if (App.Options.SelfTest) return null;
        var picker = new FolderPicker { SuggestedStartLocation = PickerLocationId.DocumentsLibrary, CommitButtonText = "Use This Folder" };
        picker.FileTypeFilter.Add("*");
        InitializeWithWindow.Initialize(picker, Handle);
        var folder = await picker.PickSingleFolderAsync();
        if (folder == null) return null;
        if (string.IsNullOrEmpty(folder.Path))
        {
            await Tell("Moshe needs a folder on this PC", "That place isn't a folder Moshe can read and write directly. Choose one on a drive, in OneDrive, or in Syncthing's folders.");
            return null;
        }
        return folder.Path;
    }

    /// <summary>The server's address, asked for and kept. False if cancelled or not an address.</summary>
    public async Task<bool> AskServerAsync()
    {
        if (App.Options.SelfTest) return false;
        var box = new TextBox { PlaceholderText = "https://moshe.example.com/", Text = Library.Server?.AbsoluteUri ?? "" };
        var panel = new StackPanel { Spacing = 12 };
        panel.Children.Add(new TextBlock { Text = "Moshe opens the library on this server instead of a folder on this PC.", TextWrapping = TextWrapping.Wrap });
        panel.Children.Add(box);
        var dialog = new ContentDialog
        {
            XamlRoot = Root.XamlRoot,
            Title = "The server's address",
            Content = panel,
            PrimaryButtonText = "Use the Server",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Primary,
        };
        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return false;
        if (!Uri.TryCreate(box.Text.Trim(), UriKind.Absolute, out var url) || url.Scheme is not ("http" or "https") || url.Host.Length == 0)
        {
            await Tell("That isn't a server's address", "Type the whole address, starting with https://");
            return false;
        }
        Library.SetServer(url);
        return true;
    }

    public async Task Tell(string title, string text)
    {
        var dialog = new ContentDialog
        {
            XamlRoot = Root.XamlRoot,
            Title = title,
            Content = new TextBlock { Text = text, TextWrapping = TextWrapping.Wrap, IsTextSelectionEnabled = true },
            CloseButtonText = "OK",
        };
        await dialog.ShowAsync();
    }

    // what the File menu's own items do

    public async void ChooseLibraryFolder()
    {
        if (await ChooseFolderAsync() is { } folder) Library.UseFolder(folder);
    }

    public static void RevealFolder()
    {
        if (Library.Folder is { } folder) Process.Start(new ProcessStartInfo("explorer.exe") { ArgumentList = { folder }, UseShellExecute = false });
    }

    public async void UseTheServer()
    {
        if (await AskServerAsync()) Library.UseServer();
    }

    // ---- where the window is ------------------------------------------------------------------

    [DllImport("user32.dll")]
    static extern uint GetDpiForWindow(IntPtr window);

    /// <summary>The first window where it was last time; another cascaded from the one in front.</summary>
    void Place()
    {
        var scale = GetDpiForWindow(Handle) / 96.0;
        var size = new SizeInt32((int)(1240 * scale), (int)(800 * scale));
        if (All.Count == 0 && Library.WindowPlace is [var x, var y, var w, var h, var maximised]
            && w > 200 && h > 200 && DisplayArea.GetFromRect(new RectInt32(x, y, w, h), DisplayAreaFallback.None) != null)
        {
            normal = new RectInt32(x, y, w, h);
            AppWindow.MoveAndResize(normal);
            if (maximised == 1 && AppWindow.Presenter is OverlappedPresenter presenter) presenter.Maximize();
            return;
        }
        AppWindow.Resize(size);
        if (All.Count > 0)
        {
            var front = All[^1].AppWindow.Position;
            AppWindow.Move(new PointInt32(front.X + (int)(28 * scale), front.Y + (int)(28 * scale)));
        }
        else
        {
            var area = DisplayArea.GetFromWindowId(AppWindow.Id, DisplayAreaFallback.Primary).WorkArea;
            AppWindow.Move(new PointInt32(area.X + Math.Max(0, (area.Width - size.Width) / 2), area.Y + Math.Max(0, (area.Height - size.Height) / 2)));
        }
        normal = new RectInt32(AppWindow.Position.X, AppWindow.Position.Y, AppWindow.Size.Width, AppWindow.Size.Height);
    }

    void SavePlace()
    {
        if (App.Options.SelfTest || AppWindow.Presenter.Kind == AppWindowPresenterKind.FullScreen) return;
        var maximised = AppWindow.Presenter is OverlappedPresenter { State: OverlappedPresenterState.Maximized };
        Library.WindowPlace = [normal.X, normal.Y, normal.Width, normal.Height, maximised ? 1 : 0];
    }
}
