import AppKit
import WebKit

/// One Moshe window, which is all page. The content runs to
/// the top edge under a transparent title bar, the traffic lights float over
/// the library pane's bar, and the page draws everything else.
@MainActor
final class MosheWindowController: NSWindowController, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    /// Every open window, the way the menu finds the one in front.
    static private(set) var all: [MosheWindowController] = []

    /// The page's top bar (App.svelte, `.bar`): the traffic lights sit in its middle.
    static let barHeight: CGFloat = 56
    /// Where the close button starts, as in a window with a unified toolbar.
    static let lightsInset: CGFloat = 20
    static let minSize = NSSize(width: 900, height: 600)
    private static let autosaveName = "Moshe Window"

    private(set) var webView: ShellWebView!
    private var bridge: FolderBridge?
    private let services = ShellServices()
    private lazy var windowMessages = WindowMessages(owner: self)

    /// The window in front, or any window.
    static var front: MosheWindowController? {
        for window in [NSApp.keyWindow, NSApp.mainWindow] {
            if let c = window?.windowController as? MosheWindowController { return c }
        }
        return all.first
    }

    @discardableResult
    static func open() -> MosheWindowController {
        let c = MosheWindowController()
        all.append(c)
        c.showWindow(nil)
        c.layoutTrafficLights()
        return c
    }

    init() {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1240, height: 800),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                              backing: .buffered, defer: false)
        window.title = "Moshe"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.tabbingMode = .disallowed
        window.minSize = Self.minSize
        window.collectionBehavior.insert(.fullScreenPrimary)
        window.isReleasedWhenClosed = false
        super.init(window: window)
        window.delegate = self
        // The frame is remembered for the first window of the app; another
        // one opens cascaded from the window in front.
        if !Self.all.contains(where: { $0.window?.frameAutosaveName == Self.autosaveName }) {
            if !window.setFrameUsingName(Self.autosaveName) { window.center() }
            window.setFrameAutosaveName(Self.autosaveName)
        } else if let front = Self.front?.window {
            window.setFrame(front.frame, display: false)
            window.setFrameTopLeftPoint(window.cascadeTopLeft(from: NSPoint(x: front.frame.minX, y: front.frame.maxY)))
        }
        makeWebView()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not from a nib") }

    // MARK: the page

    /// The web view for the library as it is now: the page from inside the app
    /// with the folder behind it, or the server's page. Made again when the
    /// library moves.
    private func makeWebView() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()          // the page's own settings (localStorage) outlive a launch
        // Lets the page tell it is inside the shell: it leaves room for the traffic lights.
        config.applicationNameForUserAgent = "Moshe/\(Self.version) (macOS shell)"
        let content = config.userContentController
        content.addUserScript(WKUserScript(source: ShellServices.script, injectionTime: .atDocumentStart,
                                           forMainFrameOnly: true, in: .page))
        content.addUserScript(WKUserScript(source: WindowMessages.script, injectionTime: .atDocumentStart,
                                           forMainFrameOnly: true, in: .page))
        content.addScriptMessageHandler(services, contentWorld: .page, name: "mosheShell")
        content.add(windowMessages, contentWorld: .page, name: "mosheWindow")
        if Library.usesFolder, let folder = Library.folder, let web = Library.webBundle {
            config.setURLSchemeHandler(AppScheme(root: web, library: folder), forURLScheme: AppScheme.scheme)
            let bridge = FolderBridge(root: folder)
            content.addScriptMessageHandler(bridge, contentWorld: .page, name: "mosheStorage")
            self.bridge = bridge
        } else {
            bridge = nil
        }

        let view = ShellWebView(frame: window?.contentView?.bounds ?? .zero, configuration: config)
        view.autoresizingMask = [.width, .height]
        view.navigationDelegate = self
        view.uiDelegate = self
        view.isInspectable = true                     // Safari → Develop, for a look inside the page
        view.allowsMagnification = false
        services.webView = view
        bridge?.webView = view
        bridge?.startWatching()
        webView = view
        window?.contentView = view
        view.load(URLRequest(url: Library.startURL, cachePolicy: .reloadIgnoringLocalCacheData))
    }

    /// The library moved: the page again, from where it lives now.
    func reload() {
        teardown()
        makeWebView()
        layoutTrafficLights()
    }

    private func teardown() {
        bridge?.stopWatching()
        webView?.configuration.userContentController.removeAllScriptMessageHandlers()
        webView?.stopLoading()
        bridge = nil
    }

    static var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
    }

    /// Run one of the page's commands (App.svelte, `window.mosheCommand`).
    func command(_ name: String, _ arg: Any? = nil) {
        let a = arg.map { Self.json($0) } ?? "undefined"
        webView.evaluateJavaScript("window.mosheCommand ? window.mosheCommand(\(Self.json(name)), \(a)) : false") { result, _ in
            if (result as? Bool) != true { NSLog("Moshe: the page has no command \(name)") }
        }
    }

    static func json(_ value: Any) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: [value]), let s = String(data: data, encoding: .utf8) else { return "null" }
        return String(s.dropFirst().dropLast())
    }

    // MARK: the traffic lights

    /// The close, minimise and zoom buttons, in the middle of the page's 56 px
    /// bar rather than the 28 px title bar they come in. AppKit puts them back
    /// whenever it lays the title bar out again, so this runs after each of those.
    func layoutTrafficLights() {
        guard let window, !window.styleMask.contains(.fullScreen),
              let close = window.standardWindowButton(.closeButton),
              let titlebar = close.superview, let container = titlebar.superview else { return }
        let height = Self.barHeight
        var frame = container.frame
        frame.size.height = height
        frame.origin.y = window.frame.height - height
        container.frame = frame
        titlebar.frame = container.bounds
        let buttons: [NSWindow.ButtonType] = [.closeButton, .miniaturizeButton, .zoomButton]
        for (i, kind) in buttons.enumerated() {
            guard let b = window.standardWindowButton(kind) else { continue }
            b.setFrameOrigin(NSPoint(x: Self.lightsInset + CGFloat(i) * 20, y: ((height - b.frame.height) / 2).rounded()))
        }
    }

    func windowDidResize(_ notification: Notification) { layoutTrafficLights() }
    func windowDidEndLiveResize(_ notification: Notification) { layoutTrafficLights() }
    func windowDidExitFullScreen(_ notification: Notification) {
        layoutTrafficLights()
        tellFullScreen()
    }
    func windowDidEnterFullScreen(_ notification: Notification) { tellFullScreen() }

    /// In full screen the traffic lights are gone, and the page need not leave room for them.
    private func tellFullScreen() {
        let on = window?.styleMask.contains(.fullScreen) ?? false
        webView.evaluateJavaScript("document.documentElement.classList.toggle('moshe-fullscreen', \(on))", completionHandler: nil)
    }
    func windowDidBecomeKey(_ notification: Notification) { layoutTrafficLights() }
    func windowDidResignKey(_ notification: Notification) { layoutTrafficLights() }

    func windowWillClose(_ notification: Notification) {
        teardown()
        Self.all.removeAll { $0 === self }
    }

    // MARK: moving the window from the page's bars

    /// A press on an empty part of a bar (WindowMessages.script) moves the
    /// window, as a title bar would; two zoom it, or whatever System Settings →
    /// Desktop & Dock says a double-click on a title bar does.
    fileprivate func windowMessage(_ what: String) {
        guard let window, let down = webView.lastMouseDown,
              ProcessInfo.processInfo.systemUptime - down.timestamp < 1 else { return }
        switch what {
        case "drag":
            guard NSEvent.pressedMouseButtons & 1 == 1 else { return }
            window.performDrag(with: down)
            // The drag took the release, which WebKit is still waiting for.
            if NSEvent.pressedMouseButtons & 1 == 0,
               let up = NSEvent.mouseEvent(with: .leftMouseUp, location: window.mouseLocationOutsideOfEventStream,
                                           modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                           windowNumber: window.windowNumber, context: nil, eventNumber: 0,
                                           clickCount: 1, pressure: 0) {
                webView.mouseUp(with: up)
            }
        case "zoom":
            switch UserDefaults(suiteName: UserDefaults.globalDomain)?.string(forKey: "AppleActionOnDoubleClick") ?? "Maximize" {
            case "Minimize": window.miniaturize(nil)
            case "None": break
            default: window.zoom(nil)
            }
        default: break
        }
    }

    // MARK: WKNavigationDelegate

    /// The window only ever shows the app. A link anywhere else — in the text,
    /// ⌘-click on an address — opens in the browser.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        guard let target = action.request.url else { return decisionHandler(.allow) }
        // a frame inside the page (the export's preview, the print frame) is the page's business
        guard action.targetFrame?.isMainFrame ?? true else { return decisionHandler(.allow) }
        if Library.isOurs(target) || target.scheme == "about" { return decisionHandler(.allow) }
        if ["http", "https", "mailto"].contains(target.scheme?.lowercased() ?? "") { Outside.open(target) }
        // and a file dropped where the page did not take it is not opened in place of the app
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if window?.styleMask.contains(.fullScreen) == true { tellFullScreen() }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let e = error as NSError
        if e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled { return }
        NSLog("Moshe: could not open \(Library.startURL.absoluteString) — \(error.localizedDescription)")
        let where_ = Library.usesFolder ? "the app's own page" : (Library.server?.absoluteString ?? "the server")
        webView.loadHTMLString(Self.unreachable(where_, error.localizedDescription), baseURL: nil)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // WebKit's page process went away (memory, a crash): bring the page back
        NSLog("Moshe: the page's process ended; loading it again")
        webView.load(URLRequest(url: Library.startURL))
    }

    private static func unreachable(_ place: String, _ why: String) -> String {
        let esc = { (s: String) in s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;") }
        return """
        <!doctype html><meta charset="utf-8"><style>
        body{font:13px -apple-system,sans-serif;color:#555;display:flex;height:100vh;margin:0;align-items:center;justify-content:center;text-align:center}
        @media (prefers-color-scheme:dark){body{color:#bbb;background:#1e1e1e}}
        h1{font-size:17px;font-weight:600;color:inherit}
        </style><div><h1>Moshe could not open \(esc(place))</h1><p>\(esc(why))</p>
        <p>Choose a library folder or another server from the Moshe menu.</p></div>
        """
    }

    // MARK: WKUIDelegate

    /// window.open and target=_blank: the browser, or for the app's own pages another window.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let target = action.request.url {
            if Library.isOurs(target) { Self.open() } else if ["http", "https", "mailto"].contains(target.scheme?.lowercased() ?? "") {
                Outside.open(target)
            }
        }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        present(alert) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        present(alert) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable (String?) -> Void) {
        let alert = NSAlert()
        alert.messageText = prompt
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 300, height: 24))
        field.stringValue = defaultText ?? ""
        alert.accessoryView = field
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        alert.window.initialFirstResponder = field
        present(alert) { completionHandler($0 == .alertFirstButtonReturn ? field.stringValue : nil) }
    }

    /// <input type=file>: an image to put in a sheet, a file to import.
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        if let window { panel.beginSheetModal(for: window) { completionHandler($0 == .OK ? panel.urls : nil) } } else {
            completionHandler(panel.runModal() == .OK ? panel.urls : nil)
        }
    }

    private func present(_ alert: NSAlert, _ done: @escaping @MainActor (NSApplication.ModalResponse) -> Void) {
        if let window, window.isVisible, window.attachedSheet == nil {
            alert.beginSheetModal(for: window) { r in MainActor.assumeIsolated { done(r) } }
        } else {
            done(alert.runModal())
        }
    }
}

/// The page's bars tell the window where a press landed (WindowMessages.script).
/// Its own object, held weakly, so the web view's configuration, which keeps
/// its handlers, does not keep the window alive.
final class WindowMessages: NSObject, WKScriptMessageHandler {
    weak var owner: MosheWindowController?
    init(owner: MosheWindowController) { self.owner = owner }

    /// What the pages have asked, for the self-test.
    @MainActor static var received: [String] = []

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let what = message.body as? String else { return }
        MainActor.assumeIsolated {
            Self.received.append(what)
            owner?.windowMessage(what)
        }
    }

    /// A press on a bar (the strip across the top of each pane) that is not on
    /// a control moves the window; a second one zooms it.
    static let script = """
    (() => {
      const post = (m) => { try { window.webkit.messageHandlers.mosheWindow.postMessage(m); } catch (e) {} };
      const CONTROL = 'button, a, input, select, textarea, [contenteditable], [role=button], [role=menuitem], label, .capsule';
      window.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const t = e.target;
        if (!t || !t.closest || !t.closest('.bar') || t.closest(CONTROL)) return;
        post(e.detail >= 2 ? 'zoom' : 'drag');
      }, true);
    })();
    """
}

/// The page gets every shortcut first, so ⌘B reaches the editor and ⌘N the
/// app; a key the page leaves alone goes on to the menu, whose items call
/// the same commands (window.mosheCommand). Either way a command runs once.
/// Chords with ⌃ are the exception, and the shell's own keys (⌥⌘N New Window):
/// they go to the menu first, whatever the page would make of them.
final class ShellWebView: WKWebView {
    /// The last press, for a drag the page asks for a moment later.
    private(set) var lastMouseDown: NSEvent?

    override func mouseDown(with event: NSEvent) {
        lastMouseDown = event
        super.mouseDown(with: event)
    }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if event.modifierFlags.contains(.control) || Menus.takesFirst(event), NSApp.mainMenu?.performKeyEquivalent(with: event) == true {
            return true
        }
        return super.performKeyEquivalent(with: event)
    }

    /// Keys go to the page from the moment its window opens, so ⌘N works
    /// without clicking into the page first.
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        window?.makeFirstResponder(self)
    }

    /// The page's presses are the page's; moving the window is asked for.
    override var mouseDownCanMoveWindow: Bool { false }
}

/// The browser, for anything that is not the app. The self-test only notes it.
@MainActor
enum Outside {
    static var opened: [URL] = []
    static var testing: Bool { UserDefaults.standard.string(forKey: "SelfTestOut") != nil }

    static func open(_ url: URL) {
        opened.append(url)
        if !testing { NSWorkspace.shared.open(url) }
    }
}
