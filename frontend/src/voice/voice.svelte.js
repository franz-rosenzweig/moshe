// Voice (docs/VOICE.md): what the writer says, carried out. engine/src/voice.js
// reads an utterance as text or as a command; this does it, in the editor with
// the editor's own transactions (each one step of undo), with the pen's marks
// in Revision Mode, and in the app with the same commands its menus call. The
// microphone side (voice/mic.js, or a native app) only hands over what it heard.
import { undo, redo, isolateHistory } from '@codemirror/commands';
import { EditorSelection } from '@codemirror/state';
import {
  parse, soundsLike, fromSaid, numberOf, cleanDictation, placeDictation, phraseRanges, nearest, proseLines, sentenceRanges, wordAt, headingsOf,
  marksOf, spokenText, snapNames, namesIn, alternatesFor, settleChanges,
} from '@engine/voice.js';
import { strikeChanges, insertChanges, commentChanges, fitToMarkup } from '@engine/pen.js';
import { splitSheet } from '@engine/sheet.js';
import { synonymList } from '@engine/words.js';
import { lookup } from './words.js';
import { app, prefs, store, openSheet, persist } from '../lib/state.svelte.js';
import { setVoice, voiceState } from './marks.js';

export const voice = $state({
  mic: 'off',          // off | loading | listening | hearing | working | error: the microphone side's state
  loadPct: 0,          // while a model downloads
  caption: '',         // what the microphone side has to say: a download, an error
  level: 0,            // how loud, 0–1, for the meter
  asleep: false,       // "go to sleep": nothing but "wake up" counts
  partial: '',         // the recognizer's guess while she's still talking
  last: null,          // the newest of `heard`, on the strip
  heard: [],           // {said, kind: text | command | fail | ignored, msg, why, how}, newest first
  choice: null,        // a numbered list showing: {kind: match | syn | fix | sheet, label, items: [{label, sub?}]}
  reading: false,      // reading aloud
  lang: 'en',          // dictation's language: en | he
  names: [],           // the project's names, given to the recognizer and put right after it
  words: null,         // the Words view: {kind: syn | def | fix, word, entry?, list?, used?}
  count: 0,            // utterances handled so far (what the self-tests wait on)
});

let host = null;        // what the app lends: {view(), command(name, arg), editor(name, arg)}
let picked = null;      // the open list's action, kept out of the state: (index) => result
let readToken = 0;
const listeners = new Set();

/** The app's half: called once, from App.svelte. */
export function connect(h) { host = h; }

// for self-tests (tools/voice-e2e.mjs), as window.__mosheLocal is for the storage: read-only
if (typeof window !== 'undefined') {
  window.__mosheVoice = {
    text: () => { const v = view(); return v ? v.state.doc.toString() : null; },
    selection: () => { const v = view(); return v ? [v.state.selection.main.from, v.state.selection.main.to] : null; },
    state: () => JSON.parse(JSON.stringify({ ...voice, heard: voice.heard.slice(0, 40) })),
  };
}
/** Called when the language changes (the microphone side restarts in it). */
export function onLanguage(fn) { listeners.add(fn); return () => listeners.delete(fn); }

const view = () => (host && host.view && host.view()) || null;
const command = (name, arg) => host && host.command && host.command(name, arg);
const editorRun = (name, arg) => host && host.editor && host.editor(name, arg);
const textOf = (v) => v.state.doc.toString();
const cap = (w) => (w ? w[0].toUpperCase() + w.slice(1) : w);
const matchCase = (old, w) => (/^\p{Lu}/u.test(old) ? cap(w) : w);
/** The words of a group exactly as said (case kept). */
const asSaid = (said, words) => { const at = String(said).toLowerCase().indexOf(String(words).toLowerCase()); return at < 0 ? words : String(said).slice(at, at + words.length); };

// ---- hearing

let chain = Promise.resolve();
/**
 * An utterance, from the microphone side (or typed, to try it): carried out in turn.
 * @param {string} said
 * @param {{source?: 'mic' | 'typed', how?: string}} [meta]  how: the engine and its timing, for the strip
 */
export function hear(said, meta = {}) {
  chain = chain.then(() => run(String(said || ''), meta)).catch((e) => { console.error(e); report(said, 'fail', `That went wrong: ${e.message}`, '', meta); });
  return chain;
}

async function run(said, meta) {
  partial('');
  let how = meta.how || '';
  if (meta.source === 'mic' && prefs.voice.names !== false && voice.names.length) {
    const s = snapNames(said, voice.names);
    if (s.fixed.length) { said = s.text; how = [how, `names put right: ${s.fixed.join(', ')}`].filter(Boolean).join(' · '); }
  }
  meta = { ...meta, how };
  const p = parse(said, { asleep: voice.asleep, choosing: !!voice.choice, reading: voice.reading });
  if (p.kind === 'empty') return;
  if (p.kind === 'ignored') { report(said, 'ignored', 'Asleep · only “wake up” works', '', meta); return; }
  // what's being read aloud comes back in through the microphone: while it reads, only stopping counts
  if (voice.reading && meta.source === 'mic' && !(p.kind === 'command' && ['stop', 'stopReading', 'sleep'].includes(p.id))) {
    report(said, 'ignored', 'Reading aloud · only “stop” works', '', meta);
    return;
  }
  if (p.kind === 'choice') { pick(p.n, said, meta); return; }
  if (p.kind === 'text') {
    const near = !p.why && soundsLike(said);
    dictate(said, { why: p.why || (near ? `Sounds like “${near}”: “scratch that”, then say it again.` : ''), meta });
    return;
  }
  const v = view();
  const fn = DO[p.id] || (p.command.app && (() => { command(p.command.app); return { msg: p.command.say }; }));
  if (!fn) { report(said, 'fail', 'Not done yet', '', meta); return; }
  if (NEEDS_TEXT.has(p.command.group) && !v) { report(said, 'fail', 'Open a sheet first', '', meta); tone('fail'); return; }
  const r = (await fn(p.groups, said, v)) || {};
  if (r.decline) { dictate(said, { why: r.decline, meta }); return; }
  if (r.dictate != null) { dictate(r.dictate, { why: r.why, meta, literal: true, said }); return; }
  report(said, r.fail ? 'fail' : 'command', r.fail || r.msg || p.command.say, r.why, meta);
  tone(r.fail ? 'fail' : 'command');
}

function report(said, kind, msg, why = '', meta = {}) {
  const item = { said: String(said || '').trim(), kind, msg, why: why || '', how: meta.how || '' };
  voice.last = item;
  voice.heard = [item, ...voice.heard].slice(0, 40);
  voice.count++;
}

/** The recognizer's guess so far, shown grey at the cursor. */
export function partial(text) {
  voice.partial = text || '';
  const v = view();
  if (!v || (!text && !voiceState(v).ghost)) return;
  v.dispatch({ effects: setVoice.of({ ghost: text && !voice.asleep ? { pos: v.state.selection.main.head, text: ` ${text}` } : null }) });
}

// ---- dictation

/** Some sheets are written with a blank line between paragraphs, some without: a new one follows suit. */
const paragraphBreak = (doc) => ((doc.match(/\S\n\n(?=\S)/gu) || []).length >= (doc.match(/\S\n(?=\S)/gu) || []).length ? '\n\n' : '\n');

function dictate(text, { why = '', meta = {}, literal = false, said = text } = {}) {
  const v = view();
  if (!v) { report(said, 'fail', 'Open a sheet first', '', meta); tone('fail'); return; }
  const notes = [];
  let words = text;
  if (!literal) {
    const c = cleanDictation(text, { lang: voice.lang });
    words = c.text;
    if (c.fillers) notes.push(`${c.fillers} filler word${c.fillers > 1 ? 's' : ''} left out`);
  }
  if (!words.trim()) { report(said, 'ignored', 'Nothing left to type', '', meta); return; }
  const doc = textOf(v), s = v.state.selection.main;
  const p = placeDictation(doc, s.from, s.to, words, { lang: voice.lang, names: voice.names, stop: !literal });
  if (app.revision) {
    // as the pen writes it: an insertion (over a selection, a change)
    const placed = p.insert.trim();
    const changes = s.empty ? insertChanges(doc, s.from, placed) : [{ from: s.from, to: s.to, insert: `{~~${doc.slice(s.from, s.to)}~>${placed}~~}` }];
    const c = changes[0];
    apply(v, changes, { cursor: c.from + c.insert.length, last: [c.from, c.from + c.insert.length] });
  } else {
    apply(v, { from: p.from, to: p.to, insert: p.insert }, { cursor: p.end, last: [p.start, p.end] });
  }
  report(said, 'text', notes.length ? `Typed · ${notes.join(' · ')}` : 'Typed', why, meta);
  tone('text');
}

/** A change to the text: one step of undo, the cursor (or a selection) after it, "that" set. */
function apply(v, changes, { cursor = null, select = null, last = null } = {}) {
  const cs = v.state.changes(changes);
  const sel = select ? EditorSelection.range(select[0], select[1]) : cursor != null ? EditorSelection.cursor(cursor) : undefined;
  v.dispatch({
    changes: cs, selection: sel ? EditorSelection.create([sel]) : undefined, scrollIntoView: true, userEvent: 'input.voice',
    annotations: isolateHistory.of('full'), effects: setVoice.of({ last, target: null, matches: [], ghost: null }),
  });
}
function select(v, r, msg = 'Selected') {
  v.dispatch({ selection: EditorSelection.single(r[0], r[1]), scrollIntoView: true, effects: setVoice.of({ matches: [], target: null }) });
  return { msg };
}
function moveTo(v, pos, msg) {
  v.dispatch({ selection: EditorSelection.cursor(pos), scrollIntoView: true, effects: setVoice.of({ matches: [], target: null }) });
  return { msg };
}
/** What "that" is: the selection, or else what was just said. */
function thatRange(v) {
  const s = v.state.selection.main;
  if (!s.empty) return [s.from, s.to];
  const l = voiceState(v).last;
  return l && l[1] > l[0] ? l : null;
}

// ---- numbered lists

function choose(v, list, act) {
  voice.choice = list;
  picked = act;
  if (v && list.kind === 'match') v.dispatch({ effects: setVoice.of({ matches: list.ranges }) });
}
function closeChoice(v = view()) {
  voice.choice = null;
  picked = null;
  if (v) v.dispatch({ effects: setVoice.of({ matches: [], target: null }) });
}
function pick(n, said, meta) {
  const list = voice.choice;
  if (!(n >= 1 && n <= list.items.length)) { report(said, 'fail', `No number ${Number.isNaN(n) ? '' : n} · 1 to ${list.items.length}`, '', meta); tone('fail'); return; }
  const act = picked;
  voice.choice = null;
  picked = null;
  const r = (act && act(n - 1)) || {};
  report(said, r.fail ? 'fail' : 'command', r.fail || r.msg || `Number ${n}`, r.why, meta);
  tone(r.fail ? 'fail' : 'command');
}
/** A phrase, found: done at once when it's there once (or the nearest will do), numbered when it's there more. */
function withPhrase(v, phrase, act, nearestWillDo = false) {
  const doc = textOf(v), head = v.state.selection.main.head, found = phraseRanges(doc, phrase);
  if (!found.length) return { fail: `Not found · “${phrase}”` };
  if (found.length === 1 || nearestWillDo) return act(nearest(found, head));
  const ranges = found.length > 9 ? [...found].sort((a, b) => Math.abs(a[0] - head) - Math.abs(b[0] - head)).slice(0, 9).sort((a, b) => a[0] - b[0]) : found;
  choose(v, { kind: 'match', label: `“${phrase}”`, ranges, items: ranges.map((r) => ({ label: around(doc, r) })) }, (i) => { const vv = view(); return vv ? act(ranges[i]) : { fail: 'The sheet closed' }; });
  return { msg: `${found.length} matches · say a number` };
}
const around = (doc, [a, b]) => `${doc.slice(Math.max(0, a - 24), a).replace(/^\S*\s/u, '…')}[${doc.slice(a, b)}]${doc.slice(b, b + 24).replace(/\s\S*$/u, '…')}`.replace(/\n/gu, ' ');

// ---- the sheets of the list, for "open", "go to" and "show sheets"

const listSheets = () => (store ? store.sheetList(app.selection).sections.flatMap((s) => s.sheets) : []);
function findSheet(said) {
  const p = said.toLowerCase().replace(/^(?:the |chapter |sheet )/u, '').trim(), all = listSheets();
  if (!p || !all.length) return null;
  const n = /^\d+$/u.test(p) ? Number(p) : NaN;
  if (n >= 1 && n <= all.length) return all[n - 1];
  const t = (s) => (s.title || s.name || '').toLowerCase();
  return all.find((s) => t(s) === p) || all.find((s) => t(s).replace(/^[^:]*:\s*/u, '') === p)
    || all.find((s) => t(s).replace(/[:]/gu, '').includes(p)) || all.find((s) => p.split(' ').every((w) => t(s).includes(w))) || null;
}

// ---- revision marks and plain edits

function strikeOrDelete(v, r, verb) {
  const doc = textOf(v), line = v.state.doc.lineAt(r[0]), said = doc.slice(r[0], r[1]);
  if (app.revision || verb === 'strike' || verb === 'cross out') {
    const changes = strikeChanges(doc, line.from, line.to, r[0], r[1]);
    if (!changes.length) return { msg: 'Marked already' };
    apply(v, changes, { cursor: changes[changes.length - 1].from + changes[changes.length - 1].insert.length });
    return { msg: changes[0].insert ? `Marked for deletion · “${said}”` : 'The insertion is gone' };
  }
  let [a, b] = fitToMarkup(doc, line.from, line.to, r[0], r[1]);
  if (doc[a - 1] === ' ' && (b >= doc.length || /[ \n.,;:!?…]/u.test(doc[b]))) a--;
  else if (doc[b] === ' ' && (a === 0 || doc[a - 1] === '\n')) b++;
  apply(v, { from: a, to: b, insert: '' }, { cursor: a });
  return { msg: `Deleted · “${said}”` };
}
function replaceRange(v, r, words) {
  const doc = textOf(v), old = doc.slice(r[0], r[1]), neu = matchCase(old, words);
  if (app.revision) {
    const line = v.state.doc.lineAt(r[0]), [a, b] = fitToMarkup(doc, line.from, line.to, r[0], r[1]);
    apply(v, { from: a, to: b, insert: `{~~${doc.slice(a, b)}~>${neu}~~}` }, { cursor: a + doc.slice(a, b).length + neu.length + 8 });
  } else apply(v, { from: r[0], to: r[1], insert: neu }, { cursor: r[0] + neu.length, last: [r[0], r[0] + neu.length] });
  return { msg: `${old} → ${neu}` };
}
/** The word a Words command is about: the one named (nearest the cursor), the selection, or the cursor's. */
function targetWord(v, phrase) {
  const doc = textOf(v), s = v.state.selection.main;
  if (phrase && !/^(that|it|this)$/iu.test(phrase)) { const f = phraseRanges(doc, phrase); return f.length ? nearest(f, s.head) : null; }
  if (!s.empty && !/\s/u.test(doc.slice(s.from, s.to).trim())) return [s.from, s.to];
  return wordAt(doc, s.head);
}

// ---- the dashboard

function showView(id) { app.dashboard = true; app.dashboardView = id; persist(); }

// ---- the commands, by the ids of engine/src/voice.js

const NEEDS_TEXT = new Set(['Writing', 'Choosing', 'Editing', 'Words', 'Reading']);
const units = (v, kind) => (kind === 'sentence' ? sentenceRanges(textOf(v)) : proseLines(textOf(v)));

const DO = {
  sleep() { voice.asleep = true; stopReading(); partial(''); return { msg: 'Asleep' }; },
  wake() { const was = voice.asleep; voice.asleep = false; return { msg: was ? 'Listening' : 'Listening already' }; },
  type: (g, said) => ({ dictate: fromSaid(said, g[0]), why: '“type” in front: typed as words.' }),
  language(g) {
    voice.lang = /hebrew|עברית/iu.test(g.join(' ')) ? 'he' : 'en';
    for (const fn of listeners) fn(voice.lang);
    return { msg: voice.lang === 'he' ? 'Dictating in Hebrew' : 'Dictating in English' };
  },

  newParagraph(g, said, v) {
    const s = v.state.selection.main, brk = paragraphBreak(textOf(v));
    apply(v, { from: s.from, to: s.to, insert: brk }, { cursor: s.from + brk.length });
    return { msg: 'New paragraph' };
  },
  punctuation(g, said, v) {
    const mark = { period: '.', 'full stop': '.', comma: ',', 'question mark': '?', colon: ':', semicolon: ';' }[g[0].toLowerCase()] || '!';
    const doc = textOf(v), s = v.state.selection.main;
    let from = s.from;
    while (from > 0 && doc[from - 1] === ' ') from--;
    apply(v, { from, to: s.to, insert: mark }, { cursor: from + 1 });
    return { msg: `“${mark}”` };
  },
  undo(g, said, v) { closeChoice(v); if (voice.words && voice.words.used) voice.words = { ...voice.words, used: null }; return undo(v) ? { msg: 'Undone' } : { fail: 'Nothing to undo' }; },
  redo(g, said, v) { return redo(v) ? { msg: 'Redone' } : { fail: 'Nothing to redo' }; },

  selectThat(g, said, v) { const r = thatRange(v); return r ? select(v, r) : { fail: 'Nothing said yet to select' }; },
  selectAll(g, said, v) { const L = proseLines(textOf(v)); return L.length ? select(v, [L[0][0], L[L.length - 1][1]], 'Selected all') : { fail: 'The sheet is empty' }; },
  selectUnit(g, said, v) {
    const which = { current: 'this', previous: 'last' }[g[0].toLowerCase()] || g[0].toLowerCase(), kind = g[1].toLowerCase();
    const doc = textOf(v), head = v.state.selection.main.head;
    let r = null;
    if (kind === 'word') r = which === 'next' ? (doc.slice(head).match(/[\p{L}\p{N}]/u) ? wordAt(doc, head + doc.slice(head).search(/[\p{L}\p{N}]/u) + 1) : null) : wordAt(doc, head);
    else {
      const list = units(v, kind), i = list.findIndex((x) => x[0] <= head && head <= x[1]);
      const at = i >= 0 ? i : list.filter((x) => x[1] < head).length - 1;
      r = which === 'this' ? list[at] : which === 'next' ? list[at + 1] : (i >= 0 && head === list[i][1] ? list[i] : list[at - (i >= 0 ? 1 : 0)]);
    }
    return r ? select(v, r, `Selected the ${kind}`) : { fail: `No ${which} ${kind}` };
  },
  selectRange(g, said, v) {
    const doc = textOf(v), a = phraseRanges(doc, g[0]), b = phraseRanges(doc, g[1]);
    if (!a.length || !b.length) return { fail: `Not found · “${!a.length ? g[0] : g[1]}”` };
    const s = nearest(a, v.state.selection.main.head), e = b.filter((x) => x[1] > s[0]).sort((x, y) => x[0] - y[0])[0];
    return e ? select(v, [s[0], e[1]]) : { fail: 'The end comes before the start' };
  },
  selectPhrase: (g, said, v) => withPhrase(v, g[0], (r) => select(v, r)),
  showNumbers(g, said, v) { const kind = /paragraph/iu.test(g.join(' ')) ? 'paragraphs' : 'sentences'; v.dispatch({ effects: setVoice.of({ numbers: kind }) }); return { msg: `Numbered ${kind}` }; },
  hideNumbers(g, said, v) { v.dispatch({ effects: setVoice.of({ numbers: null }) }); closeChoice(v); return { msg: 'Numbers hidden' }; },
  pickUnit(g, said, v) {
    const kind = g[0].toLowerCase(), list = units(v, kind), num = numberOf(g[1]), r = list[num - 1];
    return r ? select(v, r, `Selected ${kind} ${num}`) : { fail: `No ${kind} ${num} · ${list.length} in this sheet` };
  },
  cancel(g, said, v) {
    stopReading();
    closeChoice(v);
    const s = v.state.selection.main;
    v.dispatch({ selection: EditorSelection.cursor(s.head), effects: setVoice.of({ numbers: null, target: null }) });
    return { msg: 'Cleared' };
  },

  goEdge(g, said, v) {
    const toEnd = /end|bottom/iu.test(g[0]), where = (g[1] || 'sheet').toLowerCase(), doc = textOf(v), head = v.state.selection.main.head;
    let r;
    if (where === 'paragraph') { const L = v.state.doc.lineAt(head); r = [L.from, L.to]; }
    else if (where === 'sentence') r = sentenceRanges(doc).find((x) => x[0] <= head && head <= x[1]);
    else { const L = proseLines(doc); r = L.length ? [L[0][0], L[L.length - 1][1]] : [0, doc.length]; }
    if (!r) return { fail: 'Nowhere to go' };
    return moveTo(v, toEnd ? r[1] : r[0], `To the ${toEnd ? 'end' : 'start'} of the ${['paragraph', 'sentence'].includes(where) ? where : 'sheet'}`);
  },
  step(g, said, v) {
    const head = v.state.selection.main.head, list = units(v, g[1].toLowerCase()), next = /next/iu.test(g[0]);
    const r = next ? list.find((x) => x[0] > head) : list.filter((x) => x[1] < head).pop();
    return r ? moveTo(v, r[0], `The ${g[0].toLowerCase()} ${g[1].toLowerCase()}`) : { fail: `No ${g[0].toLowerCase()} ${g[1].toLowerCase()}` };
  },
  goNear: (g, said, v) => (v ? withPhrase(v, g[1], (r) => moveTo(v, /after/iu.test(g[0]) ? r[1] : r[0], `Cursor ${g[0].toLowerCase()} “${g[1]}”`), true) : { fail: 'Open a sheet first' }),
  goTo(g, said, v) {
    const p = g[0].toLowerCase().replace(/^the /u, '');
    if (v) {
      const doc = textOf(v), h = headingsOf(doc).find((x) => x.title.toLowerCase().includes(p));
      if (h) { const next = proseLines(doc).find((x) => x[0] > h.to); return moveTo(v, next ? next[0] : h.to, `To “${h.title}”`); }
    }
    const s = findSheet(g[0]);
    if (s) { openSheet(s.path); return { msg: `Opened “${s.title || s.name}”` }; }
    return { decline: `There's no “${g[0]}” heading or sheet here, so it was typed.` };
  },
  open(g) {
    const s = findSheet(g[0]);
    if (!s) return { decline: `There's no sheet called “${g[0]}” in this list, so it was typed.` };
    openSheet(s.path);
    return { msg: `Opened “${s.title || s.name}”` };
  },
  showSheets(g, said, v) {
    const all = listSheets().slice(0, 30);
    if (!all.length) return { fail: 'No sheets in this list' };
    choose(v, { kind: 'sheet', label: 'Sheets', items: all.map((s) => ({ label: s.title || s.name, sub: s.preview })) }, (i) => { openSheet(all[i].path); return { msg: `Opened “${all[i].title || all[i].name}”` }; });
    showView('voice');
    return { msg: `${all.length} sheets · say a number` };
  },
  stepSheet(g) { command(/next/iu.test(g[0]) ? 'nextSheet' : 'previousSheet'); return { msg: `The ${g[0].toLowerCase()} sheet` }; },
  scroll(g, said, v) {
    if (!v) return { fail: 'No sheet open' };
    v.scrollDOM.scrollBy({ top: (/down/iu.test(g[0]) ? 1 : -1) * v.scrollDOM.clientHeight * 0.8, behavior: 'smooth' });
    return { msg: `Scrolled ${g[0].toLowerCase()}` };
  },
  zoom(g) { const bigger = /bigger|larger|in/iu.test(g.join(' ')); command(bigger ? 'zoomIn' : 'zoomOut'); command(bigger ? 'zoomIn' : 'zoomOut'); return { msg: bigger ? 'Bigger' : 'Smaller' }; },

  deleteThat(g, said, v) { const r = thatRange(v); return r ? strikeOrDelete(v, r, 'delete') : { fail: 'Nothing to delete' }; },
  deleteLast(g, said, v) {
    const doc = textOf(v), head = v.state.selection.main.head;
    const r = /word/iu.test(g[0]) ? wordAt(doc, head) : sentenceRanges(doc).filter((x) => x[0] < head).pop();
    return r ? strikeOrDelete(v, r, 'delete') : { fail: 'Nothing before the cursor' };
  },
  deletePhrase: (g, said, v) => withPhrase(v, g[1], (r) => strikeOrDelete(v, r, g[0].toLowerCase()), true),
  replace: (g, said, v) => withPhrase(v, g[0], (r) => replaceRange(v, r, fromSaid(said, g[1]).replace(/[.!?]+$/u, '')), true),
  insert(g, said, v) {
    const words = asSaid(said, g[0]), after = /after/iu.test(g[1]);
    return withPhrase(v, g[2], (r) => {
      const doc = textOf(v), at = after ? r[1] : r[0];
      if (app.revision) { const c = insertChanges(doc, at, words); apply(v, c, { cursor: c[0].from + c[0].insert.length }); }
      else { const ins = after ? ` ${words}` : `${words} `; apply(v, { from: at, to: at, insert: ins }, { cursor: at + ins.length, last: after ? [at + 1, at + ins.length] : [at, at + words.length] }); }
      return { msg: `Inserted “${words}”` };
    }, true);
  },
  format(g, said, v) {
    const kind = /bold/iu.test(g[0]) ? 'strong' : /ital|emph/iu.test(g[0]) ? 'emphasis' : 'mark';
    const label = { strong: 'Bold', emphasis: 'Italic', mark: 'Highlighted' }[kind];
    const go = (r) => { select(v, r); editorRun(kind); return { msg: label }; };
    if (/^(that|it|this)$/iu.test(g[1])) { const r = thatRange(v); return r ? go(r) : { fail: 'Nothing selected' }; }
    return withPhrase(v, g[1], go, true);
  },
  makeFormat(g, said, v) { return DO.format([{ bold: 'bold', italic: 'italicize', italics: 'italicize' }[g[0].toLowerCase()] || 'highlight', 'that'], said, v); },
  heading(g) { editorRun('heading', /sub/iu.test(g[0]) ? 3 : 2); return { msg: /sub/iu.test(g[0]) ? 'Subheading' : 'Heading' }; },
  move(g, said, v) {
    const r = thatRange(v);
    if (!r) return { fail: 'Nothing selected to move' };
    const doc = textOf(v);
    let [a, b] = r;
    while (a < b && /\s/u.test(doc[a])) a++;
    while (b > a && /\s/u.test(doc[b - 1])) b--;
    const t = doc.slice(a, b);
    if (doc[a - 1] === ' ' && (b >= doc.length || /[ \n.,;:!?…]/u.test(doc[b]))) a--;
    let at;
    if (g[2]) { const L = proseLines(doc); at = /end/iu.test(g[2]) ? L[L.length - 1][1] : L[0][0]; }
    else { const f = phraseRanges(doc, g[1]).filter((x) => x[1] <= a || x[0] >= b); if (!f.length) return { fail: `Not found · “${g[1]}”` }; const x = nearest(f, a); at = /after/iu.test(g[0]) ? x[1] : x[0]; }
    const before = /before/iu.test(g[0]) || /start|top/iu.test(g[2]);
    const piece = before ? `${t} ` : ` ${t}`;
    const cs = v.state.changes([{ from: a, to: b, insert: '' }, { from: at, insert: piece }]);
    const start = cs.mapPos(at, -1) + (before ? 0 : 1);
    apply(v, cs, { cursor: start + t.length, last: [start, start + t.length] });
    return { msg: `Moved “${t.length > 32 ? `${t.slice(0, 32)}…` : t}”` };
  },
  comment(g, said, v) {
    const doc = textOf(v), s = v.state.selection.main;
    const r = !s.empty ? [s.from, s.to] : sentenceRanges(doc).find((x) => x[0] <= s.head && s.head <= x[1]);
    if (!r) return { fail: 'Nothing to comment on' };
    const note = cap(fromSaid(said, g[0])), line = v.state.doc.lineAt(r[0]);
    const changes = commentChanges(doc, line.from, line.to, r[0], Math.min(r[1], line.to), note);
    apply(v, changes, { cursor: changes[0].from + changes[0].insert.length });
    return { msg: `Comment · “${note}”` };
  },

  revisionOn() { if (!app.revision) command('revision'); return { msg: 'Revision Mode' }; },
  revisionOff() { if (app.revision) command('revision'); return { msg: 'Revision Mode off' }; },
  acceptAll(g, said, v) {
    const accept = /accept/iu.test(g[0]), changes = settleChanges(textOf(v), accept);
    if (!changes.length) return { fail: 'No insertions, deletions or changes here' };
    apply(v, changes);
    return { msg: `${accept ? 'Accepted' : 'Rejected'} ${changes.length} mark${changes.length > 1 ? 's' : ''}` };
  },
  pickMark(g, said, v) {
    const ms = marksOf(textOf(v)), n = numberOf(g[0]), m = ms[n - 1];
    showView('annotations');
    return m ? select(v, [m.from, m.to], `Mark ${n} · ${m.kind}`) : { fail: `No mark ${n} · ${ms.length} in this sheet` };
  },

  async synonyms(g, said, v) {
    const phrase = g[0] || g[1] || '', r = targetWord(v, phrase);
    const word = r ? textOf(v).slice(r[0], r[1]).replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '') : phrase;
    if (!word) return { fail: 'Which word?' };
    const entry = await lookup(word), list = entry ? synonymList(entry) : [];
    voice.words = { kind: 'syn', word, entry, list };
    showView('words');
    if (!list.length) return { msg: `No synonyms for “${word}”` };
    if (!r) return { msg: `${list.length} synonyms · “${word}” isn't in this sheet` };
    v.dispatch({ effects: setVoice.of({ target: r }) });
    choose(v, { kind: 'syn', label: word, items: list.map((w) => ({ label: w })) }, (i) => {
      const vv = view(), t = vv && voiceState(vv).target;
      if (!vv || !t) return { fail: 'The word moved away' };
      voice.words = { ...voice.words, used: list[i] };
      return replaceRange(vv, t, list[i]);
    });
    return { msg: `${list.length} synonyms · say “use” and a number` };
  },
  async define(g, said, v) {
    const phrase = g[0] || g[1] || '', r = !phrase || /^(that|it|this)$/iu.test(phrase) ? targetWord(v, '') : null;
    const word = r ? textOf(v).slice(r[0], r[1]) : phrase;
    const entry = await lookup(word);
    voice.words = { kind: 'def', word, entry };
    showView('words');
    return entry ? { msg: `Defined · ${entry.lemma}` } : { msg: `No definition for “${word}”` };
  },
  correct(g, said, v) {
    const r = targetWord(v, g[0]);
    if (!r) return { fail: `Not found · “${g[0]}”` };
    const word = textOf(v).slice(r[0], r[1]), list = alternatesFor(word, voice.names);
    voice.words = { kind: 'fix', word, list };
    showView('words');
    v.dispatch({ selection: EditorSelection.cursor(r[1]), effects: setVoice.of({ target: r }) });
    if (!list.length) return { msg: `No other guesses for “${word}”`, why: 'Say “spell” and the letters, like “spell a v n e r”.' };
    choose(v, { kind: 'fix', label: word, items: list.map((w) => ({ label: w })) }, (i) => {
      const vv = view(), t = vv && voiceState(vv).target;
      if (!vv || !t) return { fail: 'The word moved away' };
      voice.words = { ...voice.words, used: list[i] };
      return replaceRange(vv, t, list[i]);
    });
    return { msg: `${list.length} other guess${list.length > 1 ? 'es' : ''} · say a number` };
  },
  spell(g, said, v) {
    const w = g[0].replace(/[^a-z]/giu, '').toLowerCase(), t = voiceState(v).target, s = v.state.selection.main;
    const r = t || (!s.empty ? [s.from, s.to] : null);
    if (!r) return { dictate: w, why: 'Nothing was being corrected, so the spelled word was typed.' };
    closeChoice(v);
    return replaceRange(v, r, w);
  },
  use: () => ({ fail: 'No numbered list showing' }),

  readThat(g, said, v) { const r = thatRange(v); return r ? read(v, r) : { fail: 'Nothing to read' }; },
  readUnit(g, said, v) {
    const head = v.state.selection.main.head, r = units(v, g[0].toLowerCase()).find((x) => x[0] <= head && head <= x[1]);
    return r ? read(v, r) : { fail: `No ${g[0].toLowerCase()} at the cursor` };
  },
  readNumbered(g, said, v) {
    const kind = g[0].toLowerCase(), n = numberOf(g[1]), r = units(v, kind)[n - 1];
    return r ? read(v, r, `Reading ${kind} ${n}`) : { fail: `No ${kind} ${n}` };
  },
  readFrom(g, said, v) { const L = proseLines(textOf(v)); return L.length ? read(v, [v.state.selection.main.head, L[L.length - 1][1]]) : { fail: 'Nothing to read' }; },
  stopReading() { const was = voice.reading; stopReading(); return { msg: was ? 'Stopped' : 'Nothing is being read' }; },
  stop() { stopReading(); return { msg: 'Stopped' }; },
  wordCount(g, said, v) { const n = (spokenText(textOf(v), 0, v.state.doc.length).text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length; return { msg: `${n} words` }; },

  help() { showView('voice'); return { msg: 'What you can say, in the dashboard' }; },
  dashboard(g) { const on = /show|open/iu.test(g[0]); if (!!app.dashboard !== on) command('dashboard'); return { msg: on ? 'Dashboard' : 'Dashboard hidden' }; },
  panel(g) {
    const id = { words: 'words', voice: 'voice', heard: 'voice', marks: 'annotations', annotations: 'annotations', outline: 'outline', overview: 'overview', progress: 'progress' }[g[0].toLowerCase()];
    showView(id);
    return { msg: `Dashboard · ${g[0].toLowerCase()}` };
  },
  back(g) { command(/back/iu.test(g[0]) ? 'back' : 'forward'); return { msg: /back/iu.test(g[0]) ? 'Back' : 'Forward' }; },
};

// ---- reading aloud, in the system's voices

function read(v, r, msg = 'Reading') {
  const { text, map } = spokenText(textOf(v), r[0], r[1]);
  if (!text.trim()) return { fail: 'Nothing there to read' };
  if (!('speechSynthesis' in window)) return { fail: 'This browser has no voices to read with' };
  stopReading();
  const token = ++readToken;
  voice.reading = true;
  v.dispatch({ effects: setVoice.of({ reading: r, word: null }) });
  const u = new SpeechSynthesisUtterance(text);
  u.lang = voice.lang === 'he' ? 'he-IL' : 'en-US';
  u.rate = prefs.voice.rate || 1;
  u.onboundary = (e) => {
    if (token !== readToken || (e.name && e.name !== 'word')) return;
    let j = e.charIndex;
    while (j < text.length && /[\p{L}\p{N}'’-]/u.test(text[j])) j++;
    const vv = view();
    if (vv && j > e.charIndex) vv.dispatch({ effects: setVoice.of({ word: [map[e.charIndex], map[j - 1] + 1] }) });
  };
  const done = () => { if (token !== readToken) return; voice.reading = false; const vv = view(); if (vv) vv.dispatch({ effects: setVoice.of({ reading: null, word: null }) }); };
  let started = false;
  u.onstart = () => { started = true; };
  u.onend = done;
  u.onerror = done;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
  // no voice to read with (some systems have none): it never starts, and the microphone mustn't wait on it
  setTimeout(() => { if (!started) done(); }, 3000);
  return { msg };
}
export function stopReading() {
  readToken++;
  try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch { /* nothing to stop */ }
  if (!voice.reading) return;
  voice.reading = false;
  const v = view();
  if (v) v.dispatch({ effects: setVoice.of({ reading: null, word: null }) });
}

// ---- tones: one for a command, one for text, a low one for a command that couldn't be done

let audio = null;
function tone(kind) {
  if (!prefs.voice.sounds) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime, notes = kind === 'command' ? [660, 880] : kind === 'fail' ? [196] : [523];
    notes.forEach((f, i) => {
      const o = audio.createOscillator(), gain = audio.createGain(), at = t + i * 0.09;
      o.frequency.value = f;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.05, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
      o.connect(gain).connect(audio.destination);
      o.start(at);
      o.stop(at + 0.2);
    });
  } catch { /* no sound: nothing lost */ }
}

// ---- the project's names

let namesKey = '';
/** The names in the open project (or the open list), for the recognizer: refreshed as the library changes. */
export function refreshNames() {
  if (!store) return;
  const paths = app.project ? store.projectSheets(app.project) : listSheets().map((s) => s.path);
  const key = `${app.version}|${paths.length}|${paths[0] || ''}`;
  if (key === namesKey) return;
  namesKey = key;
  const texts = paths.slice(0, 400).map((p) => { const t = store.text(p); return t ? splitSheet(t).body : ''; });
  voice.names = namesIn(texts);
}
