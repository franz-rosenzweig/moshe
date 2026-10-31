import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMANDS, parse, lite, fromSaid, numberOf, cleanDictation, placeDictation, phraseRanges, nearest, proseLines, sentenceRanges,
  wordAt, headingsOf, marksOf, spokenText, soundex, snapNames, namesIn, alternatesFor, settleChanges,
} from '../src/voice.js';

const CHAPTER = `## Two: Arrival

"The Ben-Ami place," he said. "Follow the trees. If you reach the water tower, you've gone too far."

She did not reach the water tower. ==The house found her first==, low and white. Someone had left a lamp burning.

### The kitchen

Avner was not there. She found a letter in the same slanting hand: _The key is where it always was. Eat something._

%%Too neat? Maybe she shouldn't find the key at first.%%

{==She ate bread standing up==}{>>Echo this. Later.<<}, the way he used to. {--Very--} {++Quite++} {~~cold~>wintry~~} night.^[A note. Two.]`;

test('every command is said by its own example', () => {
  const ids = new Set();
  for (const c of COMMANDS) {
    assert.ok(!ids.has(c.id), `one ${c.id}`);
    ids.add(c.id);
    const p = parse(c.example, { reading: c.id === 'stop' });
    assert.equal(p.kind, 'command', `“${c.example}” is a command`);
    assert.equal(p.id, c.id, `“${c.example}” is ${c.id}, not ${p.id}`);
  }
});

test('a command counts only as the whole utterance', () => {
  assert.equal(parse('delete that').id, 'deleteThat');
  const t = parse('She said delete that and left.');
  assert.equal(t.kind, 'text');
  assert.match(t.why, /delete that/);
  assert.equal(parse('the frost came early that year').why, '');
  // the way recognizers write it: a capital, a full stop, a filler first
  assert.equal(parse('Scratch that.').id, 'undo');
  const s = parse('Um, select the water tower.');
  assert.equal(s.id, 'selectPhrase');
  assert.deepEqual(s.groups, ['the water tower']);
  // “type” in front: the words, not the command
  const ty = parse('type new paragraph');
  assert.equal(ty.id, 'type');
  assert.equal(ty.groups[0], 'new paragraph');
});

test('the exact phrases win over the open-ended ones', () => {
  assert.equal(parse('open the dashboard').id, 'dashboard');
  assert.equal(parse('go to sleep').id, 'sleep');
  assert.equal(parse('go to the end').id, 'goEdge');
  assert.equal(parse('go to mark 2').id, 'pickMark');
  assert.equal(parse('select this sentence').id, 'selectUnit');
  assert.equal(parse('select she did through stones').id, 'selectRange');
  assert.equal(parse('delete last word').id, 'deleteLast');
  assert.equal(parse('open frost').id, 'open');
});

test('what is going on decides some of it', () => {
  // asleep: nothing counts but waking
  assert.equal(parse('what do you think of it so far', { asleep: true }).kind, 'ignored');
  assert.equal(parse('Wake up.', { asleep: true }).id, 'wake');
  // a numbered list showing: a number picks, in any of the ways recognizers write it
  for (const [said, n] of [['two', 2], ['To.', 2], ['too', 2], ['2.', 2], ['Use 4.', 4], ['use for', 4], ['number seven', 7], ['the one', 1]]) {
    const p = parse(said, { choosing: true });
    assert.equal(p.kind, 'choice', said);
    assert.equal(p.n, n, said);
  }
  // no list: a number is a word
  assert.equal(parse('two').kind, 'text');
  // “stop” only while reading
  assert.equal(parse('stop', { reading: true }).id, 'stop');
  const st = parse('Stop.');
  assert.equal(st.kind, 'text');
  assert.match(st.why, /Nothing was being read/);
  assert.equal(parse('stop reading').id, 'stopReading');
});

test('numbers and the words a command was given', () => {
  assert.equal(numberOf('12'), 12);
  assert.equal(numberOf('Four'), 4);
  assert.ok(Number.isNaN(numberOf('lots')));
  assert.equal(lite('“Select the water tower.”'), 'Select the water tower');
  assert.equal(fromSaid('Comment who lit it?', 'who lit it'), 'who lit it?');
  assert.equal(fromSaid('replace slanting with Careful.', 'careful'), 'Careful.');
});

test('dictation is tidied, never reworded', () => {
  assert.deepEqual(cleanDictation('Um, she stood in the doorway and uh listened.'), { text: 'she stood in the doorway and listened.', fillers: 2 });
  assert.equal(cleanDictation('she paused comma then left period').text, 'she paused, then left.');
  assert.equal(cleanDictation('was it question mark').text, 'was it?');
  assert.equal(cleanDictation('umbrella and humble').text, 'umbrella and humble', 'only whole fillers');
  assert.equal(cleanDictation('שלום comma', { lang: 'he' }).text, 'שלום comma', 'spoken punctuation is English only');
});

test('dictation is placed: spaces, capitals, the full stop', () => {
  const t = 'She did not reach the tower. Someone had left a lamp.';
  // at the end of a paragraph: a space, a capital, a full stop added
  let p = placeDictation(t, t.length, t.length, 'she stood in the doorway');
  assert.equal(p.insert, ' She stood in the doorway.');
  assert.equal(t.length + 1, p.start);
  // in the middle of a sentence: the recognizer's capital and full stop go
  const mid = t.indexOf(' Someone') - 1;     // after "tower"
  p = placeDictation('She did not reach the tower at all.', 27, 27, 'Quite.');
  assert.equal(p.insert, ' quite');
  // before a full stop that's already there
  p = placeDictation(t, mid, mid, 'Even then.');
  assert.equal(p.insert, ' even then');
  // before a new sentence: its stop kept, a space after
  const at = t.indexOf('Someone');
  p = placeDictation(t, at, at, 'It was late.');
  assert.equal(p.insert, 'It was late. ');
  // a name keeps its capital mid-sentence
  p = placeDictation('She saw', 7, 7, 'Avner by the gate', { names: ['Avner'] });
  assert.equal(p.insert, ' Avner by the gate.');
  // a new, empty paragraph
  p = placeDictation('First.\n\n', 8, 8, 'the next one began');
  assert.equal(p.insert, 'The next one began.');
  // a selection is replaced
  p = placeDictation('a cold night', 2, 6, 'bitter');
  assert.deepEqual([p.from, p.to, p.insert], [2, 6, 'bitter']);
  // Hebrew: no capitals, no added stop
  p = placeDictation('שלום', 4, 4, 'עולם ומלואו כולו', { lang: 'he' });
  assert.equal(p.insert, ' עולם ומלואו כולו');
});

test('a phrase is found across punctuation and markup, never inside a word', () => {
  const r = phraseRanges(CHAPTER, 'the water tower');
  assert.equal(r.length, 2);
  assert.equal(CHAPTER.slice(...r[1]), 'the water tower');
  const h = phraseRanges(CHAPTER, 'the house found her first');
  assert.equal(h.length, 1);
  assert.equal(CHAPTER.slice(...h[0]), 'The house found her first');
  assert.equal(phraseRanges(CHAPTER, 'you’ve gone').length, 1, 'curly or straight apostrophes');
  assert.equal(phraseRanges(CHAPTER, 'he').filter(([a]) => CHAPTER.slice(a, a + 3) === 'hea').length, 0);
  assert.equal(phraseRanges(CHAPTER, 'house white').length, 0);
  assert.deepEqual(nearest([[10, 12], [100, 104], [300, 301]], 120), [100, 104]);
});

test('sentences, prose, words and headings', () => {
  const lines = proseLines(CHAPTER).map(([a, b]) => CHAPTER.slice(a, b));
  assert.ok(lines.every((l) => !l.startsWith('#') && !l.startsWith('%%')), 'no headings, no comment lines');
  const s = sentenceRanges(CHAPTER).map(([a, b]) => CHAPTER.slice(a, b));
  assert.equal(s[0], '"The Ben-Ami place," he said.');
  assert.equal(s[1], '"Follow the trees.');
  assert.equal(s[3], 'She did not reach the water tower.');
  assert.ok(s.includes('{==She ate bread standing up==}{>>Echo this. Later.<<}, the way he used to.'), 'a comment’s full stops don’t end the sentence');
  assert.ok(s.includes('She found a letter in the same slanting hand: _The key is where it always was.'));
  assert.ok(s.includes('Eat something._'), 'the italic’s closing tag stays with its sentence');
  const w = wordAt(CHAPTER, CHAPTER.indexOf('lamp') + 2);
  assert.equal(CHAPTER.slice(...w), 'lamp');
  assert.deepEqual(headingsOf(CHAPTER).map((h) => h.title), ['Two: Arrival', 'The kitchen']);
});

test('the marks, as Revision Mode lists them', () => {
  const kinds = marksOf(CHAPTER).map((m) => `${m.kind}: ${m.text}`);
  assert.deepEqual(kinds, [
    'Highlight: The house found her first',
    'Note: Too neat? Maybe she shouldn\'t find the key at first.',
    'Comment: Echo this. Later. · She ate bread standing up',
    'Deletion: Very', 'Insertion: Quite', 'Change: cold → wintry',
  ]);
});

test('accept all, reject all', () => {
  const t = 'the way he used to. {--Very--} {++Quite++} {~~cold~>wintry~~} night, {++and ++}then **{--gone--}**.';
  const apply = (changes) => { let s = t; for (const c of [...changes].reverse()) s = s.slice(0, c.from) + c.insert + s.slice(c.to); return s; };
  assert.equal(apply(settleChanges(t, true)), 'the way he used to. Quite wintry night, and then ****.');
  assert.equal(apply(settleChanges(t, false)), 'the way he used to. Very cold night, then **gone**.');
  assert.deepEqual(settleChanges('no marks here', true), []);
});

test('reading aloud says only what a reader reads', () => {
  const at = CHAPTER.indexOf('{==She ate');
  const { text, map } = spokenText(CHAPTER, at, CHAPTER.length);
  assert.equal(text, 'She ate bread standing up, the way he used to. Quite wintry night.');
  assert.equal(CHAPTER[map[0]], 'S');
  assert.equal(map.length, text.length);
  const h = spokenText(CHAPTER, 0, CHAPTER.indexOf('\n'));
  assert.equal(h.text, 'Two: Arrival');
  assert.equal(spokenText(CHAPTER, CHAPTER.indexOf('%%'), CHAPTER.indexOf('%%', CHAPTER.indexOf('%%') + 2) + 2).text, '', 'a comment line is silent');
});

test('names: found in the project, put right by sound', () => {
  assert.equal(soundex('Avner'), soundex('Abner'));
  assert.equal(soundex('Avner'), soundex('Avenor'));
  assert.notEqual(soundex('Avner'), soundex('after'));
  const names = ['Avner', 'Ben-Ami', 'Miriam'];
  assert.equal(snapNames("Avenor's truck was not there.", names).text, "Avner's truck was not there.");
  assert.equal(snapNames('The Benny Ami place.', names).text, 'The Ben-Ami place.');
  assert.equal(snapNames('Ben Ami said so.', names).text, 'Ben-Ami said so.');
  assert.equal(snapNames('Mary am read it twice.', names).text, 'Miriam read it twice.');
  for (const s of ['after that, he left.', 'Never mind.', 'The owner was there.', 'A mirror hung there.', 'She went in November.']) assert.equal(snapNames(s, names).text, s);
  const found = namesIn([CHAPTER, 'Then Avner left. She asked Avner why, and Miriam laughed. Later Miriam slept. On Monday it rained, and Monday again.']);
  assert.ok(found.includes('Avner') && found.includes('Miriam'), found.join(','));
  assert.ok(!found.includes('Monday') && !found.includes('She') && !found.includes('Then'), found.join(','));
  assert.deepEqual(alternatesFor('there'), ['their', 'they\'re']);
  assert.ok(alternatesFor('Abner', names).includes('Avner'));
});
