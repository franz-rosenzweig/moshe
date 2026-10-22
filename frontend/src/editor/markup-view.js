// The editor's reading of the text: Moshe's markup (engine/src/markup.js)
// shown as you write. Tags stay in the text, where the
// cursor can reach them, but greyed; what they enclose is styled. A
// heading's #s hang in the margin. A link's address, a footnote and an
// annotation's note fold away into a small mark until the cursor goes into
// them (or a click opens them in a popover).
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import { EditorSelection, EditorState, StateField } from '@codemirror/state';
import { parseLines } from '@engine/markup.js';

// ---- measuring the tags that hang in the margin ----------------------------------

let canvas = null;
const widths = new Map();
/** How wide a tag is in the editor's font at its base size, in pixels. */
export function tagWidth(text, font) {
  const key = font + '\u0000' + text;
  let w = widths.get(key);
  if (w === undefined) {
    canvas = canvas || document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = font;
    w = ctx.measureText(text).width;
    widths.set(key, w);
  }
  return w;
}

// ---- widgets ---------------------------------------------------------------------------

class Mark extends WidgetType {
  constructor(text, cls, title = '', data = null) { super(); this.text = text; this.cls = cls; this.title = title; this.data = data; }
  eq(o) { return o.text === this.text && o.cls === this.cls && o.title === this.title; }
  toDOM() {
    const s = document.createElement('span');
    s.className = this.cls;
    s.textContent = this.text;
    if (this.title) s.title = this.title;
    if (this.data) for (const [k, v] of Object.entries(this.data)) s.dataset[k] = v;
    return s;
  }
  ignoreEvent() { return false; }
}

class ImageWidget extends WidgetType {
  constructor(src, alt, lines, color) { super(); this.src = src; this.alt = alt; this.lines = lines; this.color = color; }
  eq(o) { return o.src === this.src && o.alt === this.alt && o.lines === this.lines && o.color === this.color; }
  toDOM() {
    const box = document.createElement('div');
    box.className = 'cm-imgbox';
    const img = document.createElement('img');
    img.src = this.src;
    img.alt = this.alt;
    img.style.maxHeight = `calc(${this.lines} * var(--ed-lh))`;
    if (!this.color) img.style.filter = 'grayscale(1)';
    img.onerror = () => { box.classList.add('broken'); box.textContent = this.alt || 'image'; };
    box.appendChild(img);
    if (this.alt) { const c = document.createElement('span'); c.className = 'cm-imgcap'; c.textContent = this.alt; box.appendChild(c); }
    return box;
  }
}

// ---- building the decorations ----------------------------------------------------------

const HEAD_CLS = ['', 'cm-h1', 'cm-h2', 'cm-h3', 'cm-h4', 'cm-h5', 'cm-h6'];
const autoDir = Decoration.line({ attributes: { dir: 'auto' } });

/**
 * @param {object} cfg  {font: string (CSS font of the body text), imageUrl: (path) => string,
 *                        imagePreviews, imageLines, imageColor, firstLineIndent}
 */
export function markup(cfg) {
  const inside = (sel, from, to) => sel.ranges.some((r) => r.from <= to && r.to >= from);

  function build(view) {
    const state = view.state;
    const doc = state.doc.toString();
    // only what is on the screen (and a screen's worth either side) is read in full
    let vFrom = state.doc.length, vTo = 0;
    for (const r of view.visibleRanges) { vFrom = Math.min(vFrom, r.from); vTo = Math.max(vTo, r.to); }
    if (vTo < vFrom) { vFrom = 0; vTo = Math.min(state.doc.length, 5000); }
    const span = Math.max(3000, vTo - vFrom);
    const lines = parseLines(doc, { from: Math.max(0, vFrom - span), to: Math.min(doc.length, vTo + span) });
    const sel = state.selection;
    const out = [];
    const add = (from, to, deco) => { if (to > from || deco.point || deco.spec.widget) out.push(deco.range(from, to)); };
    const mark = (from, to, cls) => { if (to > from) out.push(Decoration.mark({ class: cls }).range(from, to)); };
    // every line finds its own direction (dir=auto): a Hebrew paragraph runs
    // right to left, its heading's #s hang in the right margin
    const decorated = new Set();
    const lineDeco = (L, cls, style = '') => {
      decorated.add(L.from);
      out.push(Decoration.line({ class: cls, attributes: style ? { style, dir: 'auto' } : { dir: 'auto' } }).range(L.from));
    };
    const font = cfg.font();

    const inline = (nodes) => {
      for (const n of nodes) {
        const tags = () => { for (const [a, b] of n.tags) mark(a, b, 'cm-tag'); };
        const open = inside(sel, n.from, n.to);
        switch (n.type) {
          case 'strong': tags(); mark(n.inner[0], n.inner[1], 'cm-strong'); break;
          case 'em': tags(); mark(n.inner[0], n.inner[1], 'cm-em'); break;
          case 'mark': for (const [a, b] of n.tags) mark(a, b, 'cm-tag cm-mark-tag'); mark(n.from, n.to, 'cm-mark'); break;
          case 'strike': tags(); mark(n.inner[0], n.inner[1], 'cm-strike'); break;
          case 'code': for (const [a, b] of n.tags) mark(a, b, 'cm-tag cm-code-tag'); mark(n.from, n.to, 'cm-code'); break;
          case 'math': for (const [a, b] of n.tags) mark(a, b, 'cm-tag'); mark(n.inner[0], n.inner[1], 'cm-math'); break;
          case 'comment': case 'note': for (const [a, b] of n.tags) mark(a, b, 'cm-tag cm-comment-tag'); mark(n.inner[0], n.inner[1], 'cm-comment'); mark(n.from, n.to, 'cm-comment-bg'); break;
          case 'delete': for (const [a, b] of n.tags) mark(a, b, 'cm-tag cm-comment-tag'); mark(n.inner[0], n.inner[1], 'cm-delete'); break;
          case 'insert': for (const [a, b] of n.tags) mark(a, b, 'cm-tag'); mark(n.inner[0], n.inner[1], 'cm-insert'); break;
          case 'subst': {
            for (const [a, b] of n.tags) mark(a, b, 'cm-tag');
            mark(n.data.old[0], n.data.old[1], 'cm-delete');
            mark(n.data.new[0], n.data.new[1], 'cm-insert');
            break;
          }
          case 'cmark': for (const [a, b] of n.tags) mark(a, b, 'cm-tag'); mark(n.inner[0], n.inner[1], 'cm-annot'); break;
          case 'annotation': {
            const note = doc.slice(n.data.note[0], n.data.note[1]);
            if (open) {
              for (const [a, b] of n.tags) mark(a, b, 'cm-tag cm-annot-tag');
              mark(n.inner[0], n.inner[1], 'cm-annot');
              mark(n.data.note[0], n.data.note[1], 'cm-annot-note');
            } else {
              add(n.from, n.inner[0], Decoration.replace({}));
              out.push(Decoration.mark({ class: 'cm-annot', attributes: { title: note, 'data-annot': String(n.from) } }).range(n.inner[0], n.inner[1]));
              add(n.inner[1], n.to, Decoration.replace({}));
            }
            inline(n.children);
            continue;
          }
          case 'footnote': {
            if (open) { for (const [a, b] of n.tags) mark(a, b, 'cm-tag cm-fn-tag'); mark(n.inner[0], n.inner[1], 'cm-fn'); inline(n.children); }
            else add(n.from, n.to, Decoration.replace({ widget: new Mark('＊', 'cm-fnmark', doc.slice(n.inner[0], n.inner[1]), { fn: String(n.from) }) }));
            continue;
          }
          case 'link': {
            if (open) {
              for (const [a, b] of n.tags) mark(a, b, 'cm-tag cm-link-tag');
              mark(n.data.target[0], n.data.target[1], 'cm-link-url');
            } else {
              add(n.tags[0][0], n.tags[0][1], Decoration.replace({ widget: new Mark('°°', 'cm-linkmark') }));
              add(n.tags[1][0], n.tags[1][1], Decoration.replace({ widget: new Mark('°°', 'cm-linkmark', n.data.url, { link: String(n.from) }) }));
            }
            out.push(Decoration.mark({ class: 'cm-link', attributes: { title: n.data.url, 'data-href': n.data.url, 'data-link': String(n.from) } }).range(n.inner[0], n.inner[1]));
            inline(n.children);
            continue;
          }
          case 'wikilink': for (const [a, b] of n.tags) mark(a, b, 'cm-tag cm-link-tag'); mark(n.inner[0], n.inner[1], 'cm-link cm-wikilink'); break;
          case 'url': out.push(Decoration.mark({ class: 'cm-link cm-url', attributes: { 'data-href': n.data.url } }).range(n.from, n.to)); break;
          case 'image': {
            for (const [a, b] of n.tags) mark(a, b, 'cm-tag cm-img-tag');
            mark(n.inner[0], n.inner[1], 'cm-img-alt');
            if (!open) mark(n.data.target[0], n.data.target[1], 'cm-img-url');
            break;
          }
          case 'escape': mark(n.from, n.from + 1, 'cm-tag'); break;
          default: break;
        }
        if (n.children && n.children.length) inline(n.children);
      }
    };

    for (const L of lines) {
      switch (L.type) {
        case 'heading': {
          const w = tagWidth(doc.slice(L.tag[0], L.tag[1]), font);
          lineDeco(L, `cm-heading ${HEAD_CLS[L.level]}`, `text-indent:-${w.toFixed(1)}px;--hang:${w.toFixed(1)}px`);
          mark(L.tag[0], L.tag[1], 'cm-tag cm-tag-h');
          break;
        }
        case 'list': {
          const tag = doc.slice(L.from + L.indent, L.tag[1]);
          const w = tagWidth(tag, font);
          const lead = L.depth * 1.5;
          lineDeco(L, `cm-list${L.task === 'done' ? ' cm-task-done' : ''}`, `padding-inline-start:calc(${lead}em + ${w.toFixed(1)}px + 1.2em);text-indent:-${w.toFixed(1)}px`);
          if (L.indent) add(L.from, L.from + L.indent, Decoration.replace({}));
          mark(L.from + L.indent, L.tag[1], 'cm-tag cm-list-tag');
          break;
        }
        case 'quote': {
          const w = tagWidth(doc.slice(L.tag[0], L.tag[1]), font);
          lineDeco(L, 'cm-quote', `text-indent:-${w.toFixed(1)}px;--hang:${w.toFixed(1)}px`);
          mark(L.tag[0], L.tag[1], 'cm-tag cm-quote-tag');
          break;
        }
        case 'divider': lineDeco(L, 'cm-divider'); mark(L.from, L.to, 'cm-divider-tag'); break;
        case 'fence': lineDeco(L, `cm-codeblock cm-fence${L.open ? ' cm-fence-open' : ' cm-fence-close'}`); mark(L.from, L.to, 'cm-tag cm-code-tag'); break;
        case 'code': lineDeco(L, 'cm-codeblock'); break;
        case 'math': lineDeco(L, 'cm-mathblock'); break;
        case 'comment': {
          lineDeco(L, 'cm-commentblock');
          if (L.tags) for (const [a, b] of L.tags) mark(a, b, 'cm-tag cm-comment-tag');
          else if (L.tag) mark(L.tag[0], L.tag[1], 'cm-tag cm-comment-tag');
          mark(L.content[0], L.content[1], 'cm-comment');
          if (L.after) inline(L.after);
          break;
        }
        case 'toc': lineDeco(L, 'cm-toc'); mark(L.from, L.to, 'cm-tag cm-toc-tag'); break;
        case 'table': lineDeco(L, `cm-table${L.row === 'rule' ? ' cm-table-rule' : ''}`); break;
        case 'image': lineDeco(L, 'cm-imageline'); break;
        case 'paragraph': if (cfg.firstLineIndent()) lineDeco(L, 'cm-para', `text-indent:${cfg.firstLineIndent()}em`); break;
        default: break;
      }
      if (L.type === 'table') {
        for (let i = L.from; i < L.to; i++) if (doc[i] === '|') mark(i, i + 1, 'cm-tag cm-table-bar');
      }
      if (L.inline && L.inline.length) inline(L.inline);
      if (!decorated.has(L.from)) out.push(autoDir.range(L.from));
    }
    return Decoration.set(out, true);
  }

  // an image on a line of its own: its preview below it. A block widget, so a
  // state field's (CodeMirror takes no block decorations from a plugin)
  const IMAGE_LINE = /^\s*!\[([^\]\n]*)\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)\s*$/u;
  const buildImages = (state) => {
    if (!cfg.imagePreviews()) return Decoration.none;
    const out = [];
    for (let n = 1; n <= state.doc.lines; n++) {
      const line = state.doc.line(n);
      if (line.length > 2000 || !line.text.includes('![')) continue;
      const m = IMAGE_LINE.exec(line.text);
      if (!m) continue;
      const src = cfg.imageUrl(m[2]);
      if (src) out.push(Decoration.widget({ widget: new ImageWidget(src, m[1], cfg.imageLines(), cfg.imageColor()), side: 1, block: true }).range(line.to));
    }
    return Decoration.set(out);
  };
  const images = StateField.define({
    create: buildImages,
    update: (value, tr) => (tr.docChanged || tr.reconfigured ? buildImages(tr.state) : value),
    provide: (f) => EditorView.decorations.from(f),
  });

  return [
    images,
    ViewPlugin.fromClass(class {
      constructor(view) { this.decorations = build(view); }
      update(u) {
        if (u.docChanged || u.selectionSet || u.viewportChanged || u.transactions.some((t) => t.reconfigured)) this.decorations = build(u.view);
      }
    }, { decorations: (v) => v.decorations }),
  ];
}

// ---- short tags ---------------------------------------------------------------

/** Short tags typed, the file's written: :: → ==, ++ → %%, || → {-- … --}. */
export const shortTags = EditorView.inputHandler.of((view, from, to, text) => {
  if (text.length !== 1 || from !== to) return false;
  const before = view.state.doc.sliceString(Math.max(0, from - 1), from);
  const line = view.state.doc.lineAt(from);
  const upto = view.state.doc.sliceString(line.from, from - 1);
  let insert = null, replaceFrom = from - 1;
  if (text === ':' && before === ':') insert = '==';
  else if (text === '+' && before === '+' && !/\{$/u.test(upto)) insert = '%%';
  else if (text === '|' && before === '|') {
    const opens = (upto.match(/\{--/gu) || []).length, closes = (upto.match(/--\}/gu) || []).length;
    insert = opens > closes ? '--}' : '{--';
  }
  if (insert === null) return false;
  view.dispatch({ changes: { from: replaceFrom, to, insert }, selection: { anchor: replaceFrom + insert.length }, userEvent: 'input.type' });
  return true;
});

/** (fn), (img), (tbl), (toc) typed: the construct they stand for. */
export const shortInserts = (onFootnote) => EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== ')' || from !== to) return false;
  const line = view.state.doc.lineAt(from);
  const upto = view.state.doc.sliceString(line.from, from);
  const m = /\((fn|img|tbl|toc)$/u.exec(upto);
  if (!m) return false;
  const start = from - m[0].length;
  const kinds = {
    fn: { insert: '^[]', cursor: 2 },
    img: { insert: '![]()', cursor: 4 },
    tbl: { insert: '| Column | Column | Column |\n| --- | --- | --- |\n| Lorem | Ipsum | Dolor |\n| Lorem | Ipsum | Dolor |', cursor: 2 },
    toc: { insert: '(toc)', cursor: 5 },
  };
  const k = kinds[m[1]];
  view.dispatch({ changes: { from: start, to, insert: k.insert }, selection: { anchor: start + k.cursor }, userEvent: 'input.type' });
  if (m[1] === 'fn' && onFootnote) onFootnote(start);
  return true;
});

// ---- commands ------------------------------------------------------------------------

/** Wrap the selection in a tag (or unwrap it if it already is); with nothing
 *  selected, put the two halves in and the cursor between them. */
export function toggleWrap(view, open, close = open) {
  const { state } = view;
  const changes = state.changeByRange((r) => {
    const text = state.sliceDoc(r.from, r.to);
    const before = state.sliceDoc(r.from - open.length, r.from), after = state.sliceDoc(r.to, r.to + close.length);
    if (before === open && after === close) {
      return { changes: [{ from: r.from - open.length, to: r.from }, { from: r.to, to: r.to + close.length }], range: EditorSelection.range(r.from - open.length, r.to - open.length) };
    }
    if (text.startsWith(open) && text.endsWith(close) && text.length >= open.length + close.length) {
      return { changes: { from: r.from, to: r.to, insert: text.slice(open.length, text.length - close.length) }, range: EditorSelection.range(r.from, r.to - open.length - close.length) };
    }
    return { changes: { from: r.from, to: r.to, insert: open + text + close }, range: r.empty ? EditorSelection.cursor(r.from + open.length) : EditorSelection.range(r.from + open.length, r.to + open.length) };
  });
  view.dispatch(state.update(changes, { scrollIntoView: true, userEvent: 'input' }));
  return true;
}

/** The paragraph's heading level set (0: none), or raised/lowered by one. */
export function setHeading(view, level) {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const m = /^(#{1,6})[ \t]+/u.exec(line.text);
  const cur = m ? m[1].length : 0;
  let next = level;
  if (level === '+') next = cur === 0 ? 1 : Math.max(1, cur - 1);
  if (level === '-') next = cur === 0 ? 0 : cur >= 6 ? 0 : cur + 1;
  const tag = next ? '#'.repeat(next) + ' ' : '';
  view.dispatch({ changes: { from: line.from, to: line.from + (m ? m[0].length : 0), insert: tag }, userEvent: 'input' });
  return true;
}

/** The paragraph's block tag changed: '- ', '1. ', '> ', '%% ' toggled. */
export function toggleBlock(view, tag) {
  const { state } = view;
  const changes = [];
  const seen = new Set();
  for (const r of state.selection.ranges) {
    for (let pos = r.from; pos <= r.to;) {
      const line = state.doc.lineAt(pos);
      if (!seen.has(line.from)) {
        seen.add(line.from);
        const m = /^(?:[-*+]\s|\d+[.)]\s|>\s?|%%\s?)/u.exec(line.text);
        if (m && m[0].trim() === tag.trim()) changes.push({ from: line.from, to: line.from + m[0].length });
        else changes.push({ from: line.from, to: line.from + (m ? m[0].length : 0), insert: tag });
      }
      pos = line.to + 1;
    }
  }
  view.dispatch({ changes, userEvent: 'input' });
  return true;
}

/** Return in a list item: the next item, numbered on; in an empty one, the list ends. */
export function smartEnter(view) {
  const { state } = view;
  if (!state.selection.main.empty) return false;
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  const m = /^([ \t]*)([-*+•]|(\d{1,9})([.)]))([ \t]+)(\[[ xX]\][ \t]+)?/u.exec(line.text);
  if (!m) {
    const q = /^((?:>[ \t]?)+)/u.exec(line.text);
    if (q && pos === line.to) {
      if (line.text.trim() === q[1].trim()) { endBlock(view, line); return true; }
      view.dispatch({ changes: { from: pos, insert: '\n' + q[1] }, selection: { anchor: pos + 1 + q[1].length }, scrollIntoView: true, userEvent: 'input' });
      return true;
    }
    return false;
  }
  if (pos < line.from + m[0].length) return false;
  if (line.text.slice(m[0].length).trim() === '') {
    if (m[1]) return indentList(view, true);      // an empty item deeper in: one level out
    endBlock(view, line);
    return true;
  }
  const marker = m[3] ? `${Number(m[3]) + 1}${m[4]}` : m[2];
  const next = `${m[1]}${marker}${m[5]}${m[6] ? '[ ] ' : ''}`;
  view.dispatch({ changes: { from: pos, to: pos, insert: '\n' + next }, selection: { anchor: pos + 1 + next.length }, scrollIntoView: true, userEvent: 'input' });
  return true;
}

/** The empty last item of a list (or line of a quote) gone, and a blank line
 *  left after the block: other Markdown readers would otherwise take the
 *  paragraph that follows as more of its last item. */
function endBlock(view, line) {
  const above = line.number > 1 ? view.state.doc.line(line.number - 1).text : '';
  const insert = above.trim() ? '\n' : '';
  view.dispatch({ changes: { from: line.from, to: line.to, insert }, selection: { anchor: line.from + insert.length }, scrollIntoView: true, userEvent: 'input' });
}

const LIST_ITEM = /^[ \t]*([-*+•]|\d{1,9}[.)])[ \t]/u;

/** Tab in a list item: one level deeper (Shift: one up), every item selected. */
export function indentList(view, out = false) {
  const { state } = view;
  const changes = [];
  const seen = new Set();
  for (const r of state.selection.ranges) {
    for (let pos = r.from; pos <= r.to;) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      if (seen.has(line.from) || !LIST_ITEM.test(line.text)) continue;
      seen.add(line.from);
      if (!out) changes.push({ from: line.from, insert: '\t' });
      else {
        const m = /^(\t| {1,4})/u.exec(line.text);
        if (m) changes.push({ from: line.from, to: line.from + m[0].length });
      }
    }
  }
  if (!seen.size) return false;
  if (changes.length) view.dispatch({ changes, userEvent: 'input' });
  return true;
}

// ---- tables: Tab from cell to cell

const TABLE_RULE = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/u;
const hasPipe = (t) => /(^|[^\\])\|/u.test(t);
const isRule = (t) => hasPipe(t) && TABLE_RULE.test(t);

/** The line's table (its first and last line numbers), if it is in one. */
function tableAround(doc, n) {
  if (!hasPipe(doc.line(n).text)) return null;
  let a = n, b = n;
  while (a > 1 && hasPipe(doc.line(a - 1).text)) a--;
  while (b < doc.lines && hasPipe(doc.line(b).text)) b++;
  for (let i = a; i <= b; i++) if (isRule(doc.line(i).text)) return { first: a, last: b };
  return null;
}

/** A row's cells: where each is, and where its words are. */
function cellsOf(line) {
  const t = line.text, pipes = [];
  for (let i = 0; i < t.length; i++) { if (t[i] === '\\') i++; else if (t[i] === '|') pipes.push(i); }
  const edges = [...(/^[ \t]*\|/u.test(t) ? [] : [-1]), ...pipes, ...(/\|[ \t]*$/u.test(t) ? [] : [t.length])];
  const cells = [];
  for (let k = 0; k + 1 < edges.length; k++) {
    const a = edges[k] + 1, b = edges[k + 1], inner = t.slice(a, b);
    const lead = inner.length - inner.trimStart().length, words = inner.trim().length;
    cells.push({ from: line.from + a, to: line.from + b, text: words ? [line.from + a + lead, line.from + a + lead + words] : null, empty: line.from + a + Math.min(1, inner.length) });
  }
  return cells;
}

/** Tab in a table: the next cell (Shift: the one before), its words selected;
 *  past the last cell, a new row. */
export function tableTab(view, back = false) {
  const { state } = view;
  const head = state.selection.main.head, doc = state.doc;
  const line = doc.lineAt(head);
  const table = tableAround(doc, line.number);
  if (!table) return false;
  const go = (c) => {
    const range = c.text ? EditorSelection.range(c.text[0], c.text[1]) : EditorSelection.cursor(c.empty);
    view.dispatch({ selection: range, scrollIntoView: true, userEvent: 'select' });
    return true;
  };
  const rowCells = (n) => (isRule(doc.line(n).text) ? null : cellsOf(doc.line(n)));
  const here = isRule(line.text) ? [] : cellsOf(line);
  let k = -1;
  here.forEach((c, i) => { if (c.from <= head) k = i; });
  if (isRule(line.text)) k = back ? 0 : Infinity;
  if (!back) {
    if (k + 1 < here.length) return go(here[k + 1]);
    for (let n = line.number + 1; n <= table.last; n++) { const cs = rowCells(n); if (cs && cs.length) return go(cs[0]); }
    const cols = Math.max(1, here.length || cellsOf(doc.line(table.first)).length);
    const row = '|' + '  |'.repeat(cols);
    view.dispatch({ changes: { from: doc.line(table.last).to, insert: '\n' + row }, selection: { anchor: doc.line(table.last).to + 3 }, scrollIntoView: true, userEvent: 'input' });
    return true;
  }
  if (k - 1 >= 0 && k !== Infinity) return go(here[k - 1]);
  for (let n = line.number - 1; n >= table.first; n--) { const cs = rowCells(n); if (cs && cs.length) return go(cs[cs.length - 1]); }
  return true;
}

/** Tab in the editor never leaves it: a table's next cell, a list item one
 *  level in, or else a tab typed (Shift-Tab outside a list does nothing). */
export function tabKey(view, back = false) {
  if (tableTab(view, back) || indentList(view, back)) return true;
  if (!back) view.dispatch(view.state.replaceSelection('\t'), { scrollIntoView: true, userEvent: 'input.type' });
  return true;
}

export { EditorState };
