<script>
  // Settings (⌘,), in panes: General, Sidebar, Markup,
  // Backup, Sync, Styles.
  import Icon from './Icon.svelte';
  import MarkupPane from './MarkupPane.svelte';
  import { app, prefs, store, persist, toast, signOut, bump, backupKeeper } from '../lib/state.svelte.js';
  import { openDialog } from '../lib/ui.svelte.js';
  import { applyTheme, setCustomThemes } from '../lib/themes.js';
  import { STYLES, STYLE_ORDER, exportSheets } from '@export';

  const TABS = [['general', 'settings', 'General'], ['sidebar', 'panel-left', 'Sidebar'], ['markup', 'palette', 'Markup'], ['backup', 'history', 'Backup'], ['sync', 'send', 'Sync'], ['styles', 'pen-tool', 'Styles']];
  const FONTS = ['System Font', 'Georgia', 'Iowan Old Style', 'Palatino', 'Charter', 'Avenir Next', 'Helvetica Neue', 'Menlo', 'Courier Prime', 'American Typewriter', 'Frank Ruehl CLM', 'David CLM', 'Noto Serif Hebrew', 'Noto Sans Hebrew'];

  let backups = $state(null);
  let advanced = $state(false);
  let tokens = $state(null);
  let newToken = $state(null);
  let deviceName = $state('');
  let pw = $state({ current: '', next: '' });
  import { loadConfig, saveConfig, startSync, syncState } from '../lib/davsync.js';
  import { theStorage } from '../lib/state.svelte.js';
  const cfg0 = loadConfig();
  let dav = $state({ kind: cfg0 ? (cfg0.token ? 'moshe' : 'webdav') : 'off', url: cfg0 ? cfg0.site || cfg0.url : '', token: cfg0 ? cfg0.token || '' : '', user: cfg0 ? cfg0.user || '' : '', password: cfg0 ? cfg0.password || '' : '' });
  let syncInfo = $state({ ...syncState });
  syncState.listeners.add((st) => { syncInfo = { ...st }; });
  function saveDav() {
    if (dav.kind === 'off') { saveConfig(null); startSync(store, theStorage(), null); toast('Not syncing'); return; }
    const site = dav.url.trim().replace(/\/+$/u, '');
    const url = dav.kind === 'moshe' ? `${site}/dav/` : dav.url.trim();
    const cfg = dav.kind === 'moshe' ? { url, site, token: dav.token.trim() } : { url, user: dav.user, password: dav.password };
    saveConfig(cfg);
    startSync(store, theStorage(), cfg);
    toast('Syncing…');
  }
  // On a phone, Settings is a list of the panes, and a
  // pane pushed over it with a way back (Android's Back does the same, mosheBack).
  const phoneQuery = matchMedia('(max-width: 760px)');
  let phone = $state(phoneQuery.matches);
  phoneQuery.addEventListener('change', () => { phone = phoneQuery.matches; });
  let wasOpen = false;
  $effect(() => { const open = !!app.settingsOpen; if (open && !wasOpen) app.settingsPane = false; wasOpen = open; });
  const close = () => { app.settingsOpen = null; app.settingsPane = false; persist(); };
  const phoneBack = () => { if (app.settingsPane) app.settingsPane = false; else close(); };
  // a pane, or the list, starts at its top rather than where the last one was left
  let contentEl = $state(null);
  $effect(() => { app.settingsOpen; app.settingsPane; if (contentEl) contentEl.scrollTop = 0; });

  const dark = () => prefs.appearance === 'dark' || (prefs.appearance === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);

  $effect(() => {
    app.version;
    if (store) setCustomThemes(store.setting('themes', {}));
    const t = prefs.theme;
    prefs.appearance;
    applyTheme(t, dark());
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => applyTheme(prefs.theme, dark());
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  });

  // a style's look, as its export makes it: the top of a page with a title and some text
  const LOREM = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.\n\nDuis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.';
  const previews = {};
  function stylePreview(id) {
    if (!previews[id]) {
      const name = STYLES[id].name;
      try { previews[id] = exportSheets([{ title: name, path: `${name}.md`, body: `# ${name}\n${LOREM}` }], { format: 'html', style: id, title: name, full: true }).text; } catch { previews[id] = ''; }
    }
    return previews[id];
  }

  $effect(() => { const tab = app.settingsOpen; if (tab === 'backup' && backupKeeper().kind === 'server') loadBackups(); if (tab === 'sync' && app.mode === 'server') loadTokens(); });

  async function loadBackups() {
    try { const r = await fetch('/api/backups'); backups = r.ok ? (await r.json()).backups : []; } catch { backups = []; }
  }
  async function backupNow() {
    const r = await fetch('/api/backups', { method: 'POST' });
    if (r.ok) { toast('Backed up'); loadBackups(); } else toast('The server does not keep backups (MOSHE_BACKUPS).');
  }
  async function loadTokens() {
    try { const r = await fetch('/api/tokens'); tokens = r.ok ? (await r.json()).tokens : []; } catch { tokens = []; }
  }
  async function addDevice() {
    const r = await fetch('/api/tokens', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: deviceName.trim() }) });
    const d = await r.json();
    if (!r.ok) { toast(d.error || 'Could not add the device'); return; }
    newToken = d;
    deviceName = '';
    loadTokens();
  }
  async function removeDevice(name) {
    await fetch(`/api/tokens/${encodeURIComponent(name)}`, { method: 'DELETE' });
    loadTokens();
  }
  async function changePassword() {
    const r = await fetch('/api/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: pw.current, newPassword: pw.next }) });
    const d = await r.json().catch(() => ({}));
    toast(r.ok ? 'Password changed. Other devices are signed out.' : d.error || 'Could not change it');
    if (r.ok) pw = { current: '', next: '' };
  }
  const libSetting = (k, d) => { app.version; return store ? store.setting(k, d) : d; };
  const fmtDate = (ms) => new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
</script>

{#if app.settingsOpen}
  <div class="overlay" role="presentation" onmousedown={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div class="win popover" role="dialog" aria-label="Settings">
      {#if phone}
        <div class="phonebar">
          <button class="pback" aria-label={app.settingsPane ? 'Back to Settings' : 'Close Settings'} onclick={phoneBack}><Icon name="chevron-left" size={22} stroke={2} />{app.settingsPane ? 'Settings' : ''}</button>
          <span class="ptitle">{app.settingsPane ? TABS.find((t) => t[0] === app.settingsOpen)?.[2] : 'Settings'}</span>
        </div>
      {:else}
        <div class="titlebar">
          <button class="close" aria-label="Close" onclick={close}></button>
          <span>{TABS.find((t) => t[0] === app.settingsOpen)?.[2]}</span>
        </div>
        <div class="tabs">
          {#each TABS as [k, ic, label]}
            <button class:on={app.settingsOpen === k} onclick={() => (app.settingsOpen = k)}><Icon name={ic} size={20} stroke={1.5} /><span>{label}</span></button>
          {/each}
        </div>
      {/if}
      <div class="content" bind:this={contentEl}>
        {#if phone && !app.settingsPane}
          <div class="plist">
            {#each TABS as [k, ic, label]}
              <button class="pitem" onclick={() => { app.settingsOpen = k; app.settingsPane = true; }}>
                <span class="picon"><Icon name={ic} size={19} stroke={1.6} /></span><span class="plabel">{label}</span><Icon name="chevron-right" size={16} stroke={2} />
              </button>
            {/each}
          </div>
        {:else if app.settingsOpen === 'general'}
          <select class="fontpick" bind:value={prefs.font}>{#each FONTS as f}<option value={f}>{f}</option>{/each}</select>
          <div class="form">
            <label for="s-lh">Line Height:</label><span><input id="s-lh" class="field n" type="number" step="0.1" min="1" max="3" bind:value={prefs.lineHeight} /></span>
            <label for="s-ps">Paragraph Spacing:</label><span><input id="s-ps" class="field n" type="number" step="0.5" min="0" max="4" bind:value={prefs.paragraphSpacing} /></span>
            <label for="s-fi">First Line Indent:</label><span><input id="s-fi" class="field n" type="number" step="0.5" min="0" max="6" bind:value={prefs.firstLineIndent} /></span>
            <label for="s-lw" class="gap">Line Width:</label><span class="gap"><input id="s-lw" class="field n" type="number" step="2" min="30" max="140" bind:value={prefs.lineWidth} /> <em>(Characters)</em></span>
            <label for="s-fs">Font Size:</label><span><input id="s-fs" class="field n" type="number" min="10" max="40" bind:value={prefs.fontSize} /> <em>(⌘+ ⌘− ⌘0)</em></span>
            <label class="gap"><input type="checkbox" bind:checked={prefs.imagePreviews} /> Image Previews:</label>
            <span class="gap"><input class="field n" type="number" min="3" max="8" bind:value={prefs.imageLines} disabled={!prefs.imagePreviews} /> <em>(Lines)</em><br /><label><input type="checkbox" bind:checked={prefs.imageColor} disabled={!prefs.imagePreviews} /> Full Color</label></span>
            <span class="lbl gap">Insertion Point:</span>
            <span class="gap radios">
              {#each [['text', 'Text Color'], ['accent', 'Accent Color']] as [v, l]}<label><input type="radio" bind:group={prefs.caret} value={v} /> {l}</label>{/each}
            </span>
            <hr class="rule" />
            <span class="lbl gap">Appearance:</span>
            <span class="gap radios">
              {#each [['system', 'Match System'], ['light', 'Light'], ['dark', 'Dark']] as [v, l]}<label><input type="radio" bind:group={prefs.appearance} value={v} /> {l}</label>{/each}
            </span>
            <span class="lbl">Editing:</span>
            <span class="checks">
              <label><input type="checkbox" bind:checked={prefs.smartLists} /> Smart Lists</label>
              <label><input type="checkbox" bind:checked={prefs.smartTags} /> Smart Tags (:: ++ || typed as the file’s tags)</label>
              <label><input type="checkbox" bind:checked={prefs.grammar} /> Check Grammar and Spelling While Typing (English)
                <select class="field" bind:value={prefs.dialect} disabled={!prefs.grammar}>{#each [[0, 'American'], [1, 'British'], [2, 'Australian'], [3, 'Canadian'], [4, 'Indian']] as [v, l]}<option value={v}>{l}</option>{/each}</select></label>
              <label><input type="checkbox" bind:checked={prefs.hebrewSpelling} /> Check Hebrew Spelling While Typing</label>
              <label><input type="checkbox" bind:checked={prefs.penMarks} /> Pen Marks in Revision Mode (strike, scribble, caret, circle)</label>
              <label><input type="checkbox" bind:checked={prefs.spellcheck} /> Check Spelling While Typing{#if prefs.grammar || prefs.hebrewSpelling}{' (other languages)'}{/if}</label>
              <label><input type="checkbox" bind:checked={prefs.showCounter} /> Show Counter</label>
              <label><input type="checkbox" bind:checked={prefs.pageBackground} /> Show Page Background</label>
              <label><input type="checkbox" bind:checked={prefs.sheetListDates} /> Show Dates in the Sheet List</label>
            </span>
            <span class="lbl">Typewriter:</span>
            <span class="checks">
              <label><input type="checkbox" bind:checked={app.typewriter.marker} onchange={persist} /> Line Marker</label>
              <label>Highlight <select class="field" bind:value={app.typewriter.highlight} onchange={persist}><option value="off">Off</option><option value="line">Line</option><option value="sentence">Sentence</option><option value="paragraph">Paragraph</option></select></label>
              <label>Fixed Scrolling <select class="field" bind:value={app.typewriter.fixed} onchange={persist}><option value="off">Off</option><option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option><option value="variable">Variable</option></select></label>
            </span>
            <span class="lbl gap">Handwriting:</span>
            <span class="gap"><label>New pages on <select class="field" bind:value={prefs.inkPaper}><option value="lined">Lined</option><option value="blank">Blank</option><option value="dotted">Dotted</option><option value="grid">Grid</option><option value="cornell">Cornell</option></select> paper</label></span>
            <span class="lbl gap">Getting Started:</span>
            <span class="gap"><button class="btn" onclick={() => window.mosheCommand('gettingStarted')}>Add to the Inbox</button></span>
          </div>

        {:else if app.settingsOpen === 'sidebar'}
          <div class="form sidebar">
            <span class="lbl">Show:</span>
            <span class="shows">
              {#each [['globalFilters', false, 'Global Filters', 'Adds a top section to your library, for quick access to all of your content.'], ['showProjects', true, 'Projects', 'For self-contained projects like books, blogs, etc.'], ['showNotes', true, 'Notes', 'For loose content.']] as [key, dflt, label, note]}
                <label><input type="checkbox" checked={libSetting(key, dflt)} onchange={(e) => store.setSetting(key, e.target.checked)} /> {label}<small>{note}</small></label>
              {/each}
            </span>
            <span></span>
            <span><button class="btn" onclick={() => (advanced = true)}>Advanced…</button></span>
          </div>
          {#if advanced}
            <div class="sheet-over" role="presentation" onmousedown={(e) => { if (e.target === e.currentTarget) advanced = false; }}>
              <div class="sheet popover" role="dialog" aria-label="Advanced sidebar settings">
                <div class="checks">
                  {#each [['alwaysShowTrash', false, 'Always Show Trash'], ['globalFiltersIncludeProjects', false, 'Include Projects in Global Filters'], ['inboxCounter', false, 'Show Inbox Counter'], ['showArchive', true, 'Show Project Archive']] as [key, dflt, label]}
                    <label><input type="checkbox" checked={libSetting(key, dflt)} onchange={(e) => store.setSetting(key, e.target.checked)} /> {label}</label>
                  {/each}
                </div>
                <p class="dim small">{app.mode === 'server' ? 'The library is a folder on the server.' : 'The library is a folder on this device.'} Groups are folders and sheets are Markdown files; Obsidian and any other editor can open them.</p>
                <div class="row end">
                  <button class="btn" onclick={() => { app.hints = {}; persist(); toast('The hints are back'); }}>Show Hints Again</button>
                  <span class="grow"></span>
                  <button class="btn primary" onclick={() => (advanced = false)}>Done</button>
                </div>
              </div>
            </div>
          {/if}

        {:else if app.settingsOpen === 'markup'}
          <MarkupPane dark={dark()} />

        {:else if app.settingsOpen === 'backup' && backupKeeper().kind !== 'server'}
          {@const keeper = backupKeeper()}
          <div class="center">
            <p class="big"><Icon name="history" size={22} /> {keeper.kind === 'synced' ? 'Backups are kept by the server' : 'No server backs up this library'}</p>
            {#if keeper.kind === 'synced'}
              <p class="dim">This library is a folder on this device, kept in step with {keeper.host}. That server backs up what reaches it every hour there are changes: open Moshe there to browse or restore them.</p>
            {:else}
              <p class="dim">This library is a folder on this device. Set up Sync with a Moshe server and the server backs it up every hour there are changes; or keep the folder in Time Machine.</p>
            {/if}
          </div>

        {:else if app.settingsOpen === 'backup'}
          <div class="center">
            <p class="big"><Icon name="history" size={22} /> Backups are kept by the server</p>
            <ul class="dim">
              <li>Hourly backups for the last 12 hours of work</li>
              <li>Daily backups for the last 7 days of work</li>
              <li>Weekly backups for the past 6 months of work</li>
            </ul>
            {#if backups && backups.length}<p>Latest backup: {fmtDate(backups[0].at)}</p>{:else if backups}<p class="dim">No backups yet.</p>{/if}
            <div class="row">
              <button class="btn" onclick={backupNow}>Backup Now</button>
              <button class="btn" onclick={() => openDialog('backups')}>Browse Backups…</button>
            </div>
            <p class="dim small">Each backup is a copy of the library's sheets and settings, kept outside the library, so no sync carries them. Backups made with Backup Now are kept until you delete them.</p>
          </div>

        {:else if app.settingsOpen === 'sync'}
          {#if app.mode === 'server'}
            <div class="form">
              <span class="lbl">This library:</span>
              <span class="dim">Lives on the server. The Mac and Android apps keep a folder of their own, moved by Syncthing — or, with no Syncthing, synced with this server over WebDAV with a device token made here.</span>
              <span class="lbl gap">Devices:</span>
              <span class="gap">
                {#if tokens}
                  {#each tokens as t}<div class="dev"><Icon name="keyboard" size={14} /> {t.name} <button class="btn" onclick={() => removeDevice(t.name)}>Remove</button></div>{/each}
                  {#if !tokens.length}<div class="dim">No devices yet.</div>{/if}
                {/if}
                <div class="dev"><input class="field" placeholder="Phone" bind:value={deviceName} /> <button class="btn" disabled={!deviceName.trim()} onclick={addDevice}>Add a Device</button></div>
                {#if newToken}
                  <div class="token">Token for {newToken.name}, shown only now:<code>{newToken.token}</code>WebDAV address: <code>{location.origin}/dav/</code></div>
                {/if}
              </span>
              <span class="lbl gap">Password:</span>
              <span class="gap">
                <input class="field" type="password" placeholder="Current password" bind:value={pw.current} />
                <input class="field" type="password" placeholder="New password" bind:value={pw.next} />
                <button class="btn" disabled={!pw.current || pw.next.length < 8} onclick={changePassword}>Change</button>
              </span>
              <span class="lbl gap">Session:</span>
              <span class="gap"><button class="btn" onclick={signOut}>Sign Out</button></span>
            </div>
          {:else}
            <div class="form">
              <span class="lbl">This library:</span>
              <span class="dim">A folder on this device. Whatever syncs it (Syncthing, iCloud Drive, Dropbox) carries it to your other devices — or, with none, sync it with your Moshe server here.</span>
              <span class="lbl gap">Sync with:</span>
              <span class="gap radios">
                <label><input type="radio" bind:group={dav.kind} value="off" /> Nothing (another app syncs this folder)</label>
              </span>
              <span></span>
              <span class="radios"><label><input type="radio" bind:group={dav.kind} value="moshe" /> A Moshe server</label><label><input type="radio" bind:group={dav.kind} value="webdav" /> A WebDAV folder</label></span>
              {#if dav.kind !== 'off'}
                <label for="dav-url">Address:</label>
                <input id="dav-url" class="field" bind:value={dav.url} placeholder={dav.kind === 'moshe' ? 'https://moshe.example.com' : 'https://cloud.example.com/remote.php/dav/files/me/Writing/'} />
                {#if dav.kind === 'moshe'}
                  <label for="dav-token">Device token:</label>
                  <input id="dav-token" class="field" type="password" bind:value={dav.token} placeholder="msh_… (Settings → Sync on the server)" />
                {:else}
                  <label for="dav-user">User:</label><input id="dav-user" class="field" bind:value={dav.user} />
                  <label for="dav-pw">Password:</label><input id="dav-pw" class="field" type="password" bind:value={dav.password} />
                {/if}
              {/if}
              <span></span>
              <span class="row"><button class="btn primary" onclick={saveDav}>{dav.kind === 'off' ? 'Stop Syncing' : 'Save and Sync'}</button>
                {#if syncInfo.now}<button class="btn" onclick={() => syncInfo.now && syncInfo.now()}>Sync Now</button>{/if}</span>
              <span class="lbl">Status:</span>
              <span class="dim">{syncInfo.running ? 'Syncing…' : syncInfo.error ? `Couldn't sync: ${syncInfo.error}` : syncInfo.last ? `Last synced ${new Date(syncInfo.last.at).toLocaleTimeString()}: ${syncInfo.last.sent.length} sent, ${syncInfo.last.taken.length} taken, ${syncInfo.last.merged.length} merged` : syncInfo.config ? 'Waiting' : 'Not syncing'}</span>
            </div>
          {/if}

        {:else if app.settingsOpen === 'styles'}
          <div class="stylepane">
            <div class="sgroup">
              <div class="shead">PDF, DOCX, ePub & HTML</div>
              <div class="styles">
                {#each STYLE_ORDER as id}
                  {@const st = STYLES[id]}
                  <div class="style" title={st.description || st.name}>
                    <div class="thumb"><iframe title={st.name} srcdoc={stylePreview(id)} sandbox="" tabindex="-1" loading="lazy"></iframe></div>
                    <span class="sname">{st.name}<Icon name="lock" size={9} /></span>
                  </div>
                {/each}
              </div>
            </div>
            <p class="dim small">Pick a style in the export window (⇧⌘P); a project remembers its own.</p>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay { position: fixed; inset: 0; z-index: 55; display: flex; align-items: flex-start; justify-content: center; padding: 90px 20px 20px; background: transparent; }
  .win { position: relative; width: 690px; max-width: 100%; max-height: calc(100vh - 120px); display: flex; flex-direction: column; border-radius: 12px; overflow: hidden; }
  .titlebar { height: 30px; display: flex; align-items: center; justify-content: center; position: relative; font-size: 13px; font-weight: 600; color: var(--muted); }
  .close { position: absolute; left: 12px; top: 9px; width: 12px; height: 12px; border-radius: 50%; border: 0; background: #ff5f57; padding: 0; }
  .tabs { display: flex; justify-content: center; gap: 2px; padding: 4px 0 8px; border-bottom: 1px solid var(--sep); }
  .tabs button { width: 62px; height: 50px; border: 0; background: none; border-radius: 7px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; color: var(--muted); font-size: 11px; }
  .tabs button.on { background: var(--hint-bg); color: var(--accent-fg); }
  .content { padding: 28px 40px 30px; overflow: auto; font-size: 13px; }
  .fontpick { display: block; width: 100%; height: 62px; font-size: 22px; text-align: center; text-align-last: center; border: 1px solid var(--sep); border-radius: 10px; background: var(--popover-bg); margin-bottom: 24px; color: var(--text); }
  .form { display: grid; grid-template-columns: 200px 1fr; gap: 10px 10px; align-items: center; }
  .form > label, .form > .lbl { text-align: right; justify-self: end; display: flex; gap: 5px; align-items: center; }
  .form .gap { margin-top: 12px; }
  .form em { color: var(--muted); font-style: normal; }
  .n { width: 56px; }
  .checks { display: flex; flex-direction: column; gap: 5px; }
  .checks label { display: flex; gap: 6px; align-items: center; }
  .radios { display: flex; gap: 14px; }
  .form.sidebar .lbl { align-self: start; }
  .shows { display: flex; flex-direction: column; gap: 10px; }
  .shows label { display: grid; grid-template-columns: auto 1fr; column-gap: 6px; align-items: center; }
  .shows small { grid-column: 2; color: var(--muted); font-size: 11px; line-height: 1.35; max-width: 320px; }
  .sheet-over { position: absolute; inset: 0; z-index: 5; display: flex; justify-content: center; align-items: flex-start; background: rgba(0, 0, 0, 0.08); }
  .sheet { margin-top: 30px; width: 400px; max-width: calc(100% - 40px); padding: 20px 22px 16px; border-radius: 10px; display: flex; flex-direction: column; gap: 12px; }
  .row.end { align-items: center; }
  .grow { flex: 1; }
  .radios label { display: flex; gap: 4px; align-items: center; }
  .rule { grid-column: 1 / -1; width: 100%; border: 0; border-top: 1px solid var(--sep); margin: 14px 0 4px; }
  .center { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .center ul { text-align: left; margin: 0; }
  .big { font-size: 16px; display: flex; gap: 8px; align-items: center; margin: 0; }
  .row { display: flex; gap: 10px; }
  .small { font-size: 12px; max-width: 440px; }
  .dev { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
  .stylepane { display: flex; flex-direction: column; gap: 10px; }
  .sgroup { border: 1px solid var(--sep); border-radius: 6px; overflow: hidden; }
  .shead { font-size: 11px; font-weight: 700; padding: 5px 8px; border-bottom: 1px solid var(--sep); background: var(--list-bg, var(--editor-bg)); }
  .styles { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 14px 12px; padding: 12px; }
  .style { display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 5px; border-radius: 3px; }
  .thumb { width: 126px; height: 76px; overflow: hidden; background: #fff; box-shadow: 0 0 0 1px var(--sep); position: relative; }
  .thumb iframe { position: absolute; left: 0; top: 0; width: 360px; height: 217px; border: 0; transform: scale(0.35); transform-origin: 0 0; pointer-events: none; }
  .sname { font-size: 11px; display: flex; gap: 4px; align-items: center; }
  .sname :global(svg) { opacity: 0.55; }
  .token { background: var(--hint-bg); border-radius: 8px; padding: 10px; font-size: 12px; display: flex; flex-direction: column; gap: 4px; }
  .token code { user-select: all; -webkit-user-select: all; word-break: break-all; background: var(--popover-bg); padding: 4px 6px; border-radius: 5px; }

  /* A phone: the whole screen, a list of the panes, and each pane in one column,
     every label above what it sets, nothing wider than the screen. */
  @media (max-width: 760px) {
    .overlay { padding: 0; align-items: stretch; }
    .win { width: 100%; height: 100%; max-height: none; border-radius: 0; box-shadow: none; padding-top: env(safe-area-inset-top, 0px); }
    .phonebar { flex: none; height: 52px; display: flex; align-items: center; position: relative; border-bottom: 1px solid var(--sep); }
    .pback { position: relative; z-index: 1; border: 0; background: none; color: var(--accent-fg); display: flex; align-items: center; gap: 0; height: 44px; padding: 0 12px 0 6px; font-size: 16px; }
    .ptitle { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 17px; font-weight: 600; color: var(--text-strong, var(--text)); pointer-events: none; }
    .content { flex: 1; padding: 16px 16px calc(28px + env(safe-area-inset-bottom, 0px)); overflow-x: hidden; font-size: 15px; }
    .plist { display: flex; flex-direction: column; border-radius: 12px; overflow: hidden; background: var(--hint-bg); }
    .pitem { display: flex; align-items: center; gap: 12px; height: 52px; padding: 0 14px; border: 0; background: none; color: var(--text); font-size: 16px; text-align: left; }
    .pitem + .pitem { border-top: 1px solid var(--sep); }
    .pitem :global(svg:last-child) { color: var(--muted); }
    .picon { width: 30px; height: 30px; border-radius: 7px; display: flex; align-items: center; justify-content: center; background: var(--accent); color: var(--on-accent); flex: none; }
    .picon :global(svg) { color: var(--on-accent); stroke: var(--on-accent); opacity: 1; }
    .plabel { flex: 1; }
    .fontpick { height: 50px; font-size: 18px; margin-bottom: 18px; }
    .form { grid-template-columns: minmax(0, 1fr); gap: 6px; }
    .form > label, .form > .lbl { justify-self: start; text-align: left; font-weight: 600; color: var(--muted); font-size: 13px; margin-top: 8px; }
    .form > span, .form > input { min-width: 0; }
    .form > input.field { width: 100%; }
    .form .gap { margin-top: 14px; }
    .form > label.gap:has(input[type=checkbox]) { font-weight: 400; color: var(--text); font-size: 15px; }
    .n { width: 72px; }
    .checks { gap: 12px; }
    /* the box in its own column, the words wrapping beside it, a menu under the words */
    .checks label { display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: 8px; align-items: start; line-height: 1.35; }
    .checks label :global(input[type=checkbox]) { margin-top: 2px; }
    .checks label :global(select) { grid-column: 2; justify-self: start; margin-top: 6px; }
    .checks label:not(:has(input[type=checkbox])) { grid-template-columns: auto auto; justify-content: start; align-items: center; }
    .checks label:not(:has(input[type=checkbox])) :global(select) { grid-column: auto; margin-top: 0; }
    .radios { flex-wrap: wrap; gap: 10px 16px; }
    .shows small { max-width: none; font-size: 12px; }
    .sheet { width: calc(100% - 32px); }
    .dev { flex-wrap: wrap; }
    .dev :global(input) { flex: 1; min-width: 0; }
    .form :global(input[type=password]) { width: 100%; margin-bottom: 6px; }
    .row { flex-wrap: wrap; }
    .small { max-width: none; }
    .rule { margin: 12px 0 0; }
  }
</style>
