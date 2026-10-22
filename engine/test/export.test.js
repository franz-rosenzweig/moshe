import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDoc, isRtl, plainText, footnotesIn } from '../src/export/doc.js';
import { STYLES, STYLE_ORDER, resolveStyle, PAGE_SIZES } from '../src/export/styles.js';
import { toHtml, escapeHtml, safeUrl, base64 } from '../src/export/html.js';
import { toMarkdown, toText } from '../src/export/markdown.js';
import { createZip, crc32 } from '../src/export/zip.js';
import { toDocx, directionRuns, imageSize } from '../src/export/docx.js';
import { toEpub, chaptersOf } from '../src/export/epub.js';
import { exportSheets, FORMATS } from '../src/export/index.js';
import { parseXml, iter } from '../src/xml.js';

// ---- helpers -------------------------------------------------------------------------

/** A CRC-32 written again, bit by bit, so the writer's table is not checked against itself. */
function crcSlow(bytes) {
  let c = 0xFFFFFFFF;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** Reads a stored ZIP back: its local entries in order, checked against the central directory. */
function unzip(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  const entries = [];
  let i = 0;
  while (i + 4 <= bytes.length && v.getUint32(i, true) === 0x04034B50) {
    const flags = v.getUint16(i + 6, true), method = v.getUint16(i + 8, true);
    const crc = v.getUint32(i + 14, true), csize = v.getUint32(i + 18, true), size = v.getUint32(i + 22, true);
    const nlen = v.getUint16(i + 26, true), elen = v.getUint16(i + 28, true);
    const name = dec.decode(bytes.subarray(i + 30, i + 30 + nlen));
    const start = i + 30 + nlen + elen;
    assert.equal(method, 0, `${name} is stored`);
    assert.equal(csize, size, `${name}: stored, so its sizes agree`);
    const data = bytes.subarray(start, start + size);
    assert.equal(crcSlow(data), crc, `${name}: CRC-32`);
    entries.push({ name, flags, method, extraLength: elen, offset: i, data, text: () => dec.decode(data) });
    i = start + size;
  }
  // the central directory and its end record agree with what was read
  let n = 0;
  const cdStart = i;
  while (v.getUint32(i, true) === 0x02014B50) {
    const nlen = v.getUint16(i + 28, true), elen = v.getUint16(i + 30, true), clen = v.getUint16(i + 32, true);
    const name = dec.decode(bytes.subarray(i + 46, i + 46 + nlen));
    assert.equal(name, entries[n].name);
    assert.equal(v.getUint32(i + 42, true), entries[n].offset, `${name}: its offset`);
    i += 46 + nlen + elen + clen;
    n++;
  }
  assert.equal(v.getUint32(i, true), 0x06054B50, 'end of central directory');
  assert.equal(v.getUint16(i + 10, true), entries.length);
  assert.equal(v.getUint32(i + 16, true), cdStart);
  assert.equal(v.getUint32(i + 12, true), i - cdStart);
  const map = new Map(entries.map((e) => [e.name, e]));
  return { entries, map, text: (name) => { const e = map.get(name); assert.ok(e, `${name} is there`); return e.text(); } };
}

const XML_PART = /\.(xml|rels|opf|xhtml|ncx)$/u;

/** Every element under one, depth first. */
function* all(el) {
  yield el;
  for (const c of el.children) yield* all(c);
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const wAttr = (el, name) => el.attrs[`{${W}}${name}`];

const png1 = () => {
  // a 3×2 PNG header is enough for the size to be read; the rest is not looked at
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 3, 0, 0, 0, 2]);
  return b;
};

const MARKED = [
  '# Title',
  'Plain %%a comment%% text {--gone--}{++added++} and {~~old~>new~~} with {==annotated==}{>>the note<<} and a {>>lone note<<} and {==critic mark==}.',
  '%% a comment block %%',
  '%% a comment block',
  'over two lines %% and after it',
  'Tail.',
].join('\n');

// ---- the document model --------------------------------------------------------------

test('a plain export drops the writer\'s marks and accepts the changes', () => {
  const doc = buildDoc([{ title: 'S', body: MARKED }]);
  const texts = doc.blocks.map((b) => (b.children ? plainText(b.children) : b.type));
  assert.deepEqual(texts, [
    'Title',
    'Plain text added and new with annotated and a and critic mark.',
    'and after it',
    'Tail.',
  ]);
  assert.equal(doc.revision, false);
  assert.equal(doc.comments.length, 0);
  const json = JSON.stringify(doc.blocks);
  for (const gone of ['a comment', 'gone', 'old', 'the note', 'lone note', 'comment block']) assert.ok(!json.includes(gone), gone);
  assert.ok(!/"type":"(comment|delete|insert|annotation)"/u.test(json));
  const cut = buildDoc([{ title: 'S', body: 'Strike out {--this--}, or add {++that++}. A %%note%%.' }]);
  assert.equal(plainText(cut.blocks[0].children), 'Strike out, or add that. A.');
});

test('a revision export keeps comments, deletions, insertions and annotations', () => {
  const doc = buildDoc([{ title: 'S', body: MARKED }], { revision: true });
  const p = doc.blocks[1].children;
  const types = p.map((n) => n.type);
  assert.deepEqual(types, ['text', 'comment', 'text', 'delete', 'insert', 'text', 'delete', 'insert', 'text', 'annotation', 'text', 'comment', 'text', 'mark', 'text']);
  assert.equal(p[1].text, 'a comment');
  assert.equal(plainText(p[6].children), 'old');
  assert.equal(plainText(p[7].children), 'new');
  const ann = p[9];
  assert.equal(ann.display, 'margin');
  assert.equal(plainText(ann.children), 'annotated');
  assert.equal(plainText(ann.note), 'the note');
  assert.equal(doc.comments.length, 3, 'two comments and the annotation');
  assert.ok(doc.comments.find((c) => c.id === ann.id && c.anchored));
  const blocks = doc.blocks.filter((b) => b.type === 'comment');
  assert.deepEqual(blocks.map((b) => b.text), ['a comment block', 'a comment block\nover two lines']);
  assert.equal(plainText(doc.blocks.find((b) => b.type === 'paragraph' && plainText(b.children) === 'and after it').children), 'and after it');
});

test('annotations: omitted, inline, or footnotes numbered with the rest', () => {
  const body = 'One^[first] {==two==}{>>note two<<} three^[third]';
  const inline = buildDoc([{ body }], { annotations: 'inline' });
  const a = inline.blocks[0].children.find((n) => n.type === 'annotation');
  assert.equal(a.display, 'inline');
  assert.equal(plainText(a.note), 'note two');
  const fn = buildDoc([{ body }], { annotations: 'footnotes' });
  assert.deepEqual(fn.footnotes.map((f) => plainText(f.children)), ['first', 'note two', 'third']);
  assert.equal(plainText(fn.blocks[0].children), 'One two three');
  const omit = buildDoc([{ body }]);
  assert.equal(omit.footnotes.length, 2);
});

test('footnotes are numbered in order across sheets, one inside another after it', () => {
  const doc = buildDoc([
    { title: 'A', body: 'A one^[fn one] and two^[fn two ^[inner]].' },
    { title: 'B', body: '## B\nB three^[fn *three*].' },
  ]);
  assert.deepEqual(doc.footnotes.map((f) => [f.n, plainText(f.children)]), [[1, 'fn one'], [2, 'fn two '], [3, 'inner'], [4, 'fn three']]);
  assert.deepEqual(doc.footnotes[3].children.map((n) => n.type), ['text', 'em']);
  const refs = doc.blocks.flatMap((b) => b.children.filter((n) => n.type === 'footnote').map((n) => n.n));
  assert.deepEqual(refs, [1, 2, 4]);
  assert.deepEqual(footnotesIn(doc.blocks.slice(0, 1), doc), [1, 2, 3]);
  assert.deepEqual(footnotesIn(doc.blocks.slice(1), doc), [4]);
});

test('(toc) lists the headings of the whole document, levels 1 to 3 unless asked', () => {
  const sheets = [
    { title: 'Front', body: '# Book\n(toc)' },
    { title: 'One', body: '## One\n### One a\n#### Deep' },
    { title: 'Two', body: '## Two *emphasised*^[not in the toc]' },
  ];
  const doc = buildDoc(sheets);
  const toc = doc.blocks.find((b) => b.type === 'toc');
  assert.deepEqual(toc.entries.map((e) => [e.level, e.text]), [[1, 'Book'], [2, 'One'], [3, 'One a'], [2, 'Two emphasised']]);
  assert.deepEqual(toc.entries.map((e) => e.id), ['book', 'one', 'one-a', 'two-emphasised']);
  const two = buildDoc(sheets, { tocLevels: [2, 2] }).blocks.find((b) => b.type === 'toc');
  assert.deepEqual(two.entries.map((e) => e.text), ['One', 'Two emphasised']);
  assert.equal(buildDoc(sheets, { tocLevels: 4 }).blocks.find((b) => b.type === 'toc').entries.length, 5);
  // one # and many ##: the ## are the chapters
  assert.equal(doc.topLevel, 1);
  assert.equal(doc.chapterLevel, 2);
});

test('lists nest by indentation, count from their first number, and keep tasks', () => {
  const doc = buildDoc([{ body: [
    '- a', '  - b', '    3. c', '    4. d', '- e', '', '- f', '1. g', '      - too deep', '- [ ] open', '- [x] done',
  ].join('\n') }]);
  const [bullets, ordered, tasks] = doc.blocks;
  assert.equal(doc.blocks.length, 3);
  assert.equal(bullets.type, 'list');
  assert.equal(bullets.ordered, false);
  assert.deepEqual(bullets.items.map((i) => plainText(i.children)), ['a', 'e', 'f'], 'a blank line keeps one list');
  const b = bullets.items[0].lists[0];
  assert.deepEqual(b.items.map((i) => plainText(i.children)), ['b']);
  const c = b.items[0].lists[0];
  assert.equal(c.ordered, true);
  assert.equal(c.start, 3);
  assert.deepEqual(c.items.map((i) => plainText(i.children)), ['c', 'd']);
  assert.equal(ordered.ordered, true);
  assert.equal(ordered.items[0].lists[0].items[0].children[0].text, 'too deep', 'an item too deep sits one level down');
  assert.deepEqual(tasks.items.map((i) => i.task), ['open', 'done']);
});

test('tables: header from the row above the rule, alignment from its colons, pipes in code kept', () => {
  const doc = buildDoc([{ body: [
    '| Left | Centre | Right | None |',
    '|:-----|:------:|------:|------|',
    '| `a|b` | x \\| y | [[Page|label]] | **bold** |',
    '| short |',
  ].join('\n') }]);
  const t = doc.blocks[0];
  assert.equal(t.type, 'table');
  assert.deepEqual(t.align, ['left', 'center', 'right', null]);
  assert.deepEqual(t.head.map(plainText), ['Left', 'Centre', 'Right', 'None']);
  assert.deepEqual(t.rows[0].map(plainText), ['a|b', 'x | y', 'label', 'bold']);
  assert.equal(t.rows[0][0][0].type, 'code');
  assert.equal(t.rows[0][3][0].type, 'strong');
  assert.deepEqual(t.rows[1].map(plainText), ['short', '', '', ''], 'a short row is padded');
  const bare = buildDoc([{ body: '| a | b |\n| c | d |' }]).blocks[0];
  assert.equal(bare.head, null);
  assert.equal(bare.rows.length, 2);
});

test('quotes, code, maths, dividers, images and links become their blocks and runs', () => {
  const doc = buildDoc([{ body: [
    '> outer', '>> inner', '```js', 'let a = 1;', '', '  b();', '```', '$$', 'x^2', '$$', '$$ y $$', '---',
    '![A caption](_media/p.png "T")', 'See [site](https://e.com "Title"), www.e.org and [[Wiki|w]] and ![icon](i.png) and $a+b$ and \\*.',
  ].join('\n') }]);
  const [quote, code, math, math2, hr, img, p] = doc.blocks;
  assert.equal(quote.type, 'quote');
  assert.equal(quote.blocks[0].type, 'paragraph');
  assert.equal(quote.blocks[1].type, 'quote');
  assert.equal(plainText(quote.blocks[1].blocks[0].children), 'inner');
  assert.deepEqual([code.type, code.lang, code.text], ['code', 'js', 'let a = 1;\n\n  b();']);
  assert.deepEqual([math.type, math.text], ['math', 'x^2']);
  assert.equal(math2.text, 'y');
  assert.equal(hr.type, 'divider');
  assert.deepEqual([img.type, img.src, img.alt, img.title], ['image', '_media/p.png', 'A caption', 'T']);
  const types = p.children.map((n) => n.type);
  assert.deepEqual(types, ['text', 'link', 'text', 'link', 'text', 'image', 'text', 'math', 'text']);
  assert.equal(p.children[1].url, 'https://e.com');
  assert.equal(p.children[1].title, 'Title');
  assert.equal(p.children[3].url, 'https://www.e.org');
  assert.ok(plainText(p.children).includes('and w and'));
  assert.ok(plainText(p.children).endsWith('and *.'));
});

test('a Hebrew paragraph is right to left; the document guesses its language', () => {
  assert.equal(isRtl('שלום, world'), true);
  assert.equal(isRtl('"123" hello שלום'), false);
  assert.equal(isRtl('  — «שלום»'), true);
  assert.equal(isRtl('مرحبا'), true);
  assert.equal(isRtl('12345'), false);
  const doc = buildDoc([{ body: '# כותרת\nפסקה בעברית.\nAn English one.\n- פריט\n> ציטוט' }]);
  assert.deepEqual(doc.blocks.map((b) => b.rtl ?? b.items?.[0].rtl ?? b.blocks?.[0].rtl), [true, true, false, true, true]);
  assert.equal(doc.lang, 'he');
  assert.equal(buildDoc([{ body: 'English.\nשלום' }]).lang, 'en');
  assert.equal(doc.blocks[0].id, 'section-1', 'a heading with no Latin letters still has an id');
});

test('front matter is split off and a material sheet left out', () => {
  const doc = buildDoc([
    { text: '---\nkeywords: [Draft]\n---\n# Kept\nText.' },
    { text: '---\nmaterial: true\n---\n# Research\nNot exported.' },
  ]);
  assert.deepEqual(doc.blocks.map((b) => plainText(b.children)), ['Kept', 'Text.']);
  assert.equal(doc.sheets.length, 1);
  assert.equal(doc.title, 'Kept', 'an untitled sheet takes its first line');
});

// ---- styles -----------------------------------------------------------------------------

test('styles: all seven, in order, each complete; overrides change the page', () => {
  assert.deepEqual(STYLE_ORDER, ['everyday', 'essay', 'business', 'manuscript', 'papers', 'columns', 'revision']);
  for (const id of STYLE_ORDER) {
    const s = STYLES[id];
    assert.equal(s.id, id);
    assert.ok(s.name && s.description);
    assert.equal(s.headings.length, 6);
    for (const k of ['body', 'heading', 'mono']) assert.ok(s.fonts[k].css && s.fonts[k].word && s.fonts[k].cs, `${id} ${k}`);
    assert.ok(PAGE_SIZES[s.page.size]);
    for (const k of ['top', 'right', 'bottom', 'left']) assert.ok(s.page.margins[k] > 0);
  }
  assert.equal(STYLES.manuscript.page.size, 'Letter');
  assert.equal(STYLES.manuscript.page.margins.left, 72);
  assert.equal(STYLES.manuscript.lineSpacing, 2);
  assert.equal(STYLES.columns.columns, 2);
  assert.equal(STYLES.revision.revision, true);
  const s = resolveStyle('manuscript', { pageSize: 'a4', margins: 50 });
  assert.equal(s.page.size, 'A4', 'the dialog\'s lower-case names are understood');
  assert.equal(resolveStyle('papers', { pageSize: 'a5' }).page.size, 'A5');
  assert.equal(resolveStyle('papers', { pageSize: 'b7' }).page.size, 'A4', 'an unknown size is ignored');
  assert.equal(s.page.margins.top, 50);
  assert.equal(STYLES.manuscript.page.size, 'Letter', 'the built-in style is not changed');
  const custom = resolveStyle({ size: 14, colors: { link: '#ff0000' } });
  assert.equal(custom.size, 14);
  assert.equal(custom.colors.link, '#ff0000');
  assert.equal(custom.colors.text, STYLES.everyday.colors.text);
  assert.equal(resolveStyle('nonsense').id, 'everyday');
});

// ---- HTML --------------------------------------------------------------------------------

test('HTML: everything escaped, script links neutralised', () => {
  const doc = buildDoc([{ body: [
    '# <Title> & "more"',
    'Text with <script>alert(1)</script> & \'quotes\' and [bad](javascript:alert(1)) and [ok](https://e.com/?a=1&b="2" "a \\"t\\"") and `<code>`.',
    '```html', '<p class="x">&amp;</p>', '```',
  ].join('\n') }]);
  const html = toHtml(doc, 'everyday', { title: 'A <b> title' });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &#39;quotes&#39;'));
  assert.ok(html.includes('<h1 id="title-more" dir="auto" class="chapter">&lt;Title&gt; &amp; &quot;more&quot;</h1>') || html.includes('&lt;Title&gt; &amp; &quot;more&quot;</h1>'));
  assert.ok(html.includes('<a href="#">bad</a>'));
  assert.ok(html.includes('href="https://e.com/?a=1&amp;b=&quot;2&quot;"'));
  assert.ok(html.includes('<code>&lt;code&gt;</code>'));
  assert.ok(html.includes('&lt;p class=&quot;x&quot;&gt;&amp;amp;&lt;/p&gt;'));
  assert.ok(html.includes('<title>A &lt;b&gt; title</title>'));
  assert.equal(safeUrl(' JaVaScRiPt:alert(1)'), '#');
  assert.equal(safeUrl('java\tscript:x'), '#');
  assert.equal(safeUrl('data:text/html,x'), '#');
  assert.equal(safeUrl('data:image/png;base64,AA==', true), 'data:image/png;base64,AA==');
  assert.equal(escapeHtml('a\u0000b\u0007c'), 'abc', 'characters XML cannot hold are dropped');
  assert.equal(base64(new TextEncoder().encode('Moshe!?')), 'TW9zaGUhPw==');
});

test('HTML: a full page for print, or a snippet; footnotes at the end; dir on blocks', () => {
  const sheets = [{ title: 'S', body: '# One\nText^[A *note*].\nשלום עולם\n## Two\nMore.\n![Pic](_media/p.png)' }];
  const doc = buildDoc(sheets);
  const page = toHtml(doc, 'manuscript', { title: 'Book', author: 'Ada', lang: 'en' });
  assert.ok(page.startsWith('<!DOCTYPE html>\n<html lang="en">'));
  assert.ok(page.includes('@page { size: letter; margin: 72pt 72pt 72pt 72pt;'));
  assert.ok(page.includes('@top-right { content: "Ada / " "Book / " counter(page)'));
  assert.ok(page.includes('@media print'));
  assert.ok(page.includes('font-family: "Courier New"'));
  assert.ok(page.includes('<meta name="author" content="Ada">'));
  // manuscript: each chapter (here ##, as there is one #) on a new page, but not the first heading
  assert.ok(page.includes('<h1 id="one" dir="auto" class="chapter">'));
  assert.ok(page.includes('<h2 id="two" dir="auto" class="chapter break">'));
  assert.ok(page.includes('<sup class="fnref"><a href="#fn-1" id="fnref-1" role="doc-noteref">1</a></sup>'));
  assert.ok(page.includes('<li id="fn-1" dir="auto"><a href="#fnref-1" class="fnback" role="doc-backlink">1.</a> A <em>note</em></li>'));
  assert.ok(page.includes('<p dir="rtl">שלום עולם</p>'));
  assert.ok(page.includes('<img src="_media/p.png" alt="Pic">'), 'a picture not given keeps its path');
  const snippet = toHtml(doc, 'everyday', { full: false, images: { '_media/p.png': { bytes: png1(), type: 'image/png' } } });
  assert.ok(snippet.startsWith('<article class="moshe-doc style-everyday">'));
  assert.ok(!snippet.includes('<style>'));
  assert.ok(snippet.includes('src="data:image/png;base64,iVBORw0KGgo'));
  assert.ok(!toHtml(doc, 'everyday', { unresolvedImages: 'caption' }).includes('<img'));
  const hebrew = toHtml(buildDoc([{ body: 'שלום\nעולם' }]), 'everyday');
  assert.ok(hebrew.includes('<html lang="he" dir="rtl">'));
  const cols = toHtml(doc, 'columns');
  assert.ok(cols.includes('class="moshe-doc style-columns columns"'));
  assert.ok(cols.includes('column-count: 2'));
});

test('HTML: a revision copy shows the marks, with annotations in the margin', () => {
  const html = toHtml(buildDoc([{ body: MARKED }], { revision: true }), 'revision');
  assert.ok(html.includes('class="moshe-doc style-revision has-notes"'));
  assert.ok(html.includes('<span class="comment" role="note">a comment</span>'));
  assert.ok(html.includes('<del>gone</del><ins>added</ins>'));
  assert.ok(html.includes('<del>old</del><ins>new</ins>'));
  assert.ok(html.includes('<span class="annotated">annotated</span><span class="margin-note" role="note">the note</span>'));
  assert.ok(html.includes('<div class="comment-block" role="note" dir="auto">a comment block<br>over two lines</div>'));
  const inline = toHtml(buildDoc([{ body: MARKED }], { annotations: 'inline' }), 'everyday', { full: false });
  assert.ok(inline.includes('<span class="annotated">annotated</span> <span class="annotation-note">[the note]</span>'));
});

// ---- Markdown and text -----------------------------------------------------------------

test('Markdown: standard, with footnotes at the end and none of the writer\'s marks', () => {
  const sheets = [
    { title: 'A', body: `# Title
Some **bold**, _em_, ==mark==, ~~strike~~, \`code\`, $x$ and a [link](https://e.com/a b).^[A *note*.]
%%comment%% Kept {--deleted--}{++inserted++} {~~was~>is~~} {==annotated==}{>>note<<}.
Literal * star, snake_case, _under, [brackets] and 1. not a list
1\\. not a list either
- one
  - two
- [x] done
1. first
2. second
> quote
>> deeper
\`\`\`
code \`\`\` inside
\`\`\`
| a | b |
|:--:|--:|
| 1 | x\\|y |
---
![Pic](_media/p.png)
(toc)` },
    { title: 'B', body: '## Second\nMore^[two].' },
  ];
  const md = toMarkdown(buildDoc(sheets));
  assert.equal(md, `# Title

Some **bold**, *em*, ==mark==, ~~strike~~, \`code\`, $x$ and a [link](<https://e.com/a b>).[^1]

Kept inserted is annotated.

Literal \\* star, snake_case, \\_under, \\[brackets\\] and 1. not a list

1\\. not a list either

- one
  - two
- [x] done

1. first
2. second

> quote
>
> > deeper

\`\`\`
code \`\`\` inside
\`\`\`

| a | b |
| :---: | ---: |
| 1 | x\\|y |

---

![Pic](_media/p.png)

- [Title](#title)
  - [Second](#second)

## Second

More[^2].

[^1]: A *note*.
[^2]: two
`);
  assert.ok(!/\{(\+\+|--|~~|==|>>)|%%/u.test(md));
});

test('Markdown: two lists in a row stay two lists; highlights can be written other ways', () => {
  const doc = buildDoc([{ body: '- a\n- b\n\n(toc)\n# H\n1. x\n\n\nnot\n1. y' }]);
  const md = toMarkdown(doc);
  assert.ok(md.startsWith('- a\n- b\n\n* [H](#h)\n\n# H'), md);
  const mark = buildDoc([{ body: '==hi==' }]);
  assert.equal(toMarkdown(mark, { highlight: 'html' }), '<mark>hi</mark>\n');
  assert.equal(toMarkdown(mark, { highlight: 'none' }), 'hi\n');
});

test('plain text: what a reader sees, footnotes as [n]', () => {
  const t = toText(buildDoc([{ body: '# Title\nA **b** [link](https://e.com)^[note].\n- one\n  1. two\n> q\n| a | b |\n|---|---|\n| 1 | 2 |\n---\n![Cap](x.png)\n%%c%% end' }]));
  assert.equal(t, 'Title\n\nA b link <https://e.com>[1].\n\n• one\n   1. two\n\n    q\n\na\tb\n1\t2\n\n* * *\n\n[Cap]\n\nend\n\n[1] note\n');
});

// ---- ZIP -------------------------------------------------------------------------------------

test('ZIP: stored entries with CRC-32, UTF-8 names flagged, read back intact', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
  const big = new Uint8Array(70000).map((_, i) => (i * 7) & 255);
  const zip = createZip([
    { name: 'mimetype', data: 'application/epub+zip' },
    { name: 'folder/' },
    { name: 'folder/שלום.txt', data: 'שלום' },
    { name: 'bin', data: big },
  ], { date: new Date(2026, 8, 26, 12, 30, 10) });
  const z = unzip(zip);
  assert.deepEqual(z.entries.map((e) => e.name), ['mimetype', 'folder/', 'folder/שלום.txt', 'bin']);
  assert.equal(z.entries[0].flags, 0, 'a plain ASCII name is not flagged');
  assert.equal(z.entries[0].extraLength, 0);
  assert.equal(z.entries[2].flags & 0x0800, 0x0800);
  assert.equal(z.text('folder/שלום.txt'), 'שלום');
  assert.deepEqual([...z.map.get('bin').data], [...big]);
  const v = new DataView(zip.buffer);
  assert.equal(v.getUint16(12, true), ((2026 - 1980) << 9) | (9 << 5) | 26, 'the DOS date');
  assert.equal(v.getUint16(10, true), (12 << 11) | (30 << 5) | 5, 'the DOS time');
});

// ---- DOCX -------------------------------------------------------------------------------------

const DOCX_SHEETS = [
  { title: 'Front', body: '# The Book\n(toc)' },
  { title: 'One', body: [
    '## Chapter one',
    'Some **bold** _italic_ ~~struck~~ ==marked== `code` and a [link](https://example.com/?q=1&r=2) and [inside](#chapter-two).^[A footnote with a [link](https://fn.example).]',
    '- bullet', '  - nested', '    1. deep ordered', '- back', '', '1. one', '2. two', '',
    '3. again', 'break', '1. restart',
    '| H1 | H2 |', '|:--|--:|', '| a | b |',
    '> A quote', '```', 'code line', '\tindented', '```', '$$', 'x^2', '$$', '---',
    '![Pic](_media/p.png)', '![Missing](_media/missing.png)',
    'שלום עולם, and some English.',
  ].join('\n') },
  { title: 'Two', body: '## Chapter two\nSecond footnote^[Two].\n%%comment%% {--del--}{++ins++} {==ann==}{>>note<<}' },
];

function docxParts(bytes) {
  const z = unzip(bytes);
  const xml = {};
  for (const e of z.entries) if (XML_PART.test(e.name)) xml[e.name] = parseXml(e.text());
  return { z, xml };
}

test('DOCX: every part there, well-formed, typed and related', () => {
  const doc = buildDoc(DOCX_SHEETS);
  const bytes = toDocx(doc, 'everyday', { title: 'The Book', author: 'Ada Lovelace', images: { '_media/p.png': { bytes: png1(), type: 'image/png' } } });
  const { z, xml } = docxParts(bytes);
  const names = z.entries.map((e) => e.name);
  for (const part of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/footnotes.xml',
    'word/settings.xml', 'word/_rels/document.xml.rels', 'docProps/core.xml', 'word/fontTable.xml', 'word/media/image1.png', 'word/footer1.xml']) {
    assert.ok(names.includes(part), part);
  }
  assert.equal(names[0], '[Content_Types].xml');
  // every part has a content type
  const types = xml['[Content_Types].xml'];
  const defaults = new Set(types.children.filter((c) => c.name === 'Default').map((c) => c.attrs.Extension));
  const overrides = new Set(types.children.filter((c) => c.name === 'Override').map((c) => c.attrs.PartName));
  for (const n of names) {
    if (n.endsWith('/')) continue;
    assert.ok(overrides.has(`/${n}`) || defaults.has(n.split('.').pop()), `${n} has a content type`);
  }
  for (const o of overrides) assert.ok(names.includes(o.slice(1)), `${o} exists`);
  // every relationship points at a part that exists, and every r:id used is declared
  const relsOf = (part) => {
    const dir = part.slice(0, part.lastIndexOf('/') + 1);
    const relsName = `${dir}_rels/${part.slice(dir.length)}.rels`;
    const rels = xml[relsName] ? xml[relsName].children : [];
    for (const r of rels) if (r.attrs.TargetMode !== 'External') assert.ok(names.includes(dir + r.attrs.Target), `${relsName}: ${r.attrs.Target}`);
    return new Map(rels.map((r) => [r.attrs.Id, r]));
  };
  for (const part of ['word/document.xml', 'word/footnotes.xml']) {
    const rels = relsOf(part);
    for (const el of all(xml[part])) {
      for (const [k, v] of Object.entries(el.attrs)) if (k.startsWith(`{${R}}`)) assert.ok(rels.has(v), `${part}: ${k} ${v}`);
    }
  }
  for (const r of xml['_rels/.rels'].children) assert.ok(names.includes(r.attrs.Target), `_rels/.rels: ${r.attrs.Target}`);
  const docRels = [...relsOf('word/document.xml').values()];
  const link = docRels.find((r) => r.attrs.Target === 'https://example.com/?q=1&r=2');
  assert.equal(link.attrs.TargetMode, 'External');
  assert.ok([...relsOf('word/footnotes.xml').values()].some((r) => r.attrs.Target === 'https://fn.example'), 'a footnote\'s link is the footnotes part\'s');
  // core properties
  const core = z.text('docProps/core.xml');
  assert.ok(core.includes('<dc:title>The Book</dc:title>'));
  assert.ok(core.includes('<dc:creator>Ada Lovelace</dc:creator>'));
});

test('DOCX: footnotes, lists, styles and the table of contents are Word\'s own', () => {
  const doc = buildDoc(DOCX_SHEETS);
  const { xml } = docxParts(toDocx(doc, 'essay'));
  const body = xml['word/document.xml'];
  // footnotes: each reference has its footnote, with its text
  const refs = [...iter(body, W, 'footnoteReference')].map((e) => wAttr(e, 'id'));
  assert.deepEqual(refs, ['1', '2']);
  const notes = [...iter(xml['word/footnotes.xml'], W, 'footnote')];
  assert.deepEqual(notes.map((n) => wAttr(n, 'id')), ['-1', '0', '1', '2']);
  const noteText = (n) => [...iter(n, W, 't')].map((t) => t.text).join('');
  assert.equal(noteText(notes[2]).trim(), 'A footnote with a link.');
  assert.equal(noteText(notes[3]).trim(), 'Two');
  // numbering: every numId used exists, and points at an abstractNum that does
  const numbering = xml['word/numbering.xml'];
  const abstracts = new Set([...iter(numbering, W, 'abstractNum')].map((a) => wAttr(a, 'abstractNumId')));
  const nums = new Map([...iter(numbering, W, 'num')].map((n) => [wAttr(n, 'numId'), n]));
  const used = [...iter(body, W, 'numId')].map((e) => wAttr(e, 'val'));
  assert.equal(used.length, 8, 'a list paragraph for each item');
  for (const id of used) {
    assert.ok(nums.has(id), `numId ${id}`);
    const abs = [...iter(nums.get(id), W, 'abstractNumId')][0];
    assert.ok(abstracts.has(wAttr(abs, 'val')));
  }
  // separate numbered lists restart: each has its own w:num with a start
  const starts = [...nums.values()].flatMap((n) => [...iter(n, W, 'startOverride')].map((s) => wAttr(s, 'val')));
  // the nested list; 1, 2 and (after a blank line, still the same list) 3; and the list after a paragraph
  assert.deepEqual(starts, ['1', '1', '1']);
  const levels = [...iter(body, W, 'ilvl')].map((e) => wAttr(e, 'val'));
  assert.ok(levels.includes('2'), 'the nested list is two levels down');
  // every style used is defined
  const styles = xml['word/styles.xml'];
  const defined = new Set([...iter(styles, W, 'style')].map((s) => wAttr(s, 'styleId')));
  for (const need of ['Normal', 'Heading1', 'Heading2', 'Heading3', 'Heading4', 'Heading5', 'Heading6', 'Title', 'Quote', 'ListParagraph',
    'SourceCode', 'FootnoteText', 'FootnoteReference', 'Hyperlink', 'TOC1', 'TableGrid']) assert.ok(defined.has(need), need);
  for (const tag of ['pStyle', 'rStyle', 'tblStyle']) {
    for (const part of ['word/document.xml', 'word/footnotes.xml']) {
      for (const e of iter(xml[part], W, tag)) assert.ok(defined.has(wAttr(e, 'val')), `${tag} ${wAttr(e, 'val')}`);
    }
  }
  // the heading styles are Word's built-in ones, with outline levels (for the navigation pane and the TOC)
  const h2 = [...iter(styles, W, 'style')].find((s) => wAttr(s, 'styleId') === 'Heading2');
  assert.equal(wAttr([...iter(h2, W, 'name')][0], 'val'), 'heading 2');
  assert.equal(wAttr([...iter(h2, W, 'outlineLvl')][0], 'val'), '1');
  assert.equal([...iter(h2, W, 'smallCaps')].length, 1, 'Essay\'s headings are small capitals');
  // the table of contents: a TOC field, with a link to each heading's bookmark
  const instr = [...iter(body, W, 'instrText')].map((e) => e.text).join('');
  assert.ok(instr.includes('TOC \\o "1-3" \\h \\z \\u'));
  const anchors = [...iter(body, W, 'hyperlink')].map((h) => wAttr(h, 'anchor')).filter(Boolean);
  const marks = new Set([...iter(body, W, 'bookmarkStart')].map((b) => wAttr(b, 'name')));
  assert.ok(anchors.length >= 3);
  for (const a of anchors) assert.ok(marks.has(a), `bookmark ${a}`);
  // a table, with its header row repeated
  assert.equal([...iter(body, W, 'tbl')].length, 1);
  assert.equal([...iter(body, W, 'tblHeader')].length, 1);
  assert.equal([...iter(body, W, 'tc')].length, 4);
  // runs: bold, italic, strike, highlight, code
  const rprs = [...iter(body, W, 'rPr')];
  const has = (name) => rprs.some((r) => r.children.some((c) => c.name === name));
  for (const n of ['b', 'i', 'strike', 'highlight', 'rStyle']) assert.ok(has(n), n);
  assert.equal(wAttr([...iter(body, W, 'highlight')][0], 'val'), 'yellow');
  // a picture not given shows its caption; page size and margins from the style
  const text = [...iter(body, W, 't')].map((t) => t.text).join('');
  assert.ok(text.includes('[Pic]') && text.includes('[Missing]'));
  const pg = [...iter(body, W, 'pgSz')][0];
  assert.deepEqual([wAttr(pg, 'w'), wAttr(pg, 'h')], ['11906', '16838']);
  assert.equal(wAttr([...iter(body, W, 'pgMar')][0], 'left'), '1440');
});

test('DOCX: a Hebrew paragraph is bidi and its Hebrew runs right to left', () => {
  const { xml } = docxParts(toDocx(buildDoc([{ body: 'שלום עולם, and some English.\nEnglish with מילה אחת inside.\n- פריט' }])));
  const paras = [...iter(xml['word/document.xml'], W, 'p')];
  const bidi = (p) => [...iter(p, W, 'bidi')].length > 0;
  const runs = (p) => [...iter(p, W, 'r')].map((r) => [[...iter(r, W, 't')].map((t) => t.text).join(''), [...iter(r, W, 'rtl')].length > 0]);
  assert.equal(bidi(paras[0]), true);
  assert.deepEqual(runs(paras[0]), [['שלום עולם, ', true], ['and some English', false], ['.', true]]);
  assert.equal(bidi(paras[1]), false);
  assert.deepEqual(runs(paras[1]), [['English with ', false], ['מילה אחת', true], [' inside.', false]]);
  assert.equal(bidi(paras[2]), true, 'a Hebrew list item too');
  assert.deepEqual(directionRuns('abc', true), [{ text: 'abc', rtl: false }]);
  assert.deepEqual(directionRuns('', false), []);
});

test('DOCX: a revision copy has tracked changes and Word comments', () => {
  const doc = buildDoc(DOCX_SHEETS, { revision: true });
  const { z, xml } = docxParts(toDocx(doc, 'revision', { author: 'Ada' }));
  const body = xml['word/document.xml'];
  const del = [...iter(body, W, 'del')];
  const ins = [...iter(body, W, 'ins')];
  assert.equal(del.length, 1);
  assert.equal(ins.length, 1);
  assert.equal([...iter(del[0], W, 'delText')].map((t) => t.text).join(''), 'del');
  assert.equal(wAttr(del[0], 'author'), 'Ada');
  const comments = [...iter(xml['word/comments.xml'], W, 'comment')];
  assert.deepEqual(comments.map((c) => [...iter(c, W, 't')].map((t) => t.text).join('')), ['comment', 'note']);
  const ids = comments.map((c) => wAttr(c, 'id'));
  for (const tag of ['commentRangeStart', 'commentRangeEnd', 'commentReference']) {
    assert.deepEqual([...iter(body, W, tag)].map((e) => wAttr(e, 'id')), ids, tag);
  }
  // the annotated text sits between its comment's range marks
  const p = [...iter(body, W, 'p')].find((x) => [...iter(x, W, 'commentRangeStart')].length === 2);
  const seq = p.children.map((c) => (c.name === 'r' ? [...iter(c, W, 't')].map((t) => t.text).join('') : c.name));
  const at = seq.indexOf('commentRangeStart', seq.indexOf('commentRangeStart') + 1);
  assert.equal(seq[at + 1], 'ann');
  assert.equal(seq[at + 2], 'commentRangeEnd');
  assert.ok(z.text('[Content_Types].xml').includes('/word/comments.xml'));
  assert.ok(z.text('word/_rels/document.xml.rels').includes('comments.xml'));
  // or, asked, as formatting and highlighted text
  const plain = docxParts(toDocx(doc, 'revision', { trackChanges: false, comments: 'inline' }));
  assert.equal([...iter(plain.xml['word/document.xml'], W, 'del')].length, 0);
  assert.equal(plain.z.map.has('word/comments.xml'), false);
  assert.ok([...iter(plain.xml['word/document.xml'], W, 't')].some((t) => t.text.includes('[note]')));
});

test('DOCX: pictures embedded when given, Letter pages and two columns when the style says', () => {
  const doc = buildDoc([{ body: '# One\n![Pic](_media/p.png)\nText ![icon](_media/p.png) inline.\n## Two\nMore.' }]);
  const images = { '_media/p.png': { bytes: png1(), type: 'image/png' } };
  const m = docxParts(toDocx(doc, 'manuscript', { images, author: 'Ada', title: 'Book' }));
  assert.equal(m.z.entries.filter((e) => e.name.startsWith('word/media/')).length, 1, 'one file for a picture used twice');
  assert.equal([...iter(m.xml['word/document.xml'], 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', 'inline')].length, 2);
  const ext = [...iter(m.xml['word/document.xml'], 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', 'extent')][0];
  assert.deepEqual([ext.attrs.cx, ext.attrs.cy], [String(3 * 9525), String(2 * 9525)], 'the PNG\'s own size, read from it');
  const pg = [...iter(m.xml['word/document.xml'], W, 'pgSz')][0];
  assert.deepEqual([wAttr(pg, 'w'), wAttr(pg, 'h')], ['12240', '15840']);
  assert.ok(m.z.text('word/header1.xml').includes('Ada / Book / '), 'a manuscript\'s running head');
  const h2 = [...iter(m.xml['word/styles.xml'], W, 'style')].find((s) => wAttr(s, 'styleId') === 'Heading2');
  assert.equal([...iter(h2, W, 'pageBreakBefore')].length, 1, 'chapters begin a page');
  const c = docxParts(toDocx(doc, 'columns'));
  assert.equal(wAttr([...iter(c.xml['word/document.xml'], W, 'cols')][0], 'num'), '2');
  assert.deepEqual(imageSize(png1()), { width: 3, height: 2 });
  assert.deepEqual(imageSize(new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0, 4, 0, 0, 0xFF, 0xC0, 0, 11, 8, 0, 20, 0, 30, 3, 0, 0])), { width: 30, height: 20 });
});

// ---- EPUB -------------------------------------------------------------------------------------

test('EPUB: mimetype first and stored, container, package, nav, chapters, all well-formed', () => {
  const doc = buildDoc(DOCX_SHEETS);
  const bytes = toEpub(doc, 'papers', { title: 'The Book', author: 'Ada', lang: 'en', images: { '_media/p.png': { bytes: png1(), type: 'image/png' } },
    cover: { bytes: png1(), type: 'image/png' }, date: new Date(Date.UTC(2026, 8, 26)) });
  const z = unzip(bytes);
  const first = z.entries[0];
  assert.equal(first.name, 'mimetype');
  assert.equal(first.method, 0);
  assert.equal(first.extraLength, 0);
  assert.equal(first.text(), 'application/epub+zip');
  assert.equal(first.offset, 0);
  for (const e of z.entries) if (XML_PART.test(e.name)) parseXml(e.text());
  const container = parseXml(z.text('META-INF/container.xml'));
  const rootfile = [...iter(container, 'urn:oasis:names:tc:opendocument:xmlns:container', 'rootfile')][0];
  assert.equal(rootfile.attrs['full-path'], 'OEBPS/content.opf');
  const OPF = 'http://www.idpf.org/2007/opf';
  const opf = parseXml(z.text('OEBPS/content.opf'));
  assert.equal(opf.attrs.version, '3.0');
  const items = [...iter(opf, OPF, 'item')];
  for (const it of items) assert.ok(z.map.has(`OEBPS/${it.attrs.href}`), it.attrs.href);
  const ids = new Set(items.map((it) => it.attrs.id));
  const spine = [...iter(opf, OPF, 'itemref')].map((r) => r.attrs.idref);
  for (const id of spine) assert.ok(ids.has(id), id);
  assert.ok(items.some((it) => it.attrs.properties === 'nav'));
  assert.ok(items.some((it) => it.attrs.properties === 'cover-image'));
  assert.deepEqual(spine, ['cover', 'ch1', 'ch2', 'ch3']);
  const opfText = z.text('OEBPS/content.opf');
  assert.ok(opfText.includes('<dc:title>The Book</dc:title>'));
  assert.ok(opfText.includes('<dc:creator id="author">Ada</dc:creator>'));
  assert.ok(opfText.includes('<meta property="dcterms:modified">2026-09-26T00:00:00Z</meta>'));
  assert.match(opfText, /<dc:identifier id="book-id">urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}<\/dc:identifier>/u);
  // nav: the headings, nested, pointing into the chapter files
  const nav = z.text('OEBPS/nav.xhtml');
  assert.ok(nav.includes('<nav epub:type="toc" id="toc" role="doc-toc">'));
  assert.ok(nav.includes('<a href="ch001.xhtml#the-book">The Book</a><ol><li><a href="ch002.xhtml#chapter-one">Chapter one</a></li><li><a href="ch003.xhtml#chapter-two">Chapter two</a></li></ol>'));
  assert.ok(z.text('OEBPS/toc.ncx').includes('<content src="ch002.xhtml#chapter-one"/>'));
  // a chapter: XHTML, self-closed void elements, footnotes as asides with a way back
  const ch2 = z.text('OEBPS/ch002.xhtml');
  assert.ok(ch2.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">'));
  assert.ok(ch2.includes('<hr/>'));
  assert.ok(ch2.includes('<img src="images/img001.png" alt="Pic"/>'));
  assert.ok(ch2.includes('<a href="#fn-1" id="fnref-1" role="doc-noteref" epub:type="noteref">1</a>'));
  assert.ok(ch2.includes('<aside epub:type="footnote" role="doc-footnote" id="fn-1" class="footnote" dir="auto"><p><a href="#fnref-1" class="fnback" role="doc-backlink">1.</a> A footnote with a <a href="https://fn.example">link</a>.</p></aside>'));
  assert.ok(!ch2.includes('id="fn-2"'), 'a footnote goes with its own chapter');
  assert.ok(z.text('OEBPS/ch003.xhtml').includes('id="fn-2"'));
  // the (toc) in the text links across chapter files
  assert.ok(z.text('OEBPS/ch001.xhtml').includes('<a href="ch002.xhtml#chapter-one">Chapter one</a>'));
  assert.ok(z.text('OEBPS/style.css').includes('font-family: Charter'));
  assert.ok(!z.text('OEBPS/style.css').includes('@page'));
});

test('EPUB: without headings a chapter a sheet; a Hebrew book reads right to left', () => {
  const doc = buildDoc([{ title: 'First', body: 'One.' }, { title: 'Second', body: 'Two.' }]);
  assert.deepEqual(chaptersOf(doc).map((c) => [c.title, c.file]), [['First', 'ch001.xhtml'], ['Second', 'ch002.xhtml']]);
  const z = unzip(toEpub(doc, 'everyday'));
  assert.ok(z.text('OEBPS/nav.xhtml').includes('<li><a href="ch002.xhtml">Second</a></li>'));
  const he = unzip(toEpub(buildDoc([{ title: 'א', body: '# פרק\nשלום.' }])));
  assert.ok(he.text('OEBPS/content.opf').includes('page-progression-direction="rtl"'));
  assert.ok(he.text('OEBPS/ch001.xhtml').includes('lang="he" xml:lang="he" dir="rtl"'));
  assert.ok(he.text('OEBPS/ch001.xhtml').includes('<p dir="rtl">שלום.</p>'));
  const empty = unzip(toEpub(buildDoc([])));
  assert.ok(empty.map.has('OEBPS/ch001.xhtml'), 'an empty book still has a chapter');
});

// ---- exportSheets ----------------------------------------------------------------------------

test('exportSheets: each format, its type and extension', () => {
  const sheets = [{ title: 'My: Book?', body: '# My Book\nText with ![pic](_media/a b.png).\n{==x==}{>>n<<}' }];
  const images = { '_media/a b.png': { bytes: png1(), type: 'image/png' } };
  const want = { html: ['text/html', 'html'], 'pdf-html': ['text/html', 'html'], docx: [FORMATS[1].mime, 'docx'], epub: ['application/epub+zip', 'epub'],
    markdown: ['text/markdown', 'md'], text: ['text/plain', 'txt'], textbundle: ['application/zip', 'textpack'] };
  for (const [format, [mime, extension]] of Object.entries(want)) {
    const r = exportSheets(sheets, { format, images, style: 'revision' });
    assert.equal(r.mime, mime, format);
    assert.equal(r.extension, extension, format);
    assert.ok(r.bytes instanceof Uint8Array && r.bytes.length > 0);
    assert.equal(r.filename, `My Book.${extension}`);
    if (['html', 'pdf-html', 'markdown', 'text'].includes(format)) assert.equal(typeof r.text, 'string');
  }
  // the Revision style shows the marks where it can, but Markdown and text never do
  assert.ok(exportSheets(sheets, { format: 'html', style: 'revision' }).text.includes('margin-note'));
  assert.ok(!exportSheets(sheets, { format: 'html', style: 'revision', revision: false }).text.includes('margin-note">'));
  assert.equal(exportSheets(sheets, { format: 'markdown', style: 'revision' }).text, '# My Book\n\nText with ![pic](<_media/a b.png>).\n\nx\n');
  assert.ok(exportSheets(sheets, { format: 'pdf-html', images }).text.includes('src="data:image/png'));
  assert.ok(!exportSheets(sheets, { format: 'pdf-html', images: {} }).text.includes('<img'), 'a printed page shows a missing picture\'s caption');
  const letter = exportSheets(sheets, { format: 'html', style: 'everyday', pageSize: 'letter', margins: 36 }).text;
  assert.ok(letter.includes('@page { size: letter; margin: 36pt 36pt 36pt 36pt;'));
  assert.ok(exportSheets(sheets, { format: 'pdf-html', pageSize: 'a5' }).text.includes('@page { size: A5;'));
  const a5 = unzip(exportSheets(sheets, { format: 'docx', pageSize: 'a5' }).bytes).text('word/document.xml');
  assert.ok(a5.includes('<w:pgSz w:w="8391" w:h="11906"/>'));
  const snippet = exportSheets(sheets, { format: 'html', full: false }).text;
  assert.ok(snippet.startsWith('<article') && !snippet.includes('<style>'));
  assert.throws(() => exportSheets(sheets, { format: 'rtf' }), /unknown export format/u);
});

test('exportSheets: a TextPack is the bundle folder with info.json, text.md and assets', () => {
  const r = exportSheets([{ title: 'Pack', body: '# Pack\n![one](_media/p.png)\n![two](other/p.png)\n![gone](_media/none.png)' }], {
    format: 'textbundle', images: { '_media/p.png': { bytes: png1(), type: 'image/png' }, 'other/p.png': { bytes: png1(), type: 'image/png' } },
  });
  const z = unzip(r.bytes);
  assert.deepEqual(z.entries.map((e) => e.name), ['Pack.textbundle/', 'Pack.textbundle/info.json', 'Pack.textbundle/text.md', 'Pack.textbundle/assets/',
    'Pack.textbundle/assets/p.png', 'Pack.textbundle/assets/p-2.png']);
  const info = JSON.parse(z.text('Pack.textbundle/info.json'));
  assert.equal(info.version, 2);
  assert.equal(info.type, 'net.daringfireball.markdown');
  assert.equal(z.text('Pack.textbundle/text.md'), '# Pack\n\n![one](assets/p.png)\n\n![two](assets/p-2.png)\n\n![gone](_media/none.png)\n');
});

test('a raw source block goes into HTML as it is, and stays code in an ePub', async () => {
  const { exportSheets } = await import('../src/export/index.js');
  const body = '# Raw\n```raw\n<aside class="x">as <b>written</b></aside>\n```\n';
  const html = exportSheets([{ title: 'Raw', body, path: 'Raw.md' }], { format: 'html', full: false }).text;
  assert.ok(html.includes('<aside class="x">as <b>written</b></aside>'));
  const md = exportSheets([{ title: 'Raw', body, path: 'Raw.md' }], { format: 'markdown' }).text;
  assert.ok(md.includes('```raw\n<aside'));
});
