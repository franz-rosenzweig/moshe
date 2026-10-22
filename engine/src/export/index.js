// Export: some sheets, in an export style, as a file. This is the one call the
// app makes (the export sheet's "Export" button, "Print", "Copy as…"); the
// modules it draws on can also be used alone: doc.js reads the sheets into
// one document, and html, markdown, docx and epub write it out.
//
// Nothing here touches the disk or the network, so it runs the same in the
// page and in Node; what comes back is bytes (or text) for the caller to save,
// share or print.
import { buildDoc } from './doc.js';
import { resolveStyle, STYLES, STYLE_ORDER } from './styles.js';
import { toHtml } from './html.js';
import { toMarkdown, toText } from './markdown.js';
import { toDocx } from './docx.js';
import { toEpub } from './epub.js';
import { createZip } from './zip.js';

export { buildDoc, resolveStyle, STYLES, STYLE_ORDER, toHtml, toMarkdown, toText, toDocx, toEpub, createZip };

/** The formats, in the order the export sheet offers them, with what exportSheets returns for each. */
export const FORMATS = [
  // printed to PDF by the app: what exportSheets gives is the page to print
  { id: 'pdf-html', name: 'PDF', extension: 'html', mime: 'text/html', print: true },
  { id: 'docx', name: 'Word (DOCX)', extension: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { id: 'epub', name: 'ePub', extension: 'epub', mime: 'application/epub+zip' },
  { id: 'html', name: 'HTML', extension: 'html', mime: 'text/html' },
  { id: 'markdown', name: 'Markdown', extension: 'md', mime: 'text/markdown' },
  { id: 'textbundle', name: 'TextPack', extension: 'textpack', mime: 'application/zip' },
  { id: 'text', name: 'Plain Text', extension: 'txt', mime: 'text/plain' },
];

const encoder = new TextEncoder();

/** A title as a file name: no characters a file system refuses. */
export function fileName(title, extension) {
  const base = String(title || 'Untitled').replace(/[\\/:*?"<>|\u0000-\u001F]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 120) || 'Untitled';
  return `${base}.${extension}`;
}

/** The part of an image's path a bundle keeps it under: its name, made unique. */
function assetName(src, used) {
  const base = (src.split(/[\\/]/u).pop() || 'image').replace(/[^\p{L}\p{N}._ -]+/gu, '-');
  let name = base, k = 2;
  while (used.has(name)) name = base.replace(/(\.[^.]*)?$/u, (ext) => `-${k}${ext || ''}`), k++;
  used.add(name);
  return name;
}

/**
 * Some sheets as an exported file.
 * @param {{title?: string, body?: string, text?: string}[]} sheets  in order; `text` is a whole file with its
 *   front matter (a material sheet is then left out), `body` the text without it
 * @param {object} [opts]
 * @param {'html'|'pdf-html'|'docx'|'epub'|'markdown'|'text'|'textbundle'} [opts.format='html']
 *   'pdf-html' is the page the app prints to PDF: the HTML page, laid out for print
 * @param {string|object} [opts.style='everyday']  an export style's id, or a style object (laid over Everyday)
 * @param {string} [opts.title]      the document's title (by default the first sheet's)
 * @param {string} [opts.author]
 * @param {string} [opts.lang]       by default a guess: 'he' when most paragraphs are Hebrew, else 'en'
 * @param {number|number[]} [opts.tocLevels=[1, 3]]  the headings a (toc) lists
 * @param {Record<string, {bytes: Uint8Array, type: string, width?: number, height?: number}>} [opts.images]
 *   the pictures the text refers to, by their path in it (_media/…), to embed
 * @param {boolean} [opts.revision]  show the writer's marks (by default the style's say; never for
 *   Markdown, text and TextPack, which have no way to show them)
 * @param {'omit'|'inline'|'footnotes'|'margin'} [opts.annotations]  what an annotation's note becomes
 * @param {string} [opts.pageSize]      'A4', 'Letter' or 'A5' (in any case); by default the style's
 * @param {boolean} [opts.full=true]     HTML: the whole page with its CSS; false: the <article> alone (for the clipboard)
 * @param {number|object} [opts.margins]  in points
 * @param {boolean} [opts.pageBreaks]     each chapter on a new page (by default the style's say)
 * @param {{bytes: Uint8Array, type: string}} [opts.cover]  an EPUB's cover picture
 * @param {Date} [opts.date]
 * @returns {{text?: string, bytes: Uint8Array, mime: string, extension: string, filename: string}}
 *   text for the formats that are text; bytes always
 */
export function exportSheets(sheets, opts = {}) {
  const format = opts.format || 'html';
  const style = resolveStyle(opts.style, { pageSize: opts.pageSize, margins: opts.margins, pageBreaks: opts.pageBreaks });
  const plain = format === 'markdown' || format === 'text' || format === 'textbundle';
  const revision = plain ? false : opts.revision ?? style.revision;
  const doc = buildDoc(sheets, {
    revision, annotations: opts.annotations, tocLevels: opts.tocLevels, title: opts.title, lang: opts.lang,
  });
  const common = { title: opts.title || doc.title, author: opts.author, lang: opts.lang || doc.lang, images: opts.images, date: opts.date };
  const text = (t, mime, extension) => ({ text: t, bytes: encoder.encode(t), mime, extension, filename: fileName(common.title, extension) });
  const bin = (bytes, mime, extension) => ({ bytes, mime, extension, filename: fileName(common.title, extension) });
  switch (format) {
    case 'html': return text(toHtml(doc, style, { ...common, full: opts.full !== false }), 'text/html', 'html');
    case 'pdf-html': return text(toHtml(doc, style, { ...common, full: opts.full !== false, unresolvedImages: 'caption' }), 'text/html', 'html');
    case 'markdown': return text(toMarkdown(doc), 'text/markdown', 'md');
    case 'text': return text(toText(doc), 'text/plain', 'txt');
    case 'docx': return bin(toDocx(doc, style, common), FORMATS[1].mime, 'docx');
    case 'epub': return bin(toEpub(doc, style, { ...common, tocLevels: opts.tocLevels, cover: opts.cover }), 'application/epub+zip', 'epub');
    case 'textbundle': {
      // a TextPack: the bundle's folder zipped, its pictures in assets/ and the text pointing there
      const images = opts.images || {};
      const used = new Set();
      const assets = new Map();
      const md = toMarkdown(doc, {
        imageSrc: (src) => {
          if (!images[src] || !images[src].bytes) return src;
          if (!assets.has(src)) assets.set(src, assetName(src, used));
          return `assets/${assets.get(src)}`;
        },
      });
      const folder = fileName(common.title, 'textbundle');
      const info = { version: 2, type: 'net.daringfireball.markdown', transient: false, creatorIdentifier: 'xyz.tiresia.moshe' };
      const entries = [
        { name: `${folder}/` },
        { name: `${folder}/info.json`, data: `${JSON.stringify(info, null, 2)}\n` },
        { name: `${folder}/text.md`, data: md },
        { name: `${folder}/assets/` },
        ...[...assets].map(([src, name]) => ({ name: `${folder}/assets/${name}`, data: images[src].bytes })),
      ];
      return bin(createZip(entries, { date: opts.date }), 'application/zip', 'textpack');
    }
    default: throw new Error(`unknown export format: ${format}`);
  }
}
