// The handwriting page's tools (components/InkPage.svelte), as Samsung Notes
// has them: a pen of seven kinds, each remembering its own size, colour and
// opacity; a highlighter of its own; an eraser that takes whole strokes or
// just what it passes over; the lasso; favourite pens; the colours used last.
// They're the same on every page, and kept with the settings.
import { prefs, persist } from './state.svelte.js';
import { across, PEN_TYPES } from '@engine/ink.js';

/** The pens the pen tool writes with (the highlighter is a tool of its own). */
export const WRITING = ['fountain', 'calligraphy', 'pen', 'pencil', 'brush', 'marker'];

const PENS = {
  fountain: { size: 25, color: '#1e1e1e', opacity: 100 },
  calligraphy: { size: 35, color: '#1e1e1e', opacity: 100 },
  pen: { size: 20, color: '#1971c2', opacity: 100 },
  pencil: { size: 25, color: '#495057', opacity: 100 },
  brush: { size: 40, color: '#1e1e1e', opacity: 100 },
  marker: { size: 30, color: '#e03131', opacity: 100 },
  highlighter: { size: 40, color: '#ffd43b', opacity: 50 },
};

const saved = prefs.inkTools || {};
/** What's in hand, and how each pen is set. */
export const tools = $state({
  tool: saved.tool || 'pen',                  // pen | highlighter | eraser | lasso | text
  pen: PEN_TYPES[saved.pen] && saved.pen !== 'highlighter' ? saved.pen : 'fountain',
  pens: Object.fromEntries(Object.entries(PENS).map(([k, v]) => [k, { ...v, ...((saved.pens || {})[k] || {}) }])),
  eraser: { mode: 'area', size: 24, takes: 'all', ...(saved.eraser || {}) },   // mode: area | stroke; takes: all | pen | highlighter
  text: { size: 24, font: 'sans', color: '#1e1e1e', ...(saved.text || {}) },   // a new text box's: font size (page units), sans | hand
  favorites: saved.favorites || [],           // [{pen, size, color, opacity}]
  recent: saved.recent || ['#1e1e1e', '#1971c2', '#e03131'],
  fingers: !!saved.fingers,                   // fingers write (on a device with no pen)
  roundButton: saved.roundButton ?? true,     // the round menu's button in the corner
});

let timer = null;
/** The tools kept with the settings, a moment after they change. */
export function keep() {
  clearTimeout(timer);
  timer = setTimeout(() => { prefs.inkTools = JSON.parse(JSON.stringify(tools)); persist(); }, 400);
}

/** The pen in hand: its kind, colour, width (in page units) and opacity, or null for the eraser and lasso. */
export function brush() {
  const pen = tools.tool === 'highlighter' ? 'highlighter' : tools.tool === 'pen' ? tools.pen : null;
  if (!pen) return null;
  const p = tools.pens[pen];
  return { pen, color: p.color, width: across(pen, p.size), opacity: p.opacity };
}

/** The pen in hand set to a colour (and the colour remembered as used). */
export function setColor(color) {
  if (tools.tool === 'text') { tools.text.color = color; used(color); keep(); return; }
  const pen = tools.tool === 'highlighter' ? 'highlighter' : tools.pen;
  if (tools.tool !== 'highlighter') tools.tool = 'pen';
  tools.pens[pen].color = color;
  if (pen !== 'highlighter') used(color);
  keep();
}

/** A colour just written with goes to the front of the ones used last. */
export function used(color) {
  if (tools.recent[0] === color) return;
  tools.recent = [color, ...tools.recent.filter((c) => c !== color)].slice(0, 8);
  keep();
}

export function choose(tool, pen = null) {
  tools.tool = tool;
  if (pen && pen !== 'highlighter') tools.pen = pen;
  keep();
}

/** A favourite pen: the pen in hand as it's set now. */
export function addFavorite() {
  const b = brush();
  if (!b) return;
  const fav = { pen: b.pen, ...tools.pens[b.pen] };
  if (tools.favorites.some((f) => f.pen === fav.pen && f.size === fav.size && f.color === fav.color && f.opacity === fav.opacity)) return;
  tools.favorites = [...tools.favorites, fav].slice(-8);
  keep();
}
export function useFavorite(f) {
  tools.pens[f.pen] = { size: f.size, color: f.color, opacity: f.opacity };
  choose(f.pen === 'highlighter' ? 'highlighter' : 'pen', f.pen);
}
export function dropFavorite(i) { tools.favorites = tools.favorites.filter((_, j) => j !== i); keep(); }

/** What the lasso copied or cut, for pasting on this page or another. */
export const clipboard = $state({ items: null });

/** Black ink on a dark page is white, and white on a light one black: the pens in hand follow the page. */
export function suitPens(dark) {
  const from = dark ? '#1e1e1e' : '#ffffff', to = dark ? '#ffffff' : '#1e1e1e';
  let changed = false;
  for (const p of Object.values(tools.pens)) if (p.color === from) { p.color = to; changed = true; }
  for (const f of tools.favorites) if (f.color === from) { f.color = to; changed = true; }
  if (tools.text.color === from) { tools.text.color = to; changed = true; }
  if (tools.recent.includes(from)) { tools.recent = [...new Set(tools.recent.map((c) => (c === from ? to : c)))]; changed = true; }
  if (changed) keep();
}
