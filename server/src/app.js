// The Moshe server. The app is the page: it runs the engine itself, and the
// server gives it the library folder to work on (files.js), tells it when
// someone else changed the folder (the event stream), keeps backups
// (backups.js), and offers the folder over WebDAV to devices that keep a copy
// of their own (dav.js). And signing in, as Dvarim's server does it.
import { createServer } from 'node:http';
import { createReadStream, statSync, watch } from 'node:fs';
import { extname, join, resolve, sep, relative } from 'node:path';
import { Auth, SESSION_COOKIE, SESSION_DAYS, Throttle } from './auth.js';
import { Dav, DAV_PREFIX } from './dav.js';
import { Files, offered } from './files.js';
import { Backups } from './backups.js';
import { Sheets } from './sheets.js';

const PUBLIC_API = new Set(['/api/login', '/api/auth', '/api/health']);
const MAX_BODY = 32 * 1024 * 1024;
export const KEEP_ALIVE_MS = 120000;
const REVALIDATE = { 'Cache-Control': 'no-cache' };
const FOREVER = { 'Cache-Control': 'public, max-age=31536000, immutable' };
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8', '.map': 'application/json', '.wasm': 'application/wasm',
  // Hunspell's dictionary (Hebrew spelling): text, so a proxy compresses its 5.7 MB
  '.dic': 'text/plain; charset=utf-8', '.aff': 'text/plain; charset=utf-8',
};

function send(res, status, body, headers = {}) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': data.length, 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim().replace(/^"|"$/gu, ''));
  }
  return out;
}

const effectiveHost = (req) => String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
const isHttps = (req) => String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() === 'https';

/** A request that changes something, from a page on another site, is refused. */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host.toLowerCase() === effectiveHost(req); } catch { return false; }
}

function clientKey(req) {
  const fwd = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || '';
  const ip = fwd ? String(fwd).split(',')[0].trim() : (req.socket && req.socket.remoteAddress);
  return ip || '?';
}

const sessionCookie = (value, req) => `${SESSION_COOKIE}=${value}; HttpOnly; Max-Age=${SESSION_DAYS * 86400}; Path=/; SameSite=strict${isHttps(req) ? '; Secure' : ''}`;

function readRaw(req) {
  return new Promise((ok, fail) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { fail(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', fail);
  });
}

async function jsonBody(req) {
  try {
    const v = JSON.parse((await readRaw(req)).toString('utf8'));
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

const DAV_CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'ETag, DAV, Content-Length' };
const DAV_PREFLIGHT = {
  ...DAV_CORS,
  'Access-Control-Allow-Methods': 'OPTIONS, PROPFIND, GET, HEAD, PUT, DELETE, MKCOL',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Depth, If-Match, If-None-Match',
  'Access-Control-Max-Age': '600',
};

/**
 * @param {object} cfg
 * @param {string} cfg.root         the library folder
 * @param {string} [cfg.staticDir]  the built app
 * @param {string} [cfg.authFile]
 * @param {string} [cfg.backupDir]  where backups go (none if unset)
 * @param {boolean} [cfg.watch]     watch the folder for others' changes (default true)
 * @param {string} [cfg.languageTool]  a LanguageTool server's address, for Check Text (none if unset)
 */
export async function createApp(cfg) {
  const log = cfg.log || ((...a) => console.error(...a));
  const root = resolve(cfg.root);
  const files = new Files(root);
  const sheets = new Sheets(files);
  const auth = Auth.load(root, cfg.authFile);
  const throttle = new Throttle();
  const staticDir = cfg.staticDir ? resolve(cfg.staticDir) : null;
  const streams = new Set();
  const backups = cfg.backupDir ? new Backups(root, resolve(cfg.backupDir), { log }) : null;

  // ---- what changed: every page is told, and rescans
  let pending = new Set(), timer = null;
  const changed = (paths) => {
    for (const p of paths) pending.add(p);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const list = [...pending];
      pending = new Set();
      for (const s of streams) s.res.write(`event: changed\ndata: ${JSON.stringify({ paths: list })}\n\n`);
    }, 250);
  };
  const dav = new Dav(root, { onChange: changed });
  let watcher = null;
  if (cfg.watch !== false) {
    try {
      watcher = watch(root, { recursive: true }, (_type, name) => {
        if (!name) return;
        const rel = String(name).split(sep).join('/');
        if (rel.endsWith('.moshe-tmp') || !offered(rel)) return;
        changed([rel]);
      });
      watcher.on('error', (e) => log('watch:', e.message));
    } catch (e) { log('watch:', e.message); }
  }

  // With no password, only this machine and the tailnet may in: a request
  // through a tunnel or a proxy (Cloudflare's, say) is refused until one is
  // set, so a public address added before the password exposes nothing.
  const viaProxy = (req) => !!(req.headers['cf-ray'] || req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']);
  const openToAll = (req) => !auth.enabled && !viaProxy(req);
  const authenticated = (req) => {
    auth.refresh();
    if (openToAll(req)) return true;
    return auth.enabled && auth.checkSession(cookies(req)[SESSION_COOKIE]);
  };

  const davAuthenticated = (req) => {
    auth.refresh();
    if (openToAll(req)) return true;
    if (!auth.enabled) return false;
    const header = String(req.headers.authorization || '');
    const lower = header.toLowerCase();
    if (lower.startsWith('bearer ')) return !!auth.checkToken(header.slice(7).trim());
    if (lower.startsWith('basic ')) {
      const pair = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
      return !!auth.checkToken(pair.slice(pair.indexOf(':') + 1));
    }
    return sameOrigin(req) && auth.checkSession(cookies(req)[SESSION_COOKIE]);
  };

  async function serveDav(req, res, path, method) {
    if (method === 'OPTIONS' && req.headers['access-control-request-method']) { res.writeHead(204, DAV_PREFLIGHT); return res.end(); }
    const key = clientKey(req);
    const wait = throttle.retryAfter(key);
    if (wait > 0) { res.writeHead(429, { ...DAV_CORS, 'Retry-After': String(Math.floor(wait) + 1) }); return res.end('too many attempts'); }
    if (!davAuthenticated(req)) {
      if (req.headers.authorization) throttle.recordFailure(key);
      res.writeHead(401, { ...DAV_CORS, 'WWW-Authenticate': 'Basic realm="Moshe", charset="UTF-8"', 'Content-Type': 'text/plain' });
      return res.end('a token is needed: Settings → Sync on the server makes one');
    }
    let rel;
    try { rel = decodeURIComponent(path.slice(DAV_PREFIX.length)); } catch { rel = null; }
    if (rel === null) { res.writeHead(400, DAV_CORS); return res.end(); }
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
    const out = await dav.handle(method, rel, headers, () => readRaw(req));
    const body = out.body === undefined ? null : Buffer.from(out.body, 'utf8');
    res.writeHead(out.status, {
      ...DAV_CORS, 'Cache-Control': 'no-store', ...(out.headers || {}),
      ...(body ? { 'Content-Length': body.length } : out.length !== undefined ? { 'Content-Length': out.length } : {}),
      ...(body && !(out.headers && out.headers['Content-Type']) ? { 'Content-Type': 'text/plain; charset=utf-8' } : {}),
    });
    return res.end(body || undefined);
  }

  // ---- the page's storage (engine/src/storage-http.js)
  async function fsApi(req, res, path, method, url) {
    const op = path.slice('/api/fs/'.length);
    try {
      if (op === 'list' && method === 'GET') return send(res, 200, await files.list());
      if (op === 'raw' && method === 'GET') {
        const p = url.searchParams.get('path') || '';
        const r = await files.raw(p);
        res.writeHead(200, { 'Content-Type': r.type, 'Content-Length': r.size, 'Cache-Control': 'no-cache' });
        return r.stream.pipe(res);
      }
      if (op === 'raw' && method === 'PUT') {
        const p = url.searchParams.get('path') || '';
        const out = await files.writeRaw(p, await readRaw(req));
        changed([p]);
        return send(res, 200, out);
      }
      if (method !== 'POST') return send(res, 405, { error: 'method not allowed' });
      const b = await jsonBody(req);
      switch (op) {
        case 'read': return send(res, 200, await files.readMany(Array.isArray(b.paths) ? b.paths.map(String) : []));
        case 'write': { const out = await files.write(String(b.path), String(b.text ?? '')); changed([String(b.path)]); return send(res, 200, out); }
        case 'remove': await files.remove(String(b.path)); changed([String(b.path)]); return send(res, 200, null);
        case 'move': await files.move(String(b.from), String(b.to)); changed([String(b.from), String(b.to)]); return send(res, 200, null);
        case 'mkdir': await files.mkdir(String(b.path)); return send(res, 200, null);
        case 'removeDir': return send(res, 200, await files.removeDir(String(b.path)));
        default: return send(res, 404, { error: 'no such operation' });
      }
    } catch (e) {
      const status = e.status || (e.code === 'ENOENT' ? 404 : e.code === 'EEXIST' ? 409 : e.code === 'EINVAL' ? 400 : 500);
      if (status >= 500) log(`fs ${op}:`, e);
      return send(res, status, { error: { code: e.code || 'EIO', message: e.message } });
    }
  }

  async function backupsApi(req, res, path, method) {
    if (!backups) return send(res, 404, { error: 'backups are not kept by this server (MOSHE_BACKUPS)' });
    if (path === '/api/backups' && method === 'GET') return send(res, 200, { backups: await backups.list() });
    if (path === '/api/backups' && method === 'POST') return send(res, 200, { id: await backups.make(true) });
    const m = /^\/api\/backups\/([^/]+)$/u.exec(path);
    if (m && method === 'GET') {
      const f = await backups.files(decodeURIComponent(m[1]));
      return f ? send(res, 200, { files: f }) : send(res, 404, { error: 'no such backup' });
    }
    if (m && method === 'DELETE') return send(res, 200, { removed: await backups.remove(decodeURIComponent(m[1])) });
    return send(res, 405, { error: 'method not allowed' });
  }

  async function sheetsApi(req, res, path, method, url) {
    const key = clientKey(req);
    if (throttle.retryAfter(key) > 0) return send(res, 429, { error: 'too many attempts; wait a little' });
    if (!authenticated(req) && !davAuthenticated(req)) {
      if (req.headers.authorization) throttle.recordFailure(key);
      return send(res, 401, { error: 'a token is needed: Settings → Sync on the server makes one' });
    }
    try {
      if (path === '/api/sheets' && method === 'GET') return send(res, 200, { sheets: await sheets.list(url.searchParams.get('group') || 'Notes') });
      if (method !== 'POST') return send(res, 405, { error: 'method not allowed' });
      const b = await jsonBody(req);
      if (path === '/api/sheets') {
        const out = await sheets.create(b.group, b.text);
        changed([out.path]);
        return send(res, 201, out);
      }
      if (path === '/api/sheets/append') {
        const out = await sheets.append(b.sheet ?? b.path ?? b.title, b.text, { group: b.group || null, atStart: b.at === 'start', create: !!b.create });
        changed([out.path]);
        return send(res, out.created ? 201 : 200, out);
      }
      return send(res, 404, { error: 'no such endpoint' });
    } catch (e) {
      if (!e.status || e.status >= 500) log('sheets:', e);
      return send(res, e.status || 500, { error: e.status ? e.message : 'internal error' });
    }
  }

  // Check Text: the page's prose sent on to LanguageTool, which stays private
  // behind this server (it may be starting: systemd wakes it on the first request)
  async function proofApi(req, res, method) {
    const lt = cfg.languageTool && String(cfg.languageTool).replace(/\/+$/u, '');
    if (method === 'GET') return send(res, 200, { available: !!lt });
    if (method !== 'POST') return send(res, 405, { error: 'method not allowed' });
    if (!lt) return send(res, 404, { error: 'no grammar checker on this server (MOSHE_LANGUAGETOOL)' });
    const b = await jsonBody(req);
    const text = String(b.text ?? '');
    if (!text.trim()) return send(res, 200, { matches: [], language: null });
    if (text.length > 100000) return send(res, 413, { error: 'too much text at once' });
    const form = new URLSearchParams({ text, language: String(b.language || 'auto') });
    if (!b.language || b.language === 'auto') form.set('preferredVariants', String(b.variants || 'en-US,de-DE,pt-PT,ca-ES'));
    if (b.level === 'picky') form.set('level', 'picky');
    let r;
    try {
      r = await fetch(`${lt}/v2/check`, { method: 'POST', body: form, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(90000) });
    } catch (e) {
      log('proof:', e.message);
      return send(res, 502, { error: 'the grammar checker did not answer' });
    }
    if (!r.ok) return send(res, 502, { error: `the grammar checker said ${r.status}` });
    const j = await r.json();
    return send(res, 200, {
      language: j.language && j.language.detectedLanguage ? j.language.detectedLanguage.name : (j.language && j.language.name) || null,
      matches: (j.matches || []).map((m) => ({
        offset: m.offset, length: m.length, message: m.message, short: m.shortMessage || '',
        replacements: (m.replacements || []).slice(0, 6).map((x) => x.value),
        rule: m.rule ? m.rule.id : '', issue: m.rule ? m.rule.issueType : '', category: m.rule && m.rule.category ? m.rule.category.id : '',
      })),
    });
  }

  async function tokens(req, res, path, method) {
    if (path === '/api/tokens' && method === 'GET') return send(res, 200, { tokens: auth.tokenList() });
    if (path === '/api/tokens' && method === 'POST') {
      const name = String((await jsonBody(req)).name ?? '').trim();
      if (!/^[\p{L}\p{N} ._'’()-]{1,40}$/u.test(name)) return send(res, 400, { error: 'give the device a name: letters, digits and spaces, up to 40' });
      if (auth.tokenList().some((t) => t.name === name)) return send(res, 409, { error: `there is already a device called ${name}` });
      return send(res, 200, { name, token: auth.addToken(name) });
    }
    const m = /^\/api\/tokens\/(.+)$/u.exec(path);
    if (m && method === 'DELETE') return send(res, 200, { removed: auth.removeToken(decodeURIComponent(m[1])) });
    return send(res, 405, { error: 'method not allowed' });
  }

  async function login(req, res) {
    if (!auth.enabled && !viaProxy(req)) return send(res, 200, { authenticated: true, required: false });
    if (!auth.enabled) return send(res, 403, { error: 'no password is set on the server yet: on the server, run docker exec -it moshe node server/src/cli.js set-password' });
    const key = clientKey(req);
    const wait = throttle.retryAfter(key);
    if (wait > 0) return send(res, 429, { error: `too many attempts; try again in ${Math.floor(wait) + 1}s` }, { 'Retry-After': String(Math.floor(wait) + 1) });
    const data = await jsonBody(req);
    if (!auth.verify(String(data.password ?? ''))) {
      const delay = throttle.recordFailure(key);
      return send(res, 401, { error: 'wrong password' }, { 'Retry-After': String(Math.floor(delay) + 1) });
    }
    throttle.clear(key);
    return send(res, 200, { authenticated: true, required: true }, { 'Set-Cookie': sessionCookie(auth.issueSession(), req) });
  }

  async function changePassword(req, res) {
    if (!auth.enabled) return send(res, 400, { error: 'no password is set; use the command line to set one' });
    const data = await jsonBody(req);
    const key = clientKey(req);
    if (throttle.retryAfter(key) > 0) return send(res, 429, { error: 'too many attempts; wait a little' });
    if (!auth.verify(String(data.currentPassword ?? ''))) { throttle.recordFailure(key); return send(res, 403, { error: 'that is not the current password' }); }
    try { auth.setPassword(String(data.newPassword ?? '')); } catch (e) { return send(res, 400, { error: e.message }); }
    throttle.clear(key);
    auth.rotateSecret();
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(auth.issueSession(), req) });
  }

  function stream(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
    res.write('event: hello\ndata: {}\n\n');
    const alive = setInterval(() => res.write(': keepalive\n\n'), 20000);
    const entry = { res, alive };
    streams.add(entry);
    req.on('close', () => { clearInterval(alive); streams.delete(entry); });
  }

  function serveStatic(req, res, pathname) {
    const head = req.method === 'HEAD';
    if (!staticDir) return send(res, 404, { error: 'the app is not built; run frontend/build.sh' });
    let rel;
    try { rel = decodeURIComponent(pathname).replace(/^\/+/u, ''); } catch { rel = ''; }
    const file = (p, headers) => {
      const st = statSync(p);
      res.writeHead(200, { 'Content-Type': TYPES[extname(p).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, ...headers });
      if (head) return res.end();
      createReadStream(p).pipe(res);
      return undefined;
    };
    if (rel) {
      const target = resolve(staticDir, rel);
      let isFile = false;
      try { isFile = statSync(target).isFile(); } catch { /* not there */ }
      if (isFile && target.startsWith(staticDir + sep)) return file(target, rel.startsWith('assets/') ? FOREVER : REVALIDATE);
    }
    const index = join(staticDir, 'index.html');
    try { if (statSync(index).isFile()) return file(index, REVALIDATE); } catch { /* fall through */ }
    return send(res, 404, { error: 'the app is not built; run frontend/build.sh' });
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://local');
    const path = url.pathname;
    const method = (req.method || 'GET').toUpperCase();
    if (path.startsWith('/api/')) {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !sameOrigin(req)) return send(res, 403, { error: 'cross-site request refused' });
      if (path === '/api/health') return send(res, 200, { ok: true, app: 'moshe' });
      // sheets from outside (Shortcuts, a bot): a device token, or the signed-in page
      if (path === '/api/sheets' || path.startsWith('/api/sheets/')) return sheetsApi(req, res, path, method, url);
      if (!PUBLIC_API.has(path) && !authenticated(req)) return send(res, 401, { error: 'not signed in' });
      if (path === '/api/auth' && method === 'GET') return send(res, 200, { required: auth.enabled || viaProxy(req), authenticated: authenticated(req), passwordSet: auth.enabled });
      if (path === '/api/login' && method === 'POST') return login(req, res);
      if (path === '/api/logout' && method === 'POST') {
        return send(res, 200, { authenticated: false }, { 'Set-Cookie': `${SESSION_COOKIE}=""; expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; Path=/` });
      }
      if (path === '/api/password' && method === 'POST') return changePassword(req, res);
      if (path === '/api/events' && method === 'GET') return stream(req, res);
      if (path.startsWith('/api/fs/')) return fsApi(req, res, path, method, url);
      if (path === '/api/proof') return proofApi(req, res, method);
      if (path === '/api/backups' || path.startsWith('/api/backups/')) return backupsApi(req, res, path, method);
      if (path === '/api/tokens' || path.startsWith('/api/tokens/')) return tokens(req, res, path, method);
      return send(res, 404, { error: 'no such endpoint' });
    }
    if (path === '/dav' || path.startsWith(DAV_PREFIX)) return serveDav(req, res, path === '/dav' ? DAV_PREFIX : path, method);
    if (method === 'GET' || method === 'HEAD') return serveStatic(req, res, path);
    return send(res, 405, { error: 'method not allowed' });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      log(`${req.method} ${req.url}:`, e);
      if (!res.headersSent) send(res, e.status || 500, { error: e.status === 413 ? 'request too large' : 'internal error' });
      else res.end();
    });
  });
  server.keepAliveTimeout = KEEP_ALIVE_MS;
  server.headersTimeout = KEEP_ALIVE_MS + 5000;
  if (backups && cfg.backupEvery !== 0) backups.start(cfg.backupEvery);

  return {
    server, auth, files, backups, dav,
    listen(port, host) { return new Promise((ok) => server.listen(port, host, () => ok(server.address()))); },
    async close() {
      if (watcher) watcher.close();
      if (backups) backups.close();
      clearTimeout(timer);
      for (const s of streams) { clearInterval(s.alive); s.res.end(); }
      streams.clear();
      await new Promise((ok) => server.close(() => ok()));
    },
  };
}

export { relative };
