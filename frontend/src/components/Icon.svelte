<script>
  // A Lucide icon by name (lib/icons.js), drawn in the current colour.
  import { ICONS } from '../lib/icons.js';
  import { CUSTOM_ICONS } from '../lib/custom-icons.js';
  let { name, size = 18, stroke = 1.6, fill = 'none', style = '' } = $props();
</script>

<svg class="icon" width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" stroke-width={stroke}
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" {style}>{@html CUSTOM_ICONS[name] || ICONS[name] || CUSTOM_ICONS.sheets}</svg>

<style>
  .icon { flex: none; display: block; }
</style>
