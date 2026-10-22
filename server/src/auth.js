// Signing in: one password, a signed session cookie, and named tokens for the
// devices that sync with this server over WebDAV. Dvarim's (server/src/auth.js
// there), which it had from its Python server.
//
// What it defends against, the app being on the public internet:
//   - guessing the password (scrypt, and per-address backoff on failures)
//   - reading or forging a session cookie (HMAC-SHA256 over the payload)
//   - a page on another site acting as you (SameSite=Strict, and a same-origin
//     check on every request that changes something: http.js)
//   - a stolen token living forever (expiry; rotating `secret` signs everyone out)
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const SCRYPT = { N: 2 ** 14, r: 8, p: 1 };
export const SESSION_COOKIE = 'moshe_session';
export const SESSION_DAYS = 30;
// Typos should not lock you out, but a script should die quickly: the first
// few tries are free, then each failure doubles the wait, per client address.
const LOCKOUT_FREE_ATTEMPTS = 3;
const LOCKOUT_BASE_SECONDS = 2.0;
const LOCKOUT_MAX_SECONDS = 300.0;

/** base64url without padding: Python's urlsafe_b64encode(...).rstrip("="). */
export const b64 = (buf) => Buffer.from(buf).toString('base64url');
export const unb64 = (s) => Buffer.from(s, 'base64url');

const scrypt = (password, salt, N, r, p) =>
  scryptSync(Buffer.from(password, 'utf8'), salt, 32, { N, r, p, maxmem: 256 * N * r + 1024 * 1024 });

export function hashPassword(password, salt = randomBytes(16)) {
  const dk = scrypt(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p);
  return { algo: 'scrypt', n: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, salt: b64(salt), hash: b64(dk) };
}

export function verifyPassword(password, record) {
  if (!record || record.algo !== 'scrypt') return false;
  let dk, want;
  try {
    dk = scrypt(password, unb64(record.salt), Number(record.n), Number(record.r), Number(record.p));
    want = unb64(record.hash);
  } catch {
    return false;
  }
  return dk.length === want.length && timingSafeEqual(dk, want);
}

const now = () => Date.now() / 1000;
// Which version of the file: every save renames a new one into place, so its
// inode tells even two saves in the same clock tick apart.
const mtimeOf = (path) => { try { const st = statSync(path); return `${st.ino}:${st.mtimeMs}:${st.size}`; } catch { return null; } };

export class Auth {
  /**
   * @param {string} path  the auth file: MOSHE_AUTH_FILE, or <root>/.moshe/auth.json
   */
  constructor(path, data) {
    this.path = path;
    this.data = data;
  }

  static load(root, override = process.env.MOSHE_AUTH_FILE) {
    const path = override || join(root, '.moshe', 'auth.json');
    const data = { password: null, secret: b64(randomBytes(32)), tokens: {} };
    if (existsSync(path)) {
      try {
        Object.assign(data, JSON.parse(readFileSync(path, 'utf8')));
      } catch { /* unreadable: start from the defaults, as the Python does */ }
    }
    const auth = new Auth(path, data);
    if (!existsSync(path)) auth.save();
    else auth._mtime = mtimeOf(path);
    return auth;
  }

  save() {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = this.path.replace(/\.json$/u, '') + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.data, null, 1), 'utf8');
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.path);
    this._mtime = mtimeOf(this.path);
  }

  /** Read the file again if someone else wrote it (cli.js, while the server
   *  runs): a token added there works at once, a password set there counts. */
  refresh() {
    const m = mtimeOf(this.path);
    if (m === null || m === this._mtime) return;
    try {
      this.data = { password: null, secret: this.data.secret, tokens: {}, ...JSON.parse(readFileSync(this.path, 'utf8')) };
      this._mtime = m;
    } catch { /* half-written: the next request reads it */ }
  }

  /** Tokens as a list, without their hashes. */
  tokenList() {
    return Object.entries(this.data.tokens || {}).map(([name, rec]) => ({ name, created: (rec && rec.created) || null }))
      .sort((a, b) => (a.name < b.name ? -1 : 1));
  }

  /** No password set means no login. Fine on a tailnet, not on the internet. */
  get enabled() {
    return !!this.data.password;
  }

  setPassword(password) {
    if ([...password].length < 8) throw new Error('use at least 8 characters');
    this.data.password = hashPassword(password);
    this.save();
  }

  clearPassword() {
    this.data.password = null;
    this.save();
  }

  /** Invalidates every session cookie in existence. */
  rotateSecret() {
    this.data.secret = b64(randomBytes(32));
    this.save();
  }

  // ---- tokens, for devices

  /** A token for a device. Returned once; only its hash is kept. */
  addToken(name) {
    const token = 'msh_' + b64(randomBytes(32));
    const digest = createHash('sha256').update(token).digest('hex');
    this.data.tokens = this.data.tokens || {};
    this.data.tokens[name] = { hash: digest, created: Math.floor(now()) };
    this.save();
    return token;
  }

  removeToken(name) {
    const tokens = this.data.tokens || {};
    if (!(name in tokens)) return false;
    delete tokens[name];
    this.save();
    return true;
  }

  tokenNames() {
    return Object.keys(this.data.tokens || {}).sort();
  }

  /** The token's name, or null. */
  checkToken(token) {
    const digest = Buffer.from(createHash('sha256').update(token).digest('hex'));
    for (const [name, rec] of Object.entries(this.data.tokens || {})) {
      const want = Buffer.from(String((rec && rec.hash) || ''));
      if (want.length === digest.length && timingSafeEqual(digest, want)) return name;
    }
    return null;
  }

  // ---- sessions

  _secret() {
    return unb64(this.data.secret);
  }

  issueSession(days = SESSION_DAYS) {
    const iat = Math.floor(now());
    // json.dumps(payload, separators=(",", ":")): the Python's bytes, exactly
    const raw = Buffer.from(JSON.stringify({ iat, exp: iat + days * 86400 }));
    const sig = createHmac('sha256', this._secret()).update(raw).digest();
    return `${b64(raw)}.${b64(sig)}`;
  }

  checkSession(cookie) {
    if (!cookie || !cookie.includes('.')) return false;
    const i = cookie.indexOf('.');
    const body = cookie.slice(0, i), sig = cookie.slice(i + 1);
    try {
      const raw = unb64(body);
      const expected = createHmac('sha256', this._secret()).update(raw).digest();
      const given = unb64(sig);
      if (given.length !== expected.length || !timingSafeEqual(expected, given)) return false;
      const payload = JSON.parse(raw.toString('utf8'));
      return Number(payload.exp || 0) > now();
    } catch {
      return false;
    }
  }

  verify(password) {
    return verifyPassword(password, this.data.password || {});
  }
}

/** Per-client backoff on failed logins. In memory: a restart forgives, which
 *  is right for a single-user app that must not lock its owner out. */
export class Throttle {
  constructor() {
    this.state = new Map();
  }

  retryAfter(key) {
    const [, until] = this.state.get(key) || [0, 0];
    return Math.max(0, until - now());
  }

  recordFailure(key) {
    let [fails] = this.state.get(key) || [0, 0];
    fails += 1;
    const over = fails - LOCKOUT_FREE_ATTEMPTS;
    const delay = over <= 0 ? 0 : Math.min(LOCKOUT_MAX_SECONDS, LOCKOUT_BASE_SECONDS * 2 ** (over - 1));
    this.state.set(key, [fails, now() + delay]);
    return delay;
  }

  clear(key) {
    this.state.delete(key);
  }
}
