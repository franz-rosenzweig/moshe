<sub>[Moshe docs](README.md) › Getting started</sub>

# Install

This page covers every way into Moshe: the web app in a browser, the web app installed as an app of its own, the Mac app and the Android app. All of them show the same library, so you can start with the browser and add the others later.

Moshe is a hobby project that I built for my own writing, so please treat it like one. It's been careful with my files so far, and the server keeps backups, but your writing is worth more than any app. Try it on a COPY of your folder first, keep the folder in a backup of your own, and if something looks wrong, stop and let me know.

## On the web

Moshe is a web app first, served by a Moshe server. Open the server's address in any browser, type the password and press **Sign In**. My own copy is at https://moshe.tiresia.xyz, which is mine alone, so for yours you'll need a server of your own; [Your own server](server.md) explains how, and it's one Docker container.

If the page says no password is set yet, the server is refusing to open your library to the internet without one, which is what you want. Set it on the server with:

```sh
docker exec -it moshe node server/src/cli.js set-password
```

A sign-in lasts 30 days on that browser.

### As an app of its own

The web app can sit in the Dock or on the home screen like any other app, in its own window without the browser's bars:

- **Safari on the Mac:** **File › Add to Dock**.
- **Chrome or Edge:** the browser's menu has an option to install the page as an app.
- **A phone:** **Add to Home Screen** in the browser's menu (in Safari on an iPhone, it's under the share button).

## The Mac app

There are no releases to download, so you build the Mac app yourself, from the repository, on a Mac. You need macOS 14 or newer, the Command Line Tools (`xcode-select --install`), XcodeGen (`brew install xcodegen`) and Node, for the web app inside it:

```sh
cd frontend && npm ci && npm run build && cd ..
mac/build.sh                 # mac/build/Moshe.app, in about ten seconds
open mac/build/Moshe.app     # or copy it to /Applications
```

`mac/build.sh` signs the app with your own Apple Development identity if your keychain has one, and otherwise ad hoc, which is fine on the Mac you built it on. Nothing about it is notarized, so the simplest way onto another Mac is to build it there too.

The first time it opens, Moshe asks for the folder to keep your library in. Pick the folder Syncthing, iCloud Drive or Dropbox already keeps in step, or a folder inside your Obsidian vault, and press **Use This Folder**. An empty folder starts an empty library, with an **Add “Getting Started”** button for a short tour: five sheets in my words, a welcome and then writing with tags, sheets and groups, checking and translating, and where your writing lives. **Settings › General** adds them to the Inbox again whenever you like. If you'd rather work on a server's copy, cancel, press **Use a Server…** and type your own server's address. And if you build Moshe for yourself and always use the same server, put `MOSHE_DEFAULT_SERVER=https://your.server/` in `mac/local.env` before you build, which means the app offers your server from the start.

[The Mac app](mac.md) has the rest: the window, the menus and switching folders. The build details are in [mac/README.md](../mac/README.md).

## The Android app

The Android app is built from the repository too. You need JDK 17, the Android SDK (platform 36), and the web app built first:

```sh
cd frontend && npm ci && npm run build && cd ../android
./gradlew assembleDebug      # a test build, "Moshe dev", that installs beside the real app
./release.sh                 # android/Moshe-<version>.apk, signed with your keystore.properties
adb install -r Moshe-0.1.0.apk
```

The first time it opens, Moshe asks **Where is your library?** and offers three answers:

- **A folder on this phone**, for a phone with Syncthing: pick the synced folder that holds your library.
- **Moshe's own folder, synced with the server**, for a phone without Syncthing. Then in Moshe, **Settings › Sync**, choose **A Moshe server** and type the server's address and a device token (see [WebDAV sync](webdav.md)).
- **The server's page, with no folder**, which is the web app in the app's window. Type your server's address under it. If you build the app for yourself, `moshe.defaultServer=https://your.server/` in `android/local.properties` fills it in for you.

You can change it later by long-pressing Moshe's icon and choosing **Library**. [The Android app](android.md) has the rest, and the build and signing details are in [android/README.md](../android/README.md).

## Your own server

Everything above needs a Moshe server somewhere, unless you only use the Mac or Android app on a folder. The server is Node with no dependencies, it runs in one Docker container, and it keeps your backups. [Your own server](server.md) walks you through it.

Basically, the quickest way to try Moshe is to run the server against an empty folder, open it in a browser, and start writing. If anything here doesn't work the way I described, feel free to ask me.

<sub>Next: [The library](library.md) →</sub>
