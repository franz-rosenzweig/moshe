// Writes frontend/public/words/en/: WordNet's words for the voice's thesaurus
// and dictionary (engine/src/words.js), offline. One file per first letter,
// a.json … z.json and _.json for the rest, {lemma: [[pos, gloss, [synonym, …]], …]};
// exceptions.json, {irregular form: [lemma, …]}; and WordNet's licence.
// From frontend/: npm run words (--if-missing: only when a.json is not there yet;
// --exc DIR: read noun.exc, verb.exc, adj.exc, adv.exc from DIR).
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve, relative } from 'node:path';
import { shardOf, baseForms } from '../engine/src/words.js';

const DICT = fileURLToPath(new URL('../frontend/node_modules/wordnet-db/dict/', import.meta.url));
const OUT = fileURLToPath(new URL('../frontend/public/words/en/', import.meta.url));
const GLOSS = 140;      // characters a definition keeps, cut at a word
const SYNONYMS = 12;    // a sense's synonyms at most
const FILES = { n: 'noun', v: 'verb', a: 'adj', r: 'adv' };

const args = process.argv.slice(2);
if (args.includes('--if-missing') && existsSync(join(OUT, 'a.json'))) process.exit(0);
const excDir = args.includes('--exc') ? resolve(args[args.indexOf('--exc') + 1] || '.') : DICT;
if (!existsSync(join(DICT, 'data.noun'))) {
  console.error(`no WordNet in ${DICT}: cd frontend && npm install`);
  process.exit(1);
}

const lines = (name) => readFileSync(join(DICT, name), 'latin1').split('\n').filter((l) => l && !l.startsWith('  '));
const words = (s) => s.replace(/_/gu, ' ');

/** A definition without its quoted examples, at most GLOSS characters. */
function shortGloss(g) {
  let s = g.trim();
  const ex = s.search(/(?:^|[;:]\s*)"/u);
  if (ex > 0) s = s.slice(0, ex);
  s = s.replace(/[\s;:,]+$/u, '');
  if (s.length <= GLOSS) return s;
  s = s.slice(0, GLOSS + 1);
  return s.slice(0, s.lastIndexOf(' ')).replace(/[\s;:,(]+$/u, '') + '…';
}

// ---- the synsets: data.noun, data.verb, data.adj, data.adv ----------------------------

/** A data file's synsets by offset: their words, "similar to" links, gloss. */
function readData(file) {
  const out = new Map();
  for (const line of lines(`data.${file}`)) {
    const bar = line.indexOf(' | ');
    const f = line.slice(0, bar).split(' ');
    const n = parseInt(f[3], 16);
    const members = [];
    // an adjective may carry where it goes: galore(ip), elect(p)
    for (let i = 0; i < n; i++) members.push(words(f[4 + 2 * i]).replace(/\([a-z]+\)$/u, ''));
    let k = 4 + 2 * n;
    const pointers = Number(f[k++]);
    const similar = [];
    for (let i = 0; i < pointers; i++, k += 4) if (f[k] === '&') similar.push(f[k + 1]);
    out.set(f[0], { members, similar, gloss: shortGloss(line.slice(bar + 3)) });
  }
  return out;
}

// how often each sense was seen in tagged text (index.sense), to rank what
// "similar to" brings: icy and chilly before algid and gelid
const seen = new Map();     // "a01251128 chilly" → count
const usage = new Map();    // "a cold" → its count over all its adjective senses
for (const line of lines('index.sense')) {
  const [key, offset, , count] = line.split(' ');
  const at = key.indexOf('%');
  const lemma = words(key.slice(0, at));
  const pos = 'xnvara'[key[at + 1]];
  seen.set(`${pos}${offset} ${lemma}`, Number(count));
  usage.set(`${pos} ${lemma}`, (usage.get(`${pos} ${lemma}`) || 0) + Number(count));
}
const often = (pos, lemma) => [...'nvar'].reduce((n, p) => n + (usage.get(`${p} ${lemma}`) || 0), 0);

const data = {};
for (const [pos, file] of Object.entries(FILES)) data[pos] = readData(file);

/** A synset's synonyms before its own word is taken out: its members, and an
 *  adjective's "similar to" synsets' members, the most used first. */
const pool = new Map();
function synonymsOf(pos, offset) {
  const key = pos + offset;
  if (pool.has(key)) return pool.get(key);
  const syn = data[pos].get(offset);
  const more = [];
  for (const o of syn.similar) {
    for (const w of data[pos].get(o).members) {
      const lw = w.toLowerCase();
      more.push({ w, here: seen.get(`${pos}${o} ${lw}`) || 0, all: often(pos, lw), at: more.length });
    }
  }
  // by how much the word is used at all (SemCor's counts are too few to go by the sense alone)
  more.sort((x, y) => y.all - x.all || y.here - x.here || x.at - y.at);
  const list = [...syn.members, ...more.map((m) => m.w)];
  pool.set(key, list);
  return list;
}

// ---- the lemmas: index.noun, index.verb, index.adj, index.adv --------------------------

const entries = new Map();  // lemma → {pos → [sense, …]}
for (const [pos, file] of Object.entries(FILES)) {
  for (const line of lines(`index.${file}`)) {
    const f = line.split(' ');
    const lemma = words(f[0]);
    const count = Number(f[2]), pointers = Number(f[3]);
    const offsets = f.slice(6 + pointers, 6 + pointers + count);   // in sense order, the most common first
    const senses = offsets.map((o) => {
      const keep = [];
      const had = new Set([lemma]);
      for (const w of synonymsOf(pos, o)) {
        const lw = w.toLowerCase();
        // the word itself, or a form of it or of one already kept (big: bigger; large: larger)
        if (had.has(lw) || baseForms(lw).some((b) => b !== lw && had.has(b))) continue;
        had.add(lw);
        keep.push(w);
        if (keep.length >= SYNONYMS) break;
      }
      return [pos, data[pos].get(o).gloss, keep];
    });
    if (!entries.has(lemma)) entries.set(lemma, {});
    entries.get(lemma)[pos] = senses;
  }
}

// a word's parts of speech, the one it is most used as first (cold: the
// adjective before the illness); WordNet's senses keep their order within each
const shards = {};
for (const lemma of [...entries.keys()].sort()) {
  const byPos = entries.get(lemma);
  const order = Object.keys(byPos).sort((p, q) => (usage.get(`${q} ${lemma}`) || 0) - (usage.get(`${p} ${lemma}`) || 0)
    || 'nvar'.indexOf(p) - 'nvar'.indexOf(q));
  (shards[shardOf(lemma)] ||= {})[lemma] = order.flatMap((p) => byPos[p]);
}

// ---- irregular forms: noun.exc, verb.exc, adj.exc, adv.exc ------------------------------

// went → go, geese → goose: WordNet's lists where they are to be had (the
// wordnet-db package leaves them out), else these, the common ones
const COMMON = `arise arose arisen|awake awoke awoken|be was were been am is are|bear bore borne born|beat beaten|become became
begin began begun|bend bent|bind bound|bite bit bitten|bleed bled|blow blew blown|break broke broken|breed bred|bring brought
build built|burn burnt|buy bought|catch caught|choose chose chosen|cling clung|come came|creep crept|deal dealt|dig dug|dive dove
do did done does|draw drew drawn|dream dreamt|drink drank drunk|drive drove driven|eat ate eaten|fall fell fallen|feed fed|feel felt
fight fought|find found|flee fled|fling flung|fly flew flown|forbid forbade forbidden|forget forgot forgotten|forgive forgave forgiven
freeze froze frozen|get got gotten|give gave given|go went gone|grind ground|grow grew grown|hang hung|have has had|hear heard
hide hid hidden|hold held|keep kept|kneel knelt|know knew known|lay laid|lead led|leap leapt|learn learnt|leave left|lend lent
lie lay lain|light lit|lose lost|make made|mean meant|meet met|mistake mistook mistaken|overcome overcame|pay paid|ride rode ridden
ring rang rung|rise rose risen|run ran|say said|see saw seen|seek sought|sell sold|send sent|shake shook shaken|shine shone
shoot shot|show shown|shrink shrank shrunk|sing sang sung|sink sank sunk|sit sat|slay slew slain|sleep slept|slide slid|sling slung
smell smelt|speak spoke spoken|speed sped|spell spelt|spend spent|spill spilt|spin spun|spit spat|spring sprang sprung|stand stood
steal stole stolen|stick stuck|sting stung|stink stank stunk|stride strode stridden|strike struck stricken|strive strove striven
swear swore sworn|sweep swept|swim swam swum|swing swung|take took taken|teach taught|tear tore torn|tell told|think thought
throw threw thrown|tread trod trodden|undertake undertook undertaken|understand understood|wake woke woken|wear wore worn
weave wove woven|weep wept|win won|wind wound|withdraw withdrew withdrawn|wring wrung|write wrote written
child children|foot feet|tooth teeth|goose geese|mouse mice|louse lice|ox oxen|person people|die dice|wolf wolves|knife knives
wife wives|life lives|leaf leaves|half halves|calf calves|self selves|shelf shelves|thief thieves|loaf loaves|elf elves
scarf scarves|hoof hooves|sheaf sheaves|wharf wharves|datum data|criterion criteria|phenomenon phenomena|cactus cacti|fungus fungi
nucleus nuclei|radius radii|stimulus stimuli|alumnus alumni|syllabus syllabi|analysis analyses|crisis crises|thesis theses
hypothesis hypotheses|oasis oases|diagnosis diagnoses|appendix appendices|index indices|matrix matrices|vertex vertices|larva larvae
formula formulae|antenna antennae|vertebra vertebrae|bacterium bacteria|curriculum curricula|medium media|memorandum memoranda
stratum strata|cherub cherubim|seraph seraphim|kibbutz kibbutzim
good better best|well better best|bad worse worst|ill worse worst|far farther farthest further furthest|little less least lesser
many more most|much more most|old elder eldest`;

const exceptions = {};
const add = (form, base) => { if (form !== base && !(exceptions[form] ||= []).includes(base)) exceptions[form].push(base); };
const lists = Object.values(FILES).map((f) => join(excDir, `${f}.exc`)).filter((p) => existsSync(p));
if (lists.length) {
  for (const p of lists) {
    for (const line of readFileSync(p, 'latin1').split('\n')) {
      const [form, ...bases] = line.trim().split(/\s+/u).map((w) => words(w).toLowerCase());
      if (form) for (const b of bases) add(form, b);
    }
  }
} else {
  console.warn(`no WordNet exception lists (*.exc) in ${excDir}: writing the common irregular forms only`);
  for (const line of COMMON.split(/[|\n]/u)) {
    const [base, ...forms] = line.trim().split(' ');
    for (const f of forms) add(f, base);
  }
}

// ---- write -----------------------------------------------------------------------------

mkdirSync(OUT, { recursive: true });
for (const [name, shard] of Object.entries(shards)) writeFileSync(join(OUT, `${name}.json`), JSON.stringify(shard));
writeFileSync(join(OUT, 'exceptions.json'), JSON.stringify(exceptions));
// the licence, as WordNet 3.1's own files carry it at their head
const licence = readFileSync(join(DICT, 'data.noun'), 'latin1').split('\n').filter((l) => l.startsWith('  '))
  .map((l) => l.replace(/^\s+\d+ ?/u, '').trimEnd()).join('\n').trim();
writeFileSync(join(OUT, 'LICENSE'), `WordNet Release 3.1\n\n${licence}\n\n`
  + 'The files here were generated from WordNet 3.1 (the wordnet-db package) by tools/wordnet.mjs.\n');

const names = Object.keys(shards).sort();
const bytes = [...names.map((n) => `${n}.json`), 'exceptions.json', 'LICENSE'].reduce((n, f) => n + statSync(join(OUT, f)).size, 0);
console.log(`${names.length} shards, ${entries.size} words, ${Object.keys(exceptions).length} irregular forms`
  + ` (${lists.length ? 'WordNet' : 'common'}), ${(bytes / 1048576).toFixed(1)} MB in ${relative(process.cwd(), OUT) || '.'}`);
