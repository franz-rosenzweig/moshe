<script>
  // A handwritten sheet's page (engine/ink.js): paper to write on with the pen,
  // as in a notebook, and nothing recognised or changed. It works the way
  // Samsung Notes does: seven pens and a highlighter, an eraser that takes
  // whole strokes or just what it passes over, the lasso to move, resize, copy
  // and restyle what's written, the page's colour, paper and view (one long
  // page, or pages), reading mode, pinching to zoom, and the S Pen's button:
  // held down it erases, and pressed with the pen over the glass it opens the
  // round pen menu. Fingers scroll and pinch and never write (unless "Fingers
  // write" is on); while the pen is on or over the glass a resting hand does
  // nothing. Each change is saved a moment later, to the drawing
  // (NAME.excalidraw.md, which Obsidian's Excalidraw plugin opens too) and to
  // its picture (NAME.svg, which the sheet shows). The page is SVG, a path a
  // stroke; only the stroke being drawn is on a canvas over it.
  import { onMount, tick, untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import InkTools from './InkTools.svelte';
  import InkSample from './InkSample.svelte';
  import InkRadial from './InkRadial.svelte';
  import { app, theStorage, prefs, toast, persist } from '../lib/state.svelte.js';
  import { tools, brush, used, clipboard, suitPens, WRITING } from '../lib/ink-tools.svelte.js';
  import { readInkFile, writeInkFile, inkFromScene, sceneFromInk, inkSvg, pageHeight, pageSize, paperSvg, strokePath, paintOf, othersSvg, layersOf,
    boundsOf, lassoed, transformed, touches, eraseArea, copies, snapShape, isDark, across, emptyScene, GRAIN, COLORS, PEN_TYPES, PAGE_WIDTH, PAGE_HEIGHT, PAGE_GAP, PAPER_COLOR } from '@engine/ink.js';

  let { inkPath, svgPath, typing = false, ontype = null } = $props();

  const PALM_MS = 600;
  const ZOOM = [0.5, 4];
  let items = $state.raw([]);
  let past = $state.raw([]), future = $state.raw([]);
  let page = $state.raw({ paper: 'lined', color: PAPER_COLOR, view: 'scroll', pages: 1 });
  let status = $state('loading');                // loading | ready | failed
  let fit = $state(1), zoom = $state(1), viewH = $state(800);
  let reading = $state(false), panel = $state(null), pinching = $state(false);
  let chosen = $state.raw(new Set());             // the strokes the lasso holds
  let drag = $state.raw(null);                    // moving or resizing them: x' = a·x + c, y' = d·y + f
  let styling = $state(false);                    // the lasso's Change Style
  let radial = $state(null);                      // the round pen menu, at {x, y}
  let ring = $state(null);                        // the pen over the glass: {x, y, r}
  let pasteAt = $state(null);                     // a tap with the lasso: Paste here, at [x, y]
  let wrap, scroller, pageEl, canvas, ctx;
  let base = emptyScene(), prevText = null;
  let live = null, liveId = null, liveType = null, erased = false, penAt = 0, penDownAt = 0, penButton = false, pinch = null;
  let saveTimer = null, saving = Promise.resolve();
  let holdTimer = null, holdAt = null;           // a stroke held still at its end: made a clean shape

  const k = $derived(fit * zoom);                 // screen pixels to a page unit
  const size = $derived(page.view === 'pages' ? pageSize(items, { view: 'pages', pages: page.pages })
    : { h: Math.ceil(Math.max(pageHeight(items) + 500, viewH / k + 300)), pages: 1 });
  const dark = $derived(isDark(page.color));
  const paperMarkup = $derived(paperSvg(page.paper, PAGE_WIDTH, size.h, { color: page.color, view: page.view, pages: size.pages }));
  const layers = $derived(layersOf(items));
  const held = $derived(chosen.size ? items.filter((it) => chosen.has(it)) : []);
  const heldBox = $derived.by(() => {
    const b = held.length && boundsOf(held);
    if (!b) return null;
    const m = drag || { a: 1, d: 1, c: 0, f: 0 }, pad = 8;
    return { x0: m.a * b.x0 + m.c - pad, y0: m.d * b.y0 + m.f - pad, x1: m.a * b.x1 + m.c + pad, y1: m.d * b.y1 + m.f + pad };
  });
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

  // a stroke's shape and bounds, worked out once (a stroke is never changed, only replaced)
  const paths = new WeakMap(), boxes = new WeakMap();
  const pathOf = (it) => { let d = paths.get(it); if (d == null) { d = strokePath(it); paths.set(it, d); } return d; };
  const boxOf = (it) => { let b = boxes.get(it); if (!b) { b = boundsOf([it]); boxes.set(it, b); } return b; };
  const near = (it, x, y, r) => { const b = boxOf(it); return !!b && x >= b.x0 - r && x <= b.x1 + r && y >= b.y0 - r && y <= b.y1 + r; };
  const moved = (it) => (drag && chosen.has(it) ? `matrix(${drag.a} 0 0 ${drag.d} ${drag.c} ${drag.f})` : undefined);

  onMount(() => {
    load();
    const ro = new ResizeObserver(layout);
    ro.observe(wrap);
    scroller.addEventListener('touchstart', touch, { passive: false });
    scroller.addEventListener('touchmove', touch, { passive: false });
    scroller.addEventListener('touchend', touch, { passive: false });
    scroller.addEventListener('touchcancel', touch, { passive: false });
    scroller.addEventListener('wheel', wheel, { passive: false });
    // the S Pen's button, for a shell that hears it when the browser doesn't
    window.mosheStylusButton = (x, y) => openRadial(x, y);
    return () => {
      ro.disconnect();
      for (const t of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) scroller.removeEventListener(t, touch);
      scroller.removeEventListener('wheel', wheel);
      delete window.mosheStylusButton;
      flush();
    };
  });

  // focus mode, and the bars gone again: so are their panels
  $effect(() => { if (app.interfaceHidden && !app.chrome) untrack(() => { panel = null; }); });

  // another tool in hand: the lasso lets go
  $effect(() => { tools.tool; untrack(() => { if (chosen.size) chosen = new Set(); pasteAt = null; }); });

  async function load() {
    const s = theStorage();
    try {
      const r = s && (await s.read(inkPath).catch(() => null));
      prevText = r ? r.text : null;
      const got = readInkFile(prevText || '');
      base = got.scene;
      const bg = !got.paper && base.appState && /^#[0-9a-f]{6}$/iu.test(base.appState.viewBackgroundColor || '') ? base.appState.viewBackgroundColor : null;
      page = { paper: got.paper || prefs.inkPaper || 'lined', color: got.color || bg || PAPER_COLOR, view: got.view || 'scroll', pages: got.pages || 1 };
      suitPens(isDark(page.color));
      items = inkFromScene(base);
      status = 'ready';
      layout();
      // drawn on elsewhere (the Excalidraw plugin), or by an older Moshe: the picture made again
      if (prevText) {
        const pic = picture(items, page);
        const old = await s.read(svgPath).catch(() => null);
        if (!old || old.text !== pic) { await s.write(svgPath, pic); redrawn(); }
      }
    } catch (e) { status = 'failed'; toast(`The handwriting could not be opened: ${e.message}`); }
  }

  function layout() {
    if (!wrap || !canvas) return;
    const w = wrap.clientWidth, h = wrap.clientHeight, dpr = window.devicePixelRatio || 1;
    fit = Math.min(1, Math.max(0.3, (w - 24) / PAGE_WIDTH));
    viewH = h;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx = canvas.getContext('2d', { desynchronized: true }) || canvas.getContext('2d');
  }

  // ---- the pen
  const r2 = (n) => Math.round(n * 100) / 100;
  /** A pointer's place on the page, in page units, with its pressure. */
  function at(e, r = pageEl.getBoundingClientRect()) {
    return [r2((e.clientX - r.left) / k), r2((e.clientY - r.top) / k), e.pointerType === 'mouse' ? 0.5 : e.pressure || 0.5];
  }
  const record = () => { past = [...past.slice(-200), { items, page }]; future = []; };
  const erasing = (e) => tools.tool === 'eraser' || !!(e.buttons & (2 | 32));

  function down(e) {
    if (status !== 'ready' || radial || pinch) return;
    const pen = e.pointerType === 'pen';
    if (pen) penAt = performance.now();
    // the pen's button pressed with the pen over the glass, told as a press of its own: the round menu
    if (pen && e.button === 2 && !(e.buttons & 1)) { e.preventDefault(); penButton = true; openRadial(e.clientX, e.clientY); return; }
    if (e.pointerType === 'touch' && (!tools.fingers || reading || performance.now() - penAt < PALM_MS)) return;   // fingers scroll
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    panel = null; pasteAt = null; styling = false;
    scroller.setPointerCapture(e.pointerId);
    liveId = e.pointerId; liveType = e.pointerType;
    if (pen) penDownAt = performance.now();
    if (reading) { live = { kind: 'pan', x: e.clientX, y: e.clientY, left: scroller.scrollLeft, top: scroller.scrollTop }; return; }
    const p = at(e);
    if (erasing(e)) { live = { kind: 'erase', last: p }; erased = false; eraseAt(p, p); showRing(e); return; }
    ring = null;
    if (tools.tool === 'lasso') { if (chosen.size) chosen = new Set(); live = { kind: 'lasso', points: [p] }; return; }
    const b = brush();
    live = { kind: 'stroke', ...b, points: [p] };
    canvas.style.mixBlendMode = b.pen === 'highlighter' ? (dark ? 'screen' : 'multiply') : 'normal';
    holding(e);
    drawLive();
  }

  function move(e) {
    if (e.pointerType === 'pen') {
      penAt = performance.now();                                         // over the glass counts: the hand comes down next
      const button = !!(e.buttons & (2 | 32));
      if (!(e.buttons & 1)) {
        if (button && !penButton && !live && !radial) openRadial(e.clientX, e.clientY);
        if (!live) showRing(e);
      } else penDownAt = penAt;
      penButton = button;
    } else if (e.pointerType === 'mouse' && !live) showRing(e);
    if (live == null || e.pointerId !== liveId) return;
    e.preventDefault();
    if (live.kind === 'pan') { scroller.scrollLeft = live.left - (e.clientX - live.x); scroller.scrollTop = live.top - (e.clientY - live.y); return; }
    const r = pageEl.getBoundingClientRect();
    if (live.kind === 'grab') { drag = matrixFor(live, at(e, r)); return; }
    // every sample the pen took since the last frame (not the ones it guesses ahead: they're wrong at every turn)
    const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ev of list.length ? list : [e]) {
      const p = at(ev, r);
      if (live.kind === 'erase') { eraseAt(live.last, p); live.last = p; } else if (!live.snapped) live.points.push(p);
    }
    if (live.kind === 'erase') showRing(e);
    else { if (live.kind === 'stroke') holding(e); drawLive(); }
  }

  /** The pen kept still (a few pixels' wobble aside) for a moment at the end of a stroke: the stroke made a clean shape. */
  function holding(e) {
    if (holdAt && Math.hypot(e.clientX - holdAt.x, e.clientY - holdAt.y) < 5) return;
    holdAt = { x: e.clientX, y: e.clientY };
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      if (!live || live.kind !== 'stroke' || live.snapped) return;
      const shape = snapShape(live.points);
      if (!shape) return;
      live.points = shape; live.snapped = true;
      if (navigator.vibrate) navigator.vibrate(8);
      drawLive();
    }, 600);
  }

  function up(e) {
    if (live == null || e.pointerId !== liveId) return;
    const l = live;
    live = null; liveId = null;
    clearTimeout(holdTimer); holdAt = null;
    if (l.kind === 'stroke') {
      record();
      items = [...items, { kind: 'stroke', pen: l.pen, color: l.color, width: l.width, opacity: l.opacity, points: l.points }];
      if (l.pen !== 'highlighter') used(l.color);
      soon();
    } else if (l.kind === 'lasso') {
      const b = boundsOf([{ kind: 'stroke', width: 0, points: l.points }]);
      if (b.x1 - b.x0 < 8 && b.y1 - b.y0 < 8) { if (clipboard.items) pasteAt = l.points[0].slice(0, 2); }   // a tap
      else chosen = new Set(lassoed(items, l.points));
    } else if (l.kind === 'grab') commit();
    erased = false;
    if (e.pointerType === 'pen') { penAt = performance.now(); penDownAt = penAt; }
    requestAnimationFrame(clearLive);
  }

  /** The stroke being drawn, on the canvas over the page, as it will be on it. */
  function drawLive() {
    if (!ctx || !live) return;
    const r = pageEl.getBoundingClientRect(), c = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (r.left - c.left), dpr * (r.top - c.top));
    if (live.kind === 'stroke') {
      const p = paintOf(live);
      ctx.globalAlpha = p.opacity * (p.grain ? 0.8 : 1);
      ctx.fillStyle = p.color;
      ctx.fill(new Path2D(strokePath(live)));
    } else if (live.kind === 'lasso') {
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.5 / k;
      ctx.setLineDash([6 / k, 5 / k]);
      ctx.strokeStyle = dark ? '#ffffff' : '#1971c2';
      ctx.beginPath();
      live.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  function clearLive() {
    if (!ctx || (live && live.kind !== 'erase')) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  /** The pen over the glass, as a ring the size of what it would write or erase. */
  function showRing(e) {
    const er = erasing(e);
    if (e.pointerType === 'mouse' && !er) { ring = null; return; }
    const b = brush(), c = wrap.getBoundingClientRect();
    const r = er ? (tools.eraser.size / 2) * k : b ? Math.max(2, (b.width / 2) * k) : 3;
    ring = { x: e.clientX - c.left, y: e.clientY - c.top, r, erase: er };
  }

  // ---- the eraser
  function eraseAt(a, b) {
    const r = tools.eraser.size / 2, takes = tools.eraser.takes, whole = tools.eraser.mode === 'stroke';
    const can = (it) => it.kind === 'stroke' && (takes === 'all' || (takes === 'highlighter') === (it.pen === 'highlighter'));
    // every half radius along the way, so a quick sweep misses nothing
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (r / 2)));
    let next = items, changed = false;
    for (let i = a === b ? n : 1; i <= n; i++) {
      const x = a[0] + ((b[0] - a[0]) * i) / n, y = a[1] + ((b[1] - a[1]) * i) / n;
      const hit = next.filter((it) => can(it) && near(it, x, y, r) && touches(it, x, y, r));
      if (!hit.length) continue;
      changed = true;
      const set = new Set(hit);
      next = whole ? next.filter((it) => !set.has(it)) : next.flatMap((it) => (set.has(it) ? eraseArea([it], x, y, r) : [it]));
    }
    if (!changed) return;
    if (!erased) { record(); erased = true; }
    items = next;
    soon();
  }

  function eraseAll() {
    if (!items.length) return;
    record();
    items = items.filter((it) => it.kind !== 'stroke');
    soon();
    toast('The page is erased. Undo brings it back.');
  }

  // ---- the lasso: what it holds moved, resized, copied, restyled
  const grab = (what) => (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    scroller.setPointerCapture(e.pointerId);
    liveId = e.pointerId; liveType = e.pointerType; styling = false;
    const b = boundsOf(held);
    live = { kind: 'grab', what, start: at(e), box: b };
    drag = { a: 1, d: 1, c: 0, f: 0 };
  };

  function matrixFor({ what, start, box }, p) {
    if (what === 'move') return { a: 1, d: 1, c: p[0] - start[0], f: p[1] - start[1] };
    // a corner pulled: the corner across from it stays put, and the strokes keep their shape
    const ox = what.includes('w') ? box.x1 : box.x0, oy = what.includes('n') ? box.y1 : box.y0;
    const cx = what.includes('w') ? box.x0 : box.x1, cy = what.includes('n') ? box.y0 : box.y1;
    const qx = p[0] - start[0] + cx - ox, qy = p[1] - start[1] + cy - oy, vx = cx - ox, vy = cy - oy;
    const s = Math.max(0.1, (qx * vx + qy * vy) / (vx * vx + vy * vy || 1));
    return { a: s, d: s, c: ox - s * ox, f: oy - s * oy };
  }

  function commit() {
    const m = drag;
    drag = null;
    if (!m || (m.a === 1 && Math.abs(m.c) < 0.5 && Math.abs(m.f) < 0.5)) return;
    const was = held, now = transformed(was, m);
    replace(was, now);
  }
  /** Some strokes replaced by others, in their places, as one step of Undo, and the lasso holding the new ones. */
  function replace(was, now) {
    const map = new Map(was.map((it, i) => [it, now[i]]));
    record();
    items = items.map((it) => map.get(it) || it);
    chosen = new Set(now);
    soon();
  }
  const keepId = (it) => ({ ...it, el: undefined, id: it.id || (it.el && it.el.id), version: it.el ? it.el.version : it.version });

  function copyHeld() { if (held.length) { clipboard.items = copies(held); toast(held.length === 1 ? 'Copied the stroke' : `Copied ${held.length} strokes`); } }
  function deleteHeld() { if (!held.length) return; record(); items = items.filter((it) => !chosen.has(it)); chosen = new Set(); soon(); }
  function cutHeld() { copyHeld(); deleteHeld(); }
  function duplicateHeld() { if (!held.length) return; const c = copies(held, 30, 30); record(); items = [...items, ...c]; chosen = new Set(c); soon(); }
  function restyle(patch) {
    if (!held.length) return;
    replace(held, held.map((it) => ({ ...keepId(it), ...(patch.color ? { color: patch.color } : {}), ...(patch.pen ? { pen: patch.pen } : {}), ...(patch.scale ? { width: Math.max(0.5, it.width * patch.scale) } : {}) })));
  }
  /** What was copied, put on the page: where the lasso tapped, or in the middle of what's on the screen. */
  function paste(where = null) {
    if (!clipboard.items) return;
    const b = boundsOf(clipboard.items);
    let x = where && where[0], y = where && where[1];
    if (!where) {
      const r = pageEl.getBoundingClientRect(), s = scroller.getBoundingClientRect();
      x = ((s.left + s.width / 2 - r.left) / k) - (b.x1 - b.x0) / 2;
      y = ((s.top + s.height / 2 - r.top) / k) - (b.y1 - b.y0) / 2;
    }
    const c = copies(clipboard.items, x - b.x0, y - b.y0);
    record();
    items = [...items, ...c];
    pasteAt = null;
    if (tools.tool !== 'lasso') tools.tool = 'lasso';
    tick().then(() => { chosen = new Set(c); });
    soon();
  }

  // ---- the S Pen's button: the round pen menu
  function openRadial(x, y) {
    if (radial || status !== 'ready') return;
    panel = null; ring = null;
    radial = { x, y };
  }

  // ---- fingers: palm, pinch
  const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  const mid = (a, b) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });
  const clampZoom = (z) => Math.min(ZOOM[1], Math.max(ZOOM[0], z));

  function touch(e) {
    // the pen's own touches never scroll the page
    if ([...e.changedTouches].some((t) => t.touchType === 'stylus')) { if (e.cancelable) e.preventDefault(); return; }
    const t = [...e.touches].filter((x) => x.touchType !== 'stylus');
    if (pinch) {
      if (e.cancelable) e.preventDefault();
      if (t.length >= 2) movePinch(t[0], t[1]); else endPinch();
      return;
    }
    // two fingers down, and the pen not writing: pinching (a finger's stroke begun is no stroke after all)
    if (e.type === 'touchstart' && t.length === 2 && performance.now() - penDownAt > 400 && !(live && liveType !== 'touch')) {
      if (live && liveType === 'touch') { if (live.kind === 'grab') drag = null; live = null; liveId = null; clearLive(); }
      if (e.cancelable) e.preventDefault();
      startPinch(t[0], t[1]);
      return;
    }
    // a hand resting on the glass while the pen writes, or just after: nothing
    if ((e.type === 'touchstart' || e.type === 'touchmove') && (live || performance.now() - penAt < PALM_MS) && e.cancelable) e.preventDefault();
  }

  function startPinch(a, b) {
    const r = pageEl.getBoundingClientRect();
    pinch = { d0: dist(a, b), m0: mid(a, b), m: mid(a, b), left: r.left, top: r.top, ratio: 1 };
    pinching = true;
  }
  function movePinch(a, b) {
    const m = mid(a, b);
    const ratio = clampZoom(zoom * (dist(a, b) / pinch.d0)) / zoom;
    // the page under the fingers stays under them: a transform while they move, the real zoom when they lift
    const tx = m.x - pinch.left - (pinch.m0.x - pinch.left) * ratio, ty = m.y - pinch.top - (pinch.m0.y - pinch.top) * ratio;
    pageEl.style.transform = `translate(${tx}px, ${ty}px) scale(${ratio})`;
    pinch.ratio = ratio; pinch.m = m;
  }
  async function endPinch() {
    const { ratio, m0, m, left, top } = pinch;
    pinch = null;
    const P = [(m0.x - left) / k, (m0.y - top) / k];
    pageEl.style.transform = '';
    pinching = false;
    await zoomTo(zoom * ratio, P, m);
  }
  /** Zoomed, keeping the page's point P under the screen's point m. */
  async function zoomTo(z, P, m) {
    zoom = Math.abs(clampZoom(z) - 1) < 0.04 ? 1 : clampZoom(z);
    await tick();
    const r = pageEl.getBoundingClientRect();
    scroller.scrollLeft += r.left - (m.x - P[0] * k);
    scroller.scrollTop += r.top - (m.y - P[1] * k);
  }
  function wheel(e) {
    if (!e.ctrlKey && !e.metaKey) return;                              // a trackpad's pinch, or Ctrl and the wheel
    e.preventDefault();
    const r = pageEl.getBoundingClientRect();
    zoomTo(zoom * Math.exp(-e.deltaY * 0.01), [(e.clientX - r.left) / k, (e.clientY - r.top) / k], { x: e.clientX, y: e.clientY });
  }
  function zoomFit() {
    const s = scroller.getBoundingClientRect(), r = pageEl.getBoundingClientRect();
    zoomTo(1, [PAGE_WIDTH / 2, (s.top + s.height / 2 - r.top) / k], { x: s.left + s.width / 2, y: s.top + s.height / 2 });
  }

  // ---- history
  function undo() {
    if (!past.length) return;
    future = [{ items, page }, ...future];
    ({ items, page } = past[past.length - 1]);
    past = past.slice(0, -1); chosen = new Set(); soon();
  }
  function redo() {
    if (!future.length) return;
    past = [...past, { items, page }];
    ({ items, page } = future[0]);
    future = future.slice(1); chosen = new Set(); soon();
  }

  // ---- the page's own settings
  function setPage(patch) {
    if (patch.default) {
      prefs.inkPaper = page.paper; prefs.inkColor = page.color; prefs.inkView = page.view;
      persist();
      toast('New pages will start like this one');
      return;
    }
    const was = dark;
    record();
    page = { ...page, ...patch };
    if (patch.pages) page = { ...page, pages: Math.max(patch.pages, size.pages + (patch.pages > page.pages ? 0 : 1)) };
    // black ink turns white on a dark page, and back
    if (isDark(page.color) !== was) {
      const from = was ? '#ffffff' : '#1e1e1e', to = was ? '#1e1e1e' : '#ffffff';
      items = items.map((it) => (it.kind === 'stroke' && it.color.toLowerCase() === from ? { ...keepId(it), color: to } : it));
      suitPens(!was);
    }
    soon();
  }
  function addPage() {
    record();
    page = { ...page, pages: size.pages + 1 };
    soon();
    tick().then(() => scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' }));
  }

  // ---- saving: the drawing and its picture, a moment after the last change
  const picture = (now, pg) => inkSvg(now, { paper: pg.paper, color: pg.color, view: pg.view, pages: pg.pages });
  function soon() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 700); }
  function flush() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; save(); } }
  function save() {
    saveTimer = null;
    const now = items, pg = page;
    saving = saving.then(async () => {
      const s = theStorage();
      const scene = sceneFromInk(now, base, { color: pg.color });
      now.forEach((it, i) => { if (it.kind === 'stroke' && !it.el) it.el = scene.elements[i]; });   // the same element next time
      const text = writeInkFile(prevText, scene, { paper: pg.paper, color: pg.color === PAPER_COLOR ? null : pg.color, view: pg.view === 'scroll' ? null : pg.view, pages: pg.view === 'pages' ? pg.pages : null });
      await s.write(inkPath, text);
      prevText = text;
      base = scene;
      await s.write(svgPath, picture(now, pg));
      redrawn();
    }).catch((err) => toast(`The handwriting could not be saved: ${err.message}`));
    return saving;
  }
  /** The sheet's picture of this page has changed: the editor shows it anew. */
  const redrawn = () => window.dispatchEvent(new CustomEvent('moshe:redrawn', { detail: svgPath }));

  function key(e) {
    const t = document.activeElement;
    if (t && (t.closest('.cm-editor') || /^(INPUT|TEXTAREA|SELECT)$/u.test(t.tagName))) return;
    const mod = e.metaKey || e.ctrlKey, ch = e.key.toLowerCase();
    if (mod && ch === 'z') { if (e.shiftKey) redo(); else undo(); }
    else if (mod && ch === 'y') redo();
    else if (chosen.size && (e.key === 'Delete' || e.key === 'Backspace')) deleteHeld();
    else if (mod && ch === 'c' && chosen.size) copyHeld();
    else if (mod && ch === 'x' && chosen.size) cutHeld();
    else if (mod && ch === 'd' && chosen.size) duplicateHeld();
    else if (mod && ch === 'v' && clipboard.items) paste();
    else if (e.key === 'Escape' && (chosen.size || pasteAt)) { chosen = new Set(); pasteAt = null; }
    else return;
    e.preventDefault();
  }
</script>

<svelte:window onkeydown={key} />

<div class="ink" class:dark bind:this={wrap}>
  <InkTools canUndo={past.length > 0} canRedo={future.length > 0} onundo={undo} onredo={redo} {page} onpage={setPage} oneraseall={eraseAll}
    {reading} onreading={() => { reading = !reading; panel = null; chosen = new Set(); }} {typing} {ontype}
    canPaste={!!clipboard.items} onpaste={() => paste()} {zoom} onfit={zoomFit} bind:panel />
  <div class="scroll {tools.tool}" class:reading class:pinching class:fingers={tools.fingers && !reading} bind:this={scroller}
    onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onpointerleave={() => (ring = null)}
    oncontextmenu={(e) => e.preventDefault()} role="application" aria-label="The page">
    <div class="page" class:pages={page.view === 'pages'} bind:this={pageEl} style="width:{PAGE_WIDTH * k}px; height:{size.h * k}px">
      {#if page.view === 'pages'}
        {#each { length: size.pages } as _, i}<div class="sheet" style="top:{i * (PAGE_HEIGHT + PAGE_GAP) * k}px; height:{PAGE_HEIGHT * k}px"></div>{/each}
      {/if}
      <svg width={PAGE_WIDTH * k} height={size.h * k} viewBox="0 0 {PAGE_WIDTH} {size.h}">
        <defs>{@html GRAIN}</defs>
        <g>{@html paperMarkup}</g>
        {#each layers.highlights as g (g.key)}
          <g opacity={g.opacity} style="mix-blend-mode:{dark ? 'screen' : 'multiply'}">
            {#each g.items as it (it)}<path d={pathOf(it)} fill={g.color} transform={moved(it)} />{/each}
          </g>
        {/each}
        {#each layers.rest as it (it)}
          {#if it.kind === 'stroke'}
            {@const p = paintOf(it)}
            <path d={pathOf(it)} fill={p.color} fill-opacity={p.opacity < 1 ? p.opacity : undefined} filter={p.grain ? 'url(#grain)' : undefined} transform={moved(it)} />
          {:else}
            <g>{@html othersSvg([it])}</g>
          {/if}
        {/each}
      </svg>
      {#if heldBox}
        <div class="held" style="left:{heldBox.x0 * k}px; top:{heldBox.y0 * k}px; width:{(heldBox.x1 - heldBox.x0) * k}px; height:{(heldBox.y1 - heldBox.y0) * k}px"
          onpointerdown={grab('move')} role="presentation">
          {#each ['nw', 'ne', 'sw', 'se'] as c}<span class="handle {c}" onpointerdown={grab(c)} role="presentation"></span>{/each}
        </div>
        {#if !drag}
          <div class="heldbar popover" role="toolbar" tabindex="-1" aria-label="What the lasso holds" onpointerdown={(e) => e.stopPropagation()}
            style="left:{Math.max(4, Math.min(heldBox.x0 * k, PAGE_WIDTH * k - 330))}px; top:{heldBox.y0 * k > 60 ? heldBox.y0 * k - 50 : heldBox.y1 * k + 10}px">
            <button onclick={cutHeld}><Icon name="scissors" size={15} /> Cut</button>
            <button onclick={copyHeld}><Icon name="copy" size={15} /> Copy</button>
            <button onclick={duplicateHeld}><Icon name="files" size={15} /> Duplicate</button>
            <button onclick={deleteHeld}><Icon name="trash-2" size={15} /> Delete</button>
            <button class:on={styling} onclick={() => (styling = !styling)}><Icon name="palette" size={15} /> Style</button>
            {#if styling}
              <div class="restyle popover">
                <div class="kinds">
                  {#each WRITING as pk}<button title={PEN_TYPES[pk].label} aria-label={PEN_TYPES[pk].label} onclick={() => restyle({ pen: pk })}><InkSample pen={pk} width={across(pk, 30)} w={44} h={22} color={dark ? '#ffffff' : '#1e1e1e'} /></button>{/each}
                </div>
                <div class="colors">{#each COLORS as c}<button class="swatch" style="--c:{c}" aria-label="Colour {c}" onclick={() => restyle({ color: c })}></button>{/each}</div>
                <div class="sizes"><button onclick={() => restyle({ scale: 0.8 })}><Icon name="minus" size={14} /> Thinner</button><button onclick={() => restyle({ scale: 1.25 })}><Icon name="plus" size={14} /> Thicker</button></div>
              </div>
            {/if}
          </div>
        {/if}
      {/if}
      {#if pasteAt}
        <button class="pastehere popover" style="left:{pasteAt[0] * k}px; top:{pasteAt[1] * k}px" onpointerdown={(e) => e.stopPropagation()} onclick={() => paste(pasteAt)}><Icon name="clipboard" size={15} /> Paste</button>
      {/if}
    </div>
    {#if page.view === 'pages' && status === 'ready'}
      <button class="addpage" onpointerdown={(e) => e.stopPropagation()} onclick={addPage}><Icon name="file-plus" size={16} /> Add a Page</button>
    {/if}
  </div>
  <canvas bind:this={canvas} aria-hidden="true"></canvas>
  {#if ring}<div class="ring" class:erase={ring.erase} style="left:{ring.x}px; top:{ring.y}px; width:{ring.r * 2}px; height:{ring.r * 2}px"></div>{/if}
  {#if zoom !== 1}<button class="zoom popover chrome" title="Zoom to fit" onclick={zoomFit}>{Math.round(zoom * 100)}%</button>{/if}
  {#if tools.roundButton && coarse && !reading && status === 'ready'}
    <button class="round popover chrome" title="The pens (or press the S Pen's button with the pen over the page)" aria-label="The pens"
      onclick={(e) => { const r = e.currentTarget.getBoundingClientRect(); openRadial(r.left + r.width / 2, r.top + r.height / 2); }}>
      {#if brush()}<InkSample pen={brush().pen} color={brush().color} width={Math.min(6, brush().width)} opacity={brush().opacity} w={30} h={20} />{:else}<Icon name={tools.tool === 'eraser' ? 'eraser' : 'lasso'} size={20} />{/if}
    </button>
  {/if}
  {#if radial}<InkRadial x={radial.x} y={radial.y} onclose={() => (radial = null)} onundo={undo} onredo={redo} />{/if}
  {#if status === 'loading'}<p class="hint">Opening the page…</p>{/if}
</div>

<style>
  .ink { position: relative; height: 100%; overflow: hidden; background: var(--sidebar-bg); }
  .scroll { position: absolute; inset: 0; overflow: auto; overscroll-behavior: contain; touch-action: pan-x pan-y; padding: 108px 12px 40vh; cursor: crosshair; }
  .scroll.fingers { touch-action: none; }
  :global(html.moshe-focus) .scroll { padding-top: 28px; }
  .scroll.pinching { overflow: hidden; }
  .scroll.reading { cursor: grab; }
  .scroll.eraser { cursor: none; }
  .page { position: relative; margin: 0 auto; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12); transform-origin: 0 0; }
  .page.pages { box-shadow: none; }
  .page svg { position: relative; display: block; }
  .sheet { position: absolute; left: 0; right: 0; box-shadow: 0 1px 5px rgba(0, 0, 0, 0.16); }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  .ring { position: absolute; z-index: 2; margin: 0; transform: translate(-50%, -50%); border-radius: 50%; pointer-events: none;
    border: 1px solid rgba(25, 113, 194, 0.75); box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.6); }
  .ring.erase { border-color: rgba(120, 120, 120, 0.9); background: rgba(255, 255, 255, 0.25); }

  .held { position: absolute; z-index: 2; border: 1.5px dashed var(--accent); border-radius: 4px; cursor: move; touch-action: none; background: rgba(25, 113, 194, 0.04); }
  .handle { position: absolute; width: 16px; height: 16px; margin: -9px; border-radius: 50%; background: #fff; border: 2px solid var(--accent); touch-action: none; }
  .handle::after { content: ''; position: absolute; inset: -10px; }
  .nw { left: 0; top: 0; cursor: nwse-resize; } .ne { right: 0; top: 0; cursor: nesw-resize; margin-right: -9px; }
  .sw { left: 0; bottom: 0; cursor: nesw-resize; margin-bottom: -9px; } .se { right: 0; bottom: 0; cursor: nwse-resize; margin: 0 -9px -9px 0; }
  .heldbar, .pastehere { position: absolute; z-index: 3; display: flex; gap: 2px; padding: 4px; border-radius: 11px; background: var(--hud-bg, var(--popover-bg)); box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16); }
  .heldbar button, .pastehere { display: flex; align-items: center; gap: 5px; height: 32px; padding: 0 9px; border: 0; border-radius: 8px; background: none; color: var(--text); font-size: 13px; white-space: nowrap; }
  .heldbar button.on { background: var(--sel-grey); }
  .pastehere { transform: translate(-50%, -120%); padding: 0 12px; }
  .restyle { position: absolute; top: calc(100% + 6px); right: 0; width: 290px; display: flex; flex-direction: column; gap: 10px; padding: 10px; border-radius: 12px; background: var(--popover-bg); box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18); }
  .restyle .kinds, .restyle .colors, .restyle .sizes { display: flex; flex-wrap: wrap; gap: 6px; }
  .restyle .kinds button { height: 32px; padding: 0 2px; }
  .restyle .swatch { width: 26px; height: 26px; padding: 0; border-radius: 50%; background: var(--c); box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.18); }
  .restyle .sizes button { border: 1px solid var(--sep); }
  .addpage { display: flex; align-items: center; gap: 6px; margin: 24px auto 0; height: 36px; padding: 0 16px; border: 1px dashed var(--sep); border-radius: 10px; background: none; color: var(--muted); font-size: 13px; }
  .zoom { position: absolute; z-index: 3; left: 12px; bottom: calc(14px + env(safe-area-inset-bottom, 0px)); height: 30px; padding: 0 10px; border: 0; border-radius: 15px; background: var(--hud-bg, var(--popover-bg)); color: var(--text); font-size: 12px; font-variant-numeric: tabular-nums; }
  .round { position: absolute; z-index: 3; right: 16px; bottom: calc(18px + env(safe-area-inset-bottom, 0px)); width: 52px; height: 52px; border-radius: 50%; border: 0; display: flex; align-items: center; justify-content: center;
    background: var(--hud-bg, var(--popover-bg)); color: var(--text); box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18); opacity: 0.92; }
  .hint { position: absolute; top: 45%; left: 0; right: 0; text-align: center; color: var(--muted); margin: 0; pointer-events: none; }
</style>
