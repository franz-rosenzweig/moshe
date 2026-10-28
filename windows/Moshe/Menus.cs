using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Windows.ApplicationModel.DataTransfer;

namespace Moshe;

/// <summary>
/// The menu bar of docs/MENUS.md, the Windows way: the Mac's items and commands
/// (mac/Moshe/Menus.swift) with Ctrl for ⌘. The page hears every key first, so an
/// item only shows its key; choosing the item calls the same command,
/// window.mosheCommand(name, arg), and either way it runs once. What is ticked,
/// what a toggle says now, and the submenus built from the library come from
/// window.mosheMenuState() when a menu is pressed open. ⌃⌘ chords have no Windows
/// key, so those items are in the menu only.
/// </summary>
sealed class Menus
{
    readonly ShellWindow owner;
    readonly MenuBar bar;
    readonly List<Action<JsonObject>> updates = [];
    readonly List<(MenuFlyoutItemBase Item, Func<string> Command)> pageItems = [];
    int groups;

    public Menus(ShellWindow owner, MenuBar bar)
    {
        this.owner = owner;
        this.bar = bar;
        Build();
        foreach (var top in bar.Items)
            top.AddHandler(UIElement.PointerPressedEvent, new PointerEventHandler((_, _) => Refresh()), handledEventsToo: true);
    }

    /// <summary>The page's state, into every item: enabled for the commands the page has, ticks, titles, submenus.</summary>
    public async void Refresh()
    {
        if (await owner.MenuState() is not { } state) return;
        var commands = state["commands"] is JsonArray names ? names.Select(J.Text).OfType<string>().ToHashSet() : null;
        foreach (var (item, command) in pageItems) item.IsEnabled = commands == null || commands.Contains(command());
        foreach (var update in updates) update(state);
    }

    void Run(string command, JsonNode? arg)
    {
        owner.Command(command, arg);
        // what the command changed shows the next time a menu opens; and now, if one is open
        _ = Task.Delay(200).ContinueWith(_ => owner.DispatcherQueue.TryEnqueue(Refresh));
    }

    void Build()
    {
        var file = Top("File");
        Page(file, "New Sheet", "newSheet", key: "Ctrl+N");
        Page(file, "New Material Sheet", "newMaterialSheet");
        Page(file, "New Handwritten Sheet", "newHandwrittenSheet");
        Page(file, "New Group…", "newGroup", key: "Ctrl+Shift+N");
        Page(file, "New Filter…", "newFilter");
        Page(file, "New Project…", "newProject");
        Line(file);
        Page(file, "Open Quickly…", "openQuickly", key: "Ctrl+O");
        Line(file);
        Swap(file, "Add to Favorites", "Remove from Favorites", "favorite", "favorite");
        Swap(file, "Mark as Material", "Mark as Text", "material", "material");
        Page(file, "Keywords…", "keywords", key: "Ctrl+Shift+K");
        Page(file, "Goal…", "goal");
        Page(file, "Statistics…", "statistics");
        Swap(file, "Glue Sheets", "Unglue Sheets", "glued", "glue");
        Page(file, "Merge Sheets…", "merge");
        Page(file, "Duplicate", "duplicate", key: "Ctrl+D");
        Line(file);
        Page(file, "Export…", "export", key: "Ctrl+Shift+P");
        Page(file, "Print…", "print", key: "Ctrl+P");
        Page(file, "Share…", "share");
        Line(file);
        Page(file, "Browse Backups…", "browseBackups");
        Page(file, "Import…", "import");
        Line(file);
        Shell(file, "Library Folder…", owner.ChooseLibraryFolder);
        var reveal = Shell(file, "Show Library in File Explorer", ShellWindow.RevealFolder);
        updates.Add(_ => reveal.IsEnabled = Library.Folder != null);
        Shell(file, "Use the Server…", owner.UseTheServer);
        Line(file);
        Page(file, "Settings…", "settings", key: "Ctrl+,");
        Line(file);
        Shell(file, "New Window", () => ShellWindow.Open(), "Ctrl+Alt+N");
        Shell(file, "Close Window", owner.Close, "Ctrl+W");
        Shell(file, "Exit", () => Application.Current.Exit(), "Alt+F4");

        var edit = Top("Edit");
        var undo = Page(edit, "Undo", "undo", key: "Ctrl+Z");
        var redo = Page(edit, "Redo", "redo", key: "Ctrl+Shift+Z");
        // a page from before canUndo: always
        updates.Add(s => { if (s["canUndo"] != null && !J.Bool(s["canUndo"])) undo.IsEnabled = false; });
        updates.Add(s => { if (s["canRedo"] != null && !J.Bool(s["canRedo"])) redo.IsEnabled = false; });
        Line(edit);
        Native(edit, "Cut", "Ctrl+X", "x", 0x58);
        Native(edit, "Copy", "Ctrl+C", "c", 0x43);
        var copyAs = Sub(edit, "Copy As");
        Page(copyAs.Items, "Markdown", "copyAs", "markdown");
        Page(copyAs.Items, "HTML", "copyAs", "html");
        Page(copyAs.Items, "Rich Text", "copyAs", "rich");
        Native(edit, "Paste", "Ctrl+V", "v", 0x56);
        var paste = Sub(edit, "Paste As");
        Native(paste.Items, "Plain Text", "Ctrl+Shift+V", "V", 0x56, modifiers: 2 | 8);
        Clip(paste.Items, "Code Block", "pasteAs", "code");
        Clip(paste.Items, "Raw Source Block", "pasteAs", "raw");
        Line(paste.Items);
        Clip(paste.Items, "From Markdown", "pasteFrom", "markdown", key: "Ctrl+Alt+V");
        Clip(paste.Items, "From HTML", "pasteFrom", "html");
        Clip(paste.Items, "From Rich Text", "pasteFrom", "rich");
        Native(edit, "Select All", "Ctrl+A", "a", 0x41);
        Line(edit);
        var up = Page(edit, "Move Line Up", "moveUp");
        var down = Page(edit, "Move Line Down", "moveDown");
        updates.Add(s =>
        {
            var what = J.Text(s["focus"]) == "list" ? "Sheet" : "Line";
            up.Text = $"Move {what} Up";
            down.Text = $"Move {what} Down";
        });
        Page(edit, "Split at Selection", "split", key: "Ctrl+Shift+B");
        Page(edit, "Attach Note…", "attachNote");
        Page(edit, "Attach Image…", "attachImage");
        Line(edit);
        var find = Sub(edit, "Find");
        Page(find.Items, "Find…", "find", "open", "Ctrl+F");
        Page(find.Items, "Find and Replace…", "find", "replace", "Ctrl+Alt+F");
        Page(find.Items, "Find Next", "find", "next", "Ctrl+G");
        Page(find.Items, "Find Previous", "find", "previous", "Ctrl+Shift+G");
        Page(find.Items, "Use Selection for Find", "find", "selection", "Ctrl+E");
        Line(find.Items);
        Page(find.Items, "Search Library…", "openQuickly", key: "Ctrl+Shift+F");

        var markup = Top("Markup");
        Page(markup, "Title", "heading", 1, "Ctrl+Alt+1");
        Page(markup, "Heading", "heading", 2, "Ctrl+Alt+2");
        Page(markup, "Subheading", "heading", 3, "Ctrl+Alt+3");
        var more = Sub(markup, "More");
        Page(more.Items, "Heading 4", "heading", 4, "Ctrl+Alt+4");
        Page(more.Items, "Heading 5", "heading", 5, "Ctrl+Alt+5");
        Page(more.Items, "Heading 6", "heading", 6, "Ctrl+Alt+6");
        Page(more.Items, "Paragraph", "heading", 0, "Ctrl+Alt+0");
        Line(markup);
        Page(markup, "Strong", "strong", key: "Ctrl+B");
        Page(markup, "Emphasis", "emphasis", key: "Ctrl+I");
        Page(markup, "Code", "code");
        var mark = Sub(markup, "Mark");
        Page(mark.Items, "Mark", "mark", key: "Ctrl+Shift+H");
        Page(mark.Items, "Delete", "markDelete");
        Page(mark.Items, "Insert", "markInsert");
        Page(mark.Items, "Comment", "comment", key: "Ctrl+Shift+C");
        Page(markup, "Link", "link", key: "Ctrl+K");
        Page(markup, "Annotate", "annotate");
        Line(markup);
        Page(markup, "Dashed List", "dashedList");
        Page(markup, "Numbered List", "numberedList");
        Page(markup, "Quote", "quote");
        Line(markup);
        Page(markup, "Comment Block", "commentBlock");
        Page(markup, "Code Block", "codeBlock");
        Page(markup, "Raw Source Block", "rawBlock");
        Line(markup);
        Page(markup, "Clear Markup", "clearMarkup", key: "Ctrl+L");

        var insert = Top("Insert");
        Page(insert, "Line Break", "insert", "lineBreak", "Shift+Enter");
        Page(insert, "Tab", "insert", "tab");
        Page(insert, "Divider", "insert", "divider");
        Line(insert);
        Page(insert, "Image", "insert", "image");
        Page(insert, "Video", "insert", "video");
        Page(insert, "Footnote", "insert", "footnote");
        Page(insert, "Equation", "insert", "equation");
        Page(insert, "Table", "insert", "table");
        Page(insert, "Table of Contents", "insert", "toc");
        Line(insert);
        Page(insert, "Sketch…", "insert", "sketch");

        var view = Top("View");
        Swap(view, "Show Library", "Hide Library", "library", "showLibrary", "showSheets");
        Dynamic(view, "Dashboard", "dashboardViews", "dashboardView", "dashboardView");
        Toggle(view, "Second Editor", "secondEditor", "secondEditor", "Ctrl+Alt+3");
        Swap(view, "Show Counter", "Hide Counter", "counter", "toggleCounter");
        Swap(view, "Show Paragraph Numbers", "Hide Paragraph Numbers", "paragraphNumbers", "toggleParagraphNumbers");
        var dates = Toggle(null, "Show Dates", "toggleSheetDates", "sheetDates");
        Dynamic(view, "Sheet List", "sheetSorts", "sheetSort", "sheetSort", items =>
        {
            Line(items);
            items.Add(dates);
        });
        Line(view);
        Toggle(view, "Translation Mode", "translation", "translation", "Ctrl+Shift+T");
        Toggle(view, "Revision Mode", "revision", "revision", "Ctrl+Shift+E");
        Line(view);
        Page(view, "Zoom In", "zoomIn", key: "Ctrl+Plus");
        Page(view, "Zoom Out", "zoomOut", key: "Ctrl+Minus");
        Page(view, "Default Size", "zoomReset", key: "Ctrl+0");
        Line(view);
        Swap(view, "Show Line Marker", "Hide Line Marker", "lineMarker", "toggleLineMarker");
        Choices(view, "Highlight", "highlight", "highlight", [("off", "Off"), ("line", "Line"), ("sentence", "Sentence"), ("paragraph", "Paragraph")]);
        Choices(view, "Fixed Scrolling", "fixedScrolling", "fixedScrolling",
            [("off", "Off"), ("top", "Top"), ("middle", "Middle"), ("bottom", "Bottom"), ("variable", "Variable")]);
        Line(view);
        Choices(view, "Appearance", "appearance", "appearance", [("system", "Match System"), ("light", "Light"), ("dark", "Dark")]);
        Dynamic(view, "Theme", "themes", "theme", "theme");
        Line(view);
        Toggle(view, "Focus Mode", "hideInterface", "interfaceHidden", "Ctrl+.");
        Shell(view, "Full Screen", () => owner.FullScreen(owner.AppWindow.Presenter.Kind != Microsoft.UI.Windowing.AppWindowPresenterKind.FullScreen), "F11");

        var go = Top("Go");
        Page(go, "Back", "back", key: "Ctrl+[");
        Page(go, "Forward", "forward", key: "Ctrl+]");
        Line(go);
        Dynamic(go, "Notes", "notes", "select", "selection");
        Dynamic(go, "Projects", "projects", "select", "selection");
        Page(go, "Favorites", "favorites", key: "Ctrl+Shift+U");
        Line(go);
        Page(go, "Previous Sheet", "previousSheet", key: "Ctrl+Alt+Up");
        Page(go, "Next Sheet", "nextSheet", key: "Ctrl+Alt+Down");
        Line(go);
        Page(go, "Library", "showLibrary", key: "Ctrl+1");
        Page(go, "Sheet List", "showSheets", key: "Ctrl+2");
        Page(go, "Editor", "showEditor", key: "Ctrl+3");
        Page(go, "Dashboard", "dashboard", key: "Ctrl+4");

        var window = Top("Window");
        Shell(window, "New Window", () => ShellWindow.Open(), "Ctrl+Alt+N");
        Line(window);
        Page(window, "Quick Export", "panel", "export", "Ctrl+6");
        Page(window, "Statistics", "panel", "statistics", "Ctrl+7");
        Page(window, "Navigation", "panel", "navigation", "Ctrl+8");
        Page(window, "Markup", "panel", "markup", "Ctrl+9");
        Page(window, "Keyword Manager", "keywordManager");

        var help = Top("Help");
        Shell(help, "Moshe Help", () => Outside.Open(new Uri("https://github.com/franz-rosenzweig/moshe#readme")));
        Page(help, "Getting Started", "gettingStarted");
        Line(help);
        Shell(help, "About Moshe", async () => await owner.Tell("Moshe", $"Version {App.Version}, for Windows.\nhttps://github.com/franz-rosenzweig/moshe"));
    }

    // ---- the kinds of item -----------------------------------------------------------------

    IList<MenuFlyoutItemBase> Top(string title)
    {
        var menu = new MenuBarItem { Title = title };
        bar.Items.Add(menu);
        return menu.Items;
    }

    static MenuFlyoutSubItem Sub(IList<MenuFlyoutItemBase> into, string text)
    {
        var sub = new MenuFlyoutSubItem { Text = text };
        into.Add(sub);
        return sub;
    }

    static void Line(IList<MenuFlyoutItemBase> into) => into.Add(new MenuFlyoutSeparator());

    static void Key(MenuFlyoutItem item, string? key)
    {
        if (key != null) item.KeyboardAcceleratorTextOverride = key;
    }

    /// <summary>An item that runs one of the page's commands.</summary>
    MenuFlyoutItem Page(IList<MenuFlyoutItemBase> into, string text, string command, JsonNode? arg = null, string? key = null)
    {
        var item = new MenuFlyoutItem { Text = text };
        Key(item, key);
        item.Click += (_, _) => Run(command, arg);
        into.Add(item);
        pageItems.Add((item, () => command));
        return item;
    }

    /// <summary>An item ticked while the page says so (Translation Mode). Into a menu, or kept for one built later.</summary>
    ToggleMenuFlyoutItem Toggle(IList<MenuFlyoutItemBase>? into, string text, string command, string state, string? key = null)
    {
        var item = new ToggleMenuFlyoutItem { Text = text };
        Key(item, key);
        item.Click += (_, _) => Run(command, null);
        into?.Add(item);
        pageItems.Add((item, () => command));
        updates.Add(s => item.IsChecked = J.Bool(s[state]));
        return item;
    }

    /// <summary>An item whose title says what it will do: Add to Favorites, or Remove from Favorites when the sheet is one.</summary>
    void Swap(IList<MenuFlyoutItemBase> into, string off, string on, string state, string offCommand, string? onCommand = null)
    {
        var item = new MenuFlyoutItem { Text = off };
        var now = offCommand;
        item.Click += (_, _) => Run(now, null);
        into.Add(item);
        pageItems.Add((item, () => now));
        updates.Add(s =>
        {
            var yes = J.Bool(s[state]);
            item.Text = yes ? on : off;
            now = yes ? onCommand ?? offCommand : offCommand;
        });
    }

    /// <summary>A submenu of choices, the one in use ticked (Appearance › Dark).</summary>
    void Choices(IList<MenuFlyoutItemBase> into, string text, string command, string state, (string Value, string Text)[] options)
    {
        var sub = Sub(into, text);
        var group = $"choices{groups++}";
        foreach (var (value, label) in options)
        {
            var item = new RadioMenuFlyoutItem { Text = label, GroupName = group };
            item.Click += (_, _) => Run(command, value);
            sub.Items.Add(item);
            pageItems.Add((item, () => command));
            updates.Add(s => item.IsChecked = J.Text(s[state]) == value);
        }
    }

    /// <summary>
    /// A submenu from the page's state: the themes, the dashboard's views, the
    /// library's groups and projects, the sheet list's orders. Each entry is
    /// <c>{id, name}</c> or <c>{path, name, depth}</c>; the one in use is ticked.
    /// </summary>
    void Dynamic(IList<MenuFlyoutItemBase> into, string text, string list, string command, string? current, Action<IList<MenuFlyoutItemBase>>? after = null)
    {
        var sub = Sub(into, text);
        var group = $"dynamic{groups++}";
        void Fill(JsonObject? state)
        {
            sub.Items.Clear();
            var entries = (state?[list] as JsonArray)?.OfType<JsonObject>().ToList() ?? new List<JsonObject>();
            var now = current == null || state == null ? null : J.Text(state[current]);
            if (entries.Count == 0) sub.Items.Add(new MenuFlyoutItem { Text = "None", IsEnabled = false });
            foreach (var entry in entries)
            {
                var value = J.Text(entry["id"]) ?? J.Text(entry["path"]) ?? entry["id"]?.ToJsonString() ?? "";
                var indent = new string(' ', Math.Clamp(J.Int(entry["depth"]), 0, 4));
                var item = new RadioMenuFlyoutItem { Text = indent + (J.Text(entry["name"]) ?? value), GroupName = group, IsChecked = value == now };
                item.Click += (_, _) => Run(command, value);
                sub.Items.Add(item);
            }
            after?.Invoke(sub.Items);
        }
        Fill(null);
        updates.Add(Fill);
    }

    /// <summary>A Paste As item: the page may not read the clipboard from a menu, so the shell hands it over.</summary>
    void Clip(IList<MenuFlyoutItemBase> into, string text, string command, string kind, string? key = null)
    {
        var item = new MenuFlyoutItem { Text = text };
        Key(item, key);
        item.Click += async (_, _) => Run(command, await FromClipboard(kind));
        into.Add(item);
        pageItems.Add((item, () => command));
    }

    static async Task<JsonObject> FromClipboard(string kind)
    {
        var clip = new JsonObject { ["kind"] = kind, ["text"] = "" };
        try
        {
            var content = Clipboard.GetContent();
            if (content.Contains(StandardDataFormats.Text)) clip["text"] = await content.GetTextAsync();
            if (content.Contains(StandardDataFormats.Html)) clip["html"] = HtmlFormatHelper.GetStaticFragment(await content.GetHtmlFormatAsync());
        }
        catch (Exception e)
        {
            Log.Write($"clipboard: {e.Message}");
        }
        return clip;
    }

    /// <summary>An item that presses its key in the page (Cut, Copy, Paste, Select All): what the key does, it does.</summary>
    void Native(IList<MenuFlyoutItemBase> into, string text, string key, string letter, int virtualKey, int modifiers = 2)
    {
        var item = new MenuFlyoutItem { Text = text, KeyboardAcceleratorTextOverride = key };
        item.Click += (_, _) => owner.Key(letter, "Key" + letter.ToUpperInvariant(), virtualKey, modifiers);
        into.Add(item);
    }

    /// <summary>An item that is the shell's own: the library folder, windows, help.</summary>
    static MenuFlyoutItem Shell(IList<MenuFlyoutItemBase> into, string text, Action act, string? key = null)
    {
        var item = new MenuFlyoutItem { Text = text };
        Key(item, key);
        item.Click += (_, _) => act();
        into.Add(item);
        return item;
    }
}
