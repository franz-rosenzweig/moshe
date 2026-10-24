<script>
  // The sheet list: the sheets of the selected group (and of the groups in
  // it, each under its name), a few lines of each.
  import Icon from './Icon.svelte';
  import { app, store, openSheet, select, persist, toast, prefs, phoneOpen, trashWarning } from '../lib/state.svelte.js';
  import { ui, openMenu, menuUnder, confirm, colorOf } from '../lib/ui.svelte.js';
  import { sheetMenu, trashSheets, newSheet, sortItems } from '../lib/actions.js';
  import { addGettingStarted } from '@engine/welcome.js';
  import { draggingFiles } from '../lib/importer.js';
  let fileOver = $state(false);

  let { filtering = $bindable(false) } = $props();
  let query = $state('');
  let listEl;
  let anchor = null;           // for shift-clicks
  let moving = null;           // the end of a shift-selection that the arrows move
  let dropAt = $state(null);   // {path, where: before|after}

  const list = $derived.by(() => { app.version; return store ? store.sheetList(app.selection) : { title: '', sections: [] }; });
  const kwColors = $derived.by(() => { app.version; return store ? Object.fromEntries(store.keywords(app.project).map((k) => [k.name, k.color])) : {}; });
  const fold = (s) => String(s).normalize('NFD').replace(/[̀-֑ͯ-ׇ]/gu, '').toLowerCase();
  const shown = $derived.by(() => {
    if (!filtering || !query.trim()) return list.sections;
    const q = fold(query.trim());
    return list.sections.map((s) => ({ ...s, sheets: s.sheets.filter((x) => fold(x.title + ' ' + x.preview.map((p) => p.text).join(' ') + ' ' + x.keywords.join(' ')).includes(q) || fold(store.text(x.path) || '').includes(q)) }));
  });
  const flat = $derived(shown.flatMap((s) => s.sheets.map((x) => x.path)));
  const manual = $derived((list.sort || 'manual') === 'manual' && !!list.group);
  const glueColor = 'var(--accent-fg)';

  function click(e, path) {
    app.focus = 'list';
    if (e.shiftKey && anchor) {
      const a = flat.indexOf(anchor), b = flat.indexOf(path);
      app.selected = flat.slice(Math.min(a, b), Math.max(a, b) + 1);
    } else if (e.metaKey || e.ctrlKey) {
      app.selected = app.selected.includes(path) ? app.selected.filter((p) => p !== path) : [...app.selected, path];
      anchor = path;
    } else {
      anchor = path;
      if (matchMedia('(max-width: 760px)').matches) phoneOpen(path);
      else { openSheet(path, { fromList: true }); window.dispatchEvent(new CustomEvent('moshe:picked')); }
    }
    if (e.altKey && !e.shiftKey && !e.metaKey) { app.second = path; }
  }

  function menu(e, path) {
    if (!app.selected.includes(path)) { app.selected = [path]; anchor = path; if (!e.shiftKey) openSheet(path, { fromList: true }); }
    openMenu(e, sheetMenu(app.selected.length ? app.selected : [path]));
  }

  function keydown(e) {
    if (e.target.tagName === 'INPUT') return;
    const i = flat.indexOf(app.sheet);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      if (e.shiftKey) {
        // a run of sheets from the anchor, as a shift-click makes (for Glue and Merge)
        const from = moving && app.selected.includes(moving) ? moving : app.sheet;
        const next = flat[Math.max(0, Math.min(flat.length - 1, flat.indexOf(from) + step))];
        if (!next) return;
        if (!anchor || !app.selected.includes(anchor)) anchor = app.sheet || next;
        const a = flat.indexOf(anchor), b = flat.indexOf(next);
        app.selected = flat.slice(Math.min(a, b), Math.max(a, b) + 1);
        moving = next;
        document.querySelector(`[data-sheet="${CSS.escape(next)}"]`)?.scrollIntoView({ block: 'nearest' });
        return;
      }
      const next = flat[Math.max(0, Math.min(flat.length - 1, i + step))];
      if (!next) return;
      anchor = next;
      moving = null;
      openSheet(next, { fromList: true });
      document.querySelector(`[data-sheet="${CSS.escape(next)}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && (e.metaKey || e.key === 'Delete') && app.selected.length) {
      e.preventDefault();
      trashSheets(app.selected);
    } else if (e.key === 'Enter' || e.key === 'ArrowRight') {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('moshe:focus-editor'));
    } else if (e.key === 'ArrowLeft') {
      app.focus = 'library';
    }
  }

  function dragStart(e, path) {
    const paths = app.selected.includes(path) ? flat.filter((p) => app.selected.includes(p)) : [path];
    ui.drag = { kind: 'sheets', paths };
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', paths.map((p) => store.sheetInfo(p).title).join('\n'));
  }

  function dragOver(e, s) {
    if (!ui.drag || ui.drag.kind !== 'sheets') return;
    const sameDir = ui.drag.paths.every((p) => p.slice(0, p.lastIndexOf('/')) === s.dir);
    if (!manual && sameDir) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    dropAt = { path: s.path, where: e.clientY < r.top + r.height / 2 ? 'before' : 'after' };
  }

  function drop(e, s) {
    e.preventDefault();
    const d = ui.drag, at = dropAt;
    ui.drag = null;
    dropAt = null;
    if (!d || !at) return;
    const dir = s.dir;
    const order = store.sheetsIn(dir).filter((p) => !d.paths.includes(p));
    let i = order.indexOf(s.path);
    if (i < 0) i = order.length; else if (at.where === 'after') i++;
    const moving = d.paths.filter((p) => p.slice(0, p.lastIndexOf('/')) !== dir);
    const staying = d.paths.filter((p) => p.slice(0, p.lastIndexOf('/')) === dir);
    let moved = [];
    if (moving.length) moved = store.moveSheets(moving, dir, i);
    const names = store.sheetsIn(dir).filter((p) => !staying.includes(p));
    let j = names.indexOf(s.path);
    if (j < 0) j = names.length; else if (at.where === 'after') j++;
    names.splice(j, 0, ...staying);
    if (staying.length && manual) store.reorderSheets(dir, names);
    if (moved.length) toast(`Moved to ${dir.split('/').pop()}`);
  }

  function fmtDate(ms) {
    if (!ms) return '';
    const d = new Date(ms), now = new Date();
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) return `Today, ${time}`;
    const y = new Date(now); y.setDate(y.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return `Yesterday, ${time}`;
    return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' }) + `, ${time}`;
  }

  // a library with nothing in it yet: the Getting Started sheets, on request
  const emptyLibrary = $derived.by(() => { app.version; return store ? store.allSheets(true).length === 0 && !store.library().groups.length && !store.library().projects.length : false; });
  function welcome() { const g = addGettingStarted(store); select(g); }

  const showDates = $derived(prefs.sheetListDates || app.selection === 'all' || app.selection === 'notes-all' || app.selection === 'recent');

  async function emptyTrash() {
    const proj = app.selection.endsWith('#trash') ? app.selection.slice(0, -6) : null;
    if (await confirm('Empty the Trash?', trashWarning(), 'Empty Trash', true)) {
      store.emptyTrash(proj);
    }
  }

  function trashMenu(e, t) {
    openMenu(e, [
      { label: 'Put Back', action: () => { const p = store.restore(t.path); toast('Put back'); if (t.kind === 'sheet') openSheet(p); } },
      { sep: true },
      { label: 'Erase…', action: async () => { if (await confirm(`Erase “${t.title}”?`, 'It is gone for good.', 'Erase', true)) store.erase(t.path); } },
    ]);
  }

  $effect(() => { if (!filtering) query = ''; });
  $effect(() => { app.selection; query = ''; });
</script>

<section class="list" class:file-over={fileOver} aria-label="Sheets" tabindex="-1" onkeydown={keydown} onfocusin={() => (app.focus = 'list')}
  ondragover={(e) => { if (draggingFiles(e) && list.group) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; fileOver = true; } }}
  ondragleave={(e) => { if (e.currentTarget === e.target) fileOver = false; }}
  ondrop={(e) => { if (draggingFiles(e) && list.group) { e.preventDefault(); fileOver = false; import('../lib/importer.js').then((m) => m.importFiles([...e.dataTransfer.files], list.group)); } }}>
  <header>
    <h2 title={list.title}>{list.title}</h2>
    {#if list.group}
      <button class="sort" title="Sort" onclick={(e) => menuUnder(e.currentTarget, sortItems(list.group), 'right')}><Icon name="arrow-up-down" size={13} /></button>
    {/if}
  </header>
  {#if filtering}
    <div class="filter">
      <Icon name="search" size={13} />
      <!-- svelte-ignore a11y_autofocus -->
      <input bind:value={query} placeholder="Filter in {list.title}" autofocus onkeydown={(e) => { if (e.key === 'Escape') filtering = false; }} />
      {#if query}<button onclick={() => (query = '')} aria-label="Clear"><Icon name="x" size={12} /></button>{/if}
    </div>
  {/if}
  <div class="scroll sheets" bind:this={listEl}>
    {#if list.trash}
      {#each list.sections[0].items as t (t.path)}
        <div class="card trash" role="listitem" oncontextmenu={(e) => trashMenu(e, t)} ondblclick={() => { const p = store.restore(t.path); if (t.kind === 'sheet') openSheet(p); }}>
          <div class="line title">{#if t.kind !== 'sheet'}<Icon name="folder" size={13} /> {/if}{t.title}</div>
          {#each (t.preview || []).slice(1, 3) as p}<div class="line" class:heading={p.heading}>{p.text}</div>{/each}
          <div class="origin">from {t.origin.replace(/\.md$/u, '').split('/').slice(0, -1).join(' › ') || 'Inbox'}</div>
        </div>
      {/each}
      {#if list.sections[0].items.length}
        <div class="trash-foot"><button class="btn" onclick={emptyTrash}>Empty Trash</button></div>
      {:else}
        <div class="empty">The Trash is empty</div>
      {/if}
    {:else}
      {#each shown as s (s.path)}
        {#if s.depth > 0 && (s.sheets.length || !filtering)}
          <div class="subhead" style="padding-left:{16 + (s.depth - 1) * 10}px">{s.name}</div>
        {/if}
        {#each s.sheets as sh, k (sh.path)}
          {@const sel = app.selected.includes(sh.path)}
          {@const prevGlued = k > 0 && s.sheets[k - 1].glued}
          <div class="card" class:sel class:focus={sel && app.focus === 'list'} class:material={sh.material}
            class:drop-before={dropAt && dropAt.path === sh.path && dropAt.where === 'before'}
            class:drop-after={dropAt && dropAt.path === sh.path && dropAt.where === 'after'}
            class:glued={sh.glued || prevGlued}
            data-sheet={sh.path} role="listitem" draggable="true"
            onclick={(e) => click(e, sh.path)} oncontextmenu={(e) => menu(e, sh.path)}
            ondragstart={(e) => dragStart(e, sh.path)} ondragover={(e) => dragOver(e, sh)} ondragleave={() => (dropAt = null)} ondrop={(e) => drop(e, sh)}
            ondblclick={() => window.dispatchEvent(new CustomEvent('moshe:focus-editor'))} onkeydown={() => {}}>
            {#if sh.glued || prevGlued}<span class="glue" style="background:{glueColor};top:{prevGlued ? 0 : 14}px;bottom:{sh.glued ? 0 : 14}px"></span>{/if}
            {#if showDates}<div class="date">{fmtDate(sh.modified)}</div>{/if}
            <div class="marks">
              {#if sh.goal}{@const g = store.goalProgress(sh.goal, sh.stats)}<span class="gring" class:done={g.reached} class:over={g.over} style="--p:{Math.min(1, g.fraction)}" title="Goal"></span>{/if}
              {#if sh.favorite}<Icon name="star" size={11} fill="currentColor" stroke={1.2} />{/if}
              {#if sh.material}<Icon name="paperclip" size={12} />{/if}
              {#if sh.notes.length}<Icon name="message-square" size={11} />{/if}
            </div>
            {#if sh.empty}
              <div class="line placeholder">Empty sheet</div>
            {:else}
              <div class="pv" dir="auto" style="-webkit-line-clamp:{prefs.previewLines}">{#each sh.preview as p, i}{#if p.heading}{#if i > 0}<br />{/if}<b>{p.text}</b><br />{:else}{p.text}{' '}{/if}{/each}</div>
            {/if}
            {#if sh.keywords.length}
              <div class="kws">{#each sh.keywords as kw}<span class="kw" style={kwColors[kw] ? `--kw:${colorOf(kwColors[kw])}` : ''}>{kw}</span>{/each}</div>
            {/if}
          </div>
        {/each}
        {#if s.depth === 0 && !s.sheets.length && shown.length === 1}
          {#if emptyLibrary && !filtering}
            <div class="welcome">
              <b>Your library is empty</b>
              <p>Every sheet you write here is a Markdown file in <code>Notes/</code>, and every group a folder. Press ⌘N to start a sheet, or begin with a short tour.</p>
              <button class="btn primary" onclick={welcome}>Add “Getting Started”</button>
              <button class="btn" onclick={() => newSheet()}>New Sheet</button>
            </div>
          {:else}
            <div class="empty">{filtering && query ? 'No Matches' : 'No Sheets'}</div>
          {/if}
        {/if}
      {/each}
      {#if list.group && manual}
        <div class="tail" role="presentation" ondragover={(e) => { if (ui.drag && ui.drag.kind === 'sheets') { e.preventDefault(); } }}
          ondrop={(e) => { e.preventDefault(); const d = ui.drag; ui.drag = null; if (d) { store.moveSheets(d.paths.filter((p) => p.slice(0, p.lastIndexOf('/')) !== list.group), list.group); const order = store.sheetsIn(list.group).filter((p) => !d.paths.includes(p)); store.reorderSheets(list.group, [...order, ...d.paths.map((p) => list.group + '/' + p.split('/').pop())]); } }}
          ondblclick={() => newSheet()}></div>
      {/if}
    {/if}
  </div>
</section>

<style>
  .list.file-over { box-shadow: inset 0 0 0 3px var(--accent); }
  .list { background: var(--list-bg); height: 100%; display: flex; flex-direction: column; min-height: 0; outline: none; }
  header { display: flex; align-items: center; gap: 8px; padding: 0 16px; height: 43px; border-bottom: 1px solid var(--sep-strong); flex: none; }
  h2 { margin: 0; font-size: 17px; font-weight: 700; color: var(--group-title); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; letter-spacing: -0.01em; }
  .sort { border: 0; background: none; color: var(--icon-dim); padding: 3px; border-radius: 4px; display: flex; opacity: 0; }
  header:hover .sort { opacity: 1; }
  .sort:hover { background: var(--hint-bg); color: var(--icon); }
  .filter { display: flex; align-items: center; gap: 6px; margin: 8px 12px 0; padding: 0 8px; height: 28px; border-radius: 7px; background: var(--hint-bg); color: var(--muted); flex: none; }
  .filter input { flex: 1; border: 0; background: none; outline: none; font-size: 13px; min-width: 0; }
  .filter button { border: 0; background: none; color: var(--muted); padding: 0; display: flex; }
  .sheets { flex: 1; min-height: 0; padding: 10px 12px 40px; }
  .card { position: relative; padding: 15px 16px 15px; border-radius: 8px; color: var(--list-text); font-size: 13px; line-height: 18px; cursor: default; }
  .card:not(.sel)::after { content: ''; position: absolute; left: 14px; right: 14px; bottom: 0; height: 1px; background: var(--sep); }
  .card.sel { background: var(--sel-grey); }
  .card.sel.focus { background: var(--accent-focus); color: var(--on-accent); }
  .card.sel.focus .date, .card.sel.focus .origin, .card.sel.focus .marks { color: color-mix(in srgb, var(--on-accent) 70%, transparent); }
  .card.material { background-image: repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in srgb, var(--sep) 55%, transparent) 6px 7px); }
  .card.sel.material { background-image: none; }
  .card.drop-before { box-shadow: 0 -2px 0 var(--accent); }
  .card.drop-after { box-shadow: 0 2px 0 var(--accent); }
  .glue { position: absolute; left: 4px; width: 3px; border-radius: 2px; }
  .line { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .line.heading { font-weight: 700; }
  .pv { display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
  .pv b { font-weight: 700; }
  .line.placeholder { color: var(--muted); font-style: italic; }
  .date { font-size: 11px; color: var(--muted); margin-bottom: 2px; }
  .marks { position: absolute; right: 12px; top: 15px; display: flex; gap: 4px; color: var(--muted); align-items: center; }
  .gring { width: 11px; height: 11px; border-radius: 50%; background: conic-gradient(#0a84ff calc(var(--p) * 360deg), var(--sep) 0); }
  .gring.done { background: #34c759; }
  .gring.over { background: #ff3b30; }
  .kws { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
  .kw { --kw: var(--section); font-size: 11px; line-height: 16px; padding: 0 7px; border-radius: 8px; background: color-mix(in srgb, var(--kw) 16%, transparent); color: color-mix(in srgb, var(--kw) 80%, var(--list-text)); }
  .card.sel.focus .kw { background: rgba(0, 0, 0, 0.1); color: var(--on-accent); }
  .subhead { font-size: 11px; font-weight: 700; color: var(--section); text-transform: uppercase; letter-spacing: 0.04em; padding: 14px 16px 4px; }
  .welcome { margin: 30vh 12px 0; padding: 16px 18px; background: var(--hint-bg); border: 1px solid var(--hint-border); border-radius: 10px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; font-size: 13px; line-height: 1.45; }
  .welcome p { margin: 0; color: var(--text); }
  .welcome code { font-size: 12px; }
  .empty { color: var(--muted); font-size: 15px; text-align: center; margin-top: 38vh; }
  .trash .origin { font-size: 11px; color: var(--muted); margin-top: 3px; }
  .trash .title { font-weight: 700; display: flex; gap: 5px; align-items: center; }
  .trash-foot { display: flex; justify-content: center; padding: 16px; }
  .tail { min-height: 120px; }
</style>
