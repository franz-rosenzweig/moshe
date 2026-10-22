// Moshe's markup (docs/FORMAT.md) written from what an importer read: the
// DOCX and HTML readers turn their documents into blocks of runs, each run
// with its formatting and what it sits inside (a link, a tracked change, a
// comment), and this module writes those as lines of Markdown, CriticMarkup
// and footnotes.
//
// Runs with the same formatting are joined, so Word's habit of cutting a
// sentence into many runs leaves no **a****b** behind; spaces are moved
// outside emphasis, where Markdown needs them; and a character is escaped only
// where Moshe's own reader (../markup.js) would otherwise take it for markup.
// That last is settled by asking the reader: each line is parsed, and any tag
// it finds that is made of the document's own text gets a backslash, until
// the line reads back as written. Ordinary prose stays clean.
import { parseInline, parseLines } from '../markup.js';

/** Formatting flags on a text run. */
export const B = 1, I = 2, S = 4, H = 8, C = 16;
const FLAGS = [B, I, S, H];
const OPEN = { [B]: '**', [I]: '_', [S]: '~~', [H]: '==' };

/**
 * @typedef {{link?: string|null, ch?: 'ins'|'del'|null, cm?: string|null}} Ctx
 *   what a run sits inside: a link's address, a tracked change, a comment's range (its id)
 * @typedef {(Ctx & {k: 't', s: string, f: number})
 *   | {k: 'br'}
 *   | (Ctx & {k: 'fn', items: Item[]})
 *   | (Ctx & {k: 'img', alt: string, src: string})
 *   | (Ctx & {k: 'note', id: string})} Item
 *   text with its flags; a line break; a footnote with its runs; a picture (src as the text will
 *   have it); a comment on no text
 * @typedef {{type: 'p', kind?: 'para'|'heading'|'quote'|'code'|'math'|'comment'|'caption'|'divider',
 *            level?: number, list?: {ordered: boolean, depth: number, n: number}|null, items: Item[]}
 *   | {type: 'table', rows: Block[][][]}
 *   | {type: 'toc'}} Block
 *   a table's cell is the blocks in it
 * @typedef {{author: string, items: Item[], extras: string[], noted?: boolean}} Comment
 *   a comment's text, and the comments on the same text that are written after it
 */

// the markup Moshe escapes with a backslash (markup.js's escape rule)
const ESCAPABLE = /[\\`*_{}[\]()#+\-.!|=~^%$<>:]/u;
// nodes whose closing tag the reader finds by searching for it, which a
// backslash before its first character does not hide
const SEARCHED = new Set(['code', 'comment', 'insert', 'delete', 'note', 'subst', 'cmark', 'annotation', 'mark', 'strike', 'wikilink', 'math']);
const isWordChar = (c) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/**
 * A piece of a line being written: the document's text (m false), or markup (m true).
 * @typedef {{m: boolean, s: string, tag?: boolean, fmt?: 'open'|'close', pair?: number, em?: boolean, alt?: boolean,
 *            raw?: boolean, esc?: boolean, bare?: {url: string}}} Token
 *   tag: markup the reader must read as a tag; pair: the tags that are one node's; fmt: an emphasis's
 *   or link's (spaces move out of it, and it may be given up); alt: its delimiter is chosen as it is
 *   written (this.pairs); raw: markup whose inside Moshe does not read (a code span's, a note's);
 *   esc: a backslash put in; bare: a link written as its address
 */
const M = (s, extra = {}) => ({ m: true, s, tag: true, ...extra });
const L = (s) => ({ m: false, s });

/** Consecutive items with the same key. */
function groups(items, key) {
  const out = [];
  for (const it of items) {
    const k = key(it);
    const last = out[out.length - 1];
    if (last && last.key === k) last.items.push(it);
    else out.push({ key: k, items: [it] });
  }
  return out;
}

const sameCtx = (a, b) => (a.link || null) === (b.link || null) && (a.ch || null) === (b.ch || null) && (a.cm ?? null) === (b.cm ?? null);

/** Runs joined where they can be: no empty ones, spaces taking the formatting before them. */
function normalise(items) {
  const out = [];
  for (const it0 of items) {
    if (it0.k === 't' && !it0.s) continue;
    const it = { ...it0 };
    if (it.k === 't') {
      // code that is only spaces, or begins or ends with a backtick (which Moshe's code has no way to
      // hold), is written as text
      if (it.f & C && (!it.s.trim() || it.s.startsWith('`') || it.s.endsWith('`'))) it.f &= ~C;
      const prev = out[out.length - 1];
      // a space between two bold words is bold too, so the two are one run
      if (!it.s.trim() && !(it.f & C) && prev && prev.k === 't' && sameCtx(prev, it)) it.f = prev.f & ~C;
      if (prev && prev.k === 't' && prev.f === it.f && sameCtx(prev, it)) { prev.s += it.s; continue; }
    }
    out.push(it);
  }
  return out;
}

/** A run of code between enough backticks that none inside closes it. */
function codeTokens(t, pair) {
  const longest = Math.max(0, ...(t.match(/`+/gu) || []).map((r) => r.length));
  const fence = '`'.repeat(longest + 1);
  return [M(fence, { pair }), { m: true, s: t, raw: true }, M(fence, { pair })];
}

/** An address as a link's or picture's target: spaces, brackets and parentheses encoded. */
export function target(url) {
  return String(url).replace(/[\s()<>]/gu, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
}

/** What a reader sees of some items, as plain text (deletions left out). */
export function plainItems(items) {
  let out = '';
  for (const it of items) {
    if (it.ch === 'del') continue;
    if (it.k === 't') out += it.s;
    else if (it.k === 'br') out += ' ';
  }
  return out;
}

/** Items with the spaces at their two ends taken off. */
export function trimItems(items) {
  const out = items.filter((it) => it.k !== 't' || it.s);
  const firstText = out.findIndex((it) => it.k !== 'note');
  for (let i = Math.max(0, firstText); i < out.length && out[i].k === 't'; i++) {
    out[i] = { ...out[i], s: out[i].s.replace(/^\s+/u, '') };
    if (out[i].s) break;
  }
  for (let i = out.length - 1; i >= 0 && out[i].k === 't'; i--) {
    out[i] = { ...out[i], s: out[i].s.replace(/\s+$/u, '') };
    if (out[i].s) break;
  }
  return out.filter((it) => it.k !== 't' || it.s);
}

export class MarkupWriter {
  /**
   * @param {{comments?: Map<string, Comment>, authors?: boolean}} [opts]
   *   authors: begin each comment's note with its author's name (as Word shows it)
   */
  constructor(opts = {}) {
    this.comments = opts.comments || new Map();
    this.authors = opts.authors !== false;
    this.pairs = new Map();      // a bold's or emphasis's pair → {options, at, delim}: the delimiter it is written with
    this.nextPair = 1;
    this.unresolved = 0;         // lines the reader still reads otherwise after every escape (should stay 0)
    this.unresolvedLines = [];   // and those lines, with where (for tracing one down)
    this.dropped = 0;            // emphases or links given up because no escape made them readable
    // the CriticMarkup open around what is being written (a footnote's text is written inside its
    // reference's): the reader ends {--…--} at the first --}, so none may hold another of its kind
    this.depth = { ins: 0, del: 0, subst: 0, cm: 0 };
  }

  // ---- runs to tokens --------------------------------------------------------------

  /** @param {Item[]} items @returns {Token[]} */
  inline(items) {
    const out = [];
    for (const g of groups(normalise(items), (it) => (it.k === 'br' ? null : it.cm ?? null))) {
      if (g.key === null) { out.push(...this.changes(g.items)); continue; }
      const c = this.comments.get(g.key);
      if (this.depth.cm && c && !c.noted) {
        // a comment inside another's range (in a footnote on commented text): its text, then its note
        c.noted = true;
        out.push(...this.changes(g.items), ...this.noteAlone(c, true));
        continue;
      }
      this.depth.cm++;
      const inner = this.changes(g.items);
      this.depth.cm--;
      if (!c || c.noted) { out.push(...inner); continue; }
      c.noted = true;
      const visible = g.items.some((it) => it.k !== 'note' && (it.k !== 't' || it.s.trim()));
      if (!visible) { out.push(...inner, ...this.noteAlone(c, true)); continue; }
      const pair = this.nextPair++;
      out.push(M('{==', { pair }), ...inner, M('==}', { pair }), M('{>>', { pair }), ...this.noteTokens(c), M('<<}', { pair }));
      for (const id of c.extras) { const x = this.comments.get(id); if (x && !x.noted) { x.noted = true; out.push(...this.noteAlone(x, false)); } }
    }
    return out;
  }

  /** The author's name before a comment's text, unless it is there already. */
  authorPrefix(c, plain) {
    if (!this.authors || !c.author) return '';
    return plain.trimStart().startsWith(`${c.author}:`) ? '' : `${c.author}: `;
  }

  /** An annotation's note: read as markup by Moshe, so written as markup. */
  noteTokens(c) {
    const items = trimItems(c.items.map((it) => (it.k === 'br' ? { k: 't', s: ' ', f: 0 } : it)));
    const prefix = this.authorPrefix(c, plainItems(items));
    return [...(prefix ? [L(prefix)] : []), ...this.inline(items.map((it) => ({ ...it, cm: null })))];
  }

  /** A comment on no text, {>>…<<}, which Moshe keeps as written: plain text. */
  noteAlone(c, withExtras) {
    const plain = plainItems(c.items).replace(/\s+/gu, ' ').trim();
    const text = `${this.authorPrefix(c, plain)}${plain}`.replace(/<<\}/gu, '<< }');
    const out = [{ m: true, s: `{>>${text}<<}`, raw: true }];
    if (withExtras) {
      for (const id of c.extras) { const x = this.comments.get(id); if (x && !x.noted) { x.noted = true; out.push(...this.noteAlone(x, false)); } }
    }
    return out;
  }

  changes(items) {
    const out = [];
    const gs = groups(items, (it) => it.ch || null);
    for (let i = 0; i < gs.length; i++) {
      const g = gs[i];
      const pair = this.nextPair++;
      const d = this.depth;
      const within = (key, fn) => { d[key]++; try { return fn(); } finally { d[key]--; } };
      if (g.key === 'del' && gs[i + 1] && gs[i + 1].key === 'ins' && !d.subst && !d.del && !d.ins) {
        const was = within('subst', () => this.links(g.items));
        const now = within('subst', () => this.links(gs[i + 1].items));
        out.push(M('{~~', { pair }), ...was, M('~>', { pair }), ...now, M('~~}', { pair }));
        i++;
      } else if (g.key === 'del' && !d.del) out.push(M('{--', { pair }), ...within('del', () => this.links(g.items)), M('--}', { pair }));
      else if (g.key === 'ins' && !d.ins) out.push(M('{++', { pair }), ...within('ins', () => this.links(g.items)), M('++}', { pair }));
      // (a deletion inside a deletion is deleted already)
      else out.push(...this.links(g.items));
    }
    return out;
  }

  links(items) {
    const out = [];
    for (const g of groups(items, (it) => it.link || null)) {
      if (!g.key) { out.push(...this.format(g.items)); continue; }
      const only = g.items.length === 1 && g.items[0].k === 't' && g.items[0].f === 0 ? g.items[0].s : null;
      if (only !== null && only === g.key && /^(https?:\/\/|www\.)[^\s<>*_~=[\]{}`^%$|\\]+$/u.test(only) && !/[.,;:!?)'"\]]$/u.test(only)) {
        // an address shown as itself: written bare, if nothing around it would join it
        out.push({ m: true, s: only, bare: { url: only } });
        continue;
      }
      const pair = this.nextPair++;
      out.push(M('[', { fmt: 'open', pair }), ...this.format(g.items), M(`](${target(g.key)})`, { fmt: 'close', pair }));
    }
    return out;
  }

  /** Formatted runs, each flag opened once for as long as it lasts. */
  format(items0) {
    // a highlight or strike ending in its own mark's character ("a=" highlighted) would close a
    // character early, and the reader finds == and ~~ by searching, which no backslash stops:
    // that last character is left outside
    const items = [];
    items0.forEach((it, i) => {
      if (it.k === 't') {
        for (const [flag, ch] of [[H, '='], [S, '~']]) {
          if (!(it.f & flag) || !it.s.trimEnd().endsWith(ch)) continue;
          const next = items0.slice(i + 1).find((x) => x.k === 't' && x.s.trim());
          if (next && next.f & flag) continue;
          const m = new RegExp(`${ch}+\\s*$`, 'u').exec(it.s);
          if (m.index > 0) items.push({ ...it, s: it.s.slice(0, m.index) });
          it = { ...it, s: m[0], f: it.f & ~flag };
        }
      }
      items.push(it);
    });
    const out = [];
    const stack = [];            // [flag, pair]
    const runLength = (from, flag) => {
      let n = 0;
      for (let j = from; j < items.length; j++) {
        const it = items[j];
        if (it.k !== 't') continue;
        if (!(it.f & flag)) break;
        n += it.s.length;
      }
      return n;
    };
    const close = () => {
      const [flag, pair] = stack.pop();
      out.push(M(OPEN[flag], { fmt: 'close', pair, em: flag === I, alt: flag === I || flag === B }));
    };
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.k !== 't') {
        // a footnote that uses the formatting open around it would close it early (the reader
        // looks for ** without regard to ^[…]): what it uses is closed first
        if (it.k === 'fn') {
          const used = it.items.reduce((m, x) => m | (x.k === 't' ? x.f : 0), 0);
          while (stack.some(([f]) => used & f)) close();
        }
        out.push(...this.atomic(it));
        continue;
      }
      const want = it.f & (B | I | S | H);
      while (stack.some(([f]) => !(want & f))) close();
      const missing = FLAGS.filter((f) => want & f && !stack.some(([g]) => g === f)).sort((a, b) => runLength(i, b) - runLength(i, a));
      for (const f of missing) {
        const pair = this.nextPair++;
        // emphasis is _ or * (inside a word), bold ** or __ (inside *…*, where the reader splits ** after a space)
        if (f === I) this.pairs.set(pair, { options: ['_', '*'], at: 0, delim: '_' });
        if (f === B) this.pairs.set(pair, { options: ['**', '__'], at: 0, delim: '**' });
        out.push(M(OPEN[f], { fmt: 'open', pair, em: f === I, alt: f === I || f === B }));
        stack.push([f, pair]);
      }
      if (it.f & C) out.push(...codeTokens(it.s, this.nextPair++));
      else out.push(L(it.s));
    }
    while (stack.length) close();
    return out;
  }

  atomic(it) {
    switch (it.k) {
      case 'fn': {
        const inner = this.inline(trimItems(it.items.map((x) => (x.k === 'br' ? { k: 't', s: ' ', f: 0 } : x))));
        const pair = this.nextPair++;
        return inner.length ? [M('^[', { pair }), ...inner, M(']', { pair })] : [];
      }
      case 'img': {
        const alt = (it.alt || '').replace(/[[\]]/gu, (c) => (c === '[' ? '(' : ')')).replace(/\s+/gu, ' ').trim();
        return [{ m: true, s: `![${alt}](${target(it.src)})`, raw: true }];
      }
      case 'note': {
        const c = this.comments.get(it.id);
        if (!c || c.noted) return [];
        c.noted = true;
        return this.noteAlone(c, true);
      }
      case 'br': return [L(' ')];
      default: return [];
    }
  }

  // ---- tokens to a line ------------------------------------------------------------

  /**
   * Tokens as a finished line.
   * @param {Token[]} tokens
   * @param {{prefix?: string, kind?: 'para'|'heading'|'list'|'quote'|'cell'}} [opts]
   *   prefix: the line's own tag ("## ", "\t1. ", "> "), which the check reads with it
   */
  line(tokens, opts = {}) {
    const kind = opts.kind || 'para';
    const prefix = opts.prefix || '';
    let toks = tokens.filter((t) => t.s !== '' || t.bare).map((t) => ({ ...t }));
    if (kind === 'cell') {
      // a | in a table cell would end it
      toks = toks.flatMap((t) => (t.m || !t.s.includes('|') ? [t] : t.s.split('|').flatMap((part, k) => (k ? [{ m: true, s: '\\', esc: true }, L(`|${part}`)] : [L(part)]))));
    }
    toks = moveSpaces(toks);
    trimEnds(toks);
    toks = toks.filter((t) => t.s !== '' || t.bare);
    this.decide(toks);
    const lineCheck = this.lineCheck(kind, prefix);
    const dropped = new Set();
    for (let attempt = 0; ; attempt++) {
      const work = toks.filter((t) => !(t.fmt && dropped.has(t.pair))).map((t) => ({ ...t }));
      let res = this.settle(work, lineCheck);
      // a run of one character escaped in places ("\\_\\__\\___") is escaped all through
      const runs = uniformRuns(work, this.join(work));
      if (runs.length) {
        insertEscapes(work, this.join(work), runs);
        res = this.settle(work, lineCheck);
      }
      if (!res.broken.length && !res.capped) return prefix + res.text;
      // markup no escape makes readable (an emphasis begun inside a word that ends where a bold
      // ends, ***): that emphasis or link is given up and its text kept
      const pairs = [...new Set(res.broken.map((i) => work[i]).filter((t) => t && t.fmt && t.pair !== undefined).map((t) => t.pair))];
      if (res.capped || !pairs.length || attempt >= 8) {
        this.unresolved++;
        this.unresolvedLines.push({ text: res.text, broken: res.broken.map((i) => this.join(work).starts[i]) });
        return prefix + res.text;
      }
      for (const pair of pairs) dropped.add(pair);
      this.dropped += pairs.length;
    }
  }

  /**
   * Escapes added to the tokens until Moshe's reader reads the line as they mean it.
   * @returns {{text: string, broken: number[], capped: boolean}}  broken: the tokens written as
   *   markup that the reader still does not read as markup
   */
  settle(toks, lineCheck) {
    let text = '';
    for (let round = 0; ; round++) {
      const j = this.join(toks);
      text = j.text;
      const fixes = new Set();
      let changed = false;
      const literal = (p) => p >= 0 && p < text.length && !toks[j.owner[p]].m;
      const escaped = (p) => p > 0 && toks[j.owner[p - 1]].esc;
      const lp = lineCheck(text);
      if (lp >= 0 && literal(lp) && !escaped(lp)) fixes.add(lp);
      // every tag the reader finds: none may be made of the document's text
      const tagged = new Uint8Array(text.length);
      const tagNode = new Array(text.length);
      const swallowed = [];      // addresses in the text that run on into the markup after them
      const bareRunOn = [];      // and links written as bare addresses that do
      const visit = (nodes) => {
        for (const n of nodes) {
          if (n.type === 'url') {
            let q = n.from;
            while (q < n.to && literal(q)) q++;
            if (q > n.from && q < n.to) swallowed.push([n.from, q]);
            const t = toks[j.owner[n.from]];
            if (t.bare && n.to > j.starts[j.owner[n.from]] + t.s.length) bareRunOn.push(j.owner[n.from]);
          }
          // one fix a node a round: escaping its opening tag may be all it takes
          let bad = false;
          n.tags.forEach(([a, b], ti) => {
            tagged.fill(1, a, b);
            for (let q = a; q < b; q++) tagNode[q] = n;
            if (bad) return;
            const lits = [];
            for (let p = a; p < b; p++) if (literal(p) && !escaped(p)) lits.push(p);
            if (!lits.length) return;
            bad = true;
            fixes.add(lits[0]);
            if (ti > 0 && SEARCHED.has(n.type) && lits.length > 1) fixes.add(lits[1]);
          });
          if (bad) continue;
          if (n.children && n.children.length) visit(n.children);
          if (n.type === 'subst') visit(parseInline(text, n.data.new[0], n.data.new[1]));
          if (n.type === 'annotation') visit(parseInline(text, n.data.note[0], n.data.note[1]));
        }
      };
      visit(parseInline(text, 0, text.length));
      if (swallowed.length && this.linkAddress(toks, j, swallowed[0], text)) continue;
      if (bareRunOn.length) {
        const t = toks[bareRunOn[0]];
        const pair = this.nextPair++;
        toks.splice(bareRunOn[0], 1, M('[', { fmt: 'open', pair }), L(t.bare.url), M(`](${target(t.bare.url)})`, { fmt: 'close', pair }));
        continue;
      }
      // and every tag written must be read as one
      const broken = [];
      if (!fixes.size) {
        for (let ti = 0, at = 0; ti < toks.length; at += j.lens[ti], ti++) {
          const t = toks[ti];
          if (t.tag && j.lens[ti] && !tagged.subarray(at, at + j.lens[ti]).every((x) => x)) broken.push([ti, at]);
        }
        // first another delimiter (_ for *, __ for **); only if none is left, escapes
        for (const [ti] of broken) {
          const pair = toks[ti].alt ? this.pairs.get(toks[ti].pair) : null;
          if (pair && pair.at + 1 < pair.options.length && !pair.switched) { pair.delim = pair.options[++pair.at]; pair.switched = true; changed = true; }
        }
        for (const [ti] of broken) { const pair = toks[ti].alt ? this.pairs.get(toks[ti].pair) : null; if (pair) pair.switched = false; }
        if (!changed) {
          for (const [ti, at] of broken) {
            const t = toks[ti];
            if (t.pair !== undefined && /^(\^\[|\[|\]\(.*|\])$/su.test(t.s)) {
              // a footnote or link that does not close where it should: a bracket in its text
              // (mirrored ones are common in Hebrew) is taken for one of its own
              let a = -1, b = -1;
              for (let k = 0, pos = 0; k < toks.length; pos += j.lens[k], k++) {
                if (toks[k].pair === t.pair) { if (a < 0) a = pos; b = pos; }
              }
              for (let q = a + 1; q < b; q++) if ((text[q] === '[' || text[q] === ']') && literal(q) && !escaped(q)) fixes.add(q);
            } else {
              for (const p of [at - 1, at + j.lens[ti]]) if (literal(p) && !escaped(p) && ESCAPABLE.test(text[p])) fixes.add(p);
            }
          }
        }
      }
      // and the tags written together must be read as one node's: a stray backtick can make the
      // reader skip from it to the next without making anything of it, pairing the tags otherwise
      if (!fixes.size && !broken.length && !changed) {
        const first = new Map();
        const mismatched = [];
        for (let ti = 0, at = 0; ti < toks.length; ti++) {
          const t = toks[ti];
          if (t.tag && t.pair !== undefined && j.lens[ti]) {
            if (!first.has(t.pair)) first.set(t.pair, tagNode[at]);
            else if (first.get(t.pair) !== tagNode[at]) mismatched.push([ti, at]);
          }
          at += j.lens[ti];
        }
        if (mismatched.length) {
          for (let q = 0; q < text.length; q++) if (text[q] === '`' && literal(q) && !escaped(q)) fixes.add(q);
          if (!fixes.size) broken.push(...mismatched);
        }
      }
      // a fix inside a run of one character (a line of underscores to fill in) takes the whole run
      for (const p of [...fixes]) {
        const c = text[p];
        if (!/[_*~=]/u.test(c)) continue;
        const inRun = (q) => q >= 0 && q < text.length && (text[q] === c || (text[q] === '\\' && toks[j.owner[q]].esc));
        let a = p, b = p;
        while (inRun(a - 1)) a--;
        while (inRun(b + 1)) b++;
        const run = [];
        for (let q = a; q <= b; q++) if (text[q] === c) run.push(q);
        if (run.length >= 3) for (const q of run) if (literal(q) && !escaped(q)) fixes.add(q);
      }
      const usable = [...fixes].filter((p) => ESCAPABLE.test(text[p]));
      if (!usable.length && !changed) return { text, broken: broken.map(([ti]) => ti), capped: false };
      if (round >= 40) return { text, broken: broken.map(([ti]) => ti), capped: true };
      insertEscapes(toks, j, usable);
    }
  }

  /**
   * An address in the text that the reader would run on past (into the markup after it, as it
   * reads an address to the next space) made a link of its own. → whether it could be
   */
  linkAddress(toks, j, [a, b], text) {
    while (b > a && /[.,;:!?)'"\]]/u.test(text[b - 1])) b--;
    if (b <= a) return false;
    const t0 = j.owner[a], t1 = j.owner[b - 1];
    for (let k = t0; k <= t1; k++) if (toks[k].m) return false;
    const url = text.slice(a, b);
    const head = toks[t0].s.slice(0, a - j.starts[t0]);
    const tail = toks[t1].s.slice(b - j.starts[t1]);
    const pair = this.nextPair++;
    const parts = [];
    if (head) parts.push(L(head));
    parts.push(M('[', { fmt: 'open', pair }), L(url), M(`](${target(url.startsWith('www.') ? `https://${url}` : url)})`, { fmt: 'close', pair }));
    if (tail) parts.push(L(tail));
    toks.splice(t0, t1 - t0 + 1, ...parts);
    return true;
  }

  /** Emphasis as _ or *, and addresses bare or as links, from what is around them. */
  decide(toks) {
    const around = (i) => {
      let prev = '', next = '';
      for (let k = i - 1; k >= 0 && !prev; k--) prev = toks[k].s;
      for (let k = i + 1; k < toks.length && !next; k++) next = toks[k].s;
      return [prev.slice(-1) || undefined, next[0]];
    };
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.em && t.fmt === 'open') {
        const closeAt = toks.findIndex((x, k) => k > i && x.pair === t.pair);
        const [before] = around(i);
        const [, after] = around(closeAt < 0 ? i : closeAt);
        if (isWordChar(before) || isWordChar(after)) Object.assign(this.pairs.get(t.pair), { delim: '*', at: 1 });
      }
      if (t.bare) {
        const [before] = around(i);
        // the reader takes an address to the next space, less the punctuation that ends it
        let rest = '';
        for (let k = i + 1; k < toks.length && rest.length < 64 && !/\s/u.test(rest); k++) rest += toks[k].s;
        const ok = (before === undefined || /[\s(<]/u.test(before)) && /^[.,;:!?)'"\]]*(\s|$)/u.test(rest);
        if (!ok) {
          const pair = this.nextPair++;
          toks.splice(i, 1, M('[', { fmt: 'open', pair }), L(t.bare.url), M(`](${target(t.bare.url)})`, { fmt: 'close', pair }));
        }
      }
    }
  }

  join(toks) {
    let text = '';
    const owner = [], starts = [], lens = [];
    toks.forEach((t, ti) => {
      const s = t.alt ? this.pairs.get(t.pair).delim : t.s;
      starts.push(text.length);
      lens.push(s.length);
      for (let k = 0; k < s.length; k++) owner.push(ti);
      text += s;
    });
    return { text, owner, starts, lens };
  }

  /** What would make the line other than what it is meant to be: a position to escape, or -1. */
  lineCheck(kind, prefix) {
    return (text) => {
      if (!text) return -1;
      const L0 = parseLines(prefix + text)[0];
      const first = text.search(/\S/u);
      switch (kind) {
        case 'para':
          if (L0.type === 'paragraph' || L0.type === 'image' || L0.type === 'divider') return -1;
          if (L0.type === 'list' && /\d/u.test(L0.marker)) return first + L0.marker.length - 1;
          return first;
        case 'list': return L0.task && text[0] === '[' ? 0 : -1;
        case 'quote': return L0.type === 'quote' && L0.depth > 1 ? first : -1;
        default: return -1;
      }
    };
  }

  // ---- blocks ----------------------------------------------------------------------

  /**
   * Blocks as the text of a sheet: paragraphs apart by a blank line, a list's
   * items and a quote's lines one to a line.
   * @param {Block[]} blocks
   * @returns {string}
   */
  blocks(blocks) {
    const parts = [];           // {text, kind}
    const push = (text, kind) => { if (text) parts.push({ text, kind }); };
    let code = null;            // the code block being gathered
    const flushCode = () => { if (code) { push(fenced(code.join('\n')), 'code'); code = null; } };
    for (let bi = 0; bi < blocks.length; bi++) {
      const b = blocks[bi];
      if (b.type !== 'p' || b.kind !== 'code') flushCode();
      if (b.type === 'toc') { push('(toc)', 'toc'); continue; }
      if (b.type === 'table') { push(this.table(b), 'table'); continue; }
      const kind = b.kind || 'para';
      if (kind === 'code') { (code ||= []).push(plainLines(b.items)); continue; }
      if (kind === 'math') { const t = plainLines(b.items).trim(); if (t) push(`$$\n${t}\n$$`, 'math'); continue; }
      if (kind === 'divider') { push('---', 'divider'); continue; }
      if (kind === 'comment') {
        const t = plainLines(b.items).trim().replace(/%%/gu, '% %');
        if (t) push(`%%${t}%%`, 'comment');
        continue;
      }
      if (kind === 'caption') {
        // a picture's caption, when the picture is alone before it, becomes its description
        const prev = blocks[bi - 1];
        const img = prev && prev.type === 'p' && soleImage(prev.items);
        const cap = plainItems(b.items).replace(/\s+/gu, ' ').trim();
        const last = parts[parts.length - 1];
        if (img && cap && (!img.alt || img.alt.trim() === cap) && last && last.kind === 'para' && last.img === img) {
          img.alt = cap;
          last.text = this.line(this.inline(trimItems(prev.items)));
          continue;
        }
      }
      if (kind === 'heading') {
        const items = trimItems(b.items.map((it) => (it.k === 'br' ? { k: 't', s: ' ', f: 0, link: it.link, ch: it.ch, cm: it.cm } : it)));
        // a heading all in bold is only bold because of how it was made
        const texts = items.filter((it) => it.k === 't' && it.s.trim());
        const strip = texts.length && texts.every((it) => it.f & B) ? B : 0;
        const prefix = `${'#'.repeat(Math.min(6, Math.max(1, b.level || 1)))} `;
        const t = this.line(this.inline(items.map((it) => (it.k === 't' ? { ...it, f: it.f & ~strip } : it))), { prefix, kind: 'heading' });
        if (t.length > prefix.length) push(t, 'heading');
        continue;
      }
      if (b.list) {
        const items = trimItems(b.items.map((it) => (it.k === 'br' ? { k: 't', s: ' ', f: 0, link: it.link, ch: it.ch, cm: it.cm } : it)));
        const prefix = `${'\t'.repeat(Math.min(8, b.list.depth))}${b.list.ordered ? `${b.list.n}.` : '-'} `;
        const t = this.line(this.inline(items), { prefix, kind: 'list' });
        if (t.length > prefix.length) parts.push({ text: t, kind: 'list', depth: b.list.depth, ordered: b.list.ordered });
        continue;
      }
      // a paragraph: each line break in it begins a new one
      const segments = [[]];
      for (const it of b.items) {
        if (it.k === 'br') segments.push([]);
        else segments[segments.length - 1].push(it);
      }
      const lines = [];
      let img = null;
      for (const seg of segments) {
        const items = trimItems(seg);
        const t = this.line(this.inline(items), { prefix: kind === 'quote' ? '> ' : '', kind: kind === 'quote' ? 'quote' : 'para' });
        if (t && t !== '> ') { lines.push(t); img = segments.length === 1 ? soleImage(items) : null; }
      }
      if (lines.length) {
        parts.push({ text: lines.join('\n'), kind: kind === 'quote' ? 'quote' : 'para', img });
      }
    }
    flushCode();
    let out = '';
    let top = null;             // the kind of list the last top-level item was in
    parts.forEach((p, i) => {
      const prev = parts[i - 1];
      let sep = '\n\n';
      if (prev && p.kind === 'quote' && prev.kind === 'quote') sep = '\n';
      if (prev && p.kind === 'list' && prev.kind === 'list') {
        // one list's items a line apart; a bulleted list running into a numbered one is set apart
        sep = p.depth === 0 && top !== null && top !== p.ordered ? '\n\n' : '\n';
      }
      if (p.kind === 'list' && p.depth === 0) top = p.ordered;
      if (p.kind !== 'list') top = null;
      if (i) out += sep;
      out += p.text;
    });
    return out;
  }

  /** A pipe table, its first row the header. */
  table(b) {
    const cellText = (blocks) => {
      const items = [];
      const add = (bs) => {
        for (const x of bs) {
          if (x.type === 'table') { for (const r of x.rows) for (const c of r) add(c); continue; }
          if (x.type !== 'p') continue;
          if (items.length) items.push({ k: 't', s: ' ', f: 0 });
          for (const it of x.items) items.push(it.k === 'br' ? { k: 't', s: ' ', f: 0, link: it.link, ch: it.ch, cm: it.cm } : it);
        }
      };
      add(blocks);
      return trimItems(items);
    };
    const rows = b.rows.map((r) => r.map(cellText));
    const width = Math.max(1, ...rows.map((r) => r.length));
    const lines = rows.map((r, ri) => {
      const cells = [];
      for (let ci = 0; ci < width; ci++) {
        let items = r[ci] || [];
        if (ri === 0) {
          // a header row is bold in Word; in a pipe table it is a header anyway
          const texts = items.filter((it) => it.k === 't' && it.s.trim());
          if (texts.length && texts.every((it) => it.f & B)) items = items.map((it) => (it.k === 't' ? { ...it, f: it.f & ~B } : it));
        }
        cells.push(this.line(this.inline(items), { kind: 'cell' }));
      }
      return `| ${cells.join(' | ')} |`.replace(/ {2}\|/gu, ' |');
    });
    lines.splice(1, 0, `|${' --- |'.repeat(width)}`);
    return lines.join('\n');
  }
}

/** A backslash before each of some positions in the joined tokens (from the end, so the positions hold). */
function insertEscapes(toks, j, positions) {
  for (const p of [...positions].sort((a, b) => b - a)) {
    const ti = j.owner[p];
    const off = p - j.starts[ti];
    const t = toks[ti];
    const parts = [];
    if (off > 0) parts.push(L(t.s.slice(0, off)));
    parts.push({ m: true, s: '\\', esc: true }, L(t.s.slice(off)));
    toks.splice(ti, 1, ...parts);
  }
}

/** The unescaped characters of each run of one character (_ * ~ = …) that is escaped somewhere in it. */
function uniformRuns(toks, j) {
  const { text, owner } = j;
  const out = [];
  const isEsc = (p) => p >= 0 && p < text.length && toks[owner[p]].esc;
  const isLit = (p) => p >= 0 && p < text.length && !toks[owner[p]].m;
  for (let p = 0; p < text.length;) {
    const c = text[p];
    if (!isLit(p) || !/[_*~=^$%`]/u.test(c)) { p++; continue; }
    // the run: this character, written or escaped, and the backslashes between
    let q = p, escapedSome = false;
    const bare = [];
    while (q < text.length) {
      if (isLit(q) && text[q] === c) {
        if (isEsc(q - 1)) escapedSome = true;
        else bare.push(q);
        q++;
      } else if (isEsc(q) && isLit(q + 1) && text[q + 1] === c) q++;
      else break;
    }
    if (escapedSome && bare.length && countOf(text, p, q, c) >= 3) out.push(...bare);
    p = Math.max(q, p + 1);
  }
  return out;
}

const countOf = (text, from, to, c) => { let n = 0; for (let k = from; k < to; k++) if (text[k] === c) n++; return n; };

/** Spaces moved out of emphasis and links, which do not begin or end with one. */
function moveSpaces(toks) {
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.fmt === 'open') {
        const n = toks[i + 1];
        if (n && !n.m && /^\s/u.test(n.s)) {
          const ws = /^\s+/u.exec(n.s)[0];
          n.s = n.s.slice(ws.length);
          toks.splice(i, 0, L(ws));
          changed = true;
          i++;
        }
      } else if (t.fmt === 'close') {
        const p = toks[i - 1];
        if (p && !p.m && /\s$/u.test(p.s)) {
          const ws = /\s+$/u.exec(p.s)[0];
          p.s = p.s.slice(0, -ws.length);
          toks.splice(i + 1, 0, L(ws));
          changed = true;
        }
      }
    }
    const kept = [];
    for (const t of toks) {
      if (!t.m && !t.s) continue;
      const last = kept[kept.length - 1];
      // an emphasis or link with nothing left in it goes
      if (t.fmt === 'close' && last && last.fmt === 'open' && last.pair === t.pair) { kept.pop(); changed = true; continue; }
      kept.push(t);
    }
    toks = kept;
  }
  return toks;
}

/** The spaces at a line's two ends taken off. */
function trimEnds(toks) {
  for (const t of toks) {
    if (t.m) { if (t.s) break; continue; }
    t.s = t.s.replace(/^\s+/u, '');
    if (t.s) break;
  }
  for (let i = toks.length - 1; i >= 0; i--) {
    const t = toks[i];
    if (t.m) { if (t.s) break; continue; }
    t.s = t.s.replace(/\s+$/u, '');
    if (t.s) break;
  }
}

/** The one picture a paragraph holds, if that is all it holds. */
function soleImage(items) {
  const imgs = items.filter((it) => it.k === 'img');
  if (imgs.length !== 1) return null;
  return items.every((it) => it.k === 'img' || (it.k === 't' && !it.s.trim())) ? imgs[0] : null;
}

/** A block's text with its line breaks, formatting dropped (code, a comment block). */
function plainLines(items) {
  let out = '';
  for (const it of items) {
    if (it.ch === 'del') continue;
    if (it.k === 't') out += it.s;
    else if (it.k === 'br') out += '\n';
  }
  return out;
}

/** A fenced code block, its fence longer than any run of backticks inside. */
function fenced(text) {
  const longest = Math.max(2, ...(text.match(/^[ \t]*`+/gmu) || []).map((r) => r.trim().length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}\n${text.replace(/\s+$/u, '')}\n${fence}`;
}
