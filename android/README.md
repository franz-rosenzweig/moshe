# Moshe for Android

A WebView around the web app in `frontend/`, which is the whole interface and
already has a phone layout: library → sheets → editor, each with a way back,
the dashboard as a bottom sheet, and a markup bar on the keyboard. The app
serves the page from the APK, gives it the library (docs/BRIDGE.md), and adds
what a page cannot do.

- **Where the library lives**, asked on first run and changed from the
  launcher (long-press Moshe → Library):
  - **a folder on this phone**: the Syncthing folder that holds `Writing`,
    picked once through the system's folder picker and kept
    (`TreeLibrary.java`, the Storage Access Framework). The page rescans every
    15 s while in front and whenever the app comes back;
  - **Moshe's own folder, synced with the server**, for a phone without
    Syncthing (`FileLibrary.java`, plain files, atomic writes). The page runs
    the sync itself over WebDAV, through the bridge's `http` op: in Moshe,
    Settings → Sync, with the server's address and a device token made in the
    server's own Settings → Sync;
  - **the server's page** (https://moshe.tiresia.xyz), with no folder.
- **The page is served** at `https://appassets.androidplatform.net/` from
  `assets/web/`, and pictures a sheet uses at `/_library/<path>` from the
  library. Nothing else ever loads in the window; any other address goes to
  the browser. No service worker.
- **`window.mosheShell`** (docs/BRIDGE.md §5): PDF through the print system
  (its dialog has Save as PDF; the export's `@page` gives the paper), the other
  exports through the system's create-document screen, the share sheet, and the
  browser for links.
- **Share into Moshe**: text shared from any app becomes a new sheet in the Inbox.
- **Back** goes back in the page first (editor → sheets → library,
  `window.mosheBack()`), and leaves the app only when the page has nowhere to go.
- **The keyboard** shortens the window (`adjustResize` and the insets), so the
  page's `visualViewport` follows it and the markup bar sits on it.
- The user agent ends `Moshe/<version> (Android shell)`.

## Build it

JDK 17 and the Android SDK (platform 36), and the web app built first:

```sh
cd frontend && npm ci && npm run build && cd ../android
export JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home ANDROID_HOME=~/android-sdk
./gradlew assembleDebug      # app/build/outputs/apk/debug/app-debug.apk: "Moshe dev", beside the real app
./gradlew assembleRelease    # app/build/outputs/apk/release/, signed if keystore.properties is there
```

Gradle copies `frontend/dist` into the APK's assets on every build.

**Signing**: `./release.sh` builds `android/Moshe-<version>.apk`, signed, and
checks the signature. It signs with `android/keystore.properties` if there is
one, and otherwise with Dvarim's (`dvarim/android/keystore.properties`, beside
this repository), whose key signs Moshe too; another file can be named as its
argument. Gradle alone reads the file, and finds `storeFile` beside it. Git
ignores both, and any `*.keystore` and `*.apk`. Install with
`adb install -r Moshe-0.1.0.apk`; Moshe (`xyz.tiresia.moshe`) is its own app
beside Dvarim.

## Check it

With the phone plugged in and USB debugging on:

```sh
./check.sh           # the test build on its own folder, seeded with the sample library
./check.sh tree      # on the folder picked in the test build (pick it on the phone first)
```

It installs the test build (`xyz.tiresia.moshe.debug`), opens it, and over the
WebView's DevTools runs the bridge's conformance checks and the shell's own:
the user agent, `mosheShell`, `info`, pictures in and out of `/_library/`, a
path out of the library refused, and Back. It needs a Python with `websockets`
(`MOSHE_PYTHON=`).

By hand, after that: type on the phone and see the text reach the server's
folder (through Syncthing or the sync) and Obsidian; the markup bar sits on
the keyboard; Hebrew paragraphs run right to left; share a line of text from
another app; export a PDF.
