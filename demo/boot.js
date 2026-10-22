// The taste's start (stuffs.tiresia.xyz/moshe/): Moshe's own page, unchanged,
// with its library kept in this browser instead of on a server. The engine
// takes any storage a page hands it as window.mosheStorage (the same door the
// Mac and Android shells use, docs/BRIDGE.md), so this gives it one in
// IndexedDB, filled with the sample library (library.json, made from
// demo/library.mjs) the first time. Nothing here talks to a server: the few
// calls the page makes to its own server (/api/…) are answered "not here"
// before they leave the browser.
import { IdbStorage } from '@engine/storage-idb.js';
import { MemoryStorage } from '@engine/storage.js';

const DB = 'moshe-taste';
const FIRST = { selection: 'Notes/Getting Started', sheet: 'Notes/Getting Started/Welcome to Moshe.md' };

const realFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (/^\/(api|dav|_library)\//u.test(url) || url.startsWith(`${location.origin}/api/`)) {
    return Promise.resolve(new Response(JSON.stringify({ error: 'not in the demo' }), { status: 404, headers: { 'Content-Type': 'application/json' } }));
  }
  return realFetch(input, init);
};

/** IndexedDB, with what Settings and the sync ask a shell's storage. */
class TasteStorage extends IdbStorage {
  async info() { return { name: 'This browser', detail: 'A demo library, kept only in this browser', canPick: false, canUseServer: false, pollSeconds: 0 }; }
}
class TasteMemory extends MemoryStorage {
  async info() { return { name: 'This page', detail: 'A demo library, gone when the page closes', canPick: false, canUseServer: false, pollSeconds: 0 }; }
}

async function sample() {
  const r = await realFetch('./library.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error(`the sample library did not load (${r.status})`);
  return r.json();
}

async function fill(storage, lib) {
  for (const d of lib.dirs) await storage.mkdir(d);
  for (const [path, text] of Object.entries(lib.files)) await storage.write(path, text);
}

async function storage() {
  try {
    const s = new TasteStorage(DB);
    const { files } = await s.list();
    if (!files.length) {
      await fill(s, await sample());
      try { if (!localStorage.getItem('moshe.ui')) localStorage.setItem('moshe.ui', JSON.stringify(FIRST)); } catch { /* none kept */ }
    }
    return s;
  } catch (e) {
    // no IndexedDB here (some private windows): the library lives in the page until it closes
    console.warn('moshe demo: keeping the library in memory', e);
    const s = new TasteMemory();
    await fill(s, await sample());
    return s;
  }
}

// (no top-level await: the build targets ES2020, as the app's own does)
storage().then((s) => {
  window.mosheStorage = s;
  return import('../frontend/src/main.js');
}).catch((e) => {
  document.getElementById('app').innerHTML = '<p style="font: 15px system-ui; padding: 24px">The demo could not start in this browser.</p>';
  console.error(e);
});
