import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { HttpStorage } from '../../engine/src/storage-http.js';
import { Store } from '../../engine/src/store.js';

async function server(opts = {}) {
  const root = mkdtempSync(join(tmpdir(), 'moshe-'));
  mkdirSync(join(root, 'Notes', 'Blog'), { recursive: true });
  writeFileSync(join(root, 'Notes', 'Blog', 'Post.md'), '# A post\nText.\n');
  mkdirSync(join(root, '.moshe'), { recursive: true });
  const authFile = join(root, '.moshe', 'auth.json');
  const app = await createApp({ root, authFile, watch: false, backupDir: opts.backups ? join(root, '..', `${root.split('/').pop()}-backups`) : null, backupEvery: 0 });
  const addr = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${addr.port}`;
  return { root, app, base };
}

test('the page works on the server\'s folder through the engine', async () => {
  const { root, app, base } = await server();
  try {
    const storage = new HttpStorage(base);
    const store = await Store.open(storage);
    assert.deepEqual(store.sheetList('Notes/Blog').sections[0].sheets.map((s) => s.title), ['A post']);
    const p = store.createSheet('Notes/Blog', { text: '# Second\nMore.\n' });
    await store.flush();
    assert.equal(readFileSync(join(root, p), 'utf8'), '# Second\nMore.\n');
    // someone edits on the server's disk; the page's store reads only that
    writeFileSync(join(root, 'Notes', 'Blog', 'Post.md'), '# A post, edited in Obsidian\nText.\n');
    const changed = await store.scanChanges();
    assert.ok(changed.includes('Notes/Blog/Post.md'));
    assert.equal(store.sheetInfo('Notes/Blog/Post.md').title, 'A post, edited in Obsidian');
    // the password file is never offered
    const listing = await storage.list();
    assert.ok(!listing.files.some((f) => f.includes('auth.json')));
    await assert.rejects(storage.read('.moshe/auth.json'));
    await assert.rejects(storage.write('../escape.md', 'x'));
  } finally { await app.close(); }
});

test('with a password: nothing without signing in; a token opens WebDAV, not the files', async () => {
  const { app, base } = await server();
  try {
    app.auth.setPassword('correct horse');
    assert.equal((await fetch(`${base}/api/fs/list`)).status, 401);
    const bad = await fetch(`${base}/api/login`, { method: 'POST', body: JSON.stringify({ password: 'nope' }), headers: { 'Content-Type': 'application/json' } });
    assert.equal(bad.status, 401);
    const ok = await fetch(`${base}/api/login`, { method: 'POST', body: JSON.stringify({ password: 'correct horse' }), headers: { 'Content-Type': 'application/json' } });
    const cookie = ok.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(`${base}/api/fs/list`, { headers: { cookie } })).status, 200);
    const token = app.auth.addToken('Phone');
    assert.equal((await fetch(`${base}/api/fs/list`, { headers: { Authorization: `Bearer ${token}` } })).status, 401, 'a device token does not open the page\'s files');
    const dav = await fetch(`${base}/dav/`, { method: 'PROPFIND', headers: { Authorization: `Bearer ${token}`, Depth: '1' } });
    assert.equal(dav.status, 207);
    const get = await fetch(`${base}/dav/Notes/Blog/Post.md`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(await get.text(), '# A post\nText.\n');
    const etag = get.headers.get('etag');
    const put = await fetch(`${base}/dav/Notes/Blog/Post.md`, { method: 'PUT', body: '# Changed\n', headers: { Authorization: `Bearer ${token}`, 'If-Match': '"stale"' } });
    assert.equal(put.status, 412, 'a write from an older version is refused');
    const put2 = await fetch(`${base}/dav/Notes/Blog/Post.md`, { method: 'PUT', body: '# Changed\n', headers: { Authorization: `Bearer ${token}`, 'If-Match': etag } });
    assert.equal(put2.status, 204);
    const auth = await fetch(`${base}/dav/.moshe/auth.json`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(auth.status, 404);
  } finally { await app.close(); }
});

test('backups: one when asked, a file unchanged since the last shared, pruned by age', async () => {
  const { root, app, base } = await server({ backups: true });
  try {
    const id1 = await app.backups.make(true);
    writeFileSync(join(root, 'Notes', 'New.md'), 'New\n');
    const id2 = await app.backups.make(false);
    const list = await (await fetch(`${base}/api/backups`)).json();
    assert.deepEqual(list.backups.map((b) => b.id).sort(), [id1, id2].sort());
    const files = (await (await fetch(`${base}/api/backups/${encodeURIComponent(id2)}`)).json()).files;
    assert.equal(files['Notes/New.md'], 'New\n');
    assert.equal(files['Notes/Blog/Post.md'], '# A post\nText.\n');
    assert.ok(existsSync(app.backups.dir));
  } finally { await app.close(); }
});

test('with no password, a request through a tunnel is refused; the tailnet and this machine are not', async () => {
  const { app, base } = await server();
  try {
    assert.equal((await fetch(`${base}/api/fs/list`)).status, 200, 'local, no password: open');
    const tunnel = { 'cf-ray': 'abc', 'cf-connecting-ip': '203.0.113.9' };
    assert.equal((await fetch(`${base}/api/fs/list`, { headers: tunnel })).status, 401);
    assert.equal((await fetch(`${base}/dav/`, { method: 'PROPFIND', headers: { ...tunnel, Depth: '1' } })).status, 401);
    const a = await (await fetch(`${base}/api/auth`, { headers: tunnel })).json();
    assert.deepEqual([a.required, a.authenticated, a.passwordSet], [true, false, false]);
    const l = await fetch(`${base}/api/login`, { method: 'POST', headers: { ...tunnel, 'Content-Type': 'application/json' }, body: '{"password":"x"}' });
    assert.equal(l.status, 403);
  } finally { await app.close(); }
});
