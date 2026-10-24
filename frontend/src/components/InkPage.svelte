<script>
  // A handwritten sheet's page (engine/ink.js): paper to write on with the pen,
  // as in a notebook, and nothing recognised or changed. It grows as you write.
  // Fingers scroll it, the pen writes, and its button erases; while the pen is
  // on or over the glass, a hand resting on it does nothing. (On a device with
  // no pen, "Fingers draw" lets a finger write; a mouse always does.) Each
  // stroke is saved a moment later, to the drawing (NAME.excalidraw.md, which
  // Obsidian's Excalidraw plugin opens too) and to its picture (NAME.svg, which
  // the sheet shows). The page itself is that picture, drawn as SVG and
  // scrolled by the browser; only the stroke being drawn is on a canvas.
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { theStorage, prefs, toast } from '../lib/state.svelte.js';
  import { readInkFile, writeInkFile, inkFromScene, sceneFromInk, inkSvg, pageHeight, emptyScene, PENS, PAPERS, PAGE_WIDTH } from '@engine/ink.js';
  import { radiusAt } from '@engine/sketch.js';

  let { inkPath, svgPath, typing = false, ontype = null } = $props();

  const SIZES = [2.5, 4.25, 8.5];               // across, in page units (Excalidraw's strokeWidth 0.6, 1, 2)
  const PALM_MS = 600;
  let items = $state.raw([]);
  let past = $state.raw([]), future = $state.raw([]);
  let pen = $state('ink'), size = $state(4.25), erasing = $state(false), paper = $state('lined'), fingers = $state(false);
  let state = $state('loading');                 // loading | ready | failed
  let scale = $state(1), viewH = $state(800);
  let wrap, scroller, page, canvas, ctx;
  let base = emptyScene(), prevText = null;
  let live = null, liveId = null, erased = false, penAt = 0;
  let saveTimer = null, saving = Promise.resolve();

  const svg = $derived(inkSvg(items, { paper, minHeight: Math.max(pageHeight(items) + 500, viewH / scale + 300) }));
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

  onMount(() => {
    load();
    const ro = new ResizeObserver(layout);
    ro.observe(wrap);
    // the pen's own touches never scroll the page; nor does a hand while the pen is near
    const touch = (e) => {
      if ([...e.changedTouches].some((t) => t.touchType === 'stylus')) { e.preventDefault(); return; }
      if (live || performance.now() - penAt < PALM_MS) e.preventDefault();
    };
    scroller.addEventListener('touchstart', touch, { passive: false });
    scroller.addEventListener('touchmove', touch, { passive: false });
    return () => { ro.disconnect(); scroller.removeEventListener('touchstart', touch); scroller.removeEventListener('touchmove', touch); flush(); };
  });

  async function load() {
    const s = theStorage();
    try {
      const r = s && (await s.read(inkPath).catch(() => null));
      prevText = r ? r.text : null;
      const got = readInkFile(prevText || '');
      base = got.scene;
      paper = got.paper || prefs.inkPaper || 'lined';
      items = inkFromScene(base);
      state = 'ready';
      layout();
      // drawn on elsewhere (the Excalidraw plugin): the picture made again
      if (prevText) {
        const pic = inkSvg(items, { paper });
        const old = await s.read(svgPath).catch(() => null);
        if (!old || old.text !== pic) { await s.write(svgPath, pic); redrawn(); }
      }
    } catch (e) { state = 'failed'; toast(`The handwriting could not be opened: ${e.message}`); }
  }

  function layout() {
    if (!wrap || !canvas) return;
    const w = wrap.clientWidth, h = wrap.clientHeight, dpr = window.devicePixelRatio || 1;
    scale = Math.min(1, Math.max(0.3, (w - 24) / PAGE_WIDTH));
    viewH = h;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx = canvas.getContext('2d', { desynchronized: true }) || canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---- drawing
  const r2 = (n) => Math.round(n * 100) / 100;
  /** A pointer's place on the page, in page units, with its pressure. */
  function at(e) {
    const r = page.getBoundingClientRect();
    return [r2((e.clientX - r.left) / scale), r2((e.clientY - r.top) / scale), e.pointerType === 'mouse' ? 0.5 : e.pressure || 0.5];
  }
  const record = () => { past = [...past.slice(-200), items]; future = []; };

  function eraseAt([x, y]) {
    const keep = items.filter((it) => it.kind !== 'stroke' || !it.points.some(([px, py, p]) => Math.hypot(px - x, py - y) <= radiusAt(it.marker ? { color: 'marker', size: it.size / 3.2 } : it, p) + 10));
    if (keep.length !== items.length) { if (!erased) { record(); erased = true; } items = keep; soon(); }
  }

  function down(e) {
    if (state !== 'ready') return;
    if (e.pointerType === 'pen') penAt = performance.now();
    else if (e.pointerType === 'touch' && (!fingers || performance.now() - penAt < PALM_MS)) return;   // fingers scroll
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    scroller.setPointerCapture(e.pointerId);
    liveId = e.pointerId;
    const p = at(e);
    if (erasing || (e.buttons & (2 | 32))) { live = 'erase'; erased = false; eraseAt(p); return; }
    const kind = PENS[pen];
    live = { kind: 'stroke', color: kind.color, marker: !!kind.marker, opacity: kind.opacity ?? 100, size: kind.marker ? size * 4 : size, points: [p] };
  }

  function move(e) {
    if (e.pointerType === 'pen') penAt = performance.now();             // hovering counts: the hand comes down next
    if (live == null || e.pointerId !== liveId) return;
    e.preventDefault();
    const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    const pr = page.getBoundingClientRect(), cr = canvas.getBoundingClientRect();
    for (const ev of list.length ? list : [e]) {
      const p = at(ev);
      if (live === 'erase') { eraseAt(p); continue; }
      const q = live.points[live.points.length - 1];
      live.points.push(p);
      // as it's drawn: a segment at a time, on the canvas over the page
      const sx = (v) => pr.left - cr.left + v * scale, sy = (v) => pr.top - cr.top + v * scale;
      ctx.save();
      ctx.strokeStyle = live.color;
      ctx.globalAlpha = live.marker ? 0.3 : 1;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1, (live.marker ? live.size : radiusAt(live, p[2]) * 2) * scale);
      ctx.beginPath(); ctx.moveTo(sx(q[0]), sy(q[1])); ctx.lineTo(sx(p[0]), sy(p[1])); ctx.stroke();
      ctx.restore();
    }
  }

  function up(e) {
    if (live == null || e.pointerId !== liveId) return;
    if (live !== 'erase') { record(); items = [...items, live]; soon(); }
    live = null; liveId = null; erased = false;
    penAt = e.pointerType === 'pen' ? performance.now() : penAt;
    requestAnimationFrame(() => ctx && ctx.clearRect(0, 0, canvas.width, canvas.height));
  }

  function undo() { if (!past.length) return; future = [items, ...future]; items = past[past.length - 1]; past = past.slice(0, -1); soon(); }
  function redo() { if (!future.length) return; past = [...past, items]; items = future[0]; future = future.slice(1); soon(); }

  // ---- saving: the drawing and its picture, a moment after the last stroke
  function soon() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 700); }
  function flush() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; save(); } }
  function save() {
    saveTimer = null;
    const now = items, pp = paper;
    saving = saving.then(async () => {
      const s = theStorage();
      const scene = sceneFromInk(now, base);
      now.forEach((it, i) => { if (it.kind === 'stroke' && !it.el) it.el = scene.elements[i]; });   // the same element next time
      const text = writeInkFile(prevText, scene, { paper: pp });
      await s.write(inkPath, text);
      prevText = text;
      base = scene;
      await s.write(svgPath, inkSvg(now, { paper: pp }));
      redrawn();
    }).catch((err) => toast(`The handwriting could not be saved: ${err.message}`));
    return saving;
  }
  /** The sheet's picture of this page has changed: the editor shows it anew. */
  const redrawn = () => window.dispatchEvent(new CustomEvent('moshe:redrawn', { detail: svgPath }));

  function setPaper(p) { paper = p; prefs.inkPaper = p; soon(); }

  function key(e) {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z' && !(document.activeElement && document.activeElement.closest('.cm-editor'))) {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    }
  }
</script>

<svelte:window onkeydown={key} />

<div class="ink" bind:this={wrap}>
  <div class="tools popover" role="toolbar" aria-label="Pens">
    {#each Object.entries(PENS) as [name, p]}
      <button class="pen" class:on={!erasing && pen === name} class:marker={!!p.marker} title={p.label} aria-label={p.label} aria-pressed={!erasing && pen === name}
        style="--ink:{p.color}" onclick={() => { pen = name; erasing = false; }}><i></i></button>
    {/each}
    <span class="sep"></span>
    {#each SIZES as s}
      <button class="size" class:on={!erasing && size === s} title="Size" aria-label="Size {s}" aria-pressed={!erasing && size === s} onclick={() => { size = s; erasing = false; }}><i style="--d:{3 + s * 1.3}px"></i></button>
    {/each}
    <button class="tool" class:on={erasing} title="Eraser (or hold the pen's button)" aria-label="Eraser" aria-pressed={erasing} onclick={() => (erasing = !erasing)}><Icon name="eraser" size={18} /></button>
    <span class="sep"></span>
    <button class="tool" title="Undo" aria-label="Undo" disabled={!past.length} onclick={undo}><Icon name="undo-2" size={18} /></button>
    <button class="tool" title="Redo" aria-label="Redo" disabled={!future.length} onclick={redo}><Icon name="redo-2" size={18} /></button>
    <span class="sep"></span>
    <select class="paper" aria-label="Paper" value={paper} onchange={(e) => setPaper(e.currentTarget.value)}>
      {#each PAPERS as p}<option value={p}>{p[0].toUpperCase() + p.slice(1)}</option>{/each}
    </select>
    {#if coarse}<button class="tool" class:on={fingers} title="Fingers draw (off: fingers scroll)" aria-label="Fingers draw" aria-pressed={fingers} onclick={() => (fingers = !fingers)}><Icon name="hand" size={18} /></button>{/if}
    {#if ontype}<button class="type" class:on={typing} onclick={ontype}>{typing ? 'Done Typing' : 'Type It Up'}</button>{/if}
  </div>
  <div class="scroll" bind:this={scroller} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} role="application" aria-label="The page">
    <div class="page" bind:this={page} style="width:{PAGE_WIDTH * scale}px">{@html svg}</div>
  </div>
  <canvas bind:this={canvas} aria-hidden="true"></canvas>
  {#if state === 'loading'}<p class="hint">Opening the page…</p>{/if}
</div>

<style>
  .ink { position: relative; height: 100%; overflow: hidden; background: var(--sidebar-bg); }
  .scroll { position: absolute; inset: 0; overflow-y: auto; overflow-x: hidden; touch-action: pan-y; padding: 108px 12px 40vh; cursor: crosshair; }
  .page { margin: 0 auto; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12); background: #fdfcf8; }
  .page :global(svg) { display: block; width: 100%; height: auto; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  /* the tools in a row over the page, and in two when the page is narrow: Type It Up never out of sight */
  .tools { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); z-index: 3; display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 2px; padding: 4px 8px;
    width: max-content; max-width: calc(100% - 16px); border-radius: 12px; background: var(--hud-bg, var(--popover-bg)); }
  .pen, .size, .tool { flex: none; width: 36px; height: 36px; border: 0; border-radius: 8px; background: none; display: flex; align-items: center; justify-content: center; color: var(--text); padding: 0; }
  .on { background: var(--sel-grey); }
  .tool:disabled { opacity: 0.35; }
  .pen i { width: 18px; height: 18px; border-radius: 50%; background: var(--ink); box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15); }
  .pen.marker i { border-radius: 4px; width: 12px; height: 20px; opacity: 0.8; }
  .size i { width: var(--d); height: var(--d); border-radius: 50%; background: var(--text); }
  .sep { flex: none; width: 1px; height: 22px; background: var(--sep); margin: 0 4px; }
  .paper { flex: none; height: 30px; border: 1px solid var(--sep); border-radius: 7px; background: var(--input-bg, transparent); color: var(--text); font-size: 13px; padding: 0 6px; }
  .type { flex: none; margin-left: 6px; height: 30px; padding: 0 12px; border: 0; border-radius: 7px; background: var(--accent); color: var(--on-accent); font-size: 13px; font-weight: 600; white-space: nowrap; }
  .type.on { background: var(--sel-grey); color: var(--text); }
  .hint { position: absolute; top: 45%; left: 0; right: 0; text-align: center; color: var(--muted); margin: 0; pointer-events: none; }
</style>
