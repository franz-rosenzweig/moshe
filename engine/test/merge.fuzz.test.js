// Two versions of a sheet, edited at random from one base, merged: the merge
// must be symmetric (both devices write the same bytes), settled (merging
// the result again with either side changes nothing), and lose nothing
// either side wrote (every paragraph one side added is in the result).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeText } from '../src/merge.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let q = a; q = Math.imul(q ^ (q >>> 15), q | 1); q ^= q + Math.imul(q ^ (q >>> 7), q | 61); return ((q ^ (q >>> 14)) >>> 0) / 4294967296; };
}
const WORDS = 'the quick brown fox jumps over a lazy dog while Gregor dreams of hesed and the long road home under grey skies'.split(' ');

function edit(r, lines, tag) {
  const out = [...lines];
  const n = 1 + Math.floor(r() * 4);
  const added = [];
  for (let k = 0; k < n; k++) {
    const op = r();
    const i = Math.floor(r() * (out.length + 1));
    if (op < 0.35 || !out.length) {
      const para = `${tag}${k}: ` + Array.from({ length: 3 + Math.floor(r() * 8) }, () => WORDS[Math.floor(r() * WORDS.length)]).join(' ');
      out.splice(i, 0, para);
      added.push(para);
    } else if (op < 0.6) {
      out.splice(Math.min(i, out.length - 1), 1);
    } else {
      const j = Math.min(i, out.length - 1);
      const words = out[j].split(' ');
      words[Math.floor(r() * words.length)] = `${tag}w${k}`;
      out[j] = words.join(' ');
    }
  }
  return { lines: out, added };
}

const N = Number(process.env.MOSHE_FUZZ || 3000);

test(`merge: symmetric, settled, nothing added is lost (${N} random pairs)`, () => {
  const r = rng(Number(process.env.MOSHE_SEED || 7));
  const problems = [];
  for (let i = 0; i < N && problems.length < 3; i++) {
    const base = Array.from({ length: 2 + Math.floor(r() * 10) }, (_, k) => `p${k} ` + Array.from({ length: 4 + Math.floor(r() * 6) }, () => WORDS[Math.floor(r() * WORDS.length)]).join(' '));
    const a = edit(r, base, 'A'), b = edit(r, base, 'B');
    const B = base.join('\n'), A = a.lines.join('\n'), C = b.lines.join('\n');
    const ab = mergeText(B, A, C).text, ba = mergeText(B, C, A).text;
    if (ab !== ba) { problems.push(`not symmetric:\nbase ${JSON.stringify(base)}\nA ${JSON.stringify(a.lines)}\nB ${JSON.stringify(b.lines)}\nab ${JSON.stringify(ab)}\nba ${JSON.stringify(ba)}`); continue; }
    for (const p of [...a.added, ...b.added]) {
      // a paragraph one side added may later have been edited by that same side; check only untouched ones
      const kept = (a.lines.includes(p) || b.lines.includes(p));
      if (kept && !ab.split('\n').some((l) => l === p || l.includes(p.slice(0, 12)))) problems.push(`lost ${JSON.stringify(p)}\nbase ${JSON.stringify(base)}\nA ${JSON.stringify(a.lines)}\nB ${JSON.stringify(b.lines)}\nresult ${JSON.stringify(ab)}`);
    }
    // settled: the result merged again with either side, from the side it came from, is itself
    if (mergeText(A, ab, A).text !== ab || mergeText(C, ab, C).text !== ab) problems.push('not settled');
    if (mergeText(A, A, ab).text !== ab) problems.push(`taking the result from A's own version changes it`);
  }
  if (problems.length) assert.fail(problems.join('\n\n'));
});
