import AppKit
import Foundation

/// Where the library lives. Moshe's is a folder on this Mac, read and written
/// by the page through FolderBridge (docs/BRIDGE.md), which is the default; a
/// Moshe server's own page is the other way, with no bridge.
enum Library {
    static let modeKey = "libraryMode"        // "folder" | "server"
    static let folderKey = "libraryFolder"    // a path; the app is not sandboxed
    static let serverKey = "serverURL"

    /// The server this build was given (MOSHE_DEFAULT_SERVER, into the
    /// Info.plist by build.sh), offered before an address is typed. Usually none.
    static var defaultServer: String? {
        let s = ((Bundle.main.object(forInfoDictionaryKey: "MosheDefaultServer") as? String) ?? "")
            .trimmingCharacters(in: .whitespaces)
        return s.isEmpty || s.hasPrefix("$(") ? nil : s
    }

    /// The page, served from inside the app in folder mode (AppScheme).
    static let appOrigin = URL(string: "moshe-app://app/")!

    static var mode: String { UserDefaults.standard.string(forKey: modeKey) ?? "folder" }

    /// The folder chosen, whatever the mode, if it is still there.
    static var folder: URL? {
        guard let path = UserDefaults.standard.string(forKey: folderKey), !path.isEmpty else { return nil }
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: path, isDirectory: &isDir), isDir.boolValue else { return nil }
        return URL(fileURLWithPath: path, isDirectory: true)
    }

    /// The folder was chosen once and has gone (a disk not mounted, a folder moved).
    static var folderMissing: Bool {
        (UserDefaults.standard.string(forKey: folderKey).map { !$0.isEmpty } ?? false) && folder == nil
    }

    static var usesFolder: Bool { mode == "folder" && folder != nil && webBundle != nil }

    /// The server: the address typed in Use the Server…, or this build's. None before either.
    static var server: URL? {
        guard let s = UserDefaults.standard.string(forKey: serverKey) ?? defaultServer, !s.isEmpty else { return nil }
        return URL(string: s.hasSuffix("/") ? s : s + "/")
    }

    /// The built web app inside Moshe.app (build.sh copies frontend/dist there).
    static var webBundle: URL? {
        guard let url = Bundle.main.resourceURL?.appendingPathComponent("web", isDirectory: true),
              FileManager.default.fileExists(atPath: url.appendingPathComponent("index.html").path) else { return nil }
        return url
    }

    /// Where a window opens. (Server mode without a server can't last: ensureChosen asks.)
    static var startURL: URL { usesFolder ? appOrigin : (server ?? appOrigin) }

    /// A page the app treats as its own: from inside the app, or the server's.
    static func isOurs(_ url: URL) -> Bool {
        if url.scheme == AppScheme.scheme { return true }
        guard let server else { return false }
        return url.scheme == server.scheme && url.host == server.host && url.port == server.port
    }

    static func useFolder(_ url: URL) {
        UserDefaults.standard.set(url.path, forKey: folderKey)
        UserDefaults.standard.set("folder", forKey: modeKey)
        NotificationCenter.default.post(name: .mosheReload, object: nil)
    }

    static func useServer() {
        UserDefaults.standard.set("server", forKey: modeKey)
        NotificationCenter.default.post(name: .mosheReload, object: nil)
    }

    /// The folder picker. Nil if cancelled.
    @MainActor
    static func chooseFolder() -> URL? {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "Use This Folder"
        panel.message = "Choose the folder Moshe keeps your library in: Notes/Writing in your Obsidian vault, "
            + "or any folder Syncthing or iCloud Drive keeps in step. An empty folder starts an empty library."
        if let current = UserDefaults.standard.string(forKey: folderKey) {
            panel.directoryURL = URL(fileURLWithPath: current)
        }
        return panel.runModal() == .OK ? panel.url : nil
    }

    /// First run, or the folder has gone: ask for one. Cancelling offers the
    /// server instead, or quitting.
    @MainActor
    static func ensureChosen() {
        // the server's window with no server to open (an address never typed, a build without one)
        if mode == "server" && server == nil { UserDefaults.standard.set("folder", forKey: modeKey) }
        guard mode == "folder", folder == nil else { return }
        if webBundle == nil {
            // a build without the web app can only be a server's window
            if server == nil && !askServer(switching: false) { NSApp.terminate(nil) }
            return useServer()
        }
        while true {
            if let url = chooseFolder() {
                UserDefaults.standard.set(url.path, forKey: folderKey)
                return
            }
            let alert = NSAlert()
            alert.messageText = folderMissing ? "Moshe cannot find your library folder" : "Moshe keeps your writing in a folder"
            let there = server.map { " (\($0.host ?? $0.absoluteString))" } ?? ""
            alert.informativeText = "Choose the folder your sheets live in, or open the library on a Moshe server\(there) instead."
            alert.addButton(withTitle: "Choose Folder…")
            alert.addButton(withTitle: server == nil ? "Use a Server…" : "Use the Server")
            alert.addButton(withTitle: "Quit")
            switch alert.runModal() {
            case .alertFirstButtonReturn: continue
            case .alertSecondButtonReturn:
                if server == nil && !askServer(switching: false) { continue }
                UserDefaults.standard.set("server", forKey: modeKey)
                return
            default: NSApp.terminate(nil)
            }
        }
    }

    /// The server's address, asked for in an alert, and kept. Switches to it
    /// unless told not to. False if cancelled or not an address.
    @MainActor @discardableResult
    static func askServer(switching: Bool = true) -> Bool {
        let alert = NSAlert()
        alert.messageText = "The server's address"
        alert.informativeText = "Moshe opens the library on this server instead of a folder on this Mac."
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
        field.stringValue = server?.absoluteString ?? ""
        field.placeholderString = defaultServer ?? "https://moshe.example.com/"
        alert.accessoryView = field
        alert.addButton(withTitle: "Use the Server")
        alert.addButton(withTitle: "Cancel")
        alert.window.initialFirstResponder = field
        guard alert.runModal() == .alertFirstButtonReturn else { return false }
        let typed = field.stringValue.trimmingCharacters(in: .whitespaces)
        guard let url = URL(string: typed.isEmpty ? (defaultServer ?? "") : typed), let scheme = url.scheme,
              ["http", "https"].contains(scheme.lowercased()), url.host != nil else {
            NSSound.beep()
            return false
        }
        UserDefaults.standard.set(url.absoluteString, forKey: serverKey)
        if switching { useServer() }
        return true
    }
}

extension Notification.Name {
    /// The library moved (another folder, the server): every window loads again.
    static let mosheReload = Notification.Name("moshe.reload")
}
