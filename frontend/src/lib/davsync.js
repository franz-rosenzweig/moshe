// The built-in sync, for a device that keeps its own copy of the library and
// has no Syncthing (the Android app's own folder, say): kept in step with a
// Moshe server (or any WebDAV folder) by engine/src/webdav.js. Set up in
// Settings → Sync; the address and the token stay in this device's storage,
// never in the library.
import { WebDavSync } from '@engine/webdav.js';

const KEY = 'moshe.sync';
export const syncState = { config: null, running: false, last: null, error: null, listeners: new Set() };

export function loadConfig() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
export function saveConfig(cfg) {
  try { if (cfg) localStorage.setItem(KEY, JSON.stringify(cfg)); else localStorage.removeItem(KEY); } catch { /* not kept */ }
}

let sync = null, timer = null, every = null;
const tell = () => { for (const f of syncState.listeners) try { f(syncState); } catch { /* */ } };

/** Start syncing a store with the configured server (or stop, with none). */
export function startSync(store, storage, cfg = loadConfig()) {
  stopSync();
  syncState.config = cfg;
  if (!cfg || !cfg.url) { tell(); return; }
  const useShell = storage && storage.httpFetch && cfg.viaShell !== false;
  sync = new WebDavSync(store, { url: cfg.url, token: cfg.token || undefined, user: cfg.user, password: cfg.password, fetch: useShell ? storage.httpFetch() : undefined });
  const off = store.on((ev) => { if (!ev.external) soon(5000); });
  const run = async () => {
    if (syncState.running) return;
    syncState.running = true; tell();
    try { syncState.last = await sync.sync(); syncState.error = null; } catch (e) { syncState.error = e.message || String(e); }
    syncState.running = false; tell();
  };
  const soon = (ms) => { clearTimeout(timer); timer = setTimeout(run, ms); };
  every = setInterval(() => { if (document.visibilityState === 'visible') run(); }, 5 * 60e3);
  const vis = () => { if (document.visibilityState === 'visible') soon(300); };
  document.addEventListener('visibilitychange', vis);
  sync._stop = () => { off(); document.removeEventListener('visibilitychange', vis); };
  syncState.now = run;
  soon(200);
}

export function stopSync() {
  clearTimeout(timer); clearInterval(every);
  if (sync && sync._stop) sync._stop();
  sync = null;
  syncState.now = null;
}
