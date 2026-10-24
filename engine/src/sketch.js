// Sketches: ink drawn with a pen (or a finger, or a mouse), kept as an SVG
// picture beside the sheet, so Obsidian or any browser shows it, with the
// strokes themselves inside it too (a <metadata> block), so Moshe can open it
// again and go on drawing. A stroke's width follows the pen's pressure.

/** The inks: a name in the strokes, a colour in the picture. The marker is wide and see-through. */
export const INKS = { ink: '#1d1d1f', blue: '#1f5fd1', red: '#d1342f', marker: '#f5c518' };
export const PAPER = '#fdfcf8';
const MARGIN = 16;

const r2 = (n) => Math.round(n * 100) / 100;

/** How wide a stroke is at a point: the pen's pressure (a marker's doesn't change). */
export function radiusAt(stroke, p) {
  if (stroke.color === 'marker') return stroke.size * 1.6;
  return (stroke.size / 2) * (0.35 + 0.9 * (p == null ? 0.5 : Math.max(0, Math.min(1, p))));
}

/** A stroke's points steadied: each the mean of it and its neighbours, none closer than `gap`. */
function steady(pts, gap = 1.2) {
  const kept = [];
  for (const p of pts) {
    const q = kept[kept.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) >= gap) kept.push(p);
  }
  if (kept.length < 3) return kept;
  return kept.map((p, i) => {
    if (i === 0 || i === kept.length - 1) return p;
    const a = kept[i - 1], c = kept[i + 1];
    return [(a[0] + 2 * p[0] + c[0]) / 4, (a[1] + 2 * p[1] + c[1]) / 4, p[2]];
  });
}

/**
 * A stroke as shapes to fill: the outline of its body (an SVG path's d, or
 * '' for a dot) and the two round ends.
 * @returns {{d: string, caps: [number, number, number][]}}
 */
export function strokeShape(stroke) {
  const pts = steady(stroke.points || []);
  if (!pts.length) return { d: '', caps: [] };
  const rad = pts.map((p) => radiusAt(stroke, p[2]));
  const first = pts[0], last = pts[pts.length - 1];
  const caps = [[first[0], first[1], rad[0]], [last[0], last[1], rad[rad.length - 1]]];
  if (pts.length < 2) return { d: '', caps: [caps[0]] };
  const left = [], right = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len; ty /= len;
    left.push([pts[i][0] - ty * rad[i], pts[i][1] + tx * rad[i]]);
    right.push([pts[i][0] + ty * rad[i], pts[i][1] - tx * rad[i]]);
  }
  const ring = [...left, ...right.reverse()];
  const d = `M${ring.map(([x, y]) => `${r2(x)} ${r2(y)}`).join('L')}Z`;
  return { d, caps };
}

/** The picture of a stroke, as SVG. */
function strokeSvg(stroke) {
  const { d, caps } = strokeShape(stroke);
  const fill = INKS[stroke.color] || INKS.ink;
  const op = stroke.color === 'marker' ? ' opacity="0.45"' : '';
  return `<g fill="${fill}"${op}>${d ? `<path d="${d}"/>` : ''}${caps.map(([x, y, r]) => `<circle cx="${r2(x)}" cy="${r2(y)}" r="${r2(r)}"/>`).join('')}</g>`;
}

/**
 * The sketch as an SVG file: cropped to its ink with a margin, on paper, with
 * the strokes kept inside for drawing on later. Null with nothing drawn.
 * @param {{color: string, size: number, points: [number, number, number][]}[]} strokes
 */
export function sketchSvg(strokes) {
  const live = (strokes || []).filter((s) => s.points && s.points.length);
  if (!live.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of live) for (const [x, y, p] of s.points) {
    const r = radiusAt(s, p);
    x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r);
  }
  const W = Math.max(120, Math.ceil(x1 - x0 + 2 * MARGIN)), H = Math.max(80, Math.ceil(y1 - y0 + 2 * MARGIN));
  const dx = MARGIN - x0 + (W - (x1 - x0 + 2 * MARGIN)) / 2, dy = MARGIN - y0 + (H - (y1 - y0 + 2 * MARGIN)) / 2;
  const moved = live.map((s) => ({ color: s.color, size: s.size, points: s.points.map(([x, y, p]) => [r2(x + dx), r2(y + dy), r2(p == null ? 0.5 : p)]) }));
  const meta = JSON.stringify({ v: 1, width: W, height: H, strokes: moved }).replace(/</gu, '\\u003c').replace(/&/gu, '\\u0026');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">\n`
    + `<metadata id="moshe-sketch">${meta}</metadata>\n`
    + `<rect width="${W}" height="${H}" fill="${PAPER}"/>\n`
    + `${moved.map(strokeSvg).join('\n')}\n</svg>\n`;
}

/** The strokes inside a sketch Moshe drew: {width, height, strokes}, or null for any other picture. */
export function readSketch(svg) {
  const m = /<metadata id="moshe-sketch">([\s\S]*?)<\/metadata>/u.exec(String(svg || ''));
  if (!m) return null;
  try {
    const j = JSON.parse(m[1]);
    return j && Array.isArray(j.strokes) ? j : null;
  } catch { return null; }
}
