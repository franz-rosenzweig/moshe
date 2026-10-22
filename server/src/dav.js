// The library over WebDAV, for the built-in sync (engine/src/webdav.js): a
// device that keeps its own copy of the library (the Android app, say, with
// no Syncthing) keeps it in step with this one. Class 1 WebDAV, as much as a
// sync needs: OPTIONS, PROPFIND, GET, HEAD, PUT, DELETE, MKCOL.
//
// A write is taken only if the device made it from the version here now
// (If-Match on the file's hash); the device merged with that version first,
// so what it sends is taken as it is. Only what a sync carries is offered
// (engine/src/store.js, syncable): the sheets, the folders' settings, the
// library's, the trash. Never anything else in the folder.
import { sha1 } from '../../engine/src/sha1.js';
import { syncable, isGroupDir, TRASH } from '../../engine/src/store.js';
import { NodeStorage } from '../../engine/src/storage-node.js';

export const DAV_PREFIX = '/dav/';
const MAX_FILE = 8 * 1024 * 1024;

const etagOf = (text) => `"${sha1(text)}"`;
const esc = (s) => s.replace(/[&<>"]/gu, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hrefOf = (rel, dir) => DAV_PREFIX + rel.split('/').filter(Boolean).map(encodeURIComponent).join('/') + (dir && rel ? '/' : '');
const typeOf = (p) => (p.endsWith('.json') ? 'application/json' : 'text/markdown');

function listed(header, etag) {
  return String(header).split(',').map((s) => s.trim().replace(/^W\//u, '')).some((t) => t === '*' || t === etag);
}

/** Folders a synced file may be in. */
const folderOk = (d) => d === '' || d === '.moshe' || isGroupDir(d) || d === 'Projects' || d === TRASH || d.startsWith(TRASH + '/');

export class Dav {
  constructor(root, { onChange = () => {} } = {}) {
    this.storage = new NodeStorage(root);
    this.onChange = onChange;
    this._lock = Promise.resolve();
  }

  /** One write at a time: the check against If-Match and the write that depends on it are one step. */
  _serial(fn) {
    const p = this._lock.then(fn);
    this._lock = p.catch(() => {});
    return p;
  }

  async _files() {
    const listing = await this.storage.list();
    const files = listing.files.filter(syncable);
    const texts = await this.storage.readMany(files);
    const out = new Map();
    files.forEach((p, i) => { if (texts[i]) out.set(p, texts[i].text.replace(/\r\n?/gu, '\n')); });
    const dirs = new Set(['']);
    for (const p of out.keys()) {
      const parts = p.split('/');
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
    }
    for (const d of listing.dirs) if (folderOk(d)) dirs.add(d);
    return { files: out, dirs };
  }

  async handle(method, rel, headers, readBody) {
    rel = rel.replace(/\/+$/u, '');
    if (rel.split('/').some((p) => p === '..' || p === '.')) return { status: 400, body: 'bad path' };
    switch (method) {
      case 'OPTIONS': return { status: 200, headers: { DAV: '1', Allow: 'OPTIONS, PROPFIND, GET, HEAD, PUT, DELETE, MKCOL' } };
      case 'PROPFIND': return this.propfind(rel, headers.depth);
      case 'GET': case 'HEAD': return this.get(rel, method === 'HEAD');
      case 'PUT': return this._serial(() => this.put(rel, headers, readBody));
      case 'DELETE': return this._serial(() => this.remove(rel, headers));
      case 'MKCOL': return this._serial(() => this.mkcol(rel));
      default: return { status: 405, headers: { Allow: 'OPTIONS, PROPFIND, GET, HEAD, PUT, DELETE, MKCOL' }, body: 'not supported here' };
    }
  }

  async propfind(rel, depthHeader) {
    const depth = depthHeader === '0' ? 0 : depthHeader === '1' ? 1 : Infinity;
    const { files, dirs } = await this._files();
    const entries = [];
    const fileEntry = (p) => {
      const text = files.get(p);
      entries.push(`<d:response><d:href>${esc(hrefOf(p, false))}</d:href><d:propstat><d:prop>`
        + `<d:resourcetype/><d:getetag>${esc(etagOf(text))}</d:getetag>`
        + `<d:getcontentlength>${new TextEncoder().encode(text).length}</d:getcontentlength>`
        + `<d:getcontenttype>${typeOf(p)}</d:getcontenttype>`
        + `<d:displayname>${esc(p.split('/').pop())}</d:displayname>`
        + '</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>');
    };
    const dirEntry = (d) => {
      entries.push(`<d:response><d:href>${esc(hrefOf(d, true))}</d:href><d:propstat><d:prop>`
        + `<d:resourcetype><d:collection/></d:resourcetype><d:displayname>${esc(d.split('/').pop() || 'dav')}</d:displayname>`
        + '</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>');
    };
    if (files.has(rel)) fileEntry(rel);
    else if (dirs.has(rel)) {
      dirEntry(rel);
      if (depth > 0) {
        const under = (p) => (rel === '' ? p : p.startsWith(rel + '/') ? p.slice(rel.length + 1) : null);
        const within = (p) => { const u = under(p); return u !== null && u !== '' && (depth === Infinity || !u.includes('/')); };
        for (const d of [...dirs].sort()) if (within(d)) dirEntry(d);
        for (const p of [...files.keys()].sort()) if (within(p)) fileEntry(p);
      }
    } else return { status: 404, body: 'not found' };
    return {
      status: 207,
      headers: { 'Content-Type': 'application/xml; charset=utf-8' },
      body: `<?xml version="1.0" encoding="utf-8"?>\n<d:multistatus xmlns:d="DAV:">${entries.join('')}</d:multistatus>\n`,
    };
  }

  async _current(rel) {
    if (!syncable(rel)) return undefined;
    const r = await this.storage.read(rel);
    return r ? r.text.replace(/\r\n?/gu, '\n') : undefined;
  }

  async get(rel, head) {
    const text = await this._current(rel);
    if (text === undefined) return { status: 404, body: 'not found' };
    return {
      status: 200,
      headers: { 'Content-Type': `${typeOf(rel)}; charset=utf-8`, ETag: etagOf(text) },
      body: head ? undefined : text,
      length: new TextEncoder().encode(text).length,
    };
  }

  static precondition(current, headers) {
    const etag = current === undefined ? null : etagOf(current);
    if (headers['if-match'] !== undefined && (etag === null || !listed(headers['if-match'], etag))) return false;
    if (headers['if-none-match'] !== undefined && etag !== null && listed(headers['if-none-match'], etag)) return false;
    return true;
  }

  async put(rel, headers, readBody) {
    if (!syncable(rel)) return { status: 403, body: 'only the sheets and the library\'s own settings are kept here' };
    const raw = await readBody();
    if (raw.length > MAX_FILE) return { status: 413, body: 'too large for a sheet' };
    const text = new TextDecoder('utf-8', { fatal: false }).decode(raw).replace(/\r\n?/gu, '\n');
    const current = await this._current(rel);
    if (!Dav.precondition(current, headers)) return { status: 412, body: 'the file here changed; fetch it and merge again' };
    await this.storage.write(rel, text);
    this.onChange([rel]);
    return { status: current === undefined ? 201 : 204, headers: { ETag: etagOf(text) } };
  }

  async remove(rel, headers) {
    const current = await this._current(rel);
    if (current === undefined) return { status: 404, body: 'not found' };
    if (!Dav.precondition(current, headers)) return { status: 412, body: 'the file here changed; fetch it and merge again' };
    await this.storage.remove(rel);
    this.onChange([rel]);
    return { status: 204 };
  }

  async mkcol(rel) {
    if (!rel || !folderOk(rel)) return { status: 403, body: 'not a folder the library has' };
    const { files, dirs } = await this._files();
    if (files.has(rel) || dirs.has(rel)) return { status: 405, body: 'already there' };
    await this.storage.mkdir(rel);
    return { status: 201 };
  }
}
