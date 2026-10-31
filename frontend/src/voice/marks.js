// What voice shows in the text (docs/VOICE.md): a number on each place the
// writer can pick (matches of a phrase, or every sentence or paragraph), the
// word a list is about, the words being read aloud, and the recognizer's guess
// at the cursor while she's still talking. It also keeps "that", the words just
// said, mapped through every change since, so "select that" finds them.
import { StateField, StateEffect } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { sentenceRanges, proseLines } from '@engine/voice.js';

/** A patch of what's shown: any of {matches, target, numbers, reading, word, ghost, last}. */
export const setVoice = StateEffect.define();

const EMPTY = { matches: [], target: null, numbers: null, reading: null, word: null, ghost: null, last: null };

class Badge extends WidgetType {
  constructor(n) { super(); this.n = n; }
  eq(o) { return o.n === this.n; }
  toDOM() { const b = document.createElement('span'); b.className = 'cm-voice-badge'; b.textContent = String(this.n); b.setAttribute('aria-hidden', 'true'); return b; }
  ignoreEvent() { return false; }
}
class Ghost extends WidgetType {
  constructor(text) { super(); this.text = text; }
  eq(o) { return o.text === this.text; }
  toDOM() { const g = document.createElement('span'); g.className = 'cm-voice-ghost'; g.textContent = this.text; return g; }
}

const badge = (pos, n) => Decoration.widget({ widget: new Badge(n), side: -1 }).range(pos);
const mark = (cls) => Decoration.mark({ class: cls });

function decorations(state, v) {
  const out = [], len = state.doc.length;
  const ok = (r) => r && r[0] >= 0 && r[1] <= len && r[1] > r[0];
  if (v.numbers) {
    const text = state.doc.toString();
    const list = v.numbers === 'paragraphs' ? proseLines(text) : sentenceRanges(text);
    list.forEach((r, i) => out.push(badge(r[0], i + 1)));
  }
  v.matches.forEach((r, i) => { if (ok(r)) { out.push(badge(r[0], i + 1)); out.push(mark('cm-voice-match').range(r[0], r[1])); } });
  if (ok(v.target)) out.push(mark('cm-voice-match').range(v.target[0], v.target[1]));
  if (ok(v.reading)) out.push(mark('cm-voice-reading').range(v.reading[0], v.reading[1]));
  if (ok(v.word)) out.push(mark('cm-voice-word').range(v.word[0], v.word[1]));
  if (v.ghost && v.ghost.text && v.ghost.pos <= len) out.push(Decoration.widget({ widget: new Ghost(v.ghost.text), side: 1 }).range(v.ghost.pos));
  return Decoration.set(out, true);
}

export const voiceField = StateField.define({
  create: () => EMPTY,
  update(v, tr) {
    let out = v;
    if (tr.docChanged) {
      const m = (r) => r && [tr.changes.mapPos(r[0], 1), tr.changes.mapPos(r[1], -1)];
      out = { ...v, matches: v.matches.map(m), target: m(v.target), reading: m(v.reading), word: null, last: m(v.last),
        ghost: v.ghost && { ...v.ghost, pos: tr.changes.mapPos(v.ghost.pos) } };
    }
    for (const e of tr.effects) if (e.is(setVoice)) out = { ...out, ...e.value };
    return out;
  },
  provide: (f) => EditorView.decorations.compute([f], (state) => decorations(state, state.field(f))),
});

const theme = EditorView.baseTheme({
  '.cm-voice-badge': {
    display: 'inline-block', minWidth: '1.45em', textAlign: 'center', marginRight: '4px', borderRadius: '6px', padding: '0 4px',
    font: '650 0.7em/1.55 var(--font-ui, system-ui)', verticalAlign: '0.12em', background: 'var(--accent)', color: 'var(--on-accent)',
    fontVariantNumeric: 'tabular-nums', userSelect: 'none',
  },
  '.cm-voice-match': { background: 'var(--accent-tint)', boxShadow: '0 0 0 1px var(--accent)', borderRadius: '2px' },
  '.cm-voice-reading': { background: 'var(--accent-tint)' },
  '.cm-voice-word': { background: 'var(--accent)', color: 'var(--on-accent)', borderRadius: '3px' },
  '.cm-voice-ghost': { opacity: '0.45', fontStyle: 'italic' },
});

/** The editor's part of voice: add it to the editor's extensions. */
export const voiceMarks = [voiceField, theme];

/** What's shown now in a view. */
export const voiceState = (view) => view.state.field(voiceField, false) || EMPTY;
