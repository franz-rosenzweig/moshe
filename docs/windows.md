<sub>[Moshe docs](README.md) › Devices and sync</sub>

# The Windows app

The Windows app is Moshe in a window of its own, working on a folder on your PC, with a menu bar. The whole interface is the same page as the web app, so everything in these docs works the same in it; the app adds the window, the menus, and the few things a web page can't do well, like saving a PDF straight to a file. It runs on Windows 11, and on Windows 10 with the WebView2 Runtime, which recent Windows 10 has.

## Installing it

Download `Moshe-…-Setup.exe` from the project's releases on GitHub and run it. It installs Moshe for you alone, without asking for an administrator, and puts it in the Start menu. The app isn't signed, so the first time Windows says it comes from an unknown publisher: press **More info**, then **Run anyway**. The portable zip beside it is the same app, to unzip anywhere. How it's built is in [windows/README.md](../windows/README.md).

## The library folder

The first time it opens, Moshe asks for the folder to keep your library in: a folder inside your Obsidian vault, or any folder Syncthing or OneDrive keeps in step. An empty folder starts an empty library. Moshe reads and writes that folder directly, and when another app changes something in it, Moshe hears about it within about a third of a second.

The **File** menu has the rest:

- **Library Folder…** chooses another folder.
- **Show Library in File Explorer** opens the folder.
- **Use the Server…** opens the library on a Moshe server instead, the server's page and all, after asking for the address.

If the folder has gone, say a drive that isn't plugged in, Moshe asks again, and offers the server or **Quit** instead.

### Names Windows won't take

A Mac or a phone allows file names Windows doesn't: a name with `: * ? " < > |` in it, one that ends with a dot or a space, and a few Windows keeps for itself, like `CON` and `NUL`. If a sheet or a group has one, Moshe on Windows says it can't save it under that name, and saves nothing half-way; rename it, here or on the device it came from, and it saves. When another app has a file open, Moshe waits a moment for it, and writes it anyway if the other app allows that.

## The window

Moshe remembers where the window was. **F11** makes it full screen, **Ctrl+Alt+N** opens a second window on the same library, handy for a reference text on another screen, and **Ctrl+W** closes one. Links in a sheet open in your browser, and nothing but Moshe ever loads in the window.

## The menu bar

The menu bar has everything, menu by menu: **File**, **Edit**, **Markup**, **Insert**, **View**, **Go**, **Window** and **Help**, the same items as the Mac app's with **Ctrl** where the Mac has **⌘**. Each item does what the same key does in the page. Ticks and changing titles (**Show Library** and **Hide Library**, **Add to Favorites** and **Remove from Favorites**) show what's true right now, and the submenus are built from your library: **Go › Notes** and **Go › Projects** list your groups and projects, **View › Theme** your themes. The Mac's few keys that use both ⌃ and ⌘ have no Windows key, so on Windows those are in the menus only: **Add to Favorites**, **Mark as Material**, **New Filter…**, **Move Line Up** and **Down**. The whole list is in [MENUS.md](MENUS.md).

## What Windows adds

- **PDFs.** **Export PDF…** makes the PDF on the paper and margins the export style asks for, with its page numbers, and saves it where you say. **File › Print…** opens the print dialog.
- **Saving and sharing.** The other exports get a save dialog, and **File › Share…** hands the file to Windows' share sheet, a PDF too.
- **Pictures.** A picture you paste or drop into a sheet is saved in the library folder, beside the sheet.
- **Spelling.** Besides Moshe's own checks, Windows' spell checker underlines as you type, with suggestions when you right-click.

## Backups and Check Text

When the Windows app works on a folder, there's no server behind it on the PC. If the same folder is also a Moshe server's library, through Syncthing, that server backs it up, and if the app syncs with a server over WebDAV, that server does; otherwise, File History or OneDrive's version history is the answer. For the same reason, **Check Text** needs the app to use the server's page; the as-you-type checks work everywhere.

<sub>Next: [The Android app](android.md) →</sub>
