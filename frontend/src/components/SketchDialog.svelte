<script>
  // Insert › Sketch: a sheet of paper to draw on with the pen (a finger or a
  // mouse will do), its strokes as wide as the pen presses. Done hands back
  // the strokes and their SVG (engine/sketch.js); the editor saves the picture
  // beside the sheet. Once a pen has touched it, fingers are the hand resting
  // on the paper, and draw nothing. The pen's button erases while held.
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { INKS, PAPER, strokeShape, radiusAt, sketchSvg } from '@engine/sketch.js';

  let { dialog } = $props();

  const SIZES = [2, 4, 8];
  let strokes = $state.raw((dialog.strokes || []).map((s) => ({ ...s, points: s.points.map(([x, y, p]) => [x + 40, y + 40, p]) })));
  let past = $state.raw([]), future = $state.raw([]);
  let color = $state('ink'), size = $state(4), erasing = $state(false);
  let paper, canvas, ctx, dpr = 1;
  let live = null, liveId = null, erased = null, penSeen = false;

  onMount(() => {
    size_();
    const ro = new ResizeObserver(size_);
    ro.observe(paper);
    return () => ro.disconnect();
  });

  function size_() {
    if (!paper || !canvas) return;
    dpr = window.devicePixelRatio || 1;
    const r = paper.getBoundingClientRect();
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx = canvas.getContext('2d', { desynchronized: true }) || canvas.getContext('2d');
    redraw();
  }

  function paint(s) {
    const { d, caps } = strokeShape(s);
    ctx.save();
    ctx.fillStyle = INKS[s.color] || INKS.ink;
    if (s.color === 'marker') ctx.globalAlpha = 0.45;
    const p = new Path2D(d || undefined);
    for (const [x, y, r] of caps) { p.moveTo(x + r, y); p.arc(x, y, r, 0, Math.PI * 2); }
    ctx.fill(p);
    ctx.restore();
  }

  function redraw() {
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of strokes) paint(s);
  }

  const at = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top, e.pointerType === 'mouse' ? 0.5 : e.pressure || 0.5]; };
  const record = () => { past = [...past, strokes]; future = []; };

  function eraseAt([x, y]) {
    const keep = strokes.filter((s) => !s.points.some(([px, py, p]) => Math.hypot(px - x, py - y) <= radiusAt(s, p) + 8));
    if (keep.length !== strokes.length) { if (!erased) { record(); erased = true; } strokes = keep; redraw(); }
  }

  function down(e) {
    if (e.pointerType === 'pen') penSeen = true;
    else if (e.pointerType === 'touch' && penSeen) return;          // the hand, not the pen
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    liveId = e.pointerId;
    if (erasing || (e.buttons & (2 | 32))) { erased = false; live = 'erase'; eraseAt(at(e)); return; }
    live = { color, size, points: [at(e)] };
  }

  function move(e) {
    if (live == null || e.pointerId !== liveId) return;
    e.preventDefault();
    const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ev of list.length ? list : [e]) {
      const p = at(ev);
      if (live === 'erase') { eraseAt(p); continue; }
      const q = live.points[live.points.length - 1];
      live.points.push(p);
      // as it's drawn: a segment at a time (the whole stroke is painted properly when it's done)
      ctx.save();
      ctx.strokeStyle = INKS[live.color];
      if (live.color === 'marker') ctx.globalAlpha = 0.25;
      ctx.lineCap = 'round';
      ctx.lineWidth = radiusAt(live, p[2]) * 2;
      ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
      ctx.restore();
    }
  }

  function up(e) {
    if (live == null || e.pointerId !== liveId) return;
    if (live !== 'erase') { record(); strokes = [...strokes, live]; }
    live = null; liveId = null; erased = null;
    redraw();
  }

  function undo() { if (!past.length) return; future = [strokes, ...future]; strokes = past[past.length - 1]; past = past.slice(0, -1); redraw(); }
  function redo() { if (!future.length) return; past = [...past, strokes]; strokes = future[0]; future = future.slice(1); redraw(); }
  function clearAll() { if (!strokes.length) return; record(); strokes = []; redraw(); }

  function done() {
    const svg = sketchSvg(strokes);
    dialog.resolve(svg ? { svg } : null);
  }

  function key(e) {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape') { e.preventDefault(); dialog.resolve(null); }
    else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (mod && e.key === 'Enter') { e.preventDefault(); done(); }
  }
</script>

<svelte:window onkeydown={key} />

<div class="overlay" role="presentation">
  <div class="win popover" role="dialog" aria-label="Sketch">
    <div class="bar">
      <div class="inks" role="radiogroup" aria-label="Ink">
        {#each Object.keys(INKS) as c}
          <button class="ink" class:on={!erasing && color === c} role="radio" aria-checked={!erasing && color === c} aria-label={c === 'marker' ? 'Marker' : c[0].toUpperCase() + c.slice(1)}
            style="--ink:{INKS[c]}" class:marker={c === 'marker'} onclick={() => { color = c; erasing = false; }}><i></i></button>
        {/each}
      </div>
      <div class="sizes" role="radiogroup" aria-label="Size">
        {#each SIZES as s}
          <button class="size" class:on={!erasing && size === s} role="radio" aria-checked={!erasing && size === s} aria-label="Size {s}" onclick={() => { size = s; erasing = false; }}><i style="--d:{4 + s * 1.6}px"></i></button>
        {/each}
      </div>
      <button class="tool" class:on={erasing} aria-pressed={erasing} title="Eraser (or hold the pen's button)" onclick={() => (erasing = !erasing)}><Icon name="eraser" size={18} /></button>
      <span class="sep"></span>
      <button class="tool" title="Undo" aria-label="Undo" disabled={!past.length} onclick={undo}><Icon name="undo-2" size={18} /></button>
      <button class="tool" title="Redo" aria-label="Redo" disabled={!future.length} onclick={redo}><Icon name="redo-2" size={18} /></button>
      <button class="tool" title="Clear" aria-label="Clear" disabled={!strokes.length} onclick={clearAll}><Icon name="trash-2" size={18} /></button>
      <span class="grow"></span>
      <button class="btn" onclick={() => dialog.resolve(null)}>Cancel</button>
      <button class="btn primary" onclick={done}>Done</button>
    </div>
    <div class="paper" bind:this={paper} style="--paper:{PAPER}">
      <canvas bind:this={canvas} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} aria-label="The sketch"></canvas>
      {#if !strokes.length}<p class="hint">Draw with the pen. Fingers rest on the paper without drawing.</p>{/if}
    </div>
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; background: var(--overlay); z-index: 60; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .win { position: relative; width: min(1100px, 100%); height: min(760px, 100%); display: flex; flex-direction: column; overflow: hidden; }
  .bar { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--sep); flex-wrap: wrap; }
  .inks, .sizes { display: flex; gap: 4px; }
  .ink, .size, .tool { width: 34px; height: 34px; border: 0; border-radius: 8px; background: none; display: flex; align-items: center; justify-content: center; color: var(--text); padding: 0; }
  .ink.on, .size.on, .tool.on { background: var(--sel-grey); }
  .tool:disabled { opacity: 0.35; }
  .ink i { width: 18px; height: 18px; border-radius: 50%; background: var(--ink); box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15); }
  .ink.marker i { border-radius: 4px; width: 12px; height: 20px; opacity: 0.8; }
  .size i { width: var(--d); height: var(--d); border-radius: 50%; background: var(--text); }
  .sep { width: 1px; height: 22px; background: var(--sep); }
  .grow { flex: 1; }
  .paper { position: relative; flex: 1; min-height: 0; background: var(--paper); }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; cursor: crosshair; }
  .hint { position: absolute; left: 0; right: 0; top: 45%; text-align: center; color: #9a958a; font-size: 14px; pointer-events: none; margin: 0; }
  @media (max-width: 760px) { .overlay { padding: 0; } .win { width: 100%; height: 100%; border-radius: 0; } }
</style>
