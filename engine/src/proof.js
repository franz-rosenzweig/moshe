// A sheet's prose for a proofreader (Harper in the page, LanguageTool on the
// server): each paragraph as a reader sees it, the markup's tags gone, with
// the place in the sheet every character came from, so what the checker
// finds can be shown, and fixed, in the text as written.
//
// Left out: code and math blocks, comment blocks, tables, dividers; in a
// paragraph, comments, deletions and pictures. A footnote and an annotation's
// note are read as paragraphs of their own. Inline code, addresses and
// equations stay in (so the words around them still read as a sentence) but
// are masked: nothing found inside them is reported.
import { parseLines, parseInline } from './markup.js';

const PROSE = new Set(['paragraph', 'heading', 'list', 'quote']);
const MASKED = new Set(['code', 'url', 'math']);
const HEBREW = /[֐-׿]/gu, LATIN = /[A-Za-z]/gu;

/**
 * @typedef {{ from: number, to: number, text: string, map: number[], mask: [number, number][], kind: string }} Prose
 *   `text` is what the checker reads; `map[i]` is where text[i] is in the
 *   sheet (map[text.length] is the paragraph's end); `mask` is ranges of
 *   `text` whose findings are dropped.
 */

/**
 * The prose of a sheet's body, paragraph by paragraph.
 * @param {string} body
 * @param {{from?: number, to?: number}} [range]  only the paragraphs that touch it
 * @param {{english?: boolean}} [opts]  english: leave out paragraphs mostly in another script (Harper reads only English)
 * @returns {Prose[]}
 */
export function proseOf(body, range = null, opts = {}) {
  const out = [];
  for (const L of parseLines(body, range)) {
    if (!PROSE.has(L.type)) continue;
    if (range && (L.to < (range.from ?? 0) || L.from > (range.to ?? body.length))) continue;
    const [a, b] = L.content;
    const w = new Writer(body, L.type);
    const extra = [];
    w.walk(a, b, L.inline || parseInline(body, a, b), extra);
    for (const p of [w.done(b), ...extra]) {
      if (!p.text.trim()) continue;
      if (opts.english && !mostlyLatin(p.text)) continue;
      out.push(p);
    }
  }
  return out;
}

function mostlyLatin(t) {
  const he = (t.match(HEBREW) || []).length, la = (t.match(LATIN) || []).length;
  return la > 0 && he <= la * 0.3;
}

class Writer {
  constructor(src, kind) {
    this.src = src;
    this.kind = kind;
    this.text = '';
    this.map = [];
    this.mask = [];
    this.gap = false;   // something was left out just now: a space after it is one too many
  }

  put(from, to) {
    for (let i = from; i < to; i++) {
      const c = this.src[i];
      // where a comment or a deletion was, keep one space, not two, and none before a comma
      if (this.gap && /\s/u.test(c) && (!this.text || /\s$/u.test(this.text))) continue;
      if (this.gap && /[,.;:!?…)\]}”’»]/u.test(c)) {
        const floor = this.mask.reduce((m, [, b]) => Math.max(m, b), 0);
        while (this.text.length > floor && /[ \t]$/u.test(this.text)) { this.text = this.text.slice(0, -1); this.map.pop(); }
      }
      this.gap = false;
      this.text += c;
      this.map.push(i);
    }
  }

  walk(from, to, nodes, extra) {
    let i = from;
    for (const n of nodes) {
      if (n.from < i) continue;
      this.put(i, n.from);
      this.node(n, extra);
      i = n.to;
    }
    this.put(i, to);
  }

  node(n, extra) {
    const src = this.src;
    switch (n.type) {
      case 'comment': case 'note': case 'delete': case 'image':
        this.gap = true;
        return;
      case 'footnote': {
        const w = new Writer(src, 'footnote');
        w.walk(n.inner[0], n.inner[1], n.children || parseInline(src, n.inner[0], n.inner[1]), extra);
        extra.push(w.done(n.inner[1]));
        this.gap = true;
        return;
      }
      case 'annotation': {
        this.walk(n.inner[0], n.inner[1], n.children || parseInline(src, n.inner[0], n.inner[1]), extra);
        if (n.data && n.data.note) {
          const [a, b] = n.data.note;
          const w = new Writer(src, 'note');
          w.walk(a, b, parseInline(src, a, b), extra);
          extra.push(w.done(b));
        }
        return;
      }
      case 'subst': {
        const [a, b] = n.data.new;
        this.walk(a, b, parseInline(src, a, b), extra);
        return;
      }
      case 'wikilink': this.put(n.data.label[0], n.data.label[1]); return;
      case 'escape': this.put(n.inner[0], n.inner[1]); return;
      default:
        if (MASKED.has(n.type)) {
          const at = this.text.length;
          if (n.inner) this.put(n.inner[0], n.inner[1]); else this.put(n.from, n.to);
          if (this.text.length > at) this.mask.push([at, this.text.length]);
          return;
        }
        if (n.inner) this.walk(n.inner[0], n.inner[1], n.children || [], extra);
        else this.put(n.from, n.to);
    }
  }

  done(end) {
    const text = this.text.replace(/\s+$/u, '');
    const map = this.map.slice(0, text.length);
    map.push(text.length < this.text.length ? this.map[text.length] : end);
    const first = map.length ? map[0] : end;
    return { from: first, to: map[map.length - 1], text, map, mask: this.mask.filter(([a]) => a < text.length), kind: this.kind };
  }
}

/**
 * A finding in a paragraph's prose, placed in the sheet: from, to. Null when
 * it falls in a masked part.
 */
export function placeFinding(p, start, end) {
  if (p.mask.some(([a, b]) => start < b && end > a)) return null;
  const s = Math.max(0, Math.min(start, p.text.length)), e = Math.max(s, Math.min(end, p.text.length));
  const from = p.map[s];
  const to = e > s ? p.map[e - 1] + 1 : from;
  return { from, to };
}
