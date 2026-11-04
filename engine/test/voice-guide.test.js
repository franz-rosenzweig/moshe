import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COMMANDS, parse } from '../src/voice.js';

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
