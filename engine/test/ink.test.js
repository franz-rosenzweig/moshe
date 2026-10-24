import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readInkFile, writeInkFile, inkFromScene, sceneFromInk, inkSvg, emptyScene, compressScene, pageHeight, PENS } from '../src/ink.js';

const stroke = (x0, y0, color = PENS.ink.color, size = 4.25) => ({ kind: 'stroke', color, size, marker: false, opacity: 100, points: Array.from({ length: 12 }, (_, i) => [x0 + i * 5, y0 + Math.sin(i) * 6, 0.3 + i * 0.05]) });

test('a page of ink is an Excalidraw drawing the plugin can open', () => {
  const scene = sceneFromInk([stroke(100, 200)]);
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
  const back = readInkFile(file);
  assert.equal(back.paper, 'lined');
  const ink = inkFromScene(back.scene);
  assert.equal(ink.length, 1);
  assert.deepEqual(ink[0].points[3], [115, Math.round((200 + Math.sin(3) * 6) * 100) / 100, 0.45]);
});

test('a drawing the plugin compressed is read too', () => {
  const scene = sceneFromInk([stroke(10, 20), stroke(300, 40, PENS.red.color)]);
  const file = `---\n\nexcalidraw-plugin: parsed\ntags: [excalidraw]\n\n---\n==⚠ ...\n\n# Excalidraw Data\n\n## Text Elements\nHello ^abc\n\n%%\n## Drawing\n\`\`\`compressed-json\n${compressScene(scene)}\n\`\`\`\n%%`;
  const back = readInkFile(file);
  assert.equal(back.scene.elements.length, 2);
  assert.equal(back.paper, null);
  assert.equal(inkFromScene(back.scene)[1].color, PENS.red.color);
});

test('saving again changes only the drawing: the plugin\'s text and files stay, and what Moshe doesn\'t draw is kept', () => {
  const text = { id: 'abc', type: 'text', x: 50, y: 60, width: 80, height: 25, text: 'Hello', fontSize: 20, strokeColor: '#1e1e1e', opacity: 100 };
  const scene = { ...emptyScene(), elements: [text, sceneFromInk([stroke(10, 20)]).elements[0]], files: { f1: { mimeType: 'image/png' } } };
  const prev = `---\n\nexcalidraw-plugin: parsed\ntags: [excalidraw]\nmy-key: kept\n\n---\n==⚠ ...\n\n# Excalidraw Data\n\n## Text Elements\nHello ^abc\n\n## Embedded Files\nf1: [[pic.png]]\n\n%%\n## Drawing\n\`\`\`compressed-json\n${compressScene(scene)}\n\`\`\`\n%%`;
  const ink = inkFromScene(readInkFile(prev).scene);
  assert.deepEqual(ink.map((i) => i.kind), ['other', 'stroke']);
  ink.push(stroke(400, 500, PENS.blue.color));
  const next = writeInkFile(prev, sceneFromInk(ink, readInkFile(prev).scene), { paper: 'dotted' });
  assert.match(next, /my-key: kept/u);
  assert.match(next, /moshe-paper: dotted/u);
  assert.match(next, /## Text Elements\nHello \^abc\n\n## Embedded Files\nf1: \[\[pic.png\]\]/u);
  assert.match(next, /## Drawing\n```json\n/u);
  assert.doesNotMatch(next, /compressed-json/u);
  const again = readInkFile(next);
  assert.equal(again.scene.elements.length, 3);
  assert.equal(again.scene.elements[0].text, 'Hello');
  assert.deepEqual(again.scene.files, { f1: { mimeType: 'image/png' } });
  assert.equal(again.scene.elements[1].id, scene.elements[1].id, 'an unchanged stroke keeps its element');
});

test('the page as a picture: paper, ink, and the plugin\'s shapes and text', () => {
  const ink = [stroke(100, 200), { kind: 'other', el: { type: 'text', x: 50, y: 60, width: 80, height: 25, text: 'Hi <there>', fontSize: 20, strokeColor: '#1e1e1e', opacity: 100 } },
    { kind: 'other', el: { type: 'rectangle', x: 10, y: 10, width: 50, height: 30, strokeColor: '#e03131', opacity: 100 } }];
  const lined = inkSvg(ink, { paper: 'lined' });
  assert.match(lined, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="1000" height="\d+"/u);
  assert.match(lined, /<path d="M0 120H1000M0 160H1000/u, 'ruled');
  assert.match(lined, /<g fill="#1e1e1e"><path d="M/u);
  assert.match(lined, /<tspan x="0" dy="20">Hi &lt;there&gt;<\/tspan>/u);
  assert.match(lined, /<rect width="50" height="30" rx="0" stroke="#e03131"/u);
  assert.match(inkSvg(ink, { paper: 'dotted' }), /<pattern id="dots"/u);
  assert.doesNotMatch(inkSvg(ink, { paper: 'blank' }), /M0 120H1000/u);
  assert.equal(pageHeight([stroke(0, 3000)]), 3166, 'the page grows with the ink');
});
