// The voice tutorial (Help › Voice Tutorial, Settings › Voice): lessons to pick from, each a few
// minutes on its own practice sheet, one step at a time. A step says what to say, and Moshe moves
// on when it sees it done: by what the sheet now reads, mostly, so any way of saying it that works
// counts. tools/lessons-e2e.mjs says every line of every lesson to the real app, as typed and as a
// recognizer writes it, and checks each step was done.
//
// A step's done(c) is asked as things change, with
//   c.heard      one line heard since the step began ({kind: text | command | fail | ignored, id}), or null
//   c.text       the sheet open now; c.from, c.to the selection, c.sel its text
//   c.listening  the microphone is on; c.asleep, c.reading, c.choosing (a numbered list), c.words (the
//                Words view's kind: syn | def | fix), c.revision, c.dashboard, c.focus, c.numbers, c.sheet
// A step with `say` shows that line (`id`: the command it is, none when it's typed, which the tests
// hold it to); one with `do` shows its `text`. `when` names what must be going on for the line to be
// a command (and a step for while it reads is passed over once the reading is over). `want`: the
// item of a numbered list to say the number of (its words, or its number). `tip`, a few words under
// the line. `look`: where on screen. `practice`: the step makes a practice sheet (a lesson with
// `text` gets its own when it starts).

const heard = (...ids) => (c) => !!c.heard && c.heard.kind === 'command' && ids.includes(c.heard.id);
const has = (...s) => (c) => c.text != null && s.every((x) => c.text.includes(x));
const lacks = (...s) => (c) => c.text != null && s.every((x) => !c.text.includes(x));
const both = (...f) => (c) => f.every((g) => g(c));
const low = (s) => String(s || '').toLowerCase();
const clean = (s) => low(s).replace(/^[\s“"]+|[\s.,;!?”"]+$/gu, '');
/** The selection is these words (case aside, and a closing full stop). */
const picked = (s) => (c) => !!c.sel && clean(c.sel) === clean(s);
/** The selection runs from these words to those. */
const spans = (a, b) => (c) => !!c.sel && clean(c.sel).startsWith(clean(a)) && clean(c.sel).endsWith(clean(b));
/** The selection is the nth (from 1) time these words are in the sheet. */
const pickedNth = (s, n) => (c) => {
  if (!c.text || !c.sel || clean(c.sel) !== clean(s)) return false;
  let at = -1;
  for (let i = 0; i < n; i++) { at = low(c.text).indexOf(low(s), at + 1); if (at < 0) return false; }
  return c.from === at;
};
const cursor = (c) => c.text != null && c.from === c.to;
const atEnd = (c) => cursor(c) && c.from >= c.text.replace(/\s+$/u, '').length;
/** The cursor is just after (or before) these words. */
const after = (s) => (c) => cursor(c) && low(c.text).slice(0, c.from).trimEnd().endsWith(low(s));
const before = (s) => (c) => cursor(c) && low(c.text).slice(c.from).trimStart().startsWith(low(s));
/** The cursor is in the paragraph (the line) that has these words. */
const inLine = (s) => (c) => {
  if (!cursor(c)) return false;
  const a = c.text.lastIndexOf('\n', c.from - 1) + 1, b = c.text.indexOf('\n', c.from);
  return c.text.slice(a, b < 0 ? undefined : b).includes(s);
};
const LISTEN = { do: 'listen', text: 'Start listening', look: 'mic', done: (c) => c.listening && !c.asleep };

export const LESSONS = [
  {
    id: 'basics', title: 'The Basics',
    steps: [
      LISTEN,
      { say: 'new sheet', id: 'newSheet', look: 'strip', practice: true, done: both(heard('newSheet'), (c) => c.text === '') },
      { say: 'the frost came early that year', look: 'strip', tip: 'Then a pause', done: has('The frost came early that year') },
      { say: 'the wells froze before the harvest was in', look: 'strip', done: has('The wells froze before the harvest was in') },
      { say: 'new paragraph', id: 'newParagraph', done: both(heard('newParagraph'), has('harvest was in.\n')) },
      { say: 'nobody could remember a winter like it', done: has('Nobody could remember a winter like it') },
      { say: 'scratch that', id: 'undo', tip: 'Takes back the last thing', done: both(heard('undo'), has('harvest was in'), lacks('Nobody could')) },
      { say: 'the old people said it would pass', done: has('\nThe old people said it would pass') },
      { say: 'comma', id: 'punctuation', done: has('it would pass,') },
      { say: 'and it did', done: has('it would pass, and it did') },
      { say: 'go to sleep', id: 'sleep', look: 'mic', tip: 'Moshe stops acting on what you say', done: (c) => c.asleep },
      { say: 'this is not typed', look: 'strip', when: 'asleep', done: both((c) => !!c.heard && c.heard.kind === 'ignored', lacks('not typed')) },
      { say: 'wake up', id: 'wake', when: 'asleep', look: 'mic', done: (c) => !c.asleep && heard('wake')(c) },
      { say: 'what can I say', id: 'help', look: 'dashboard', done: heard('help') },
    ],
  },
  {
    id: 'mistakes', title: 'Fixing Mistakes',
    text: '# Fixing Mistakes\n\nThe bakery opened at six. Its bread was famous across the valley, and the flower came from the mill by the river. The line reached the corner by seven.\n',
    steps: [
      LISTEN,
      { say: 'go to the end', id: 'goEdge', done: both(heard('goEdge'), atEnd) },
      { say: 'the baker never took a holiday', done: has('The baker never took a holiday') },
      { say: 'delete that', id: 'deleteThat', tip: 'What you just said', done: both(heard('deleteThat'), lacks('The baker never')) },
      { say: 'the baker never took a day off in her whole life', done: has('The baker never took a day off in her whole life') },
      { say: 'delete last word', id: 'deleteLast', done: both(has('in her whole'), lacks('whole life')) },
      { say: 'do that again', id: 'repeat', done: both(has('a day off in her'), lacks('her whole')) },
      { say: 'delete last sentence', id: 'deleteLast', done: both(heard('deleteLast'), lacks('The baker never'), has('by seven.')) },
      { say: 'scratch that', id: 'undo', done: both(heard('undo'), has('The baker never took a day off in her')) },
      { say: 'undo three times', id: 'undoMany', done: both(heard('undoMany'), lacks('The baker never'), has('by seven.')) },
      { say: 'redo', id: 'redo', done: both(heard('redo'), has('The baker never took a day off in her whole life')) },
      { say: 'correct flower', id: 'correct', look: 'dashboard', tip: 'Words that sound the same', done: (c) => c.choosing && heard('correct')(c) },
      { do: 'number', text: 'Say the number of “flour”', want: 'flour', look: 'dashboard', done: both(has('the flour came'), lacks('flower')) },
      { say: 'replace six with five', id: 'replace', done: has('opened at five') },
      { say: 'replace five with six', id: 'replace', done: both(heard('replace'), has('opened at six')) },
    ],
  },
  {
    id: 'selecting', title: 'Selecting',
    text: '# Selecting\n\nThe river ran past the mill and under the old bridge. In spring the river rose, and the miller watched it from his door. Nobody crossed the bridge after dark.\n\nThe mill burned down one dry summer.\n',
    steps: [
      LISTEN,
      { say: 'select the old bridge', id: 'selectPhrase', done: picked('the old bridge') },
      { say: 'select this sentence', id: 'selectUnit', done: picked('The river ran past the mill and under the old bridge.') },
      { say: 'select next sentence', id: 'selectUnit', done: spans('In spring', 'from his door') },
      { say: 'select the river', id: 'selectPhrase', look: 'dashboard', tip: 'It’s there twice', done: (c) => c.choosing && heard('selectPhrase')(c) },
      { do: 'number', text: 'Say “two”', want: 2, look: 'dashboard', done: pickedNth('the river', 2) },
      { say: 'select the river', id: 'selectPhrase', look: 'dashboard', done: (c) => c.choosing && heard('selectPhrase')(c) },
      { say: 'cancel', id: 'cancel', done: both(heard('cancel'), (c) => !c.choosing) },
      { say: 'select the miller through dark', id: 'selectRange', done: spans('the miller', 'after dark') },
      { say: 'select all', id: 'selectAll', done: spans('The river ran', 'dry summer') },
      { say: 'show numbers', id: 'showNumbers', tip: 'Each sentence gets one', done: (c) => !!c.numbers },
      { say: 'sentence three', id: 'pickUnit', done: picked('Nobody crossed the bridge after dark.') },
      { say: 'hide numbers', id: 'hideNumbers', done: (c) => !c.numbers && heard('hideNumbers')(c) },
      { say: 'go to the end', id: 'goEdge', done: both(heard('goEdge'), atEnd) },
      { say: 'it was never built again', done: has('It was never built again') },
      { say: 'select that', id: 'selectThat', tip: 'What you just said', done: picked('It was never built again.') },
    ],
  },
  {
    id: 'changing', title: 'Changing Words',
    text: '# Changing Words\n\nThe market was busy on Thursday. A farmer sold eggs from a wooden cart, and his dog slept under it.\n',
    steps: [
      LISTEN,
      { say: 'replace Thursday with Friday', id: 'replace', done: has('busy on Friday') },
      { say: 'insert brown before eggs', id: 'insert', done: has('sold brown eggs') },
      { say: 'insert every morning after cart', id: 'insert', done: has('wooden cart every morning,') },
      { say: 'delete wooden', id: 'deletePhrase', done: both(has('from a cart'), lacks('wooden')) },
      { say: 'select his dog', id: 'selectPhrase', done: picked('his dog') },
      { say: 'uppercase that', id: 'transform', done: has('HIS DOG') },
      { say: 'lowercase that', id: 'transform', done: both(heard('transform'), has('and his dog')) },
      { say: 'capitalize that', id: 'transform', done: has('His Dog') },
      { say: 'put that in quotes', id: 'quote', done: has('“His Dog”') },
      { say: 'scratch that', id: 'undo', done: both(heard('undo'), has('His Dog'), lacks('“His Dog”')) },
      { say: 'select every morning', id: 'selectPhrase', done: picked('every morning') },
      { say: 'move that after eggs', id: 'move', done: has('sold brown eggs every morning from a cart, and') },
    ],
  },
  {
    id: 'formatting', title: 'Formatting',
    text: '# Formatting\n\nBeans from the old kitchen\n\nSoak the beans overnight. Cook them slowly with onions and salt. Serve them hot with fresh bread.\n\ngarlic\npepper\nrosemary\n',
    steps: [
      LISTEN,
      { say: 'bold soak the beans', id: 'format', done: has('**Soak the beans**') },
      { say: 'italicize slowly', id: 'format', done: (c) => /[*_]slowly[*_]/u.test(c.text || '') },
      { say: 'highlight fresh bread', id: 'format', done: has('==fresh bread==') },
      { say: 'scratch that', id: 'undo', done: both(heard('undo'), lacks('==fresh bread==')) },
      { say: 'select overnight', id: 'selectPhrase', done: picked('overnight') },
      { say: 'bold that', id: 'makeFormat', done: has('**overnight**') },
      { say: 'select beans from the old kitchen', id: 'selectPhrase', done: picked('Beans from the old kitchen') },
      { say: 'make that a heading', id: 'heading', done: (c) => /^#{1,6} Beans from the old kitchen/mu.test(c.text || '') },
      { say: 'select garlic through rosemary', id: 'selectRange', done: spans('garlic', 'rosemary') },
      { say: 'make that a list', id: 'list', done: (c) => /^[-*+] garlic\n[-*+] pepper\n[-*+] rosemary/mu.test(c.text || '') },
    ],
  },
  {
    id: 'moving', title: 'Moving Around',
    text: '# Moving Around\n\n## Morning\n\nThe ferry left at dawn. Gulls followed it out of the harbor.\n\n## Evening\n\nBy evening the wind had turned.\n\nThe ferry came back empty.\n',
    steps: [
      LISTEN,
      { say: 'go to the end', id: 'goEdge', done: both(heard('goEdge'), atEnd) },
      { say: 'go to the top', id: 'goEdge', tip: 'Where the writing starts', done: both(heard('goEdge'), before('The ferry left')) },
      { say: 'go after gulls', id: 'goNear', done: after('gulls') },
      { say: 'and terns', tip: 'Typed where the cursor is', done: has('Gulls and terns followed it') },
      { say: 'go after had', id: 'goNear', done: after('wind had') },
      { say: 'finally', done: has('the wind had finally turned') },
      { say: 'go before empty', id: 'goNear', done: before('empty') },
      { say: 'almost', done: has('came back almost empty') },
      { say: 'scratch that', id: 'undo', done: both(heard('undo'), has('came back empty')) },
      { say: 'go to evening', id: 'goTo', tip: 'A heading', done: both(heard('goTo'), before('By evening')) },
      { say: 'next paragraph', id: 'step', done: inLine('The ferry came back') },
      { say: 'previous paragraph', id: 'step', done: both(heard('step'), inLine('By evening')) },
      { say: 'go to the end of the paragraph', id: 'goEdge', done: both(heard('goEdge'), after('finally turned.')) },
    ],
  },
  {
    id: 'words', title: 'Finding Words',
    text: '# Finding Words\n\nThe old house was quiet. Its garden was big, and its rooms were cold even in summer. A letter came from Abner every spring.\n',
    steps: [
      LISTEN,
      { say: 'synonyms for big', id: 'synonyms', look: 'dashboard', done: (c) => c.choosing && c.words === 'syn' },
      { do: 'number', text: 'Say a number from the list', want: 1, look: 'dashboard', done: lacks('garden was big') },
      { say: 'scratch that', id: 'undo', done: both(heard('undo'), has('garden was big')) },
      { say: 'select cold', id: 'selectPhrase', done: picked('cold') },
      { say: 'synonyms', id: 'synonyms', look: 'dashboard', tip: 'For what’s selected', done: (c) => c.choosing && c.words === 'syn' && heard('synonyms')(c) },
      { say: 'use two', id: 'use', look: 'dashboard', done: lacks('were cold') },
      { say: 'define quiet', id: 'define', look: 'dashboard', done: (c) => c.words === 'def' && heard('define')(c) },
      { say: 'select Abner', id: 'selectPhrase', tip: 'A name heard wrong', done: picked('Abner') },
      { say: 'spell a v n e r', id: 'spell', done: both(has('from Avner'), lacks('Abner')) },
      { say: 'word count', id: 'wordCount', look: 'strip', done: heard('wordCount') },
      { say: 'show words', id: 'panel', look: 'dashboard', done: heard('panel') },
    ],
  },
  {
    id: 'reading', title: 'Reading Aloud',
    text: '# Reading Aloud\n\nThe keeper wrote one line in his log every night. Most nights it said the same thing. Calm sea, no ships.\n\nOne night in March it said something else.\n',
    steps: [
      LISTEN,
      { say: 'go to the top', id: 'goEdge', done: both(heard('goEdge'), before('The keeper wrote')) },
      { say: 'read this paragraph', id: 'readUnit', tip: 'Each word lights up', done: (c) => c.reading || heard('readUnit')(c) },
      { say: 'stop reading', id: 'stopReading', when: 'reading', done: (c) => !c.reading },
      { say: 'read sentence two', id: 'readNumbered', done: (c) => c.reading || heard('readNumbered')(c) },
      { say: 'stop', id: 'stop', when: 'reading', tip: 'Only while it reads', done: (c) => !c.reading },
      { say: 'select calm sea', id: 'selectPhrase', done: picked('calm sea') },
      { say: 'read that back', id: 'readThat', done: (c) => c.reading || heard('readThat')(c) },
      { say: 'stop reading', id: 'stopReading', when: 'reading', done: (c) => !c.reading },
      { say: 'read from here', id: 'readFrom', done: (c) => c.reading || heard('readFrom')(c) },
      { say: 'stop reading', id: 'stopReading', when: 'reading', done: (c) => !c.reading },
    ],
  },
  {
    id: 'tricky', title: 'Commands or Words',
    text: '# Commands or Words\n\nChange came slowly to the village. The old road was paved, and a shop opened by the well.\n',
    steps: [
      LISTEN,
      { say: 'go to the end', id: 'goEdge', done: both(heard('goEdge'), atEnd) },
      { say: 'she said delete that and left', tip: 'A command inside a sentence is typed', done: has('She said delete that and left') },
      { say: 'select few were chosen', id: 'selectPhrase', tip: 'Not in the sheet, so it’s typed', done: has('Select few were chosen') },
      { say: 'change came to the well', id: 'replace', tip: 'This one is a command', done: has('Change the well slowly') },
      { say: 'scratch that', id: 'undo', done: both(heard('undo'), has('Change came slowly')) },
      { say: 'type change came to the well', id: 'type', tip: '“Type” makes it words', done: has('Change came to the well') },
      { say: 'go to the end', id: 'goEdge', done: both(heard('goEdge'), atEnd) },
      { say: 'type period', id: 'type', tip: 'The word, not the mark', done: (c) => /\bperiod\b/iu.test(c.text || '') },
      { say: 'period', id: 'punctuation', tip: 'On its own, the mark', done: both(heard('punctuation'), (c) => /period\.\s*$/iu.test(c.text || '')) },
      { say: 'the shop is still there', done: has('The shop is still there') },
      { say: 'build that', tip: 'Close enough to “bold that”', look: 'strip', done: has('**The shop is still there') },
      { say: 'scratch that', id: 'undo', done: both(heard('undo'), lacks('**')) },
    ],
  },
  {
    id: 'sheets', title: 'Sheets and the App',
    steps: [
      LISTEN,
      { say: 'new sheet', id: 'newSheet', practice: true, done: both(heard('newSheet'), (c) => c.text === '') },
      { say: 'a list of things to pack', done: has('A list of things to pack') },
      { say: 'new sheet', id: 'newSheet', practice: true, done: both(heard('newSheet'), (c) => c.text === '') },
      { say: 'a second sheet for the trip', done: has('A second sheet for the trip') },
      { say: 'previous sheet', id: 'stepSheet', done: has('A list of things to pack') },
      { say: 'next sheet', id: 'stepSheet', done: has('A second sheet for the trip') },
      { say: 'go back', id: 'back', done: both(heard('back'), has('A list of things to pack')) },
      { say: 'show sheets', id: 'showSheets', done: heard('showSheets') },
      { say: 'hide the dashboard', id: 'dashboard', done: (c) => !c.dashboard && heard('dashboard')(c) },
      { say: 'show the dashboard', id: 'dashboard', done: (c) => c.dashboard && heard('dashboard')(c) },
      { say: 'bigger text', id: 'zoom', done: heard('zoom') },
      { say: 'smaller text', id: 'zoom', done: heard('zoom') },
      { say: 'focus mode', id: 'focusMode', tip: 'Only the page', done: (c) => c.focus },
      { say: 'focus mode', id: 'focusMode', tip: 'And everything is back', done: (c) => !c.focus && heard('focusMode')(c) },
    ],
  },
  {
    id: 'revising', title: 'Revision Mode',
    text: '# Revision Mode\n\nThe letter came on a Tuesday. It was short and it was not signed.\n',
    steps: [
      LISTEN,
      { say: 'revision mode', id: 'revisionOn', tip: 'Changes are marked, not made', done: (c) => c.revision },
      { say: 'delete short and', id: 'deletePhrase', done: has('{--short and--}') },
      { say: 'insert two lines after letter', id: 'insert', done: has('{++') },
      { say: 'select not signed', id: 'selectPhrase', done: picked('not signed') },
      { say: 'comment who sent it', id: 'comment', done: has('{>>') },
      { say: 'reject all', id: 'acceptAll', tip: 'The comment stays', done: both(heard('acceptAll'), lacks('{--', '{++'), has('It was short and it was')) },
      { say: 'scratch that', id: 'undo', done: both(heard('undo'), has('{--short and--}')) },
      { say: 'accept all', id: 'acceptAll', done: both(heard('acceptAll'), lacks('{--', '{++', 'short and')) },
      { say: 'stop revising', id: 'revisionOff', done: (c) => !c.revision && heard('revisionOff')(c) },
    ],
  },
];

/** The commands the lessons leave out: they open something to finish by hand, or need what a practice sheet hasn't got. */
export const NOT_IN_LESSONS = ['micOff', 'language', 'open', 'scroll', 'translation', 'export', 'checkText', 'pickMark'];
