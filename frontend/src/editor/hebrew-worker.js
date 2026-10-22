// Hebrew spelling, off the page's thread: Hunspell (hunspell-wasm) with
// Hspell's dictionary (dictionary-he, AGPL), both loaded on the first
// question. Asked: check (words → true for each one spelled right),
// suggest (a word → a few better ones), add (the writer's own words).
import initHunspell from 'hunspell-wasm/wasm/hunspell.js';
import wasmUrl from 'hunspell-wasm/wasm/hunspell.wasm?url';
import { Hunspell } from 'hunspell-wasm/dist/Hunspell.js';
import affUrl from '@he-dictionary/index.aff?url';
import dicUrl from '@he-dictionary/index.dic?url';

// a word of one's own takes the prefixes an ordinary noun takes (ו, ה, ב, ל, מ, ש, כ…)
const LIKE = 'מחשב';
const HEBREW = /[א-ת]/u;

let hunspell = null;
let loading = null;
const added = new Set();

async function load() {
  const text = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(`the Hebrew dictionary did not load (${r.status})`); return r.text(); });
  const [m, aff, dic] = await Promise.all([initHunspell({ locateFile: () => wasmUrl }), text(affUrl), text(dicUrl)]);
  hunspell = new Hunspell(m, aff, dic);
}

function add(words) {
  for (const w of words) {
    if (added.has(w) || !HEBREW.test(w)) continue;
    added.add(w);
    try { hunspell.addWordWithAffix(w, LIKE); } catch { hunspell.addWord(w); }
  }
}

self.onmessage = async (e) => {
  const { id, op, words = [], word = '' } = e.data || {};
  try {
    loading ||= load();
    await loading;
    let result = null;
    if (op === 'check') result = words.map((w) => hunspell.testSpelling(w));
    else if (op === 'suggest') result = hunspell.getSpellingSuggestions(word).filter((s) => s !== word).slice(0, 6);
    else if (op === 'add') add(words);
    self.postMessage({ id, result });
  } catch (err) {
    loading = null;
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
