import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStroke, inside, tokensOf, strikeChanges, scribbleChanges, insertChanges, commentChanges, snapBetweenWords, fitToMarkup } from '../src/pen.js';

const LH = 24;
// a stroke through the given corners, a point every 2 px, with a little hand tremor
function path(corners, jitter = 0.6) {
  const out = [];
  let seed = 7;
  const wob = () => { seed = (seed * 9301 + 49297) % 233280; return (seed / 233280 - 0.5) * 2 * jitter; };
  for (let i = 1; i < corners.length; i++) {
    const [ax, ay] = corners[i - 1], [bx, by] = corners[i];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 2));
    for (let k = 0; k < n; k++) out.push({ x: ax + ((bx - ax) * k) / n + wob(), y: ay + ((by - ay) * k) / n + wob() });
  }
  const [lx, ly] = corners[corners.length - 1];
  out.push({ x: lx, y: ly });
  return out;
}
const ellipse = (cx, cy, rx, ry, turns = 1.08) => Array.from({ length: 90 }, (_, i) => [cx + rx * Math.cos((i / 89) * turns * 2 * Math.PI), cy + ry * Math.sin((i / 89) * turns * 2 * Math.PI)]);

test('pen strokes are read by their shape', () => {
  assert.equal(readStroke(path([[100, 200], [102, 201]])).kind, 'tap');
  assert.equal(readStroke(path([[100, 200], [260, 203]]), LH).kind, 'strike', 'a line through words');
  assert.equal(readStroke(path([[260, 200], [100, 196]]), LH).kind, 'strike', 'drawn right to left, as over Hebrew');
  const z = readStroke(path([[100, 200], [180, 192], [104, 206], [184, 196], [102, 210], [186, 200]]), LH);
  assert.equal(z.kind, 'scribble');
  const c = readStroke(path([[300, 236], [310, 208], [320, 236]]), LH);
  assert.equal(c.kind, 'caret');
  assert.ok(Math.abs(c.x - 310) < 2, 'the caret points where its peak is');
  const o = readStroke(path(ellipse(200, 200, 90, 26)), LH);
  assert.equal(o.kind, 'circle');
  assert.equal(readStroke(path([[100, 100], [101, 220]]), LH), null, 'a line down the page is no mark');
  assert.equal(readStroke(path([[100, 200], [150, 160], [200, 200]]), LH)?.kind === 'caret' ? 'too wide' : 'ok', 'ok', 'a wide arch is no caret');
});

test('a circle encloses what is inside it', () => {
  const poly = ellipse(200, 200, 90, 26).map(([x, y]) => ({ x, y }));
  assert.ok(inside(poly, 200, 200));
  assert.ok(!inside(poly, 320, 200));
});

test('the words a stroke can cover leave the markup\'s tags out', () => {
  const t = 'Some **bold** words, here.';
  assert.deepEqual(tokensOf(t, 0, t.length).map((k) => t.slice(k.from, k.to)), ['Some', 'bold', 'words', ',', 'here', '.']);
  const h = 'שלום {--עולם--} יפה';
  assert.deepEqual(tokensOf(h, 0, h.length).map((k) => h.slice(k.from, k.to)), ['שלום', 'עולם', 'יפה']);
});

test('a strike is a deletion; through an insertion, the insertion goes', () => {
  const t = 'The quick brown fox.';
  const apply = (s, ch) => ch.slice().sort((a, b) => b.from - a.from).reduce((x, c) => x.slice(0, c.from) + c.insert + x.slice(c.to), s);
  assert.equal(apply(t, strikeChanges(t, 0, t.length, 4, 9)), 'The {--quick--} brown fox.');
  const ins = 'The {++very ++}quick fox.';
  assert.equal(apply(ins, strikeChanges(ins, 0, ins.length, 7, 11)), 'The quick fox.');
  const del = 'The {--quick--} fox.';
  assert.deepEqual(strikeChanges(del, 0, del.length, 7, 12), [], 'struck already');
  // never half a mark: a strike from inside **bold** out takes the whole of it
  const b = 'A **bold** move.';
  assert.equal(apply(b, strikeChanges(b, 0, b.length, 4, 15)), 'A {--**bold** move--}.');
});

test('a scribble takes a mark back, or deletes plain words untracked', () => {
  const apply = (s, ch) => ch.slice().sort((a, b) => b.from - a.from).reduce((x, c) => x.slice(0, c.from) + c.insert + x.slice(c.to), s);
  const d = 'The {--quick--} fox.';
  assert.equal(apply(d, scribbleChanges(d, 0, d.length, 7, 12)), 'The quick fox.');
  const i = 'The {++very ++}quick fox.';
  assert.equal(apply(i, scribbleChanges(i, 0, i.length, 7, 11)), 'The quick fox.');
  const a = 'A {==passage==}{>>why?<<} here.';
  assert.equal(apply(a, scribbleChanges(a, 0, a.length, 5, 12)), 'A passage here.');
  const p = 'The quick brown fox.';
  assert.equal(apply(p, scribbleChanges(p, 0, p.length, 4, 9)), 'The brown fox.', 'and one space with them');
});

test('a caret inserts between words, with the space on the right side', () => {
  const t = 'The fox jumped.';
  assert.equal(snapBetweenWords(t, 0, t.length, 5), 4, 'not inside a word');
  assert.deepEqual(insertChanges(t, 4, 'quick'), [{ from: 4, to: 4, insert: '{++quick ++}' }]);
  assert.deepEqual(insertChanges(t, 7, 'quickly'), [{ from: 7, to: 7, insert: '{++ quickly++}' }]);
  assert.deepEqual(insertChanges(t, 14, ' high '), [{ from: 14, to: 14, insert: '{++ high++}' }]);
  assert.deepEqual(insertChanges(t, 4, '   '), []);
});

test('a circle highlights, with the comment written for it', () => {
  const t = 'A long passage here.';
  assert.deepEqual(commentChanges(t, 0, t.length, 7, 14, 'too long?'), [{ from: 7, to: 14, insert: '{==passage==}{>>too long?<<}' }]);
  assert.deepEqual(commentChanges(t, 0, t.length, 7, 14, ''), [{ from: 7, to: 14, insert: '{==passage==}' }]);
  assert.deepEqual(fitToMarkup('x _em_ y', 0, 8, 3, 8), [2, 8]);
});
