<sub>[Moshe docs](README.md) › Your files</sub>

# The folder, in plain words

This page explains what Moshe keeps on disk, which is the most important thing about it: your library is an ordinary folder of Markdown files, and nothing Moshe knows about your writing lives anywhere else. Delete Moshe tomorrow and every sheet, every group and every keyword is still there, readable in any editor. The exact rules, key by key, are in [FORMAT.md](FORMAT.md); this is the short version.

## What's in the folder

Here is a small library, the way Finder or Obsidian shows it:

```
Writing/
  Notes/
    Title ideas.md              a sheet in the Inbox
    Journal/                    a group
      Sunday.md
    Reading/
      Middlemarch.md
  Projects/
    Late Apples/                a project
      Part One/                 one of its groups
        Late Apples.md
        Two Arrival.md
      Extras/
        Characters/
          Miriam.md
        Templates/
    Genesis/
      Original/
        בראשית א.md
      Translation/
        בראשית א.md
  .moshe/
    library.json
```

- **Notes** is the Notes section. A sheet directly in it is in the Inbox, and every folder in it is a group.
- **Projects** holds one folder per project. Inside a project, each folder is a group, and **Extras** holds the Extras, with a **Templates** folder that's always there. A sheet directly in the project's folder is in its **Pending**.
- A folder inside a group is a group inside a group, as deep as you like.
- A sheet is a `.md` file. Pictures live beside the sheets that use them, in a folder called `_media`.

Anything whose name starts with a dot or an underscore, and any file that isn't `.md`, isn't shown as a group or a sheet, and Moshe leaves it alone. So you can keep a PDF of the original next to a translation, and it won't get in the way.

## A sheet

A sheet is plain Markdown. Its title is its first line, and the file is named from the title when you first write it, and then keeps that name, so a link to it from Obsidian doesn't break when you change the title. **Rename File to Match Title** renames it when you ask.

The markup is standard Markdown, with Obsidian's extensions where Markdown has nothing of its own: `==highlight==`, `%%comment%%`, `^[inline footnote]` and `[[links]]`. Annotations, deletions and tracked changes use CriticMarkup, a plain-text way of writing them that other editors know too.

A sheet only has front matter, the block between `---` lines at the top, when it needs one: its keywords, whether it's a material sheet, its goal, and notes attached to it. The editor never shows the front matter; the dashboard does. Anything else in there, like Obsidian's `aliases`, is someone else's, and Moshe keeps it exactly as written.

## The small files beside them

Each folder can hold a `.moshe.json`, which keeps what a folder can't say by itself: the order of its sheets and groups when you sort them by hand, its icon and colour, its sort order, its goal and filters, and for each sheet when it was made, whether it's a favorite and whether it's glued to the next one. In a project's folder it also keeps the project's template, whether it's archived, and its keywords' colours and favorites.

Every value in it carries the time it was set, which is the clever part: when two devices change the same folder's settings, the two files are merged key by key, the newer value winning, and there's never a conflict to sort out.

The library's own settings, the keyword colours and favorites of the Notes section, the sidebar settings, your own editor themes and your spelling dictionary, are in `.moshe/library.json`. What you delete goes to `.moshe/trash`, at the path it had, until you empty the Trash, and sync tools' conflict copies, once merged, are put away in `.moshe/conflicts`.

What isn't in the folder: the font, the theme you picked, which panes are open and the like. Those belong to each device, so the phone can look different from the Mac.

## Changing the files yourself

You can rename, move and edit the files with any other app while Moshe is open: rename a folder in the Finder and the group is renamed, edit a sheet in Obsidian and the change shows up in the editor. If you were typing in that sheet at the same moment, Moshe merges the two versions instead of picking one. [Obsidian and Syncthing](obsidian-and-syncthing.md) explains how that works.

Basically, instead of a library you can only open in one app, you have a folder you can open in ALL of them, and Moshe is just the nicest way to write in it.

<sub>Next: [Obsidian and Syncthing](obsidian-and-syncthing.md) →</sub>
