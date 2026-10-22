// HTML from an export document: a standalone page whose CSS comes from the
// export style, laid out for the screen and, through @page and print rules,
// for the browser's "Save as PDF" (which is how Moshe makes a PDF: page size,
// margins, page numbers, chapters on new pages, footnotes as a numbered list
// at the end). The EPUB exporter renders its chapters with the same functions
// in XHTML mode, so the book and the page agree.
//
// Every block gets a dir attribute: "rtl" when its first letter is Hebrew or
// Arabic, "auto" otherwise, so a Hebrew paragraph among English ones (or the
// other way round) reads in its own direction.
import { plainText, isRtl, tocTree } from './doc.js';
import { resolveStyle, textWidth } from './styles.js';

/** @typedef {import('./doc.js').Doc} Doc @typedef {import('./doc.js').Inline} Inline @typedef {import('./doc.js').Block} Block */

// characters XML does not allow at all, which a pasted text can carry
const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/gu;

/** Text made safe inside an element or a quoted attribute, in HTML and in XML alike. */
export function escapeHtml(s) {
  return String(s).replace(BAD_XML, '').replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;').replace(/'/gu, '&#39;');
}

/** A link's address, unless it would run script when clicked. */
export function safeUrl(url, image = false) {
  const u = String(url || '').trim();
  const scheme = /^([a-z][a-z0-9+.-]*):/iu.exec(u.replace(/[\s\u0000-\u001F]/gu, ''));
  if (!scheme) return u;
  const s = scheme[1].toLowerCase();
  if (s === 'javascript' || s === 'vbscript') return '#';
  if (s === 'data') return image && /^data:image\/(png|jpe?g|gif|webp|svg\+xml);/iu.test(u) ? u : '#';
  return u;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** Bytes as base64, without Buffer or btoa (so it runs in Node and in the page). */
export function base64(bytes) {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  if (i < bytes.length) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8);
    out += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + '=';
  }
  return out;
}

const dirOf = (rtl) => (rtl ? 'rtl' : 'auto');

/**
 * @typedef {object} RenderContext
 * @property {Doc} doc
 * @property {boolean} xhtml      self-closed void elements, for EPUB
 * @property {boolean} epub       epub:type on notes, footnotes as asides
 * @property {(id: string) => string} href       where a heading is, for a (toc)
 * @property {(src: string) => string|null} img  an image's address, or null to show only its caption
 * @property {boolean} pageBreaks
 * @property {boolean} [started]  set once the first block is written
 */

/** A void element. */
const voidEl = (ctx, tag, attrs = '') => (ctx.xhtml ? `<${tag}${attrs}/>` : `<${tag}${attrs}>`);

/**
 * Inline runs as HTML.
 * @param {Inline[]} nodes
 * @param {RenderContext} ctx
 */
export function renderInline(nodes, ctx) {
  let out = '';
  for (const n of nodes) {
    switch (n.type) {
      case 'text': out += escapeHtml(n.text); break;
      case 'strong': out += `<strong>${renderInline(n.children, ctx)}</strong>`; break;
      case 'em': out += `<em>${renderInline(n.children, ctx)}</em>`; break;
      case 'mark': out += `<mark>${renderInline(n.children, ctx)}</mark>`; break;
      case 'strike': out += `<s>${renderInline(n.children, ctx)}</s>`; break;
      case 'code': out += `<code>${escapeHtml(n.text)}</code>`; break;
      case 'math': out += `<span class="math">${escapeHtml(n.text)}</span>`; break;
      case 'link': {
        const title = n.title ? ` title="${escapeHtml(n.title)}"` : '';
        out += `<a href="${escapeHtml(safeUrl(n.url))}"${title}>${renderInline(n.children, ctx)}</a>`;
        break;
      }
      case 'image': {
        const src = ctx.img(n.src);
        out += src ? voidEl(ctx, 'img', ` src="${escapeHtml(safeUrl(src, true))}" alt="${escapeHtml(n.alt)}" class="inline"`)
          : `<span class="image-missing">${escapeHtml(n.alt || n.src)}</span>`;
        break;
      }
      case 'footnote': {
        const type = ctx.epub ? ' epub:type="noteref"' : '';
        out += `<sup class="fnref"><a href="#fn-${n.n}" id="fnref-${n.n}" role="doc-noteref"${type}>${n.n}</a></sup>`;
        break;
      }
      case 'comment': out += `<span class="comment" role="note">${escapeHtml(n.text)}</span>`; break;
      case 'delete': out += `<del>${renderInline(n.children, ctx)}</del>`; break;
      case 'insert': out += `<ins>${renderInline(n.children, ctx)}</ins>`; break;
      case 'annotation': {
        const text = `<span class="annotated">${renderInline(n.children, ctx)}</span>`;
        out += n.display === 'margin'
          ? `${text}<span class="margin-note" role="note">${renderInline(n.note, ctx)}</span>`
          : `${text} <span class="annotation-note">[${renderInline(n.note, ctx)}]</span>`;
        break;
      }
      default: if (n.children) out += renderInline(n.children, ctx);
    }
  }
  return out;
}

function tocList(tree, ctx) {
  if (!tree.length) return '';
  return `<ol>${tree.map((t) => `<li dir="${dirOf(isRtl(t.entry.text))}"><a href="${escapeHtml(ctx.href(t.entry.id))}">${escapeHtml(t.entry.text)}</a>${tocList(t.children, ctx)}</li>`).join('')}</ol>`;
}

/**
 * Blocks as HTML.
 * @param {Block[]} blocks
 * @param {RenderContext} ctx
 */
export function renderBlocks(blocks, ctx) {
  let out = '';
  for (const b of blocks) out += renderBlock(b, ctx) + '\n';
  return out;
}

function renderBlock(b, ctx) {
  const first = !ctx.started;
  ctx.started = true;
  switch (b.type) {
    case 'heading': {
      const level = Math.min(6, Math.max(1, b.level));
      const chapter = ctx.doc.chapterLevel !== null && level <= ctx.doc.chapterLevel;
      const cls = chapter ? ` class="chapter${ctx.pageBreaks && !first ? ' break' : ''}"` : '';
      return `<h${level} id="${escapeHtml(b.id)}" dir="${dirOf(b.rtl)}"${cls}>${renderInline(b.children, ctx)}</h${level}>`;
    }
    case 'paragraph': return `<p dir="${dirOf(b.rtl)}">${renderInline(b.children, ctx)}</p>`;
    case 'list': return renderList(b, ctx);
    case 'quote': {
      const firstPara = b.blocks.find((x) => x.type === 'paragraph');
      return `<blockquote dir="${dirOf(firstPara && firstPara.rtl)}">\n${renderBlocks(b.blocks, ctx)}</blockquote>`;
    }
    case 'code': {
      // a raw source block (```raw) goes into a web page as it is (not into an ePub's XHTML, which it could break)
      if (b.lang === 'raw' && !ctx.xhtml) return b.text;
      const lang = b.lang.replace(/[^\w+-]/gu, '');
      return `<pre dir="ltr"><code${lang ? ` class="language-${lang}"` : ''}>${escapeHtml(b.text)}</code></pre>`;
    }
    case 'math': return `<div class="math" dir="ltr">${escapeHtml(b.text)}</div>`;
    case 'divider': return voidEl(ctx, 'hr');
    case 'image': {
      const src = ctx.img(b.src);
      const cap = b.alt ? `<figcaption dir="${dirOf(b.rtl)}">${escapeHtml(b.alt)}</figcaption>` : '';
      if (!src) return `<figure class="image-missing">${cap || `<figcaption>${escapeHtml(b.src)}</figcaption>`}</figure>`;
      const title = b.title ? ` title="${escapeHtml(b.title)}"` : '';
      return `<figure>${voidEl(ctx, 'img', ` src="${escapeHtml(safeUrl(src, true))}" alt="${escapeHtml(b.alt)}"${title}`)}${cap}</figure>`;
    }
    case 'table': {
      const cell = (tag, c, i) => {
        const a = b.align[i];
        const style = a ? ` style="text-align: ${a}"` : '';
        const rtl = isRtl(plainText(c));
        return `<${tag}${style} dir="${dirOf(rtl)}">${renderInline(c, ctx)}</${tag}>`;
      };
      const head = b.head ? `<thead><tr>${b.head.map((c, i) => cell('th', c, i)).join('')}</tr></thead>` : '';
      const rows = b.rows.map((r) => `<tr>${r.map((c, i) => cell('td', c, i)).join('')}</tr>`).join('\n');
      return `<div class="table"><table>${head}<tbody>\n${rows}\n</tbody></table></div>`;
    }
    case 'toc': {
      if (!b.entries.length) return '';
      // (not epub:type="toc", which a book keeps for its navigation document)
      return `<nav class="toc" role="doc-toc">${tocList(tocTree(b.entries), ctx)}</nav>`;
    }
    case 'comment': {
      const lines = b.text.split('\n').map((l) => escapeHtml(l)).join(voidEl(ctx, 'br'));
      return `<div class="comment-block" role="note" dir="${dirOf(b.rtl)}">${lines}</div>`;
    }
    default: return '';
  }
}

function renderList(b, ctx) {
  const tag = b.ordered ? 'ol' : 'ul';
  const start = b.ordered && b.start !== 1 ? ` start="${b.start}"` : '';
  const dir = b.items[0] && b.items[0].rtl ? ' dir="rtl"' : '';
  const items = b.items.map((it) => {
    // (U+FE0E asks for the plain glyph, not the emoji some systems draw instead)
    const task = it.task ? `<span class="check">${it.task === 'done' ? '\u2611\uFE0E' : '\u2610\uFE0E'}</span> ` : '';
    const nested = it.lists.map((l) => renderList(l, ctx)).join('');
    return `<li dir="${dirOf(it.rtl)}"${it.task ? ' class="task"' : ''}>${task}${renderInline(it.children, ctx)}${nested}</li>`;
  }).join('\n');
  return `<${tag}${start}${dir}>\n${items}\n</${tag}>`;
}

/** A footnote's text after its number, which links back to where it is referred to. */
export function renderFootnoteBody(fn, ctx) {
  return `<a href="#fnref-${fn.n}" class="fnback" role="doc-backlink">${fn.n}.</a> ${renderInline(fn.children, ctx)}`;
}

/** Every footnote, as the numbered list that ends the page. The numbers are
 *  written, not the list's own, so a Hebrew footnote's comes at its start, on the right. */
function renderFootnotes(doc, ctx) {
  if (!doc.footnotes.length) return '';
  const items = doc.footnotes.map((fn) => {
    const rtl = isRtl(plainText(fn.children));
    return `<li id="fn-${fn.n}" dir="${dirOf(rtl)}">${renderFootnoteBody(fn, ctx)}</li>`;
  }).join('\n');
  return `<section class="footnotes" role="doc-endnotes">\n<ol>\n${items}\n</ol>\n</section>\n`;
}

// ---- CSS -----------------------------------------------------------------------

const num = (n) => String(+Number(n).toFixed(3));
const pt = (n) => `${num(n)}pt`;
/** A CSS string, safe to put in a <style> element. */
const cssString = (s) => `"${String(s).replace(/[\\"]/gu, '\\$&').replace(/[\n\r]/gu, ' ').replace(/</gu, '\\3c ')}"`;

/**
 * The CSS for a style.
 * @param {import('./styles.js').ExportStyle} style
 * @param {{target?: 'page'|'epub', title?: string, author?: string}} [opts]
 *   'page': a page for the screen and for print; 'epub': a book's, leaving
 *   fonts' sizes and colours to the reader where it can
 */
export function styleCss(style, opts = {}) {
  const epub = opts.target === 'epub';
  const s = style, c = s.colors;
  const em = (points) => `${num(points / s.size)}em`;
  const after = em(s.paragraph.after);
  const L = [];
  if (!epub) {
    const size = s.page.size === 'Letter' ? 'letter' : s.page.size === 'A5' ? 'A5' : 'A4';
    const m = s.page.margins;
    const box = `font-family: ${s.fonts.body.css}; font-size: 9pt; color: ${c.muted};`;
    let boxes = '';
    if (s.pageNumbers === 'footer') boxes = ` @bottom-center { content: counter(page); ${box} }`;
    else if (s.pageNumbers === 'header') {
      const who = [opts.author, opts.title].filter(Boolean).map((x) => cssString(`${x} / `)).join(' ');
      boxes = ` @top-right { content: ${who} counter(page); ${box} font-size: ${pt(s.size)}; }`;
    }
    L.push(`@page { size: ${size}; margin: ${pt(m.top)} ${pt(m.right)} ${pt(m.bottom)} ${pt(m.left)};${boxes} }`);
    L.push(`:root { color-scheme: light; }`);
    L.push(`html { font-size: ${pt(s.size)}; background: #fff; }`);
    L.push(`body { margin: 0; color: ${c.text}; font-family: ${s.fonts.body.css}; font-size: 1rem; line-height: ${num(s.lineHeight)}; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }`);
    L.push(`.moshe-doc { box-sizing: content-box; max-width: ${pt(textWidth(s))}; margin: 0 auto; padding: 48px 24px 96px; }`);
  } else {
    L.push(`body { margin: 0 4%; font-family: ${s.fonts.body.css}; line-height: ${num(s.lineHeight)}; }`);
  }
  const justify = s.paragraph.align === 'justify' ? ' text-align: justify; hyphens: auto; -webkit-hyphens: auto;' : '';
  L.push(`p { margin: ${em(s.paragraph.before)} 0 ${after}; orphans: 2; widows: 2;${justify} }`);
  if (s.paragraph.indent) L.push(`p + p { text-indent: ${em(s.paragraph.indent)}; }`);
  s.headings.forEach((h, i) => {
    const rules = [`font-family: ${s.fonts.heading.css}`, `font-size: ${em(h.size)}`, `font-weight: ${h.bold ? 700 : 400}`,
      `font-style: ${h.italic ? 'italic' : 'normal'}`, `line-height: ${num(Math.min(s.lineHeight, 1.3))}`,
      `margin: ${num(h.before / h.size)}em 0 ${num(h.after / h.size)}em`, 'break-after: avoid', 'page-break-after: avoid'];
    if (h.smallCaps) rules.push('font-variant: small-caps', 'letter-spacing: 0.04em');
    if (h.uppercase) rules.push('text-transform: uppercase');
    if (h.align === 'center') rules.push('text-align: center');
    if (!epub && (h.color || c.heading)) rules.push(`color: ${h.color || c.heading}`);
    if (h.rule) rules.push(`padding-bottom: 0.25em`, `border-bottom: 1.5pt solid ${c.rule}`);
    L.push(`h${i + 1} { ${rules.join('; ')}; }`);
  });
  L.push(`h1:first-child, h2:first-child, h3:first-child { margin-top: 0; }`);
  L.push(epub ? `a { text-decoration: underline; }` : `a { color: ${c.link}; text-decoration: underline; text-decoration-thickness: 0.06em; text-underline-offset: 0.15em; }`);
  L.push(`mark { background: ${c.mark}; color: inherit; padding: 0 0.1em; }`);
  L.push(`code { font-family: ${s.fonts.mono.css}; font-size: 0.9em; background: ${c.codeBg}; padding: 0.05em 0.25em; border-radius: 3px; }`);
  L.push(`pre { font-family: ${s.fonts.mono.css}; font-size: ${em(s.code.size)}; line-height: 1.45; background: ${c.codeBg}; padding: 0.7em 0.9em; margin: 0 0 ${after}; white-space: pre-wrap; overflow-wrap: anywhere; text-align: left; border-radius: 4px; break-inside: avoid; }`);
  L.push(`pre code { background: none; padding: 0; font-size: inherit; border-radius: 0; }`);
  const q = s.quote;
  L.push(`blockquote { margin: 0 0 ${after}; padding: 0 0 0 ${em(q.indent)}; ${q.rule ? `border-left: 2pt solid ${c.rule}; ` : ''}font-size: ${em(q.size)};${q.italic ? ' font-style: italic;' : ''} }`);
  L.push(`blockquote[dir="rtl"] { padding: 0 ${em(q.indent)} 0 0; ${q.rule ? `border-left: 0; border-right: 2pt solid ${c.rule}; ` : ''}}`);
  L.push(`blockquote blockquote { margin-top: 0.3em; font-size: 1em; }`);
  L.push(`ul, ol { margin: 0 0 ${after}; padding: 0 0 0 1.6em; }`);
  L.push(`ul[dir="rtl"], ol[dir="rtl"] { padding: 0 1.6em 0 0; }`);
  L.push(`li { margin: 0.15em 0; } li > ul, li > ol { margin: 0.15em 0 0; }`);
  L.push(`li.task { list-style: none; } .check { font-family: ${s.fonts.body.css}; }`);
  L.push(`.table { overflow-x: auto; margin: 0 0 ${after}; }`);
  L.push(`table { border-collapse: collapse; font-size: 0.92em; line-height: 1.35; }`);
  L.push(`th, td { border: 0.75pt solid ${c.rule}; padding: 0.3em 0.6em; vertical-align: top; text-align: start; }`);
  L.push(`th { font-weight: 700; background: ${c.codeBg}; } tr { break-inside: avoid; } thead { display: table-header-group; }`);
  L.push(`figure { margin: 1em 0; text-align: center; break-inside: avoid; } figure img { max-width: 100%; height: auto; } img.inline { max-height: 1.2em; vertical-align: middle; }`);
  L.push(`figcaption { font-size: 0.88em; font-style: italic; margin-top: 0.4em;${epub ? '' : ` color: ${c.muted};`} }`);
  L.push(`.image-missing { font-style: italic; }`);
  if (s.divider === 'rule') L.push(`hr { border: 0; border-top: 0.75pt solid ${c.rule}; margin: 1.4em 25%; }`);
  else L.push(`hr { border: 0; margin: 1em 0; text-align: center; height: auto; } hr::after { content: ${cssString(s.divider === 'hash' ? '#' : '*\u2002*\u2002*')}; }`);
  L.push(`.math { font-family: ${s.fonts.mono.css}; font-size: 0.92em; } div.math { text-align: center; margin: 0 0 ${after}; white-space: pre-wrap; }`);
  L.push(`nav.toc { margin: 0 0 1.5em; } nav.toc ol { list-style: none; margin: 0; padding: 0 0 0 1.2em; } nav.toc > ol { padding: 0; }`);
  L.push(`nav.toc li { margin: 0.2em 0; } nav.toc a { color: inherit; text-decoration: none; } nav.toc li[dir="rtl"] > ol { padding: 0 1.2em 0 0; }`);
  L.push(`sup.fnref { font-size: 0.72em; line-height: 0; vertical-align: super; } sup.fnref a { text-decoration: none; }`);
  L.push(`.footnotes { margin-top: 2.5em; padding-top: 0.6em; border-top: 0.75pt solid ${c.rule}; font-size: ${em(s.footnote.size)}; line-height: 1.4; }`);
  L.push(`.footnotes ol { list-style: none; margin: 0; padding: 0; } .footnotes li { margin: 0 0 0.4em; } .fnback { text-decoration: none; }`);
  L.push(`.footnotes aside p, aside.footnote p { text-indent: 0; margin: 0 0 0.4em; }`);
  // the writer's marks, for a revision copy
  L.push(`.comment { background: ${c.commentBg}; color: ${c.comment}; border-radius: 3px; padding: 0 0.25em; font-style: italic; font-size: 0.92em; }`);
  L.push(`.comment-block { background: ${c.commentBg}; color: ${c.comment}; border-left: 3pt solid ${c.comment}; padding: 0.4em 0.8em; margin: 0 0 ${after}; font-style: italic; font-size: 0.92em; }`);
  L.push(`.comment-block[dir="rtl"] { border-left: 0; border-right: 3pt solid ${c.comment}; }`);
  L.push(`del { color: ${c.deletion}; text-decoration: line-through; text-decoration-thickness: 0.08em; }`);
  L.push(`ins { color: ${c.insertion}; text-decoration: underline; text-decoration-thickness: 0.08em; text-underline-offset: 0.15em; }`);
  L.push(`.annotated { background: ${c.commentBg}; border-bottom: 1.5px solid ${c.note}; }`);
  L.push(`.annotation-note { color: ${c.note}; font-size: 0.9em; }`);
  if (epub) {
    L.push(`.margin-note { color: ${c.note}; font-size: 0.85em; } .margin-note::before { content: " ["; } .margin-note::after { content: "]"; }`);
  } else {
    // margin notes float into a margin the page keeps free for them
    L.push(`.moshe-doc.has-notes { padding-right: 13rem; max-width: ${pt(textWidth(s) * 0.72)}; }`);
    L.push(`.margin-note { float: right; clear: right; width: 11rem; margin: 0 -13rem 0.5em 0; padding-left: 0.5em; border-left: 2px solid ${c.note}; color: ${c.note}; font-size: 0.8rem; line-height: 1.35; font-style: normal; font-weight: 400; text-indent: 0; text-align: left; direction: ltr; unicode-bidi: plaintext; }`);
    L.push(`@media screen and (max-width: 44em) { .moshe-doc.has-notes { padding-right: 24px; } .margin-note { float: none; display: block; width: auto; margin: 0.3em 0; } }`);
  }
  if (s.columns > 1) {
    L.push(`.moshe-doc.columns { column-count: ${s.columns}; column-gap: ${pt(s.columnGap)}; column-rule: 0.5pt solid ${c.rule}; }`);
    L.push(`.moshe-doc.columns .chapter, .moshe-doc.columns > nav.toc { column-span: all; } .moshe-doc.columns .footnotes { break-inside: avoid-column; }`);
    if (!epub) L.push(`@media screen and (max-width: 44em) { .moshe-doc.columns { column-count: 1; } }`);
  }
  if (!epub) {
    L.push(`@media print {`);
    L.push(`  html { background: none; }`);
    L.push(`  .moshe-doc { max-width: none; margin: 0; padding: 0; }`);
    L.push(`  .moshe-doc.has-notes { padding-right: 13rem; }`);
    L.push(`  .break { break-before: page; page-break-before: always; }`);
    L.push(`  .table { overflow: visible; }`);
    L.push(`  a { text-decoration: none; }`);
    L.push(`}`);
  }
  return L.join('\n');
}

// ---- the page ------------------------------------------------------------------

/**
 * The document as HTML.
 * @param {Doc} doc
 * @param {string|object} [style]  an export style or its id
 * @param {{full?: boolean, title?: string, author?: string, lang?: string, pageBreaks?: boolean,
 *          images?: Record<string, {bytes?: Uint8Array, type?: string, url?: string}>, unresolvedImages?: 'keep'|'caption'}} [opts]
 *   full (the default): a standalone page with its CSS; false: the <article> alone.
 *   images: pictures to embed (as data: URLs) by their path in the text. Any other keeps its
 *   path (which works for a page saved beside the library's _media folder), or with
 *   unresolvedImages 'caption' shows only its caption, as a printed page must.
 * @returns {string}
 */
export function toHtml(doc, style, opts = {}) {
  const s = resolveStyle(style);
  const full = opts.full !== false;
  const images = opts.images || {};
  const ctx = {
    doc, xhtml: false, epub: false,
    href: (id) => `#${id}`,
    img: (src) => {
      const im = images[src];
      if (im && im.bytes) return `data:${im.type || 'image/png'};base64,${base64(im.bytes)}`;
      if (im && im.url) return im.url;
      return opts.unresolvedImages === 'caption' ? null : src;
    },
    pageBreaks: opts.pageBreaks ?? s.pageBreaks,
    started: false,
  };
  const hasNotes = doc.comments.some((x) => x.anchored);
  const cls = ['moshe-doc', `style-${s.id}`];
  if (s.columns > 1) cls.push('columns');
  if (hasNotes) cls.push('has-notes');
  const body = `<article class="${cls.join(' ')}">\n${renderBlocks(doc.blocks, ctx)}${renderFootnotes(doc, ctx)}</article>`;
  if (!full) return body;
  const title = opts.title || doc.title;
  const lang = opts.lang || doc.lang;
  const rtl = /^(he|iw|yi|ar|fa|ur)\b/u.test(lang);
  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="generator" content="Moshe">',
    opts.author ? `<meta name="author" content="${escapeHtml(opts.author)}">` : '',
    `<title>${escapeHtml(title)}</title>`,
    `<style>\n${styleCss(s, { target: 'page', title, author: opts.author })}\n</style>`,
  ].filter(Boolean).join('\n');
  return `<!DOCTYPE html>\n<html lang="${escapeHtml(lang)}"${rtl ? ' dir="rtl"' : ''}>\n<head>\n${head}\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}

