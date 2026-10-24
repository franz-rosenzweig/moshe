<sub>[Moshe docs](README.md) › Writing in Moshe</sub>

# The pen

I edit a lot of other people's writing, and on paper I always did it with a pen: a line through what goes, a caret where something's missing, a circle and a note in the margin. So Moshe lets you edit that way on a tablet with a pen, the Samsung S Pen in my case, and it works the same with an Apple Pencil on an iPad or a pen on a Windows laptop, since it's the browser that tells Moshe a pen is there.

The ink itself is never kept. Every stroke turns into the same marks the menus write, which means the file stays plain Markdown that Obsidian reads, the marks show up in Revision Mode's list, and a Word export turns them into real tracked changes, Hebrew included.

## Proofreading marks

Turn on **Revision Mode** (**⇧⌘E**, or **View › Revision Mode**), and then with the pen:

- **Strike through** a word or a few, and they're marked as deleted: `{--like this--}`.
- **Scribble** back and forth over words, and they're gone for good. Scribble over one of your marks instead, and that mark is taken back: a deletion comes back, an insertion goes away, a highlight is just text again.
- **Draw a caret** (a small ∧) between two words, and a box opens. Write what's missing, by hand or on the keyboard, press Return, and it goes in as an insertion: `{++like this++}`.
- **Circle** some words, and a box opens for your comment. Write it and press **Add Comment**, and the words are highlighted with the comment beside them: `{==like this==}{>>why?<<}`. Write nothing and press **Highlight**, and they're just highlighted.
- **Tap** to put the cursor somewhere, as usual.

Each mark snaps to whole words, the punctuation around them stays out of it, and each one is a single step of **Undo**. If a stroke isn't one of these, it fades to grey and Moshe tells you what the marks are.

Outside Revision Mode the pen works like a finger, so you can still select, scroll and tap around. Your fingers keep scrolling in Revision Mode too, except while the pen is on the screen or just above it, when a hand resting on the glass is ignored. **Settings › General › Pen Marks in Revision Mode** turns the marks off.

## Writing by hand

Once you've used the pen, a round pen button shows up at the bottom right of the editor. Press it and a box opens at the cursor, so you can write a few words by hand there. On a Samsung tablet the keyboard's handwriting turns what you write with the S Pen into text, in Hebrew too. In Revision Mode it goes in as an insertion, and otherwise as plain text.

Samsung's "S Pen to text" may also work right in the sheet itself, without the box. I'll know once I've tried it on the tablet, and I'll update this page then.

## Sketches

**Insert › Sketch** (also in the markup list, **⌘9**, on the bar above a phone's or tablet's keyboard, and in the menu you get by long-pressing the text) opens a sheet of paper to draw on: a diagram, a map of the plot, a family tree. There are four inks (black, blue, red and a see-through yellow marker), three sizes, an eraser, and Undo, Redo and Clear. The lines get thicker the harder you press, and holding the pen's button erases while you hold it. Once the pen has touched the paper, fingers don't draw, so you can rest your hand on it.

**Done** saves the sketch as an SVG picture in the sheet's `_media` folder and puts it in the sheet like any other picture, which means Obsidian and any browser show it too. To draw on it again, double-click (or double-tap) the picture in the sheet, or right-click it and choose **Edit Sketch…**. Moshe keeps the strokes inside the picture, so you pick up right where you left off. Basically, a sketch is a picture that Moshe can still draw on.

<sub>Next: [Goals and the dashboard](goals-and-dashboard.md) →</sub>
