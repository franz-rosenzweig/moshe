// The server's library folder as storage, for the page the server serves
// (server/src/files.js is the other half). The page runs the engine itself;
// this carries each storage call to the server. The listing includes each
// file's modification time, so the store rescans only what changed.
import { StorageError } from './storage.js';

export class HttpStorage {
  /** @param {string} base  the site, '' for this page's own */
  constructor(base = '', fetchFn = globalThis.fetch.bind(globalThis)) {
    this.base = base;
    this.fetch = fetchFn;
    this.onUnauthorized = null;
  }

  async _call(op, body, method = 'POST') {
    let res;
    try {
      res = await this.fetch(`${this.base}/api/fs/${op}`, {
        method,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin',
      });
    } catch (e) {
      throw new StorageError('EIO', `the server could not be reached: ${e && e.message ? e.message : e}`);
    }
    if (res.status === 401) {
      if (this.onUnauthorized) this.onUnauthorized();
      throw new StorageError('EACCES', 'signed out: sign in again');
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = data && data.error;
      throw new StorageError((err && err.code) || 'EIO', (err && err.message) || (typeof err === 'string' ? err : `HTTP ${res.status}`));
    }
    return data;
  }

  list() { return this._call('list', undefined, 'GET'); }
  async read(path) { return (await this._call('read', { paths: [path] }))[0]; }
  readMany(paths) { return paths.length ? this._call('read', { paths }) : Promise.resolve([]); }
  write(path, text) { return this._call('write', { path, text }); }
  remove(path) { return this._call('remove', { path }); }
  move(from, to) { return this._call('move', { from, to }); }
  mkdir(path) { return this._call('mkdir', { path }); }
  removeDir(path) { return this._call('removeDir', { path }); }

  /** A file's address for an <img>: media beside the sheets. */
  rawUrl(path) { return `${this.base}/api/fs/raw?path=${encodeURIComponent(path)}`; }

  async writeRaw(path, blob) {
    const res = await this.fetch(`${this.base}/api/fs/raw?path=${encodeURIComponent(path)}`, { method: 'PUT', body: blob, credentials: 'same-origin' });
    if (!res.ok) throw new StorageError('EIO', `could not store ${path} (HTTP ${res.status})`);
    return res.json();
  }

  async info() {
    return { name: 'the server', detail: `${this.base || location.host}`, canPick: false, pollSeconds: 0 };
  }
}
