# Moshe for Android — design notes

How the Android shell was put together, what it adds to the page, how to
check it, and what is still open. Read `docs/FORMAT.md`, `docs/BRIDGE.md`,
then this; building it is in [README.md](README.md). The whole interface is
the web app; the app is a WebView shell around it, like the one of Dvarim (a
to-do app built the same way), and the page has a phone layout: library → sheets → editor,
each with a way back, the dashboard as a bottom sheet, and a markup bar that
sits on the keyboard (it follows `visualViewport`, so the activity must
`adjustResize`).

## Where it started: Dvarim's shell

Dvarim's `android/` was copied into `moshe/android/` and renamed (`dvarim` →
`moshe`), package **`xyz.tiresia.moshe`** (a new app, not an update of
Dvarim's), and:

- **Kept**: the WebView activity that serves `assets/web/` at
  `https://appassets.androidplatform.net` (`shouldInterceptRequest`), the
  folder bridge as **`MosheStorage`** replying through
  **`window.__mosheStorageReply`**, `info.pollSeconds: 15`, the `http` op
  (the page's WebDAV sync goes through it), the settings screen.
- **Dropped**: the Today widget, the quick-settings tile, reminders and
  AlarmManager, `Local.java`/`Outbox`, calendars.

## Where the library lives on the phone — two ways, the person chooses

1. **A folder** (Storage Access Framework tree URI, persisted permission):
   for someone with Syncthing on the phone — the Syncthing folder that holds
   `Writing`. `list` over DocumentsContract is slow on large trees; answer
   `mtimes` so rescans read only what changed.
2. **The app's own folder, synced with the server over WebDAV**: for a phone
   without Syncthing. The folder is app-private
   (`getFilesDir()/library`, a plain `java.io.File` bridge — fast). The page
   runs the sync itself (`engine/src/webdav.js`) — it needs the server's
   address and a device token from Settings → Sync on the server — and makes
   its requests through the `http` op (the page's Settings → Sync); the
   shell only has to answer `http` and say `http: true` in `info`.

The app asks which on first run; it can be switched in the shell's settings.

## What the shell adds

- **`window.mosheShell`** (docs/BRIDGE.md §5):
  - `savePdf(html, fileName)`: an offscreen WebView with the HTML, then
    `PrintManager.print(fileName, webView.createPrintDocumentAdapter(fileName), attrs)`
    (the system print dialog has "Save as PDF").
  - `saveFile(fileName, base64, mime)`: `ACTION_CREATE_DOCUMENT`, write the bytes.
  - `share(fileName, base64, mime)`: a `FileProvider` URI and `ACTION_SEND`.
  - `openExternal(url)`: `ACTION_VIEW`. Any navigation off the app's origin
    goes there too.
- **Share target**: text shared to Moshe → load
  `https://appassets.androidplatform.net/?share=<urlencoded text>`; the page
  makes a new sheet in the Inbox from it.
- **Back**: the system back gesture goes back in the page first (editor →
  sheets → library): evaluate `window.mosheBack()`, which answers `true` if the
  page went back a pane, and finish the activity only when it answers `false`.
- **Images**: op `writeBytes` (base64 → file) and `/_library/<path>` served
  from the library folder by `shouldInterceptRequest` (docs/BRIDGE.md).
- User agent: append `Moshe/<version> (Android shell)`.

## Check it

`await window.__mosheLocal.conformance()` passes on each folder kind; typing
on the phone reaches the server's folder (through Syncthing or WebDAV) and
Obsidian; the markup bar sits on the keyboard; Hebrew paragraphs run right to
left.

## Open work: other people's builds

Moshe is meant to be built by anyone from this repository, signed with
their own key. Moshe is GPL-3.0-or-later (`LICENSE`).

1. **No built-in server.** `Place.DEFAULT_SERVER` is
   `https://moshe.tiresia.xyz/`, so a build falls back to that server. Make
   it a `buildConfigField` read from `keystore.properties` or
   `local.properties` (`moshe.defaultServer`, empty when unset), and with no
   default ask for the address on the "server's page" and "synced with the
   server" paths. Existing installs must keep working: their
   `keystore.properties` sets it, or the first launch of the new build stores
   the old default under `server` when nothing is stored and the app was
   already set up.
2. **About:** wherever the app shows its version, add "Free software under
   the GNU GPL, version 3 or later."
