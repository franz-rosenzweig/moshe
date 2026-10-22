// Check Text (the dashboard's revision view): the whole sheet read by
// LanguageTool on the server (/api/proof), which catches more than the
// checker that runs as you type (editor/proof.js). Its findings are listed
// in the dashboard and underlined in the text, in the same colours.
import { proseOf, placeFinding } from '@engine/proof.js';

export const check = $state({
  available: null,     // does the server have LanguageTool? (null: not asked yet)
  path: null,          // the sheet the findings are for
  status: 'idle',      // idle | checking | starting (slow: the checker is waking) | done | error
  error: null,
  results: null,       // [{id, from, to, kind, cls, message, short, problem, suggestions, src: 'lt'}]
  forText: null,       // the text they were found in
  language: null,
  run: 0,              // goes up when a check is done: the editor shows its findings once
});

// LanguageTool's categories, as the underlines' kinds (editor/proof.js's KINDS)
const CATS = {
  TYPOS: 'sp', GRAMMAR: 'gr', CONFUSED_WORDS: 'gr', COLLOCATIONS: 'gr', SEMANTICS: 'gr', MISC: 'gr', NONSTANDARD_PHRASES: 'gr', FALSE_FRIENDS: 'gr',
  PUNCTUATION: 'pu', CASING: 'pu', TYPOGRAPHY: 'pu', COMPOUNDING: 'pu',
  STYLE: 'st', REDUNDANCY: 'st', PLAIN_ENGLISH: 'st', WIKIPEDIA: 'st', REPETITIONS_STYLE: 'st', GENDER_NEUTRALITY: 'st',
};
const ISSUES = { misspelling: 'sp', typographical: 'pu', whitespace: 'pu', grammar: 'gr', duplication: 'gr', style: 'st', inconsistency: 'st', 'locale-violation': 'st', register: 'st' };
const classOf = (m) => CATS[m.category] || ISSUES[m.issue] || 'gr';

export async function probeCheck() {
  if (check.available !== null) return;
  try { const r = await fetch('/api/proof'); check.available = r.ok && !!(await r.json()).available; } catch { check.available = false; }
}

let seq = 0;
/** The sheet's text read by LanguageTool; its findings in `check`. */
export async function checkText(path, body) {
  const run = ++seq;
  Object.assign(check, { path, status: 'checking', error: null, results: null, forText: body, language: null });
  const slow = setTimeout(() => { if (run === seq && check.status === 'checking') check.status = 'starting'; }, 1500);
  try {
    const prose = proseOf(body, null, { english: true });
    const found = [];
    let n = 0;
    // a request holds up to 20,000 characters of paragraphs
    for (let i = 0; i < prose.length;) {
      const batch = [];
      let len = 0;
      while (i < prose.length && (!batch.length || len + prose[i].text.length < 20000)) { batch.push(prose[i]); len += prose[i].text.length + 2; i++; }
      const starts = [];
      let at = 0;
      for (const p of batch) { starts.push(at); at += p.text.length + 2; }
      const r = await fetch('/api/proof', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: batch.map((p) => p.text).join('\n\n') }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `the server said ${r.status}`);
      if (j.language && !check.language) check.language = j.language;
      for (const m of j.matches || []) {
        let k = starts.length - 1;
        while (k > 0 && starts[k] > m.offset) k--;
        const a = m.offset - starts[k], b = a + m.length;
        if (b > batch[k].text.length) continue;
        if (m.category === 'CASING' && a === 0 && ['list', 'footnote', 'note'].includes(batch[k].kind)) continue;   // a list item may start small
        const place = placeFinding(batch[k], a, b);
        if (!place || place.to <= place.from) continue;
        found.push({
          id: `lt${run}-${n++}`, from: place.from, to: place.to, kind: m.category || m.issue, cls: classOf(m), message: m.message, short: m.short,
          problem: batch[k].text.slice(a, b), suggestions: (m.replacements || []).map((t) => ({ kind: 0, text: t })), src: 'lt', rule: m.rule,
        });
      }
    }
    if (run !== seq) return;
    check.results = found.sort((x, y) => x.from - y.from);
    check.status = 'done';
    check.run = run;
  } catch (e) {
    if (run === seq) { check.status = 'error'; check.error = e.message; }
  } finally { clearTimeout(slow); }
}

/** A finding dealt with (fixed or ignored): off the list. */
export function dropFinding(id) {
  if (check.results) check.results = check.results.filter((f) => f.id !== id);
}

export function clearCheck() { seq++; Object.assign(check, { path: null, status: 'idle', error: null, results: null, forText: null, language: null }); }
