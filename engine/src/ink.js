// Handwriting: a page of ink, kept as an Excalidraw drawing the way Obsidian's
// Excalidraw plugin keeps one, so the plugin opens and edits it too, and as an
// SVG picture of the page beside it, which any app shows.
//
// The drawing file (NAME.excalidraw.md) is Markdown: front matter, a line the
// plugin writes for anyone reading it as text, "# Excalidraw Data", and under
// "## Drawing" the scene's JSON, plain or LZ-compressed (the plugin compresses
// when it saves). Moshe writes it plain and, when the file is already there,
// changes only that block (and its own front matter key, moshe-paper), so
// whatever else the plugin put there stays. A Moshe stroke is the plugin's
// "freedraw" element, pressure and all; anything else drawn in the plugin
// (shapes, arrows, text) is kept as it is, and drawn plainly in the picture.

import { compressToBase64, decompressFromBase64 } from './lzstring.js';
import { strokeShape } from './sketch.js';

/** The page: this many units wide, ruled every LINE units below a top margin. */
export const PAGE_WIDTH = 1000;
export const LINE = 40;
const TOP = 120;
const GRID = 32;
export const PAPERS = ['lined', 'blank', 'dotted', 'grid'];
export const PAPER_COLOR = '#fdfcf8';
const RULE_COLOR = '#d6dfe9';

/** The pens: Excalidraw's own colours, so the strokes look at home in the plugin. */
export const PENS = {
  ink: { color: '#1e1e1e', label: 'Ink' },
  blue: { color: '#1971c2', label: 'Blue' },
  red: { color: '#e03131', label: 'Red' },
  green: { color: '#2f9e44', label: 'Green' },
  marker: { color: '#ffd43b', label: 'Marker', marker: true, opacity: 45 },
};

// Excalidraw draws a freedraw element strokeWidth × 4.25 across
const ACROSS = 4.25;

// ---- the file -------------------------------------------------------------------

const BANNER = "==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠== You can decompress Drawing data with the command palette: 'Decompress current Excalidraw file'. For more info check in plugin settings under 'Saving'";
const DRAWING = /(\n##? Drawing\n[^`]*```)(json|compressed-json)\n([\s\S]*?)```\n?/u;

/** An empty scene, as the plugin starts one. */
export function emptyScene() {
  return { type: 'excalidraw', version: 2, source: 'https://github.com/franz-rosenzweig/moshe', elements: [], appState: { gridSize: null, viewBackgroundColor: '#ffffff' }, files: {} };
}

/** A drawing file read: its scene (empty if there's none yet) and its paper. */
export function readInkFile(text) {
  const t = String(text || '');
  const paperMatch = /^moshe-paper:\s*(\w+)\s*$/mu.exec(t.split(/\n---\s*\n/u)[0] || '');
  const paper = paperMatch && PAPERS.includes(paperMatch[1]) ? paperMatch[1] : null;
  const m = DRAWING.exec(t);
  if (!m) return { scene: emptyScene(), paper };
  let json = m[3];
  if (m[2] === 'compressed-json') json = decompressFromBase64(json.replace(/[\r\n]/gu, '')) || '';
  try {
    const scene = JSON.parse(json.slice(0, json.lastIndexOf('}') + 1));
    if (!scene || !Array.isArray(scene.elements)) return { scene: emptyScene(), paper };
    return { scene, paper };
  } catch { return { scene: emptyScene(), paper }; }
}

/** The drawing file with this scene in it: a new one, or `prev` with only its drawing (and paper) changed. */
export function writeInkFile(prev, scene, { paper = 'lined' } = {}) {
  const block = `\n## Drawing\n\`\`\`json\n${JSON.stringify(scene, null, '\t')}\n\`\`\`\n`;
  if (prev && DRAWING.test(prev)) {
    let out = prev.replace(DRAWING, () => block);
    out = /^moshe-paper:.*$/mu.test(out) ? out.replace(/^moshe-paper:.*$/mu, `moshe-paper: ${paper}`)
      : out.replace(/^(---\n)/u, `$1moshe-paper: ${paper}\n`);
    return out;
  }
  return ['---', '', 'excalidraw-plugin: parsed', 'tags: [excalidraw]', `moshe-paper: ${paper}`, '', '---', BANNER, '', '',
    '# Excalidraw Data', '', '## Text Elements', '%%', block.slice(1) + '%%', ''].join('\n');
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
 * The page's ink: Moshe's strokes, from the plugin's freedraw elements, and
 * the plugin's other elements, kept as they are.
 * @returns {({kind: 'stroke', id: string, color: string, size: number, marker: boolean, opacity: number, points: [number, number, number][], el?: object}
 *   | {kind: 'other', el: object})[]}
 */
export function inkFromScene(scene) {
  return (scene.elements || []).map((el) => {
    if (el.type !== 'freedraw' || el.isDeleted || !Array.isArray(el.points)) return { kind: 'other', el };
    const pr = Array.isArray(el.pressures) && el.pressures.length === el.points.length && !el.simulatePressure ? el.pressures : null;
    return {
      kind: 'stroke', id: el.id, el,
      color: el.strokeColor || PENS.ink.color, opacity: el.opacity ?? 100,
      marker: (el.opacity ?? 100) < 70,
      size: (el.strokeWidth || 1) * ACROSS,
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
    strokeColor: s.color, backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: r2(s.size / ACROSS), strokeStyle: 'solid',
    roughness: 0, opacity: s.opacity ?? 100, groupIds: [], frameId: null, roundness: null, seed: rnd(), version: 1, versionNonce: rnd(),
    isDeleted: false, boundElements: null, updated: Date.now(), link: null, locked: false,
    points, pressures: s.points.map((p) => r2(p[2] ?? 0.5)), simulatePressure: false, lastCommittedPoint: points[points.length - 1] || null,
  };
}

/** The scene with this ink in it, the rest of `base` (the plugin's settings, files) as it was. */
export function sceneFromInk(items, base = emptyScene()) {
  return { ...base, elements: items.map((it) => (it.kind === 'stroke' ? elementOf(it) : it.el)) };
}

/** A stroke as engine/sketch.js draws it: its outline and round ends. */
export function shapeOf(s) {
  // (sketch.js's marker is size × 1.6 in radius, and steady; a pen's about its size across)
  return strokeShape({ color: s.marker ? 'marker' : s.color, size: s.marker ? s.size / 3.2 : s.size, points: s.points });
}

// ---- the picture -----------------------------------------------------------------------

/** How far down the ink goes (the page is at least a page long). */
export function pageHeight(items, min = 1414) {
  let bottom = 0;
  for (const it of items) {
    if (it.kind === 'stroke') for (const p of it.points) bottom = Math.max(bottom, p[1]);
    else if (!it.el.isDeleted) bottom = Math.max(bottom, (it.el.y || 0) + (it.el.height || 0));
  }
  return Math.max(min, Math.ceil(bottom + 160));
}

const esc = (s) => String(s).replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');

/** The paper, as SVG: its colour and its ruling. */
export function paperSvg(paper, w, h) {
  let rule = '';
  if (paper === 'lined') for (let y = TOP; y < h; y += LINE) rule += `M0 ${y}H${w}`;
  if (paper === 'grid') { for (let y = GRID; y < h; y += GRID) rule += `M0 ${y}H${w}`; for (let x = GRID; x < w; x += GRID) rule += `M${x} 0V${h}`; }
  const lines = rule ? `<path d="${rule}" stroke="${RULE_COLOR}" stroke-width="1" fill="none"/>` : '';
  let dots = '';
  if (paper === 'dotted') {
    dots = `<defs><pattern id="dots" width="${GRID}" height="${GRID}" patternUnits="userSpaceOnUse"><circle cx="${GRID / 2}" cy="${GRID / 2}" r="1.3" fill="#c3ccd6"/></pattern></defs><rect width="${w}" height="${h}" fill="url(#dots)"/>`;
  }
  return `<rect width="${w}" height="${h}" fill="${PAPER_COLOR}"/>${lines}${dots}`;
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
        const a = Math.atan2(y2 - y1, x2 - x1), l = 10 + 2 * w;
        d += `M${r2(x2 - l * Math.cos(a - 0.45))} ${r2(y2 - l * Math.sin(a - 0.45))}L${r2(x2)} ${r2(y2)}L${r2(x2 - l * Math.cos(a + 0.45))} ${r2(y2 - l * Math.sin(a + 0.45))}`;
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

/** The page as an SVG picture: the paper, then the ink in the order it was drawn. */
export function inkSvg(items, { paper = 'lined', minHeight = 600 } = {}) {
  const w = PAGE_WIDTH, h = Math.max(pageHeight(items, 600), Math.ceil(minHeight));
  const body = items.map((it) => {
    if (it.kind !== 'stroke') return otherSvg(it.el);
    const { d, caps } = shapeOf(it);
    const op = (it.opacity ?? 100) < 100 ? ` opacity="${r2(it.opacity / 100)}"` : '';
    return `<g fill="${esc(it.color)}"${op}>${d ? `<path d="${d}"/>` : ''}${caps.map(([x, y, r]) => `<circle cx="${r2(x)}" cy="${r2(y)}" r="${r2(r)}"/>`).join('')}</g>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n${paperSvg(paper, w, h)}\n${body}\n</svg>\n`;
}
