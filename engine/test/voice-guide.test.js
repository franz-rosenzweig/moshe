import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COMMANDS, parse } from '../src/voice.js';
import { VOICE_SHEET, GETTING_STARTED, addVoiceGuide } from '../src/welcome.js';
import { Store } from '../src/store.js';
import { MemoryStorage } from '../src/storage.js';

// docs/voice-guide.md, the writer's guide to voice: its tables (those headed “Say”) are the
// commands, one row each, so the guide can't drift from COMMANDS without a test saying so.
const GUIDE = readFileSync(new URL('../../docs/voice-guide.md', import.meta.url), 'utf8');

/** The rows of the guide's command tables: what to say, what it does, and the other ways to say it. */
function rows() {
  const out = [], cells = (l) => l.trim().replace(/^\||\|$/gu, '').split('|').map((c) => c.trim());
  let header = null;
  for (const line of GUIDE.split('\n')) {
    if (!line.trim().startsWith('|')) { header = null; continue; }
    if (/^\|[\s|:-]+\|$/u.test(line.trim())) continue;   // the line under the header
    if (!header) { header = cells(line); continue; }
    if (header[0] !== 'Say') continue;
    const [say, does = '', also = ''] = cells(line);
    out.push({ say: say.replace(/\*\*/gu, ''), does, also: [...also.matchAll(/"([^"]+)"/gu)].map((m) => m[1]) });
  }
  return out;
}
const ROWS = rows();
const commandOf = (row) => COMMANDS.find((c) => c.say === row.say);

test('the guide has every command, once, and no other', () => {
  const said = ROWS.map((r) => r.say);
  for (const c of COMMANDS) assert.equal(said.filter((s) => s === c.say).length, 1, `“${c.say}” (${c.id}) has one row in docs/voice-guide.md`);
  for (const s of said) assert.ok(COMMANDS.some((c) => c.say === s), `“${s}” in docs/voice-guide.md is a command`);
  for (const c of COMMANDS) assert.ok(GUIDE.includes(c.say), `docs/voice-guide.md says “${c.say}”`);
});

test('the guide marks the commands that are never guessed, and only those', () => {
  for (const r of ROWS) {
    const c = commandOf(r);
    if (c) assert.equal(/never guessed/iu.test(r.does), !!c.exact, `“${r.say}” is ${c.exact ? '' : 'not '}marked never guessed`);
  }
});

test('the other ways the guide gives to say a command are that command', () => {
  // ‹n› a number, ‹letters› letters, any other ‹…› some words
  const fill = (s) => s.replace(/‹([^›]*)›/gu, (m, k) => ({ n: '2', letters: 'a b c' }[k] || 'the tower'));
  for (const r of ROWS) {
    const c = commandOf(r);
    if (!c) continue;
    for (const a of r.also) {
      const p = parse(fill(a), { reading: c.id === 'stop', asleep: c.id === 'wake' });
      assert.equal(p.kind, 'command', `“${a}” is a command`);
      assert.equal(p.id, c.id, `“${a}” is ${c.id}, not ${p.id}`);
    }
  }
});

// The voice sheet in Getting Started (src/welcome.js), the short guide inside Moshe: what it
// tells you to say is a command, apart from the sentences it shows being typed.
const SAID_AS_TEXT = ['She said delete that and left', 'the frost came early that year'];
const NAMED = ['type'];   // a word it's talking about, said only in front of others

test('what the voice sheet tells you to say does what it says', () => {
  const said = [...VOICE_SHEET.matchAll(/"([^"]+)"/gu)].map((m) => m[1]);
  assert.ok(said.length >= 15, 'the sheet has its phrases in "quotes"');
  for (const s of said.filter((x) => !NAMED.includes(x))) {
    const p = parse(s, { reading: s === 'stop', asleep: s === 'wake up' });
    assert.equal(p.kind, SAID_AS_TEXT.includes(s) ? 'text' : 'command', `“${s}” in the voice sheet is ${SAID_AS_TEXT.includes(s) ? 'typed' : 'a command'}`);
  }
});

test('the voice sheet is in Getting Started, and Settings › Voice adds it to the Inbox once', async () => {
  assert.ok(GETTING_STARTED.includes(VOICE_SHEET));
  assert.match(GETTING_STARTED[0], /\*\*Writing by voice\*\*/u, 'the welcome sheet names it');
  const store = await Store.open(new MemoryStorage({ 'Notes/a.md': 'A note\n' }), { now: () => 0 });
  const p = addVoiceGuide(store);
  assert.equal(p, 'Notes/Writing by voice.md');
  assert.ok(store.text(p).startsWith('# Writing by voice\n'), 'a heading of its own, outside the group');
  store.saveSheet(p, `${store.text(p)}\nThe frost came late that year.\n`);
  assert.equal(addVoiceGuide(store), p, 'pressed again, the one already there, practice and all');
  assert.equal(store.sheetsIn('Notes').length, 2);
});
