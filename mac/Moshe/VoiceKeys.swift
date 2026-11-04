import AppKit
import Carbon.HIToolbox

/// The voice keys from any app (docs/VOICE.md; the page's frontend/src/voice/keys.js).
/// The page says which keys it wants (`mosheShell.voiceKeys`), and they're
/// registered with the system, so a press reaches Moshe while another app is in
/// front: it brings Moshe forward and turns voice on, or starts listening. Pressed
/// in Moshe, it turns it off again. RegisterEventHotKey asks for no permission.
/// The View menu shows the same keys, so a key works there too when it isn't held.
@MainActor
enum VoiceKeys {
    private static var held: [String: EventHotKeyRef] = [:]
    private static var handler: EventHandlerRef?
    private static let names = ["voice", "listen"]

    /// The keys held now, for the self-test.
    static var holding: [String] { names.filter { held[$0] != nil } }

    /// Hold the keys the page asks for, the menu showing `menu`; which are held.
    static func set(_ args: [String: Any]) -> [String: Bool] {
        install()
        var out: [String: Bool] = [:]
        for (i, name) in names.enumerated() {
            if let ref = held.removeValue(forKey: name) { UnregisterEventHotKey(ref) }
            out[name] = false
            guard let spec = args[name] as? String, let key = Key(spec) else { continue }
            var ref: EventHotKeyRef?
            let id = EventHotKeyID(signature: 0x4D53_4845, id: UInt32(i + 1))    // "MSHE"
            if RegisterEventHotKey(key.code, key.carbon, id, GetApplicationEventTarget(), 0, &ref) == noErr, let ref {
                held[name] = ref
                out[name] = true
            }
        }
        let menu = args["menu"] as? [String: Any] ?? [:]
        Menus.voiceKeys(voice: (menu["voice"] as? String).flatMap(Key.init), listen: (menu["listen"] as? String).flatMap(Key.init))
        return out
    }

    private static func install() {
        guard handler == nil else { return }
        var type = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, event, _ in
            var id = EventHotKeyID()
            GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil,
                              MemoryLayout<EventHotKeyID>.size, nil, &id)
            let i = Int(id.id) - 1
            // the application's event target hears on the main thread
            MainActor.assumeIsolated { if VoiceKeys.names.indices.contains(i) { VoiceKeys.pressed(VoiceKeys.names[i]) } }
            return noErr
        }, 1, &type, nil, &handler)
    }

    /// A voice key pressed: in another app it brings Moshe forward and only ever switches on.
    static func pressed(_ name: String) {
        let away = !NSApp.isActive
        if away { NSApp.activate() }
        let c = MosheWindowController.front ?? MosheWindowController.open()
        if let w = c.window {
            if w.isMiniaturized { w.deminiaturize(nil) }
            w.makeKeyAndOrderFront(nil)
        }
        c.webView?.evaluateJavaScript("window.mosheCommand && window.mosheCommand('\(name)'\(away ? ", 'on'" : ""))", completionHandler: nil)
    }

    /// A key as the page writes it (keys.js): "Alt+Meta+KeyL", "F6".
    struct Key {
        let code: UInt32
        let flags: NSEvent.ModifierFlags
        let equivalent: String

        init?(_ spec: String) {
            var parts = spec.split(separator: "+").map(String.init)
            guard let last = parts.popLast(), let k = Self.keys[last] else { return nil }
            var f: NSEvent.ModifierFlags = []
            for m in parts {
                switch m {
                case "Ctrl": f.insert(.control)
                case "Alt": f.insert(.option)
                case "Shift": f.insert(.shift)
                case "Meta": f.insert(.command)
                default: return nil
                }
            }
            code = UInt32(k.0)
            flags = f
            equivalent = k.1
        }

        var carbon: UInt32 {
            (flags.contains(.command) ? UInt32(cmdKey) : 0) | (flags.contains(.option) ? UInt32(optionKey) : 0)
                | (flags.contains(.control) ? UInt32(controlKey) : 0) | (flags.contains(.shift) ? UInt32(shiftKey) : 0)
        }

        /// KeyboardEvent.code → the Mac's key code and a menu's key equivalent.
        static let keys: [String: (Int, String)] = {
            var k: [String: (Int, String)] = [:]
            let letters: [(String, Int)] = [("A", kVK_ANSI_A), ("B", kVK_ANSI_B), ("C", kVK_ANSI_C), ("D", kVK_ANSI_D), ("E", kVK_ANSI_E),
                ("F", kVK_ANSI_F), ("G", kVK_ANSI_G), ("H", kVK_ANSI_H), ("I", kVK_ANSI_I), ("J", kVK_ANSI_J), ("K", kVK_ANSI_K),
                ("L", kVK_ANSI_L), ("M", kVK_ANSI_M), ("N", kVK_ANSI_N), ("O", kVK_ANSI_O), ("P", kVK_ANSI_P), ("Q", kVK_ANSI_Q),
                ("R", kVK_ANSI_R), ("S", kVK_ANSI_S), ("T", kVK_ANSI_T), ("U", kVK_ANSI_U), ("V", kVK_ANSI_V), ("W", kVK_ANSI_W),
                ("X", kVK_ANSI_X), ("Y", kVK_ANSI_Y), ("Z", kVK_ANSI_Z)]
            for (l, c) in letters { k["Key" + l] = (c, l.lowercased()) }
            let digits = [kVK_ANSI_0, kVK_ANSI_1, kVK_ANSI_2, kVK_ANSI_3, kVK_ANSI_4, kVK_ANSI_5, kVK_ANSI_6, kVK_ANSI_7, kVK_ANSI_8, kVK_ANSI_9]
            for (n, c) in digits.enumerated() { k["Digit\(n)"] = (c, "\(n)") }
            let fkeys = [kVK_F1, kVK_F2, kVK_F3, kVK_F4, kVK_F5, kVK_F6, kVK_F7, kVK_F8, kVK_F9, kVK_F10,
                         kVK_F11, kVK_F12, kVK_F13, kVK_F14, kVK_F15, kVK_F16, kVK_F17, kVK_F18, kVK_F19, kVK_F20]
            for (n, c) in fkeys.enumerated() { k["F\(n + 1)"] = (c, String(Character(UnicodeScalar(NSF1FunctionKey + n)!))) }
            let f = { (u: Int) in String(Character(UnicodeScalar(u)!)) }
            let named: [String: (Int, String)] = [
                "Space": (kVK_Space, " "), "Minus": (kVK_ANSI_Minus, "-"), "Equal": (kVK_ANSI_Equal, "="),
                "BracketLeft": (kVK_ANSI_LeftBracket, "["), "BracketRight": (kVK_ANSI_RightBracket, "]"), "Backslash": (kVK_ANSI_Backslash, "\\"),
                "Semicolon": (kVK_ANSI_Semicolon, ";"), "Quote": (kVK_ANSI_Quote, "'"), "Comma": (kVK_ANSI_Comma, ","),
                "Period": (kVK_ANSI_Period, "."), "Slash": (kVK_ANSI_Slash, "/"), "Backquote": (kVK_ANSI_Grave, "`"),
                "Enter": (kVK_Return, "\r"), "Tab": (kVK_Tab, "\t"), "Backspace": (kVK_Delete, "\u{8}"), "Delete": (kVK_ForwardDelete, f(NSDeleteFunctionKey)),
                "ArrowUp": (kVK_UpArrow, f(NSUpArrowFunctionKey)), "ArrowDown": (kVK_DownArrow, f(NSDownArrowFunctionKey)),
                "ArrowLeft": (kVK_LeftArrow, f(NSLeftArrowFunctionKey)), "ArrowRight": (kVK_RightArrow, f(NSRightArrowFunctionKey)),
                "Home": (kVK_Home, f(NSHomeFunctionKey)), "End": (kVK_End, f(NSEndFunctionKey)),
                "PageUp": (kVK_PageUp, f(NSPageUpFunctionKey)), "PageDown": (kVK_PageDown, f(NSPageDownFunctionKey)), "Insert": (kVK_Help, f(NSHelpFunctionKey)),
            ]
            k.merge(named) { a, _ in a }
            return k
        }()
    }
}
