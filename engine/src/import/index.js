// Import: a file from elsewhere made the text of a sheet (File ›
// Import). This is the one call the app makes; what comes back is the
// sheet's text, the pictures it refers to as _media/<name> (for the caller to
// save beside it), a title, and anything worth telling the writer. Nothing
// here touches the disk, so it runs the same in the page and in Node.
//
//   .docx                      Word, with its tracked changes and comments (./docx.js)
//   .md .markdown              Markdown, reference footnotes made inline ^[…]
//   .txt .text                 plain text, taken as it is
//   .textbundle .textpack      a TextBundle, zipped: its text.md, its assets/ made _media/
//   .html .htm                 a web page (./html.js)
import { docxToMarkdown } from './docx.js';
import { htmlToMarkdown } from './html.js';
import { unzip } from './unzip.js';
import { splitSheet, sheetTitle } from '../sheet.js';

export { docxToMarkdown, htmlToMarkdown, unzip };

/**
 * @typedef {object} ImportResult
 * @property {string} title       the document's title: its first heading, or what the file says, or its name
 * @property {string} text        the sheet's text, in Moshe's markup, ending in a newline
 * @property {{name: string, bytes: Uint8Array, type: string}[]} images  the pictures the text refers to as _media/<name>
 * @property {string[]} warnings  what did not come across, in plain words
 */

/** Text bytes as a string: UTF-8 (or UTF-16 with its mark), else the Windows code page it most likely is. */
export function decodeText(bytes) {
  if (bytes[0] === 0xFF && bytes[1] === 0xFE) return { text: new TextDecoder('utf-16le').decode(bytes) };
  if (bytes[0] === 0xFE && bytes[1] === 0xFF) return { text: new TextDecoder('utf-16be').decode(bytes) };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    // Hebrew letters are 0xE0–0xFA in windows-1255; Western text has its accents all over the upper half
    let high = 0, hebrew = 0;
    for (const b of bytes) if (b >= 0x80) { high++; if (b >= 0xE0 && b <= 0xFA) hebrew++; }
    const label = hebrew > high * 0.6 ? 'windows-1255' : 'windows-1252';
    try {
      return { text: new TextDecoder(label).decode(bytes), warning: `it is not UTF-8, so it was read as ${label === 'windows-1255' ? 'Hebrew' : 'Western'} Windows text` };
    } catch {
      return { text: new TextDecoder().decode(bytes), warning: 'it is not UTF-8, and some characters may be wrong' };
    }
  }
}

const normaliseLines = (t) => t.replace(/\r\n?/gu, '\n');

/**
 * Markdown's reference footnotes ([^1] … [^1]: text) made Moshe's inline ones (^[text]).
 * Left alone if the text has none.
 */
export function inlineFootnotes(md) {
  const lines = md.split('\n');
  const defs = new Map();
  const kept = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const f = /^[ \t]{0,3}(`{3,}|~{3,})/u.exec(line);
    if (f) {
      if (!fence) fence = f[1];
      else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
    }
    const m = !fence && !f && /^\[\^([^\]\s]+)\]:[ \t]*(.*)$/u.exec(line);
    if (m) {
      let text = m[2];
      // its text goes on over indented lines
      while (i + 1 < lines.length && /^(?: {2,}|\t)\S/u.test(lines[i + 1])) text += ` ${lines[++i].trim()}`;
      defs.set(m[1], text.trim());
      continue;
    }
    kept.push(line);
  }
  if (!defs.size) return md;
  fence = null;
  const out = kept.map((line) => {
    const f = /^[ \t]{0,3}(`{3,}|~{3,})/u.exec(line);
    if (f) {
      if (!fence) fence = f[1];
      else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      return line;
    }
    if (fence) return line;
    // not inside `code`
    return line.split(/(`+[^`]*`+)/u).map((part, k) => (k % 2 ? part : part.replace(/\[\^([^\]\s]+)\]/gu, (all, id) => (defs.has(id) ? `^[${defs.get(id)}]` : all)))).join('');
  });
  return out.join('\n').replace(/\n{3,}$/u, '\n\n').replace(/\n+$/u, '\n');
}

/** A text's title as Moshe reads one: its first heading's or first line's text. */
const titleOf = (text) => sheetTitle(splitSheet(text).body || text).trim();

const baseName = (name) => String(name).split(/[\\/]/u).pop().replace(/\.[^.]+$/u, '');

/** A TextBundle or TextPack (a zipped bundle): its text, its assets made _media/. */
async function readBundle(bytes) {
  const files = await unzip(bytes);
  const names = [...files.keys()];
  const textName = names.filter((n) => /(^|\/)text\.(md|markdown|txt|text)$/iu.test(n) && !/(^|\/)__MACOSX\//u.test(n))
    .sort((a, b) => a.split('/').length - b.split('/').length)[0];
  if (!textName) throw new Error('This bundle has no text.md in it');
  const root = textName.slice(0, textName.lastIndexOf('/') + 1);
  const { text: raw, warning } = decodeText(files.get(textName));
  let text = normaliseLines(raw);
  const images = [];
  const used = new Set();
  for (const n of names) {
    if (!n.startsWith(`${root}assets/`) || n.endsWith('/')) continue;
    const rel = n.slice(root.length + 'assets/'.length);
    const ext = (/\.([^.]+)$/u.exec(rel) || [])[1]?.toLowerCase() || '';
    const type = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', heic: 'image/heic', tif: 'image/tiff', tiff: 'image/tiff' }[ext];
    if (!type) continue;
    // a picture in a folder inside assets/ keeps the folder in its name, so none is lost
    const name = rel.replace(/\//gu, '-');
    if (used.has(name)) continue;
    used.add(name);
    images.push({ name, bytes: files.get(n), type });
    if (name !== rel) text = text.split(`assets/${rel}`).join(`assets/${name}`).split(`assets/${encodeURI(rel)}`).join(`assets/${encodeURI(name)}`);
  }
  // the text's references to assets/ now point to _media/, written as the editor writes them
  text = text.replace(/\]\(\s*<(?:\.\/)?assets\/([^>\n]*)>/gu, (m, file) => `](_media/${encodeURI(file)}`)
    .replace(/(\]\(\s*)(?:\.\/)?assets\//gu, '$1_media/').replace(/(\bsrc\s*=\s*["'])(?:\.\/)?assets\//gu, '$1_media/');
  text = inlineFootnotes(text);
  return { text, images, warnings: warning ? [warning] : [] };
}

/**
 * A file made a sheet's text.
 * @param {string} name   the file's name: its extension says what it is
 * @param {Uint8Array|ArrayBuffer} input  its bytes
 * @returns {Promise<ImportResult>}
 * @throws {Error} for a kind of file that cannot be imported, or a damaged one, with a plain message
 */
export async function importFile(name, input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const ext = ((/\.([^./\\]+)$/u.exec(String(name)) || [])[1] || '').toLowerCase();
  let r;
  switch (ext) {
    case 'docx': case 'docm': case 'dotx':
      r = await docxToMarkdown(bytes);
      break;
    case 'md': case 'markdown': case 'mdown': case 'mkd': case 'mdtext': {
      const { text, warning } = decodeText(bytes);
      const t = inlineFootnotes(normaliseLines(text));
      r = { title: titleOf(t), text: t, images: [], warnings: warning ? [warning] : [] };
      break;
    }
    case 'txt': case 'text': {
      const { text, warning } = decodeText(bytes);
      const t = normaliseLines(text);
      r = { title: titleOf(t), text: t, images: [], warnings: warning ? [warning] : [] };
      break;
    }
    case 'textbundle': case 'textpack': {
      const b = await readBundle(bytes);
      r = { title: titleOf(b.text), ...b };
      break;
    }
    case 'html': case 'htm': case 'xhtml': {
      let { text, warning } = decodeText(bytes);
      // a page that names its own character set, when it is not UTF-8
      const cs = /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/iu.exec(text.slice(0, 4096));
      if (warning && cs) {
        try { text = new TextDecoder(cs[1].toLowerCase()).decode(bytes); warning = null; } catch { /* keep the guess */ }
      }
      r = htmlToMarkdown(normaliseLines(text));
      if (warning) r.warnings.push(warning);
      break;
    }
    case 'doc': case 'dot':
      throw new Error('Word 97–2003 documents (.doc) cannot be imported: open it in Word or Pages and save it as .docx');
    case 'rtf': case 'odt': case 'pages':
      throw new Error(`.${ext} files cannot be imported: save it as Word (.docx) first`);
    default:
      throw new Error(`${ext ? `.${ext} files` : 'Files without an extension'} cannot be imported. Moshe imports Word (.docx), Markdown (.md), plain text (.txt), TextBundle (.textbundle, .textpack) and HTML (.html)`);
  }
  if (!r.text.endsWith('\n') && r.text) r.text += '\n';
  return { title: r.title || baseName(name), text: r.text, images: r.images || [], warnings: r.warnings || [] };
}
