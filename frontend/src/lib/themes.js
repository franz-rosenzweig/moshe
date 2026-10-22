// Editor themes: the colours of the editor's text and tags, each in a light
// and a dark version. Moshe is app.css's own tokens; the rest change some of
// them. A theme is applied as CSS custom properties on the document
// (applyTheme). Extra themes (themes-exchange.js, empty unless the checkout
// has some of its own) come as the colours of a preview card; exchangeVars
// makes the rest.
import { EXCHANGE } from './themes-exchange.js';

const hidden = (bg) => ({ '--ed-tag': bg, '--ed-tag-h': bg, '--ed-link-tag': bg, '--ed-code-tag': bg, '--ed-comment-tag': bg });

export const THEMES = {
  Moshe: { name: 'Moshe', light: {}, dark: {} },
  'Moshe Mono': {
    name: 'Moshe Mono',
    light: { '--ed-quote': '#262626', '--ed-link': '#262626', '--ed-link-bg': 'rgba(0,0,0,0.05)', '--ed-comment': '#6b6b6b', '--ed-comment-block': '#6b6b6b', '--ed-comment-tag': '#d0d0d0', '--ed-comment-bg': '#f6f6f6', '--ed-divider': '#9a9a9a', '--ed-footnote': '#262626', '--ed-annot-border': '#bdbdbd', '--ed-annot-bg': '#f2f2f2', '--ed-annot-text': '#262626', '--ed-mark-bg': '#ececec', '--ed-mark-tag': '#bdbdbd' },
    dark: { '--ed-quote': '#dcdcdc', '--ed-link': '#dcdcdc', '--ed-link-bg': 'rgba(255,255,255,0.07)', '--ed-comment': '#9a9a9a', '--ed-comment-block': '#9a9a9a', '--ed-comment-bg': '#262626', '--ed-divider': '#777', '--ed-footnote': '#dcdcdc', '--ed-annot-border': '#555', '--ed-annot-bg': '#2c2c2c', '--ed-annot-text': '#dcdcdc', '--ed-mark-bg': '#333', '--ed-mark-tag': '#666' },
  },
  Classic: {
    name: 'Classic',
    light: { '--ed-tag': '#b9b9b9', '--ed-tag-h': '#c9c9c9', '--ed-link': '#1d6ed8', '--ed-quote': '#1d6ed8', '--ed-mark-bg': '#ffec8a' },
    dark: { '--ed-tag': '#5d5d5d', '--ed-tag-h': '#4a4a4a', '--ed-link': '#6ab0ff', '--ed-quote': '#6ab0ff', '--ed-mark-bg': '#5a4d12' },
  },
  'Blue Pencil': {
    name: 'Blue Pencil',
    light: { '--ed-tag': '#7fb2e5', '--ed-tag-h': '#2e8ae6', '--ed-link': '#2e8ae6', '--ed-quote': '#6f7f8f', '--ed-text': '#3a4450', '--ed-mark-bg': '#dcecfb', '--ed-mark-tag': '#2e8ae6', '--ed-comment': '#e0457b', '--ed-comment-block': '#e0457b' },
    dark: { '--ed-tag': '#3f6f9f', '--ed-tag-h': '#5aa5f0', '--ed-link': '#5aa5f0', '--ed-text': '#cfd8e2', '--ed-mark-bg': '#20374f', '--ed-mark-tag': '#5aa5f0' },
  },
  Simple: {
    name: 'Simple',
    light: { '--ed-tag': '#a3a3a3', '--ed-tag-h': '#a3a3a3', '--ed-link': '#262626', '--ed-link-bg': 'transparent', '--ed-quote': '#555', '--ed-mark-bg': '#fff4a8' },
    dark: { '--ed-tag': '#6c6c6c', '--ed-tag-h': '#6c6c6c', '--ed-link': '#dcdcdc', '--ed-link-bg': 'transparent', '--ed-quote': '#aaa', '--ed-mark-bg': '#4d4518' },
  },
  Solarized: {
    name: 'Solarized',
    light: { '--editor-bg': '#fdf6e3', '--ed-text': '#586e75', '--ed-tag': '#93a1a1', '--ed-tag-h': '#cb4b16', '--ed-link': '#268bd2', '--ed-link-bg': 'rgba(38,139,210,0.1)', '--ed-quote': '#2aa198', '--ed-mark-bg': '#eee8d5', '--ed-mark-tag': '#b58900', '--ed-comment': '#dc322f', '--ed-comment-block': '#dc322f', '--ed-comment-bg': '#fbeee0', '--ed-code-bg': '#eee8d5', '--ed-divider': '#cb4b16', '--ed-selection': '#e8dfc2', '--ed-line-marker': '#f5eedb' },
    dark: { '--editor-bg': '#002b36', '--ed-text': '#93a1a1', '--ed-tag': '#586e75', '--ed-tag-h': '#cb4b16', '--ed-link': '#268bd2', '--ed-link-bg': 'rgba(38,139,210,0.15)', '--ed-quote': '#2aa198', '--ed-mark-bg': '#073642', '--ed-mark-tag': '#b58900', '--ed-comment': '#dc322f', '--ed-comment-block': '#dc322f', '--ed-comment-bg': '#0a3440', '--ed-code-bg': '#073642', '--ed-divider': '#cb4b16', '--ed-selection': '#0d4a5a', '--ed-line-marker': '#04313d' },
  },
  Yosemite: {
    name: 'Yosemite',
    light: { '--ed-tag': '#c7c7cc', '--ed-tag-h': '#007aff', '--ed-link': '#007aff', '--ed-quote': '#8e8e93', '--ed-mark-bg': '#fff3b0', '--ed-comment': '#ff3b30', '--ed-comment-block': '#ff3b30' },
    dark: { '--ed-tag': '#48484a', '--ed-tag-h': '#0a84ff', '--ed-link': '#0a84ff', '--ed-quote': '#98989d', '--ed-mark-bg': '#4d4414' },
  },
  'Barely There': {
    name: 'Barely There',
    light: { '--ed-tag': '#eeeeee', '--ed-tag-h': '#f3f3f3', '--ed-link-tag': '#eeeeee', '--ed-code-tag': '#eeeeee', '--ed-comment-tag': '#f7e6da' },
    dark: { '--ed-tag': '#2a2a2b', '--ed-tag-h': '#262627', '--ed-link-tag': '#2a2a2b', '--ed-code-tag': '#2a2a2b', '--ed-comment-tag': '#3a2626' },
  },
  'No Tags': {
    name: 'No Tags',
    light: hidden('#ffffff'),
    dark: hidden('#1e1e1f'),
  },
};

// ---- colour arithmetic, for the extra themes' cards
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const hex = (c) => '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => hex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));
const lum = (h) => { const [r, g, b] = rgb(h).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
function hsl(h) {
  const [r, g, b] = rgb(h), max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(hue * 60 + 360) % 360, s, l];
}
function fromHsl([h, s, l]) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return hex([r + m, g + m, b + m]);
}
/** A colour's lightness turned over (light for dark), kept within lo…hi. */
const turn = (h, lo, hi) => { const [a, s, l] = hsl(h); return fromHsl([a, s, Math.min(hi, Math.max(lo, 1 - l))]); };

// What a card doesn't show (comments, annotations, footnotes, revisions)
// comes from Moshe's own colours, the light or the dark ones.
const LIGHT = { '--ed-divider': '#c20a2c', '--ed-annot-bg': '#fff0b2', '--ed-annot-border': '#ffcc00', '--ed-annot-text': '#4e4137', '--ed-comment': '#e0042d', '--ed-comment-block': '#c20a2c', '--ed-comment-tag': '#ffc9a3', '--ed-comment-bg': '#fffae5', '--ed-delete': '#c20a2c', '--ed-insert': '#2f8343', '--ed-footnote': '#155186', '--ed-footnote-bg': '#8ac8ff', '--ed-math': '#2f8343' };
const DARK = { '--ed-divider': '#d63b3d', '--ed-annot-bg': '#35301b', '--ed-annot-border': '#5d5115', '--ed-annot-text': '#f6de62', '--ed-comment': '#ff4244', '--ed-comment-block': '#ff4244', '--ed-comment-tag': '#5d2829', '--ed-comment-bg': '#342222', '--ed-delete': '#ff4244', '--ed-insert': '#33d158', '--ed-footnote': '#83c3f3', '--ed-footnote-bg': '#0b68ae', '--ed-math': '#33d158' };

/** A light card's colours made dark: grounds and fills darkened, ink lightened, hues kept. */
function darkened(p) {
  const fg = (c) => c && turn(c, 0.55, 0.9), fill = (c) => c && turn(c, 0.2, 0.3), line = (c) => c && turn(c, 0.3, 0.5);
  return {
    ...p, bg: turn(p.bg, 0.1, 0.14), text: turn(p.text, 0.8, 0.88), heading: fg(p.heading), headingBg: fill(p.headingBg),
    tagH: p.tagH && turn(p.tagH, 0.25, 0.5), tag: p.tag && turn(p.tag, 0.25, 0.5), em: fg(p.em), strong: fg(p.strong),
    markBg: fill(p.markBg), markBorder: line(p.markBorder), markText: fg(p.markText),
    linkBg: fill(p.linkBg), linkBorder: line(p.linkBorder), linkText: fg(p.linkText),
    codeBg: fill(p.codeBg), codeBorder: line(p.codeBorder), codeText: fg(p.codeText),
  };
}

/** The editor's colours for a theme card; a light card is darkened for the dark appearance. */
export function exchangeVars(card, dark) {
  const p = dark && lum(card.bg) > 0.2 ? darkened(card) : card;
  const isDark = lum(p.bg) < 0.2, none = 'transparent';
  const tag = p.tag || mix(p.bg, p.text, 0.35);
  return {
    ...(isDark ? DARK : LIGHT),
    '--editor-bg': p.bg, '--ed-text': p.text, '--ed-list-tag': p.text,
    '--ed-heading': p.heading || p.text, '--ed-heading-bg': p.headingBg || none,
    '--ed-tag-h': p.tagH || mix(p.bg, p.text, 0.2), '--ed-tag': tag, '--ed-link-tag': tag, '--ed-code-tag': tag, '--ed-mark-tag': tag,
    '--ed-em': p.em || p.text, '--ed-strong': p.strong || p.text, '--ed-quote': p.em || p.text,
    '--ed-mark-bg': p.markBg || none, '--ed-mark-border': p.markBorder || none, '--ed-mark-text': p.markText || p.text,
    '--ed-link': p.linkText || p.text, '--ed-link-bg': p.linkBg || none, '--ed-link-border': p.linkBorder || none, '--ed-link-deco': 'none',
    '--ed-code-bg': p.codeBg || none, '--ed-code-border': p.codeBorder || none, '--ed-code-text': p.codeText || p.text,
    '--ed-selection': mix(p.bg, p.heading || p.text, 0.28), '--ed-line-marker': mix(p.bg, p.text, 0.05),
  };
}

for (const card of EXCHANGE) {
  if (THEMES[card.name]) continue;
  THEMES[card.name] = { name: card.name, exchange: card, get light() { return exchangeVars(card, false); }, get dark() { return exchangeVars(card, true); } };
}
// ---- your own themes: copies of a theme, kept in the library's settings
// ('themes' in .moshe/library.json) so every device has them. The built-in
// ones are locked; a copy is how one is changed.
const BUILT_IN = Object.keys(THEMES);
/** Moshe's own themes, then the extra ones. */
export const OWN_THEMES = BUILT_IN.filter((t) => !THEMES[t].exchange);
export const EXCHANGE_THEMES = BUILT_IN.filter((t) => THEMES[t].exchange);
export const THEME_ORDER = BUILT_IN;
export const isLocked = (name) => BUILT_IN.includes(name);
let custom = [];
/** Your themes, from the library's settings: {name: {light, dark}}. */
export function setCustomThemes(map) {
  for (const n of custom) if (!isLocked(n)) delete THEMES[n];
  custom = [];
  for (const [name, t] of Object.entries(map || {})) {
    if (isLocked(name) || !t || typeof t !== 'object') continue;
    THEMES[name] = { name, custom: true, light: { ...(t.light || {}) }, dark: { ...(t.dark || {}) } };
    custom.push(name);
  }
}
export const customThemes = () => [...custom];
/** A theme's colours as plain maps, for a copy of it. */
export const copyOf = (name) => { const t = THEMES[name] || THEMES.Moshe; return { light: { ...t.light }, dark: { ...t.dark } }; };

// Moshe's colours, as app.css sets them: what a theme doesn't set.
export const BASE_LIGHT = {
  '--editor-bg': '#ffffff', '--ed-text': '#262626', '--ed-tag-h': '#e9e9e9', '--ed-tag': '#d4d4d4', '--ed-list-tag': '#262626', '--ed-divider': '#c20a2c',
  '--ed-quote': '#105fa4', '--ed-link': '#105fa4', '--ed-link-bg': 'rgba(184, 222, 255, 0.3)', '--ed-link-tag': '#d4d4d4', '--ed-mark-bg': '#fff1b8', '--ed-mark-tag': '#e9c43c',
  '--ed-annot-bg': '#fff0b2', '--ed-annot-border': '#ffcc00', '--ed-annot-text': '#4e4137', '--ed-comment': '#e0042d', '--ed-comment-block': '#c20a2c', '--ed-comment-tag': '#ffc9a3',
  '--ed-comment-bg': '#fffae5', '--ed-delete': '#c20a2c', '--ed-insert': '#2f8343', '--ed-code-bg': '#f4f4f4', '--ed-code-tag': '#cbcbcd', '--ed-footnote': '#155186',
  '--ed-footnote-bg': '#8ac8ff', '--ed-math': '#2f8343', '--ed-selection': '#fbe7ae', '--ed-line-marker': '#f5f5f5',
};
export const BASE_DARK = {
  '--editor-bg': '#1e1e1f', '--ed-text': '#dcdcdc', '--ed-tag-h': '#323232', '--ed-tag': '#474747', '--ed-list-tag': '#eaeaea', '--ed-divider': '#d63b3d',
  '--ed-quote': '#6aaee8', '--ed-link': '#83c3f3', '--ed-link-bg': 'rgba(16, 83, 134, 0.45)', '--ed-link-tag': '#474747', '--ed-mark-bg': '#4a4220', '--ed-mark-tag': '#8c7a2a',
  '--ed-annot-bg': '#35301b', '--ed-annot-border': '#5d5115', '--ed-annot-text': '#f6de62', '--ed-comment': '#ff4244', '--ed-comment-block': '#ff4244', '--ed-comment-tag': '#5d2829',
  '--ed-comment-bg': '#342222', '--ed-delete': '#ff4244', '--ed-insert': '#33d158', '--ed-code-bg': '#000000', '--ed-code-tag': '#848484', '--ed-footnote': '#83c3f3',
  '--ed-footnote-bg': '#0b68ae', '--ed-math': '#33d158', '--ed-selection': '#5c4b1d', '--ed-line-marker': '#262627',
};
/** A theme's colours over Moshe's, for the light or dark appearance: what the editor shows. */
export const resolvedVars = (name, dark) => ({ ...(dark ? BASE_DARK : BASE_LIGHT), ...(dark ? (THEMES[name] || THEMES.Moshe).dark : (THEMES[name] || THEMES.Moshe).light) });
/** A colour as #rrggbb for a colour well (rgba and short forms too), or null for none. */
export function asHex(c) {
  if (!c || c === 'transparent' || c === 'none') return null;
  if (/^#[0-9a-f]{6}$/iu.test(c)) return c.toLowerCase();
  if (/^#[0-9a-f]{3}$/iu.test(c)) return '#' + c.slice(1).split('').map((x) => x + x).join('').toLowerCase();
  const m = /^rgba?\(([^)]+)\)$/u.exec(c);
  if (m) { const [r, g, b, a = 1] = m[1].split(',').map(Number); if (a === 0) return null; return hex([r, g, b].map((v) => v / 255)); }
  return null;
}

let applied = [];
/** The theme's colours on the document, for the light or dark appearance in force. */
export function applyTheme(name, dark) {
  const t = THEMES[name] || THEMES.Moshe;
  const root = document.documentElement;
  for (const k of applied) root.style.removeProperty(k);
  const vars = dark ? t.dark : t.light;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  applied = Object.keys(vars);
}

/** A theme's sample colours, for its card in Settings. */
export function sample(name, dark = false) {
  const t = THEMES[name] || THEMES.Moshe;
  const base = dark
    ? { bg: '#1e1e1f', text: '#dcdcdc', tag: '#474747', h: '#323232', link: '#83c3f3', mark: '#4a4220', code: '#000' }
    : { bg: '#ffffff', text: '#262626', tag: '#d4d4d4', h: '#e9e9e9', link: '#105fa4', mark: '#fff1b8', code: '#f4f4f4' };
  const v = dark ? t.dark : t.light;
  const text = v['--ed-text'] || base.text;
  return {
    bg: v['--editor-bg'] || base.bg, text, tag: v['--ed-tag'] || base.tag,
    h: v['--ed-tag-h'] || base.h, heading: v['--ed-heading'] || text, headingBg: v['--ed-heading-bg'] || 'transparent',
    em: v['--ed-em'] || text, strong: v['--ed-strong'] || text,
    link: v['--ed-link'] || base.link, linkBg: v['--ed-link-bg'] || 'transparent', linkBorder: v['--ed-link-border'] || 'transparent', linkDeco: v['--ed-link-deco'] || 'underline',
    mark: v['--ed-mark-bg'] || base.mark, markText: v['--ed-mark-text'] || text,
    code: v['--ed-code-bg'] || base.code, codeText: v['--ed-code-text'] || text,
  };
}
