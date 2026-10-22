<sub>[Moshe docs](README.md) › Under the hood</sub>

# Developing Moshe

The working notes for building, running and testing Moshe from the
repository: what each folder is, how to run it, how sheets come in from
outside, what checks the writing, and the tests. This was the top of the
README until the README became the front page; the commands run from the
repository's root.

## The pieces

| | |
| --- | --- |
| `engine/` | the rules, in plain JavaScript that runs in the page, in Node and in the shells' web views: the library on disk (`store.js`), the markup (`markup.js`), statistics and goals (`sheet.js`), merging two versions of a sheet (`merge.js`), WebDAV sync (`webdav.js`), the exporters (`export/`) |
| `frontend/` | the app: Svelte 5 and CodeMirror 6, built to static files. It runs the engine itself; its storage is the server's folder (the web app), or a folder on the device through the native shell's bridge ([BRIDGE.md](BRIDGE.md)) |
| `server/` | Node, no dependencies: serves the app and the library folder to it, keeps backups (hourly, daily, weekly), offers the folder over WebDAV to devices with no Syncthing, and asks for the password |
| `mac/`, `android/` | the native shells — design notes in each `NEXT.md` |
| `tools/` | the browser tests (`e2e.py`), screenshots (`shot.py`), a sample library, the shell simulator, auto-deploy |
| `demo/` | the taste on stuffs.tiresia.xyz/moshe/: the web app running in the browser on a made-up library (`library.mjs`) kept in IndexedDB, built by `tools/build_demo.py OUT_DIR` |

## Run it

```sh
frontend/build.sh                              # the app, via Docker (no Node on the host)
node tools/sample-library.mjs /tmp/moshe-sample
MOSHE_ROOT=/tmp/moshe-sample node server/src/main.js     # http://localhost:8430
```

On a server it can run as a `moshe` service in a Docker Compose file,
redeployed by `tools/autodeploy.sh` (cron, every 5 minutes) whenever master
moves and the tests pass (`MOSHE_REPO` and `MOSHE_STACK` point it at the
checkout and the compose file). Set the password with
`docker exec -it moshe node server/src/cli.js set-password`.

## Sheets from outside (Shortcuts, a bot, cron)

Make a sheet or add to one — for Apple's Shortcuts, a bot or a script — over HTTP
with a device token (`docker exec moshe node server/src/cli.js add-token Shortcuts`),
or from the command line:

```sh
# a new sheet, named from its first line; GROUP is Inbox (the default), a path, or a group's name
curl -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"group":"Inbox","text":"# An idea\nWorth keeping."}' https://moshe.tiresia.xyz/api/sheets
# text added to a sheet (by path or title) at its end, or "at":"start"; "create":true makes it if missing
curl -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"sheet":"Today","group":"Journal","text":"More.","create":true}' https://moshe.tiresia.xyz/api/sheets/append
curl -H "Authorization: Bearer $TOKEN" 'https://moshe.tiresia.xyz/api/sheets?group=Chapters'   # a group's sheets

echo "# An idea" | docker exec -i moshe node server/src/cli.js new Inbox
echo "More."     | docker exec -i moshe node server/src/cli.js append "An idea" [--group G] [--start] [--create]
docker exec moshe node server/src/cli.js sheets Chapters
```

The open app picks the change up like any edit from another editor. The
same, for people rather than developers: [Sheets from outside](automation.md).

## Checking the writing

- As you type:
  - English grammar and spelling by Harper (harper.js, Apache-2.0, WebAssembly in a worker);
  - Hebrew spelling by Hunspell (hunspell-wasm, LGPL/MPL) with Hspell's dictionary (dictionary-he, AGPL-3.0).
- Both run in the page, offline, on every device.
- Check Text asks LanguageTool on the server ([languagetool/README.md](../languagetool/README.md)).

## Test it

```sh
tools/test-gate.sh     # engine and server, in Node
tools/e2e.py           # the real app in headless Chrome: as the web app, and as the Mac and Android apps (folder mode)
```

GitHub runs the engine's and the server's tests and the web app's build on
every push to master and every pull request (`.github/workflows/test.yml`).
The browser tests need Docker and a headless Chrome, so they run where Moshe
is deployed.

Moshe is under the GNU GPL, version 3 or later ([LICENSE](../LICENSE)), and
so is anything contributed to it.

## More

- [The library on disk](FORMAT.md): the folder format, every key.
- [The folder bridge](BRIDGE.md): how the Mac and Android apps give the page a folder.
- [The menus](MENUS.md): the menu bar, item for item, and what each calls in the page.
- [Moshe for macOS](../mac/README.md) and [Moshe for Android](../android/README.md): building and checking the apps.

<sub>Next: [Moshe for macOS](../mac/README.md) →</sub>
