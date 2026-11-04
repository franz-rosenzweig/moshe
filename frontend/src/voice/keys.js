// The voice keys (docs/VOICE.md): one turns voice on and off, one starts and
// stops listening, each chosen in Settings › Voice. A key is written as its
// modifiers and the key's place on the keyboard (KeyboardEvent.code), so it is
// the same key in any layout: "Alt+Meta+KeyL" is ⌥⌘L, "F6" is F6 alone.
// The apps register them with the system too (mosheShell.voiceKeys), so they
// work while another app is in front.

export const MODS = ['Ctrl', 'Alt', 'Shift', 'Meta'];
export const onMac = () => typeof navigator !== 'undefined' && (/Mac|iPhone|iPad/u.test(navigator.platform) || /Macintosh/u.test(navigator.userAgent));

export const DEFAULTS = {
  mac: { voice: 'Alt+Shift+Meta+KeyL', listen: 'Alt+Meta+KeyL' },
  other: { voice: 'Ctrl+Alt+Shift+KeyL', listen: 'Ctrl+Alt+KeyL' },
};

const NAMED = {
  Space: 'Space', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/', Backquote: '`', Enter: 'Return', Tab: 'Tab', Backspace: 'Delete', Delete: 'Forward Delete',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Home: 'Home', End: 'End', PageUp: 'Page Up', PageDown: 'Page Down', Insert: 'Insert',
};
const fkey = (code) => /^F([1-9]|1[0-9]|2[0-4])$/u.test(code);
/** A key the apps can register: a letter, a digit, an F-key, or one of NAMED. */
export const known = (code) => /^Key[A-Z]$/u.test(code) || /^Digit[0-9]$/u.test(code) || fkey(code) || code in NAMED;

/** {mods, code} from a key's spec, or null. */
export function parse(spec) {
  if (typeof spec !== 'string' || !spec) return null;
  const parts = spec.split('+');
  const code = parts.pop();
  if (!known(code) || parts.some((m) => !MODS.includes(m))) return null;
  return { mods: MODS.filter((m) => parts.includes(m)), code };
}

/** The spec of a key pressed, or null for a modifier on its own (still being held for a chord). */
export function fromEvent(e) {
  if (!e.code || !known(e.code)) return null;
  const mods = MODS.filter((m) => e[`${m.toLowerCase()}Key`]);
  return [...mods, e.code].join('+');
}

/** Whether a key press is the key of a spec. */
export function matches(spec, e) {
  return !!spec && fromEvent(e) === spec && !(e.getModifierState && e.getModifierState('AltGraph'));
}

/** How a spec is shown: ⌥⌘L on a Mac, Ctrl+Alt+L elsewhere. */
export function label(spec, mac) {
  const k = parse(spec);
  if (!k) return 'None';
  const key = /^Key/u.test(k.code) ? k.code.slice(3) : /^Digit/u.test(k.code) ? k.code.slice(5) : NAMED[k.code] || k.code;
  if (mac) return [['Ctrl', '⌃'], ['Alt', '⌥'], ['Shift', '⇧'], ['Meta', '⌘']].filter(([m]) => k.mods.includes(m)).map(([, s]) => s).join('') + key;
  return [...k.mods.map((m) => (m === 'Meta' ? 'Win' : m)), key].join('+');
}

// keys every app needs for itself
const TAKEN = {
  mac: { 'Meta+KeyQ': 'Quit', 'Meta+KeyW': 'Close', 'Meta+KeyC': 'Copy', 'Meta+KeyV': 'Paste', 'Meta+KeyX': 'Cut', 'Meta+KeyZ': 'Undo', 'Meta+KeyA': 'Select All', 'Meta+KeyH': 'Hide', 'Meta+KeyM': 'Minimise', 'Meta+Tab': 'switching apps', 'Meta+Space': 'Spotlight', 'Ctrl+Space': 'the input source' },
  other: { 'Ctrl+KeyC': 'Copy', 'Ctrl+KeyV': 'Paste', 'Ctrl+KeyX': 'Cut', 'Ctrl+KeyZ': 'Undo', 'Ctrl+KeyY': 'Redo', 'Ctrl+KeyA': 'Select All', 'Ctrl+KeyW': 'Close', 'Alt+Tab': 'switching apps', 'Alt+F4': 'closing a window' },
};

/** Why a key can't be a voice key, or null if it can. Alone, a key would be typed
 *  (or move the cursor), so it needs ⌘ or ⌃ on a Mac (⌥ alone types letters there,
 *  and macOS won't give ⌥ alone to a key that works from any app), Ctrl or Alt
 *  elsewhere; an F-key can be alone. */
export function problem(spec, mac) {
  const k = parse(spec);
  if (!k) return 'Not a key Moshe can use';
  const taken = TAKEN[mac ? 'mac' : 'other'][spec];
  if (taken) return `${label(spec, mac)} is ${taken}`;
  if (fkey(k.code)) return null;
  if (mac ? !k.mods.includes('Meta') && !k.mods.includes('Ctrl') : !k.mods.includes('Ctrl') && !k.mods.includes('Alt')) {
    return mac ? 'Needs ⌘ or ⌃, or an F-key' : 'Needs Ctrl or Alt, or an F-key';
  }
  if (!mac && k.mods.includes('Meta')) return 'Windows keeps the Windows key for itself';
  return null;
}

/** The two keys as set, the defaults where nothing (or something unusable) is. */
export function voiceKeys(pref, mac) {
  const d = DEFAULTS[mac ? 'mac' : 'other'];
  const pick = (which) => {
    const v = pref && pref[which];
    if (v === '') return '';                                   // none: turned off
    return typeof v === 'string' && !problem(v, mac) ? v : d[which];
  };
  const keys = { voice: pick('voice'), listen: pick('listen') };
  if (keys.voice && keys.voice === keys.listen) keys.voice = d.voice === keys.listen ? d.listen : d.voice;
  return keys;
}
