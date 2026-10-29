# The folder bridge

How a native shell (the Mac app, the Windows app, the Android app) gives the page a folder to
keep the library in. It is **Dvarim's bridge** (`dvarim/docs/BRIDGE.md`), with
Moshe's names, without Dvarim's calendar ops, and with a few shell services a
writing app needs (§5). The page's half is `engine/src/storage-bridge.js`.

- **Reference implementation:** `tools/bridge_sim.py`, about a hundred lines of
  Python over a real folder (Dvarim's, renamed).
- **The check a shell must pass:** `engine/src/storage-conformance.js`. From a
  self-test: `await window.__mosheLocal.conformance()` → `{ok, results: [{name, ok, ms, error?}]}`.

If a shell and this document disagree, this document wins.

## The shape of it

```
 ┌──────────── the shell's WebView ─────────────┐
 │  the page, from the app's own bundle          │
 │    engine (store, markup, merge)              │
 │    BridgeStorage ── message ──┐               │
 └───────────────────────────────┼───────────────┘
                                 ▼
          the shell: one message at a time, a folder on disk
          ◄── window.__mosheFilesChanged() when someone else writes it
```

The shell does four things: serves the page from inside the app, answers the
bridge's messages from the folder, tells the page when something else changed
the folder, and offers the few services in §5. Everything else is the page's.

**The folder is the library** (`docs/FORMAT.md`): `Notes/`, `Projects/`,
`.moshe/`. Often it is a folder inside an Obsidian vault, one Obsidian and
Syncthing already see.

## 1. Serving the page

Serve the build (`frontend/dist`, made by `npm ci && npm run build` in
`frontend/`) from inside the app:

| | origin | how |
| --- | --- | --- |
| macOS | `moshe-app://app` | a `WKURLSchemeHandler` registered for `moshe-app` |
| Android | `https://appassets.androidplatform.net` | `shouldInterceptRequest` answering from `assets/web/` |
| Windows | `https://moshe-app.example` | WebView2's `WebResourceRequested`, answering from `web/` beside the app |

- A path that names a file in the build returns that file with its MIME type
  (`.js` is `text/javascript`, `.css`, `.svg`, `.png`, `.webmanifest`,
  `.html`, `.woff2`). Any other path returns `index.html`.
- `/api/` needs no answer: in folder mode the page does its own work.
- **`/_library/<path>`** answers with that file of the *library folder*, as
  bytes, with its MIME type (`.png`, `.jpg`, `.gif`, `.webp`, `.svg`, `.pdf`):
  how the editor shows the images a sheet uses (`![](_media/photo.png)`).
  Refuse a path that leaves the folder.
- No service worker inside a shell.
- **User agent**: add `Moshe/<version> (macOS shell)` on the Mac (the page
  leaves room for the traffic lights when it sees it), `Moshe/<version>
  (Android shell)` on Android, `Moshe/<version> (Windows shell)` on Windows.

## 2. The messages

### Transport

**macOS.** A `WKScriptMessageHandlerWithReply` named `mosheStorage`, added to
the page content world:

```swift
config.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "mosheStorage")
```

The page calls `window.webkit.messageHandlers.mosheStorage.postMessage(msg)`;
reply with `replyHandler(reply, nil)`. Check
`message.frameInfo.securityOrigin`: its protocol must be `moshe-app`.

**Android.** A `@JavascriptInterface` object added as `MosheStorage`:

```java
web.addJavascriptInterface(bridge, "MosheStorage");
@JavascriptInterface public void request(int id, String json) { … }   // return at once; work on a single-thread executor
// reply on the UI thread:
web.post(() -> web.evaluateJavascript("window.__mosheStorageReply(" + id + "," + JSONObject.quote(replyJson) + ")", null));
```

Replies may arrive in any order; the page matches them by `id`. Add the
interface only in the folder-mode activity, and only ever load the app's own
origin there.

**Windows.** Android's transport, carried over WebView2's web messages: a
document-start script defines `window.MosheStorage.request(id, json)`, which
posts `{channel: 'storage', id, json}`; the shell answers with
`PostWebMessageAsJson({channel: 'storage', id, reply})`, and the script hands
`reply` to `window.__mosheStorageReply`. Check the message's `Source`: it must
be the app's origin. (`windows/Moshe/Scripts.cs`, `FolderBridge.cs`.)

### Messages and replies

```json
{ "v": 1, "op": "write", "args": { "path": "Notes/Blog/Post.md", "text": "# A post\n" } }
```
```json
{ "ok": <result> }
{ "error": { "code": "EACCES", "message": "what went wrong, in words a person can act on" } }
```

**One at a time, in the order sent** (a serial queue). A write followed by a
read of the same file must read the new text.

| op | args | ok | notes |
| --- | --- | --- | --- |
| `list` | — | `{files, dirs, mtimes?}` | Every file and directory under the root, empty directories included. May leave out what is inside `.git`, `.obsidian`, `.trash`, `.stfolder`, `.stversions`, `node_modules`. **Must include `.moshe/`.** `mtimes` (optional, recommended): `{path: ms}` for every file — with it the page reads only what changed on a rescan instead of every file. |
| `read` | `path` | `{text, mtime}` or `null` | `null`: no such file, not an error. |
| `readMany` | `paths` | `[{text, mtime} or null, …]` | One answer per path, in order: a whole scan in one round trip. |
| `write` | `path`, `text` | `{mtime}` | Creates parent directories. **Atomic**: write a temporary file beside it (`*.moshe-tmp`), rename it over. |
| `writeBytes` | `path`, `base64` | `{mtime}` | Bytes, for an image pasted or dropped into a sheet (saved in `_media/` beside it). Atomic, like `write`. |
| `remove` | `path` | `null` | A file; quiet if absent. |
| `move` | `from`, `to` | `null` | A file or a directory with everything in it; creates `to`'s parents. **`EEXIST` if a file or non-empty directory is at `to`**; a directory may replace an empty one (rename(2)). `ENOENT` if `from` is absent. Groups are moved and renamed this way, so it must be fast for a folder. |
| `mkdir` | `path` | `null` | And its parents; quiet if present. |
| `removeDir` | `path` | `true`/`false` | Only if empty. `true` if no directory is there afterwards. |
| `info` | — | `{name, detail, canPick, canUseServer, pollSeconds, http, changes}` | `name`: the folder's name; `detail`: where it is. `pollSeconds`: how often to rescan while in front (`0` if the shell reports changes itself, as the Mac does; about 15 on Android). |
| `pick` | — | `{changed}` | Offer the folder picker; reload the page if one was chosen. |
| `useServer` | — | `null` | Switch to server mode (the server's page). |
| `http` | `url`, `method`, `headers`, `body` | `{status, headers, body}` | Optional: one HTTP request made by the shell, for the built-in WebDAV sync to a server that answers no page from another origin (Nextcloud). No redirects, no cookies, 30 s timeout, `https:` or a tailnet `http:` only. Runs beside the serial queue. |
| `changed` | `paths` | `null` | Optional, page → shell, if `info` says `changes: true`: the library changed. |

### Paths and text

- Relative to the folder, `/`-separated, no empty, `.` or `..` segment; refuse
  anything else (and anything that leads out through a symlink) with `EINVAL`.
- **Names exactly as written** (NFC): Hebrew and accented names must come back
  as they were written. On the Mac, create with `rename(2)`/`mkdir(2)` and list
  with `enumerator(atPath:)` — Foundation decomposes names otherwise (Dvarim's
  `FolderBridge.swift` already does this; reuse it).
- UTF-8 both ways; `write` stores exactly the string's bytes; `read` returns
  exactly the file (a `\r\n`, a BOM, kept). `mtime` in milliseconds.
- Error codes: `EINVAL`, `ENOENT`, `EEXIST`, `EACCES` (say how to fix it),
  `ENOSPC`, `EIO`, `ENOSYS` (unknown op), `EPROTO` (unknown `v`).

## 3. When someone else writes the folder

Obsidian, Syncthing and iCloud Drive all write to the same folder. When the
shell notices a change it did not make, it calls `window.__mosheFilesChanged()`.
Mac: `FSEventStream` on the folder, ~0.3 s latency. Windows: a
`FileSystemWatcher` on it, the same. Android: `pollSeconds`.
Too often is harmless: the page debounces and compares contents. It also
rescans when the window comes to the front.

While a sheet is open and someone else changes its file, the editor takes the
change if nothing typed is unsaved, and merges the two if something is
(`engine/src/store.js`, `saveSheet`). Conflict copies that Syncthing leaves
(`x.sync-conflict-….md`) are merged in and moved to `.moshe/conflicts/`.

## 4. Which mode the shell is in

- **Folder** (the default for Moshe): the shell serves the page from inside
  the app and installs the bridge. Mac: a path, not sandboxed. Android: a
  Storage Access Framework tree URI with a persisted permission — or, with no
  Syncthing on the phone, an app-private folder synced over WebDAV with the
  server (Settings → Sync on the server makes the device's token).
- **Server**: the shell opens the server's address (`https://<host>/`), no
  bridge. Useful as a fallback.

## 5. Shell services (Moshe's, not Dvarim's)

The page looks for `window.mosheShell` and uses what it offers; each is
optional, and the page has a browser fallback for all of them.

| call | what the shell does | fallback |
| --- | --- | --- |
| `mosheShell.savePdf(html, fileName)` → Promise | Render the print-ready HTML (it has `@page` size and margins) to a PDF — Mac: an offscreen `WKWebView` + `createPDF`/`printOperation`; Android: `PrintManager` or `WebView.createPrintDocumentAdapter` — and offer a save panel (Mac) or the share sheet/`ACTION_CREATE_DOCUMENT` (Android). | an iframe and `print()` |
| `mosheShell.saveFile(fileName, base64, mime)` → Promise | Save an export (DOCX, ePub, Markdown…) with a save panel / create-document intent. | `<a download>` |
| `mosheShell.share(fileName, base64, mime)` → Promise | The system share sheet, for "Send as Mail", AirDrop… | — |
| `mosheShell.openExternal(url)` | Open a link in the default browser (links in the text, ⌘-click). | `window.open` |

Report them in the user agent or by defining the object before the page
loads (`WKUserScript` at document start; `addJavascriptInterface` + a small
injected wrapper on Android).

**Windows** defines it in a document-created script (`windows/Moshe/Scripts.cs`),
each call a web message with a reply: `savePdf` and `sharePdf` print the HTML
in a hidden WebView2 (`Page.printToPDF`, the `@page` size and its margin boxes
drawn by Chromium itself), `saveFile` has a save dialog, `share` Windows' share
sheet, `copy` both kinds of clipboard. Print… stays the page's own, in WebView2's
print dialog. Where a Whisper model is on the PC, it adds `mosheShell.voice`
([VOICE.md](VOICE.md), Windows), and it lets the page have the microphone, on the
app's own origin only, for the page's own Whisper.

## Checking a shell

1. Folder mode on a **copy** of the library or an empty folder.
2. `await window.__mosheLocal.conformance()` → every check `ok`.
3. By hand: edit a sheet in Obsidian and see it in the app; type in the app
   and see the file; rename a group in the app and see the folder renamed;
   let Syncthing bring a change in with the sheet open.
4. `tools/bridge_sim.py` shows the expected answers for any op.
