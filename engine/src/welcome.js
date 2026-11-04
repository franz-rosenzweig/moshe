// What a new library can start with: a Getting Started group of real
// sheets to read and type in, written as a letter to the new writer.
// Settings › General, the sample library and an empty library's welcome all
// use it. Settings › Voice adds the voice sheet on its own (addVoiceGuide).

// Writing by voice, short: the whole of it is docs/voice-guide.md. Every phrase
// in quotes is checked against the commands (engine/test/voice-guide.test.js),
// and the keys against the defaults (frontend/tests/keys.test.js).
export const VOICE_SHEET = `## Writing by voice

Moshe can type what you say and do what you ask, so you can write and edit a whole chapter without the keyboard or the mouse. You talk, you pause, and at each pause Moshe either types what you said or does it.

**Turning it on.** Press ⌥⇧⌘L on a Mac, or Ctrl+Alt+Shift+L anywhere else. A strip appears under the text, and when it says Listening, just talk. The same key turns voice off again, and in the Mac and Windows apps it works from any other app too, bringing Moshe forward. ⌥⌘L (Ctrl+Alt+L) starts and stops listening on its own. You can choose your own keys in Settings › Voice, even an F-key by itself. On an Android phone or tablet, touch and hold Moshe's icon and choose Start Listening.

**The one rule.** Everything you say is typed, unless the whole of it, from one pause to the next, is a command. Say "delete that" on its own, and Moshe deletes what you just said. Say "She said delete that and left", and it's all typed. So say a command in one go, and then pause.

**Try it.** Start listening, and say each of these, with a pause after each one:

1. "new sheet" opens an empty sheet to practice in.
2. "the frost came early that year" is typed, with a capital and a full stop.
3. "replace early with late" changes the word, and the strip shows early → late.
4. "bold the frost" makes it bold, and "scratch that" takes it back.
5. "synonyms for late" lists other words. Say the number of the one you like, or "cancel".
6. "read this paragraph" reads it aloud, and "stop" stops it.
7. "go back" brings you back to this sheet.

**What the strip says.** Under the text, the strip shows what Moshe heard and what it did with it: Text when it was typed, Command when it was done, and in red, why a command couldn't be done. When a command can't be done, nothing changes.

**When it gets it wrong.** "Scratch that" takes back the last thing, typed or done, and saying it again goes further back. Put "type" in front of words to type them even when they sound like a command, like "type new paragraph". When someone comes in, say "go to sleep", and nothing you say counts until you say "wake up".

**When you're stuck,** say "what can I say". The dashboard's Voice view opens with what makes sense right then, and every command is listed under All Commands. The whole guide, with every command and all the ways to say it, is [Writing by voice](https://github.com/franz-rosenzweig/moshe/blob/master/docs/voice-guide.md) in Moshe's docs. Settings › Voice adds this sheet to your Inbox whenever you want it back.
`;

export const GETTING_STARTED = [
  `# Welcome to Moshe

Hi, and welcome! Moshe is a writing app for long texts, like books, articles, and translations. You keep a library of sheets in groups and projects, write in a plain editor where the Markdown stays visible but quiet, and set goals that fill up as you write.

The big difference from most writing apps is where your writing lives. Every sheet in Moshe is a plain Markdown file in a folder that YOU own, which means Obsidian or any text editor can open it too, and nothing is ever locked inside Moshe.

These are real sheets, so type in them, try things out and don't worry about breaking anything.

**Writing with tags** is about formatting without taking your hands off the keyboard.

**Sheets and groups** is about keeping a long text in order, and what that looks like in the folder.

**Checking and translating** covers spelling, grammar, and putting a text beside its translation.

**Writing by voice** is about writing and editing by talking, without the keyboard or the mouse.

**Where your writing lives** covers syncing, backups, and exporting.

When you're done, move this group to the Trash. You can add it back any time from Settings › General. (On Windows and Linux, read ⌘ as the Control key.)
`,
  `## Writing with tags

Moshe is here to help you WRITE, and everything else comes second. That's why the formatting is done with a few characters as you type, so your hands never have to leave the keyboard.

Start a line with # for a heading, and with ## or ### for smaller ones. **Two asterisks** make text strong, _underscores_ emphasize it, and ==two equals signs== mark a passage. A dash starts a list and a > starts a quote. Those characters are called tags, and the ones at the start of a line hang in the margin, a little out of the way.

Some tags are just for you while you work. %%Two percent signs make a comment like this one, which stays in your file but never shows up when you export.%% You can also strike something out with {--this--}, add something with {++this++}, or {==annotate a passage==}{>>like this<<}, which is handy when you're revising.

Footnotes^[Like this one. It gets its number when you export.], equations like $E = mc^2$, and tables are tags too. For a table, use Insert › Table, and Tab takes you from cell to cell.

You don't have to remember any of this. Press ⌘9 for the list of tags, and on a phone or a tablet they're on the bar above the keyboard. And if your fingers are used to typing :: for a highlight, that works too.
`,
  `## Sheets and groups

If you're writing a book, you won't start at line one and stop at The End. You'll write the ending before the middle, move chapter six after chapter three, and write plenty that never makes it in. Moshe is built for exactly that.

Everything you write is a sheet, and every sheet is one Markdown file. The first line of a sheet becomes the name of its file, so this one is saved as \`Sheets and groups.md\`. Sheets are meant to be shuffled around like paper, so just drag them in the list to put them in order.

Sheets live in groups, and every group is a folder. A group shows all its sheets, including the ones in the groups inside it, which means you can look at a whole book or just one chapter. The Inbox is the Notes folder itself, and Projects are for self-contained things like a book or a blog.

Right-click a sheet for its keywords and a writing goal. Both are saved at the top of the file, so other apps see them too. Select a few sheets and right-click again to Merge them into one, or to Glue them, which keeps them as separate files but reads them as one text.

Basically, whatever you do in Moshe, you'll find the same thing in the folder: files, folders, and plain text.
`,
  `## Checking and translating

Moshe checks your writing as you type, and it does it right on your device, so your text isn't sent anywhere for that.

English spelling and grammar get a wavy line, in a different color for each kind of problem. Hebrew gets a spelling check too, and it doesn't mind vowel points. Click an underlined word for suggestions, to ignore it, or to add it to your dictionary, which is kept with your library.

For a closer read, open the dashboard (⌘4), go to Annotations and press Check Text. That sends the sheet to LanguageTool on your Moshe server, which catches a lot more, and lists everything it finds. It's there only when your server has LanguageTool set up.

If you translate, put the two texts in groups named "Original" and "Translation" next to each other, and press ⇧⌘T to see them together. ("Hebrew" and "English" work too, and so do מקור and תרגום.) Each sheet then sits next to its translation, paragraph by paragraph, so you always know where you are.

And when you're revising, Revision Mode (⇧⌘E) quiets the text and brings out your comments, marks, deletions, and insertions, with a list of all of them in the dashboard.
`,
  VOICE_SHEET,
  `## Where your writing lives

Your library is a folder with Notes and Projects inside it, and Moshe reads and writes it as you go. There's no Save button, because every change is saved within a second.

On the web, the folder is on your Moshe server. In the Mac and Android apps it can be a folder on the device instead, which works offline. To keep a device's folder in step with the server, set up Sync in Settings, and if you already sync the folder some other way, that works too.

Your Moshe server can also make a backup every hour there are changes, and Settings › Backup is where you get an old version of a sheet back. A folder that only lives on your device isn't backed up by Moshe, so keep it in Time Machine or another backup.

When it's time to share your work, press ⇧⌘P to export it as a Word document, a PDF, an e-book, a web page, or plain Markdown.

Basically, it's your folder, so you can always open it, copy it, or take it somewhere else. Now go write something!
`,
];

/** The Getting Started group added to a library. → its path */
export function addGettingStarted(store, parent = 'Notes') {
  const dir = store.createGroup(parent, 'Getting Started');
  for (const text of GETTING_STARTED) store.createSheet(dir, { text });
  return dir;
}

/** The voice sheet on its own, in the Inbox: the one already there if there is one (it may have been practised on). → its path */
export function addVoiceGuide(store, dir = 'Notes') {
  const text = VOICE_SHEET.replace(/^## /u, '# ');
  const title = text.split('\n')[0].slice(2);
  return store.sheetsIn(dir).find((p) => store.sheetInfo(p).title === title) || store.createSheet(dir, { text });
}
