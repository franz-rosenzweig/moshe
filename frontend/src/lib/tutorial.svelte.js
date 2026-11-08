// The voice tutorial (Help › Voice Tutorial, Settings › Voice): engine/src/tutorial.js has its
// lessons, TutorialCard.svelte shows them, and this keeps the place and moves it on.
import { LESSONS } from '@engine/tutorial.js';
import { app, prefs, store, select, persist } from './state.svelte.js';
import { newSheet, trashSheets } from './actions.js';
import { voice, sheetNow } from '../voice/voice.svelte.js';

export { LESSONS };
export const tutorial = $state({
  on: false,
  lesson: null,      // the lesson's id; null: the list of lessons
  step: 0,           // the lesson's; its length at the end
  ticked: false,     // the step is done, and the next comes in a moment
  miss: false,       // something was said in the step, and it isn't done
  practice: [],      // the practice sheets made, which the end of a lesson offers to trash
  since: 0,          // voice.count when the step began: only what's heard after it counts
});
let timer = null;

export const lessonOf = (id) => LESSONS.find((l) => l.id === id) || null;
const LISTENING = new Set(['listening', 'hearing', 'working']);
const listening = () => LISTENING.has(voice.mic) && !voice.asleep;

/** The list of lessons: voice on, and the Inbox (where practice sheets go). */
export function startTutorial() {
  app.settingsOpen = null;
  if (!prefs.voice.on) { prefs.voice.on = true; persist(); }
  clearTimeout(timer);
  Object.assign(tutorial, { on: true, lesson: null, step: 0, ticked: false, miss: false });
}

export function stopTutorial() { clearTimeout(timer); tutorial.on = false; }

/** A lesson from its first step, on a practice sheet of its own when it has one. */
export function startLesson(id) {
  const l = lessonOf(id);
  if (!l) return;
  clearTimeout(timer);
  select('Notes', { keepSheet: true });
  if (l.text) { const p = newSheet({ text: l.text }); if (p) tutorial.practice = [...tutorial.practice, p]; }
  Object.assign(tutorial, { on: true, lesson: id, step: -1 });
  nextStep();
}

/** The lessons, with those done. */
export function lessonList() {
  const done = new Set(prefs.lessonsDone || []);
  return LESSONS.map((l) => ({ id: l.id, title: l.title, count: l.steps.filter((s) => s.do !== 'listen').length, done: done.has(l.id) }));
}

/** The next step (Skip, or after a tick); a step that has nothing to do now is passed over. What was said
 *  from `since` on counts for it: after a tick, what's said in the moment before the next step shows. */
export function nextStep(since = voice.count) {
  clearTimeout(timer);
  const l = lessonOf(tutorial.lesson);
  if (!l) return;
  let i = Math.min(tutorial.step + 1, l.steps.length);
  for (; l.steps[i]; i++) {
    const s = l.steps[i];
    if (s.do === 'listen' && listening()) continue;                  // already listening
    if (s.when === 'reading' && !voice.reading) continue;            // the reading is over
    break;
  }
  Object.assign(tutorial, { step: i, ticked: false, miss: false, since });
  if (i >= l.steps.length && !(prefs.lessonsDone || []).includes(l.id)) { prefs.lessonsDone = [...(prefs.lessonsDone || []), l.id]; persist(); }
}

/** What a step is asked about: what's going on, and the sheet. */
function context() {
  const now = sheetNow();
  return {
    heard: null, listening: LISTENING.has(voice.mic), asleep: voice.asleep, reading: voice.reading, choosing: !!voice.choice,
    words: (voice.words && voice.words.kind) || null, text: now ? now.text : null, from: now ? now.from : 0, to: now ? now.to : 0,
    sel: now ? now.text.slice(now.from, now.to) : '', numbers: now ? now.numbers : null,
    revision: !!app.revision, dashboard: !!app.dashboard, focus: !!app.interfaceHidden, sheet: app.sheet,
  };
}

/** Asked whenever voice or the sheet changes: is the step done? Then a tick, and the next step after a moment. */
export function checkStep() {
  const l = tutorial.on && !tutorial.ticked && lessonOf(tutorial.lesson);
  const s = l && l.steps[tutorial.step];
  if (!s) return;
  const c = context();
  // what was heard since the step began, oldest first (two lines can land between looks)
  const fresh = voice.heard.slice(0, Math.max(0, Math.min(voice.count - tutorial.since, voice.heard.length))).reverse();
  const done = s.done(c) || fresh.some((heard) => s.done({ ...c, heard }));
  if (!done) {
    if (s.do !== 'listen' && fresh.some((h) => h.kind !== 'ignored' || s.when === 'asleep')) tutorial.miss = true;
    return;
  }
  if (s.practice && app.sheet && !tutorial.practice.includes(app.sheet)) tutorial.practice = [...tutorial.practice, app.sheet];
  tutorial.ticked = true;
  tutorial.miss = false;
  const at = voice.count;
  timer = setTimeout(() => nextStep(at), 900);
}

/** The practice sheets still there. */
export const practiceLeft = () => tutorial.practice.filter((p) => store && store.exists(p));

/** Trash Practice Sheets. */
export function trashPractice() {
  const left = practiceLeft();
  if (left.length) trashSheets(left);
  tutorial.practice = [];
}

// for self-tests (tools/lessons-e2e.mjs): where the tutorial is, and a lesson started
if (typeof window !== 'undefined') {
  window.__mosheTutorial = {
    lessons: () => LESSONS.map((l) => ({ id: l.id, title: l.title, steps: l.steps.length })),
    start: (id) => { startTutorial(); startLesson(id); return true; },
    stop: () => { stopTutorial(); return true; },
    context: () => { const c = context(); return { ...c, fresh: voice.heard.slice(0, Math.max(0, Math.min(voice.count - tutorial.since, voice.heard.length))).map((h) => ({ kind: h.kind, id: h.id, said: h.said })) }; },
    state: () => {
      const l = lessonOf(tutorial.lesson), s = l && l.steps[tutorial.step];
      return { on: tutorial.on, lesson: tutorial.lesson, step: tutorial.step, of: l ? l.steps.length : 0, ticked: tutorial.ticked, miss: tutorial.miss,
        practice: practiceLeft(), card: s ? { say: s.say || null, do: s.do || null, text: s.text || null, want: s.want ?? null, when: s.when || null, id: s.id || null } : null };
    },
  };
}
