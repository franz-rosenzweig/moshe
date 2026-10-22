// Show Paragraph Numbers (View menu): each paragraph's number in the
// margin. A paragraph is a line with text on it, outside code
// fences; they are counted from the top, drawn only where the screen is.
import { ViewPlugin, Decoration } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

const FENCE = /^\s*(```|~~~)/u;

export const paragraphNumbers = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.build(view); }
  update(u) { if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view); }
  build(view) {
    const b = new RangeSetBuilder();
    const vr = view.visibleRanges;
    if (!vr.length) return b.finish();
    const doc = view.state.doc, from = vr[0].from, to = vr[vr.length - 1].to;
    let n = 0, fence = false;
    for (let i = 1; i <= doc.lines; i++) {
      const line = doc.line(i);
      if (line.from > to) break;
      if (FENCE.test(line.text)) { fence = !fence; continue; }
      if (fence || !line.text.trim()) continue;
      n++;
      if (line.to >= from) b.add(line.from, line.from, Decoration.line({ attributes: { 'data-pn': String(n) } }));
    }
    return b.finish();
  }
}, { decorations: (v) => v.decorations });
