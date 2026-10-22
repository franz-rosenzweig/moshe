<script>
  // The dialogs: a group's (or filter's) name, colour and icon; a new
  // project; a goal; keywords; statistics; a question before something
  // can't be undone. One at a time (lib/ui.svelte.js, openDialog).
  import Icon from './Icon.svelte';
  import ExportDialog from './ExportDialog.svelte';
  import BackupsDialog from './BackupsDialog.svelte';
  import KeywordManager from './KeywordManager.svelte';
  import { ui, COLORS, COLOR_ORDER, colorOf, openDialog } from '../lib/ui.svelte.js';
  import { GROUP_ICONS } from '../lib/icons.js';
  import { store, app, toast } from '../lib/state.svelte.js';
  import { PROJECT_TEMPLATES, TEMPLATE_ORDER } from '@engine/templates.js';

  const d = $derived(ui.dialog);
  let form = $state({});
  let showIcons = $state(false);

  // before the dialog is drawn, so its fields never see the last dialog's form
  $effect.pre(() => {
    const x = ui.dialog;
    showIcons = false;
    if (!x) return;
    if (x.kind === 'group') form = { name: x.name || '', color: x.color || null, icon: x.icon || null, rules: x.rules ? JSON.parse(JSON.stringify(x.rules)) : null };
    else if (x.kind === 'project') form = { name: x.name || '', color: x.color || null, icon: x.icon || 'book', template: 'novel', goalOn: !!x.goal, goal: x.goal ? { ...x.goal } : { type: 'about', count: 50000, metric: 'words', deadline: null } };
    else if (x.kind === 'goal') form = x.goal ? { ...x.goal, deadlineOn: !!x.goal.deadline } : { type: 'at-least', count: 800, metric: 'words', deadline: null, deadlineOn: false };
    else if (x.kind === 'keywords') form = { add: '', kws: keywordsOf(x.paths) };
    else form = {};
  });

  function keywordsOf(paths) {
    const all = new Map();
    for (const p of paths) for (const k of store.sheetInfo(p).keywords) all.set(k, (all.get(k) || 0) + 1);
    return [...all].map(([name, n]) => ({ name, all: n === paths.length }));
  }

  const close = (v = null) => d && d.resolve(v);

  function done() {
    if (!d) return;
    if (d.kind === 'group') close({ name: form.name.trim() || d.name, color: form.color, icon: form.icon, rules: form.rules });
    else if (d.kind === 'project') close({ name: form.name.trim() || 'New Project', color: form.color, icon: form.icon, template: form.template, goal: form.goalOn ? { ...form.goal, count: Number(form.goal.count) } : null });
    else if (d.kind === 'goal') close({ type: form.type, count: Number(form.count) || 0, metric: form.metric, deadline: form.deadlineOn && form.deadline ? form.deadline : null });
    else close(true);
  }

  function addKeyword(name) {
    const k = String(name || '').trim();
    if (!k) return;
    for (const p of d.paths) {
      const kws = store.sheetInfo(p).keywords;
      if (!kws.includes(k)) store.setSheetMeta(p, { keywords: [...kws, k] });
    }
    form.kws = keywordsOf(d.paths);
    form.add = '';
  }
  function removeKeyword(name) {
    for (const p of d.paths) store.setSheetMeta(p, { keywords: store.sheetInfo(p).keywords.filter((k) => k !== name) });
    form.kws = keywordsOf(d.paths);
  }

  const known = $derived.by(() => { app.version; return d && d.kind === 'keywords' ? store.keywords(app.project) : []; });
  const statsOf = $derived.by(() => { app.version; return d && d.kind === 'stats' ? store.groupStats(d.path) : null; });
  const goalOf = $derived.by(() => { app.version; return d && d.kind === 'stats' ? store.sget(d.path, 'goal', null) : null; });
  const hist = $derived.by(() => { app.version; return d && d.kind === 'stats' && goalOf ? store.history(d.path, 10).reverse() : []; });
  const histMax = $derived(Math.max(1, ...hist.map((h) => h.written), goalOf && goalOf.type === 'daily' ? goalOf.count : 0));
  function historyCsv() {
    const rows = [['day', 'start', 'end', 'written'], ...store.history(d.path, 10000).reverse().map((h) => [h.day, h.start, h.end, h.written])];
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n') + '\n'], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${d.name} history.csv`;
    a.click();
  }
  const fmtTime = (s) => { const m = Math.floor(s / 60), r = s % 60; return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : m ? `${m} min ${r} sec` : `${r} sec`; };
  // beside the button that opened it (below, kept on screen), or centred
  function statPlace(a) {
    if (!a) return 'position:fixed;left:50%;top:18%;transform:translateX(-50%)';
    const left = Math.min(Math.max(8, a.left + a.width / 2 - 125), window.innerWidth - 258);
    return `position:fixed;left:${left}px;top:${a.bottom + 8}px`;
  }
  async function copyStats() {
    const st = statsOf; if (!st) return;
    const lines = [d.name, `Sheets\t${st.sheets}`, `Characters\t${st.characters}`, `Without Spaces\t${st.charactersNoSpaces}`, `Words\t${st.words}`, `Sentences\t${st.sentences}`, `Paragraphs\t${st.paragraphs}`, `Pages\t${st.pages}`,
      `Reading (slow)\t${fmtTime(st.reading.slow)}`, `Reading (average)\t${fmtTime(st.reading.average)}`, `Reading (fast)\t${fmtTime(st.reading.fast)}`, `Reading aloud\t${fmtTime(st.reading.aloud)}`];
    try { await navigator.clipboard.writeText(lines.join('\n')); toast('Statistics copied'); } catch { toast('Couldn\u2019t copy'); }
  }

  const METRICS = [['words', 'Words'], ['characters', 'Characters'], ['characters-no-spaces', 'Characters Without Spaces'], ['sentences', 'Sentences'], ['paragraphs', 'Paragraphs'], ['lines', 'Lines'], ['pages', 'Pages'], ['reading-time', 'Minutes of Reading']];
  const RULE_FIELDS = [['keyword', 'Keyword'], ['text', 'Text'], ['title', 'Title'], ['created', 'Created'], ['modified', 'Modified'], ['material', 'Material sheet'], ['favorite', 'Favorite'], ['goal', 'Has a goal'], ['notes', 'Has notes']];
</script>

{#if d}
  {#if d.kind === 'export'}
    <ExportDialog dialog={d} />
  {:else if d.kind === 'backups'}
    <BackupsDialog dialog={d} />
  {:else if d.kind === 'keywordManager'}
    <KeywordManager dialog={d} />
  {:else if d.kind === 'stats'}
    <!-- Statistics: a popover by the button that asked (centred when a menu asked) -->
    <div class="overlay clear" role="presentation" onmousedown={(e) => { if (e.target === e.currentTarget) close(null); }}>
      <div class="statpop popover" role="dialog" aria-label="Statistics" style={statPlace(d.anchor)} tabindex="-1" onkeydown={(e) => { if (e.key === 'Escape') close(null); }}>
        <div class="stathead">
          <button class="round" aria-label="Close" onclick={() => close(null)}><Icon name="x" size={9} stroke={2.6} /></button>
          <b>{d.name}</b>
          <button class="round" title="Copy the Statistics" aria-label="Copy the statistics" onclick={copyStats}><Icon name="share" size={9} stroke={2.4} /></button>
        </div>
        {#if statsOf}
          <table class="stats">
            <tbody>
              <tr><th>Sheets</th><td>{statsOf.sheets}</td></tr>
              <tr class="gap"><th>Characters</th><td>{statsOf.characters.toLocaleString()}</td></tr>
              <tr><th>Without Spaces</th><td>{statsOf.charactersNoSpaces.toLocaleString()}</td></tr>
              <tr class="gap"><th>Words</th><td>{statsOf.words.toLocaleString()}</td></tr>
              <tr><th>Sentences</th><td>{statsOf.sentences.toLocaleString()}</td></tr>
              <tr><th>Paragraphs</th><td>{statsOf.paragraphs.toLocaleString()}</td></tr>
              <tr><th>Pages</th><td>{statsOf.pages}</td></tr>
              <tr class="gap"><th>Slow</th><td>{fmtTime(statsOf.reading.slow)}</td></tr>
              <tr><th>Average</th><td>{fmtTime(statsOf.reading.average)}</td></tr>
              <tr><th>Fast</th><td>{fmtTime(statsOf.reading.fast)}</td></tr>
              <tr><th>Aloud</th><td>{fmtTime(statsOf.reading.aloud)}</td></tr>
            </tbody>
          </table>
          {#if goalOf}
            <div class="hist">
              <div class="hist-head"><b>History</b> <span class="dim">{goalOf.type === 'daily' ? `every day ${goalOf.count.toLocaleString()}` : `goal ${goalOf.count.toLocaleString()}`} {goalOf.metric}</span></div>
              <div class="bars">
                {#each hist as h}
                  <div class="bar" title="{h.day}: {h.written}">
                    <span class="fill" class:met={goalOf.type === 'daily' && h.written >= goalOf.count} style="height:{(h.written / histMax) * 100}%"></span>
                    <small>{h.day.slice(8)}</small>
                  </div>
                {:else}<p class="dim">Written days appear here.</p>{/each}
              </div>
              {#if hist.length}
                <div class="hist-nums">
                  <span>Today <b>{(hist[hist.length - 1].day === new Date().toISOString().slice(0, 10) ? hist[hist.length - 1].written : 0).toLocaleString()}</b></span>
                  <span>Average <b>{Math.round(hist.reduce((a, h) => a + h.written, 0) / hist.length).toLocaleString()}</b></span>
                  <span>Best <b>{Math.max(...hist.map((h) => h.written)).toLocaleString()}</b></span>
                  <button class="btn" onclick={historyCsv}>Export CSV</button>
                </div>
              {/if}
            </div>
          {/if}
        {/if}
      </div>
    </div>
  {:else}
    <div class="overlay" role="presentation" onmousedown={(e) => { if (e.target === e.currentTarget) close(null); }}>
      <div class="dialog popover" role="dialog" aria-modal="true" onkeydown={(e) => { if (e.key === 'Escape') close(null); if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && d.kind !== 'keywords') done(); }}>
        {#if d.kind === 'confirm'}
          <h3>{d.title}</h3>
          {#if d.message}<p>{d.message}</p>{/if}
          <div class="actions"><button class="btn" onclick={() => close(false)}>Cancel</button><button class="btn primary" class:danger-bg={d.danger} onclick={() => close(true)}>{d.ok}</button></div>

        {:else if d.kind === 'group'}
          <h3>{d.title}</h3>
          <div class="grid">
            <label for="g-name">Name:</label>
            <!-- svelte-ignore a11y_autofocus -->
            <input id="g-name" class="field" bind:value={form.name} autofocus onfocus={(e) => e.target.select()} />
          </div>
          <div class="look">
            <div class="colors"><span class="lbl">Color:</span>
              <div class="dots">
                {#each COLOR_ORDER as c}
                  <button class="dot" class:on={form.color === c} style="--c:{COLORS[c]}" title={c} onclick={() => (form.color = form.color === c ? null : c)}></button>
                {/each}
              </div>
            </div>
            <div class="vsep"></div>
            <div class="icons"><span class="lbl">Icon:</span>
              {#each [d.filter ? 'list-filter' : 'sheets', 'folder'] as ic}
                <button class="iconbtn" class:on={(form.icon || (d.filter ? 'list-filter' : 'sheets')) === ic} onclick={() => (form.icon = ic)} style="color:{colorOf(form.color, 'var(--icon)')}"><Icon name={ic} size={19} /></button>
              {/each}
              <button class="iconbtn" class:on={showIcons} onclick={() => (showIcons = !showIcons)}><Icon name="ellipsis" size={18} /></button>
            </div>
          </div>
          {#if showIcons}
            <div class="icongrid">
              {#each GROUP_ICONS as ic}
                <button class="iconbtn small" class:on={form.icon === ic} title={ic} onclick={() => (form.icon = ic)} style="color:{colorOf(form.color, 'var(--icon)')}"><Icon name={ic} size={17} /></button>
              {/each}
            </div>
          {/if}
          {#if d.filter && form.rules}
            <div class="rules">
              <div class="rules-head">Sheets that match
                <select class="field" bind:value={form.rules.match}><option value="all">all</option><option value="any">any</option></select> of:</div>
              {#each form.rules.items as r, i}
                <div class="rule">
                  <select class="field" bind:value={r.field}>{#each RULE_FIELDS as [v, l]}<option value={v}>{l}</option>{/each}</select>
                  {#if ['keyword', 'text', 'title'].includes(r.field)}
                    <select class="field" bind:value={r.op}><option value="is">{r.field === 'keyword' ? 'is' : 'contains'}</option><option value="not">{r.field === 'keyword' ? 'is not' : 'does not contain'}</option></select>
                    <input class="field" bind:value={r.value} list={r.field === 'keyword' ? 'kwlist' : undefined} />
                  {:else if ['created', 'modified'].includes(r.field)}
                    <select class="field" bind:value={r.op}><option value="within">in the last</option><option value="older">more than</option></select>
                    <input class="field num" type="number" min="0" bind:value={r.value} /> days{#if r.op === 'older'}&nbsp;ago{/if}
                  {:else}
                    <select class="field" bind:value={r.op}><option value="is">yes</option><option value="not">no</option></select>
                  {/if}
                  <button class="iconbtn small" title="Remove" onclick={() => form.rules.items.splice(i, 1)}><Icon name="x" size={13} /></button>
                </div>
              {/each}
              <button class="btn" onclick={() => form.rules.items.push({ field: 'keyword', op: 'is', value: '' })}>Add Condition</button>
              <datalist id="kwlist">{#each store.keywords(app.project) as k}<option value={k.name}></option>{/each}</datalist>
            </div>
          {/if}
          <div class="actions"><button class="btn" onclick={() => close(null)}>Cancel</button><button class="btn primary" onclick={done}>Done</button></div>

        {:else if d.kind === 'project'}
          <h3>{d.title}</h3>
          <div class="grid">
            <label for="p-name">Title:</label>
            <!-- svelte-ignore a11y_autofocus -->
            <input id="p-name" class="field" bind:value={form.name} placeholder="Project Title" autofocus />
          </div>
          <div class="look">
            <div class="colors"><span class="lbl">Color:</span>
              <div class="dots">{#each COLOR_ORDER as c}<button class="dot" class:on={form.color === c} style="--c:{COLORS[c]}" title={c} onclick={() => (form.color = form.color === c ? null : c)}></button>{/each}</div>
            </div>
            <div class="vsep"></div>
            <div class="icons"><span class="lbl">Icon:</span>
              <button class="iconbtn on" style="color:{colorOf(form.color, 'var(--accent-fg)')}" onclick={() => (showIcons = !showIcons)}><Icon name={form.icon} size={19} /></button>
            </div>
          </div>
          {#if showIcons}
            <div class="icongrid">{#each GROUP_ICONS as ic}<button class="iconbtn small" class:on={form.icon === ic} onclick={() => { form.icon = ic; showIcons = false; }} style="color:{colorOf(form.color, 'var(--icon)')}"><Icon name={ic} size={17} /></button>{/each}</div>
          {/if}
          {#if !d.editing}
            <div class="templates">
              <span class="lbl">Template:</span>
              <div class="tlist">
                {#each TEMPLATE_ORDER as t}
                  {@const tp = PROJECT_TEMPLATES[t]}
                  <button class="tpl" class:on={form.template === t} onclick={() => { form.template = t; form.icon = tp.icon; }}>
                    <Icon name={tp.icon} size={18} /><span><b>{tp.name}</b><small>{tp.description}</small></span>
                  </button>
                {/each}
              </div>
            </div>
          {/if}
          <label class="check"><input type="checkbox" bind:checked={form.goalOn} /> Goal</label>
          {#if form.goalOn}
            <div class="goalrow">
              <select class="field" bind:value={form.goal.type}><option value="about">About</option><option value="at-least">At least</option><option value="at-most">At most</option><option value="daily">Every day</option></select>
              <input class="field num" type="number" min="1" bind:value={form.goal.count} />
              <select class="field" bind:value={form.goal.metric}>{#each METRICS as [v, l]}<option value={v}>{l}</option>{/each}</select>
            </div>
            <div class="goalrow"><span class="lbl">Deadline:</span><input class="field" type="date" bind:value={form.goal.deadline} /></div>
          {/if}
          <div class="actions"><button class="btn" onclick={() => close(null)}>Cancel</button><button class="btn primary" onclick={done}>Done</button></div>

        {:else if d.kind === 'goal'}
          <h3>{d.title}</h3>
          <div class="goalrow">
            <select class="field" bind:value={form.type}>
              <option value="about">About</option><option value="at-least">At least</option><option value="at-most">At most</option>
              {#if d.group}<option value="daily">Every day</option>{/if}
            </select>
            <!-- svelte-ignore a11y_autofocus -->
            <input class="field num" type="number" min="1" bind:value={form.count} autofocus />
            <select class="field" bind:value={form.metric}>{#each METRICS as [v, l]}<option value={v}>{l}</option>{/each}</select>
          </div>
          <label class="check"><input type="checkbox" bind:checked={form.deadlineOn} /> Deadline</label>
          {#if form.deadlineOn}
            <div class="goalrow"><input class="field" type="date" bind:value={form.deadline} /></div>
          {/if}
          <div class="actions">
            {#if d.goal}<button class="btn danger" onclick={() => close(false)}>Remove Goal</button>{/if}
            <span style="flex:1"></span>
            <button class="btn" onclick={() => close(null)}>Cancel</button><button class="btn primary" onclick={done}>Done</button>
          </div>

        {:else if d.kind === 'keywords'}
          <h3>Keywords</h3>
          <div class="kwbox">
            {#each form.kws || [] as k}
              <span class="kw" class:partial={!k.all}>{k.name}<button onclick={() => removeKeyword(k.name)} aria-label="Remove"><Icon name="x" size={10} /></button></span>
            {/each}
            <!-- svelte-ignore a11y_autofocus -->
            <input class="kwin" bind:value={form.add} placeholder={form.kws && form.kws.length ? '' : 'Add Keywords'} list="kwlist2" autofocus
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addKeyword(form.add); } if (e.key === 'Backspace' && !form.add && form.kws && form.kws.length) removeKeyword(form.kws[form.kws.length - 1].name); }} />
            <datalist id="kwlist2">{#each known as k}<option value={k.name}></option>{/each}</datalist>
          </div>
          {#if known.length}
            <div class="lbl" style="margin-top:12px">In use</div>
            <div class="kwall">
              {#each known.filter((k) => !(form.kws || []).some((x) => x.name === k.name)) as k}
                <button class="kw add" style={k.color ? `--kw:${colorOf(k.color)}` : ''} onclick={() => addKeyword(k.name)}>{k.name} <small>{k.count}</small></button>
              {/each}
            </div>
          {/if}
          <div class="actions"><button class="btn" onclick={() => { close(true); setTimeout(() => openDialog('keywordManager'), 50); }}>Manage Keywords…</button><span style="flex:1"></span><button class="btn primary" onclick={() => close(true)}>Done</button></div>

        {/if}
      </div>
    </div>
  {/if}
{/if}

<style>
  .overlay { position: fixed; inset: 0; background: var(--overlay); z-index: 60; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .dialog { position: relative; width: 508px; max-width: 100%; max-height: 90vh; overflow: auto; padding: 22px 24px 20px; font-size: 13px; }
  h3 { margin: 0 0 18px; font-size: 16px; font-weight: 700; }
  h3.center { text-align: center; font-size: 13px; }
  p { margin: -8px 0 18px; line-height: 1.45; color: var(--text); }
  .grid { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 10px; margin-bottom: 16px; }
  .grid input { width: 100%; }
  .look { display: flex; align-items: flex-start; gap: 22px; padding-bottom: 16px; border-bottom: 1px solid var(--sep); margin: 0 -24px 0; padding-left: 24px; padding-right: 24px; }
  .colors { display: flex; gap: 10px; }
  .dots { display: grid; grid-template-columns: repeat(6, 16px); gap: 10px 9px; }
  .dot { width: 16px; height: 16px; border-radius: 50%; border: 0; background: var(--c); padding: 0; position: relative; }
  .dot.on::after { content: ''; position: absolute; inset: 4px; border-radius: 50%; background: #fff; }
  .vsep { width: 1px; align-self: stretch; background: var(--sep); }
  .icons { display: flex; gap: 10px; align-items: center; }
  .lbl { color: var(--text); font-size: 13px; white-space: nowrap; }
  .iconbtn { width: 44px; height: 44px; border-radius: 50%; border: 0; background: var(--hint-bg); display: flex; align-items: center; justify-content: center; color: var(--icon); }
  .iconbtn.on { box-shadow: inset 0 0 0 2px var(--text); background: var(--popover-bg); }
  .iconbtn.small { width: 32px; height: 32px; }
  .icongrid { display: grid; grid-template-columns: repeat(auto-fill, 32px); gap: 6px; max-height: 190px; overflow: auto; padding: 12px 0; border-bottom: 1px solid var(--sep); }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; align-items: center; }
  .danger-bg { background: var(--danger) !important; }
  .templates { margin: 14px 0; }
  .tlist { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 8px; }
  .tpl { display: flex; gap: 10px; align-items: flex-start; text-align: left; border: 1px solid var(--sep); background: var(--popover-bg); border-radius: 8px; padding: 8px 10px; color: var(--icon); }
  .tpl.on { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); color: var(--accent-fg); }
  .tpl span { display: flex; flex-direction: column; gap: 2px; color: var(--text); }
  .tpl small { color: var(--muted); font-size: 11px; line-height: 1.3; }
  .check { display: flex; align-items: center; gap: 6px; margin: 12px 0 8px; }
  .goalrow { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
  .num { width: 90px; }
  .kwbox { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; min-height: 36px; padding: 5px; border: 1px solid var(--field-border); border-radius: 7px; background: var(--field-bg); }
  .kwin { flex: 1; min-width: 120px; border: 0; background: none; outline: none; font-size: 13px; }
  .kw { --kw: var(--accent); display: inline-flex; align-items: center; gap: 4px; font-size: 12px; padding: 2px 8px; border-radius: 10px; background: color-mix(in srgb, var(--kw) 16%, transparent); color: var(--text); border: 1px solid transparent; }
  .kw.partial { border-style: dashed; border-color: var(--section); background: none; }
  .kw button { border: 0; background: none; padding: 0; display: flex; color: var(--muted); }
  .kw.add { cursor: default; }
  .kw small { color: var(--muted); }
  .kwall { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .overlay.clear { background: transparent; }
  .statpop { width: 250px; padding: 8px 14px 14px; font-size: 12px; background: var(--hud-bg, var(--popover-bg)); outline: none; }
  .stathead { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 -6px 12px; }
  .stathead b { font-size: 12px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .round { width: 16px; height: 16px; border-radius: 50%; border: 0; padding: 0; display: flex; align-items: center; justify-content: center; background: var(--muted); color: var(--popover-bg); opacity: 0.55; flex: none; }
  .round:hover { opacity: 0.85; }
  .statpop .hist { margin-top: 14px; }
  .stats { margin: 0 auto; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  .stats th { text-align: right; font-weight: 400; color: var(--muted); padding: 2px 10px 2px 0; }
  .stats td { padding: 2px 0; }
  .stats tr.gap th, .stats tr.gap td { padding-top: 14px; }
  .hist { margin-top: 16px; border-top: 1px solid var(--sep); padding-top: 12px; }
  .hist-head { display: flex; gap: 8px; align-items: baseline; margin-bottom: 8px; }
  .bars { display: flex; gap: 6px; align-items: flex-end; height: 110px; }
  .bar { flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 3px; }
  .fill { width: 100%; background: #0a84ff; border-radius: 3px 3px 0 0; min-height: 2px; }
  .fill.met { background: #34c759; }
  .bar small { font-size: 10px; color: var(--muted); }
  .hist-nums { display: flex; gap: 14px; align-items: center; margin-top: 10px; font-size: 12px; color: var(--muted); }
  .hist-nums b { color: var(--text); }
  .hist-nums .btn { margin-left: auto; }
  .rules { margin-top: 14px; display: flex; flex-direction: column; gap: 8px; }
  .rules-head { display: flex; align-items: center; gap: 6px; }
  .rule { display: flex; gap: 6px; align-items: center; }
  .rule input:not(.num) { flex: 1; min-width: 0; }
</style>
