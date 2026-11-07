import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../src/voice.js';
import { VOICE_SHEET } from '../src/welcome.js';
import { VOICE_LESSON, PRACTICE_STEP } from '../src/tutorial.js';

const GUIDE = readFileSync(new URL('../../docs/voice-guide.md', import.meta.url), 'utf8');
const lower = (s) => s.toLowerCase();

test('each line the tutorial says to say is what the step waits for', () => {
  for (const s of VOICE_LESSON.filter((x) => x.say)) {
    const p = parse(s.say, { reading: s.when === 'reading', asleep: s.when === 'asleep' });
    if (s.id) assert.equal(p.kind === 'command' && p.id, s.id, `“${s.say}” is ${s.id}`);
    else assert.equal(p.kind, 'text', `“${s.say}” is typed`);
  }
});

test('its lines come from the voice sheet and the guide', () => {
  for (const s of VOICE_LESSON.filter((x) => x.say)) {
    assert.ok(lower(VOICE_SHEET).includes(lower(s.say)) || lower(GUIDE).includes(lower(s.say)), `“${s.say}” is in the voice sheet or docs/voice-guide.md`);
  }
});

test('a step is done by its own line, and not by another', () => {
  const base = { heard: null, listening: true, asleep: false, reading: false, choosing: false };
  for (const s of VOICE_LESSON) {
    if (s.do === 'listen') {
      assert.ok(s.done(base));
      assert.ok(!s.done({ ...base, listening: false }));
      assert.ok(!s.done({ ...base, asleep: true }));
      continue;
    }
    if (s.when === 'reading') {
      assert.ok(!s.done({ ...base, reading: true }), 'not while it reads');
      assert.ok(s.done(base), 'once the reading stops');
      continue;
    }
    const right = s.do === 'number' ? { kind: 'command', id: 'choice' } : s.id ? { kind: 'command', id: s.id } : { kind: 'text' };
    assert.ok(s.done({ ...base, heard: right }), `${s.say || s.do}: done`);
    assert.ok(!s.done(base), `${s.say || s.do}: not before anything is heard`);
    const wrong = right.kind === 'text' ? { kind: 'command', id: 'newSheet' } : { kind: 'text' };
    assert.ok(!s.done({ ...base, heard: wrong }), `${s.say || s.do}: not by something else`);
    if (right.kind === 'command') assert.ok(!s.done({ ...base, heard: { ...right, kind: 'fail' } }), `${s.say || s.do}: not when it couldn't be done`);
  }
});

test('the practice sheet is the one the tutorial says to make', () => {
  assert.equal(VOICE_LESSON[PRACTICE_STEP].say, 'new sheet');
  assert.ok(PRACTICE_STEP < VOICE_LESSON.findIndex((s) => !s.do && !s.id), 'before anything is typed');
});
