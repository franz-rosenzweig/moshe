// Bringing files into the library (File › Import): Word, Markdown, plain
// text, TextBundle and HTML, each made a sheet in a group, its images saved
// in _media/ beside it. Dropped on the sheet list or a group, or chosen with
// File › Import.
import { store, theStorage, toast, openSheet, select, app } from './state.svelte.js';
import { targetGroup } from './actions.js';

export const IMPORTABLE = '.docx,.md,.markdown,.txt,.text,.textbundle,.textpack,.html,.htm';
const fileName = (s) => s.replace(/[\\/:*?"<>|#^[\]]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 80) || 'Imported';

/** Files made sheets in a group. → the new sheets' paths */
// the importers, if this build has them (a glob that finds nothing is no error)
const importers = import.meta.glob('../../../engine/src/import/index.js');

/**
 * Rich text on the clipboard (from Word, Google Docs, a web page) as Moshe's
 * markup: bold, italics, links, headings, lists,
 * quotes, footnotes kept. → the text, or null when there is no converter or
 * nothing but plain text in it.
 */
export async function markupFromHtml(html) {
  if (!/<(b|strong|i|em|a\s|h[1-6]|li|blockquote|sup|table|u|s|del|code|pre)\b|font-weight\s*:\s*(bold|[6-9]00)|font-style\s*:\s*italic/iu.test(html)) return null;
  const load = Object.values(importers)[0];
  if (!load) return null;
  try {
    const { htmlToMarkdown } = await load();
    const text = htmlToMarkdown(html).text.replace(/\n+$/u, '');
    return text || null;
  } catch { return null; }
}

export async function importFiles(files, dir = targetGroup()) {
  const load = Object.values(importers)[0];
  if (!load) { toast('Importing isn’t in this version yet.'); return []; }
  const { importFile } = await load();
  const s = theStorage();
  const made = [];
  const warnings = [];
  for (const f of files) {
    try {
      const r = await importFile(f.name, new Uint8Array(await f.arrayBuffer()));
      let text = r.text;
      for (const img of r.images || []) {
        if (!s || !s.writeRaw) { warnings.push(`${f.name}: its images could not be kept here`); break; }
        let name = img.name;
        for (let n = 2; store.exists(`${dir}/_media/${name}`); n++) name = img.name.replace(/(\.[^.]+)?$/u, ` ${n}$1`);
        await s.writeRaw(`${dir}/_media/${name}`, new Blob([img.bytes], { type: img.type }));
        if (name !== img.name) text = text.split(`_media/${encodeURI(img.name)}`).join(`_media/${encodeURI(name)}`).split(`_media/${img.name}`).join(`_media/${name}`);
      }
      if (r.images && r.images.length) store.makeDirs(`${dir}/_media`);
      const p = store.createSheet(dir, { text: text.endsWith('\n') ? text : text + '\n' });
      const base = f.name.replace(/\.[^.]+$/u, '');
      made.push(store.renameSheet(p, fileName(base)));
      warnings.push(...(r.warnings || []).map((w) => `${f.name}: ${w}`));
    } catch (e) {
      warnings.push(`${f.name}: ${e.message}`);
    }
  }
  if (made.length) {
    if (!store.sheetList(app.selection).sections.some((x) => x.path === dir)) select(dir, { keepSheet: true });
    openSheet(made[made.length - 1]);
  }
  toast(made.length ? `Imported ${made.length} file${made.length === 1 ? '' : 's'}${warnings.length ? ` — ${warnings[0]}` : ''}` : `Nothing imported: ${warnings[0] || 'no files'}`, warnings.length ? 7000 : 3000);
  if (warnings.length > 1) console.warn('moshe: import', warnings);
  return made;
}

/** File › Import: the system's file chooser. */
export function chooseAndImport(dir) {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = IMPORTABLE;
  input.onchange = () => { if (input.files && input.files.length) importFiles([...input.files], dir); };
  input.click();
}

/** Is this drag carrying files from outside the app? */
export const draggingFiles = (e) => !!(e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files'));
