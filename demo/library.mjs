// The sample library of the taste on stuffs (and of the docs' screenshots):
// a made-up novel, a few essays, Genesis 1 in Hebrew beside the King James,
// some notes and the Getting Started sheets. Nothing in it is anyone's real
// writing. fillLibrary() writes it into an empty store through the engine's
// own calls, so the files are exactly what Moshe itself would make.
import { addGettingStarted } from '../engine/src/welcome.js';

const LETTER = `## One: The Letter

The letter came in October, which was the wrong month for it. Miriam read it twice standing at the mailboxes and a third time on the stairs, and by the time she reached her door she had decided not to go.

Her uncle wrote the way he spoke, in short sentences that each seemed to have been weighed. _The trees are old. I am older. Come before the frost if you are coming at all._ He did not say what he wanted her to do once she was there, and he did not sign it, as if there could be only one person in the world who would write to her about trees.

She went in November.
`;

const ARRIVAL = `## Two: Arrival

Miriam came to the valley on the last bus of the day, with one suitcase and her uncle's letter folded into the back of her passport. The driver let her off where the asphalt gave up and pointed with his chin at a row of cypresses that might have been a mile away or three.

"The Ben-Ami place," he said. "Follow the trees. If you reach the water tower, you've gone too far."

She did not reach the water tower. ==The house found her first==, low and white behind a wall of stacked stones, its shutters closed against an afternoon that had already turned cold. Someone had left a lamp burning in the kitchen.

### The kitchen

Avner was not there. On the table, under a saucer, she found a second letter, shorter than the first, in the same slanting hand: _The key is where it always was. Eat something. I'll be back when the frost lets me._^[In the first draft Avner's notes were in Hebrew. Decide before Part Two whether the English keeps a word or two of it.]

%%Too neat? Maybe she shouldn't find the key at first.%%

She had never been to the house before, so the key could not be where it always was. She looked anyway: under the mat, behind the shutter, in the cold mouth of the oven. In the end it was hanging on a nail by the door, in plain sight, which was how her uncle had always hidden things.

{==She ate bread and white cheese standing up==}{>>Echo this in the last chapter, when she leaves.<<}, the way he used to, and listened to the house settle around her. The refrigerator hummed and stopped. A shutter knocked once and thought better of it. Somewhere out in the dark, row after row, the trees were doing whatever trees do in the hour before a frost.

### The orchard at night

She took the lamp outside. The cold had a smell, sharp and clean, like a knife that has just been sharpened, and the grass was already stiff under her shoes.

**The orchard was larger than she had imagined.** In the lamplight she could see four rows, then six, then nothing but the shapes of more trees going down the slope towards a sound that might have been water. Here and there an apple still hung on a bare branch, small and dark, as if the tree had forgotten it.

She picked one. It was hard and sour and very cold, and she ate the whole thing standing there, because nobody was watching and because she had come all this way.
`;

const FROST = `## Three: Frost

Avner came back on the third day, in a truck that sounded older than he was. He did not ask how long she meant to stay. "You found the key," he said. "It's never where you'd think, and always where it is."

He walked her through the rows before breakfast, naming the trees as if they were relatives: this one planted the year the road came, this one grafted from a tree in a village that no longer had a name. The frost had silvered the grass, and their footprints stayed behind them, dark and exact.

"The late ones are the best," he said, and twisted an apple off a branch for her. "Everyone else has given up by now."
`;

const PART_TWO = `## Four: The Pressing

By the second week Miriam knew which shutter knocked and which floorboard answered it. She learned to start the stove with newspaper and patience, and to say nothing when Avner was reading the sky.

The pressing was on a Thursday. Half the valley came, or seemed to, with crates and children and opinions about the weather.
`;

const GENESIS_HE = `# בראשית א

בראשית ברא אלהים את השמים ואת הארץ.
והארץ היתה תהו ובהו וחשך על פני תהום ורוח אלהים מרחפת על פני המים.
ויאמר אלהים יהי אור ויהי אור.
וירא אלהים את האור כי טוב ויבדל אלהים בין האור ובין החשך.
ויקרא אלהים לאור יום ולחשך קרא לילה ויהי ערב ויהי בקר יום אחד.
ויאמר אלהים יהי רקיע בתוך המים ויהי מבדיל בין מים למים.
ויעש אלהים את הרקיע ויבדל בין המים אשר מתחת לרקיע ובין המים אשר מעל לרקיע ויהי כן.
ויקרא אלהים לרקיע שמים ויהי ערב ויהי בקר יום שני.
ויאמר אלהים יקוו המים מתחת השמים אל מקום אחד ותראה היבשה ויהי כן.
ויקרא אלהים ליבשה ארץ ולמקוה המים קרא ימים וירא אלהים כי טוב.
ויאמר אלהים תדשא הארץ דשא עשב מזריע זרע עץ פרי עשה פרי למינו אשר זרעו בו על הארץ ויהי כן.
ותוצא הארץ דשא עשב מזריע זרע למינהו ועץ עשה פרי אשר זרעו בו למינהו וירא אלהים כי טוב.
ויהי ערב ויהי בקר יום שלישי.
`;

const GENESIS_EN = `# Genesis 1

In the beginning God created the heaven and the earth.
And the earth was without form, and void; and darkness was upon the face of the deep. And the Spirit of God moved upon the face of the waters.
And God said, Let there be light: and there was light.
And God saw the light, that it was good: and God divided the light from the darkness.
And God called the light Day, and the darkness he called Night. And the evening and the morning were the first day.
And God said, Let there be a {==firmament==}{>>רקיע: something beaten out flat. Newer translations say "vault" or "dome". Keep the King James word?<<} in the midst of the waters, and let it divide the waters from the waters.
And God made the firmament, and divided the waters which were under the firmament from the waters which were above the firmament: and it was so.
And God called the firmament Heaven. And the evening and the morning were the second day.
And God said, Let the waters under the heaven be gathered together unto one place, and let the dry land appear: and it was so.
And God called the dry land Earth; and the gathering together of the waters called he Seas: and God saw that it was good.
And God said, Let the earth bring forth grass, the herb yielding seed, and the fruit tree yielding fruit after his kind, whose seed is in itself, upon the earth: and it was so.
`;

const ESSAYS = {
  footnotes: `# On Footnotes

A footnote is the translator admitting, in small print, that something did not fit.^[Or that it fitted too well, and someone ought to know.] The question is never whether to admit it, but how often and how quietly.

Too many, and the reader starts reading the bottom of the page instead of the top. Too few, and the translation pretends to be the original, which is the one thing it can never be.
`,
  comma: `# What the Comma Knows

Hebrew prose and English prose disagree about the comma, and a translator who doesn't notice ends up with English that sounds out of breath.

A Hebrew sentence will happily run on with "and" after "and", and in Hebrew that is a rhythm. In English it is a list. The comma is where you decide which one you are writing.
`,
  sentence: `# The long sentence

The answer is not to cut every long sentence in two. Some of them are long because the thought is long, and the reader should feel the length.

The trick is to know which kind you have: a sentence that goes somewhere, or one that only goes on.
`,
  reader: `# The Second Reader

Every translation has two readers: the one who will read it, and the one who already read the original and will be checking.

The second reader is not a enemy. She is the one who will tell you, years later, which of your choices still make sense.
`,
  letter: `# A Letter to a Young Translator

Read the whole book before you translate the first sentence. Then read it again, slowly, with a pencil, and only then begin.

Keep a list of the words you were unsure of. Most of them will sort themselves out by the last chapter, and the ones that don't are your real work.
`,
};

const INBOX = [
  { text: '# Title ideas\nLate Apples\nThe House Finds Her First\nA Key in Plain Sight\nWhat the Frost Allows\n', keywords: ['Idea'], favorite: true },
  { text: '# Overheard at the market\n"You don\'t buy apples in October, you choose them." An old man to his grandson, holding one up to the light like a jeweller.\n', keywords: ['Idea'] },
  { text: '# Look up\n- When did the valley\'s first orchards go in?\n- Firmament, vault, dome: what do the newer Bible translations say for רקיע?\n- Is "frost pocket" a real orchard term? (Yes, I think, but check.)\n' },
  { text: '# Books to read this winter\nMiddlemarch, again\nThe Mill on the Floss\nA Hebrew grammar that isn\'t a textbook\n' },
];

/** The sample library, written into an empty store. → the path of the sheet to open first */
export function fillLibrary(store) {
  const meta = (path, m) => { store.setSheetMeta(path, m); return path; };

  // ---- Notes: Getting Started, the Inbox, a few groups
  addGettingStarted(store);
  for (const n of INBOX) {
    const p = store.createSheet('Notes', { text: n.text });
    if (n.keywords) meta(p, { keywords: n.keywords });
    if (n.favorite) store.setFavorite(p, true);
  }
  const ideas = store.createGroup('Notes', 'Ideas', { icon: 'lightbulb', color: 'blue' });
  store.createSheet(ideas, { text: "# Hardy's weather\nIn Hardy the weather does half the work of the plot. Late Apples needs one: the frost night in Part Two.\n" });
  const journal = store.createGroup('Notes', 'Journal', { icon: 'notebook-pen', color: 'orange' });
  store.createSheet(journal, { text: '# A slow morning\nWrote the kitchen scene twice. The second one is shorter and better, which is usually how it goes.\n' });
  const reading = store.createGroup('Notes', 'Reading', { icon: 'book-open', color: 'green' });
  store.createSheet(reading, { text: '# Middlemarch\nThe narrator keeps stepping in to be kind about people the reader would rather judge. That is the whole book, maybe.\n' });

  // ---- a novel
  const novel = store.createProject('Late Apples', { template: 'empty', color: 'orange', icon: 'book', goal: { type: 'daily', count: 500, metric: 'words' } });
  const one = store.editGroup(`${novel}/Drafts`, { name: 'Part One' });
  const two = store.createGroup(novel, 'Part Two', { after: one });
  const chars = store.editGroup(`${novel}/Extras/Notes`, { name: 'Characters' });
  store.createSheet(one, { text: '# Late Apples\n' });
  meta(store.createSheet(one, { text: LETTER }), { keywords: ['Done', 'Miriam'] });
  const arrival = meta(store.createSheet(one, { text: ARRIVAL }), {
    keywords: ['Draft', 'Miriam'],
    goal: { type: 'at-least', count: 800, metric: 'words' },
    notes: ['End the chapter in the orchard, not the kitchen.', "Avner's second letter: shorter than the first, and no signature again."],
  });
  meta(store.createSheet(one, { text: FROST }), { keywords: ['Draft', 'Revise'] });
  meta(store.createSheet(two, { text: PART_TWO }), { keywords: ['Draft'] });
  store.createSheet(chars, { text: '# Miriam\nThirty-four. Lives alone in the city, in a flat with no balcony. Reads letters standing up.\n' });
  store.createSheet(chars, { text: '# Avner Ben-Ami\nHer uncle. Speaks in short sentences. Hides things in plain sight.\n' });
  store.createSheet(`${novel}/Extras/Research`, { text: '# Apple varieties\nThe late ones keep best: picked after the first frost, stored in a cool room, sweeter by spring.\n' });

  // ---- essays
  const essays = store.createProject('Essays on Translation', { template: 'blog', color: 'blue', icon: 'feather' });
  meta(store.createSheet(`${essays}/Drafts`, { text: ESSAYS.footnotes }), { keywords: ['Revise'] });
  meta(store.createSheet(`${essays}/Drafts`, { text: ESSAYS.comma }), { keywords: ['Draft'] });
  meta(store.createSheet(`${essays}/Drafts`, { text: ESSAYS.sentence }), { keywords: ['Draft'] });
  meta(store.createSheet(`${essays}/Drafts`, { text: ESSAYS.reader }), { keywords: ['Idea'] });
  meta(store.createSheet(`${essays}/Published`, { text: ESSAYS.letter }), { keywords: ['Done'] });
  store.saveFilter(essays, { name: 'To Revise', color: 'red', rules: { match: 'all', items: [{ field: 'keyword', op: 'is', value: 'Revise' }] } });

  // keywords' colours, in the library's pool and each project's; a few names the spelling check should know
  const COLORS = [['Done', 'green'], ['Draft', 'orange'], ['Miriam', 'purple'], ['Revise', 'red'], ['Idea', 'blue']];
  for (const pool of [null, novel, essays]) for (const [k, color] of COLORS) store.setKeyword(k, { color }, pool);
  for (const k of ['Draft', 'Miriam']) store.setKeyword(k, { favorite: true }, novel);
  // (and the Bible's own spellings, which a modern Hebrew dictionary doesn't have)
  store.setSetting('dictionary', ['Ami', 'Avner', 'Ben-Ami', 'Middlemarch', 'Miriam',
    'אלהים', 'היתה', 'ויבדל', 'ויעש', 'ותוצא', 'ותראה', 'יקוו', 'ולמקוה', 'למינהו', 'למינו', 'מזריע', 'מרחפת', 'תדשא']);

  // ---- a translation: Genesis 1, the Hebrew beside the King James (both in the public domain)
  const gen = store.createProject('Genesis', { template: 'translation', color: 'teal', icon: 'languages' });
  const verses = (t) => `${t.trim().split('\n').filter(Boolean).join('\n\n')}\n`;   // a verse a paragraph, with room between
  store.createSheet(`${gen}/Original`, { text: verses(GENESIS_HE) });
  const en = store.createSheet(`${gen}/Translation`, { text: verses(GENESIS_EN) });
  store.renameSheet(en, 'בראשית א');
  const glossary = store.sheetsIn(`${gen}/Extras/Glossary`)[0];
  if (glossary) store.writeText(glossary, '# Glossary\n\n- רקיע: firmament (King James); vault, dome (newer)\n- תהו ובהו: without form, and void\n');

  return arrival;
}
