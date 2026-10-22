// A sheet's text read as Moshe's markup (docs/FORMAT.md, "Markup"): which
// line is a heading, a list item, a quote, code…, and within a line where
// the tags are and what they enclose. One reading serves the editor (which
// greys the tags and styles what they enclose), the sheet list's preview,
// the statistics and the exporters, so all four agree on what the text says.
//
// Every position is an offset into the text given, so the editor can put a
// decoration exactly on a tag. A line is a paragraph, as in the editor: two
// lines in a row are two paragraphs, a blank line is only space.

/**
 * @typedef {{type: string, from: number, to: number, tags: number[][], inner: number[]|null,
 *            children: Inline[], data?: object}} Inline
 * @typedef {{type: string, from: number, to: number, tag: number[]|null, content: number[],
 *            inline: Inline[], level?: number, ordered?: boolean, depth?: number, lang?: string,
 *            open?: boolean, close?: boolean}} Line
 */

const HEADING = /^(#{1,6})([ \t]+|$)/u;
const DIVIDER = /^[ \t]{0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/u;
const LIST = /^([ \t]*)([-*+•]|\d{1,9}[.)])([ \t]+|$)/u;
const TASK = /^\[[ xX]\][ \t]+/u;
const QUOTE = /^((?:[ \t]{0,3}>[ \t]?)+)/u;
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*([^`\s]*)[^`]*$/u;
const TOC = /^\(toc\)[ \t]*$/iu;

/** The depth of a list item from its indentation: a tab or two spaces a level. */
function depthOf(indent) {
  let cols = 0;
  for (const c of indent) cols += c === '\t' ? 2 : 1;   // a tab is one level, as two spaces are
  return Math.floor(cols / 2);
}

/**
 * Every line of a text, read. With a range, only the lines that touch it are
 * read in full and returned; the rest are only scanned for where code
 * blocks, equations and comment blocks open and close (what decides how a
 * line in the range reads) — the editor reads what is on the screen.
 * @param {string} text
 * @param {{from?: number, to?: number}} [range]
 * @returns {Line[]}
 */
export function parseLines(text, range = null) {
  const out = [];
  let pos = 0;
  let fence = null;          // the open code fence: its marker
  let math = false;          // inside a $$ block
  let comment = false;       // inside a %% block that has not closed
  const raw = text.split('\n');
  const rFrom = range ? range.from ?? 0 : 0, rTo = range ? range.to ?? text.length : text.length;
  for (let n = 0; n < raw.length; n++) {
    const line = raw[n];
    const from = pos, to = pos + line.length;
    pos = to + 1;
    if (range && (to < rFrom || from > rTo)) {
      // outside the range: only the block state is followed
      if (fence) { const m = FENCE.exec(line); if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !m[2]) fence = null; continue; }
      if (math) { if (line.trim() === '$$' || line.trimEnd().endsWith('$$')) math = false; continue; }
      if (comment) { if (line.includes('%%')) comment = false; continue; }
      if (!line.trim()) continue;
      const fm = FENCE.exec(line);
      if (fm) { fence = fm[1]; continue; }
      if (line.trimStart().startsWith('$$')) { const r = line.trim(); if (!(r.length > 3 && r.endsWith('$$'))) math = true; continue; }
      if (line.startsWith('%%') && line.indexOf('%%', 2) < 0) comment = true;
      continue;
    }
    const L = { type: 'paragraph', from, to, tag: null, content: [from, to], inline: [] };
    if (fence) {
      const m = FENCE.exec(line);
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !m[2]) {
        Object.assign(L, { type: 'fence', close: true, tag: [from, to], content: [to, to] });
        fence = null;
      } else Object.assign(L, { type: 'code' });
      out.push(L);
      continue;
    }
    if (math) {
      const end = line.trim() === '$$' || line.trimEnd().endsWith('$$');
      Object.assign(L, { type: 'math' });
      if (end) { math = false; L.close = true; }
      out.push(L);
      continue;
    }
    if (comment) {
      const at = line.indexOf('%%');
      L.type = 'comment';
      if (at < 0) { L.inline = []; out.push(L); continue; }
      comment = false;
      L.close = true;
      L.tag = [from + at, from + at + 2];
      L.content = [from, from + at];
      // anything after the closing %% is ordinary text again
      L.after = parseInline(text, from + at + 2, to);
      out.push(L);
      continue;
    }
    if (!line.trim()) { L.type = 'empty'; out.push(L); continue; }
    let m;
    if ((m = FENCE.exec(line))) {
      fence = m[1];
      Object.assign(L, { type: 'fence', open: true, lang: m[2] || '', tag: [from, to], content: [to, to] });
      out.push(L);
      continue;
    }
    if (line.trimStart().startsWith('$$')) {
      const rest = line.trim();
      L.type = 'math';
      L.open = true;
      if (!(rest.length > 3 && rest.endsWith('$$'))) math = true;
      else L.close = true;
      out.push(L);
      continue;
    }
    if (line.startsWith('%%')) {
      // a comment block: to the next %%, here or on a later line. A %%…%% with
      // text after it on the line is only a comment inside a paragraph.
      const close = line.indexOf('%%', 2);
      if (close < 0) {
        comment = true;
        Object.assign(L, { type: 'comment', open: true, tag: [from, from + 2], content: [from + 2, to] });
        out.push(L);
        continue;
      }
      if (!line.slice(close + 2).trim()) {
        Object.assign(L, { type: 'comment', open: true, close: true, tag: [from, from + 2],
          tags: [[from, from + 2], [from + close, from + close + 2]], content: [from + 2, from + close] });
        out.push(L);
        continue;
      }
    }
    if (TOC.test(line)) { Object.assign(L, { type: 'toc', tag: [from, to], content: [to, to] }); out.push(L); continue; }
    if ((m = HEADING.exec(line))) {
      const end = from + m[0].length;
      Object.assign(L, { type: 'heading', level: m[1].length, tag: [from, end], content: [end, to] });
      L.inline = parseInline(text, end, to);
      out.push(L);
      continue;
    }
    if (DIVIDER.test(line)) { Object.assign(L, { type: 'divider', tag: [from, to], content: [to, to] }); out.push(L); continue; }
    if ((m = QUOTE.exec(line))) {
      const end = from + m[0].length;
      Object.assign(L, { type: 'quote', depth: (m[1].match(/>/gu) || []).length, tag: [from, end], content: [end, to] });
      L.inline = parseInline(text, end, to);
      out.push(L);
      continue;
    }
    if ((m = LIST.exec(line))) {
      let end = from + m[0].length;
      const task = TASK.exec(line.slice(m[0].length));
      if (task) end += task[0].length;
      Object.assign(L, {
        type: 'list', ordered: /\d/u.test(m[2]), marker: m[2], depth: depthOf(m[1]),
        indent: m[1].length, tag: [from, end], content: [end, to],
        ...(task ? { task: task[0][1] !== ' ' ? 'done' : 'open' } : {}),
      });
      L.inline = parseInline(text, end, to);
      out.push(L);
      continue;
    }
    if (line.startsWith('|') || /^\s*\|/u.test(line)) {
      L.type = 'table';
      L.row = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/u.test(line) ? 'rule' : 'cells';
      L.inline = parseInline(text, from, to);
      out.push(L);
      continue;
    }
    L.inline = parseInline(text, from, to);
    if (L.inline.length === 1 && L.inline[0].type === 'image' && text.slice(from, to).trim() === text.slice(L.inline[0].from, L.inline[0].to)) L.type = 'image';
    out.push(L);
  }
  return out;
}

const isSpace = (c) => c === undefined || /\s/u.test(c);
const isWordChar = (c) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** The index of the `close` that ends what opened at `start`, or -1. */
function findClose(text, start, end, close) {
  const i = text.indexOf(close, start);
  return i >= 0 && i + close.length <= end ? i : -1;
}

/** The index of the bracket closing the one at `open`, counting nesting, or -1. */
function matchBracket(text, open, end, o = '[', c = ']') {
  let depth = 0;
  for (let i = open; i < end; i++) {
    const ch = text[i];
    if (ch === '\\') { i++; continue; }
    if (ch === o) depth++;
    else if (ch === c && --depth === 0) return i;
  }
  return -1;
}

/** Where a strong or emphasis run that opened at `start` with `d` closes. */
function findDelim(text, start, end, d) {
  for (let i = start; i <= end - d.length; i++) {
    const ch = text[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '`') { const c = findClose(text, i + 1, end, '`'); if (c > 0) { i = c; continue; } }
    if (text.startsWith(d, i) && !isSpace(text[i - 1]) && i > start) {
      // an underscore run closes only at a word's end; a lone * or _ must not be
      // the start of a ** or __ (that is another run's tag)
      if (d[0] === '_' && isWordChar(text[i + d.length])) continue;
      if (d.length === 1 && text[i + 1] === d) { i++; continue; }
      return i;
    }
  }
  return -1;
}

const node = (type, from, to, tags, inner, children = [], data = undefined) =>
  (data ? { type, from, to, tags, inner, children, data } : { type, from, to, tags, inner, children });

/**
 * The inline markup of text[from, to).
 * @returns {Inline[]}  every run of markup, in order; plain text between them is not listed
 */
// the characters a run of markup can begin with: any other is plain text
const STARTS = new Set(['\\', '`', '%', '{', '^', '!', '[', '*', '_', '=', '~', '$', 'h', 'w']);

export function parseInline(text, from, to) {
  const out = [];
  let i = from;
  while (i < to) {
    if (!STARTS.has(text[i])) { i++; continue; }
    const c = text[i], c2 = text.slice(i, i + 2), c3 = text.slice(i, i + 3);
    let j;
    if (c === '\\' && i + 1 < to && /[\\`*_{}[\]()#+\-.!|=~^%$<>:]/u.test(text[i + 1])) {
      out.push(node('escape', i, i + 2, [[i, i + 1]], [i + 1, i + 2]));
      i += 2;
      continue;
    }
    if (c === '`') {
      let run = 1;
      while (text[i + run] === '`') run++;
      const fence = '`'.repeat(run);
      j = findClose(text, i + run, to, fence);
      if (j >= 0) {
        out.push(node('code', i, j + run, [[i, i + run], [j, j + run]], [i + run, j]));
        i = j + run;
        continue;
      }
    }
    if (c2 === '%%') {
      j = findClose(text, i + 2, to, '%%');
      const end = j >= 0 ? j + 2 : to;
      out.push(node('comment', i, end, j >= 0 ? [[i, i + 2], [j, j + 2]] : [[i, i + 2]], [i + 2, j >= 0 ? j : to]));
      i = end;
      continue;
    }
    if (c === '{' && ['{++', '{--', '{~~', '{==', '{>>'].includes(c3)) {
      const closeTag = { '{++': '++}', '{--': '--}', '{~~': '~~}', '{==': '==}', '{>>': '<<}' }[c3];
      j = findClose(text, i + 3, to, closeTag);
      if (j >= 0) {
        const end = j + 3;
        if (c3 === '{~~') {
          const arrow = findClose(text, i + 3, j, '~>');
          if (arrow >= 0) {
            out.push(node('subst', i, end, [[i, i + 3], [arrow, arrow + 2], [j, end]], [i + 3, j],
              [...parseInline(text, i + 3, arrow)], { old: [i + 3, arrow], new: [arrow + 2, j] }));
            i = end;
            continue;
          }
        }
        if (c3 === '{==') {
          // a highlight with a note straight after it is an annotation
          if (text.startsWith('{>>', end)) {
            const k = findClose(text, end + 3, to, '<<}');
            if (k >= 0) {
              out.push(node('annotation', i, k + 3, [[i, i + 3], [j, end], [end, end + 3], [k, k + 3]], [i + 3, j],
                parseInline(text, i + 3, j), { note: [end + 3, k] }));
              i = k + 3;
              continue;
            }
          }
          out.push(node('cmark', i, end, [[i, i + 3], [j, end]], [i + 3, j], parseInline(text, i + 3, j)));
          i = end;
          continue;
        }
        const type = { '{++': 'insert', '{--': 'delete', '{>>': 'note' }[c3];
        out.push(node(type, i, end, [[i, i + 3], [j, end]], [i + 3, j], type === 'note' ? [] : parseInline(text, i + 3, j)));
        i = end;
        continue;
      }
    }
    if (c2 === '^[') {
      j = matchBracket(text, i + 1, to);
      if (j >= 0) {
        out.push(node('footnote', i, j + 1, [[i, i + 2], [j, j + 1]], [i + 2, j], parseInline(text, i + 2, j)));
        i = j + 1;
        continue;
      }
    }
    if (c2 === '![') {
      j = matchBracket(text, i + 1, to);
      if (j >= 0 && text[j + 1] === '(') {
        const k = matchBracket(text, j + 1, to, '(', ')');
        if (k >= 0) {
          const { url, title } = splitTarget(text.slice(j + 2, k));
          out.push(node('image', i, k + 1, [[i, i + 2], [j, k + 1]], [i + 2, j], [], { url, title, target: [j + 2, k] }));
          i = k + 1;
          continue;
        }
      }
    }
    if (c2 === '[[') {
      j = findClose(text, i + 2, to, ']]');
      if (j >= 0) {
        const inner = text.slice(i + 2, j);
        const bar = inner.indexOf('|');
        out.push(node('wikilink', i, j + 2, [[i, i + 2], [j, j + 2]], [i + 2, j], [],
          { target: bar >= 0 ? inner.slice(0, bar) : inner, label: bar >= 0 ? [i + 2 + bar + 1, j] : [i + 2, j] }));
        i = j + 2;
        continue;
      }
    }
    if (c === '[') {
      j = matchBracket(text, i, to);
      if (j >= 0 && text[j + 1] === '(') {
        const k = matchBracket(text, j + 1, to, '(', ')');
        if (k >= 0) {
          const { url, title } = splitTarget(text.slice(j + 2, k));
          out.push(node('link', i, k + 1, [[i, i + 1], [j, k + 1]], [i + 1, j], parseInline(text, i + 1, j), { url, title, target: [j + 2, k] }));
          i = k + 1;
          continue;
        }
      }
    }
    if ((c2 === '**' || c2 === '__') && !isSpace(text[i + 2])) {
      if (!(c === '_' && isWordChar(text[i - 1]))) {
        j = findDelim(text, i + 2, to, c2);
        if (j >= 0) {
          out.push(node('strong', i, j + 2, [[i, i + 2], [j, j + 2]], [i + 2, j], parseInline(text, i + 2, j)));
          i = j + 2;
          continue;
        }
      }
    }
    if ((c === '*' || c === '_') && text[i + 1] !== c && !isSpace(text[i + 1])) {
      if (!(c === '_' && isWordChar(text[i - 1]))) {
        j = findDelim(text, i + 1, to, c);
        if (j >= 0) {
          out.push(node('em', i, j + 1, [[i, i + 1], [j, j + 1]], [i + 1, j], parseInline(text, i + 1, j)));
          i = j + 1;
          continue;
        }
      }
    }
    if (c2 === '==' && !isSpace(text[i + 2])) {
      j = findClose(text, i + 2, to, '==');
      if (j > i + 2 && !isSpace(text[j - 1])) {
        out.push(node('mark', i, j + 2, [[i, i + 2], [j, j + 2]], [i + 2, j], parseInline(text, i + 2, j)));
        i = j + 2;
        continue;
      }
    }
    if (c2 === '~~' && !isSpace(text[i + 2])) {
      j = findClose(text, i + 2, to, '~~');
      if (j > i + 2 && !isSpace(text[j - 1])) {
        out.push(node('strike', i, j + 2, [[i, i + 2], [j, j + 2]], [i + 2, j], parseInline(text, i + 2, j)));
        i = j + 2;
        continue;
      }
    }
    if (c === '$' && text[i + 1] !== '$' && !isSpace(text[i + 1])) {
      j = text.indexOf('$', i + 1);
      if (j > i + 1 && j < to && !isSpace(text[j - 1]) && !/\d/u.test(text[j + 1] || '')) {
        out.push(node('math', i, j + 1, [[i, i + 1], [j, j + 1]], [i + 1, j]));
        i = j + 1;
        continue;
      }
    }
    if ((c === 'h' || c === 'w') && (text.startsWith('https://', i) || text.startsWith('http://', i) || text.startsWith('www.', i))
        && (i === from || /[\s(<]/u.test(text[i - 1]))) {
      let k = i;
      while (k < to && !/[\s<>]/u.test(text[k])) k++;
      while (k > i && /[.,;:!?)'"\]]/u.test(text[k - 1])) k--;
      out.push(node('url', i, k, [], [i, k], [], { url: text.slice(i, k) }));
      i = k;
      continue;
    }
    i++;
  }
  return out;
}

/** A link's (url "title") as its parts. */
function splitTarget(t) {
  const m = /^\s*<?([^\s>]*)>?(?:\s+["'(](.*)["')])?\s*$/su.exec(t);
  return m ? { url: m[1], title: m[2] || '' } : { url: t.trim(), title: '' };
}

// ---- reading it back as text ----------------------------------------------------

/** What a reader of the finished text sees of an inline run: no tags, and none
 *  of what is only for the writer (comments, deletions, notes). */
export function plainInline(text, from, to, nodes, opts = {}) {
  let out = '';
  let i = from;
  for (const n of nodes) {
    if (n.from < i) continue;
    out += text.slice(i, n.from);
    out += plainNode(text, n, opts);
    i = n.to;
  }
  return out + text.slice(i, to);
}

function plainNode(text, n, opts) {
  switch (n.type) {
    case 'comment': case 'delete': case 'note': return opts.writer ? text.slice(n.inner[0], n.inner[1]) : '';
    case 'footnote': return opts.footnotes ? plainInline(text, n.inner[0], n.inner[1], n.children, opts) : '';
    case 'image': return opts.images ? text.slice(n.inner[0], n.inner[1]) : '';
    case 'escape': return text.slice(n.inner[0], n.inner[1]);
    case 'math': return opts.math ? text.slice(n.inner[0], n.inner[1]) : '';
    case 'subst': return plainInline(text, n.data.new[0], n.data.new[1], parseInline(text, n.data.new[0], n.data.new[1]), opts);
    case 'wikilink': return text.slice(n.data.label[0], n.data.label[1]);
    case 'url': case 'code': return text.slice(n.inner[0], n.inner[1]);
    default: return n.inner ? plainInline(text, n.inner[0], n.inner[1], n.children, opts) : text.slice(n.from, n.to);
  }
}

/** A line's text as a reader sees it (headings' and lists' tags gone). */
export function plainLine(text, L, opts = {}) {
  switch (L.type) {
    case 'empty': case 'divider': case 'fence': case 'toc': return '';
    case 'comment': {
      const own = opts.writer ? text.slice(L.content[0], L.content[1]) : '';
      return L.after ? own + plainInline(text, L.tag[1], L.to, L.after, opts) : own;
    }
    case 'math': return '';
    case 'code': return opts.code === false ? '' : text.slice(L.from, L.to);
    case 'table': return L.row === 'rule' ? '' : plainInline(text, L.from, L.to, L.inline, opts).replace(/\s*\|\s*/gu, ' ').trim();
    default: return plainInline(text, L.content[0], L.content[1], L.inline, opts);
  }
}
