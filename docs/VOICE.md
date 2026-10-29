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

### When it isn't quite a command

Recognizers mishear short commands, so the rule is applied with some give, in
three layers, from the safest:

- **More ways to say each command.** "Please", "okay,", "can you…" and "…for me" around a command are ignored, as are "um" and "uh" before it. Most commands also take other words: "erase that", "make that bold", "bold the selection", "end of the paragraph", "down a paragraph", "what's another word for cold". Each command's other phrasings are in its `also`, and a test checks that each one parses to its command. Words a writer may well dictate on their own stay text: "Listen.", "The end.", "Again.", "Enough.", "Forget it.".
- **The recognizer's other guesses.** When the words as heard are text but one of the recognizer's alternatives is an exact command, the command is taken (`commandAmong`), and the strip says so. This never takes a command that is open-ended ("select ‹words›") or big.
- **Near misses.** A short utterance whose letters are within a quarter of an exact command's is carried out as that command (`nearCommand`): "build that" is "bold that", "Highlight dad" is "highlight that". The strip says "Heard … taken as …". Within a third, it is still typed, and the strip names the command it sounds like, so she can say "scratch that" and try again.
  - **Commands marked `exact`** are never done on a guess: "accept all", "new sheet", "export", "type…", the language, "go back", the next sheet, "undo three times", "do that again".
  - **A guess that can't be carried out** does nothing, and the words are typed with the hint.
  - **"I like that"** is too far from "highlight that" to guess: it may be meant.

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
the system's voices (`speechSynthesis`) and lights each word as it's read. A
native app that reads aloud itself (`voice.speak`, below) is used instead: the
Android WebView has no `speechSynthesis`. The speakers feed back into the
microphone, so while it reads, only "stop" counts.

## A native app's recognizer

A native app offers its own recognizer the way it offers its other services
([BRIDGE.md](BRIDGE.md) §5): it defines `window.mosheShell.voice` before the
page loads.

| The page calls | The app |
| --- | --- |
| `voice.start({lang, words, pause})` | Starts listening. `lang` is `en` or `he`. `words` are the recognizer's custom words: the project's names, and the commands' own words (`commandPhrases`). `pause` is in ms. |
| `voice.stop()` | Stops. |
| `voice.language(lang)` | Goes on listening, in the other language. |
| `voice.speak(text, lang, rate)` | Optional: reads `text` aloud. The promise settles when the reading ends: `true` read to the end, `false` stopped. |
| `voice.stopSpeaking()` | Stops reading. |

An app may offer reading aloud without listening (`speak` but no `start`). The
page then listens with Whisper and reads with the app.

The app tells the page what it hears through `window.mosheVoice`:

| The app calls | When |
| --- | --- |
| `mosheVoice.partial(text)` | The guess so far, shown grey at the cursor. |
| `mosheVoice.final(text, {how, alternatives})` | At each pause: one utterance. `how` is shown on the strip, e.g. "Apple's speech · 0.3 s". `alternatives` are the recognizer's other guesses at the whole of it, if any. |
| `mosheVoice.state(s, pct, caption)` | `listening`, `hearing`, `loading` (with a percentage), `error`, `off`. `caption`, optional, says why on the strip; an `error` stops listening. |
| `mosheVoice.level(v)` | How loud, 0–1, a few times a second, for the meter. |
| `mosheVoice.spoken(start, end)` | While `voice.speak` reads: the word being read, as offsets in the text given. |

### The Mac

`mac/Moshe/Voice.swift`, on macOS 26 and later.

- **Recognizer:** Apple's on-device dictation (`DictationTranscriber`), with punctuation. The system downloads its model once.
- **Pauses:** the microphone's sound goes through a pause detector, the same rule as the page's. At each pause the app asks the analyzer to finalize the text up to there (`finalize(through:)`). It hands that over as one utterance, 0.1–0.3 s after the pause, and sends the guess so far as partials.
- **Custom words:** they go to the analyzer as contextual strings.
- **"New paragraph":** Apple's dictation writes it as the break itself; the app hands the page the words instead.
- **Older Macs:** macOS 14 and 15 have no `mosheShell.voice`, so the page listens with Whisper. The app lets the page have the microphone for that.
- **Menus:** View › Voice and View › Start Listening (⌥⌘L).
- **Self-test:** `mac/selftest.sh voice` speaks nine sentences with `say` into a file, which the app hears instead of the microphone (`-SelfTestVoiceFile`). It checks the sheet afterwards.

What testing showed: dictation mishears short commands, even with the commands as
custom words. Spoken by the Mac's own voices:

- "highlight that" came out as "I like that", "High like that" and "Highlight dad";
- "bold that" came out as "call dad" and "build that";
- "make that italic" came out as "make that metallic";
- "italicize that" and "make that bold" came through every time.

Hence the longer forms ("make that bold") and the layers above. With them, the
same recordings came out as follows:

- "High like that" became highlight. Its second guess was "Highlight that", and it is a near miss anyway.
- "build that" became bold.
- "Highlight dad" became highlight.
- "I like that" and "call dad" are still typed. They're too far from the commands to guess, and Apple's other guesses were "call that" or nothing.

The app sends the recognizer's alternatives with each utterance (`alternatives` in
`mosheVoice.final`'s second argument). It sends them only for an utterance heard
as one piece, since they are guesses at all of it.

### Android

`android/app/src/main/java/xyz/tiresia/moshe/Voice.java`, on Android 13 and later.

- **Recognizer:** Android's `SpeechRecognizer`. The on-device one
  (`createOnDeviceSpeechRecognizer`) when the phone has it and it has the
  language; otherwise the phone's default one, asked to prefer working offline.
- **Pauses:** the app records the microphone itself (16 kHz, `VOICE_RECOGNITION`)
  and runs the same pause detector as the page and the Mac (`PauseGate.java`).
  Each utterance is one recognizer session, its sound handed over through a pipe
  (`EXTRA_AUDIO_SOURCE`, Android 13). At the pause the pipe closes and the
  recognizer gives its words. So an utterance is cut exactly where the page would
  cut it, and the recognizer's own end-of-speech never decides. One session at a
  time, in order; what's said meanwhile waits its turn. The level comes from the
  app's own recording.
- **Custom words:** `EXTRA_BIASING_STRINGS` (Android 13).
- **Punctuation:** `EXTRA_ENABLE_FORMATTING` (Android 14), so the words come
  punctuated as Apple's do. Offensive words are not masked: they're the writer's.
- **A missing language:** Android's own dialog asks whether to download it, once,
  and the strip shows the download. If she says no, the default recognizer takes
  over. If no recognizer has the language, the strip says so.
- **Google's recognizers** send the finished words as a partial result marked
  `final_result`, and `onResults` then comes empty. The app takes those.
- **In the background** Android gives an app no microphone, so listening pauses
  and goes on when Moshe is back in front.
- **Reading aloud:** `voice.speak`, with the phone's `TextToSpeech`
  (`Speaker.java`). Each word's place comes from `onRangeStart` as
  `mosheVoice.spoken`.
- **Before Android 13,** or with no recognizer, there's no `voice.start`. The page
  listens with Whisper, and the app lets its page have the microphone for that.
- **Menus and keys:** none. The strip's microphone button starts and stops listening.
- **Self-test:** `android/check.sh voice` speaks the Mac's nine sentences with
  `say` into a 16 kHz file. The test build hears it instead of the microphone
  (`moshe.voiceFile`). It checks the sheet, then reads a paragraph aloud.

What testing showed, with `check.sh voice`:

| | Recognizer | Nine utterances | Words after the pause | Reading aloud |
| --- | --- | --- | --- | --- |
| Emulator, Android 16 | on-device (Android System Intelligence) | all, one per pause | 0.0–0.4 s | each word lit |
| Galaxy S24+, Android 17 | default (Speech Services by Google, offline) | all, one per pause | 0.0–0.1 s | each word lit |
| Galaxy Tab S10 FE, Android 16, without Google's apps | on-device (Android System Intelligence) | all, one per pause | 0.1 s | each word lit |

- **The Galaxy S24+'s on-device recognizer can't be reached by apps.** Binding to
  it fails and it never answers. After 2.5 s the app takes the default one,
  which runs offline anyway.
- **The tablet without Google's apps** still has Speech Services by Google and
  Android System Intelligence, and that's all voice needs.
- **"The West":** Google's recognizers write "the storm came in from the West".
  The page keeps capitals inside an utterance, so the sheet has it too.
- **Asking what's installed** (`checkRecognitionSupport`) is no help on its own.
  Android System Intelligence answers with empty lists until a language is
  installed, and the default recognizer won't answer at all. So the app tries,
  and asks for the language only when a session says it's missing (error 13).
  Asking up front showed Android's download dialog on every start.
- **Hebrew:** none of the three recognizes it. Android System Intelligence has
  no Hebrew pack, and Speech Services by Google says Hebrew isn't supported. The
  strip says so, and Whisper (multilingual base) is the way. Reading Hebrew
  aloud worked on the tablet. On the S24+ its Hebrew voice works over the
  network, and timed out there.
- **The WebView** has no `speechSynthesis` at all. It gives the page a microphone
  only with `MODIFY_AUDIO_SETTINGS` as well as `RECORD_AUDIO`.
- **The self-test never listens to a real microphone.** A Galaxy reopens an app
  on its own after an update, without the test's file, so the app takes the file
  from a new intent too, and `check.py` asks the app first (`hearsFile`).

Not tested yet: speech through a real microphone, in a real room; Whisper in the
WebView; Android 13–15; the download dialog on a phone (only on the emulator).

### Windows

Windows has no app yet; it would use Whisper (whisper.cpp).

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

- **A Windows app,** described above.
- **Hebrew:** commands, and a thesaurus.
- **Starting to listen when Moshe opens.**
- **A build of Moshe with voice on from the start,** under its own name.

<sub>Back: [The menus](MENUS.md)</sub>
