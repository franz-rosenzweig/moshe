import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sketchSvg, readSketch, strokeShape, radiusAt } from '../src/sketch.js';

const wave = (x0, y0, n = 30, color = 'ink', size = 4) => ({ color, size, points: Array.from({ length: n }, (_, i) => [x0 + i * 4, y0 + Math.sin(i / 4) * 10, 0.3 + (i / n) * 0.6]) });

test('a sketch is an SVG picture of its ink, cropped, on paper', () => {
  const svg = sketchSvg([wave(300, 400), wave(320, 460, 20, 'marker', 6)]);
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="\d+" height="\d+" viewBox="0 0 \d+ \d+">/u);
  assert.match(svg, /<rect width="\d+" height="\d+" fill="#fdfcf8"\/>/u);
  assert.match(svg, /<g fill="#1d1d1f"><path d="M[\d. L]+Z"\/><circle /u);
  assert.match(svg, /<g fill="#f5c518" opacity="0.45">/u);
  const w = Number(/width="(\d+)"/u.exec(svg)[1]);
  assert.ok(w < 200, 'cropped to the ink, not the page it was drawn on');
  assert.equal(sketchSvg([]), null);
  assert.equal(sketchSvg([{ color: 'ink', size: 4, points: [] }]), null);
});

test('the strokes come back out of the picture, to draw on again', () => {
  const svg = sketchSvg([wave(300, 400)]);
  const back = readSketch(svg);
  assert.equal(back.strokes.length, 1);
  assert.equal(back.strokes[0].points.length, 30);
  assert.ok(back.strokes[0].points[0][0] < 40, 'moved to the picture\'s own corner');
  assert.equal(readSketch('<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>'), null, 'any other picture is not a sketch');
  assert.equal(readSketch('<metadata id="moshe-sketch">{broken</metadata>'), null);
});

test('a stroke\'s width follows the pressure; a dot is a dot', () => {
  const s = { color: 'ink', size: 4, points: [[0, 0, 0.1]] };
  assert.ok(radiusAt(s, 0.1) < radiusAt(s, 0.9));
  assert.equal(radiusAt({ color: 'marker', size: 4 }, 0.1), radiusAt({ color: 'marker', size: 4 }, 0.9));
  const dot = strokeShape(s);
  assert.equal(dot.d, '');
  assert.equal(dot.caps.length, 1);
});
