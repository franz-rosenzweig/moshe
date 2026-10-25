<script>
  // The handwriting page's toolbar, as Samsung Notes has it: the pen, the
  // highlighter, the eraser and the lasso; the colours used last; favourite
  // pens; Undo and Redo; the page's own settings, reading mode and the rest.
  // Tapping the tool in hand again opens its panel: the pen's kinds, size,
  // opacity and colours, or the eraser's ways of erasing.
  import Icon from './Icon.svelte';
  import InkSample from './InkSample.svelte';
  import { tools, brush, setColor, choose, addFavorite, useFavorite, dropFavorite, keep, WRITING } from '../lib/ink-tools.svelte.js';
  import { PEN_TYPES, COLORS, HIGHLIGHTS, PAPERS, PAPER_COLORS, VIEWS, across, paperSvg, isDark } from '@engine/ink.js';

  let { canUndo = false, canRedo = false, onundo, onredo, page, onpage, oneraseall, reading = false, onreading,
    typing = false, ontype = null, canPaste = false, onpaste, zoom = 1, onfit, panel = $bindable(null) } = $props();

  let barH = $state(44);
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const b = $derived(brush());
  const hl = $derived(tools.pens.highlighter);
  const quick = $derived(tools.tool === 'highlighter' ? [...new Set([hl.color, ...HIGHLIGHTS])].slice(0, 3) : tools.recent.slice(0, 3));
  const PAPER_NAMES = { lined: 'Lined', blank: 'Blank', dotted: 'Dotted', grid: 'Grid', cornell: 'Cornell' };

  /** The tool tapped: taken in hand, or, if it's in hand already, its panel opened. */
  function tap(tool) {
    if (tools.tool === tool && tool !== 'lasso') panel = panel === tool ? null : tool;
    else { choose(tool); panel = null; }
  }
  const toggle = (name) => { panel = panel === name ? null : name; };
  const set = (pen, k, v) => { tools.pens[pen][k] = v; keep(); };
  const mini = (p) => paperSvg(p, 1000, 1414, { color: page.color, weight: 14 });
</script>

<div class="bar popover" role="toolbar" aria-label="Pens" bind:clientHeight={barH}>
  {#if reading}
    <button class="tool on" title="Reading mode: the pen scrolls the page. Tap to write again" aria-label="Reading mode" aria-pressed="true" onclick={onreading}><Icon name="book-open-text" size={19} /></button>
    {#if ontype}<button class="type" class:on={typing} onclick={ontype}>{typing ? 'Done Typing' : 'Type It Up'}</button>{/if}
  {:else}
    <button class="tool pentool" class:on={tools.tool === 'pen'} title="{PEN_TYPES[tools.pen].label} (tap again for its settings)" aria-label="Pen" aria-pressed={tools.tool === 'pen'} onclick={() => tap('pen')}>
      <InkSample pen={tools.pen} color={tools.pens[tools.pen].color} width={Math.min(6, across(tools.pen, tools.pens[tools.pen].size))} opacity={tools.pens[tools.pen].opacity} w={30} h={20} />
    </button>
    <button class="tool" class:on={tools.tool === 'highlighter'} title="Highlighter (tap again for its settings)" aria-label="Highlighter" aria-pressed={tools.tool === 'highlighter'} onclick={() => tap('highlighter')}>
      <Icon name="highlighter" size={19} /><i class="under" style="background:{hl.color}"></i>
    </button>
    <button class="tool" class:on={tools.tool === 'eraser'} title="Eraser (tap again for its settings; or hold the pen's button)" aria-label="Eraser" aria-pressed={tools.tool === 'eraser'} onclick={() => tap('eraser')}><Icon name="eraser" size={19} /></button>
    <button class="tool" class:on={tools.tool === 'lasso'} title="Lasso: draw round strokes to move, resize, copy or restyle them" aria-label="Lasso" aria-pressed={tools.tool === 'lasso'} onclick={() => tap('lasso')}><Icon name="lasso" size={19} /></button>
    <span class="sep"></span>
    {#each quick as c (c)}
      <button class="swatch" class:on={b && b.color === c} style="--c:{c}" title="Colour" aria-label="Colour {c}" onclick={() => setColor(c)}></button>
    {/each}
    {#if tools.favorites.length}
      <span class="sep"></span>
      {#each tools.favorites as f, i}
        <button class="fav" title="{PEN_TYPES[f.pen].label} (right-click or long-press to remove)" aria-label="Favourite pen {i + 1}" onclick={() => useFavorite(f)} oncontextmenu={(e) => { e.preventDefault(); dropFavorite(i); }}>
          <InkSample pen={f.pen} color={f.color} width={Math.min(6, across(f.pen, f.size))} opacity={f.opacity} w={26} h={18} />
        </button>
      {/each}
    {/if}
    <span class="sep"></span>
    <button class="tool" title="Undo" aria-label="Undo" disabled={!canUndo} onclick={onundo}><Icon name="undo-2" size={18} /></button>
    <button class="tool" title="Redo" aria-label="Redo" disabled={!canRedo} onclick={onredo}><Icon name="redo-2" size={18} /></button>
    <span class="sep"></span>
    <button class="tool" class:on={panel === 'page'} title="The page: its colour, paper and view" aria-label="Page" aria-pressed={panel === 'page'} onclick={() => toggle('page')}><Icon name="file" size={18} /></button>
    <button class="tool" title="Reading mode: the pen scrolls and can't write" aria-label="Reading mode" aria-pressed="false" onclick={onreading}><Icon name="book-open-text" size={19} /></button>
    <button class="tool" class:on={panel === 'more'} title="More" aria-label="More" aria-pressed={panel === 'more'} onclick={() => toggle('more')}><Icon name="ellipsis-vertical" size={18} /></button>
    {#if ontype}<button class="type" class:on={typing} onclick={ontype}>{typing ? 'Done Typing' : 'Type It Up'}</button>{/if}
  {/if}
</div>

{#if panel}
  <div class="scrim" onpointerdown={() => (panel = null)} aria-hidden="true"></div>
  <div class="panel popover" style="top:{barH + 18}px" role="dialog" aria-label="Settings for the {panel}">
    {#if panel === 'pen' || panel === 'highlighter'}
      {@const pen = panel === 'highlighter' ? 'highlighter' : tools.pen}
      {@const p = tools.pens[pen]}
      {#if panel === 'pen'}
        <div class="kinds">
          {#each WRITING as k}
            <button class="kind" class:on={tools.pen === k} onclick={() => choose('pen', k)} aria-pressed={tools.pen === k}>
              <InkSample pen={k} color={tools.pens[k].color} width={across(k, Math.max(25, tools.pens[k].size))} w={52} h={26} />
              <span>{PEN_TYPES[k].label}</span>
            </button>
          {/each}
        </div>
      {/if}
      <div class="preview"><InkSample {pen} color={p.color} width={across(pen, p.size)} opacity={p.opacity} w={240} h={56} /></div>
      <label class="slider"><span>Size</span><input id="ink-size" type="range" min="1" max="100" value={p.size} oninput={(e) => set(pen, 'size', +e.currentTarget.value)} /><b>{p.size}</b></label>
      <label class="slider"><span>Opacity</span><input id="ink-opacity" type="range" min="10" max="100" step="5" value={p.opacity} oninput={(e) => set(pen, 'opacity', +e.currentTarget.value)} /><b>{p.opacity}%</b></label>
      <div class="colors">
        {#each (pen === 'highlighter' ? [...HIGHLIGHTS, ...COLORS.slice(3, 12)] : COLORS) as c}
          <button class="swatch" class:on={p.color === c} style="--c:{c}" aria-label="Colour {c}" onclick={() => setColor(c)}></button>
        {/each}
        <label class="wheel" title="Any colour"><input id="ink-color" type="color" value={p.color} onchange={(e) => setColor(e.currentTarget.value)} /></label>
      </div>
      {#if pen !== 'highlighter' && tools.recent.length > 1}
        <div class="row"><span class="lbl">Used last</span>{#each tools.recent as c}<button class="swatch small" class:on={p.color === c} style="--c:{c}" aria-label="Colour {c}" onclick={() => setColor(c)}></button>{/each}</div>
      {/if}
      <div class="row">
        <button class="btn" onclick={addFavorite}><Icon name="star" size={15} /> Add to Favourites</button>
        {#each tools.favorites as f, i}
          <span class="favitem"><button class="fav" onclick={() => useFavorite(f)} aria-label="Favourite pen {i + 1}"><InkSample pen={f.pen} color={f.color} width={Math.min(6, across(f.pen, f.size))} opacity={f.opacity} w={26} h={18} /></button><button class="x" aria-label="Remove favourite {i + 1}" onclick={() => dropFavorite(i)}><Icon name="x" size={11} /></button></span>
        {/each}
      </div>
    {:else if panel === 'eraser'}
      <div class="seg" role="radiogroup" aria-label="How it erases">
        <button class:on={tools.eraser.mode === 'area'} onclick={() => { tools.eraser.mode = 'area'; keep(); }}>What it passes over</button>
        <button class:on={tools.eraser.mode === 'stroke'} onclick={() => { tools.eraser.mode = 'stroke'; keep(); }}>Whole strokes</button>
      </div>
      <label class="slider"><span>Size</span><input id="ink-eraser" type="range" min="4" max="100" value={tools.eraser.size} oninput={(e) => { tools.eraser.size = +e.currentTarget.value; keep(); }} /><b>{tools.eraser.size}</b></label>
      <div class="seg" role="radiogroup" aria-label="What it erases">
        {#each [['all', 'All ink'], ['pen', 'Pen only'], ['highlighter', 'Highlighter only']] as [v, l]}
          <button class:on={tools.eraser.takes === v} onclick={() => { tools.eraser.takes = v; keep(); }}>{l}</button>
        {/each}
      </div>
      <div class="row"><button class="btn danger" onclick={() => { oneraseall(); panel = null; }}><Icon name="trash-2" size={15} /> Erase the Page</button></div>
    {:else if panel === 'page'}
      <span class="lbl">Colour</span>
      <div class="colors">
        {#each PAPER_COLORS as c}
          <button class="swatch paper-c" class:on={page.color === c} style="--c:{c}" aria-label="Page colour {c}{isDark(c) ? ' (dark)' : ''}" onclick={() => onpage({ color: c })}></button>
        {/each}
        <label class="wheel" title="Any colour"><input id="ink-paper-color" type="color" value={page.color} onchange={(e) => onpage({ color: e.currentTarget.value })} /></label>
      </div>
      <span class="lbl">Paper</span>
      <div class="papers">
        {#each PAPERS as p}
          <button class="paper" class:on={page.paper === p} aria-pressed={page.paper === p} onclick={() => onpage({ paper: p })}>
            <svg viewBox="0 0 1000 1414" width="46" height="65" aria-hidden="true">{@html mini(p)}</svg><span>{PAPER_NAMES[p]}</span>
          </button>
        {/each}
      </div>
      <span class="lbl">View</span>
      <div class="seg" role="radiogroup" aria-label="View">
        {#each VIEWS as v}<button class:on={page.view === v} onclick={() => onpage({ view: v })}>{v === 'scroll' ? 'One long page' : 'Pages'}</button>{/each}
      </div>
      <div class="row">
        {#if page.view === 'pages'}<button class="btn" onclick={() => onpage({ pages: page.pages + 1 })}><Icon name="file-plus" size={15} /> Add a Page</button>{/if}
        <button class="btn" onclick={() => onpage({ default: true })}>Use for New Pages</button>
      </div>
    {:else if panel === 'more'}
      <label class="check"><input type="checkbox" checked={tools.fingers} onchange={(e) => { tools.fingers = e.currentTarget.checked; keep(); }} /> Fingers write (off: fingers scroll){#if !coarse}<small>A mouse or trackpad always writes</small>{/if}</label>
      <label class="check"><input type="checkbox" checked={tools.roundButton} onchange={(e) => { tools.roundButton = e.currentTarget.checked; keep(); }} /> The round pen menu's button, in the corner</label>
      {#if canPaste}<button class="btn" onclick={() => { onpaste(); panel = null; }}><Icon name="clipboard" size={15} /> Paste</button>{/if}
      {#if zoom !== 1}<button class="btn" onclick={() => { onfit(); panel = null; }}>Zoom to Fit ({Math.round(zoom * 100)}%)</button>{/if}
    {/if}
  </div>
{/if}

<style>
  /* the tools in a row over the page, and in two when the page is narrow: Type It Up never out of sight */
  .bar { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); z-index: 4; display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 2px; padding: 4px 8px;
    width: max-content; max-width: calc(100% - 16px); border-radius: 14px; background: var(--hud-bg, var(--popover-bg)); }
  .tool, .fav { position: relative; flex: none; width: 38px; height: 38px; border: 0; border-radius: 9px; background: none; display: flex; align-items: center; justify-content: center; color: var(--text); padding: 0; }
  .pentool { width: 44px; }
  .on { background: var(--sel-grey); }
  .tool:disabled { opacity: 0.35; }
  .under { position: absolute; left: 10px; right: 10px; bottom: 5px; height: 3px; border-radius: 2px; opacity: 0.85; }
  .swatch { flex: none; width: 26px; height: 26px; margin: 0 2px; border-radius: 50%; border: 0; padding: 0; background: var(--c); box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.18); }
  .swatch.on { box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.18), 0 0 0 2px var(--popover-bg, #fff), 0 0 0 4px var(--accent); }
  .swatch.small { width: 20px; height: 20px; }
  .sep { flex: none; width: 1px; height: 22px; background: var(--sep); margin: 0 4px; }
  .type { flex: none; margin-left: 6px; height: 32px; padding: 0 12px; border: 0; border-radius: 8px; background: var(--accent); color: var(--on-accent); font-size: 13px; font-weight: 600; white-space: nowrap; }
  .type.on { background: var(--sel-grey); color: var(--text); }

  .scrim { position: absolute; inset: 0; z-index: 4; }
  .panel { position: absolute; left: 50%; transform: translateX(-50%); z-index: 5; width: min(360px, calc(100% - 24px)); max-height: calc(100% - 90px); overflow-y: auto;
    display: flex; flex-direction: column; gap: 12px; padding: 14px; border-radius: 14px; background: var(--popover-bg); box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18); color: var(--text); font-size: 13px; }
  .kinds { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
  .kind { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 2px; border: 0; border-radius: 10px; background: none; color: var(--text); font-size: 11px; }
  .preview { display: flex; justify-content: center; padding: 6px 0; border-radius: 10px; background: #fdfcf8; }
  .slider { display: grid; grid-template-columns: 58px 1fr 42px; align-items: center; gap: 8px; }
  .slider input { width: 100%; accent-color: var(--accent); }
  .slider b { font-weight: 500; text-align: right; font-variant-numeric: tabular-nums; color: var(--muted); }
  .colors { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .colors .swatch { margin: 0; width: 28px; height: 28px; }
  .paper-c { border-radius: 7px !important; }
  .wheel { width: 28px; height: 28px; border-radius: 50%; overflow: hidden; background: conic-gradient(red, yellow, lime, aqua, blue, magenta, red); position: relative; }
  .wheel input { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; border: 0; padding: 0; cursor: pointer; }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .lbl { color: var(--muted); font-size: 12px; margin-right: 4px; }
  .btn { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px; border: 1px solid var(--sep); border-radius: 8px; background: none; color: var(--text); font-size: 13px; }
  .btn.danger { color: var(--red, #c92a2a); }
  .favitem { position: relative; display: inline-flex; }
  .favitem .fav { width: 34px; height: 30px; border: 1px solid var(--sep); }
  .favitem .x { position: absolute; top: -6px; right: -6px; width: 16px; height: 16px; border-radius: 50%; border: 0; padding: 0; display: flex; align-items: center; justify-content: center; background: var(--sel-grey); color: var(--text); }
  .seg { display: flex; border: 1px solid var(--sep); border-radius: 9px; overflow: hidden; }
  .seg button { flex: 1; border: 0; background: none; color: var(--text); font-size: 12px; padding: 7px 4px; }
  .seg button + button { border-left: 1px solid var(--sep); }
  .papers { display: flex; flex-wrap: wrap; gap: 6px; }
  .paper { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 5px; border: 0; border-radius: 9px; background: none; color: var(--text); font-size: 11px; }
  .paper svg { border-radius: 3px; box-shadow: 0 0 0 1px var(--sep); }
  .kind.on, .paper.on, .seg button.on { background: var(--sel-grey); }
  .check { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .check small { flex-basis: 100%; padding-left: 22px; color: var(--muted); }
</style>
