// Grammar and spelling as you type, in English, by Harper (harper.js: a
// checker compiled to WebAssembly, run in a worker): no server, works offline,
// the same on the web, the Mac and Android. What it finds is underlined, a
// colour to a kind (spelling, grammar, style, punctuation); a click on it
// shows why and what to write instead (Editor.svelte's popover).
//
// Only what is on screen (and a little around) is read, a paragraph at a
// time; a paragraph read once is not read again until it changes. The sheet's
// markup is taken off first (@engine/proof.js), and English lines are left
// to Harper alone: the browser's own spelling check stays on the others
// (Hebrew).
import { StateField, StateEffect, Facet } from '@codemirror/state';
import { EditorView, Decoration, ViewPlugin } from '@codemirror/view';
import { proseOf, placeFinding } from '@engine/proof.js';

export const KINDS = {
  Spelling: 'sp', Typo: 'sp',
  Agreement: 'gr', Grammar: 'gr', Usage: 'gr', WordChoice: 'gr', Malapropism: 'gr', Eggcorn: 'gr', BoundaryError: 'gr', WordOrder: 'gr',
  Miscellaneous: 'gr', Nonstandard: 'gr', Regionalism: 'gr',
  Style: 'st', Readability: 'st', Redundancy: 'st', Repetition: 'st', Enhancement: 'st',
  Punctuation: 'pu', Capitalization: 'pu', Formatting: 'pu',
};
export const KIND_NAMES = { sp: 'Spelling', gr: 'Grammar', st: 'Style', pu: 'Punctuation' };

/** What a finding is called, for "Ignore": the same thing about the same words. */
export const findingKey = (f) => `${f.kind}|${f.problem}|${f.message}`;

// ---- the checker, one for the page
const cache = new Map();           // a paragraph's text → its findings (in its own offsets)
const KNOWN = ['Moshe'];           // words every library knows: the app's own name
let settings = { dialect: 0, words: [...KNOWN] };
let linterP = null;
const views = new Set();

function linter() {
  if (!linterP) {
    linterP = (async () => {
      const [{ WorkerLinter, LocalLinter }, { binary }] = await Promise.all([import('harper.js'), import('harper.js/binary')]);
      let l;
      try {
        l = new WorkerLinter({ binary, dialect: settings.dialect });
        await l.setup();
      } catch {
        // no worker here (a shell's own address scheme, say): the page's own thread, a paragraph at a time
        l = new LocalLinter({ binary, dialect: settings.dialect });
        await l.setup();
      }
      if (settings.words.length) await l.importWords(settings.words);
      return l;
    })();
    linterP.catch(() => { linterP = null; });
  }
  return linterP;
}

/** The dialect (Harper's Dialect: 0 American, 1 British, 2 Australian, 3 Canadian, 4 Indian) and the library's own words. */
export async function configureProof({ dialect = 0, words = [] } = {}) {
  const w = [...new Set([...KNOWN, ...words])].sort();
  if (dialect === settings.dialect && w.join('\n') === settings.words.join('\n')) return;
  const added = w.filter((x) => !settings.words.includes(x));
  const dialectChanged = dialect !== settings.dialect;
  const removed = settings.words.some((x) => !w.includes(x));
  settings = { dialect, words: w };
  if (linterP) {
    if (removed) { const old = linterP; linterP = null; old.then((l) => l.dispose && l.dispose()).catch(() => {}); }
    else {
      const l = await linterP;
      if (dialectChanged) await l.setDialect(dialect);
      if (added.length) await l.importWords(added);
    }
  }
  cache.clear();
  for (const v of views) v.plugin(proofPlugin)?.soon(50);
}

/** Findings for paragraphs' texts, read in one go for those not read before. */
async function findingsFor(texts) {
  const todo = [...new Set(texts.filter((t) => !cache.has(t)))];
  if (todo.length) {
    const l = await linter();
    const joined = todo.join('\n\n');
    const lints = await l.lint(joined, { language: 'plaintext', isolateEnglish: false });
    const starts = [];
    let at = 0;
    for (const t of todo) { starts.push(at); at += t.length + 2; }
    const per = todo.map(() => []);
    for (const x of lints) {
      const s = x.span();
      let k = starts.length - 1;
      while (k > 0 && starts[k] > s.start) k--;
      const a = s.start - starts[k], b = s.end - starts[k];
      if (b > todo[k].length) continue;          // across two paragraphs: not one of theirs
      per[k].push({
        start: a, end: b, kind: x.lint_kind(), message: x.message(), problem: todo[k].slice(a, b),
        suggestions: x.suggestions().slice(0, 6).map((g) => ({ kind: Number(g.kind()), text: g.get_replacement_text() })),
      });
    }
    todo.forEach((t, k) => cache.set(t, per[k]));
    if (cache.size > 4000) for (const key of [...cache.keys()].slice(0, 1000)) cache.delete(key);
  }
  return texts.map((t) => cache.get(t) || []);
}

// ---- in an editor
/** A sheet's findings the writer chose to ignore (keys, see findingKey). */
export const proofIgnored = Facet.define({ combine: (v) => new Set(v.flat()) });

const setFindings = StateEffect.define();
const noSpell = Decoration.line({ attributes: { spellcheck: 'false' } });

export const proofField = StateField.define({
  create: () => ({ deco: Decoration.none, list: [] }),
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setFindings)) return e.value;
    if (!tr.docChanged) return v;
    const list = v.list.map((f) => ({ ...f, from: tr.changes.mapPos(f.from, 1), to: tr.changes.mapPos(f.to, -1) }));
    return { deco: v.deco.map(tr.changes), list };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

// Check Text's findings (lib/check.svelte.js), kept in place as the text changes
export const setChecked = StateEffect.define();
export const checkField = StateField.define({
  create: () => ({ deco: Decoration.none, list: [] }),
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setChecked)) return e.value;
    if (!tr.docChanged || !v.list.length) return v;
    const list = v.list.map((f) => ({ ...f, from: tr.changes.mapPos(f.from, 1), to: tr.changes.mapPos(f.to, -1) })).filter((f) => f.to > f.from);
    return { deco: v.deco.map(tr.changes), list };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

/** A finding still wanted: not ignored in its sheet, not a word of the dictionary. */
export const wanted = (f, ignored) => !ignored.has(findingKey(f)) && !(f.cls === 'sp' && settings.words.includes(f.problem));

/** Check Text's findings shown in an editor (those still wanted). */
export function showChecked(view, findings) {
  const ignored = view.state.facet(proofIgnored);
  const list = (findings || []).filter((f) => wanted(f, ignored) && f.to <= view.state.doc.length);
  const marks = list.map((f, i) => Decoration.mark({ class: `cm-proof ${f.cls}`, attributes: { 'data-check': String(i) } }).range(f.from, f.to));
  view.dispatch({ effects: setChecked.of({ deco: Decoration.set(marks, true), list }) });
  view.plugin(proofPlugin)?.soon(0);
}

const proofPlugin = ViewPlugin.fromClass(class {
  constructor(view) {
    this.view = view;
    this.timer = null;
    this.run = 0;
    views.add(view);
    this.soon(300);
  }
  update(u) {
    if (u.docChanged) this.soon(700);
    else if (u.viewportChanged) this.soon(150);
    else if (u.startState.facet(proofIgnored) !== u.state.facet(proofIgnored)) this.soon(0);
  }
  soon(ms) { clearTimeout(this.timer); this.timer = setTimeout(() => this.check(), ms); }
  async check() {
    const view = this.view, run = ++this.run;
    const doc = view.state.doc;
    const vr = view.visibleRanges;
    if (!vr.length) return;
    const body = doc.toString();
    const range = { from: Math.max(0, vr[0].from - 3000), to: Math.min(body.length, vr[vr.length - 1].to + 3000) };
    const prose = proseOf(body, range, { english: true });
    let found;
    try { found = await findingsFor(prose.map((p) => p.text)); } catch { return; }
    if (run !== this.run || view.state.doc !== doc) return;       // typed meanwhile: the next run shows it
    const ignored = view.state.facet(proofIgnored);
    const checked = (view.state.field(checkField, false) || { list: [] }).list;
    const list = [];
    const marks = [];
    const lines = new Set();
    prose.forEach((p, k) => {
      for (let n = doc.lineAt(p.from).number, last = doc.lineAt(Math.min(p.to, doc.length)).number; n <= last; n++) lines.add(doc.line(n).from);
      for (const f of found[k]) {
        if (ignored.has(findingKey(f))) continue;
        if (f.kind === 'Capitalization' && f.start === 0 && (p.kind === 'list' || p.kind === 'footnote' || p.kind === 'note')) continue;   // a list item may start small
        const at = placeFinding(p, f.start, f.end);
        if (!at || at.to <= at.from) continue;
        if (checked.some((c) => c.from < at.to && c.to > at.from)) continue;     // Check Text has its own word on it
        const cls = KINDS[f.kind] || 'gr';
        list.push({ ...f, from: at.from, to: at.to, cls });
      }
    });
    list.sort((a, b) => a.from - b.from || a.to - b.to);
    list.forEach((f, i) => marks.push(Decoration.mark({ class: `cm-proof ${f.cls}`, attributes: { 'data-proof': String(i) } }).range(f.from, f.to)));
    for (const at of lines) marks.push(noSpell.range(at));
    view.dispatch({ effects: setFindings.of({ deco: Decoration.set(marks, true), list }) });
  }
  destroy() { clearTimeout(this.timer); views.delete(this.view); }
});

/** The finding at a place in the text (its decoration's index), or null. */
export function findingAt(view, el) {
  const checked = el.dataset.check !== undefined;
  const i = Number(checked ? el.dataset.check : el.dataset.proof);
  const { list } = view.state.field(checked ? checkField : proofField, false) || { list: [] };
  return list[i] || null;
}

/** A Check Text finding where it is now (the text may have changed since). */
export function checkedById(view, id) {
  const { list } = view.state.field(checkField, false) || { list: [] };
  return list.find((f) => f.id === id) || null;
}

/** A suggestion made so: Harper's kinds are replace (0), remove (1), insert after (2). */
export function applySuggestion(view, f, s) {
  const change = s.kind === 2 ? { from: f.to, to: f.to, insert: s.text } : { from: f.from, to: f.to, insert: s.kind === 1 ? '' : s.text };
  view.dispatch({ changes: change, selection: { anchor: change.from + change.insert.length }, userEvent: 'input.proof' });
  view.focus();
}

/** Drop a Check Text finding from an editor (fixed or ignored). */
export function unshowChecked(view, id) {
  const v = view.state.field(checkField, false);
  if (!v || !v.list.some((f) => f.id === id)) return;
  const list = v.list.filter((f) => f.id !== id);
  const marks = list.map((f, i) => Decoration.mark({ class: `cm-proof ${f.cls}`, attributes: { 'data-check': String(i) } }).range(f.from, f.to));
  view.dispatch({ effects: setChecked.of({ deco: Decoration.set(marks, true), list }) });
}

/** As you type (Harper); checkField is in every editor, for Check Text. */
export const proof = [proofField, proofPlugin];
