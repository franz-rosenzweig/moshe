# The menus

Moshe's Mac menu bar, item for item, with the usual keys of a Mac writing
app, and what each calls in the page. The Mac app builds its menu bar from this
(`mac/Moshe/Menus.swift`). The page's own keys (App.svelte's keydown) are the
same keys, so the web app and Android behave alike, with no menu bar.

- **key**: the menu's key. The page hears a key first, and a key it leaves
  alone reaches the menu. ⌃ chords reach the menu first.
- **command**: `window.mosheCommand(name, arg)`. means the page does not
  have it yet. The menu shows such an item disabled until the page lists the
  command in `mosheMenuState().commands`.
- **state**: read from `window.mosheMenuState()` (below) when a menu opens:
  titles that toggle, ticks, and the submenus built from the library.

## File

| item | key | command | state |
| --- | --- | --- | --- |
| New Sheet | ⌘N | `newSheet` | |
| New Material Sheet | ⌃⌥⌘N | `newMaterialSheet` | |
| New Group… | ⇧⌘N | `newGroup` | |
| New Filter… | ⌃⌘N | `newFilter` | |
| New Project… | | `newProject` | |
| Open Quickly ▸ Sheets… | ⌘O | `openQuickly` | |
| Add to Favorites / Remove from Favorites | ⌃⌘U | `favorite` | `favorite` |
| Mark as Material / Mark as Text | ⌃⌘M | `material` | `material` |
| Keywords… | ⇧⌘K | `keywords` | |
| Goal… | | `goal` | |
| Statistics… | | `statistics` | |
| Glue Sheets / Unglue Sheets | | `glue` | `glued` |
| Merge Sheets… | | `merge` | |
| Duplicate | ⌘D | `duplicate` | |
| Export… | ⇧⌘P | `export` | |
| Share… | | `share` (export, then `mosheShell.share`) | |
| Browse Backups… | | `browseBackups` | |
| Import… | | `import` | |
| Close Window | ⌘W | (the shell) | |
| Print… | ⌘P | `print` (PDF export straight to the print path) | |

Left out: Add External Folder (Moshe's library is one folder), Publish (no
publishing targets), Save Version and Browse All Versions (Moshe keeps backups,
not versions).

## Edit

| item | key | command | state |
| --- | --- | --- | --- |
| Undo / Redo | ⌘Z / ⇧⌘Z | `undo` / `redo`: the editor's history (a text field in the page: the field's own) | `canUndo` / `canRedo` |
| Cut | ⌘X | native | |
| Copy ▸ Copy · Copy as Markdown · Copy as HTML · Copy as Rich Text | ⌘C · · · | native · `copyAs`, arg `markdown` / `html` / `rich` | |
| Paste ▸ Paste | ⌘V | native | |
| … Paste as Plain Text | ⌥⇧⌘V | native `pasteAsPlainText:` | |
| … Paste as Code Block · Raw Source Block | | `pasteAs`, arg `{kind: 'code'\|'raw', text}` | |
| … Paste from Markdown · HTML · Rich Text | ⌥⌘V · · | `pasteFrom`, arg `{kind: 'markdown'\|'html'\|'rich', text, html}` | |
| Delete · Select All | · ⌘A | native | |
| Move Line Up / Move Line Down | ⌃⌘↑ / ⌃⌘↓ | `moveUp` / `moveDown`: a line in the editor, a sheet in the list | `focus` gives "Line" or "Sheet" |
| Split at Selection | ⇧⌘B | `split` | |
| Attach Note… · Attach Image… | | `attachNote` · `attachImage` | |
| Find ▸ Find… · Find and Replace… · Find Next · Find Previous · Use Selection for Find · Search Library… | ⌘F · ⌥⌘F · ⌘G · ⇧⌘G · ⌘E · ⇧⌘F | `find`, arg `open` / `replace` / `next` / `previous` / `selection`; `openQuickly` | |
| Spelling and Grammar ▸ · Substitutions ▸ · Transformations ▸ · Speech ▸ | | native | |

For the paste commands the shell passes what is on the clipboard (the page may
not read it itself from a menu).

## Markup

| item | key | command |
| --- | --- | --- |
| Title · Heading · Subheading | (⌥⌘1 · ⌥⌘2 · ⌥⌘3, hidden) | `heading` 1 · 2 · 3 |
| More ▸ Heading 4 · 5 · 6 · Paragraph | (⌥⌘4–6, ⌥⌘0, hidden) | `heading` 4 · 5 · 6 · 0 |
| Strong · Emphasis | ⌘B · ⌘I | `strong` · `emphasis` |
| Code | | `code` |
| Mark ▸ Mark · Delete · Insert · Comment | ⇧⌘H · · · ⇧⌘C | `mark` · `markDelete` · `markInsert` · `comment` |
| Link | ⌘K | `link` |
| Annotate | | `annotate` |
| Dashed List · Numbered List · Quote | | `dashedList` · `numberedList` · `quote` |
| Comment Block · Code Block · Raw Source Block | | `commentBlock` · `codeBlock` · `rawBlock` |
| Clear Markup | ⌘L | `clearMarkup` |

## Insert

| item | key | command |
| --- | --- | --- |
| Line Break | ⇧↩ | `insert`, arg `lineBreak` (the editor's key already) |
| Tab | ⌥⇥ | `insert` `tab` |
| Divider | | `insert` `divider` |
| Image · Video · Footnote · Equation · Table | | `insert` `image` · `video` · `footnote` · `equation` · `table` |
| Table of Contents | | `insert` `toc` |
| Sketch… | | `insert` `sketch`: a drawing (pen, finger or mouse) saved as an SVG beside the sheet |

## View

| item | key | command | state |
| --- | --- | --- | --- |
| Hide Library / Show Library | | `showSheets` / `showLibrary` | `library` |
| Dashboard ▸ (its views) | | `dashboardView`, arg view id | `dashboard`, `dashboardView`, `dashboardViews` |
| Second Editor | ⌥⌘3 | `secondEditor` | `secondEditor` |
| Hide Counter / Show Counter | | `toggleCounter` | `counter` |
| Show Paragraph Numbers | | `toggleParagraphNumbers` | `paragraphNumbers` |
| Sheet List ▸ (sort orders, Show Dates) | | `sheetSort`, arg; `toggleSheetDates` | `sheetSort`, `sheetSorts`, `sheetDates` |
| Translation Mode · Revision Mode | ⇧⌘T · ⇧⌘E | `translation` · `revision` | `translation`, `revision` |
| Zoom In · Zoom Out · Default Size | ⌘+ · ⌘− · ⌘0 | `zoomIn` · `zoomOut` · `zoomReset` | |
| Show Line Marker | | `toggleLineMarker` | `lineMarker` |
| Highlight ▸ Off · Line · Sentence · Paragraph | | `highlight`, arg | `highlight` |
| Fixed Scrolling ▸ Off · Top · Middle · Bottom · Variable | | `fixedScrolling`, arg | `fixedScrolling` |
| Appearance ▸ Match System · Light · Dark | | `appearance`, arg | `appearance` |
| Theme ▸ (the themes) | | `theme`, arg id | `theme`, `themes` |
| Hide Interface | ⌘. | `hideInterface` | `interfaceHidden` |
| Enter Full Screen | ⌃⌘F (🌐F) | native | |

## Go

| item | key | command | state |
| --- | --- | --- | --- |
| Back · Forward | ⌘[ · ⌘] | `back` · `forward` | |
| Notes ▸ (All, Inbox, the groups) · Projects ▸ (the projects) | | `select`, arg path | `notes`, `projects`, `selection` |
| Favorites | ⇧⌘U | `favorites` | |
| Previous Sheet · Next Sheet | ⌥⌘↑ · ⌥⌘↓ | `previousSheet` · `nextSheet` | |
| Library · Sheet List · Editor · Dashboard | ⌘1 · ⌘2 · ⌘3 · ⌘4 | `showLibrary` · `showSheets` · `showEditor` · `dashboard` | |
| (Switch Editor) | ⌥⌘← / ⌥⌘→, hidden | `otherEditor` | |

## Window

| item | key | command |
| --- | --- | --- |
| New Window | ⌥⌘N | (the shell) |
| Minimize · Zoom | ⌘M · ⌃⌘Z | native |
| Fill · Center · Move & Resize ▸ · Full Screen Tile ▸ | | added by macOS |
| Quick Export · Statistics · Navigation · Markup | ⌘6 · ⌘7 · ⌘8 · ⌘9 | `panel`, arg `export` / `statistics` / `navigation` / `markup` (the side panels: the dashboard's views where the page has them) |
| Keyword Manager | | `keywordManager` |
| Bring All to Front | | native |

## Moshe (the app menu) and Help

- **Moshe**: About Moshe · Settings… ⌘, (`settings`) · Library Folder… · Show
  Library in Finder · Use the Server… · Services · Hide/Hide Others/Show All ·
  Quit.
- **Help**: Moshe Help (the README) · Getting Started (`gettingStarted`: the Getting Started sheets added to the Inbox again) · the search field macOS adds.

## Shell services the page uses if they are there

- `mosheShell.copy({text, html})`: Copy as HTML / Rich Text, since a menu's
  call is no user gesture for the page's clipboard. Without it the page tries
  `navigator.clipboard`.
- `mosheShell.print(html, fileName)`: File › Print… with the export window's
  PDF page. Without it the page prints a hidden frame.
- `mosheShell.share(fileName, base64, mime)`: File › Share… for the export
  window's file.
- `mosheShell.sharePdf(html, fileName)`, optional: the same for a PDF. Without
  it Share… on PDF saves it.

## `window.mosheMenuState()`

Called by the shell when a menu opens; plain data, cheap to make:

```js
{
  commands: ['newSheet', …],   // every name mosheCommand knows: the rest are shown disabled
  focus: 'library' | 'list' | 'editor',
  library: true,               // the library pane is shown
  dashboard: false, dashboardView: 'overview', dashboardViews: [{ id, name }],
  secondEditor: false, translation: false, revision: false, interfaceHidden: false,
  favorite: false, material: false, glued: false,       // the picked sheet(s)
  counter: true, paragraphNumbers: false, lineMarker: false, sheetDates: false,
  highlight: 'off', fixedScrolling: 'off', appearance: 'system',
  theme: 'Moshe', themes: [{ id, name }],
  sheetSort: 'manual', sheetSorts: [{ id, name }],
  selection: 'Notes', notes: [{ path, name, depth }], projects: [{ path, name }],
}
```
