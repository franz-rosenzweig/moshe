<script>
  // The keyword manager: every keyword in the library (or the open project's
  // pool), how many sheets have it, its colour, whether it is a favourite;
  // rename, merge, delete — each on every sheet that has it.
  import Icon from './Icon.svelte';
  import { app, store, toast } from '../lib/state.svelte.js';
  import { COLORS, COLOR_ORDER, colorOf, confirm } from '../lib/ui.svelte.js';

  let { dialog } = $props();
  let chosen = $state([]);
  let editing = $state(null);   // {name, value}
  let colorFor = $state(null);
  const project = app.project;
  const list = $derived.by(() => { app.version; return store.keywords(project); });
  const favs = $derived(list.filter((k) => k.favorite));
  const others = $derived(list.filter((k) => !k.favorite));

  function pick(e, k) {
    if (e.metaKey || e.ctrlKey || e.shiftKey) chosen = chosen.includes(k.name) ? chosen.filter((x) => x !== k.name) : [...chosen, k.name];
    else chosen = [k.name];
  }
  function rename() {
    const to = editing.value.trim();
    if (to && to !== editing.name) { const n = store.renameKeyword(editing.name, to, project).length; toast(`Renamed on ${n} sheet${n === 1 ? '' : 's'}`); }
    editing = null;
  }
  async function remove(names) {
    if (!(await confirm(`Delete ${names.length === 1 ? `“${names[0]}”` : `${names.length} keywords`}?`, 'It is taken off every sheet that has it.', 'Delete', true))) return;
    for (const n of names) store.renameKeyword(n, null, project);
    chosen = [];
  }
  function merge() {
    const [into, ...rest] = chosen;
    for (const n of rest) store.renameKeyword(n, into, project);
    toast(`Merged into “${into}”`);
    chosen = [into];
  }
</script>

<div class="overlay" role="presentation" onmousedown={(e) => { if (e.target === e.currentTarget) dialog.resolve(null); }}>
  <div class="win popover" role="dialog" aria-label="Keywords">
    <div class="head"><b>Keywords{project ? ` in ${store.projectNode(project).name}` : ''}</b><button class="x" aria-label="Close" onclick={() => dialog.resolve(null)}><Icon name="x" size={14} /></button></div>
    <div class="body scroll">
      {#each [['Favorites', favs], ['Other', others]] as [label, ks]}
        <div class="sec">{label}</div>
        {#if !ks.length}<div class="dim small">{label === 'Favorites' ? 'Star a keyword to keep it here.' : 'No keywords yet: add them to a sheet in the dashboard.'}</div>{/if}
        {#each ks as k (k.name)}
          <div class="kw" class:on={chosen.includes(k.name)} role="option" aria-selected={chosen.includes(k.name)} tabindex="-1" onclick={(e) => pick(e, k)} onkeydown={() => {}}>
            <button class="dot" style="background:{colorOf(k.color, 'var(--sep-strong)')}" title="Colour" onclick={(e) => { e.stopPropagation(); colorFor = colorFor === k.name ? null : k.name; }}></button>
            {#if editing && editing.name === k.name}
              <!-- svelte-ignore a11y_autofocus -->
              <input class="field" bind:value={editing.value} autofocus onkeydown={(e) => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') editing = null; }} onblur={rename} />
            {:else}
              <span class="name" ondblclick={() => (editing = { name: k.name, value: k.name })} role="textbox" tabindex="-1">{k.name}</span>
            {/if}
            <span class="n">{k.count}</span>
            <button class="star" class:fav={k.favorite} title={k.favorite ? 'Remove from Favorites' : 'Add to Favorites'} onclick={(e) => { e.stopPropagation(); store.setKeyword(k.name, { favorite: !k.favorite }, project); }}><Icon name="star" size={13} fill={k.favorite ? 'currentColor' : 'none'} /></button>
          </div>
          {#if colorFor === k.name}
            <div class="colors">
              {#each COLOR_ORDER as c}<button class="cdot" style="background:{COLORS[c]}" title={c} onclick={() => { store.setKeyword(k.name, { color: c }, project); colorFor = null; }}></button>{/each}
              <button class="btn" onclick={() => { store.setKeyword(k.name, { color: null }, project); colorFor = null; }}>None</button>
            </div>
          {/if}
        {/each}
      {/each}
    </div>
    <div class="foot">
      <button class="btn" disabled={chosen.length !== 1} onclick={() => (editing = { name: chosen[0], value: chosen[0] })}>Rename…</button>
      <button class="btn" disabled={chosen.length < 2} onclick={merge}>Merge</button>
      <button class="btn danger" disabled={!chosen.length} onclick={() => remove(chosen)}>Delete</button>
      <span style="flex:1"></span>
      <button class="btn primary" onclick={() => dialog.resolve(true)}>Done</button>
    </div>
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; background: var(--overlay); z-index: 60; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .win { position: relative; width: min(420px, 100%); height: min(560px, 100%); display: flex; flex-direction: column; }
  .head { height: 44px; display: flex; align-items: center; justify-content: center; border-bottom: 1px solid var(--sep); position: relative; }
  .x { position: absolute; right: 12px; border: 0; background: none; color: var(--muted); display: flex; }
  .body { flex: 1; min-height: 0; padding: 8px 12px; }
  .sec { font-size: 11px; font-weight: 700; color: var(--section); text-transform: uppercase; letter-spacing: 0.04em; margin: 10px 4px 4px; }
  .kw { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 6px; }
  .kw.on { background: var(--accent); color: var(--on-accent); }
  .kw.on .n { color: rgba(255, 255, 255, 0.8); }
  .dot { width: 12px; height: 12px; border-radius: 50%; border: 0; padding: 0; flex: none; }
  .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kw .field { flex: 1; }
  .n { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
  .star { border: 0; background: none; padding: 2px; color: var(--icon-dim); display: flex; }
  .star.fav { color: #ffcc00; }
  .colors { display: flex; gap: 6px; padding: 6px 28px; align-items: center; flex-wrap: wrap; }
  .cdot { width: 16px; height: 16px; border-radius: 50%; border: 0; padding: 0; }
  .foot { display: flex; gap: 6px; padding: 10px 12px; border-top: 1px solid var(--sep); }
  .small { font-size: 12px; padding: 2px 4px; }
</style>
