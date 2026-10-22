import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage } from '../src/storage.js';
import { Store, NOTES, TRASH } from '../src/store.js';
import { mergeText, mergeSidecar } from '../src/merge.js';
import { parseLines, parseInline } from '../src/markup.js';
import { stats, sheetPreview, splitSheet, setMeta, parseGoal, formatGoal, outline } from '../src/sheet.js';

let clock = Date.UTC(2026, 8, 26, 12);
const now = () => (clock += 1000);

async function lib(files = {}) {
  const storage = new MemoryStorage(files);
  const store = await Store.open(storage, { now });
  return { storage, store };
}

test('an empty folder becomes a library with Notes and Projects', async () => {
  const { storage, store } = await lib();
  await store.flush();
  const { dirs } = await storage.list();
  assert.ok(dirs.includes('Notes') && dirs.includes('Projects'));
  const l = store.library();
  assert.equal(l.inbox.name, 'Inbox');
  assert.deepEqual(l.groups, []);
  assert.deepEqual(l.projects, []);
});

test('sheets: created, named from their first line once it is finished, and listed with a preview', async () => {
  const { storage, store } = await lib();
  const blog = store.createGroup(NOTES, 'Blog');
  let p = store.createSheet(blog);
  assert.equal(p, 'Notes/Blog/Untitled.md');
  let r = store.saveSheet(p, '# Why hesed', '');
  assert.equal(r.path, p, 'not renamed while the first line is still being typed');
  r = store.saveSheet(p, '# Why *hesed* resists translation\nIt is **loving**-kindness, and more.', '# Why hesed');
  assert.equal(r.path, 'Notes/Blog/Why hesed resists translation.md');
  p = r.path;
  r = store.saveSheet(p, '# A new title\nIt is loving-kindness, and more.', null);
  assert.equal(r.path, p, 'a retitled sheet keeps its file name');
  await store.flush();
  assert.equal((await storage.read(p)).text, '# A new title\nIt is loving-kindness, and more.');
  const list = store.sheetList(blog);
  assert.equal(list.sections[0].sheets.length, 1);
  const s = list.sections[0].sheets[0];
  assert.equal(s.title, 'A new title');
  assert.deepEqual(s.preview.map((x) => x.heading), [true, false]);
  assert.equal(s.stats.words, 8);
});

test('groups show the sheets of the groups inside them; the Inbox only its own', async () => {
  const { store } = await lib({
    'Notes/Loose.md': 'Loose\n',
    'Notes/Novel/Opening.md': '# Opening\n',
    'Notes/Novel/Part 2/Middle.md': '# Middle\n',
    'Notes/Novel/Part 10/End.md': '# End\n',
  });
  const l = store.library();
  assert.equal(l.inbox.count, 1);
  assert.deepEqual(l.groups[0].groups.map((g) => g.name), ['Part 2', 'Part 10'], 'natural order for unlisted groups');
  const sections = store.sheetList('Notes/Novel').sections;
  assert.deepEqual(sections.map((s) => [s.name, s.sheets.map((x) => x.title)]),
    [['Novel', ['Opening']], ['Part 2', ['Middle']], ['Part 10', ['End']]]);
  assert.deepEqual(store.sheetList(NOTES).sections.map((s) => s.name), ['Inbox']);
});

test('moving, reordering, trashing and restoring keep the order and the sheet\'s settings', async () => {
  const { storage, store } = await lib({ 'Notes/A/one.md': '# One\n', 'Notes/A/two.md': '# Two\n', 'Notes/B/three.md': '# Three\n' });
  store.reorderSheets('Notes/A', ['two.md', 'one.md']);
  assert.deepEqual(store.sheetsIn('Notes/A'), ['Notes/A/two.md', 'Notes/A/one.md']);
  store.setFavorite('Notes/A/one.md', true);
  const [moved] = store.moveSheets(['Notes/A/one.md'], 'Notes/B', 0);
  assert.equal(moved, 'Notes/B/one.md');
  assert.deepEqual(store.sheetsIn('Notes/B'), ['Notes/B/one.md', 'Notes/B/three.md']);
  assert.equal(store.sheetInfo(moved).favorite, true, 'the favourite went with it');
  const t = store.trashSheet(moved);
  assert.equal(t, `${TRASH}/one.md`);
  assert.equal(store.trash()[0].origin, 'Notes/B/one.md');
  assert.equal(store.library().trashCount, 1);
  const back = store.restore(t);
  assert.equal(back, 'Notes/B/one.md');
  assert.equal(store.sheetInfo(back).favorite, true);
  await store.flush();
  const files = (await storage.list()).files;
  assert.ok(files.includes('Notes/B/one.md') && !files.includes(`${TRASH}/one.md`));
});

test('a project from a template has its groups, Extras and Templates', async () => {
  const { store } = await lib();
  const p = store.createProject('Novel Without a Cause', { template: 'novel', author: 'Jane Doe' });
  const node = store.projectNode(p);
  assert.deepEqual(node.groups.map((g) => g.name), ['Front Matter', 'Prologue', 'Chapters', 'Epilogue', 'Back Matter']);
  assert.deepEqual(node.groups[2].groups.map((g) => g.name), ['One', 'Two', 'Three', 'Four', 'Five']);
  assert.deepEqual(node.extras.map((g) => g.name), ['Notes', 'Characters', 'Locations', 'Plot', 'Research', 'Other', 'Templates']);
  const front = store.sheetList(`${p}/Front Matter`).sections[0].sheets;
  assert.equal(front[0].title, 'Novel Without a Cause');
  assert.equal(front[0].preview[1].text, 'by Jane Doe');
  // a sheet dragged into Templates is copied
  const [copy] = store.moveSheets([front[1].path], `${p}/Extras/Templates`);
  assert.ok(store.exists(front[1].path) && store.exists(copy));
});

test('someone else\'s edit is taken as it is; an open sheet\'s edit merges with it', async () => {
  const { storage, store } = await lib({ 'Notes/s.md': 'One.\nTwo.\nThree.\n' });
  await storage.write('Notes/s.md', 'One!\nTwo.\nThree.\n');
  assert.deepEqual(await store.scanChanges(), ['Notes/s.md']);
  assert.equal(store.text('Notes/s.md'), 'One!\nTwo.\nThree.\n');
  // the editor opened "One!…" and changed the last line; meanwhile Obsidian changed the second
  await storage.write('Notes/s.md', 'One!\nTwo, changed.\nThree.\n');
  await store.scanChanges();
  const r = store.saveSheet('Notes/s.md', 'One!\nTwo.\nThree, in the editor.\n', 'One!\nTwo.\nThree.\n');
  assert.equal(r.merged, true);
  assert.equal(r.body, 'One!\nTwo, changed.\nThree, in the editor.\n');
});

test('a conflict copy is merged in and put away', async () => {
  const { storage, store } = await lib({ 'Notes/s.md': 'Alpha.\nBeta.\n' });
  await storage.write('Notes/s.md', 'Alpha, here.\nBeta.\n');
  await store.scanChanges();
  await storage.write('Notes/s.sync-conflict-20260926-120000-ABCDEFG.md', 'Alpha.\nBeta, there.\n');
  clock = Date.UTC(2026, 8, 26, 12, 30);
  await store.scanChanges();
  await store.flush();
  assert.equal(store.text('Notes/s.md'), 'Alpha, here.\nBeta, there.\n');
  const files = (await storage.list()).files;
  assert.ok(files.some((f) => f.startsWith('.moshe/conflicts/')));
  assert.ok(!files.includes('Notes/s.sync-conflict-20260926-120000-ABCDEFG.md'));
});

test('merge: symmetric, word by word inside a paragraph, both kept when truly in conflict', () => {
  const base = 'The quick brown fox jumps.\nSecond line.\n';
  const a = 'The quick red fox jumps.\nSecond line.\n';
  const b = 'The quick brown fox leaps.\nSecond line.\n';
  assert.equal(mergeText(base, a, b).text, 'The quick red fox leaps.\nSecond line.\n');
  assert.equal(mergeText(base, a, b).text, mergeText(base, b, a).text);
  const c = mergeText('x\n', 'one\n', 'two\n');
  assert.equal(c.conflicts, 1);
  assert.equal(c.text, mergeText('x\n', 'two\n', 'one\n').text);
  assert.ok(c.text.includes('one') && c.text.includes('two'));
  const s = mergeSidecar({ icon: { v: 'a', t: 1 }, color: { v: 'red', t: 5 } }, { icon: { v: 'b', t: 2 }, color: { v: 'blue', t: 3 } });
  assert.deepEqual(s, { icon: { v: 'b', t: 2 }, color: { v: 'red', t: 5 } });
});

test('markup: tags found where they are', () => {
  const t = '## A **bold** _claim_ with ==light== and %%a note%% and {==this==}{>>why?<<} and ^[a footnote] and [a link](https://x.org).';
  const [L] = parseLines(t);
  assert.equal(L.type, 'heading');
  assert.equal(L.level, 2);
  const types = L.inline.map((n) => n.type);
  assert.deepEqual(types, ['strong', 'em', 'mark', 'comment', 'annotation', 'footnote', 'link']);
  const link = L.inline[6];
  assert.equal(link.data.url, 'https://x.org');
  assert.equal(t.slice(link.inner[0], link.inner[1]), 'a link');
  assert.deepEqual(parseInline('snake_case_name and file_name', 0, 29), [], 'underscores inside words are not emphasis');
  const lines = parseLines('- one\n\t- two\n1. three\n> quote\n```js\ncode *no*\n```\n%%\nhidden\n%%\n----');
  assert.deepEqual(lines.map((l) => l.type), ['list', 'list', 'list', 'quote', 'fence', 'code', 'fence', 'comment', 'comment', 'comment', 'divider']);
  assert.deepEqual(lines.slice(0, 3).map((l) => [l.depth, l.ordered]), [[0, false], [1, false], [0, true]]);
});

test('statistics leave out what only the writer sees', () => {
  const st = stats('# Title here\nOne two three. Four five?\n%%not counted at all%%\nSix {--gone--} seven {==eight==}{>>no<<}.');
  assert.equal(st.words, 10);
  assert.equal(st.paragraphs, 3);
  assert.equal(st.sentences, 4);
  assert.equal(sheetPreview('\n\n# Hello, stranger!\nNice to have you here.').title, 'Hello, stranger!');
});

test('front matter: kept exactly, changed key by key, hidden from the body', () => {
  const text = '---\naliases: [x]\nkeywords: [Draft]\n---\n# Body\n';
  assert.equal(splitSheet(text).body, '# Body\n');
  const next = setMeta(text, { keywords: ['Draft', 'Pencroft'], goal: formatGoal({ type: 'at-least', count: 800, metric: 'words' }) });
  assert.equal(next, '---\naliases: [x]\nkeywords: [Draft, Pencroft]\ngoal: at least 800 words\n---\n# Body\n');
  assert.deepEqual(parseGoal('about 5,000 words by 2026-10-31'), { type: 'about', count: 5000, metric: 'words', deadline: '2026-10-31' });
  assert.equal(setMeta('---\nkeywords: [a]\n---\nx', { keywords: [] }), 'x');
  const o = outline('# One\ntext ^[fn] [l](u)\n## Two');
  assert.deepEqual(o.map((x) => x.kind), ['heading', 'footnote', 'link', 'heading']);
  assert.deepEqual(outline('a {--cut--} and {++added++}').map((x) => [x.kind, x.text]), [['delete', 'cut'], ['insert', 'added']]);
});

test('goals: a day\'s writing is where the count stands against where the day began', async () => {
  const { store } = await lib({ 'Notes/Book/One.md': 'one two three\n' });
  store.editGroup('Notes/Book', { goal: { type: 'daily', count: 5, metric: 'words' } });
  store.recordProgress();
  assert.equal(store.writtenToday('Notes/Book'), 0);
  store.saveSheet('Notes/Book/One.md', 'one two three four five six\n', null);
  store.recordProgress();
  assert.equal(store.writtenToday('Notes/Book'), 3);
  const g = store.goalProgress(store.sget('Notes/Book', 'goal'), store.groupStats('Notes/Book'), 'Notes/Book');
  assert.equal(g.value, 3);
  assert.equal(g.reached, false);
  const h = store.history('Notes/Book');
  assert.equal(h.length, 1);
  assert.deepEqual([h[0].start, h[0].end, h[0].written], [3, 6, 3]);
});

test('a save that comes after its sheet was moved or trashed follows it there', async () => {
  const { storage, store } = await lib({ 'Notes/A/s.md': 'first\n', 'Notes/Untitled.md': '' });
  store.createGroup('Notes', 'B');
  store.moveSheets(['Notes/A/s.md'], 'Notes/B');
  let r = store.saveSheet('Notes/A/s.md', 'typed just before the move\n', 'first\n');
  assert.equal(r.path, 'Notes/B/s.md');
  assert.equal(store.exists('Notes/A/s.md'), false, 'nothing written back where it was');
  const t = store.trashSheet('Notes/B/s.md');
  r = store.saveSheet('Notes/A/s.md', 'typed just before the trash\n', null);
  assert.equal(r.path, t, 'into the trash, the latest text with it');
  assert.equal(store.text(t), 'typed just before the trash\n');
  const u = store.trashSheet('Notes/Untitled.md');
  store.erase(u);
  r = store.saveSheet('Notes/Untitled.md', '', '', { closing: true });
  assert.equal(r.gone, true);
  await store.flush();
  const files = (await storage.list()).files;
  assert.ok(!files.includes('Notes/Untitled.md') && !files.includes('Notes/A/s.md'), 'nothing resurrected');
});

test('a write the storage refuses is kept and tried again until it lands', async () => {
  const storage = new MemoryStorage({ 'Notes/s.md': 'one\n' });
  const store = await Store.open(storage, { now, onWriteError: () => {} });
  const real = storage.write.bind(storage);
  let down = true;
  storage.write = async (p, t) => { if (down) { const e = new Error('offline'); e.code = 'EIO'; throw e; } return real(p, t); };
  store.saveSheet('Notes/s.md', 'one, then two\n', 'one\n');
  await store.flush();
  assert.deepEqual(store.unsaved(), { 'Notes/s.md': 'one, then two\n' });
  store.saveSheet('Notes/s.md', 'one, then two, then three\n', 'one, then two\n');
  await store.flush();
  down = false;
  let saved = false;
  store.on((ev) => { if (ev.saved) saved = true; });
  store.retryFailed();
  await store.flush();
  assert.equal((await storage.read('Notes/s.md')).text, 'one, then two, then three\n');
  assert.deepEqual(store.unsaved(), {});
  assert.equal(saved, true);
});

test("the global filters' All takes in projects when the library says so; the Notes section's All never does", async () => {
  const { store } = await lib({ 'Notes/A note.md': '# A note\n', 'Projects/Book/Chapter.md': '# Chapter\n' });
  const paths = (sel) => store.sheetList(sel).sections.flatMap((s) => s.sheets.map((x) => x.path)).sort();
  assert.deepEqual(paths('all'), ['Notes/A note.md']);
  assert.deepEqual(paths('notes-all'), ['Notes/A note.md']);
  store.setSetting('globalFiltersIncludeProjects', true);
  assert.deepEqual(paths('all'), ['Notes/A note.md', 'Projects/Book/Chapter.md']);
  assert.deepEqual(paths('notes-all'), ['Notes/A note.md']);
});

test('a tab indents a list item one level, as two spaces do', () => {
  const depths = (t) => parseLines(t).filter((L) => L.type === 'list').map((L) => L.depth);
  assert.deepEqual(depths('- a\n\t- b\n\t- c\n\t\t- d\n- e'), [0, 1, 1, 2, 0]);
  assert.deepEqual(depths('- a\n  - b\n    - c'), [0, 1, 2]);
});

test('prose for the grammar check: markup off, places kept, code masked, Hebrew and code blocks left out', async () => {
  const { proseOf, placeFinding } = await import('../src/proof.js');
  const body = '# A titel\nSome **bold** and {--gone--} and `cod` and [a lnk](https://x.org) and {~~old~>new~~}.^[A noet.]\n\n```\nnot prose\n```\nשורה בעברית\n- itme';
  const ps = proseOf(body, null, { english: true });
  assert.deepEqual(ps.map((p) => [p.kind, p.text]), [
    ['heading', 'A titel'], ['paragraph', 'Some bold and and cod and a lnk and new.'], ['footnote', 'A noet.'], ['list', 'itme'],
  ]);
  const at = (p, word) => { const i = p.text.indexOf(word); const r = placeFinding(p, i, i + word.length); return r && body.slice(r.from, r.to); };
  assert.equal(at(ps[0], 'titel'), 'titel');
  assert.equal(at(ps[1], 'lnk'), 'lnk');
  assert.equal(at(ps[1], 'new'), 'new');
  assert.equal(at(ps[1], 'cod'), null, 'inline code is masked');
  assert.equal(at(ps[2], 'noet'), 'noet');
  assert.equal(at(ps[3], 'itme'), 'itme');
  // a deletion before a comma leaves no space before it
  const struck = 'Strike it out with {--this--}, then go on.';
  const cut = proseOf(struck, null, { english: true })[0];
  assert.equal(cut.text, 'Strike it out with, then go on.');
  const go = placeFinding(cut, cut.text.indexOf('go'), cut.text.indexOf('go') + 2);
  assert.equal(struck.slice(go.from, go.to), 'go');
});
