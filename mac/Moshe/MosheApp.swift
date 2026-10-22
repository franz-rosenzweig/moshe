import AppKit

/// Moshe for macOS: the web app in `frontend/`, running on a folder of
/// Markdown on this Mac (docs/BRIDGE.md), in a window that is all page.
/// Everything a person sees is the page; this adds the window, the
/// menus, the folder and the few things a page cannot do (ShellServices).
@main
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.run()
    }

    func applicationWillFinishLaunching(_ notification: Notification) {
        // The system underlines misspellings and grammar in the editor, as in
        // any Mac text view. WebKit reads these when it first checks; Edit →
        // Spelling and Grammar turns them off again, and remembers.
        UserDefaults.standard.register(defaults: [
            "WebContinuousSpellCheckingEnabled": true,
            "WebGrammarCheckingEnabled": true,
        ])
        NSApp.mainMenu = Menus.build()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NotificationCenter.default.addObserver(forName: .mosheReload, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated {
                for window in MosheWindowController.all { window.reload() }
            }
        }
        if UserDefaults.standard.string(forKey: "SelfTestOut") == nil { Library.ensureChosen() }
        MosheWindowController.open()
        NSApp.activate()
    }

    /// Closing the last window leaves Moshe running, as a Mac app does;
    /// clicking the Dock icon brings a window back.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if MosheWindowController.all.isEmpty { MosheWindowController.open() }
        return true
    }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }
}
