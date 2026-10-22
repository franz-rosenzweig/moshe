// The export styles: how an exported document looks, in seven styles a writer
// often wants. One description serves every format, so a document
// exported as HTML, PDF, DOCX and EPUB in the same style looks like the same
// document: the HTML exporter turns it into CSS, the DOCX exporter into Word
// styles, the EPUB exporter into a lighter CSS that leaves the reader's own
// settings alone.
//
// Sizes are in points. Fonts come twice: a CSS stack for the page (the first
// one installed wins) and a single name for Word, which has no stacks; `cs`
// is Word's font for Hebrew and Arabic, since not every Latin font has them.

/**
 * @typedef {{css: string, word: string, cs: string}} Font
 * @typedef {{size: number, bold: boolean, italic?: boolean, smallCaps?: boolean, uppercase?: boolean,
 *            align: 'start'|'center', before: number, after: number, color?: string, rule?: boolean}} HeadingStyle
 * @typedef {object} ExportStyle
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {{body: Font, heading: Font, mono: Font}} fonts
 * @property {number} size             body text
 * @property {number} lineHeight       CSS line-height
 * @property {number} lineSpacing      Word's line spacing ("multiple"): 1 single, 2 double
 * @property {{before: number, after: number, indent: number, align: 'start'|'justify'}} paragraph
 *   indent is the first line's, and is not given to a paragraph that follows a heading or starts a block
 * @property {HeadingStyle[]} headings  levels 1 to 6
 * @property {{italic: boolean, indent: number, rule: boolean, size: number}} quote
 * @property {{size: number}} code
 * @property {{size: number}} footnote
 * @property {{size: 'A4'|'Letter'|'A5', margins: {top: number, right: number, bottom: number, left: number}}} page
 * @property {{text: string, heading: string, link: string, mark: string, muted: string, rule: string, codeBg: string,
 *             comment: string, commentBg: string, deletion: string, insertion: string, note: string}} colors
 * @property {number} columns
 * @property {number} columnGap
 * @property {'rule'|'asterisks'|'hash'} divider
 * @property {boolean} pageBreaks      each chapter (see Doc.chapterLevel) on a new page
 * @property {'footer'|'header'|null} pageNumbers  manuscript's header carries the author and title too
 * @property {boolean} revision        show the writer's marks: comments, deletions, insertions, annotations
 */

/** Page sizes in points. */
export const PAGE_SIZES = {
  A4: { width: 595.28, height: 841.89 },
  Letter: { width: 612, height: 792 },
  A5: { width: 419.53, height: 595.28 },
};

/** A page size's name as PAGE_SIZES has it, whatever its case ('a4', 'letter'), or null. */
export function pageSizeName(name) {
  const k = Object.keys(PAGE_SIZES).find((x) => x.toLowerCase() === String(name || '').toLowerCase());
  return k || null;
}

const IN = 72, CM = 72 / 2.54;
const margins = (v) => ({ top: v, right: v, bottom: v, left: v });

const SANS = { css: '"Helvetica Neue", Helvetica, Arial, "Noto Sans Hebrew", "Arial Hebrew", sans-serif', word: 'Arial', cs: 'Arial' };
const SERIF = { css: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", "Frank Ruehl CLM", "Noto Serif Hebrew", serif', word: 'Times New Roman', cs: 'Times New Roman' };
const MONO = { css: '"SF Mono", Menlo, Consolas, "Liberation Mono", "Courier New", monospace', word: 'Consolas', cs: 'Courier New' };

const BASE_COLORS = {
  text: '#1d1d1f', heading: '#1d1d1f', link: '#0b62c4', mark: '#fff0a0', muted: '#6e6e73', rule: '#c8c8cc',
  codeBg: '#f4f4f5', comment: '#8a5300', commentBg: '#fff1cc', deletion: '#c62828', insertion: '#1b7f3b', note: '#6b5a00',
};

/** Six heading levels from a list of sizes and what they share. */
function headings(sizes, common, per = []) {
  return sizes.map((size, i) => ({ size, bold: true, align: 'start', before: Math.round(size * 0.9), after: Math.round(size * 0.35), ...common, ...(per[i] || {}) }));
}

/** @type {Record<string, ExportStyle>} */
export const STYLES = {
  everyday: {
    id: 'everyday', name: 'Everyday',
    description: 'Clean and neutral: a sans-serif face, generous spacing, bold headings. Good for anything.',
    fonts: { body: SANS, heading: SANS, mono: MONO },
    size: 11, lineHeight: 1.5, lineSpacing: 1.15,
    paragraph: { before: 0, after: 8, indent: 0, align: 'start' },
    headings: headings([22, 17, 14, 12, 11, 11], {}, [{ after: 10 }, {}, {}, {}, { italic: true }, { italic: true, bold: false }]),
    quote: { italic: false, indent: 18, rule: true, size: 11 },
    code: { size: 9.5 },
    footnote: { size: 9 },
    page: { size: 'A4', margins: margins(2.5 * CM) },
    colors: { ...BASE_COLORS },
    columns: 1, columnGap: 18,
    divider: 'rule',
    pageBreaks: false,
    pageNumbers: 'footer',
    revision: false,
  },
  essay: {
    id: 'essay', name: 'Essay',
    description: 'For essays and papers: a book serif, wide line spacing, indented paragraphs, centred small-caps headings.',
    fonts: { body: SERIF, heading: SERIF, mono: MONO },
    size: 12, lineHeight: 1.9, lineSpacing: 1.8,
    paragraph: { before: 0, after: 0, indent: 0.5 * IN, align: 'start' },
    headings: headings([15, 13, 12, 12, 12, 12], { bold: false, align: 'center', smallCaps: true, before: 24, after: 12 },
      [{ bold: true, before: 30, after: 18 }, {}, { smallCaps: false, italic: true }, { smallCaps: false, italic: true, align: 'start' },
        { smallCaps: false, italic: true, align: 'start' }, { smallCaps: false, italic: true, align: 'start' }]),
    quote: { italic: false, indent: 0.5 * IN, rule: false, size: 11 },
    code: { size: 10 },
    footnote: { size: 10 },
    page: { size: 'A4', margins: margins(IN) },
    colors: { ...BASE_COLORS, text: '#111', heading: '#111', link: '#111' },
    columns: 1, columnGap: 18,
    divider: 'asterisks',
    pageBreaks: false,
    pageNumbers: 'footer',
    revision: false,
  },
  business: {
    id: 'business', name: 'Business',
    description: 'Reports and proposals: a compact sans-serif with strong, dark blue headings and a rule under the title.',
    fonts: {
      body: { css: '"Segoe UI", "Helvetica Neue", Calibri, Arial, "Noto Sans Hebrew", sans-serif', word: 'Calibri', cs: 'Arial' },
      heading: { css: '"Helvetica Neue", "Segoe UI", Arial, "Noto Sans Hebrew", sans-serif', word: 'Arial', cs: 'Arial' },
      mono: MONO,
    },
    size: 10.5, lineHeight: 1.45, lineSpacing: 1.1,
    paragraph: { before: 0, after: 8, indent: 0, align: 'start' },
    headings: headings([20, 15, 12.5, 11, 10.5, 10.5], { color: '#1f3a5f' }, [{ rule: true, before: 12, after: 12 }, { before: 18 }]),
    quote: { italic: true, indent: 18, rule: true, size: 10.5 },
    code: { size: 9 },
    footnote: { size: 8.5 },
    page: { size: 'A4', margins: margins(2 * CM) },
    colors: { ...BASE_COLORS, heading: '#1f3a5f', link: '#1f5fbf', rule: '#1f3a5f' },
    columns: 1, columnGap: 18,
    divider: 'rule',
    pageBreaks: false,
    pageNumbers: 'footer',
    revision: false,
  },
  manuscript: {
    id: 'manuscript', name: 'Manuscript',
    description: 'Standard manuscript format for submissions: Courier 12pt, double-spaced, one-inch margins, chapters on new pages.',
    fonts: {
      body: { css: '"Courier New", Courier, "Courier Prime", "Liberation Mono", monospace', word: 'Courier New', cs: 'Courier New' },
      heading: { css: '"Courier New", Courier, "Courier Prime", "Liberation Mono", monospace', word: 'Courier New', cs: 'Courier New' },
      mono: { css: '"Courier New", Courier, monospace', word: 'Courier New', cs: 'Courier New' },
    },
    size: 12, lineHeight: 2, lineSpacing: 2,
    paragraph: { before: 0, after: 0, indent: 0.5 * IN, align: 'start' },
    headings: headings([12, 12, 12, 12, 12, 12], { bold: false, align: 'center', before: 0, after: 24 },
      [{ uppercase: true, before: 2 * IN }, {}, { align: 'start', italic: true }, { align: 'start' }, { align: 'start' }, { align: 'start' }]),
    quote: { italic: false, indent: 0.5 * IN, rule: false, size: 12 },
    code: { size: 12 },
    footnote: { size: 12 },
    page: { size: 'Letter', margins: margins(IN) },
    colors: { ...BASE_COLORS, text: '#000', heading: '#000', link: '#000', mark: '#fff0a0', muted: '#000', rule: '#000', codeBg: 'transparent' },
    columns: 1, columnGap: 18,
    divider: 'hash',
    pageBreaks: true,
    pageNumbers: 'header',
    revision: false,
  },
  papers: {
    id: 'papers', name: 'Papers',
    description: 'A compact serif page, like a journal article: small type, tight leading, indented paragraphs.',
    fonts: {
      body: { css: 'Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, "Noto Serif Hebrew", serif', word: 'Cambria', cs: 'Times New Roman' },
      heading: { css: 'Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, "Noto Serif Hebrew", serif', word: 'Cambria', cs: 'Times New Roman' },
      mono: MONO,
    },
    size: 10.5, lineHeight: 1.4, lineSpacing: 1.1,
    paragraph: { before: 0, after: 0, indent: 14, align: 'justify' },
    headings: headings([16, 12.5, 11, 10.5, 10.5, 10.5], { before: 14, after: 6 }, [{ before: 0, after: 12 }, {}, { italic: true }, { italic: true, bold: false }, { italic: true, bold: false }, { italic: true, bold: false }]),
    quote: { italic: false, indent: 18, rule: false, size: 9.5 },
    code: { size: 8.5 },
    footnote: { size: 8.5 },
    page: { size: 'A4', margins: margins(2 * CM) },
    colors: { ...BASE_COLORS, text: '#161616', heading: '#161616', link: '#1a4f8b' },
    columns: 1, columnGap: 18,
    divider: 'asterisks',
    pageBreaks: false,
    pageNumbers: 'footer',
    revision: false,
  },
  columns: {
    id: 'columns', name: 'Columns',
    description: 'Two justified columns of serif text under sans-serif headings, like a newsletter.',
    fonts: {
      body: { css: 'Georgia, "Sitka Text", Cambria, "Times New Roman", "Noto Serif Hebrew", serif', word: 'Georgia', cs: 'Times New Roman' },
      heading: SANS,
      mono: MONO,
    },
    size: 10, lineHeight: 1.4, lineSpacing: 1.05,
    paragraph: { before: 0, after: 5, indent: 0, align: 'justify' },
    headings: headings([22, 14, 11.5, 10.5, 10, 10], { before: 10, after: 5 }, [{ before: 0, after: 12 }]),
    quote: { italic: true, indent: 10, rule: true, size: 10 },
    code: { size: 8.5 },
    footnote: { size: 8.5 },
    page: { size: 'A4', margins: margins(1.8 * CM) },
    colors: { ...BASE_COLORS, heading: '#222', link: '#0b62c4' },
    columns: 2, columnGap: 20,
    divider: 'rule',
    pageBreaks: false,
    pageNumbers: 'footer',
    revision: false,
  },
  revision: {
    id: 'revision', name: 'Revision',
    description: 'For review: shows comments, deletions (struck through), insertions (underlined) and annotations in the margin.',
    fonts: { body: SANS, heading: SANS, mono: MONO },
    size: 11, lineHeight: 1.6, lineSpacing: 1.3,
    paragraph: { before: 0, after: 8, indent: 0, align: 'start' },
    headings: headings([20, 16, 13, 11.5, 11, 11], {}),
    quote: { italic: false, indent: 18, rule: true, size: 11 },
    code: { size: 9.5 },
    footnote: { size: 9 },
    page: { size: 'A4', margins: margins(2.5 * CM) },
    colors: { ...BASE_COLORS },
    columns: 1, columnGap: 18,
    divider: 'rule',
    pageBreaks: false,
    pageNumbers: 'footer',
    revision: true,
  },
};

/** The styles' ids in the order the export dialog offers them (each one's name is STYLES[id].name). */
export const STYLE_ORDER = ['everyday', 'essay', 'business', 'manuscript', 'papers', 'columns', 'revision'];

const clone = (v) => JSON.parse(JSON.stringify(v));

/** b laid over a, object by object (arrays and values replaced). */
function merge(a, b) {
  const out = clone(a);
  for (const [k, v] of Object.entries(b || {})) {
    if (v === undefined) continue;
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = merge(out[k], v);
    else out[k] = clone(v);
  }
  return out;
}

/**
 * A style ready to export with: a built-in one by id, or a style object laid
 * over Everyday (so a custom style need only say what differs), with the
 * page and a few choices overridden.
 * @param {string|Partial<ExportStyle>} [style]
 * @param {{pageSize?: string, margins?: number|object, pageBreaks?: boolean, columns?: number,
 *          revision?: boolean, pageNumbers?: 'footer'|'header'|null}} [overrides]
 *   pageSize 'A4', 'Letter' or 'A5', in any case; margins in points
 * @returns {ExportStyle}
 */
export function resolveStyle(style, overrides = {}) {
  let s;
  if (style && typeof style === 'object') s = merge(STYLES[style.id] || STYLES.everyday, style);
  else s = clone(STYLES[style] || STYLES.everyday);
  const o = overrides || {};
  if (pageSizeName(o.pageSize)) s.page.size = pageSizeName(o.pageSize);
  if (typeof o.margins === 'number') s.page.margins = margins(o.margins);
  else if (o.margins && typeof o.margins === 'object') s.page.margins = { ...s.page.margins, ...o.margins };
  for (const k of ['pageBreaks', 'columns', 'revision', 'pageNumbers']) if (o[k] !== undefined) s[k] = o[k];
  return s;
}

/** The width the text runs to, in points (the page less its side margins). */
export function textWidth(style) {
  const p = PAGE_SIZES[style.page.size] || PAGE_SIZES.A4;
  return p.width - style.page.margins.left - style.page.margins.right;
}
