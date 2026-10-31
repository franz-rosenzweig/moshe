import AppKit

/// The menu bar, item for item (docs/MENUS.md). Each item
/// calls the page's own command (`window.mosheCommand(name, arg)`) in the window
/// in front; what is ticked, what an item is called now, and the submenus built
/// from the library come from `window.mosheMenuState()`, asked when a menu opens.
///
/// The page hears a key before the menu does (ShellWebView), so a key the page
/// knows runs there and the menu item is what the mouse and the eye use; a key
/// the page leaves alone comes on to the item. A command runs once either way.
/// The shell's own keys (New Window, Zoom) and ⌃ chords go to the menu first.
@MainActor
enum Menus {
    /// What the page said when a menu last opened (docs/MENUS.md, mosheMenuState).
    static var state: [String: Any] = [:]

    /// The page's commands before it could say which it has (a page from before mosheMenuState).
    static let known: Set<String> = [
        "newSheet", "newMaterialSheet", "newGroup", "newProject", "export", "openQuickly", "find", "settings",
        "showLibrary", "showSheets", "showEditor", "dashboard", "translation", "back", "forward", "zoomIn", "zoomOut",
        "zoomReset", "revision", "trash", "strong", "emphasis", "link", "mark", "comment", "heading", "duplicate",
        "favorite", "moveUp", "moveDown", "favorites", "otherEditor", "import",
    ]

    /// Whether the front page has a command.
    static func has(_ name: String) -> Bool {
        if let commands = state["commands"] as? [String] { return commands.contains(name) }
        return known.contains(name)
    }

    static func bool(_ key: String) -> Bool { (state[key] as? Bool) ?? ((state[key] as? NSNumber)?.boolValue ?? false) }
    static func string(_ key: String) -> String? { state[key] as? String }

    /// Ask the page in front for its menu state, and show it in whatever menu is open.
    static func refresh(_ menu: NSMenu? = nil) {
        guard let web = MosheWindowController.front?.webView else { return }
        web.evaluateJavaScript("window.mosheMenuState ? window.mosheMenuState() : null") { result, _ in
            MainActor.assumeIsolated {
                state = (result as? [String: Any]) ?? [:]
                menu?.update()
            }
        }
    }

    // Arrow keys, as a menu item's key equivalent.
    static let up = "\u{F700}", down = "\u{F701}", left = "\u{F702}", right = "\u{F703}"

    /// Keys the shell answers before the page: its own items, which the page
    /// might otherwise take for something of its own (⌥⌘N was a material sheet).
    static func takesFirst(_ event: NSEvent) -> Bool {
        let mods = event.modifierFlags.intersection([.command, .option, .control, .shift])
        let key = event.charactersIgnoringModifiers?.lowercased() ?? ""
        return (key == "n" && mods == [.command, .option]) || (key == "z" && mods == [.command, .control])
    }

    static func build() -> NSMenu {
        let bar = NSMenu()
        for m in [appMenu(), fileMenu(), editMenu(), markupMenu(), insertMenu(), viewMenu(), goMenu()] {
            m.delegate = Opening.shared
            bar.addItem(submenu(m))
        }
        let window = windowMenu()
        window.delegate = Opening.shared
        bar.addItem(submenu(window))
        NSApp.windowsMenu = window
        let help = NSMenu(title: "Help")
        let helpItem = NSMenuItem(title: "Moshe Help", action: #selector(MenuTarget.help(_:)), keyEquivalent: "?")
        helpItem.target = MenuTarget.shared
        help.addItem(helpItem)
        page(help, "Getting Started", "gettingStarted")   // the welcome sheets, into the Inbox again
        bar.addItem(submenu(help))
        NSApp.helpMenu = help
        return bar
    }

    // MARK: making items

    private static func submenu(_ menu: NSMenu, title: String? = nil) -> NSMenuItem {
        let item = NSMenuItem(title: title ?? menu.title, action: nil, keyEquivalent: "")
        item.submenu = menu
        return item
    }

    /// An item that runs a page command.
    @discardableResult
    private static func page(_ m: NSMenu, _ title: String, _ name: String, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command,
                             arg: Any? = nil, toggle: (key: String, on: String)? = nil, tick: (key: String, value: String)? = nil,
                             hidden: Bool = false) -> PageItem {
        let item = PageItem(title: title, action: #selector(MenuTarget.pageCommand(_:)), keyEquivalent: key)
        item.keyEquivalentModifierMask = key.isEmpty ? [] : mods
        item.target = MenuTarget.shared
        item.command = name
        item.arg = arg
        item.offTitle = title
        item.toggle = toggle
        item.tick = tick
        if hidden {
            item.isHidden = true
            item.allowsKeyEquivalentWhenHidden = true
        }
        m.addItem(item)
        return item
    }

    /// An item for the shell itself.
    private static func shell(_ m: NSMenu, _ title: String, _ action: Selector, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command) {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.keyEquivalentModifierMask = key.isEmpty ? [] : mods
        item.target = MenuTarget.shared
        m.addItem(item)
    }

    /// An item sent along the responder chain (to the web view, for editing; to the window).
    private static func standard(_ m: NSMenu, _ title: String, _ action: String, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command) {
        let item = NSMenuItem(title: title, action: Selector((action)), keyEquivalent: key)
        item.keyEquivalentModifierMask = key.isEmpty ? [] : mods
        m.addItem(item)
    }

    private static func heading(_ m: NSMenu, _ title: String) {
        m.addItem(NSMenuItem.sectionHeader(title: title))
    }

    /// A submenu built from the page's state when it opens: one ticked item per entry.
    private static func dynamic(_ m: NSMenu, _ title: String, list: String, command: String, current: String?) {
        let sub = NSMenu(title: title)
        sub.delegate = DynamicMenu(list: list, command: command, current: current)
        m.addItem(submenu(sub))
    }

    /// A submenu of fixed choices, the one in use ticked.
    private static func choices(_ m: NSMenu, _ title: String, command: String, key: String, _ options: [(String, String)]) {
        let sub = NSMenu(title: title)
        for (value, label) in options { page(sub, label, command, arg: value, tick: (key, value)) }
        m.addItem(submenu(sub))
    }

    // MARK: the menus

    private static func appMenu() -> NSMenu {
        let m = NSMenu(title: "Moshe")
        standard(m, "About Moshe", "orderFrontStandardAboutPanel:")
        m.addItem(.separator())
        page(m, "Settings…", "settings", ",")
        m.addItem(.separator())
        shell(m, "Library Folder…", #selector(MenuTarget.chooseFolder(_:)))
        shell(m, "Show Library in Finder", #selector(MenuTarget.revealFolder(_:)))
        shell(m, "Use the Server…", #selector(MenuTarget.useServer(_:)))
        m.addItem(.separator())
        let services = NSMenuItem(title: "Services", action: nil, keyEquivalent: "")
        services.submenu = NSMenu(title: "Services")
        NSApp.servicesMenu = services.submenu
        m.addItem(services)
        m.addItem(.separator())
        standard(m, "Hide Moshe", "hide:", "h")
        standard(m, "Hide Others", "hideOtherApplications:", "h", [.command, .option])
        standard(m, "Show All", "unhideAllApplications:")
        m.addItem(.separator())
        standard(m, "Quit Moshe", "terminate:", "q")
        return m
    }

    private static func fileMenu() -> NSMenu {
        let m = NSMenu(title: "File")
        page(m, "New Sheet", "newSheet", "n")
        page(m, "New Material Sheet", "newMaterialSheet", "n", [.command, .option, .control])
        page(m, "New Handwritten Sheet", "newHandwrittenSheet")
        page(m, "New Group…", "newGroup", "n", [.command, .shift])
        page(m, "New Filter…", "newFilter", "n", [.command, .control])
        page(m, "New Project…", "newProject")
        m.addItem(.separator())
        let quickly = NSMenu(title: "Open Quickly")
        page(quickly, "Sheets…", "openQuickly", "o")
        m.addItem(submenu(quickly))
        m.addItem(.separator())
        page(m, "Add to Favorites", "favorite", "u", [.command, .control], toggle: ("favorite", "Remove from Favorites"))
        page(m, "Mark as Material", "material", "m", [.command, .control], toggle: ("material", "Mark as Text"))
        page(m, "Keywords…", "keywords", "k", [.command, .shift])
        page(m, "Goal…", "goal")
        page(m, "Statistics…", "statistics")
        m.addItem(.separator())
        page(m, "Glue Sheets", "glue", toggle: ("glued", "Unglue Sheets"))
        page(m, "Merge Sheets…", "merge")
        page(m, "Duplicate", "duplicate", "d")
        m.addItem(.separator())
        page(m, "Import…", "import")
        page(m, "Export…", "export", "p", [.command, .shift])
        page(m, "Share…", "share")
        m.addItem(.separator())
        page(m, "Browse Backups…", "browseBackups")
        m.addItem(.separator())
        standard(m, "Close Window", "performClose:", "w")
        m.addItem(.separator())
        page(m, "Print…", "print", "p")
        return m
    }

    private static func editMenu() -> NSMenu {
        let m = NSMenu(title: "Edit")
        // The editor keeps its own undo history; the items ask the page to undo and redo.
        shell(m, "Undo", #selector(MenuTarget.undo(_:)), "z")
        shell(m, "Redo", #selector(MenuTarget.redo(_:)), "z", [.command, .shift])
        m.addItem(.separator())
        standard(m, "Cut", "cut:", "x")
        let copy = NSMenu(title: "Copy")
        standard(copy, "Copy", "copy:", "c")
        copy.addItem(.separator())
        page(copy, "Copy as Markdown", "copyAs", arg: "markdown")
        page(copy, "Copy as HTML", "copyAs", arg: "html")
        page(copy, "Copy as Rich Text", "copyAs", arg: "rich")
        m.addItem(submenu(copy))
        let paste = NSMenu(title: "Paste")
        standard(paste, "Paste", "paste:", "v")
        paste.addItem(.separator())
        heading(paste, "Paste as")
        standard(paste, "Plain Text", "pasteAsPlainText:", "v", [.command, .option, .shift])
        pasteItem(paste, "Code Block", "pasteAs", "code")
        pasteItem(paste, "Raw Source Block", "pasteAs", "raw")
        paste.addItem(.separator())
        heading(paste, "Paste from")
        pasteItem(paste, "Markdown", "pasteFrom", "markdown", key: "v", mods: [.command, .option])
        pasteItem(paste, "HTML", "pasteFrom", "html")
        pasteItem(paste, "Rich Text", "pasteFrom", "rich")
        m.addItem(submenu(paste))
        standard(m, "Delete", "delete:")
        standard(m, "Select All", "selectAll:", "a")
        m.addItem(.separator())
        page(m, "Move Line Up", "moveUp", up, [.command, .control])
        page(m, "Move Line Down", "moveDown", down, [.command, .control])
        m.addItem(.separator())
        page(m, "Split at Selection", "split", "b", [.command, .shift])
        m.addItem(.separator())
        page(m, "Attach Note…", "attachNote")
        page(m, "Attach Image…", "attachImage")
        m.addItem(.separator())
        let find = NSMenu(title: "Find")
        page(find, "Find…", "find", "f")
        page(find, "Find and Replace…", "find", "f", [.command, .option], arg: "replace")
        page(find, "Find Next", "find", "g", arg: "next")
        page(find, "Find Previous", "find", "g", [.command, .shift], arg: "previous")
        page(find, "Use Selection for Find", "find", "e", arg: "selection")
        find.addItem(.separator())
        page(find, "Search Library…", "openQuickly", "f", [.command, .shift])
        m.addItem(submenu(find))
        m.addItem(.separator())
        let spelling = NSMenu(title: "Spelling and Grammar")
        standard(spelling, "Show Spelling and Grammar", "showGuessPanel:", ":")
        standard(spelling, "Check Document Now", "checkSpelling:", ";")
        spelling.addItem(.separator())
        standard(spelling, "Check Spelling While Typing", "toggleContinuousSpellChecking:")
        standard(spelling, "Check Grammar With Spelling", "toggleGrammarChecking:")
        standard(spelling, "Correct Spelling Automatically", "toggleAutomaticSpellingCorrection:")
        m.addItem(submenu(spelling))
        let substitutions = NSMenu(title: "Substitutions")
        standard(substitutions, "Show Substitutions", "orderFrontSubstitutionsPanel:")
        substitutions.addItem(.separator())
        standard(substitutions, "Smart Quotes", "toggleAutomaticQuoteSubstitution:")
        standard(substitutions, "Smart Dashes", "toggleAutomaticDashSubstitution:")
        standard(substitutions, "Text Replacement", "toggleAutomaticTextReplacement:")
        m.addItem(submenu(substitutions))
        let transformations = NSMenu(title: "Transformations")
        standard(transformations, "Make Upper Case", "uppercaseWord:")
        standard(transformations, "Make Lower Case", "lowercaseWord:")
        standard(transformations, "Capitalize", "capitalizeWord:")
        m.addItem(submenu(transformations))
        let speech = NSMenu(title: "Speech")
        standard(speech, "Start Speaking", "startSpeaking:")
        standard(speech, "Stop Speaking", "stopSpeaking:")
        m.addItem(submenu(speech))
        return m
    }

    /// A paste item: the shell hands the page what is on the clipboard.
    private static func pasteItem(_ m: NSMenu, _ title: String, _ name: String, _ kind: String, key: String = "", mods: NSEvent.ModifierFlags = .command) {
        let item = page(m, title, name, key, mods, arg: kind)
        item.withClipboard = true
    }

    private static func markupMenu() -> NSMenu {
        let m = NSMenu(title: "Markup")
        page(m, "Title", "heading", arg: 1)
        page(m, "Heading", "heading", arg: 2)
        page(m, "Subheading", "heading", arg: 3)
        let more = NSMenu(title: "More")
        page(more, "Heading 4", "heading", arg: 4)
        page(more, "Heading 5", "heading", arg: 5)
        page(more, "Heading 6", "heading", arg: 6)
        more.addItem(.separator())
        page(more, "Paragraph", "heading", arg: 0)
        m.addItem(submenu(more))
        // ⌥⌘1–6 and ⌥⌘0, as the brief had them: kept, out of sight
        for level in 0...6 { page(m, "Heading \(level)", "heading", "\(level)", [.command, .option], arg: level, hidden: true) }
        m.addItem(.separator())
        page(m, "Strong", "strong", "b")
        page(m, "Emphasis", "emphasis", "i")
        page(m, "Code", "code")
        let mark = NSMenu(title: "Mark")
        page(mark, "Mark", "mark", "h", [.command, .shift])
        page(mark, "Delete", "markDelete")
        page(mark, "Insert", "markInsert")
        page(mark, "Comment", "comment", "c", [.command, .shift])
        m.addItem(submenu(mark))
        page(m, "Link", "link", "k")
        page(m, "Annotate", "annotate")
        m.addItem(.separator())
        page(m, "Dashed List", "dashedList")
        page(m, "Numbered List", "numberedList")
        page(m, "Quote", "quote")
        m.addItem(.separator())
        page(m, "Comment Block", "commentBlock")
        page(m, "Code Block", "codeBlock")
        page(m, "Raw Source Block", "rawBlock")
        m.addItem(.separator())
        page(m, "Clear Markup", "clearMarkup", "l")
        return m
    }

    private static func insertMenu() -> NSMenu {
        let m = NSMenu(title: "Insert")
        page(m, "Line Break", "insert", "\r", [.shift], arg: "lineBreak")
        page(m, "Tab", "insert", "\t", [.option], arg: "tab")
        page(m, "Divider", "insert", arg: "divider")
        m.addItem(.separator())
        for (kind, title) in [("image", "Image"), ("video", "Video"), ("footnote", "Footnote"), ("equation", "Equation"), ("table", "Table")] {
            page(m, title, "insert", arg: kind)
        }
        m.addItem(.separator())
        page(m, "Table of Contents", "insert", arg: "toc")
        page(m, "Sketch…", "insert", arg: "sketch")
        return m
    }

    private static func viewMenu() -> NSMenu {
        let m = NSMenu(title: "View")
        let library = page(m, "Show Library", "showLibrary", toggle: ("library", "Hide Library"))
        library.onCommand = "showSheets"
        dynamic(m, "Dashboard", list: "dashboardViews", command: "dashboardView", current: "dashboardView")
        page(m, "Second Editor", "secondEditor", "3", [.command, .option], tick: ("secondEditor", "true"))
        m.addItem(.separator())
        page(m, "Show Counter", "toggleCounter", toggle: ("counter", "Hide Counter"))
        page(m, "Show Paragraph Numbers", "toggleParagraphNumbers", toggle: ("paragraphNumbers", "Hide Paragraph Numbers"))
        dynamic(m, "Sheet List", list: "sheetSorts", command: "sheetSort", current: "sheetSort")
        m.addItem(.separator())
        page(m, "Translation Mode", "translation", "t", [.command, .shift], tick: ("translation", "true"))
        page(m, "Revision Mode", "revision", "e", [.command, .shift], tick: ("revision", "true"))
        m.addItem(.separator())
        page(m, "Voice", "voice", tick: ("voice", "true"))
        page(m, "Start Listening", "listen", "l", [.command, .option], toggle: ("listening", "Stop Listening"))
        m.addItem(.separator())
        page(m, "Zoom In", "zoomIn", "+")
        page(m, "Zoom In", "zoomIn", "=", hidden: true)       // ⌘= is where ⌘+ is without a plus key
        page(m, "Zoom Out", "zoomOut", "-")
        page(m, "Default Size", "zoomReset", "0")
        m.addItem(.separator())
        page(m, "Show Line Marker", "toggleLineMarker", toggle: ("lineMarker", "Hide Line Marker"))
        choices(m, "Highlight", command: "highlight", key: "highlight",
                [("off", "Off"), ("line", "Line"), ("sentence", "Sentence"), ("paragraph", "Paragraph")])
        choices(m, "Fixed Scrolling", command: "fixedScrolling", key: "fixedScrolling",
                [("off", "Off"), ("top", "Top"), ("middle", "Middle"), ("bottom", "Bottom"), ("variable", "Variable")])
        m.addItem(.separator())
        choices(m, "Appearance", command: "appearance", key: "appearance", [("system", "Match System"), ("light", "Light"), ("dark", "Dark")])
        dynamic(m, "Theme", list: "themes", command: "theme", current: "theme")
        m.addItem(.separator())
        page(m, "Focus Mode", "hideInterface", ".", toggle: ("interfaceHidden", "Leave Focus Mode"))
        // ⌃⌘F, the usual Mac key. A Mac with a globe key shows it as fn-F, and takes both.
        standard(m, "Enter Full Screen", "toggleFullScreen:", "f", [.command, .control])
        return m
    }

    private static func goMenu() -> NSMenu {
        let m = NSMenu(title: "Go")
        page(m, "Back", "back", "[")
        page(m, "Forward", "forward", "]")
        m.addItem(.separator())
        dynamic(m, "Notes", list: "notes", command: "select", current: "selection")
        dynamic(m, "Projects", list: "projects", command: "select", current: "selection")
        page(m, "Favorites", "favorites", "u", [.command, .shift])
        m.addItem(.separator())
        page(m, "Previous Sheet", "previousSheet", up, [.command, .option])
        page(m, "Next Sheet", "nextSheet", down, [.command, .option])
        m.addItem(.separator())
        page(m, "Library", "showLibrary", "1")
        page(m, "Sheet List", "showSheets", "2")
        page(m, "Editor", "showEditor", "3")
        page(m, "Dashboard", "dashboard", "4")
        // ⌥⌘← / ⌥⌘→: from one editor to the other (translation mode, a second editor)
        page(m, "Switch Editor", "otherEditor", right, [.command, .option], hidden: true)
        page(m, "Switch Editor", "otherEditor", left, [.command, .option], hidden: true)
        return m
    }

    private static func windowMenu() -> NSMenu {
        let m = NSMenu(title: "Window")
        shell(m, "New Window", #selector(MenuTarget.newWindow(_:)), "n", [.command, .option])
        m.addItem(.separator())
        standard(m, "Minimize", "performMiniaturize:", "m")
        standard(m, "Zoom", "performZoom:", "z", [.command, .control])
        m.addItem(.separator())
        page(m, "Quick Export", "panel", "6", arg: "export")
        page(m, "Statistics", "panel", "7", arg: "statistics")
        page(m, "Navigation", "panel", "8", arg: "navigation")
        page(m, "Markup", "panel", "9", arg: "markup")
        page(m, "Keyword Manager", "keywordManager")
        m.addItem(.separator())
        standard(m, "Bring All to Front", "arrangeInFront:")
        return m
    }
}

/// A menu item that runs a page command: its name and argument, and how the
/// page's state shows in it (a title that toggles, a tick).
final class PageItem: NSMenuItem {
    var command = ""
    var arg: Any?
    var offTitle = ""
    /// Shown as `on` while the state's `key` is true (Add to Favorites / Remove from Favorites).
    var toggle: (key: String, on: String)?
    /// Ticked while the state's `key` is `value` ("true" for a bool).
    var tick: (key: String, value: String)?
    /// For a toggle whose two halves are two commands (Show Library / Hide Library).
    var onCommand: String?
    /// Hands the page what is on the clipboard (Paste as, Paste from).
    var withClipboard = false

    /// The command this item runs now.
    @MainActor var current: String {
        if let toggle, let onCommand, Menus.bool(toggle.key) { return onCommand }
        return command
    }
}

/// Opening a menu asks the page for its state (docs/MENUS.md, mosheMenuState).
@MainActor
final class Opening: NSObject, NSMenuDelegate {
    static let shared = Opening()
    func menuWillOpen(_ menu: NSMenu) { Menus.refresh(menu) }
}

/// A submenu from the page's state: the themes, the dashboard's views, the
/// library's groups and projects, the sheet list's orders. Each entry is
/// `{id, name}` or `{path, name, depth}`; the one in use is ticked.
@MainActor
final class DynamicMenu: NSObject, NSMenuDelegate {
    private static var kept: [DynamicMenu] = []          // NSMenu holds its delegate weakly
    let list: String, command: String, current: String?

    init(list: String, command: String, current: String?) {
        self.list = list
        self.command = command
        self.current = current
        super.init()
        Self.kept.append(self)
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let entries = Menus.state[list] as? [[String: Any]] ?? []
        let now = current.flatMap { Menus.string($0) }
        if entries.isEmpty {
            let none = NSMenuItem(title: "None", action: nil, keyEquivalent: "")
            none.isEnabled = false
            menu.addItem(none)
            return
        }
        for e in entries {
            let value = (e["id"] ?? e["path"]).map { "\($0)" } ?? ""
            let item = PageItem(title: e["name"] as? String ?? value, action: #selector(MenuTarget.pageCommand(_:)), keyEquivalent: "")
            item.target = MenuTarget.shared
            item.command = command
            item.arg = value
            item.offTitle = item.title
            item.indentationLevel = min(4, (e["depth"] as? Int) ?? 0)
            item.state = value == now ? .on : .off
            menu.addItem(item)
        }
    }
}

/// What the menu items call.
@MainActor
final class MenuTarget: NSObject, NSMenuItemValidation {
    static let shared = MenuTarget()

    /// Every command the menu has sent, for the self-test.
    static var sent: [String] = []

    @objc func pageCommand(_ sender: NSMenuItem) {
        guard let item = sender as? PageItem, let front = MosheWindowController.front else { return }
        let name = item.current
        Self.sent.append(name)
        var arg = item.arg
        if item.withClipboard {
            // the page may not read the clipboard from a menu; the shell hands it over
            let pb = NSPasteboard.general
            var clip: [String: Any] = ["kind": item.arg ?? "", "text": pb.string(forType: .string) ?? ""]
            if let html = pb.string(forType: .html) {
                clip["html"] = html
            } else if let rtf = pb.data(forType: .rtf),
                      let attributed = NSAttributedString(rtf: rtf, documentAttributes: nil),
                      let data = try? attributed.data(from: NSRange(location: 0, length: attributed.length),
                                                      documentAttributes: [.documentType: NSAttributedString.DocumentType.html]) {
                clip["html"] = String(decoding: data, as: UTF8.self)
            }
            arg = clip
        }
        front.command(name, arg)
        // what the command changed shows the next time a menu opens
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { Menus.refresh() }
    }

    @objc func newWindow(_ sender: Any?) { MosheWindowController.open() }

    @objc func chooseFolder(_ sender: Any?) {
        if let url = Library.chooseFolder() { Library.useFolder(url) }
    }

    @objc func revealFolder(_ sender: Any?) {
        if let folder = Library.folder { NSWorkspace.shared.activateFileViewerSelecting([folder]) }
    }

    @objc func useServer(_ sender: Any?) { Library.askServer() }

    @objc func help(_ sender: Any?) {
        Outside.open(URL(string: "https://github.com/franz-rosenzweig/moshe#readme")!)
    }

    /// The editor's history, not WebKit's: the page's undo and redo commands
    /// (in a text field of the page, that field's own), or its keys pressed
    /// in a page from before them.
    @objc func undo(_ sender: Any?) { history("undo", []) }
    @objc func redo(_ sender: Any?) { history("redo", [.shift]) }

    private func history(_ name: String, _ extra: NSEvent.ModifierFlags) {
        // Chosen with the key itself, the page has already had the key and let
        // it be: doing it again would only come back here.
        if NSApp.currentEvent?.type == .keyDown { return }
        guard let window = NSApp.keyWindow else { return }
        guard let web = window.firstResponder as? ShellWebView else {
            // a text field in a panel: its own undo
            NSApp.sendAction(Selector((name + ":")), to: nil, from: self)
            return
        }
        if Menus.has(name), let front = MosheWindowController.front {
            Self.sent.append(name)
            front.command(name)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { Menus.refresh() }
            return
        }
        let key = "z"
        let flags = NSEvent.ModifierFlags.command.union(extra)
        guard let down = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: flags,
                                          timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                                          context: nil, characters: key, charactersIgnoringModifiers: key,
                                          isARepeat: false, keyCode: 6) else { return }
        web.keyDown(with: down)
    }

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        if let p = item as? PageItem {
            if let toggle = p.toggle { p.title = Menus.bool(toggle.key) ? toggle.on : p.offTitle }
            if let tick = p.tick {
                let v = Menus.state[tick.key]
                let now = (v as? Bool).map { $0 ? "true" : "false" } ?? (v as? NSNumber).map { $0.boolValue ? "true" : "false" } ?? (v as? String)
                p.state = now == tick.value ? .on : .off
            }
            if p.command == "moveUp" || p.command == "moveDown" {
                let what = Menus.string("focus") == "list" ? "Sheet" : "Line"
                p.title = p.command == "moveUp" ? "Move \(what) Up" : "Move \(what) Down"
            }
            return MosheWindowController.front != nil && Menus.has(p.current)
        }
        switch item.action {
        case #selector(undo(_:)), #selector(redo(_:)):
            guard MosheWindowController.front != nil else { return false }
            // a text field in a panel keeps its own history; a page from before canUndo: always
            guard NSApp.keyWindow?.firstResponder is ShellWebView, Menus.has("undo") else { return true }
            return Menus.bool(item.action == #selector(undo(_:)) ? "canUndo" : "canRedo")
        case #selector(revealFolder(_:)):
            return Library.folder != nil
        case #selector(chooseFolder(_:)):
            item.state = Library.usesFolder ? .on : .off
            return true
        case #selector(useServer(_:)):
            item.state = Library.usesFolder ? .off : .on
            return true
        default:
            return true
        }
    }
}
