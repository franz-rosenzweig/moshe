// The library, kept in memory and changed file by file (docs/FORMAT.md). The
// folder is the database: every change here is a write, a move or a removal
// in storage, queued in order, and what someone else changes there (Obsidian,
// a sync) is read back by scanChanges().
//
// The shape is Dvarim's store: the store works on its own copy of the library,
// synchronously, and a queue carries each change to storage, which is
// asynchronous everywhere (the native shells' bridges, the server over HTTP).
// `flush()` waits for the queue.
import { readEach } from './storage.js';
import { conflictOriginal, copyTime, likelyBase, mergeSidecar, mergeText } from './merge.js';
import { addStats, emptyStats, formatGoal, metricOf, parseGoal, plainText, readMeta, setMeta, sheetPreview, splitSheet, stats } from './sheet.js';
import { PROJECT_TEMPLATES } from './templates.js';

export const NOTES = 'Notes', PROJECTS = 'Projects', EXTRAS = 'Extras', TEMPLATES = 'Templates';
export const SIDECAR = '.moshe.json';
export const LIBRARY_META = '.moshe/library.json';
export const TRASH = '.moshe/trash';
export const TRASH_META = `${TRASH}/${SIDECAR}`;
export const CONFLICTS = '.moshe/conflicts';
const OLD_COPY = 2 * 86400e3;
const TOMBSTONE_DAYS = 30;

export const baseName = (p) => p.slice(p.lastIndexOf('/') + 1);
export const dirOf = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };
export const joinPath = (d, n) => (d ? `${d}/${n}` : n);
const hiddenName = (n) => n.startsWith('.') || n.startsWith('_');
const parents = (p) => { const parts = p.split('/'); return parts.slice(1).map((_, i) => parts.slice(0, i + 1).join('/')); };
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const byName = (a, b) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
export const readText = (r) => (r ? { ...r, text: r.text.replace(/\r\n?/gu, '\n') } : r);

/** Is this a section's own folder or a group in one? (Notes, Notes/…, Projects/X/…) */
export function isGroupDir(d) {
  const parts = d.split('/');
  if (parts.some((p) => !p || hiddenName(p))) return false;
  if (parts[0] === NOTES) return true;
  return parts[0] === PROJECTS && parts.length >= 2;
}

/** Is this a sheet: a .md file in a group, the Inbox, or a project? */
export function isSheet(p) {
  if (!p.endsWith('.md') || conflictOriginal(p) !== null) return false;
  const d = dirOf(p);
  if (hiddenName(baseName(p))) return false;
  return isGroupDir(d) && d !== PROJECTS;
}

export const isSidecar = (p) => baseName(p) === SIDECAR && (isGroupDir(dirOf(p)) || dirOf(p) === PROJECTS || p === TRASH_META);
const isTrashed = (p) => p.startsWith(TRASH + '/') && (p.endsWith('.md') || p === TRASH_META);

/** Every file the store reads. */
export const tracked = (p) => isSheet(p) || isSidecar(p) || p === LIBRARY_META || isTrashed(p);

/** What a sync the app runs itself carries (webdav.js), and what the server
 *  offers one (server/src/dav.js): the sheets, the folders' settings, the
 *  library's, and the trash. */
export function syncable(p) {
  if (p.split('/').some((s) => s === '' || s === '.' || s === '..')) return false;
  return tracked(p) && conflictOriginal(p) === null;
}

/** A file name from a title: what a file system takes, and short. */
export function fileName(title) {
  let n = String(title || '').replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/gu, ' ').replace(/\s+/gu, ' ').trim().replace(/^[.\s_]+/u, '').replace(/[.\s]+$/u, '');
  if ([...n].length > 80) n = [...n].slice(0, 80).join('').replace(/[\s.]+$/u, '');
  return n || 'Untitled';
}
const PROVISIONAL = /^Untitled(?: \d+)?\.md$/u;

export class Store {
  /**
   * @param {object} storage  see storage.js
   * @param {{now?: () => number, onWriteError?: Function}} [opts]
   */
  constructor(storage, opts = {}) {
    this.storage = storage;
    this.now = opts.now || (() => Date.now());
    this.onWriteError = opts.onWriteError || null;
    this.tree = { files: new Set(), dirs: new Set() };
    this._disk = new Map();      // path -> {text, mtime}: every tracked file as last read or written
    this._history = new Map();   // path -> texts, oldest first: what a merge starts from
    this._meta = new Map();      // path of a .moshe.json or library.json -> its stamped values
    this._info = new Map();      // sheet path -> what the lists show of it, for the text it had
    this._kids = null;           // dir -> {dirs, files}: the tree, indexed, until it changes
    this._moved = new Map();     // path -> where this store moved it (null: erased): a late save follows it
    this._failed = new Map();    // path -> a write storage refused (the network, say): tried again
    this.listeners = [];
    this.syncLog = [];
    this._queue = [];
    this._writes = 0;
    this._flushing = null;
  }

  static async open(storage, opts = {}) {
    const store = new Store(storage, opts);
    const listing = await storage.list();
    store._setTree(listing);
    const paths = [...store.tree.files].filter(tracked);
    const texts = await readEach(storage, paths);
    paths.forEach((p, i) => { const r = readText(texts[i]); if (r) store._adopt(p, r); });
    store.ensureLayout();
    // conflict copies left while nothing was running
    await store._mergeCopies([...store.tree.files].filter((p) => conflictOriginal(p) !== null && tracked(conflictOriginal(p))));
    return store;
  }

  on(cb) { this.listeners.push(cb); return () => { this.listeners = this.listeners.filter((x) => x !== cb); }; }

  notify(paths, extra = {}) {
    for (const cb of [...this.listeners]) {
      try { cb({ paths, ...extra }); } catch { /* a listener never breaks a write */ }
    }
  }

  // ------------------------------------------------------------------ storage
  _setTree(listing) {
    this.tree = { files: new Set(listing.files), dirs: new Set(listing.dirs) };
    this._kids = null;
  }

  _enqueue(op) {
    this._writes++;
    if (op.op === 'write') {
      // a newer text for a file still waiting to be written replaces the older,
      // unless something moves or removes files after it
      for (let i = this._queue.length - 1; i >= 0; i--) {
        const q = this._queue[i];
        if (q.op !== 'write' && q.op !== 'mkdir') break;
        if (q.op === 'write' && q.path === op.path) { q.text = op.text; return; }
      }
    }
    this._queue.push(op);
    if (!this._flushing) this._flushing = Promise.resolve().then(() => this._drain());
  }

  async _drain() {
    while (this._queue.length) {
      const op = this._queue.shift();
      try {
        if (op.op === 'write') {
          const r = await this.storage.write(op.path, op.text);
          const m = this._disk.get(op.path);
          if (m && m.text === op.text && r && r.mtime !== undefined) m.mtime = r.mtime;
          if (this._failed.has(op.path) && this._failed.get(op.path).text === op.text) {
            this._failed.delete(op.path);
            if (!this._failed.size) this.notify([], { saved: true });
          }
        } else if (op.op === 'remove') await this.storage.remove(op.path);
        else if (op.op === 'move') await this.storage.move(op.from, op.to);
        else if (op.op === 'removeDir') await this.storage.removeDir(op.path);
        else if (op.op === 'mkdir') await this.storage.mkdir(op.path);
      } catch (e) {
        // a write that did not reach storage is kept, and tried again
        // (retryFailed): the text is still here, and must get there
        if (op.op === 'write' && (!e.code || e.code === 'EIO' || e.code === 'EACCES')) this._failed.set(op.path, op);
        if (this.onWriteError) this.onWriteError(e, op);
        else console.error('moshe: storage', op.op, op.path || op.from, e);
      }
    }
    this._flushing = null;
  }

  /** A file's text set as it is (a recovered edit, say). */
  writeText(path, text) {
    this._put(path, text);
    this.notify([path]);
  }

  /** Writes storage refused, as they stand now: {path: text}. */
  unsaved() {
    const out = {};
    for (const [p, op] of this._failed) out[p] = this._disk.has(p) ? this._disk.get(p).text : op.text;
    return out;
  }

  /** Try the refused writes again, each with the file's text as it is now. */
  retryFailed() {
    for (const [p, op] of this._failed) {
      const text = this._disk.has(p) ? this._disk.get(p).text : op.text;
      this._failed.set(p, { ...op, text });
      this._enqueue({ op: 'write', path: p, text });
    }
  }

  /** Resolves once every change made so far is in storage. */
  async flush() {
    while (this._flushing) await this._flushing;
  }

  /** A file's text as read from storage: into the copy, the history, the caches. */
  _adopt(path, r) {
    this._disk.set(path, { text: r.text, mtime: r.mtime });
    this._remember(path, r.text);
    this._parse(path);
  }

  _remember(path, text) {
    const h = this._history.get(path);
    if (!h) this._history.set(path, [text]);
    else if (h[h.length - 1] !== text) {
      h.push(text);
      if (h.length > 40) h.splice(0, h.length - 40);
    }
  }

  _parse(path) {
    const r = this._disk.get(path);
    if (!r) { this._meta.delete(path); this._info.delete(path); return; }
    if (baseName(path) === SIDECAR || path === LIBRARY_META) {
      let v = {};
      try { v = JSON.parse(r.text); } catch { /* unreadable: nothing set */ }
      this._meta.set(path, v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    } else this._info.delete(path);
  }

  /** Write a file: into the copy at once, into storage in order. */
  _put(path, text) {
    if (!this.tree.files.has(path)) {
      this.tree.files.add(path);
      for (const d of parents(path)) this.tree.dirs.add(d);
      this._kids = null;
    }
    this._disk.set(path, { text, mtime: this.now() });
    this._remember(path, text);
    this._parse(path);
    this._enqueue({ op: 'write', path, text });
  }

  _mkdir(dir) {
    const all = [...parents(dir + '/x')];
    let made = false;
    for (const d of all) if (!this.tree.dirs.has(d)) { this.tree.dirs.add(d); made = true; }
    if (made) { this._kids = null; this._enqueue({ op: 'mkdir', path: dir }); }
  }

  _removeFile(path) {
    this.tree.files.delete(path);
    this._disk.delete(path);
    this._meta.delete(path);
    this._info.delete(path);
    this._kids = null;
    this._enqueue({ op: 'remove', path });
  }

  /** A folder and everything in it, gone. */
  _removeTree(dir) {
    const prefix = dir + '/';
    for (const f of [...this.tree.files]) if (f.startsWith(prefix)) this._removeFile(f);
    const dirs = [...this.tree.dirs].filter((d) => d === dir || d.startsWith(prefix)).sort((a, b) => b.length - a.length);
    for (const d of dirs) { this.tree.dirs.delete(d); this._enqueue({ op: 'removeDir', path: d }); }
    this._kids = null;
  }

  /** A file or a folder moved, and every copy and cache keyed by its paths with it. */
  _move(from, to) {
    const rekey = (map, a, b) => { if (map.has(a)) { map.set(b, map.get(a)); map.delete(a); } };
    if (this.tree.files.has(from)) {
      this.tree.files.delete(from);
      this.tree.files.add(to);
      for (const m of [this._disk, this._history, this._meta, this._info]) rekey(m, from, to);
      this._moved.set(from, to);
    } else {
      const prefix = from + '/';
      for (const f of [...this.tree.files]) {
        if (!f.startsWith(prefix)) continue;
        const g = to + f.slice(from.length);
        this.tree.files.delete(f);
        this.tree.files.add(g);
        for (const m of [this._disk, this._history, this._meta, this._info]) rekey(m, f, g);
        this._moved.set(f, g);
      }
      for (const d of [...this.tree.dirs]) {
        if (d === from || d.startsWith(prefix)) { this.tree.dirs.delete(d); this.tree.dirs.add(to + d.slice(from.length)); }
      }
    }
    for (const d of parents(to)) this.tree.dirs.add(d);
    this._kids = null;
    this._enqueue({ op: 'move', from, to });
  }

  exists(path) { return this.tree.files.has(path) || this.tree.dirs.has(path); }

  /** `name` in `dir`, or "name 2", "name 3"… if that is taken. */
  uniquePath(dir, name) {
    const dot = name.endsWith('.md') ? name.length - 3 : name.length;
    const stem = name.slice(0, dot), ext = name.slice(dot);
    let p = joinPath(dir, name);
    for (let n = 2; this.exists(p) || this._kidsLower(dir).has(baseName(p).toLowerCase()); n++) p = joinPath(dir, `${stem} ${n}${ext}`);
    return p;
  }

  /** Names in a folder, lower-cased: a Mac's disk does not tell "a" from "A". */
  _kidsLower(dir) {
    const k = this._children(dir);
    return new Set([...k.dirs, ...k.files, ...(k.other || [])].map((n) => n.toLowerCase()));
  }

  ensureLayout() {
    for (const d of [NOTES, PROJECTS]) if (!this.tree.dirs.has(d)) this._mkdir(d);
  }

  // ------------------------------------------------------------------ the tree
  _children(dir) {
    if (!this._kids) {
      const kids = new Map();
      const at = (d) => { let k = kids.get(d); if (!k) { k = { dirs: [], files: [], other: [] }; kids.set(d, k); } return k; };
      for (const d of this.tree.dirs) at(dirOf(d)).dirs.push(baseName(d));
      for (const f of this.tree.files) {
        const k = at(dirOf(f));
        if (isSheet(f)) k.files.push(baseName(f)); else k.other.push(baseName(f));
      }
      this._kids = kids;
    }
    return this._kids.get(dir) || { dirs: [], files: [], other: [] };
  }

  /** The subgroups of a group, in its order. */
  subgroups(dir) {
    let names = this._children(dir).dirs.filter((n) => !hiddenName(n));
    if (dir === PROJECTS) names = [];
    else if (dirOf(dir) === PROJECTS) names = names.filter((n) => n !== EXTRAS);
    else if (this.isExtras(dir)) {
      names = names.filter((n) => n !== TEMPLATES);
    }
    const order = this._order(dir, 'groups', names);
    if (this.isExtras(dir)) order.push(TEMPLATES);
    return order.map((n) => joinPath(dir, n));
  }

  isExtras(dir) { return dirOf(dirOf(dir)) === PROJECTS && baseName(dir) === EXTRAS; }
  isTemplates(dir) { return this.isExtras(dirOf(dir)) && baseName(dir) === TEMPLATES; }

  /** The project a path is in, or null. */
  projectOf(path) {
    const parts = path.split('/');
    return parts[0] === PROJECTS && parts.length >= 2 ? `${PROJECTS}/${parts[1]}` : null;
  }

  /** Names in a sidecar's order: those listed first, in that order, then the rest by name. */
  _order(dir, key, names) {
    const listed = this.sget(dir, key, []) || [];
    const here = new Set(names);
    const out = listed.filter((n) => here.has(n));
    const seen = new Set(out);
    return [...out, ...names.filter((n) => !seen.has(n)).sort(byName)];
  }

  /** The sheets directly in a folder, in its sort order. */
  sheetsIn(dir) {
    const names = this._children(dir).files;
    const sort = this.sget(dir, 'sort', 'manual') || 'manual';
    if (sort === 'manual') return this._order(dir, 'sheets', names).map((n) => joinPath(dir, n));
    const rev = sort.startsWith('-');
    const key = rev ? sort.slice(1) : sort;
    const info = names.map((n) => this.sheetInfo(joinPath(dir, n)));
    const val = (s) => (key === 'title' ? s.title.toLowerCase() : key === 'created' ? s.created : s.modified);
    info.sort((a, b) => {
      const x = val(a), y = val(b);
      const c = key === 'title' ? collator.compare(x, y) : x - y;
      return (rev ? -c : c) || byName(a.name, b.name);
    });
    return info.map((s) => s.path);
  }

  /** Every sheet in a group and the groups inside it, in order. */
  sheetsUnder(dir) {
    const out = [...this.sheetsIn(dir)];
    for (const g of this.subgroups(dir)) out.push(...this.sheetsUnder(g));
    return out;
  }

  // ------------------------------------------------------------------ sidecars
  _sideOf(dir) { return joinPath(dir, SIDECAR); }

  /** A value from a folder's .moshe.json (or library.json for '.moshe'). */
  sget(dir, key, dflt = null) {
    const m = this._meta.get(dir === '.moshe' ? LIBRARY_META : this._sideOf(dir));
    const e = m && m[key];
    return e && e.v !== null && e.v !== undefined ? clone(e.v) : dflt;
  }

  /** Set values in a folder's .moshe.json, each stamped now; null deletes. */
  sset(dir, patch) {
    const path = dir === '.moshe' ? LIBRARY_META : this._sideOf(dir);
    const m = clone(this._meta.get(path) || {});
    const t = this.now();
    for (const [k, v] of Object.entries(patch)) {
      const prev = m[k];
      if (v === null || v === undefined) { if (prev) m[k] = { v: null, t: Math.max(t, prev.t + 1) }; continue; }
      m[k] = { v: clone(v), t: prev ? Math.max(t, prev.t + 1) : t };
    }
    // deletions older than a month are forgotten: every device has heard of them
    for (const [k, e] of Object.entries(m)) if (e && e.v === null && t - e.t > TOMBSTONE_DAYS * 86400e3) delete m[k];
    this._put(path, sidecarText(m));
  }

  /** A sheet's own entry in its folder's .moshe.json. */
  sheetMeta(path) { return this.sget(dirOf(path), `sheet:${baseName(path)}`, {}) || {}; }

  _setSheetMeta(path, patch) {
    const cur = this.sheetMeta(path);
    const next = { ...cur, ...patch };
    for (const k of Object.keys(next)) if (next[k] === null || next[k] === undefined || next[k] === false) delete next[k];
    this.sset(dirOf(path), { [`sheet:${baseName(path)}`]: Object.keys(next).length ? next : null });
  }

  // ------------------------------------------------------------------ reading sheets
  text(path) { const r = this._disk.get(path); return r ? r.text : null; }

  /** What the lists and the dashboard know of a sheet. */
  sheetInfo(path) {
    const r = this._disk.get(path);
    const text = r ? r.text : '';
    // cached for the text it was made from: a string compare is a pointer
    // compare when the text has not changed, so nothing is hashed or reread
    let c = this._info.get(path);
    if (!c || c.text !== text) {
      const { values, body } = splitSheet(text);
      const meta = readMeta(values);
      const pv = sheetPreview(body);
      c = { text, title: pv.title, preview: pv.preview, meta, stats: stats(body) };
      this._info.set(path, c);
    }
    const sm = this.sheetMeta(path);
    const modified = r && r.mtime ? r.mtime : 0;
    return {
      path, name: baseName(path), dir: dirOf(path), title: c.title, preview: c.preview,
      keywords: c.meta.keywords, material: c.meta.material, goal: c.meta.goal, notes: c.meta.notes, ink: c.meta.ink,
      favorite: !!sm.favorite, glued: !!sm.glued, created: sm.created ? Date.parse(sm.created) || modified : modified,
      modified, stats: c.stats, empty: !c.title,
    };
  }

  /** The sheet as the editor opens it. */
  openSheet(path) {
    const text = this.text(path);
    if (text === null) return null;
    const { head, body } = splitSheet(text);
    return { path, head, body, ...this.sheetInfo(path) };
  }

  // ------------------------------------------------------------------ the library
  _groupNode(dir, depth = 0) {
    const name = dir === NOTES ? 'Inbox' : baseName(dir);
    const kids = this.subgroups(dir);
    return {
      path: dir, name, depth,
      icon: this.sget(dir, 'icon', null) || (this.isTemplates(dir) ? 'folder' : dir === NOTES ? 'inbox' : null),
      color: this.sget(dir, 'color', null),
      goal: this.sget(dir, 'goal', null),
      filters: (this.sget(dir, 'filters', []) || []).map((f) => ({ ...f, path: `filter:${dir}:${f.id}`, parent: dir })),
      count: dir === NOTES ? this.sheetsIn(dir).length : this.sheetsUnder(dir).length,
      groups: dir === NOTES ? [] : kids.map((g) => this._groupNode(g, depth + 1)),
      templates: this.isTemplates(dir),
    };
  }

  /** The library as the sidebar shows it. */
  library() {
    const notesGroups = this.subgroups(NOTES).map((g) => this._groupNode(g, 0));
    const projects = this._children(PROJECTS).dirs.filter((n) => !hiddenName(n));
    const ordered = this._order(PROJECTS, 'groups', projects).map((n) => this.projectNode(joinPath(PROJECTS, n)));
    return {
      inbox: this._groupNode(NOTES),
      groups: notesGroups,
      notesFilters: (this.sget(NOTES, 'filters', []) || []).map((f) => ({ ...f, path: `filter:${NOTES}:${f.id}`, parent: NOTES })),
      projects: ordered.filter((p) => !p.archived),
      archived: ordered.filter((p) => p.archived),
      trashCount: this.trash().filter((t) => !this._inProjectTrash(t)).length,
      favoritesCount: this.favorites().length,
    };
  }

  projectNode(dir) {
    const proj = this.sget(dir, 'project', {}) || {};
    const extras = joinPath(dir, EXTRAS);
    const groups = this.subgroups(dir).map((g) => this._groupNode(g, 0));
    const main = [...this.sheetsIn(dir), ...this.subgroups(dir).flatMap((g) => this.sheetsUnder(g))];
    return {
      path: dir, name: baseName(dir), icon: this.sget(dir, 'icon', null) || 'book', color: this.sget(dir, 'color', null),
      goal: this.sget(dir, 'goal', null), archived: !!proj.archived, template: proj.template || null,
      groups, extras: this.tree.dirs.has(extras) ? this.subgroups(extras).map((g) => this._groupNode(g, 0)) : [],
      pending: this.sheetsIn(dir).length, count: main.length,
      filters: (this.sget(dir, 'filters', []) || []).map((f) => ({ ...f, path: `filter:${dir}:${f.id}`, parent: dir })),
      trashCount: this.trash().filter((t) => this._inProjectTrash(t) === dir).length,
      favoritesCount: this.favorites(dir).length,
    };
  }

  /** Every sheet of a project's main content (not its Extras): what it exports and counts. */
  projectSheets(dir) {
    return [...this.sheetsIn(dir), ...this.subgroups(dir).flatMap((g) => this.sheetsUnder(g))];
  }

  /** Every sheet in the library: the Notes section, and the projects if asked. */
  allSheets(withProjects = false) {
    const out = this.sheetsUnder(NOTES);        // the Inbox and every group in Notes
    if (withProjects) {
      for (const n of this._children(PROJECTS).dirs.filter((x) => !hiddenName(x))) {
        const dir = joinPath(PROJECTS, n);
        out.push(...this.sheetsIn(dir), ...this.subgroups(dir).flatMap((g) => this.sheetsUnder(g)));
        const ex = joinPath(dir, EXTRAS);
        if (this.tree.dirs.has(ex)) out.push(...this.subgroups(ex).flatMap((g) => this.sheetsUnder(g)));
      }
    }
    return out;
  }

  favorites(project = null) {
    const all = project ? this._allInProject(project) : this.allSheets(false);
    return all.filter((p) => this.sheetMeta(p).favorite);
  }

  _allInProject(dir) {
    const ex = joinPath(dir, EXTRAS);
    return [...this.projectSheets(dir), ...(this.tree.dirs.has(ex) ? this.subgroups(ex).flatMap((g) => this.sheetsUnder(g)) : [])];
  }

  /**
   * What the sheet list shows for a selection: sections of sheets, one per
   * group (a group shows the sheets of every group inside it).
   * @param {string} sel  a group's path, or all | recent | favorites | trash (the global
   *   filters), or notes-all (the Notes section's All), or
   *   <project>#favorites | <project>#trash | <project>#pending, or filter:<dir>:<id>
   */
  sheetList(sel, opts = {}) {
    const sec = (path, name, sheets, depth = 0) => ({ path, name, depth, sheets: sheets.map((p) => this.sheetInfo(p)) });
    const withProjects = !!this.sget('.moshe', 'globalFiltersIncludeProjects', false);
    if (sel === 'all') return { title: 'All', sections: [sec('all', 'All', this._byRecent(this.allSheets(withProjects)))] };
    if (sel === 'notes-all') return { title: 'All', sections: [sec('notes-all', 'All', this._byRecent(this.allSheets(false)))] };
    if (sel === 'recent') {
      const week = this.now() - 7 * 86400e3;
      return { title: 'Last 7 Days', sections: [sec('recent', 'Last 7 Days', this._byRecent(this.allSheets(withProjects).filter((p) => this.sheetInfo(p).created >= week)))] };
    }
    if (sel === 'favorites') return { title: 'Favorites', sections: [sec('favorites', 'Favorites', this.favorites())] };
    if (sel === 'trash' || sel.endsWith('#trash')) {
      const proj = sel === 'trash' ? null : sel.slice(0, -6);
      const items = this.trash().filter((t) => (proj ? this._inProjectTrash(t) === proj : !this._inProjectTrash(t)));
      return { title: 'Trash', trash: true, sections: [{ path: sel, name: 'Trash', depth: 0, sheets: [], items }] };
    }
    if (sel.endsWith('#favorites')) return { title: 'Favorites', sections: [sec(sel, 'Favorites', this.favorites(sel.slice(0, -10)))] };
    if (sel.endsWith('#pending')) {
      const dir = sel.slice(0, -8);
      return { title: 'Pending', group: dir, sections: [sec(dir, 'Pending', this.sheetsIn(dir))] };
    }
    if (sel.startsWith('filter:')) {
      const f = this.filterById(sel);
      if (!f) return { title: 'Filter', sections: [] };
      const scope = f.parent === NOTES ? this.allSheets(false) : dirOf(f.parent) === PROJECTS ? this._allInProject(f.parent) : this.sheetsUnder(f.parent);
      return { title: f.name, filter: f, sections: [sec(sel, f.name, scope.filter((p) => this.matches(p, f.rules)))] };
    }
    if (!this.tree.dirs.has(sel)) return { title: '', sections: [] };
    const sections = [];
    const walk = (dir, depth) => {
      sections.push(sec(dir, dir === NOTES ? 'Inbox' : baseName(dir), this.sheetsIn(dir), depth));
      if (dir === NOTES || (dirOf(dir) === PROJECTS)) return;
      for (const g of this.subgroups(dir)) walk(g, depth + 1);
    };
    walk(sel, 0);
    return { title: sel === NOTES ? 'Inbox' : baseName(sel), group: sel, sort: this.sget(sel, 'sort', 'manual') || 'manual', sections };
  }

  _byRecent(paths) {
    return paths.map((p) => [p, this.sheetInfo(p).modified]).sort((a, b) => b[1] - a[1]).map(([p]) => p);
  }

  /** A group's (or project's) numbers: every sheet in it, material left out. */
  groupStats(dir) {
    const paths = dirOf(dir) === PROJECTS ? this.projectSheets(dir) : dir === NOTES ? this.sheetsIn(dir) : this.sheetsUnder(dir);
    let st = emptyStats();
    let sheets = 0;
    for (const p of paths) {
      const s = this.sheetInfo(p);
      sheets++;
      if (!s.material) st = addStats(st, s.stats);
    }
    return { ...st, sheets };
  }

  /** Where a goal stands: {value, target, fraction, done, over, perDay?}.
   *  For an "every day" goal on a group, `dir` gives today's writing. */
  goalProgress(goal, st, dir = null) {
    if (!goal) return null;
    const value = goal.type === 'daily' && dir ? this.writtenToday(dir) : metricOf(st, goal.metric);
    const target = goal.count || 0;
    const fraction = target ? value / target : 0;
    const out = { value, target, fraction, reached: false, over: false };
    if (goal.type === 'at-most') { out.reached = value <= target && value > 0; out.over = value > target; } else if (goal.type === 'about') {
      out.reached = Math.abs(value - target) <= target * 0.1; out.over = value > target * 1.1;
    } else out.reached = value >= target;
    if (goal.deadline) {
      const days = Math.max(1, Math.ceil((Date.parse(goal.deadline + 'T23:59:59') - this.now()) / 86400e3));
      out.daysLeft = days;
      out.perDay = Math.max(0, Math.ceil((target - value) / days));
    }
    return out;
  }

  // ------------------------------------------------------------------ writing history
  /** Every group and project that has a goal. */
  goalGroups() {
    const out = [];
    const walk = (dir) => { if (this.sget(dir, 'goal', null)) out.push(dir); for (const g of this.subgroups(dir)) walk(g); };
    for (const g of this.subgroups(NOTES)) walk(g);
    for (const n of this._children(PROJECTS).dirs.filter((x) => !hiddenName(x))) {
      const p = joinPath(PROJECTS, n);
      if (this.sget(p, 'goal', null)) out.push(p);
      for (const g of this.subgroups(p)) walk(g);
    }
    return out;
  }

  /**
   * Note where each goal's count stands today (the writing history): the
   * first note of a day is where the day started, the last where it ended.
   * One key a day in the folder's .moshe.json, so two devices' days merge.
   * Called when the app opens and every few minutes while it is writing.
   */
  recordProgress() {
    const day = isoNow(this.now()).slice(0, 10);
    for (const dir of this.goalGroups()) {
      const goal = this.sget(dir, 'goal', null);
      const st = this.groupStats(dir);
      const value = metricOf(st, goal.metric);
      const key = `day:${day}`;
      const cur = this.sget(dir, key, null);
      if (!cur) this.sset(dir, { [key]: { start: value, end: value } });
      else if (cur.end !== value) this.sset(dir, { [key]: { ...cur, end: value } });
    }
  }

  /** A group's days, newest first: [{day, start, end, written}]. */
  history(dir, days = 30) {
    const m = this._meta.get(this._sideOf(dir)) || {};
    return Object.keys(m).filter((k) => k.startsWith('day:') && m[k] && m[k].v).sort().reverse().slice(0, days)
      .map((k) => ({ day: k.slice(4), ...m[k].v, written: Math.max(0, m[k].v.end - m[k].v.start) }));
  }

  /** How much of a group's goal today's writing is (for "every day" goals), or null. */
  writtenToday(dir) {
    const goal = this.sget(dir, 'goal', null);
    if (!goal) return null;
    const cur = this.sget(dir, `day:${isoNow(this.now()).slice(0, 10)}`, null);
    const value = metricOf(this.groupStats(dir), goal.metric);
    return cur ? Math.max(0, value - cur.start) : 0;
  }

  // ------------------------------------------------------------------ keywords and filters
  /** Every keyword in use, with how many sheets have it and its colour. */
  keywords(project = null) {
    const counts = new Map();
    const paths = project ? this._allInProject(project) : this.allSheets(false);
    for (const p of paths) for (const k of this.sheetInfo(p).keywords) counts.set(k, (counts.get(k) || 0) + 1);
    const where = project || '.moshe';
    const colors = this.sget(where, 'keywords', {}) || {};
    const favs = this.sget(where, 'favoriteKeywords', []) || [];
    for (const k of Object.keys(colors)) if (!counts.has(k)) counts.set(k, 0);
    return [...counts].map(([name, count]) => ({ name, count, color: colors[name] || null, favorite: favs.includes(name) }))
      .sort((a, b) => byName(a.name, b.name));
  }

  filterById(id) {
    const [, dir, fid] = /^filter:(.*):([^:]+)$/u.exec(id) || [];
    if (!dir) return null;
    const f = (this.sget(dir, 'filters', []) || []).find((x) => x.id === fid);
    return f ? { ...f, parent: dir, path: id } : null;
  }

  /** Does a sheet meet a filter's rules? rules: {match: all|any, items: [{field, op, value}]} */
  matches(path, rules) {
    if (!rules || !rules.items || !rules.items.length) return true;
    const s = this.sheetInfo(path);
    const text = () => fold(splitSheet(this.text(path) || '').body);
    const test = (r) => {
      const v = r.value === undefined ? '' : r.value;
      switch (r.field) {
        case 'text': return r.op === 'not' ? !text().includes(fold(String(v))) : text().includes(fold(String(v)));
        case 'title': return fold(s.title).includes(fold(String(v))) !== (r.op === 'not');
        case 'keyword': return s.keywords.some((k) => fold(k) === fold(String(v))) !== (r.op === 'not');
        case 'material': return s.material === (r.op !== 'not');
        case 'favorite': return s.favorite === (r.op !== 'not');
        case 'goal': return !!s.goal === (r.op !== 'not');
        case 'notes': return (s.notes.length > 0) === (r.op !== 'not');
        case 'created': case 'modified': {
          const days = Number(v) || 0;
          const at = r.field === 'created' ? s.created : s.modified;
          return r.op === 'older' ? at < this.now() - days * 86400e3 : at >= this.now() - days * 86400e3;
        }
        default: return true;
      }
    };
    return rules.match === 'any' ? rules.items.some(test) : rules.items.every(test);
  }

  /** Sheets whose title, text or keywords hold the query, best first. The
   *  raw text is searched first (folded once per version of each sheet);
   *  only a sheet that matches is read as markup, for its snippet. */
  search(query, scope = null, limit = 60) {
    const q = fold(query.trim());
    if (!q) return [];
    const paths = scope ? (dirOf(scope) === PROJECTS ? this._allInProject(scope) : this.sheetsUnder(scope)) : this.allSheets(true);
    const out = [];
    for (const p of paths) {
      const s = this.sheetInfo(p);
      const c = this._info.get(p);
      if (c.folded === undefined) c.folded = fold(c.text);
      const inTitle = fold(s.title).includes(q), inKw = s.keywords.some((k) => fold(k).includes(q));
      if (!inTitle && !inKw && !c.folded.includes(q)) continue;
      if (out.length >= limit) { out.push({ path: p, title: s.title, snippet: '', at: -1, score: (inTitle ? 2 : 0) + (inKw ? 1 : 0) }); continue; }
      if (c.plain === undefined) { c.plain = plainText(splitSheet(c.text).body); c.plainFold = foldMapped(c.plain); }
      const body = c.plain;
      const { text: f, map } = c.plainFold;
      const at = f.indexOf(q);
      if (!inTitle && !inKw && at < 0) continue;       // only in a tag, not the text
      let snippet = '';
      const pos = at >= 0 ? map[at] : -1;
      if (at >= 0) {
        const a = Math.max(0, pos - 40);
        snippet = (a ? '…' : '') + body.slice(a, map[Math.min(map.length - 1, at + q.length)] + 80).replace(/\s+/gu, ' ');
      }
      out.push({ path: p, title: s.title, snippet, at: pos, score: (inTitle ? 2 : 0) + (inKw ? 1 : 0) });
    }
    return out.sort((a, b) => b.score - a.score);
  }

  // ------------------------------------------------------------------ changing sheets
  /** A new sheet, empty or with text, at the end of a group (or after a sheet). */
  createSheet(dir, { text = '', after = null, material = false } = {}) {
    if (!isGroupDir(dir) || dir === PROJECTS) throw new Error(`not a group: ${dir}`);
    this._mkdir(dir);
    const first = splitSheet(text).body.split('\n').find((l) => l.trim());
    const title = first ? sheetPreview(first).title : '';
    const path = this.uniquePath(dir, title && text.includes('\n') ? `${fileName(title)}.md` : 'Untitled.md');
    this._put(path, material ? setMeta(text, { material: true }) : text);
    this._insertOrder(dir, 'sheets', baseName(path), after ? baseName(after) : null);
    this._setSheetMeta(path, { created: isoNow(this.now()) });
    this.notify([path], { created: path });
    return path;
  }

  _insertOrder(dir, key, name, after = null) {
    const names = key === 'sheets' ? this._children(dir).files.filter((n) => n !== name) : this._children(dir).dirs.filter((n) => n !== name && !hiddenName(n));
    const order = this._order(dir, key, names);
    const i = after ? order.indexOf(after) : -1;
    if (i >= 0) order.splice(i + 1, 0, name); else order.push(name);
    this.sset(dir, { [key]: order });
  }

  /**
   * The editor's text for a sheet. If the file changed since the editor
   * opened it (`base`, the body it started from), the two are merged, and the
   * merged body is what is written and returned.
   * @returns {{path: string, body: string, merged: boolean}}  path changes if the file was named
   */
  saveSheet(path, body, base = null, { closing = false } = {}) {
    // moved or trashed here since the editor opened it: the save goes where it went
    for (let hops = 0; this.text(path) === null && this._moved.has(path) && hops < 20; hops++) {
      const to = this._moved.get(path);
      if (to === null) return { path, body, merged: false, gone: true };
      path = to;
    }
    const text = this.text(path);
    if (text === null) {
      // gone meanwhile (deleted elsewhere): the editor's text is kept, as a new sheet
      if (!this.tree.dirs.has(dirOf(path))) this._mkdir(dirOf(path));
      this._put(path, body);
      this.notify([path]);
      return { path, body, merged: false };
    }
    const { head, body: now } = splitSheet(text);
    let out = body, merged = false;
    if (base !== null && now !== base && now !== body) {
      out = mergeText(base, body, now).text;
      merged = true;
      this._log({ path, kind: 'merged with a change made elsewhere while it was open' });
    }
    if (head + out !== text) this._put(path, head + out);
    let at = path;
    if (PROVISIONAL.test(baseName(path))) {
      const title = sheetPreview(out).title;
      const lines = out.split('\n');
      const firstDone = lines.findIndex((l) => l.trim()) >= 0 && lines.slice(lines.findIndex((l) => l.trim()) + 1).length > 0;
      if (title && (closing || firstDone)) at = this.renameSheet(path, fileName(title));
    }
    this.notify([at]);
    return { path: at, body: out, merged };
  }

  /**
   * Read one file again, now, and take it if someone else changed it: the
   * editor does this before each save, so a save never lands on an edit
   * made elsewhere since the last scan (it merges with it instead).
   * → true if it had changed
   */
  async reread(path) {
    await this.flush();
    const seen = this._writes;
    let r;
    try { r = readText(await this.storage.read(path)); } catch { return false; }
    if (this._writes !== seen || !r) return false;
    const mine = this._disk.get(path);
    if (mine && mine.text === r.text) { mine.mtime = r.mtime; return false; }
    this._adopt(path, r);
    this.notify([path], { external: true });
    return true;
  }

  /** A sheet's file renamed (its title is not touched). → the new path */
  renameSheet(path, name) {
    const dir = dirOf(path);
    const want = `${fileName(name)}.md`;
    if (want === baseName(path)) return path;
    const to = this.uniquePath(dir, want);
    const meta = this.sheetMeta(path);
    const order = this.sget(dir, 'sheets', null);
    this._move(path, to);
    const patch = { [`sheet:${baseName(path)}`]: null };
    if (Object.keys(meta).length) patch[`sheet:${baseName(to)}`] = meta;
    if (order) patch.sheets = order.map((n) => (n === baseName(path) ? baseName(to) : n));
    this.sset(dir, patch);
    this.notify([path, to], { renamed: { [path]: to } });
    return to;
  }

  /** Change a sheet's front matter values (keywords, material, goal, notes). */
  setSheetMeta(path, patch) {
    const text = this.text(path);
    if (text === null) throw new Error(`no such sheet: ${path}`);
    const p = { ...patch };
    if ('goal' in p) p.goal = p.goal ? formatGoal(p.goal) : null;
    const next = setMeta(text, p);
    if (next !== text) this._put(path, next);
    this.notify([path]);
  }

  setFavorite(path, on) { this._setSheetMeta(path, { favorite: !!on }); this.notify([path]); }

  /**
   * Sheets moved into a group, in order, at `index` in its manual order
   * (null: the end). Out of the Templates group, and into it, they are copied.
   * @returns {string[]} their new paths
   */
  moveSheets(paths, dir, index = null) {
    if (!isGroupDir(dir) || dir === PROJECTS) throw new Error(`not a group: ${dir}`);
    this._mkdir(dir);
    const out = [];
    const renamed = {};
    for (const path of paths) {
      if (!this.tree.files.has(path)) continue;
      const from = dirOf(path);
      const copy = this.isTemplates(from) !== this.isTemplates(dir) && (this.isTemplates(from) || this.isTemplates(dir));
      if (from === dir) { out.push(path); continue; }
      const meta = this.sheetMeta(path);
      delete meta.glued;
      const to = this.uniquePath(dir, baseName(path));
      if (copy) {
        this._put(to, this.text(path));
        this._setSheetMeta(to, { created: isoNow(this.now()) });
      } else {
        this._move(path, to);
        const order = this.sget(from, 'sheets', null);
        const patch = { [`sheet:${baseName(path)}`]: null };
        if (order) patch.sheets = order.filter((n) => n !== baseName(path));
        this.sset(from, patch);
        if (Object.keys(meta).length) this.sset(dir, { [`sheet:${baseName(to)}`]: meta });
        renamed[path] = to;
      }
      out.push(to);
    }
    // their place in the group's order
    const names = this._children(dir).files;
    const moving = out.map(baseName);
    const order = this._order(dir, 'sheets', names).filter((n) => !moving.includes(n));
    const at = index === null || index > order.length ? order.length : Math.max(0, index);
    order.splice(at, 0, ...moving);
    this.sset(dir, { sheets: order });
    this.notify([...paths, ...out], { renamed });
    return out;
  }

  /** A group's sheets in a new manual order (names or paths). */
  reorderSheets(dir, names) {
    this.sset(dir, { sheets: names.map(baseName), sort: 'manual' });
    this.notify([dir]);
  }

  setSort(dir, sort) { this.sset(dir, { sort }); this.notify([dir]); }

  /** Findings of the grammar check the writer ignored in a sheet (kept in its folder's settings). */
  proofIgnored(path) {
    const m = this.sget(dirOf(path), 'proofIgnore', null) || {};
    return Array.isArray(m[baseName(path)]) ? m[baseName(path)] : [];
  }

  ignoreFinding(path, key) {
    const dir = dirOf(path), name = baseName(path);
    const m = { ...(this.sget(dir, 'proofIgnore', null) || {}) };
    m[name] = [...new Set([...(Array.isArray(m[name]) ? m[name] : []), key])];
    this.sset(dir, { proofIgnore: m });
    this.notify([dir]);
  }

  /** A copy of a sheet, right after it. → its path */
  duplicateSheet(path) {
    const dir = dirOf(path);
    const to = this.uniquePath(dir, baseName(path));
    this._put(to, this.text(path));
    this._insertOrder(dir, 'sheets', baseName(to), baseName(path));
    this._setSheetMeta(to, { created: isoNow(this.now()) });
    this.notify([to], { created: to });
    return to;
  }

  /** Into the trash, remembering where it was. → its place in the trash */
  trashSheet(path) {
    if (!this.tree.files.has(path)) return null;
    const dir = dirOf(path);
    const to = this.uniquePath(TRASH, baseName(path));
    const meta = this.sheetMeta(path);
    this._mkdir(TRASH);
    this._move(path, to);
    const order = this.sget(dir, 'sheets', null);
    const patch = { [`sheet:${baseName(path)}`]: null };
    if (order) patch.sheets = order.filter((n) => n !== baseName(path));
    this.sset(dir, patch);
    this.sset(TRASH, { [`item:${baseName(to)}`]: { origin: path, at: isoNow(this.now()), kind: 'sheet', meta } });
    this.notify([path, to], { trashed: path });
    return to;
  }

  /** What is in the trash: {name, path, origin, kind, at, title}. */
  trash() {
    const names = new Set([...this._children(TRASH).files, ...this._children(TRASH).dirs, ...this._children(TRASH).other.filter((n) => n.endsWith('.md'))]);
    const out = [];
    for (const n of names) {
      if (hiddenName(n)) continue;
      const path = joinPath(TRASH, n);
      const item = this.sget(TRASH, `item:${n}`, null) || { origin: joinPath(NOTES, n), kind: this.tree.dirs.has(path) ? 'group' : 'sheet' };
      const title = item.kind === 'sheet' ? sheetPreview(splitSheet(this.text(path) || '').body).title : n;
      const pv = item.kind === 'sheet' ? sheetPreview(splitSheet(this.text(path) || '').body).preview : [];
      out.push({ name: n, path, origin: item.origin, kind: item.kind, at: item.at || null, title: title || n.replace(/\.md$/u, ''), preview: pv });
    }
    return out.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  }

  /** Whose trash a trashed thing is in: its project's (a project itself is in the Notes trash), or null. */
  _inProjectTrash(t) { return t.kind === 'project' ? null : this.projectOf(t.origin); }

  /** Out of the trash, back where it was (or, if that group is gone, to the Inbox or the project's Pending). */
  restore(trashPath) {
    const name = baseName(trashPath);
    const item = this.sget(TRASH, `item:${name}`, null) || { origin: joinPath(NOTES, name), kind: 'sheet' };
    let dir = dirOf(item.origin);
    if (!this.tree.dirs.has(dir)) {
      const proj = this.projectOf(item.origin);
      dir = proj && this.tree.dirs.has(proj) ? proj : NOTES;
    }
    const to = this.uniquePath(dir, baseName(item.origin));
    this._mkdir(dir);
    this._move(trashPath, to);
    this.sset(TRASH, { [`item:${name}`]: null });
    if (item.kind === 'sheet') {
      this._insertOrder(dir, 'sheets', baseName(to));
      if (item.meta && Object.keys(item.meta).length) this.sset(dir, { [`sheet:${baseName(to)}`]: item.meta });
    } else this._insertOrder(dir, 'groups', baseName(to));
    this.notify([trashPath, to], { restored: to });
    return to;
  }

  /** Gone for good: one thing in the trash. */
  erase(trashPath) {
    const name = baseName(trashPath);
    const prefix = trashPath + '/';
    for (const f of [...this.tree.files]) if (f === trashPath || f.startsWith(prefix)) this._moved.set(f, null);
    for (const [k, v] of this._moved) if (v && (v === trashPath || v.startsWith(prefix))) this._moved.set(k, null);
    if (this.tree.dirs.has(trashPath)) this._removeTree(trashPath); else this._removeFile(trashPath);
    this.sset(TRASH, { [`item:${name}`]: null });
    this.notify([trashPath]);
  }

  /** The trash emptied (a project's, or the Notes section's). */
  emptyTrash(project = null) {
    for (const t of this.trash()) {
      if ((project ? this._inProjectTrash(t) === project : !this._inProjectTrash(t))) this.erase(t.path);
    }
  }

  /** Glue a sheet to the next one in its group (or unglue it). */
  setGlued(path, on) { this._setSheetMeta(path, { glued: !!on }); this.notify([path]); }

  /** Sheets glued together, as one text: [start, …] runs of consecutive glued sheets. */
  gluedRun(path) {
    const dir = dirOf(path);
    if ((this.sget(dir, 'sort', 'manual') || 'manual') !== 'manual') return [path];
    const list = this.sheetsIn(dir);
    let i = list.indexOf(path);
    if (i < 0) return [path];
    while (i > 0 && this.sheetMeta(list[i - 1]).glued) i--;
    const run = [list[i]];
    while (i < list.length - 1 && this.sheetMeta(list[i]).glued) run.push(list[++i]);
    return run;
  }

  /** Several sheets made one: the first gets every text, in order, and the others go to the trash. */
  mergeSheets(paths) {
    if (paths.length < 2) return paths[0];
    const [first, ...rest] = paths;
    const parts = paths.map((p) => splitSheet(this.text(p) || ''));
    const body = parts.map((x) => x.body.replace(/\s+$/u, '')).join('\n\n') + '\n';
    const kws = [...new Set(parts.flatMap((x) => readMeta(x.values).keywords))];
    let text = parts[0].head + body;
    if (kws.length) text = setMeta(text, { keywords: kws });
    this._put(first, text);
    for (const p of rest) this.trashSheet(p);
    this.notify(paths);
    return first;
  }

  /** A sheet split at a place in its body: the rest becomes a new sheet after it, glued to it. → the new sheet */
  splitSheet(path, at) {
    const { head, body } = splitSheet(this.text(path) || '');
    const a = body.slice(0, at).replace(/\s+$/u, '') + '\n', b = body.slice(at).replace(/^\s+/u, '');
    this._put(path, head + a);
    const dir = dirOf(path);
    const title = sheetPreview(b).title;
    const to = this.uniquePath(dir, title ? `${fileName(title)}.md` : 'Untitled.md');
    this._put(to, b);
    this._insertOrder(dir, 'sheets', baseName(to), baseName(path));
    this._setSheetMeta(to, { created: isoNow(this.now()) });
    this._setSheetMeta(path, { glued: true });
    this.notify([path, to], { created: to });
    return to;
  }

  // ------------------------------------------------------------------ groups and projects
  /** A new group in a group (or a project, or its Extras). → its path */
  createGroup(parent, name, { icon = null, color = null, after = null } = {}) {
    if (!(isGroupDir(parent) || parent === NOTES)) throw new Error(`not a group: ${parent}`);
    const dir = this.uniquePath(parent, fileName(name || 'New Group'));
    this._mkdir(dir);
    if (icon || color) this.sset(dir, { ...(icon ? { icon } : {}), ...(color ? { color } : {}) });
    this._insertOrder(parent, 'groups', baseName(dir), after ? baseName(after) : null);
    this.notify([dir], { created: dir });
    return dir;
  }

  /** A group's (or project's) name, icon, colour, goal. → its path (new if renamed) */
  editGroup(dir, { name, icon, color, goal } = {}) {
    let at = dir;
    const patch = {};
    if (icon !== undefined) patch.icon = icon;
    if (color !== undefined) patch.color = color;
    if (goal !== undefined) patch.goal = goal;
    if (Object.keys(patch).length) this.sset(dir, patch);
    if (name !== undefined && fileName(name) !== baseName(dir) && dir !== NOTES && !this.isTemplates(dir)) {
      const parent = dirOf(dir);
      const to = this.uniquePath(parent, fileName(name));
      this._move(dir, to);
      const order = this.sget(parent, 'groups', null);
      if (order) this.sset(parent, { groups: order.map((n) => (n === baseName(dir) ? baseName(to) : n)) });
      at = to;
      this.notify([dir, to], { renamed: { [dir]: to } });
    } else this.notify([dir]);
    return at;
  }

  /** A group moved into another (or to another place among its siblings). → its path */
  moveGroup(dir, parent, index = null) {
    let at = dir;
    const renamed = {};
    if (dirOf(dir) !== parent) {
      if (parent === dir || parent.startsWith(dir + '/')) throw new Error('a group cannot go inside itself');
      const from = dirOf(dir);
      const to = this.uniquePath(parent, baseName(dir));
      this._move(dir, to);
      const order = this.sget(from, 'groups', null);
      if (order) this.sset(from, { groups: order.filter((n) => n !== baseName(dir)) });
      at = to;
      renamed[dir] = to;
    }
    const names = this._children(parent).dirs.filter((n) => !hiddenName(n) && !(dirOf(parent) === PROJECTS && n === EXTRAS) && !(this.isExtras(parent) && n === TEMPLATES));
    const order = this._order(parent, 'groups', names).filter((n) => n !== baseName(at));
    const i = index === null || index > order.length ? order.length : Math.max(0, index);
    order.splice(i, 0, baseName(at));
    this.sset(parent, { groups: order });
    this.notify([dir, at], { renamed });
    return at;
  }

  /** A group, with everything in it, into the trash. */
  trashGroup(dir) {
    if (dir === NOTES || !this.tree.dirs.has(dir) || this.isTemplates(dir)) return null;
    const parent = dirOf(dir);
    const to = this.uniquePath(TRASH, baseName(dir));
    this._mkdir(TRASH);
    this._move(dir, to);
    const order = this.sget(parent, 'groups', null);
    if (order) this.sset(parent, { groups: order.filter((n) => n !== baseName(dir)) });
    this.sset(TRASH, { [`item:${baseName(to)}`]: { origin: dir, at: isoNow(this.now()), kind: dirOf(dir) === PROJECTS ? 'project' : 'group' } });
    this.notify([dir, to], { trashed: dir });
    return to;
  }

  /** A new project, from a template. → its path */
  createProject(name, { template = 'empty', icon = null, color = null, goal = null, author = '' } = {}) {
    const t = PROJECT_TEMPLATES[template] || PROJECT_TEMPLATES.empty;
    const dir = this.uniquePath(PROJECTS, fileName(name || 'New Project'));
    this._mkdir(dir);
    this.sset(dir, { icon: icon || t.icon, ...(color ? { color } : {}), ...(goal ? { goal } : {}), project: { template } });
    const fill = (s) => s.replaceAll('{title}', baseName(dir)).replaceAll('{author}', author || 'Jane Doe');
    const make = (parent, g) => {
      const gd = joinPath(parent, fileName(g.name));
      this._mkdir(gd);
      for (const s of g.sheets || []) this.createSheet(gd, { text: fill(s) });
      for (const sub of g.groups || []) make(gd, sub);
      this.sset(gd, { groups: (g.groups || []).map((x) => fileName(x.name)) });
    };
    for (const g of t.groups) make(dir, g);
    this.sset(dir, { groups: t.groups.map((g) => fileName(g.name)) });
    const ex = joinPath(dir, EXTRAS);
    this._mkdir(ex);
    for (const g of t.extras) make(ex, g);
    this._mkdir(joinPath(ex, TEMPLATES));
    this.sset(ex, { groups: t.extras.map((g) => fileName(g.name)) });
    this._insertOrder(PROJECTS, 'groups', baseName(dir));
    this.notify([dir], { created: dir });
    return dir;
  }

  /** A group of the Notes section made a project (dragged to Projects). → its path */
  groupToProject(dir) {
    const to = this.uniquePath(PROJECTS, baseName(dir));
    const parent = dirOf(dir);
    this._move(dir, to);
    const order = this.sget(parent, 'groups', null);
    if (order) this.sset(parent, { groups: order.filter((n) => n !== baseName(dir)) });
    this._mkdir(joinPath(to, EXTRAS, TEMPLATES));
    this.sset(to, { project: { template: null } });
    this._insertOrder(PROJECTS, 'groups', baseName(to));
    this.notify([dir, to], { renamed: { [dir]: to } });
    return to;
  }

  setArchived(dir, on) {
    const proj = this.sget(dir, 'project', {}) || {};
    this.sset(dir, { project: { ...proj, archived: !!on } });
    this.notify([dir]);
  }

  isArchived(path) {
    const proj = this.projectOf(path);
    return !!(proj && (this.sget(proj, 'project', {}) || {}).archived);
  }

  /** A copy of a project, every sheet and setting in it. → its path */
  duplicateProject(dir) {
    const to = this.uniquePath(PROJECTS, `${baseName(dir)} copy`);
    const prefix = dir + '/';
    this._mkdir(to);
    for (const d of [...this.tree.dirs]) if (d.startsWith(prefix)) this._mkdir(to + d.slice(dir.length));
    for (const f of [...this.tree.files]) {
      if (!f.startsWith(prefix) || !this._disk.has(f)) continue;
      this._put(to + f.slice(dir.length), this.text(f));
    }
    const side = this._sideOf(dir);
    if (this._disk.has(side)) {
      this._put(this._sideOf(to), this.text(side));
      const proj = this.sget(to, 'project', {}) || {};
      this.sset(to, { project: { ...proj, archived: false } });
    }
    this._insertOrder(PROJECTS, 'groups', baseName(to), baseName(dir));
    this.notify([to], { created: to });
    return to;
  }

  reorderProjects(names) { this.sset(PROJECTS, { groups: names.map(baseName) }); this.notify([PROJECTS]); }

  // ------------------------------------------------------------------ filters and keywords
  saveFilter(parent, filter) {
    const list = this.sget(parent, 'filters', []) || [];
    const f = { id: filter.id || Math.random().toString(36).slice(2, 10), name: filter.name || 'Filter', icon: filter.icon || 'filter', color: filter.color || null, rules: filter.rules || { match: 'all', items: [] } };
    const i = list.findIndex((x) => x.id === f.id);
    if (i >= 0) list[i] = f; else list.push(f);
    this.sset(parent, { filters: list });
    this.notify([parent]);
    return `filter:${parent}:${f.id}`;
  }

  removeFilter(id) {
    const f = this.filterById(id);
    if (!f) return;
    this.sset(f.parent, { filters: (this.sget(f.parent, 'filters', []) || []).filter((x) => x.id !== f.id) });
    this.notify([f.parent]);
  }

  /** A keyword's colour, or whether it is a favourite, in the library's (or a project's) pool. */
  setKeyword(name, { color, favorite } = {}, project = null) {
    const where = project || '.moshe';
    if (color !== undefined) {
      const colors = this.sget(where, 'keywords', {}) || {};
      if (color) colors[name] = color; else delete colors[name];
      this.sset(where, { keywords: colors });
    }
    if (favorite !== undefined) {
      const favs = (this.sget(where, 'favoriteKeywords', []) || []).filter((k) => k !== name);
      if (favorite) favs.push(name);
      this.sset(where, { favoriteKeywords: favs });
    }
    this.notify([]);
  }

  /** A keyword renamed (or merged into another, or removed with to = null) on every sheet that has it. */
  renameKeyword(from, to, project = null) {
    const paths = project ? this._allInProject(project) : this.allSheets(true);
    const changed = [];
    for (const p of paths) {
      const kws = this.sheetInfo(p).keywords;
      if (!kws.includes(from)) continue;
      const next = [...new Set(kws.map((k) => (k === from ? to : k)).filter(Boolean))];
      this.setSheetMeta(p, { keywords: next });
      changed.push(p);
    }
    const where = project || '.moshe';
    const colors = this.sget(where, 'keywords', {}) || {};
    if (from in colors) {
      if (to && !(to in colors)) colors[to] = colors[from];
      delete colors[from];
      this.sset(where, { keywords: colors });
    }
    this.notify(changed);
    return changed;
  }

  /** A library-wide setting (library.json). */
  setting(key, dflt = null) { return this.sget('.moshe', key, dflt); }
  setSetting(key, value) { this.sset('.moshe', { [key]: value }); this.notify([]); }

  // ------------------------------------------------------------------ what others change
  /**
   * Read what someone else changed in storage: taken as it is (an edit in
   * Obsidian wins), and a sync tool's conflict copies merged in. → the paths
   * that changed.
   */
  async scanChanges(tries = 3) {
    if (this._failed.size) this.retryFailed();
    for (let attempt = 0; attempt < tries; attempt++) {
      await this.flush();
      const seen = this._writes;
      const listing = await this.storage.list();
      const files = new Set(listing.files);
      const mt = listing.mtimes || null;
      // with modification times, only what changed is read; without, all of it
      const want = [...files].filter((p) => tracked(p) && (!mt || !this._disk.has(p) || this._disk.get(p).mtime !== mt[p]));
      const copies = [...files].filter((p) => conflictOriginal(p) !== null && tracked(conflictOriginal(p)));
      const texts = await readEach(this.storage, want);
      if (this._writes !== seen) continue;           // the store wrote meanwhile: what was read may be older
      const changed = [];
      for (const p of [...this._disk.keys()]) {
        if (!files.has(p)) { this._disk.delete(p); this._meta.delete(p); this._info.delete(p); changed.push(p); }
      }
      want.forEach((p, i) => {
        const r = readText(texts[i]);
        if (!r) return;
        const mine = this._disk.get(p);
        if (mine && mine.text === r.text) { mine.mtime = r.mtime; return; }
        this._adopt(p, r);
        changed.push(p);
      });
      const treeChanged = listing.files.length !== this.tree.files.size || listing.dirs.length !== this.tree.dirs.size
        || listing.files.some((f) => !this.tree.files.has(f)) || listing.dirs.some((d) => !this.tree.dirs.has(d));
      this._setTree(listing);
      if (copies.length) changed.push(...await this._mergeCopies(copies));
      if (changed.length || treeChanged) this.notify(changed, { external: true });
      return changed;
    }
    return [];
  }

  /** A sync tool's conflict copies merged into their files and put away. */
  async _mergeCopies(copies) {
    if (!copies.length) return [];
    const texts = await readEach(this.storage, copies);
    const changed = [];
    copies.forEach((path, i) => {
      const r = readText(texts[i]);
      if (!r) return;
      const original = conflictOriginal(path);
      const at = copyTime(baseName(path));
      const cur = this._disk.get(original);
      if (at !== null && this.now() - at > OLD_COPY) {
        this._log({ path: original, kind: 'old conflict copy, put away unmerged', copy: path });
      } else if (!cur) {
        // its file is gone: the copy is all there is of it
        this._put(original, r.text);
        changed.push(original);
        this._log({ path: original, kind: 'conflict copy of a missing file, kept as the file', copy: path });
      } else if (baseName(original) === SIDECAR || original === LIBRARY_META) {
        let theirs = {};
        try { theirs = JSON.parse(r.text); } catch { /* nothing to add */ }
        const merged = sidecarText(mergeSidecar(this._meta.get(original) || {}, theirs || {}));
        if (merged !== cur.text) { this._put(original, merged); changed.push(original); }
        this._log({ path: original, kind: 'conflict copy', copy: path });
      } else {
        // a version this device had is the copy's base: what came after it here
        // goes onto what was typed there, and nothing is doubled
        const h = this._history.get(original) || [];
        const k = h.lastIndexOf(r.text);
        const base = k > 0 ? h[k - 1] : k === 0 ? r.text : likelyBase(h, r.text);
        const m = mergeText(base, cur.text, r.text);
        if (m.text !== cur.text) { this._put(original, m.text); changed.push(original); }
        this._log({ path: original, kind: 'conflict copy', copy: path, conflicts: m.conflicts });
      }
      const away = this.uniquePath(CONFLICTS, baseName(path));
      this._mkdir(CONFLICTS);
      this.tree.files.delete(path);
      this.tree.files.add(away);
      this._kids = null;
      this._enqueue({ op: 'move', from: path, to: away });
    });
    return changed;
  }

  // ------------------------------------------------------------------ built-in sync
  /** Every file a sync carries, as this device has it: path -> text. */
  async syncTexts() {
    await this.flush();
    const out = new Map();
    for (const [p, r] of this._disk) if (syncable(p)) out.set(p, r.text);
    return out;
  }

  /** A file as another device has it, from a sync that already merged it with
   *  this one (webdav.js) or checked it was made from it (If-Match). null: deleted there. */
  receive(path, text) {
    if (!syncable(path)) throw new Error(`not a file a sync carries: ${path}`);
    if (text === null) {
      if (!this.tree.files.has(path)) return false;
      this._removeFile(path);
      this.notify([path], { external: true });
      return true;
    }
    const mine = this._disk.get(path);
    if (mine && mine.text === text) return false;
    this._put(path, text);
    this.notify([path], { external: true });
    return true;
  }

  /** Merge for a sync: sheets by text, settings key by key. */
  static mergeFor(path, base, ours, theirs) {
    if (baseName(path) === SIDECAR || path === LIBRARY_META) {
      const p = (s) => { try { return JSON.parse(s || '{}') || {}; } catch { return {}; } };
      return { text: sidecarText(mergeSidecar(p(ours), p(theirs))), conflicts: 0 };
    }
    return mergeText(base, ours, theirs);
  }

  makeDirs(rel) { this._mkdir(rel); }

  _log(entry) {
    this.syncLog.push({ at: this.now(), ...entry });
    if (this.syncLog.length > 50) this.syncLog.shift();
  }
}

/** A sidecar as its file: keys sorted, so two devices with the same values write the same bytes. */
export function sidecarText(m) {
  const sorted = Object.fromEntries(Object.keys(m).sort().map((k) => [k, m[k]]));
  return JSON.stringify(sorted, null, 1) + '\n';
}

/** Text for searching: lower case, accents and niqqud gone. */
export function fold(s) {
  return String(s).normalize('NFD').replace(/[̀-֑ͯ-ׇ]/gu, '').toLowerCase();
}

/** fold(), and where each character of the result came from in the text. */
export function foldMapped(s) {
  let text = '';
  const map = [];
  let i = 0;
  for (const ch of s) {
    for (const f of fold(ch)) { text += f; map.push(i); }
    i += ch.length;
  }
  map.push(s.length);
  return { text, map };
}

export function isoNow(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export { parseGoal, formatGoal };
