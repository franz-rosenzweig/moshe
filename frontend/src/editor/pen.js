// Pen marks in the editor. In Revision Mode a pen stroke over the text is a
// proofreading mark: drawn as it's made, read by its shape (engine/pen.js),
// matched to the words under it the moment it's done, and turned into the
// revision mark it stands for; then the ink fades, and only the edit is kept.
// A caret or a circle asks for words (the writing box, Editor.svelte). Fingers
// keep scrolling, except while the pen is on or over the glass: then they're
// the hand resting on it, and ignored.
import { ViewPlugin } from '@codemirror/view';
import { StateField, StateEffect } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { readStroke, inside, tokensOf, strikeChanges, scribbleChanges, insertChanges, commentChanges, snapBetweenWords } from '@engine/pen.js';

const PALM_MS = 600;     // a touch this soon after the pen was seen is the hand

// where the writing box's words will go, kept in step with any edit made while it's open
const setPending = StateEffect.define();
export const penPending = StateField.define({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setPending)) return e.value;
    if (!v || !tr.docChanged) return v;
    return { ...v, pos: tr.changes.mapPos(v.pos, -1), from: tr.changes.mapPos(v.from, 1), to: tr.changes.mapPos(v.to, -1) };
  },
});

/** Words, not the punctuation at either end, unless there's nothing but. */
function trimmed(hit) {
  if (!hit.some((t) => t.word)) return hit;
  let a = 0, b = hit.length;
  while (!hit[a].word) a++;
  while (!hit[b - 1].word) b--;
  return hit.slice(a, b);
}

/** A token's place on screen: its middle, and the line it sits on. */
function placeOf(view, tok) {
  const a = view.coordsAtPos(tok.from, 1), b = view.coordsAtPos(tok.to, -1);
  if (!a || !b) return null;
  return { x: (Math.min(a.left, b.left, a.right, b.right) + Math.max(a.left, b.left, a.right, b.right)) / 2, y: (a.top + a.bottom) / 2, top: a.top, bottom: a.bottom };
}

/** The words a stroke along `y` from x0 to x1 covers (their middles inside it): {line, from, to} or null. */
function wordsAlong(view, y, x0, x1) {
  const pos = view.posAtCoords({ x: (x0 + x1) / 2, y }, false);
  if (pos == null) return null;
  const line = view.state.doc.lineAt(pos);
  const text = view.state.doc.toString();
  const hit = trimmed(tokensOf(text, line.from, line.to).filter((t) => {
    const p = placeOf(view, t);
    return p && y >= p.top - 3 && y <= p.bottom + 3 && p.x >= x0 && p.x <= x1;
  }));
  return hit.length ? { line, from: hit[0].from, to: hit[hit.length - 1].to } : null;
}

/** The words inside a loop, in the paragraph that has the most of them. */
function wordsInside(view, poly, box) {
  const doc = view.state.doc, text = doc.toString();
  const a = view.posAtCoords({ x: (box.left + box.right) / 2, y: box.top + 2 }, false);
  const b = view.posAtCoords({ x: (box.left + box.right) / 2, y: box.bottom - 2 }, false);
  if (a == null || b == null) return null;
  let best = null;
  for (let n = doc.lineAt(Math.min(a, b)).number, last = doc.lineAt(Math.max(a, b)).number; n <= last; n++) {
    const line = doc.line(n);
    const hit = trimmed(tokensOf(text, line.from, line.to).filter((t) => { const p = placeOf(view, t); return p && inside(poly, p.x, p.y); }));
    if (hit.length && (!best || hit.length > best.n)) best = { line, n: hit.length, from: hit[0].from, to: hit[hit.length - 1].to };
  }
  return best;
}

/** Changes made as one step of the history, apart from the typing around them. */
function apply(view, changes) {
  if (!changes || !changes.length) return false;
  view.dispatch({ annotations: isolateHistory.of('full') });
  view.dispatch({ changes, userEvent: 'input.pen', scrollIntoView: false });
  view.dispatch({ annotations: isolateHistory.of('full') });
  return true;
}

/**
 * What the writing box wrote: an insertion at a caret, a circle's comment, or
 * plain words at the cursor (the box opened by hand).
 * @param {import('@codemirror/view').EditorView} view
 * @param {{kind: 'insert' | 'comment' | 'text', pos?: number, from?: number, to?: number}} req
 */
export function commitWriting(view, req, words) {
  const text = view.state.doc.toString();
  const held = view.state.field(penPending, false);
  view.dispatch({ effects: setPending.of(null) });
  if (held && held.kind === req.kind) req = { ...req, ...held };     // where the words go now, after any edits meanwhile
  const clamp = (n) => Math.max(0, Math.min(n, text.length));
  req = { ...req, pos: clamp(req.pos ?? 0), from: clamp(req.from ?? 0), to: clamp(req.to ?? 0) };
  if (req.kind === 'insert') return apply(view, insertChanges(text, req.pos, words));
  if (req.kind === 'comment') {
    const line = view.state.doc.lineAt(req.from);
    return apply(view, commentChanges(text, line.from, line.to, req.from, req.to, words));
  }
  const t = String(words || '');
  if (!t) return false;
  view.dispatch({ annotations: isolateHistory.of('full') });
  view.dispatch(view.state.replaceSelection(t), { userEvent: 'input.pen', scrollIntoView: true });
  view.dispatch({ annotations: isolateHistory.of('full') });
  return true;
}

/** The writing box opened for `req`: its place held, and kept in step with the text. */
export function holdWriting(view, req) {
  view.dispatch({ effects: setPending.of({ kind: req.kind, pos: req.pos ?? 0, from: req.from ?? 0, to: req.to ?? 0 }) });
}

/** The writing box closed without writing. */
export function dropWriting(view) { if (view.state.field(penPending, false)) view.dispatch({ effects: setPending.of(null) }); }

/**
 * @param {() => {on: boolean, write: (req: object) => void, fail: (why: string) => void}} get
 *   on: marks are read (Revision Mode); write: open the writing box; fail: say a stroke meant nothing
 */
export function penMarks(get) {
  return [penPending, ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view;
      this.points = null;
      this.id = null;
      this.penAt = 0;
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'cm-pen-ink';
      this.canvas.setAttribute('aria-hidden', 'true');
      view.dom.appendChild(this.canvas);
      this.down = (e) => this.onDown(e);
      this.move = (e) => this.onMove(e);
      this.up = (e) => this.onUp(e);
      this.cancel = () => this.clear(true);
      this.touch = (e) => this.onTouch(e);
      const s = view.scrollDOM;
      s.addEventListener('pointerdown', this.down, true);
      s.addEventListener('pointermove', this.move, true);
      s.addEventListener('pointerup', this.up, true);
      s.addEventListener('pointercancel', this.cancel, true);
      s.addEventListener('touchstart', this.touch, { capture: true, passive: false });
      s.addEventListener('touchmove', this.touch, { capture: true, passive: false });
    }

    /** The pen on the glass, or just over it, a moment ago. */
    penNear() { return !!this.points || performance.now() - this.penAt < PALM_MS; }

    onTouch(e) {
      if (!get().on) return;
      const touches = [...e.changedTouches];
      // the pen's own touches: no scrolling while it writes (Chrome names them "stylus")
      if (touches.some((t) => t.touchType === 'stylus')) { e.preventDefault(); return; }
      if (this.penNear()) { e.preventDefault(); e.stopPropagation(); }       // the hand
    }

    onDown(e) {
      if (e.pointerType === 'pen') {
        this.penAt = performance.now();
        if (!get().on || (e.buttons & ~1)) return;        // with the pen's button held, the pen selects as a finger would
        e.preventDefault();
        e.stopPropagation();
        try { this.view.scrollDOM.setPointerCapture(e.pointerId); } catch { /* gone already */ }
        this.id = e.pointerId;
        this.size();
        this.points = [this.at(e)];
        this.ink(this.color());
        return;
      }
      if (e.pointerType === 'touch' && get().on && this.penNear()) { e.preventDefault(); e.stopPropagation(); }
    }

    onMove(e) {
      if (e.pointerType === 'pen') this.penAt = performance.now();        // hovering counts: the hand comes down next
      if (!this.points || e.pointerId !== this.id) return;
      e.preventDefault();
      const ctx = this.ctx;
      const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      for (const ev of list.length ? list : [e]) {
        const p = this.at(ev), q = this.points[this.points.length - 1];
        this.points.push(p);
        ctx.lineWidth = 1.6 + 2.2 * (p.p || 0.5);
        ctx.beginPath();
        ctx.moveTo(q.x - this.ox, q.y - this.oy);
        ctx.lineTo(p.x - this.ox, p.y - this.oy);
        ctx.stroke();
      }
    }

    onUp(e) {
      if (!this.points || e.pointerId !== this.id) return;
      e.preventDefault();
      const points = this.points;
      this.points = null;
      this.penAt = performance.now();
      let done = false;
      try { done = this.act(readStroke(points, this.view.defaultLineHeight || 24)); } catch (err) { console.error(err); }
      this.clear(!done);
    }

    /** A stroke read: made into its mark. True if it meant something. */
    act(s) {
      const view = this.view;
      if (!s) { get().fail('Strike through, scribble over, draw a caret or circle the words.'); return false; }
      if (s.kind === 'tap') {
        const pos = view.posAtCoords({ x: s.x, y: s.y });
        if (pos != null) { view.dispatch({ selection: { anchor: pos } }); view.focus(); }
        return true;
      }
      const text = view.state.doc.toString();
      if (s.kind === 'strike' || s.kind === 'scribble') {
        const w = wordsAlong(view, s.y, s.box.left, s.box.right);
        if (!w) { get().fail('No words under the stroke.'); return false; }
        const changes = (s.kind === 'strike' ? strikeChanges : scribbleChanges)(text, w.line.from, w.line.to, w.from, w.to);
        return apply(view, changes) || s.kind === 'strike';
      }
      if (s.kind === 'caret') {
        const at = view.posAtCoords({ x: s.x, y: s.y }, false);
        if (at == null) return false;
        const line = view.state.doc.lineAt(at);
        const req = { kind: 'insert', pos: snapBetweenWords(text, line.from, line.to, at), x: s.x, y: s.box.bottom };
        holdWriting(view, req);
        get().write(req);
        return true;
      }
      if (s.kind === 'circle') {
        const w = wordsInside(view, s.points, s.box);
        if (!w) { get().fail('No words inside the circle.'); return false; }
        const req = { kind: 'comment', from: w.from, to: w.to, x: s.box.left, y: s.box.bottom };
        holdWriting(view, req);
        get().write(req);
        return true;
      }
      return false;
    }

    at(e) { return { x: e.clientX, y: e.clientY, p: e.pressure }; }

    color() { return getComputedStyle(this.view.dom).getPropertyValue('--accent-fg').trim() || '#b8730a'; }

    size() {
      const r = this.view.dom.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      this.ox = r.left; this.oy = r.top;
      this.canvas.width = Math.round(r.width * dpr);
      this.canvas.height = Math.round(r.height * dpr);
      this.canvas.style.opacity = '1';
      this.canvas.style.transition = 'none';
      this.ctx = this.canvas.getContext('2d', { desynchronized: true }) || this.canvas.getContext('2d');
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    ink(color) { const c = this.ctx; c.strokeStyle = color; c.lineCap = 'round'; c.lineJoin = 'round'; }

    /** The ink away: fading, or at once; a stroke that meant nothing goes grey first. */
    clear(failed = false) {
      this.points = null;
      if (!this.ctx) return;
      if (failed) { this.ctx.globalCompositeOperation = 'source-in'; this.ctx.fillStyle = 'rgba(140,140,140,0.8)'; this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height); this.ctx.globalCompositeOperation = 'source-over'; }
      this.canvas.style.transition = 'opacity 0.45s';
      this.canvas.style.opacity = '0';
    }

    destroy() {
      const s = this.view.scrollDOM;
      s.removeEventListener('pointerdown', this.down, true);
      s.removeEventListener('pointermove', this.move, true);
      s.removeEventListener('pointerup', this.up, true);
      s.removeEventListener('pointercancel', this.cancel, true);
      s.removeEventListener('touchstart', this.touch, true);
      s.removeEventListener('touchmove', this.touch, true);
      this.canvas.remove();
    }
  })];
}
