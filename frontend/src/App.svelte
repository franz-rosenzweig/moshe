<script>
  // The window: library, sheet list and editor side by side (⌘1 ⌘2 ⌘3), the
  // dashboard on the right (⌘4), each pane with its own buttons along the top.
  import { onMount } from 'svelte';
  import Icon from './components/Icon.svelte';
  import Library from './components/Library.svelte';
  import SheetList from './components/SheetList.svelte';
  import EditorPane from './components/EditorPane.svelte';
  import Dashboard from './components/Dashboard.svelte';
  import Menu from './components/Menu.svelte';
  import Dialogs from './components/Dialogs.svelte';
  import Settings from './components/Settings.svelte';
  import QuickOpen from './components/QuickOpen.svelte';
  import Login from './components/Login.svelte';
  import MarkupBar from './components/MarkupBar.svelte';
  import { app, prefs, store, start, back, forward, setPanes, persist, openSheet, openProject, closeProject, toast, select } from './lib/state.svelte.js';
  import { ui, menuUnder, openDialog, confirm } from './lib/ui.svelte.js';
  import { newSheet, newGroup, trashSheets, newProject, newFilter, targetGroup, goalFor, glue } from './lib/actions.js';
  import { THEMES, THEME_ORDER, customThemes } from './lib/themes.js';
  import { startTranslation, translationPair } from './lib/translation.js';
  import { undoDepth, redoDepth } from '@codemirror/commands';
  import { addGettingStarted } from '@engine/welcome.js';

  let pane;
  let filtering = $state(false);
  const mac = /Mac|iPhone|iPad/u.test(navigator.platform) || /Macintosh/u.test(navigator.userAgent);
  const shell = /Moshe\/[^ ]* \(macOS/u.test(navigator.userAgent);
  const narrow = $state({ on: false });
  const touchFirst = $state({ on: false });
  // a tablet, upright or sideways: the editor has the whole screen, and the
  // library and the sheets slide over it when they're wanted
  const slide = $derived(!narrow.on && touchFirst.on);
  /** ⌘1–3, and the pane buttons: side by side, or slid over the editor. */
  function panes(n) {
    if (!slide) return setPanes(n);
    app.drawer = n === 1 || (app.drawer === n && n !== 3) ? 0 : n;
  }     // a phone or a tablet: touch is the main way in, so the on-screen keyboard gets the markup bar

  // what a native menu can ask for (docs/BRIDGE.md: the Mac's menus call
  // window.mosheCommand(name), so their shortcuts and the page's are one set)
  const COMMANDS = {
    import: () => import('./lib/importer.js').then((m) => m.chooseAndImport()),
    newSheet: () => newSheet(), newMaterialSheet: () => newSheet({ material: true }), newGroup: () => newGroup(), newProject: () => newProject(),
    export: () => exportCurrent(), openQuickly: () => { app.quickOpen = true; }, find: (arg) => editorRun('find', arg || 'open'), settings: () => { app.settingsOpen = 'general'; },
    showLibrary: () => panes(3), showSheets: () => panes(2), showEditor: () => panes(1), dashboard: () => { app.dashboard = !app.dashboard; persist(); },
    translation: () => toggleTranslation(), back: () => back(), forward: () => forward(),
    zoomIn: () => { prefs.fontSize = Math.min(40, prefs.fontSize + 1); }, zoomOut: () => { prefs.fontSize = Math.max(10, prefs.fontSize - 1); }, zoomReset: () => { prefs.fontSize = 16; },
    revision: () => { app.revision = !app.revision; app.revisionKind = null; app.dashboard = true; app.dashboardView = 'annotations'; },
    trash: () => { if (app.selected.length) trashSheets(app.selected); },
    strong: () => editorRun('strong'), emphasis: () => editorRun('emphasis'), link: () => editorRun('link'), mark: () => editorRun('mark'),
    comment: () => editorRun('comment'), heading: (n) => editorRun('heading', n),
    // the Sheet and View menus' items: the same as their keys (below)
    duplicate: () => duplicatePicked(), favorite: () => toggleFavorite(), moveUp: () => moveUpDown(-1), moveDown: () => moveUpDown(1),
    favorites: () => { if (app.project) closeProject(); select('favorites'); }, otherEditor: () => pane && pane.switchEditor && pane.switchEditor(),
    // the rest of the menus (docs/MENUS.md): File
    newFilter: () => { const d = targetGroup(); newFilter(d === 'Projects' ? 'Notes' : d); },
    material: () => { const p = picked(); if (!p.length) return; const on = !store.sheetInfo(p[0]).material; for (const x of p) store.setSheetMeta(x, { material: on }); },
    keywords: () => { const p = picked(); if (p.length) openDialog('keywords', { paths: p }); },
    goal: () => { const p = picked()[0]; if (p) goalFor({ sheet: true, path: p, goal: store.sheetInfo(p).goal }); },
    statistics: () => {
      const sel = app.selection;
      if (app.focus === 'library' && store.exists(sel) && !sel.includes('#')) openDialog('stats', { path: sel, name: sel === 'Notes' ? 'Inbox' : sel.split('/').pop() });
      else COMMANDS.dashboardView('progress');
    },
    glue: () => { const p = picked(); if (p.length > 1) glue(p); else if (p.length === 1 && store.sheetInfo(p[0]).glued) store.setGlued(p[0], false); },
    merge: async () => { const p = picked(); if (p.length > 1 && (await confirm('Merge these sheets?', 'Their text becomes one sheet, in this order; the others go to the Trash.', 'Merge'))) openSheet(store.mergeSheets(p)); },
    share: () => exportCurrent({ share: true }), print: () => exportCurrent({ print: true }),
    browseBackups: () => openDialog('backups'), gettingStarted: () => { app.settingsOpen = null; select(addGettingStarted(store)); }, keywordManager: () => openDialog('keywordManager'),
    // Edit, Markup, Insert: the text's own (Editor.svelte's run)
    copyAs: (k) => editorRun('copyAs', k), pasteAs: (a) => editorRun('pasteAs', a), pasteFrom: (a) => editorRun('pasteFrom', a), split: () => editorRun('split'),
    code: () => editorRun('code'), markDelete: () => editorRun('markDelete'), markInsert: () => editorRun('markInsert'), annotate: () => editorRun('annotate'),
    dashedList: () => editorRun('dashedList'), numberedList: () => editorRun('numberedList'), quote: () => editorRun('quote'),
    commentBlock: () => editorRun('commentBlock'), codeBlock: () => editorRun('codeBlock'), rawBlock: () => editorRun('rawBlock'),
    clearMarkup: () => editorRun('clearMarkup'), insert: (kind) => editorRun('insert', kind),
    undo: () => fieldHistory('undo') || editorRun('undo'), redo: () => fieldHistory('redo') || editorRun('redo'),
    attachImage: () => editorRun('insert', 'image'),
    attachNote: () => { if (!app.sheet) return; app.dashboard = true; app.dashboardView = 'overview'; persist(); setTimeout(() => window.dispatchEvent(new CustomEvent('moshe:add-note')), 50); },
    // View
    dashboardView: (id) => { app.dashboard = true; app.dashboardView = id || 'overview'; persist(); },
    secondEditor: () => { app.second = app.second ? null : app.sheet; persist(); },
    toggleCounter: () => { prefs.showCounter = !prefs.showCounter; persist(); },
    toggleParagraphNumbers: () => { prefs.paragraphNumbers = !prefs.paragraphNumbers; persist(); },
    sheetSort: (id) => { const g = store.sheetList(app.selection).group; if (g && id) store.setSort(g, id); },
    toggleSheetDates: () => { prefs.sheetListDates = !prefs.sheetListDates; persist(); },
    toggleLineMarker: () => { app.typewriter.marker = !app.typewriter.marker; persist(); },
    highlight: (v) => { app.typewriter.highlight = v || 'off'; persist(); },
    fixedScrolling: (v) => { app.typewriter.fixed = v || 'off'; persist(); },
    appearance: (v) => { prefs.appearance = v || 'system'; persist(); },
    theme: (id) => { if (THEMES[id]) { prefs.theme = id; persist(); } },
    hideInterface: () => toggleInterface(),
    // Go, Window
    select: (path) => goTo(path),
    previousSheet: () => stepSheet(-1), nextSheet: () => stepSheet(1),
    panel: (kind) => { if (kind === 'export') exportCurrent(); else if (kind === 'statistics') COMMANDS.dashboardView('progress'); else if (kind === 'navigation') COMMANDS.dashboardView('outline'); else if (kind === 'markup') editorRun('markupPanel'); },
    checkText: () => { const v = pane && pane.activeView(); if (!v || !app.sheet) return; app.revision = true; app.dashboard = true; app.dashboardView = 'annotations'; import('./lib/check.svelte.js').then((m) => m.checkText(app.sheet, v.state.doc.toString())); },
  };
  /** The sheets a Sheet command acts on: those picked in the list, or the open one. */
  const picked = () => (app.selected.length ? app.selected : app.sheet ? [app.sheet] : []);
  function duplicatePicked() { const p = picked(); if (p.length === 1) openSheet(store.duplicateSheet(p[0])); }
  function toggleFavorite() {
    const p = picked();
    if (!p.length) return;
    const on = !store.sheetInfo(p[0]).favorite;
    for (const x of p) store.setFavorite(x, on);
    toast(on ? 'Added to Favorites' : 'Removed from Favorites');
  }
  /** A command for the text: the editor with the cursor (or the first) does it. */
  async function editorRun(name, arg) {
    const ed = pane && pane.activeEditor && pane.activeEditor();
    return ed ? ed.run(name, arg) : false;
  }
  /** Undo / Redo in a text field (the find bar, a dialog's): the field's own. */
  const inField = () => !!document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
  function fieldHistory(kind) {
    if (!inField()) return false;
    document.execCommand(kind);
    return true;
  }
  /** Move Up / Move Down: a line in the editor, sheets in the list. */
  function moveUpDown(step) {
    if (app.focus === 'editor') editorRun('moveLine', step);
    else moveInList(picked(), step);
  }
  /** Previous Sheet / Next Sheet: in the sheet list's order. */
  function stepSheet(step) {
    const list = store.sheetList(app.selection).sections.flatMap((x) => x.sheets.map((i) => i.path));
    if (!list.length) return;
    const i = list.indexOf(app.sheet);
    const next = list[i < 0 ? (step > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, i + step))];
    if (next && next !== app.sheet) openSheet(next, { fromList: true });
  }
  /** Go › Notes / Projects: a group, a filter, a project. */
  function goTo(path) {
    if (!path) return;
    const proj = path.startsWith('Projects/') && store.projectOf ? store.projectOf(path) : null;
    if (proj && proj === path) { openProject(path); return; }
    if (app.project && !(proj && proj === app.project)) closeProject();
    if (proj && app.project !== proj) openProject(proj);
    select(path);
  }
  /** Hide Interface (⌘.): only the text; again, and all is back as it was. */
  let panesBefore = null;
  function toggleInterface() {
    app.interfaceHidden = !app.interfaceHidden;
    if (app.interfaceHidden) { panesBefore = app.panes; app.panes = 1; app.dashboard = false; }
    else if (panesBefore) { app.panes = panesBefore; panesBefore = null; }
    persist();
  }

  // what a native menu shows when it opens: ticks, titles, the submenus built from the library (docs/MENUS.md)
  window.mosheMenuState = () => {
    if (app.phase !== 'ready' || !store) return { commands: [] };
    const p = picked(), one = p.length ? store.sheetInfo(p[0]) : null;
    const list = store.sheetList(app.selection);
    const lib = store.library();
    const ed = pane && pane.activeEditor && pane.activeEditor(), ev = ed && ed.getView && ed.getView();
    const notes = [{ path: 'notes-all', name: 'All', depth: 0 }, { path: 'Notes', name: 'Inbox', depth: 0 }];
    const walk = (nodes, depth) => { for (const n of nodes || []) { notes.push({ path: n.path, name: n.name, depth }); walk(n.groups, depth + 1); } };
    walk(lib.groups, 0);
    return {
      commands: Object.keys(COMMANDS),
      focus: app.focus === 'editor' ? 'editor' : app.focus === 'list' ? 'list' : 'library',
      // a text field in the page (the find bar, a dialog's) has its own history, which the page cannot see into
      canUndo: inField() || !!(ev && undoDepth(ev.state)), canRedo: inField() || !!(ev && redoDepth(ev.state)),
      library: app.panes === 3,
      dashboard: !!app.dashboard, dashboardView: app.dashboardView || 'overview',
      dashboardViews: [['overview', 'Overview'], ['progress', 'Progress'], ['outline', 'Outline'], ['attachments', 'Attachments'], ['annotations', 'Annotations']].map(([id, name]) => ({ id, name })),
      secondEditor: !!app.second, translation: !!app.translation, revision: !!app.revision, interfaceHidden: !!app.interfaceHidden,
      favorite: !!(one && one.favorite), material: !!(one && one.material), glued: !!(one && one.glued),
      counter: !!prefs.showCounter, paragraphNumbers: !!prefs.paragraphNumbers, lineMarker: !!app.typewriter.marker, sheetDates: !!prefs.sheetListDates,
      highlight: app.typewriter.highlight || 'off', fixedScrolling: app.typewriter.fixed || 'off', appearance: prefs.appearance || 'system',
      theme: prefs.theme, themes: [...THEME_ORDER, ...customThemes()].map((id) => ({ id, name: THEMES[id] ? THEMES[id].name : id })),
      sheetSort: list.group ? store.sget(list.group, 'sort', 'manual') || 'manual' : null,
      sheetSorts: [['manual', 'Manually'], ['title', 'By Title'], ['-modified', 'By Modification Date'], ['-created', 'By Creation Date']].map(([id, name]) => ({ id, name })),
      selection: app.selection, notes, projects: (lib.projects || []).map((x) => ({ path: x.path, name: x.name })),
    };
  };
  // the Android Back key: whatever is open closes first, at any width (a menu, a
  // dialog, Settings, the slid-over panes, the dashboard); then, on a phone, a pane back
  window.mosheBack = () => {
    if (ui.menu) { ui.menu = null; return true; }
    if (ui.dialog) { if (ui.dialog.kind !== 'sketch') ui.dialog.resolve(null); return true; }   // a sketch goes only by Cancel
    if (app.quickOpen) { app.quickOpen = false; return true; }
    if (app.settingsOpen && app.settingsPane) { app.settingsPane = false; return true; }
    if (app.settingsOpen) { app.settingsOpen = null; return true; }
    if (app.drawer) { app.drawer = 0; return true; }
    if (app.dashboard) { app.dashboard = false; return true; }
    if (!narrow.on) return false;
    if (app.phone === 'editor') { app.phone = 'list'; return true; }
    if (app.phone === 'list') { app.phone = 'library'; return true; }
    if (app.project) { closeProject(); app.phone = 'library'; return true; }
    return false;
  };
  window.mosheCommand = (name, arg) => { const f = COMMANDS[name]; if (f && app.phase === 'ready') f(arg); return !!f; };

  onMount(() => {
    start();
    const onFocus = () => pane && pane.focus();
    window.addEventListener('moshe:focus-editor', onFocus);
    const mq = matchMedia('(max-width: 760px)'), coarse = matchMedia('(pointer: coarse)');
    const set = () => { narrow.on = mq.matches; touchFirst.on = coarse.matches; if (!slide) app.drawer = 0; };
    set();
    for (const m of [mq, coarse]) m.addEventListener('change', set);
    // a sheet picked from the slid-over list: the panes slide away, back to the text
    const picked = () => { if (slide) app.drawer = 0; };
    window.addEventListener('moshe:picked', picked);
    return () => { window.removeEventListener('moshe:focus-editor', onFocus); window.removeEventListener('moshe:picked', picked); for (const m of [mq, coarse]) m.removeEventListener('change', set); };
  });

  // the appearance setting: the system's, or always light or dark
  $effect(() => {
    const a = prefs.appearance;
    if (a === 'light' || a === 'dark') document.documentElement.setAttribute('data-theme', a);
    else document.documentElement.removeAttribute('data-theme');
    persist();
  });
  $effect(() => { prefs.fontSize; prefs.lineHeight; prefs.lineWidth; prefs.font; prefs.theme; persist(); });

  function keydown(e) {
    const mod = mac ? e.metaKey : e.ctrlKey;
    if (app.phase !== 'ready') return;
    if (e.key === 'Escape') {
      if (ui.menu) { ui.menu = null; return; }
      if (app.quickOpen) { app.quickOpen = false; return; }
      if (app.settingsOpen) { app.settingsOpen = null; return; }
    }
    if (!mod || e.defaultPrevented) return;     // a key the editor (or a field) has taken is not the page's too
    const k = e.key.toLowerCase();
    const inEditor = document.activeElement && document.activeElement.closest && document.activeElement.closest('.cm-editor');
    // ⌃⌘ chords are a Mac's (⌃ is ⌘ elsewhere)
    const ctrlCmd = e.ctrlKey && e.metaKey;
    if (!e.shiftKey && !e.altKey && !ctrlCmd && ['1', '2', '3'].includes(k)) { e.preventDefault(); panes(4 - Number(k)); return; }
    // the menus' keys (docs/MENUS.md): ⌃⌘N filter, ⌃⌘M material, ⇧⌘K keywords, ⇧⌘B split, ⌘L clear markup, ⌥⌘3 second editor,
    // ⌥⌘↑/↓ previous/next sheet, ⌘. hide interface, ⌘6–9 the panels (⌘9 in the text is the editor's own), ⌥⌘V paste from Markdown
    if (k === 'n' && ctrlCmd && !e.altKey) { e.preventDefault(); COMMANDS.newFilter(); return; }
    if (k === 'n' && ctrlCmd && e.altKey) { e.preventDefault(); newSheet({ material: true }); return; }
    if (k === 'm' && ctrlCmd) { e.preventDefault(); COMMANDS.material(); return; }
    if (k === 'k' && e.shiftKey && !e.altKey) { e.preventDefault(); COMMANDS.keywords(); return; }
    if (k === 'b' && e.shiftKey && !e.altKey && inEditor) { e.preventDefault(); COMMANDS.split(); return; }
    if (k === 'l' && !e.shiftKey && !e.altKey && inEditor) { e.preventDefault(); COMMANDS.clearMarkup(); return; }
    if (e.code === 'Digit3' && e.altKey && !e.shiftKey) { e.preventDefault(); COMMANDS.secondEditor(); return; }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.altKey && !ctrlCmd && !e.shiftKey) { e.preventDefault(); stepSheet(e.key === 'ArrowUp' ? -1 : 1); return; }
    if (e.key === '.' && !e.shiftKey && !e.altKey) { e.preventDefault(); toggleInterface(); return; }
    if (!e.shiftKey && !e.altKey && ['6', '7', '8', '9'].includes(k) && !(k === '9' && inEditor)) { e.preventDefault(); COMMANDS.panel({ 6: 'export', 7: 'statistics', 8: 'navigation', 9: 'markup' }[k]); return; }
    if (e.code === 'KeyV' && e.altKey && !e.shiftKey && inEditor) { e.preventDefault(); COMMANDS.pasteFrom('markdown'); return; }
    if (!e.shiftKey && !e.altKey && k === '4') { e.preventDefault(); app.dashboard = !app.dashboard; persist(); return; }
    if (k === 'n' && !e.shiftKey && !e.altKey && !ctrlCmd) { e.preventDefault(); newSheet(); return; }
    if (k === 'n' && e.shiftKey) { e.preventDefault(); newGroup(); return; }
    if (k === 'o' || (k === 'f' && e.shiftKey)) { e.preventDefault(); app.quickOpen = true; return; }
    if (k === ',') { e.preventDefault(); app.settingsOpen = 'general'; return; }
    if (k === '[' || (e.altKey && e.key === 'ArrowLeft' && !inEditor)) { e.preventDefault(); back(); return; }
    if (k === ']' || (e.altKey && e.key === 'ArrowRight' && !inEditor)) { e.preventDefault(); forward(); return; }
    if (k === 'p' && e.shiftKey) { e.preventDefault(); exportCurrent(); return; }
    if (k === 't' && e.shiftKey && !e.altKey) { e.preventDefault(); toggleTranslation(); return; }
    if ((k === '=' || k === '+') && !e.altKey) { e.preventDefault(); prefs.fontSize = Math.min(40, prefs.fontSize + 1); return; }
    if (k === '-' && !e.altKey) { e.preventDefault(); prefs.fontSize = Math.max(10, prefs.fontSize - 1); return; }
    if (k === '0' && !e.altKey) { e.preventDefault(); prefs.fontSize = 16; return; }
    if (k === 'f' && e.ctrlKey && e.metaKey) { e.preventDefault(); toggleFullscreen(); return; }
    if ((e.key === 'Backspace') && !inEditor && app.focus === 'list' && app.selected.length) { e.preventDefault(); trashSheets(app.selected); return; }
    // the other sheet shortcuts (the same as COMMANDS' duplicate, favorite, favorites, moveUp/Down, otherEditor)
    if (k === 'd' && !e.shiftKey && !e.altKey && !(e.ctrlKey && e.metaKey) && !inEditor && picked().length === 1) { e.preventDefault(); duplicatePicked(); return; }
    if (k === 'u' && e.ctrlKey && e.metaKey) { e.preventDefault(); toggleFavorite(); return; }
    if (k === 'u' && e.shiftKey && !(e.ctrlKey && e.metaKey)) { e.preventDefault(); COMMANDS.favorites(); return; }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.ctrlKey && e.metaKey) { e.preventDefault(); if (inEditor) editorRun('moveLine', e.key === 'ArrowUp' ? -1 : 1); else moveInList(picked(), e.key === 'ArrowUp' ? -1 : 1); return; }
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.altKey && inEditor && pane && pane.switchEditor && pane.switchEditor()) { e.preventDefault(); return; }
    if (k === 'i' && e.shiftKey) { e.preventDefault(); import('./lib/importer.js').then((m) => m.chooseAndImport()); return; }
    if (k === 'e' && e.shiftKey) { e.preventDefault(); COMMANDS.revision(); return; }
  }

  /** Sheets one place up or down in their group, where it is sorted by hand. */
  function moveInList(paths, step) {
    if (!paths.length) return;
    const dir = paths[0].slice(0, paths[0].lastIndexOf('/'));
    if (!paths.every((p) => p.startsWith(dir + '/') && !p.slice(dir.length + 1).includes('/'))) return;
    if ((store.sget(dir, 'sort', 'manual') || 'manual') !== 'manual') { toast('The group is sorted; choose Sort by › Manually to move sheets.'); return; }
    const order = store.sheetsIn(dir);
    const idx = paths.map((p) => order.indexOf(p)).sort((x, y) => x - y);
    if (idx[0] < 0 || (step < 0 && idx[0] === 0) || (step > 0 && idx[idx.length - 1] === order.length - 1)) return;
    const moving = idx.map((i) => order[i]);
    const rest = order.filter((p) => !moving.includes(p));
    const at = Math.max(0, Math.min(rest.length, rest.indexOf(order[step < 0 ? idx[0] - 1 : idx[idx.length - 1] + 1]) + (step < 0 ? 0 : 1)));
    rest.splice(at, 0, ...moving);
    store.reorderSheets(dir, rest);
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.(); else document.exitFullscreen?.();
  }

  function exportCurrent(extra = {}) {
    const paths = app.selected.length ? app.selected : app.sheet ? [app.sheet] : [];
    if (!paths.length) return;
    const one = paths.length === 1 ? store.sheetInfo(paths[0]) : null;
    openDialog('export', { paths: paths.length === 1 ? store.gluedRun(paths[0]) : paths, title: one ? one.title : `${paths.length} sheets`, ...extra });
  }

  // the translation button only where there is a translation to show (⇧⌘T works everywhere)
  const hasPair = $derived.by(() => { app.version; return !!(store && app.sheet && store.exists(app.sheet) && translationPair(store, app.sheet)); });

  function toggleTranslation() {
    if (app.translation) { app.translation = false; persist(); return; }
    if (!app.sheet) { toast('Open a sheet first.'); return; }
    const pair = translationPair(store, app.sheet);
    if (!pair) { toast('Translation mode pairs groups called Original and Translation (or Source and Target) side by side. Make a project from the Translation template, or two such groups.', 7000); return; }
    if (!pair.other) startTranslation(store, app.sheet);
    app.translation = true;
    persist();
  }

  // The panes' widths, dragged at their edges: the library's and the
  // sheet list's right edge, the dashboard's left. The editor always keeps its room;
  // a double-click on an edge puts the pane back to its own width.
  const WIDTHS = { lib: [240, 180, 420], list: [280, 220, 520], dash: [300, 240, 480] };
  // the editor's least room: two editors' worth when it is split (translation mode, a second sheet)
  const editorMin = () => (app.translation || app.second ? 640 : 380);
  const widthOf = (k) => app.widths[k] || WIDTHS[k][0];
  function resize(e, key, dir) {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const x0 = e.clientX, w0 = widthOf(key);
    const others = ['lib', 'list', 'dash'].filter((k) => k !== key && document.querySelector(`.window > .col.${k}`))
      .reduce((n, k) => n + widthOf(k), 0);
    const [, lo, hi] = WIDTHS[key];
    const move = (ev) => {
      const w = Math.round(Math.max(lo, Math.min(hi, window.innerWidth - others - editorMin(), w0 + dir * (ev.clientX - x0))));
      if (w !== app.widths[key]) app.widths = { ...app.widths, [key]: w };
    };
    const done = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', done);
      handle.removeEventListener('pointercancel', done);
      document.documentElement.classList.remove('resizing');
      persist();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', done);
    handle.addEventListener('pointercancel', done);
    document.documentElement.classList.add('resizing');
  }
  function resetWidth(key) { const { [key]: _, ...rest } = app.widths; app.widths = rest; persist(); }

  // on a phone, one pane at a time: the library,
  // then a group's sheets, then the editor, each with a way back
  const showLib = $derived(narrow.on ? app.phone === 'library' : slide ? app.drawer === 3 : app.panes === 3);
  const showList = $derived(narrow.on ? app.phone === 'list' : slide ? app.drawer >= 2 : app.panes >= 2);
  const showEditor = $derived(narrow.on ? app.phone === 'editor' : true);
  const listTitle = $derived.by(() => { app.version; return store ? store.sheetList(app.selection).title : ''; });
</script>

<svelte:window onkeydown={keydown} />

{#if app.phase === 'login'}
  <Login />
{:else if app.phase === 'error'}
  <div class="fatal"><h1>Moshe could not open the library</h1><p>{app.error}</p><button class="btn" onclick={() => start()}>Try Again</button></div>
{:else if app.phase === 'starting'}
  <div class="fatal"><p class="dim">Opening the library…</p></div>
{:else}
  <div class="window" class:bare={app.interfaceHidden} class:shell class:narrow={narrow.on} class:slide>
    {#if slide && app.drawer}<div class="drawer-scrim" role="presentation" onclick={() => (app.drawer = 0)}></div>{/if}
    {#if showLib}
      <div class="col lib" style:width={narrow.on ? null : `${widthOf('lib')}px`}>
        {#if !narrow.on && !slide}<div class="edge right" role="separator" aria-orientation="vertical" aria-label="Library width" title="Drag to resize; double-click for the usual width" onpointerdown={(e) => resize(e, 'lib', 1)} ondblclick={() => resetWidth('lib')}></div>{/if}
        <div class="bar" class:traffic={shell}>
          {#if narrow.on}<span class="phone-title">{app.project ? '' : 'Library'}</span>
            <button class="tb" title="Settings" onclick={() => (app.settingsOpen = 'general')}><Icon name="settings" size={18} /></button>{/if}
          {#if app.project}
            <button class="tb" title="Close Project" onclick={() => closeProject()}><Icon name="chevron-left" size={17} stroke={2} /></button>
          {:else}
            <button class="tb" title="Add…" onclick={(e) => menuUnder(e.currentTarget, [
              { label: 'New Group…', icon: 'folder-plus', key: '⇧⌘N', action: () => newGroup() },
              { label: 'New Project…', icon: 'book', action: () => newProject() },
              { label: 'New Sheet', icon: 'square-pen', key: '⌘N', action: () => newSheet() },
              { label: 'New Material Sheet', icon: 'paperclip', key: '⌥⌘N', action: () => newSheet({ material: true }) },
              { sep: true },
              { label: 'Import…', icon: 'download', key: '⇧⌘I', action: () => import('./lib/importer.js').then((m) => m.chooseAndImport()) },
            ])}><Icon name="folder-badge-plus" size={19} /></button>
          {/if}
          {#if !narrow.on}<button class="tb" title="Hide Library (⌘2)" onclick={() => panes(2)}><Icon name="sidebar-left" size={19} /></button>{/if}
        </div>
        <Library />
      </div>
    {/if}
    {#if showList}
      <div class="col list" style:width={narrow.on ? null : `${widthOf('list')}px`} style:left={slide && showLib ? `${widthOf('lib')}px` : null}>
        {#if !narrow.on && !slide}<div class="edge right" role="separator" aria-orientation="vertical" aria-label="Sheet list width" title="Drag to resize; double-click for the usual width" onpointerdown={(e) => resize(e, 'list', 1)} ondblclick={() => resetWidth('list')}></div>{/if}
        <div class="bar right">
          {#if narrow.on}
            <button class="back" onclick={() => (app.phone = 'library')}><Icon name="chevron-left" size={20} stroke={2} /> {app.project ? store.projectNode(app.project).name : 'Library'}</button>
          {:else if !showLib}
            <button class="tb" title="Show Library (⌘1)" onclick={() => panes(3)} style="margin-right:auto"><Icon name="sidebar-left" size={19} /></button>
          {/if}
          <button class="tb" class:on={filtering} title="Filter" onclick={() => (filtering = !filtering)}><Icon name="list-filter" size={18} /></button>
          <button class="tb" title="New Sheet (⌘N)" onclick={() => newSheet()}><Icon name="square-pen" size={18} /></button>
        </div>
        <SheetList bind:filtering />
      </div>
    {/if}
    {#if showEditor}
      <div class="col editor">
        <div class="bar">
          {#if narrow.on}
            <button class="back" onclick={() => (app.phone = 'list')}><Icon name="chevron-left" size={20} stroke={2} /> {listTitle}</button>
          {:else if slide || app.panes === 1}
            <button class="tb" title="Show Sheets (⌘2)" onclick={() => panes(2)}><Icon name="sidebar-left" size={19} /></button>
          {/if}
          <div class="capsule" class:hide-phone={narrow.on}>
            <button title="Back" disabled={!app.history.length} onclick={back}><Icon name="chevron-left" size={17} stroke={2} /></button>
            <span class="div"></span>
            <button title="Forward" disabled={!app.future.length} onclick={forward}><Icon name="chevron-right" size={17} stroke={2} /></button>
          </div>
          <span class="grow"></span>
          {#if app.unsaved}<span class="unsaved" title="The server could not be reached. The text is kept in this browser and sent as soon as it can be.">Not saved yet — retrying</span>{/if}
          <button class="tb" title="Export (⇧⌘P)" onclick={exportCurrent}><Icon name="share" size={19} /></button>
          {#if app.translation || hasPair}<button class="tb" class:on={app.translation} title="Translation Mode (⇧⌘T)" onclick={toggleTranslation}><Icon name="languages" size={17} /></button>{/if}
          <button class="tb" title="Find (⌘F), Open Quickly (⌘O)" onclick={(e) => menuUnder(e.currentTarget, [
            { label: 'Find in Sheet', key: '⌘F', action: () => pane && pane.search() },
            { label: 'Search the Library…', key: '⌘O', action: () => { app.quickOpen = true; } },
          ], 'right')}><Icon name="search" size={20} /></button>
          <button class="tb" class:on={app.dashboard} title="Dashboard (⌘4)" onclick={() => { app.dashboard = !app.dashboard; persist(); }}><Icon name="sidebar-right" size={19} /></button>
        </div>
        <div class="editor-body">
          <EditorPane bind:this={pane} />
        </div>
      </div>
    {/if}
    {#if app.dashboard && showEditor}
      <div class="col dash" class:sheet={narrow.on} style:width={narrow.on ? null : `${widthOf('dash')}px`}>
        {#if !narrow.on}<div class="edge left" role="separator" aria-orientation="vertical" aria-label="Dashboard width" title="Drag to resize; double-click for the usual width" onpointerdown={(e) => resize(e, 'dash', -1)} ondblclick={() => resetWidth('dash')}></div>{/if}
        {#if narrow.on}<button class="grab" aria-label="Close" onclick={() => { app.dashboard = false; persist(); }}></button>{/if}
        <Dashboard {pane} />
      </div>
    {/if}
  </div>
  {#if narrow.on || touchFirst.on}<MarkupBar view={() => pane && pane.activeView()} />{/if}
  <QuickOpen />
  <Settings />
{/if}
<Menu />
<Dialogs />
{#if app.toast}
  <div class="toast" role="status">{app.toast.message}</div>
{/if}

<style>
  /* Hide Interface (⌘.): the bars fade away, back when the pointer comes up to them */
  .window.bare :global(.bar) { opacity: 0; transition: opacity 0.25s; }
  .window.bare :global(.bar:hover) { opacity: 1; }
  .window.bare :global(.counter), .window.bare :global(.goalring) { display: none; }

  .window { display: flex; height: 100%; min-height: 0; }
  .col { display: flex; flex-direction: column; min-height: 0; height: 100%; position: relative; }
  /* a pane's edge to drag: a few points either side of the line, the whole height */
  .edge { position: absolute; top: 0; bottom: 0; width: 7px; z-index: 6; cursor: col-resize; touch-action: none; }
  .edge.right { right: -4px; }
  .edge.left { left: -4px; }
  :global(html.resizing), :global(html.resizing *) { cursor: col-resize !important; user-select: none !important; -webkit-user-select: none !important; }
  .lib { width: 240px; flex: none; background: var(--sidebar-bg); }
  .list { width: 280px; flex: none; background: var(--list-bg); border-right: 1px solid var(--sep); }
  .editor { flex: 1; min-width: 0; background: var(--editor-bg); }
  .dash { width: 300px; flex: none; border-left: 1px solid var(--sep); background: var(--sidebar-bg); }
  .bar { height: 56px; flex: none; display: flex; align-items: center; gap: 6px; padding: 0 8px 0 12px; }
  .bar.right { justify-content: flex-end; }
  .lib .bar { justify-content: flex-end; padding-right: 7px; }
  .lib .bar.traffic { padding-left: 78px; }
  /* the Mac shell's traffic lights float over whichever pane comes first; in full screen they are gone */
  .window.shell > .col:first-child > .bar { padding-left: 78px; }
  :global(html.moshe-fullscreen) .window.shell > .col:first-child > .bar { padding-left: 12px; }
  .editor .bar { padding-left: 8px; }
  .grow { flex: 1; }
  .unsaved { font-size: 12px; color: #fff; background: #d70015; border-radius: 10px; padding: 3px 10px; margin-right: 6px; }
  .editor-body { flex: 1; min-height: 0; }
  .narrow .list { width: 100%; border: 0; }
  .narrow .lib { width: 100%; }
  .narrow .bar { padding-top: env(safe-area-inset-top, 0px); height: calc(52px + env(safe-area-inset-top, 0px)); }
  /* under a tablet's status bar (the Android app runs edge to edge): the bars start below it; elsewhere it's 0 */
  .window:not(.narrow) .bar { padding-top: env(safe-area-inset-top, 0px); height: calc(56px + env(safe-area-inset-top, 0px)); }
  .window:not(.narrow) .dash { padding-top: env(safe-area-inset-top, 0px); }
  /* a tablet: the editor whole, the library and the sheets slid over it */
  .window.slide { position: relative; }
  .window.slide > .col.lib, .window.slide > .col.list { position: absolute; top: 0; bottom: 0; left: 0; z-index: 31; box-shadow: 6px 0 24px rgba(0, 0, 0, 0.16); }
  .drawer-scrim { position: absolute; inset: 0; z-index: 30; background: rgba(0, 0, 0, 0.12); }
  .phone-title { font-size: 28px; font-weight: 700; margin-right: auto; padding-left: 6px; color: var(--text-strong); }
  .back { border: 0; background: none; color: var(--accent-fg); display: flex; align-items: center; gap: 2px; font-size: 16px; margin-right: auto; padding: 0; max-width: 60vw; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .hide-phone { display: none; }
  .dash.sheet { position: fixed; left: 0; right: 0; bottom: 0; top: 18vh; width: auto; z-index: 45; border: 0; border-radius: 14px 14px 0 0; box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.18); }
  .grab { position: absolute; top: 6px; left: 50%; transform: translateX(-50%); width: 40px; height: 5px; border-radius: 3px; border: 0; background: var(--sep-strong); z-index: 2; padding: 0; }
  .fatal { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 24px; text-align: center; }
  .fatal h1 { font-size: 20px; margin: 0; }
  .toast {
    position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); background: rgba(40, 40, 42, 0.92); color: #fff;
    padding: 9px 16px; border-radius: 10px; font-size: 13px; z-index: 100; max-width: min(560px, 90vw); box-shadow: 0 6px 24px rgba(0, 0, 0, 0.2);
  }
</style>
