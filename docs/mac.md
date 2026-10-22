<sub>[Moshe docs](README.md) › Devices and sync</sub>

# The Mac app

The Mac app is Moshe in a window of its own, working on a folder on your Mac, with a full menu bar. The whole interface is the same page as the web app, so everything in these docs works the same in it; the app adds the window, the menus, and the few things a web page can't do well, like saving a PDF straight to a file. The screenshots in these docs are of the web app, and the Mac app looks the same, with the traffic lights at the top left.

How to build and install it is in [Install](install.md).

## The library folder

The first time it opens, Moshe asks for the folder to keep your library in: a folder inside your Obsidian vault, or any folder Syncthing, iCloud Drive or Dropbox keeps in step. Press **Use This Folder**, and an empty folder starts an empty library. Moshe reads and writes that folder directly, and when another app changes something in it, Moshe hears about it within about a third of a second.

The **Moshe** menu has the rest:

- **Library Folder…** chooses another folder.
- **Show Library in Finder** opens the folder.
- **Use the Server…** opens the library on a Moshe server instead, the server's page and all, after asking for the address. Type your own server's address there.

If the folder has gone, say an external disk that isn't plugged in, Moshe asks again, and offers **Use the Server** or **Quit** instead.

## The window

The window is all page: the page runs right up to the top edge, and the traffic lights sit in the library's bar. Drag an empty part of any pane's bar to move the window, and double-click it to zoom. Moshe remembers where the window was, and **⌃⌘F** makes it full screen. **File › New Window**, or **⌥⌘N**, opens a second window on the same library, which is handy for a reference text on another screen.

Links in a sheet open in your browser, and nothing but Moshe ever loads in the window.

## The menu bar

The menu bar has everything, menu by menu and key by key: **File**, **Edit**, **Markup**, **Insert**, **View**, **Go**, **Window** and **Help**. Each item does what the same key does in the page, so pressing the key and choosing the item come to the same thing. Ticks and changing titles (**Show Library** and **Hide Library**, **Add to Favorites** and **Remove from Favorites**) show what's true right now, and the submenus are built from your library: **Go › Notes** and **Go › Projects** list your groups and projects, **View › Theme** your themes. An item Moshe doesn't have yet is greyed out.

A few things are only in the menus:

- **Edit › Copy** › **Copy as Markdown**, **Copy as HTML**, **Copy as Rich Text**, and **Edit › Paste** › **Paste from Markdown**, **HTML** or **Rich Text**, and **Paste as Code Block**.
- **Insert** › **Divider**, **Image**, **Footnote**, **Equation**, **Table** and **Table of Contents**.
- **View** › **Show Paragraph Numbers**, **Sheet List** for the sort order and **Show Dates**, **Highlight** and **Fixed Scrolling** for the typewriter, and **Appearance**.
- **Window** › **Quick Export** (**⌘6**), **Statistics** (**⌘7**), **Navigation** (**⌘8**), **Markup** (**⌘9**) and **Keyword Manager**.
- **File** › **Print…** (**⌘P**) and **Share…**.

**Help › Moshe Help** opens this project's page on GitHub, which leads here. The whole list, item by item, is in [MENUS.md](MENUS.md).

## What the Mac adds

- **PDFs.** **Export PDF…** makes the PDF with the Mac's own printing, on the paper and margins the export style asks for, draws the page numbers on, and saves it where the save panel says. **File › Print…** sends the same PDF to the print panel.
- **Saving and sharing.** The other exports get a save panel, and **File › Share…** hands the file to the share sheet, a PDF too.
- **Pictures.** A picture you paste or drop into a sheet is saved in the library folder, beside the sheet.
- **Spelling and grammar.** Besides Moshe's own checks, the Mac's spelling and grammar underline as you type, as in any Mac app, and **Edit › Spelling and Grammar** turns them off. If you've turned spell checking off for every app on your Mac and want it in Moshe alone, run `defaults write xyz.tiresia.moshe NSAllowContinuousSpellChecking -bool true`.

## Backups and Check Text

When the Mac app works on a folder, there's no server behind it on the Mac. If the same folder is also a Moshe server's library, through Syncthing as mine is, that server backs it up, and if the app syncs with a server over WebDAV, that server does; otherwise, Time Machine is the answer. **Settings › Backup** says what Moshe knows about it. For the same reason, **Check Text** needs the app to use the server's page; the as-you-type checks work everywhere.

<sub>Next: [The Android app](android.md) →</sub>
