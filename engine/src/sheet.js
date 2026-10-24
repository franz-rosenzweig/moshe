// One sheet: its front matter (docs/FORMAT.md, "Front matter") apart from
// the text the editor shows, its title and preview for the sheet list, and
// its statistics for the dashboard and goals.
import * as frontmatter from './frontmatter.js';
import { parseLines, plainLine } from './markup.js';

frontmatter.ORDER.splice(0, frontmatter.ORDER.length, 'keywords', 'material', 'goal', 'notes', 'ink');

/**
 * A sheet file's text as its front matter and its body.
 * @returns {{fm: object|null, values: object, head: string, body: string}}
 *   head is the front matter exactly as written ('' for none)
 */
export function splitSheet(text) {
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) return { fm: null, values: {}, head: '', body: text };
  const lines = text.split('\n');
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i].replace(/\r$/u, '');
    if (l === '---' || l === '...') { end = i; break; }
  }
  if (end < 0) return { fm: null, values: {}, head: '', body: text };
  const parsed = frontmatter.parse(lines.slice(1, end));
  if (!parsed) return { fm: null, values: {}, head: '', body: text };
  const [values, entries] = parsed;
  const fm = new frontmatter.FrontMatter(entries, lines[end], lines[0]);
  const head = lines.slice(0, end + 1).join('\n') + '\n';
  return { fm, values, head, body: text.slice(head.length) };
}

/** The file's text for a head (as splitSheet gave it, or '') and a body. */
export const joinSheet = (head, body) => head + body;

/** A sheet's text with some front matter values changed (undefined or null:
 *  removed), every other line of it kept exactly as it was written. */
export function setMeta(text, patch) {
  const { fm, values, body } = splitSheet(text);
  const next = { ...values };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null || v === false || (Array.isArray(v) && !v.length) || v === '') delete next[k];
    else next[k] = v;
  }
  const head = frontmatter.dump(next, fm);
  // an empty front matter block is no front matter
  return (/^---\r?\n---\r?\n$/u.test(head) ? '' : head) + body;
}

/** What a sheet's front matter says, read into Moshe's terms. */
export function readMeta(values) {
  const list = (v) => (Array.isArray(v) ? v : v === null || v === undefined || v === '' ? [] : [v])
    .filter((x) => x !== null && x !== undefined && String(x).trim()).map(String);
  return {
    keywords: list(values.keywords),
    material: values.material === true,
    goal: typeof values.goal === 'string' ? parseGoal(values.goal) : null,
    notes: list(values.notes),
    // a handwritten sheet's page of ink: its drawing file, beside the sheet (engine/ink.js)
    ink: typeof values.ink === 'string' && values.ink.trim() ? values.ink.trim() : null,
  };
}

// ---- goals --------------------------------------------------------------------------

const METRICS = {
  words: 'words', word: 'words', characters: 'characters', chars: 'characters', character: 'characters',
  'characters-no-spaces': 'characters-no-spaces', 'characters without spaces': 'characters-no-spaces',
  sentences: 'sentences', sentence: 'sentences', paragraphs: 'paragraphs', paragraph: 'paragraphs',
  lines: 'lines', line: 'lines', pages: 'pages', page: 'pages',
  'minutes reading': 'reading-time', 'reading-time': 'reading-time', minutes: 'reading-time', minute: 'reading-time',
};
const TYPE_WORDS = { 'at least': 'at-least', 'at-least': 'at-least', 'at most': 'at-most', 'at-most': 'at-most', about: 'about', daily: 'daily', 'every day': 'daily' };

/** A goal as written in front matter — "at least 800 words", "about 5000 words
 *  by 2026-10-31" — as {type, count, metric, deadline}, or null. */
export function parseGoal(s) {
  const m = /^\s*(at least|at-least|at most|at-most|about|daily|every day)?\s*([\d.,]+)\s*([a-z -]+?)\s*(?:by\s+(\d{4}-\d{2}-\d{2}))?\s*$/iu.exec(String(s));
  if (!m) return null;
  const metric = METRICS[m[3].trim().toLowerCase()];
  if (!metric) return null;
  return { type: TYPE_WORDS[(m[1] || 'about').toLowerCase()], count: Number(m[2].replace(/,/gu, '')), metric, deadline: m[4] || null };
}

const METRIC_WORDS = { words: 'words', characters: 'characters', 'characters-no-spaces': 'characters without spaces',
  sentences: 'sentences', paragraphs: 'paragraphs', lines: 'lines', pages: 'pages', 'reading-time': 'minutes reading' };

/** The front matter line for a goal. */
export function formatGoal(g) {
  if (!g) return null;
  const type = { 'at-least': 'at least', 'at-most': 'at most', about: 'about', daily: 'daily' }[g.type] || 'about';
  return `${type} ${g.count} ${METRIC_WORDS[g.metric] || 'words'}${g.deadline ? ` by ${g.deadline}` : ''}`;
}

// ---- title and preview -----------------------------------------------------------

/** The plain text of a line for the sheet list: tags gone, and what only the
 *  writer sees (comments, notes) too. */
function listLine(body, L) {
  if (L.type === 'code') return body.slice(L.from, L.to);
  return plainLine(body, L, { footnotes: false, images: true }).replace(/\s+/gu, ' ').trim();
}

/**
 * What the sheet list shows: the first lines, each with whether it is a
 * heading (shown bold), up to `max` characters in all.
 * @returns {{title: string, preview: {text: string, heading: boolean}[]}}
 */
export function sheetPreview(body, max = 240) {
  // the opening is all a preview shows: a long sheet is not read to its end
  const head = body.length > 6000 ? body.slice(0, body.indexOf('\n', 6000) < 0 ? body.length : body.indexOf('\n', 6000)) : body;
  const lines = parseLines(head);
  const out = [];
  let used = 0;
  for (const L of lines) {
    if (used >= max || out.length >= 6) break;
    const t = listLine(body, L);
    if (!t) continue;
    out.push({ text: t.length > max - used ? t.slice(0, max - used) : t, heading: L.type === 'heading' });
    used += t.length;
  }
  return { title: out.length ? out[0].text : '', preview: out };
}

/** The title alone: a sheet's first line of text. */
export function sheetTitle(body) {
  for (const L of parseLines(body)) {
    const t = listLine(body, L);
    if (t) return t;
  }
  return '';
}

// ---- statistics ----------------------------------------------------------------------

export const WORDS_PER_PAGE = 200;
const READING = { slow: 180, average: 240, fast: 300, aloud: 120 };   // words a minute

/** What a reader counts in a text: comments, deletions and notes are the
 *  writer's, not the reader's, and are left out. */
export function countable(body) {
  const lines = parseLines(body);
  return lines.map((L) => (L.type === 'code' ? body.slice(L.from, L.to) : plainLine(body, L, { footnotes: true }))).filter((t) => t.trim());
}

/** A sheet's text with the tags gone, comments and notes kept: what a search reads. */
export function plainText(body) {
  return parseLines(body).map((L) => (L.type === 'code' ? body.slice(L.from, L.to) : plainLine(body, L, { writer: true, footnotes: true, images: true }))).join('\n');
}

const WORD = /[\p{L}\p{N}][\p{L}\p{N}\p{M}'’\-_.]*/gu;

/**
 * @param {string} body
 * @returns {{characters: number, charactersNoSpaces: number, words: number, sentences: number,
 *            paragraphs: number, lines: number, pages: number, reading: {slow: number, average: number, fast: number, aloud: number}}}
 *   reading times in seconds
 */
export function stats(body) {
  const paras = countable(body);
  let characters = 0, noSpaces = 0, words = 0, sentences = 0;
  for (const p of paras) {
    const t = p.trim();
    characters += [...t].length;
    noSpaces += [...t.replace(/\s+/gu, '')].length;
    const w = t.match(WORD);
    words += w ? w.length : 0;
    const ends = t.match(/[.!?…]+(?=[\s"'”’)\]]|$)/gu);
    sentences += ends ? ends.length : 0;
    if (w && !/[.!?…]["'”’)\]]*$/u.test(t)) sentences++;
  }
  const reading = Object.fromEntries(Object.entries(READING).map(([k, wpm]) => [k, Math.round((words / wpm) * 60)]));
  return {
    characters, charactersNoSpaces: noSpaces, words, sentences, paragraphs: paras.length, lines: paras.length,
    pages: Math.round((words / WORDS_PER_PAGE) * 10) / 10, reading,
  };
}

/** The value of one metric from stats(). */
export function metricOf(st, metric) {
  switch (metric) {
    case 'characters': return st.characters;
    case 'characters-no-spaces': return st.charactersNoSpaces;
    case 'sentences': return st.sentences;
    case 'paragraphs': return st.paragraphs;
    case 'lines': return st.lines;
    case 'pages': return st.pages;
    case 'reading-time': return Math.round(st.reading.average / 60);
    default: return st.words;
  }
}

/** Two stats added, for a group's or a project's. */
export function addStats(a, b) {
  const out = { ...a };
  for (const k of ['characters', 'charactersNoSpaces', 'words', 'sentences', 'paragraphs', 'lines']) out[k] = (a[k] || 0) + (b[k] || 0);
  out.pages = Math.round((out.words / WORDS_PER_PAGE) * 10) / 10;
  out.reading = Object.fromEntries(Object.entries(READING).map(([k, wpm]) => [k, Math.round((out.words / wpm) * 60)]));
  return out;
}

export const emptyStats = () => stats('');

// ---- outline -------------------------------------------------------------------------

/**
 * What the dashboard's outline lists: headings, and the links, footnotes,
 * annotations, comments and marks in the text, each with where it is.
 */
export function outline(body) {
  const lines = parseLines(body);
  const out = [];
  const walk = (nodes) => {
    for (const n of nodes) {
      const t = (a, b) => body.slice(a, b);
      if (n.type === 'link') out.push({ kind: 'link', at: n.from, text: t(n.inner[0], n.inner[1]), url: n.data.url });
      else if (n.type === 'url') out.push({ kind: 'link', at: n.from, text: n.data.url, url: n.data.url });
      else if (n.type === 'wikilink') out.push({ kind: 'link', at: n.from, text: t(n.data.label[0], n.data.label[1]), target: n.data.target });
      else if (n.type === 'footnote') out.push({ kind: 'footnote', at: n.from, text: t(n.inner[0], n.inner[1]) });
      else if (n.type === 'annotation') out.push({ kind: 'annotation', at: n.from, text: t(n.inner[0], n.inner[1]), note: t(n.data.note[0], n.data.note[1]) });
      else if (n.type === 'comment' || n.type === 'note') out.push({ kind: 'comment', at: n.from, text: t(n.inner[0], n.inner[1]) });
      else if (n.type === 'mark' || n.type === 'cmark') out.push({ kind: 'mark', at: n.from, text: t(n.inner[0], n.inner[1]) });
      else if (n.type === 'delete') out.push({ kind: 'delete', at: n.from, text: t(n.inner[0], n.inner[1]) });
      else if (n.type === 'insert') out.push({ kind: 'insert', at: n.from, text: t(n.inner[0], n.inner[1]) });
      else if (n.type === 'image') out.push({ kind: 'image', at: n.from, text: t(n.inner[0], n.inner[1]), url: n.data.url });
      if (n.children && n.children.length) walk(n.children);
    }
  };
  for (const L of lines) {
    if (L.type === 'heading') out.push({ kind: 'heading', level: L.level, at: L.from, text: plainLine(body, L) });
    if (L.type === 'comment' && L.open) out.push({ kind: 'comment', at: L.from, text: body.slice(L.content[0], L.content[1]).trim() });
    walk(L.inline);
    if (L.after) walk(L.after);
  }
  return out;
}
