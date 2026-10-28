<script>
  // The dashboard's two views for voice (docs/VOICE.md). Voice: a numbered list
  // when one is waiting for a number, what can be said just now, what was heard,
  // and the names it listens for. Words: synonyms, definitions and other guesses,
  // numbered so a choice takes one word.
  import { voice, hear } from '../voice/voice.svelte.js';
  import { COMMANDS } from '@engine/voice.js';
  import { app } from '../lib/state.svelte.js';

  let { view } = $props();
  const say = (text) => hear(text, { source: 'typed' });
  const CHIPS = { text: 'Text', command: 'Command', fail: 'Command', ignored: 'Ignored' };
  const POS = { n: 'noun', v: 'verb', a: 'adjective', r: 'adverb' };

  // what can be said just now
  const now = $derived.by(() => {
    voice.last;
    if (voice.asleep) return ['wake up'];
    if (voice.choice) return ['one', 'two', 'cancel'];
    if (voice.reading) return ['stop'];
    if (app.revision) return ['strike ‹words›', 'insert ‹words› after ‹words›', 'replace ‹words› with ‹words›', 'comment ‹words›', 'accept all', 'stop revising'];
    return ['select ‹words›', 'select this sentence', 'show numbers', 'synonyms', 'read this paragraph', 'new paragraph', 'scratch that', 'go to sleep'];
  });
  const groups = [...new Set(COMMANDS.filter((c) => !c.hidden).map((c) => c.group))];
  const open = (p) => !p.includes('‹');
</script>

{#snippet numbered(items, live)}
  <ol class="nl">
    {#each items as it, i}
      <li><button disabled={!live} onclick={() => say(String(i + 1))}><span class="n" class:off={!live}>{i + 1}</span><span class="t">{it.label}{#if it.sub}<small>{it.sub}</small>{/if}</span></button></li>
    {/each}
  </ol>
{/snippet}

{#snippet phrase(p)}
  {#if open(p)}<button class="said" onclick={() => say(p)}>{p}</button>{:else}<span class="said idle">{p}</span>{/if}
{/snippet}

{#if view === 'words'}
  {@const w = voice.words}
  {#if !w}
    <section><h4>Words</h4><p class="dim small">Say “synonyms” for the word at the cursor, “synonyms for ‹word›”, “define ‹word›” or “correct ‹word›”.</p></section>
  {:else if w.kind === 'syn'}
    <section>
      <h4>Synonyms</h4>
      <div class="word">{w.word}</div>
      {#if w.list.length}
        {@render numbered(w.list.map((label) => ({ label })), voice.choice && voice.choice.kind === 'syn')}
        <p class="dim small">{voice.choice && voice.choice.kind === 'syn' ? 'Say “use” and a number, or the number.' : w.used ? `Used “${w.used}”.` : ''}</p>
      {:else}<p class="dim small">None found.</p>{/if}
    </section>
    {#if w.entry}
      <section>
        <h4>Senses</h4>
        {#each w.entry.senses.slice(0, 6) as s}<p class="sense"><em>{POS[s.pos] || s.pos}</em> {s.gloss}</p>{/each}
      </section>
    {/if}
  {:else if w.kind === 'def'}
    <section>
      <h4>Definition</h4>
      <div class="word">{w.entry ? w.entry.lemma : w.word}</div>
      {#if w.entry}
        {#each w.entry.senses.slice(0, 8) as s}<p class="sense"><em>{POS[s.pos] || s.pos}</em> {s.gloss}{#if s.synonyms.length}<small>{s.synonyms.slice(0, 5).join(', ')}</small>{/if}</p>{/each}
      {:else}<p class="dim small">Not in the dictionary.</p>{/if}
    </section>
  {:else if w.kind === 'fix'}
    <section>
      <h4>Other Guesses</h4>
      <div class="word">{w.word}</div>
      {#if w.list.length}{@render numbered(w.list.map((label) => ({ label })), voice.choice && voice.choice.kind === 'fix')}{/if}
      <p class="dim small">{w.used ? `Used “${w.used}”.` : 'Or say “spell” and the letters.'}</p>
    </section>
  {/if}
{:else}
  {#if voice.choice && voice.choice.kind !== 'syn' && voice.choice.kind !== 'fix'}
    <section>
      <h4>Say a Number <small>{voice.choice.label}</small></h4>
      {@render numbered(voice.choice.items, true)}
    </section>
  {/if}
  <section>
    <h4>You Can Say</h4>
    <div class="chips">{#each now as p}{@render phrase(p)}{/each}</div>
  </section>
  <section>
    <h4>Heard</h4>
    {#each voice.heard.slice(0, 12) as h}
      <div class="h"><span class="q">“{h.said}”</span><span class="a"><span class="chip {h.kind}">{CHIPS[h.kind]}</span>{h.msg}</span>{#if h.how}<small>{h.how}</small>{/if}</div>
    {:else}<p class="dim small">Nothing yet.</p>{/each}
  </section>
  <section>
    <h4>Names <small>{voice.names.length}</small></h4>
    {#if voice.names.length}<p class="small names">{voice.names.slice(0, 24).join(', ')}</p>{:else}<p class="dim small">Words written with a capital in the middle of sentences, in this project.</p>{/if}
  </section>
  <section>
    <h4>All Commands</h4>
    {#each groups as g}
      <details><summary>{g}</summary>
        {#each COMMANDS.filter((c) => c.group === g && !c.hidden) as c}<div class="cmd">{@render phrase(c.say)}<span class="dim">{c.does}</span></div>{/each}
      </details>
    {/each}
  </section>
{/if}

<style>
  section { padding: 12px 18px; border-bottom: 1px solid var(--sep); }
  h4 { margin: 0 0 6px; font-size: 11px; font-weight: 600; color: var(--section); display: flex; gap: 6px; align-items: baseline; }
  h4 small { font-weight: 400; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .small { font-size: 12px; margin: 4px 0 0; }
  .word { font-size: 19px; font-weight: 600; color: var(--text-strong); margin: 2px 0 8px; }
  .nl { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .nl button { width: 100%; display: flex; gap: 9px; align-items: baseline; text-align: left; border: 0; background: none; border-radius: 6px; padding: 4px 6px; color: var(--text); font-size: 13.5px; }
  .nl button:not(:disabled):hover { background: var(--hint-bg); }
  .nl .n { flex: none; min-width: 1.5em; text-align: center; border-radius: 5px; background: var(--accent); color: var(--on-accent); font-size: 11px; font-weight: 650; line-height: 1.6; font-variant-numeric: tabular-nums; }
  .nl .n.off { background: var(--sep); color: var(--muted); }
  .nl .t { min-width: 0; overflow-wrap: anywhere; }
  .nl small, .sense small, .h small { display: block; color: var(--muted); font-size: 11px; }
  .sense { margin: 0 0 7px; font-size: 12.5px; line-height: 1.45; color: var(--text); }
  .sense em { font-style: normal; color: var(--muted); font-size: 11px; margin-right: 3px; }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .said { border: 1px solid var(--sep); background: var(--editor-bg); color: var(--text); border-radius: 999px; padding: 2px 9px; font-size: 12px; }
  button.said:hover { border-color: var(--accent); }
  .said.idle { color: var(--muted); }
  .h { display: flex; flex-direction: column; gap: 1px; padding: 5px 0; border-bottom: 1px solid var(--sep); font-size: 12.5px; }
  .h:last-child { border-bottom: 0; }
  .h .q { color: var(--text-strong); overflow-wrap: anywhere; }
  .h .a { display: flex; gap: 6px; align-items: center; color: var(--muted); font-size: 11.5px; }
  .chip { font-size: 10.5px; font-weight: 650; border-radius: 5px; padding: 0 6px; }
  .chip.text { background: color-mix(in srgb, var(--text) 9%, transparent); color: var(--text); }
  .chip.command { background: var(--accent-tint); color: var(--accent-soft); }
  .chip.fail { background: color-mix(in srgb, var(--danger) 14%, transparent); color: var(--danger); }
  .chip.ignored { border: 1px dashed var(--icon-dim); color: var(--muted); }
  .names { color: var(--text); }
  details { font-size: 12.5px; padding: 2px 0; }
  summary { cursor: pointer; color: var(--text); padding: 2px 0; }
  .cmd { display: flex; flex-direction: column; gap: 2px; padding: 4px 0 4px 12px; }
  .cmd .dim { font-size: 11.5px; }
</style>
