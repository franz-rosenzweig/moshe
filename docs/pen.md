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

For turning handwriting into text, Moshe leaves it to the tablet, which does it well already. On a Samsung tablet, the keyboard's handwriting mode writes into a sheet like any other text field, in Hebrew too, and so does the box a caret opens in Revision Mode.

## Handwritten sheets

Sometimes I just want to write, the way I would in a notebook, and nothing should turn my writing into text while I do. So a sheet can be handwritten: press the pen button next to **New Sheet** in the sheet list (or **File › New Handwritten Sheet**), and the sheet opens as a page of paper. Write on it with the pen, as much as you like. Nothing is recognised or changed, it's just your handwriting. The page works a lot like Samsung Notes, because that's what my hand is used to.

### Pens and the highlighter

Along the top are the pen, the highlighter, the eraser, the lasso and text, then the colours you used last, your favourite pens, Undo and Redo, the page's settings, reading mode, ⋮ and **Type It Up**. Tap the pen again and its panel opens: six kinds of pen (fountain pen, calligraphy pen, pen, pencil, calligraphy brush and marker), a size from 1 to 100, opacity, and the colours, with the wheel for any colour at all. Each kind of pen remembers its own size and colour. **Add to Favourites** keeps the pen just as it's set, next to the colours on the bar, and a right-click or a long press on a favourite takes it off.

The highlighter has its own button and its own colours. It always goes under the writing, so it never dims it, and where two highlights cross the colour doesn't get darker.

### The S Pen's button

Hold the button down while you write and the pen erases. Click it (press and let go) with the pen just above the page, not touching, and the round pen menu opens: the pen you're holding in the middle (tap it for all the pens, the eraser and the lasso), its size on the left, its colour on the right (tap it for the colours), Undo and Redo at the top, and your favourites at the bottom, with **+** to add the pen you're holding. On a tablet there's also a round button in the bottom corner that opens the same menu, in case your tablet keeps the button press to itself (⋮ hides it).

### The eraser

Tap the eraser again for its settings. It can erase only what it passes over, which cuts a stroke in two, or whole strokes at a time. You can set its size, and whether it takes all the ink, only the pen or only the highlighter. **Erase the Page** clears everything, and Undo brings it back.

### The lasso

Draw round some writing with the lasso and it's held in a box. Drag the box to move it, drag a corner to make it bigger or smaller, and the bar above it has **Cut**, **Copy**, **Duplicate**, **Delete** and **Style** (another pen, another colour, thinner or thicker). To paste, tap the page with the lasso and press **Paste**, on this page or on another one. On a keyboard, ⌘C, ⌘X, ⌘V, ⌘D and Delete work too.

### Text on the page

The **T** on the bar puts typed text on the page, next to your handwriting. Tap where it should go and type, with the keyboard or the tablet's own handwriting keyboard. Tap somewhere else (or press Escape) and it's on the page. Tap a text box with **T** again to change it, and empty it to take it away. Tap **T** once more for the size, the font (plain or handwritten) and the colour. Hebrew goes from the right, as it should. The lasso picks up text boxes along with the ink, to move them, resize them, copy them or change their colour, and the eraser leaves them alone. In Excalidraw they're ordinary text you can edit there too.

### Shapes

Draw a line, a circle, a rectangle or a triangle, keep the pen still at the end for a moment, and it snaps into a clean shape. A line that's nearly level comes out level. Handwriting is left alone.

### The page

The page button has the page's colour (white, cream, yellow, a few soft ones and three dark ones), its paper (lined, blank, dotted, grid or Cornell) and the view: one long page that keeps growing as you write, or separate pages, one under the other, with **Add a Page** at the bottom. When you switch to a dark page, black ink turns white, and back again. **Use for New Pages** makes new handwritten sheets start the same way (**Settings › General › Handwriting** sets the paper too).

### Fingers, zooming and reading

Your fingers scroll the page and never write, so you can rest your hand on it, and two fingers pinch to zoom (on a computer, pinch the trackpad or hold ⌘ or Ctrl and scroll). The number in the corner shows how far in you are, and tapping it fits the page again. **Reading mode** (the open book) makes the pen scroll instead of write, so you can read through a page without marking it. On a device with no pen, ⋮ › **Fingers write** lets a finger write, and on a computer the mouse or trackpad always does.

### Typing it up

When you want to type it up, press **Type It Up**. The page stays on one side and the sheet's text opens on the other (or underneath, on an upright screen), so you can read your handwriting and type it in. The typing goes into the same sheet, under a picture of the page. **Done Typing** gives the whole screen back to the page.

### Where it's kept

Everything is saved as you go, as plain files beside the sheet in `_media`. The page itself is an Excalidraw drawing (`.excalidraw.md`), which means Obsidian's Excalidraw plugin opens it and you can keep drawing on it there. Next to it is an SVG picture of the page, which is what the sheet shows, in Moshe and in Obsidian. Excalidraw draws every stroke the way it draws its own, like the fountain pen, but Moshe remembers which pen each one was. If you change the drawing in Excalidraw, Moshe redraws the picture the next time you open the sheet. Moshe draws Excalidraw's shapes, arrows and text plainly, and leaves anything it doesn't draw itself exactly as it was.

## Sketches

**Insert › Sketch** (also in the markup list, **⌘9**, on the bar above a phone's or tablet's keyboard, and in the menu you get by long-pressing the text) opens a sheet of paper to draw on: a diagram, a map of the plot, a family tree. There are four inks (black, blue, red and a see-through yellow marker), three sizes, an eraser, and Undo, Redo and Clear. The lines get thicker the harder you press, and holding the pen's button erases while you hold it. Once the pen has touched the paper, fingers don't draw, so you can rest your hand on it.

**Done** saves the sketch as an SVG picture in the sheet's `_media` folder and puts it in the sheet like any other picture, which means Obsidian and any browser show it too. To draw on it again, double-click (or double-tap) the picture in the sheet, or right-click it and choose **Edit Sketch…**. Moshe keeps the strokes inside the picture, so you pick up right where you left off. Basically, a sketch is a picture that Moshe can still draw on.

<sub>Next: [Goals and the dashboard](goals-and-dashboard.md) →</sub>
