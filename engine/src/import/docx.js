// A Word document (.docx) read into Moshe's markup: the other half of
// ../export/docx.js, so a client's file can be brought in, edited and sent
// back. What Word has that Moshe has a word for comes across as that word:
// headings (by the style's id, its name in styles.xml, or an outline level),
// emphasis, highlights, links, footnotes and endnotes (inline ^[…]), lists,
// tables, pictures, and — what matters to an editor — tracked changes as
// CriticMarkup ({++…++}, {--…--}, {~~old~>new~~}) and comments as
// {==text==}{>>Author: comment<<}. Hebrew and mixed text is kept exactly:
// Moshe gives each paragraph its own direction, so w:bidi and w:rtl need no
// markup. Fields show their result (a table of contents becomes (toc));
// headers, footers, page layout and fonts are left behind.
//
// The runs are gathered here as blocks of items (./writer.js has their
// shape) and ./writer.js writes them as text.
import { unzip } from './unzip.js';
import { parseXml } from '../xml.js';
import { MarkupWriter, B, I, S, H, C, plainItems } from './writer.js';

/** @typedef {import('./writer.js').Item} Item @typedef {import('./writer.js').Block} Block */

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const V = 'urn:schemas-microsoft-com:vml';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const MATH = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const DC = 'http://purl.org/dc/elements/1.1/';
// Strict Open XML (Word's "Strict" save option) has its own names for the same things
const STRICT = {
  'http://purl.oclc.org/ooxml/wordprocessingml/main': W,
  'http://purl.oclc.org/ooxml/officeDocument/relationships': R,
  'http://purl.oclc.org/ooxml/drawingml/main': A,
  'http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing': WP,
  'http://purl.oclc.org/ooxml/officeDocument/math': MATH,
};

// style names, in the English Word writes for its own styles and in a few other
// languages (a style Word made in German is "Überschrift 1", its id "berschrift1")
const HEADING = /^(?:heading|berschrift|überschrift|titre|titolo|t[ií]tulo|kop|rubrik|overskrift|otsikko|nag[łl][óo]wek|nadpis|c[ií]msor|ba[şs]l[ıi]k|заголовок|כותרת|عنوان)\s*([1-9])$/iu;
const TITLE = /^(?:title|titel|titre|titolo|t[ií]tulo|tytu[łl]|название)$/iu;
const KINDS = [
  ['quote', /^(?:quote|intense ?quote|block ?text|block ?quot(?:e|ation)|quotations?|zitat|citation|cita)$/iu],
  ['code', /^(?:source ?code|html ?preformatted|preformatted ?text|code|code ?block)$/iu],
  ['comment', /^comment ?block$/iu],
  ['divider', /^divider$/iu],
  ['caption', /^caption$/iu],
  ['math', /^math ?block$/iu],
  ['toc', /^(?:toc|contents)\s*[1-9]$/iu],
];
const CODE_CHAR = /^(?:verbatim ?char|html ?code|html ?typewriter|html ?keyboard|source ?text|code ?char|inline ?code)$/iu;
const RTL_LETTER = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}]/u;
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp',
  webp: 'image/webp', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff', emf: 'image/emf', wmf: 'image/wmf', wdp: 'image/vnd.ms-photo' };

const attr = (el, name) => (el ? el.attrs[`{${W}}${name}`] ?? el.attrs[name] : undefined);
const kids = (el, name) => (el ? el.children.filter((c) => c.ns === W && c.name === name) : []);
const kid = (el, name) => (el ? el.children.find((c) => c.ns === W && c.name === name) || null : null);
const val = (el, name) => attr(kid(el, name), 'val');
/** An on/off value: on unless it says otherwise. */
const isOn = (v) => !(v === '0' || v === 'false' || v === 'off' || v === 'none');
/** A property that is on unless it says otherwise (<w:b/>, <w:b w:val="0"/>); undefined when absent. */
const onOff = (el) => (el ? isOn(attr(el, 'val')) : undefined);

// what a part is lightened of before it is parsed: formatting this reader never looks at (fonts,
// sizes, spacing, proofing marks, revision ids), which is half the elements of a long document,
// and VML's shape data, whose attributes can run to megabytes
const NOISE = new RegExp(`<w:(?:${['rFonts', 'sz', 'szCs', 'lang', 'color', 'kern', 'spacing', 'proofErr', 'lastRenderedPageBreak', 'noProof',
  'bookmarkStart', 'bookmarkEnd', 'ind', 'jc', 'position', 'w', 'u', 'caps', 'smallCaps', 'snapToGrid', 'widowControl', 'keepNext', 'keepLines',
  'contextualSpacing', 'autoSpaceDE', 'autoSpaceDN', 'adjustRightInd', 'textAlignment', 'shd', 'vertAlign', 'effect', 'fitText', 'em', 'emboss',
  'imprint', 'outline', 'shadow', 'webHidden', 'suppressAutoHyphens', 'wordWrap', 'overflowPunct', 'topLinePunct', 'kinsoku', 'cnfStyle', 'tblW',
  'tcW', 'gridCol', 'tblInd', 'tblLook', 'tblLayout', 'noWrap', 'vAlign', 'trHeight', 'cantSplit'].join('|')})(?=[\\s/])[^>]*/>`
  + '|\\s(?:w:rsid\\w*|w14:paraId|w14:textId|o:gfxdata)="[^"]*"|\\s[\\w:.-]+="[^"<]{8000,}"', 'gu');

/** Strict Open XML's names made the usual ones, so the rest reads one kind. */
function normalise(el) {
  if (STRICT[el.ns]) el.ns = STRICT[el.ns];
  for (const k of Object.keys(el.attrs)) {
    const m = /^\{([^}]*)\}(.*)$/u.exec(k);
    if (m && STRICT[m[1]]) { el.attrs[`{${STRICT[m[1]]}}${m[2]}`] = el.attrs[k]; delete el.attrs[k]; }
  }
  for (const c of el.children) normalise(c);
  return el;
}

/** A path inside the package from a part's folder and a relationship's target. */
function resolvePath(dir, target) {
  const parts = (target.startsWith('/') ? target.slice(1) : dir + target).split('/');
  const out = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return out.join('/');
}

// ---- styles and numbering ------------------------------------------------------------

/** The run properties that matter here, those that are set. */
function readRunProps(rPr) {
  const p = {};
  if (!rPr) return p;
  for (const c of rPr.children) {
    if (c.ns !== W) continue;
    switch (c.name) {
      case 'b': case 'bCs': case 'i': case 'iCs': case 'vanish': case 'rtl': case 'cs': p[c.name] = onOff(c); break;
      case 'strike': case 'dstrike': p.strike = (p.strike || false) || onOff(c); break;
      case 'highlight': p.highlight = onOff(c); break;
      case 'rStyle': p.rStyle = attr(c, 'val'); break;
      default: break;
    }
  }
  return p;
}

class Styles {
  constructor(root) {
    this.map = new Map();
    this.defaultPara = null;
    this.paraCache = new Map();
    this.charCache = new Map();
    for (const s of kids(root, 'style')) {
      const id = attr(s, 'styleId');
      if (!id) continue;
      const pPr = kid(s, 'pPr');
      const numPr = kid(pPr, 'numPr');
      const outline = val(pPr, 'outlineLvl');
      const st = {
        id, type: attr(s, 'type') || 'paragraph', name: val(s, 'name') || '', basedOn: val(s, 'basedOn'),
        outline: outline === undefined ? undefined : parseInt(outline, 10),
        numPr: numPr ? { numId: val(numPr, 'numId'), ilvl: val(numPr, 'ilvl') } : null,
        rp: readRunProps(kid(s, 'rPr')),
      };
      this.map.set(id, st);
      if (st.type === 'paragraph' && attr(s, 'default') !== undefined && isOn(attr(s, 'default'))) this.defaultPara = id;
    }
  }

  *chain(id) {
    const seen = new Set();
    let st = this.map.get(id);
    while (st && !seen.has(st.id) && seen.size < 30) {
      seen.add(st.id);
      yield st;
      st = st.basedOn ? this.map.get(st.basedOn) : null;
    }
  }

  /** What a paragraph style makes a paragraph: {kind, level, numPr}. */
  para(id) {
    if (this.paraCache.has(id)) return this.paraCache.get(id);
    let info = null;
    let numPr = null;
    for (const st of this.chain(id)) {
      if (!numPr && st.numPr) numPr = st.numPr;
      if (info) continue;
      const names = [st.id, st.name];
      if (names.some((n) => TITLE.test(n))) { info = { kind: 'heading', level: 1 }; continue; }
      const hm = names.map((n) => HEADING.exec(n)).find(Boolean);
      if (hm) { info = { kind: 'heading', level: Math.min(6, parseInt(hm[1], 10)) }; continue; }
      const k = KINDS.find(([, re]) => names.some((n) => re.test(n)));
      if (k) { info = { kind: k[0] }; continue; }
      if (st.outline !== undefined) info = st.outline < 9 ? { kind: 'heading', level: Math.min(6, st.outline + 1) } : { kind: 'para' };
    }
    const out = { ...(info || { kind: 'para' }), numPr };
    this.paraCache.set(id, out);
    return out;
  }

  /** A character style's properties, what it is based on filled in. */
  char(id) {
    if (this.charCache.has(id)) return this.charCache.get(id);
    const out = {};
    for (const st of this.chain(id)) {
      for (const [k, v] of Object.entries(st.rp)) if (out[k] === undefined && k !== 'rStyle') out[k] = v;
      if (out.code === undefined && (CODE_CHAR.test(st.id) || CODE_CHAR.test(st.name))) out.code = true;
    }
    this.charCache.set(id, out);
    return out;
  }
}

class Numbering {
  constructor(root, styles) {
    this.styles = styles;
    this.abstracts = new Map();
    this.nums = new Map();
    for (const a of kids(root, 'abstractNum')) {
      const levels = new Map();
      for (const l of kids(a, 'lvl')) levels.set(parseInt(attr(l, 'ilvl') || '0', 10), { fmt: val(l, 'numFmt') || 'decimal', start: parseInt(val(l, 'start') || '1', 10) });
      this.abstracts.set(attr(a, 'abstractNumId'), { levels, link: val(a, 'numStyleLink') });
    }
    for (const n of kids(root, 'num')) {
      const overrides = new Map();
      for (const o of kids(n, 'lvlOverride')) {
        const ilvl = parseInt(attr(o, 'ilvl') || '0', 10);
        const lvl = kid(o, 'lvl');
        const so = val(o, 'startOverride');
        overrides.set(ilvl, {
          start: so !== undefined ? parseInt(so, 10) : lvl && val(lvl, 'start') !== undefined ? parseInt(val(lvl, 'start'), 10) : undefined,
          fmt: lvl ? val(lvl, 'numFmt') : undefined,
        });
      }
      this.nums.set(attr(n, 'numId'), { abs: val(n, 'abstractNumId'), overrides });
    }
  }

  /** A list level: its format, where it starts, and the list it counts with. */
  level(numId, ilvl, depth = 0) {
    const num = this.nums.get(numId);
    if (!num || depth > 5) return null;
    let absId = num.abs;
    let abs = this.abstracts.get(absId);
    if (abs && !abs.levels.size && abs.link && this.styles) {
      // a list that takes its levels from a numbering style
      const st = this.styles.map.get(abs.link);
      const linked = st && st.numPr && st.numPr.numId !== numId ? this.nums.get(st.numPr.numId) : null;
      if (linked) { absId = linked.abs; abs = this.abstracts.get(absId); }
    }
    const lvl = abs && abs.levels.get(ilvl);
    const o = num.overrides.get(ilvl);
    if (!lvl && !o) return null;
    return { fmt: (o && o.fmt) || (lvl && lvl.fmt) || 'decimal', start: lvl ? lvl.start : 1, override: o ? o.start : undefined, key: `a${absId}` };
  }
}

// ---- the reader ------------------------------------------------------------------------

class DocxReader {
  constructor(files, opts) {
    this.files = files;
    this.lower = new Map([...files.keys()].map((k) => [k.toLowerCase(), k]));
    this.opts = opts;
    this.warnings = new Map();   // message → [how many times, the message for more than one]
    this.images = [];
    this.imageByPath = new Map();
    this.imageNames = new Set();
    this.counters = new Map();
    this.seenNum = new Set();
    // the walk's state: which part, open fields, open comments, text boxes waiting
    this.part = null;
    this.fields = [];
    this.outer = null;            // the comment whose range the text is in
    this.demoted = new Set();     // comments begun inside another's range (written after its note)
    this.started = new Set();     // comments whose range or mark has been met
    this.hasText = new Set();     // comments whose range holds something
    this.pending = [];
    this.tocHere = false;
    this.comments = new Map();
  }

  /** A warning, counted: `many` has {n} where the count goes. */
  warn(one, many = one) {
    const w = this.warnings.get(one);
    if (w) w[0]++;
    else this.warnings.set(one, [1, many]);
  }

  get(path) {
    return this.files.get(path) || this.files.get(this.lower.get(path.toLowerCase()) || '') || (() => {
      try { const d = decodeURIComponent(path); return d !== path ? this.get(d) : null; } catch { return null; }
    })();
  }

  /** A part's XML; one that is not the document itself is left out, with a warning, if it is broken. */
  xml(path, required = false) {
    const bytes = this.get(path);
    if (!bytes) return null;
    try {
      const root = parseXml(new TextDecoder().decode(bytes).replace(NOISE, ''));
      return STRICT[root.ns] ? normalise(root) : root;
    } catch (e) {
      if (required) throw new Error(`The document is damaged (${path}: ${e.message})`);
      this.warn(`${path} is damaged and was left out`);
      return null;
    }
  }

  /** A part's relationships: id → {type, target, external}. */
  rels(path) {
    const slash = path.lastIndexOf('/');
    const dir = path.slice(0, slash + 1);
    const root = this.xml(`${dir}_rels/${path.slice(slash + 1)}.rels`);
    const out = new Map();
    if (!root) return out;
    for (const r of root.children) {
      if (r.name !== 'Relationship') continue;
      const external = (r.attrs.TargetMode || '').toLowerCase() === 'external';
      const t = r.attrs.Target || '';
      out.set(r.attrs.Id, { type: r.attrs.Type || '', target: external ? t : resolvePath(dir, t), external });
    }
    return out;
  }

  /** The part a relationship of this type leads to, with its own relationships. */
  related(rels, type) {
    for (const r of rels.values()) {
      if (!r.external && r.type.endsWith(`/${type}`)) return { name: r.target, rels: this.rels(r.target), root: this.xml(r.target) };
    }
    return null;
  }

  read() {
    const pkg = this.rels('');
    let main = 'word/document.xml';
    for (const r of pkg.values()) if (r.type.endsWith('/officeDocument') && !r.external) main = r.target;
    const docRoot = this.xml(main, true);
    if (!docRoot || docRoot.ns !== W) throw new Error('This file has no Word document inside it: is it really a .docx?');
    const docRels = this.rels(main);
    const styles = this.related(docRels, 'styles');
    this.styles = new Styles(styles && styles.root);
    const numbering = this.related(docRels, 'numbering');
    this.numbering = new Numbering(numbering && numbering.root, this.styles);
    this.footnotesPart = this.related(docRels, 'footnotes');
    this.endnotesPart = this.related(docRels, 'endnotes');
    const notesOf = (part, tag) => new Map(part && part.root ? kids(part.root, tag).map((n) => [attr(n, 'id'), n]) : []);
    this.footnotes = notesOf(this.footnotesPart, 'footnote');
    this.endnotes = notesOf(this.endnotesPart, 'endnote');

    // comments first, so a range met in the text knows its comment
    const commentsPart = this.related(docRels, 'comments');
    if (commentsPart && commentsPart.root) {
      for (const c of kids(commentsPart.root, 'comment')) {
        const id = attr(c, 'id');
        const items = this.sub(commentsPart, () => flatten(this.blocksOfNew(c.children)));
        this.comments.set(id, { author: attr(c, 'author') || '', items, extras: [] });
      }
    }

    this.part = { name: main, rels: docRels };
    const body = kid(docRoot, 'body');
    const blocks = [];
    if (body) this.blocksOf(body.children, blocks);

    const writer = new MarkupWriter({ comments: this.comments, authors: this.opts.authors });
    let text = writer.blocks(blocks);
    text = text ? `${text}\n` : '';

    const firstHeading = blocks.find((b) => b.type === 'p' && b.kind === 'heading' && plainItems(b.items).trim());
    let title = firstHeading ? plainItems(firstHeading.items).replace(/\s+/gu, ' ').trim() : '';
    if (!title) {
      const core = this.xml('docProps/core.xml');
      const t = core && core.children.find((c) => c.ns === DC && c.name === 'title');
      title = t ? (t.text || '').trim() : '';
    }
    const warnings = [...this.warnings].map(([one, [n, many]]) => (n > 1 ? many.replace('{n}', String(n)) : one));
    return { title, text, images: this.images, warnings, unresolved: writer.unresolved, unresolvedLines: writer.unresolvedLines, dropped: writer.dropped };
  }

  /** Runs `fn` over another part (a footnote, a comment), with the walk's state its own. */
  sub(part, fn) {
    const saved = { part: this.part, fields: this.fields, outer: this.outer, demoted: this.demoted, pending: this.pending, tocHere: this.tocHere };
    this.part = { name: part.name, rels: part.rels };
    this.fields = [];
    this.outer = null;
    this.demoted = new Set();
    this.pending = [];
    this.tocHere = false;
    try { return fn(); } finally { Object.assign(this, saved); }
  }

  blocksOfNew(children) { const out = []; this.blocksOf(children, out); return out; }

  // ---- blocks ------------------------------------------------------------------

  /** @param {object[]} children @param {Block[]} out */
  blocksOf(children, out) {
    for (const el of children) {
      if (el.ns === MC && el.name === 'AlternateContent') {
        const choice = el.children.find((c) => c.name === 'Choice') || el.children.find((c) => c.name === 'Fallback');
        if (choice) this.blocksOf(choice.children, out);
        continue;
      }
      if (el.ns !== W) continue;
      switch (el.name) {
        case 'p': this.paragraph(el, out); break;
        case 'tbl': this.table(el, out); break;
        case 'sdt': this.sdtBlock(el, out); break;
        case 'customXml': case 'ins': case 'del': case 'moveTo': case 'moveFrom': this.blocksOf(el.children, out); break;
        case 'commentRangeStart': this.commentStart(el); break;
        case 'commentRangeEnd': {
          const items = [];
          this.commentEnd(el, items, {});
          if (items.length) out.push({ type: 'p', items });
          break;
        }
        case 'altChunk': this.warn('a part pasted in from another file (an altChunk) was left out', '{n} parts pasted in from other files (altChunks) were left out'); break;
        default: break;
      }
    }
  }

  pushToc(out) {
    const last = out[out.length - 1];
    if (!last || last.type !== 'toc') out.push({ type: 'toc' });
  }

  sdtBlock(el, out) {
    const pr = kid(el, 'sdtPr');
    const part = kid(pr, 'docPartObj');
    if (part && /table of contents/iu.test(val(part, 'docPartGallery') || '')) { this.pushToc(out); return; }
    if (kid(pr, 'showingPlcHdr')) return;       // "Click or tap here to enter text."
    const content = kid(el, 'sdtContent');
    if (content) this.blocksOf(content.children, out);
  }

  /** What a paragraph's properties make it: {kind, level, list}. */
  paraInfo(pPr) {
    const styleId = val(pPr, 'pStyle') || this.styles.defaultPara;
    const st = styleId ? this.styles.para(styleId) : { kind: 'para', numPr: null };
    let { kind, level } = st;
    const outline = val(pPr, 'outlineLvl');
    if (outline !== undefined) {
      const o = parseInt(outline, 10);
      if (o < 9) { kind = 'heading'; level = Math.min(6, o + 1); } else if (kind === 'heading') kind = 'para';
    }
    let list = null;
    if (kind === 'para' || kind === 'quote') {
      const direct = kid(pPr, 'numPr');
      const numId = (direct && val(direct, 'numId')) ?? (st.numPr && st.numPr.numId);
      const ilvl = parseInt((direct && val(direct, 'ilvl')) ?? (st.numPr && st.numPr.ilvl) ?? '0', 10) || 0;
      if (numId !== undefined && numId !== null && numId !== '0') list = this.listItem(numId, Math.min(8, ilvl));
    }
    return { kind, level, list };
  }

  /** A list item's marker: counted as Word counts, deeper levels starting again under each item. */
  listItem(numId, ilvl) {
    const lv = this.numbering.level(numId, ilvl);
    if (!lv || lv.fmt === 'none') return null;
    const counts = this.counters.get(lv.key) || [];
    for (let k = ilvl + 1; k < 9; k++) counts[k] = undefined;
    const key = `${numId}:${ilvl}`;
    if (lv.override !== undefined && !this.seenNum.has(key)) counts[ilvl] = lv.override;
    else counts[ilvl] = counts[ilvl] === undefined ? lv.start : counts[ilvl] + 1;
    this.seenNum.add(key);
    this.counters.set(lv.key, counts);
    return { ordered: lv.fmt !== 'bullet', depth: ilvl, n: counts[ilvl] };
  }

  paragraph(p, out) {
    const pPr = kid(p, 'pPr');
    const info = this.paraInfo(pPr);
    /** @type {Item[]} */
    const items = [];
    this.inlineOf(p.children, items, {});
    const visible = items.some((it) => it.k !== 'br' && (it.k !== 't' || it.s.trim()));
    if (info.kind === 'toc') {
      // a contents entry outside a contents field (the field is the usual way)
      if (visible) this.pushToc(out);
    } else if (visible || info.kind === 'divider' || items.some((it) => it.k === 'note')) {
      out.push({ type: 'p', kind: info.kind, level: info.level, list: info.list, items });
    }
    if (this.tocHere) { this.tocHere = false; this.pushToc(out); }
    if (this.pending.length) { out.push(...this.pending); this.pending = []; }
  }

  table(tbl, out) {
    const rows = [];
    const rowsOf = (el) => el.children.flatMap((c) => (c.ns !== W ? [] : c.name === 'tr' ? [c]
      : c.name === 'sdt' ? rowsOf(kid(c, 'sdtContent') || { children: [] }) : c.name === 'customXml' ? rowsOf(c) : []));
    const cellsOf = (el) => el.children.flatMap((c) => (c.ns !== W ? [] : c.name === 'tc' ? [c]
      : c.name === 'sdt' ? cellsOf(kid(c, 'sdtContent') || { children: [] }) : c.name === 'customXml' ? cellsOf(c) : []));
    for (const tr of rowsOf(tbl)) {
      const cells = [];
      for (const tc of cellsOf(tr)) {
        const tcPr = kid(tc, 'tcPr');
        const span = parseInt(val(tcPr, 'gridSpan') || '1', 10) || 1;
        const vm = kid(tcPr, 'vMerge');
        const merged = vm && attr(vm, 'val') !== 'restart';
        cells.push(merged ? [] : this.blocksOfNew(tc.children));
        for (let k = 1; k < span; k++) cells.push([]);
      }
      if (cells.length) rows.push(cells);
    }
    if (!rows.length) return;
    // a table of one cell is a box drawn round some paragraphs, not a table
    if (rows.length === 1 && rows[0].length === 1) { out.push(...rows[0][0]); return; }
    out.push({ type: 'table', rows });
  }

  // ---- runs --------------------------------------------------------------------

  /** Whether text met now is shown: not a field's instruction, not inside a table of contents. */
  visible() { return this.fields.every((f) => f.phase === 'result' && !f.suppress); }

  fieldLink() {
    for (let k = this.fields.length - 1; k >= 0; k--) if (this.fields[k].link) return this.fields[k].link;
    return null;
  }

  /** Something is in the open comments' ranges. */
  touch() {
    if (this.outer !== null) this.hasText.add(this.outer);
    for (const id of this.demoted) this.hasText.add(id);
  }

  ctxOf(ctx) { return { link: ctx.link || this.fieldLink() || null, ch: ctx.ch || null, cm: this.outer }; }

  inlineOf(children, items, ctx) {
    for (const el of children) {
      if (el.ns === W) {
        switch (el.name) {
          case 'r': this.run(el, items, ctx); break;
          case 'hyperlink': {
            let link = ctx.link || null;
            const id = el.attrs[`{${R}}id`];
            const rel = id && this.part.rels.get(id);
            if (rel) link = rel.target;
            this.inlineOf(el.children, items, { ...ctx, link });
            break;
          }
          case 'ins': case 'moveTo': this.inlineOf(el.children, items, { ...ctx, ch: 'ins' }); break;
          case 'del': case 'moveFrom': this.inlineOf(el.children, items, { ...ctx, ch: 'del' }); break;
          case 'smartTag': case 'customXml': case 'dir': case 'bdo': this.inlineOf(el.children, items, ctx); break;
          case 'sdt': {
            if (kid(kid(el, 'sdtPr'), 'showingPlcHdr')) break;
            const content = kid(el, 'sdtContent');
            if (content) this.inlineOf(content.children, items, ctx);
            break;
          }
          case 'fldSimple': this.fieldSimple(el, items, ctx); break;
          case 'commentRangeStart': this.commentStart(el); break;
          case 'commentRangeEnd': this.commentEnd(el, items, ctx); break;
          default: break;
        }
      } else if (el.ns === MC && el.name === 'AlternateContent') {
        this.alternate(el, (c) => this.inlineOf(c, items, ctx), items);
      } else if (el.ns === MATH && (el.name === 'oMath' || el.name === 'oMathPara')) {
        this.math(el, items, ctx);
      }
    }
  }

  /** Markup compatibility: the choice Word made, or what it offers older readers if that gave nothing. */
  alternate(el, walk, items) {
    const choice = el.children.find((c) => c.name === 'Choice');
    const fallback = el.children.find((c) => c.name === 'Fallback');
    const before = items.length + this.pending.length;
    if (choice) walk(choice.children);
    if (fallback && items.length + this.pending.length === before) walk(fallback.children);
  }

  /** A run's formatting flags for some of its text. */
  flags(rp, text) {
    const st = rp.rStyle ? this.styles.char(rp.rStyle) : {};
    const pick = (k) => (rp[k] !== undefined ? rp[k] : st[k]);
    // Hebrew and Arabic take the complex-script bold and italic (w:bCs, w:iCs)
    const cs = pick('rtl') || pick('cs') || RTL_LETTER.test(text);
    const b = cs ? pick('bCs') ?? pick('b') : pick('b');
    const i = cs ? pick('iCs') ?? pick('i') : pick('i');
    return (b ? B : 0) | (i ? I : 0) | (pick('strike') ? S : 0) | (pick('highlight') ? H : 0) | (st.code ? C : 0);
  }

  run(r, items, ctx) {
    const rp = readRunProps(kid(r, 'rPr'));
    const hidden = rp.vanish !== undefined ? rp.vanish : rp.rStyle ? !!this.styles.char(rp.rStyle).vanish : false;
    let skipMark = false;     // a footnote's own mark (customMarkFollows) is not its text
    const text = (s) => {
      if (!s || hidden || !this.visible()) return;
      if (skipMark) { skipMark = false; return; }
      items.push({ k: 't', s, f: this.flags(rp, s), ...this.ctxOf(ctx) });
      if (s.trim()) this.touch();
    };
    for (const c of r.children) {
      if (c.ns === MC && c.name === 'AlternateContent') {
        this.alternate(c, (cs) => this.run({ ...r, children: [...(kid(r, 'rPr') ? [kid(r, 'rPr')] : []), ...cs] }, items, ctx), items);
        continue;
      }
      if (c.ns !== W) continue;
      switch (c.name) {
        case 't': case 'delText': text(c.text ?? ''); break;
        case 'instrText': case 'delInstrText': {
          const top = this.fields[this.fields.length - 1];
          if (top && top.phase === 'instr') top.instr += c.text ?? '';
          break;
        }
        case 'fldChar': this.fldChar(c); break;
        case 'tab': case 'ptab': text(' '); break;
        case 'br': case 'cr': if (!hidden && this.visible()) items.push({ k: 'br' }); break;
        case 'noBreakHyphen': text('‑'); break;
        case 'sym': {
          const code = parseInt(attr(c, 'char') || '', 16);
          if (code) text(String.fromCharCode(code));
          break;
        }
        case 'footnoteReference': case 'endnoteReference':
          if (!hidden) this.noteRef(c.name === 'footnoteReference' ? 'footnote' : 'endnote', c, items, ctx);
          if (attr(c, 'customMarkFollows') !== undefined && isOn(attr(c, 'customMarkFollows'))) skipMark = true;
          break;
        case 'commentReference': this.commentRef(c, items, ctx); break;
        case 'drawing': if (!hidden) this.drawing(c, items, ctx); break;
        case 'pict': case 'object': if (!hidden) this.vml(c, items, ctx); break;
        case 'ruby': {
          const base = kid(c, 'rubyBase');
          if (base) this.inlineOf(base.children, items, ctx);
          break;
        }
        default: break;
      }
    }
  }

  // ---- fields ------------------------------------------------------------------

  fldChar(c) {
    const type = attr(c, 'fldCharType');
    if (type === 'begin') this.fields.push({ instr: '', phase: 'instr' });
    else if (type === 'separate') {
      const top = this.fields[this.fields.length - 1];
      if (top && top.phase === 'instr') { top.phase = 'result'; this.fieldKind(top); }
    } else if (type === 'end') this.fields.pop();
  }

  /** What a field's instruction makes of its result: a table of contents is (toc), a hyperlink a link. */
  fieldKind(f) {
    const m = /^\s*([A-Za-z]+)\b(.*)$/su.exec(f.instr);
    if (!m) return;
    const kind = m[1].toUpperCase();
    if (kind === 'TOC') {
      // f is the innermost field: a contents inside another one's result, or inside a hidden part, is not shown
      if (this.fields.slice(0, -1).every((x) => x.phase === 'result' && !x.suppress)) this.tocHere = true;
      f.suppress = true;
    } else if (kind === 'HYPERLINK' && !/\\l\b/u.test(m[2])) {
      const q = /"([^"]*)"/u.exec(m[2]);
      const url = q ? q[1] : m[2].trim().split(/\s+/u)[0];
      if (url) f.link = url;
    }
  }

  fieldSimple(el, items, ctx) {
    const f = { instr: attr(el, 'instr') || '', phase: 'result' };
    this.fields.push(f);
    this.fieldKind(f);
    if (!f.suppress) this.inlineOf(el.children, items, ctx);
    this.fields.pop();
  }

  // ---- notes and comments ---------------------------------------------------------

  noteRef(kind, c, items, ctx) {
    if (!this.visible()) return;
    const part = kind === 'footnote' ? this.footnotesPart : this.endnotesPart;
    const el = (kind === 'footnote' ? this.footnotes : this.endnotes).get(attr(c, 'id'));
    if (!el || !part) return;
    const inner = this.sub(part, () => flatten(this.blocksOfNew(el.children)));
    if (!inner.some((it) => it.k !== 't' || it.s.trim())) return;
    items.push({ k: 'fn', items: inner, ...this.ctxOf(ctx) });
    this.touch();
  }

  commentStart(el) {
    const id = attr(el, 'id');
    if (!this.comments.has(id) || this.started.has(id)) return;
    this.started.add(id);
    if (this.outer === null) this.outer = id;
    else {
      // a comment begun inside another's range is written after that one's note
      this.demoted.add(id);
      const o = this.comments.get(this.outer);
      if (!o.extras.includes(id)) o.extras.push(id);
    }
  }

  commentEnd(el, items, ctx) {
    const id = attr(el, 'id');
    if (!this.comments.has(id)) return;
    if (!this.started.has(id)) {
      this.started.add(id);
      items.push({ k: 'note', id, link: null, ch: ctx.ch || null, cm: this.outer });
    } else if (id === this.outer) {
      this.outer = null;
      if (!this.hasText.has(id)) items.push({ k: 'note', id, link: null, ch: ctx.ch || null, cm: null });
    } else this.demoted.delete(id);
  }

  commentRef(c, items, ctx) {
    const id = attr(c, 'id');
    if (!this.comments.has(id) || this.started.has(id)) return;
    this.started.add(id);
    items.push({ k: 'note', id, link: null, ch: ctx.ch || null, cm: this.outer });
  }

  // ---- pictures, text boxes, equations ------------------------------------------------

  drawing(el, items, ctx) {
    if (!this.visible()) return;
    const found = { blips: [], boxes: [], chart: false, alt: '' };
    const scan = (n) => {
      for (const c of n.children) {
        if (c.ns === A && c.name === 'blip') found.blips.push(c.attrs[`{${R}}embed`] || c.attrs[`{${R}}link`]);
        else if (c.ns === W && c.name === 'txbxContent') found.boxes.push(c);
        else {
          if (c.ns === WP && c.name === 'docPr' && !found.alt) found.alt = c.attrs.descr || c.attrs.title || '';
          if (c.name === 'chart' || c.name === 'relIds') found.chart = true;
          scan(c);
        }
      }
    };
    scan(el);
    for (const rid of found.blips) if (rid) this.image(rid, found.alt, items, ctx);
    for (const box of found.boxes) this.textBox(box);
    if (!found.blips.length && !found.boxes.length && found.chart) this.warn('a chart or diagram was left out', '{n} charts or diagrams were left out');
  }

  vml(el, items, ctx) {
    if (!this.visible()) return;
    let alt = '';
    const rids = [], boxes = [];
    const scan = (n) => {
      for (const c of n.children) {
        if (c.ns === V && c.name === 'imagedata') rids.push(c.attrs[`{${R}}id`] || c.attrs[`{${R}}href`]);
        else if (c.ns === W && c.name === 'txbxContent') boxes.push(c);
        else { if (c.ns === V && c.attrs.alt && !alt) alt = c.attrs.alt; scan(c); }
      }
    };
    scan(el);
    for (const rid of rids) if (rid) this.image(rid, alt, items, ctx);
    for (const box of boxes) this.textBox(box);
  }

  /** A text box's paragraphs, which follow the paragraph it is anchored in. */
  textBox(box) {
    const saved = { fields: this.fields, tocHere: this.tocHere, pending: this.pending };
    this.fields = [];
    this.tocHere = false;
    this.pending = [];
    const blocks = this.blocksOfNew(box.children);
    const inner = this.pending;
    Object.assign(this, saved);
    if (blocks.length) {
      this.pending.push(...blocks, ...inner);
      this.warn('a text box was placed after the paragraph it is anchored in', '{n} text boxes were placed after the paragraphs they are anchored in');
    }
  }

  image(rid, alt, items, ctx) {
    const rel = this.part.rels.get(rid);
    if (!rel) return;
    if (this.opts.images === false) { this.warn('a picture was left out', '{n} pictures were left out'); return; }
    if (/Description automatically generated|automatisch generiert|générée automatiquement/iu.test(alt)) alt = '';
    if (rel.external) {
      items.push({ k: 'img', alt, src: rel.target, ...this.ctxOf(ctx) });
      this.touch();
      return;
    }
    let entry = this.imageByPath.get(rel.target);
    if (!entry) {
      const bytes = this.get(rel.target);
      if (!bytes) { this.warn('a picture is missing from the file', '{n} pictures are missing from the file'); return; }
      const file = rel.target.split('/').pop() || 'image';
      const ext = (/\.([^.]+)$/u.exec(file) || [])[1]?.toLowerCase() || '';
      let name = file.replace(/[^\p{L}\p{N}._ -]+/gu, '-');
      for (let k = 2; this.imageNames.has(name); k++) name = file.replace(/(\.[^.]*)?$/u, (e) => `-${k}${e || ''}`);
      this.imageNames.add(name);
      if (/^(emf|wmf|tiff?|wdp)$/u.test(ext)) this.warn('a picture is in a format browsers do not show (EMF, WMF or TIFF)', '{n} pictures are in a format browsers do not show (EMF, WMF or TIFF)');
      entry = { name, bytes, type: IMAGE_TYPES[ext] || 'application/octet-stream' };
      this.images.push(entry);
      this.imageByPath.set(rel.target, entry);
    }
    items.push({ k: 'img', alt, src: `_media/${encodeURI(entry.name)}`, ...this.ctxOf(ctx) });
    this.touch();
  }

  math(el, items, ctx) {
    if (!this.visible()) return;
    let t = '';
    const walk = (n) => { for (const c of n.children) { if (c.ns === MATH && c.name === 't') t += c.text || ''; else walk(c); } };
    walk(el);
    if (!t) return;
    items.push({ k: 't', s: t, f: 0, ...this.ctxOf(ctx) });
    this.touch();
    this.warn('an equation was brought in as plain text', '{n} equations were brought in as plain text');
  }
}

/** Blocks as one run of items, a space between paragraphs (a footnote's, a comment's, a cell's). */
function flatten(blocks) {
  const out = [];
  const add = (bs) => {
    for (const b of bs) {
      if (b.type === 'table') { for (const r of b.rows) for (const c of r) add(c); continue; }
      if (b.type !== 'p') continue;
      if (out.length) out.push({ k: 't', s: ' ', f: 0 });
      for (const it of b.items) out.push(it.k === 'br' ? { k: 't', s: ' ', f: 0, link: it.link, ch: it.ch, cm: it.cm } : it);
    }
  };
  add(blocks);
  return out;
}

/**
 * A Word document as Moshe's markup.
 * @param {Uint8Array|ArrayBuffer} input  the .docx file
 * @param {{images?: boolean, authors?: boolean}} [opts]
 *   images (default true): bring the pictures in (as _media/<name>, their bytes in `images`);
 *   authors (default true): begin each comment with its author's name
 * @returns {Promise<{title: string, text: string, images: {name: string, bytes: Uint8Array, type: string}[], warnings: string[]}>}
 *   title: the first heading's text, or the document's title in its properties ('' if neither)
 */
export async function docxToMarkdown(input, opts = {}) {
  const r = await readDocx(input, opts);
  return { title: r.title, text: r.text, images: r.images, warnings: r.warnings };
}

/** docxToMarkdown's work, with `unresolved`: the lines the writer could not settle (for tests; 0 is right). */
export async function readDocx(input, opts = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0) {
    throw new Error('This is an older Word document (.doc) or a password-protected one: open it in Word or Pages and save it as .docx, without a password');
  }
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4B) throw new Error('This is not a Word (.docx) document');
  const images = opts.images !== false;
  const files = await unzip(bytes, {
    filter: (n) => /\.(xml|rels)$/iu.test(n) || (images && !/^(word\/(embeddings|fonts)\/|docProps\/|customXml\/)/iu.test(n)),
  });
  return new DocxReader(files, { ...opts, images }).read();
}
