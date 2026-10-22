#!/usr/bin/env node
// Setting the password and making tokens for syncing devices; and sheets from
// outside the app (a bot, a cron job, Apple's Shortcuts):
//
//   echo "# Idea\nsome text" | node server/src/cli.js new [GROUP]
//   echo "more text" | node server/src/cli.js append SHEET [--group G] [--start] [--create]
//   node server/src/cli.js sheets [GROUP]
//
//   node server/src/cli.js set-password
//   node server/src/cli.js add-token Phone
//   node server/src/cli.js list-tokens
//   node server/src/cli.js remove-token Phone
//   node server/src/cli.js clear-password
//   node server/src/cli.js logout-everywhere
//
// In the container: docker exec -it moshe node server/src/cli.js set-password
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { Auth } from './auth.js';
import { Files } from './files.js';
import { Sheets } from './sheets.js';

const here = dirname(fileURLToPath(import.meta.url));

/** A line from the terminal, not echoed. */
function secret(prompt) {
  return new Promise((ok) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(prompt)) process.stdout.write(prompt); };
    rl.question(prompt, (answer) => { rl.close(); process.stdout.write('\n'); ok(answer); });
  });
}

/** Everything piped in. */
async function stdinText(input = process.stdin) {
  if (input.isTTY) return '';
  let text = '';
  for await (const chunk of input) text += chunk;
  return text;
}

export async function main(argv = process.argv.slice(2), env = process.env, input = process.stdin, write = (s) => process.stdout.write(s)) {
  let root = env.MOSHE_ROOT || resolve(here, '..', '..', 'data');
  const args = [...argv];
  const at = args.indexOf('--root');
  if (at >= 0) { root = args[at + 1]; args.splice(at, 2); }
  const [cmd, name] = args;
  const auth = Auth.load(root, env.MOSHE_AUTH_FILE || undefined);
  const out = (s) => write(s + '\n');

  switch (cmd) {
    case 'set-password': {
      const pw = await secret('New password: ');
      if (pw !== await secret('Again: ')) { console.error('they do not match'); return 1; }
      try { auth.setPassword(pw); } catch (e) { console.error(e.message); return 1; }
      out(`password set in ${auth.path}`);
      out('everyone is logged out; sign in again in the browser');
      auth.rotateSecret();
      return 0;
    }
    case 'clear-password':
      auth.clearPassword();
      out('password removed — the app is now open to anyone who can reach it');
      return 0;
    case 'add-token': {
      if (!name) { console.error('add-token NAME'); return 1; }
      const token = auth.addToken(name);
      out(`token for ${name}:\n\n  ${token}\n`);
      out('This is the only time it is shown. Use it as:');
      out('  Authorization: Bearer <token>');
      return 0;
    }
    case 'remove-token':
      out(auth.removeToken(name) ? 'removed' : 'no such token');
      return 0;
    case 'list-tokens': {
      const names = auth.tokenNames();
      out(names.length ? names.join('\n') : '(none)');
      return 0;
    }
    case 'new':
    case 'append':
    case 'sheets': {
      const flag = (f) => { const i = args.indexOf(f); if (i < 0) return false; args.splice(i, 1); return true; };
      const option = (f) => { const i = args.indexOf(f); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
      const group = option('--group'), atStart = flag('--start'), create = flag('--create');
      const sheets = new Sheets(new Files(root));
      try {
        if (cmd === 'sheets') { for (const s of await sheets.list(args[1] || group || 'Notes')) out(`${s.path}\t${s.title}`); return 0; }
        const text = await stdinText(input);
        if (cmd === 'new') { out((await sheets.create(args[1] || group || 'Notes', text)).path); return 0; }
        if (!args[1]) { console.error('append SHEET: a path or a title'); return 1; }
        out((await sheets.append(args[1], text, { group, atStart, create })).path);
        return 0;
      } catch (e) { console.error(e.message); return 1; }
    }
    case 'logout-everywhere':
      auth.rotateSecret();
      out('every session cookie is now invalid');
      return 0;
    default:
      console.error('usage: cli.js [--root DIR] set-password | clear-password | add-token NAME | remove-token NAME | list-tokens | logout-everywhere | new [GROUP] | append SHEET [--group G] [--start] [--create] | sheets [GROUP]');
      return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().then((code) => process.exit(code));
