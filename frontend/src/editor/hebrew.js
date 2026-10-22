// Hebrew spelling as you type: the Hebrew words of what is on screen asked
// of Hunspell (editor/hebrew-worker.js), the ones it does not know underlined
// as spelling, in any paragraph, English or Hebrew. Niqqud is set aside and
// ׳ ״ read as ' " for the lookup; the underline stays on the word as written.
// A word is asked once a session; the writer's own words (the library's
// dictionary, shared with editor/proof.js) always pass.
import { StateField, StateEffect } from '@codemirror/state';
import { EditorView, Decoration, ViewPlugin } from '@codemirror/view';
import { proseOf, placeFinding } from '@engine/proof.js';
import { proofIgnored, findingKey } from './proof.js';

const WORD = /[א-ת](?:[א-ת֑-ׇ'"׳״]*[א-ת֑-ׇ])?/gu;
const normal = (w) => w.replace(/[֑-ׇ]/gu, '').replace(/׳/gu, "'").replace(/״/gu, '"');
export const HEBREW_MESSAGE = 'Not in the Hebrew dictionary.';

// ---- the worker, one for the page
let worker = null, broken = false, seq = 0;
const waiting = new Map();
const known = new Map();            // a word (normalised) → spelled right?
let own = new Set();
const views = new Set();

function call(op, data) {
  if (broken) return Promise.reject(new Error('no Hebrew spelling here'));
  if (!worker) {
    try {
      worker = new Worker(new URL('./hebrew-worker.js', import.meta.url), { type: 'module' });
    } catch (e) { broken = true; return Promise.reject(e); }
    worker.onmessage = (e) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      if (e.data.error) w.reject(new Error(e.data.error)); else w.resolve(e.data.result);
    };
    worker.onerror = () => { broken = true; for (const w of waiting.values()) w.reject(new Error('the Hebrew spelling check stopped')); waiting.clear(); };
    if (own.size) worker.postMessage({ id: ++seq, op: 'add', words: [...own] });
  }
  const id = ++seq;
  return new Promise((resolve, reject) => { waiting.set(id, { resolve, reject }); worker.postMessage({ id, op, ...data }); });
}

/** The library's own words (its dictionary): they pass. */
export function configureHebrew(words = []) {
  const next = new Set(words.filter((w) => /[א-ת]/u.test(w)).map(normal));
  const added = [...next].filter((w) => !own.has(w));
  if (!added.length && next.size === own.size) return;
  own = next;
  for (const w of added) known.set(w, true);
  if (worker && added.length) worker.postMessage({ id: ++seq, op: 'add', words: added });
  for (const v of views) v.plugin(hebrewPlugin)?.soon(50);
}

/** Better spellings for a word. */
export const hebrewSuggestions = (word) => call('suggest', { word: normal(word) }).catch(() => []);

// ---- in an editor
const setHebrew = StateEffect.define();
const noSpell = Decoration.line({ attributes: { spellcheck: 'false' } });

export const hebrewField = StateField.define({
  create: () => ({ deco: Decoration.none, list: [] }),
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setHebrew)) return e.value;
    if (!tr.docChanged) return v;
    const list = v.list.map((f) => ({ ...f, from: tr.changes.mapPos(f.from, 1), to: tr.changes.mapPos(f.to, -1) }));
    return { deco: v.deco.map(tr.changes), list };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

const hebrewPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.view = view; this.timer = null; this.run = 0; views.add(view); this.soon(400); }
  update(u) {
    if (u.docChanged) this.soon(600);
    else if (u.viewportChanged) this.soon(150);
    else if (u.startState.facet(proofIgnored) !== u.state.facet(proofIgnored)) this.soon(0);
  }
  soon(ms) { clearTimeout(this.timer); this.timer = setTimeout(() => this.check(), ms); }
  async check() {
    const view = this.view, run = ++this.run, doc = view.state.doc;
    const vr = view.visibleRanges;
    if (!vr.length) return;
    const body = doc.toString();
    if (!/[א-ת]/u.test(body)) { if (view.state.field(hebrewField).list.length) view.dispatch({ effects: setHebrew.of({ deco: Decoration.none, list: [] }) }); return; }
    const range = { from: Math.max(0, vr[0].from - 3000), to: Math.min(body.length, vr[vr.length - 1].to + 3000) };
    const words = [];
    for (const p of proseOf(body, range)) {
      for (const m of p.text.matchAll(WORD)) {
        const w = normal(m[0]);
        if (w.replace(/['"]/gu, '').length < 2) continue;
        words.push({ p, start: m.index, end: m.index + m[0].length, word: w, written: m[0] });
      }
    }
    const ask = [...new Set(words.map((x) => x.word).filter((w) => !known.has(w) && !own.has(w)))];
    if (ask.length) {
      let ok;
      try { ok = await call('check', { words: ask }); } catch { return; }
      ask.forEach((w, i) => known.set(w, ok[i]));
    }
    if (run !== this.run || view.state.doc !== doc) return;
    const ignored = view.state.facet(proofIgnored);
    const list = [], marks = [], lines = new Set();
    for (const x of words) {
      const at = placeFinding(x.p, x.start, x.end);
      if (!at || at.to <= at.from) continue;
      lines.add(doc.lineAt(at.from).from);
      if (known.get(x.word) !== false || own.has(x.word)) continue;
      const f = { kind: 'Spelling', cls: 'sp', message: HEBREW_MESSAGE, problem: x.written, word: x.word, suggestions: null, src: 'he', from: at.from, to: at.to };
      if (ignored.has(findingKey(f))) continue;
      list.push(f);
    }
    list.sort((a, b) => a.from - b.from);
    list.forEach((f, i) => marks.push(Decoration.mark({ class: 'cm-proof sp', attributes: { 'data-heb': String(i) } }).range(f.from, f.to)));
    for (const at of lines) marks.push(noSpell.range(at));     // the system's own check would only say it again
    view.dispatch({ effects: setHebrew.of({ deco: Decoration.set(marks, true), list }) });
  }
  destroy() { clearTimeout(this.timer); views.delete(this.view); }
});

/** The Hebrew finding an underline stands for. */
export function hebrewAt(view, el) {
  const { list } = view.state.field(hebrewField, false) || { list: [] };
  return list[Number(el.dataset.heb)] || null;
}

export const hebrew = [hebrewField, hebrewPlugin];
