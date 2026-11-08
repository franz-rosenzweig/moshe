import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, COMMANDS } from '../src/voice.js';
import { LESSONS, NOT_IN_LESSONS } from '../src/tutorial.js';

const steps = LESSONS.flatMap((l) => l.steps.map((s) => ({ ...s, lesson: l })));

test('each line a lesson says to say is the command its step names, or words', () => {
  for (const s of steps.filter((x) => x.say)) {
    const p = parse(s.say, { reading: s.when === 'reading', asleep: s.when === 'asleep' });
    if (s.when === 'asleep' && !s.id) { assert.equal(p.kind, 'ignored', `“${s.say}”, asleep, is let be`); continue; }
    if (s.id) assert.equal(p.kind === 'command' && p.id, s.id, `${s.lesson.id}: “${s.say}” is ${s.id}`);
    else assert.equal(p.kind, 'text', `${s.lesson.id}: “${s.say}” is typed`);
  }
});

test('the lessons have every command in them, but a few', () => {
  const taught = new Set(steps.map((s) => s.id).filter(Boolean));
  for (const c of COMMANDS) {
    if (c.hidden && c.id !== 'use') continue;
    if (NOT_IN_LESSONS.includes(c.id)) { assert.ok(!taught.has(c.id), `${c.id} is left out, and it's in a lesson`); continue; }
    assert.ok(taught.has(c.id), `${c.id} is in a lesson`);
  }
});

test('no step is done before its lesson begins', () => {
  for (const l of LESSONS) {
    const c = { heard: null, listening: false, asleep: false, reading: false, choosing: false, words: null, text: l.text ?? null, from: 0, to: 0, sel: '',
      numbers: null, revision: false, dashboard: true, focus: false, sheet: null };
    for (const [i, s] of l.steps.entries()) {
      if (s.when === 'reading') continue;   // done as soon as the reading is over
      assert.ok(!s.done(c), `${l.id} ${i} (${s.say || s.text}) isn't done at the start`);
    }
  }
});

test('the lessons are told apart, and each step says what to do', () => {
  assert.equal(new Set(LESSONS.map((l) => l.id)).size, LESSONS.length);
  for (const s of steps) {
    assert.ok(s.say || (s.do && s.text), `${s.lesson.id}: a line, or what to do`);
    assert.equal(typeof s.done, 'function');
    if (s.do === 'number') assert.ok(s.want != null, `${s.lesson.id}: a number step says which`);
  }
  // a lesson without a sheet of its own makes one first
  for (const l of LESSONS.filter((x) => !x.text)) assert.ok(l.steps.slice(0, 3).some((s) => s.practice), `${l.id} makes its practice sheet`);
});
