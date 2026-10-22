<script>
  // Browse Backups: the server's backups of the library, each a whole copy.
  // Pick one, then a sheet in it, see it, and restore it — as a new sheet
  // beside the current one (or into the Inbox, if it is gone), so nothing
  // here is overwritten.
  import Icon from './Icon.svelte';
  import { store, openSheet, toast, select, backupKeeper } from '../lib/state.svelte.js';
  import { sheetTitle, splitSheet } from '@engine/sheet.js';
  import { isSheet } from '@engine/store.js';

  let { dialog } = $props();
  let list = $state(null);
  let chosen = $state(null);
  let files = $state(null);
  let sheet = $state(null);
  let filter = $state('');

  // a folder library on a device: the backups, if any, are on the server it syncs with
  const keeper = backupKeeper();
  $effect(() => { if (keeper.kind === 'server') load(); });
  async function load() {
    try { const r = await fetch('/api/backups'); list = r.ok ? (await r.json()).backups : []; } catch { list = []; }
  }
  async function open(b) {
    chosen = b;
    sheet = null;
    files = null;
    const r = await fetch(`/api/backups/${encodeURIComponent(b.id)}`);
    files = r.ok ? (await r.json()).files : {};
  }
  const sheets = $derived(files ? Object.keys(files).filter((p) => isSheet(p)).sort() : []);
  const shown = $derived(filter ? sheets.filter((p) => (p + ' ' + files[p]).toLowerCase().includes(filter.toLowerCase())) : sheets);
  const fmt = (ms) => new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  const changed = (p) => store.text(p) !== files[p];

  function restore(p) {
    const dir = p.slice(0, p.lastIndexOf('/'));
    const where = store.exists(dir) ? dir : 'Notes';
    const np = store.createSheet(where, { text: files[p], after: store.exists(p) ? p : null });
    const title = sheetTitle(splitSheet(files[p]).body);
    store.renameSheet(np, `${title || 'Restored'} (from ${new Date(chosen.at).toLocaleDateString()})`);
    toast('Restored beside the current sheet');
    select(where, { keepSheet: true });
    dialog.resolve(true);
  }
</script>

<div class="overlay" role="presentation" onmousedown={(e) => { if (e.target === e.currentTarget) dialog.resolve(null); }}>
  <div class="win popover" role="dialog" aria-label="Backups">
    <div class="tape"></div>
    <div class="head"><b>Backups</b><button class="x" onclick={() => dialog.resolve(null)} aria-label="Close"><Icon name="x" size={14} /></button></div>
    <div class="cols">
      <div class="col scroll">
        {#if keeper.kind === 'synced'}<p class="dim pad">This library is a folder on this device. Its backups are kept by the server it syncs with, {keeper.host}: open Moshe there to browse them.</p>
        {:else if keeper.kind === 'none'}<p class="dim pad">This library is a folder on this device, and no Moshe server keeps backups of it. Set up Sync in Settings to have the server back it up every hour, or keep the folder in Time Machine.</p>
        {:else if list === null}<p class="dim pad">Loading…</p>{:else if !list.length}<p class="dim pad">No backups yet. The server makes one every hour there are changes.</p>{/if}
        {#each list || [] as b}
          <button class="item" class:on={chosen && chosen.id === b.id} onclick={() => open(b)}>
            {#if b.manual}<Icon name="lock" size={12} />{/if}{fmt(b.at)}
          </button>
        {/each}
      </div>
      <div class="col scroll">
        {#if files}
          <input class="field filter" placeholder="Filter" bind:value={filter} />
          {#each shown as p}
            <button class="item" class:on={sheet === p} onclick={() => (sheet = p)} title={p}>
              <span class="t">{sheetTitle(splitSheet(files[p]).body) || p.split('/').pop()}</span>
              <small>{p.split('/').slice(0, -1).join(' › ')}{!store.exists(p) ? ' · deleted since' : changed(p) ? ' · changed since' : ''}</small>
            </button>
          {/each}
        {/if}
      </div>
      <div class="col view scroll">
        {#if sheet}
          <div class="bar"><button class="btn primary" onclick={() => restore(sheet)}>Restore a Copy</button></div>
          <pre>{splitSheet(files[sheet]).body}</pre>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; background: var(--overlay); z-index: 60; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .win { position: relative; width: min(1000px, 100%); height: min(680px, 100%); display: flex; flex-direction: column; overflow: hidden; }
  .tape { height: 8px; background: repeating-linear-gradient(135deg, #f5c400 0 12px, #1c1c1e 12px 24px); flex: none; }
  .head { display: flex; justify-content: center; align-items: center; height: 40px; position: relative; border-bottom: 1px solid var(--sep); }
  .x { position: absolute; right: 12px; border: 0; background: none; color: var(--muted); display: flex; }
  .cols { flex: 1; display: grid; grid-template-columns: 220px 280px 1fr; min-height: 0; }
  .col { border-right: 1px solid var(--sep); min-height: 0; padding: 6px; }
  .item { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; text-align: left; border: 0; background: none; padding: 7px 10px; border-radius: 6px; font-size: 13px; color: var(--text); }
  .item.on { background: var(--accent); color: var(--on-accent); }
  .item small { color: var(--muted); font-size: 11px; }
  .item.on small { color: rgba(255, 255, 255, 0.8); }
  .item .t { font-weight: 600; }
  .filter { width: 100%; margin-bottom: 6px; }
  .view pre { white-space: pre-wrap; font: 13px/1.6 var(--font-ui); padding: 10px 16px; margin: 0; user-select: text; }
  .bar { padding: 8px 16px; border-bottom: 1px solid var(--sep); }
  .pad { padding: 12px; }
</style>
