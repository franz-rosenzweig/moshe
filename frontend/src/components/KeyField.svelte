<script>
  // One of the voice keys in Settings › Voice (voice/keys.js): click, then press
  // the new key. Esc keeps the old one; Delete leaves none.
  import { prefs, persist } from '../lib/state.svelte.js';
  import { voice } from '../voice/voice.svelte.js';
  import { voiceKeys, fromEvent, problem, label, DEFAULTS } from '../voice/keys.js';

  let { which, mac } = $props();
  const other = which === 'voice' ? 'listen' : 'voice';
  const keys = $derived(voiceKeys(prefs.voice.keys, mac));
  const waiting = $derived(voice.recordingKey === which);
  const changed = $derived(!!prefs.voice.keys && prefs.voice.keys[which] !== undefined && keys[which] !== DEFAULTS[mac ? 'mac' : 'other'][which]);
  let why = $state('');
  let el = $state(null);

  function set(spec) {
    const next = { ...(prefs.voice.keys || {}) };
    if (spec === undefined) delete next[which]; else next[which] = spec;
    prefs.voice.keys = next;
    persist();
  }
  function stop() { if (voice.recordingKey === which) voice.recordingKey = null; }

  $effect(() => {
    if (!waiting) return;
    why = '';
    const press = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const alone = !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;
      if (alone && e.key === 'Escape') { stop(); return; }
      if (alone && (e.key === 'Backspace' || e.key === 'Delete')) { set(''); stop(); return; }
      const spec = fromEvent(e);
      if (!spec) return;                                   // a modifier, still being held
      const no = problem(spec, mac) || (spec === keys[other] ? `${label(spec, mac)} is the other voice key` : '');
      if (no) { why = no; return; }
      set(spec);
      stop();
    };
    const away = (e) => { if (el && !el.contains(e.target)) stop(); };
    window.addEventListener('keydown', press, true);
    window.addEventListener('pointerdown', away, true);
    return () => { window.removeEventListener('keydown', press, true); window.removeEventListener('pointerdown', away, true); };
  });
</script>

<span class="keyfield" bind:this={el}>
  <button class="btn key" class:waiting onclick={() => (voice.recordingKey = waiting ? null : which)}>
    {waiting ? 'Press a Key' : keys[which] ? label(keys[which], mac) : 'None'}
  </button>
  {#if waiting}<em>{why || 'Esc to Cancel · Delete for None'}</em>
  {:else if changed}<button class="btn" onclick={() => set(undefined)}>Default</button>{/if}
</span>

<style>
  .keyfield { display: inline-flex; gap: 8px; align-items: center; }
  .key { min-width: 96px; font-variant-numeric: tabular-nums; }
  .key.waiting { color: var(--accent-fg); }
  em { color: var(--muted); font-style: normal; }
</style>
