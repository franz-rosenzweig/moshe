// Voice: what the writer says, read either as words to type or as a command to
// carry out (docs/VOICE.md). A command counts only when it is the whole
// utterance, from one pause to the next; anything else is text. This is the
// part that needs neither a microphone nor an editor: the parser, cleaning up
// and placing dictation, and finding what the writer names in a sheet (a
// phrase, a sentence, a heading, a mark), so the page and the tests share it.

import { parseLines, parseInline } from './markup.js';

// ---- numbers, as recognizers write them: "2", "two", and "to", "too", "for", "won" by their sound

export const NUMBER_WORDS = {
  one: 1, won: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};
const NUM = `(\\d{1,3}|${Object.keys(NUMBER_WORDS).join('|')})`;
/** A number said as digits or as a word; NaN for anything else. */
export const numberOf = (s) => (/^\d+$/u.test(s) ? Number(s) : NUMBER_WORDS[String(s).toLowerCase()] ?? NaN);

// ---- what was said, made comparable

const FILLER_START = /^(?:(?:u+m+|u+h+|e+r+m*|hmm+|mm+)[,.…]*\s+)+/iu;
/** The utterance as the parser reads it: quotes, a filler at the start and the closing full stop gone. */
export function lite(said) {
  return String(said || '').replace(/[“”"«»]/gu, '').replace(/[‘’]/gu, "'").replace(/\s+/gu, ' ').trim()
    .replace(FILLER_START, '').replace(/^[,.;:…\s]+|[,.;:!?…\s]+$/gu, '');
}

// ---- the commands: one table for the parser, the Voice panel's suggestions and docs/VOICE.md

const R = (s) => new RegExp(`^(?:${s})$`, 'iu');
const THAT = '(?:that|it|this)';

/**
 * @typedef {{id: string, group: string, say: string, example: string, does: string, re: RegExp,
 *            when?: string, whyNot?: string, app?: string, hidden?: boolean}} Command
 * `when` names what must be going on for the command to count (else it's text, and `whyNot` says why);
 * `app` names the page's own command (window.mosheCommand) it stands for.
 * @type {Command[]}
 */
export const COMMANDS = [
  // Listening
  { id: 'sleep', group: 'Listening', say: 'go to sleep', example: 'go to sleep', does: 'Stops listening. Only “wake up” works until then.', re: R('go to sleep|stop listening|mic(?:rophone)? off') },
  { id: 'wake', group: 'Listening', say: 'wake up', example: 'wake up', does: 'Listens again.', re: R('wake up|start listening') },
  { id: 'type', group: 'Listening', say: 'type ‹words›', example: 'type delete that', does: 'Types the words, even when they sound like a command.', re: R('(?:type|literally) (.+)') },
  { id: 'language', group: 'Listening', say: 'switch to Hebrew · English', example: 'switch to Hebrew', does: 'Changes the language of dictation.', re: R('(?:switch to |dictate in )?(hebrew|english)|(עברית|אנגלית)') },
  // Writing
  { id: 'newParagraph', group: 'Writing', say: 'new paragraph', example: 'new paragraph', does: 'Starts a paragraph.', re: R('new paragraph|new line|next line') },
  { id: 'punctuation', group: 'Writing', say: 'period · comma · question mark', example: 'question mark', does: 'Puts that mark at the cursor.', re: R('(period|full stop|comma|question mark|exclamation (?:point|mark)|colon|semicolon)') },
  { id: 'undo', group: 'Writing', say: 'scratch that · undo', example: 'scratch that', does: 'Takes back the last thing, said or done.', re: R('scratch that|undo(?: that)?|take that back') },
  { id: 'redo', group: 'Writing', say: 'redo', example: 'redo', does: 'Puts it back.', re: R('redo(?: that)?') },
  // Choosing
  { id: 'selectThat', group: 'Choosing', say: 'select that', example: 'select that', does: 'Selects what was just said.', re: R(`select ${THAT}`) },
  { id: 'selectAll', group: 'Choosing', say: 'select all', example: 'select all', does: 'Selects the whole sheet.', re: R('select (?:all|everything)') },
  { id: 'selectUnit', group: 'Choosing', say: 'select this · next · last sentence', example: 'select this sentence', does: 'Also “paragraph” and “word”.', re: R('select (?:the )?(this|current|next|last|previous) (sentence|paragraph|word)') },
  { id: 'selectRange', group: 'Choosing', say: 'select ‹words› through ‹words›', example: 'select she did through stones', does: 'From the first words to the second.', re: R('select (?:from )?(.+?) (?:through|thru|until) (.+)') },
  { id: 'selectPhrase', group: 'Choosing', say: 'select ‹words›', example: 'select the water tower', does: 'Selects them. If they appear more than once, each gets a number.', re: R('select (.+)') },
  { id: 'showNumbers', group: 'Choosing', say: 'show numbers', example: 'show numbers', does: 'A number on every sentence; “show paragraph numbers” for paragraphs.', re: R('show (sentence |paragraph )?numbers|number (?:the )?(sentences|paragraphs)') },
  { id: 'hideNumbers', group: 'Choosing', say: 'hide numbers', example: 'hide numbers', does: 'Takes them away.', re: R('hide (?:the )?numbers') },
  { id: 'pickUnit', group: 'Choosing', say: 'sentence ‹n› · paragraph ‹n›', example: 'sentence 4', does: 'Selects it.', re: R(`(sentence|paragraph) ${NUM}`) },
  { id: 'cancel', group: 'Choosing', say: 'cancel', example: 'cancel', does: 'Drops the selection, the numbers and any list.', re: R('cancel|never ?mind|unselect|deselect|clear (?:the )?selection') },
  // Moving
  { id: 'goEdge', group: 'Moving', say: 'go to the end · top', example: 'go to the end', does: 'Of the sheet; also “end of paragraph”.', re: R('go to (?:the )?(end|bottom|top|start|beginning)(?: of (?:the |this )?(sheet|chapter|text|document|paragraph|sentence))?') },
  { id: 'step', group: 'Moving', say: 'next · previous paragraph', example: 'next paragraph', does: 'Also “sentence”.', re: R('(?:go to (?:the )?)?(next|previous) (paragraph|sentence)') },
  { id: 'goNear', group: 'Moving', say: 'go after ‹words› · go before ‹words›', example: 'go after the trees', does: 'Puts the cursor there.', re: R('(?:go|move|cursor) (after|before) (.+)') },
  { id: 'goTo', group: 'Moving', say: 'go to ‹heading or sheet›', example: 'go to the kitchen', does: 'Moves to that heading, or opens that sheet; typed as text if there is none.', re: R('go to (?!mark )(.+)') },
  { id: 'open', group: 'Moving', say: 'open ‹sheet›', example: 'open frost', does: 'Opens a sheet of the group by its title or number; typed as text if there is none.', re: R('open (?:the )?(?:sheet )?(.+)') },
  { id: 'showSheets', group: 'Moving', say: 'show sheets', example: 'show sheets', does: 'Numbers the group’s sheets; then a number opens one.', re: R('(?:show|list) (?:the )?sheets') },
  { id: 'stepSheet', group: 'Moving', say: 'next sheet · previous sheet', example: 'next sheet', does: 'The one beside it in the list.', re: R('(next|previous) sheet') },
  { id: 'newSheet', group: 'Moving', say: 'new sheet', example: 'new sheet', does: 'A new, empty sheet.', re: R('new sheet'), app: 'newSheet' },
  { id: 'scroll', group: 'Moving', say: 'scroll down · up', example: 'scroll down', does: 'A screen at a time.', re: R('scroll (down|up)') },
  { id: 'zoom', group: 'Moving', say: 'bigger text · smaller text', example: 'bigger text', does: 'The text’s size.', re: R('(bigger|smaller|larger) text|zoom (in|out)') },
  // Editing
  { id: 'deleteThat', group: 'Editing', say: 'delete that', example: 'delete that', does: 'What is selected, or what was just said. In Revision Mode it’s marked instead.', re: R(`delete ${THAT}`) },
  { id: 'deleteLast', group: 'Editing', say: 'delete last word · last sentence', example: 'delete last word', does: 'Before the cursor.', re: R('delete (?:the )?(?:last|previous) (word|sentence)') },
  { id: 'deletePhrase', group: 'Editing', say: 'delete ‹words› · strike ‹words›', example: 'strike already', does: '“strike” always marks them for deletion, as the pen does.', re: R('(delete|strike|cross out|remove) (.+)') },
  { id: 'replace', group: 'Editing', say: 'replace ‹words› with ‹words›', example: 'replace slanting with careful', does: 'In Revision Mode it’s kept as a change.', re: R('(?:replace|change) (.+?) (?:with|to|into) (.+)') },
  { id: 'insert', group: 'Editing', say: 'insert ‹words› after ‹words›', example: 'insert still after was', does: 'Also “before”. An insertion mark in Revision Mode.', re: R('(?:insert|add) (.+?) (after|before) (.+)') },
  { id: 'format', group: 'Editing', say: 'bold · italicize · highlight that', example: 'highlight that', does: 'Also “bold ‹words›”, “mark ‹words›”.', re: R('(bold|italicize|italic|emphasize|highlight|mark) (.+)') },
  { id: 'makeFormat', group: 'Editing', say: 'make that bold · italic · highlighted', example: 'make that bold', does: 'The same, in words recognizers hear better.', re: R(`make ${THAT} (bold|italic|italics|highlighted)`) },
  { id: 'heading', group: 'Editing', say: 'make that a heading', example: 'make that a heading', does: 'The paragraph at the cursor; also “subheading”.', re: R(`(?:make ${THAT} (?:a )?)?(heading|subheading)`) },
  { id: 'move', group: 'Editing', say: 'move that after ‹words›', example: 'move that to the end', does: 'Also “before ‹words›” and “to the end”.', re: R(`move ${THAT} (?:(after|before) (.+)|to the (end|start|top))`) },
  { id: 'comment', group: 'Editing', say: 'comment ‹words›', example: 'comment who lit it?', does: 'A note on the selection, or on the sentence at the cursor.', re: R('(?:add (?:a )?)?comment (.+)') },
  // Revision
  { id: 'revisionOn', group: 'Revision', say: 'revision mode', example: 'revision mode', does: 'Deletions become marks; dictation goes in as insertions.', re: R('(?:turn on |start )?revision mode(?: on)?|start revising'), app: 'revision' },
  { id: 'revisionOff', group: 'Revision', say: 'stop revising', example: 'stop revising', does: 'Back to writing.', re: R('revision mode off|stop revising|leave revision mode|turn off revision mode'), app: 'revision' },
  { id: 'acceptAll', group: 'Revision', say: 'accept all · reject all', example: 'accept all', does: 'Every insertion, deletion and change in the sheet.', re: R('(accept|reject) all(?: changes| marks)?') },
  { id: 'pickMark', group: 'Revision', say: 'mark ‹n›', example: 'mark 1', does: 'Selects that mark, in the order the Annotations view lists them.', re: R(`(?:go to )?mark ${NUM}`) },
  // Words
  { id: 'synonyms', group: 'Words', say: 'synonyms (for ‹word›)', example: 'synonyms for cold', does: 'Numbered, in the dashboard; then “use 4”.', re: R('(?:synonyms|thesaurus|other words|another word)(?: for (.+))?|thesaurus (.+)') },
  { id: 'define', group: 'Words', say: 'define ‹word›', example: 'define orchard', does: 'The definition, in the dashboard.', re: R('(?:define|look up|definition of|meaning of) (.+)|what does (.+) mean|define|definition') },
  { id: 'correct', group: 'Words', say: 'correct ‹word›', example: 'correct cold', does: 'Words that sound like it, numbered.', re: R('correct (.+)') },
  { id: 'spell', group: 'Words', say: 'spell ‹letters›', example: 'spell a v n e r', does: 'Spells out the word being corrected, or the selection.', re: R('spell (?:that |it )?([a-z](?:[\\s.,-]*[a-z])*)') },
  { id: 'use', group: 'Words', say: 'use ‹n›', example: 'use 4', does: 'Picks from the numbered list; the number alone does too.', re: R(`use ${NUM}`), hidden: true },
  // Reading
  { id: 'readThat', group: 'Reading', say: 'read that back', example: 'read that back', does: 'What is selected, or what was just said.', re: R(`read ${THAT}(?: back)?|read back`) },
  { id: 'readUnit', group: 'Reading', say: 'read this paragraph · this sentence', example: 'read this paragraph', does: 'Lighting each word as it goes.', re: R('read (?:this|the) (paragraph|sentence)') },
  { id: 'readNumbered', group: 'Reading', say: 'read sentence ‹n›', example: 'read sentence 2', does: 'Also “paragraph ‹n›”.', re: R(`read (sentence|paragraph) ${NUM}`) },
  { id: 'readFrom', group: 'Reading', say: 'read from here', example: 'read from here', does: 'To the end of the sheet.', re: R('read (?:from here|on|to the end)') },
  { id: 'stopReading', group: 'Reading', say: 'stop reading', example: 'stop reading', does: 'Stops it.', re: R('stop reading') },
  { id: 'stop', group: 'Reading', say: 'stop', example: 'stop', does: 'Only while it is reading; otherwise it’s a word.', re: R('stop|quiet'), when: 'reading', whyNot: 'Nothing was being read, so “stop” was typed.' },
  { id: 'wordCount', group: 'Reading', say: 'word count', example: 'word count', does: 'How many words the sheet has.', re: R('word count|how many words|count (?:the )?words') },
  // The app
  { id: 'help', group: 'App', say: 'what can I say', example: 'what can I say', does: 'Suggestions for the moment, in the dashboard.', re: R('what can i say|show (?:the )?commands|help|commands') },
  { id: 'dashboard', group: 'App', say: 'show · hide the dashboard', example: 'hide the dashboard', does: 'The pane on the right.', re: R('(show|hide|close|open) (?:the )?dashboard') },
  { id: 'panel', group: 'App', say: 'show words · voice · annotations · outline', example: 'show annotations', does: 'That view of the dashboard.', re: R('show (?:the )?(words|voice|heard|marks|annotations|outline|overview|progress)') },
  { id: 'focusMode', group: 'App', say: 'focus mode', example: 'focus mode', does: 'Only the page; again, and everything is back.', re: R('focus mode|hide (?:the )?interface|show (?:the )?interface'), app: 'hideInterface' },
  { id: 'back', group: 'App', say: 'go back · go forward', example: 'go back', does: 'The sheets visited before and after.', re: R('go (back|forward)') },
  { id: 'export', group: 'App', say: 'export', example: 'export', does: 'The Export window, for the open sheet.', re: R('export(?: (?:this|the) sheet)?'), app: 'export' },
  { id: 'translation', group: 'App', say: 'translation mode', example: 'translation mode', does: 'The sheet and its translation side by side.', re: R('translation mode'), app: 'translation' },
  { id: 'checkText', group: 'App', say: 'check text', example: 'check text', does: 'LanguageTool, when the server has it.', re: R('check (?:the )?text'), app: 'checkText' },
];

/** The commands' own words, for a recognizer that takes custom words: short commands ("highlight that")
 *  are what dictation mishears most, as something it expects more ("I like that"). */
export function commandPhrases() {
  const out = new Set(['bold that', 'italicize that', 'highlight that', 'show paragraph numbers']);
  for (const c of COMMANDS) {
    if (c.hidden) continue;
    for (const part of [...c.say.replace(/\([^)]*\)/gu, '').split(' · '), c.example]) {
      const p = part.replace(/‹[^›]*›/gu, '').replace(/\s+/gu, ' ').trim().toLowerCase();
      // only what is a command as it stands, and not one that takes any words ("select ‹words›")
      const hit = p.includes(' ') && parse(p, { reading: true });
      if (hit && hit.kind === 'command' && !hit.command.re.source.includes('(.+')) out.add(p);
    }
  }
  return [...out];
}

let phrases = null;
/** The command a short utterance sounds like, when it isn't one (“build that”: “bold that”), for the strip to
 *  say so. Never carried out: “I like that” may be meant. */
export function soundsLike(said) {
  const l = lite(said).toLowerCase(), letters = (s) => s.replace(/[^a-z]/gu, ''), w = letters(l);
  if (l.split(' ').length > 4 || w.length < 4) return '';
  phrases ||= commandPhrases();
  let best = '', far = Infinity;
  for (const p of phrases) { const d = distance(w, letters(p)); if (d < far) { far = d; best = p; } }
  return far > 0 && far / Math.max(w.length, letters(best).length) <= 0.35 ? best : '';
}

// the exact phrases are tried before those that take any words ("open the dashboard" before "open ‹sheet›")
const ORDERED = [...COMMANDS.filter((c) => !c.re.source.includes('(.+')), ...COMMANDS.filter((c) => c.re.source.includes('(.+'))];

/** The words a command was given, as they were said: with their case and closing punctuation. */
export function fromSaid(said, words) {
  const s = String(said || '').replace(/[‘’]/gu, "'"), w = String(words || '');
  const at = w ? s.toLowerCase().lastIndexOf(w.toLowerCase()) : -1;
  return at < 0 ? w : s.slice(at).replace(/["”»\s]+$/u, '').trim();
}

/** The words of a command, said inside a sentence: the strip says why that was typed. */
const COMMANDY = /\b(delete that|scratch that|undo that|select that|new paragraph|go to sleep|bold that|read that back|wake up)\b/iu;
const WAKE = R('wake up|start listening');
const CHOICE = new RegExp(`^(?:number |use |pick |choose |take |option |the )?${NUM}(?: please)?$`, 'iu');

/**
 * What an utterance is.
 * @param {string} said  as the recognizer wrote it
 * @param {{asleep?: boolean, choosing?: boolean, reading?: boolean}} ctx  what is going on
 * @returns {{kind: 'empty'} | {kind: 'ignored'} | {kind: 'choice', n: number}
 *         | {kind: 'command', id: string, groups: string[], command: Command}
 *         | {kind: 'text', text: string, why: string}}
 */
export function parse(said, ctx = {}) {
  const l = lite(said);
  if (!/[\p{L}\p{N}]/u.test(l)) return { kind: 'empty' };
  if (ctx.asleep) return WAKE.test(l) ? { kind: 'command', id: 'wake', groups: [], command: COMMANDS.find((c) => c.id === 'wake') } : { kind: 'ignored' };
  if (ctx.choosing) { const m = CHOICE.exec(l); if (m) return { kind: 'choice', n: numberOf(m[1]) }; }
  let why = '';
  for (const c of ORDERED) {
    const m = c.re.exec(l);
    if (!m) continue;
    if (c.when && !ctx[c.when]) { why = c.whyNot || why; continue; }
    return { kind: 'command', id: c.id, groups: m.slice(1).map((g) => g ?? ''), command: c };
  }
  const hit = !why && COMMANDY.exec(l);
  return { kind: 'text', text: String(said).trim(), why: why || (hit ? `“${hit[1].toLowerCase()}” was inside a sentence, and a command has to stand alone.` : '') };
}

// ---- dictation: cleaned up, then placed

const FILLERS = /(^|\s)(?:u+m+|u+h+|e+r+m*|hmm+|mm+)(?:[,.…]+)?(?=\s|$)/giu;
const SPOKEN = [[/\s*\bcomma\b/giu, ','], [/\s*\b(?:period|full stop)\b/giu, '.'], [/\s*\bquestion mark\b/giu, '?'],
  [/\s*\bexclamation (?:point|mark)\b/giu, '!'], [/\s*\bsemicolon\b/giu, ';'], [/\s*\bcolon\b/giu, ':']];
/** What a recognizer wrote, tidied: fillers out, spoken punctuation in. Never a word changed. */
export function cleanDictation(said, { lang = 'en' } = {}) {
  let t = String(said || '').replace(/\s+/gu, ' ').trim(), fillers = 0;
  t = t.replace(FILLERS, (m, p) => { fillers++; return p; }).replace(/\s{2,}/gu, ' ').replace(/^[,.\s]+/u, '').trim();
  if (lang === 'en') for (const [re, p] of SPOKEN) t = t.replace(re, p);
  return { text: t, fillers };
}

const ENDS = /[.!?…]["”’)_*=}\]]*$/u;
const KEEP_CAPITAL = /^(?:I|I'm|I've|I'll|I'd|OK)$/u;
/**
 * Where dictated words go, and how: a space either side as needed, a capital at the start
 * of a sentence (and not in its middle, where recognizers put one anyway), the closing
 * full stop dropped when the sentence goes on or one is already there, one added to a
 * finished sentence at the end of a paragraph.
 * @param {string} text  the sheet
 * @param {number} from @param {number} to  the place (a selection is replaced)
 * @param {string} words  cleaned dictation
 * @param {{lang?: string, names?: string[], stop?: boolean}} [opts]
 * @returns {{from: number, to: number, insert: string, start: number, end: number}}  start–end: the words themselves
 */
export function placeDictation(text, from, to, words, { lang = 'en', names = [], stop = true } = {}) {
  let t = String(words || '').trim();
  const prev = text.slice(0, from), next = text.slice(to);
  const lineStart = prev === '' || prev.endsWith('\n');
  const before = prev.replace(/[ \t]+$/u, '');
  const sentenceStart = lineStart || before.endsWith('\n') || ENDS.test(before);
  const ahead = next.replace(/^[ \t]+/u, '');
  const latin = lang === 'en';
  if (latin && t) {
    const first = t.split(/\s/u)[0].replace(/[^\p{L}'’]/gu, '');
    if (sentenceStart) t = t[0].toUpperCase() + t.slice(1);
    else if (/^\p{Lu}\p{Ll}/u.test(first) && !KEEP_CAPITAL.test(first) && !names.some((n) => n.toLowerCase() === first.toLowerCase())) t = t[0].toLowerCase() + t.slice(1);
  }
  if (/^[.,;:!?…]/u.test(ahead) || /^\p{Ll}/u.test(ahead)) t = t.replace(/[.!?…]+$/u, '');   // the sentence goes on, or has its stop
  else if (latin && stop && (ahead === '' || ahead.startsWith('\n')) && !/[.!?…:;,"”)]$/u.test(t) && t.split(/\s+/u).length >= 3) t += '.';
  const lead = !lineStart && !/[\s([{“"‘'-]$/u.test(prev) && !/^[,.;:!?…)\]]/u.test(t) ? ' ' : '';
  const trail = /^[\p{L}\p{N}“"(]/u.test(next) ? ' ' : '';
  const insert = lead + t + trail;
  return { from, to, insert, start: from + lead.length, end: from + lead.length + t.length };
}

// ---- finding what the writer names

/** Every place `phrase` is said in text[from, to): its words in order, with anything but letters
 *  between them (punctuation, markup's tags), never inside a longer word. */
export function phraseRanges(text, phrase, from = 0, to = text.length) {
  const toks = String(phrase || '').toLowerCase().replace(/[‘’]/gu, "'").match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu);
  if (!toks) return [];
  const body = toks.map((t) => t.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/'/gu, "['’]")).join('[^\\p{L}\\p{N}\\n]+');
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'giu');
  const out = [], hay = text.slice(from, to);
  let m;
  while ((m = re.exec(hay))) out.push([from + m.index, from + m.index + m[0].length]);
  return out;
}
/** The range closest to `pos`. */
export const nearest = (ranges, pos) => ranges.reduce((best, r) => (!best || Math.abs(r[0] - pos) < Math.abs(best[0] - pos) ? r : best), null);

const PROSE = new Set(['paragraph', 'list', 'quote']);
/** The lines that are prose (paragraphs, list items, quotes), as their text's range. */
export function proseLines(text) {
  return parseLines(text).filter((L) => PROSE.has(L.type) && L.content[1] > L.content[0] && text.slice(L.content[0], L.content[1]).trim())
    .map((L) => [L.content[0], L.content[1]]);
}

/** A line's sentences: they end at . ! ? … and the closing marks after, never inside a comment or a footnote. */
function lineSentences(text, a, b) {
  const out = [];
  let start = a, i = a, depth = 0;
  while (i < b) {
    if (text.startsWith('{>>', i) || text.startsWith('^[', i)) { depth++; i += text[i] === '{' ? 3 : 2; continue; }
    if (depth && (text.startsWith('<<}', i) || text[i] === ']')) { depth--; i += text[i] === '<' ? 3 : 1; continue; }
    if (!depth && /[.!?…]/u.test(text[i])) {
      let j = i + 1;
      while (j < b && /[.!?…"”’)_*=}\]]/u.test(text[j])) j++;
      if (j >= b || text[j] === ' ') { out.push([start, j]); i = j; while (i < b && text[i] === ' ') i++; start = i; continue; }
      i = j;
      continue;
    }
    i++;
  }
  if (start < b && text.slice(start, b).trim()) out.push([start, b]);
  return out;
}
/** Every sentence of the prose, in order. */
export const sentenceRanges = (text) => proseLines(text).flatMap(([a, b]) => lineSentences(text, a, b));

const WORD = /[\p{L}\p{N}\p{M}][\p{L}\p{N}\p{M}'’-]*/gu;
/** The word at `pos`, or the last one before it. */
export function wordAt(text, pos) {
  let best = null;
  WORD.lastIndex = 0;
  for (let m; (m = WORD.exec(text));) {
    const r = [m.index, m.index + m[0].length];
    if (r[0] <= pos && pos <= r[1]) return r;
    if (r[1] <= pos) best = r; else break;
  }
  return best;
}

/** The headings: where each is, and its words. */
export const headingsOf = (text) => parseLines(text).filter((L) => L.type === 'heading')
  .map((L) => ({ from: L.from, to: L.to, title: text.slice(L.content[0], L.content[1]).trim() }));

const MARKS = { annotation: 'Comment', delete: 'Deletion', insert: 'Insertion', subst: 'Change', mark: 'Highlight', comment: 'Note' };
/** The writer's marks, in order: what Revision Mode lists. */
export function marksOf(text) {
  const out = [];
  for (const L of parseLines(text)) {
    if (L.type === 'comment') { out.push({ kind: 'Note', from: L.from, to: L.to, text: text.slice(L.content[0], L.content[1]).trim() }); continue; }
    const walk = (nodes) => {
      for (const n of nodes) {
        if (!MARKS[n.type]) { if (n.children) walk(n.children); continue; }
        const said = n.type === 'subst' ? `${text.slice(...n.data.old)} → ${text.slice(...n.data.new)}`
          : n.type === 'annotation' ? `${text.slice(...n.data.note)} · ${text.slice(...n.inner)}` : text.slice(...n.inner);
        out.push({ kind: MARKS[n.type], from: n.from, to: n.to, text: said });
      }
    };
    walk(L.inline || []);
  }
  return out;
}

/** Every insertion, deletion and change settled, as changes to the text: taken in (accept) or dropped.
 *  A mark that goes takes a space with it, so two don't meet. */
export function settleChanges(text, accept) {
  const out = [];
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.type === 'insert') out.push({ from: n.from, to: n.to, insert: accept ? text.slice(...n.inner) : '' });
      else if (n.type === 'delete') out.push({ from: n.from, to: n.to, insert: accept ? '' : text.slice(...n.inner) });
      else if (n.type === 'subst') out.push({ from: n.from, to: n.to, insert: text.slice(...(accept ? n.data.new : n.data.old)) });
      else if (n.children) walk(n.children);
    }
  };
  for (const L of parseLines(text)) walk(L.inline || []);
  return out.map((c) => (c.insert === '' && text[c.from - 1] === ' ' && /^[ .,;:!?…]?$/u.test(text[c.to] ?? '') ? { ...c, from: c.from - 1 } : c));
}

/** text[from, to) as it's read aloud: no tags, nothing only for the writer (deletions, comments, notes,
 *  footnotes, a change's old words), lines run together. map[i] is where spoken[i] is in the text. */
export function spokenText(text, from, to) {
  const skip = new Uint8Array(text.length);
  const off = (a, b) => { for (let i = Math.max(a, from); i < Math.min(b, to); i++) skip[i] = 1; };
  const SILENT = new Set(['delete', 'comment', 'footnote', 'image', 'note']);
  const walk = (nodes) => {
    for (const n of nodes) {
      if (SILENT.has(n.type)) { off(n.from, n.to); continue; }
      for (const [a, b] of n.tags || []) off(a, b);
      if (n.type === 'subst') { off(n.from, n.data.new[0]); off(n.data.new[1], n.to); }
      if (n.type === 'annotation') off(n.data.note[0], n.data.note[1]);
      if (n.children) walk(n.children);
    }
  };
  for (const L of parseLines(text, { from, to })) {
    if (L.to < from || L.from > to) continue;
    if (!PROSE.has(L.type) && L.type !== 'heading') { off(L.from, L.to); continue; }
    if (L.tag) off(L.tag[0], L.tag[1]);
    walk(L.inline || []);
  }
  let spoken = '';
  const map = [];
  for (let i = from; i < to; i++) {
    if (skip[i]) continue;
    const c = text[i] === '\n' ? ' ' : text[i];
    if (c === ' ' && spoken.endsWith(' ')) continue;
    spoken += c;
    map.push(i);
  }
  return { text: spoken, map };
}

// ---- names: the project's own words, which recognizers get wrong

/** Words that sound alike share a code: Avner, Abner and Avenor are all A156; “after” is A136. */
export function soundex(word) {
  const w = String(word || '').toLowerCase().replace(/[^a-z]/gu, '');
  if (!w) return '';
  const code = (c) => ('bfpv'.includes(c) ? '1' : 'cgjkqsxz'.includes(c) ? '2' : 'dt'.includes(c) ? '3' : c === 'l' ? '4' : 'mn'.includes(c) ? '5' : c === 'r' ? '6' : '');
  let out = w[0], last = code(w[0]);
  for (const c of w.slice(1)) { const k = code(c); if (k && k !== last) out += k; if (c !== 'h' && c !== 'w') last = k; }
  return (out + '000').slice(0, 4);
}
/** The edit distance between two words. */
export function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const letters = (s) => String(s).toLowerCase().replace(/[^a-z]/gu, '');
const like = (said, name) => { const w = letters(said), n = letters(name); return !!w && Math.abs(w.length - n.length) <= 2 && (w === n || (soundex(w) === soundex(n) && distance(w, n) <= 2)); };

/** The project's names put right where a recognizer heard them wrong (“Abner”, “Benny Ami”),
 *  by sound and by spelling, one word or two. Returns the text and what was changed. */
export function snapNames(said, names) {
  const fixed = [], toks = String(said).split(/(\s+)/u);
  for (const name of names || []) {
    for (let i = 0; i < toks.length; i += 2) {
      for (const span of [1, 2]) {
        const j = i + (span - 1) * 2;
        if (j >= toks.length) continue;
        const raw = toks.slice(i, j + 1).join(''), core = raw.replace(/^[^\p{L}]+|['’]s\b.*$|[^\p{L}]+$/gu, '');
        if (!core || core === name || !like(core, name)) continue;
        const at = raw.indexOf(core);
        fixed.push(`${core} → ${name}`);
        toks.splice(i, j - i + 1, raw.slice(0, at) + name + raw.slice(at + core.length));
        break;
      }
    }
  }
  return { text: toks.join(''), fixed };
}

const NOT_NAMES = new Set([...`A An The And But Or So If When While Then There Here This That These Those It Its He She They We You His Her Him Them Their Our
  My Your What Why How Who Where Which In On At Of To For From With By As After Before Once Now Yes No Not Some All One Two`.split(/\s+/u),
'I', 'I\'m', 'I\'ll', 'I\'ve', 'I\'d', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'God', 'English', 'Hebrew']);
/** The project's names: words always written with a capital (never in lower case anywhere in it), a few times over.
 *  A name often starts its sentence ("Avner was not there"); “She” and “The” are written small elsewhere. */
export function namesIn(texts, { min = 2, max = 60 } = {}) {
  const count = new Map(), small = new Set();
  for (const text of texts) {
    const prose = proseLines(text).map(([a, b]) => spokenText(text, a, b).text).join('\n');
    for (const raw of prose.match(/[\p{L}][\p{L}'’-]*/gu) || []) {
      const w = raw.replace(/['’]s$/u, '');
      if (/^\p{Lu}\p{Ll}/u.test(w)) { if (!NOT_NAMES.has(w)) count.set(w, (count.get(w) || 0) + 1); }
      else if (/^\p{Ll}/u.test(w)) small.add(w.toLowerCase());
    }
  }
  return [...count].filter(([w, n]) => n >= min && !small.has(w.toLowerCase()))
    .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, max).map(([w]) => w);
}

// ---- other words it might have been

const HOMOPHONES = [
  'there their they\'re', 'to too two', 'your you\'re', 'its it\'s', 'whose who\'s', 'than then', 'here hear', 'where wear were',
  'know no now', 'knew new', 'right write rite', 'whole hole', 'wood would', 'weather whether', 'which witch', 'peace piece',
  'break brake', 'buy by bye', 'cell sell', 'cent scent sent', 'flour flower', 'for four fore', 'hour our', 'loan lone',
  'made maid', 'meat meet', 'night knight', 'one won', 'pair pear', 'passed past', 'plain plane', 'principal principle',
  'rain reign rein', 'road rode', 'sea see', 'sight site cite', 'some sum', 'son sun', 'stair stare', 'tail tale',
  'threw through', 'waist waste', 'wait weight', 'weak week', 'allowed aloud', 'bare bear', 'board bored', 'course coarse',
  'dear deer', 'fair fare', 'grate great', 'heal heel', 'higher hire', 'lead led', 'mail male', 'role roll', 'sole soul',
  'steal steel', 'tide tied', 'toe tow', 'vain vein', 'way weigh', 'rose rows', 'cold called', 'lamb lamp', 'key quay',
].map((g) => g.split(' '));
/** Words a recognizer may have meant instead of `word`: those that sound the same, and the project's names. */
export function alternatesFor(word, names = []) {
  const w = String(word).toLowerCase();
  const out = [];
  for (const g of HOMOPHONES) if (g.includes(w)) out.push(...g.filter((x) => x !== w));
  for (const n of names) if (n.toLowerCase() !== w && like(word, n)) out.push(n);
  return [...new Set(out)];
}
