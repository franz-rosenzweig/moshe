# Moshe for macOS — design notes

How the Mac shell was put together, what it adds to the page, how to check
it, and what is still open. Read, in order: `docs/FORMAT.md` (the library on
disk), `docs/BRIDGE.md` (the contract), then this. Building and running it
are in [README.md](README.md).

**What Moshe is**: a writing app whose library is a folder of Markdown files
(`Notes/`, `Projects/`, groups as folders, sheets as `.md`). The whole
interface is the web app in `frontend/`, running the engine (`engine/src`) in
the page. The Mac app is a shell around it in **folder mode**: the page reads
and writes a folder on the Mac through the bridge.

**The library folder** can be any folder, typically one inside an Obsidian
vault that Syncthing (or iCloud Drive, Dropbox) keeps in step with a server,
which serves the same folder at its web address. Obsidian keeps working on it
at the same time; the page handles edits from elsewhere.

## Where it started: Dvarim's shell

Most of what Moshe needs, the Mac app of Dvarim (a to-do app built the same
way) already did. Its `mac/` folder was copied into `moshe/mac/`, then:

**Kept and renamed** (`dvarim` → `moshe`, `Dvarim` → `Moshe`):
- `AppScheme.swift` → serves `Resources/web` at **`moshe-app://app/`**.
- `FolderBridge.swift` → the handler is **`mosheStorage`**; the change callback
  is **`window.__mosheFilesChanged()`**; temporary files are `*.moshe-tmp`.
  It takes care with names (rename(2)/mkdir(2), `enumerator(atPath:)`: Hebrew
  file names are common — `פרק ראשון.md`). The `list` reply carries **`mtimes`**
  (`{path: ms}` for every file), so the page reads only changed files on a
  rescan, which matters for a library of long sheets.
- `Library.swift` → folder mode by default (first run: an open panel to choose
  the library folder; remember it as a security-scoped bookmark if the app is
  ever sandboxed). Server mode stays as a fallback: the address, then the
  site's page.
- `build.sh`, `project.yml`, `selftest.sh`: bundle id `xyz.tiresia.moshe`,
  name Moshe, the icon from `frontend/public/icons/icon-1024.png` (a white
  camel on yellow).
- The user agent: `Moshe/<version> (macOS shell)` — the page leaves 78 px for
  the traffic lights when it sees it.

**Dropped**: Quick Entry and its hotkey, the menu bar Today, the Dock badge,
reminders, the Outbox, the to-do App Intents, `LocalPage.swift`, calendars.

## What the shell adds

1. **The window.** Full-size content view, transparent title bar, no
   toolbar, the traffic lights floating over the library pane (the page draws
   everything else). Minimum size about 900×600. The frame is remembered.
   Full screen with ⌃⌘F.
2. **Menus.** Each item calls the page:
   `webView.evaluateJavaScript("window.mosheCommand('newSheet')")`. With the
   key equivalent on the menu item, AppKit handles the key before the page,
   so each action runs once. The full list is in `docs/MENUS.md`; the core:

   | menu | items (key) → `mosheCommand` name |
   | --- | --- |
   | File | New Sheet (⌘N) `newSheet` · New Material Sheet (⌃⌥⌘N) `newMaterialSheet` · New Group (⇧⌘N) `newGroup` · New Project… `newProject` · Import… (⇧⌘I) `import` · Export… (⇧⌘P) `export` · Move to Trash (⌘⌫) `trash` |
   | Edit | the standard Undo/Redo/Cut/Copy/Paste/Select All (to the web view) · Find (⌘F) `find` · Open Quickly (⌘O) `openQuickly` |
   | Format | Strong (⌘B) `strong` · Emphasis (⌘I) `emphasis` · Link (⌘K) `link` · Mark (⇧⌘H) `mark` · Comment (⇧⌘C) `comment` · Heading 1–6 (⌥⌘1…6) `heading`, arg 1–6 · Paragraph (⌥⌘0) `heading`, arg 0 |
   | Sheet | Duplicate (⌘D) `duplicate` · Favorite (⌃⌘U) `favorite` · Move Up/Down (⌃⌘↑/↓) `moveUp` `moveDown` |
   | View | Library/Sheets/Editor (⌘1/⌘2/⌘3) `showLibrary` `showSheets` `showEditor` · Dashboard (⌘4) `dashboard` · Favorites (⇧⌘U) `favorites` · Switch Editor (⌥⌘→/←) `otherEditor` · Translation Mode (⇧⌘T) `translation` · Revision Mode (⇧⌘E) `revision` · Zoom In/Out/Actual Size (⌘+ ⌘− ⌘0) `zoomIn` `zoomOut` `zoomReset` · Enter Full Screen (⌃⌘F) native |
   | Go | Back (⌘[) `back` · Forward (⌘]) `forward` |
   | Moshe | Settings… (⌘,) `settings` |

   `mosheCommand(name, arg)` returns `true` if the page knows the name.
3. **`window.mosheShell`** (docs/BRIDGE.md §5), injected at document start:
   - `savePdf(html, fileName)`: load the HTML in an offscreen `WKWebView`,
     then `printOperation(with:)` with an `NSPrintInfo` whose job disposition
     is *save* to the URL an `NSSavePanel` gave (the HTML's `@page` sets size
     and margins; honour it, or read A4/Letter from `@page size`).
     `createPDF` alone gives one tall page — not that.
   - `saveFile(fileName, base64, mime)`: `NSSavePanel`, write the bytes.
   - `share(fileName, base64, mime)`: `NSSharingServicePicker` (Mail, AirDrop).
   - `openExternal(url)`: `NSWorkspace.shared.open`. Any navigation away from
     `moshe-app://` also opens in the browser, never in the window.
4. **FSEvents** on the library folder → `window.__mosheFilesChanged()`
   (≈0.3 s latency; `info.pollSeconds: 0`).
5. **More windows**: ⌥⌘N opens another window on the same folder (each its own
   page; the pages see each other's writes through FSEvents).
6. **Spelling**: the editor is a contenteditable; the web view's continuous
   spell checking and grammar checking are on so the system underlines work,
   and the page's text direction (Hebrew per paragraph) stands.
7. **Images** (docs/BRIDGE.md): op `writeBytes` (base64 → file, atomic), and
   the scheme handler also serving `moshe-app://app/_library/<path>` from the
   library folder, so pasted and dropped images show in the editor. A file
   dragged from Finder into the editor arrives in the page as a normal drop.
8. **Printing**: File › Print… (⌘P) → `window.mosheCommand('export')` (the
   export window has PDF).

## Check it

1. `cd frontend && npm ci && npm run build` (the web build), then
   `mac/build.sh`.
2. Folder mode on a **copy** of a library first: `node tools/sample-library.mjs
   /tmp/moshe-sample` makes one (Notes, the Getting Started sheets, a Novel
   project, a Hebrew/English translation project).
3. In the app's console or a self-test:
   `await window.__mosheLocal.conformance()` → every check ok.
4. By hand: new sheet (⌘N), type a title and Return, see `Title.md` appear in
   Finder; rename a group and see the folder renamed; edit the file in
   Obsidian and watch the editor take it; type in the same sheet in both at
   once and see both edits kept; ⇧⌘P → PDF saves a paginated PDF; ⇧⌘T in the
   translation project shows the two sides.
5. Then point it at your real library folder.

## Later

A share extension ("Add to Moshe" from any app → a new sheet in the Inbox,
via `moshe-app://app/?share=<text>` — the page handles `?share=`),
Shortcuts actions (New Sheet, Append to Sheet), Spotlight.

## Open work: other people's builds

Moshe is meant to be built by anyone from this repository (no Developer ID,
no releases). Moshe is GPL-3.0-or-later (`LICENSE`). On the Mac side:

1. **No built-in server.** `Library.defaultServer` is
   `https://moshe.tiresia.xyz/`, so a build falls back to that server. Make
   it a build setting instead: `mac/build.sh` reads `MOSHE_DEFAULT_SERVER`
   into the Info.plist (empty when unset), and with no default **Use the
   Server…** asks for an address (no placeholder that is a real address).
   Existing installs must keep working: either their builds set
   `MOSHE_DEFAULT_SERVER`, or the first launch of the new build stores the
   old default in `serverKey` when nothing is stored and the app was already
   set up.
2. **About Moshe:** `NSHumanReadableCopyright` in `project.yml` →
   "© 2026 the Moshe authors. Free software under the GNU GPL, version 3 or
   later."
3. **Help › Getting Started:** `mosheCommand('gettingStarted')` adds the
   Getting Started sheets to the Inbox again (docs/MENUS.md).
4. **Help › Moshe Help** opens the repository's README.
