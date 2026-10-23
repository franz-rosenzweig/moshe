# Moshe for macOS

A native shell around the web app in `frontend/`, which stays the whole
interface. The shell gives the page a folder on this Mac to keep the library
in (docs/BRIDGE.md), a window that is all page, the menus, and the
few things a page cannot do well.

- **The library is a folder**: first run asks for one — `Notes/Writing` in the
  Obsidian vault, or any folder; an empty one starts an empty library. The page
  reads and writes it through `FolderBridge.swift`, and FSEvents tells it within
  about 0.3 s when Obsidian, Syncthing or iCloud change something. Moshe → Library
  Folder… chooses another; Moshe → Use the Server… opens the library on the server
  instead, the page and all: the address typed there, or the one the build was
  given (`MOSHE_DEFAULT_SERVER`, from the environment or `mac/local.env`, which
  git leaves out). Without either it asks.
- **The window**: the page runs to the top edge under a transparent title
  bar; the traffic lights float in the middle of the library's bar; an empty part
  of any pane's bar moves the window, and a double-click zooms it. The frame is
  remembered. At least 900 × 600. ⌃⌘F for full screen, ⌃⌘N for another window on
  the same folder.
- **The menu bar**, item for item and key for key (docs/MENUS.md): File, Edit, Markup, Insert, View, Go, Window. Each item
  calls the page's own command (`window.mosheCommand`); what is ticked, what a
  toggle says now, and the submenus built from the library (themes, the
  dashboard's views, Notes and Projects, sort orders) come from
  `window.mosheMenuState()` when a menu opens. The page hears a key first, and a
  key it leaves alone goes on to the menu; the shell's own keys (⌥⌘N New Window,
  ⌃⌘Z Zoom) and ⌃ chords go to the menu first. Either way a command runs once.
- **`window.mosheShell`** (docs/BRIDGE.md §5): a paginated PDF through the print
  system (the export's `@page` sets the paper and margins; the page numbers its
  margin boxes ask for, which WebKit's printing leaves out, are drawn on
  afterwards), print (that PDF, to the print panel), a save panel for the other
  exports, the share sheet (a PDF too), the clipboard for Copy as HTML and Rich
  Text, and the browser for links. Nothing but the app
  ever loads in the window: any other address opens in the browser.
- **Pictures**: pasted or dropped images are saved in the folder (`writeBytes`) and
  shown from it (`moshe-app://app/_library/…`).
- **Spelling and grammar**: the system's, underlined as you type (Edit → Spelling
  and Grammar). Check Spelling While Typing obeys `NSAllowContinuousSpellChecking`,
  the setting that turns it off in every app; to have it in Moshe alone:
  `defaults write xyz.tiresia.moshe NSAllowContinuousSpellChecking -bool true`.

## Build it

macOS 14 or newer, the Command Line Tools (`xcode-select --install`),
`brew install xcodegen`, and Node for the web app.

```sh
cd frontend && npm ci && npm run build && cd ..
mac/build.sh                 # mac/build/Moshe.app, in about ten seconds
open mac/build/Moshe.app     # or copy it to /Applications
```

`xcodegen generate` in `mac/` makes `Moshe.xcodeproj` from `project.yml` for
anyone who would rather use Xcode; both builds read the same settings. The
build signs with an Apple Development identity if the keychain has one, ad hoc
otherwise.

## Test it

```sh
mac/selftest.sh              # every section; or e.g. mac/selftest.sh keys,menus
```

It builds the app with `SelfTest/` linked in, as its own app
(`xyz.tiresia.moshe.selftest`, so Moshe can stay open), and runs it on a fresh
copy of the sample library: the bridge's conformance checks, the window and its
traffic lights, ⌘N/⌘B/⌥⌘2/⌘+ each running once, the menus with the mouse, edits
from another app arriving, a group renamed on disk with its name as typed,
pictures, the save and share calls, PDFs on A4 and Letter measured with PDFKit,
translation mode, and choosing another folder. It takes the keyboard for about
half a minute; a check that needs Moshe in front is skipped, and says so, if
another app keeps the front. Pictures and PDFs land in `mac/build/selftest/out`.

## The pieces

| file | |
| --- | --- |
| `MosheApp.swift` | the app: launching, the first-run folder choice, reopening |
| `Window.swift` | the window, the traffic lights, moving it from the page's bars, links out, alerts and file pickers |
| `Menus.swift` | the menu bar and what its items call |
| `Library.swift` | where the library is: the folder, or the server |
| `FolderBridge.swift` | docs/BRIDGE.md's messages, answered from the folder; FSEvents |
| `AppScheme.swift` | `moshe-app://app/`: the web app, and `/_library/` from the folder |
| `ShellServices.swift` | `window.mosheShell`: PDF, save, share, links |
| `ShellHTTP.swift` | the bridge's `http` op, for the page's WebDAV sync |

Later, as mac/NEXT.md says: a share extension, Shortcuts actions, Spotlight.
