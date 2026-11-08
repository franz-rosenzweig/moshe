<script>
  // The voice tutorial's card (lib/tutorial.svelte.js): the lessons to pick from, then one step at
  // a time, what to say, a tick when Moshe sees it done, and a ring round where to look. It sits
  // over the strip, or at the foot of the window where there's none (a phone's list).
  import Icon from './Icon.svelte';
  import { tutorial, lessonOf, lessonList, startLesson, checkStep, nextStep, stopTutorial, trashPractice, practiceLeft, LESSONS } from '../lib/tutorial.svelte.js';
  import { voice } from '../voice/voice.svelte.js';
  import { toggleListening } from '../voice/mic.js';
  import { prefs, store, app } from '../lib/state.svelte.js';
  import { voiceKeys, label as keyLabel, onMac } from '../voice/keys.js';

  const lesson = $derived(lessonOf(tutorial.lesson));
  const step = $derived(lesson ? lesson.steps[tutorial.step] || null : null);
  const shown = $derived(lesson ? lesson.steps.filter((s) => s.do !== 'listen') : []);
  const at = $derived(lesson && step ? shown.indexOf(step) + 1 : 0);
  const next = $derived(lesson ? LESSONS[LESSONS.indexOf(lesson) + 1] || null : null);
  const list = $derived.by(() => { void (tutorial.on + tutorial.lesson + (prefs.lessonsDone || []).length); return lessonList(); });
  const left = $derived.by(() => { void (tutorial.practice.length + tutorial.lesson + tutorial.step + app.version); return store ? practiceLeft().length : 0; });
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;   // no keyboard to press it on
  const key = $derived.by(() => { const k = !touch && voiceKeys(prefs.voice.keys, onMac()).listen; return k ? keyLabel(k, onMac()) : ''; });

  // every change voice makes is a look at the step (and the sheet, below, a few times a second)
  $effect(() => { void (voice.count + voice.mic + voice.asleep + voice.reading + !!voice.choice + tutorial.step + tutorial.ticked + tutorial.on); checkStep(); });

  const TARGET = { mic: '.vstrip .mic', strip: '.vstrip .heard', dashboard: '.col.dash' };
  let ring = $state(null), place = $state({ bottom: 16, right: null });
  $effect(() => {
    if (!tutorial.on) return;
    const look = step && !tutorial.ticked ? step.look : null;
    const where = () => {
      const strip = document.querySelector('.vstrip'), sr = strip && strip.getBoundingClientRect();
      place = sr && sr.width ? { bottom: Math.round(innerHeight - sr.top + 12), right: Math.round(innerWidth - sr.right + 14) } : { bottom: 16, right: null };
      const el = look && document.querySelector(TARGET[look]), r = el && el.getBoundingClientRect();
      const pad = r && r.height > 200 ? -6 : 5;   // round a small thing; inside a tall one
      ring = r && r.width ? { left: r.left - pad, top: r.top - pad, width: r.width + 2 * pad, height: r.height + 2 * pad } : null;
      checkStep();
    };
    where();
    const t = setInterval(where, 250);
    return () => clearInterval(t);
  });
</script>

{#if tutorial.on}
  {#if ring}<div class="ring" aria-hidden="true" style:left={`${ring.left}px`} style:top={`${ring.top}px`} style:width={`${ring.width}px`} style:height={`${ring.height}px`}></div>{/if}
  <div class="tut" role="dialog" aria-label="Voice Tutorial" style:bottom={`${place.bottom}px`} style:right={place.right == null ? null : `${place.right}px`} class:wide={place.right == null}>
    <div class="top">
      {#if lesson}
        <button class="back" title="Lessons" onclick={() => { tutorial.lesson = null; }}><Icon name="chevron-left" size={14} stroke={2.2} /></button>
        <span class="name">{lesson.title}</span>
        {#if step && at}<span class="n">{at} / {shown.length}</span>{/if}
      {:else}
        <span class="name">Voice Tutorial</span>
      {/if}
      <button class="x" title="Close" onclick={stopTutorial}><Icon name="x" size={15} stroke={2} /></button>
    </div>
    {#if !lesson}
      <div class="lessons">
        {#each list as l (l.id)}
          <button class="lesson" onclick={() => startLesson(l.id)}>
            <span class="t">{l.title}</span>
            <span class="c">{l.count}</span>
            {#if l.done}<span class="did"><Icon name="check" size={13} stroke={2.6} /></span>{/if}
          </button>
        {/each}
      </div>
      {#if left}
        <div class="foot"><span class="grow"></span><button class="btn" onclick={trashPractice}>Trash Practice Sheets</button></div>
      {/if}
    {:else if step}
      <div class="big" class:ok={tutorial.ticked} aria-live="polite">
        {#if tutorial.ticked}<span class="tick"><Icon name="check" size={16} stroke={3} /></span>{/if}
        {#if step.say}<span class="say">Say</span> <span class="q">“{step.say}”</span>{:else}<span>{step.text}</span>{/if}
      </div>
      {#if step.tip && !tutorial.ticked}<div class="tip">{step.tip}</div>{/if}
      {#if tutorial.miss && !tutorial.ticked}<div class="miss">Not yet</div>{/if}
      <div class="foot">
        {#if step.do === 'listen' && !tutorial.ticked}
          <button class="btn primary mic" disabled={voice.mic === 'loading'} onclick={toggleListening}>
            <Icon name="mic" size={13} stroke={2} />{voice.mic === 'loading' ? `Loading ${voice.loadPct}%` : 'Start Listening'}{#if key}<kbd>{key}</kbd>{/if}
          </button>
        {/if}
        <span class="grow"></span>
        <button class="skip" onclick={() => nextStep()}>Skip</button>
      </div>
      {#if voice.mic === 'error' && voice.caption}<div class="err">{voice.caption}</div>{/if}
    {:else}
      <div class="big ok"><span class="tick"><Icon name="check" size={16} stroke={3} /></span><span>Done</span></div>
      <div class="foot">
        {#if left}<button class="btn" onclick={trashPractice}>Trash Practice Sheets</button>{/if}
        <span class="grow"></span>
        {#if next}<button class="btn primary" onclick={() => startLesson(next.id)}>{next.title}</button>
        {:else}<button class="btn primary" onclick={() => { tutorial.lesson = null; }}>Lessons</button>{/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .tut { position: fixed; z-index: 46; width: 330px; max-width: calc(100vw - 24px); box-sizing: border-box; padding: 10px 12px 10px 14px; border-radius: 12px;
    background: var(--editor-bg); color: var(--text); border: 1px solid var(--sep-strong); box-shadow: 0 10px 34px rgba(0, 0, 0, 0.2); }
  .tut.wide { left: 12px; right: 12px; width: auto; margin: 0 auto; max-width: 420px; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); }
  .top { display: flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 650; color: var(--muted); }
  .name { text-transform: uppercase; letter-spacing: 0.05em; }
  .n { font-variant-numeric: tabular-nums; margin-left: 2px; }
  .x { margin-left: auto; border: 0; background: none; color: var(--muted); padding: 2px; display: inline-flex; border-radius: 5px; }
  .back { border: 0; background: none; color: var(--muted); padding: 2px; margin-left: -4px; display: inline-flex; border-radius: 5px; }
  .lessons { display: flex; flex-direction: column; margin: 8px -6px 2px; max-height: min(52vh, 420px); overflow-y: auto; }
  .lesson { display: flex; align-items: center; gap: 8px; text-align: left; border: 0; background: none; color: var(--text-strong); font-size: 14.5px; padding: 7px 6px; border-radius: 7px; }
  .lesson:hover { background: var(--hover, color-mix(in srgb, var(--text) 7%, transparent)); }
  .lesson .t { flex: 1; }
  .lesson .c { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
  .did { display: inline-flex; color: var(--accent); }
  .big { display: flex; align-items: baseline; flex-wrap: wrap; gap: 0 6px; margin: 8px 0 6px; font-size: 19px; line-height: 1.3; color: var(--text-strong); }
  .say { color: var(--muted); font-size: 15px; }
  .q { font-weight: 650; }
  .big.ok .q, .big.ok > span:last-child { color: var(--muted); }
  .tick { align-self: center; display: inline-flex; width: 22px; height: 22px; border-radius: 50%; align-items: center; justify-content: center; background: var(--accent); color: var(--on-accent); }
  .tip { font-size: 12.5px; color: var(--muted); margin: -2px 0 6px; }
  .miss { font-size: 12.5px; color: var(--danger); margin: -2px 0 6px; }
  .foot { display: flex; align-items: center; gap: 8px; min-height: 26px; margin-top: 4px; }
  .grow { flex: 1; }
  .mic { display: inline-flex; align-items: center; gap: 6px; height: 28px; font-weight: 600; }
  .mic kbd { font: inherit; font-size: 11.5px; opacity: 0.75; }
  .skip { border: 0; background: none; color: var(--muted); font-size: 12.5px; padding: 4px 2px; }
  .err { margin-top: 6px; font-size: 12px; color: var(--danger); }
  .ring { position: fixed; z-index: 46; pointer-events: none; border: 2px solid var(--accent); border-radius: 12px; animation: ring 1.6s ease-out infinite; }
  @keyframes ring { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 45%, transparent); } 100% { box-shadow: 0 0 0 10px color-mix(in srgb, var(--accent) 0%, transparent); } }
  @media (prefers-reduced-motion: reduce) { .ring { animation: none; } }
</style>
