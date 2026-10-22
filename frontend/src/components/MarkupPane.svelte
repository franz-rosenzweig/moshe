<script>
  // Settings › Markup: each markup's tag and colours in the chosen theme,
  // light and dark (tag, text, background), with its style and size; the
  // themes in a strip below. The built-in themes are locked: a click on a
  // swatch offers a copy to change.
  // Your themes live in the library's settings, so every device has them.
  import Icon from './Icon.svelte';
  import { app, prefs, store, persist, toast } from '../lib/state.svelte.js';
  import { confirm, openMenu } from '../lib/ui.svelte.js';
  import { THEMES, OWN_THEMES, EXCHANGE_THEMES, customThemes, setCustomThemes, isLocked, copyOf, sample, resolvedVars, asHex } from '../lib/themes.js';

  let { dark } = $props();

  const H = ['--ed-tag-h', '--ed-heading', '--ed-heading-bg'];
  // [definition, tag, [tag, text, background] variables, style, size]; null is a gap
  const ROWS = [
    ['Title', '#', H, 'B', '4XL'], ['Heading', '##', H, 'B', 'XL'], ['Subheading', '###', H, 'B', 'M'],
    ['Subheading 2', '####', H, 'B', '–'], ['Subheading 3', '#####', H, 'BI', '–'], ['Subheading 4', '######', H, 'BI', '–'],
    ['Divider', '----', ['--ed-divider', '--ed-divider', null], '', ''],
    null,
    ['Strong', '**…**', ['--ed-tag', '--ed-strong', null], 'B', ''], ['Emphasis', '_…_', ['--ed-tag', '--ed-em', null], 'I', ''],
    ['Mark', '==…==', ['--ed-mark-tag', '--ed-mark-text', '--ed-mark-bg'], '', ''],
    ['Delete', '{--…--}', ['--ed-tag', '--ed-delete', null], 'S', ''], ['Insert', '{++…++}', ['--ed-tag', '--ed-insert', null], 'U', ''],
    null,
    ['Dashed List', '-', ['--ed-list-tag', null, null], '', ''], ['Numbered List', '1.', ['--ed-list-tag', null, null], '', ''],
    ['Quote', '>', ['--ed-tag', '--ed-quote', null], 'I', ''],
    null,
    ['Link', '[…](…)', ['--ed-link-tag', '--ed-link', '--ed-link-bg'], 'U', ''], ['Image', '![…](…)', ['--ed-link-tag', '--ed-link', null], '', ''],
    ['Footnote', '^[…]', ['--ed-footnote', '--ed-footnote', '--ed-footnote-bg'], '', ''],
    ['Annotation', '{==…==}{>>…<<}', ['--ed-annot-border', '--ed-annot-text', '--ed-annot-bg'], '', ''],
    ['Comment', '%%…%%', ['--ed-comment-tag', '--ed-comment', '--ed-comment-bg'], '', ''],
    ['Comment Block', '%%', [null, '--ed-comment-block', '--ed-comment-bg'], '', ''],
    null,
    ['Code', '`…`', ['--ed-code-tag', '--ed-code-text', '--ed-code-bg'], '', ''], ['Code Block', '```', [null, '--ed-code-text', '--ed-code-bg'], '', ''],
    ['Equation', '$…$', [null, '--ed-math', null], '', ''], ['Table', '| … |', ['--ed-tag', null, null], '', ''],
    null,
    ['Text', '', [null, '--ed-text', '--editor-bg'], '', ''], ['Selection', '', [null, null, '--ed-selection'], '', ''], ['Line Marker', '', [null, null, '--ed-line-marker'], '', ''],
  ];
  const WHAT = ['tag', 'text', 'background'];

  // your themes from the library, registered here too: Settings' own effect may run after this pane reads them
  const mine = $derived.by(() => { app.version; setCustomThemes(store.setting('themes', {})); return customThemes(); });
  const vars = $derived.by(() => { mine; prefs.theme; return { light: resolvedVars(prefs.theme, false), dark: resolvedVars(prefs.theme, true) }; });
  const locked = $derived(isLocked(prefs.theme));

  function saveMine(map) { store.setSetting('themes', map); }
  const allMine = () => ({ ...(store.setting('themes', {}) || {}) });

  function uniqueName(base) {
    let n = `${base} Copy`, i = 2;
    while (THEMES[n]) n = `${base} Copy ${i++}`;
    return n;
  }
  function duplicate(name) {
    const n = uniqueName(THEMES[name] ? THEMES[name].name : name);
    saveMine({ ...allMine(), [n]: copyOf(name) });
    prefs.theme = n; persist();
    toast(`“${n}” is yours to change`);
    return n;
  }
  function removeTheme(name) {
    const m = allMine(); delete m[name]; saveMine(m);
    if (prefs.theme === name) { prefs.theme = 'Moshe'; persist(); }
  }
  let renaming = $state(null), newName = $state('');
  function rename(from) {
    const to = newName.trim(); renaming = null;
    if (!to || to === from) return;
    if (THEMES[to]) { toast(`There is a theme called “${to}” already`); return; }
    const m = allMine(); m[to] = m[from]; delete m[from]; saveMine(m);
    if (prefs.theme === from) { prefs.theme = to; persist(); }
  }

  // a swatch: click to change (a locked theme offers a copy first), ⌥-click to clear
  let well = $state(null), wellFor = null;
  async function swatch(e, mode, key) {
    if (!key) return;
    let name = prefs.theme;
    const current = asHex(resolvedVars(name, mode === 'dark')[key]);   // before a copy: the copy has the same colours
    if (isLocked(name)) {
      if (!(await confirm(`“${THEMES[name].name}” is locked`, 'The built-in themes stay as they are. Make a copy of it to change its colours?', 'Duplicate'))) return;
      name = duplicate(name);
    }
    if (e.altKey) { setVar(name, mode, key, 'transparent'); return; }
    wellFor = { name, mode, key };
    well.value = current || '#ffffff';
    well.click();
  }
  function setVar(name, mode, key, value) {
    const m = allMine();
    if (!m[name]) return;
    m[name] = { ...m[name], [mode]: { ...(m[name][mode] || {}), [key]: value } };
    saveMine(m);
  }
  const onWell = () => { if (wellFor) setVar(wellFor.name, wellFor.mode, wellFor.key, well.value); };

  function cardMenu(e, t) {
    e.preventDefault();
    openMenu(e, [
      { label: 'Duplicate', icon: 'copy', action: () => duplicate(t) },
      !isLocked(t) && { label: 'Rename…', action: () => { renaming = t; newName = t; } },
      !isLocked(t) && { label: 'Share…', icon: 'share', action: () => share(t) },
      !isLocked(t) && { sep: true },
      !isLocked(t) && { label: 'Delete Theme', icon: 'trash-2', action: async () => { if (await confirm(`Delete “${t}”?`, 'Your copy of the theme goes; the sheets are untouched.', 'Delete', true)) removeTheme(t); } },
    ]);
  }

  // Share: the theme as a small file (.moshe-theme); Add Themes… reads them back
  async function share(t = prefs.theme) {
    const text = JSON.stringify({ moshe: 'theme', name: THEMES[t].name, ...copyOf(t) }, null, 1);
    const name = `${THEMES[t].name}.moshe-theme`, shell = window.mosheShell;
    if (shell && shell.saveFile) { await shell.saveFile(name, btoa(unescape(encodeURIComponent(text))), 'application/json'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  let picker = $state(null);
  async function addThemes(e) {
    const m = allMine();
    let added = 0, last = null;
    for (const f of e.target.files || []) {
      try {
        const t = JSON.parse(await f.text());
        if (!t || t.moshe !== 'theme' || typeof t.light !== 'object' || typeof t.dark !== 'object') throw new Error('not a Moshe theme');
        const clean = (o) => Object.fromEntries(Object.entries(o).filter(([k, v]) => /^--(ed|editor)-[a-z-]+$/u.test(k) && typeof v === 'string' && v.length < 60 && !/[;{}<>]/u.test(v)));
        let n = String(t.name || f.name.replace(/\.[^.]+$/u, '')).slice(0, 60);
        while (THEMES[n] || m[n]) n = uniqueName(n);
        m[n] = { light: clean(t.light), dark: clean(t.dark) };
        added++; last = n;
      } catch { toast(`${f.name} isn’t a Moshe theme`); }
    }
    e.target.value = '';
    if (!added) return;
    saveMine(m);
    prefs.theme = last; persist();
    toast(added === 1 ? `Added “${last}”` : `Added ${added} themes`);
  }

  let strip = $state(null);
  // the chosen theme's card in view along the strip; only the strip moves (scrollIntoView
  // would scroll Settings too, down to the strip, on a phone where the pane is taller than the screen)
  $effect(() => { prefs.theme; mine; if (strip) setTimeout(() => {
    const c = strip.querySelector('.card.on');
    if (!c) return;
    const left = c.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft;
    if (left < strip.scrollLeft) strip.scrollLeft = left;
    else if (left + c.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = left + c.offsetWidth - strip.clientWidth;
  }, 0); });
</script>

<div class="markup">
  <div class="top">
    <select class="field" disabled><option>Moshe Markdown</option></select>
    <span class="dim">Markdown, with highlights, comments and footnotes kept in the file</span>
  </div>
  <div class="table">
    <div class="thead"><span>Definition</span><span></span><span class="c">Light</span><span class="c">Dark</span><span class="c">Style</span><span class="c">Size</span></div>
    <div class="rows scroll">
      {#each ROWS as row}
        {#if !row}<div class="gap"></div>
        {:else}
          {@const [name, tag, keys, style, size] = row}
          <div class="row">
            <b>{name}</b><code>{tag}</code>
            {#each ['light', 'dark'] as mode}
              <span class="wells">
                {#each keys as key, i}
                  {@const c = key && asHex(vars[mode][key])}
                  <button class="well" class:none={!c} class:off={!key} disabled={!key} style={c ? `background:${c}` : ''}
                    title={key ? `${name} ${WHAT[i]}, ${mode}${locked ? '' : ' — ⌥-click for none'}` : ''} aria-label={`${name} ${WHAT[i]} ${mode}`}
                    onclick={(e) => swatch(e, mode, key)}></button>
                {/each}
              </span>
            {/each}
            <span class="styles">
              {#if style !== null && (keys[1] || style)}
                {#each ['B', 'I', 'U', 'S'] as f}<span class="st" class:on={style.includes(f)} class:i={f === 'I'} class:u={f === 'U'} class:s={f === 'S'}>{f}</span>{/each}
              {/if}
            </span>
            <span class="size">{#if size}<span class="sz">{size}</span>{/if}</span>
          </div>
        {/if}
      {/each}
    </div>
  </div>

  <div class="strip" bind:this={strip}>
    {#each [...OWN_THEMES, ...mine, ...EXCHANGE_THEMES] as t (t)}
      {@const s = sample(t, dark)}
      <div class="card" class:on={prefs.theme === t} role="button" tabindex="0" title={THEMES[t].name}
        onclick={() => { prefs.theme = t; persist(); }} onkeydown={(e) => { if (e.key === 'Enter') { prefs.theme = t; persist(); } }}
        oncontextmenu={(e) => cardMenu(e, t)} ondblclick={() => { if (!isLocked(t)) { renaming = t; newName = t; } }}>
        <div class="tsample" style="background:{s.bg};color:{s.text}">
          <div style="background:{s.headingBg}"><span style="color:{s.h}">#</span> <b style="color:{s.heading}">{THEMES[t].name}</b></div>
          <div>Lorem <span style="color:{s.tag}">*</span><i style="color:{s.em}">ipsum</i><span style="color:{s.tag}">*</span> dolor <span style="background:{s.mark};color:{s.markText}">sit</span></div>
          <div><span style="color:{s.tag}">**</span><b style="color:{s.strong}">consetetur</b><span style="color:{s.tag}">**</span> <span class="tlink" style="color:{s.link};background:{s.linkBg};box-shadow:inset 0 0 0 1px {s.linkBorder};text-decoration-line:{s.linkDeco}">dolore</span></div>
          <div>elitr, sed <span style="background:{s.code};color:{s.codeText};font-family:var(--font-mono)">diam</span> nonumy</div>
        </div>
        {#if renaming === t}
          <!-- svelte-ignore a11y_autofocus -->
          <input class="rename" bind:value={newName} autofocus onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') rename(t); if (e.key === 'Escape') renaming = null; }} onblur={() => rename(t)} />
        {:else}
          <span class="tname">{THEMES[t].name}{#if isLocked(t)}<Icon name="lock" size={9} />{/if}</span>
        {/if}
      </div>
    {/each}
  </div>

  <div class="bottom">
    <span class="grow"></span>
    <button class="btn icon" title="Share the Theme…" aria-label="Share the theme" disabled={locked} onclick={() => share()}><Icon name="share" size={14} /></button>
    <button class="btn" onclick={() => picker.click()}>Add Themes…</button>
    <input type="file" accept=".moshe-theme,.json,application/json" multiple hidden bind:this={picker} onchange={addThemes} />
    <input type="color" class="colorwell" bind:this={well} oninput={onWell} tabindex="-1" aria-hidden="true" />
  </div>
</div>

<style>
  .markup { display: flex; flex-direction: column; gap: 12px; }
  .top { display: flex; gap: 14px; align-items: center; }
  .top select { width: 260px; }
  .table { border: 1px solid var(--sep); border-radius: 6px; overflow: hidden; font-size: 11px; }
  .thead, .row { display: grid; grid-template-columns: 116px 1fr 96px 96px 84px 46px; align-items: center; }
  .thead { height: 24px; border-bottom: 1px solid var(--sep); color: var(--text); background: var(--list-bg, var(--editor-bg)); }
  .thead > span { padding: 0 8px; }
  .thead .c { text-align: center; border-left: 1px solid var(--sep); height: 100%; display: flex; align-items: center; justify-content: center; }
  .rows { max-height: 214px; }
  .row { height: 22.5px; }
  .row:nth-child(odd) { background: color-mix(in srgb, var(--accent) 3%, transparent); }
  .row > b { padding-left: 8px; font-weight: 600; white-space: nowrap; }
  .row code { font-family: var(--font-ui); color: var(--text); padding-right: 6px; text-align: right; white-space: nowrap; overflow: hidden; }
  .row > span { height: 100%; display: flex; align-items: center; justify-content: center; border-left: 1px solid var(--sep); gap: 3px; }
  .gap { height: 22.5px; }
  .well { width: 22px; height: 13px; border-radius: 3px; border: 1px solid rgba(0, 0, 0, 0.18); padding: 0; background: #fff; cursor: pointer; }
  .well.none { background: #fff; }
  .well.off { visibility: hidden; }
  .st { width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; border-radius: 3px; font-size: 10px; font-weight: 700; color: var(--muted); background: var(--hint-bg); }
  .st.i { font-style: italic; font-family: Georgia, serif; }
  .st.u { text-decoration: underline; }
  .st.s { text-decoration: line-through; }
  .st.on { background: var(--accent); color: var(--on-accent); }
  .sz { font-size: 10px; background: var(--hint-bg); border-radius: 4px; padding: 1px 6px; }
  .strip { display: flex; gap: 12px; overflow-x: auto; overflow-y: hidden; padding: 4px 2px 6px; scrollbar-width: thin; }
  .card { flex: 0 0 116px; display: flex; flex-direction: column; gap: 4px; align-items: center; padding: 4px; border-radius: 3px; cursor: default; outline: none; }
  .card.on { background: var(--accent); color: var(--on-accent); }
  .card:focus-visible { box-shadow: 0 0 0 2px var(--accent); }
  .tsample { width: 100%; height: 54px; padding: 5px 6px; font-size: 7.5px; line-height: 1.55; text-align: left; box-shadow: 0 0 0 1px var(--sep); overflow: hidden; white-space: nowrap; border-radius: 2px; }
  .tlink { border-radius: 2px; padding: 0 2px; text-decoration: underline; }
  .tname { font-size: 11px; display: flex; gap: 4px; align-items: center; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tname :global(svg) { opacity: 0.55; flex: none; }
  .rename { width: 100%; font-size: 11px; border: 1px solid var(--accent); border-radius: 3px; padding: 0 3px; color: var(--text); background: var(--editor-bg); }
  .bottom { display: flex; gap: 8px; align-items: center; }
  .grow { flex: 1; }
  .btn.icon { padding: 3px 8px; }
  .colorwell { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
  .bottom { position: relative; }

  /* A phone: the markup and its light and dark colours; the style and size
     columns stay on the Mac and in a browser window, where there is room. */
  @media (max-width: 760px) {
    .top { flex-wrap: wrap; gap: 6px 12px; }
    .top select { width: 100%; }
    .thead, .row { grid-template-columns: minmax(0, 1fr) auto 64px 64px; }
    .thead > span:nth-child(5), .thead > span:nth-child(6), .row > .styles, .row > .size { display: none; }
    .row { height: 34px; }
    .gap { height: 12px; }
    .rows { max-height: none; }
    .table { font-size: 13px; }
    .bottom { flex-wrap: wrap; }
  }
</style>
