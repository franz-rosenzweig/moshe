// Exports a sample document in every format and style, for a person to open
// and look at: the sheets of sample-library/ if it has any, or otherwise a
// built-in sample that uses every piece of Moshe's markup, in English and in
// Hebrew. Writes /tmp/moshe-export/ (or the folder given):
//
//   docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD":/repo \
//     -v /tmp/moshe-export:/tmp/moshe-export -w /repo node:22-alpine node tools/export-sample.mjs
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { deflateSync } from 'node:zlib';
import { exportSheets, STYLE_ORDER } from '../engine/src/export/index.js';
import { crc32 } from '../engine/src/export/zip.js';

const out = process.argv[2] || '/tmp/moshe-export';
const library = new URL('../sample-library/', import.meta.url).pathname;

/** Every sheet under a folder, in path order (names starting . or _ are not sheets). */
function sheetsIn(dir) {
  const found = [];
  const walk = (d) => {
    let names;
    try { names = readdirSync(d); } catch { return; }
    for (const n of names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
      if (n.startsWith('.') || n.startsWith('_')) continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n.endsWith('.md')) found.push({ title: relative(dir, p).replace(/\.md$/u, ''), text: readFileSync(p, 'utf8') });
    }
  };
  walk(dir);
  return found;
}

/** A small PNG (a colour gradient), made here so the sample has a picture to embed. */
function png(width, height) {
  const chunk = (type, data) => {
    const b = new Uint8Array(12 + data.length);
    const v = new DataView(b.buffer);
    v.setUint32(0, data.length);
    b.set(new TextEncoder().encode(type), 4);
    b.set(data, 8);
    v.setUint32(8 + data.length, crc32(b.subarray(4, 8 + data.length)));
    return b;
  };
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, width); iv.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8);                       // 8-bit RGB
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    for (let x = 0; x < width; x++) raw.set([40 + (180 * x) / width, 90 + (120 * y) / height, 200], row + 1 + x * 3);
  }
  const parts = [new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))];
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.length; }
  return all;
}

const SAMPLE = [
  { title: 'Title page', body: `# The Lighthouse Keeper's Notebook
_A sample for Moshe's exporters_

(toc)
` },
  { title: 'Chapter one', body: `## Chapter One: Arrival
The ferry left me on the jetty at dusk, with **two trunks**, _one umbrella_ and a letter of introduction nobody asked to see.^[The letter is reproduced in the appendix, with the keeper's *marginalia*.]
Every line is a paragraph. This one has ==a highlight==, some \`inline code\`, a formula $e^{i\\pi} + 1 = 0$, ~~a strike~~ and a [link](https://example.com/?a=1&b=2 "Example").
A bare address: https://moshe.example/export, a [[Wiki link|wiki link]] and escaped \\*stars\\*.
%%A comment for the writer only.%% The reader never sees the comment before this sentence.
Tracked changes: the sea was {--grey--}{++pewter++}, the wind {~~cold~>bitter~~}, and the keeper {==seemed unsurprised==}{>>Is this too flat? Try something with more tension.<<} to see me.
A second footnote^[Footnotes are numbered across the whole document, not per sheet.] ends this paragraph.

### What I brought
- Oilskins
- Books
  - Moby-Dick
  - _The Rings of Saturn_
    1. first reading
    2. second reading
- Tea
3. The third thing
4. The fourth thing
- [ ] Unpack
- [x] Light the lamp

> The sea has neither meaning nor pity.
>> Chekhov, quoted by the keeper

---

| Night | Wind | Visibility |
| :--- | :---: | ---: |
| Monday | NW 5 | 2 nm |
| Tuesday | \`calm\` | 10 nm |
| Wednesday | S 7 & rain | < 1 nm |
` },
  { title: 'Chapter two', body: `## Chapter Two: The Lamp
\`\`\`python
def lamp(on: bool) -> str:
    return "lit" if on else "dark"  # <no> escaping trouble & fine
\`\`\`
$$
\\int_0^1 x^2\\,dx = \\frac{1}{3}
$$
![The lamp room at night](_media/lamp.png)
![A picture that is not in the export](_media/missing.png)
%% A comment block
over two lines %%
The last paragraph of chapter two.
` },
  { title: 'פרק שלישי', body: `## פרק שלישי: הסערה
הרוח נשבה כל הלילה, והמגדלור עמד בה.^[הערת שוליים בעברית, עם מילה in English.]
This English paragraph follows a Hebrew one, and has שתי מילים in Hebrew.
- פריט ראשון
- פריט שני
> ציטוט בעברית
` },
];

const sheets = sheetsIn(library);
const source = sheets.length ? sheets : SAMPLE;
const images = { '_media/lamp.png': { bytes: png(480, 240), type: 'image/png' } };
const opts = { title: sheets.length ? 'Sample library' : "The Lighthouse Keeper's Notebook", author: 'Ada Keeper', images };

mkdirSync(out, { recursive: true });
const write = (name, r) => { writeFileSync(join(out, name), r.bytes); console.log(`${name.padEnd(28)} ${String(r.bytes.length).padStart(8)} bytes  ${r.mime}`); };
console.log(`${sheets.length ? `${sheets.length} sheets from sample-library` : 'the built-in sample'} → ${out}`);
write('sample.docx', exportSheets(source, { ...opts, format: 'docx' }));
write('sample.epub', exportSheets(source, { ...opts, format: 'epub', cover: { bytes: png(600, 900), type: 'image/png' } }));
write('sample.html', exportSheets(source, { ...opts, format: 'html' }));
write('sample.md', exportSheets(source, { ...opts, format: 'markdown' }));
write('sample.txt', exportSheets(source, { ...opts, format: 'text' }));
write('sample.textpack', exportSheets(source, { ...opts, format: 'textbundle' }));
write('sample-print.html', exportSheets(source, { ...opts, format: 'pdf-html' }));
for (const id of STYLE_ORDER) {
  write(`sample-${id}.html`, exportSheets(source, { ...opts, format: 'pdf-html', style: id }));
  write(`sample-${id}.docx`, exportSheets(source, { ...opts, format: 'docx', style: id }));
}
