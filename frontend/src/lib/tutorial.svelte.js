// The voice tutorial (Help › Voice Tutorial, Settings › Voice): engine/src/tutorial.js has its
// steps, TutorialCard.svelte shows them, and this keeps its place and moves it on.
import { VOICE_LESSON, PRACTICE_STEP } from '@engine/tutorial.js';
import { app, prefs, store, select, persist } from './state.svelte.js';
import { trashSheets } from './actions.js';
import { voice } from '../voice/voice.svelte.js';

export const LESSON = VOICE_LESSON;
export const tutorial = $state({
  on: false,
  step: 0,           // LESSON's; LESSON.length at the end
  ticked: false,     // the step is done, and the next comes in a moment
  practice: null,    // the sheet made at "new sheet", which the end offers to trash
  since: 0,          // voice.count when the step began: only what's heard after it counts
});
let timer = null;

/** From the beginning: voice on, the Inbox (where the practice sheet goes), the first step. */
export function startTutorial() {
  app.settingsOpen = null;
  if (!prefs.voice.on) { prefs.voice.on = true; persist(); }
  select('Notes', { keepSheet: true });
  clearTimeout(timer);
  Object.assign(tutorial, { on: true, step: 0, ticked: false, practice: null, since: voice.count });
}

export function stopTutorial() { clearTimeout(timer); tutorial.on = false; }

/** The next step (Skip, or after a tick). */
export function nextStep() {
  clearTimeout(timer);
  tutorial.step = Math.min(tutorial.step + 1, LESSON.length);
  // a step for while it reads, once the reading is over: passed over
  while (LESSON[tutorial.step] && LESSON[tutorial.step].when === 'reading' && !voice.reading) tutorial.step++;
  tutorial.ticked = false;
  tutorial.since = voice.count;
}

const LISTENING = new Set(['listening', 'hearing', 'working']);
/** Asked whenever voice changes: is the step done? Then a tick, and the next step after a moment. */
export function checkStep() {
  const s = tutorial.on && !tutorial.ticked && LESSON[tutorial.step];
  if (!s) return;
  const c = { heard: null, listening: LISTENING.has(voice.mic), asleep: voice.asleep, reading: voice.reading, choosing: !!voice.choice };
  // what was heard since the step began, oldest first (two lines can land between looks)
  const fresh = voice.heard.slice(0, Math.max(0, Math.min(voice.count - tutorial.since, voice.heard.length))).reverse();
  const done = s.done(c) || fresh.some((heard) => s.done({ ...c, heard }));
  if (!done) return;
  if (tutorial.step === PRACTICE_STEP) tutorial.practice = app.sheet;
  tutorial.ticked = true;
  timer = setTimeout(nextStep, 900);
}

/** The end's Trash Practice Sheet. */
export function trashPractice() {
  const p = tutorial.practice;
  if (p && store && store.exists(p)) trashSheets([p]);
  tutorial.practice = null;
  stopTutorial();
}
