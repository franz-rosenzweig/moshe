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

The window looks like Windows 11's own apps: one title bar, in the same soft material as theirs, with the menus at the left, your library's name at the right ("Writing - Moshe") and the usual buttons beside it, Snap Layouts included. Moshe remembers where the window was. **Ctrl+Alt+N** opens a second window on the same library, handy for a reference text on another screen, and **Ctrl+W** closes one. Links in a sheet open in your browser, and nothing but Moshe ever loads in the window.

**F11**, or **View › Full Screen**, makes the window full screen, and either one again brings it and its title bar back, from Moshe's own full screen too. **Esc** also leaves the full screen that Moshe's page asks for. For the first few seconds a note at the top says which key to press.

**Ctrl** and **+** or **−** makes the text bigger or smaller, **Ctrl+0** brings it back to the usual size, and so do **Ctrl** with the mouse wheel and a pinch on the touchpad. It's the same as **View › Zoom**, and the size is remembered.

## The menus

The title bar has five menus, with everything the Mac app's eight have and **Ctrl** where the Mac has **⌘**:

- **File**: new sheets and groups (**New ▸**), **Open Quickly…**, what you can do to a sheet (**Sheet ▸**: favorites, material, keywords, a goal, glue, merge, duplicate), **Export…**, **Print…**, **Share…**, the library folder and the server, windows, and **Settings**.
- **Edit**: undo, the clipboard (with **Copy As ▸** and **Paste As ▸** Markdown, HTML and Rich Text), finding, moving a line or a sheet, splitting, attaching.
- **Format**: what the Mac calls Markup and Insert: **Strong**, **Emphasis**, **Link**, **Mark ▸**, **Heading ▸**, lists, blocks, **Insert ▸** (images, footnotes, tables, equations…), and **Clear Markup**.
- **View**: the library and the second editor, the dashboard, the sheet list's order, the side **Panels ▸**, **Go To ▸** your groups and projects, translation, revision and focus modes, voice (**Voice**, **Start Listening**, **Voice Model ▸**), the text's counter and highlighting, **Zoom ▸**, the appearance and the theme, and full screen.
- **Help**.

**Alt** and a menu's letter opens it, as in any Windows app: **Alt+F** File, **Alt+E** Edit, **Alt+O** Format, **Alt+V** View, **Alt+H** Help; **Alt** alone moves to the menu bar. Each item does what the same key does in the page, then hands the keyboard back to your sheet. Ticks and changing titles (**Show Library** and **Hide Library**, **Add to Favorites** and **Remove from Favorites**) show what's true right now, and the submenus are built from your library: **View › Go To › Notes** and **Projects** list your groups and projects, **View › Theme** your themes. The Mac's few keys that use both ⌃ and ⌘ have no Windows key, so on Windows those are in the menus only: **Add to Favorites**, **Mark as Material**, **New › Filter…**, **Move Line Up** and **Down**. The whole list, the Mac's way, is in [MENUS.md](MENUS.md).

**Right-click** in a sheet for the formatting too: after any spelling suggestions come **Strong**, **Emphasis**, **Code**, **Link**, **Mark**, **Heading** and **Insert**, then Cut, Copy and Paste.

## What Windows adds

- **PDFs.** **Export PDF…** makes the PDF on the paper and margins the export style asks for, with its page numbers, and saves it where you say. **File › Print…** opens the print dialog.
- **Saving and sharing.** The other exports get a save dialog, and **File › Share…** hands the file to Windows' share sheet, a PDF too.
- **Pictures.** A picture you paste or drop into a sheet is saved in the library folder, beside the sheet.
- **Spelling.** Besides Moshe's own checks, Windows' spell checker underlines as you type, with suggestions when you right-click.

## Writing by voice

Turn it on in **Settings › Voice**, or **View › Voice**, then **Ctrl+Alt+L** or **View › Start Listening** starts and stops listening. What voice can do, and the rule it follows, is in [Voice](VOICE.md). On Windows, Moshe listens with Whisper on your PC: nothing you say leaves it, and it works offline from the first time. It writes each sentence down about half a second after you pause.

- **View › Voice Model** chooses between **Whisper base.en**, built in and quicker, and **Whisper small.en**, which hears more exactly and takes about four times as long. The first time you choose small.en, Moshe fetches it (488 MB) from Hugging Face.
- Moshe's own Whisper hears English. For Hebrew, choose **Whisper, on This Computer** in **Settings › Voice**: Moshe's page has a multilingual model.
- Moshe uses the microphone Windows' sound settings choose. If Windows keeps it from desktop apps, the strip under the text says so: allow it in **Settings › Privacy & security › Microphone**.
- Reading aloud ("read that back") uses Windows' own voices.

## Backups and Check Text

When the Windows app works on a folder, there's no server behind it on the PC. If the same folder is also a Moshe server's library, through Syncthing, that server backs it up, and if the app syncs with a server over WebDAV, that server does; otherwise, File History or OneDrive's version history is the answer. For the same reason, **Check Text** needs the app to use the server's page; the as-you-type checks work everywhere.

<sub>Next: [The Android app](android.md) →</sub>
