// Sheets from outside the app ("Create Sheet", "Append to Sheet"), for Shortcuts on a phone (over HTTP, with a
// device token), and for a bot or a cron job (the CLI). A sheet is a Markdown
// file in a group's folder, named from its first line as the app names one;
// the app takes it in like a file another editor wrote.
import { fileName, isSheet } from '../../engine/src/store.js';
import { sheetTitle, splitSheet } from '../../engine/src/sheet.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const baseName = (p) => p.slice(p.lastIndexOf('/') + 1);
const isGroup = (dir) => isSheet(`${dir}/x.md`);
const fold = (s) => String(s || '').normalize('NFC').trim().toLowerCase();

export class Sheets {
  /** @param {import('./files.js').Files} files */
  constructor(files) { this.files = files; }

  /** A group's folder from what someone typed: "Inbox" or "Notes", a path, or a group's name if only one has it. */
  async group(name) {
    const want = String(name || '').trim().replace(/^\/+|\/+$/gu, '');
    if (!want || fold(want) === 'inbox' || fold(want) === 'notes') return 'Notes';
    const { dirs } = await this.files.list();
    const groups = dirs.filter(isGroup);
    if (groups.includes(want)) return want;
    const named = groups.filter((d) => fold(baseName(d)) === fold(want) || fold(d) === fold(want));
    if (named.length === 1) return named[0];
    if (named.length > 1) throw fail(409, `more than one group is called “${want}”: ${named.join(', ')}`);
    throw fail(404, `no group “${want}”`);
  }

  /** A group's sheets (not those of the groups inside it): [{path, title}]. */
  async list(group) {
    const dir = await this.group(group);
    const { files } = await this.files.list();
    const paths = files.filter((p) => isSheet(p) && p.slice(0, p.lastIndexOf('/')) === dir).sort();
    const texts = await this.files.readMany(paths);
    return paths.map((p, i) => ({ path: p, title: (texts[i] && sheetTitle(splitSheet(texts[i].text).body)) || baseName(p).slice(0, -3) }));
  }

  /** A new sheet in a group, named from its first line. → {path} */
  async create(group, text) {
    const dir = await this.group(group);
    const body = String(text ?? '').replace(/\r\n?/gu, '\n');
    if (!body.trim()) throw fail(400, 'the sheet has no text');
    const { files } = await this.files.list();
    const taken = new Set(files.map(fold));
    const name = fileName(sheetTitle(splitSheet(body).body));
    let path = `${dir}/${name}.md`;
    for (let n = 2; taken.has(fold(path)); n++) path = `${dir}/${name} ${n}.md`;
    await this.files.write(path, body.endsWith('\n') ? body : body + '\n');
    return { path };
  }

  /**
   * Text added to a sheet, at its end (or its start, after any front matter).
   * The sheet: its path, or its title (in a group, if one is given); `create`
   * makes it when there is none. → {path, created}
   */
  async append(sheet, text, { group = null, atStart = false, create = false } = {}) {
    const add = String(text ?? '').replace(/\r\n?/gu, '\n').trim();
    if (!add) throw fail(400, 'there is no text to add');
    const path = await this.find(sheet, group);
    if (!path) {
      if (!create) throw fail(404, `no sheet “${sheet}”`);
      const title = String(sheet).trim();
      return { ...(await this.create(group, `# ${title}\n${add}\n`)), created: true };
    }
    const [cur] = await this.files.readMany([path]);
    const old = cur ? cur.text : '';
    let next;
    if (atStart) {
      const fm = /^---\n[\s\S]*?\n---\n/u.exec(old);
      const head = fm ? fm[0] : '';
      next = `${head}${add}\n\n${old.slice(head.length).replace(/^\n+/u, '')}`;
    } else {
      next = `${old.replace(/\s+$/u, '')}${old.trim() ? '\n\n' : ''}${add}\n`;
    }
    await this.files.write(path, next);
    return { path, created: false };
  }

  /** A sheet by path, file name or title (in a group, if one is given), or null. */
  async find(sheet, group = null) {
    const want = String(sheet || '').trim();
    if (!want) throw fail(400, 'which sheet? give its path or title');
    const { files } = await this.files.list();
    const all = files.filter(isSheet);
    if (all.includes(want)) return want;
    const dir = group ? await this.group(group) : null;
    const pool = dir ? all.filter((p) => p.slice(0, p.lastIndexOf('/')) === dir) : all;
    const byName = pool.filter((p) => fold(baseName(p)) === fold(`${fileName(want)}.md`));
    if (byName.length === 1) return byName[0];
    const texts = await this.files.readMany(pool);
    const byTitle = pool.filter((p, i) => texts[i] && fold(sheetTitle(splitSheet(texts[i].text).body)) === fold(want));
    if (byTitle.length > 1) throw fail(409, `more than one sheet is called “${want}”: ${byTitle.join(', ')}`);
    return byTitle[0] || byName[0] || null;
  }
}
