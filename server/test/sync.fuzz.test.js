// Two devices and the server, working at random and syncing now and then
// over WebDAV (engine/src/webdav.js against server/src/dav.js). When all is
// synced they must hold the same library, and every paragraph anyone typed
// must still be somewhere in it (a sheet, or the trash).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { MemoryStorage } from '../../engine/src/storage.js';
import { NodeStorage } from '../../engine/src/storage-node.js';
import { Store } from '../../engine/src/store.js';
import { WebDavSync } from '../../engine/src/webdav.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let q = a; q = Math.imul(q ^ (q >>> 15), q | 1); q ^= q + Math.imul(q ^ (q >>> 7), q | 61); return ((q ^ (q >>> 14)) >>> 0) / 4294967296; };
}

const SESSIONS = Number(process.env.MOSHE_SESSIONS || 12), STEPS = Number(process.env.MOSHE_STEPS || 25);

test(`sync: two devices and the server end the same, nothing typed lost (${SESSIONS} sessions × ${STEPS} steps)`, async () => {
  const problems = [];
  for (let s = 0; s < SESSIONS && !problems.length; s++) {
    const r = rng(1000 + s + Number(process.env.MOSHE_SEED || 0));
    const root = mkdtempSync(join(tmpdir(), 'moshe-fz-'));
    mkdirSync(join(root, 'Notes', 'A'), { recursive: true });
    mkdirSync(join(root, 'Notes', 'B'), { recursive: true });
    writeFileSync(join(root, 'Notes', 'A', 'One.md'), '# One\nfirst line\n');
    const app = await createApp({ root, authFile: join(root, '..', `${root.split('/').pop()}-auth.json`), watch: false, backupEvery: 0 });
    const addr = await app.listen(0, '127.0.0.1');
    const url = `http://127.0.0.1:${addr.port}/dav/`;
    const devices = [];
    for (let d = 0; d < 2; d++) {
      const store = await Store.open(new MemoryStorage(), { onWriteError: () => {} });
      devices.push({ store, sync: new WebDavSync(store, { url }) });
    }
    const server = await Store.open(new NodeStorage(root));      // someone at the server (Obsidian, say)
    const typed = new Set();
    let n = 0;
    const word = () => ['river', 'lamp', 'hesed', 'stone', 'Gregor', 'window', 'salt'][Math.floor(r() * 7)];
    try {
      for (let step = 0; step < STEPS; step++) {
        const who = Math.floor(r() * 3);
        const store = who < 2 ? devices[who].store : server;
        if (who === 2) await server.scanChanges();
        const sheets = store.allSheets(false);
        const op = r();
        if (op < 0.3 || !sheets.length) {
          const para = `p${s}.${n++} ${word()} ${word()}`;
          typed.add(para);
          store.createSheet(r() < 0.5 ? 'Notes/A' : 'Notes/B', { text: `# S${n}\n${para}\n` });
        } else if (op < 0.75) {
          const p = sheets[Math.floor(r() * sheets.length)];
          const body = store.openSheet(p).body;
          const para = `p${s}.${n++} ${word()} ${word()}`;
          typed.add(para);
          const lines = body.split('\n');
          lines.splice(1 + Math.floor(r() * (lines.length - 1)), 0, para);
          store.saveSheet(p, lines.join('\n'), body);
        } else if (op < 0.85) {
          const p = sheets[Math.floor(r() * sheets.length)];
          store.moveSheets([p], p.startsWith('Notes/A/') ? 'Notes/B' : 'Notes/A');
        } else if (op < 0.9) {
          store.trashSheet(sheets[Math.floor(r() * sheets.length)]);
        } else {
          const p = sheets[Math.floor(r() * sheets.length)];
          store.setFavorite(p, r() < 0.5);
        }
        await store.flush();
        if (r() < 0.4) await devices[Math.floor(r() * 2)].sync.sync();
      }
      // everyone syncs until nothing moves
      for (let round = 0; round < 6; round++) {
        await server.scanChanges();
        for (const d of devices) await d.sync.sync();
      }
      await server.scanChanges();
      const texts = async (st) => { const t = await st.syncTexts(); return Object.fromEntries([...t].filter(([p]) => !p.endsWith('.moshe.json')).sort()); };
      const [a, b, srv] = [await texts(devices[0].store), await texts(devices[1].store), await texts(server)];
      if (JSON.stringify(a) !== JSON.stringify(srv)) problems.push(`session ${s}: device A and the server differ\n${JSON.stringify(a).slice(0, 600)}\n${JSON.stringify(srv).slice(0, 600)}`);
      if (JSON.stringify(b) !== JSON.stringify(srv)) problems.push(`session ${s}: device B and the server differ`);
      if (Object.keys(srv).filter((p) => p.endsWith('.md')).length < 2) problems.push(`session ${s}: the server holds almost nothing — the test is not testing`);
      const everything = Object.values(srv).join('\n');
      for (const para of typed) if (!everything.includes(para)) problems.push(`session ${s}: lost ${JSON.stringify(para)}`);
    } finally {
      await app.close();
    }
  }
  if (problems.length) assert.fail(problems.slice(0, 5).join('\n\n'));
});
