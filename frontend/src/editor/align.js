// Translation mode's alignment: two editors, paragraph beside paragraph.
// Each paragraph gets room below it to match the height of its counterpart
// on the other side, so the nth paragraph of the original and the nth of the
// translation always start at the same height, whatever their lengths; and
// the paragraph the cursor is in shows its counterpart.
import { Decoration, EditorView } from '@codemirror/view';
import { StateEffect, StateField } from '@codemirror/state';

/** Room to add below each line: Map(line number → px). */
export const setPads = StateEffect.define();
/** The line whose counterpart the other side is showing (0: none). */
export const setCounterpart = StateEffect.define();

function build(state, pads, counterpart) {
  const out = [];
  const n = state.doc.lines;
  for (const [line, px] of pads) {
    if (line > n || px < 1) continue;
    out.push(Decoration.line({ attributes: { style: `padding-bottom:${px.toFixed(1)}px` } }).range(state.doc.line(line).from));
  }
  if (counterpart && counterpart <= n) out.push(Decoration.line({ class: 'cm-counterpart' }).range(state.doc.line(counterpart).from));
  return Decoration.set(out, true);
}

export const alignField = StateField.define({
  create: () => ({ pads: new Map(), counterpart: 0, deco: Decoration.none }),
  update(v, tr) {
    let { pads, counterpart } = v;
    let changed = tr.docChanged;
    for (const e of tr.effects) {
      if (e.is(setPads)) { pads = e.value; changed = true; }
      if (e.is(setCounterpart)) { counterpart = e.value; changed = true; }
    }
    return changed ? { pads, counterpart, deco: build(tr.state, pads, counterpart) } : v;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

/** A line's height without the room this alignment gave it. */
function natural(view, i) {
  if (i > view.state.doc.lines) return 0;
  const block = view.lineBlockAt(view.state.doc.line(i).from);
  const pad = view.state.field(alignField, false)?.pads.get(i) || 0;
  return Math.max(0, block.height - pad);
}

const samePads = (a, b) => a.size === b.size && [...a].every(([k, v]) => Math.abs((b.get(k) || 0) - v) < 1);

/**
 * Keep two editors' paragraphs level. Returns a function that stops it.
 * @param {EditorView} a
 * @param {EditorView} b
 * @param {(counts: {lines: number, done: number}) => void} [onCount]
 */
export function alignViews(a, b, onCount = null) {
  for (const v of [a, b]) if (!v.state.field(alignField, false)) v.dispatch({ effects: StateEffect.appendConfig.of(alignField) });
  let frame = 0, stopped = false;
  const run = () => {
    frame = 0;
    if (stopped) return;
    const n = Math.max(a.state.doc.lines, b.state.doc.lines);
    const pa = new Map(), pb = new Map();
    let lines = 0, done = 0;
    for (let i = 1; i <= n; i++) {
      const ha = natural(a, i), hb = natural(b, i);
      if (i <= a.state.doc.lines && i <= b.state.doc.lines) {
        if (hb > ha) pa.set(i, hb - ha); else if (ha > hb) pb.set(i, ha - hb);
      }
      const ta = i <= a.state.doc.lines ? a.state.doc.line(i).text.trim() : '';
      const tb = i <= b.state.doc.lines ? b.state.doc.line(i).text.trim() : '';
      if (ta) { lines++; if (tb) done++; }
    }
    if (!samePads(pa, a.state.field(alignField).pads)) a.dispatch({ effects: setPads.of(pa) });
    if (!samePads(pb, b.state.field(alignField).pads)) b.dispatch({ effects: setPads.of(pb) });
    if (onCount) onCount({ lines, done });
  };
  const soon = () => { if (!frame) frame = requestAnimationFrame(run); };
  // the cursor's paragraph, shown on the other side
  const mark = (from, to) => {
    const line = from.hasFocus ? from.state.doc.lineAt(from.state.selection.main.head).number : 0;
    if (to.state.field(alignField).counterpart !== line) to.dispatch({ effects: setCounterpart.of(line) });
    if (from.state.field(alignField).counterpart !== 0 && from.hasFocus) from.dispatch({ effects: setCounterpart.of(0) });
  };
  const listen = (from, to) => (u) => {
    if (u.docChanged || u.geometryChanged || u.viewportChanged) soon();
    if (u.selectionSet || u.focusChanged) mark(from, to);
  };
  const offA = addListener(a, listen(a, b)), offB = addListener(b, listen(b, a));
  // the two scroll as one: level paragraphs make it a matter of scrollTop
  let syncing = false;
  const sync = (from, to) => () => {
    if (syncing) return;
    syncing = true;
    to.scrollDOM.scrollTop = from.scrollDOM.scrollTop;
    requestAnimationFrame(() => { syncing = false; });
  };
  const sa = sync(a, b), sb = sync(b, a);
  a.scrollDOM.addEventListener('scroll', sa, { passive: true });
  b.scrollDOM.addEventListener('scroll', sb, { passive: true });
  soon();
  return () => {
    stopped = true;
    if (frame) cancelAnimationFrame(frame);
    offA(); offB();
    a.scrollDOM.removeEventListener('scroll', sa);
    b.scrollDOM.removeEventListener('scroll', sb);
    for (const v of [a, b]) if (v.state.field(alignField, false)) v.dispatch({ effects: [setPads.of(new Map()), setCounterpart.of(0)] });
  };
}

/** An update listener added to a view after it was made, through the view's hook (Editor.svelte). */
function addListener(view, fn) {
  const set = (view.__alignListeners ||= new Set());
  set.add(fn);
  return () => set.delete(fn);
}
