<sub>[Moshe docs](README.md) › Writing in Moshe</sub>

# Writing by voice

Moshe can write down what you say and do what you ask, so you can write and edit a whole chapter without the keyboard or the mouse. You talk, you pause, and at each pause Moshe either types what you said or carries it out as a command. This page shows how to start, how Moshe tells the two apart, and every command it knows. How it all works inside is in [Voice](VOICE.md).

## Turning it on

Voice is off until you turn it on. A strip appears under the text, and the dashboard gets two more views, **Voice** and **Words**. Two keys do it all:

| | Mac | Windows |
| --- | --- | --- |
| Voice on and off | **⌥⇧⌘L** | **Ctrl+Alt+Shift+L** |
| Start or stop listening | **⌥⌘L** | **Ctrl+Alt+L** |

- **Voice on** starts listening too, since that's what you turned it on for. **Voice off** stops listening and puts the strip away. **View › Voice** in the menu bar does the same, and **Settings › Voice › Write and Edit by Voice** turns voice on without listening yet.
- **Start listening** turns voice on first, if it's off.
- **From any app.** In the Mac and Windows apps, the keys work while another app is in front: they bring Moshe forward and switch on, and pressed again in Moshe, they switch off. **Settings › Voice › From Any App** keeps them to Moshe's own window instead.
- **Your own keys.** In **Settings › Voice**, click a key and press the one you'd like instead. A key on its own works if it's an F-key, which suits a one-handed keyboard or a switch that sends one: F6 alone can start and stop listening. Otherwise the key needs ⌘ or ⌃ on a Mac, Ctrl or Alt elsewhere, so it can't be typed by accident. **Delete** leaves an action with no key, and **Default** puts the usual one back.
- **On Android,** a keyboard plugged into the phone or tablet has the same keys (**Ctrl+Alt+L**). Without one, touch and hold Moshe's icon and choose **Start Listening**.

The microphone button at the left of the strip starts and stops listening too.

**Listen With**, in the same settings, chooses what hears you. Start with the first choice: the app's own recognizer where the app has one, and otherwise Whisper, which runs on your computer, so your voice never leaves it. Whisper downloads its model the first time, and the strip counts up while it does. **The Browser's Own** sends your voice to Google (in Chrome) or Apple (in Safari).

## The one rule

Everything you say is typed, unless the whole of it, from one pause to the next, is a command.

Say "delete that" on its own, and Moshe deletes what you just said. Say "She said delete that and left", and it's all typed, because "delete that" was only part of it. So you never have to switch between writing and giving orders, and a line of dialogue can't turn into one by accident.

### Pausing

A pause of just under a second (0.7 s) is the end of what you said, and that's when Moshe decides.

- **Say a command in one go,** then pause. A pause in the middle cuts it in two, and each half is typed.
- **In a sentence, pauses are fine.** What comes next is typed after it and joins up. But a pause right before words that sound like a command can make them one, so carry on to the end of the sentence when you can.
- **Politeness doesn't get in the way.** "Okay, new paragraph, please" is a new paragraph, and so is "um, new paragraph". "Please", "okay", "can you…" and "…for me" around a command are left out.

### What gets typed

Moshe tidies what you dictate, but it never changes your words.

- A sentence starts with a capital, and a finished sentence at the end of a paragraph gets its full stop. In the middle of a sentence, the capital a recognizer puts in anyway is taken out, except for "I" and the names in your project.
- "Um" and "uh" are left out, and the strip says how many.
- Say "comma", "period", "question mark", "exclamation mark", "colon" or "semicolon" as you go, and you get the mark (in English). After "a", "the", "his" and the like, or before "of", the name stays a word: "a period of calm", "the Oxford comma".
- Whatever is selected is replaced by what you dictate next.
- In Revision Mode, what you dictate goes in as an insertion, and over a selection as a change.

### Reading the strip

The strip is where Moshe tells you what it heard and what it did about it.

- **The microphone button,** on the left, says **Listening** (with a red dot), **Asleep**, **Mic Off**, or **Loading** and a percentage while a model downloads. The little bar beside it moves as you speak. Press it to start or stop listening, or to wake Moshe up.
- **EN** or **HE** is the language you're dictating in. Press it to switch.
- **While you talk,** the strip says **Hearing**, then **Working Out the Words**, with "Waiting for the pause: then text or command" under it. Some recognizers show your words in grey as you go, at the cursor too; Whisper waits for the pause.
- **After the pause,** what was heard is in quotes, with a label:
  - **Text**: it was typed.
  - **Command**: it was done, and the strip says what it did ("Bold", "early → late", "Undone").
  - **Command** in red: a command that couldn't be done, and why ("Not found", "Nothing to undo"). Nothing changed.
  - **Ignored**: Moshe was asleep, or reading aloud.
- **The line underneath** says why, when that isn't obvious: "delete that" was inside a sentence, and a command has to stand alone.

Before you've said anything, the strip says: Say "what can I say". The dashboard's **Voice** view also keeps what was heard lately, under **Heard**, so you can look back.

## A first five minutes

1. Turn voice on and start listening (**⌥⇧⌘L**, or **Ctrl+Alt+Shift+L** on Windows). The strip says **Listening**.
2. Say "new sheet", and pause. A new, empty sheet opens, and the strip says **Command**.
3. Say "the frost came early that year", and pause. It's typed with a capital and a full stop, and the strip says **Text**.
4. Say "nobody in the village had a coat warm enough", and pause. It follows on as the next sentence.
5. Say "new paragraph", then "the well froze on the first night".
6. **Change a word.** Say "replace early with late". The strip shows "early → late". (Another way, good for any change: say "select early", and then just say "late". What you say takes the place of what's selected.)
7. **Make something bold.** Say "bold the frost". When you've only just said the words, "make that bold" does it to them.
8. **Undo.** Say "scratch that", and the bold is gone. Say "redo", and it's back.
9. **Find another word.** Say "synonyms for warm". The dashboard opens at **Words** with a numbered list. Say the number of the one you like, "three" for instance, and it takes the place of "warm" in the sheet. "Cancel" keeps "warm".
10. **Listen to it.** Say "read this paragraph". Moshe reads it aloud and lights each word as it goes. Say "stop" to stop.
11. **Take a break.** Say "go to sleep". The strip says **Asleep**, and nothing you say is typed or done until you say "wake up".

That's most of it. Whenever you're not sure what to say, say "what can I say".

## When it mishears

### Taking it back

"Scratch that" takes back the last thing, whether it was typed or done. Each sentence you dictate and each command is one step, so it never takes back more than that. Say it again to go further back, or say "undo three times". "Redo" puts it back.

### When your words are a command

"Type" in front types the words, command or not: "type new paragraph", "type help".

It's also the way for a sentence that happens to start like a command. Said on its own, "Add salt before serving" reads as "add ‹words› before ‹words›", and "Change came to the village" as "change ‹words› to ‹words›". When the words it names aren't in the sheet, Moshe types the sentence, and the strip says No "serving" in the sheet. When they are, it's done as a command: say "scratch that", then say it again with "type" in front.

In dictation, a mark's name becomes the mark unless it's plainly the word (see [What gets typed](#what-gets-typed)). Where Moshe gets it wrong, say "type" in front.

A few commands are a single word, and said all on their own they're commands, not text: "help", "heading", "English", "cancel", "undo", "export", "synonyms", "define", and the marks, like "period" and "dash". In a sentence they're just words, and most short lines are always typed: "Listen.", "The end.", "Again.", "Enough." "Stop" is a command only while Moshe is reading aloud, and a number only while a numbered list is showing.

### Near misses

Recognizers mishear short commands most of all ("bold that" can come out as "build that"), so when something short comes close to a command, Moshe makes a call, and the strip says which:

- **Very close,** and it's done as the command. The strip says: Heard "build that", taken as "bold that".
- **Fairly close,** and it's typed, and the strip names the command it sounds like: Sounds like "bold that": "scratch that", then say it again.
- **Not close,** like "I like that" for "highlight that", and it's typed. You may well have meant it.

Commands that do a lot, or that are easy to say by accident, are never done on a guess, however close: they're marked *Never guessed* in the tables below. And when a guess can't be done (there's nothing to make bold, say), the words are typed after all, with the hint.

Some recognizers, like the Mac's, have a second guess at what you said. When the first guess is text and the second is a command, the command is taken, and the strip's second line says so.

The longer forms come through best: "make that bold" is heard right more often than "bold that".

### Places that aren't there

"Go to ‹heading or sheet›" and "open ‹sheet›" type your words when there's no heading or sheet by that name, and the strip says so, since "go to the market" may just be a sentence. So do the commands that name words in the sheet ("select", "delete", "replace", "insert", "bold", "go after"): when the words aren't there, your words are typed, and the strip says No "…" in the sheet. If you meant the command, say "scratch that" and try again.

### A word heard wrong

"Correct ‹word›" lists the words that sound like it, and the names in your project, numbered in the dashboard's **Words** view: "correct cold" offers "called". Say a number. If the right word isn't there, say "spell" and its letters: "spell f r o s t".

Moshe also learns the names in your project (words you always write with a capital) and puts them right when the recognizer hears them wrong. They're listed under **Names** in the dashboard's **Voice** view, and **Settings › Voice › Put the Project's Names Right** turns this off.

### "What can I say"

Say "what can I say" whenever you're stuck. The dashboard's **Voice** view opens with what makes sense just then, under **You Can Say**: "wake up" while Moshe is asleep, the numbers while a list is showing, "stop" while it's reading, the revision marks in Revision Mode, and a few everyday ones otherwise. Under **All Commands** is every command, in the same groups as the tables below.

## Keeping your hands free

Voice is meant to be enough on its own, and a few habits make it so.

- **One key, from anywhere.** Choose a key you can press easily (an F-key alone, if that's easiest) for **Voice On and Off** in **Settings › Voice**. From any app, it brings Moshe forward listening.
- **Leave it listening.** Starting to listen takes a key or a click, and Moshe doesn't start listening by itself when it opens. So once it's listening, leave it on. Say "go to sleep" when the phone rings or someone comes in: nothing you say is typed or done, and the strip says **Asleep**. Say "wake up" when you're back. "Stop listening" puts it to sleep too. Only "microphone off" turns the microphone off, and then it takes a key or the strip's button to start again.
- **Point with numbers.** Rather than naming words, say "show numbers", and every sentence gets a number. "Sentence 4" selects that one, and "read sentence 4" reads it. "Show paragraph numbers" and "paragraph 2" do the same with paragraphs, and "hide numbers" takes the numbers away. Say "sentence" or "paragraph" with the number: a number on its own is typed.
- **Pick from lists by number.** When "select ‹words›" finds the words in more than one place, each place gets a number in the text (and in the dashboard's **Voice** view). Synonyms, other guesses and "show sheets" are numbered too. Say the number any way it comes out: "two", "2", "to" and "too" all mean 2, and so do "use two", "number two" and "pick two". A number that isn't on the list does nothing, and the strip says which numbers there are. "Cancel" closes the list.
- **Listen instead of reading.** "Read that back" reads what you just said, "read this paragraph" the paragraph you're in, and "read from here" goes to the end of the sheet, lighting each word as it goes. The speakers carry Moshe's voice back into the microphone, so while it reads, it listens only for "stop" (and "stop reading", or "go to sleep"). **Settings › Voice › Reading Aloud** sets how fast it reads.
- **Hear what happened.** Turn on **Settings › Voice › A Tone for Each Command**: two rising notes for a command, one note for text, and a low note for a command that couldn't be done. Then you only need to look at the strip when something sounds wrong.
- **Revise without losing anything.** In Revision Mode ("revision mode"), deleting marks words rather than taking them out, and what you dictate goes in as an insertion. Words struck by mistake are still there, and "accept all" or "reject all" settles everything at the end.
- **Less to look at.** "Bigger text" makes the text larger, and "focus mode" leaves only the page.

## Every command

How to read the tables:

- **‹words›** is any words in the sheet, **‹word›** one word, **‹n›** a number and **‹sheet›** a sheet's title.
- **A dot** separates choices: "next · previous paragraph" is "next paragraph" or "previous paragraph".
- **"That"** is what's selected or, when nothing is, what you just said.
- **When the words are there more than once,** the place nearest the cursor is used. Only "select ‹words›" numbers them for you to choose.
- **Or say** gives a few of the other ways to say each one.

### Listening

| Say | What it does | Or say |
| --- | --- | --- |
| **go to sleep** | Moshe stops taking in what you say. Only "wake up" works until then. The microphone stays on, so waking needs no hands. | "stop listening", "pause listening" |
| **microphone off** | Turns the microphone off. A key or the strip's button turns it on again. It works while Moshe is asleep too. *Never guessed.* | "mic off", "turn the microphone off" |
| **wake up** | Moshe listens again. | "start listening", "I'm back" |
| **type ‹words›** | Types the words, even when they sound like a command. *Never guessed.* | |
| **switch to Hebrew · English** | Changes the language you dictate in. Commands are in English, so in Hebrew, say "אנגלית" to come back. *Never guessed.* | "dictate in Hebrew", "English", "אנגלית" |

### Writing

| Say | What it does | Or say |
| --- | --- | --- |
| **new paragraph** | Starts a new paragraph. | "new line", "paragraph break" |
| **period · comma · question mark** | Puts that mark at the cursor. "Dash" puts in a long dash, "hyphen" a short one. | "full stop", "exclamation mark", "colon", "semicolon", "dash", "hyphen", "ellipsis", "open quote", "close quote" |
| **scratch that · undo** | Takes back the last thing, said or done. | "undo that", "take that back" |
| **undo ‹n› times** | Several steps back at once. *Never guessed.* | "undo the last ‹n› changes" |
| **redo** | Puts back what was undone. | "put it back" |
| **do that again** | The last command, once more. *Never guessed.* | "repeat that", "same again" |

### Choosing

| Say | What it does | Or say |
| --- | --- | --- |
| **select that** | Selects what you just said. | "select what I said" |
| **select all** | Selects the whole sheet. | "select everything" |
| **select this · next · last sentence** | Selects that sentence. Also "paragraph" and "word". | "select the paragraph", "select the last word" |
| **select ‹words› through ‹words›** | Selects from the first words to the second. | "select from ‹words› until ‹words›" |
| **select ‹words›** | Selects them. If they're there more than once, each place gets a number, and you say the one you mean. | |
| **show numbers** | Puts a number on every sentence. | "show paragraph numbers", "number the sentences" |
| **hide numbers** | Takes the numbers away. | "hide the numbers" |
| **sentence ‹n› · paragraph ‹n›** | Selects that sentence or paragraph. | |
| **cancel** | Drops the selection, the numbers and any list. | "unselect", "never mind" |

### Moving

| Say | What it does | Or say |
| --- | --- | --- |
| **go to the end · top** | To the end or the top of the sheet, or of the paragraph or sentence. | "go to the beginning", "end of the paragraph", "start of the sentence" |
| **next · previous paragraph** | To the next or the previous paragraph. Also "sentence". | "next sentence", "down a paragraph", "up a sentence" |
| **go after ‹words› · go before ‹words›** | Puts the cursor just after or just before them. | "move after ‹words›", "cursor before ‹words›" |
| **go to ‹heading or sheet›** | Moves to that heading in the sheet, or opens that sheet. If there's neither, the words are typed. | |
| **open ‹sheet›** | Opens a sheet of the group by its title, or its number in the list. If there's none, the words are typed. | |
| **show sheets** | Numbers the group's sheets in the dashboard. Then a number opens one. | "list the sheets" |
| **next sheet · previous sheet** | The sheet beside this one in the list. *Never guessed.* | |
| **new sheet** | A new, empty sheet. *Never guessed.* | |
| **scroll down · up** | A screen at a time. | |
| **bigger text · smaller text** | Changes the size of the text. | "larger text", "zoom in", "zoom out" |

### Editing

| Say | What it does | Or say |
| --- | --- | --- |
| **delete that** | Deletes what's selected, or what you just said. In Revision Mode it's marked for deletion instead. | "erase that", "remove that" |
| **delete last word · last sentence** | Deletes the word or the sentence before the cursor. | "delete the previous word" |
| **delete ‹words› · strike ‹words›** | "Delete" deletes them, or marks them in Revision Mode. "Strike" always marks them for deletion, as the pen does. | "remove ‹words›", "cross out ‹words›" |
| **replace ‹words› with ‹words›** | Puts the new words in place of the old ones. In Revision Mode it's kept as a change. | "change ‹words› to ‹words›" |
| **insert ‹words› after ‹words›** | Adds words at that place. Also "before". In Revision Mode it's an insertion mark. | "insert ‹words› before ‹words›", "add ‹words› after ‹words›" |
| **bold · italicize · highlight ‹words›** | Makes those words bold, italic or highlighted. | "mark ‹words›", "emphasize ‹words›" |
| **bold · italicize · highlight that** | The same, for what's selected or what you just said. "Make that bold" is heard better. | "make that bold", "make that italic", "mark that" |
| **capitalize · uppercase · lowercase that** | Changes the case of what's selected, or what you just said. "The word" instead of "that" is the word at the cursor. | "uppercase that", "lowercase that", "capitalize the word" |
| **put that in quotes** | Puts quotation marks around it. | "quote that", "put quotes around that" |
| **make that a list** | Makes a list of it. Also "a numbered list". | "make that a numbered list", "bullet that" |
| **make that a heading** | Makes the paragraph the cursor is in a heading. Also "subheading" and "title". | "make that a subheading", "make that a title" |
| **move that after ‹words›** | Moves what's selected, or what you just said. Also "before ‹words›" and "to the end". | "move that before ‹words›", "move that to the end" |
| **comment ‹words›** | Adds your words as a comment on what's selected, or on the sentence the cursor is in. | "add a comment ‹words›" |

### Revision

| Say | What it does | Or say |
| --- | --- | --- |
| **revision mode** | Turns on Revision Mode: deleting marks words instead of taking them out, and dictation goes in as insertions. | "start revising", "editing mode" |
| **stop revising** | Back to writing. | "done revising", "writing mode" |
| **accept all · reject all** | Settles every insertion, deletion and change in the sheet. *Never guessed.* | "accept all changes", "reject all changes" |
| **mark ‹n›** | Selects that mark, counting the way the Annotations view lists them. | "go to mark ‹n›" |

### Words

| Say | What it does | Or say |
| --- | --- | --- |
| **synonyms (for ‹word›)** | Other words for the one you name, or the one at the cursor, numbered in the dashboard's **Words** view. Then say "use" and a number. | "another word", "thesaurus", "what's another word for ‹word›" |
| **define ‹word›** | The definition, in the **Words** view. "Define" on its own looks up the word at the cursor. | "what does ‹word› mean", "look up ‹word›" |
| **correct ‹word›** | Words that sound like it, and the project's names, numbered to pick from. | |
| **spell ‹letters›** | Puts those letters in place of the word being corrected, or of what's selected. With neither, it types the word. | |
| **use ‹n›** | Picks from the numbered list. The number alone does too. | |

### Reading

| Say | What it does | Or say |
| --- | --- | --- |
| **read that back** | Reads aloud what's selected, or what you just said. | "read it back", "read what I said" |
| **read this paragraph · this sentence** | Reads the paragraph or the sentence the cursor is in, lighting each word as it goes. | "read the sentence" |
| **read sentence ‹n›** | Reads that sentence. Also "paragraph ‹n›". | "read paragraph ‹n›" |
| **read from here** | Reads from the cursor to the end of the sheet. | "read on", "read to the end" |
| **stop reading** | Stops reading. | "stop talking" |
| **stop** | Stops reading too, but only while Moshe is reading. Otherwise it's a word. | "quiet" |
| **word count** | Shows on the strip how many words the sheet has. | "how many words" |

### The app

| Say | What it does | Or say |
| --- | --- | --- |
| **what can I say** | Suggestions for the moment, in the dashboard's **Voice** view. | "show commands", "help" |
| **show · hide the dashboard** | Shows or hides the pane on the right. *Never guessed.* | "open the dashboard", "close the dashboard" |
| **show words · voice · annotations · outline** | Opens that view of the dashboard. | "show marks", "show overview", "show progress" |
| **focus mode** | Only the page. Say it again, and everything is back. "Hide the interface" only hides, and "show the interface" only shows. *Never guessed.* | "hide the interface", "show the interface", "leave focus mode" |
| **go back · go forward** | The sheets you were in before and after. *Never guessed.* | |
| **export** | Opens the Export window for the sheet. *Never guessed.* | "export this sheet" |
| **translation mode** | The sheet and its translation, side by side. Say it again to leave. *Never guessed.* | |
| **check text** | Checks the sheet with LanguageTool, when your server has it. *Never guessed.* | "check the text" |

<sub>Next: [Voice, under the hood](VOICE.md) →</sub>
