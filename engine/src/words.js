// Words looked up offline: WordNet's senses, short definitions and synonyms,
// in the files tools/wordnet.mjs writes (frontend/public/words/en/): one per
// first letter, {lemma: [[pos, gloss, [synonym, …]], …]}, and the exception
// list for irregular forms, {form: [lemma, …]}. Nothing here fetches: the page
// loads the files a word needs (frontend/src/voice/words.js) and hands them in.

/** The file a lemma is in: its first letter, a–z, or '_' for anything else. */
export function shardOf(lemma) {
  const c = String(lemma ?? '').charAt(0).toLowerCase();
  return c >= 'a' && c <= 'z' ? c : '_';
}

/** A word as WordNet keys it: lowercase, one space between words, without
 *  the punctuation around it or a possessive 's (any script: Hebrew passes). */
function clean(word) {
  const edge = /^[^\p{L}\p{N}\p{M}]+|[^\p{L}\p{N}\p{M}]+$/gu;
  return String(word ?? '').normalize('NFC').toLowerCase()
    .replace(/[‘’ʼ]/gu, "'").replace(/[_\s]+/gu, ' ')
    .replace(edge, '').replace(/'s$/u, '').replace(edge, '');
}

const isVowel = (c) => 'aeiou'.includes(c);
// a stem ending in one consonant twice: hopp(ing), bigg(er), pass(ed)
const doubled = (s) => s.length > 2 && s.at(-1) === s.at(-2) && !isVowel(s.at(-1)) && /\p{L}/u.test(s.at(-1));
// consonant, vowel, consonant: such a word doubles its last letter before a
// suffix (hop → hopping, thin → thinner), so one left single means a dropped e
const cvc = (s) => /[b-df-hj-np-tv-z][aeiou][b-df-hj-np-tv-z]$/u.test(s) && !/[wxy]$/u.test(s);

/** What a stem left by -ed, -ing, -er or -est was, likeliest first:
 *  hopp(ed) → hop, hop(ed) → hope, pass(ed) → pass, cold(er) → cold, fin(er) → fine. */
function stems(s, adjective) {
  if (s.length < 2) return [];
  if (doubled(s)) return [s, s.slice(0, -1), s + 'e'];
  // WordNet's order: verbs try the e first, adjectives last, unless the shape says otherwise
  return adjective && !cvc(s) ? [s, s + 'e'] : [s + 'e', s];
}

// WordNet's detachment rules (its morphy), [suffix, what it was], in its order
const NOUN = [['s', ''], ['ses', 's'], ['xes', 'x'], ['zes', 'z'], ['ches', 'ch'], ['shes', 'sh'], ['men', 'man'], ['ies', 'y']];
const VERB = [['s', ''], ['ies', 'y'], ['es', 'e'], ['es', ''], ['ied', 'y'], ['ed', null], ['ying', 'ie'], ['ing', null]];
const ADJECTIVE = [['ier', 'y'], ['iest', 'y'], ['er', null], ['est', null]];

/**
 * The lemmas to try for a word as written, likeliest first: the word itself,
 * what the exception list says it is a form of (went → go), then WordNet's
 * rules for regular endings (cats → cat, stopped → stop, colder → cold).
 * @param {Record<string, string[]>} [exceptions]  exceptions.json
 * @returns {string[]}  lowercase, no repeats; [] for no word
 */
export function baseForms(word, exceptions = {}) {
  const w = clean(word);
  if (!w) return [];
  const out = new Set([w]);
  if (exceptions && Object.hasOwn(exceptions, w)) for (const b of exceptions[w]) out.add(b);
  for (const [rules, adjective] of [[NOUN, false], [VERB, false], [ADJECTIVE, true]]) {
    for (const [suffix, was] of rules) {
      if (w.length <= suffix.length || !w.endsWith(suffix)) continue;
      const s = w.slice(0, -suffix.length);
      // null: -ed, -ing, -er, -est, where the stem's shape tells hopped from hoped
      for (const b of was === null ? stems(s, adjective) : [s + was]) out.add(b);
    }
  }
  return [...out];
}

/**
 * A word looked up in the shards at hand: the first of its base forms that
 * WordNet has, with its senses (most common first).
 * @param {Record<string, object>} shards  {name: the shard's object}, as loaded
 * @returns {null | {word: string, lemma: string, senses: {pos: 'n'|'v'|'a'|'r', gloss: string, synonyms: string[]}[]}}
 */
export function lookupIn(shards, word, exceptions = {}) {
  for (const lemma of baseForms(word, exceptions)) {
    const shard = shards?.[shardOf(lemma)];
    if (!shard || !Object.hasOwn(shard, lemma) || !Array.isArray(shard[lemma])) continue;
    return {
      word: String(word).trim(),
      lemma,
      senses: shard[lemma].map(([pos, gloss, synonyms]) => ({ pos, gloss, synonyms: synonyms || [] })),
    };
  }
  return null;
}

const TURN = [5, 3];   // synonyms a sense gives at a time: the commonest sense most, then 2 each

/** The synonyms to offer for an entry, numbered by place: a few from each
 *  sense in turn, so the first sense does not crowd out the rest. */
export function synonymList(entry, max = 12) {
  const senses = (entry?.senses || []).map((s) => s.synonyms || []);
  const at = senses.map(() => 0);     // how far into each sense's list
  const out = [];
  const seen = new Set([String(entry?.lemma ?? '').toLowerCase()]);
  for (let more = true; more && out.length < max;) {
    more = false;
    senses.forEach((list, i) => {
      // up to its turn's new ones: one another sense gave already takes no turn
      for (let took = 0; took < (TURN[i] ?? 2) && at[i] < list.length && out.length < max;) {
        const w = list[at[i]++];
        if (seen.has(w.toLowerCase())) continue;
        seen.add(w.toLowerCase());
        out.push(w);
        took++;
      }
      if (at[i] < list.length) more = true;
    });
  }
  return out;
}
