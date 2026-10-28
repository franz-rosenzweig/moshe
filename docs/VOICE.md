<sub>[Moshe docs](README.md) › Under the hood</sub>

# Voice

Writing and editing by voice, for writers who can't use their hands much, or
would rather not. It's off until **Settings › Voice** turns it on. Then a strip
appears under the text, and the dashboard gains two views, **Voice** and
**Words**. **⌥⌘L** starts and stops listening, and so does the strip's
microphone button.

## The rule

Everything said is text, unless the whole utterance, from one pause to the
next, is a command. "Delete that" said on its own deletes. "She said delete
that and left" is typed. The pause is 0.7 s.

- **"type" in front** types a command's words: "type new paragraph".
- **Some commands need their target to exist.** "Go to the kitchen" moves to that heading, or opens that sheet. With no such place it's typed, and the strip says why. "Open ‹sheet›" works the same way.
- **"stop" is a command only while Moshe is reading aloud.** Otherwise it's a word.
- **Asleep** ("go to sleep"): nothing counts but "wake up".
- **A numbered list showing:** a number picks from it. "Two", "to", "too", "2" and "use two" all mean 2. That's how recognizers write it.
- **Undo:** every command and every dictated sentence is one step of the editor's own undo. "Scratch that" is undo.

The strip always shows what was heard and whether it was taken as text or as a
command. It also shows why, when that isn't obvious.

## The pieces

| | |
| --- | --- |
| `engine/src/voice.js` | The parser and the command table (`COMMANDS`), dictation's cleanup and placing, and finding phrases, sentences, headings and marks. Also the project's names and the words that sound alike. No DOM, no editor. |
| `engine/src/words.js` | The thesaurus and dictionary lookup over WordNet's files: a word's base forms, its senses, and a numbered synonym list. |
| `frontend/src/voice/voice.svelte.js` | Carries out what was said: in the editor (`EditorView` transactions), with the pen's marks in Revision Mode (`engine/pen.js`), and in the app through the same `COMMANDS` the menus call (`App.svelte`). |
| `frontend/src/voice/marks.js` | What voice shows in the text: numbered badges, the word a list is about, the words being read, and the grey guess at the cursor. Also "that", the words just said. |
| `frontend/src/voice/mic.js` | Listening: the app's own recognizer, Whisper in the page, or the browser's own. |
| `frontend/src/voice/vad-worklet.js` | The pause detector, on the audio thread. |
| `frontend/src/voice/whisper-worker.js` | Whisper, in a worker. |
| `frontend/src/voice/words.js` | Loads the word files as they're needed. |
| `VoiceStrip.svelte`, `VoicePanel.svelte` | The strip; the dashboard's Voice and Words views. |

Each command in `COMMANDS` has an example, and a test checks that the example
parses to that command. The Voice view's **All Commands** is built from the same
table.

## Editing

- **Outside Revision Mode,** "delete" deletes, "replace" replaces, and dictation is typed at the cursor.
- **Inside it,** voice writes the marks the pen writes, with the same functions (`strikeChanges`, `insertChanges`, `commentChanges` in `engine/pen.js`):
  - "strike already" → `{--already--}`
  - "replace slanting with careful" → `{~~slanting~>careful~~}`
  - "comment who lit it?" → `{==…==}{>>Who lit it?<<}`
  - dictation → `{++…++}`
- **"accept all" and "reject all"** settle every insertion, deletion and change (`settleChanges`).

Dictation is cleaned, never reworded. "Um" and "uh" go, and so do spoken
commas and full stops. The words are then placed with a space either side as needed:

- **Capitals:** a capital at the start of a sentence; mid-sentence, the capital recognizers add is dropped, except for "I" and the project's names.
- **Full stops:** the closing stop is dropped where the sentence goes on, and added to a finished sentence at the end of a paragraph.

## Names

The project's names are words always written with a capital (never in lower
case anywhere in it), at least twice, leaving out a short list of common words
(`namesIn`). In the sample library that's Avner and Miriam.

What the microphone hears is checked against them, one word or two, by sound
(Soundex) and by spelling (`snapNames`). So "Abner", "Avenor" and "Benny Ami"
come out as the names. Words that merely look alike, like "after", are left alone.
**Settings › Voice** turns this off. A native app also gets the names up front
(below), for its recognizer's own custom words.

## Words

The thesaurus and the definitions are WordNet's (Princeton, a free licence:
`frontend/public/words/en/LICENSE`).

- **Generating the files:** `tools/wordnet.mjs` turns the `wordnet-db` package into one file per first letter, 21 MB in all (7 MB compressed). The page loads them only as they're needed.
- **Not committed:** the files are generated. `npm run words` makes them, and `npm run build` makes them first when they're missing. CI and `tools/release.sh` run it before building, and so does the Dockerfile.
- **Ordering:** synonyms come a few from each sense in turn, the commonest sense most. Within a sense, they're ordered by how often each word is used in WordNet's tagged corpus.
- **Exceptions:** irregular forms ("went", "geese") come from a built-in list. `wordnet-db` has no exception files.
- **Known gaps:** a verb with a single-word sense has no synonyms there. Proper names and slang turn up unmarked. Hebrew has no thesaurus yet.

## Listening

**Settings › Voice › Listen With:**

- **Best available** (`auto`): the app's own recognizer when the page runs in a native app that has one, otherwise Whisper.
- **Whisper, on this computer.**
  - **Library:** transformers.js 3.8.1, loaded from jsDelivr.
  - **Models:** Whisper's English models from Hugging Face. Tiny is 41 MB, base 77 MB, small 249 MB. On the graphics chip (WebGPU) they're bigger and several times faster. Hebrew uses the multilingual base.
  - **Downloads:** once; then the browser keeps them.
  - **Privacy:** the audio never leaves the computer.
  - **Speed** (on an M2): base takes about 0.4 s from the end of a sentence to its words on the graphics chip, and about 2.7 s on the processor.
- **The browser's own.** Chrome sends the audio to Google, Safari to Apple. Chromium has no service behind it. It shows the grey guess while you talk; Whisper waits for the pause.

The pause detector keeps a running guess at the room's noise. It hears speech
start when the sound rises well above that, and ends the utterance at the first
0.7 s pause. It runs on the audio thread, so nothing the page does can drop a word.

Reading aloud ("read that back", "read this paragraph", "read sentence 4") uses
the system's voices (`speechSynthesis`) and lights each word as it's read. The
speakers feed back into the microphone, so while it reads, only "stop" counts.

## A native app's recognizer

A native app offers its own recognizer the way it offers its other services
([BRIDGE.md](BRIDGE.md) §5): it defines `window.mosheShell.voice` before the
page loads.

| The page calls | The app |
| --- | --- |
| `voice.start({lang, words, pause})` | Starts listening. `lang` is `en` or `he`. `words` are the project's names, for the recognizer's custom words. `pause` is in ms. |
| `voice.stop()` | Stops. |
| `voice.language(lang)` | Goes on listening, in the other language. |

The app tells the page what it hears through `window.mosheVoice`:

| The app calls | When |
| --- | --- |
| `mosheVoice.partial(text)` | The guess so far, shown grey at the cursor. |
| `mosheVoice.final(text, {how})` | At each pause: one utterance. `how` is shown on the strip, e.g. "Apple's speech · 0.3 s". |
| `mosheVoice.state(s, pct)` | `listening`, `loading` (with a percentage), `error`, `off`. |
| `mosheVoice.level(v)` | How loud, 0–1, a few times a second, for the meter. |

The plan is Apple's on-device speech on the Mac and Android's recognizer on
Android. On Windows, which has no app yet, it would be Whisper (whisper.cpp).
The Android WebView has no `speechSynthesis`, so reading aloud there will need
a `voice.speak` from the app.

## Tests

```sh
cd engine && node --test test/voice.test.js test/words.test.js
node tools/voice-e2e.mjs APP_DIR             # the real app, what's said handed over as if heard
node tools/voice-e2e.mjs APP_DIR --audio --gpu   # spoken by the Mac's `say` into a fake microphone, heard by Whisper
```

`APP_DIR` is the demo build with its library and the word files. The top of
`tools/voice-e2e.mjs` shows how to make it. The first run says about fifty
things, from "select the water tower" and "two" to "accept all". After each one
it checks what the text became. The second run speaks nine of them and needs
Chromium, a Mac and the network (Whisper's first download).

## Not yet

- **The native apps' recognizers,** described above.
- **Voice in the Mac's menu bar** ([MENUS.md](MENUS.md)): Start Listening, Voice.
- **Hebrew:** commands, and a thesaurus.
- **Starting to listen when Moshe opens.**
- **A build of Moshe with voice on from the start,** under its own name.

<sub>Back: [The menus](MENUS.md)</sub>
