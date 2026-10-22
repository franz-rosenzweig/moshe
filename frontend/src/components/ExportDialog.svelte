<script>
  // Export (⇧⌘P): the sheets as PDF, DOCX, ePub, HTML or text, in an export
  // style, with a preview.
  import Icon from './Icon.svelte';
  import { store, toast, app, theStorage } from '../lib/state.svelte.js';
  import { exportSheets, STYLES, STYLE_ORDER } from '@export';
  import { splitSheet } from '@engine/sheet.js';

  let { dialog } = $props();
  const FORMATS = [['text', 'Text'], ['html', 'HTML'], ['epub', 'ePub'], ['pdf', 'PDF'], ['docx', 'DOCX']];
  const SAVED = 'moshe.export';
  const saved = (() => { try { return JSON.parse(localStorage.getItem(SAVED) || '{}'); } catch { return {}; } })();
  const projectKey = (() => dialog.project || "")();
  let format = $state(dialog.print ? 'pdf' : (saved[projectKey] && saved[projectKey].format) || saved.format || 'pdf');
  const remembered = (saved[projectKey] && saved[projectKey].style) || saved.style;
  let style = $state(STYLES[remembered] ? remembered : 'everyday');
  let textKind = $state(saved.textKind || 'markdown');
  let pageSize = $state(saved.pageSize || 'a4');
  let title = $state(dialog.title || 'Untitled');
  let author = $state(saved.author || '');
  let htmlFull = $state(true);
  let preview = $state('');
  let error = $state(null);
  let busy = $state(false);

  // an image's address, written relative to its sheet, made the library's
  // own path, so the exporter finds its bytes (loaded below) whatever sheet
  // it is in
  const resolveIn = (dir, url) => {
    const parts = dir ? dir.split('/') : [];
    for (const seg of decodeURI(url).split('/')) { if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg); }
    return parts.join('/');
  };
  const IMG = /!\[([^\]]*)\]\(<?([^)\s>]+)>?([^)]*)\)/gu;
  const sheets = $derived(dialog.paths.map((p) => {
    const info = store.sheetInfo(p);
    const dir = p.slice(0, p.lastIndexOf('/'));
    const body = splitSheet(store.text(p) || '').body.replace(IMG, (m, alt, url, rest) =>
      (/^(https?:|data:|blob:)/iu.test(url) ? m : `![${alt}](${encodeURI(resolveIn(dir, url))}${rest})`));
    return { title: info.title, body, path: p };
  }));
  let images = $state({});
  $effect(() => {
    const s = theStorage();
    if (!s || !s.rawUrl) return;
    const want = new Set();
    for (const sh of sheets) for (const m of sh.body.matchAll(IMG)) if (!/^(https?:|data:|blob:)/iu.test(m[2])) want.add(m[2]);
    (async () => {
      const got = {};
      for (const url of want) {
        try {
          const r = await fetch(s.rawUrl(decodeURI(url)), { credentials: 'same-origin' });
          if (!r.ok) continue;
          got[url] = { bytes: new Uint8Array(await r.arrayBuffer()), type: (r.headers.get('content-type') || '').split(';')[0] || 'image/png' };
        } catch { /* shown as its caption */ }
      }
      if (Object.keys(got).length) images = got;
    })();
  });

  function remember() {
    try {
      const all = JSON.parse(localStorage.getItem(SAVED) || '{}');
      all.format = format; all.style = style; all.textKind = textKind; all.pageSize = pageSize; all.author = author;
      if (projectKey) all[projectKey] = { format, style };
      localStorage.setItem(SAVED, JSON.stringify(all));
    } catch { /* not kept */ }
  }

  function opts(fmt) {
    // no lang: the exporter tells a Hebrew book from its paragraphs, and sets the page right to left
    return { format: fmt, style, title, author, pageSize, images };
  }

  $effect(() => {
    format; style; pageSize; title; author; textKind; images;
    try {
      error = null;
      const out = exportSheets(sheets, opts(format === 'text' ? (textKind === 'plain' ? 'text' : 'markdown') : 'pdf-html'));
      preview = format === 'text' ? '' : out.text;
      if (format === 'text') preview = `<pre style="white-space:pre-wrap;font:13px/1.5 ui-monospace,Menlo,monospace;padding:24px;margin:0">${String(out.text).replace(/[&<>]/gu, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</pre>`;
    } catch (e) { error = e.message; preview = ''; }
  });

  const safeName = (s) => (s || 'Untitled').replace(/[\\/:*?"<>|]/gu, '-').slice(0, 80);

  // Share… (File menu): the same export, handed to the system's share sheet where the shell has one
  const sharing = !!dialog.share;
  // Print… (File menu): the PDF's page, printed (the Mac shell prints it itself if it can)
  const printing = !!dialog.print;
  async function download(data, mime, ext) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const shell = window.mosheShell;
    if (sharing && shell && shell.share) {
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      await shell.share(`${safeName(title)}.${ext}`, btoa(bin), mime);
      return;
    }
    if (shell && shell.saveFile) {
      // the Mac's save panel, Android's create-document: the shell writes it
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      await shell.saveFile(`${safeName(title)}.${ext}`, btoa(bin), mime);
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${safeName(title)}.${ext}`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  function printHtml(html) {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(f);
    f.srcdoc = html;
    f.onload = () => {
      setTimeout(() => {
        try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast(`Could not print: ${e.message}`); }
        setTimeout(() => f.remove(), 60000);
      }, 250);
    };
  }

  async function doExport() {
    busy = true;
    remember();
    try {
      if (printing) {
        const out = exportSheets(sheets, opts('pdf-html'));
        const shell = window.mosheShell;
        if (shell && shell.print) await shell.print(out.text, `${safeName(title)}.pdf`); else printHtml(out.text);
      } else if (format === 'pdf') {
        const out = exportSheets(sheets, opts('pdf-html'));
        // the Mac shell saves the PDF where its save panel says; Android's and the browser's go through a print window
        const shell = window.mosheShell;
        if (sharing && shell && shell.sharePdf) await shell.sharePdf(out.text, `${safeName(title)}.pdf`);
        else if (shell && shell.savePdf) {
          const saved = await shell.savePdf(out.text, `${safeName(title)}.pdf`);
          if (/Android/iu.test(navigator.userAgent)) toast('Choose “Save as PDF” in the print window.');
          else if (saved) toast('PDF saved');
        } else {
          printHtml(out.text);
          toast('Choose “Save as PDF” in the print window.');
        }
      } else {
        const fmt = format === 'text' ? (textKind === 'plain' ? 'text' : textKind === 'textbundle' ? 'textbundle' : 'markdown') : format === 'html' ? 'html' : format;
        const out = exportSheets(sheets, { ...opts(fmt), full: htmlFull });
        await download(out.bytes || out.text, out.mime, out.extension);
      }
      dialog.resolve(true);
    } catch (e) { toast(`Could not export: ${e.message}`, 6000); } finally { busy = false; }
  }

  async function copy(kind) {
    try {
      if (kind === 'markdown') {
        await navigator.clipboard.writeText(exportSheets(sheets, opts('markdown')).text);
      } else {
        const html = exportSheets(sheets, { ...opts('html'), full: false }).text;
        const text = exportSheets(sheets, opts('text')).text;
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
      }
      toast(kind === 'substack' ? 'Copied for Substack: paste it into a new post.' : 'Copied');
    } catch (e) { toast(`Could not copy: ${e.message}`); }
  }
</script>

<div class="overlay" role="presentation" onmousedown={(e) => { if (e.target === e.currentTarget) dialog.resolve(null); }}>
  <div class="win popover" role="dialog" aria-label="Export" onkeydown={(e) => { if (e.key === 'Escape') dialog.resolve(null); }}>
    <div class="top">
      <button class="x" onclick={() => dialog.resolve(null)} aria-label="Close"><Icon name="x" size={14} /></button>
      <div class="seg">
        {#each FORMATS as [f, label]}<button class:on={format === f} onclick={() => (format = f)}>{label}</button>{/each}
      </div>
      <span class="count dim">{sheets.length} sheet{sheets.length === 1 ? '' : 's'}</span>
    </div>
    <div class="settings">
      {#if format === 'text'}
        <select class="field" bind:value={textKind}><option value="markdown">Markdown</option><option value="plain">Plain Text</option><option value="textbundle">TextPack (with images)</option></select>
      {:else}
        <select class="field" bind:value={style} title="Style">{#each STYLE_ORDER as s}<option value={s}>{STYLES[s].name}</option>{/each}</select>
      {/if}
      {#if format === 'pdf' || format === 'docx'}
        <select class="field" bind:value={pageSize}><option value="a4">A4</option><option value="letter">US Letter</option><option value="a5">A5</option></select>
      {/if}
      {#if format === 'epub' || format === 'docx' || format === 'pdf'}
        <input class="field" bind:value={title} placeholder="Title" />
        <input class="field" bind:value={author} placeholder="Author" />
      {/if}
      {#if format === 'html'}
        <label class="chk"><input type="checkbox" bind:checked={htmlFull} /> Full page</label>
      {/if}
    </div>
    <div class="preview">
      {#if error}<div class="err">{error}</div>{:else}<iframe title="Preview" srcdoc={preview} sandbox="allow-same-origin"></iframe>{/if}
    </div>
    <div class="foot">
      {#if format === 'html' || format === 'text'}
        <button class="btn" onclick={() => copy(format === 'text' ? 'markdown' : 'html')}>Copy</button>
      {/if}
      <button class="btn" onclick={() => copy('substack')}>Copy for Substack</button>
      <span style="flex:1"></span>
      <button class="btn" onclick={() => dialog.resolve(null)}>Cancel</button>
      <button class="btn primary" disabled={busy || !!error} onclick={doExport}>{printing ? 'Print…' : sharing ? 'Share…' : format === 'pdf' ? 'Export PDF…' : 'Export'}</button>
    </div>
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; background: var(--overlay); z-index: 60; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .win { position: relative; width: min(920px, 100%); height: min(760px, 100%); display: flex; flex-direction: column; overflow: hidden; }
  .top { height: 52px; display: flex; align-items: center; justify-content: center; position: relative; border-bottom: 1px solid var(--sep); flex: none; }
  .x { position: absolute; left: 14px; border: 0; background: none; color: var(--muted); display: flex; padding: 4px; border-radius: 5px; }
  .count { position: absolute; right: 16px; font-size: 12px; }
  .seg { display: flex; background: var(--hint-bg); border-radius: 8px; padding: 2px; }
  .seg button { border: 0; background: none; padding: 4px 14px; border-radius: 6px; font-size: 13px; color: var(--text); }
  .seg button.on { background: var(--popover-bg); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12); font-weight: 600; }
  .settings { display: flex; gap: 8px; justify-content: center; align-items: center; padding: 10px; border-bottom: 1px solid var(--sep); flex: none; flex-wrap: wrap; }
  .chk { display: flex; gap: 5px; align-items: center; }
  .preview { flex: 1; min-height: 0; background: #8e8e93; padding: 16px; }
  .preview iframe { width: 100%; height: 100%; border: 0; background: #fff; border-radius: 3px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25); }
  .err { color: #fff; padding: 20px; }
  .foot { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--sep); flex: none; }
</style>
