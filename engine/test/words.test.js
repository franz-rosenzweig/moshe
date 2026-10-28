import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { shardOf, baseForms, lookupIn, synonymList } from '../src/words.js';

const EXC = { wolves: ['wolf'], went: ['go'], geese: ['goose'] };

test('a lemma is in the file of its first letter', () => {
  assert.equal(shardOf('cold'), 'c');
  assert.equal(shardOf('Orchard'), 'o');
  assert.equal(shardOf('ice cream'), 'i');
  assert.equal(shardOf('.22'), '_');
  assert.equal(shardOf('3-d'), '_');
  assert.equal(shardOf('שלום'), '_');
  assert.equal(shardOf('éclair'), '_');
  assert.equal(shardOf(''), '_');
});

test('a word as written comes to the lemmas it may be', () => {
  const has = (word, lemma, exc = EXC) => assert.ok(baseForms(word, exc).includes(lemma), `${word} → ${lemma}: ${baseForms(word, exc)}`);
  assert.equal(baseForms('Cats')[0], 'cats', 'the word itself first, lowercase');
  has('cats', 'cat');
  has('wolves', 'wolf');
  assert.ok(!baseForms('wolves', {}).includes('wolf'), 'wolves is the exception list’s');
  assert.equal(baseForms('went', EXC)[1], 'go', 'the exception list right after the word');
  has('geese', 'goose');
  has('running', 'run');
  has('stopped', 'stop');
  has('colder', 'cold');
  has('bigger', 'big');
  has('boxes', 'box');
  has('churches', 'church');
  has('cities', 'city');
  has('tried', 'try');
  has('dying', 'die');
  has('happier', 'happy');
  has('cypresses', 'cypress');
  // which comes first where both are words
  const before = (word, a, b) => {
    const f = baseForms(word);
    assert.ok(f.indexOf(a) >= 0 && (f.indexOf(b) < 0 || f.indexOf(a) < f.indexOf(b)), `${word}: ${a} before ${b} in ${f}`);
  };
  before('hoped', 'hope', 'hop');
  before('hopped', 'hop', 'hope');
  before('passed', 'pass', 'passe');
  before('finer', 'fine', 'fin');
  before('colder', 'cold', 'colde');
});

test('a possessive and the punctuation around a word go', () => {
  assert.deepEqual(baseForms("dog's").slice(0, 1), ['dog']);
  assert.deepEqual(baseForms('writer’s').slice(0, 1), ['writer']);
  assert.deepEqual(baseForms('“orchard,”').slice(0, 1), ['orchard']);
  assert.deepEqual(baseForms('(cold!)').slice(0, 1), ['cold']);
  assert.equal(baseForms("dogs'")[0], 'dogs');
  assert.equal(baseForms('ice_cream')[0], 'ice cream');
  assert.equal(baseForms("o'clock")[0], "o'clock", 'an apostrophe inside stays');
  assert.deepEqual(baseForms('...'), []);
  assert.deepEqual(baseForms(''), []);
  assert.deepEqual(baseForms(null), []);
});

test('any script passes through unbroken', () => {
  assert.deepEqual(baseForms('שָׁלוֹם,'), ['שָׁלוֹם']);
  assert.deepEqual(baseForms('ΚΑΛΗΜΕΡΑ'), ['καλημερα']);
  assert.equal(lookupIn({}, 'בית', EXC), null);
});

const SHARDS = {
  c: {
    cold: [
      ['a', 'having a low or inadequate temperature', ['icy', 'frigid', 'chilly', 'frosty', 'wintry']],
      ['a', 'without human warmth or emotion', ['frigid', 'distant', 'aloof', 'unfriendly']],
      ['n', 'a mild viral infection', ['common cold']],
    ],
    cat: [['n', 'feline mammal', ['true cat']]],
  },
  g: { go: [['v', 'change location; move', ['travel', 'move', 'locomote']]] },
  t: { toString: [['n', 'not a real word', []]] },
};

test('a word is looked up by the first of its forms that is there', () => {
  const e = lookupIn(SHARDS, 'Colder', EXC);
  assert.equal(e.lemma, 'cold');
  assert.equal(e.word, 'Colder');
  assert.equal(e.senses.length, 3);
  assert.deepEqual(e.senses[0], { pos: 'a', gloss: 'having a low or inadequate temperature', synonyms: ['icy', 'frigid', 'chilly', 'frosty', 'wintry'] });
  assert.equal(lookupIn(SHARDS, "cat's", EXC).lemma, 'cat');
  assert.equal(lookupIn(SHARDS, 'went', EXC).lemma, 'go', 'through the exception list, into another shard');
  assert.equal(lookupIn(SHARDS, 'orchard', EXC), null, 'not there');
  assert.equal(lookupIn({ c: SHARDS.c }, 'went', EXC), null, 'its shard not loaded');
  assert.equal(lookupIn(SHARDS, 'constructor', EXC), null, 'nothing inherited is a word');
  assert.equal(lookupIn(SHARDS, 'hasOwnProperty'), null);
});

test('synonyms are offered a few from each sense in turn, the commonest sense most', () => {
  const e = lookupIn(SHARDS, 'cold', EXC);
  assert.deepEqual(synonymList(e), ['icy', 'frigid', 'chilly', 'frosty', 'wintry', 'distant', 'aloof', 'unfriendly', 'common cold']);
  assert.deepEqual(synonymList(e, 4), ['icy', 'frigid', 'chilly', 'frosty']);
  assert.deepEqual(synonymList({ lemma: 'x', senses: [{ synonyms: ['X', 'y'] }] }), ['y'], 'not the word itself');
  assert.deepEqual(synonymList(null), []);
});

// the generated files (cd frontend && npm run words), when they are there
const words = new URL('../../frontend/public/words/en/', import.meta.url);
const generated = existsSync(new URL('c.json', words));

test('the real WordNet files', { skip: !generated && 'no frontend/public/words/en/c.json: cd frontend && npm run words' }, () => {
  const shards = {};
  const read = (name) => JSON.parse(readFileSync(new URL(`${name}.json`, words), 'utf8'));
  const exceptions = read('exceptions');
  const lookup = (word) => {
    for (const s of new Set(baseForms(word, exceptions).map(shardOf))) shards[s] ||= read(s);
    return lookupIn(shards, word, exceptions);
  };
  const cold = lookup('cold');
  assert.equal(cold.senses[0].pos, 'a', 'the adjective first');
  assert.ok(cold.senses.some((s) => s.synonyms.includes('chilly') || s.synonyms.includes('icy')), 'cold: chilly or icy');
  const cypress = lookup('cypresses');
  assert.equal(cypress.lemma, 'cypress');
  assert.ok(cypress.senses[0].gloss.length > 10);
  const orchard = lookup('orchard');
  // WordNet 3.1: "garden consisting of a small cultivated wood without undergrowth"
  assert.ok(orchard.senses.some((s) => s.pos === 'n' && /fruit|tree|wood/u.test(s.gloss)), orchard.senses[0].gloss);
  assert.equal(lookup('geese').lemma, 'goose');
  assert.equal(lookup('went').lemma, 'go');
  for (const [, shard] of Object.entries(shards)) {
    for (const senses of Object.values(shard).slice(0, 500)) {
      for (const [pos, gloss, synonyms] of senses) {
        assert.ok('nvar'.includes(pos) && pos.length === 1);
        assert.ok(gloss.length <= 141 && !gloss.includes('; "'), gloss);
        assert.ok(Array.isArray(synonyms) && synonyms.length <= 12);
      }
    }
  }
});
