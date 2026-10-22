// A sample library to try Moshe on (never your own): the Getting Started
// sheets, plus a few notes and a translation project. Writes into the folder
// given, which must not exist yet or be empty.
//   docker run --rm -u "$(id -u):$(id -g)" -v "$PWD":/repo -v /tmp:/tmp -w /repo node:22-alpine node tools/sample-library.mjs /tmp/moshe-sample
import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { NodeStorage } from '../engine/src/storage-node.js';
import { Store } from '../engine/src/store.js';
import { addGettingStarted } from '../engine/src/welcome.js';

const root = process.argv[2];
if (!root) { console.error('usage: sample-library.mjs FOLDER'); process.exit(1); }
if (existsSync(root) && readdirSync(root).length) { console.error(`${root} is not empty`); process.exit(1); }
for (let d = resolve(root); ; d = dirname(d)) {   // never inside a real Obsidian vault
  if (existsSync(join(d, '.obsidian'))) { console.error(`refusing: ${root} is inside an Obsidian vault`); process.exit(1); }
  if (d === dirname(d)) break;
}
mkdirSync(root, { recursive: true });
const store = await Store.open(new NodeStorage(root));

addGettingStarted(store);
store.createSheet('Notes', { text: 'Buy a new notebook\nAnd a pen that does not skip.\n' });
store.createSheet('Notes', { text: '# Idea for a story\nA translator who finds a letter inside the book she is translating.\n' });

const novel = store.createProject('Novel Without a Cause', { template: 'novel', color: 'orange', author: 'Jane Doe', goal: { type: 'about', count: 95000, metric: 'words' } });
store.createProject('The Daily Times', { template: 'blog', color: 'yellow', icon: 'newspaper' });
const tr = store.createProject('Kafka in Hebrew', { template: 'translation', color: 'teal', icon: 'languages' });
const orig = `${tr}/Original`, trans = `${tr}/Translation`;
store.createSheet(orig, { text: `# פרק ראשון

כשגרגור זמזא התעורר בוקר אחד מחלומות טרופים, מצא עצמו הופך במיטתו לשרץ ענקי.

הוא שכב על גבו הקשה כשריון, וכשהרים מעט את ראשו ראה את בטנו הקמורה, החומה.

„מה קרה לי?“ חשב. לא היה זה חלום.
` });
store.createSheet(trans, { text: `# Chapter One

When Gregor Samsa woke one morning from troubled dreams, he found himself transformed in his bed into a monstrous vermin.

He lay on his armour-hard back, and when he lifted his head a little he could see his domed brown belly.

“What has happened to me?” he thought. It was no dream.
` });
store.renameSheet(`${trans}/Chapter One.md`, 'פרק ראשון');
await store.flush();
console.log('sample library in', root);
