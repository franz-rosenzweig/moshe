# Moshe for Windows

A native shell around the web app in `frontend/`, which stays the whole
interface, as on the Mac (`mac/README.md`). The shell gives the page a folder on
this PC to keep the library in (docs/BRIDGE.md), a window with a menu bar, and
the few things a page cannot do well. C# and WinUI 3, with the page in WebView2.

- **The library is a folder**: first run asks for one — a folder in the Obsidian
  vault, or any folder Syncthing or OneDrive keeps in step; an empty one starts an
  empty library. The page reads and writes it through `FolderBridge.cs` (the ops
  themselves are `Moshe.Core/FolderFiles.cs`), and a FileSystemWatcher tells it
  within about 0.3 s when Obsidian, Syncthing or OneDrive change something. File ›
  Library Folder… chooses another; File › Use the Server… opens the library on the
  server instead, the page and all.
- **Windows' own rules for names**: a name Windows can't keep (one with `: * ? " < > |`,
  one ending in a dot or a space, `CON`, `NUL` and the rest) is refused as `EINVAL`
  with a message that says so, rather than half-written. A file another app holds
  open is waited for, then written in place if it can't be replaced; a junction or
  link out of the library is refused like `..`.
- **The window**, as Windows 11's own apps have it: the page under one Mica title
  bar that holds the icon, the menus and the library's name ("Writing - Moshe"),
  with the system's caption buttons, their Snap Layouts, and colours that follow
  light and dark. The frame is remembered; Ctrl+Alt+N opens another window on the
  same folder, Ctrl+W closes one. Scrollbars are Windows 11's thin ones (WebView2's
  Fluent overlay style).
- **Full screen** is one state with two ways in: F11 or View › Full Screen, and the
  page's own (the Fullscreen API). The title bar is hidden exactly while the window
  is full screen, even when Windows itself takes it out (Win+↓); F11 or the menu
  takes it out of both at once, and Esc out of the page's. A word at the top says
  how, for three seconds.
- **Text size** the Windows way: Ctrl and + or −, Ctrl+0, and Ctrl with the mouse
  wheel or a pinch go to the page's own View › Zoom (`zoomIn`, `zoomOut`,
  `zoomReset`), never to the browser's zoom of the whole window. WebView2's zoom
  control stays on, because with it off WebView2 keeps Ctrl+Plus and Ctrl+Minus
  from the page.
- **The menus**: every item of docs/MENUS.md, with Ctrl for ⌘, gathered into the
  five a Windows writing app has: **File** (with New ▸ and Sheet ▸), **Edit**,
  **Format** (the Mac's Markup and Insert), **View** (with the Mac's Go and the
  Window menu's panels) and **Help**. Alt and F, E, O, V or H opens one; Alt alone
  moves to the menu bar. Each item calls the page's own command
  (`window.mosheCommand`), then gives the keyboard back to the page; ticks, titles
  that change, and the submenus built from the library come from
  `window.mosheMenuState()` when a menu is pressed open. The page hears every key
  first, so the menu only shows the keys; Cut, Copy, Paste and Select All press
  theirs in the page. ⌃⌘ chords have no Windows key: those items are in the menu
  only. The browser's own keys (Ctrl+P, Ctrl+F, Ctrl+R…) are off, so they reach
  the page.
- **Right-click** in a sheet: the spelling suggestions, then Strong, Emphasis,
  Code, Link, Mark ▸, Heading ▸, Insert ▸ and Clear Markup, then Cut, Copy and
  Paste. A browser's own items (Back, Reload, Save as, Print…) are taken out.
- **`window.mosheShell`** (docs/BRIDGE.md §5): a paginated PDF, printed by WebView2
  with the export's `@page` for the paper and margins and its margin boxes for the
  page numbers, which Chromium draws itself; a save dialog for the other exports;
  the share sheet (a PDF too); both kinds of clipboard for Copy as HTML; and the
  browser for links. Print… is the page's own, in WebView2's print dialog. Nothing
  but the app ever loads in the window: any other address opens in the browser.
- **Pictures**: pasted or dropped images are saved in the folder (`writeBytes`) and
  shown from it (`https://moshe-app.example/_library/…`).
- **Spelling**: Windows' spell checker, underlined as you type, with suggestions on
  a right-click.
- **Writing by voice** (docs/VOICE.md, Windows): `mosheShell.voice`, with Whisper
  through whisper.cpp on this PC and offline. The microphone's sound goes through
  the Mac's pause gate, ported line for line; at each pause, Whisper writes the
  utterance down, with the project's names and the commands as its prompt, and
  the page carries it out. base.en is built in; View › Voice Model fetches
  small.en once. View › Voice and View › Start Listening (Ctrl+Alt+L) are there
  too. The microphone goes to the app's own page only, for its own Whisper when
  Settings › Voice chooses it. Reading aloud is the page's own, with Windows' voices.

The page needs nothing of its own for Windows: it already speaks Android's
transport (`window.MosheStorage.request(id, json)`, answered by
`window.__mosheStorageReply`), and the shell carries that over WebView2's web
messages. The user agent ends in `Moshe/<version> (Windows shell)`.

## Build it

On GitHub: every push that touches `windows/`, `frontend/` or `engine/` runs the
Windows workflow (`.github/workflows/windows.yml`), and the run keeps the
installer and a portable zip. A tag `windows-vX.Y.Z` also makes the release.

On a Windows PC with Node 22, the .NET 10 SDK, Python, and (for the installer)
Inno Setup 6:

```powershell
windows\build.ps1               # build\Moshe is the app; build\out the installer
windows\build.ps1 -SmallModel   # with Whisper small.en built in as well (488 MB more)
```

`windows\tools\get-models.ps1` fetches Whisper's models from Hugging Face into
`build\models` and checks each against its SHA-256; the build copies them in as
`Models\`. Without one there, the app builds without its own recognizer, and
voice uses the page's Whisper.

The installer is for one person and needs no administrator: it copies the app to
`%LOCALAPPDATA%\Programs\Moshe`. Settings and the page's own storage are in
`%LOCALAPPDATA%\Moshe`, with `moshe.log`. The app isn't signed, so Windows says
the publisher is unknown the first time: More info › Run anyway.

## Test it

```powershell
dotnet run --project windows\Tests     # the folder code, and the same ops through tools\bridge_sim.py
windows\selftest.ps1                   # the built app on a scratch library
```

The tests run every op of docs/BRIDGE.md on a scratch folder, the Windows edges
(the names, a junction out, a file held open, a read-only file, renames by case),
and a list of messages through both `FolderFiles` and the reference, answer for
answer, and the pause gate on made-up sound: where an utterance starts and ends,
a click, a breath, the 15 s limit, and Whisper's prompt. The self-test runs the
real app with `--selftest` on a scratch library,
with no dialog for anyone to answer: the bridge's conformance checks in the page,
`/_library/`, a file written from outside reaching the page, a PDF on A5, saving,
sharing, links out, and the menus' state. The PDF it made is kept with the
workflow's run. Then voice: the Mac's nine sentences, spoken by Windows' own
voice into a file (`tools\speak.ps1`) that the app hears instead of the
microphone (`--voice-file`), and what the sheet became; Ctrl+Alt+L; the
microphone for the page; reading aloud, word by word.

## The pieces

| file | |
| --- | --- |
| `Moshe/App.xaml.cs` | the app: launching, the WebView2 environment |
| `Moshe/ShellWindow.xaml.cs` | a window: the page, the messages, links out, the first-run folder choice, where the window is |
| `Moshe/Menus.cs` | the menu bar and what its items call |
| `Moshe/Library.cs` | where the library is: the folder, or the server |
| `Moshe/FolderBridge.cs` | docs/BRIDGE.md's messages, in order, and the watcher |
| `Moshe/AppScheme.cs` | `https://moshe-app.example/`: the web app, and `/_library/` from the folder |
| `Moshe/ShellServices.cs`, `PdfMaker.cs` | `window.mosheShell`: PDF, save, share, clipboard, links |
| `Moshe/Scripts.cs` | what goes into the page before its own scripts |
| `Moshe/SelfTest.cs` | the self-test |
| `Moshe/Voice.cs` | `mosheShell.voice`: the microphone, Whisper, the models |
| `Moshe.Core/PauseGate.cs`, `Utterances.cs` | the pause gate, and the utterances it cuts; what Whisper is given and what it wrote |
| `Moshe.Core/FolderFiles.cs` | every op of docs/BRIDGE.md on the Windows file system |
| `Moshe.Core/ShellHttp.cs` | the bridge's `http` op, for the page's WebDAV sync |
| `Tests/Program.cs` | the folder code's and the pause gate's tests |
| `tools/get-models.ps1`, `tools/speak.ps1` | Whisper's models, fetched and checked; sentences spoken into a WAV for the tests |

Later: signing, so Windows knows the publisher; an ARM64 build; updates from the
releases; Moshe in the Share sheet as a target; Whisper on the graphics chip
(whisper.cpp's Vulkan build); a multilingual model for Hebrew.
