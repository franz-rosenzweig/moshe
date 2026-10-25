// Handwriting: a page of ink, kept as an Excalidraw drawing the way Obsidian's
// Excalidraw plugin keeps one, so the plugin opens and edits it too, and as an
// SVG picture of the page beside it, which any app shows.
//
// The drawing file (NAME.excalidraw.md) is Markdown: front matter, a line the
// plugin writes for anyone reading it as text, "# Excalidraw Data", and under
// "## Drawing" the scene's JSON, plain or LZ-compressed (the plugin compresses
// when it saves). Moshe writes it plain and, when the file is already there,
// changes only that block (and its own moshe-* front matter keys: the paper,
// its colour, the view), so whatever else the plugin put there stays.
//
// A stroke is the plugin's "freedraw" element, pressure and all; which of the
// pens drew it (fountain pen, calligraphy pen, pen, pencil, calligraphy brush,
// highlighter, marker) is in its customData, and each is drawn its own way.
// The fountain pen is drawn just as Excalidraw draws a freedraw element, so a
// page looks the same in the plugin. A text box is the plugin's "text"
// element, listed under "## Text Elements" too, as the plugin keeps it.
// Anything else drawn in the plugin (shapes, arrows, text inside a shape) is
// kept as it is, and drawn plainly in the picture.

import { compressToBase64, decompressFromBase64 } from './lzstring.js';
import { getStroke, getStrokePoints } from './freehand.js';
import { inside } from './pen.js';

/** The page: this many units wide; a page of the pages view is this tall, with a gap below. */
export const PAGE_WIDTH = 1000;
export const PAGE_HEIGHT = 1414;
export const PAGE_GAP = 28;
export const LINE = 40;
const TOP = 120;
const GRID = 32;
const CUE = 250;
export const PAPERS = ['lined', 'blank', 'dotted', 'grid', 'cornell'];
export const VIEWS = ['scroll', 'pages'];
export const PAPER_COLOR = '#fdfcf8';
/** The page colours to choose from: light ones, and dark ones for light ink. */
export const PAPER_COLORS = ['#ffffff', '#fdfcf8', '#fff6c9', '#f4efe3', '#e9eef3', '#3b352e', '#2b2b2b', '#1c2430'];

/** The pens, as Samsung Notes has them; Excalidraw draws them all as its own freedraw. */
export const PEN_TYPES = {
  fountain: { label: 'Fountain pen' },
  calligraphy: { label: 'Calligraphy pen' },
  pen: { label: 'Pen' },
  pencil: { label: 'Pencil' },
  brush: { label: 'Calligraphy brush' },
  highlighter: { label: 'Highlighter' },
  marker: { label: 'Marker' },
};

/** The colours to pick from (Excalidraw's own, and white for a dark page). */
export const COLORS = ['#1e1e1e', '#868e96', '#ffffff', '#e03131', '#f76707', '#f59f00', '#fcc419', '#2f9e44', '#12b886', '#1971c2', '#4dabf7', '#5f3dc4', '#ae3ec9', '#e64980', '#8d5524'];
export const HIGHLIGHTS = ['#ffd43b', '#8ce99a', '#74c0fc', '#faa2c1', '#ffc078', '#b197fc'];

/** A text box's fonts, as Excalidraw numbers them (2 Helvetica, 5 Excalifont), and as the page draws them. */
export const FONTS = {
  sans: { family: 2, css: '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' },
  hand: { family: 5, css: 'Excalifont, Virgil, "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive' },
};
export const LINE_HEIGHT = 1.25;
const RTL = /^[^\p{L}]*[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/u;
/** Does a text read right to left (its first letter Hebrew or Arabic)? */
export const rtl = (text) => RTL.test(String(text || ''));

/** How big a text is, near enough (the page measures it exactly, with its fonts). */
export function measureText(text, size) {
  const lines = String(text || '').split('\n');
  return { w: r2(Math.max(size * 0.6, ...lines.map((l) => l.length * size * 0.55))), h: r2(lines.length * size * LINE_HEIGHT) };
}

/** How wide a pen draws for a size from 1 to 100 (Samsung's scale), in page units. */
export function across(pen, size) {
  const v = Math.max(1, Math.min(100, size)) / 100;
  if (pen === 'highlighter') return 6 + v * 54;
  if (pen === 'marker' || pen === 'brush') return 1.5 + v * v * 48;
  return 0.6 + Math.pow(v, 1.5) * 30;
}

// Excalidraw draws a freedraw element strokeWidth × 4.25 across
const ACROSS = 4.25;

/** Is a colour dark (so the ink on it should be light)? */
export function isDark(hex) {
  const m = /^#?([0-9a-f]{6})$/iu.exec(String(hex || ''));
  if (!m) return false;
  const n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b < 110;
}

// ---- the file -------------------------------------------------------------------

const BANNER = "==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠== You can decompress Drawing data with the command palette: 'Decompress current Excalidraw file'. For more info check in plugin settings under 'Saving'";
const DRAWING = /(\n##? Drawing\n[^`]*```)(json|compressed-json)\n([\s\S]*?)```\n?/u;

/** An empty scene, as the plugin starts one. */
export function emptyScene() {
  return { type: 'excalidraw', version: 2, source: 'https://github.com/franz-rosenzweig/moshe', elements: [], appState: { gridSize: null, viewBackgroundColor: '#ffffff' }, files: {} };
}

const front = (t) => (t.startsWith('---') ? t.split(/\n---\s*\n/u)[0] : '');
const key = (fm, k) => { const m = new RegExp(`^${k}:\\s*(\\S+)\\s*$`, 'mu').exec(fm); return m ? m[1] : null; };

/** A drawing file read: its scene (empty if there's none yet) and its page: paper, colour, view, pages. */
export function readInkFile(text) {
  const t = String(text || '');
  const fm = front(t);
  const paper = PAPERS.includes(key(fm, 'moshe-paper')) ? key(fm, 'moshe-paper') : null;
  const color = /^#[0-9a-f]{6}$/iu.test(key(fm, 'moshe-color') || '') ? key(fm, 'moshe-color').toLowerCase() : null;
  const view = VIEWS.includes(key(fm, 'moshe-view')) ? key(fm, 'moshe-view') : null;
  const pages = Math.max(1, Number(key(fm, 'moshe-pages')) || 1);
  const out = (scene) => ({ scene, paper, color, view, pages });
  const m = DRAWING.exec(t);
  if (!m) return out(emptyScene());
  let json = m[3];
  if (m[2] === 'compressed-json') json = decompressFromBase64(json.replace(/[\r\n]/gu, '')) || '';
  try {
    const scene = JSON.parse(json.slice(0, json.lastIndexOf('}') + 1));
    return out(scene && Array.isArray(scene.elements) ? scene : emptyScene());
  } catch { return out(emptyScene()); }
}

/** The drawing file with this scene in it: a new one, or `prev` with only its drawing and Moshe's keys changed. */
export function writeInkFile(prev, scene, { paper = 'lined', color = null, view = null, pages = null } = {}) {
  const keys = { 'moshe-paper': paper, 'moshe-color': color, 'moshe-view': view, 'moshe-pages': pages && pages > 1 ? pages : null };
  const block = `\n## Drawing\n\`\`\`json\n${JSON.stringify(scene, null, '\t')}\n\`\`\`\n`;
  // the plugin lists every text with its element's id, and reads the text from here
  const texts = (scene.elements || []).filter((el) => el.type === 'text' && !el.isDeleted).map((el) => `${el.text ?? ''} ^${el.id}\n\n`).join('');
  if (prev && DRAWING.test(prev)) {
    let out = prev.replace(DRAWING, () => block);
    out = out.replace(/(^## Text Elements\n)([\s\S]*?)(?=^## |^%%)/mu, (m, head) => head + texts);
    for (const [k, v] of Object.entries(keys)) {
      const re = new RegExp(`^${k}:.*\\n?`, 'mu');
      if (v == null) out = out.replace(re, '');
      else if (re.test(out)) out = out.replace(re, `${k}: ${v}\n`);
      else out = out.replace(/^(---\n[\s\S]*?)(\n*---\n)/u, (m, head, end) => `${head}\n${k}: ${v}${end}`);
    }
    return out;
  }
  const extra = Object.entries(keys).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${v}`);
  return ['---', '', 'excalidraw-plugin: parsed', 'tags: [excalidraw]', ...extra, '', '---', BANNER, '', '',
    '# Excalidraw Data', '', '## Text Elements', texts + '%%', block.slice(1) + '%%', ''].join('\n');
}

/** What the plugin writes when it compresses (for tests, and for files Moshe reads). */
export function compressScene(scene) {
  const c = compressToBase64(JSON.stringify(scene));
  let out = '';
  for (let i = 0; i < c.length; i += 256) out += `${c.slice(i, i + 256)}\n\n`;
  return out.trim();
}

// ---- strokes and elements ------------------------------------------------------------

const rnd = () => Math.floor(Math.random() * 2 ** 31);
const newId = () => Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
const r2 = (n) => Math.round(n * 100) / 100;

/**
 * The page's ink: strokes, from the plugin's freedraw elements, and the
 * plugin's other elements, kept as they are.
 * @returns {({kind: 'stroke', id: string, pen: string, color: string, width: number, opacity: number, points: [number, number, number][], el?: object}
 *   | {kind: 'text', id: string, x: number, y: number, w: number, h: number, text: string, size: number, color: string, opacity: number, font: 'sans'|'hand', el?: object}
 *   | {kind: 'other', el: object})[]}  width: across, in page units; opacity: 0–100; size: the font's, in page units
 */
export function inkFromScene(scene) {
  return (scene.elements || []).map((el) => {
    if (el.type === 'text' && !el.isDeleted && !el.containerId) {
      return {
        kind: 'text', id: el.id, el, x: el.x, y: el.y, w: el.width, h: el.height, text: String(el.text ?? el.originalText ?? ''),
        size: el.fontSize || 20, color: el.strokeColor || COLORS[0], opacity: el.opacity ?? 100, font: el.fontFamily === 2 || el.fontFamily === 6 || el.fontFamily === 9 ? 'sans' : 'hand',
      };
    }
    if (el.type !== 'freedraw' || el.isDeleted || !Array.isArray(el.points)) return { kind: 'other', el };
    const pr = Array.isArray(el.pressures) && el.pressures.length === el.points.length && !el.simulatePressure ? el.pressures : null;
    const mine = el.customData && el.customData.moshe;
    const opacity = el.opacity ?? 100;
    return {
      kind: 'stroke', id: el.id, el,
      pen: mine && PEN_TYPES[mine.pen] ? mine.pen : opacity < 70 ? 'highlighter' : 'fountain',
      color: el.strokeColor || COLORS[0], opacity,
      width: (el.strokeWidth || 1) * ACROSS,
      points: el.points.map(([x, y], i) => [r2(el.x + x), r2(el.y + y), pr ? pr[i] : 0.5]),
    };
  });
}

/** A stroke as the plugin's freedraw element (the one it came from, if it's unchanged). */
function elementOf(s) {
  if (s.el) return s.el;
  const xs = s.points.map((p) => p[0]), ys = s.points.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  const points = s.points.map(([px, py]) => [r2(px - x), r2(py - y)]);
  return {
    id: s.id || newId(), type: 'freedraw', x: r2(x), y: r2(y), width: r2(Math.max(...xs) - x), height: r2(Math.max(...ys) - y), angle: 0,
    strokeColor: s.color, backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: r2(s.width / ACROSS), strokeStyle: 'solid',
    roughness: 0, opacity: Math.round(s.opacity ?? 100), groupIds: [], frameId: null, roundness: null, seed: rnd(), version: (s.version || 0) + 1, versionNonce: rnd(),
    isDeleted: false, boundElements: null, updated: Date.now(), link: null, locked: false,
    points, pressures: s.points.map((p) => r2(p[2] ?? 0.5)), simulatePressure: false, lastCommittedPoint: points[points.length - 1] || null,
    customData: { moshe: { pen: s.pen || 'fountain' } },
  };
}

/** A text box as the plugin's text element (the one it came from, if it's unchanged). */
function textElementOf(t) {
  if (t.el) return t.el;
  const { w, h } = t.w && t.h ? t : measureText(t.text, t.size);
  return {
    id: t.id || newId(), type: 'text', x: r2(t.x), y: r2(t.y), width: r2(w), height: r2(h), angle: 0,
    strokeColor: t.color, backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid', roughness: 0,
    opacity: Math.round(t.opacity ?? 100), groupIds: [], frameId: null, roundness: null, seed: rnd(), version: (t.version || 0) + 1, versionNonce: rnd(),
    isDeleted: false, boundElements: null, updated: Date.now(), link: null, locked: false,
    text: t.text, originalText: t.text, fontSize: r2(t.size), fontFamily: (FONTS[t.font] || FONTS.sans).family, textAlign: rtl(t.text) ? 'right' : 'left',
    verticalAlign: 'top', containerId: null, autoResize: true, lineHeight: LINE_HEIGHT,
  };
}

/** The scene with this ink in it (and the page's colour), the rest of `base` (the plugin's settings, files) as it was. */
export function sceneFromInk(items, base = emptyScene(), { color = null } = {}) {
  const appState = color ? { ...(base.appState || {}), viewBackgroundColor: color } : base.appState;
  return { ...base, appState, elements: items.map((it) => (it.kind === 'stroke' ? elementOf(it) : it.kind === 'text' ? textElementOf(it) : it.el)) };
}

// ---- drawing a stroke ---------------------------------------------------------------------

const sine = (t) => Math.sin((t * Math.PI) / 2);
const med = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const f2 = (n) => Math.round(n * 100) / 100;

/** An outline as an SVG path (Excalidraw's own way: quadratic curves through the midpoints). */
export function outlinePath(pts) {
  if (!pts.length) return '';
  let d = `M${f2(pts[0][0])} ${f2(pts[0][1])}Q`;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], m = med(a, b);
    d += `${f2(a[0])} ${f2(a[1])} ${f2(m[0])} ${f2(m[1])} `;
  }
  return `${d.trim()}Z`;
}

// each pen's feel: how much the pressure thins it, how smooth, how it starts and ends
const FEEL = {
  fountain: (w) => ({ size: w, thinning: 0.6, smoothing: 0.5, streamline: 0.5, easing: sine }),
  pen: (w) => ({ size: w, thinning: 0.18, smoothing: 0.6, streamline: 0.5 }),
  pencil: (w) => ({ size: w, thinning: 0.45, smoothing: 0.5, streamline: 0.45 }),
  brush: (w) => ({ size: w, thinning: 0.85, smoothing: 0.7, streamline: 0.55, easing: sine, start: { taper: w * 2.5 }, end: { taper: w * 3.5 } }),
  marker: (w) => ({ size: w, thinning: 0, smoothing: 0.6, streamline: 0.5 }),
  highlighter: (w) => ({ size: w, thinning: 0, smoothing: 0.6, streamline: 0.6, start: { cap: false }, end: { cap: false } }),
};

/** A polygon turned to go round clockwise (on the page, y down), so pieces that overlap add up and leave no holes. */
function clockwise(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] - poly[i][0]) * (poly[j][1] + poly[i][1]);
  return a < 0 ? poly.slice().reverse() : poly;
}

/** A calligraphy pen: a flat nib held at 45°, so the line is broad one way and fine the other. */
function nibPath(s) {
  const pts = getStrokePoints(s.points, { size: s.width, streamline: 0.5, smoothing: 0.5, last: true });
  // and a hairline along the middle, so the thin strokes never vanish
  const hair = outlinePath(clockwise(getStroke(s.points, { size: Math.max(0.8, s.width * 0.14), thinning: 0, smoothing: 0.5, streamline: 0.5, last: true })));
  if (pts.length < 2) return hair;
  const a = -Math.PI / 4, ux = Math.cos(a), uy = Math.sin(a);
  // the ribbon the nib leaves, in pieces wherever the pen turns across the nib (where the ribbon would twist)
  const pieces = [];
  let L = [], R = [], side = 0;
  for (const p of pts) {
    const half = (s.width * (0.55 + 0.65 * (p.pressure ?? 0.5))) / 2;
    const l = [p.point[0] + ux * half, p.point[1] + uy * half], r = [p.point[0] - ux * half, p.point[1] - uy * half];
    const turn = Math.sign(p.vector[0] * uy - p.vector[1] * ux);
    if (turn && side && turn !== side) { L.push(l); R.push(r); pieces.push([...L, ...R.reverse()]); L = []; R = []; }
    if (turn) side = turn;
    L.push(l); R.push(r);
  }
  if (L.length > 1) pieces.push([...L, ...R.reverse()]);
  return pieces.map((poly) => outlinePath(clockwise(poly))).join('') + hair;
}

/** The shape a stroke fills: an SVG path's d. */
export function strokePath(s) {
  if (!s.points || !s.points.length) return '';
  if (s.pen === 'calligraphy') return nibPath(s);
  const feel = (FEEL[s.pen] || FEEL.fountain)(s.width);
  return outlinePath(getStroke(s.points, { ...feel, simulatePressure: false, last: true }));
}

/** How a stroke is painted: its colour, how see-through, and whether it's the pencil's grain or the highlighter's ink. */
export function paintOf(s) {
  const pen = s.pen || 'fountain';
  const op = (s.opacity ?? 100) / 100 * (pen === 'pencil' ? 0.9 : 1);
  return { color: s.color, opacity: Math.max(0.05, Math.min(1, op)), grain: pen === 'pencil', highlight: pen === 'highlighter' };
}

// ---- choosing and changing strokes ---------------------------------------------------------

/** Strokes' and text boxes' bounds, the strokes' width included. */
export function boundsOf(items) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const it of items) {
    if (it.kind === 'text') { x0 = Math.min(x0, it.x); y0 = Math.min(y0, it.y); x1 = Math.max(x1, it.x + it.w); y1 = Math.max(y1, it.y + it.h); continue; }
    if (it.kind !== 'stroke') continue;
    const r = it.width / 2;
    for (const [x, y] of it.points) { x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r); }
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}

/** The strokes a lasso goes round (most of their points inside it), and the text boxes (their middle inside it). */
export function lassoed(items, loop) {
  if (!loop || loop.length < 3) return [];
  const poly = loop.map(([x, y]) => ({ x, y }));
  return items.filter((it) => (it.kind === 'text' ? inside(poly, it.x + it.w / 2, it.y + it.h / 2)
    : it.kind === 'stroke' && it.points.filter(([x, y]) => inside(poly, x, y)).length >= it.points.length * 0.6));
}

/** Strokes and text boxes moved and resized: x' = a·x + c, y' = d·y + f (a line's width and a text's size scale with them). */
export function transformed(items, { a = 1, d = 1, c = 0, f = 0 }) {
  const k = Math.sqrt(Math.abs(a * d)) || 1;
  return items.map((it) => (it.kind === 'text' ? {
    ...it, el: undefined, version: (it.el && it.el.version) || 0, id: it.id || (it.el && it.el.id),
    x: r2(a * it.x + c), y: r2(d * it.y + f), w: r2(it.w * k), h: r2(it.h * k), size: r2(it.size * k),
  } : it.kind !== 'stroke' ? it : {
    ...it, el: undefined, version: (it.el && it.el.version) || 0, id: it.id || (it.el && it.el.id),
    width: it.width * k, points: it.points.map(([x, y, p]) => [r2(a * x + c), r2(d * y + f), p]),
  }));
}

/** A stroke anywhere near (x, y): within r of it. */
export function touches(it, x, y, r) {
  return it.kind === 'stroke' && it.points.some(([px, py]) => Math.hypot(px - x, py - y) <= r + it.width / 2);
}

/** The area eraser: what's within r of (x, y) taken out of the strokes, which break where it passed. */
export function eraseArea(items, x, y, r) {
  let changed = false;
  const out = [];
  for (const it of items) {
    if (!touches(it, x, y, r)) { out.push(it); continue; }
    changed = true;
    let run = [];
    const flush = () => { if (run.length >= 2) out.push({ ...it, el: undefined, id: undefined, points: run }); run = []; };
    for (const p of it.points) { if (Math.hypot(p[0] - x, p[1] - y) <= r + it.width / 2) flush(); else run.push(p); }
    flush();
  }
  return changed ? out : items;
}

/** Copies of strokes and text boxes, as new ones (for paste and duplicate). */
export function copies(items, dx = 0, dy = 0) {
  return items.filter((it) => it.kind === 'stroke' || it.kind === 'text').map((it) => (it.kind === 'text'
    ? { ...it, el: undefined, id: undefined, x: r2(it.x + dx), y: r2(it.y + dy) }
    : { ...it, el: undefined, id: undefined, points: it.points.map(([x, y, p]) => [r2(x + dx), r2(y + dy), p]) }));
}

// ---- shapes: a stroke held still at its end, made clean ----------------------------------

/** Ramer–Douglas–Peucker: the corners of a line, those more than eps off the straight between their neighbours. */
function corners(pts, eps) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
  let far = 0, at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = len ? Math.abs(dy * pts[i][0] - dx * pts[i][1] + b[0] * a[1] - b[1] * a[0]) / len : Math.hypot(pts[i][0] - a[0], pts[i][1] - a[1]);
    if (d > far) { far = d; at = i; }
  }
  if (far <= eps) return [a, b];
  return [...corners(pts.slice(0, at + 1), eps).slice(0, -1), ...corners(pts.slice(at), eps)];
}

/** Points along straight lines through the corners, closely spaced, a corner held a moment (so it stays sharp). */
function along(vertices, p, step = 6) {
  const out = [];
  for (let i = 0; i < vertices.length - 1; i++) {
    const [a, b] = [vertices[i], vertices[i + 1]];
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    out.push([r2(a[0]), r2(a[1]), p], [r2(a[0]), r2(a[1]), p]);
    for (let j = 1; j < n; j++) out.push([r2(a[0] + ((b[0] - a[0]) * j) / n), r2(a[1] + ((b[1] - a[1]) * j) / n), p]);
  }
  const z = vertices[vertices.length - 1];
  out.push([r2(z[0]), r2(z[1]), p], [r2(z[0]), r2(z[1]), p]);
  return out;
}

/** A line made level or upright when it's nearly so. */
function level(a, b) {
  const an = Math.atan2(b[1] - a[1], b[0] - a[0]), deg = ((an * 180) / Math.PI + 360) % 180;
  if (deg < 7 || deg > 173) return [a, [b[0], a[1]]];
  if (Math.abs(deg - 90) < 7) return [a, [a[0], b[1]]];
  return [a, b];
}

/**
 * A rough shape drawn and held made clean: a line, a triangle, a rectangle (or any
 * four-sided shape), a circle or an ellipse. → its points, as a stroke's, or null
 * when the stroke is none of them (handwriting stays as it is).
 */
export function snapShape(points) {
  if (!points || points.length < 4) return null;
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  const xs = points.map((q) => q[0]), ys = points.map((q) => q[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const diag = Math.hypot(x1 - x0, y1 - y0);
  if (diag < 24) return null;
  const p = r2(points.reduce((t, q) => t + (q[2] ?? 0.5), 0) / points.length);
  const first = points[0], last = points[points.length - 1];
  const gap = Math.hypot(last[0] - first[0], last[1] - first[1]);
  if (gap / len > 0.9) return along(level(first, last), p);
  if (gap > Math.max(0.3 * diag, 0.18 * len)) return null;            // open, and not straight: writing
  // closed: how many corners?
  const c = corners([...points, first], diag * 0.08);
  const v = c.slice(0, -1).filter((q, i, all) => i === 0 || Math.hypot(q[0] - all[i - 1][0], q[1] - all[i - 1][1]) > diag * 0.12);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
  // how far the stroke keeps from the ellipse in its box
  const off = points.reduce((t, q) => t + Math.abs(Math.hypot((q[0] - cx) / (rx || 1), (q[1] - cy) / (ry || 1)) - 1), 0) / points.length;
  if (off < 0.12 && (v.length > 4 || v.length < 3 || off < 0.06)) {
    const round = Math.abs(rx - ry) < 0.12 * Math.max(rx, ry), r = (rx + ry) / 2;
    const n = Math.max(32, Math.round((Math.PI * (rx + ry)) / 6));
    const start = Math.atan2(first[1] - cy, first[0] - cx);
    return Array.from({ length: n + 1 }, (_, i) => {
      const a = start + (i / n) * 2 * Math.PI;
      return [r2(cx + (round ? r : rx) * Math.cos(a)), r2(cy + (round ? r : ry) * Math.sin(a)), p];
    });
  }
  if (v.length === 3) return along([...v, v[0]], p);
  if (v.length === 4) {
    // a rectangle when its sides are nearly level and upright, else the four-sided shape as drawn
    const square = v.every((q, i) => { const n = v[(i + 1) % 4], d = ((Math.atan2(n[1] - q[1], n[0] - q[0]) * 180) / Math.PI + 360) % 90; return d < 12 || d > 78; });
    const quad = square ? [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] : v;
    const k = square ? quad.reduce((best, q, i) => (Math.hypot(q[0] - first[0], q[1] - first[1]) < Math.hypot(quad[best][0] - first[0], quad[best][1] - first[1]) ? i : best), 0) : 0;
    const ring = [...quad.slice(k), ...quad.slice(0, k)];
    return along([...ring, ring[0]], p);
  }
  return null;
}

// ---- the picture -----------------------------------------------------------------------

/** How far down the ink goes (the page is at least a page long). */
export function pageHeight(items, min = PAGE_HEIGHT) {
  let bottom = 0;
  for (const it of items) {
    if (it.kind === 'stroke') for (const p of it.points) bottom = Math.max(bottom, p[1]);
    else if (it.kind === 'text') bottom = Math.max(bottom, it.y + it.h);
    else if (!it.el.isDeleted) bottom = Math.max(bottom, (it.el.y || 0) + (it.el.height || 0));
  }
  return Math.max(min, Math.ceil(bottom + 160));
}

/** How many pages the pages view shows: as many as the ink reaches, and at least `pages`. */
export function pagesFor(items, pages = 1) {
  const bottom = pageHeight(items, 0) - 160;
  return Math.max(pages, Math.ceil((bottom + 1) / (PAGE_HEIGHT + PAGE_GAP)), 1);
}

const esc = (s) => String(s).replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');

/** The paper, as SVG: its colour, its ruling, and in the pages view the pages one under another. */
export function paperSvg(paper, w, h, { color = PAPER_COLOR, view = 'scroll', pages = 1, weight = 1 } = {}) {
  const dark = isDark(color);
  const rule = dark ? 'rgba(255,255,255,0.13)' : '#d6dfe9', dot = dark ? 'rgba(255,255,255,0.22)' : '#c3ccd6';
  const sheets = view === 'pages'
    ? Array.from({ length: pages }, (_, i) => [i * (PAGE_HEIGHT + PAGE_GAP), PAGE_HEIGHT])
    : [[0, h]];
  let out = '';
  if (paper === 'dotted') out += `<defs><pattern id="dots" width="${GRID}" height="${GRID}" patternUnits="userSpaceOnUse"><circle cx="${GRID / 2}" cy="${GRID / 2}" r="${1.3 * Math.min(weight, 8)}" fill="${dot}"/></pattern></defs>`;
  for (const [top, height] of sheets) {
    out += `<rect y="${top}" width="${w}" height="${height}" fill="${color}"/>`;
    let d = '';
    if (paper === 'lined' || paper === 'cornell') for (let y = top + TOP; y < top + height; y += LINE) d += `M0 ${y}H${w}`;
    // Cornell: a column on the left for cues, and a box at the foot of each page for the summary
    if (paper === 'cornell' && view === 'pages') d += `M0 ${top + height - 260}H${w}`;
    if (paper === 'grid') { for (let y = top + GRID; y < top + height; y += GRID) d += `M0 ${y}H${w}`; for (let x = GRID; x < w; x += GRID) d += `M${x} ${top}V${top + height}`; }
    if (d) out += `<path d="${d}" stroke="${rule}" stroke-width="${weight}" fill="none"/>`;
    if (paper === 'cornell') out += `<path d="M${CUE} ${top + TOP - LINE}V${top + height - (view === 'pages' ? 260 : 0)}" stroke="${dark ? 'rgba(255,120,120,0.35)' : '#efb4b4'}" stroke-width="${1.5 * weight}" fill="none"/>`;
    if (paper === 'dotted') out += `<rect y="${top}" width="${w}" height="${height}" fill="url(#dots)"/>`;
  }
  return out;
}

/** The pencil's grain: the stroke's own alpha, roughened. */
export const GRAIN = '<filter id="grain" x="0" y="0" width="1" height="1"><feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="2" seed="3"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.4 2"/><feComposite in="SourceGraphic" operator="in"/></filter>';

/** A stroke as SVG (the highlighter's are drawn in layers: layersOf). */
export function strokeSvg(it) {
  const p = paintOf(it);
  const d = strokePath(it);
  if (!d) return '';
  return `<path d="${d}" fill="${esc(p.color)}"${p.opacity < 1 ? ` fill-opacity="${r2(p.opacity)}"` : ''}${p.grain ? ' filter="url(#grain)"' : ''}/>`;
}

/** What the plugin drew besides strokes, plainly: shapes, lines and arrows, text. */
function otherSvg(el) {
  if (el.isDeleted || el.type === 'freedraw') return '';
  const s = esc(el.strokeColor || '#1e1e1e'), w = el.strokeWidth || 1, op = (el.opacity ?? 100) / 100;
  const fill = el.backgroundColor && el.backgroundColor !== 'transparent' ? esc(el.backgroundColor) : 'none';
  const g = (inner) => `<g opacity="${op}" transform="translate(${r2(el.x)} ${r2(el.y)})${el.angle ? ` rotate(${r2((el.angle * 180) / Math.PI)} ${r2(el.width / 2)} ${r2(el.height / 2)})` : ''}">${inner}</g>`;
  switch (el.type) {
    case 'rectangle': return g(`<rect width="${r2(el.width)}" height="${r2(el.height)}" rx="${el.roundness ? 8 : 0}" stroke="${s}" stroke-width="${w}" fill="${fill}"/>`);
    case 'ellipse': return g(`<ellipse cx="${r2(el.width / 2)}" cy="${r2(el.height / 2)}" rx="${r2(el.width / 2)}" ry="${r2(el.height / 2)}" stroke="${s}" stroke-width="${w}" fill="${fill}"/>`);
    case 'diamond': return g(`<path d="M${r2(el.width / 2)} 0L${r2(el.width)} ${r2(el.height / 2)}L${r2(el.width / 2)} ${r2(el.height)}L0 ${r2(el.height / 2)}Z" stroke="${s}" stroke-width="${w}" fill="${fill}"/>`);
    case 'line': case 'arrow': {
      const pts = el.points || [];
      if (pts.length < 2) return '';
      let d = `M${pts.map(([x, y]) => `${r2(x)} ${r2(y)}`).join('L')}`;
      if (el.type === 'arrow' && el.endArrowhead !== null) {
        const [x2, y2] = pts[pts.length - 1], [x1, y1] = pts[pts.length - 2];
        const an = Math.atan2(y2 - y1, x2 - x1), l = 10 + 2 * w;
        d += `M${r2(x2 - l * Math.cos(an - 0.45))} ${r2(y2 - l * Math.sin(an - 0.45))}L${r2(x2)} ${r2(y2)}L${r2(x2 - l * Math.cos(an + 0.45))} ${r2(y2 - l * Math.sin(an + 0.45))}`;
      }
      return g(`<path d="${d}" stroke="${s}" stroke-width="${w}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
    case 'text': {
      const size = el.fontSize || 20, lines = String(el.text || '').split('\n');
      return g(`<text font-family="Virgil, Segoe Print, Bradley Hand, cursive" font-size="${size}" fill="${s}">${lines.map((t, i) => `<tspan x="0" dy="${i ? size * 1.25 : size}">${esc(t)}</tspan>`).join('')}</text>`);
    }
    default: return '';
  }
}

/** A text box as SVG: its lines from the top, a right-to-left text against its right edge. */
export function textSvg(t) {
  const r = rtl(t.text), font = (FONTS[t.font] || FONTS.sans).css.replace(/"/gu, "'");
  const x = r ? t.x + t.w : t.x;
  const lines = String(t.text).split('\n');
  return `<text x="${r2(x)}" y="${r2(t.y)}" font-family="${font}" font-size="${r2(t.size)}" fill="${esc(t.color)}"${(t.opacity ?? 100) < 100 ? ` fill-opacity="${r2(t.opacity / 100)}"` : ''}${r ? ' direction="rtl" text-anchor="end"' : ''}>`
    + lines.map((l, i) => `<tspan x="${r2(x)}" dy="${r2(i ? t.size * LINE_HEIGHT : t.size)}">${esc(l) || ' '}</tspan>`).join('') + '</text>';
}

/** Anything the plugin drew besides strokes, as SVG (for the page as it's written on, too). */
export const othersSvg = (items) => items.filter((it) => it.kind === 'other').map((it) => otherSvg(it.el)).join('');

/** The page's full height for its view. */
export function pageSize(items, { view = 'scroll', pages = 1, minHeight = 0 } = {}) {
  if (view === 'pages') { const n = pagesFor(items, pages); return { h: n * (PAGE_HEIGHT + PAGE_GAP) - PAGE_GAP, pages: n }; }
  return { h: Math.max(pageHeight(items), Math.ceil(minHeight)), pages: 1 };
}

/**
 * The ink in the order it's drawn: the highlighter first, under the writing, each
 * colour as one layer (so where its strokes cross it's no darker, and the
 * writing on top is never dimmed), and then everything else as it came.
 * @returns {{highlights: {key: string, color: string, opacity: number, items: object[]}[], rest: object[]}}
 */
export function layersOf(items) {
  const groups = new Map(), rest = [];
  for (const it of items) {
    if (it.kind !== 'stroke' || it.pen !== 'highlighter') { rest.push(it); continue; }
    const p = paintOf(it), key = `${p.color}|${r2(p.opacity)}`;
    if (!groups.has(key)) groups.set(key, { key, color: p.color, opacity: p.opacity, items: [] });
    groups.get(key).items.push(it);
  }
  return { highlights: [...groups.values()], rest };
}

/** The page as an SVG picture: the paper, the highlighter, then the rest of the ink in the order it was drawn. */
export function inkSvg(items, { paper = 'lined', color = PAPER_COLOR, view = 'scroll', pages = 1, minHeight = 0 } = {}) {
  const w = PAGE_WIDTH, { h, pages: n } = pageSize(items, { view, pages, minHeight });
  const dark = isDark(color);
  const { highlights, rest } = layersOf(items);
  const hl = highlights.map((g) => `<g opacity="${r2(g.opacity)}" style="mix-blend-mode:${dark ? 'screen' : 'multiply'}">${g.items.map((it) => `<path d="${strokePath(it)}" fill="${esc(g.color)}"/>`).join('')}</g>`).join('\n');
  const body = rest.map((it) => (it.kind === 'stroke' ? strokeSvg(it) : it.kind === 'text' ? textSvg(it) : otherSvg(it.el))).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n<defs>${GRAIN}</defs>\n${paperSvg(paper, w, h, { color, view, pages: n })}\n${hl}${hl ? '\n' : ''}${body}\n</svg>\n`;
}
