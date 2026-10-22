<script>
  // The one context menu, with submenus and check marks.
  import Icon from './Icon.svelte';
  import { ui, closeMenu } from '../lib/ui.svelte.js';

  let el = $state(null);
  let sub = $state(null);     // {items, x, y}
  let pos = $state({ x: 0, y: 0 });

  $effect(() => {
    const m = ui.menu;
    sub = null;
    if (!m) return;
    pos = { x: m.x, y: m.y };
    requestAnimationFrame(() => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      pos = { x: Math.max(6, Math.min(m.x, innerWidth - r.width - 6)), y: Math.max(6, Math.min(m.y, innerHeight - r.height - 6)) };
    });
  });

  function run(it) {
    if (it.disabled || it.submenu) return;
    closeMenu();
    sub = null;
    it.action && it.action();
  }

  function openSub(e, it) {
    const r = e.currentTarget.getBoundingClientRect();
    sub = { items: it.submenu, x: r.right + 2 > innerWidth - 220 ? r.left - 222 : r.right + 2, y: r.top - 5 };
  }
</script>

{#if ui.menu}
  <div class="scrim" role="presentation" onmousedown={closeMenu} oncontextmenu={(e) => { e.preventDefault(); closeMenu(); }}></div>
  <div class="popover menu" bind:this={el} style="left:{pos.x}px;top:{pos.y}px" role="menu">
    {#each ui.menu.items as it}
      {#if it.sep}
        <div class="sep"></div>
      {:else if it.heading}
        <div class="label">{it.heading}</div>
      {:else}
        <div class="item" class:disabled={it.disabled} role="menuitem" tabindex="-1"
          onmouseenter={(e) => { if (it.submenu) openSub(e, it); else sub = null; }}
          onclick={() => run(it)} onkeydown={() => {}}>
          <span class="check">{#if it.checked}✓{/if}</span>
          {it.label}
          {#if it.submenu}<span class="key"><Icon name="chevron-right" size={12} /></span>{:else if it.key}<span class="key">{it.key}</span>{/if}
        </div>
      {/if}
    {/each}
  </div>
  {#if sub}
    <div class="popover menu" style="left:{sub.x}px;top:{sub.y}px" role="menu">
      {#each sub.items as it}
        {#if it.sep}<div class="sep"></div>{:else}
          <div class="item" class:disabled={it.disabled} role="menuitem" tabindex="-1" onclick={() => run(it)} onkeydown={() => {}}>
            <span class="check">{#if it.checked}✓{/if}</span>{it.label}
          </div>
        {/if}
      {/each}
    </div>
  {/if}
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 49; }
  .check { width: 12px; display: inline-block; font-size: 12px; margin-left: -4px; }
</style>
