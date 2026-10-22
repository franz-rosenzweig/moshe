// Backups: hourly for the last twelve hours, daily for
// a week, weekly for six months, and any made by hand ("Backup Now") until
// they are deleted. Each is a folder of the library's own files (the sheets,
// the folders' settings, the library's, the trash) as they were, outside the
// library, so a sync never carries them. A file unchanged since the backup
// before is a hard link to that one's copy, so a backup costs only what
// changed.
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { syncable } from '../../engine/src/store.js';
import { NodeStorage } from '../../engine/src/storage-node.js';

const HOUR = 3600e3, DAY = 24 * HOUR;
const pad = (n) => String(n).padStart(2, '0');
/** A backup's folder name: when it was made, in UTC, and "-manual" if by hand. */
const nameOf = (ms, manual) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z${manual ? '-manual' : ''}`;
};
const timeOf = (name) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})Z/u.exec(name);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
};

export class Backups {
  constructor(root, dir, { now = () => Date.now(), log = console.error } = {}) {
    this.root = root;
    this.dir = dir;
    this.now = now;
    this.log = log;
    this.storage = new NodeStorage(root);
    this.timer = null;
    this.running = null;
  }

  start(everyMs = 10 * 60e3) {
    const tick = () => this.maybe().catch((e) => this.log('backup:', e));
    setTimeout(tick, 30e3);
    this.timer = setInterval(tick, everyMs);
    return this;
  }

  close() { clearInterval(this.timer); }

  /** Every backup, newest first: {id, at, manual, files}. */
  async list() {
    let names = [];
    try { names = await fs.readdir(this.dir); } catch { return []; }
    const out = [];
    for (const n of names) {
      const at = timeOf(n);
      if (at === null) continue;
      out.push({ id: n, at, manual: n.endsWith('-manual') });
    }
    return out.sort((a, b) => b.at - a.at);
  }

  /** A backup's files: path -> text. */
  async files(id) {
    if (!(await this.list()).some((b) => b.id === id)) return null;
    const store = new NodeStorage(join(this.dir, id));
    const { files } = await store.list();
    const texts = await store.readMany(files);
    const out = {};
    files.forEach((p, i) => { if (texts[i]) out[p] = texts[i].text; });
    return out;
  }

  async _snapshot() {
    const { files } = await this.storage.list();
    return files.filter(syncable).sort();
  }

  /** A backup, if something changed since the last one and the last is an hour old. */
  async maybe() {
    const last = (await this.list()).find((b) => !b.manual) || (await this.list())[0];
    if (last && this.now() - last.at < HOUR) return null;
    if (last && !(await this._changedSince(last.id))) { await this.prune(); return null; }
    return this.make(false);
  }

  async _changedSince(id) {
    const now = await this._snapshot();
    const texts = await this.storage.readMany(now);
    const old = await this.files(id);
    if (!old) return true;
    if (Object.keys(old).length !== now.length) return true;
    return now.some((p, i) => !texts[i] || old[p] !== texts[i].text);
  }

  /** A backup now. → its id */
  make(manual = true) {
    if (this.running) return this.running;
    this.running = (async () => {
      const id = nameOf(this.now(), manual);
      const target = join(this.dir, id);
      const prev = (await this.list())[0];
      const paths = await this._snapshot();
      const texts = await this.storage.readMany(paths);
      await fs.mkdir(target, { recursive: true });
      for (let i = 0; i < paths.length; i++) {
        if (!texts[i]) continue;
        const dst = join(target, ...paths[i].split('/'));
        await fs.mkdir(dirname(dst), { recursive: true });
        if (prev) {
          const src = join(this.dir, prev.id, ...paths[i].split('/'));
          try {
            if ((await fs.readFile(src, 'utf8')) === texts[i].text) { await fs.link(src, dst); continue; }
          } catch { /* not in that one, or it differs */ }
        }
        await fs.writeFile(dst, texts[i].text, 'utf8');
      }
      await this.prune();
      return id;
    })().finally(() => { this.running = null; });
    return this.running;
  }

  /** Keep hourly for 12 hours, daily for 7 days, weekly for 26 weeks; hand-made ones always. */
  async prune() {
    const all = (await this.list()).filter((b) => !b.manual);
    const now = this.now();
    const keep = new Set();
    const bucket = (b, size, span) => {
      if (now - b.at > span) return null;
      return Math.floor(b.at / size);
    };
    const seen = { h: new Set(), d: new Set(), w: new Set() };
    for (const b of all) {             // newest first: the newest of each bucket stays
      const h = bucket(b, HOUR, 12 * HOUR), d = bucket(b, DAY, 7 * DAY), w = bucket(b, 7 * DAY, 26 * 7 * DAY);
      let kept = false;
      if (h !== null && !seen.h.has(h)) { seen.h.add(h); kept = true; }
      if (d !== null && !seen.d.has(d)) { seen.d.add(d); kept = true; }
      if (w !== null && !seen.w.has(w)) { seen.w.add(w); kept = true; }
      if (kept) keep.add(b.id);
    }
    if (all.length) keep.add(all[0].id);
    for (const b of all) if (!keep.has(b.id)) await fs.rm(join(this.dir, b.id), { recursive: true, force: true });
  }

  async remove(id) {
    if (!(await this.list()).some((b) => b.id === id)) return false;
    await fs.rm(join(this.dir, id), { recursive: true, force: true });
    return true;
  }
}
