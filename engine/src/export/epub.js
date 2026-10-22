// An EPUB 3 book from an export document: a chapter file for each chapter
// (a heading at the document's chapter level, see Doc.chapterLevel; or each
// sheet, when the headings do not divide the text), the table of contents
// twice — nav.xhtml for EPUB 3 readers and toc.ncx for the older ones some
// e-readers still are — and the export style's CSS in its lighter, book form.
// Footnotes are EPUB 3 footnote asides at the end of the chapter that refers
// to them, so readers that pop them up (Apple Books, KOReader, Kobo) do, and
// the others show them at the chapter's end with a link back.
import { createZip } from './zip.js';
import { resolveStyle } from './styles.js';
import { renderBlocks, renderFootnoteBody, styleCss, escapeHtml as esc } from './html.js';
import { footnotesIn, plainText, isRtl, tocTree, tocRange } from './doc.js';
import { sha1 } from '../sha1.js';

/** @typedef {import('./doc.js').Doc} Doc @typedef {import('./doc.js').Block} Block */

const MEDIA = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/webp': 'webp' };
const RTL_LANG = /^(he|iw|yi|ar|fa|ur)\b/iu;

/** A name-based (version 5 style) UUID from a text, so a book exported again
 *  keeps its identifier and a reader's library replaces it rather than
 *  keeping both. */
function uuidFrom(text) {
  const h = sha1(text);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * The document cut into chapters.
 * @param {Doc} doc
 * @returns {{blocks: Block[], title: string, heading: Block|null, file: string}[]}
 */
export function chaptersOf(doc) {
  const chapters = [];
  let cur = null;
  const level = doc.chapterLevel;
  for (const b of doc.blocks) {
    const starts = level !== null ? b.type === 'heading' && b.level <= level : cur && b.sheet !== cur.sheet;
    if (!cur || starts) {
      cur = { blocks: [], sheet: b.sheet, heading: b.type === 'heading' ? b : null };
      chapters.push(cur);
    }
    cur.blocks.push(b);
  }
  if (!chapters.length) chapters.push({ blocks: [], sheet: 0, heading: null });
  return chapters.map((ch, i) => ({
    blocks: ch.blocks,
    heading: ch.heading,
    title: ch.heading ? ch.heading.text : (doc.sheets[ch.sheet] && doc.sheets[ch.sheet].title) || doc.title,
    file: `ch${String(i + 1).padStart(3, '0')}.xhtml`,
  }));
}

const page = (lang, title, body, bodyAttrs = '') => {
  const dir = RTL_LANG.test(lang) ? ' dir="rtl"' : '';
  return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n'
    + `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${esc(lang)}" xml:lang="${esc(lang)}"${dir}>\n`
    + `<head>\n<meta charset="UTF-8"/>\n<title>${esc(title)}</title>\n<link rel="stylesheet" type="text/css" href="style.css"/>\n</head>\n`
    + `<body${bodyAttrs}>\n${body}</body>\n</html>\n`;
};

/**
 * The document as an EPUB 3 book.
 * @param {Doc} doc
 * @param {string|object} [style]  an export style or its id
 * @param {{title?: string, author?: string, lang?: string, identifier?: string, date?: Date, tocLevels?: number|number[],
 *          cover?: {bytes: Uint8Array, type: string},
 *          images?: Record<string, {bytes: Uint8Array, type: string}>}} [opts]
 *   images: pictures by their path in the text; one not given shows its caption.
 *   identifier: the book's; by default one made from its title and author.
 * @returns {Uint8Array}
 */
export function toEpub(doc, style, opts = {}) {
  const s = resolveStyle(style);
  const title = opts.title || doc.title;
  const lang = opts.lang || doc.lang;
  const date = opts.date || new Date();
  const modified = date.toISOString().replace(/\.\d{3}Z$/u, 'Z');
  const identifier = opts.identifier || `urn:uuid:${uuidFrom(`${title}\n${opts.author || ''}`)}`;
  const chapters = chaptersOf(doc);

  // where each heading ended up, for links to it from a (toc) or the contents
  const where = new Map();
  for (const ch of chapters) for (const b of ch.blocks) if (b.type === 'heading') where.set(b.id, ch.file);

  const media = [];                 // {id, href, type, bytes, properties}
  const bySrc = new Map();
  const images = opts.images || {};
  const img = (src) => {
    const im = images[src];
    const ext = im && im.bytes && MEDIA[(im.type || '').toLowerCase()];
    if (!ext) return null;
    if (!bySrc.has(src)) {
      const n = media.length + 1;
      const href = `images/img${String(n).padStart(3, '0')}.${ext}`;
      media.push({ id: `img${n}`, href, type: im.type.toLowerCase() === 'image/jpg' ? 'image/jpeg' : im.type.toLowerCase(), bytes: im.bytes });
      bySrc.set(src, href);
    }
    return bySrc.get(src);
  };

  const files = [];
  const spine = [];
  const manifest = [];

  const hasCover = !!(opts.cover && opts.cover.bytes && MEDIA[(opts.cover.type || '').toLowerCase()]);
  if (hasCover) {
    const type = opts.cover.type.toLowerCase() === 'image/jpg' ? 'image/jpeg' : opts.cover.type.toLowerCase();
    const href = `images/cover.${MEDIA[type]}`;
    manifest.push(`<item id="cover-image" href="${href}" media-type="${type}" properties="cover-image"/>`);
    files.push({ name: `OEBPS/${href}`, data: opts.cover.bytes });
    const body = `<section class="cover" epub:type="cover"><img src="${href}" alt="${esc(title)}"/></section>\n`;
    files.push({ name: 'OEBPS/cover.xhtml', data: page(lang, title, body, ' class="cover-page"') });
    manifest.push('<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>');
    spine.push('<itemref idref="cover"/>');
  }

  chapters.forEach((ch, i) => {
    const ctx = {
      doc, xhtml: true, epub: true,
      href: (id) => `${where.get(id) === ch.file ? '' : where.get(id) || ''}#${id}`,
      img, pageBreaks: false, started: false,
    };
    let body = renderBlocks(ch.blocks, ctx);
    const notes = footnotesIn(ch.blocks, doc);
    if (notes.length) {
      body += '<section class="footnotes">\n' + notes.map((n) => {
        const fn = doc.footnotes[n - 1];
        const dir = isRtl(plainText(fn.children)) ? 'rtl' : 'auto';
        return `<aside epub:type="footnote" role="doc-footnote" id="fn-${n}" class="footnote" dir="${dir}"><p>${renderFootnoteBody(fn, ctx)}</p></aside>`;
      }).join('\n') + '\n</section>\n';
    }
    files.push({ name: `OEBPS/${ch.file}`, data: page(lang, ch.title, body, ` class="moshe-doc style-${esc(s.id)}"`) });
    manifest.push(`<item id="ch${i + 1}" href="${ch.file}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="ch${i + 1}"/>`);
  });

  // the contents: every heading down to the (toc) depth, and a chapter without a heading by its title
  const [, deepest] = tocRange(opts.tocLevels);
  const entries = [];
  for (const ch of chapters) {
    if (!ch.heading) entries.push({ level: doc.topLevel, text: ch.title, href: ch.file });
    for (const b of ch.blocks) {
      if (b.type === 'heading' && b.level <= deepest) entries.push({ level: b.level, text: b.text, href: `${ch.file}#${b.id}` });
    }
  }
  const tree = tocTree(entries);
  const navList = (nodes) => `<ol>${nodes.map((t) => `<li><a href="${esc(t.entry.href)}">${esc(t.entry.text)}</a>${t.children.length ? navList(t.children) : ''}</li>`).join('')}</ol>`;
  const nav = `<nav epub:type="toc" id="toc" role="doc-toc">\n<h1>${esc(RTL_LANG.test(lang) ? 'תוכן העניינים' : 'Contents')}</h1>\n${navList(tree)}\n</nav>\n`
    + `<nav epub:type="landmarks" id="landmarks" hidden="hidden">\n<ol><li><a epub:type="bodymatter" href="${chapters[0].file}">${esc(title)}</a></li></ol>\n</nav>\n`;

  let order = 0;
  let depth = 0;
  const navPoints = (nodes, d) => {
    depth = Math.max(depth, d);
    return nodes.map((t) => {
      const n = ++order;
      return `<navPoint id="np${n}" playOrder="${n}"><navLabel><text>${esc(t.entry.text)}</text></navLabel><content src="${esc(t.entry.href)}"/>${navPoints(t.children, d + 1)}</navPoint>`;
    }).join('');
  };
  const points = navPoints(tree, 1);
  const ncx = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n'
    + `<head><meta name="dtb:uid" content="${esc(identifier)}"/><meta name="dtb:depth" content="${depth}"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>\n`
    + `<docTitle><text>${esc(title)}</text></docTitle>\n${opts.author ? `<docAuthor><text>${esc(opts.author)}</text></docAuthor>\n` : ''}`
    + `<navMap>${points}</navMap>\n</ncx>\n`;

  for (const m of media) manifest.push(`<item id="${m.id}" href="${m.href}" media-type="${m.type}"/>`);
  const opf = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${esc(lang)}"${RTL_LANG.test(lang) ? ' dir="rtl"' : ''}>\n`
    + '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n'
    + `<dc:identifier id="book-id">${esc(identifier)}</dc:identifier>\n`
    + `<dc:title>${esc(title)}</dc:title>\n`
    + (opts.author ? `<dc:creator id="author">${esc(opts.author)}</dc:creator>\n` : '')
    + `<dc:language>${esc(lang)}</dc:language>\n`
    + `<meta property="dcterms:modified">${modified}</meta>\n`
    + '<meta name="generator" content="Moshe"/>\n'
    + (hasCover ? '<meta name="cover" content="cover-image"/>\n' : '')
    + '</metadata>\n<manifest>\n'
    + '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n'
    + '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n'
    + '<item id="css" href="style.css" media-type="text/css"/>\n'
    + manifest.join('\n') + '\n</manifest>\n'
    + `<spine toc="ncx"${RTL_LANG.test(lang) ? ' page-progression-direction="rtl"' : ''}>\n${spine.join('\n')}\n</spine>\n</package>\n`;

  const css = styleCss(s, { target: 'epub' })
    + '\nnav#toc ol { list-style: none; padding-left: 1.2em; } nav#toc > ol { padding-left: 0; }'
    + '\n.cover-page { margin: 0; text-align: center; } .cover img { max-width: 100%; max-height: 100vh; }'
    + '\naside.footnote { font-size: 0.88em; margin: 0 0 0.5em; }\n';

  const container = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n'
    + '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>\n</container>\n';

  return createZip([
    { name: 'mimetype', data: 'application/epub+zip' },
    { name: 'META-INF/container.xml', data: container },
    { name: 'OEBPS/content.opf', data: opf },
    { name: 'OEBPS/nav.xhtml', data: page(lang, title, nav) },
    { name: 'OEBPS/toc.ncx', data: ncx },
    { name: 'OEBPS/style.css', data: css },
    ...files,
    ...media.map((m) => ({ name: `OEBPS/${m.href}`, data: m.bytes })),
  ], { date });
}
