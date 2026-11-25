import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';

test('the learned handwriting model: served with an ETag, 304 while unchanged, 404 when there is none, signed in only', async () => {
  const root = mkdtempSync(join(tmpdir(), 'moshe-hwr-'));
  mkdirSync(join(root, 'Notes'), { recursive: true });
  const model = join(root, '..', `${root.split('/').pop()}-personal.bin`);
  writeFileSync(model, Buffer.concat([Buffer.from('HWRB'), Buffer.alloc(60)]));
  const mk = async (hwrModel) => {
    const app = await createApp({ root, authFile: join(root, '..', `${root.split('/').pop()}-auth-${Math.random()}.json`), watch: false, backupEvery: 0, hwrModel });
    return { app, base: `http://127.0.0.1:${(await app.listen(0, '127.0.0.1')).port}` };
  };
  const on = await mk(model);
  const off = await mk(null);
  const gone = await mk(`${model}.gone`);
  try {
    const r = await fetch(`${on.base}/api/hwr/model`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'private, no-cache');
    assert.equal((await r.arrayBuffer()).byteLength, 64);
    const tag = r.headers.get('etag');
    assert.ok(tag);
    assert.equal((await fetch(`${on.base}/api/hwr/model`, { headers: { 'If-None-Match': tag } })).status, 304);
    // Learning again replaces the file: a new tag, so the page fetches it again.
    const later = new Date(Date.now() + 5000);
    utimesSync(model, later, later);
    assert.equal((await fetch(`${on.base}/api/hwr/model`, { headers: { 'If-None-Match': tag } })).status, 200);
    assert.equal((await fetch(`${off.base}/api/hwr/model`)).status, 404);
    assert.equal((await fetch(`${gone.base}/api/hwr/model`)).status, 404);
    on.app.auth.setPassword('correct horse');
    assert.equal((await fetch(`${on.base}/api/hwr/model`)).status, 401, 'signed in only');
  } finally { await on.app.close(); await off.app.close(); await gone.app.close(); }
});
