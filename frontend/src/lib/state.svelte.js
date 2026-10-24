// The app's state: which group is selected, which sheet is open, how the
// window is laid out, and the library itself (the engine's store, which the
// page runs: engine/src/store.js). `app.version` goes up whenever the store
// changes, and everything that reads the library reads it again.
import { Store } from '@engine/store.js';
import { HttpStorage } from '@engine/storage-http.js';
import { detectNativeStorage } from '@engine/storage-bridge.js';

const SAVED = 'moshe.ui';
const load = () => { try { return JSON.parse(localStorage.getItem(SAVED) || '{}') || {}; } catch { return {}; } };
const saved = load();

export const app = $state({
  phase: 'starting',          // starting | login | ready | error
  error: null,
  version: 0,
  mode: 'server',             // server | folder
  // what is shown
  selection: saved.selection || 'Notes',
  project: saved.project || null,           // the project the library is showing, or null for the whole library
  sheet: saved.sheet || null,               // the sheet in the editor
  selected: saved.sheet ? [saved.sheet] : [], // sheets selected in the list
  second: null,               // the sheet in the second editor, if split
  translation: !!saved.translation, // translation mode: the open sheet's counterpart beside it
  splitVertical: false,
  dimSecond: false,
  panes: saved.panes || 3,    // 3: library, list and editor; 2: list and editor; 1: editor
  widths: saved.widths || {}, // the panes' widths as dragged: { lib, list, dash } in px
  dashboard: !!saved.dashboard,
  dashboardView: saved.dashboardView || 'overview',
  focus: 'editor',            // library | list | editor: where the keyboard is
  history: [], future: [],    // sheets visited, for back and forward
  hints: saved.hints || {},   // hint cards dismissed
  expanded: saved.expanded || {},
  settingsOpen: null,         // null or the pane of Settings shown
  settingsPane: false,        // on a phone: a pane of Settings pushed over its list
  quickOpen: false,
  search: null,
  revision: false,
  interfaceHidden: false,     // Hide Interface (⌘.): only the text
  revisionKind: null,
  drawer: 0,                  // a tablet: the panes slid over the editor (0 none, 2 the sheets, 3 the library too)
  selectionStats: null,       // the statistics of the text selected in the editor, for the dashboard         // in revision mode, the one kind of markup emphasised: annotation | comment | mark | delete
  typewriter: saved.typewriter || { marker: false, highlight: 'off', fixed: 'off' },
  counter: saved.counter || 'words',
  toast: null,
  syncing: false,
  lastSync: null,
  fullscreen: false,
  phone: 'list',              // on a phone, the one pane shown: library | list | editor
  unsaved: 0,                 // writes the server has not taken yet
});

export const prefs = $state({
  font: 'System Font', fontSize: 16, lineHeight: 1.6, paragraphSpacing: 0, firstLineIndent: 0, lineWidth: 64,
  imagePreviews: true, imageLines: 4, imageColor: false, caret: 'accent', theme: 'Moshe', appearance: 'system',
  smartLists: true, smartTags: true, penMarks: true, showCounter: true, pageBackground: false, alwaysLightEditor: false,
  paragraphNumbers: false, sheetListDates: false, previewLines: 4, spellcheck: true, grammar: true, dialect: 0, hebrewSpelling: true, dashSections: null, dashFolded: null,
  ...(saved.prefs || {}),
});

/** @type {Store|null} */
export let store = null;
let storage = null;

export function persist() {
  try {
    localStorage.setItem(SAVED, JSON.stringify({
      selection: app.selection, project: app.project, sheet: app.sheet, panes: app.panes, widths: app.widths, dashboard: app.dashboard,
      dashboardView: app.dashboardView, hints: app.hints, expanded: app.expanded, typewriter: app.typewriter,
      counter: app.counter, translation: app.translation, prefs: { ...prefs },
    }));
  } catch { /* private window: nothing kept, nothing lost */ }
}

export const bump = () => { app.version++; };

export function toast(message, ms = 2600) {
  app.toast = { message, at: Date.now() };
  const at = app.toast.at;
  setTimeout(() => { if (app.toast && app.toast.at === at) app.toast = null; }, ms);
}

/** The site's sign-in state: {required, authenticated}. */
async function authState() {
  try {
    const r = await fetch('/api/auth', { credentials: 'same-origin' });
    if (!r.ok) return { required: false, authenticated: true };
    return await r.json();
  } catch { return null; }
}

export async function signIn(password) {
  const r = await fetch('/api/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'could not sign in');
  await start();
}

export async function signOut() {
  await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
  location.reload();
}

let scanTimer = null, scanning = null;
/** Read what someone else changed, soon: several nudges in a burst are one scan. */
export function rescan(delay = 150) {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(async () => {
    if (!store) return;
    if (scanning) { rescan(400); return; }
    scanning = store.scanChanges().catch((e) => console.warn('moshe: scan', e)).finally(() => { scanning = null; });
    await scanning;
  }, delay);
}

export async function start() {
  app.phase = 'starting';
  try {
    const native = detectNativeStorage(window);
    if (native) {
      app.mode = 'folder';
      storage = native;
    } else {
      const a = await authState();
      if (a && a.required && !a.authenticated) { app.phase = 'login'; return; }
      storage = new HttpStorage('');
      storage.onUnauthorized = () => { app.phase = 'login'; };
    }
    store = await Store.open(storage, { onWriteError: (e, op) => { console.error('moshe: write', op, e); journal(); app.unsaved = Object.keys(store.unsaved()).length; if (op.op === 'write') toast('Not saved yet: the server could not be reached. Moshe keeps trying.', 6000); else toast(`Could not change ${op.path || op.to || ''}: ${e.message}`, 6000); } });
    await replayJournal();
    window.__mosheStore = store;
    // for a shell's self-test and the browser tests (docs/BRIDGE.md, "Checking a shell")
    window.__mosheLocal = {
      mode: app.mode,
      flush: () => store.flush(),
      conformance: async () => (await import('@engine/storage-conformance.js')).conformance(storage),
      snapshot: async () => { await store.flush(); return Object.fromEntries([...store._disk].map(([p, r]) => [p, r.text])); },
      rescan: () => store.scanChanges(),
    };
    store.on((ev) => {
      if (ev.saved) { app.unsaved = 0; journal(); toast('Saved'); }
      if (ev.renamed) {
        for (const [from, to] of Object.entries(ev.renamed)) follow(from, to);
      }
      bump();
    });
    await store.flush();
    if (!store.exists(app.selection.split('#')[0]) && !['all', 'notes-all', 'recent', 'favorites', 'trash'].includes(app.selection) && !app.selection.startsWith('filter:')) app.selection = 'Notes';
    if (app.project && !store.exists(app.project)) app.project = null;
    if (app.sheet && !store.exists(app.sheet)) { app.sheet = null; app.selected = []; }
    if (!app.sheet) {
      const first = store.sheetList(app.selection).sections.flatMap((x) => x.sheets)[0];
      if (first) { app.sheet = first.path; app.selected = [first.path]; }
    }
    watchForChanges();
    setInterval(() => { if (store && store._failed.size) store.retryFailed(); }, 10000);
    // goals' daily history: where each day started, and where it has got to
    store.recordProgress();
    setInterval(() => { if (store) store.recordProgress(); }, 5 * 60e3);
    if (app.mode === 'folder') import('./davsync.js').then((m) => m.startSync(store, storage));
    shareFromUrl();
    app.phase = 'ready';
    bump();
  } catch (e) {
    console.error(e);
    app.error = e && e.message ? e.message : String(e);
    app.phase = 'error';
  }
}

/** ?share=<text> (Android's share target, a Mac share extension): a new sheet in the Inbox. */
function shareFromUrl() {
  const u = new URL(location.href);
  const text = u.searchParams.get('share');
  if (!text) return;
  u.searchParams.delete('share');
  history.replaceState(null, '', u.pathname + (u.search.length > 1 ? u.search : '') + u.hash);
  const p = store.createSheet('Notes', { text: text.endsWith('\n') ? text : text + '\n' });
  app.selection = 'Notes';
  app.project = null;
  app.sheet = p;
  app.selected = [p];
  app.phone = 'editor';
  toast('Added to the Inbox');
}

/** Android's back gesture: back one pane on a phone. True if it went back. */
// (window.mosheBack, the Android Back key, is App.svelte's: it closes what's open there first)

// ---- what could not be saved, kept in this browser until it is -----------------
const JOURNAL = 'moshe.unsaved';

/** The texts storage refused, with what the files said when they were last saved, into this browser. */
function journal() {
  try {
    const u = store ? store.unsaved() : {};
    const entries = Object.entries(u).map(([path, text]) => {
      const h = store._history.get(path) || [];
      return { path, text, base: h.length > 1 ? h[h.length - 2] : null };
    });
    if (entries.length) localStorage.setItem(JOURNAL, JSON.stringify(entries)); else localStorage.removeItem(JOURNAL);
  } catch { /* nothing more to do */ }
}

/** What an earlier page could not save: written now, merged with the file if it changed meanwhile. */
async function replayJournal() {
  let entries = [];
  try { entries = JSON.parse(localStorage.getItem(JOURNAL) || '[]'); } catch { entries = []; }
  if (!entries.length) return;
  const { mergeText } = await import('@engine/merge.js');
  let n = 0;
  for (const e of entries) {
    const now = store.text(e.path);
    if (now === e.text) continue;
    const text = now === null || now === e.base || e.base === null ? e.text : mergeText(e.base, e.text, now).text;
    store.writeText(e.path, text);
    n++;
  }
  await store.flush();
  if (!Object.keys(store.unsaved()).length) localStorage.removeItem(JOURNAL);
  if (n) toast(`Recovered ${n} unsaved change${n === 1 ? '' : 's'} from before`);
}

window.addEventListener('beforeunload', (e) => {
  if (store && Object.keys(store.unsaved()).length) { journal(); e.preventDefault(); e.returnValue = ''; }
});
window.addEventListener('online', () => { if (store) { store.retryFailed(); } });

/** A path renamed or moved: whatever pointed at it follows. */
function follow(from, to) {
  const swap = (p) => (p === from ? to : p && p.startsWith(from + '/') ? to + p.slice(from.length) : p);
  app.sheet = swap(app.sheet);
  app.second = swap(app.second);
  app.selected = app.selected.map(swap);
  app.selection = swap(app.selection);
  app.project = swap(app.project);
  app.history = app.history.map(swap);
  app.future = app.future.map(swap);
  persist();
}

function watchForChanges() {
  if (app.mode === 'server') {
    let es = null;
    const connect = () => {
      es = new EventSource('/api/events');
      es.addEventListener('changed', () => rescan());
      es.addEventListener('hello', () => rescan(50));
      es.onerror = () => { es.close(); setTimeout(connect, 5000); };
    };
    connect();
    setInterval(() => { if (document.visibilityState === 'visible') rescan(0); }, 60000);
  } else {
    window.__mosheFilesChanged = () => rescan(50);
    storage.info?.().then((info) => {
      const every = info && info.pollSeconds ? info.pollSeconds * 1000 : 0;
      if (every) setInterval(() => { if (document.visibilityState === 'visible') rescan(0); }, every);
    }).catch(() => {});
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') rescan(0); });
  window.addEventListener('focus', () => rescan(0));
}

// ---- moving around ------------------------------------------------------------

/** Select a group (or a filter, All, Trash…) in the library. */
export function select(sel, { keepSheet = false } = {}) {
  app.selection = sel;
  app.focus = 'library';
  app.phone = 'list';
  if (!keepSheet && store) {
    const list = store.sheetList(sel);
    const first = list.sections.flatMap((s) => s.sheets)[0];
    if (!list.trash) openSheet(first ? first.path : null, { fromList: true });
  }
  persist();
}

/** Open a sheet in the editor (and remember where we came from). */
export function openSheet(path, { fromList = false, second = false } = {}) {
  if (second) { app.second = path; return; }
  if (path === app.sheet) { app.selected = path ? [path] : []; return; }
  if (app.sheet && path) { app.history = [...app.history.slice(-50), app.sheet]; app.future = []; }
  app.sheet = path;
  app.selected = path ? [path] : [];
  if (!fromList) app.focus = 'editor';
  persist();
}

/** On a phone: a sheet tapped in the list opens the editor. */
export function phoneOpen(path) {
  openSheet(path, { fromList: true });
  app.phone = 'editor';
}

export function back() {
  if (!app.history.length) return;
  const prev = app.history[app.history.length - 1];
  app.history = app.history.slice(0, -1);
  if (app.sheet) app.future = [app.sheet, ...app.future];
  app.sheet = prev;
  app.selected = [prev];
  revealSheet(prev);
}

export function forward() {
  if (!app.future.length) return;
  const next = app.future[0];
  app.future = app.future.slice(1);
  if (app.sheet) app.history = [...app.history, app.sheet];
  app.sheet = next;
  app.selected = [next];
  revealSheet(next);
}

/** Show the group a sheet is in, so the list holds it. */
export function revealSheet(path) {
  if (!store || !path) return;
  const dir = path.slice(0, path.lastIndexOf('/'));
  const inList = store.sheetList(app.selection).sections.some((s) => s.sheets.some((x) => x.path === path));
  if (inList) return;
  const proj = store.projectOf(path);
  app.project = proj;
  app.selection = proj && dir === proj ? `${proj}#pending` : dir;
  persist();
}

export function openProject(path) {
  app.project = path;
  const node = store.projectNode(path);
  const first = node.groups[0];
  select(first ? first.path : `${path}#pending`);
}

export function closeProject() {
  app.project = null;
  select('Notes');
}

export function setPanes(n) {
  app.panes = app.panes === n && n !== 3 ? 3 : n;
  persist();
}

/** The store's own storage, for images and the like. */
export const theStorage = () => storage;

/** Who keeps backups of this library: the server it lives on, the server a
 *  folder library syncs with (Settings › Sync), or no one. */
export function backupKeeper() {
  if (app.mode === 'server') return { kind: 'server' };
  let cfg = null;
  try { cfg = JSON.parse(localStorage.getItem('moshe.sync') || 'null'); } catch { /* none */ }
  if (!cfg || !cfg.url) return { kind: 'none' };
  let host = cfg.url;
  try { host = new URL(cfg.url).host; } catch { /* as written */ }
  return { kind: 'synced', host };
}

/** What Empty Trash says about getting a sheet back. */
export function trashWarning() {
  const k = backupKeeper().kind;
  return k === 'server' ? 'Everything in it is erased for good. The server\'s backups still hold it.'
    : k === 'synced' ? 'Everything in it is erased for good. The backups of the server this library syncs with hold what reached it.'
    : 'Everything in it is erased for good.';
}
