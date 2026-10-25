// Handwriting read as text (the handwritten page's To Text and Read the Whole
// Page): English with Grape, in the page itself, on any device, offline once
// its model is fetched; Hebrew with Google's reader in the Android app
// (android/…/InkReader.java), a line at a time, the lines found here.
let worker = null, seq = 0;
const waiting = new Map();
const MODEL = `${import.meta.env.BASE_URL || '/'}hwr/grape-2.0.bin`;

function ask(msg) {
  if (!worker) {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      if (e.data.error) w.reject(new Error(e.data.error)); else w.resolve(e.data.result);
    };
    worker.onerror = (e) => { for (const w of waiting.values()) w.reject(new Error(e.message || 'the handwriting reader stopped')); waiting.clear(); worker = null; };
  }
  return new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    worker.postMessage({ id, ...msg, url: new URL(MODEL, location.href).href });
  });
}

// the Android app's reader answers here
const native = new Map();
let onStatus = null;
window.__mosheInkReply = (id, r) => {
  const w = native.get(id);
  if (!w) return;
  native.delete(id);
  if (r && r.error) w.reject(new Error(r.error)); else w.resolve(r ? r.text || '' : '');
};
window.__mosheInkStatus = (text) => { if (onStatus) onStatus(text); };

/** The languages this device reads: English everywhere, Hebrew where the app has Google's reader. */
export function languages() {
  let he = false;
  try { he = !!(window.MosheInk && window.MosheInk.has('he')); } catch { /* no reader */ }
  return he ? ['en', 'he'] : ['en'];
}

/**
 * Strokes read as lines of text, top to bottom. The highlighter and shapes
 * that snapped clean aren't writing, so they're left out.
 * @param {object[]} items  the page's strokes (engine/ink.js)
 * @param {'en'|'he'} lang
 * @param {(text: string) => void} [status]  how it's going, while a reader is fetched
 * @returns {Promise<string[]>}
 */
export async function readInk(items, lang = 'en', status = null) {
  const ink = items.filter((s) => s.kind === 'stroke' && s.pen !== 'highlighter' && !s.shape && s.points.length)
    .map((s, i) => ({ id: s.id || `s${i}`, tool: 'pen', pts: s.points.flat() }));
  if (!ink.length) return [];
  if (lang !== 'he') return (await ask({ type: 'read', ink })).map((l) => l.text).filter((t) => t.trim());
  if (!languages().includes('he')) throw new Error('Hebrew handwriting is read in the Android app');
  onStatus = status;
  try {
    const lines = await ask({ type: 'lines', ink });
    const out = [];
    for (const line of lines) {
      // each stroke as [[x, y], …]
      const strokes = line.strokes.map((pts) => { const xy = []; for (let i = 0; i + 1 < pts.length; i += 3) xy.push([pts[i], pts[i + 1]]); return xy; });
      const text = await new Promise((resolve, reject) => {
        const id = `i${++seq}`;
        native.set(id, { resolve, reject });
        window.MosheInk.read(id, lang, JSON.stringify(strokes));
      });
      if (text.trim()) out.push(text);
    }
    return out;
  } finally { onStatus = null; }
}
