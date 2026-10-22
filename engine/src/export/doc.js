// The document an export is made from: the sheets being exported, read with
// the editor's own parser (../markup.js) and turned into blocks of inline
// runs that every exporter (HTML, DOCX, EPUB, Markdown, text) walks the same
// way. What the reader should not see is settled here, once, so the formats
// cannot disagree about it: comments, deletions and notes go, insertions and
// substitutions are accepted, and annotations keep their text, unless the
// export is a revision copy, which shows the writer's marks instead.
//
// A line is a paragraph, as in the editor: two lines in a row are
// two paragraphs, and a blank line is only space.
import { parseLines, parseInline } from '../markup.js';
import { splitSheet, readMeta, sheetTitle } from '../sheet.js';

/**
 * @typedef {{type: 'text', text: string}
 *   | {type: 'strong'|'em'|'mark'|'strike'|'delete'|'insert', children: Inline[]}
 *   | {type: 'code'|'math', text: string}
 *   | {type: 'link', url: string, title: string, children: Inline[]}
 *   | {type: 'image', src: string, alt: string, title: string}
 *   | {type: 'footnote', n: number}
 *   | {type: 'comment', text: string, id: number}
 *   | {type: 'annotation', children: Inline[], note: Inline[], display: 'margin'|'inline', id: number}} Inline
 *
 * @typedef {{children: Inline[], task?: 'open'|'done', rtl: boolean, lists: Block[]}} ListItem
 * @typedef {{level: number, text: string, id: string, n: number}} TocEntry
 *
 * @typedef {{type: 'heading', level: number, children: Inline[], id: string, n: number, text: string, rtl: boolean, sheet: number}
 *   | {type: 'paragraph', children: Inline[], rtl: boolean, sheet: number}
 *   | {type: 'list', ordered: boolean, start: number, items: ListItem[], sheet: number}
 *   | {type: 'quote', blocks: Block[], sheet: number}
 *   | {type: 'code', lang: string, text: string, sheet: number}
 *   | {type: 'math', text: string, sheet: number}
 *   | {type: 'divider', sheet: number}
 *   | {type: 'image', src: string, alt: string, title: string, rtl: boolean, sheet: number}
 *   | {type: 'table', align: (null|'left'|'center'|'right')[], head: Inline[][]|null, rows: Inline[][][], sheet: number}
 *   | {type: 'toc', levels: number[], entries: TocEntry[], sheet: number}
 *   | {type: 'comment', text: string, rtl: boolean, sheet: number}} Block
 *
 * @typedef {object} Doc
 * @property {string} title
 * @property {string} lang       a guess from the text ('he' when most paragraphs are right to left), or the one asked for
 * @property {boolean} revision
 * @property {Block[]} blocks
 * @property {{n: number, children: Inline[]}[]} footnotes   numbered from 1 across the whole document
 * @property {{id: number, children: Inline[], anchored: boolean}[]} comments  what a revision copy shows in the margin
 * @property {TocEntry[]} headings  every heading, in order
 * @property {number} topLevel      the highest heading level used (1 if none)
 * @property {number|null} chapterLevel  headings at this level or above begin a chapter (or a new page); null: none do
 * @property {{title: string}[]} sheets
 *
 * @typedef {object} DocOptions
 * @property {boolean} [revision=false]  show comments, deletions, insertions and annotations
 * @property {'omit'|'inline'|'footnotes'|'margin'} [annotations]  what an annotation's note becomes:
 *   dropped (the default), bracketed after its text, a footnote, or a margin note (the revision default)
 * @property {number|number[]} [tocLevels=[1, 3]]  which heading levels a (toc) lists: [from, to], or just `to`
 * @property {string} [title]
 * @property {string} [lang]
 */

const RTL_SCRIPT = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;

/** Whether a text is right to left: its first letter is Hebrew, Arabic…
 *  (the Unicode "first strong character" rule, as dir="auto" applies it). */
export function isRtl(text) {
  const m = /\p{L}/u.exec(text);
  return !!m && RTL_SCRIPT.test(m[0]);
}

/** A (toc)'s levels as [from, to]. */
export function tocRange(levels) {
  if (typeof levels === 'number') return [1, Math.max(1, Math.min(6, levels))];
  if (Array.isArray(levels) && levels.length === 2) {
    const a = Math.max(1, Math.min(6, levels[0] | 0)), b = Math.max(1, Math.min(6, levels[1] | 0));
    return a <= b ? [a, b] : [b, a];
  }
  return [1, 3];
}

/**
 * What a reader sees of some inline runs, as plain text: no footnote
 * markers, comments or deleted text.
 * @param {Inline[]} nodes
 */
export function plainText(nodes) {
  let out = '';
  for (const n of nodes) {
    switch (n.type) {
      case 'text': case 'code': case 'math': out += n.text; break;
      case 'image': out += n.alt; break;
      case 'footnote': case 'comment': case 'delete': break;
      default: if (n.children) out += plainText(n.children);
    }
  }
  return out;
}

/** Every footnote number referred to in some blocks, in order, with the
 *  footnotes inside footnotes after the one that holds them. */
export function footnotesIn(blocks, doc) {
  const seen = [];
  const walkInline = (nodes) => {
    for (const n of nodes) {
      if (n.type === 'footnote') {
        if (!seen.includes(n.n)) {
          seen.push(n.n);
          const fn = doc.footnotes[n.n - 1];
          if (fn) walkInline(fn.children);
        }
      } else {
        if (n.children) walkInline(n.children);
        if (n.note) walkInline(n.note);
      }
    }
  };
  const walkBlocks = (bs) => {
    for (const b of bs) {
      if (b.children) walkInline(b.children);
      if (b.blocks) walkBlocks(b.blocks);
      if (b.items) for (const it of b.items) { walkInline(it.children); walkBlocks(it.lists); }
      if (b.head) for (const c of b.head) walkInline(c);
      if (b.rows) for (const r of b.rows) for (const c of r) walkInline(c);
    }
  };
  walkBlocks(blocks);
  return seen;
}

/**
 * The headings of a (toc) as a tree: each entry under the nearest one before
 * it with a higher level, so a jump from level 1 to 3 still nests.
 * @param {{level: number}[]} entries
 * @returns {{entry: any, children: any[]}[]}
 */
export function tocTree(entries) {
  const root = [];
  const stack = [];
  for (const entry of entries) {
    while (stack.length && stack[stack.length - 1].entry.level >= entry.level) stack.pop();
    const node = { entry, children: [] };
    (stack.length ? stack[stack.length - 1].children : root).push(node);
    stack.push(node);
  }
  return root;
}

/** An id for a heading: its words in ASCII, or section-N for a heading with none
 *  (a Hebrew one), unique in the document. */
function slugFor(text, n, used) {
  let s = text.normalize('NFKD').replace(/[̀-ͯ]/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 48).replace(/-+$/u, '');
  if (!s || !/^[a-z]/u.test(s)) s = `section-${n}`;
  let id = s, k = 2;
  while (used.has(id)) id = `${s}-${k++}`;
  used.add(id);
  return id;
}

/** Adds text to a run list, joining it to the text before. */
function pushText(out, text) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.type === 'text') last.text += text;
  else out.push({ type: 'text', text });
}

/** Where a table row's cells are: split at every | that is not escaped, in
 *  code, or inside a [[wikilink|label]]. */
function splitCells(text, from, to) {
  let s = from, e = to;
  while (s < e && /\s/u.test(text[s])) s++;
  while (e > s && /\s/u.test(text[e - 1])) e--;
  if (text[s] === '|') s++;
  if (e > s && text[e - 1] === '|' && text[e - 2] !== '\\') e--;
  const cells = [];
  let start = s;
  for (let i = s; i < e; i++) {
    const c = text[i];
    if (c === '\\') { i++; continue; }
    if (c === '`') {
      let run = 1;
      while (text[i + run] === '`') run++;
      const close = text.indexOf('`'.repeat(run), i + run);
      if (close >= 0 && close < e) { i = close + run - 1; continue; }
      i += run - 1;
      continue;
    }
    if (c === '[' && text[i + 1] === '[') {
      const close = text.indexOf(']]', i + 2);
      if (close >= 0 && close < e) { i = close + 1; continue; }
    }
    if (c === '|') { cells.push([start, i]); start = i + 1; }
  }
  cells.push([start, e]);
  return cells.map(([a, b]) => {
    while (a < b && /\s/u.test(text[a])) a++;
    while (b > a && /\s/u.test(text[b - 1])) b--;
    return [a, b];
  });
}

class Builder {
  /** @param {DocOptions} opts */
  constructor(opts) {
    this.revision = !!opts.revision;
    this.annotations = opts.annotations || (this.revision ? 'margin' : 'omit');
    this.toc = tocRange(opts.tocLevels);
    this.footnotes = [];
    this.comments = [];
    this.headings = [];
    this.ids = new Set();
    this.sheet = 0;
  }

  // ---- inline -----------------------------------------------------------------

  /** The runs of text[from, to), whose markup is `nodes`. */
  inlines(text, from, to, nodes) {
    const out = [];
    let i = from;
    let dropped = false;     // the node before left nothing: "a %%note%% b" must not read "a  b", nor "a {--x--}, b" "a , b"
    const text2 = (t) => {
      if (dropped) {
        const last = out[out.length - 1];
        if ((!last || (last.type === 'text' && /\s$/u.test(last.text))) && /^\s/u.test(t)) t = t.replace(/^\s+/u, '');
        else if (last && last.type === 'text' && /[ \t]$/u.test(last.text) && /^[,.;:!?…)\]}”’»]/u.test(t)) last.text = last.text.replace(/[ \t]+$/u, '');
        if (t) dropped = false;
      }
      pushText(out, t);
    };
    for (const n of nodes) {
      if (n.from < i) continue;
      text2(text.slice(i, n.from));
      const runs = this.node(text, n);
      if (!runs.length) { dropped = true; }
      for (const r of runs) {
        if (r.type === 'text') text2(r.text);
        else { out.push(r); dropped = false; }
      }
      i = n.to;
    }
    text2(text.slice(i, to));
    return out;
  }

  /** The runs of a range the parser has not read yet. */
  reparse(text, a, b) {
    return this.inlines(text, a, b, parseInline(text, a, b));
  }

  comment(children, anchored) {
    const id = this.comments.length + 1;
    this.comments.push({ id, children, anchored });
    return id;
  }

  footnote(fill) {
    // numbered before its own text is read, so a footnote inside it comes after
    const fn = { n: this.footnotes.length + 1, children: [] };
    this.footnotes.push(fn);
    fn.children = fill();
    return { type: 'footnote', n: fn.n };
  }

  /** @returns {Inline[]} */
  node(text, n) {
    const inner = () => this.inlines(text, n.inner[0], n.inner[1], n.children);
    const slice = (r) => text.slice(r[0], r[1]);
    switch (n.type) {
      case 'escape': return [{ type: 'text', text: slice(n.inner) }];
      case 'code': return [{ type: 'code', text: slice(n.inner) }];
      case 'math': return [{ type: 'math', text: slice(n.inner) }];
      case 'strong': case 'em': case 'mark': case 'strike':
        return [{ type: n.type, children: inner() }];
      case 'comment': case 'note': {
        if (!this.revision) return [];
        const t = slice(n.inner).trim();
        if (!t) return [];
        return [{ type: 'comment', text: t, id: this.comment([{ type: 'text', text: t }], false) }];
      }
      case 'delete': return this.revision ? [{ type: 'delete', children: inner() }] : [];
      case 'insert': return this.revision ? [{ type: 'insert', children: inner() }] : inner();
      case 'subst': {
        const now = this.reparse(text, n.data.new[0], n.data.new[1]);
        if (!this.revision) return now;
        const was = this.inlines(text, n.data.old[0], n.data.old[1], n.children);
        return [{ type: 'delete', children: was }, { type: 'insert', children: now }];
      }
      case 'cmark': return this.revision ? [{ type: 'mark', children: inner() }] : inner();
      case 'annotation': {
        const children = inner();
        const note = () => this.reparse(text, n.data.note[0], n.data.note[1]);
        switch (this.annotations) {
          case 'footnotes': return [...children, this.footnote(note)];
          case 'inline': return [{ type: 'annotation', children, note: note(), display: 'inline', id: 0 }];
          case 'margin': {
            const nt = note();
            return [{ type: 'annotation', children, note: nt, display: 'margin', id: this.comment(nt, true) }];
          }
          default: return children;
        }
      }
      case 'footnote': return [this.footnote(inner)];
      case 'link': return [{ type: 'link', url: n.data.url, title: n.data.title || '', children: inner() }];
      case 'url': {
        const url = n.data.url.startsWith('www.') ? `https://${n.data.url}` : n.data.url;
        return [{ type: 'link', url, title: '', children: [{ type: 'text', text: n.data.url }] }];
      }
      case 'wikilink': return [{ type: 'text', text: slice(n.data.label) }];
      case 'image': return [{ type: 'image', src: n.data.url, alt: slice(n.inner), title: n.data.title || '' }];
      default: return [{ type: 'text', text: text.slice(n.from, n.to) }];
    }
  }

  // ---- blocks -----------------------------------------------------------------

  /** A sheet's body as blocks. */
  sheetBlocks(body) {
    const lines = parseLines(body);
    const out = [];
    const sheet = this.sheet;
    const push = (b) => { b.sheet = sheet; out.push(b); };
    let list = null;         // list lines waiting to be built into a list
    let quote = null;        // quote lines
    let table = null;        // table lines
    /** Builds the run of list, quote or table lines that a line of another kind ends. */
    const flush = (type) => {
      if (list && type !== 'list') { for (const b of this.buildLists(list)) push(b); list = null; }
      if (quote && type !== 'quote') { push(this.buildQuote(body, quote)); quote = null; }
      if (table && type !== 'table') { const t = this.buildTable(body, table); if (t) push(t); table = null; }
    };
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i];
      if (list && L.type === 'empty') {
        // a blank line between two items keeps them one list, as in Markdown
        let j = i + 1;
        while (j < lines.length && lines[j].type === 'empty') j++;
        if (j < lines.length && lines[j].type === 'list') { i = j - 1; continue; }
      }
      flush(L.type);
      switch (L.type) {
        case 'empty': break;
        case 'heading': {
          const children = this.inlines(body, L.content[0], L.content[1], L.inline);
          const t = plainText(children).trim();
          if (!t && !children.some((c) => c.type === 'image')) break;
          const n = this.headings.length + 1;
          const h = { type: 'heading', level: L.level, children, text: t, id: slugFor(t, n, this.ids), n, rtl: isRtl(t) };
          this.headings.push({ level: h.level, text: t, id: h.id, n });
          push(h);
          break;
        }
        case 'paragraph': {
          const children = this.inlines(body, L.content[0], L.content[1], L.inline);
          if (isBlank(children)) break;
          push({ type: 'paragraph', children: trimRuns(children), rtl: isRtl(plainText(children)) });
          break;
        }
        case 'image': {
          const n = L.inline[0];
          const alt = body.slice(n.inner[0], n.inner[1]);
          push({ type: 'image', src: n.data.url, alt, title: n.data.title || '', rtl: isRtl(alt) });
          break;
        }
        case 'list': {
          const children = trimRuns(this.inlines(body, L.content[0], L.content[1], L.inline));
          (list ||= []).push({ depth: L.depth, ordered: L.ordered, marker: L.marker, task: L.task, children, rtl: isRtl(plainText(children)) });
          break;
        }
        case 'quote': (quote ||= []).push(L); break;
        case 'table': (table ||= []).push(L); break;
        case 'divider': push({ type: 'divider' }); break;
        case 'toc': push({ type: 'toc', levels: this.toc, entries: [] }); break;
        case 'fence': {
          if (!L.open) break;
          const code = [];
          let j = i + 1;
          while (j < lines.length && lines[j].type === 'code') { code.push(body.slice(lines[j].from, lines[j].to)); j++; }
          i = j < lines.length && lines[j].type === 'fence' && lines[j].close ? j : j - 1;
          push({ type: 'code', lang: L.lang || '', text: code.join('\n').replace(/\r/gu, '') });
          break;
        }
        case 'math': {
          const src = [];
          let j = i;
          for (;;) {
            src.push(body.slice(lines[j].from, lines[j].to));
            if (lines[j].close || j + 1 >= lines.length || lines[j + 1].type !== 'math' || lines[j + 1].open) break;
            j++;
          }
          i = j;
          const t = src.join('\n').trim().replace(/^\$\$/u, '').replace(/\$\$$/u, '').trim();
          if (t) push({ type: 'math', text: t });
          break;
        }
        case 'comment': {
          // a comment block: this line to the one that closes it
          const parts = [];
          let j = i;
          for (;;) {
            const C = lines[j];
            parts.push(body.slice(C.content[0], C.content[1]));
            if (C.close || j + 1 >= lines.length || lines[j + 1].type !== 'comment' || lines[j + 1].open) break;
            j++;
          }
          i = j;
          const t = parts.join('\n').trim();
          if (this.revision && t) push({ type: 'comment', text: t, rtl: isRtl(t) });
          const last = lines[j];
          if (last.after && last.tag) {
            const children = this.inlines(body, last.tag[1], last.to, last.after);
            if (!isBlank(children)) push({ type: 'paragraph', children: trimRuns(children), rtl: isRtl(plainText(children)) });
          }
          break;
        }
        default: break;
      }
    }
    flush(null);
    return out;
  }

  /** List items, with their depths, as lists nested inside their items. */
  buildLists(items) {
    const top = [];
    const stack = [];        // stack[d]: the list open at depth d
    for (const it of items) {
      // an item can be at most one level deeper than the one before it
      const d = Math.min(it.depth, stack.length);
      stack.length = Math.min(stack.length, d + 1);
      let L = stack[d];
      if (!L || L.ordered !== it.ordered) {
        L = { type: 'list', ordered: it.ordered, start: it.ordered ? parseInt(it.marker, 10) || 1 : 1, items: [] };
        if (d === 0) top.push(L);
        else {
          const parent = stack[d - 1];
          parent.items[parent.items.length - 1].lists.push(L);
        }
        stack[d] = L;
        stack.length = d + 1;
      }
      const item = { children: it.children, rtl: it.rtl, lists: [] };
      if (it.task) item.task = it.task;
      L.items.push(item);
    }
    return top;
  }

  /** Quote lines as a quote, a deeper > making a quote inside it. */
  buildQuote(body, lines) {
    const root = { type: 'quote', blocks: [] };
    for (const L of lines) {
      let target = root;
      for (let d = 1; d < L.depth; d++) {
        const last = target.blocks[target.blocks.length - 1];
        if (last && last.type === 'quote') target = last;
        else { const q = { type: 'quote', blocks: [] }; target.blocks.push(q); target = q; }
      }
      const children = this.inlines(body, L.content[0], L.content[1], L.inline);
      if (isBlank(children)) continue;
      target.blocks.push({ type: 'paragraph', children: trimRuns(children), rtl: isRtl(plainText(children)) });
    }
    return root;
  }

  /** Table lines as a table: the row above the rule row is the header, and the
   *  rule row's colons give each column's alignment. */
  buildTable(body, lines) {
    const ruleAt = lines.findIndex((L) => L.row === 'rule');
    let align = [];
    if (ruleAt >= 0) {
      align = splitCells(body, lines[ruleAt].from, lines[ruleAt].to).map(([a, b]) => {
        const c = body.slice(a, b).trim();
        const l = c.startsWith(':'), r = c.endsWith(':');
        return l && r ? 'center' : r ? 'right' : l ? 'left' : null;
      });
    }
    const cells = (L) => splitCells(body, L.from, L.to).map(([a, b]) => trimRuns(this.reparse(body, a, b)));
    const rows = lines.filter((L) => L.row !== 'rule').map(cells);
    if (!rows.length) return null;
    const head = ruleAt === 1 ? rows.shift() : null;
    const width = Math.max(align.length, head ? head.length : 0, ...rows.map((r) => r.length));
    const pad = (r) => { while (r.length < width) r.push([]); return r; };
    if (head) pad(head);
    rows.forEach(pad);
    while (align.length < width) align.push(null);
    return { type: 'table', align: align.slice(0, width), head, rows };
  }
}

const isBlank = (runs) => !runs.some((r) => r.type !== 'text' || r.text.trim());

/** Runs without the spaces at their two ends. */
function trimRuns(runs) {
  const out = runs.slice();
  if (out[0] && out[0].type === 'text') out[0] = { type: 'text', text: out[0].text.replace(/^\s+/u, '') };
  const k = out.length - 1;
  if (out[k] && out[k].type === 'text') out[k] = { type: 'text', text: out[k].text.replace(/\s+$/u, '') };
  return out.filter((r) => r.type !== 'text' || r.text);
}

/**
 * The document for some sheets.
 * @param {{title?: string, body?: string, text?: string}[]} sheets  a sheet's `text` is the whole file (its
 *   front matter is split off, and a material sheet left out); `body` is the text without front matter
 * @param {DocOptions} [opts]
 * @returns {Doc}
 */
export function buildDoc(sheets, opts = {}) {
  const b = new Builder(opts);
  const blocks = [];
  const kept = [];
  for (const s of sheets) {
    let body = s.body;
    if (body === undefined) {
      const split = splitSheet(s.text || '');
      if (readMeta(split.values).material && !opts.includeMaterial) continue;
      body = split.body;
    }
    body = body.replace(/\r\n?/gu, '\n');
    b.sheet = kept.length;
    kept.push({ title: s.title || sheetTitle(body) });
    blocks.push(...b.sheetBlocks(body));
  }
  // a (toc) lists every heading in the document, wherever it stands
  const [lo, hi] = b.toc;
  const entries = b.headings.filter((h) => h.level >= lo && h.level <= hi);
  const fill = (bs) => { for (const x of bs) { if (x.type === 'toc') x.entries = entries; if (x.blocks) fill(x.blocks); } };
  fill(blocks);
  const levels = b.headings.map((h) => h.level);
  const topLevel = levels.length ? Math.min(...levels) : 1;
  let chapterLevel = null;
  for (let L = topLevel; L <= 6 && chapterLevel === null; L++) {
    if (levels.filter((x) => x <= L).length >= 2) chapterLevel = L;
  }
  const paras = blocks.filter((x) => 'rtl' in x);
  const rtlShare = paras.length ? paras.filter((x) => x.rtl).length / paras.length : 0;
  const firstHeading = b.headings[0];
  return {
    title: opts.title || (kept[0] && kept[0].title) || (firstHeading && firstHeading.text) || 'Untitled',
    lang: opts.lang || (rtlShare > 0.5 ? 'he' : 'en'),
    revision: b.revision,
    blocks,
    footnotes: b.footnotes,
    comments: b.comments,
    headings: b.headings,
    topLevel,
    chapterLevel,
    sheets: kept,
  };
}
