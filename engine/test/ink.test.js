import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readInkFile, writeInkFile, inkFromScene, sceneFromInk, inkSvg, emptyScene, compressScene, pageHeight, pagesFor, strokePath, outlinePath,
  eraseArea, lassoed, transformed, copies, snapShape, across, isDark, boundsOf, PEN_TYPES, PAGE_HEIGHT, PAGE_GAP } from '../src/ink.js';
import { getStroke } from '../src/freehand.js';

const stroke = (x0, y0, { pen = 'fountain', color = '#1e1e1e', width = 4.25, opacity = 100 } = {}) =>
  ({ kind: 'stroke', pen, color, width, opacity, points: Array.from({ length: 12 }, (_, i) => [x0 + i * 5, y0 + Math.sin(i) * 6, 0.3 + i * 0.05]) });

test('a page of ink is an Excalidraw drawing the plugin can open', () => {
  const scene = sceneFromInk([stroke(100, 200, { pen: 'pencil' })]);
  const file = writeInkFile(null, scene, { paper: 'lined' });
  assert.match(file, /^---\n\nexcalidraw-plugin: parsed\ntags: \[excalidraw\]\nmoshe-paper: lined\n\n---\n/u);
  assert.match(file, /# Excalidraw Data\n\n## Text Elements\n%%\n## Drawing\n```json\n\{/u);
  assert.match(file, /```\n%%\n$/u);
  const el = JSON.parse(/```json\n([\s\S]*?)```/u.exec(file)[1]).elements[0];
  assert.equal(el.type, 'freedraw');
  assert.equal(el.strokeWidth, 1, 'a pen 4.25 across is strokeWidth 1');
  assert.deepEqual(el.points[0], [0, el.points[0][1]], 'points are relative to the element');
  assert.equal(el.pressures.length, el.points.length);
  assert.equal(el.simulatePressure, false);
  assert.deepEqual(el.customData, { moshe: { pen: 'pencil' } }, 'which pen drew it');
  const back = readInkFile(file);
  assert.equal(back.paper, 'lined');
  assert.equal(back.color, null);
  const ink = inkFromScene(back.scene);
  assert.equal(ink.length, 1);
  assert.equal(ink[0].pen, 'pencil');
  assert.deepEqual(ink[0].points[3], [115, Math.round((200 + Math.sin(3) * 6) * 100) / 100, 0.45]);
});

test('the page\'s colour, paper and view are kept in its front matter, among the plugin\'s keys', () => {
  const scene = sceneFromInk([stroke(10, 20)], emptyScene(), { color: '#2b2b2b' });
  assert.equal(scene.appState.viewBackgroundColor, '#2b2b2b', 'the plugin shows the page in its colour too');
  const file = writeInkFile(null, scene, { paper: 'grid' });
  const next = writeInkFile(file, scene, { paper: 'cornell', color: '#2b2b2b', view: 'pages', pages: 3 });
  assert.match(next, /^---\n\nexcalidraw-plugin: parsed\ntags: \[excalidraw\]\nmoshe-paper: cornell\nmoshe-color: #2b2b2b\nmoshe-view: pages\nmoshe-pages: 3\n\n---\n/u);
  assert.deepEqual((({ paper, color, view, pages }) => ({ paper, color, view, pages }))(readInkFile(next)), { paper: 'cornell', color: '#2b2b2b', view: 'pages', pages: 3 });
  const back = writeInkFile(next, scene, { paper: 'cornell' });
  assert.doesNotMatch(back, /moshe-color|moshe-view|moshe-pages/u, 'back to the plain page: the keys go');
});

test('a drawing the plugin compressed is read too', () => {
  const scene = sceneFromInk([stroke(10, 20), stroke(300, 40, { color: '#e03131' })]);
  const file = `---\n\nexcalidraw-plugin: parsed\ntags: [excalidraw]\n\n---\n==⚠ ...\n\n# Excalidraw Data\n\n## Text Elements\nHello ^abc\n\n%%\n## Drawing\n\`\`\`compressed-json\n${compressScene(scene)}\n\`\`\`\n%%`;
  const back = readInkFile(file);
  assert.equal(back.scene.elements.length, 2);
  assert.equal(back.paper, null);
  assert.equal(inkFromScene(back.scene)[1].color, '#e03131');
});

test('strokes drawn before there were pens, or in the plugin, are the fountain pen, and the see-through ones the highlighter', () => {
  const el = (opacity) => ({ id: 'a', type: 'freedraw', x: 0, y: 0, strokeWidth: 4, strokeColor: '#ffd43b', opacity, points: [[0, 0], [10, 0]], pressures: [0.5, 0.5], simulatePressure: false });
  const [hl, ink] = inkFromScene({ elements: [el(30), el(100)] });
  assert.equal(hl.pen, 'highlighter');
  assert.equal(hl.width, 17);
  assert.equal(ink.pen, 'fountain');
});

test('saving again changes only the drawing: the plugin\'s text and files stay, and what Moshe doesn\'t draw is kept', () => {
  const text = { id: 'abc', type: 'text', x: 50, y: 60, width: 80, height: 25, text: 'Hello', fontSize: 20, strokeColor: '#1e1e1e', opacity: 100 };
  const scene = { ...emptyScene(), elements: [text, sceneFromInk([stroke(10, 20)]).elements[0]], files: { f1: { mimeType: 'image/png' } } };
  const prev = `---\n\nexcalidraw-plugin: parsed\ntags: [excalidraw]\nmy-key: kept\n\n---\n==⚠ ...\n\n# Excalidraw Data\n\n## Text Elements\nHello ^abc\n\n## Embedded Files\nf1: [[pic.png]]\n\n%%\n## Drawing\n\`\`\`compressed-json\n${compressScene(scene)}\n\`\`\`\n%%`;
  const ink = inkFromScene(readInkFile(prev).scene);
  assert.deepEqual(ink.map((i) => i.kind), ['text', 'stroke'], 'the plugin\'s text is a text box Moshe can edit');
  ink.push(stroke(400, 500, { color: '#1971c2' }));
  const next = writeInkFile(prev, sceneFromInk(ink, readInkFile(prev).scene), { paper: 'dotted' });
  assert.match(next, /my-key: kept\nmoshe-paper: dotted\n/u);
  assert.match(next, /## Text Elements\nHello \^abc\n\n## Embedded Files\nf1: \[\[pic.png\]\]/u);
  assert.match(next, /## Drawing\n```json\n/u);
  assert.doesNotMatch(next, /compressed-json/u);
  const again = readInkFile(next);
  assert.equal(again.scene.elements.length, 3);
  assert.equal(again.scene.elements[0].text, 'Hello');
  assert.deepEqual(again.scene.files, { f1: { mimeType: 'image/png' } });
  assert.equal(again.scene.elements[1].id, scene.elements[1].id, 'an unchanged stroke keeps its element');
});

test('the fountain pen is drawn just as Excalidraw draws a stroke, and every pen draws its own way', () => {
  const s = stroke(100, 200);
  const excalidraw = outlinePath(getStroke(s.points, { size: 4.25, thinning: 0.6, smoothing: 0.5, streamline: 0.5, easing: (t) => Math.sin((t * Math.PI) / 2), simulatePressure: false, last: true }));
  assert.equal(strokePath(s), excalidraw);
  const shapes = Object.keys(PEN_TYPES).map((pen) => strokePath({ ...s, pen, width: across(pen, 30) }));
  assert.ok(shapes.every((d) => /^M[\d.]+ [\d.]+Q/u.test(d)), 'each a filled outline');
  assert.equal(new Set(shapes).size, shapes.length, 'and no two alike');
  assert.ok(across('fountain', 1) < across('fountain', 50) && across('fountain', 50) < across('fountain', 100));
});

test('the page as a picture: paper, the highlighter under the writing, and the plugin\'s shapes and text', () => {
  const ink = [stroke(100, 200), stroke(90, 205, { pen: 'highlighter', color: '#ffd43b', width: 20, opacity: 50 }), stroke(300, 205, { pen: 'highlighter', color: '#ffd43b', width: 20, opacity: 50 }),
    { kind: 'other', el: { type: 'text', x: 50, y: 60, width: 80, height: 25, text: 'Hi <there>', fontSize: 20, strokeColor: '#1e1e1e', opacity: 100 } },
    { kind: 'other', el: { type: 'rectangle', x: 10, y: 10, width: 50, height: 30, strokeColor: '#e03131', opacity: 100 } }];
  const lined = inkSvg(ink, { paper: 'lined' });
  assert.match(lined, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="1000" height="1414"/u);
  assert.match(lined, /<path d="M0 120H1000M0 160H1000/u, 'ruled');
  assert.match(lined, /<g opacity="0.5" style="mix-blend-mode:multiply"><path d="M[^"]+" fill="#ffd43b"\/><path d="M[^"]+" fill="#ffd43b"\/><\/g>\n<path d="M[^"]+Z" fill="#1e1e1e"\/>/u,
    'both highlights in one layer, under the ink');
  assert.match(lined, /<tspan x="0" dy="20">Hi &lt;there&gt;<\/tspan>/u);
  assert.match(lined, /<rect width="50" height="30" rx="0" stroke="#e03131"/u);
  assert.match(inkSvg(ink, { paper: 'dotted' }), /<pattern id="dots"/u);
  assert.doesNotMatch(inkSvg(ink, { paper: 'blank' }), /M0 120H1000/u);
  assert.match(inkSvg([stroke(0, 0, { pen: 'pencil' })]), /filter="url\(#grain\)"/u, 'the pencil has grain');
  assert.equal(pageHeight([stroke(0, 3000)]), 3166, 'the page grows with the ink');
});

test('a dark page, and the pages view', () => {
  assert.ok(isDark('#2b2b2b') && !isDark('#fdfcf8') && !isDark('#fff6c9'));
  const dark = inkSvg([stroke(0, 0, { pen: 'highlighter', opacity: 50 })], { paper: 'lined', color: '#2b2b2b' });
  assert.match(dark, /<rect y="0" width="1000" height="1414" fill="#2b2b2b"\/><path d="M0 120H1000[^"]*" stroke="rgba\(255,255,255,0.13\)"/u);
  assert.match(dark, /mix-blend-mode:screen/u, 'a highlighter that lightens');
  const far = stroke(100, PAGE_HEIGHT * 2 + 100);
  assert.equal(pagesFor([far]), 3, 'as many pages as the ink reaches');
  const pages = inkSvg([far], { paper: 'cornell', view: 'pages', pages: 2 });
  assert.match(pages, new RegExp(`height="${3 * (PAGE_HEIGHT + PAGE_GAP) - PAGE_GAP}"`, 'u'));
  assert.equal((pages.match(/<rect y="\d+" width="1000" height="1414"/gu) || []).length, 3, 'three sheets of paper');
  assert.match(pages, /M250 80V1154/u, 'Cornell: the cue column, and the summary at the foot');
});

test('the area eraser cuts strokes where it passes, and leaves the rest alone', () => {
  const s = { ...stroke(0, 0), el: { id: 'x' }, id: 'x', points: Array.from({ length: 21 }, (_, i) => [i * 10, 0, 0.5]) };
  const other = stroke(0, 500);
  const out = eraseArea([s, other], 100, 0, 12);
  assert.equal(out.length, 3);
  assert.deepEqual(out.slice(0, 2).map((p) => [p.points[0][0], p.points.at(-1)[0]]), [[0, 80], [120, 200]]);
  assert.ok(out.slice(0, 2).every((p) => !p.el && !p.id), 'the pieces are new strokes');
  assert.equal(out[2], other);
  assert.equal(eraseArea([other], 100, 0, 12)[0], other);
});

test('the lasso takes what it goes round; moved, resized, copied', () => {
  const a = stroke(100, 100), b = stroke(400, 100);
  const loop = [[80, 60], [200, 60], [200, 160], [80, 160]];
  assert.deepEqual(lassoed([a, b], loop), [a]);
  const [big] = transformed([{ ...a, id: 'k', el: { id: 'k', version: 3 } }], { a: 2, d: 2, c: -100, f: -100 });
  assert.equal(big.width, a.width * 2, 'the line scales with it');
  assert.deepEqual(big.points[0].slice(0, 2), [100, 100]);
  assert.equal(big.id, 'k', 'the same element in the drawing');
  assert.equal(sceneFromInk([big]).elements[0].version, 4);
  const [copy] = copies([a], 30, 30);
  assert.deepEqual(copy.points[0].slice(0, 2), [130, 130]);
  assert.equal(copy.id, undefined);
});

test('a stroke held still at its end: a clean line, circle, rectangle or triangle; writing stays writing', () => {
  const wobble = (pts) => pts.map(([x, y], i) => [x + Math.sin(i * 7) * 2, y + Math.cos(i * 5) * 2, 0.5]);
  const seg = (p, q, n = 15) => Array.from({ length: n }, (_, i) => [p[0] + ((q[0] - p[0]) * i) / n, p[1] + ((q[1] - p[1]) * i) / n]);
  const held = (pts) => pts.filter((q, i) => i && q[0] === pts[i - 1][0] && q[1] === pts[i - 1][1]).length;   // a corner is held a moment
  const closed = (pts) => Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) < 1;
  const line = snapShape(wobble(seg([100, 100], [400, 104], 40)));
  assert.equal(line[0][1], line.at(-1)[1], 'nearly level is level');
  const circle = snapShape(wobble(Array.from({ length: 60 }, (_, i) => [200 + 80 * Math.cos((i / 58) * 2 * Math.PI), 200 + 78 * Math.sin((i / 58) * 2 * Math.PI)])));
  assert.ok(closed(circle) && held(circle) === 0);
  const rect = snapShape(wobble([...seg([100, 100], [300, 102]), ...seg([300, 102], [302, 220]), ...seg([302, 220], [98, 218]), ...seg([98, 218], [101, 105])]));
  assert.ok(closed(rect) && held(rect) === 5);
  const xs = rect.map((q) => q[0]), ys = rect.map((q) => q[1]);
  const edge = (v, all) => Math.abs(v - Math.min(...all)) < 0.01 || Math.abs(v - Math.max(...all)) < 0.01;
  assert.ok(rect.every(([x, y]) => edge(x, xs) || edge(y, ys)), 'upright and level: every point on its box');
  const tri = snapShape(wobble([...seg([100, 300], [200, 120]), ...seg([200, 120], [300, 300]), ...seg([300, 300], [104, 298])]));
  assert.ok(closed(tri) && held(tri) === 4);
  assert.equal(snapShape(Array.from({ length: 40 }, (_, i) => [100 + i * 5, 100 + Math.sin(i / 2) * 14, 0.5])), null);
  assert.equal(snapShape([[0, 0, 0.5], [3, 3, 0.5], [5, 4, 0.5], [6, 6, 0.5]]), null, 'a dot');
});

test('a text box is the plugin\'s text element, listed under Text Elements, and moves and copies with the lasso', () => {
  const box = { kind: 'text', x: 100, y: 200, w: 140, h: 60, text: 'A word\nand another', size: 24, color: '#1971c2', font: 'sans', opacity: 100 };
  const hebrew = { kind: 'text', x: 100, y: 400, w: 110, h: 30, text: 'שלום עולם', size: 24, color: '#1e1e1e', font: 'hand', opacity: 100 };
  const file = writeInkFile(null, sceneFromInk([box, hebrew, stroke(400, 500)]), { paper: 'lined' });
  const [a, b] = JSON.parse(/```json\n([\s\S]*?)```/u.exec(file)[1]).elements;
  assert.deepEqual([a.type, a.text, a.originalText, a.fontSize, a.fontFamily, a.textAlign, a.verticalAlign, a.lineHeight], ['text', 'A word\nand another', 'A word\nand another', 24, 2, 'left', 'top', 1.25]);
  assert.deepEqual([b.fontFamily, b.textAlign], [5, 'right'], 'handwriting font; Hebrew from the right');
  assert.match(file, new RegExp(`## Text Elements\\nA word\\nand another \\^${a.id}\\n\\nשלום עולם \\^${b.id}\\n\\n%%\\n## Drawing`, 'u'));
  // changed and saved again: the list follows, and a deleted text leaves it
  const ink = inkFromScene(readInkFile(file).scene);
  assert.deepEqual(ink.map((i) => i.kind), ['text', 'text', 'stroke']);
  const next = writeInkFile(file, sceneFromInk([{ ...ink[0], el: undefined, text: 'Changed' }, ink[2]], readInkFile(file).scene), { paper: 'lined' });
  assert.match(next, new RegExp(`## Text Elements\\nChanged \\^${a.id}\\n\\n%%`, 'u'));
  // drawn on the page
  const svg = inkSvg([box, hebrew]);
  assert.match(svg, /<text x="100" y="200" font-family="[^"]*Helvetica[^"]*" font-size="24" fill="#1971c2"><tspan x="100" dy="24">A word<\/tspan><tspan x="100" dy="30">and another<\/tspan><\/text>/u);
  assert.match(svg, /<text x="210" y="400"[^>]* direction="rtl" text-anchor="end"><tspan x="210" dy="24">שלום עולם<\/tspan>/u);
  // the lasso: taken by its middle, moved and resized, copied
  assert.deepEqual(lassoed([box, hebrew], [[80, 180], [300, 180], [300, 300], [80, 300]]), [box]);
  assert.deepEqual(boundsOf([box, hebrew]), { x0: 100, y0: 200, x1: 240, y1: 430 });
  const [big] = transformed([box], { a: 2, d: 2, c: -100, f: -200 });
  assert.deepEqual([big.x, big.y, big.w, big.size], [100, 200, 280, 48]);
  const [copy] = copies([box], 10, 10);
  assert.deepEqual([copy.x, copy.y, copy.id, copy.text], [110, 210, undefined, box.text]);
  // never erased
  assert.equal(eraseArea([box], 120, 210, 30)[0], box);
});
