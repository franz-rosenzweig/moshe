// Two versions of one file, and the version both started from, made into one:
// when two devices changed the same sheet before they saw each other
// (docs/SYNC.md). A sheet merges line by line (a line is a paragraph), and a
// paragraph both sides changed merges word by word; only where both changed
// the same words differently are both versions kept, one after the other.
// A folder's .moshe.json merges key by key, the newer value winning.
//
// Symmetric by construction — merge(base, a, b) is merge(base, b, a) — so two
// devices merging the same pair write the same bytes, and settled: merging
// the result again with either side changes nothing.
//
// The line merge is Dvarim's (engine/src/merge.js there), proved by its fuzzer.

const json = (v) => JSON.stringify(v === undefined ? null : v);
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Pairs [i, j] of a longest common subsequence of two arrays. */
function lcs(a, b) {
  const n = a.length, m = b.length;
  if (n * m > 4_000_000) return null;             // too big to compare item by item
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const pairs = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  return pairs;
}

/** Every item of `a`, in order, somewhere in `b`. */
function within(a, b) {
  let j = 0;
  for (const x of a) {
    while (j < b.length && b[j] !== x) j++;
    if (j === b.length) return false;
    j++;
  }
  return true;
}

/** Both versions of a stretch both sides changed: the one that already holds
 *  the other, else the shortest run holding both (their common items once),
 *  in a fixed order — so merging it again with either side changes nothing. */
function both(x, y) {
  if (within(x, y)) return [...y];
  if (within(y, x)) return [...x];
  [x, y] = json(x) <= json(y) ? [x, y] : [y, x];
  const pairs = lcs(x, y) || [];
  const out = [];
  let i = 0, j = 0;
  for (const [pi, pj] of [...pairs, [x.length, y.length]]) {
    out.push(...x.slice(i, pi), ...y.slice(j, pj));
    if (pi < x.length) out.push(x[pi]);
    i = pi + 1; j = pj + 1;
  }
  return out;
}

/**
 * Three versions of a list, merged: what only one side changed is that
 * side's, what both changed alike is kept once, and where they changed the
 * same stretch differently, `onBoth` decides (by default: both versions).
 * @returns {{items: any[], conflicts: number}}
 */
export function merge3(base, ours, theirs, onBoth = null) {
  if (eq(ours, base)) return { items: [...theirs], conflicts: 0 };
  if (eq(theirs, base) || eq(ours, theirs)) return { items: [...ours], conflicts: 0 };
  const po = lcs(base, ours), pt = lcs(base, theirs);
  if (!po || !pt) return { items: both(ours, theirs), conflicts: 1 };
  const mo = new Map(po), mt = new Map(pt);
  const out = [];
  let conflicts = 0, i = 0, o = 0, t = 0;
  const chunk = (bb, oo, tt) => {
    if (eq(oo, bb)) out.push(...tt);
    else if (eq(tt, bb) || eq(oo, tt)) out.push(...oo);
    else {
      const r = onBoth ? onBoth(bb, oo, tt) : null;
      if (r) { out.push(...r.items); conflicts += r.conflicts; } else { conflicts++; out.push(...both(oo, tt)); }
    }
  };
  for (;;) {
    // the next base item both sides kept: a stable point between changes
    let k = i;
    while (k < base.length && !(mo.has(k) && mt.has(k) && mo.get(k) >= o && mt.get(k) >= t)) k++;
    if (k >= base.length) {
      chunk(base.slice(i), ours.slice(o), theirs.slice(t));
      break;
    }
    chunk(base.slice(i, k), ours.slice(o, mo.get(k)), theirs.slice(t, mt.get(k)));
    out.push(base[k]);
    i = k + 1; o = mo.get(k) + 1; t = mt.get(k) + 1;
  }
  return { items: out, conflicts };
}

/** A paragraph as words and the spaces between them, so joining gives it back. */
const words = (line) => line.match(/\s+|[^\s]+/gu) || [];

/** Is `edited` still the paragraph `base` was, edited, rather than another put in its place?
 *  Most of the words in order are the same. */
function sameParagraph(base, edited) {
  const a = base.split(/\s+/u).filter(Boolean), b = edited.split(/\s+/u).filter(Boolean);
  if (!a.length || !b.length) return false;
  const kept = (lcs(a, b) || []).length;
  return kept / Math.max(a.length, b.length) >= 0.6;
}

/** Where both sides changed the same stretch of paragraphs, and it has as
 *  many on every side, try it paragraph by paragraph, and a paragraph both
 *  changed word by word: edits to neighbouring paragraphs, or to different
 *  words of one, all stay. */
function paragraphWise(bb, oo, tt) {
  if (bb.length !== oo.length || bb.length !== tt.length) return null;
  const out = [];
  for (let i = 0; i < bb.length; i++) {
    const b = bb[i], o = oo[i], t = tt[i];
    if (o === b || o === t) out.push(t);
    else if (t === b) out.push(o);
    else {
      // word by word only for two edits of one paragraph: a paragraph
      // rewritten on one side takes nothing from the other side's edit of the old one
      if (!sameParagraph(b, o) || !sameParagraph(b, t)) return null;
      const r = merge3(words(b), words(o), words(t));
      if (r.conflicts) return null;
      out.push(r.items.join(''));
    }
  }
  return { items: out, conflicts: 0 };
}

/** The version a conflict copy was most likely made from, of those this
 *  device had before its current one: the one sharing the most paragraphs
 *  with the copy (and of equals, the older, which can only lose less). */
export function likelyBase(history, copy) {
  if (!history || history.length < 2) return '';
  const want = new Map();
  for (const l of copy.split('\n')) want.set(l, (want.get(l) || 0) + 1);
  let best = '', bestScore = -1;
  for (const v of history.slice(0, -1)) {
    const have = new Map(want);
    let score = 0;
    for (const l of v.split('\n')) { const n = have.get(l); if (n) { score++; have.set(l, n - 1); } }
    if (score > bestScore) { best = v; bestScore = score; }
  }
  return best;
}

/**
 * A sheet (or any text file) merged three ways.
 * @param {string} base  '' when nothing says what both started from: then
 *   everything either side has is kept
 * @returns {{text: string, conflicts: number}}
 */
export function mergeText(base, ours, theirs) {
  if (ours === theirs) return { text: ours, conflicts: 0 };
  if (ours === base) return { text: theirs, conflicts: 0 };
  if (theirs === base) return { text: ours, conflicts: 0 };
  const split = (s) => (s ? s.split('\n') : []);
  const r = merge3(split(base), split(ours), split(theirs), paragraphWise);
  return { text: r.items.join('\n'), conflicts: r.conflicts };
}

// ---- a folder's .moshe.json ------------------------------------------------------

/** Every key of two sidecars, each the newer of its two values (ties: the one
 *  whose value sorts first as JSON, on both devices alike). */
export function mergeSidecar(a, b) {
  const out = {};
  for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
    const x = a && a[k], y = b && b[k];
    if (!x) { out[k] = y; continue; }
    if (!y) { out[k] = x; continue; }
    if (x.t !== y.t) out[k] = x.t > y.t ? x : y;
    else out[k] = json(x.v) <= json(y.v) ? x : y;
  }
  return out;
}

// ---- conflict copies ---------------------------------------------------------------

// Conflict copies sync tools leave beside a file both sides changed.
const SYNCTHING = /^(.*)\.sync-conflict-\d{8}-\d{6}-[A-Z0-9]{7}(\.[^./]+)?$/u;      // name.sync-conflict-20260923-101500-ABCDEFG.md
const CONFLICTED = /^(.*) \([^()]*conflicted copy[^()]*\)(\.[^./]+)?$/iu;             // name (Ada's conflicted copy 2026-09-23).md

/** The file a conflict copy is a copy of, or null if it is not one. */
export function conflictOriginal(path) {
  const slash = path.lastIndexOf('/');
  const dir = path.slice(0, slash + 1), name = path.slice(slash + 1);
  const m = SYNCTHING.exec(name) || CONFLICTED.exec(name);
  return m ? dir + m[1] + (m[2] || '') : null;
}

/** When a sync tool made a conflict copy, from its name, or null. */
export function copyTime(name) {
  let m = /\.sync-conflict-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-/u.exec(name);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  m = /conflicted copy[^()]*?(\d{4})-(\d{2})-(\d{2})/iu.exec(name);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]) + 86400e3;
  return null;
}
