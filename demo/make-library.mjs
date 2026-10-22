// The sample library (demo/library.mjs), made with the engine itself:
//
//   node demo/make-library.mjs --json OUT.json    {files: {path: text}, dirs: [...], open: path}
//   node demo/make-library.mjs --folder DIR       the files themselves, in DIR (new or empty)
//
// The JSON is what the taste on stuffs puts into the browser's own storage;
// the folder is for running a server on it (the docs' screenshots).
import { mkdirSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { MemoryStorage } from '../engine/src/storage.js';
import { NodeStorage } from '../engine/src/storage-node.js';
import { Store } from '../engine/src/store.js';
import { fillLibrary } from './library.mjs';

const [how, out] = process.argv.slice(2);
if (!['--json', '--folder'].includes(how) || !out) { console.error('usage: make-library.mjs --json OUT.json | --folder DIR'); process.exit(1); }

let storage;
if (how === '--folder') {
  if (existsSync(out) && readdirSync(out).length) { console.error(`${out} is not empty`); process.exit(1); }
  mkdirSync(out, { recursive: true });
  storage = new NodeStorage(out);
} else storage = new MemoryStorage();

const store = await Store.open(storage);
const open = fillLibrary(store);
await store.flush();

if (how === '--json') {
  const files = {};
  for (const [p, f] of [...storage.files].sort(([a], [b]) => (a < b ? -1 : 1))) files[p] = f.text;
  writeFileSync(out, JSON.stringify({ files, dirs: [...storage.dirs].sort(), open }));
}
console.log(`sample library (${how.slice(2)}) in ${out}; open ${open}`);
