# The library on disk

Moshe keeps no database. The library is a folder of Markdown files, readable
and editable in Obsidian or any editor, and everything Moshe knows about it is
in that folder. Delete the app and the writing is all still there.

## Folders

```
<library>/
  Notes/                    the Notes section
    A sheet.md              a sheet in the Inbox (directly in Notes/)
    Blog/                   a group
      Drafts/               a group inside it
        Post.md
      .moshe.json           Blog's order, icon, colour… (below)
    .moshe.json
  Projects/                 the Projects section
    Novel Without a Cause/  a project
      Loose sheet.md        Pending: a sheet in the project but in no group
      Chapters/             a project group (the project's main content)
        One/
          Scene.md
      Extras/               the project's Extras section
        Characters/         an Extras group
        Templates/          the project's sheet templates
      .moshe.json           the project's icon, colour, goal, keyword colours…
  .moshe/
    library.json            library-wide: keyword colours and favourites, sidebar
                            settings, your editor themes ("themes": name → CSS colours)
    trash/<old path>        what was deleted, at the path it had
    conflicts/              sync tools' conflict copies, once merged in
```

- A **group** is a folder. A nested folder is a nested group.
- A **sheet** is a `.md` file in a group (or in `Notes/`, the Inbox, or directly
  in a project, Pending).
- A **project** is a folder in `Projects/`. Its `Extras/` folder holds its
  Extras groups; `Extras/Templates/` is always there.
- A folder or file whose name begins with `.` or `_`, and anything that is not
  `.md`, is not shown as a group or sheet. Images live beside the sheets that
  use them, in a folder called `_media/`.
- Anything else in the library folder (a stray file at the top, say) is left
  alone.

## Sheets

A sheet is Markdown. Its **title** is its first line: a heading's text, or
the first line of text. There is no separate title.

The **file name** comes from the title when the sheet is first written with
text, and then stays: retitling a sheet does not rename its file, so nothing
that links to it (Obsidian, say) breaks. "Rename File to Match Title" in the
sheet's menu does it on request. A sheet created empty is `Untitled.md` until it
has a first line.

### Front matter

Only what a sheet has, and only then:

```yaml
---
keywords: [Draft, Pencroft]
material: true
goal: {type: at-least, count: 800, metric: words}
notes:
  - |
    A note attached to the sheet.
---
```

| key | meaning |
| --- | --- |
| `keywords` | the sheet's keywords. A list; a keyword may have spaces. |
| `material` | a material sheet: left out of export, statistics and goals |
| `goal` | the sheet's writing goal: `type` (`about`, `at-least`, `at-most`), `count`, `metric` (`words`, `characters`, `characters-no-spaces`, `sentences`, `paragraphs`, `lines`, `pages`, `reading-time`), optional `deadline` (`YYYY-MM-DD`) |
| `notes` | notes attached to the sheet, each a block of Markdown |
| `ink` | a handwritten sheet: its page of ink, a drawing beside it (`_media/NAME.excalidraw.md`, Obsidian's Excalidraw plugin's own format, with the strokes as `freedraw` elements and the paper in `moshe-paper`), whose picture (`_media/NAME.svg`) the sheet shows |

Any other key is someone else's (Obsidian's `aliases`, say) and is kept exactly
as written. The editor never shows the front matter; the dashboard does.

## Markup

The file holds standard Markdown, with Obsidian's extensions and CriticMarkup
where Markdown has nothing of its own. The editor shows the tags greyed, and
with Smart Tags on it turns a few short tags into the file's own as you type.

| element (and its short tag) | in the file | notes |
| --- | --- | --- |
| title … heading 6 | `# Title` … `###### Heading 6` | |
| strong | `**strong**` | |
| emphasis | `_emphasis_` (`*emphasis*` also read) | |
| mark (`::mark::`) | `==mark==` | Obsidian's highlight |
| comment (`++comment++`) | `%%comment%%` | Obsidian's comment: never exported |
| comment block | a paragraph that is `%%…%%` | |
| deletion (`\|\|delete\|\|`) | `{--delete--}` | CriticMarkup deletion: never exported |
| annotation: some text and a note on it | `{==annotated text==}{>>the note<<}` | CriticMarkup highlight and comment |
| footnote (`(fn)`) | `^[the footnote]` | an inline footnote (Obsidian, Pandoc) |
| link | `[link](https://…)` | |
| image (`(img)`) | `![caption](_media/name.png)` | |
| code | `` `code` `` | |
| code block | a fenced code block (` ``` `) | |
| lists, quote, divider | `-` / `1.`, `>`, `----` | |
| table (`(tbl)`) | a pipe table | |
| equation | `$…$` inline, `$$…$$` block | |
| table of contents | `(toc)` on a line of its own | |

Tracked changes use the rest of CriticMarkup: `{++added++}`,
`{~~old~>new~~}`. Revision mode accepts or rejects them.

## `.moshe.json`: a folder's own settings

Each group's and project's folder may hold a `.moshe.json`. Every value in it
carries the time it was set, so two devices' versions merge key by key, the
newer winning, with no conflict:

```json
{
 "sheets": { "v": ["Scene two.md", "Scene one.md"], "t": 1727370000000 },
 "groups": { "v": ["One", "Two"], "t": 1727370000000 },
 "icon": { "v": "book", "t": 1727370000000 },
 "color": { "v": "orange", "t": 1727370000000 },
 "sort": { "v": "manual", "t": 1727370000000 },
 "sheet:Scene one.md": { "v": { "created": "2026-09-26T14:03:00", "favorite": true, "glued": true }, "t": 1727370000000 }
}
```

| key | value |
| --- | --- |
| `sheets` | the sheets in manual order, by file name. Sheets not listed come after, by name. |
| `groups` | the subgroups (folders) and filters in order. Unlisted come after, by name. |
| `icon`, `color` | the group's or project's icon and colour |
| `sort` | `manual`, `title`, `modified`, `created`, and `-` before one of the last three to reverse it |
| `goal` | a group or project goal (as a sheet's, and `type: daily`) |
| `filters` | the filters placed in this group: `[{id, name, icon, color, rules}]` |
| `sheet:<file>` | a sheet's `created` time, `favorite`, and `glued` (glued to the next sheet) |
| `project` | in a project's folder: `{template, archived, exportStyle}` |
| `keywords` | in a project's folder: its keyword pool's colours |

A value set to `null` is a deletion, kept (with its time) for thirty days so
that a device that has not heard of it does not bring it back.
