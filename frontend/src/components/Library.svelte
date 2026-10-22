<script>
  // The library: the Notes section (the Inbox and its groups) and the
  // Projects; or, with a project open, that project alone, its groups and
  // its Extras.
  import Icon from './Icon.svelte';
  import GroupRow from './GroupRow.svelte';
  import { app, store, select, openProject, closeProject, persist, toast, prefs, trashWarning } from '../lib/state.svelte.js';
  import { ui, openMenu, menuUnder, openDialog, colorOf, confirm } from '../lib/ui.svelte.js';
  import { newGroup, newProject, projectMenu, editProject, newFilter, goalFor } from '../lib/actions.js';

  const lib = $derived.by(() => { app.version; return store ? store.library() : null; });
  const project = $derived.by(() => { app.version; return app.project && store && store.exists(app.project) ? store.projectNode(app.project) : null; });
  const projStats = $derived.by(() => { app.version; return project ? store.groupStats(project.path) : null; });
  const projGoal = $derived(project && project.goal ? store.goalProgress(project.goal, projStats, project.path) : null);
  let draggingProject = $state(null);
  let overProjects = $state(false);

  function dismiss(key) { app.hints = { ...app.hints, [key]: true }; persist(); }

  // the sections Settings › Sidebar switches (library settings, so read again when the library changes)
  const show = $derived.by(() => {
    app.version;
    const on = (k, d) => (store ? store.setting(k, d) : d);
    return { global: on('globalFilters', false), notes: on('showNotes', true), projects: on('showProjects', true), trash: on('alwaysShowTrash', false) };
  });
  function item(sel, label, icon, count = null) { return { sel, label, icon, count }; }
  async function emptyTrash() {
    if (await confirm('Empty the Trash?', trashWarning(), 'Empty Trash', true)) store.emptyTrash();
  }

  function dropOnProjects(e) {
    e.preventDefault();
    overProjects = false;
    const d = ui.drag;
    ui.drag = null;
    if (d && d.kind === 'group' && d.paths[0].startsWith('Notes/')) {
      const p = store.groupToProject(d.paths[0]);
      toast('Converted to a project');
      openProject(p);
    }
  }

  function projectDragStart(e, p) { draggingProject = p.path; ui.drag = { kind: 'project', paths: [p.path] }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', p.name); }
  function projectDrop(e, p) {
    e.preventDefault();
    const d = ui.drag;
    ui.drag = null;
    draggingProject = null;
    if (d && d.kind === 'project' && d.paths[0] !== p.path) {
      const names = lib.projects.map((x) => x.path).filter((x) => x !== d.paths[0]);
      names.splice(names.indexOf(p.path), 0, d.paths[0]);
      store.reorderProjects(names);
    } else if (d && d.kind === 'sheets') {
      store.moveSheets(d.paths, p.path);
      toast(`Moved to ${p.name} › Pending`);
    }
  }

  function fmtGoal(g) {
    if (!g) return '';
    const unit = { words: 'words', characters: 'characters', 'characters-no-spaces': 'characters', sentences: 'sentences', paragraphs: 'paragraphs', lines: 'lines', pages: 'pages', 'reading-time': 'minutes' }[g.metric] || 'words';
    return `${Number(g.count).toLocaleString()} ${unit}`;
  }
</script>

<nav class="library" aria-label="Library">
  <div class="scroll body">
    {#if lib && project}
      <!-- a project, and nothing else -->
      <div class="proj-head">
        <h1 class="proj-title" oncontextmenu={(e) => openMenu(e, projectMenu(project))}>{project.name}</h1>
        {#if project.goal}
          <button class="proj-goal" onclick={() => goalFor({ path: project.path, name: project.name, goal: project.goal })}>
            <Icon name="target" size={14} stroke={1.7} /> <span>{fmtGoal(project.goal)}</span>
            <span class="ring" style="--p:{Math.min(1, projGoal ? projGoal.fraction : 0)}" class:done={projGoal && projGoal.reached}></span>
          </button>
        {/if}
        <div class="proj-tools">
          <button class="mini" title="Statistics" onclick={(e) => openDialog('stats', { path: project.path, name: project.name, anchor: e.currentTarget.getBoundingClientRect() })}><Icon name="chart-line" size={15} /></button>
          <button class="mini" title="Export" onclick={() => openDialog('export', { paths: store.projectSheets(project.path).filter((x) => !store.sheetInfo(x).material), title: project.name, project: project.path })}><Icon name="share" size={15} /></button>
          <button class="mini" title="More" onclick={(e) => menuUnder(e.currentTarget, [
            { label: 'Edit Project…', action: () => editProject(project) },
            { label: project.goal ? 'Edit Goal…' : 'Add Goal…', icon: 'target', action: () => goalFor({ path: project.path, name: project.name, goal: project.goal }) },
            { label: 'New Filter…', icon: 'list-filter', action: () => newFilter(project.path) },
            { sep: true },
            { label: 'Duplicate Project', icon: 'copy', action: () => store.duplicateProject(project.path) },
            { label: 'Share Project…', icon: 'share', action: () => import('../lib/share.js').then((m) => m.shareProject(project.path)) },
            { label: 'Archive Project', icon: 'archive', action: () => { store.setArchived(project.path, true); closeProject(); } },
          ])}><Icon name="circle-ellipsis" size={15} /></button>
        </div>
      </div>
      <div class="rule"></div>

      {#if !app.hints.main}
        <div class="hint">This is the main space of your project. It’s where you put the texts you are actively working on.<button onclick={() => dismiss('main')}>Dismiss</button></div>
      {/if}
      {#each project.filters as f (f.path)}
        <div class="row" class:selected={app.selection === f.path} role="treeitem" aria-selected={app.selection === f.path} tabindex="-1" onclick={() => select(f.path)} onkeydown={() => {}}>
          <span class="ic" style="color:{app.selection === f.path ? 'var(--on-accent)' : colorOf(f.color, 'var(--accent-soft)')}"><Icon name={f.icon || 'list-filter'} size={18} stroke={1.5} /></span><span class="name">{f.name}</span>
        </div>
      {/each}
      {#each project.groups as g (g.path)}
        <GroupRow node={g} />
      {/each}
      {#if !project.groups.length}
        <button class="add-first" onclick={() => newGroup(project.path)}><Icon name="folder-plus" size={16} /> New Group</button>
      {/if}

      <div class="section"><span>Extras</span>
        <button class="sec-add" title="Add a group to Extras" onclick={() => newGroup(`${project.path}/Extras`)}><Icon name="circle-ellipsis" size={14} /></button>
      </div>
      {#if !app.hints.extras}
        <div class="hint">This is where you put everything else. It’s like a virtual rug (or filing cabinet).<button onclick={() => dismiss('extras')}>Dismiss</button></div>
      {/if}
      {#each project.extras as g (g.path)}
        <GroupRow node={g} />
      {/each}
      {#if project.pending}
        <div class="row" class:selected={app.selection === `${project.path}#pending`} role="treeitem" aria-selected="false" tabindex="-1" onclick={() => select(`${project.path}#pending`)} onkeydown={() => {}}>
          <span class="ic"><Icon name="inbox" size={18} stroke={1.5} /></span><span class="name">Pending</span><span class="count">{project.pending}</span>
        </div>
      {/if}
      {#if project.favoritesCount}
        <div class="row" class:selected={app.selection === `${project.path}#favorites`} role="treeitem" aria-selected="false" tabindex="-1" onclick={() => select(`${project.path}#favorites`)} onkeydown={() => {}}>
          <span class="ic"><Icon name="star" size={18} stroke={1.5} /></span><span class="name">Favorites</span>
        </div>
      {/if}
      {#if project.trashCount}
        <div class="row" class:selected={app.selection === `${project.path}#trash`} role="treeitem" aria-selected="false" tabindex="-1" onclick={() => select(`${project.path}#trash`)} onkeydown={() => {}}>
          <span class="ic"><Icon name="trash-2" size={18} stroke={1.5} /></span><span class="name">Trash</span>
        </div>
      {/if}
    {:else if lib}
      <!-- the whole library: its sections, each switched in Settings › Sidebar -->
      {@const globalOn = show.global}
      {@const trashShown = lib.trashCount || show.trash}
      {#snippet fixedRow(it)}
        <div class="row" class:selected={app.selection === it.sel} role="treeitem" aria-selected={app.selection === it.sel} tabindex="-1" onclick={() => select(it.sel)}
          oncontextmenu={(e) => { if (it.sel === 'trash' && lib.trashCount) openMenu(e, [{ label: 'Empty Trash…', icon: 'trash-2', action: emptyTrash }]); }} onkeydown={() => {}}>
          <span class="ic"><Icon name={it.icon} size={18} stroke={1.5} /></span><span class="name">{it.label}</span>
        </div>
      {/snippet}
      {#if globalOn}
        <div class="section first"><span>Filters</span></div>
        {#each [item('all', 'All', 'drawers'), item('recent', 'Last 7 Days', 'calendar'), ...(lib.favoritesCount ? [item('favorites', 'Favorites', 'star')] : []), ...(trashShown ? [item('trash', 'Trash', 'trash-2')] : [])] as it (it.sel)}
          {@render fixedRow(it)}
        {/each}
      {/if}
      {#if show.notes}
        <div class="section" class:first={!globalOn}><span>Notes</span>
          <button class="sec-add" title="Add…" onclick={(e) => menuUnder(e.currentTarget, [
            { label: 'New Group…', icon: 'folder-plus', action: () => newGroup('Notes') },
            { label: 'New Filter…', icon: 'list-filter', action: () => newFilter('Notes') },
          ])}><Icon name="circle-ellipsis" size={14} /></button>
        </div>
        {@render fixedRow(item('notes-all', 'All', 'drawers'))}
        <GroupRow node={lib.inbox} />
        {#each lib.notesFilters as f (f.path)}
          <div class="row" class:selected={app.selection === f.path} role="treeitem" aria-selected={app.selection === f.path} tabindex="-1" onclick={() => select(f.path)}
            oncontextmenu={(e) => openMenu(e, [{ label: 'Delete Filter', action: () => store.removeFilter(f.path) }])} onkeydown={() => {}}>
            <span class="ic" style="color:{app.selection === f.path ? 'var(--on-accent)' : colorOf(f.color, 'var(--accent-soft)')}"><Icon name={f.icon || 'list-filter'} size={18} stroke={1.5} /></span><span class="name">{f.name}</span>
          </div>
        {/each}
        {#each lib.groups as g (g.path)}
          <GroupRow node={g} />
        {/each}
        {#if !globalOn}
          {#if lib.favoritesCount}{@render fixedRow(item('favorites', 'Favorites', 'star'))}{/if}
          {#if trashShown}{@render fixedRow(item('trash', 'Trash', 'trash-2'))}{/if}
        {/if}
      {/if}

      {#if show.projects}
      <div class="section" class:first={!globalOn && !show.notes} class:over={overProjects} role="group" ondragover={(e) => { if (ui.drag && ui.drag.kind === 'group') { e.preventDefault(); overProjects = true; } }}
        ondragleave={() => (overProjects = false)} ondrop={dropOnProjects}><span>Projects</span>
        <button class="sec-add" title="Add Project…" onclick={() => newProject()}><Icon name="circle-ellipsis" size={14} /></button>
      </div>
      {#each lib.projects as p (p.path)}
        <div class="row proj" role="treeitem" aria-selected="false" tabindex="-1" draggable="true"
          ondragstart={(e) => projectDragStart(e, p)} ondragover={(e) => { if (ui.drag) e.preventDefault(); }} ondrop={(e) => projectDrop(e, p)}
          onclick={() => openProject(p.path)} oncontextmenu={(e) => openMenu(e, projectMenu(p))} onkeydown={() => {}}>
          <span class="ic" style="color:{colorOf(p.color, 'var(--accent-fg)')}"><Icon name={p.icon || 'book'} size={18} stroke={1.5} /></span><span class="name">{p.name}</span>
        </div>
      {/each}
      {#if !lib.projects.length}
        <button class="add-first" onclick={() => newProject()}><Icon name="plus" size={15} /> Add Project…</button>
      {/if}
      {/if}
      {#if lib.archived.length && store.setting('showArchive', true)}
        <div class="section"><span>Archive</span></div>
        {#each lib.archived as p (p.path)}
          <div class="row proj archived" role="treeitem" aria-selected="false" tabindex="-1"
            onclick={() => openProject(p.path)} oncontextmenu={(e) => openMenu(e, projectMenu(p))} onkeydown={() => {}}>
            <span class="ic" style="color:{colorOf(p.color, 'var(--accent-fg)')}"><Icon name={p.icon || 'book'} size={18} stroke={1.5} /></span><span class="name">{p.name}</span>
          </div>
        {/each}
      {/if}
    {/if}
  </div>
</nav>

<style>
  .library { background: var(--sidebar-bg); height: 100%; display: flex; flex-direction: column; min-height: 0; }
  .body { flex: 1; min-height: 0; padding-bottom: 24px; }
  .section { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px 4px 17px; font-size: 11px; font-weight: 600; color: var(--section); height: 34px; }
  .section.first { padding-top: 0; padding-bottom: 0; height: 11px; overflow: visible; }
  .section.over { background: var(--accent-tint); }
  .sec-add { border: 0; background: none; color: var(--section); padding: 0; opacity: 0; display: flex; }
  .section:hover .sec-add { opacity: 1; }
  .row { height: 32px; display: flex; align-items: center; gap: 7px; margin: 0 10px; padding: 0 10px 0 17px; border-radius: 7px; color: var(--text-strong); font-size: 13px; cursor: default; }
  .row:focus { outline: none; }
  .row.selected { background: var(--accent); color: var(--on-accent); font-weight: 600; }
  .row.selected .ic { color: var(--on-accent) !important; }
  .row.archived { opacity: 0.65; }
  .ic { display: flex; color: var(--accent-fg); }
  .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .count { color: var(--section); font-size: 12px; }
  .row.selected .count { color: color-mix(in srgb, var(--on-accent) 70%, transparent); }
  .add-first { margin: 4px 22px; border: 0; background: none; color: var(--accent-soft); display: flex; gap: 6px; align-items: center; padding: 6px 0; font-size: 13px; }

  .proj-head { padding: 2px 22px 12px 29px; }
  .proj-title { font-size: 21px; line-height: 1.25; font-weight: 700; color: var(--group-title); margin: 0 0 10px; letter-spacing: -0.01em; word-break: break-word; }
  .proj-goal { display: flex; align-items: center; gap: 7px; border: 0; background: none; padding: 0; color: var(--group-title); font-size: 13px; width: 100%; margin-bottom: 14px; }
  .proj-goal span:nth-child(2) { flex: 1; text-align: left; }
  .ring { width: 14px; height: 14px; border-radius: 50%; background: conic-gradient(var(--accent) calc(var(--p) * 360deg), var(--sel-grey) 0); }
  .ring.done { background: #36c759; }
  .proj-tools { display: flex; gap: 12px; color: #7d7d7d; }
  .mini { border: 0; background: none; padding: 2px; color: #7d7d7d; display: flex; border-radius: 4px; }
  .mini:hover { background: var(--hint-bg); }
  .rule { height: 1px; background: var(--sep); margin: 0 16px 18px 18px; }
  .hint {
    margin: 0 10px 14px; padding: 12px 18px 10px 20px; background: var(--hint-bg); border: 1px solid var(--hint-border); border-radius: 9px;
    font-size: 12px; line-height: 1.42; color: var(--text-strong);
  }
  .hint button { display: block; border: 0; background: none; padding: 9px 0 0; margin-top: 9px; color: var(--accent-soft); font-size: 12px; width: 100%; text-align: left; border-top: 1px solid var(--hint-border); }
</style>
