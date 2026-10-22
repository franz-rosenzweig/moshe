<script>
  // Open Quickly (⌘O): find a sheet, group or project by name or by what is
  // written in it, and go there.
  import Icon from './Icon.svelte';
  import { app, store, openSheet, select, openProject, revealSheet } from '../lib/state.svelte.js';

  let q = $state('');
  let i = $state(0);
  let input;

  const results = $derived.by(() => {
    app.version;
    if (!app.quickOpen || !store) return [];
    const query = q.trim().toLowerCase();
    const out = [];
    if (query) {
      const lib = store.library();
      const walk = (g, trail) => {
        if (g.name.toLowerCase().includes(query)) out.push({ kind: 'group', path: g.path, title: g.name, sub: trail.join(' › '), icon: g.icon || 'sheets' });
        for (const k of g.groups || []) walk(k, [...trail, g.name]);
      };
      for (const g of lib.groups) walk(g, ['Notes']);
      for (const p of [...lib.projects, ...lib.archived]) {
        if (p.name.toLowerCase().includes(query)) out.push({ kind: 'project', path: p.path, title: p.name, sub: 'Project', icon: p.icon || 'book' });
        for (const g of [...p.groups, ...p.extras]) walk(g, [p.name]);
      }
      for (const r of store.search(q).slice(0, 40)) out.push({ kind: 'sheet', path: r.path, title: r.title || r.path.split('/').pop(), sub: r.snippet || r.path.split('/').slice(0, -1).join(' › '), icon: 'file' });
    } else {
      // what was open lately
      const seen = [...new Set([app.sheet, ...app.history.slice().reverse()])].filter((p) => p && store.exists(p)).slice(0, 12);
      for (const p of seen) out.push({ kind: 'sheet', path: p, title: store.sheetInfo(p).title || p.split('/').pop(), sub: p.split('/').slice(0, -1).join(' › '), icon: 'clock' });
    }
    return out.slice(0, 60);
  });

  $effect(() => { if (app.quickOpen) { q = ''; i = 0; setTimeout(() => input && input.focus(), 10); } });
  $effect(() => { q; i = 0; });

  function go(r) {
    app.quickOpen = false;
    if (!r) return;
    if (r.kind === 'sheet') { revealSheet(r.path); openSheet(r.path); setTimeout(() => window.dispatchEvent(new CustomEvent('moshe:focus-editor')), 20); } else if (r.kind === 'project') openProject(r.path);
    else {
      const proj = store.projectOf(r.path);
      app.project = proj;
      select(r.path);
    }
  }

  function key(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); i = Math.min(results.length - 1, i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); i = Math.max(0, i - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[i]); }
    else if (e.key === 'Escape') { app.quickOpen = false; }
  }
</script>

{#if app.quickOpen}
  <div class="overlay" role="presentation" onmousedown={(e) => { if (e.target === e.currentTarget) app.quickOpen = false; }}>
    <div class="box popover" role="dialog" aria-label="Open Quickly">
      <div class="in"><Icon name="search" size={18} /><input bind:this={input} bind:value={q} placeholder="Open Quickly" onkeydown={key} /></div>
      {#if results.length}
        <div class="results scroll">
          {#each results as r, k}
            <button class="r" class:on={k === i} onmouseenter={() => (i = k)} onclick={() => go(r)}>
              <Icon name={r.icon} size={16} />
              <span class="tx"><span class="t">{r.title}</span><span class="s">{r.sub}</span></span>
              <span class="kind">{r.kind === 'sheet' ? '' : r.kind}</span>
            </button>
          {/each}
        </div>
      {:else if q}
        <div class="none dim">Nothing matches “{q}”</div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .overlay { position: fixed; inset: 0; z-index: 58; display: flex; justify-content: center; align-items: flex-start; padding-top: 16vh; }
  .box { position: relative; width: min(620px, 92vw); overflow: hidden; }
  .in { display: flex; align-items: center; gap: 10px; padding: 0 16px; height: 54px; color: var(--muted); }
  .in input { flex: 1; border: 0; background: none; outline: none; font-size: 20px; color: var(--text); }
  .results { max-height: 50vh; border-top: 1px solid var(--sep); padding: 6px; }
  .r { display: flex; align-items: center; gap: 10px; width: 100%; border: 0; background: none; padding: 7px 10px; border-radius: 7px; text-align: left; color: var(--icon); }
  .r.on { background: var(--accent); color: var(--on-accent); }
  .tx { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .t { font-size: 13px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .s { font-size: 11px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .r.on .t, .r.on .s { color: var(--on-accent); }
  .kind { font-size: 11px; text-transform: capitalize; opacity: 0.6; }
  .none { padding: 14px 18px; border-top: 1px solid var(--sep); }
</style>
