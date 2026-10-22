import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importFile, inlineFootnotes, decodeText } from '../src/import/index.js';
import { docxToMarkdown, readDocx } from '../src/import/docx.js';
import { htmlToMarkdown, parseHtml } from '../src/import/html.js';
import { unzip, ZipError } from '../src/import/unzip.js';
import { MarkupWriter, B, I, S, H, C } from '../src/import/writer.js';
import { exportSheets } from '../src/export/index.js';
import { createZip, crc32 } from '../src/export/zip.js';
import { buildDoc } from '../src/export/doc.js';
import { parseLines } from '../src/markup.js';

// ---- helpers -------------------------------------------------------------------------

const enc = new TextEncoder();

const png1 = () => {
  // a 3×2 PNG header is enough for the exporter to read its size
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 3, 0, 0, 0, 2]);
  return b;
};

async function deflateRaw(data) {
  const cs = new CompressionStream('deflate-raw');
  const w = cs.writable.getWriter();
  w.write(data);
  w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

/**
 * A ZIP written here, not by createZip: entries stored or deflated, and optionally with
 * ZIP64 records (every size and offset in the ZIP64 extra field, the end record pointing on).
 * @param {{name: string, data: Uint8Array|string, deflate?: boolean}[]} entries
 */
async function makeZip(entries, { zip64 = false } = {}) {
  const parts = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    const body = e.deflate ? await deflateRaw(data) : data;
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034B50, true);
    lv.setUint16(4, zip64 ? 45 : 20, true);
    lv.setUint16(8, e.deflate ? 8 : 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    parts.push(local, body);
    const extra = zip64 ? new Uint8Array(28) : new Uint8Array(0);
    if (zip64) {
      const xv = new DataView(extra.buffer);
      xv.setUint16(0, 1, true);
      xv.setUint16(2, 24, true);
      xv.setBigUint64(4, BigInt(data.length), true);
      xv.setBigUint64(12, BigInt(body.length), true);
      xv.setBigUint64(20, BigInt(offset), true);
    }
    const c = new Uint8Array(46 + name.length + extra.length);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014B50, true);
    cv.setUint16(4, 45, true);
    cv.setUint16(6, zip64 ? 45 : 20, true);
    cv.setUint16(10, e.deflate ? 8 : 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, zip64 ? 0xFFFFFFFF : body.length, true);
    cv.setUint32(24, zip64 ? 0xFFFFFFFF : data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, extra.length, true);
    cv.setUint32(42, zip64 ? 0xFFFFFFFF : offset, true);
    c.set(name, 46);
    c.set(extra, 46 + name.length);
    central.push(c);
    offset += local.length + body.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const tail = [];
  if (zip64) {
    const rec = new Uint8Array(56);
    const rv = new DataView(rec.buffer);
    rv.setUint32(0, 0x06064B50, true);
    rv.setBigUint64(4, 44n, true);
    rv.setUint16(12, 45, true);
    rv.setUint16(14, 45, true);
    rv.setBigUint64(24, BigInt(entries.length), true);
    rv.setBigUint64(32, BigInt(entries.length), true);
    rv.setBigUint64(40, BigInt(cdSize), true);
    rv.setBigUint64(48, BigInt(offset), true);
    const loc = new Uint8Array(20);
    const locv = new DataView(loc.buffer);
    locv.setUint32(0, 0x07064B50, true);
    locv.setBigUint64(8, BigInt(offset + cdSize), true);
    locv.setUint32(16, 1, true);
    tail.push(rec, loc);
  }
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054B50, true);
  ev.setUint16(8, zip64 ? 0xFFFF : entries.length, true);
  ev.setUint16(10, zip64 ? 0xFFFF : entries.length, true);
  ev.setUint32(12, zip64 ? 0xFFFFFFFF : cdSize, true);
  ev.setUint32(16, zip64 ? 0xFFFFFFFF : offset, true);
  tail.push(end);
  const all = [...parts, ...central, ...tail];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

/** What Moshe reads of a line: its text and each character's formatting (for the writer's checks). */
function readBack(line) {
  const doc = buildDoc([{ body: line }]);
  const b = doc.blocks[0];
  const chars = [];
  const walk = (nodes, f) => {
    for (const n of nodes) {
      if (n.type === 'text') for (const ch of n.text) chars.push([ch, f]);
      else if (n.type === 'code') for (const ch of n.text) chars.push([ch, f | C]);
      else if (n.children) walk(n.children, f | ({ strong: B, em: I, strike: S, mark: H }[n.type] || 0));
    }
  };
  if (b && b.children) walk(b.children, 0);
  return { type: b ? b.type : 'none', chars };
}

// ---- round trip through Moshe's own exporter ----------------------------------------------

const SAMPLE = `# The Book

(toc)

Plain paragraph with **strong**, _emphasis_, **_both_**, ~~struck~~, ==marked== and \`code\`.

A [link](https://example.com/page) and a footnote.^[The footnote's text, with _emphasis_.]

שלום עולם, זו פסקה בעברית עם **הדגשה** ו-English words.

## Changes

Text with {++an insertion++} and {--a deletion--} and {~~old~>new~~} words.

A {==commented phrase==}{>>A note on it<<} here, and %%a quiet remark%% there.

### Lists

- one
- two
  - two point one
  - two point two
- three

1. first
2. second

| Name | שם |
| --- | --- |
| Moshe | משה |
| Aaron | אהרן |

![A picture](_media/pic.png)

> A quote.

---

\`\`\`
code line 1
  code line 2
\`\`\`

%%A comment block%%
`;

test('import: a revision export comes back as it went out, tracked changes and comments as CriticMarkup', async () => {
  const images = { '_media/pic.png': { bytes: png1(), type: 'image/png' } };
  const docx = exportSheets([{ body: SAMPLE }], { format: 'docx', style: 'revision', author: 'Ada', images });
  const r = await readDocx(docx.bytes);
  assert.equal(r.unresolved, 0);
  assert.equal(r.title, 'The Book');
  assert.deepEqual(r.warnings, []);
  assert.equal(r.images.length, 1);
  assert.equal(r.images[0].type, 'image/png');
  assert.deepEqual([...r.images[0].bytes], [...png1()]);
  const name = r.images[0].name;
  assert.equal(r.text, `# The Book

(toc)

Plain paragraph with **strong**, _emphasis_, **_both_**, ~~struck~~, ==marked== and \`code\`.

A [link](https://example.com/page) and a footnote.^[The footnote's text, with _emphasis_.]

שלום עולם, זו פסקה בעברית עם **הדגשה** ו-English words.

## Changes

Text with {++an insertion++} and {--a deletion--} and {~~old~>new~~} words.

A {==commented phrase==}{>>Ada: A note on it<<} here, and {>>Ada: a quiet remark<<} there.

### Lists

- one
- two
\t- two point one
\t- two point two
- three

1. first
2. second

| Name | שם |
| --- | --- |
| Moshe | משה |
| Aaron | אהרן |

![A picture](_media/${name})

> A quote.

---

\`\`\`
code line 1
  code line 2
\`\`\`

%%A comment block%%
`);
  // and Moshe reads it as the same document: headings, lists, the table, the footnote
  const again = buildDoc([{ body: r.text }], { revision: true });
  const first = buildDoc([{ body: SAMPLE.replace('_media/pic.png', `_media/${name}`) }], { revision: true });
  assert.deepEqual(again.headings.map((h) => [h.level, h.text]), first.headings.map((h) => [h.level, h.text]));
  assert.deepEqual(again.blocks.map((b) => b.type), first.blocks.map((b) => b.type));
  assert.equal(again.footnotes.length, 1);
  const table = again.blocks.find((b) => b.type === 'table');
  assert.deepEqual(table.rows.map((row) => row.map((c) => c[0].text)), [['Moshe', 'משה'], ['Aaron', 'אהרן']]);
  const list = again.blocks.find((b) => b.type === 'list');
  assert.deepEqual(list.items.map((it) => it.children[0].text), ['one', 'two', 'three']);
  assert.equal(list.items[1].lists.length, 1);
});

test('import: an ordinary export (marks settled) reads back without them; images can be left out', async () => {
  const docx = exportSheets([{ body: SAMPLE }], { format: 'docx', images: { '_media/pic.png': { bytes: png1(), type: 'image/png' } } });
  const r = await docxToMarkdown(docx.bytes, { images: false });
  assert.ok(r.text.includes('Text with an insertion and and new words.'));
  assert.ok(!r.text.includes('{++') && !r.text.includes('{>>'));
  assert.ok(r.text.includes('A commented phrase here, and there.'));
  assert.deepEqual(r.images, []);
  assert.deepEqual(r.warnings, ['a picture was left out']);
  assert.ok(!r.text.includes('!['));
});

// ---- a DOCX made by hand ----------------------------------------------------------------

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NS = `xmlns:w="${W_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" `
  + 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
  + 'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" '
  + 'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"';
const p = (inner, pPr = '') => `<w:p w14:paraId="1A2B3C4D" w:rsidR="00AB12CD">${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${inner}</w:p>`;
const r = (text, rPr = '') => `<w:r>${rPr ? `<w:rPr><w:rFonts w:ascii="Arial"/>${rPr}<w:sz w:val="24"/></w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const li = (text, ilvl) => p(r(text), `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="3"/></w:numPr>`);

const HAND_DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS}><w:body>
<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/></w:docPartObj></w:sdtPr><w:sdtContent>
${p(r('Contents'), '<w:pStyle w:val="TOCHeading"/>')}${p(r('Chapter One\t1'), '<w:pStyle w:val="TOC1"/>')}</w:sdtContent></w:sdt>
${p(r('Chapter One'), '<w:pStyle w:val="ChapterTitle"/>')}
${p(r('A localised heading'), '<w:pStyle w:val="Kop2"/>')}
${p(r('Outline level three'), '<w:outlineLvl w:val="2"/>')}
${p(`${r('The ')}<w:del w:id="11" w:author="Rivka"><w:r><w:delText>old</w:delText></w:r></w:del><w:ins w:id="12" w:author="Rivka"><w:r><w:t>new</w:t></w:r></w:ins>${r(' word, ')}<w:ins w:id="13" w:author="Rivka">${r('added')}</w:ins>${r(' and ')}<w:del w:id="14" w:author="Rivka"><w:r><w:delText>gone</w:delText></w:r></w:del>${r('.')}`)}
${p(`${r('Before ')}<w:commentRangeStart w:id="0"/><w:commentRangeStart w:id="2"/>${r('the ')}${r('bold', '<w:b/>')}${r(' part')}<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r><w:commentRangeEnd w:id="2"/><w:r><w:commentReference w:id="2"/></w:r>${r(' after.')}<w:r><w:commentReference w:id="1"/></w:r>`)}
${p(`${r('An endnote')}<w:r><w:rPr><w:rStyle w:val="EndnoteReference"/></w:rPr><w:endnoteReference w:id="1"/></w:r>${r(' and a ')}<w:hyperlink r:id="rIdLink"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>linked site</w:t></w:r></w:hyperlink>${r('.')}`)}
${li('Fruit', 0)}${li('Apple', 1)}${li('Pear', 1)}${li('Green', 2)}${li('Veg', 0)}${li('Leek', 1)}
${p(`<w:r><w:t>one</w:t><w:tab/><w:t>two</w:t><w:br/><w:t>three</w:t></w:r>`)}
${p(`${r('Page ')}<w:fldSimple w:instr=" PAGE "><w:r><w:t>7</w:t></w:r></w:fldSimple>${r(', ')}<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> HYPERLINK "https://moshe.example/" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${r('the site')}<w:r><w:fldChar w:fldCharType="end"/></w:r>${r(', ')}<w:smartTag w:uri="urn:x" w:element="place">${r('Jerusalem')}</w:smartTag>${r(', ')}<w:sdt><w:sdtPr/><w:sdtContent>${r('controlled')}</w:sdtContent></w:sdt><w:sdt><w:sdtPr><w:showingPlcHdr/></w:sdtPr><w:sdtContent>${r('Click here to enter text.')}</w:sdtContent></w:sdt>${r('secret', '<w:vanish/>')}${r(' and ')}${r('strong', '<w:rStyle w:val="Strong"/>')}${r(' and ')}${r('both', '<w:b/><w:i/>')}${r(' and ')}${r('under', '<w:u w:val="single"/>')}${r(' and ')}${r('hi', '<w:highlight w:val="yellow"/>')}${r(' and ')}${r('gone', '<w:strike/>')}${r(' and ')}${r('code()', '<w:rStyle w:val="HTMLCode"/>')}${r('.')}`)}
${p(`${r('Merged: ')}${r('bo', '<w:b/>')}${r('ld', '<w:b/>')}${r(' ', '<w:b/>')}${r('text', '<w:b/>')}${r(' then ')}${r('it', '<w:i/>')}${r('al', '<w:i/>')}${r('ic', '<w:i/>')}${r('s mid', '')}${r('word', '<w:i/>')}${r('.')}`)}
${p(r('Stars a*b*c and 2 * 3 and snake_case_name, 50% and 100%, a == b, x==y==z, {++not++}, see [x](y) and ^[no].'))}
${p(r('# not a heading'))}${p(r('#1 is fine'))}${p(r('1. not a list'))}${p(r('- not a bullet'))}${p(r('&gt; not a quote'))}${p(r('(toc)'))}${p(r('%%not a comment%%'))}${p(r('Name: ______________'))}
${p(`<w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">שלום </w:t></w:r><w:r><w:rPr><w:bCs/><w:rtl/></w:rPr><w:t>עולם</w:t></w:r><w:r><w:rPr><w:b/><w:bCs w:val="0"/><w:rtl/></w:rPr><w:t xml:space="preserve"> סוף</w:t></w:r>`, '<w:bidi/>')}
<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr>
<w:tr><w:tc>${p(r('A', '<w:b/>'))}</w:tc><w:tc>${p(r('B', '<w:b/>'))}</w:tc><w:tc>${p(r('C|D', '<w:b/>'))}</w:tc></w:tr>
<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>${p(r('wide'))}</w:tc><w:tc>${p(r('c'))}${p(r('more'))}</w:tc></w:tr>
</w:tbl>
<w:tbl><w:tr><w:tc>${p(r('A boxed paragraph.'))}</w:tc></w:tr></w:tbl>
${p(`<w:r><w:drawing><wp:inline><wp:extent cx="100" cy="100"/><wp:docPr id="1" name="Picture 1" descr="A red dot"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rIdImg"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`)}
${p(`${r('Anchored')}<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor><wp:docPr id="2" name="Text Box 2"/><a:graphic><a:graphicData uri="x"><w:txbxContent>${p(r('Boxed text'))}</w:txbxContent></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict><w:txbxContent>${p(r('Boxed text'))}</w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent></w:r>`)}
<w:sectPr/></w:body></w:document>`;

const HAND_STYLES = `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="${W_NS}">
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Kop2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="ChapterTitle"><w:name w:val="Chapter Title"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/><w:basedOn w:val="Kop2"/><w:pPr><w:outlineLvl w:val="9"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/></w:style>
<w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/><w:rPr><w:b/><w:bCs/></w:rPr></w:style>
<w:style w:type="character" w:styleId="HTMLCode"><w:name w:val="HTML Code"/><w:rPr><w:rFonts w:ascii="Courier New"/></w:rPr></w:style>
</w:styles>`;

const HAND_NUMBERING = `<?xml version="1.0" encoding="UTF-8"?><w:numbering xmlns:w="${W_NS}">
<w:abstractNum w:abstractNumId="7"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl><w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
<w:num w:numId="3"><w:abstractNumId w:val="7"/></w:num>
</w:numbering>`;

const HAND_COMMENTS = `<?xml version="1.0" encoding="UTF-8"?><w:comments xmlns:w="${W_NS}">
<w:comment w:id="0" w:author="Rivka" w:initials="R"><w:p><w:r><w:annotationRef/></w:r><w:r><w:t>Why </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>this</w:t></w:r><w:r><w:t>?</w:t></w:r></w:p></w:comment>
<w:comment w:id="1" w:author="Rivka"><w:p><w:r><w:t>A remark on nothing.</w:t></w:r></w:p></w:comment>
<w:comment w:id="2" w:author="Dan"><w:p><w:r><w:t>Because.</w:t></w:r></w:p></w:comment>
</w:comments>`;

const HAND_ENDNOTES = `<?xml version="1.0" encoding="UTF-8"?><w:endnotes xmlns:w="${W_NS}">
<w:endnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:endnote>
<w:endnote w:id="1"><w:p><w:r><w:rPr><w:rStyle w:val="EndnoteReference"/></w:rPr><w:endnoteRef/></w:r><w:r><w:t xml:space="preserve"> The endnote, </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>in italics</w:t></w:r><w:r><w:t>.</w:t></w:r></w:p></w:endnote>
</w:endnotes>`;

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const HAND_RELS = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="${REL}/numbering" Target="numbering.xml"/>
<Relationship Id="rId3" Type="${REL}/comments" Target="comments.xml"/>
<Relationship Id="rId4" Type="${REL}/endnotes" Target="/word/endnotes.xml"/>
<Relationship Id="rIdLink" Type="${REL}/hyperlink" Target="https://example.org/x_(y)" TargetMode="External"/>
<Relationship Id="rIdImg" Type="${REL}/image" Target="media/dot.png"/>
</Relationships>`;

/** The hand-made DOCX: its document and styles deflated (by default), or all of it stored by createZip. */
async function handDocx({ stored = false } = {}) {
  const parts = [
    { name: '[Content_Types].xml', data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
    { name: '_rels/.rels', data: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: 'word/document.xml', data: HAND_DOCUMENT, deflate: true },
    { name: 'word/_rels/document.xml.rels', data: HAND_RELS },
    { name: 'word/styles.xml', data: HAND_STYLES, deflate: true },
    { name: 'word/numbering.xml', data: HAND_NUMBERING },
    { name: 'word/comments.xml', data: HAND_COMMENTS },
    { name: 'word/endnotes.xml', data: HAND_ENDNOTES },
    { name: 'word/media/dot.png', data: png1() },
    { name: 'docProps/core.xml', data: '<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Core title</dc:title></cp:coreProperties>' },
  ];
  return stored ? createZip(parts.map(({ name, data }) => ({ name, data }))) : makeZip(parts);
}

test('import: a DOCX made by hand — styles by name and outline level, changes, comments, notes, lists, fields', async () => {
  const bytes = await handDocx();
  const res = await readDocx(bytes);
  assert.equal(res.unresolved, 0);
  assert.equal((await readDocx(await handDocx({ stored: true }))).text, res.text);
  assert.equal(res.title, 'Chapter One');
  assert.deepEqual(res.images.map((i) => [i.name, i.type]), [['dot.png', 'image/png']]);
  assert.deepEqual(res.warnings, ['a text box was placed after the paragraph it is anchored in']);
  assert.equal(res.text, `(toc)

# Chapter One

## A localised heading

### Outline level three

The {~~old~>new~~} word, {++added++} and {--gone--}.

Before {==the **bold** part==}{>>Rivka: Why _this_?<<}{>>Dan: Because.<<} after.{>>Rivka: A remark on nothing.<<}

An endnote^[The endnote, _in italics_.] and a [linked site](https://example.org/x_%28y%29).

- Fruit
\t1. Apple
\t2. Pear
\t\t- Green
- Veg
\t1. Leek

one two
three

Page 7, [the site](https://moshe.example/), Jerusalem, controlled and **strong** and **_both_** and under and ==hi== and ~~gone~~ and \`code()\`.

Merged: **bold text** then *italic*s mid*word*.

Stars a\\*b*c and 2 * 3 and snake_case_name, 50% and 100%, a == b, x\\==y==z, \\{++not++}, see \\[x](y) and \\^[no].

\\# not a heading

#1 is fine

1\\. not a list

\\- not a bullet

\\> not a quote

\\(toc)

\\%%not a comment\\%%

Name: \\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_

שלום **עולם** סוף

| A | B | C\\|D |
| --- | --- | --- |
| wide | | c more |

A boxed paragraph.

![A red dot](_media/dot.png)

Anchored

Boxed text
`);
  // every line reads in Moshe as it was meant: no literal character taken for markup
  for (const line of res.text.split('\n')) {
    if (/^(Stars|\\#|#1|1\\\.|\\-|\\>|\\\(|\\%|Name)/u.test(line)) assert.equal(parseLines(line)[0].type, 'paragraph', line);
  }
  const back = readBack(res.text.split('\n').find((l) => l.startsWith('Stars')));
  assert.equal(back.chars.map((c) => c[0]).join(''), 'Stars a*b*c and 2 * 3 and snake_case_name, 50% and 100%, a == b, x==y==z, {++not++}, see [x](y) and ^[no].');
  assert.ok(back.chars.every((c) => c[1] === 0));
  // the core properties' title, when there is no heading
  const noHeading = HAND_DOCUMENT.replace(/<w:pStyle w:val="(ChapterTitle|Kop2)"\/>/gu, '').replace('<w:outlineLvl w:val="2"/>', '');
  const z = await makeZip([
    { name: 'word/document.xml', data: noHeading },
    { name: 'word/_rels/document.xml.rels', data: HAND_RELS },
    { name: 'word/media/dot.png', data: png1() },
    { name: 'docProps/core.xml', data: '<?xml version="1.0"?><cp:coreProperties xmlns:cp="x" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Core title</dc:title></cp:coreProperties>' },
  ]);
  const nh = await docxToMarkdown(z);
  assert.equal(nh.title, 'Core title');
  assert.ok(nh.text.includes('\nChapter One\n'));
  // missing comments, endnotes and numbering parts: the text still comes
  assert.ok(nh.text.includes('Before the **bold** part after.'));
  assert.ok(nh.text.includes('An endnote and a [linked site]'));
});

test('import: importFile takes a DOCX, and refuses what it cannot read with a plain message', async () => {
  const r = await importFile('Letter.docx', await handDocx());
  assert.equal(r.title, 'Chapter One');
  assert.ok(r.text.endsWith('Boxed text\n'));
  await assert.rejects(importFile('Old.doc', new Uint8Array([0xD0, 0xCF, 0x11, 0xE0])), /\.doc\).*save it as \.docx/u);
  await assert.rejects(importFile('Fake.docx', new Uint8Array([0xD0, 0xCF, 0x11, 0xE0, 0, 0])), /older Word document|password/u);
  await assert.rejects(importFile('Fake.docx', enc.encode('hello, not a zip')), /not a Word/u);
  await assert.rejects(importFile('Empty.docx', createZip([{ name: 'hello.txt', data: 'hi' }])), /no Word document inside/u);
  await assert.rejects(importFile('photo.png', new Uint8Array(4)), /\.png files cannot be imported\. Moshe imports Word/u);
  await assert.rejects(importFile('README', new Uint8Array(4)), /without an extension/u);
});

// ---- the ZIP reader ------------------------------------------------------------------

test('unzip: stored and deflated entries, ZIP64, names in UTF-8, a filter', async () => {
  const big = enc.encode('שלום, '.repeat(2000));
  const z = await makeZip([{ name: 'a.txt', data: 'hello' }, { name: 'dir/ב.txt', data: big, deflate: true }]);
  const m = await unzip(z);
  assert.deepEqual([...m.keys()], ['a.txt', 'dir/ב.txt']);
  assert.equal(new TextDecoder().decode(m.get('a.txt')), 'hello');
  assert.deepEqual(m.get('dir/ב.txt'), big);
  const only = await unzip(z, { filter: (n) => n.endsWith('a.txt') });
  assert.deepEqual([...only.keys()], ['a.txt']);
  const z64 = await makeZip([{ name: 'x.txt', data: 'sixty-four' }, { name: 'y.txt', data: big, deflate: true }], { zip64: true });
  const m64 = await unzip(z64);
  assert.equal(new TextDecoder().decode(m64.get('x.txt')), 'sixty-four');
  assert.deepEqual(m64.get('y.txt'), big);
  // what createZip writes (folders left out)
  const c = await unzip(createZip([{ name: 'f/' }, { name: 'f/g.txt', data: 'g' }]));
  assert.deepEqual([...c.keys()], ['f/g.txt']);
});

test('unzip: a damaged archive is caught — CRC-32, bad DEFLATE data, cut short, not a ZIP', async () => {
  const z = createZip([{ name: 'a.txt', data: 'hello world' }]);
  const bad = z.slice();
  bad[30 + 'a.txt'.length + 2] ^= 0x20;           // a letter of the stored text
  await assert.rejects(unzip(bad), (e) => e instanceof ZipError && /a\.txt fails its CRC-32 check/u.test(e.message));
  const d = await makeZip([{ name: 'b.txt', data: 'compressible '.repeat(200), deflate: true }]);
  const badD = d.slice();
  badD[30 + 'b.txt'.length + 3] ^= 0xFF;          // inside the compressed data
  await assert.rejects(unzip(badD), (e) => e instanceof ZipError && /b\.txt (could not be decompressed|fails its CRC-32|is (larger|shorter))/u.test(e.message));
  await assert.rejects(unzip(z.slice(0, 20)), /not a ZIP archive/u);
  await assert.rejects(unzip(enc.encode('x'.repeat(100))), /not a ZIP archive/u);
  // a directory that points past the end
  const shifted = z.slice();
  const v = new DataView(shifted.buffer);
  v.setUint32(shifted.length - 22 + 16, 3, true);
  await assert.rejects(unzip(shifted), ZipError);
});

// ---- the writer ---------------------------------------------------------------------

/** A small seeded random, so a failure can be run again. */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

test('writer: literal text with every kind of markup character reads back exactly, escaped only where it must be', () => {
  const rand = rng(42);
  const alphabet = ['a', 'b', 'א', ' ', ' ', '*', '_', '=', '~', '^', '[', ']', '(', ')', '{', '}', '+', '-', '>', '<', '%', '#', '`', '$', '!', '\\', '|', '1', '.', ':'];
  const w = new MarkupWriter();
  for (let k = 0; k < 600; k++) {
    let s = '';
    const n = 1 + Math.floor(rand() * 14);
    for (let j = 0; j < n; j++) s += alphabet[Math.floor(rand() * alphabet.length)];
    if (!s.trim()) continue;
    const line = w.line(w.inline([{ k: 't', s, f: 0 }]));
    const back = readBack(line);
    if (back.type === 'divider') continue;       // "* * *" is a scene break in Moshe too
    assert.equal(back.chars.map((c) => c[0]).join(''), s.trim(), `${JSON.stringify(s)} → ${JSON.stringify(line)}`);
    assert.ok(back.chars.every((c) => c[1] === 0), `${JSON.stringify(s)} → ${JSON.stringify(line)}: formatted`);
  }
  assert.equal(w.unresolved, 0);
  // ordinary prose is left alone
  for (const s of ['It was 5 * 3, or 50% of it — snake_case and a_b.', 'He said: "wait" (twice) - then #2.', 'שלום, עולם! זה 100% נכון.']) {
    assert.equal(w.line(w.inline([{ k: 't', s, f: 0 }])), s);
  }
});

test('writer: formatted runs read back with the same formatting, joined and with spaces outside the marks', () => {
  const rand = rng(7);
  const words = ['word', 'שלום', ' ', ' ', 'a*b', 'x_y', '==', '!', 'end.', '(p)', '1.', '#'];
  const flagSets = [0, 0, B, I, B | I, S, H, C, B | H];
  const w = new MarkupWriter();
  let given = 0;         // lines where an emphasis had to be given up (its text kept)
  for (let k = 0; k < 400; k++) {
    const items = [];
    const n = 1 + Math.floor(rand() * 6);
    for (let j = 0; j < n; j++) items.push({ k: 't', s: words[Math.floor(rand() * words.length)], f: flagSets[Math.floor(rand() * flagSets.length)] });
    const want = [];
    for (const it of items) for (const ch of it.s) want.push([ch, it.f]);
    while (want.length && /\s/u.test(want[0][0])) want.shift();
    while (want.length && /\s/u.test(want[want.length - 1][0])) want.pop();
    if (!want.length) continue;
    const before = w.dropped;
    const line = w.line(w.inline(items));
    const back = readBack(line);
    if (back.type !== 'paragraph') continue;
    assert.equal(back.chars.map((c) => c[0]).join(''), want.map((c) => c[0]).join(''), JSON.stringify(items) + ' → ' + line);
    if (w.dropped > before) { given++; continue; }
    // a space's formatting may differ (it is moved out of the marks), and so may a highlight's
    // closing "=" or a strike's "~" (left outside it); every other character's may not
    back.chars.forEach(([ch, f], i) => {
      const loose = ch === '=' ? H : ch === '~' ? S : 0;
      if (!/\s/u.test(ch)) assert.equal(f & ~loose, want[i][1] & ~loose, `${JSON.stringify(items)} → ${line}: ${ch} at ${i}`);
    });
  }
  assert.equal(w.unresolved, 0);
  assert.ok(given < 8, `${given} lines gave up an emphasis`);
  assert.equal(w.line(w.inline([{ k: 't', s: 'a ', f: B }, { k: 't', s: 'b', f: B }])), '**a b**');
  assert.equal(w.line(w.inline([{ k: 't', s: 'bold ', f: B }, { k: 't', s: 'both', f: B | I }, { k: 't', s: ' bold', f: B }])), '**bold _both_ bold**');
  assert.equal(w.line(w.inline([{ k: 't', s: 'un', f: 0 }, { k: 't', s: 'believ', f: I }, { k: 't', s: 'able', f: 0 }])), 'un*believ*able');
  assert.equal(w.line(w.inline([{ k: 't', s: 'see ', f: 0 }, { k: 't', s: 'https://x.org/a', f: 0, link: 'https://x.org/a' }, { k: 't', s: ' now', f: 0 }])), 'see https://x.org/a now');
  assert.equal(w.line(w.inline([{ k: 't', s: 'see ', f: 0 }, { k: 't', s: 'https://x.org/a', f: 0, link: 'https://x.org/a' }, { k: 't', s: '.', f: 0 }, { k: 't', s: 'b', f: 0, ch: 'del' }])),
    'see [https://x.org/a](https://x.org/a).{--b--}');
  // CriticMarkup holds none of its own kind: a deleted footnote's deleted text, a comment in a comment
  assert.equal(w.line(w.inline([{ k: 't', s: 'gone', f: 0, ch: 'del' }, { k: 'fn', ch: 'del', items: [{ k: 't', s: 'its note', f: 0, ch: 'del' }] }, { k: 't', s: ' too', f: 0, ch: 'del' }])),
    '{--gone^[its note] too--}');
  assert.equal(w.line(w.inline([{ k: 't', s: 'new', f: 0, ch: 'ins' }, { k: 'fn', ch: 'ins', items: [{ k: 't', s: 'x', f: 0, ch: 'del' }, { k: 't', s: 'y', f: 0, ch: 'ins' }] }])),
    '{++new^[{--x--}y]++}');
  // a mirrored bracket in a Hebrew footnote; an address in the text straight before a comment
  assert.equal(w.line(w.inline([{ k: 't', s: 'טקסט', f: 0 }, { k: 'fn', items: [{ k: 't', s: 'ראו ]שם[ ובעמ׳ 3]', f: 0 }] }])), 'טקסט^[ראו \\]שם[ ובעמ׳ 3]]');
  assert.equal(w.line(w.inline([{ k: 't', s: 'See https://x.org/a.', f: 0 }, { k: 't', s: 'b', f: 0, ch: 'ins' }])), 'See [https://x.org/a](https://x.org/a).{++b++}');
  assert.equal(w.line(w.inline([{ k: 't', s: 'See https://x.org/', f: 0 }, { k: 't', s: 'a.', f: 0, link: null, cm: null, ch: null, extra: 1 }, { k: 't', s: 'b', f: 0, ch: 'del' }])), 'See [https://x.org/a](https://x.org/a).{--b--}');
  // a footnote inside bold text whose own text has bold
  assert.equal(w.line(w.inline([{ k: 't', s: 'Bold', f: B }, { k: 'fn', items: [{ k: 't', s: 'see ', f: 0 }, { k: 't', s: 'this', f: B }] }, { k: 't', s: ' more', f: B }])), '**Bold**^[see **this**] **more**');
  const cw = new MarkupWriter({ comments: new Map([['a', { author: 'A', items: [{ k: 't', s: 'outer', f: 0 }], extras: [] }], ['b', { author: 'B', items: [{ k: 't', s: 'inner', f: 0 }], extras: [] }]]) });
  assert.equal(cw.line(cw.inline([{ k: 't', s: 'text', f: 0, cm: 'a' }, { k: 'fn', cm: 'a', items: [{ k: 't', s: 'note', f: 0, cm: 'b' }] }])),
    '{==text^[note{>>B: inner<<}]==}{>>A: outer<<}');
});

// ---- other formats -------------------------------------------------------------------

test('import: a TextPack from Moshe\'s exporter comes back with its pictures in _media and its footnotes inline', async () => {
  const body = '# Bundle\n\nText with a note.^[The note.] And ![a b](_media/a b.png) and ![](_media/c.png).\n\n- item\n';
  const tp = exportSheets([{ body }], { format: 'textbundle', images: { '_media/a b.png': { bytes: png1(), type: 'image/png' }, '_media/c.png': { bytes: png1(), type: 'image/png' } } });
  const r = await importFile('Bundle.textpack', tp.bytes);
  assert.equal(r.title, 'Bundle');
  assert.equal(r.text, '# Bundle\n\nText with a note.^[The note.] And ![a b](_media/a%20b.png) and ![](_media/c.png).\n\n- item\n');
  assert.deepEqual(r.images.map((i) => [i.name, i.type]), [['a b.png', 'image/png'], ['c.png', 'image/png']]);
  // a bundle zipped at its root, text.markdown, a picture in a folder
  const z = createZip([{ name: 'info.json', data: '{}' }, { name: 'text.markdown', data: 'Hi ![](assets/sub/p.png)\r\n' }, { name: 'assets/sub/p.png', data: png1() }]);
  const r2 = await importFile('x.textbundle', z);
  assert.equal(r2.text, 'Hi ![](_media/sub-p.png)\n');
  assert.deepEqual(r2.images.map((i) => i.name), ['sub-p.png']);
  await assert.rejects(importFile('x.textpack', createZip([{ name: 'readme.txt', data: 'x' }])), /no text\.md/u);
});

test('import: HTML — headings, emphasis, links, lists, quotes, code, tables, pictures, and what is not text skipped', async () => {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Page title</title><style>p { color: red }</style>
<script>document.write("<p>not this</p>")</script></head><body>
<h1>Hello &amp; welcome</h1>
<p>Some <b>bold</b>, <em>italic</em>, <s>struck</s> and <a href="https://x.org/a?b=1&amp;c=2">a link</a>.<br>Next line
   with    spaces.
<p>Second, with <code>code()</code>, <mark>marked</mark>, 5*3*2 and &lt;tags&gt;&nbsp;here.
<ul><li>one<li>two<ul><li>two.a</ul><li>three</ul>
<ol start="3"><li>c</li><li>d</li></ol>
<blockquote><p>Quoted.</p><p>Again.</p></blockquote>
<pre>line 1
  line 2 &lt;x&gt;</pre>
<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2 | 3</td></tr></tbody></table>
<p><img src="data:image/png;base64,iVBORw0KGgo=" alt="dot"> and <img src="https://e.com/p.jpg"></p>
<b style="font-weight:normal" id="docs-internal-guid-1"><p><span style="font-weight:700">Docs bold</span> plain <span style="font-style:italic">slanted</span></p></b>
<div style="display:none">hidden</div><!-- a comment --><hr>
<p dir="rtl">שלום <strong>עולם</strong></p>
</body></html>`;
  const r = await importFile('page.html', enc.encode(html));
  assert.equal(r.title, 'Hello & welcome');
  assert.equal(r.text, `# Hello & welcome

Some **bold**, _italic_, ~~struck~~ and [a link](https://x.org/a?b=1&c=2).
Next line with spaces.

Second, with \`code()\`, ==marked==, 5\\*3*2 and <tags> here.

- one
- two
\t- two.a
- three

3. c
4. d

> Quoted.
> Again.

\`\`\`
line 1
  line 2 <x>
\`\`\`

| A | B |
| --- | --- |
| 1 | 2 \\| 3 |

![dot](_media/image1.png) and ![](https://e.com/p.jpg)

**Docs bold** plain _slanted_

---

שלום **עולם**
`);
  assert.deepEqual(r.images.map((i) => [i.name, i.type, i.bytes.length]), [['image1.png', 'image/png', 8]]);
  // no <h1>: the page's <title>; and a page in windows-1255 that says so
  assert.equal(htmlToMarkdown('<title>T &amp; U</title><p>x').title, 'T & U');
  const heb = new Uint8Array([...enc.encode('<meta charset="windows-1255"><p>'), 0xF9, 0xEC, 0xE5, 0xED]);
  assert.equal((await importFile('h.htm', heb)).text, 'שלום\n');
  // the tree forgives what HTML lets a writer leave out
  const { root } = parseHtml('<p>a<p>b<table><tr><td>1<td>2<tr><td>3</table>');
  assert.deepEqual(root.children.map((c) => c.tag), ['p', 'p', 'table']);
  assert.deepEqual(root.children[2].children.map((tr) => tr.children.map((td) => td.children[0].text)), [['1', '2'], ['3']]);
});

test('import: Markdown and plain text — line ends, byte order marks, reference footnotes, other code pages', async () => {
  const md = await importFile('Notes.md', enc.encode('﻿# Notes\r\n\r\nA claim[^1] and another[^long].\r\n\r\n```\r\nnot[^1]\r\n```\r\n\r\n[^1]: The first.\r\n[^long]: The second,\r\n    at length.\r\n'));
  assert.equal(md.title, 'Notes');
  assert.equal(md.text, '# Notes\n\nA claim^[The first.] and another^[The second, at length.].\n\n```\nnot[^1]\n```\n');
  assert.equal(inlineFootnotes('No notes [^x] here.\n'), 'No notes [^x] here.\n');
  const front = await importFile('f.markdown', enc.encode('---\nkeywords: [a]\n---\nFirst line\n'));
  assert.equal(front.title, 'First line');
  assert.equal(front.text, '---\nkeywords: [a]\n---\nFirst line\n');
  const txt = await importFile('plain.txt', enc.encode('Line one\r\nLine *two* [^1]\rLine three'));
  assert.equal(txt.text, 'Line one\nLine *two* [^1]\nLine three\n');
  assert.equal(txt.title, 'Line one');
  assert.deepEqual(txt.warnings, []);
  const heb = await importFile('h.txt', new Uint8Array([0xF9, 0xEC, 0xE5, 0xED, 0x20, 0xF2, 0xE5, 0xEC, 0xED]));
  assert.equal(heb.text, 'שלום עולם\n');
  assert.deepEqual(heb.warnings, ['it is not UTF-8, so it was read as Hebrew Windows text']);
  const u16 = new Uint8Array([0xFF, 0xFE, 0x41, 0x00, 0xD0, 0x05]);
  assert.equal(decodeText(u16).text, 'Aא');
  const empty = await importFile('Empty Note.txt', new Uint8Array(0));
  assert.deepEqual(empty, { title: 'Empty Note', text: '', images: [], warnings: [] });
});
