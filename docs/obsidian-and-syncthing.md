<sub>[Moshe docs](README.md) › Your files</sub>

# Obsidian and Syncthing

This page is about using Moshe on a folder that other apps use too: Obsidian on the same files, and Syncthing (or iCloud Drive, or Dropbox) carrying them between devices. It's the setup I use every day, and it's the reason Moshe exists.

## Moshe inside an Obsidian vault

Make a folder for your library anywhere inside your vault, `Notes/Writing` for example, and point Moshe at it: the Mac app asks for it the first time it opens, the Android app lets you pick it, and the server takes it as its library folder. An empty folder becomes an empty library, with `Notes` and `Projects` made for you.

From then on, both apps see the same files. Obsidian shows your groups as folders and your sheets as notes, and most of the markup means the same thing to both:

- `==highlights==`, `%%comments%%`, `^[inline footnotes]` and `[[links between sheets]]` are Obsidian's own, so Obsidian shows them as Moshe does, and hides the comments in reading view.
- A sheet's keywords, goal and notes are front matter, which Obsidian shows as the note's properties.
- Annotations, deletions and insertions are CriticMarkup, which Obsidian shows as plain text unless you add a plugin for it, and which stays intact either way.
- Moshe's own files are `.moshe.json` and the `.moshe` folder, which Obsidian doesn't show, and the `_media` folders hold the pictures, which Obsidian can show.

A link you make in Obsidian with `[[` works in Moshe, and the other way round, since a sheet's file name doesn't change when you retitle it. The one thing to watch is **Rename File to Match Title**: Moshe doesn't rewrite links when it renames a file, so afterwards check the `[[links]]` that pointed at the old name.

## Editing in both at once

You can have the same sheet open in Obsidian and in Moshe. When the file changes on disk, Moshe takes the new text, on the Mac within a fraction of a second, on the server as soon as it sees the change, and on Android when you come back to the app or within 15 seconds while it's in front.

If you were typing in Moshe at that moment, and the file changed under you, Moshe doesn't pick one version and lose the other. It merges them against the text both started from, a line at a time, and a paragraph both sides changed is merged word by word. Only where both changed the same words differently does it keep both versions, one after the other, for you to choose. In practice that means you can fix a typo in Obsidian while a paragraph is half-written in Moshe and keep both.

## Syncthing, iCloud Drive and Dropbox

Anything that keeps a folder in step between devices can carry a Moshe library, and Moshe doesn't need to know which. I use Syncthing between my Mac and my server, and the server serves the same folder to the web app.

When two devices change the same sheet before they hear from each other, the sync tool leaves a conflict copy beside it: Syncthing writes `Sheet.sync-conflict-20261011-101500-ABCDEFG.md`, and Dropbox and others write `Sheet (… conflicted copy 2026-10-11).md`. Moshe recognises both, merges the copy into the sheet the same way as above, and puts the copy away in `.moshe/conflicts`, so you don't end up with a sheet list full of duplicates. Group order, colours and the other folder settings never conflict, since every value carries the time it was set and the newer one wins.

## A device without Syncthing

A phone or another computer that doesn't run Syncthing can keep its own copy of the library in step with your server over WebDAV, with a device token instead of the password. That has its own page, [WebDAV sync](webdav.md).

## A few things to know

- Keep the library on a disk Moshe can write to. Moshe writes each change to a new file and renames it into place, so a sync tool never sees half a sheet.
- Don't put the server's password file inside the library, since the library is synced to every device. [Your own server](server.md) shows where it goes.
- Backups are made by the server, outside the library, so no sync carries them. See [Backups](backups.md).

Basically, instead of choosing between a writing app and Obsidian, you keep one folder and use whichever app suits the moment, and if you want to try it, point Moshe at a new folder inside your vault and write a sheet in each.

<sub>Next: [The Mac app](mac.md) →</sub>
