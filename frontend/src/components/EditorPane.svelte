<script>
  // The editor pane: the open sheet; or, when several are selected or glued
  // together, all of them one after another, each its own sheet; and a
  // second editor beside it on request (translation mode puts a sheet's
  // counterpart there, paragraph beside paragraph).
  import Editor from './Editor.svelte';
  import InkPage from './InkPage.svelte';
  import Icon from './Icon.svelte';
  import { app, store, openSheet } from '../lib/state.svelte.js';
  import { menuUnder } from '../lib/ui.svelte.js';
  import { translationPair } from '../lib/translation.js';

  let first = $state(null);
  let views = new Map();
  const register = (p, v) => { if (v) views.set(p, v); else views.delete(p); };

  const sheets = $derived.by(() => {
    app.version;
    if (!store || !app.sheet || !store.exists(app.sheet)) return [];
    const flat = store.sheetList(app.selection).sections.flatMap((s) => s.sheets.map((x) => x.path));
    if (app.selected.length > 1) return flat.filter((p) => app.selected.includes(p)).slice(0, 50);
    const run = store.gluedRun(app.sheet);
    return run.length > 1 ? run : [app.sheet];
  });
  // a handwritten sheet (front matter "ink"): its page, and its text beside it when it's being typed up
  const ink = $derived.by(() => {
    app.version;
    if (sheets.length !== 1) return null;
    const rel = store.sheetInfo(sheets[0]).ink;
    if (!rel) return null;
    const dir = sheets[0].slice(0, sheets[0].lastIndexOf('/'));
    const drawing = `${dir}/${rel}`.replace(/\/\.\//gu, '/');
    return { sheet: sheets[0], drawing, picture: drawing.replace(/\.excalidraw\.md$/u, '.svg') };
  });
  const second = $derived.by(() => { app.version; return app.second && store && store.exists(app.second) ? app.second : null; });
  const pair = $derived.by(() => { app.version; return app.translation && app.sheet ? translationPair(store, app.sheet) : null; });
  const other = $derived(pair ? pair.other : second);

  export function focus() { if (first) first.focus(); }
  export function search() { if (first) first.doSearch(); }
  export function activeView() { return first ? first.getView() : null; }
  /** The editor the menus' text commands go to: the second when it has the cursor. */
  export function activeEditor() {
    const b = secondEditor && secondEditor.getView && secondEditor.getView();
    return b && b.hasFocus ? secondEditor : first;
  }
  /** ⌥⌘← / ⌥⌘→: from one editor to the other in the split view. */
  export function switchEditor() {
    const a = first && first.getView(), b = secondEditor && secondEditor.getView();
    if (!a || !b) return false;
    (a.hasFocus ? b : a).focus();
    return true;
  }

  let secondEditor = $state(null);
  let counts = $state(null);
  // translation mode: the two sides' paragraphs kept level (editor/align.js)
  $effect(() => {
    if (!pair) { counts = null; return; }
    app.version;
    const a = first && first.getView(), b = secondEditor && secondEditor.getView();
    if (!a || !b) return;
    const [orig, trans] = pair.side === 'original' ? [a, b] : [b, a];
    let stop = null;
    import('../editor/align.js').then((m) => { stop = m.alignViews(orig, trans, (c) => { counts = c; }); });
    return () => { if (stop) stop(); };
  });
</script>

<div class="pane" class:split={!!other} class:vertical={app.splitVertical}>
  <div class="ed first">
    {#if !sheets.length}
      <div class="none">No Sheet Selected</div>
    {:else if ink}
      <div class="inkpane" class:typing={app.inkTyping}>
        <div class="inkside">
          {#key ink.drawing}<InkPage inkPath={ink.drawing} svgPath={ink.picture} sheet={ink.sheet} typing={app.inkTyping} ontype={() => (app.inkTyping = !app.inkTyping)} />{/key}
        </div>
        {#if app.inkTyping}<div class="textside"><Editor bind:this={first} path={ink.sheet} {register} /></div>{/if}
      </div>
    {:else if sheets.length === 1}
      <Editor bind:this={first} path={sheets[0]} {register} />
    {:else}
      <div class="stack scroll">
        {#each sheets as p, i (p)}
          {#if i > 0}<div class="stack-sep"></div>{/if}
          {#if i === 0}
            <Editor bind:this={first} path={p} stacked {register} onactive={(q) => { if (q && q !== app.sheet) { app.sheet = q; } }} />
          {:else}
            <Editor path={p} stacked {register} onactive={(q) => { if (q && q !== app.sheet) { app.sheet = q; } }} />
          {/if}
        {/each}
      </div>
    {/if}
  </div>
  {#if other}
    <div class="ed second" class:dim={app.dimSecond}>
      <div class="second-bar">
        <span class="second-title">{pair ? (pair.side === 'original' ? 'Translation' : 'Original') : 'Second Editor'}{#if counts && counts.lines} · {counts.done} of {counts.lines} paragraphs{/if}</span>
        <button class="rings" title="Second editor" onclick={(e) => menuUnder(e.currentTarget, [
          { label: 'Swap Editors', action: () => { const a = app.sheet; openSheet(other); app.second = a; } },
          { label: app.splitVertical ? 'Arrange Left/Right' : 'Arrange Top/Bottom', action: () => { app.splitVertical = !app.splitVertical; } },
          { label: 'Dim Second Editor', checked: !!app.dimSecond, action: () => { app.dimSecond = !app.dimSecond; } },
          { sep: true },
          { label: pair ? 'Close Translation Mode' : 'Close Second Editor', action: () => { app.second = null; app.translation = false; } },
        ], 'right')}><Icon name="circle-ellipsis" size={15} /></button>
      </div>
      {#key other}
        <Editor bind:this={secondEditor} path={other} {register} />
      {/key}
    </div>
  {/if}
</div>

<style>
  .pane { height: 100%; display: flex; min-height: 0; min-width: 0; }
  .pane.vertical { flex-direction: column; }
  .ed { flex: 1; min-width: 0; min-height: 0; position: relative; }
  .split .ed.second { border-left: 1px solid var(--sep); }
  .split.vertical .ed.second { border-left: 0; border-top: 1px solid var(--sep); }
  .ed.second.dim { opacity: 0.6; }
  .ed.second.dim:focus-within { opacity: 1; }
  .second-bar { position: absolute; top: 6px; left: 12px; right: 12px; display: flex; align-items: center; z-index: 2; pointer-events: none; }
  .second-title { font-size: 11px; font-weight: 600; color: var(--section); text-transform: uppercase; letter-spacing: 0.05em; }
  .rings { margin-left: auto; border: 0; background: none; color: var(--icon-dim); pointer-events: auto; display: flex; padding: 2px; border-radius: 4px; }
  .rings:hover { color: var(--icon); background: var(--hint-bg); }
  .inkpane { height: 100%; display: flex; }
  .inkside { flex: 1; min-width: 0; min-height: 0; }
  .textside { flex: 1; min-width: 0; min-height: 0; border-left: 1px solid var(--sep); position: relative; }
  /* upright, or a narrow window: the page above, the text below */
  @media (max-aspect-ratio: 1/1) { .inkpane.typing { flex-direction: column; } .inkpane.typing .textside { border-left: 0; border-top: 1px solid var(--sep); } }
  .none { height: 100%; display: flex; align-items: center; justify-content: center; font-size: 27px; color: #b8b8b8; font-weight: 400; }
  .stack { height: 100%; padding: 40px 0 40vh; }
  .stack-sep { max-width: calc(var(--ed-width, 64) * 0.51em); margin: 18px auto; border-top: 1px dashed var(--sep-strong); font-size: 16px; }
</style>
