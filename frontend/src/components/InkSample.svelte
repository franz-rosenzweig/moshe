<script>
  // A little stroke in a pen's own style, for the pen buttons, the panels'
  // preview and the favourites: what a pen writes like, before writing with it.
  import { strokePath, paintOf } from '@engine/ink.js';

  let { pen = 'fountain', color = '#1e1e1e', width = 4, opacity = 100, w = 56, h = 22 } = $props();

  const points = $derived(Array.from({ length: 25 }, (_, i) => {
    const t = i / 24;
    return [6 + t * (w - 12), h / 2 + Math.sin(t * Math.PI * 2) * (h / 2 - Math.min(width, h / 2 - 2) / 2 - 2), 0.3 + 0.55 * Math.sin(t * Math.PI)];
  }));
  const d = $derived(strokePath({ pen, width: Math.min(width, h * 0.8), points }));
  const paint = $derived(paintOf({ pen, color, opacity }));
  // white ink on a light button: an outline, so it's there to see
  const pale = $derived(/^#?(f[a-f0-9]|e[a-f0-9]){3}$/iu.test(color));
</script>

<svg class="sample" width={w} height={h} viewBox="0 0 {w} {h}" aria-hidden="true">
  <path {d} fill={paint.color} fill-opacity={paint.opacity} filter={paint.grain ? 'url(#grain)' : undefined} stroke={pale ? 'rgba(0, 0, 0, 0.45)' : undefined} stroke-width={pale ? 0.8 : undefined} />
</svg>

<style>
  .sample { display: block; flex: none; overflow: visible; }
</style>
