// The library folder, offered to the app's own page as storage (the page runs
// the engine itself and reads and writes through engine/src/storage-http.js):
// the storage contract of engine/src/storage.js, over HTTP, with each file's
// modification time in the listing so a page rescans only what changed.
//
// What is offered is the library and nothing else: never the server's
// password file, and nothing outside the folder.
import { promises as fs, createReadStream } from 'node:fs';
import { join, relative, sep, dirname, extname } from 'node:path';
import { checkPath, IGNORED_DIRS } from '../../engine/src/storage.js';
import { NodeStorage } from '../../engine/src/storage-node.js';

// .moshe/ holds the library's own files (library.json, trash, conflicts), and
// may hold auth.json on a server run without MOSHE_AUTH_FILE: only these are
// the library's.
const OWN = [/^\.moshe\/library\.json$/u, /^\.moshe\/trash(\/|$)/u, /^\.moshe\/conflicts(\/|$)/u, /^\.moshe\/conformance-[^/]+(\/|$)/u, /^\.moshe$/u];

/** May a page see or touch this path? */
export function offered(path) {
  try { checkPath(path); } catch { return false; }
  const parts = path.split('/');
  if (parts[0] === '.moshe') return OWN.some((re) => re.test(path));
  // what is inside .git, .obsidian… is not the library's either
  return !parts.slice(0, -1).some((p) => IGNORED_DIRS.has(p));
}

export const MEDIA_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.heic': 'image/heic', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.mov': 'video/quicktime',
};

export class Files {
  constructor(root) {
    this.root = root;
    this.storage = new NodeStorage(root);
  }

  /** Every file and folder offered, with modification times. */
  async list() {
    const files = [], dirs = [], mtimes = {};
    const walk = async (dir) => {
      let entries;
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      await Promise.all(entries.map(async (e) => {
        const p = join(dir, e.name);
        const rel = relative(this.root, p).split(sep).join('/');
        if (e.name.endsWith('.moshe-tmp')) return;
        if (e.isDirectory()) {
          if (!offered(rel) && !(rel === '.moshe')) return;
          if (IGNORED_DIRS.has(e.name) && e.name !== '.moshe') return;
          dirs.push(rel);
          await walk(p);
        } else if (e.isFile() && offered(rel)) {
          files.push(rel);
          try { mtimes[rel] = Number((await fs.stat(p)).mtimeMs); } catch { /* gone meanwhile */ }
        }
      }));
    };
    await walk(this.root);
    return { files: files.filter((f) => f in mtimes), dirs, mtimes };
  }

  _check(path) {
    if (!offered(path)) throw Object.assign(new Error(`not a file of the library: ${path}`), { status: 403 });
    return path;
  }

  async readMany(paths) { return this.storage.readMany(paths.map((p) => this._check(p))); }
  async write(path, text) { return this.storage.write(this._check(path), text); }
  async remove(path) { return this.storage.remove(this._check(path)); }
  async move(from, to) { return this.storage.move(this._check(from), this._check(to)); }
  async mkdir(path) { return this.storage.mkdir(this._check(path)); }
  async removeDir(path) { return this.storage.removeDir(this._check(path)); }

  /** An image or other file as it is, for the editor's previews. */
  async raw(path) {
    this._check(path);
    const abs = join(this.root, ...path.split('/'));
    const st = await fs.stat(abs);
    return { stream: createReadStream(abs), size: st.size, type: MEDIA_TYPES[extname(abs).toLowerCase()] || 'application/octet-stream', mtime: st.mtimeMs };
  }

  async writeRaw(path, buf) {
    this._check(path);
    const abs = join(this.root, ...path.split('/'));
    await fs.mkdir(dirname(abs), { recursive: true });
    const tmp = abs + '.moshe-tmp';
    await fs.writeFile(tmp, buf);
    await fs.rename(tmp, abs);
    return { mtime: Number((await fs.stat(abs)).mtimeMs) };
  }
}
