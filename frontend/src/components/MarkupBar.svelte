<script>
  // On a phone or a tablet, the bar above the on-screen keyboard with the tags: headings, strong, emphasis, mark, comment, link, footnote, lists,
  // quote; undo and redo; and the keyboard away. It sits on top of the
  // keyboard, wherever the keyboard leaves the page.
  import Icon from './Icon.svelte';
  import { toggleWrap, setHeading, toggleBlock } from '../editor/markup-view.js';
  import { undo, redo } from '@codemirror/commands';

  let { view } = $props();
  let bottom = $state(0);
  let shown = $state(false);

  $effect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    // The keyboard either covers the page (iOS, Chrome's overlays-content: the
    // visual viewport shrinks and the page does not) or the page is shortened
    // for it (Android's app, resizes-content: both shrink). The first leaves a
    // gap to sit above; the second is the keyboard up with the bar at the bottom.
    const tallest = {};                 // the page's full height at each width
    const place = () => {
      const w = window.innerWidth, h = window.innerHeight;
      tallest[w] = Math.max(tallest[w] || 0, h);
      const over = h - vv.height - vv.offsetTop;
      const shortened = tallest[w] - h;
      bottom = Math.max(0, over);
      shown = (over > 80 || shortened > 80) && !!document.activeElement && !!document.activeElement.closest('.cm-editor');
    };
    window.addEventListener('resize', place);
    vv.addEventListener('resize', place);
    vv.addEventListener('scroll', place);
    document.addEventListener('focusin', place);
    document.addEventListener('focusout', () => setTimeout(place, 50));
    place();
    return () => { window.removeEventListener('resize', place); vv.removeEventListener('resize', place); vv.removeEventListener('scroll', place); document.removeEventListener('focusin', place); };
  });

  const act = (fn) => (e) => {
    e.preventDefault();
    const v = view();
    if (!v) return;
    if (fn(v) !== false) v.focus();          // (false: the button has opened something of its own)
  };
  const insert = (text, back = 0) => (v) => {
    const s = v.state.selection.main;
    v.dispatch({ changes: { from: s.from, to: s.to, insert: text }, selection: { anchor: s.from + text.length - back } });
  };
  const BUTTONS = [
    ['heading', 'Heading', (v) => setHeading(v, '+')],
    ['bold', 'Strong', (v) => toggleWrap(v, '**')],
    ['italic', 'Emphasis', (v) => toggleWrap(v, '_')],
    ['highlighter', 'Mark', (v) => toggleWrap(v, '==')],
    ['message-square', 'Comment', (v) => toggleWrap(v, '%%')],
    ['link', 'Link', (v) => { const s = v.state.selection.main; const t = v.state.sliceDoc(s.from, s.to); insert(`[${t}]()`, 1)(v); }],
    ['sigma', 'Footnote', insert('^[]', 1)],
    ['list', 'List', (v) => toggleBlock(v, '- ')],
    ['list-ordered', 'Numbered List', (v) => toggleBlock(v, '1. ')],
    ['quote', 'Quote', (v) => toggleBlock(v, '> ')],
    ['palette', 'Sketch', () => { window.mosheCommand('insert', 'sketch'); return false; }],
    ['undo-2', 'Undo', (v) => undo(v)],
    ['redo-2', 'Redo', (v) => redo(v)],
  ];
</script>

{#if shown}
  <div class="bar" style="bottom:{bottom}px" role="toolbar" aria-label="Markup">
    <div class="scroll-x">
      {#each BUTTONS as [icon, label, fn]}
        <!-- the press keeps the editor's focus (and the keyboard); the click, once per tap
             and never at the end of a swipe along the bar, does the work. Acting on
             touchstart as well ran it twice: Svelte's touch listeners are passive, so
             the mousedown a tap brings after it could not be stopped -->
        <button title={label} aria-label={label} onmousedown={(e) => e.preventDefault()} onclick={act(fn)}><Icon name={icon} size={18} /></button>
      {/each}
    </div>
    <button class="done" aria-label="Hide keyboard" onmousedown={(e) => { e.preventDefault(); document.activeElement && document.activeElement.blur(); }}><Icon name="chevron-down" size={18} /></button>
  </div>
{/if}

<style>
  .bar { position: fixed; left: 0; right: 0; height: 44px; display: flex; align-items: center; background: var(--sidebar-bg); border-top: 1px solid var(--sep); z-index: 40; }
  .scroll-x { flex: 1; display: flex; overflow-x: auto; scrollbar-width: none; }
  button { flex: none; width: 44px; height: 44px; border: 0; background: none; color: var(--icon); display: flex; align-items: center; justify-content: center; }
  .done { border-left: 1px solid var(--sep); }
  /* a tablet's wide keyboard: the buttons in the middle of it */
  @media (min-width: 761px) { .scroll-x { justify-content: safe center; } }
</style>
