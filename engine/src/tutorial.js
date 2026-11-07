// The voice tutorial (Help › Voice Tutorial, Settings › Voice): one step at a time, what to
// say, and Moshe moves on when it sees it done. Its lines are the voice sheet's "Try it" list
// (welcome.js) and a few more from docs/voice-guide.md.
//
// A step's done(c) is asked as things change, with
//   c.heard      the newest line heard since the step began ({kind: text | command | fail | ignored, id}), or null
//   c.listening  the microphone is on; c.asleep, c.reading, c.choosing as voice has them
// A step with `say` shows that line; one with `do` shows its `text`. `id` is the command the
// line is (none: it's typed), which the tests hold it to. `look` is where on screen it shows.

const said = (id) => (c) => !!c.heard && c.heard.kind === 'command' && c.heard.id === id;
const typed = (c) => !!c.heard && c.heard.kind === 'text';

export const VOICE_LESSON = [
  { do: 'listen', text: 'Start listening', look: 'mic', done: (c) => c.listening && !c.asleep },
  { say: 'new sheet', id: 'newSheet', look: 'strip', done: said('newSheet') },
  { say: 'the frost came early that year', look: 'strip', done: typed },
  { say: 'she said delete that and left', look: 'strip', done: typed },
  { say: 'delete that', id: 'deleteThat', look: 'strip', done: said('deleteThat') },
  { say: 'replace early with late', id: 'replace', look: 'strip', done: said('replace') },
  { say: 'bold the frost', id: 'format', done: said('format') },
  { say: 'scratch that', id: 'undo', done: said('undo') },
  { say: 'synonyms for late', id: 'synonyms', look: 'dashboard', done: said('synonyms') },
  { do: 'number', text: 'Say a number from the list', look: 'dashboard', done: said('choice') },
  { say: 'read this paragraph', id: 'readUnit', done: said('readUnit') },
  // done when the reading stops, said or not; passed over when it has already finished
  // ("stop reading", not "stop": said after it's done, "stop" is typed)
  { say: 'stop reading', id: 'stopReading', when: 'reading', done: (c) => !c.reading },
  { say: 'go to sleep', id: 'sleep', look: 'mic', done: said('sleep') },
  { say: 'wake up', id: 'wake', when: 'asleep', look: 'mic', done: said('wake') },
  { say: 'what can I say', id: 'help', look: 'dashboard', done: said('help') },
];

/** The first step of the lesson that is the new sheet: the practice sheet, which the end offers to trash. */
export const PRACTICE_STEP = VOICE_LESSON.findIndex((s) => s.id === 'newSheet');
