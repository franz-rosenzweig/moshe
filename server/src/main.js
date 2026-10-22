#!/usr/bin/env node
// The Moshe server: `node server/src/main.js`.
//
//   MOSHE_ROOT        the library folder                  (default ./data)
//   MOSHE_STATIC      the built app                       (default ./frontend/dist)
//   MOSHE_AUTH_FILE   password and session secret         (default <root>/.moshe/auth.json — set it outside the library in production)
//   MOSHE_BACKUPS     where backups go                    (default: none kept)
//   MOSHE_WATCH       0 to not watch the folder           (default on)
//   MOSHE_LANGUAGETOOL  a LanguageTool server for Check Text, e.g. http://languagetool:8010 (default: none)
//   PORT, HOST        where to listen                     (default 8430, 0.0.0.0)
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');

export async function start(env = process.env) {
  const root = resolve(env.MOSHE_ROOT || resolve(repo, 'data'));
  const app = await createApp({
    root,
    staticDir: resolve(env.MOSHE_STATIC || resolve(repo, 'frontend', 'dist')),
    authFile: env.MOSHE_AUTH_FILE || undefined,
    backupDir: env.MOSHE_BACKUPS || null,
    watch: (env.MOSHE_WATCH ?? '1') !== '0',
    languageTool: env.MOSHE_LANGUAGETOOL || null,
  });
  const port = Number(env.PORT || 8430), host = env.HOST || '0.0.0.0';
  const where = await app.listen(port, host);
  console.error(`moshe: serving ${root} on http://${where.address}:${where.port}${app.auth.enabled ? '' : ' — NO PASSWORD SET'}${app.backups ? `, backups in ${env.MOSHE_BACKUPS}` : ''}`);
  const stop = async () => { await app.close(); process.exit(0); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch((e) => { console.error('moshe: could not start:', e); process.exit(1); });
}
