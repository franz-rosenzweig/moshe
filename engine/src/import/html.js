// An HTML page read into Moshe's markup: headings, paragraphs, bold and
// italic, links, lists, quotes, line breaks, pictures, code and tables, which
// is what a page saved from a browser, an e-mail or Word's "Web Page" holds.
// There is no DOM in Node, so the page is read by a small tolerant parser of
// its own that closes what HTML lets a writer leave open (<p>, <li>, <td>…)
// and skips what is not text (scripts, styles, forms). Pictures given in the
// page itself (data: addresses) come back as files; others keep their address.
import { MarkupWriter, B, I, S, H, C, plainItems } from './writer.js';

/** @typedef {import('./writer.js').Item} Item @typedef {import('./writer.js').Block} Block
 *  @typedef {{tag: string, attrs: Record<string, string>, children: Node[], text?: string}} Node */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr', 'keygen']);
const RAW = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'noscript', 'template']);
const SKIP = new Set(['head', 'script', 'style', 'template', 'noscript', 'svg', 'math', 'iframe', 'object', 'embed', 'select', 'textarea',
  'button', 'canvas', 'video', 'audio', 'map', 'input']);
const BLOCK = new Set(['address', 'article', 'aside', 'body', 'center', 'dd', 'details', 'dialog', 'div', 'dl', 'dt', 'fieldset', 'figcaption',
  'figure', 'footer', 'form', 'header', 'hgroup', 'html', 'main', 'nav', 'p', 'section', 'summary', 'caption', 'legend', 'menu']);
// a <p> ends where one of these begins
const ENDS_P = new Set([...BLOCK, 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'ol', 'ul', 'pre', 'table', 'li']);
const P_SCOPE = ['div', 'td', 'th', 'li', 'blockquote', 'section', 'article', 'body', 'table', 'ul', 'ol', 'dl', 'header', 'footer', 'main', 'aside', 'nav', 'figure', 'button'];

// the named character references a document is likely to use: Latin-1's, in code order, and some more
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ensp: ' ', emsp: ' ', thinsp: ' ', zwnj: '‌', zwj: '‍',
  lrm: '‎', rlm: '‏', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„', dagger: '†',
  Dagger: '‡', bull: '•', hellip: '…', permil: '‰', prime: '′', Prime: '″', lsaquo: '‹', rsaquo: '›', euro: '€', trade: '™', larr: '←',
  uarr: '↑', rarr: '→', darr: '↓', harr: '↔', minus: '−', le: '≤', ge: '≥', ne: '≠', infin: '∞', oelig: 'œ', OElig: 'Œ', scaron: 'š',
  Scaron: 'Š', fnof: 'ƒ', circ: 'ˆ', tilde: '˜', alefsym: 'ℵ', check: '✓' };
'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'
  .split(' ').forEach((name, k) => { ENTITIES[name] = String.fromCharCode(0xA0 + k); });

/** Character references resolved; one it does not know is left as written. */
export function decodeEntities(s) {
  if (!s.includes('&')) return s;
  return s.replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]{1,31});/gu, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code <= 0x10FFFF ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

/**
 * An HTML page as a tree, the way a browser would forgive it.
 * @param {string} src
 * @returns {{root: Node, title: string}}
 */
export function parseHtml(src) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  let title = '';
  const top = () => stack[stack.length - 1];
  const text = (t) => {
    if (!t) return;
    const kids = top().children;
    const last = kids[kids.length - 1];
    if (last && last.tag === '#text') last.text += decodeEntities(t);
    else kids.push({ tag: '#text', attrs: {}, children: [], text: decodeEntities(t) });
  };
  /** Closes the nearest open `names`, unless one of `stops` is nearer. */
  const closeTo = (names, stops) => {
    for (let k = stack.length - 1; k > 0; k--) {
      const t = stack[k].tag;
      if (names.includes(t)) { stack.length = k; return; }
      if (stops.includes(t)) return;
    }
  };
  const ATTR = /\s*([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/uy;
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { text(src.slice(i)); break; }
    if (lt > i) text(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      const e = src.indexOf('-->', lt + 4);
      i = e < 0 ? src.length : e + 3;
      continue;
    }
    if (src[lt + 1] === '!' || src[lt + 1] === '?') {
      const e = src.indexOf('>', lt);
      i = e < 0 ? src.length : e + 1;
      continue;
    }
    if (src[lt + 1] === '/') {
      const m = /^<\/([a-zA-Z][\w:.-]*)[^>]*>/u.exec(src.slice(lt, lt + 256));
      if (!m) { text('<'); i = lt + 1; continue; }
      const name = m[1].toLowerCase();
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].tag === name) { stack.length = k; break; }
      i = lt + m[0].length;
      continue;
    }
    const m = /^<([a-zA-Z][\w:.-]*)/u.exec(src.slice(lt, lt + 128));
    if (!m) { text('<'); i = lt + 1; continue; }
    const name = m[1].toLowerCase();
    const attrs = {};
    let j = lt + m[0].length;
    while (j < src.length) {
      while (/\s/u.test(src[j] || '')) j++;
      if (src[j] === '>' || src.startsWith('/>', j) || j >= src.length) break;
      ATTR.lastIndex = j;
      const a = ATTR.exec(src);
      if (!a || !a[0]) { j++; continue; }
      attrs[a[1].toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '');
      j = ATTR.lastIndex;
    }
    const self = src.startsWith('/>', j);
    i = Math.min(src.length, j + (self ? 2 : 1));
    if (RAW.has(name)) {
      // its content is text to the end tag, not markup
      const re = new RegExp(`</${name}\\s*>`, 'giu');
      re.lastIndex = i;
      const end = self ? null : re.exec(src);
      if (name === 'title' && !title) title = decodeEntities(src.slice(i, end ? end.index : i)).replace(/\s+/gu, ' ').trim();
      if (!self) i = end ? re.lastIndex : src.length;
      continue;
    }
    if (name === 'li') closeTo(['li'], ['ul', 'ol', 'menu']);
    else if (name === 'dt' || name === 'dd') closeTo(['dt', 'dd'], ['dl']);
    else if (name === 'tr') closeTo(['tr'], ['table', 'tbody', 'thead', 'tfoot']);
    else if (name === 'td' || name === 'th') closeTo(['td', 'th'], ['tr', 'table']);
    else if (name === 'thead' || name === 'tbody' || name === 'tfoot') closeTo(['thead', 'tbody', 'tfoot'], ['table']);
    else if (name === 'option') closeTo(['option'], ['select']);
    if (ENDS_P.has(name)) closeTo(['p'], P_SCOPE);
    const el = { tag: name, attrs, children: [] };
    top().children.push(el);
    if (!VOID.has(name) && !self) stack.push(el);
  }
  return { root, title };
}

/** Formatting an element's style attribute adds or takes away. */
function styled(f, style) {
  if (!style) return f;
  const s = style.toLowerCase();
  const w = /font-weight\s*:\s*([a-z0-9]+)/u.exec(s);
  if (w) f = /^(bold|bolder|[6-9]00)$/u.test(w[1]) ? f | B : /^(normal|lighter|[1-5]00)$/u.test(w[1]) ? f & ~B : f;
  const it = /font-style\s*:\s*([a-z]+)/u.exec(s);
  if (it) f = it[1] === 'italic' || it[1] === 'oblique' ? f | I : it[1] === 'normal' ? f & ~I : f;
  if (/text-decoration(?:-line)?\s*:[^;]*line-through/u.test(s)) f |= S;
  return f;
}

const INLINE_FLAGS = { strong: B, b: B, em: I, i: I, cite: I, dfn: I, var: I, s: S, strike: S, del: S, mark: H, code: C, kbd: C, samp: C, tt: C };
const IMAGE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/jpg': 'jpeg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp' };

/** The text inside an element as it is written (a <pre>'s), line breaks kept. */
function rawText(n) {
  if (n.tag === '#text') return n.text;
  if (n.tag === 'br') return '\n';
  return n.children.map(rawText).join('');
}

class HtmlReader {
  constructor() {
    /** @type {Block[]} */
    this.blocks = [];
    this.cur = null;
    this.images = [];
    this.imageCount = 0;
  }

  flush() {
    const c = this.cur;
    this.cur = null;
    if (c && c.items.some((it) => it.k === 'img' || (it.k === 't' && it.s.trim()))) this.blocks.push(c);
  }

  /** The paragraph inline content goes into, begun if need be with what the blocks around it make it. */
  para(ctx) {
    if (!this.cur) {
      this.cur = { type: 'p', kind: ctx.heading ? 'heading' : ctx.quote ? 'quote' : 'para', level: ctx.heading || undefined, list: ctx.li ? { ...ctx.li } : null, items: [] };
    }
    return this.cur;
  }

  text(t, ctx) {
    let s = t.replace(/[ \t\n\r\f]+/gu, ' ');
    if (!this.cur && !s.trim()) return;
    const p = this.para(ctx);
    const last = p.items[p.items.length - 1];
    if (s.startsWith(' ') && (!last || last.k === 'br' || (last.k === 't' && last.s.endsWith(' ')))) s = s.slice(1);
    if (s) p.items.push({ k: 't', s, f: ctx.f, link: ctx.link || null });
  }

  image(n, ctx) {
    let src = (n.attrs.src || '').trim();
    if (!src) return;
    const m = /^data:([\w.+/-]+)((?:;[^,;]*)*),(.*)$/su.exec(src);
    if (m) {
      const ext = IMAGE_EXT[m[1].toLowerCase()];
      if (!ext) return;
      let bytes;
      try {
        if (/;base64/iu.test(m[2])) {
          const bin = atob(m[3].replace(/\s+/gu, ''));
          bytes = new Uint8Array(bin.length);
          for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
        } else bytes = new TextEncoder().encode(decodeURIComponent(m[3]));
      } catch { return; }
      const name = `image${++this.imageCount}.${ext}`;
      this.images.push({ name, bytes, type: m[1].toLowerCase() });
      src = `_media/${name}`;
    }
    this.para(ctx).items.push({ k: 'img', alt: n.attrs.alt || n.attrs.title || '', src, link: ctx.link || null });
  }

  /** @param {Node[]} nodes */
  walk(nodes, ctx) {
    for (const n of nodes) {
      if (n.tag === '#text') { this.text(n.text, ctx); continue; }
      const tag = n.tag;
      const style = n.attrs.style || '';
      if (SKIP.has(tag) || n.attrs.hidden !== undefined || /display\s*:\s*none|mso-hide\s*:\s*all/iu.test(style)) continue;
      const f = styled(ctx.f | (INLINE_FLAGS[tag] || 0), style);
      const inner = f === ctx.f ? ctx : { ...ctx, f };
      if (/^h[1-6]$/u.test(tag)) {
        this.flush();
        this.walk(n.children, { ...inner, heading: parseInt(tag[1], 10) });
        this.flush();
        continue;
      }
      switch (tag) {
        case 'blockquote':
          this.flush();
          this.walk(n.children, { ...inner, quote: true });
          this.flush();
          break;
        case 'ul': case 'ol': case 'menu': {
          this.flush();
          const list = { ordered: tag === 'ol', depth: ctx.list ? Math.min(8, ctx.list.depth + 1) : 0, n: parseInt(n.attrs.start || '1', 10) || 1 };
          this.walk(n.children, { ...inner, list, li: null });
          this.flush();
          break;
        }
        case 'li': {
          this.flush();
          const list = ctx.list || { ordered: false, depth: 0, n: 1 };
          const v = parseInt(n.attrs.value || '', 10);
          if (v) list.n = v;
          this.walk(n.children, { ...inner, li: { ordered: list.ordered, depth: list.depth, n: list.n } });
          this.flush();
          list.n++;
          break;
        }
        case 'pre': {
          this.flush();
          const t = rawText(n).replace(/\r\n?/gu, '\n').replace(/^\n/u, '');
          if (t.trim()) this.blocks.push({ type: 'p', kind: 'code', items: [{ k: 't', s: t, f: 0 }] });
          break;
        }
        case 'table': this.flush(); this.table(n, inner); break;
        case 'hr': this.flush(); this.blocks.push({ type: 'p', kind: 'divider', items: [] }); break;
        case 'br': this.para(ctx).items.push({ k: 'br' }); break;
        case 'img': this.image(n, ctx); break;
        case 'a': {
          const href = (n.attrs.href || '').trim();
          const ok = href && !href.startsWith('#') && !/^(javascript|vbscript|data):/iu.test(href);
          this.walk(n.children, ok ? { ...inner, link: href } : inner);
          break;
        }
        default:
          if (BLOCK.has(tag)) {
            this.flush();
            this.walk(n.children, inner);
            this.flush();
          } else this.walk(n.children, inner);
      }
    }
  }

  table(n, ctx) {
    const rows = [];
    const collect = (el) => {
      for (const c of el.children) {
        if (c.tag === 'tr') rows.push(c);
        else if (c.tag === 'thead' || c.tag === 'tbody' || c.tag === 'tfoot') collect(c);
      }
    };
    collect(n);
    const out = [];
    for (const tr of rows) {
      const cells = [];
      for (const td of tr.children) {
        if (td.tag !== 'td' && td.tag !== 'th') continue;
        const saved = { blocks: this.blocks, cur: this.cur };
        this.blocks = [];
        this.cur = null;
        this.walk(td.children, { f: ctx.f, link: null });
        this.flush();
        cells.push(this.blocks);
        Object.assign(this, saved);
        for (let k = 1; k < (parseInt(td.attrs.colspan || '1', 10) || 1) && k < 50; k++) cells.push([]);
      }
      if (cells.length) out.push(cells);
    }
    if (!out.length) return;
    if (out.length === 1 && out[0].length === 1) this.blocks.push(...out[0][0]);
    else this.blocks.push({ type: 'table', rows: out });
  }
}

/**
 * An HTML page as Moshe's markup.
 * @param {string} html
 * @returns {{title: string, text: string, images: {name: string, bytes: Uint8Array, type: string}[], warnings: string[]}}
 */
export function htmlToMarkdown(html) {
  const { root, title } = parseHtml(html);
  const r = new HtmlReader();
  r.walk(root.children, { f: 0, link: null });
  r.flush();
  const text = new MarkupWriter().blocks(r.blocks);
  const h = r.blocks.find((b) => b.type === 'p' && b.kind === 'heading');
  return { title: (h && plainItems(h.items).replace(/\s+/gu, ' ').trim()) || title, text: text ? `${text}\n` : '', images: r.images, warnings: [] };
}
