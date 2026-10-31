// The voice's thesaurus and dictionary: WordNet, offline, in the files the
// build writes into public/words/en/ (tools/wordnet.mjs). The exception list
// comes once; a letter's file the first time a word needs it.
import { baseForms, lookupIn, shardOf } from '@engine/words.js';

const BASE = `${import.meta.env.BASE_URL || '/'}words/en/`;
const files = new Map();   // name → the promise of its object; null: it could not be had

function load(name) {
  if (!files.has(name)) {
    const p = fetch(`${BASE}${name}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((o) => { if (!o) files.delete(name); return o; });   // a failure is tried again next time
    files.set(name, p);
  }
  return files.get(name);
}

/**
 * A word's senses, definitions and synonyms (engine/words.js lookupIn), or
 * null: not a word WordNet has, or its files could not be loaded.
 * @returns {Promise<null | {word: string, lemma: string, senses: {pos: string, gloss: string, synonyms: string[]}[]}>}
 */
export async function lookup(word) {
  try {
    const exceptions = await load('exceptions');
    if (!exceptions) return null;
    const names = [...new Set(baseForms(word, exceptions).map(shardOf))];
    const shards = {};
    for (const [i, s] of (await Promise.all(names.map(load))).entries()) {
      if (!s) return null;
      shards[names[i]] = s;
    }
    return lookupIn(shards, word, exceptions);
  } catch {
    return null;
  }
}
