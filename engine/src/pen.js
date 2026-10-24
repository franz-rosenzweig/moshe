// Pen marks: proofreading with a pen, as on paper. A stroke is read by its
// shape with plain geometry (a strike, a scribble, a caret, a circle, a tap),
// then turned into the revision marks the file already has — {--deleted--},
// {++inserted++}, {==highlighted==}{>>comment<<} — so no ink is kept, only the
// edit it stands for (editor/pen.js draws the strokes and places them).

import { parseInline } from './markup.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };

/** The stroke's points, one every `step` pixels along it. */
function resample(pts, step) {
  const out = [{ x: pts[0].x, y: pts[0].y }];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    let a = { x: pts[i - 1].x, y: pts[i - 1].y };
    const b = pts[i];
    let d = dist(a, b);
    while (carry + d >= step) {
      const k = (step - carry) / d;
      a = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      out.push(a);
      d = dist(a, b);
      carry = 0;
    }
    carry += d;
  }
  const last = pts[pts.length - 1];
  if (dist(out[out.length - 1], last) > step / 3) out.push({ x: last.x, y: last.y });
  return out;
}

/** How many times the stroke turns back along x, by at least `amp` pixels. */
function reversals(xs, amp) {
  let n = 0, dir = 0, hi = xs[0], lo = xs[0];
  for (const x of xs) {
    if (dir === 0) {                       // no way yet: the first move of `amp` sets it
      hi = Math.max(hi, x); lo = Math.min(lo, x);
      if (hi - x > amp) { dir = -1; lo = x; } else if (x - lo > amp) { dir = 1; hi = x; }
    } else if (dir > 0) {
      if (x > hi) hi = x; else if (hi - x > amp) { n++; dir = -1; lo = x; }
    } else if (x < lo) lo = x;
    else if (x - lo > amp) { n++; dir = 1; hi = x; }
  }
  return n;
}

/** The sum of the stroke's turns, in radians, signed (a full loop is ±2π). */
function turning(r) {
  let sum = 0;
  for (let i = 2; i < r.length; i++) {
    const a1 = Math.atan2(r[i - 1].y - r[i - 2].y, r[i - 1].x - r[i - 2].x);
    const a2 = Math.atan2(r[i].y - r[i - 1].y, r[i].x - r[i - 1].x);
    let d = a2 - a1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    sum += d;
  }
  return sum;
}

/** The share of steps in `r[a..b]` that go the way `sign` says along y (−1 up, +1 down). */
function along(r, a, b, sign) {
  let good = 0, all = 0;
  for (let i = a + 1; i <= b; i++) { const dy = r[i].y - r[i - 1].y; all++; if (dy * sign >= -0.5) good++; }
  return all ? good / all : 0;
}

/**
 * What a pen stroke means, read from its shape.
 * @param {{x: number, y: number}[]} pts  the stroke in screen pixels (y grows down)
 * @param {number} lh  the height of a line of text there, which sets the scale
 * @returns {null | {kind: 'tap', x: number, y: number}
 *   | {kind: 'strike' | 'scribble', box: Box, y: number}
 *   | {kind: 'caret', box: Box, x: number, y: number}
 *   | {kind: 'circle', box: Box, points: {x: number, y: number}[]}}
 *   null: not a mark (Box: {left, right, top, bottom})
 */
export function readStroke(pts, lh = 24) {
  if (!pts || !pts.length) return null;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const box = { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
  const w = box.right - box.left, h = box.bottom - box.top;
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  if (len < lh * 0.35) return { kind: 'tap', x: pts[0].x, y: pts[0].y };

  const r = resample(pts, Math.max(1.5, lh / 8));
  const first = r[0], last = r[r.length - 1];
  const gap = dist(first, last);

  // a loop round some words
  if (r.length >= 10 && gap < 0.35 * Math.max(w, h) && Math.abs(turning(r)) > 1.5 * Math.PI && w > lh * 0.6 && h > lh * 0.45) {
    return { kind: 'circle', box, points: r };
  }

  const back = reversals(r.map((p) => p.x), lh * 0.3);
  // back and forth over words
  if (back >= 3 && h < 2.2 * lh && w > lh * 0.4) return { kind: 'scribble', box, y: median(ys) };

  // ∧ between two words: up to a point and down again, its feet apart
  let peak = 0;
  for (let i = 1; i < r.length; i++) if (r[i].y < r[peak].y) peak = i;
  const up = first.y - r[peak].y, down = last.y - r[peak].y;
  if (peak > 0 && peak < r.length - 1 && up > lh * 0.35 && down > lh * 0.35 && w < 2.5 * lh && w > lh * 0.15
      && Math.abs(last.x - first.x) > h * 0.25 && back <= 1 && along(r, 0, peak, -1) > 0.75 && along(r, peak, r.length - 1, 1) > 0.75) {
    return { kind: 'caret', box, x: r[peak].x, y: (r[peak].y + Math.max(first.y, last.y)) / 2 };
  }

  // a line through words
  if (h < Math.max(lh * 0.6, w * 0.25) && w > lh * 0.6 && len < w * 1.4 && back <= 1) return { kind: 'strike', box, y: median(ys) };
  return null;
}

/** Whether a point is inside the closed path `poly` (even-odd). */
export function inside(poly, x, y) {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) ins = !ins;
  }
  return ins;
}

// ---- the text a stroke covers

const WORDCH = /[\p{L}\p{N}\p{M}'’\-־]/u;
const isWord = (c) => !!c && WORDCH.test(c);

/** text[from, to)'s words and marks of punctuation, outside the markup's own tags. */
export function tokensOf(text, from, to) {
  const tags = [];
  const walk = (nodes) => { for (const n of nodes) { for (const t of n.tags || []) tags.push(t); if (n.children) walk(n.children); } };
  walk(parseInline(text, from, to));
  const inTag = (i) => tags.some(([a, b]) => i >= a && i < b);
  const out = [];
  for (let i = from; i < to;) {
    if (/\s/u.test(text[i]) || inTag(i)) { i++; continue; }
    if (isWord(text[i])) {
      let j = i;
      while (j < to && isWord(text[j]) && !inTag(j)) j++;
      out.push({ from: i, to: j, word: true });
      i = j;
    } else { out.push({ from: i, to: i + 1, word: false }); i++; }
  }
  return out;
}

/** [from, to) grown to take in whole any markup it cuts across, so a mark never breaks one. */
export function fitToMarkup(text, lineFrom, lineTo, from, to) {
  let a = from, b = to, moved = true;
  const nodes = parseInline(text, lineFrom, lineTo);
  while (moved) {
    moved = false;
    const visit = (list) => {
      for (const n of list) {
        if (n.to <= a || n.from >= b) continue;                    // apart
        if (n.from >= a && n.to <= b) continue;                     // all of it
        if (n.inner && a >= n.inner[0] && b <= n.inner[1]) { if (n.children) visit(n.children); continue; }   // inside it
        a = Math.min(a, n.from); b = Math.max(b, n.to); moved = true;
      }
    };
    visit(nodes);
  }
  return [a, b];
}

/** The pen's revision marks that touch [from, to): deletions, insertions, highlights, comments. */
function marksIn(text, lineFrom, lineTo, from, to) {
  const out = [];
  const visit = (list) => {
    for (const n of list) {
      if (n.to <= from || n.from >= to) continue;
      if (['delete', 'insert', 'cmark', 'annotation', 'subst', 'note', 'comment', 'mark'].includes(n.type)) out.push(n);
      else if (n.children) visit(n.children);
    }
  };
  visit(parseInline(text, lineFrom, lineTo));
  return out;
}

const KEEP = (text, n) => {
  switch (n.type) {
    case 'delete': case 'cmark': case 'annotation': case 'mark': return text.slice(n.inner[0], n.inner[1]);
    case 'subst': return text.slice(n.data.old[0], n.data.old[1]);
    default: return '';                                              // an insertion, a comment, a note
  }
};

/** A strike through [from, to): it's deleted, as a revision. Through an insertion: the insertion goes. */
export function strikeChanges(text, lineFrom, lineTo, from, to) {
  [from, to] = fitToMarkup(text, lineFrom, lineTo, from, to);
  const marks = marksIn(text, lineFrom, lineTo, from, to);
  if (marks.length === 1 && marks[0].type === 'delete' && marks[0].from <= from && marks[0].to >= to) return [];   // struck already
  if (marks.length && marks.every((n) => n.type === 'insert')) return marks.map((n) => ({ from: n.from, to: n.to, insert: '' }));
  return [{ from, to, insert: `{--${text.slice(from, to)}--}` }];
}

/** A scribble over [from, to): the marks there are taken back; with none, the words go, untracked. */
export function scribbleChanges(text, lineFrom, lineTo, from, to) {
  const marks = marksIn(text, lineFrom, lineTo, from, to);
  if (marks.length) return marks.map((n) => ({ from: n.from, to: n.to, insert: KEEP(text, n) }));
  [from, to] = fitToMarkup(text, lineFrom, lineTo, from, to);
  // and one space with them, so two don't meet
  if (text[to] === ' ' && (from === lineFrom || text[from - 1] === ' ')) to++;
  else if (text[from - 1] === ' ') from--;
  return [{ from, to, insert: '' }];
}

/** Where a caret at `pos` really means: never inside a word. */
export function snapBetweenWords(text, lineFrom, lineTo, pos) {
  if (!(isWord(text[pos - 1]) && isWord(text[pos]))) return pos;
  let a = pos, b = pos;
  while (a > lineFrom && isWord(text[a - 1])) a--;
  while (b < lineTo && isWord(text[b])) b++;
  return pos - a <= b - pos ? a : b;
}

/** Words written at a caret: an insertion, with the space on the side that keeps the words apart. */
export function insertChanges(text, pos, words) {
  const t = String(words || '').replace(/\s+/gu, ' ').trim();
  if (!t) return [];
  const before = text[pos - 1], after = text[pos];
  const spaceBefore = !before || /\s/u.test(before) || before === '\n';
  const spaceAfter = !after || /\s/u.test(after);
  const insert = spaceBefore ? (spaceAfter ? `{++${t}++}` : `{++${t} ++}`) : `{++ ${t}++}`;
  return [{ from: pos, to: pos, insert }];
}

/** A circle round [from, to): highlighted, with the comment written for it (if any). */
export function commentChanges(text, lineFrom, lineTo, from, to, note) {
  [from, to] = fitToMarkup(text, lineFrom, lineTo, from, to);
  const n = String(note || '').replace(/\s+/gu, ' ').trim();
  const inner = text.slice(from, to);
  return [{ from, to, insert: n ? `{==${inner}==}{>>${n}<<}` : `{==${inner}==}` }];
}
