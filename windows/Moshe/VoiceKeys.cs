using System.Runtime.InteropServices;
using System.Text.Json.Nodes;

namespace Moshe;

/// <summary>
/// The voice keys from any app (docs/VOICE.md; the page's frontend/src/voice/keys.js).
/// The page says which keys it wants (<c>mosheShell.voiceKeys</c>), and they're
/// registered with Windows (RegisterHotKey), so a press reaches Moshe while another
/// app is in front: it brings Moshe forward and turns voice on, or starts listening.
/// Pressed in Moshe, it turns it off again. Windows hands a registered key to Moshe
/// alone, so the page never hears it twice. The Mac's is mac/Moshe/VoiceKeys.swift.
/// </summary>
static class VoiceKeys
{
    static readonly string[] Names = ["voice", "listen"];
    static readonly HashSet<string> held = [];
    static IntPtr window;
    static WndProc? proc;                   // kept, so the collector leaves Windows' callback alone

    /// <summary>The keys held now, for the self-test.</summary>
    public static IReadOnlyCollection<string> Holding => held;

    /// <summary>Hold the keys the page asks for, each window's menu showing its labels; which are held.</summary>
    public static JsonObject Set(JsonObject args)
    {
        Make();
        var result = new JsonObject();
        for (var i = 0; i < Names.Length; i++)
        {
            var name = Names[i];
            if (held.Remove(name)) UnregisterHotKey(window, i + 1);
            result[name] = false;
            if (window == IntPtr.Zero || Parse(J.Text(args[name])) is not { } key) continue;
            if (RegisterHotKey(window, i + 1, key.Mods | MOD_NOREPEAT, key.Vk))
            {
                held.Add(name);
                result[name] = true;
            }
            else Log.Write($"voice keys: Windows wouldn't give Moshe {J.Text(args[name])} (another app has it?)");
        }
        var labels = args["labels"] as JsonObject;
        foreach (var w in ShellWindow.All) w.VoiceKeys(J.Text(labels?["voice"]), J.Text(labels?["listen"]));
        return result;
    }

    /// <summary>A voice key pressed: in another app it brings Moshe forward and only ever switches on.</summary>
    static void Pressed(string name)
    {
        var front = GetForegroundWindow();
        var shell = ShellWindow.All.FirstOrDefault(w => w.Handle == front);
        var away = shell == null;
        shell ??= ShellWindow.All.LastOrDefault() ?? ShellWindow.Open();
        if (away) shell.BringForward();
        shell.Command(name, away ? JsonValue.Create("on") : null);
    }

    /// <summary>A window of Moshe's own, never shown, that Windows sends the keys to.</summary>
    static void Make()
    {
        if (window != IntPtr.Zero) return;
        proc = (hwnd, message, wParam, lParam) =>
        {
            var id = (int)wParam;
            if (message == WM_HOTKEY && id >= 1 && id <= Names.Length) Pressed(Names[id - 1]);
            return DefWindowProc(hwnd, message, wParam, lParam);
        };
        var instance = GetModuleHandle(null);
        var wc = new WNDCLASSEX
        {
            cbSize = (uint)Marshal.SizeOf<WNDCLASSEX>(),
            lpfnWndProc = Marshal.GetFunctionPointerForDelegate(proc),
            hInstance = instance,
            lpszClassName = "MosheVoiceKeys",
        };
        RegisterClassEx(ref wc);
        window = CreateWindowEx(0, "MosheVoiceKeys", "", 0, 0, 0, 0, 0, HWND_MESSAGE, IntPtr.Zero, instance, IntPtr.Zero);
        if (window == IntPtr.Zero) Log.Write($"voice keys: no window for them ({Marshal.GetLastWin32Error()})");
    }

    /// <summary>A key as the page writes it ("Ctrl+Alt+KeyL", "F6"): Windows' modifiers and virtual key.</summary>
    internal static (uint Mods, uint Vk)? Parse(string? spec)
    {
        if (string.IsNullOrEmpty(spec)) return null;
        var parts = spec.Split('+');
        uint mods = 0;
        foreach (var m in parts[..^1])
        {
            switch (m)
            {
                case "Ctrl": mods |= MOD_CONTROL; break;
                case "Alt": mods |= MOD_ALT; break;
                case "Shift": mods |= MOD_SHIFT; break;
                case "Meta": mods |= MOD_WIN; break;
                default: return null;
            }
        }
        var code = parts[^1];
        uint vk = 0;
        // where a key is on the keyboard (KeyboardEvent.code) is a scan code; Windows says which key is there in this layout
        if (Scan.TryGetValue(code, out var scan)) vk = MapVirtualKey(scan, MAPVK_VSC_TO_VK);
        else if (code.Length is 2 or 3 && code[0] == 'F' && int.TryParse(code[1..], out var n) && n >= 1 && n <= 24) vk = (uint)(0x70 + n - 1);
        else if (Virtual.TryGetValue(code, out var v)) vk = v;
        if (vk == 0) return null;
        return (mods, vk);
    }

    static readonly Dictionary<string, uint> Scan = Table(
        ("KeyQ", 0x10), ("KeyW", 0x11), ("KeyE", 0x12), ("KeyR", 0x13), ("KeyT", 0x14), ("KeyY", 0x15), ("KeyU", 0x16), ("KeyI", 0x17), ("KeyO", 0x18), ("KeyP", 0x19),
        ("KeyA", 0x1E), ("KeyS", 0x1F), ("KeyD", 0x20), ("KeyF", 0x21), ("KeyG", 0x22), ("KeyH", 0x23), ("KeyJ", 0x24), ("KeyK", 0x25), ("KeyL", 0x26),
        ("KeyZ", 0x2C), ("KeyX", 0x2D), ("KeyC", 0x2E), ("KeyV", 0x2F), ("KeyB", 0x30), ("KeyN", 0x31), ("KeyM", 0x32),
        ("Digit1", 0x02), ("Digit2", 0x03), ("Digit3", 0x04), ("Digit4", 0x05), ("Digit5", 0x06), ("Digit6", 0x07), ("Digit7", 0x08), ("Digit8", 0x09), ("Digit9", 0x0A), ("Digit0", 0x0B),
        ("Minus", 0x0C), ("Equal", 0x0D), ("BracketLeft", 0x1A), ("BracketRight", 0x1B), ("Semicolon", 0x27), ("Quote", 0x28), ("Backquote", 0x29),
        ("Backslash", 0x2B), ("Comma", 0x33), ("Period", 0x34), ("Slash", 0x35), ("Space", 0x39), ("Enter", 0x1C), ("Tab", 0x0F), ("Backspace", 0x0E));
    static readonly Dictionary<string, uint> Virtual = Table(
        ("Delete", 0x2E), ("Insert", 0x2D), ("Home", 0x24), ("End", 0x23), ("PageUp", 0x21), ("PageDown", 0x22),
        ("ArrowLeft", 0x25), ("ArrowUp", 0x26), ("ArrowRight", 0x27), ("ArrowDown", 0x28));
    static Dictionary<string, uint> Table(params (string, uint)[] pairs) => pairs.ToDictionary(p => p.Item1, p => p.Item2);

    const uint MOD_ALT = 1, MOD_CONTROL = 2, MOD_SHIFT = 4, MOD_WIN = 8, MOD_NOREPEAT = 0x4000;
    const uint WM_HOTKEY = 0x0312, MAPVK_VSC_TO_VK = 1;
    static readonly IntPtr HWND_MESSAGE = new(-3);

    delegate IntPtr WndProc(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct WNDCLASSEX
    {
        public uint cbSize, style;
        public IntPtr lpfnWndProc;
        public int cbClsExtra, cbWndExtra;
        public IntPtr hInstance, hIcon, hCursor, hbrBackground;
        public string? lpszMenuName;
        public string? lpszClassName;
        public IntPtr hIconSm;
    }

    [DllImport("user32.dll", SetLastError = true)] static extern bool RegisterHotKey(IntPtr hwnd, int id, uint modifiers, uint vk);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr hwnd, int id);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", EntryPoint = "MapVirtualKeyW")] static extern uint MapVirtualKey(uint code, uint mapType);
    [DllImport("user32.dll", EntryPoint = "RegisterClassExW", CharSet = CharSet.Unicode, SetLastError = true)] static extern ushort RegisterClassEx(ref WNDCLASSEX wc);
    [DllImport("user32.dll", EntryPoint = "CreateWindowExW", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateWindowEx(uint exStyle, string className, string windowName, uint style, int x, int y, int width, int height,
                                        IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
    [DllImport("user32.dll", EntryPoint = "DefWindowProcW")] static extern IntPtr DefWindowProc(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll", EntryPoint = "GetModuleHandleW", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandle(string? name);
}
