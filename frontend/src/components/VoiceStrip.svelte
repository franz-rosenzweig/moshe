<script>
  // The strip under the text while voice is on (docs/VOICE.md): whether it's
  // listening, what it heard, whether that was text or a command, and what it
  // did. The microphone's button starts and stops it, and wakes it from sleep.
  import Icon from './Icon.svelte';
  import { voice, hear, refreshNames } from '../voice/voice.svelte.js';
  import { toggleListening, isListening } from '../voice/mic.js';
  import { app } from '../lib/state.svelte.js';

  // the project's names, kept up to date for the recognizer (not on every keystroke)
  let timer = null;
  $effect(() => { app.version; app.sheet; app.project; clearTimeout(timer); timer = setTimeout(refreshNames, 900); return () => clearTimeout(timer); });

  const off = $derived(voice.mic === 'off' || voice.mic === 'error');
  const label = $derived(voice.mic === 'loading' ? `Loading ${voice.loadPct}%` : off ? 'Mic Off' : voice.asleep ? 'Asleep' : 'Listening');
  const live = $derived(!off && (voice.mic === 'hearing' || voice.mic === 'working' || !!voice.partial));
  const CHIPS = { text: 'Text', command: 'Command', fail: 'Command', ignored: 'Ignored' };
  const second = $derived(voice.caption || (live ? 'Waiting for the pause: then text or command' : voice.last ? [voice.last.why, voice.last.how].filter(Boolean).join(' · ') : ''));

  function press() {
    if (isListening() && voice.asleep) hear('wake up', { source: 'typed' });
    else toggleListening();
  }
</script>

<div class="vstrip" role="status" aria-live="polite">
  <button class="mic" class:off class:asleep={!off && voice.asleep} title={off ? 'Start Listening (⌥⌘L)' : voice.asleep ? 'Wake Up' : 'Stop Listening (⌥⌘L)'} onclick={press}>
    <span class="dot" aria-hidden="true"></span><Icon name={off ? 'mic-off' : 'mic'} size={14} /><span>{label}</span>
    {#if !off}<span class="meter" aria-hidden="true"><i style:transform={`scaleX(${voice.level.toFixed(3)})`}></i></span>{/if}
  </button>
  <button class="lang" title="Dictation Language" onclick={() => hear(voice.lang === 'en' ? 'switch to hebrew' : 'switch to english', { source: 'typed' })}>{voice.lang.toUpperCase()}</button>
  <div class="heard">
    <div class="l1">
      {#if live}
        <span class="q live">“{voice.partial || '…'}”</span><span class="chip listening">{voice.mic === 'working' ? 'Working Out the Words' : 'Hearing'}</span>
      {:else if voice.last}
        <span class="q">“{voice.last.said}”</span><span class="chip {voice.last.kind}">{CHIPS[voice.last.kind]}</span><span class="msg" class:fail={voice.last.kind === 'fail'}>{voice.last.msg}</span>
      {:else}
        <span class="dim">Say “what can I say”</span>
      {/if}
    </div>
    {#if second}<div class="why" class:err={voice.mic === 'error'}>{second}</div>{/if}
  </div>
</div>

<style>
  .vstrip { flex: none; display: flex; align-items: center; gap: 8px 10px; flex-wrap: wrap; padding: 8px 12px calc(8px + env(safe-area-inset-bottom, 0px)); border-top: 1px solid var(--sep); background: var(--sidebar-bg); min-height: 52px; }
  .mic { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--sep); background: var(--editor-bg); color: var(--text); border-radius: 999px; padding: 4px 11px 4px 9px; font-size: 12.5px; font-weight: 600; }
  .mic .dot { width: 9px; height: 9px; border-radius: 50%; background: #e5484d; box-shadow: 0 0 0 0 rgba(229, 72, 77, 0.45); animation: pulse 1.8s ease-out infinite; }
  .mic.off, .mic.asleep { color: var(--muted); }
  .mic.off .dot, .mic.asleep .dot { background: var(--icon-dim); animation: none; }
  @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(229, 72, 77, 0.45); } 100% { box-shadow: 0 0 0 8px rgba(229, 72, 77, 0); } }
  .meter { width: 30px; height: 5px; border-radius: 3px; background: var(--sep); overflow: hidden; display: inline-block; }
  .meter i { display: block; height: 100%; background: #e5484d; transform-origin: left; transition: transform 60ms linear; }
  .lang { border: 1px solid var(--sep); background: none; color: var(--muted); border-radius: 6px; padding: 1px 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; }
  .heard { flex: 1 1 260px; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .l1 { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; min-width: 0; }
  .q { font-size: 14px; color: var(--text-strong); overflow-wrap: anywhere; }
  .q.live { color: var(--muted); font-style: italic; }
  .chip { font-size: 11px; font-weight: 650; border-radius: 6px; padding: 1px 7px; white-space: nowrap; }
  .chip.text { background: color-mix(in srgb, var(--text) 9%, transparent); color: var(--text); }
  .chip.command { background: var(--accent-tint); color: var(--accent-soft); }
  .chip.fail { background: color-mix(in srgb, var(--danger) 14%, transparent); color: var(--danger); }
  .chip.ignored { border: 1px dashed var(--icon-dim); color: var(--muted); }
  .chip.listening { color: var(--muted); }
  .msg { font-size: 12.5px; color: var(--muted); }
  .msg.fail { color: var(--danger); }
  .why { font-size: 11.5px; color: var(--muted); }
  .why.err { color: var(--danger); }
  @media (prefers-reduced-motion: reduce) { .mic .dot { animation: none; } }
</style>
