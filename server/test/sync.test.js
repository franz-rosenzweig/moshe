// Two devices, each with its own copy of the library, kept in step with the
// server over WebDAV (engine/src/webdav.js against server/src/dav.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { MemoryStorage } from '../../engine/src/storage.js';
import { Store } from '../../engine/src/store.js';
import { WebDavSync } from '../../engine/src/webdav.js';

async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'moshe-sync-'));
  mkdirSync(join(root, 'Notes', 'Blog'), { recursive: true });
  writeFileSync(join(root, 'Notes', 'Blog', 'Post.md'), '# A post\nOne.\nTwo.\nThree.\n');
  const app = await createApp({ root, authFile: join(root, '..', `${root.split('/').pop()}-auth.json`), watch: false, backupEvery: 0 });
  app.auth.setPassword('long enough password');
  const token = app.auth.addToken('Phone');
  const addr = await app.listen(0, '127.0.0.1');
  const url = `http://127.0.0.1:${addr.port}/dav/`;
  const device = async () => {
    const store = await Store.open(new MemoryStorage());
    return { store, sync: new WebDavSync(store, { url, token }) };
  };
  return { root, app, url, device };
}

test('a new device gets the whole library; its changes reach the server and the other device', async () => {
  const { root, app, device } = await setup();
  try {
    const a = await device(), b = await device();
    await a.sync.sync();
    assert.equal(a.store.text('Notes/Blog/Post.md'), '# A post\nOne.\nTwo.\nThree.\n');
    const p = a.store.createSheet('Notes/Blog', { text: '# From the phone\nWritten on the bus.\n' });
    a.store.setFavorite(p, true);
    await a.sync.sync();
    assert.equal(readFileSync(join(root, p), 'utf8'), '# From the phone\nWritten on the bus.\n');
    await b.sync.sync();
    assert.equal(b.store.text(p), '# From the phone\nWritten on the bus.\n');
    assert.equal(b.store.sheetInfo(p).favorite, true, 'the folder\'s settings came too');
  } finally { await app.close(); }
});

test('the same sheet changed on both devices: merged, and both end the same', async () => {
  const { root, app, device } = await setup();
  try {
    const a = await device(), b = await device();
    await a.sync.sync(); await b.sync.sync();
    a.store.saveSheet('Notes/Blog/Post.md', '# A post\nOne, from A.\nTwo.\nThree.\n', '# A post\nOne.\nTwo.\nThree.\n');
    b.store.saveSheet('Notes/Blog/Post.md', '# A post\nOne.\nTwo.\nThree, from B.\n', '# A post\nOne.\nTwo.\nThree.\n');
    // and someone edits the server's copy in Obsidian meanwhile
    writeFileSync(join(root, 'Notes', 'Blog', 'Post.md'), '# A post, retitled\nOne.\nTwo.\nThree.\n');
    for (let i = 0; i < 3; i++) { await a.sync.sync(); await b.sync.sync(); }
    const want = '# A post, retitled\nOne, from A.\nTwo.\nThree, from B.\n';
    assert.equal(a.store.text('Notes/Blog/Post.md'), want);
    assert.equal(b.store.text('Notes/Blog/Post.md'), want);
    assert.equal(readFileSync(join(root, 'Notes', 'Blog', 'Post.md'), 'utf8'), want);
    // an order changed on one, a colour on the other: both kept
    a.store.createSheet('Notes/Blog', { text: '# Second\n' });
    await a.sync.sync(); await b.sync.sync();
    const order = b.store.sheetsIn('Notes/Blog').map((x) => x.split('/').pop()).reverse();
    b.store.reorderSheets('Notes/Blog', order);
    a.store.editGroup('Notes/Blog', { color: 'red' });
    for (let i = 0; i < 2; i++) { await a.sync.sync(); await b.sync.sync(); }
    assert.deepEqual(a.store.sheetsIn('Notes/Blog'), b.store.sheetsIn('Notes/Blog'));
    assert.deepEqual(a.store.sheetsIn('Notes/Blog').map((x) => x.split('/').pop()), order);
    assert.equal(b.store.sget('Notes/Blog', 'color'), 'red');
    // deleted on one: deleted on the other
    a.store.trashSheet('Notes/Blog/Second.md');
    for (let i = 0; i < 2; i++) { await a.sync.sync(); await b.sync.sync(); }
    assert.equal(b.store.exists('Notes/Blog/Second.md'), false);
    assert.equal(b.store.trash().length, 1, 'and it is in the trash there too');
  } finally { await app.close(); }
});
