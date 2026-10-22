import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';

test('Check Text: the prose goes on to LanguageTool and its findings come back, trimmed; none without one', async () => {
  let got = null;
  const lt = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      got = { url: req.url, form: Object.fromEntries(new URLSearchParams(body)) };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ language: { name: 'English (US)', detectedLanguage: { name: 'English (US)' } }, matches: [
        { offset: 0, length: 5, message: 'Did you mean “There”?', shortMessage: 'Grammar', replacements: [{ value: 'There' }], rule: { id: 'THEIR_IS', issueType: 'grammar', category: { id: 'GRAMMAR' } }, context: {} },
      ] }));
    });
  });
  await new Promise((ok) => lt.listen(0, '127.0.0.1', ok));
  const root = mkdtempSync(join(tmpdir(), 'moshe-proof-'));
  mkdirSync(join(root, 'Notes'), { recursive: true });
  const mk = async (languageTool) => {
    const app = await createApp({ root, authFile: join(root, '..', `${root.split('/').pop()}-auth-${Math.random()}.json`), watch: false, backupEvery: 0, languageTool });
    return { app, base: `http://127.0.0.1:${(await app.listen(0, '127.0.0.1')).port}` };
  };
  const on = await mk(`http://127.0.0.1:${lt.address().port}/`);
  const off = await mk(null);
  try {
    assert.deepEqual(await (await fetch(`${on.base}/api/proof`)).json(), { available: true });
    const r = await fetch(`${on.base}/api/proof`, { method: 'POST', body: JSON.stringify({ text: 'Their is a eror.' }), headers: { 'Content-Type': 'application/json' } });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(got.url, '/v2/check');
    assert.equal(got.form.text, 'Their is a eror.');
    assert.equal(got.form.language, 'auto');
    assert.deepEqual(j.matches, [{ offset: 0, length: 5, message: 'Did you mean “There”?', short: 'Grammar', replacements: ['There'], rule: 'THEIR_IS', issue: 'grammar', category: 'GRAMMAR' }]);
    assert.deepEqual(await (await fetch(`${off.base}/api/proof`)).json(), { available: false });
    assert.equal((await fetch(`${off.base}/api/proof`, { method: 'POST', body: '{"text":"x"}', headers: { 'Content-Type': 'application/json' } })).status, 404);
    on.app.auth.setPassword('correct horse');
    assert.equal((await fetch(`${on.base}/api/proof`, { method: 'POST', body: '{"text":"x"}', headers: { 'Content-Type': 'application/json' } })).status, 401, 'signed in only');
  } finally { await on.app.close(); await off.app.close(); lt.close(); }
});
