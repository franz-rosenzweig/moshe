import AppKit
import PDFKit
import WebKit

/// Called from hook.c before main: start once the app has launched.
@_cdecl("selftest_install")
public func selftestInstall() {
    NotificationCenter.default.addObserver(forName: NSApplication.didFinishLaunchingNotification,
                                           object: nil, queue: .main) { _ in
        Task { @MainActor in await SelfTest.run() }
    }
}

/// Drives the real app from inside, on a copy of the sample library. Keys are
/// genuine NSEvents posted to the app's own queue, so a key takes the path a
/// keypress does: the web view first (the page), then the menu bar. Results are
/// checked in the folder on disk, and pictures land in -SelfTestOut.
@MainActor
enum SelfTest {
    static var failures = 0
    static var outDir: URL {
        URL(fileURLWithPath: UserDefaults.standard.string(forKey: "SelfTestOut") ?? NSTemporaryDirectory())
    }
    static var saveDir: URL {
        URL(fileURLWithPath: UserDefaults.standard.string(forKey: "SelfTestSaveDir") ?? NSTemporaryDirectory())
    }
    static var root: URL { Library.folder! }

    /// -SelfTestOnly keys,menus,… runs some sections.
    static func wants(_ part: String) -> Bool {
        guard let only = UserDefaults.standard.string(forKey: "SelfTestOnly") else { return true }
        return only.split(separator: ",").contains { $0 == part }
    }

    static func run() async {
        try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: saveDir, withIntermediateDirectories: true)
        log("SELFTEST on \(Library.folder?.path ?? "no folder")")
        _ = await until(10) { !MosheWindowController.all.isEmpty }
        NSApp.activate()
        guard let first = MosheWindowController.all.first, let w = first.window else {
            check(false, "a window opened")
            return finish()
        }
        let ready = await until(20) { await isReady(first.webView) }
        check(ready, "the page opens the library", await js(first.webView, "document.body.innerText.slice(0, 200)"))
        guard ready else { return finish() }
        await pause(0.5)
        capture(w, "01-window")
        dumpMenus()

        if wants("load") { await load(first) }
        if wants("window") { await window(first) }
        if wants("conformance") { await conformance(first.webView) }
        if wants("keys") { await keys(first) }
        if wants("menus") { await menus(first) }
        if wants("shortcuts") { await shortcuts(first) }
        if wants("outside") { await outside(first) }
        if wants("images") { await images(first.webView) }
        if wants("services") { await services(first.webView) }
        if wants("pdf") { await pdf(first.webView) }
        if wants("translation") { await translation(first) }
        if wants("proof") { await proof(first) }
        if wants("hebrew") { await hebrew(first) }
        if wants("settings") { await settings(first) }
        if wants("panes") { await panes(first) }
        if wants("reload") { await reload(first) }
        if wants("voice") { await voice(first) }
        finish()
    }

    static func finish() {
        let note = skipped > 0 ? " (\(skipped) skipped: run again with the Mac left alone)" : ""
        log((failures == 0 ? "SELFTEST passed" : "SELFTEST \(failures) failed") + note)
        exit(failures == 0 ? 0 : 1)
    }

    static func isReady(_ web: WKWebView) async -> Bool {
        await js(web, "window.__mosheLocal && document.querySelector('.window') ? 'yes' : 'no'") == "yes"
    }

    // MARK: sections

    /// The page from inside the app, on the folder, knowing it is in the shell.
    static func load(_ c: MosheWindowController) async {
        let web = c.webView!
        check(web.url?.scheme == AppScheme.scheme, "the page comes from inside the app", web.url?.absoluteString ?? "")
        check(await js(web, "window.__mosheLocal.mode") == "folder", "the page runs on the folder (folder mode)")
        let ua = await js(web, "navigator.userAgent")
        check(ua.contains("Moshe/\(MosheWindowController.version) (macOS shell)"), "the user agent names the shell", ua)
        check(await js(web, "!!document.querySelector('.lib .bar.traffic')") == "1", "the page leaves room for the traffic lights")
        check(await js(web, "['savePdf','saveFile','share','openExternal'].every((k) => typeof window.mosheShell[k] === 'function')") == "1",
              "window.mosheShell is there before the page runs")
        check(await js(web, "'serviceWorker' in navigator && navigator.serviceWorker.controller ? 'sw' : 'none'") == "none",
              "no service worker inside the shell")
    }

    /// The window: the page to the top edge, the traffic lights in the
    /// middle of its bar, and the bar's presses reaching the page.
    static func window(_ c: MosheWindowController) async {
        let w = c.window!, web = c.webView!
        check(w.styleMask.contains(.fullSizeContentView) && w.titlebarAppearsTransparent && w.titleVisibility == .hidden,
              "the content runs under a transparent title bar")
        check(w.toolbar == nil, "no toolbar")
        check(w.minSize.width >= 900 && w.minSize.height >= 600, "the window is at least 900 by 600", "\(w.minSize)")
        check(w.frameAutosaveName == "Moshe Window", "the window's frame is remembered")
        check(web.frame.maxY >= (w.contentView?.bounds.height ?? 0) && web.frame.minY <= 0, "the page fills the window", "\(web.frame)")
        if let close = w.standardWindowButton(.closeButton), let zoom = w.standardWindowButton(.zoomButton) {
            let r = close.convert(close.bounds, to: nil), z = zoom.convert(zoom.bounds, to: nil)
            let fromTop = w.frame.height - r.midY
            check(abs(fromTop - MosheWindowController.barHeight / 2) <= 1.5, "the traffic lights sit in the middle of the page's bar",
                  "centre \(fromTop) pt from the top")
            check(abs(r.minX - MosheWindowController.lightsInset) <= 1.5 && z.maxX < 78, "the traffic lights fit in the room the page leaves",
                  "\(r.minX)…\(z.maxX)")
            check(!close.isHidden && close.isEnabled, "the close button is there")
        }

        // where the page's bar buttons are, in the window
        func rect(_ selector: String) async -> NSRect? {
            let s = await js(web, "(() => { const e = document.querySelector(\(MosheWindowController.json(selector))); if (!e) return ''; const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].join(','); })()")
            let v = s.split(separator: ",").compactMap { Double($0) }
            guard v.count == 4 else { return nil }
            return NSRect(x: v[0], y: web.bounds.height - v[1] - v[3], width: v[2], height: v[3])
        }
        func hit(_ p: NSPoint) -> NSView? { w.contentView?.superview?.hitTest(p) }
        let inFront = await front(w)
        if let b = await rect(".lib .bar button:last-child") {
            // near the top of the button: inside the strip a title bar would have
            let p = NSPoint(x: b.midX, y: b.maxY - 3)
            let v = hit(p)
            check(v.map { $0 === web || $0.isDescendant(of: web) } ?? false, "a press high on a bar button reaches the page",
                  "\(p) hit \(v.map { String(describing: Swift.type(of: $0)) } ?? "nothing")")
            if inFront {
                let panes = await ui(web, "panes")
                click(w, p)
                _ = await until(3) { await ui(web, "panes") != panes }
                check(await ui(web, "panes") == "2", "clicking Hide Library in the title bar's strip hides the library", "panes \(await ui(web, "panes"))")
                press("1", 18, .command)
                _ = await until(3) { await ui(web, "panes") == "3" }
            } else { skip("clicking Hide Library in the title bar's strip") }
        } else {
            check(false, "the library's bar has buttons")
        }
        // an empty part of the editor's bar moves the window
        if let bar = await rect(".editor .bar .grow") {
            let before = WindowMessages.received.count
            let p = NSPoint(x: bar.midX, y: bar.midY)
            check(hit(p).map { $0 === web || $0.isDescendant(of: web) } ?? false, "a press on an empty part of a bar reaches the page")
            guard await front(w) else { return skip("a press on an empty part of a bar moving the window") }
            click(w, p)
            _ = await until(2) { WindowMessages.received.count > before }
            check(WindowMessages.received.dropFirst(before).contains("drag"), "the page asks to move the window from an empty part of a bar",
                  WindowMessages.received.joined(separator: ","))
        }
        if let b = await rect(".editor .bar button.tb") {
            let before = WindowMessages.received.count
            mouse(w, NSPoint(x: b.midX, y: b.midY), .leftMouseDown)
            await pause(0.4)
            mouse(w, NSPoint(x: b.midX, y: b.midY), .leftMouseUp)
            await pause(0.2)
            check(WindowMessages.received.count == before, "a press on a bar button does not move the window")
            press("\u{1b}", 53)
            await pause(0.2)
        }
        capture(w, "02-traffic-lights")
    }

    /// The checks every shell must pass (engine/src/storage-conformance.js).
    static func conformance(_ web: WKWebView) async {
        let r = try? await web.callAsyncJavaScript("return await window.__mosheLocal.conformance()", contentWorld: .page) as? [String: Any]
        let results = r?["results"] as? [[String: Any]] ?? []
        check(!results.isEmpty, "the conformance checks run")
        for x in results {
            let ok = (x["ok"] as? Bool) ?? ((x["ok"] as? NSNumber)?.boolValue ?? false)
            check(ok, "conformance: \(x["name"] as? String ?? "?")", x["error"] as? String ?? "\((x["ms"] as? NSNumber)?.intValue ?? 0) ms")
        }
    }

    /// Keys: each runs its command once, whether the page or the menu takes it.
    static func keys(_ c: MosheWindowController) async {
        let web = c.webView!
        let notes = root.appendingPathComponent("Notes")
        func sheets() -> Set<String> {
            Set(((try? FileManager.default.contentsOfDirectory(atPath: notes.path)) ?? []).filter { $0.hasSuffix(".md") })
        }
        let before = sheets()
        guard await front(c.window!) else { return skip("the keys (⌘N, ⌘B, ⌥⌘2, ⌘+, ⌘1–4, ⌃⌘N)") }
        await js(web, "window.dispatchEvent(new Event('moshe:focus-editor'))")
        press("n", 45, .command)
        _ = await until(4) { await js(web, "document.activeElement && document.activeElement.closest('.cm-editor') ? 1 : 0") == "1" }
        type("Self-test sheet")
        press("\r", 36)
        type("strong")
        let file = notes.appendingPathComponent("Self-test sheet.md")
        _ = await until(6) { ((try? String(contentsOf: file, encoding: .utf8)) ?? "").contains("strong") }
        let added = sheets().subtracting(before)
        check(added == ["Self-test sheet.md"], "⌘N makes one sheet, and its title names the file", added.sorted().joined(separator: ", "))
        await snapPage(web, "03-new-sheet")

        // ⇧⌥← selects the word; ⌘B wraps it once
        press("\u{F702}", 123, [.shift, .option])
        press("b", 11, .command)
        _ = await until(4) { text(file).contains("**strong**") }
        check(text(file).contains("**strong**") && !text(file).contains("****"), "⌘B makes the word strong once", text(file))

        // ⌥⌘2: a heading, through the menu if the page leaves it
        press("2", 19, [.command, .option], chars: "™")
        _ = await until(4) { text(file).contains("## ") }
        check(text(file).components(separatedBy: "\n").contains { $0.hasPrefix("## ") && $0.contains("strong") },
              "⌥⌘2 makes the line a second-level heading", text(file))

        let size = await ui(web, "prefs.fontSize")
        press("=", 24, .command)
        _ = await until(3) { await ui(web, "prefs.fontSize") != size }
        await pause(0.3)
        check(Int(await ui(web, "prefs.fontSize")) == (Int(size) ?? 16) + 1, "⌘+ makes the text one point bigger, once", "\(size) → \(await ui(web, "prefs.fontSize"))")
        press("0", 29, .command)
        _ = await until(3) { await ui(web, "prefs.fontSize") == "16" }
        check(await ui(web, "prefs.fontSize") == "16", "⌘0 puts the size back")

        press("4", 21, .command)
        _ = await until(3) { await ui(web, "dashboard") == "1" }
        check(await ui(web, "dashboard") == "1", "⌘4 shows the dashboard")
        await snapPage(web, "04-dashboard")
        press("4", 21, .command)
        _ = await until(3) { await ui(web, "dashboard") == "0" }
        check(await ui(web, "dashboard") == "0", "⌘4 again hides it")

        press("2", 19, .command)
        _ = await until(3) { await ui(web, "panes") == "2" }
        check(await ui(web, "panes") == "2", "⌘2 hides the library")
        let pad = await js(web, "getComputedStyle(document.querySelector('.window > .col:first-child > .bar')).paddingLeft")
        check(pad == "78px", "the sheet list's bar then leaves the traffic lights their room", pad)
        capture(c.window!, "05-no-library")
        press("1", 18, .command)
        _ = await until(3) { await ui(web, "panes") == "3" }
        check(await ui(web, "panes") == "3", "⌘1 shows it again")

        // ⌥⌘N: New Window, the menu's before the page's
        await front(c.window!)
        let windows = MosheWindowController.all.count
        press("n", 45, [.command, .option], chars: "˜")
        _ = await until(5) { MosheWindowController.all.count == windows + 1 }
        check(MosheWindowController.all.count == windows + 1, "⌥⌘N opens another window", "\(MosheWindowController.all.count)")
        if let second = MosheWindowController.all.last, second !== c {
            let ok = await until(15) { await isReady(second.webView) }
            check(ok, "the second window opens the same library")
            // the two pages see each other's writes
            try? "# From the second window\n".write(to: notes.appendingPathComponent("Second window.md"), atomically: true, encoding: .utf8)
            _ = await until(4) { await js(web, "window.__mosheStore.exists('Notes/Second window.md') ? 1 : 0") == "1" }
            let inSecond = await js(second.webView, "window.__mosheStore.exists('Notes/Second window.md') ? 1 : 0")
            let inFirst = await js(web, "window.__mosheStore.exists('Notes/Second window.md') ? 1 : 0")
            check(inSecond == "1" && inFirst == "1", "both windows see a sheet written beside them")
            second.window?.performClose(nil)
            _ = await until(3) { MosheWindowController.all.count == windows }
            check(MosheWindowController.all.count == windows, "⌘W's Close Window closes it")
        }
        c.window?.makeKeyAndOrderFront(nil)
        await pause(0.3)
    }

    /// The menus with the mouse: each item calls the page once.
    static func menus(_ c: MosheWindowController) async {
        let web = c.webView!
        func item(_ menu: String, _ title: String) -> NSMenuItem? {
            NSApp.mainMenu?.items.first { $0.title == menu }?.submenu.flatMap { find(title, in: $0) }
        }
        func choose(_ menu: String, _ title: String) {
            // the titles as a person opening the menu would see them (Hide Counter is Show Counter until then)
            NSApp.mainMenu?.items.first { $0.title == menu }?.submenu?.update()
            guard let i = item(menu, title), let m = i.menu else { return check(false, "\(menu) → \(title) is in the menu") }
            m.update()
            guard i.isEnabled else { return check(false, "\(menu) → \(title) is enabled") }
            m.performActionForItem(at: m.index(of: i))
        }
        let sent = MenuTarget.sent.count
        choose("Go", "Dashboard")
        _ = await until(3) { await ui(web, "dashboard") == "1" }
        check(await ui(web, "dashboard") == "1" && MenuTarget.sent.dropFirst(sent) == ["dashboard"], "Go → Dashboard shows the dashboard")
        choose("Go", "Dashboard")
        _ = await until(3) { await ui(web, "dashboard") == "0" }
        check(await ui(web, "dashboard") == "0", "and again hides it, once each time")

        let file = root.appendingPathComponent("Notes/Self-test sheet.md")
        if FileManager.default.fileExists(atPath: file.path) {
            if await front(c.window!) {
            await js(web, "window.dispatchEvent(new Event('moshe:focus-editor'))")
            await pause(0.3)
            choose("Markup", "Subheading")
            _ = await until(4) { text(file).contains("### ") }
            check(text(file).contains("### "), "Markup → Subheading changes the line's heading", text(file))
            let before = MenuTarget.sent.count
            choose("Edit", "Undo")
            _ = await until(4) { !text(file).contains("### ") }
            check(!text(file).contains("### ") && text(file).contains("## "), "Edit → Undo undoes it in the editor", text(file))
            check(MenuTarget.sent.dropFirst(before) == ["undo"], "with the page's undo command", "\(MenuTarget.sent.dropFirst(before))")
            _ = await until(2) { Menus.bool("canRedo") }
            choose("Edit", "Redo")
            _ = await until(4) { text(file).contains("### ") }
            check(text(file).contains("### "), "Edit → Redo does it again", text(file))
            } else { skip("Markup → Subheading and Edit → Undo in the editor") }
        }

        // the system's spelling, on in the editor
        let inFront = await front(c.window!)
        await js(web, "window.dispatchEvent(new Event('moshe:focus-editor'))")
        await pause(0.3)
        if !inFront {
            skip("the spelling items' state, and ⌃⌘F")
        } else if let spell = item("Edit", "Check Spelling While Typing") {
            spell.menu?.update()
            if UserDefaults.standard.object(forKey: "NSAllowContinuousSpellChecking") as? Bool == false {
                log("INFO  spelling while typing is off for every app on this Mac (NSAllowContinuousSpellChecking is 0)")
            } else {
                check(spell.state == .on, "Check Spelling While Typing is on")
            }
        }
        if inFront, let grammar = item("Edit", "Check Grammar With Spelling") {
            grammar.menu?.update()
            check(grammar.state == .on, "Check Grammar With Spelling is on")
        }
        // ⌃⌘F: full screen and back, by the menu, whatever the page makes of it
        if inFront, let w = c.window {
            press("f", 3, [.command, .control])
            let entered = await until(6) { w.styleMask.contains(.fullScreen) }
            check(entered, "⌃⌘F enters full screen", "\(item("View", "Enter Full Screen")?.keyEquivalentModifierMask.rawValue ?? 0)")
            await pause(1.2)
            if entered {
                capture(w, "07-full-screen")
                let pad = await js(web, "getComputedStyle(document.querySelector('.window > .col:first-child > .bar')).paddingLeft")
                check(pad == "12px", "in full screen the page takes back the traffic lights' room", pad)
            }
            press("f", 3, [.command, .control])
            let left = await until(6) { !w.styleMask.contains(.fullScreen) }
            check(left, "⌃⌘F again leaves it")
            await pause(1.2)
            if let close = w.standardWindowButton(.closeButton) {
                let fromTop = w.frame.height - close.convert(close.bounds, to: nil).midY
                check(abs(fromTop - MosheWindowController.barHeight / 2) <= 1.5, "the traffic lights are back in the bar after full screen", "\(fromTop)")
            }
        }
        check(await js(web, "typeof window.mosheCommand") == "function", "the page answers the menu (window.mosheCommand)")

        // every item's command is one the page has (docs/MENUS.md), and the menus built from the library fill
        Menus.refresh()
        _ = await until(3) { !Menus.state.isEmpty }
        func pageItems(_ m: NSMenu) -> [PageItem] { m.items.flatMap { ($0 as? PageItem).map { [$0] } ?? [] + ($0.submenu.map(pageItems) ?? []) } }
        let items = NSApp.mainMenu.map(pageItems) ?? []
        let commands = Set(items.flatMap { [$0.command] + ($0.onCommand.map { [$0] } ?? []) })
        let missing = commands.filter { !Menus.has($0) }.sorted()
        check(!items.isEmpty && missing.isEmpty, "the page has every command the menus call", "\(commands.count) commands; missing: \(missing.joined(separator: ", "))")
        for list in ["themes", "dashboardViews", "notes", "projects", "sheetSorts"] {
            let n = (Menus.state[list] as? [[String: Any]])?.count ?? 0
            check(n > 0, "the menus' \(list) come from the page", "\(n)")
        }
        // a few of the new ones, with the mouse
        let theme = await ui(web, "prefs.theme")
        if let sub = find("Theme", in: NSApp.mainMenu!)?.submenu {
            sub.delegate?.menuNeedsUpdate?(sub)
            if let other = sub.items.first(where: { $0.state == .off && $0.isEnabled != false && ($0 as? PageItem) != nil }) {
                sub.performActionForItem(at: sub.index(of: other))
                _ = await until(3) { await ui(web, "prefs.theme") != theme }
                check(await ui(web, "prefs.theme") == ((other as? PageItem)?.arg as? String ?? "?"), "View → Theme → \(other.title) changes the theme", "\(theme) → \(await ui(web, "prefs.theme"))")
                (sub.items.first { ($0 as? PageItem)?.arg as? String == theme }).map { sub.performActionForItem(at: sub.index(of: $0)) }
            }
        }
        // from whichever way the last run left it
        let counter = await ui(web, "prefs.showCounter")
        let (now, next) = counter != "0" ? ("Hide Counter", "Show Counter") : ("Show Counter", "Hide Counter")
        choose("View", now)
        _ = await until(3) { await ui(web, "prefs.showCounter") != counter }
        check(await ui(web, "prefs.showCounter") != counter, "View → \(now) \(counter != "0" ? "hides" : "shows") the counter", "\(counter) → \(await ui(web, "prefs.showCounter"))")
        Menus.refresh(); await pause(0.3)
        if let item = find(next, in: NSApp.mainMenu!) ?? find(now, in: NSApp.mainMenu!) {
            item.menu?.update()
            check(item.title == next, "and the item then says \(next)", item.title)
            // back as it was
            if await ui(web, "prefs.showCounter") != counter { item.menu.map { $0.performActionForItem(at: $0.index(of: item)) } }
        }
    }

    /// The sheet shortcuts are the page's (App.svelte's keydown): no menu
    /// item may have them, and pressed, each reaches the page and does its work.
    static func shortcuts(_ c: MosheWindowController) async {
        let web = c.webView!
        // each key is on its menu item, calling the page's command of the same work
        let chords: [(String, String, NSEvent.ModifierFlags, String)] = [
            ("⌘D", "d", [.command], "duplicate"), ("⌃⌘U", "u", [.command, .control], "favorite"),
            ("⇧⌘U", "u", [.command, .shift], "favorites"), ("⌃⌘↑", Menus.up, [.command, .control], "moveUp"),
            ("⌃⌘↓", Menus.down, [.command, .control], "moveDown"), ("⌥⌘←", Menus.left, [.command, .option], "otherEditor"),
            ("⌥⌘→", Menus.right, [.command, .option], "otherEditor"),
        ]
        func items(_ m: NSMenu) -> [NSMenuItem] { m.items.flatMap { [$0] + ($0.submenu.map(items) ?? []) } }
        let all = NSApp.mainMenu.map(items) ?? []
        let relevant: NSEvent.ModifierFlags = [.command, .control, .option, .shift]
        for (name, key, mods, command) in chords {
            let taken = all.filter { !$0.keyEquivalent.isEmpty && $0.keyEquivalent.lowercased() == key
                && $0.keyEquivalentModifierMask.intersection(relevant) == mods }
            let names = taken.compactMap { ($0 as? PageItem)?.command }
            check(taken.count == 1 && names == [command], "\(name) is the menu's \(taken.first?.title ?? "?"), calling \(command)",
                  taken.map { "\($0.title) → \(($0 as? PageItem)?.command ?? "not the page's")" }.joined(separator: ", "))
        }

        guard await front(c.window!) else { return skip("pressing the sheet shortcuts") }
        let notes = root.appendingPathComponent("Notes")
        func count() -> Int { ((try? FileManager.default.contentsOfDirectory(atPath: notes.path)) ?? []).filter { $0.hasSuffix(".md") }.count }
        // a sheet picked in the list, the editor not focused
        await js(web, "document.activeElement && document.activeElement.blur(); true")
        let before = count(), sheet = await ui(web, "sheet")
        press("d", 2, .command)
        _ = await until(4) { count() == before + 1 }
        check(count() == before + 1, "⌘D duplicates the sheet", "\(before) → \(count()) sheets, from \(sheet)")
        let copy = await ui(web, "sheet")
        await js(web, "document.activeElement && document.activeElement.blur(); true")
        press("u", 32, [.command, .control])
        let fav = "window.__mosheStore.sheetInfo(\(MosheWindowController.json(copy))).favorite ? 1 : 0"
        _ = await until(3) { await js(web, fav) == "1" }
        check(await js(web, fav) == "1", "⌃⌘U makes it a favourite", copy)
        press("u", 32, [.command, .shift], chars: "U")
        _ = await until(3) { await ui(web, "selection") == "favorites" }
        check(await ui(web, "selection") == "favorites", "⇧⌘U shows Favorites", await ui(web, "selection"))
        // and the same from the menu, with the mouse: Sheet → Favorite takes it off again
        if let item = all.first(where: { ($0 as? PageItem)?.command == "favorite" }), let m = item.menu {
            m.update()
            m.performActionForItem(at: m.index(of: item))
            _ = await until(3) { await js(web, fav) == "0" }
            check(await js(web, fav) == "0", "Sheet → Favorite takes it out of Favorites again", copy)
        }

        // ⌃⌘↓ in a hand-sorted group: back to the Inbox, a sheet picked, then down one
        _ = try? await web.callAsyncJavaScript("""
            const s = JSON.parse(localStorage.getItem('moshe.ui') || '{}');
            Object.assign(s, { project: null, selection: 'Notes', sheet: first });
            localStorage.setItem('moshe.ui', JSON.stringify(s)); location.reload(); return true;
            """, arguments: ["first": "Notes/Buy a new notebook.md"], contentWorld: .page)
        await pause(1)
        _ = await until(15) { await isReady(web) }
        let order = "JSON.stringify(window.__mosheStore.sheetsIn('Notes').map((x) => typeof x === 'string' ? x : x.path))"
        let was = await js(web, order), sort = await js(web, "window.__mosheStore.sget('Notes', 'sort', 'manual')")
        await front(c.window!)
        // the sheet picked with a click in the list, as a person would: the list has the focus
        let card = await js(web, "(() => { const e = [...document.querySelectorAll('.card')].find((x) => x.innerText.includes('Buy a new notebook')); if (!e) return ''; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2].join(','); })()")
        let xy = card.split(separator: ",").compactMap { Double($0) }
        if xy.count == 2 { click(c.window!, NSPoint(x: xy[0], y: web.bounds.height - xy[1])); await pause(0.5) }
        press("\u{F701}", 125, [.command, .control])
        _ = await until(3) { await js(web, order) != was }
        if sort == "manual" {
            let now = await js(web, order)
            let before = (try? JSONSerialization.jsonObject(with: Data(was.utf8))) as? [String] ?? []
            let after = (try? JSONSerialization.jsonObject(with: Data(now.utf8))) as? [String] ?? []
            let moved = "Notes/Buy a new notebook.md"
            check(before.firstIndex(of: moved).map { $0 + 1 } == after.firstIndex(of: moved), "⌃⌘↓ moves the sheet down one place in a hand-sorted group", "\(was) → \(now)")
            press("\u{F700}", 126, [.command, .control])
            _ = await until(3) { await js(web, order) == was }
            check(await js(web, order) == was, "⌃⌘↑ moves it back up")
        } else {
            log("INFO  the Inbox is sorted by \(sort), so ⌃⌘↑/↓ has nothing to move")
        }
    }

    /// Someone else writes the folder: the page hears of it through FSEvents.
    static func outside(_ c: MosheWindowController) async {
        let web = c.webView!
        let nudges = FolderBridge.nudges
        let outside = root.appendingPathComponent("Notes/Written outside.md")
        try? "# Written outside\n\nBy another app.\n".write(to: outside, atomically: true, encoding: .utf8)
        let seen = await until(4) { await js(web, "window.__mosheStore.exists('Notes/Written outside.md') ? 1 : 0") == "1" }
        check(seen, "a sheet written by another app appears")
        // (the page may have seen it first on a rescan of its own: FSEvents' word comes within its 0.3 s)
        _ = await until(2) { FolderBridge.nudges > nudges }
        check(FolderBridge.nudges > nudges, "FSEvents told the page", "\(FolderBridge.nudges - nudges) times")

        // the open sheet, changed underneath it
        let file = root.appendingPathComponent("Notes/Outside test.md")
        await openSheet(web, "Notes/Outside test.md", "# Outside test\n\nWritten here first.\n")
        let nudged = FolderBridge.nudges
        if FileManager.default.fileExists(atPath: file.path) {
            try? (text(file) + "\nAdded by Obsidian.\n").write(to: file, atomically: true, encoding: .utf8)
            let shown = await until(5) { await js(web, "(document.querySelector('.cm-content') || {}).innerText || ''").contains("Added by Obsidian.") }
            check(shown, "the open sheet takes an edit made in another app", await js(web, "(document.querySelector('.cm-content') || {}).innerText || ''"))
            check(FolderBridge.nudges > nudged, "FSEvents told the page of that edit", "\(FolderBridge.nudges - nudged) times")
        }

        // a group renamed in the app is the folder renamed on disk, with its name as written
        let renamed = "Café und שלום"
        _ = try? await web.callAsyncJavaScript("window.__mosheStore.editGroup('Notes/Getting Started', { name: n }); await window.__mosheStore.flush(); return true",
                                               arguments: ["n": renamed], contentWorld: .page)
        let names = rawNames(root.appendingPathComponent("Notes"))
        check(names.contains(renamed.precomposedStringWithCanonicalMapping) && !FileManager.default.fileExists(atPath: root.appendingPathComponent("Notes/Getting Started").path),
              "renaming a group renames its folder, the name composed as it was typed", names.sorted().joined(separator: " | "))
    }

    /// Pictures: writeBytes puts them in the folder, /_library/ serves them back.
    static func images(_ web: WKWebView) async {
        // a 2×2 PNG
        let png = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg=="
        let r = try? await web.callAsyncJavaScript("""
            const post = (op, args) => window.webkit.messageHandlers.mosheStorage.postMessage({ v: 1, op, args });
            const out = {};
            out.write = await post('writeBytes', { path: 'Notes/_media/dot.png', base64: png });
            out.hebrew = await post('writeBytes', { path: 'Notes/_media/תמונה.png', base64: png });
            const a = await fetch('/_library/Notes/_media/dot.png');
            out.status = a.status; out.type = a.headers.get('content-type'); out.size = (await a.arrayBuffer()).byteLength;
            out.hebrewStatus = (await fetch('/_library/Notes/_media/' + encodeURIComponent('תמונה.png'))).status;
            // WebKit folds /_library/%2E%2E/… into /etc/… before asking (the app's page
            // answers that); an escaped slash reaches the handler with its ..s
            out.outside = (await fetch('/_library/Notes/..%2F..%2F..%2F..%2F..%2Fetc%2Fhosts')).status;
            const folded = await fetch('/_library/%2E%2E/%2E%2E/%2E%2E/etc/hosts');
            out.folded = (await folded.text()).includes('localhost') ? 'the hosts file' : 'not a file outside';
            out.missing = (await fetch('/_library/Notes/_media/none.png')).status;
            const img = new Image(); img.src = '/_library/Notes/_media/dot.png';
            await new Promise((res) => { img.onload = img.onerror = res; });
            out.width = img.naturalWidth;
            return out;
            """, arguments: ["png": png], contentWorld: .page) as? [String: Any]
        let o = r ?? [:]
        let bytes = try? Data(contentsOf: root.appendingPathComponent("Notes/_media/dot.png"))
        check(bytes == Data(base64Encoded: png), "writeBytes puts the picture's bytes in the folder", "\(o["write"] ?? "nothing")")
        check((o["status"] as? NSNumber)?.intValue == 200 && (o["type"] as? String) == "image/png" && (o["size"] as? NSNumber)?.intValue == bytes?.count,
              "/_library/ serves it back, as image/png", "\(o)")
        check((o["hebrewStatus"] as? NSNumber)?.intValue == 200, "a picture with a Hebrew name is served too")
        check((o["width"] as? NSNumber)?.intValue == 2, "an <img> shows it")
        check((o["outside"] as? NSNumber)?.intValue == 403 && o["folded"] as? String == "not a file outside",
              "a path out of the folder is refused", "\(o["outside"] ?? ""), \(o["folded"] ?? "")")
        check((o["missing"] as? NSNumber)?.intValue == 404, "a missing picture is a 404")
    }

    /// window.mosheShell's save, share and link.
    static func services(_ web: WKWebView) async {
        let hello = Data("hello, Moshe".utf8).base64EncodedString()
        let r = try? await web.callAsyncJavaScript("""
            return [await window.mosheShell.saveFile('Test export.docx', b64, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
                    await window.mosheShell.share('Shared.txt', b64, 'text/plain'),
                    await window.mosheShell.openExternal('https://example.com/from-the-page')];
            """, arguments: ["b64": hello], contentWorld: .page) as? [Any]
        let saved = saveDir.appendingPathComponent("Test export.docx")
        check((r?.first as? NSNumber)?.boolValue == true && (try? Data(contentsOf: saved)) == Data("hello, Moshe".utf8),
              "saveFile writes the export's bytes where the save panel says", "\(r ?? [])")
        check(r.map { $0.count == 3 && ($0[1] as? NSNumber)?.boolValue == true } ?? false, "share answers")
        check(Outside.opened.contains(URL(string: "https://example.com/from-the-page")!), "openExternal goes to the browser")

        // copy: both kinds on the clipboard (whatever was there put back afterwards)
        let pb = NSPasteboard.general
        let before = (pb.pasteboardItems ?? []).map { item in item.types.reduce(into: [NSPasteboard.PasteboardType: Data]()) { $0[$1] = item.data(forType: $1) } }
        let copied = try? await web.callAsyncJavaScript("return await window.mosheShell.copy({ text: 'Strong words', html: '<p><b>Strong</b> words</p>' })", contentWorld: .page)
        let got = (pb.string(forType: .string), pb.string(forType: .html), pb.data(forType: .rtf) != nil)
        check((copied as? NSNumber)?.boolValue == true && got.0 == "Strong words" && (got.1 ?? "").contains("<b>Strong</b>") && got.2,
              "copy puts the text, its HTML and rich text on the clipboard", "\(got)")
        pb.clearContents()
        pb.writeObjects(before.map { types in let item = NSPasteboardItem(); for (t, d) in types { item.setData(d, forType: t) }; return item })

        // print: the PDF with its page numbers, to the print panel (in the test, to a file)
        if let html = try? String(contentsOf: outDir.appendingPathComponent("print-a4.html"), encoding: .utf8) {
            let printed = try? await web.callAsyncJavaScript("return await window.mosheShell.print(html, 'Novel')", arguments: ["html": html], contentWorld: .page)
            let pdf = PDFDocument(url: saveDir.appendingPathComponent("printed-Novel.pdf"))
            check((printed as? NSNumber)?.boolValue == true && (pdf?.pageCount ?? 0) > 1, "print makes the pages it prints", "\(pdf?.pageCount ?? 0) pages")
            let shared = try? await web.callAsyncJavaScript("return await window.mosheShell.sharePdf(html, 'Novel.pdf')", arguments: ["html": html], contentWorld: .page)
            check((shared as? NSNumber)?.boolValue == true, "sharePdf makes the PDF and offers it to the share picker")
        }

        // the window never leaves the app
        await js(web, "location.href = 'https://example.com/navigated'")
        await pause(1)
        check(web.url?.scheme == AppScheme.scheme && Outside.opened.contains(URL(string: "https://example.com/navigated")!),
              "a navigation away from the app opens in the browser instead", web.url?.absoluteString ?? "")
        await js(web, "window.open('https://example.com/popped', '_blank')")
        await pause(0.5)
        check(Outside.opened.contains(URL(string: "https://example.com/popped")!), "window.open to elsewhere goes to the browser too")
    }

    /// The export's print HTML, printed to a PDF: pages of the paper @page names.
    static func pdf(_ web: WKWebView) async {
        for name in ["print-a4", "print-letter"] {
            let src = outDir.appendingPathComponent("\(name).html")
            guard let html = try? String(contentsOf: src, encoding: .utf8) else {
                log("SKIP  pdf: no \(src.lastPathComponent) (selftest.sh makes it with node)")
                continue
            }
            let target = saveDir.appendingPathComponent("\(name).pdf")
            try? FileManager.default.removeItem(at: target)
            let t0 = Date()
            let ok = try? await web.callAsyncJavaScript("return await window.mosheShell.savePdf(html, name)",
                                                        arguments: ["html": html, "name": "\(name).pdf"], contentWorld: .page)
            let ms = Int(Date().timeIntervalSince(t0) * 1000)
            guard (ok as? NSNumber)?.boolValue == true, let doc = PDFDocument(url: target), let page = doc.page(at: 0) else {
                check(false, "savePdf makes \(name).pdf", "\(ok ?? "nil")")
                continue
            }
            let (paper, margins) = PDFMaker.page(html)
            let box = page.bounds(for: .mediaBox)
            check(abs(box.width - paper.width) < 1.5 && abs(box.height - paper.height) < 1.5, "\(name): the pages are the paper @page names",
                  "\(Int(box.width))×\(Int(box.height)) for \(Int(paper.width))×\(Int(paper.height)), \(doc.pageCount) pages, \(ms) ms")
            check(doc.pageCount > 1, "\(name): the text runs over several pages", "\(doc.pageCount)")
            // where the text is on the page: inside the margins @page sets
            var minX = CGFloat.greatestFiniteMagnitude, maxY: CGFloat = 0, maxX: CGFloat = 0, minY = CGFloat.greatestFiniteMagnitude
            for p in 0..<min(doc.pageCount, 3) {
                guard let pg = doc.page(at: p), let s = pg.string else { continue }
                for i in 0..<min(s.count, 4000) where !(s[s.index(s.startIndex, offsetBy: i)].isWhitespace) {
                    let b = pg.characterBounds(at: i)
                    guard b.width > 0 else { continue }
                    minX = min(minX, b.minX); maxX = max(maxX, b.maxX); maxY = max(maxY, b.maxY); minY = min(minY, b.minY)
                }
            }
            let detail = "text from x \(Int(minX)) to \(Int(maxX)), y \(Int(minY)) to \(Int(maxY)); margins t\(Int(margins.top)) r\(Int(margins.right)) b\(Int(margins.bottom)) l\(Int(margins.left))"
            log("INFO  \(name): \(detail)")
            check(minX >= margins.left - 2 && maxX <= box.width - margins.right + 2 && maxY <= box.height - margins.top + 2,
                  "\(name): the text sits inside @page's margins", detail)
            // the footer @page asks for: each page's number, in its bottom margin
            var numbered = true
            for p in 0..<doc.pageCount {
                guard let pg = doc.page(at: p) else { continue }
                let bottom = pg.selection(for: NSRect(x: 0, y: 0, width: box.width, height: margins.bottom))?.string?
                    .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                if bottom != String(p + 1) { numbered = false; log("INFO  \(name) page \(p + 1) bottom: «\(bottom)»") }
            }
            check(numbered, "\(name): each page has its number at the foot, as @page's @bottom-center says")
            try? FileManager.default.copyItem(at: target, to: outDir.appendingPathComponent("\(name).pdf"))
        }
    }

    /// ⇧⌘T in the translation project shows the two sides.
    static func translation(_ c: MosheWindowController) async {
        let web = c.webView!
        let sheet = "Projects/Kafka in Hebrew/Original/פרק ראשון.md"
        guard FileManager.default.fileExists(atPath: root.appendingPathComponent(sheet).path) else {
            return log("SKIP  translation: the sample has no \(sheet)")
        }
        _ = try? await web.callAsyncJavaScript("""
            const s = JSON.parse(localStorage.getItem('moshe.ui') || '{}');
            Object.assign(s, { project: 'Projects/Kafka in Hebrew', selection: 'Projects/Kafka in Hebrew/Original', sheet, translation: false });
            localStorage.setItem('moshe.ui', JSON.stringify(s));
            location.reload();
            return true;
            """, arguments: ["sheet": sheet], contentWorld: .page)
        await pause(1)
        _ = await until(15) { await isReady(web) }
        guard await front(c.window!) else { return skip("⇧⌘T in the translation project") }
        await js(web, "window.dispatchEvent(new Event('moshe:focus-editor'))")
        press("t", 17, [.command, .shift], chars: "T")
        _ = await until(4) { await ui(web, "translation") == "1" }
        await pause(0.5)
        let editors = await js(web, "document.querySelectorAll('.cm-editor').length")
        check(await ui(web, "translation") == "1" && (Int(editors) ?? 0) >= 2, "⇧⌘T shows the sheet and its translation side by side", "\(editors) editors")
        let rtl = await js(web, "[...document.querySelectorAll('.cm-line')].some((l) => getComputedStyle(l).direction === 'rtl' || l.dir === 'rtl') ? 1 : 0")
        check(rtl == "1", "the Hebrew paragraphs run right to left")
        capture(c.window!, "06-translation")
        // ⌥⌘→ / ⌥⌘←: from one editor to the other
        let which = "(() => { const eds = [...document.querySelectorAll('.cm-editor')]; return eds.findIndex((e) => e.contains(document.activeElement)); })()"
        let at = await js(web, which)
        press(at == "0" ? "\u{F703}" : "\u{F702}", at == "0" ? 124 : 123, [.command, .option])
        _ = await until(3) { await js(web, which) != at }
        let now = await js(web, which)
        check(now != at && now != "-1", "⌥⌘→/← moves from one editor to the other", "editor \(at) → \(now)")
        press("t", 17, [.command, .shift], chars: "T")
        _ = await until(3) { await ui(web, "translation") == "0" }
    }

    /// The page's grammar and spelling check (Harper, editor/proof.js): its
    /// worker and its WebAssembly under moshe-app://, the underlines, a fix
    /// applied once, and the system's own spellchecker left to the Hebrew.
    static func proof(_ c: MosheWindowController) async {
        let web = c.webView!
        let file = root.appendingPathComponent("Notes/Proof test.md")
        try? "Their is a eror. I has two apple.\n\nשלום עולם, זה משפט בעברית.\n".write(to: file, atomically: true, encoding: .utf8)
        watchWorkers(web)
        _ = try? await web.callAsyncJavaScript("""
            const s = JSON.parse(localStorage.getItem('moshe.ui') || '{}');
            Object.assign(s, { project: null, selection: 'Notes', sheet: 'Notes/Proof test.md', translation: false });
            localStorage.setItem('moshe.ui', JSON.stringify(s)); location.reload(); return true;
            """, contentWorld: .page)
        await pause(1)
        _ = await until(15) { await isReady(web) }
        let t0 = Date()
        let found = await until(45) { (Int(await js(web, "document.querySelectorAll('.cm-proof').length")) ?? 0) > 0 }
        let secs = String(format: "%.1f", Date().timeIntervalSince(t0))
        let marks = await js(web, "JSON.stringify([...document.querySelectorAll('.cm-proof')].map((e) => e.textContent + ' ' + e.className.replace('cm-proof', '').trim()))")
        check(found, "Harper underlines the mistakes", "\(marks), after \(secs) s")
        let workers = await js(web, "JSON.stringify(window.__workers || [])")
        // (the page's side loads the WebAssembly too: harper.js reads the worker's answers with it)
        check(workers.contains("\"error\":null"), "Harper's worker starts under moshe-app://", workers)
        // the WebAssembly as the scheme handler serves it: application/wasm, or streaming compiles refuse it
        let assets = Library.webBundle?.appendingPathComponent("assets")
        let name = ((try? FileManager.default.contentsOfDirectory(atPath: assets?.path ?? "")) ?? []).first { $0.hasPrefix("harper_wasm_bg") && $0.hasSuffix(".wasm") }
        let type = (try? await web.callAsyncJavaScript("const r = await fetch('/assets/' + n); return r.status + ' ' + r.headers.get('content-type')",
                                                       arguments: ["n": name ?? "none"], contentWorld: .page)) as? String
        check(type == "200 application/wasm", "the .wasm is served as application/wasm", type ?? "?")
        // the lines the page checks itself have the system's spellchecker off: English (Harper) and Hebrew (Hunspell)
        let spell = await js(web, "JSON.stringify([...document.querySelectorAll('.cm-line')].filter((l) => l.textContent.trim()).map((l) => [l.textContent.slice(0, 12), l.getAttribute('spellcheck')]))")
        check(spell.contains("\"Their is a e\",\"false\"") && spell.contains("\"שלום עולם, ז\",\"false\""), "the system's spellchecker is off where the page checks, English and Hebrew", spell)
        // a click on a finding, and its first fix, applied once
        if found {
            let before = text(file)
            await js(web, "document.querySelector('.cm-proof').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); document.querySelector('.cm-proof').click(); true")
            _ = await until(3) { (Int(await js(web, "document.querySelectorAll('.sug').length")) ?? 0) > 0 }
            let sug = await js(web, "(() => { const b = document.querySelector('.sug'); if (!b) return ''; const t = b.textContent; b.click(); return t; })()")
            _ = await until(4) { text(file) != before }
            check(!sug.isEmpty && text(file) != before, "a fix from the popover changes the text", "\(sug): \(text(file).split(separator: "\n").first ?? "")")
        }
        await snapPage(web, "08-proof")
    }

    /// The page's Hebrew spelling (Hunspell in a module worker, editor/hebrew.js):
    /// the worker under moshe-app://, its dictionary, an unknown word
    /// underlined, a suggestion applied once, and Add to Dictionary.
    static func hebrew(_ c: MosheWindowController) async {
        let web = c.webView!
        let path = "Notes/Hebrew test.md"
        watchWorkers(web)
        await openSheet(web, path, "גרגור סמסא מצא בעייה גדולה.\n")
        let marksJS = "JSON.stringify([...document.querySelectorAll('[data-heb]')].map((e) => e.textContent))"
        let t0 = Date()
        let found = await until(45) { await js(web, marksJS).contains("בעייה") }
        check(found, "an unknown Hebrew word is underlined", "\(await js(web, marksJS)) after \(String(format: "%.1f", Date().timeIntervalSince(t0))) s")
        let workers = await js(web, "JSON.stringify((window.__workers || []).filter((w) => w.url.includes('hebrew')))")
        check(workers.contains("hebrew-worker") && workers.contains("\"error\":null"), "the Hebrew module worker starts under moshe-app://", workers)
        let assets = Library.webBundle?.appendingPathComponent("assets")
        let names = (try? FileManager.default.contentsOfDirectory(atPath: assets?.path ?? "")) ?? []
        for (prefix, ext) in [("hunspell", ".wasm"), ("index", ".dic"), ("index", ".aff")] {
            guard let n = names.first(where: { $0.hasPrefix(prefix) && $0.hasSuffix(ext) }) else { check(false, "the build has its \(ext)"); continue }
            let r = (try? await web.callAsyncJavaScript("const r = await fetch('/assets/' + n); return r.status + ' ' + r.headers.get('content-type') + ' ' + (await r.arrayBuffer()).byteLength",
                                                        arguments: ["n": n], contentWorld: .page)) as? String ?? "?"
            check(r.hasPrefix("200"), "the \(ext) is served", r)
        }
        guard found else { return }
        // a click on בעייה, and בעיה from its suggestions: once
        func click(_ word: String) async {
            _ = try? await web.callAsyncJavaScript("""
                const e = [...document.querySelectorAll('[data-heb]')].find((x) => x.textContent === w);
                e.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); e.click(); return true;
                """, arguments: ["w": word], contentWorld: .page)
        }
        await click("בעייה")
        _ = await until(5) { (Int(await js(web, "document.querySelectorAll('.sug').length")) ?? 0) > 0 }
        let sugs = await js(web, "JSON.stringify([...document.querySelectorAll('.sug')].map((b) => b.textContent))")
        let file = root.appendingPathComponent(path)
        let picked = (try? await web.callAsyncJavaScript("""
            const b = [...document.querySelectorAll('.sug')].find((x) => x.textContent === 'בעיה'); if (!b) return false; b.click(); return true;
            """, contentWorld: .page)) as? Bool ?? false
        _ = await until(4) { !text(file).contains("בעייה") }
        let now = text(file)
        check(picked && !now.contains("בעייה") && now.components(separatedBy: "בעיה").count == 2, "choosing בעיה from the suggestions fixes the word once",
              "suggestions \(sugs); now «\(now.trimmingCharacters(in: .newlines))»")
        // Add to Dictionary: the name's underline goes, and the word is in the library's dictionary
        if await js(web, marksJS).contains("סמסא") {
            await click("סמסא")
            _ = await until(4) { await js(web, "[...document.querySelectorAll('button')].some((b) => b.textContent === 'Add to Dictionary') ? 1 : 0") == "1" }
            await js(web, "[...document.querySelectorAll('button')].find((b) => b.textContent === 'Add to Dictionary').click(); true")
            _ = await until(5) { !(await js(web, marksJS).contains("סמסא")) }
            let lib = text(root.appendingPathComponent(".moshe/library.json"))
            check(!(await js(web, marksJS).contains("סמסא")) && lib.contains("סמסא"), "Add to Dictionary takes סמסא's underline away and keeps the word in the library",
                  "marks \(await js(web, marksJS))")
        } else {
            log("INFO  סמסא was not underlined, so Add to Dictionary had nothing to do")
        }
        await snapPage(web, "09-hebrew")
    }

    /// Settings on the Mac is the Preferences window it always was (the phone's
    /// list-and-pane layout is for narrow screens only).
    static func settings(_ c: MosheWindowController) async {
        let web = c.webView!
        c.command("settings")
        _ = await until(3) { await js(web, "!!document.querySelector('.win')") == "1" }
        let shape = await js(web, "JSON.stringify({ width: Math.round(document.querySelector('.win').getBoundingClientRect().width), tabs: document.querySelectorAll('.tabs button').length, list: document.querySelectorAll('.pitem').length, phonebar: !!document.querySelector('.phonebar'), wide: document.documentElement.scrollWidth <= innerWidth })")
        check(shape.contains("\"width\":690") && shape.contains("\"tabs\":6") && shape.contains("\"list\":0") && shape.contains("\"phonebar\":false"),
              "Settings on the Mac is the Preferences window, tabs and all", shape)
        await snapPage(web, "10-settings")
        await js(web, "window.mosheCommand('settings'); document.querySelector('.close') && document.querySelector('.close').click(); true")
    }

    /// The panes' edges, dragged with the mouse: the width follows,
    /// is kept, and a double-click puts it back.
    static func panes(_ c: MosheWindowController) async {
        let web = c.webView!, w = c.window!
        guard await front(w) else { return skip("dragging the panes' edges") }
        func width(_ sel: String) async -> Int { Int(await js(web, "Math.round(document.querySelector('.window > .col.\(sel)').getBoundingClientRect().width)")) ?? 0 }
        func edge(_ sel: String) async -> NSPoint? {
            let v = await js(web, "(() => { const r = document.querySelector('.window > .col.\(sel) > .edge').getBoundingClientRect(); return [r.left + r.width / 2, r.top + 300].join(','); })()")
            let n = v.split(separator: ",").compactMap { Double($0) }
            return n.count == 2 ? NSPoint(x: n[0], y: web.bounds.height - n[1]) : nil
        }
        func drag(_ from: NSPoint, by dx: CGFloat) async {
            mouse(w, from, .leftMouseDown)
            for i in 1...8 {
                mouse(w, NSPoint(x: from.x + dx * CGFloat(i) / 8, y: from.y), .leftMouseDragged)
                await pause(0.03)
            }
            mouse(w, NSPoint(x: from.x + dx, y: from.y), .leftMouseUp)
            await pause(0.4)
        }
        // from the usual widths, whatever an earlier run left
        _ = try? await web.callAsyncJavaScript("""
            const s = JSON.parse(localStorage.getItem('moshe.ui') || '{}'); s.widths = {}; localStorage.setItem('moshe.ui', JSON.stringify(s)); location.reload(); return true;
            """, contentWorld: .page)
        await pause(1)
        _ = await until(15) { await isReady(web) }
        guard await front(w) else { return skip("dragging the panes' edges") }
        for (sel, dx, want) in [("lib", CGFloat(80), 320), ("list", CGFloat(-40), 240)] {
            let before = await width(sel)
            guard let p = await edge(sel) else { check(false, "the \(sel) pane has an edge to drag"); continue }
            await drag(p, by: dx)
            let after = await width(sel), kept = await ui(web, "widths.\(sel)")
            check(after == want && kept == String(want), "dragging the \(sel) pane's edge makes it \(want) px, and it is kept", "\(before) → \(after), saved \(kept)")
        }
        capture(w, "11-panes")
        // a double-click on the edge: the usual width again
        if let p = await edge("lib") {
            for n in [1, 2] {
                for t in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
                    if let e = NSEvent.mouseEvent(with: t, location: p, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                                  windowNumber: w.windowNumber, context: nil, eventNumber: 0, clickCount: n, pressure: t == .leftMouseDown ? 1 : 0) {
                        NSApp.postEvent(e, atStart: false)
                    }
                }
            }
            await pause(0.5)
            check(await width("lib") == 240, "a double-click on its edge puts the library back to 240 px", "\(await width("lib"))")
        }
        await js(web, "(() => { const s = JSON.parse(localStorage.getItem('moshe.ui') || '{}'); return 1; })()")
    }

    /// The library moved: every window loads again, on the new folder.
    /// Writing by voice (docs/VOICE.md): Apple's dictation hears sentences from a file (selftest.sh makes it with
    /// `say`), the pauses cut them into utterances, and the page carries each out in a new sheet.
    static func voice(_ c: MosheWindowController) async {
        let web = c.webView!
        guard VoiceService.available else { log("INFO  voice: this Mac's dictation needs macOS 26; the page would use Whisper"); return }
        guard UserDefaults.standard.string(forKey: "SelfTestVoiceFile").map({ FileManager.default.fileExists(atPath: $0) }) == true else {
            return check(false, "voice: the spoken file is there", "no say?")
        }
        check(await js(web, "window.mosheShell && window.mosheShell.voice ? 'yes' : 'no'") == "yes", "voice: the shell offers its recognizer")
        await js(web, "mosheMenuState().voice || mosheCommand('voice'), mosheCommand('newSheet'), 1")
        await pause(0.8)
        let before = Int(await js(web, "__mosheVoice.state().count")) ?? 0
        await js(web, "mosheCommand('listen'), 1")
        let all = await until(90) { Int(await js(web, "__mosheVoice.state().count")) ?? 0 >= before + 9 }
        await js(web, "mosheCommand('listen'), 1")                         // stop
        let heard = await js(web, "JSON.stringify(__mosheVoice.state().heard.slice(0, 9).reverse().map((h) => [h.said, h.kind, h.msg, h.how]))")
        for line in heard.components(separatedBy: "],[") { log("INFO  voice heard " + line.trimmingCharacters(in: CharacterSet(charactersIn: "[]"))) }
        check(all, "voice: nine utterances heard, one at each pause", heard)
        let kinds = await js(web, "__mosheVoice.state().heard.slice(0, 9).reverse().map((h) => h.kind).join(' ')")
        check(kinds == "text command text command command command command ignored command", "voice: text, commands and sleep told apart", kinds)
        let text = await js(web, "__mosheVoice.text()")
        check(text == "The storm came in from the west.\n\nIt rained for three days.", "voice: the sheet says what was said", text)
        check(heard.contains("Apple’s dictation"), "voice: heard by Apple's dictation")
        await snapPage(web, "voice")
    }

    static func reload(_ c: MosheWindowController) async {
        let other = FileManager.default.temporaryDirectory.appendingPathComponent("moshe-selftest-second-\(UUID().uuidString.prefix(6))")
        try? FileManager.default.createDirectory(at: other.appendingPathComponent("Notes"), withIntermediateDirectories: true)
        try? "# Second library\n".write(to: other.appendingPathComponent("Notes/Second library.md"), atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: other) }
        let saved = UserDefaults.standard.volatileDomain(forName: UserDefaults.argumentDomain)
        var args = saved
        args[Library.folderKey] = other.path
        UserDefaults.standard.setVolatileDomain(args, forName: UserDefaults.argumentDomain)
        NotificationCenter.default.post(name: .mosheReload, object: nil)
        let moved = await until(15) {
            guard await isReady(c.webView) else { return false }
            return await js(c.webView, "window.__mosheStore.exists('Notes/Second library.md') ? 1 : 0") == "1"
        }
        check(moved, "choosing another folder loads the window again on it")
        let info = (try? await c.webView.callAsyncJavaScript("return await window.webkit.messageHandlers.mosheStorage.postMessage({v: 1, op: 'info', args: {}})",
                                                             contentWorld: .page) as? [String: Any])?["ok"] as? [String: Any]
        check(info?["name"] as? String == other.lastPathComponent && (info?["pollSeconds"] as? NSNumber)?.intValue == 0,
              "info names the folder and says FSEvents reports changes", "\(info ?? [:])")
        UserDefaults.standard.setVolatileDomain(saved, forName: UserDefaults.argumentDomain)
        NotificationCenter.default.post(name: .mosheReload, object: nil)
        _ = await until(15) { await isReady(c.webView) }
    }

    // MARK: helpers

    /// From the next load on, every Worker the page makes, and how it ends, in window.__workers.
    static var watching = false
    static func watchWorkers(_ web: WKWebView) {
        guard !watching else { return }
        watching = true
        web.configuration.userContentController.addUserScript(WKUserScript(source: """
            (() => { const W = window.Worker; window.__workers = [];
              window.Worker = function (url, opts) { const w = new W(url, opts); const rec = { url: String(url).slice(0, 60), error: null };
                window.__workers.push(rec); w.addEventListener('error', (e) => { rec.error = e.message || 'error'; }); return w; };
              window.Worker.prototype = W.prototype; })();
            """, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
    }

    /// Open a sheet (after writing its text), through the page's saved state and a reload.
    static func openSheet(_ web: WKWebView, _ path: String, _ text: String) async {
        try? text.write(to: root.appendingPathComponent(path), atomically: true, encoding: .utf8)
        _ = try? await web.callAsyncJavaScript("""
            const s = JSON.parse(localStorage.getItem('moshe.ui') || '{}');
            Object.assign(s, { project: null, selection: path.split('/').slice(0, -1).join('/'), sheet: path, translation: false });
            localStorage.setItem('moshe.ui', JSON.stringify(s)); location.reload(); return true;
            """, arguments: ["path": path], contentWorld: .page)
        await pause(1)
        _ = await until(15) { await isReady(web) }
    }

    /// The window in front and the app active, for what needs the keyboard or
    /// the mouse. False if another app keeps the front (someone at the Mac).
    @discardableResult
    static func front(_ w: NSWindow) async -> Bool {
        if NSApp.isActive && w.isKeyWindow { return true }
        NSApp.activate()
        w.makeKeyAndOrderFront(nil)
        let ok = await until(3) { NSApp.isActive && w.isKeyWindow }
        if !ok { log("INFO  another app is in front; the next checks need Moshe in front") }
        await pause(0.2)
        return ok
    }

    static func find(_ title: String, in menu: NSMenu) -> NSMenuItem? {
        for i in menu.items {
            if i.title == title { return i }
            if let sub = i.submenu, let hit = find(title, in: sub) { return hit }
        }
        return nil
    }

    static func text(_ url: URL) -> String { (try? String(contentsOf: url, encoding: .utf8)) ?? "" }

    /// A directory's names as readdir(3) gives them: the bytes on disk.
    static func rawNames(_ dir: URL) -> [String] {
        guard let d = opendir(dir.path) else { return [] }
        defer { closedir(d) }
        var out: [String] = []
        while let e = readdir(d) {
            let name = withUnsafePointer(to: e.pointee.d_name) { $0.withMemoryRebound(to: CChar.self, capacity: 1024) { String(cString: $0) } }
            if name != "." && name != ".." { out.append(name) }
        }
        return out
    }

    /// A value of the page's saved state (localStorage 'moshe.ui'), e.g. "panes", "prefs.fontSize".
    static func ui(_ web: WKWebView, _ key: String) async -> String {
        let v = await js(web, "(() => { const s = JSON.parse(localStorage.getItem('moshe.ui') || '{}'); const v = \(MosheWindowController.json(key)).split('.').reduce((o, k) => o == null ? o : o[k], s); return v === true ? 1 : v === false ? 0 : v == null ? 'none' : v; })()")
        return v
    }

    @discardableResult
    static func js(_ web: WKWebView, _ src: String) async -> String {
        do { return String(describing: try await web.evaluateJavaScript(src) ?? "undefined") }
        catch { return "error: \(error.localizedDescription)" }
    }

    static func click(_ w: NSWindow, _ p: NSPoint) {
        mouse(w, p, .leftMouseDown)
        mouse(w, p, .leftMouseUp)
    }

    static func mouse(_ w: NSWindow, _ p: NSPoint, _ type: NSEvent.EventType) {
        if let e = NSEvent.mouseEvent(with: type, location: p, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                      windowNumber: w.windowNumber, context: nil, eventNumber: 0, clickCount: 1,
                                      pressure: type == .leftMouseDown ? 1 : 0) {
            NSApp.postEvent(e, atStart: false)
        }
    }

    /// A key as the keyboard sends it.
    static func press(_ key: String, _ code: UInt16, _ flags: NSEvent.ModifierFlags = [], chars: String? = nil) {
        var typed = chars ?? key
        if chars == nil, flags.contains(.control), let s = key.unicodeScalars.first, s.value >= 0x61, s.value <= 0x7a,
           let c = UnicodeScalar(s.value & 0x1f) { typed = String(Character(c)) }
        for type in [NSEvent.EventType.keyDown, .keyUp] {
            if let e = NSEvent.keyEvent(with: type, location: .zero, modifierFlags: flags,
                                        timestamp: ProcessInfo.processInfo.systemUptime,
                                        windowNumber: NSApp.keyWindow?.windowNumber ?? 0, context: nil,
                                        characters: typed, charactersIgnoringModifiers: key,
                                        isARepeat: false, keyCode: code) {
                NSApp.postEvent(e, atStart: false)
            }
        }
    }
    static func type(_ text: String) {
        for ch in text {
            let s = String(ch)
            press(s, ch == " " ? 49 : 0, ch.isUppercase ? .shift : [])
        }
    }

    // MARK: output

    static func log(_ s: String) { FileHandle.standardError.write(Data((s + "\n").utf8)) }
    static func check(_ ok: Bool, _ what: String, _ detail: String = "") {
        log((ok ? "PASS  " : "FAIL  ") + what + (detail.isEmpty ? "" : "  [" + detail.replacingOccurrences(of: "\n", with: "⏎") + "]"))
        if !ok { failures += 1 }
    }
    static func skip(_ what: String) { log("SKIP  \(what): Moshe could not come to the front"); skipped += 1 }
    static var skipped = 0
    static func pause(_ s: Double) async { try? await Task.sleep(nanoseconds: UInt64(s * 1_000_000_000)) }
    static func until(_ timeout: Double, _ cond: () async -> Bool) async -> Bool {
        let end = Date().addingTimeInterval(timeout)
        repeat { if await cond() { return true }; await pause(0.15) } while Date() < end
        return false
    }

    static func save(_ image: NSImage?, _ name: String) {
        guard let tiff = image?.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
              let png = rep.representation(using: .png, properties: [:]) else { return }
        try? png.write(to: outDir.appendingPathComponent(name + ".png"))
    }
    static func snapPage(_ web: WKWebView, _ name: String) async { save(try? await web.takeSnapshot(configuration: nil), name) }
    /// The app's own windows, chrome and all; no Screen Recording permission needed for these.
    static func capture(_ w: NSWindow, _ name: String) {
        guard let cg = CGWindowListCreateImage(.null, .optionIncludingWindow, CGWindowID(w.windowNumber),
                                               [.boundsIgnoreFraming, .bestResolution]) else { return }
        save(NSImage(cgImage: cg, size: .zero), name)
    }
    static func dumpMenus() {
        for top in NSApp.mainMenu?.items ?? [] {
            let items = (top.submenu?.items ?? []).filter { !$0.isSeparatorItem && !$0.isHidden }.map { i -> String in
                let m = i.keyEquivalentModifierMask
                let mods = (m.contains(.control) ? "⌃" : "") + (m.contains(.option) ? "⌥" : "") + (m.contains(.shift) ? "⇧" : "") + (m.contains(.command) ? "⌘" : "")
                let named: [String: String] = ["\u{8}": "⌫", "\r": "↩", "\u{1B}": "Esc"]
                let key = named[i.keyEquivalent] ?? i.keyEquivalent.uppercased()
                return i.keyEquivalent.isEmpty ? i.title : "\(i.title) \(mods)\(key)"
            }
            log("MENU  \(top.title): " + items.joined(separator: " · "))
        }
    }
}
