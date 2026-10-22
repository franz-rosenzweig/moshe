import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createApp } from '../src/app.js';
import { Files } from '../src/files.js';
import { Sheets } from '../src/sheets.js';
import { main } from '../src/cli.js';

function library() {
  const root = mkdtempSync(join(tmpdir(), 'moshe-sheets-'));
  mkdirSync(join(root, 'Notes', 'Journal'), { recursive: true });
  mkdirSync(join(root, 'Projects', 'Book', 'Chapters'), { recursive: true });
  mkdirSync(join(root, 'Projects', 'Blog', 'Journal'), { recursive: true });
  writeFileSync(join(root, 'Notes', 'Journal', 'Monday.md'), '---\nkeywords: [diary]\n---\n# Monday\nRain.\n');
  writeFileSync(join(root, 'Projects', 'Book', 'Chapters', 'One.md'), '# Chapter One\nIt began.\n');
  return root;
}

test('sheets from outside: a new one named from its first line, in a group found by name', async () => {
  const root = library();
  const s = new Sheets(new Files(root));
  assert.equal((await s.create('Inbox', '# An idea\nWorth keeping.')).path, 'Notes/An idea.md');
  assert.equal(readFileSync(join(root, 'Notes', 'An idea.md'), 'utf8'), '# An idea\nWorth keeping.\n');
  assert.equal((await s.create('', '# An idea\nAnother.')).path, 'Notes/An idea 2.md', 'a name already taken gets a number');
  assert.equal((await s.create('Chapters', '# Chapter Two\n')).path, 'Projects/Book/Chapters/Chapter Two.md');
  assert.equal((await s.create('Notes/Journal', 'Tuesday: sun')).path, 'Notes/Journal/Tuesday sun.md');
  await assert.rejects(s.create('Journal', '# x\n'), (e) => e.status === 409, 'two groups called Journal: which one?');
  await assert.rejects(s.create('Nowhere', '# x\n'), (e) => e.status === 404);
  await assert.rejects(s.create('Projects', '# x\n'), (e) => e.status === 404, 'Projects itself is not a group');
  await assert.rejects(s.create('Notes', '   '), (e) => e.status === 400);
  await assert.rejects(s.create('../..', '# x\n'), (e) => e.status === 404);
});

test('sheets from outside: text added at a sheet\'s end or start, found by path or title', async () => {
  const root = library();
  const s = new Sheets(new Files(root));
  assert.equal((await s.append('Monday', 'Cleared later.')).path, 'Notes/Journal/Monday.md');
  assert.equal(readFileSync(join(root, 'Notes', 'Journal', 'Monday.md'), 'utf8'), '---\nkeywords: [diary]\n---\n# Monday\nRain.\n\nCleared later.\n');
  await s.append('Notes/Journal/Monday.md', 'Morning note.', { atStart: true });
  assert.equal(readFileSync(join(root, 'Notes', 'Journal', 'Monday.md'), 'utf8'), '---\nkeywords: [diary]\n---\nMorning note.\n\n# Monday\nRain.\n\nCleared later.\n', 'after the front matter');
  assert.equal((await s.append('chapter one', 'It went on.', { group: 'Chapters' })).path, 'Projects/Book/Chapters/One.md', 'by title, any case');
  await assert.rejects(s.append('Wednesday', 'x'), (e) => e.status === 404);
  const made = await s.append('Wednesday', 'Wind.', { group: 'Notes/Journal', create: true });
  assert.deepEqual(made, { path: 'Notes/Journal/Wednesday.md', created: true });
  assert.equal(readFileSync(join(root, 'Notes', 'Journal', 'Wednesday.md'), 'utf8'), '# Wednesday\nWind.\n');
  assert.deepEqual((await s.list('Notes/Journal')).map((x) => x.title), ['Morning note.', 'Wednesday'], 'a sheet\'s title is its first line, so text put first retitles it');
});

test('sheets over HTTP: a device token or the signed-in page; nothing without', async () => {
  const root = library();
  const app = await createApp({ root, authFile: join(root, '..', `${root.split('/').pop()}-auth.json`), watch: false, backupEvery: 0 });
  const base = `http://127.0.0.1:${(await app.listen(0, '127.0.0.1')).port}`;
  try {
    app.auth.setPassword('correct horse');
    const post = (path, body, token) => fetch(`${base}${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    assert.equal((await post('/api/sheets', { text: '# x\n' })).status, 401);
    assert.equal((await post('/api/sheets', { text: '# x\n' }, 'msh_wrong')).status, 401);
    const token = app.auth.addToken('Shortcuts');
    const r = await post('/api/sheets', { group: 'Inbox', text: '# From the phone\nDictated.' }, token);
    assert.equal(r.status, 201);
    assert.deepEqual(await r.json(), { path: 'Notes/From the phone.md' });
    const a = await post('/api/sheets/append', { sheet: 'From the phone', text: 'And more.' }, token);
    assert.equal(a.status, 200);
    assert.equal(readFileSync(join(root, 'Notes', 'From the phone.md'), 'utf8'), '# From the phone\nDictated.\n\nAnd more.\n');
    const l = await fetch(`${base}/api/sheets?group=Chapters`, { headers: { Authorization: `Bearer ${token}` } });
    assert.deepEqual((await l.json()).sheets, [{ path: 'Projects/Book/Chapters/One.md', title: 'Chapter One' }]);
    assert.equal((await post('/api/sheets', { group: 'Nowhere', text: '# x' }, token)).status, 404);
    const foreign = await fetch(`${base}/api/sheets`, { method: 'POST', body: '{"text":"# x"}', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example', Authorization: `Bearer ${token}` } });
    assert.equal(foreign.status, 403, 'another site\'s page cannot post');
  } finally { await app.close(); }
});

test('sheets from the CLI: new, append, sheets', async () => {
  const root = library();
  const lines = [];
  const write = (s) => lines.push(String(s));
  assert.equal(await main(['--root', root, 'new', 'Notes/Journal'], {}, Readable.from(['# Thursday\nFog.\n']), write), 0);
  assert.equal(await main(['--root', root, 'append', 'Thursday'], {}, Readable.from(['Lifted by noon.']), write), 0);
  assert.equal(await main(['--root', root, 'sheets', 'Notes/Journal'], {}, Readable.from([]), write), 0);
  assert.ok(existsSync(join(root, 'Notes', 'Journal', 'Thursday.md')));
  assert.equal(readFileSync(join(root, 'Notes', 'Journal', 'Thursday.md'), 'utf8'), '# Thursday\nFog.\n\nLifted by noon.\n');
  assert.ok(lines.join('').includes('Notes/Journal/Thursday.md\tThursday'));
});
