<script>
  // The dashboard (⌘4): everything about the open sheet that is not its
  // text. Overview, Progress, Outline, Attachments, Annotations; and the
  // sheets that link here. With voice on, Voice and Words (VoicePanel.svelte).
  import Icon from './Icon.svelte';
  import VoicePanel from './VoicePanel.svelte';
  import { app, prefs, store, persist, openSheet, toast } from '../lib/state.svelte.js';
  import { openDialog, colorOf, menuUnder } from '../lib/ui.svelte.js';
  import { goalFor } from '../lib/actions.js';
  import { check, checkText, probeCheck } from '../lib/check.svelte.js';
  import { wanted } from '../editor/proof.js';
  import { outline, splitSheet, stats as statsOf } from '@engine/sheet.js';
  import { EditorSelection } from '@codemirror/state';
  import { EditorView } from '@codemirror/view';

  let { pane } = $props();
  const VIEWS = $derived([['overview', 'layout-grid', 'Overview'], ['progress', 'chart-line', 'Progress'], ['outline', 'list', 'Outline'], ['attachments', 'image', 'Attachments'], ['annotations', 'message-square', 'Annotations'],
    ...(prefs.voice.on ? [['voice', 'mic', 'Voice'], ['words', 'book-a', 'Words']] : [])]);

  const info = $derived.by(() => { app.version; return app.sheet && store && store.exists(app.sheet) ? store.sheetInfo(app.sheet) : null; });
  const body = $derived.by(() => { app.version; return info ? splitSheet(store.text(info.path) || '').body : ''; });
  const items = $derived(info ? outline(body) : []);
  const st = $derived(info ? info.stats : null);
  const goal = $derived(info && info.goal ? store.goalProgress(info.goal, st) : null);
  const links = $derived.by(() => { app.version; return info ? backlinks(info) : []; });
  let noteEdit = $state(null);   // {i, text}
  let kwAdd = $state('');
  let kwInput = $state(null);
  // the overview's sections; which are shown is the viewer's own
  const SECTIONS = [['progress', 'Progress'], ['dates', 'Dates'], ['keywords', 'Keywords'], ['incoming', 'Incoming Links'], ['outline', 'Outline'], ['links', 'Links'], ['annotations', 'Annotations'], ['media', 'Media'], ['footnotes', 'Footnotes'], ['notes', 'Notes']];
  const OVERVIEW_LISTS = [['incoming', 'Incoming Links'], ['outline', 'Outline'], ['links', 'Links'], ['annotations', 'Annotations'], ['media', 'Media'], ['footnotes', 'Footnotes']];
  const folded = $derived(prefs.dashFolded || {});
  const fold = (k) => { prefs.dashFolded = { ...folded, [k]: !folded[k] }; persist(); };
  const shown = $derived({ ...Object.fromEntries(SECTIONS.map(([k]) => [k, true])), ...(prefs.dashSections || {}) });

  function backlinks(s) {
    const name = s.name.replace(/\.md$/u, '');
    const title = s.title;
    const out = [];
    for (const p of store.allSheets(true)) {
      if (p === s.path) continue;
      const t = store.text(p) || '';
      if (t.includes(`[[${name}`) || (title && t.includes(`[[${title}`)) || t.includes(`](${encodeURI(s.name)})`) || t.includes(`](${s.name})`)) out.push(store.sheetInfo(p));
    }
    return out;
  }

  function jump(at) {
    const v = pane && pane.activeView();
    if (!v) return;
    v.dispatch({ selection: EditorSelection.cursor(Math.min(at, v.state.doc.length)), effects: EditorView.scrollIntoView(at, { y: 'start', yMargin: 80 }) });
    v.focus();
  }

  function setView(v) { app.dashboardView = v; persist(); }
  // File › Attach Note…: a new note, as ⊕ does
  $effect(() => { const add = () => { if (info) noteEdit = { i: -1, text: '' }; }; window.addEventListener('moshe:add-note', add); return () => window.removeEventListener('moshe:add-note', add); });

  // Check Text: the sheet read by LanguageTool on the server
  $effect(() => { if (app.dashboardView === 'annotations') probeCheck(); });
  const checking = $derived(check.status === 'checking' || check.status === 'starting');
  const mine = $derived.by(() => {
    app.version;
    if (check.path !== app.sheet || !check.results) return null;
    const ignored = new Set(store.proofIgnored(app.sheet));
    return check.results.filter((f) => wanted(f, ignored));
  });
  function runCheck() {
    const v = pane && pane.activeView();
    if (!v || !app.sheet) return;
    app.revision = true;
    checkText(app.sheet, v.state.doc.toString());
  }
  const showFinding = (f) => window.dispatchEvent(new CustomEvent('moshe:show-finding', { detail: { id: f.id } }));
  const CHECK_GROUPS = [['sp', 'Spelling'], ['gr', 'Grammar'], ['st', 'Style'], ['pu', 'Punctuation']];
  function addKw() {
    const k = kwAdd.trim();
    if (!k || !info) return;
    if (!info.keywords.includes(k)) store.setSheetMeta(info.path, { keywords: [...info.keywords, k] });
    kwAdd = '';
  }
  function saveNote() {
    if (!noteEdit || !info) return;
    const notes = [...info.notes];
    if (noteEdit.text.trim()) { if (noteEdit.i < 0) notes.push(noteEdit.text.trim()); else notes[noteEdit.i] = noteEdit.text.trim(); } else if (noteEdit.i >= 0) notes.splice(noteEdit.i, 1);
    store.setSheetMeta(info.path, { notes });
    noteEdit = null;
  }
  const fmt = (ms) => (ms ? new Date(ms).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const fmtTime = (s) => { const m = Math.floor(s / 60), r = s % 60; return m ? `${m} min ${r} sec` : `${r} sec`; };
  const kinds = { heading: 'Headings', link: 'Links', footnote: 'Footnotes', annotation: 'Annotations', comment: 'Comments', mark: 'Marked', delete: 'Deletions', image: 'Images' };
  const kwColors = $derived.by(() => { app.version; return store ? Object.fromEntries(store.keywords(app.project).map((k) => [k.name, k.color])) : {}; });
  const goalUnit = (g) => ({ words: 'words', characters: 'characters', 'characters-no-spaces': 'characters', sentences: 'sentences', paragraphs: 'paragraphs', lines: 'lines', pages: 'pages', 'reading-time': 'min' }[g.metric] || 'words');
  const goalType = (g) => ({ 'at-least': 'at least', 'at-most': 'at most', about: 'about', daily: 'every day' }[g.type]);
</script>

{#snippet head(key, label)}
  <button class="fold" class:shut={!!folded[key]} onclick={() => fold(key)} aria-expanded={!folded[key]}><Icon name="chevron-down" size={10} stroke={2.4} />{label}</button>
{/snippet}

<aside class="dash">
  <div class="tabs">
    {#each VIEWS as [v, ic, label]}
      <button class:on={app.dashboardView === v} title={label} onclick={() => setView(v)}><Icon name={ic} size={16} /></button>
    {/each}
  </div>
  <div class="scroll body">
    {#if prefs.voice.on && (app.dashboardView === 'voice' || app.dashboardView === 'words')}
      <VoicePanel view={app.dashboardView} />
    {:else if !info}
      <div class="none">No Sheet Selected</div>
    {:else if app.dashboardView === 'overview'}
      <!-- the overview: sections the ⫶ button below shows or hides -->
      {#if shown.progress}
        <section>
          <h4>{@render head('progress', 'Progress')} {#if !goal}<button class="add" title="Add a Goal" aria-label="Add a goal" onclick={() => goalFor({ sheet: true, path: info.path, goal: null })}><Icon name="circle-plus" size={13} /></button>{/if}</h4>
          {#if folded.progress}{:else if goal}
            <button class="ringrow" title="Edit Goal…" onclick={() => goalFor({ sheet: true, path: info.path, goal: info.goal })}>
              <svg class="ring" class:done={goal.reached} class:over={goal.over} viewBox="0 0 40 40" aria-hidden="true">
                <circle class="disc" cx="20" cy="20" r="15.5" />
                <circle class="arc" cx="20" cy="20" r="17" pathLength="100" stroke-dasharray="{Math.max(0.01, Math.min(1, goal.fraction) * 100)} 100" transform="rotate(-90 20 20)" />
              </svg>
              <span><small>{goal.over ? 'Over the limit' : goal.reached ? 'Done!' : goal.fraction >= 0.85 ? 'Almost done!' : 'Already'}</small><b>{goal.value.toLocaleString()}</b><small>{goalUnit(info.goal)} of {goalType(info.goal)} {goal.target.toLocaleString()}</small></span>
            </button>
          {:else}
            <div class="kv"><span>Characters</span>{st.characters.toLocaleString()}</div>
            <div class="kv"><span>Words</span>{st.words.toLocaleString()}</div>
            <div class="kv"><span>Average</span>{fmtTime(st.reading.average)}</div>
          {/if}
        </section>
      {/if}
      {#if shown.dates}
        <section>
          <div class="kv"><span>Created</span>{fmt(info.created)}</div>
          <div class="kv"><span>Modified</span>{fmt(info.modified)}</div>
          <div class="kv"><span>File</span><code title={info.path}>{info.path}</code></div>
        </section>
      {/if}
      {#if shown.keywords}
        <section>
          <h4>{@render head('keywords', 'Keywords')} <button class="add" title="Add a Keyword" aria-label="Add a keyword" onclick={() => kwInput && kwInput.focus()}><Icon name="circle-plus" size={13} /></button></h4>
          <div class="kws" hidden={!!folded.keywords}>
            {#each info.keywords as k}
              <span class="kw" style={kwColors[k] ? `--kw:${colorOf(kwColors[k])}` : ''}>{k}<button onclick={() => store.setSheetMeta(info.path, { keywords: info.keywords.filter((x) => x !== k) })} aria-label="Remove"><Icon name="x" size={10} /></button></span>
            {/each}
            <input class="kwin" placeholder="Add keyword" bind:this={kwInput} bind:value={kwAdd} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addKw(); } }} list="dash-kw" />
            <datalist id="dash-kw">{#each store.keywords(app.project) as k}<option value={k.name}></option>{/each}</datalist>
          </div>
        </section>
      {/if}
      {#each OVERVIEW_LISTS as [key, label]}
        {#if shown[key]}
          {@const list = key === 'incoming' ? links : key === 'outline' ? items.filter((x) => x.kind === 'heading') : items.filter((x) => x.kind === ({ links: 'link', annotations: 'annotation', media: 'image', footnotes: 'footnote' })[key])}
          <section>
            <h4>{@render head(key, label)}</h4>
            {#each folded[key] ? [] : list as x}
              {#if key === 'incoming'}
                <button class="ol" onclick={() => openSheet(x.path)}><i class="dot"></i><span>{x.title || x.name}</span></button>
              {:else}
                <button class="ol" style={key === 'outline' ? `padding-left:${(x.level - 1) * 12 + 4}px` : ''} onclick={() => jump(x.at)} title={x.url || x.note || ''}><i class="dot"></i><span>{x.text || x.url || '—'}</span></button>
              {/if}
            {/each}
          </section>
        {/if}
      {/each}
      {#if shown.notes}
        <section>
          <h4>{@render head('notes', 'Notes')} <button class="add" title="Add a Note" aria-label="Add a note" onclick={() => (noteEdit = { i: -1, text: '' })}><Icon name="circle-plus" size={13} /></button></h4>
          {#each folded.notes ? [] : info.notes as n, i}
            <button class="note" onclick={() => (noteEdit = { i, text: n })}>{n}</button>
          {/each}
        </section>
      {/if}
      <div class="custom">
        <button class="sliders" title="Show or hide sections" aria-label="Show or hide sections" onclick={(e) => menuUnder(e.currentTarget, [
          ...SECTIONS.map(([k, label]) => ({ label, checked: shown[k], action: () => { prefs.dashSections = { ...shown, [k]: !shown[k] }; persist(); } })),
          { sep: true },
          { label: 'Manage Keywords…', action: () => openDialog('keywordManager') },
        ], 'right')}><Icon name="sliders-vertical" size={14} /></button>
      </div>

    {:else if app.dashboardView === 'progress'}
      {@const pst = app.selectionStats || st}
      <section>
        <h4>{app.selectionStats ? 'Selection' : 'Progress'}</h4>
        <table class="stats"><tbody>
          <tr><th>Characters</th><td>{pst.characters.toLocaleString()}</td></tr>
          <tr><th>Without Spaces</th><td>{pst.charactersNoSpaces.toLocaleString()}</td></tr>
          <tr class="gap"><th>Words</th><td>{pst.words.toLocaleString()}</td></tr>
          <tr><th>Sentences</th><td>{pst.sentences.toLocaleString()}</td></tr>
          <tr><th>Paragraphs</th><td>{pst.paragraphs.toLocaleString()}</td></tr>
          <tr><th>Pages</th><td>{pst.pages}</td></tr>
          <tr class="gap"><th>Reading Time</th><td></td></tr>
          <tr><th>Slow</th><td>{fmtTime(pst.reading.slow)}</td></tr>
          <tr><th>Average</th><td>{fmtTime(pst.reading.average)}</td></tr>
          <tr><th>Fast</th><td>{fmtTime(pst.reading.fast)}</td></tr>
          <tr><th>Aloud</th><td>{fmtTime(pst.reading.aloud)}</td></tr>
        </tbody></table>
      </section>
      <section>
        <h4>Goal</h4>
        {#if goal}
          <div class="bigring" style="--p:{Math.min(1, goal.fraction)}" class:done={goal.reached} class:over={goal.over}>
            <div><small>{goal.reached ? 'Done' : 'Already'}</small><b>{goal.value.toLocaleString()}</b><small>{goalUnit(info.goal)}</small></div>
          </div>
          <p class="center dim">of {goalType(info.goal)} {goal.target.toLocaleString()} {goalUnit(info.goal)}{#if info.goal.deadline}<br />by {info.goal.deadline} · {goal.perDay.toLocaleString()} a day{/if}</p>
          <button class="link center" onclick={() => goalFor({ sheet: true, path: info.path, goal: info.goal })}>Edit Goal…</button>
        {:else}
          <button class="link" onclick={() => goalFor({ sheet: true, path: info.path, goal: null })}><Icon name="target" size={13} /> Add a Goal</button>
        {/if}
      </section>

    {:else if app.dashboardView === 'outline'}
      {#each Object.entries(kinds) as [k, label]}
        {@const list = items.filter((x) => x.kind === k)}
        {#if list.length}
          <section>
            <h4>{label}</h4>
            {#each list as x}
              <button class="ol" style={k === 'heading' ? `padding-left:${(x.level - 1) * 12 + 4}px` : ''} onclick={() => jump(x.at)} title={x.url || x.note || ''}>
                {#if k === 'link'}<Icon name="link" size={12} />{:else if k === 'footnote'}<span class="fn">＊</span>{/if}
                <span>{x.text || x.url || '—'}</span>
              </button>
            {/each}
          </section>
        {/if}
      {/each}
      {#if !items.length}<div class="none small">Headings, links, footnotes and annotations will appear here.</div>{/if}

    {:else if app.dashboardView === 'attachments'}
      <section>
        <h4>Images in the Text</h4>
        {#each items.filter((x) => x.kind === 'image') as im}
          <button class="ol" onclick={() => jump(im.at)}><Icon name="image" size={13} /> <span>{im.text || im.url}</span></button>
        {:else}
          <p class="dim small">Type (img) in the text, or drop an image there.</p>
        {/each}
      </section>

    {:else if app.dashboardView === 'annotations'}
      <div class="revision">
        <label><input type="checkbox" bind:checked={app.revision} onchange={() => { if (!app.revision) app.revisionKind = null; }} /> Revision Mode</label>
      </div>
      {#if check.available}
        <section class="checktext">
          <button class="btn" onclick={runCheck} disabled={checking}>{check.status === 'starting' ? 'Waking the checker…' : checking ? 'Checking…' : mine ? 'Check Again' : 'Check Text'}</button>
          {#if mine && !checking}<span class="dim small">{mine.length ? `${mine.length} suggestion${mine.length === 1 ? '' : 's'}` : 'Nothing found'}{check.language ? ` · ${check.language}` : ''}</span>{/if}
          {#if check.status === 'error' && check.path === app.sheet}<p class="err small">{check.error}</p>{/if}
        </section>
        {#if mine}
          {#each CHECK_GROUPS as [cls, label]}
            {@const list = mine.filter((f) => f.cls === cls)}
            {#if list.length}
              <section>
                <h4><i class="kdot {cls}"></i>{label} <small>{list.length}</small></h4>
                {#each list as f (f.id)}
                  <button class="ann found" onclick={() => showFinding(f)}><span class="t">{f.problem}</span><span class="n">{f.short || f.message}</span></button>
                {/each}
              </section>
            {/if}
          {/each}
        {/if}
      {/if}
      {#each [['annotation', 'Annotations'], ['comment', 'Comments'], ['mark', 'Marked Text'], ['delete', 'Deletions'], ['insert', 'Insertions']] as [k, label]}
        {@const list = items.filter((x) => x.kind === k)}
        {#if list.length}
          <section>
            <h4><button class="kind" class:on={app.revision && app.revisionKind === k} title="Show only these in the text"
              onclick={() => { const on = !(app.revision && app.revisionKind === k); app.revision = true; app.revisionKind = on ? k : null; }}>{label} <small>{list.length}</small></button></h4>
            {#each list as x}
              <button class="ann {k}" onclick={() => jump(x.at)}>
                <span class="t">{x.text}</span>
                {#if x.note}<span class="n">{x.note}</span>{/if}
              </button>
            {/each}
          </section>
        {/if}
      {/each}
      <section>
        <h4>Notes</h4>
        {#each info.notes as n, i}<button class="note" onclick={() => (noteEdit = { i, text: n })}>{n}</button>{/each}
        <button class="link" onclick={() => (noteEdit = { i: -1, text: '' })}><Icon name="plus" size={13} /> Add…</button>
      </section>
    {/if}
  </div>
</aside>

{#if noteEdit}
  <div class="overlay" role="presentation" onmousedown={(e) => { if (e.target === e.currentTarget) saveNote(); }}>
    <div class="popover notebox">
      <h4>Note</h4>
      <!-- svelte-ignore a11y_autofocus -->
      <textarea class="field" rows="8" bind:value={noteEdit.text} autofocus onkeydown={(e) => { if (e.key === 'Escape') noteEdit = null; if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveNote(); }}></textarea>
      <div class="row">
        {#if noteEdit.i >= 0}<button class="btn danger" onclick={() => { noteEdit.text = ''; saveNote(); }}>Remove Note</button>{/if}
        <span style="flex:1"></span>
        <button class="btn primary" onclick={saveNote}>Done</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .dash { height: 100%; display: flex; flex-direction: column; min-height: 0; }
  .tabs { height: 56px; flex: none; display: flex; align-items: center; justify-content: center; gap: 4px; border-bottom: 1px solid var(--sep); }
  .tabs button { width: 34px; height: 30px; border: 0; border-radius: 7px; background: none; color: var(--icon); display: flex; align-items: center; justify-content: center; }
  .tabs button.on { color: var(--accent-fg); }
  .tabs button:hover { background: var(--hint-bg); }
  .body { flex: 1; min-height: 0; padding: 6px 0 30px; }
  section { padding: 12px 18px; border-bottom: 1px solid var(--sep); }
  h4 { margin: 0 0 6px; font-size: 11px; font-weight: 600; color: var(--section); display: flex; gap: 6px; align-items: center; }
  .fold { border: 0; background: none; padding: 0; font: inherit; color: inherit; display: flex; gap: 3px; align-items: center; margin-left: -13px; }
  .fold :global(svg) { opacity: 0; transition: transform 0.15s, opacity 0.15s; }
  section:hover .fold :global(svg), .fold.shut :global(svg) { opacity: 0.7; }
  .fold.shut :global(svg) { transform: rotate(-90deg); }
  .add { margin-left: auto; border: 0; background: none; padding: 0; color: var(--section); display: flex; opacity: 0.8; }
  .add:hover { opacity: 1; color: var(--text); }
  .kv { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; padding: 1.5px 0; font-variant-numeric: tabular-nums; }
  .kv span { color: var(--text); }
  .kv code { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; max-width: 170px; color: var(--muted); }
  .ringrow { display: flex; gap: 10px; align-items: center; border: 0; background: none; padding: 2px 0; text-align: left; color: var(--text); width: 100%; }
  .ringrow span { display: flex; flex-direction: column; line-height: 1.25; }
  .ringrow b { font-size: 15px; font-weight: 500; font-variant-numeric: tabular-nums; }
  .ringrow small { font-size: 10.5px; color: var(--muted); }
  .ring { width: 40px; height: 40px; flex: none; --ring: #0a84ff; }
  .ring.done { --ring: #34c759; }
  .ring.over { --ring: #ff3b30; }
  .ring .disc { fill: color-mix(in srgb, var(--ring) 14%, transparent); }
  .ring .arc { fill: none; stroke: var(--ring); stroke-width: 4; stroke-linecap: round; }
  .dot { width: 7px; height: 7px; border-radius: 50%; border: 1.3px solid var(--accent-soft); flex: none; }
  .custom { display: flex; justify-content: flex-end; padding: 10px 14px; }
  .sliders { border: 0; background: none; color: var(--icon-dim); padding: 3px; border-radius: 5px; display: flex; }
  .sliders:hover { color: var(--icon); background: var(--hint-bg); }
  h4 small { font-weight: 400; }
  .kind { border: 0; background: none; padding: 1px 6px; margin-left: -6px; border-radius: 5px; font: inherit; color: inherit; display: flex; gap: 6px; }
  .kind:hover { background: var(--hint-bg); }
  .kind.on { background: var(--accent); color: var(--on-accent); }
  .none { color: var(--muted); text-align: center; margin-top: 40%; font-size: 15px; }
  .none.small { font-size: 12px; padding: 0 30px; }
  .link { border: 0; background: none; color: var(--accent-soft); padding: 4px 0; display: flex; align-items: center; gap: 5px; font-size: 12px; }
  .link.center { margin: 0 auto; }
  .kws { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
  .kw { --kw: var(--accent); display: inline-flex; gap: 3px; align-items: center; font-size: 12px; padding: 1px 8px; border-radius: 10px; background: color-mix(in srgb, var(--kw) 16%, transparent); }
  .kw button { border: 0; background: none; padding: 0; color: var(--muted); display: flex; }
  .kwin { border: 0; background: none; outline: none; font-size: 12px; flex: 1; min-width: 90px; padding: 3px 0; }
  .ol { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; border: 0; background: none; padding: 3px 4px; border-radius: 5px; font-size: 12px; color: var(--text); overflow: hidden; }
  .ol span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ol:hover { background: var(--hint-bg); }
  .fn { color: var(--ed-footnote); }
  .note { display: block; width: 100%; text-align: left; border: 1px solid var(--hint-border); background: var(--popover-bg); border-radius: 7px; padding: 8px 10px; margin-bottom: 6px; font-size: 12px; line-height: 1.4; white-space: pre-wrap; color: var(--text); max-height: 120px; overflow: hidden; }
  .revision label { display: flex; gap: 5px; align-items: center; font-size: 12px; }
  .revision { padding: 10px 18px; border-bottom: 1px solid var(--sep); }
  .stats { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; font-size: 12px; }
  .stats th { text-align: left; font-weight: 400; color: var(--muted); padding: 2px 0; }
  .stats td { text-align: right; }
  .stats tr.gap th { padding-top: 12px; }
  .bigring { width: 150px; height: 150px; margin: 8px auto; border-radius: 50%; background: conic-gradient(#0a84ff calc(var(--p) * 360deg), var(--sep) 0); display: flex; align-items: center; justify-content: center; }
  .bigring.done { background: conic-gradient(#34c759 360deg, #34c759 0); }
  .bigring.over { background: conic-gradient(#ff3b30 360deg, #ff3b30 0); }
  .bigring > div { width: 124px; height: 124px; border-radius: 50%; background: var(--sidebar-bg); display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .bigring b { font-size: 28px; font-weight: 500; font-variant-numeric: tabular-nums; }
  .bigring small { font-size: 11px; color: var(--muted); }
  .center { text-align: center; }
  .small { font-size: 12px; }
  .ann { display: flex; flex-direction: column; gap: 3px; width: 100%; text-align: left; border: 0; background: none; padding: 6px 8px; border-radius: 6px; font-size: 12px; color: var(--text); border-left: 3px solid transparent; }
  .ann:hover { background: var(--hint-bg); }
  .ann.annotation { border-left-color: var(--ed-annot-border); }
  .ann.comment { border-left-color: var(--ed-comment); }
  .ann.mark { border-left-color: var(--ed-mark-tag); }
  .ann.delete { border-left-color: var(--ed-delete); }
  .ann.delete .t { text-decoration: line-through; }
  .ann.insert { border-left-color: var(--ed-insert); }
  .ann.insert .t { text-decoration: underline; text-underline-offset: 2px; }
  .ann .n { color: var(--muted); font-style: italic; }
  .checktext { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .checktext .err { width: 100%; margin: 0; color: var(--danger, #d33); }
  .kdot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; background: var(--kd); }
  .kdot.sp { --kd: #e5484d; } .kdot.gr { --kd: #f59e0b; } .kdot.st { --kd: #3b82f6; } .kdot.pu { --kd: #a855f7; }
  .ann.found .n { font-style: normal; }
  .overlay { position: fixed; inset: 0; background: var(--overlay); z-index: 60; display: flex; align-items: center; justify-content: center; }
  .notebox { position: relative; width: 420px; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
  .notebox textarea { height: auto; padding: 8px; resize: vertical; line-height: 1.45; }
  .row { display: flex; gap: 8px; }
</style>
