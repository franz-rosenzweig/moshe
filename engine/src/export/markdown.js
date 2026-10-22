// Markdown and plain text from an export document. The Markdown is the
// standard kind any other app reads (CommonMark with GitHub's tables, strike
// and footnotes): paragraphs apart by a blank line, footnotes as [^1]
// references with their text at the end, and none of Moshe's own markup for
// the writer (comments, CriticMarkup), which the document has already
// settled. Highlights stay ==like this== (Obsidian, Bear, iA Writer and
// most other Markdown editors read it) unless asked otherwise.
import { tocTree } from './doc.js';

/** @typedef {import('./doc.js').Doc} Doc @typedef {import('./doc.js').Inline} Inline @typedef {import('./doc.js').Block} Block */

/** Text with what Markdown would read as markup escaped. */
function escapeText(t) {
  return t
    .replace(/[\\`*[\]<]/gu, '\\$&')
    .replace(/(^|[^\p{L}\p{N}])_|_(?=[^\p{L}\p{N}]|$)/gu, (m) => m.replace('_', '\\_'))
    .replace(/~~/gu, '\\~\\~')
    .replace(/==/gu, '\\==')
    .replace(/%%/gu, '\\%%')
    .replace(/\$(?=[^\s\d])/gu, '\\$')
    .replace(/\{(?=\+\+|--|~~|==|>>)/gu, '\\{')
    .replace(/&(?=#?[\p{L}\p{N}]+;)/gu, '\\&');    // "&amp;" meant as written, not as "&"
}

/** A run of code between enough backticks that none inside closes it. */
function codeSpan(t) {
  const longest = Math.max(0, ...(t.match(/`+/gu) || []).map((r) => r.length));
  const fence = '`'.repeat(longest + 1);
  const pad = t.startsWith('`') || t.endsWith('`') || (t.startsWith(' ') && t.endsWith(' ') && t.trim()) ? ' ' : '';
  return `${fence}${pad}${t}${pad}${fence}`;
}

/** A link target: in angle brackets when it has spaces or parentheses. */
function target(url, title) {
  const u = /[\s()<>]/u.test(url) ? `<${url.replace(/[<>]/gu, (c) => encodeURIComponent(c))}>` : url;
  return title ? `${u} "${title.replace(/"/gu, '\\"')}"` : u;
}

/** GitHub's id for a heading, which is what most renderers link to. */
function githubSlug(text) {
  return text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/gu, '-');
}

/**
 * @typedef {object} MarkdownOptions
 * @property {'=='|'html'|'none'} [highlight='==']  how a highlight is written
 * @property {(src: string) => string} [imageSrc]    an image's path in the Markdown (textbundle's assets/…)
 */

function inline(nodes, opts) {
  let out = '';
  for (const n of nodes) {
    switch (n.type) {
      case 'text': out += escapeText(n.text); break;
      case 'strong': out += `**${inline(n.children, opts)}**`; break;
      case 'em': out += `*${inline(n.children, opts)}*`; break;
      case 'strike': out += `~~${inline(n.children, opts)}~~`; break;
      case 'mark': {
        const t = inline(n.children, opts);
        out += opts.highlight === 'html' ? `<mark>${t}</mark>` : opts.highlight === 'none' ? t : `==${t}==`;
        break;
      }
      case 'code': out += codeSpan(n.text); break;
      case 'math': out += `$${n.text}$`; break;
      case 'link': out += `[${inline(n.children, opts)}](${target(n.url, n.title)})`; break;
      case 'image': out += `![${escapeText(n.alt)}](${target(opts.imageSrc ? opts.imageSrc(n.src) : n.src, n.title)})`; break;
      case 'footnote': out += `[^${n.n}]`; break;
      case 'comment': break;
      // a revision document's marks, as near as plain Markdown comes
      case 'delete': out += `~~${inline(n.children, opts)}~~`; break;
      case 'insert': out += inline(n.children, opts); break;
      case 'annotation':
        out += inline(n.children, opts);
        if (n.display === 'inline') out += ` \\[${inline(n.note, opts)}\\]`;
        break;
      default: if (n.children) out += inline(n.children, opts);
    }
  }
  return out;
}

/** A paragraph's first characters escaped where they would start a block. */
function guardStart(s) {
  if (/^(#{1,6}(\s|$)|>|[-+*](\s|$)|\||\(toc\)|={3,}|-{3,}|_{3,}|\*{3,}|~~~|```|\$\$)/iu.test(s)) {
    return /^[-+*|(=_~$]/u.test(s) ? `\\${s}` : s.replace(/^([#>])/u, '\\$1');
  }
  return s.replace(/^(\d+)([.)])(\s|$)/u, '$1\\$2$3');
}

/** A list; `alt` writes its markers the other way (* and 1)), which is how
 *  Markdown tells a list from the one just before it. */
function list(b, opts, indent, alt = false) {
  let n = b.start;
  return b.items.map((it) => {
    const marker = b.ordered ? `${n++}${alt ? ')' : '.'}` : alt ? '*' : '-';
    const task = it.task ? (it.task === 'done' ? '[x] ' : '[ ] ') : '';
    const pad = indent + ' '.repeat(marker.length + 1);
    const text = inline(it.children, opts);
    const nested = it.lists.map((l) => `\n${list(l, opts, pad)}`).join('');
    return `${indent}${marker} ${task}${text}${nested}`;
  }).join('\n');
}

function table(b, opts) {
  const cell = (c) => inline(c, opts).replace(/\|/gu, '\\|') || ' ';
  const rows = b.rows.slice();
  // Markdown's tables must have a header row: a table without one leads with its first row
  const head = b.head || rows.shift() || b.align.map(() => []);
  const rule = b.align.map((a) => (a === 'center' ? ':---:' : a === 'right' ? '---:' : a === 'left' ? ':---' : '---'));
  const line = (cells) => `| ${cells.join(' | ')} |`;
  return [line(head.map(cell)), line(rule), ...rows.map((r) => line(r.map(cell)))].join('\n');
}

function tocMd(tree, indent = '', alt = false) {
  return tree.map((t) => `${indent}${alt ? '*' : '-'} [${escapeText(t.entry.text)}](#${githubSlug(t.entry.text)})${t.children.length ? `\n${tocMd(t.children, `${indent}  `)}` : ''}`).join('\n');
}

function blocks(bs, opts) {
  const out = [];
  let prev = null;       // the kind of list written last, if the block before was one
  let alt = false;
  for (const b of bs) {
    const kind = b.type === 'list' ? (b.ordered ? 'ordered' : 'bullet') : b.type === 'toc' && b.entries.length ? 'bullet' : null;
    alt = kind !== null && kind === prev ? !alt : false;
    prev = kind;
    switch (b.type) {
      case 'heading': out.push(`${'#'.repeat(Math.min(6, b.level))} ${inline(b.children, opts)}`); break;
      case 'paragraph': out.push(guardStart(inline(b.children, opts))); break;
      case 'list': out.push(list(b, opts, '', alt)); break;
      case 'quote': out.push(blocks(b.blocks, opts).split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n')); break;
      case 'code': {
        const longest = Math.max(2, ...(b.text.match(/^`+/gmu) || []).map((r) => r.length));
        const fence = '`'.repeat(longest + 1);
        out.push(`${fence}${b.lang}\n${b.text}\n${fence}`);
        break;
      }
      case 'math': out.push(`$$\n${b.text}\n$$`); break;
      case 'divider': out.push('---'); break;
      case 'image': out.push(`![${escapeText(b.alt)}](${target(opts.imageSrc ? opts.imageSrc(b.src) : b.src, b.title)})`); break;
      case 'table': out.push(table(b, opts)); break;
      case 'toc': if (b.entries.length) out.push(tocMd(tocTree(b.entries), '', alt)); break;
      default: break;     // a comment block is the writer's
    }
  }
  return out.join('\n\n');
}

/**
 * The document as Markdown.
 * @param {Doc} doc
 * @param {MarkdownOptions} [opts]
 * @returns {string}
 */
export function toMarkdown(doc, opts = {}) {
  let md = blocks(doc.blocks, opts);
  if (doc.footnotes.length) {
    const notes = doc.footnotes.map((fn) => `[^${fn.n}]: ${inline(fn.children, opts)}`);
    md += `${md ? '\n\n' : ''}${notes.join('\n')}`;
  }
  return md ? `${md}\n` : '';
}

// ---- plain text ----------------------------------------------------------------

function textInline(nodes) {
  let out = '';
  for (const n of nodes) {
    switch (n.type) {
      case 'text': case 'code': case 'math': out += n.text; break;
      case 'image': out += n.alt ? `[${n.alt}]` : ''; break;
      case 'footnote': out += `[${n.n}]`; break;
      case 'comment': case 'delete': break;
      case 'annotation':
        out += textInline(n.children);
        if (n.display === 'inline') out += ` [${textInline(n.note)}]`;
        break;
      case 'link': {
        const t = textInline(n.children);
        out += t === n.url || !/^(https?|mailto):/u.test(n.url) ? t : `${t} <${n.url}>`;
        break;
      }
      default: if (n.children) out += textInline(n.children);
    }
  }
  return out;
}

function textList(b, indent) {
  let n = b.start;
  return b.items.map((it) => {
    const marker = it.task ? (it.task === 'done' ? '☑' : '☐') : b.ordered ? `${n}.` : '•';
    if (b.ordered) n++;
    const nested = it.lists.map((l) => `\n${textList(l, `${indent}   `)}`).join('');
    return `${indent}${marker} ${textInline(it.children)}${nested}`;
  }).join('\n');
}

function textBlocks(bs) {
  const out = [];
  for (const b of bs) {
    switch (b.type) {
      case 'heading': case 'paragraph': out.push(textInline(b.children)); break;
      case 'list': out.push(textList(b, '')); break;
      case 'quote': out.push(textBlocks(b.blocks).split('\n').map((l) => (l ? `    ${l}` : '')).join('\n')); break;
      case 'code': case 'math': out.push(b.text); break;
      case 'divider': out.push('* * *'); break;
      case 'image': out.push(b.alt ? `[${b.alt}]` : `[${b.src}]`); break;
      case 'table': {
        const rows = b.head ? [b.head, ...b.rows] : b.rows;
        out.push(rows.map((r) => r.map((c) => textInline(c)).join('\t')).join('\n'));
        break;
      }
      case 'toc': if (b.entries.length) {
        const lo = Math.min(...b.entries.map((e) => e.level));
        out.push(b.entries.map((e) => `${'  '.repeat(e.level - lo)}${e.text}`).join('\n'));
      } break;
      default: break;
    }
  }
  return out.join('\n\n');
}

/**
 * The document as plain text: what a reader sees, with footnotes as [1]
 * and their text at the end.
 * @param {Doc} doc
 * @returns {string}
 */
export function toText(doc) {
  let t = textBlocks(doc.blocks);
  if (doc.footnotes.length) {
    t += `${t ? '\n\n' : ''}${doc.footnotes.map((fn) => `[${fn.n}] ${textInline(fn.children)}`).join('\n')}`;
  }
  return t ? `${t}\n` : '';
}

