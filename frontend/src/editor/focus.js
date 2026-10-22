// The typewriter options: the line marker (a tint under the current
// line), highlighting (everything but the current line, sentence or
// paragraph fades) and fixed scrolling (the line being typed stays at one
// height on the screen).
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';

const faded = Decoration.mark({ class: 'cm-faded' });

/** The stretch around `pos` that stays bright. */
function unitAt(state, pos, mode) {
  const line = state.doc.lineAt(pos);
  if (mode !== 'sentence') return [line.from, line.to];
  const text = line.text, at = pos - line.from;
  let start = 0, end = text.length;
  const re = /[.!?…]+["'”’)\]]*\s+/gu;
  let m;
  while ((m = re.exec(text))) {
    const e = m.index + m[0].length;
    if (e <= at) start = e;
    else { end = m.index + m[0].length; break; }
  }
  return [line.from + start, line.from + end];
}

/** @param {() => {highlight: string, fixed: string}} get */
export function focusMode(get) {
  return [
    ViewPlugin.fromClass(class {
      constructor(view) { this.decorations = this.build(view); }
      update(u) { if (u.docChanged || u.selectionSet || u.focusChanged || u.transactions.some((t) => t.reconfigured)) this.decorations = this.build(u.view); }
      build(view) {
        const { highlight } = get();
        if (!highlight || highlight === 'off') return Decoration.none;
        const s = view.state;
        const [a, b] = unitAt(s, s.selection.main.head, highlight);
        const out = [];
        if (a > 0) out.push(faded.range(0, a));
        if (b < s.doc.length) out.push(faded.range(b, s.doc.length));
        return Decoration.set(out);
      }
    }, { decorations: (v) => v.decorations }),
    EditorView.updateListener.of((u) => {
      const { fixed } = get();
      if (!fixed || fixed === 'off' || !u.docChanged || !u.transactions.some((t) => t.isUserEvent('input') || t.isUserEvent('delete'))) return;
      const pos = u.state.selection.main.head;
      const y = { top: 'start', middle: 'center', bottom: 'end', variable: 'center' }[fixed] || 'center';
      const margin = fixed === 'top' ? 120 : fixed === 'bottom' ? 120 : 0;
      u.view.dispatch({ effects: EditorView.scrollIntoView(pos, { y, yMargin: margin }) });
    }),
  ];
}
