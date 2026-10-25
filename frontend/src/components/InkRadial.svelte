<script>
  // The round pen menu, laid out as Samsung Notes lays it out, for the S Pen's
  // button pressed with the pen just over the glass (or the round button in the
  // corner): the pen in hand in the middle (tap it for all the pens, the
  // eraser and the lasso), its size on the left, its colour on the right (tap
  // it for the colours), Undo and Redo at the top, and the favourite pens with
  // a "+" for the pen as it's set now at the bottom.
  import Icon from './Icon.svelte';
  import InkSample from './InkSample.svelte';
  import { tools, brush, choose, setColor, keep, useFavorite, addFavorite } from '../lib/ink-tools.svelte.js';
  import { across, PEN_TYPES, COLORS, HIGHLIGHTS } from '@engine/ink.js';

  let { x, y, onclose, onundo, onredo } = $props();

  let mode = $state('main');                     // main | kinds | colors
  const R = 84;
  const b = $derived(brush());
  const pen = $derived(tools.tool === 'highlighter' ? 'highlighter' : tools.pen);
  const set = $derived(tools.pens[pen]);
  const KINDS = [...Object.keys(PEN_TYPES).map((k) => ({ k, label: PEN_TYPES[k].label })), { k: 'eraser', label: 'Eraser' }, { k: 'lasso', label: 'Lasso' }];
  const palette = $derived(pen === 'highlighter' ? [...HIGHLIGHTS, ...COLORS.slice(3, 12)] : COLORS);
  const favs = $derived(tools.favorites.slice(0, 3));
  // kept on the screen, disc and all
  const cx = $derived(Math.min(Math.max(x, 128), window.innerWidth - 128));
  const cy = $derived(Math.min(Math.max(y, 128), window.innerHeight - 128));
  const spot = (deg, r = R) => `left:${Math.cos((deg * Math.PI) / 180) * r}px; top:${Math.sin((deg * Math.PI) / 180) * r}px`;
  const bottom = (i, n) => (n === 1 ? 90 : 125 - (70 * i) / (n - 1));
  // a tap, by pen, finger or mouse, and not the pointerdown that closes the menu behind it
  const tap = (fn) => (e) => { e.stopPropagation(); fn(); };

  function kind(k) {
    if (k === 'eraser' || k === 'lasso') { choose(k); onclose(); return; }
    choose(k === 'highlighter' ? 'highlighter' : 'pen', k);
    mode = 'main';
  }
  function size(v) {
    if (tools.tool === 'eraser') tools.eraser.size = v; else tools.pens[pen].size = v;
    keep();
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (mode === 'main' ? onclose() : (mode = 'main'))} />
<div class="scrim" onpointerdown={onclose} oncontextmenu={(e) => e.preventDefault()} aria-hidden="true"></div>
<div class="radial" style="left:{cx}px; top:{cy}px" role="menu" aria-label="The pens" tabindex="-1" onpointerdown={(e) => e.stopPropagation()}>
  <div class="disc"></div>
  {#if mode === 'main'}
    <button class="slot middle" title="All the pens" aria-label="All the pens" onclick={tap(() => (mode = 'kinds'))}>
      {#if b}<InkSample pen={b.pen} color={b.color} width={Math.min(9, b.width)} opacity={b.opacity} w={44} h={26} />{:else}<Icon name={tools.tool === 'eraser' ? 'eraser' : 'lasso'} size={24} />{/if}
    </button>
    <button class="slot" style={spot(-118)} title="Undo" aria-label="Undo" onclick={tap(onundo)}><Icon name="undo-2" size={18} /></button>
    <button class="slot" style={spot(-62)} title="Redo" aria-label="Redo" onclick={tap(onredo)}><Icon name="redo-2" size={18} /></button>
    {#if tools.tool !== 'lasso'}
      <label class="size" style={spot(180, R - 4)} title="Size">
        <input id="ink-radial-size" type="range" min={tools.tool === 'eraser' ? 4 : 1} max="100" aria-label="Size"
          value={tools.tool === 'eraser' ? tools.eraser.size : set.size} oninput={(e) => size(+e.currentTarget.value)} />
        <b>{tools.tool === 'eraser' ? tools.eraser.size : set.size}</b>
      </label>
    {/if}
    {#if b}<button class="slot color" style="{spot(0)}; --c:{b.color}" title="Colour" aria-label="Colour" onclick={tap(() => (mode = 'colors'))}><i></i></button>{/if}
    {#each favs as f, i}
      <button class="slot" style={spot(bottom(i, favs.length + 1))} title="{PEN_TYPES[f.pen].label} (a favourite)" aria-label="Favourite pen {i + 1}" onclick={tap(() => { useFavorite(f); onclose(); })}>
        <InkSample pen={f.pen} color={f.color} width={Math.min(6, across(f.pen, f.size))} opacity={f.opacity} w={30} h={20} />
      </button>
    {/each}
    <button class="slot plus" style={spot(bottom(favs.length, favs.length + 1))} title="Add this pen to the favourites" aria-label="Add to Favourites" disabled={!b} onclick={tap(addFavorite)}><Icon name="plus" size={18} /></button>
  {:else if mode === 'kinds'}
    <button class="slot middle" title="Back" aria-label="Back" onclick={tap(() => (mode = 'main'))}><Icon name="chevron-left" size={20} /></button>
    {#each KINDS as { k, label }, i}
      {@const on = k === 'eraser' || k === 'lasso' ? tools.tool === k : (k === 'highlighter' ? tools.tool === 'highlighter' : tools.tool === 'pen' && tools.pen === k)}
      <button class="slot" class:on style={spot(-90 + (i * 360) / KINDS.length)} title={label} aria-label={label} onclick={tap(() => kind(k))}>
        {#if k === 'eraser' || k === 'lasso'}<Icon name={k} size={19} />{:else}<InkSample pen={k} color={tools.pens[k].color} width={Math.min(6, across(k, tools.pens[k].size))} opacity={tools.pens[k].opacity} w={30} h={20} />{/if}
      </button>
    {/each}
  {:else}
    <button class="slot middle" title="Back" aria-label="Back" onclick={tap(() => (mode = 'main'))}><Icon name="chevron-left" size={20} /></button>
    {#each palette as c, i}
      <button class="dot" class:on={set.color === c} style="{spot(-90 + (i * 360) / palette.length, 98)}; --c:{c}" aria-label="Colour {c}" onclick={tap(() => { setColor(c); mode = 'main'; })}></button>
    {/each}
    {#each tools.recent.slice(0, 5) as c, i}
      <button class="dot" class:on={set.color === c} style="{spot(-90 + (i * 360) / 6, 52)}; --c:{c}" aria-label="Colour {c}, used last" onclick={tap(() => { setColor(c); mode = 'main'; })}></button>
    {/each}
    <label class="dot wheel" style={spot(-90 + (5 * 360) / 6, 52)} title="Any colour"><input id="ink-radial-color" type="color" value={set.color} onchange={(e) => { setColor(e.currentTarget.value); mode = 'main'; }} /></label>
  {/if}
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: 20; }
  .radial { position: fixed; z-index: 21; width: 0; height: 0; touch-action: none; }
  .disc { position: absolute; left: -122px; top: -122px; width: 244px; height: 244px; border-radius: 50%; background: var(--popover-bg); box-shadow: 0 8px 30px rgba(0, 0, 0, 0.22); }
  .slot { position: absolute; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%; border: 0; padding: 0; display: flex; align-items: center; justify-content: center;
    background: var(--sidebar-bg); color: var(--text); touch-action: none; }
  .slot.on { background: var(--sel-grey); box-shadow: 0 0 0 2px var(--accent); }
  .slot:disabled { opacity: 0.35; }
  .middle { left: 0; top: 0; width: 62px; height: 62px; margin: -31px 0 0 -31px; background: #fdfcf8; box-shadow: 0 0 0 1px var(--sep); }
  .color i { width: 26px; height: 26px; border-radius: 50%; background: var(--c); box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.2); }
  .size { position: absolute; display: flex; flex-direction: column; align-items: center; gap: 2px; transform: translate(-50%, -50%); }
  .size input { writing-mode: vertical-lr; direction: rtl; height: 96px; width: 22px; margin: 0; accent-color: var(--accent); }
  .size b { font-size: 11px; font-weight: 500; color: var(--muted); font-variant-numeric: tabular-nums; }
  .dot { position: absolute; width: 28px; height: 28px; margin: -14px 0 0 -14px; border-radius: 50%; border: 0; padding: 0; background: var(--c); box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.2); }
  .dot.on { box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.2), 0 0 0 2px var(--popover-bg), 0 0 0 4px var(--accent); }
  .wheel { overflow: hidden; background: conic-gradient(red, yellow, lime, aqua, blue, magenta, red); }
  .wheel input { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; border: 0; padding: 0; }
</style>
