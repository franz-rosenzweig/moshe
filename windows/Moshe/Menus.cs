using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Automation.Provider;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Windows.ApplicationModel.DataTransfer;
using Windows.System;

namespace Moshe;

/// <summary>
/// The menus of docs/MENUS.md, the Windows way: the Mac's items and commands
/// (mac/Moshe/Menus.swift) with Ctrl for ⌘, gathered into the five menus a
/// Windows writing app has in its title bar — File, Edit, Format (the Mac's
/// Markup and Insert), View (with Go and the Window menu's panels) and Help.
/// Alt and a menu's letter opens it, as anywhere in Windows. The page hears every
/// key first, so an item only shows its key; choosing the item calls the same
/// command, window.mosheCommand(name, arg), and either way it runs once. What is
/// ticked, what a toggle says now, and the submenus built from the library come
/// from window.mosheMenuState() when a menu is pressed open. ⌃⌘ chords have no
/// Windows key, so those items are in the menu only.
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
        // Escape on the menu bar itself: back to the page, as from any title bar
        bar.AddHandler(UIElement.KeyDownEvent, new KeyEventHandler((_, e) => { if (e.Key == VirtualKey.Escape) owner.FocusPage(); }), handledEventsToo: true);
    }

    /// <summary>The page's state, into every item: enabled for the commands the page has, ticks, titles, submenus.</summary>
    public async void Refresh()
    {
        if (await owner.MenuState() is not { } state) return;
        var commands = state["commands"] is JsonArray names ? names.Select(J.Text).OfType<string>().ToHashSet() : null;
        foreach (var (item, command) in pageItems) item.IsEnabled = commands == null || commands.Contains(command());
        foreach (var update in updates) update(state);
    }

    /// <summary>Alt and a letter (F, E, O, V, H) opens that menu; Alt alone puts the keyboard on the menu bar.</summary>
    public void Open(string? letter)
    {
        if (letter == null)
        {
            bar.Items.FirstOrDefault()?.Focus(FocusState.Keyboard);
            return;
        }
        var top = bar.Items.FirstOrDefault(m => string.Equals(m.AccessKey, letter, StringComparison.OrdinalIgnoreCase));
        if (top == null) return;
        Refresh();
        top.Focus(FocusState.Keyboard);
        if (FrameworkElementAutomationPeer.CreatePeerForElement(top) is IExpandCollapseProvider menu) menu.Expand();
    }

    void Run(string command, JsonNode? arg)
    {
        owner.Command(command, arg);
        // what the command changed shows the next time a menu opens; and now, if one is open
        _ = Task.Delay(200).ContinueWith(_ => owner.DispatcherQueue.TryEnqueue(Refresh));
    }

    void Build()
    {
        // ---- File
        var file = Top("File", "F");
        Page(file, "New Sheet", "newSheet", key: "Ctrl+N");
        var create = Sub(file, "New");
        Page(create.Items, "Material Sheet", "newMaterialSheet");
        Page(create.Items, "Handwritten Sheet", "newHandwrittenSheet");
        Page(create.Items, "Group…", "newGroup", key: "Ctrl+Shift+N");
        Page(create.Items, "Filter…", "newFilter");
        Page(create.Items, "Project…", "newProject");
        Page(file, "Open Quickly…", "openQuickly", key: "Ctrl+O");
        Line(file);
        var sheet = Sub(file, "Sheet");
        Swap(sheet.Items, "Add to Favorites", "Remove from Favorites", "favorite", "favorite");
        Swap(sheet.Items, "Mark as Material", "Mark as Text", "material", "material");
        Page(sheet.Items, "Keywords…", "keywords", key: "Ctrl+Shift+K");
        Page(sheet.Items, "Goal…", "goal");
        Page(sheet.Items, "Statistics…", "statistics");
        Line(sheet.Items);
        Swap(sheet.Items, "Glue Sheets", "Unglue Sheets", "glued", "glue");
        Page(sheet.Items, "Merge Sheets…", "merge");
        Page(sheet.Items, "Duplicate", "duplicate", key: "Ctrl+D");
        Line(file);
        Page(file, "Export…", "export", key: "Ctrl+Shift+P");
        Page(file, "Print…", "print", key: "Ctrl+P");
        Page(file, "Share…", "share");
        Line(file);
        Page(file, "Import…", "import");
        Page(file, "Browse Backups…", "browseBackups");
        Line(file);
        Shell(file, "Library Folder…", owner.ChooseLibraryFolder);
        var reveal = Shell(file, "Show Library in File Explorer", ShellWindow.RevealFolder);
        updates.Add(_ => reveal.IsEnabled = Library.Folder != null);
        Shell(file, "Use the Server…", owner.UseTheServer);
        Line(file);
        Shell(file, "New Window", () => ShellWindow.Open(), "Ctrl+Alt+N");
        Shell(file, "Close Window", owner.Close, "Ctrl+W");
        Line(file);
        Page(file, "Settings", "settings", key: "Ctrl+,");
        Shell(file, "Exit", () => Application.Current.Exit(), "Alt+F4");

        // ---- Edit
        var edit = Top("Edit", "E");
        var undo = Page(edit, "Undo", "undo", key: "Ctrl+Z");
        var redo = Page(edit, "Redo", "redo", key: "Ctrl+Shift+Z");
        // a page from before canUndo: always
        updates.Add(s => { if (s["canUndo"] != null && !J.Bool(s["canUndo"])) undo.IsEnabled = false; });
        updates.Add(s => { if (s["canRedo"] != null && !J.Bool(s["canRedo"])) redo.IsEnabled = false; });
        Line(edit);
        Native(edit, "Cut", "Ctrl+X", "x", 0x58);
        Native(edit, "Copy", "Ctrl+C", "c", 0x43);
        Native(edit, "Paste", "Ctrl+V", "v", 0x56);
        Native(edit, "Paste as Plain Text", "Ctrl+Shift+V", "V", 0x56, modifiers: 2 | 8);
        var copyAs = Sub(edit, "Copy As");
        Page(copyAs.Items, "Markdown", "copyAs", "markdown");
        Page(copyAs.Items, "HTML", "copyAs", "html");
        Page(copyAs.Items, "Rich Text", "copyAs", "rich");
        var paste = Sub(edit, "Paste As");
        Clip(paste.Items, "Code Block", "pasteAs", "code");
        Clip(paste.Items, "Raw Source Block", "pasteAs", "raw");
        Line(paste.Items);
        Clip(paste.Items, "From Markdown", "pasteFrom", "markdown", key: "Ctrl+Alt+V");
        Clip(paste.Items, "From HTML", "pasteFrom", "html");
        Clip(paste.Items, "From Rich Text", "pasteFrom", "rich");
        Native(edit, "Select All", "Ctrl+A", "a", 0x41);
        Line(edit);
        Page(edit, "Find…", "find", "open", "Ctrl+F");
        Page(edit, "Replace…", "find", "replace", "Ctrl+Alt+F");
        Page(edit, "Find Next", "find", "next", "Ctrl+G");
        Page(edit, "Find Previous", "find", "previous", "Ctrl+Shift+G");
        Page(edit, "Use Selection for Find", "find", "selection", "Ctrl+E");
        Page(edit, "Search Library…", "openQuickly", key: "Ctrl+Shift+F");
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

        // ---- Format: the Mac's Markup and Insert
        var format = Top("Format", "O");
        Page(format, "Strong", "strong", key: "Ctrl+B");
        Page(format, "Emphasis", "emphasis", key: "Ctrl+I");
        Page(format, "Code", "code");
        Page(format, "Link", "link", key: "Ctrl+K");
        var mark = Sub(format, "Mark");
        Page(mark.Items, "Mark", "mark", key: "Ctrl+Shift+H");
        Page(mark.Items, "Delete", "markDelete");
        Page(mark.Items, "Insert", "markInsert");
        Page(mark.Items, "Comment", "comment", key: "Ctrl+Shift+C");
        Page(format, "Annotate", "annotate");
        Line(format);
        var heading = Sub(format, "Heading");
        Page(heading.Items, "Title", "heading", 1, "Ctrl+Alt+1");
        Page(heading.Items, "Heading", "heading", 2, "Ctrl+Alt+2");
        Page(heading.Items, "Subheading", "heading", 3, "Ctrl+Alt+3");
        Page(heading.Items, "Heading 4", "heading", 4, "Ctrl+Alt+4");
        Page(heading.Items, "Heading 5", "heading", 5, "Ctrl+Alt+5");
        Page(heading.Items, "Heading 6", "heading", 6, "Ctrl+Alt+6");
        Line(heading.Items);
        Page(heading.Items, "Paragraph", "heading", 0, "Ctrl+Alt+0");
        var lists = Sub(format, "List and Quote");
        Page(lists.Items, "Dashed List", "dashedList");
        Page(lists.Items, "Numbered List", "numberedList");
        Page(lists.Items, "Quote", "quote");
        var blocks = Sub(format, "Block");
        Page(blocks.Items, "Comment Block", "commentBlock");
        Page(blocks.Items, "Code Block", "codeBlock");
        Page(blocks.Items, "Raw Source Block", "rawBlock");
        Line(format);
        var insert = Sub(format, "Insert");
        Page(insert.Items, "Line Break", "insert", "lineBreak", "Shift+Enter");
        Page(insert.Items, "Tab", "insert", "tab");
        Page(insert.Items, "Divider", "insert", "divider");
        Line(insert.Items);
        Page(insert.Items, "Image", "insert", "image");
        Page(insert.Items, "Video", "insert", "video");
        Page(insert.Items, "Footnote", "insert", "footnote");
        Page(insert.Items, "Equation", "insert", "equation");
        Page(insert.Items, "Table", "insert", "table");
        Page(insert.Items, "Table of Contents", "insert", "toc");
        Line(insert.Items);
        Page(insert.Items, "Sketch…", "insert", "sketch");
        Line(format);
        Page(format, "Clear Markup", "clearMarkup", key: "Ctrl+L");

        // ---- View: the Mac's View, Go and the Window menu's panels
        var view = Top("View", "V");
        Swap(view, "Show Library", "Hide Library", "library", "showLibrary", "showSheets");
        Toggle(view, "Second Editor", "secondEditor", "secondEditor", "Ctrl+Alt+3");
        Dynamic(view, "Dashboard", "dashboardViews", "dashboardView", "dashboardView");
        var dates = Toggle(null, "Show Dates", "toggleSheetDates", "sheetDates");
        Dynamic(view, "Sheet List", "sheetSorts", "sheetSort", "sheetSort", items =>
        {
            Line(items);
            items.Add(dates);
        });
        var panels = Sub(view, "Panels");
        Page(panels.Items, "Quick Export", "panel", "export", "Ctrl+6");
        Page(panels.Items, "Statistics", "panel", "statistics", "Ctrl+7");
        Page(panels.Items, "Navigation", "panel", "navigation", "Ctrl+8");
        Page(panels.Items, "Markup", "panel", "markup", "Ctrl+9");
        Page(panels.Items, "Keyword Manager", "keywordManager");
        Line(view);
        var go = Sub(view, "Go To");
        Page(go.Items, "Back", "back", key: "Ctrl+[");
        Page(go.Items, "Forward", "forward", key: "Ctrl+]");
        Line(go.Items);
        Dynamic(go.Items, "Notes", "notes", "select", "selection");
        Dynamic(go.Items, "Projects", "projects", "select", "selection");
        Page(go.Items, "Favorites", "favorites", key: "Ctrl+Shift+U");
        Line(go.Items);
        Page(go.Items, "Previous Sheet", "previousSheet", key: "Ctrl+Alt+Up");
        Page(go.Items, "Next Sheet", "nextSheet", key: "Ctrl+Alt+Down");
        Line(go.Items);
        Page(go.Items, "Library", "showLibrary", key: "Ctrl+1");
        Page(go.Items, "Sheet List", "showSheets", key: "Ctrl+2");
        Page(go.Items, "Editor", "showEditor", key: "Ctrl+3");
        Page(go.Items, "Dashboard", "dashboard", key: "Ctrl+4");
        Line(view);
        Toggle(view, "Translation Mode", "translation", "translation", "Ctrl+Shift+T");
        Toggle(view, "Revision Mode", "revision", "revision", "Ctrl+Shift+E");
        Toggle(view, "Focus Mode", "hideInterface", "interfaceHidden", "Ctrl+.");
        Line(view);
        // writing by voice (docs/VOICE.md): on in Settings › Voice or here; the page hears Ctrl+Alt+L itself
        Toggle(view, "Voice", "voice", "voice");
        Swap(view, "Start Listening", "Stop Listening", "listening", "listen", key: "Ctrl+Alt+L");
        VoiceModel(Sub(view, "Voice Model").Items);
        Line(view);
        var text = Sub(view, "Text");
        Swap(text.Items, "Show Counter", "Hide Counter", "counter", "toggleCounter");
        Swap(text.Items, "Show Paragraph Numbers", "Hide Paragraph Numbers", "paragraphNumbers", "toggleParagraphNumbers");
        Swap(text.Items, "Show Line Marker", "Hide Line Marker", "lineMarker", "toggleLineMarker");
        Choices(text.Items, "Highlight", "highlight", "highlight", [("off", "Off"), ("line", "Line"), ("sentence", "Sentence"), ("paragraph", "Paragraph")]);
        Choices(text.Items, "Fixed Scrolling", "fixedScrolling", "fixedScrolling",
            [("off", "Off"), ("top", "Top"), ("middle", "Middle"), ("bottom", "Bottom"), ("variable", "Variable")]);
        var zoom = Sub(view, "Zoom");
        Page(zoom.Items, "Zoom In", "zoomIn", key: "Ctrl+Plus");
        Page(zoom.Items, "Zoom Out", "zoomOut", key: "Ctrl+Minus");
        Page(zoom.Items, "Default Size", "zoomReset", key: "Ctrl+0");
        Choices(view, "Appearance", "appearance", "appearance", [("system", "Use System Setting"), ("light", "Light"), ("dark", "Dark")]);
        Dynamic(view, "Theme", "themes", "theme", "theme");
        Line(view);
        Shell(view, "Full Screen", owner.ToggleFullScreen, "F11");

        // ---- Help
        var help = Top("Help", "H");
        Shell(help, "Moshe Help", () => Outside.Open(new Uri("https://github.com/franz-rosenzweig/moshe#readme")));
        Page(help, "Getting Started", "gettingStarted");
        Line(help);
        Shell(help, "About Moshe", async () => await owner.Tell("Moshe", $"Version {App.Version}, for Windows.\nhttps://github.com/franz-rosenzweig/moshe"));
    }

    // ---- the kinds of item -----------------------------------------------------------------

    IList<MenuFlyoutItemBase> Top(string title, string accessKey)
    {
        var menu = new MenuBarItem { Title = title, AccessKey = accessKey };
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
    void Swap(IList<MenuFlyoutItemBase> into, string off, string on, string state, string offCommand, string? onCommand = null, string? key = null)
    {
        var item = new MenuFlyoutItem { Text = off };
        Key(item, key);
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

    /// <summary>
    /// The Whisper model voice listens with (Voice.cs), the shell's own choice:
    /// base.en, built in, or small.en, fetched the first time it is chosen.
    /// </summary>
    void VoiceModel(IList<MenuFlyoutItemBase> into)
    {
        var group = $"model{groups++}";
        foreach (var model in new[] { VoiceModels.Base, VoiceModels.Small })
        {
            var item = new RadioMenuFlyoutItem { GroupName = group };
            item.Click += async (_, _) =>
            {
                owner.FocusPage();
                await VoiceModels.Choose(owner, model);
                Refresh();
            };
            into.Add(item);
            void Update(JsonObject _)
            {
                var here = VoiceModels.PathOf(model) != null;
                item.Text = model == VoiceModels.Base ? "Whisper base.en (quicker)"
                    : here ? "Whisper small.en (more exact)" : $"Whisper small.en (more exact; fetches {model.Bytes / 1_000_000} MB)";
                item.IsChecked = VoiceModels.Current?.Model == model;
                item.IsEnabled = here || model == VoiceModels.Small;
            }
            Update([]);
            updates.Add(Update);
        }
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
    MenuFlyoutItem Shell(IList<MenuFlyoutItemBase> into, string text, Action act, string? key = null)
    {
        var item = new MenuFlyoutItem { Text = text };
        Key(item, key);
        item.Click += (_, _) =>
        {
            owner.FocusPage();
            act();
        };
        into.Add(item);
        return item;
    }

    /// <summary>The menus' titles, for the self-test.</summary>
    public IEnumerable<string> Titles => bar.Items.Select(m => m.Title);

    /// <summary>One menu's items, as "Text" or "Text (key)", for the self-test.</summary>
    public IEnumerable<string> Items(string title) =>
        bar.Items.FirstOrDefault(m => m.Title == title)?.Items.OfType<MenuFlyoutItemBase>().Select(i => i switch
        {
            MenuFlyoutItem item => string.IsNullOrEmpty(item.KeyboardAcceleratorTextOverride) ? item.Text : $"{item.Text} ({item.KeyboardAcceleratorTextOverride})",
            MenuFlyoutSubItem sub => sub.Text,
            _ => "-",
        }) ?? [];
}
