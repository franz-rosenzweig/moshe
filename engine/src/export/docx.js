// A Word document (.docx) from an export document, written by hand: the
// handful of XML parts Word, Pages and LibreOffice need, zipped. The export
// style becomes Word's own styles (Normal, Heading 1–6, Quote, List
// Paragraph…), so the document can be restyled in Word the usual way, and
// the parts that matter to an editor are real Word features rather than
// imitations: footnotes are Word footnotes, lists are Word lists, a (toc) is
// a Word table of contents (filled in, and updatable for page numbers), and a
// revision copy's deletions and insertions are tracked changes and its
// comments and annotations Word comments.
//
// Word is strict about the order of the elements inside a paragraph's or a
// run's properties (the schema's sequence), and refuses a file that breaks
// it; pPr() and rPr() below write them in that order and nothing else does.
import { createZip } from './zip.js';
import { resolveStyle, textWidth, PAGE_SIZES } from './styles.js';
import { plainText, isRtl } from './doc.js';
import { escapeHtml as esc, safeUrl } from './html.js';

/** @typedef {import('./doc.js').Doc} Doc @typedef {import('./doc.js').Inline} Inline @typedef {import('./doc.js').Block} Block */

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const RTL_LANG = /^(he|iw|yi|ar|fa|ur)\b/iu;
const tw = (points) => Math.round(points * 20);          // twentieths of a point
const half = (points) => Math.round(points * 2);         // half-points, Word's font sizes
const EMU_PER_PT = 12700, EMU_PER_PX = 9525;
const s2emu = (points) => Math.round(points * EMU_PER_PT);

/** A CSS colour as Word's RRGGBB, or null for one Word cannot use. */
function hex(c) {
  if (typeof c !== 'string') return null;
  let m = /^#([0-9a-f]{6})$/iu.exec(c);
  if (m) return m[1].toUpperCase();
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/iu.exec(c);
  return m ? `${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`.toUpperCase() : null;
}

/** Word's language tag for a document's language. */
const wordLang = (lang) => ({ en: 'en-US', he: 'he-IL', iw: 'he-IL', ar: 'ar-SA', fr: 'fr-FR', de: 'de-DE', es: 'es-ES', it: 'it-IT', ru: 'ru-RU', yi: 'yi-001' }[String(lang).toLowerCase().split('-')[0]] || lang || 'en-US');

// ---- properties, in schema order ------------------------------------------------

/**
 * A paragraph's properties.
 * @param {{style?: string, keepNext?: boolean, keepLines?: boolean, pageBreakBefore?: boolean, numId?: number, ilvl?: number,
 *          border?: {side: string, sz: number, space: number, color: string, clear?: string}, shd?: string, bidi?: boolean,
 *          spacing?: {before?: number, after?: number, line?: number}, ind?: {left?: number, right?: number, firstLine?: number, hanging?: number},
 *          contextual?: boolean, jc?: string, outline?: number, rPr?: string}} p  measures in twips
 */
function pPr(p) {
  let x = '';
  if (p.style) x += `<w:pStyle w:val="${p.style}"/>`;
  if (p.keepNext) x += '<w:keepNext/>';
  if (p.keepLines) x += '<w:keepLines/>';
  if (p.pageBreakBefore) x += '<w:pageBreakBefore/>';
  if (p.numId !== undefined) x += `<w:numPr><w:ilvl w:val="${p.ilvl || 0}"/><w:numId w:val="${p.numId}"/></w:numPr>`;
  if (p.border) {
    const b = p.border;
    // "nil" on the other side takes away a rule the style put there
    const other = b.clear ? `<w:${b.clear} w:val="nil"/>` : '';
    const sides = b.side === 'left' || b.clear === 'right' ? `<w:${b.side} w:val="single" w:sz="${b.sz}" w:space="${b.space}" w:color="${b.color}"/>${other}` : `${other}<w:${b.side} w:val="single" w:sz="${b.sz}" w:space="${b.space}" w:color="${b.color}"/>`;
    x += `<w:pBdr>${sides}</w:pBdr>`;
  }
  if (p.shd) x += `<w:shd w:val="clear" w:color="auto" w:fill="${p.shd}"/>`;
  if (p.bidi) x += '<w:bidi/>';
  if (p.spacing) {
    const s = p.spacing;
    x += `<w:spacing${s.before !== undefined ? ` w:before="${s.before}"` : ''}${s.after !== undefined ? ` w:after="${s.after}"` : ''}${s.line !== undefined ? ` w:line="${s.line}" w:lineRule="auto"` : ''}/>`;
  }
  if (p.ind) {
    const i = p.ind;
    x += `<w:ind${i.left !== undefined ? ` w:left="${i.left}"` : ''}${i.right !== undefined ? ` w:right="${i.right}"` : ''}${i.hanging !== undefined ? ` w:hanging="${i.hanging}"` : i.firstLine !== undefined ? ` w:firstLine="${i.firstLine}"` : ''}/>`;
  }
  if (p.contextual) x += '<w:contextualSpacing/>';
  if (p.jc) x += `<w:jc w:val="${p.jc}"/>`;
  if (p.outline !== undefined) x += `<w:outlineLvl w:val="${p.outline}"/>`;
  if (p.rPr) x += `<w:rPr>${p.rPr}</w:rPr>`;
  return x ? `<w:pPr>${x}</w:pPr>` : '';
}

/**
 * A run's properties (without the <w:rPr> around them).
 * @param {{style?: string, font?: {word: string, cs: string}, b?: boolean, i?: boolean, caps?: boolean, smallCaps?: boolean,
 *          strike?: boolean, color?: string|null, size?: number, highlight?: string, u?: boolean, shd?: string|null,
 *          sup?: boolean, rtl?: boolean}} r
 */
function rPrInner(r) {
  let x = '';
  if (r.style) x += `<w:rStyle w:val="${r.style}"/>`;
  if (r.font) x += `<w:rFonts w:ascii="${esc(r.font.word)}" w:hAnsi="${esc(r.font.word)}" w:eastAsia="${esc(r.font.word)}" w:cs="${esc(r.font.cs)}"/>`;
  if (r.b) x += '<w:b/><w:bCs/>';
  if (r.i) x += '<w:i/><w:iCs/>';
  if (r.caps) x += '<w:caps/>';
  if (r.smallCaps) x += '<w:smallCaps/>';
  if (r.strike) x += '<w:strike/>';
  if (r.color) x += `<w:color w:val="${r.color}"/>`;
  if (r.size) x += `<w:sz w:val="${half(r.size)}"/><w:szCs w:val="${half(r.size)}"/>`;
  if (r.highlight) x += `<w:highlight w:val="${r.highlight}"/>`;
  if (r.u) x += '<w:u w:val="single"/>';
  if (r.shd) x += `<w:shd w:val="clear" w:color="auto" w:fill="${r.shd}"/>`;
  if (r.sup) x += '<w:vertAlign w:val="superscript"/>';
  if (r.rtl) x += '<w:rtl/>';
  return x;
}
const rPr = (r) => { const x = rPrInner(r); return x ? `<w:rPr>${x}</w:rPr>` : ''; };

// letters that run left to right, and those that run right to left
const LTR_RUN = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Armenian}\p{Script=Georgian}](?:[^\p{L}]*[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Armenian}\p{Script=Georgian}])*/gu;
const RTL_RUN = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}](?:[^\p{L}]*[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}])*/gu;

/**
 * A text cut where its direction changes, as Word itself keeps it: in a
 * right-to-left paragraph everything but the runs of Latin (Greek…) words is
 * marked right to left; in a left-to-right one only the runs of Hebrew or
 * Arabic words are. Spaces and punctuation between words of one script go
 * with them, and the rest takes the paragraph's direction.
 * @returns {{text: string, rtl: boolean}[]}
 */
export function directionRuns(text, paraRtl) {
  const re = paraRtl ? LTR_RUN : RTL_RUN;
  re.lastIndex = 0;
  const out = [];
  let i = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > i) out.push({ text: text.slice(i, m.index), rtl: paraRtl });
    out.push({ text: m[0], rtl: !paraRtl });
    i = m.index + m[0].length;
  }
  if (i < text.length) out.push({ text: text.slice(i), rtl: paraRtl });
  return out;
}

// ---- images -----------------------------------------------------------------------

/** A PNG's, JPEG's or GIF's size in pixels, read from its header. */
export function imageSize(bytes) {
  const b = bytes;
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { width: v.getUint32(16), height: v.getUint32(20) };
  }
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) };
  if (b.length > 4 && b[0] === 0xFF && b[1] === 0xD8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xFF) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
      const len = (b[i + 2] << 8) | b[i + 3];
      if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
        return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
      }
      i += 2 + len;
    }
  }
  return null;
}

/** A list level's indent, in twips. */
const listIndent = (ilvl) => 360 * (ilvl + 2);

const IMAGE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/jpg': 'jpeg', 'image/gif': 'gif', 'image/bmp': 'bmp' };

// ---- the writer -----------------------------------------------------------------------

const FONT_FAMILY = { Arial: 'swiss', Calibri: 'swiss', Helvetica: 'swiss', 'Helvetica Neue': 'swiss', 'Segoe UI': 'swiss',
  'Times New Roman': 'roman', Georgia: 'roman', Cambria: 'roman', 'Cambria Math': 'roman', Palatino: 'roman', 'Book Antiqua': 'roman',
  'Courier New': 'modern', Consolas: 'modern', Menlo: 'modern', Courier: 'modern' };

class DocxWriter {
  /**
   * @param {Doc} doc
   * @param {import('./styles.js').ExportStyle} style
   * @param {object} opts
   */
  constructor(doc, style, opts) {
    this.doc = doc;
    this.s = style;
    this.opts = opts;
    this.author = opts.author || 'Moshe';
    this.date = (opts.date || new Date()).toISOString().replace(/\.\d{3}Z$/u, 'Z');
    this.track = opts.trackChanges !== false;
    this.wordComments = opts.comments !== 'inline';
    this.part = 'document';      // the part being written: document, footnotes or comments
    this.rels = { document: [], footnotes: [], comments: [] };   // each part's relationships
    this.nums = [];              // list instances: {numId, abstract, ilvl, start}
    this.footnotes = [];         // footnotes.xml's entries
    this.comments = [];          // comments.xml's entries
    this.media = [];             // images to put in word/media
    this.relCache = new Map();   // part + target → its relationship id
    this.imageNames = new Map(); // image path → its file in word/media
    this.nextAnnotation = 1;     // ids for bookmarks, comments and tracked changes: unique across all of them
    this.nextDrawing = 1;
    this.headingIds = new Map(doc.headings.map((h) => [h.id, h.n]));
    // the width a picture or a table may take: a column's, in a style with columns
    this.textWidthTw = tw((textWidth(style) - style.columnGap * (style.columns - 1)) / Math.max(1, style.columns));
    this.images = opts.images || {};
  }

  /** A relationship from the part being written (each part has its own). */
  rel(type, target, external = false) {
    const key = `${this.part} ${type} ${target}`;
    if (this.relCache.has(key)) return this.relCache.get(key);
    const list = this.rels[this.part];
    const id = `rId${list.length + 10}`;
    list.push({ id, type, target, external });
    this.relCache.set(key, id);
    return id;
  }

  /** Writes into another part (footnotes, comments) for a while. */
  inPart(part, fn) {
    const was = this.part;
    this.part = part;
    try { return fn(); } finally { this.part = was; }
  }

  // ---- runs -----------------------------------------------------------------------

  /** Plain text as runs, cut where its direction changes. */
  text(t, r) {
    if (!t) return '';
    let out = '';
    for (const part of directionRuns(t, !!r.paraRtl)) {
      const props = rPr({ ...r, rtl: part.rtl });
      const tag = r.del ? 'w:delText' : 'w:t';
      const body = part.text.split(/(\t|\n)/u).map((x) => (x === '\t' ? '<w:tab/>' : x === '\n' ? '<w:br/>' : x ? `<${tag} xml:space="preserve">${esc(x)}</${tag}>` : '')).join('');
      out += `<w:r>${props}${body}</w:r>`;
    }
    return out;
  }

  /** A point in the text that a comment is attached to, or a range of runs it covers. */
  comment(children, inner, r) {
    if (!this.wordComments || r.inFootnote || r.del) {
      // where Word cannot take a comment: shown in the text, highlighted
      const c = this.s.colors;
      return `${inner}${this.text(` [${plainText(children)}]`, { ...r, color: hex(c.comment), shd: hex(c.commentBg), i: true })}`;
    }
    const id = this.nextAnnotation++;
    this.comments.push({ id, children });
    return `<w:commentRangeStart w:id="${id}"/>${inner}<w:commentRangeEnd w:id="${id}"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${id}"/></w:r>`;
  }

  /**
   * Inline runs as Word runs.
   * @param {Inline[]} nodes
   * @param {object} r  the run properties inherited, and where the runs are (paraRtl, del, ins, inLink, inFootnote)
   */
  runs(nodes, r) {
    let out = '';
    const c = this.s.colors;
    for (const n of nodes) {
      switch (n.type) {
        case 'text': out += this.text(n.text, r); break;
        case 'strong': out += this.runs(n.children, { ...r, b: true }); break;
        case 'em': out += this.runs(n.children, { ...r, i: true }); break;
        case 'strike': out += this.runs(n.children, { ...r, strike: true }); break;
        case 'mark': out += this.runs(n.children, { ...r, highlight: 'yellow' }); break;
        case 'code': out += this.text(n.text, { ...r, style: r.style || 'VerbatimChar' }); break;
        case 'math': out += this.text(n.text, { ...r, style: r.style || 'VerbatimChar' }); break;
        case 'link': {
          const url = safeUrl(n.url);
          const anchor = url.startsWith('#') && this.headingIds.has(url.slice(1)) ? `_Toc${this.headingIds.get(url.slice(1))}` : null;
          if (r.inLink || r.track || url === '#' || (url.startsWith('#') && !anchor)) {
            out += this.runs(n.children, { ...r, u: true, color: hex(c.link) });
            break;
          }
          const target = anchor ? `w:anchor="${anchor}"` : `r:id="${this.rel(`${R}/hyperlink`, url, true)}"`;
          out += `<w:hyperlink ${target} w:history="1">${this.runs(n.children, { ...r, inLink: true, style: 'Hyperlink' })}</w:hyperlink>`;
          break;
        }
        case 'image': {
          const d = this.drawing(n.src, n.alt, true);
          out += d ? `<w:r>${rPr({ rtl: false })}${d}</w:r>` : this.text(`[${n.alt || n.src}]`, r);
          break;
        }
        case 'footnote': {
          const fn = this.doc.footnotes[n.n - 1];
          if (!fn) break;
          if (r.inFootnote) {
            // Word has no footnotes inside footnotes: its text follows in brackets
            out += this.text(' (', r) + this.runs(fn.children, r) + this.text(')', r);
            break;
          }
          const id = this.footnotes.length + 1;
          const rtl = isRtl(plainText(fn.children));
          this.footnotes.push({ id, rtl, xml: '' });
          const entry = this.footnotes[id - 1];
          entry.xml = this.inPart('footnotes', () => this.runs(fn.children, { paraRtl: rtl, inFootnote: true }));
          out += `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`;
          break;
        }
        case 'comment': out += this.comment([{ type: 'text', text: n.text }], '', r); break;
        case 'annotation': {
          if (n.display === 'margin') out += this.comment(n.note, this.runs(n.children, r), r);
          else {
            out += this.runs(n.children, r);
            out += this.text(' [', { ...r, color: hex(c.note) }) + this.runs(n.note, { ...r, color: hex(c.note) }) + this.text(']', { ...r, color: hex(c.note) });
          }
          break;
        }
        case 'delete': {
          if (this.track && !r.track) {
            const id = this.nextAnnotation++;
            out += `<w:del w:id="${id}" w:author="${esc(this.author)}" w:date="${this.date}">${this.runs(n.children, { ...r, del: true, track: true })}</w:del>`;
          } else out += this.runs(n.children, { ...r, strike: true, color: hex(c.deletion) });
          break;
        }
        case 'insert': {
          if (this.track && !r.track) {
            const id = this.nextAnnotation++;
            out += `<w:ins w:id="${id}" w:author="${esc(this.author)}" w:date="${this.date}">${this.runs(n.children, { ...r, ins: true, track: true })}</w:ins>`;
          } else out += this.runs(n.children, { ...r, u: true, color: hex(c.insertion) });
          break;
        }
        default: if (n.children) out += this.runs(n.children, r);
      }
    }
    return out;
  }

  /** A picture from the images given, fitted to the text's width; null if it was not given. */
  drawing(src, alt, inline = false) {
    const im = this.images[src];
    const ext = im && im.bytes && IMAGE_EXT[(im.type || '').toLowerCase()];
    if (!ext) return null;
    if (!this.imageNames.has(src)) {
      const name = `image${this.media.length + 1}.${ext}`;
      this.media.push({ name, bytes: im.bytes });
      this.imageNames.set(src, name);
    }
    const rid = this.rel(`${R}/image`, `media/${this.imageNames.get(src)}`);
    const size = (im.width && im.height) ? { width: im.width, height: im.height } : imageSize(im.bytes) || { width: 400, height: 300 };
    let cx = size.width * EMU_PER_PX, cy = size.height * EMU_PER_PX;
    // an image in a line of text is kept to the line's height; one on its own, to the text's width
    const max = inline ? s2emu(this.s.size * 1.5) * (size.width / size.height) : this.textWidthTw * (EMU_PER_PT / 20);
    if (cx > max) { cy = Math.round(cy * (max / cx)); cx = Math.round(max); }
    const id = this.nextDrawing++;
    const name = `Picture ${id}`;
    return `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>`
      + `<wp:docPr id="${id}" name="${name}" descr="${esc(alt || '')}"/>`
      + `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="${A}" noChangeAspect="1"/></wp:cNvGraphicFramePr>`
      + `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}"><pic:pic xmlns:pic="${PIC}">`
      + `<pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>`
      + `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
      + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`
      + '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>';
  }

  // ---- blocks ------------------------------------------------------------------------

  /** A list instance: bullets share one, each numbered list gets its own so it counts from its start. */
  num(ordered, ilvl, start) {
    if (!ordered) return 1;
    const numId = this.nums.length + 2;
    this.nums.push({ numId, ilvl, start });
    return numId;
  }

  blocks(bs, state = { prev: null, quote: 0 }) {
    let out = '';
    for (const b of bs) {
      out += this.block(b, state);
      state.prev = b.type;
    }
    return out;
  }

  block(b, state) {
    const s = this.s;
    const quoteInd = state.quote ? { left: tw(s.quote.indent * state.quote), firstLine: 0 } : undefined;
    switch (b.type) {
      case 'heading': {
        const level = Math.min(6, Math.max(1, b.level));
        const mark = this.nextAnnotation++;
        return `<w:p>${pPr({ style: `Heading${level}`, bidi: b.rtl })}<w:bookmarkStart w:id="${mark}" w:name="_Toc${b.n}"/>`
          + `${this.runs(b.children, { paraRtl: b.rtl })}<w:bookmarkEnd w:id="${mark}"/></w:p>`;
      }
      case 'paragraph': {
        const style = state.quote ? 'Quote' : state.prev === 'paragraph' ? undefined : 'FirstParagraph';
        // a border is on a side of the page, where an indent is turned round in a right-to-left
        // paragraph: a Hebrew quote's rule is moved to the right by hand
        const border = state.quote && b.rtl && s.quote.rule ? { side: 'right', clear: 'left', sz: 12, space: 8, color: hex(s.colors.rule) || '999999' } : undefined;
        return `<w:p>${pPr({ style, border, bidi: b.rtl, ind: state.quote > 1 ? quoteInd : undefined })}${this.runs(b.children, { paraRtl: b.rtl })}</w:p>`;
      }
      case 'quote': {
        const inner = { prev: null, quote: state.quote + 1 };
        return this.blocks(b.blocks, inner);
      }
      case 'list': return this.list(b, 0);
      case 'code': {
        const lines = b.text.split('\n').map((l) => this.text(l, {})).join('<w:r><w:br/></w:r>');
        return `<w:p>${pPr({ style: 'SourceCode' })}${lines}</w:p>`;
      }
      case 'math': {
        const lines = b.text.split('\n').map((l) => this.text(l, {})).join('<w:r><w:br/></w:r>');
        return `<w:p>${pPr({ style: 'MathBlock' })}${lines}</w:p>`;
      }
      case 'divider': {
        const mark = s.divider === 'rule' ? '' : this.text(s.divider === 'hash' ? '#' : '* * *', {});
        return `<w:p>${pPr({ style: 'Divider' })}${mark}</w:p>`;
      }
      case 'image': {
        const d = this.drawing(b.src, b.alt);
        const caption = b.alt ? `<w:p>${pPr({ style: 'Caption', bidi: b.rtl })}${this.text(b.alt, { paraRtl: b.rtl })}</w:p>` : '';
        if (!d) return `<w:p>${pPr({ style: 'Caption', bidi: b.rtl })}${this.text(`[${b.alt || b.src}]`, { paraRtl: b.rtl })}</w:p>`;
        return `<w:p>${pPr({ style: 'Figure', keepNext: !!b.alt })}<w:r>${d}</w:r></w:p>${caption}`;
      }
      case 'table': return this.table(b);
      case 'toc': return this.toc(b);
      case 'comment': {
        const lines = b.text.split('\n').map((l) => this.text(l, { paraRtl: b.rtl })).join('<w:r><w:br/></w:r>');
        return `<w:p>${pPr({ style: 'CommentBlock', bidi: b.rtl })}${lines}</w:p>`;
      }
      default: return '';
    }
  }

  list(b, depth) {
    const ilvl = Math.min(8, depth);
    const numId = this.num(b.ordered, ilvl, b.start);
    let out = '';
    for (const it of b.items) {
      const box = it.task ? this.text(it.task === 'done' ? '☑ ' : '☐ ', { paraRtl: it.rtl }) : '';
      // the indent is given directly too: whether a paragraph style's indent or a list's wins differs between Word, Pages and LibreOffice
      out += `<w:p>${pPr({ style: 'ListParagraph', numId, ilvl, bidi: it.rtl, ind: { left: listIndent(ilvl), hanging: 360 } })}${box}${this.runs(it.children, { paraRtl: it.rtl })}</w:p>`;
      for (const l of it.lists) out += this.list(l, depth + 1);
    }
    return out;
  }

  table(b) {
    const cols = b.align.length || 1;
    const colW = Math.floor(this.textWidthTw / cols);
    const border = hex(this.s.colors.rule) || 'BFBFBF';
    const cell = (c, i, head) => {
      const rtl = isRtl(plainText(c));
      const jc = b.align[i] === 'center' ? 'center' : b.align[i] === 'right' && !rtl ? 'right' : undefined;
      return `<w:tc><w:tcPr><w:tcW w:w="${colW}" w:type="dxa"/>${head ? `<w:shd w:val="clear" w:color="auto" w:fill="${hex(this.s.colors.codeBg) || 'F2F2F2'}"/>` : ''}</w:tcPr>`
        + `<w:p>${pPr({ style: 'TableText', bidi: rtl, jc })}${this.runs(c, { paraRtl: rtl, b: head })}</w:p></w:tc>`;
    };
    const row = (r, head) => `<w:tr>${head ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${r.map((c, i) => cell(c, i, head)).join('')}</w:tr>`;
    const edge = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="${border}"/>`;
    return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/>`
      + `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(edge).join('')}</w:tblBorders>`
      + `<w:tblLayout w:type="fixed"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>`
      + `<w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${colW}"/>`).join('')}</w:tblGrid>`
      + (b.head ? row(b.head, true) : '') + b.rows.map((r) => row(r, false)).join('') + '</w:tbl>';
  }

  /** A Word table of contents: the field Word updates (for page numbers), filled
   *  in already with a link to each heading, so it reads right before it is. */
  toc(b) {
    if (!b.entries.length) return '';
    const [lo, hi] = b.levels;
    const out = [];
    b.entries.forEach((e, k) => {
      let begin = '', end = '';
      if (k === 0) {
        begin = `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "${lo}-${hi}" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>`;
      }
      if (k === b.entries.length - 1) end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
      const rtl = isRtl(e.text);
      const level = Math.min(6, Math.max(1, e.level - lo + 1));
      out.push(`<w:p>${pPr({ style: `TOC${level}`, bidi: rtl })}${begin}<w:hyperlink w:anchor="_Toc${e.n}" w:history="1">${this.text(e.text, { paraRtl: rtl })}</w:hyperlink>${end}</w:p>`);
    });
    return out.join('');
  }

  // ---- parts ---------------------------------------------------------------------------

  documentXml() {
    let body = this.blocks(this.doc.blocks);
    const last = this.doc.blocks[this.doc.blocks.length - 1];
    if (!body || (last && last.type === 'table')) body += '<w:p/>';
    const s = this.s;
    const page = PAGE_SIZES[s.page.size] || PAGE_SIZES.A4;
    const m = s.page.margins;
    let refs = '';
    if (s.pageNumbers === 'footer') refs += `<w:footerReference w:type="default" r:id="${this.rel(`${R}/footer`, 'footer1.xml')}"/>`;
    if (s.pageNumbers === 'header') refs = `<w:headerReference w:type="default" r:id="${this.rel(`${R}/header`, 'header1.xml')}"/>` + refs;
    const cols = s.columns > 1 ? `<w:cols w:num="${s.columns}" w:space="${tw(s.columnGap)}"/>` : '<w:cols w:space="720"/>';
    const rtlDoc = RTL_LANG.test(this.opts.lang || this.doc.lang);
    const sect = `<w:sectPr>${refs}<w:pgSz w:w="${tw(page.width)}" w:h="${tw(page.height)}"/>`
      + `<w:pgMar w:top="${tw(m.top)}" w:right="${tw(m.right)}" w:bottom="${tw(m.bottom)}" w:left="${tw(m.left)}" w:header="${tw(Math.min(36, m.top / 2))}" w:footer="${tw(Math.min(36, m.bottom / 2))}" w:gutter="0"/>`
      + `${cols}${rtlDoc ? '<w:bidi/>' : ''}</w:sectPr>`;
    return `${XML_HEAD}<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}"><w:body>${body}${sect}</w:body></w:document>`;
  }

  footnotesXml() {
    const sep = '<w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote>'
      + '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>';
    const notes = this.footnotes.map((f) => `<w:footnote w:id="${f.id}"><w:p>${pPr({ style: 'FootnoteText', bidi: f.rtl })}`
      + '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>'
      + `${f.xml}</w:p></w:footnote>`).join('');
    return `${XML_HEAD}<w:footnotes xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}">${sep}${notes}</w:footnotes>`;
  }

  commentsXml() {
    const initials = this.author.split(/\s+/u).map((w) => w[0] || '').join('').slice(0, 3).toUpperCase() || 'M';
    // each comment's text is written here, after the body, so runs() cannot add to the list while it is read
    const items = this.comments.map((c) => {
      const rtl = isRtl(plainText(c.children));
      const text = this.inPart('comments', () => this.runs(c.children, { paraRtl: rtl, inFootnote: true }));
      return `<w:comment w:id="${c.id}" w:author="${esc(this.author)}" w:date="${this.date}" w:initials="${esc(initials)}">`
        + `<w:p>${pPr({ style: 'CommentText', bidi: rtl })}<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r>${text}</w:p></w:comment>`;
    }).join('');
    return `${XML_HEAD}<w:comments xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}">${items}</w:comments>`;
  }

  numberingXml() {
    const bullets = ['•', '◦', '▪'];
    const lvl = (i, ordered) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${ordered ? 'decimal' : 'bullet'}"/>`
      + `<w:lvlText w:val="${ordered ? `%${i + 1}.` : bullets[i % 3]}"/><w:lvlJc w:val="left"/>`
      + `<w:pPr><w:ind w:left="${listIndent(i)}" w:hanging="360"/></w:pPr>`
      + (ordered ? '' : '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:hint="default"/></w:rPr>')
      + '</w:lvl>';
    const abs = (id, ordered) => `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/>${Array.from({ length: 9 }, (_, i) => lvl(i, ordered)).join('')}</w:abstractNum>`;
    const nums = ['<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>',
      ...this.nums.map((n) => `<w:num w:numId="${n.numId}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="${n.ilvl}"><w:startOverride w:val="${n.start}"/></w:lvlOverride></w:num>`)];
    return `${XML_HEAD}<w:numbering xmlns:w="${W}">${abs(0, false)}${abs(1, true)}${nums.join('')}</w:numbering>`;
  }

  stylesXml() {
    const s = this.s, c = s.colors;
    const body = s.fonts.body, head = s.fonts.heading, mono = s.fonts.mono;
    const text = hex(c.text);
    const line = Math.round(s.lineSpacing * 240);
    const headLine = Math.round(Math.min(s.lineSpacing, 1.15) * 240);
    const P = (id, name, based, pp, rp, extra = '') => `<w:style w:type="paragraph" w:styleId="${id}"${extra}><w:name w:val="${name}"/>${based ? `<w:basedOn w:val="${based}"/>` : ''}`
      + `<w:next w:val="${id.startsWith('Heading') ? 'FirstParagraph' : 'Normal'}"/><w:qFormat/>${pPr(pp)}${rp ? `<w:rPr>${rPrInner(rp)}</w:rPr>` : ''}</w:style>`;
    const C = (id, name, rp) => `<w:style w:type="character" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="DefaultParagraphFont"/><w:rPr>${rPrInner(rp)}</w:rPr></w:style>`;
    const zero = { firstLine: 0 };
    const chapter = this.doc.chapterLevel;
    const out = [];
    out.push(`<w:docDefaults><w:rPrDefault><w:rPr>${rPrInner({ font: body, size: s.size })}${this.langXml('lang')}</w:rPr></w:rPrDefault>`
      + `<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="${line}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`);
    out.push(`<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/>${pPr({
      spacing: { before: tw(s.paragraph.before), after: tw(s.paragraph.after), line },
      ind: s.paragraph.indent ? { firstLine: tw(s.paragraph.indent) } : undefined,
      jc: s.paragraph.align === 'justify' ? 'both' : undefined,
    })}<w:rPr>${rPrInner({ color: text })}</w:rPr></w:style>`);
    out.push('<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>');
    out.push('<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>');
    out.push('<w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/></w:style>');
    out.push(P('FirstParagraph', 'First Paragraph', 'Normal', { ind: zero }));
    s.headings.forEach((h, i) => {
      const level = i + 1;
      out.push(P(`Heading${level}`, `heading ${level}`, 'Normal', {
        keepNext: true, keepLines: true,
        pageBreakBefore: s.pageBreaks && chapter !== null && level <= chapter,
        border: h.rule ? { side: 'bottom', sz: 12, space: 4, color: hex(c.rule) || '000000' } : undefined,
        spacing: { before: tw(h.before), after: tw(h.after), line: headLine },
        // 'left' undoes a justified Normal; in a right-to-left paragraph Word reads it as the start, the right
        ind: zero, jc: h.align === 'center' ? 'center' : 'left', outline: i,
      }, { font: head, b: h.bold, i: !!h.italic, caps: !!h.uppercase, smallCaps: !!h.smallCaps, color: hex(h.color || c.heading), size: h.size }));
    });
    out.push(P('Title', 'Title', 'Normal', { keepNext: true, spacing: { before: 0, after: tw(18), line: headLine }, ind: zero, jc: 'center' },
      { font: head, b: s.headings[0].bold, color: hex(c.heading), size: Math.round(s.headings[0].size * 1.25) }));
    out.push(P('Quote', 'Quote', 'Normal', {
      border: s.quote.rule ? { side: 'left', sz: 12, space: 8, color: hex(c.rule) || '999999' } : undefined,
      ind: { left: tw(s.quote.indent), right: s.quote.rule ? 0 : tw(s.quote.indent), firstLine: 0 },
    }, { i: s.quote.italic, size: s.quote.size }));
    out.push(P('ListParagraph', 'List Paragraph', 'Normal', { spacing: { after: tw(Math.max(2, s.paragraph.after / 3)) }, ind: { left: 720, hanging: 360 } }));
    out.push(P('SourceCode', 'Source Code', 'Normal', {
      shd: hex(c.codeBg) || undefined, spacing: { before: 0, after: tw(s.paragraph.after || 6), line: 240 }, ind: zero, jc: 'left',
    }, { font: mono, size: s.code.size }));
    out.push(P('MathBlock', 'Math Block', 'Normal', { spacing: { after: tw(s.paragraph.after || 6) }, ind: zero, jc: 'center' }, { font: mono, size: s.code.size }));
    out.push(P('Divider', 'Divider', 'Normal', {
      border: s.divider === 'rule' ? { side: 'bottom', sz: 6, space: 1, color: hex(c.rule) || '999999' } : undefined,
      spacing: { before: tw(s.size), after: tw(s.size * 1.5), line: 240 },
      ind: s.divider === 'rule' ? { left: Math.round(this.textWidthTw * 0.3), right: Math.round(this.textWidthTw * 0.3), firstLine: 0 } : zero, jc: 'center',
    }));
    out.push(P('Figure', 'Figure', 'Normal', { spacing: { before: tw(6), after: tw(4) }, ind: zero, jc: 'center' }));
    out.push(P('Caption', 'caption', 'Normal', { spacing: { after: tw(12) }, ind: zero, jc: 'center' }, { i: true, size: Math.max(8, s.size - 1.5), color: hex(c.muted) }));
    out.push(P('TableText', 'Table Text', 'Normal', { spacing: { before: 40, after: 40, line: 240 }, ind: zero, jc: 'left' }, { size: Math.max(8, s.size - 1) }));
    out.push(P('FootnoteText', 'footnote text', 'Normal', { spacing: { before: 0, after: 60, line: 240 }, ind: zero, jc: 'left' }, { size: s.footnote.size }));
    out.push(P('CommentText', 'annotation text', 'Normal', { spacing: { before: 0, after: 0, line: 240 }, ind: zero }, { size: 10 }));
    out.push(P('CommentBlock', 'Comment Block', 'Normal', {
      border: { side: 'left', sz: 18, space: 6, color: hex(c.comment) || '8A5300' }, shd: hex(c.commentBg) || undefined, ind: zero,
    }, { i: true, color: hex(c.comment), size: Math.max(8, s.size - 1) }));
    for (let i = 1; i <= 6; i++) out.push(P(`TOC${i}`, `toc ${i}`, 'Normal', { spacing: { before: 0, after: 60, line: headLine }, ind: { left: 240 * (i - 1), firstLine: 0 }, jc: 'left' }));
    out.push(C('VerbatimChar', 'Verbatim Char', { font: mono, size: Math.max(7, s.size - 1) }));
    out.push(C('Hyperlink', 'Hyperlink', { color: hex(c.link), u: true }));
    out.push(C('FootnoteReference', 'footnote reference', { sup: true }));
    out.push(C('CommentReference', 'annotation reference', { size: 8 }));
    out.push(`<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="39"/><w:tblPr><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((e) => `<w:${e} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`).join('')}</w:tblBorders></w:tblPr></w:style>`);
    return `${XML_HEAD}<w:styles xmlns:w="${W}">${out.join('')}</w:styles>`;
  }

  /** Word's languages: one for Latin text and one for Hebrew or Arabic (w:bidi), the document's in its place. */
  langXml(tag) {
    const lang = this.opts.lang || this.doc.lang;
    const rtl = RTL_LANG.test(lang);
    return `<w:${tag} w:val="${rtl ? 'en-US' : wordLang(lang)}"${tag === 'lang' ? ' w:eastAsia="en-US"' : ''} w:bidi="${rtl ? wordLang(lang) : 'he-IL'}"/>`;
  }

  settingsXml() {
    const hyphen = this.s.paragraph.align === 'justify' ? '<w:autoHyphenation/>' : '';
    return `${XML_HEAD}<w:settings xmlns:w="${W}"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/>${hyphen}`
      + '<w:characterSpacingControl w:val="doNotCompress"/>'
      + '<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>'
      + '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>'
      + `${this.langXml('themeFontLang')}</w:settings>`;
  }

  fontTableXml() {
    const fonts = new Set();
    for (const f of Object.values(this.s.fonts)) { fonts.add(f.word); fonts.add(f.cs); }
    fonts.add('Arial');
    const items = [...fonts].map((name) => {
      const family = FONT_FAMILY[name] || 'auto';
      return `<w:font w:name="${esc(name)}"><w:charset w:val="00"/><w:family w:val="${family}"/><w:pitch w:val="${family === 'modern' ? 'fixed' : 'variable'}"/></w:font>`;
    }).join('');
    return `${XML_HEAD}<w:fonts xmlns:w="${W}">${items}</w:fonts>`;
  }

  /** A header or footer: the page number, and in a manuscript's header the author and title before it. */
  pageNumberPart(tag) {
    const s = this.s;
    const r = { size: tag === 'hdr' ? s.size : 9, color: tag === 'hdr' ? null : hex(s.colors.muted) };
    const run = (inner) => `<w:r>${rPr(r)}${inner}</w:r>`;
    const field = run('<w:fldChar w:fldCharType="begin"/>') + run('<w:instrText xml:space="preserve"> PAGE </w:instrText>')
      + run('<w:fldChar w:fldCharType="separate"/>') + run('<w:t>1</w:t>') + run('<w:fldChar w:fldCharType="end"/>');
    const who = tag === 'hdr' ? [this.opts.author, this.opts.title || this.doc.title].filter(Boolean).map((x) => `${x} / `).join('') : '';
    const p = `<w:p>${pPr({ spacing: { before: 0, after: 0, line: 240 }, ind: { firstLine: 0 }, jc: tag === 'hdr' ? 'right' : 'center' })}${who ? this.text(who, r) : ''}${field}</w:p>`;
    return `${XML_HEAD}<w:${tag} xmlns:w="${W}" xmlns:r="${R}">${p}</w:${tag}>`;
  }

  coreXml() {
    const title = this.opts.title || this.doc.title;
    return `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`
      + `<dc:title>${esc(title)}</dc:title>${this.opts.author ? `<dc:creator>${esc(this.opts.author)}</dc:creator><cp:lastModifiedBy>${esc(this.opts.author)}</cp:lastModifiedBy>` : ''}`
      + `<dc:language>${esc(wordLang(this.opts.lang || this.doc.lang))}</dc:language>`
      + `<dcterms:created xsi:type="dcterms:W3CDTF">${this.date}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${this.date}</dcterms:modified></cp:coreProperties>`;
  }

  /** @returns {Uint8Array} */
  build() {
    const s = this.s;
    // the body first: writing it is what finds the footnotes, comments, links and images
    const document = this.documentXml();
    const comments = this.comments.length ? this.commentsXml() : null;
    const footnotes = this.footnotesXml();
    const fixed = [
      { id: 'rId1', type: `${R}/styles`, target: 'styles.xml' },
      { id: 'rId2', type: `${R}/numbering`, target: 'numbering.xml' },
      { id: 'rId3', type: `${R}/footnotes`, target: 'footnotes.xml' },
      { id: 'rId4', type: `${R}/settings`, target: 'settings.xml' },
      { id: 'rId5', type: `${R}/fontTable`, target: 'fontTable.xml' },
    ];
    if (comments) fixed.push({ id: 'rId6', type: `${R}/comments`, target: 'comments.xml' });
    const relsXml = (list) => `${XML_HEAD}<Relationships xmlns="${PKG_REL}">${list.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${esc(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`;
    const exts = [...new Set(this.media.map((m) => m.name.split('.').pop()))];
    const EXT_TYPE = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp' };
    const over = (part, type) => `<Override PartName="${part}" ContentType="${type}"/>`;
    const types = `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + exts.map((e) => `<Default Extension="${e}" ContentType="${EXT_TYPE[e]}"/>`).join('')
      + over('/word/document.xml', `${CT}.document.main+xml`) + over('/word/styles.xml', `${CT}.styles+xml`)
      + over('/word/numbering.xml', `${CT}.numbering+xml`) + over('/word/footnotes.xml', `${CT}.footnotes+xml`)
      + over('/word/settings.xml', `${CT}.settings+xml`) + over('/word/fontTable.xml', `${CT}.fontTable+xml`)
      + (comments ? over('/word/comments.xml', `${CT}.comments+xml`) : '')
      + (s.pageNumbers === 'footer' ? over('/word/footer1.xml', `${CT}.footer+xml`) : '')
      + (s.pageNumbers === 'header' ? over('/word/header1.xml', `${CT}.header+xml`) : '')
      + over('/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml')
      + over('/docProps/app.xml', 'application/vnd.openxmlformats-officedocument.extended-properties+xml')
      + '</Types>';
    const rootRels = `${XML_HEAD}<Relationships xmlns="${PKG_REL}">`
      + `<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/>`
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
      + `<Relationship Id="rId3" Type="${R}/extended-properties" Target="docProps/app.xml"/></Relationships>`;
    const app = `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Moshe</Application></Properties>`;
    const files = [
      { name: '[Content_Types].xml', data: types },
      { name: '_rels/.rels', data: rootRels },
      { name: 'docProps/core.xml', data: this.coreXml() },
      { name: 'docProps/app.xml', data: app },
      { name: 'word/document.xml', data: document },
      { name: 'word/_rels/document.xml.rels', data: relsXml([...fixed, ...this.rels.document]) },
      { name: 'word/styles.xml', data: this.stylesXml() },
      { name: 'word/numbering.xml', data: this.numberingXml() },
      { name: 'word/footnotes.xml', data: footnotes },
      { name: 'word/settings.xml', data: this.settingsXml() },
      { name: 'word/fontTable.xml', data: this.fontTableXml() },
    ];
    if (this.rels.footnotes.length) files.push({ name: 'word/_rels/footnotes.xml.rels', data: relsXml(this.rels.footnotes) });
    if (comments) files.push({ name: 'word/comments.xml', data: comments });
    if (this.rels.comments.length) files.push({ name: 'word/_rels/comments.xml.rels', data: relsXml(this.rels.comments) });
    if (s.pageNumbers === 'footer') files.push({ name: 'word/footer1.xml', data: this.pageNumberPart('ftr') });
    if (s.pageNumbers === 'header') files.push({ name: 'word/header1.xml', data: this.pageNumberPart('hdr') });
    for (const m of this.media) files.push({ name: `word/media/${m.name}`, data: m.bytes });
    return createZip(files, { date: this.opts.date });
  }
}

/**
 * The document as a .docx file.
 * @param {Doc} doc
 * @param {string|object} [style]  an export style or its id
 * @param {{title?: string, author?: string, lang?: string, date?: Date,
 *          images?: Record<string, {bytes: Uint8Array, type: string, width?: number, height?: number}>,
 *          trackChanges?: boolean, comments?: 'word'|'inline'}} [opts]
 *   images: pictures by their path in the text (PNG, JPEG, GIF); one not given shows its caption.
 *   trackChanges (default true): a revision copy's deletions and insertions as Word's tracked
 *   changes; false: as struck-through and underlined text. comments: 'word' (the default) as
 *   Word comments, 'inline' as highlighted text.
 * @returns {Uint8Array}
 */
export function toDocx(doc, style, opts = {}) {
  return new DocxWriter(doc, resolveStyle(style), opts).build();
}
