<script>
  // A group in the library: its icon and name, its subgroups under a
  // disclosure, and a place to drop sheets and groups.
  import Icon from './Icon.svelte';
  import GroupRow from './GroupRow.svelte';
  import { app, store, select, persist, toast } from '../lib/state.svelte.js';
  import { ui, openMenu, colorOf } from '../lib/ui.svelte.js';
  import { groupMenu } from '../lib/actions.js';

  let { node, depth = 0 } = $props();

  const selected = $derived(app.selection === node.path);
  const open = $derived(app.expanded[node.path] ?? false);
  const hasKids = $derived(node.groups.length > 0 || node.filters.length > 0);
  let over = $state(null);    // 'into' | 'before' | 'after'

  function toggle(e) {
    e.stopPropagation();
    app.expanded = { ...app.expanded, [node.path]: !open };
    persist();
  }

  function dragStart(e) {
    if (node.path === 'Notes' || node.templates) { e.preventDefault(); return; }
    ui.drag = { kind: 'group', paths: [node.path] };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', node.name);
  }

  function dragOver(e) {
    if (!ui.drag && e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files')) { e.preventDefault(); over = 'into'; e.dataTransfer.dropEffect = 'copy'; return; }
    const d = ui.drag;
    if (!d) return;
    if (d.kind === 'group' && (d.paths[0] === node.path || node.path.startsWith(d.paths[0] + '/'))) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - r.top;
    if (d.kind === 'sheets' || node.path === 'Notes') over = 'into';
    else over = y < r.height * 0.25 ? 'before' : y > r.height * 0.75 ? 'after' : 'into';
    e.dataTransfer.dropEffect = d.kind === 'sheets' && node.templates ? 'copy' : 'move';
  }

  function drop(e) {
    e.preventDefault();
    if (!ui.drag && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      over = null;
      import('../lib/importer.js').then((m) => m.importFiles([...e.dataTransfer.files], node.path));
      return;
    }
    const d = ui.drag;
    const where = over;
    over = null;
    ui.drag = null;
    if (!d) return;
    try {
      if (d.kind === 'sheets') {
        store.moveSheets(d.paths, node.path);
        toast(node.templates ? `Copied to ${node.name}` : `Moved to ${node.name}`);
      } else if (d.kind === 'group') {
        const parent = node.path.slice(0, node.path.lastIndexOf('/'));
        if (where === 'into') store.moveGroup(d.paths[0], node.path);
        else {
          const siblings = store.subgroups(parent).filter((g) => g !== d.paths[0]);
          const i = siblings.indexOf(node.path) + (where === 'after' ? 1 : 0);
          store.moveGroup(d.paths[0], parent, i);
        }
      }
    } catch (err) { toast(err.message); }
  }

  const iconColor = $derived(selected ? 'var(--on-accent)' : colorOf(node.color, null));
</script>

<div class="row" class:selected class:over-into={over === 'into'} class:over-before={over === 'before'} class:over-after={over === 'after'}
  style="padding-left:{17 + depth * 14}px;--disc:{depth * 14 + 2}px" role="treeitem" aria-selected={selected} tabindex="-1"
  draggable={node.path !== 'Notes' && !node.templates}
  ondragstart={dragStart} ondragover={dragOver} ondragleave={() => (over = null)} ondrop={drop}
  onclick={() => select(node.path)}
  oncontextmenu={(e) => openMenu(e, groupMenu(node))}
  onkeydown={() => {}}>
  {#if hasKids}
    <button class="disc" class:open onclick={toggle} aria-label={open ? 'Collapse' : 'Expand'}><Icon name="chevron-right" size={11} stroke={2.4} /></button>
  {/if}
  <span class="ic" class:tinted={!node.color && !selected} style={iconColor ? `color:${iconColor}` : ''}>
    <Icon name={node.icon === 'inbox' ? 'tray' : node.icon || (node.templates ? 'folder' : 'sheets')} size={19} stroke={1.5} />
  </span>
  <span class="name">{node.name}</span>
  {#if node.path === 'Notes' && store.setting('inboxCounter', false) && node.count}<span class="count">{node.count}</span>{/if}
  {#if node.goal}
    {@const g = store.goalProgress(node.goal, store.groupStats(node.path), node.path)}
    <span class="gring" class:done={g.reached} class:over={g.over} style="--p:{Math.min(1, g.fraction)}" title="{g.value.toLocaleString()} of {g.target.toLocaleString()}"></span>
  {/if}
</div>

{#if hasKids && open}
  {#each node.filters as f (f.path)}
    <div class="row" class:selected={app.selection === f.path} style="padding-left:{17 + (depth + 1) * 14}px" role="treeitem" aria-selected={app.selection === f.path} tabindex="-1"
      onclick={() => select(f.path)} oncontextmenu={(e) => openMenu(e, groupMenu({ ...f, filter: true }))} onkeydown={() => {}}>
      <span class="ic" style={app.selection === f.path ? 'color:var(--on-accent)' : `color:${colorOf(f.color, 'var(--accent-soft)')}`}><Icon name={f.icon || 'list-filter'} size={18} stroke={1.5} /></span>
      <span class="name">{f.name}</span>
    </div>
  {/each}
  {#each node.groups as g (g.path)}
    <GroupRow node={g} depth={depth + 1} />
  {/each}
{/if}

<style>
  .row {
    height: 32px; display: flex; align-items: center; gap: 7px; margin: 0 10px; padding-right: 10px;
    border-radius: 7px; color: var(--text-strong); font-size: 13px; cursor: default; position: relative;
  }
  .row:focus { outline: none; }
  .row.selected { background: var(--accent); color: var(--on-accent); font-weight: 600; }
  .row.over-into { background: var(--accent-tint); box-shadow: inset 0 0 0 2px var(--accent); }
  .row.over-before::before, .row.over-after::after {
    content: ''; position: absolute; left: 8px; right: 8px; height: 2px; background: var(--accent); border-radius: 1px;
  }
  .row.over-before::before { top: -1px; }
  .row.over-after::after { bottom: -1px; }
  .disc { position: absolute; left: var(--disc); top: 9px; width: 14px; height: 14px; border: 0; background: none; padding: 0; display: flex; align-items: center; justify-content: center; color: var(--section); transition: transform 0.12s; }
  .row.selected .disc { color: var(--on-accent); }
  .disc.open { transform: rotate(90deg); }
  .ic { display: flex; color: var(--accent-fg); }
  .ic.tinted { color: color-mix(in srgb, var(--accent-fg) 85%, var(--sidebar-bg)); }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .count { color: var(--section); font-size: 12px; }
  .row.selected .count { color: color-mix(in srgb, var(--on-accent) 70%, transparent); }
  .gring { width: 13px; height: 13px; border-radius: 50%; background: conic-gradient(#0a84ff calc(var(--p) * 360deg), var(--sel-grey) 0); flex: none; }
  .gring.done { background: #34c759; }
  .gring.over { background: #ff3b30; }
</style>
