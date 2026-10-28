<script module>
  import { Compartment as C } from '@codemirror/state';
  // shared by every editor, so a sheet's state (its undo) outlives the
  // editor that made it: what depends on an editor is looked up on its view
  export const dynamicC = new C();
  export const readOnlyC = new C();
  export const proofC = new C();
</script>

<script>
  // One sheet in the editor. The text is the sheet's body (its front matter
  // stays in the file, shown in the dashboard). Typing saves a moment later;
  // if the file changed meanwhile (Obsidian, a sync), the store merges the
  // two and the editor takes the merged text, the cursor where it was.
  import { onDestroy, onMount } from 'svelte';
  import { EditorView, keymap, highlightActiveLine, drawSelection, dropCursor, rectangularSelection } from '@codemirror/view';
  import { EditorState } from '@codemirror/state';
  import { history, standardKeymap, simplifySelection, moveLineUp, moveLineDown, undo, redo, isolateHistory } from '@codemirror/commands';
  import { search, searchKeymap, openSearchPanel, findNext, findPrevious, setSearchQuery, SearchQuery } from '@codemirror/search';
  import { parseLines, parseInline, plainLine, plainInline } from '@engine/markup.js';
  import { markup, shortTags, shortInserts, toggleWrap, setHeading, toggleBlock, smartEnter, tabKey } from '../editor/markup-view.js';
  import { focusMode } from '../editor/focus.js';
  import { sheetLinks } from '../editor/links.js';
  import { app, prefs, store, toast, theStorage, openSheet, revealSheet } from '../lib/state.svelte.js';
  import { openMenu, openDialog } from '../lib/ui.svelte.js';
  import { goalFor } from '../lib/actions.js';
  import { stats } from '@engine/sheet.js';
  import '../editor/editor.css';
  import { proof, proofIgnored, configureProof, findingAt, applySuggestion, findingKey, KIND_NAMES, checkField, showChecked, unshowChecked, checkedById } from '../editor/proof.js';
  import { check, dropFinding } from '../lib/check.svelte.js';
  import { hebrew, configureHebrew, hebrewAt, hebrewSuggestions } from '../editor/hebrew.js';
  import { paragraphNumbers } from '../editor/paranum.js';
  import { voiceMarks } from '../voice/marks.js';
  import { penMarks, commitWriting, holdWriting, dropWriting } from '../editor/pen.js';
  import { snapBetweenWords } from '@engine/pen.js';
  import { readSketch } from '@engine/sketch.js';
  import Icon from './Icon.svelte';

  let { path, stacked = false, onactive = null, register = null } = $props();

  let host;
  let view = null;
  let current = null;          // the path the view holds
  let base = '';               // the body as last loaded or saved: what a merge starts from
  let saveTimer = null;
  let dirty = false;
  let pop = $state(null);      // {kind, from, to, x, y, value, extra}
  let writing = $state(null);  // the writing box: {kind: insert | comment | text, pos | from, to, x, y, text}
  let winH = $state(typeof window === 'undefined' ? 800 : window.innerHeight);   // shorter while a keyboard is up: the box stays above it
  let counts = $state(null);
  let selectionCounts = $state(null);

  const states = (globalThis.__mosheStates ||= new Map());   // each sheet's editor state, undo and all, for the session
  const dynamic = dynamicC;
  const readOnly = readOnlyC;

  const fontOf = () => {
    const f = prefs.font === 'System Font' ? 'var(--font-ui)' : `"${prefs.font}", var(--font-ui)`;
    return f;
  };
  const measureFont = () => {
    const fam = prefs.font === 'System Font' ? getComputedStyle(document.body).fontFamily : `"${prefs.font}"`;
    return `500 ${prefs.fontSize}px ${fam}`;
  };

  /** A picture's place in the library, from its address in the sheet (relative to the sheet). */
  function libraryPath(url) {
    if (!url || /^(https?:|data:|blob:)/u.test(url) || !current) return null;
    const dir = current.slice(0, current.lastIndexOf('/'));
    const parts = (dir ? dir.split('/') : []);
    for (const seg of decodeURI(url).split('/')) { if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg); }
    return parts.join('/');
  }

  // pictures drawn again (a sketch edited): their address changes, so the preview loads anew
  const redrawn = new Map();
  function imageUrl(url) {
    if (!url) return null;
    if (/^(https?:|data:|blob:)/u.test(url)) return url;
    const s = theStorage();
    if (!s || !s.rawUrl || !current) return null;
    const p = libraryPath(url), raw = s.rawUrl(p), v = redrawn.get(p);
    return v ? `${raw}${raw.includes('?') ? '&' : '?'}v=${v}` : raw;
  }

  // CodeMirror's own keys, less those the menus use (⇧⌘K keywords, ⌘[ ⌘] back and forward,
  // ⌥⌘↑↓ sheets, ⇧⌘U favorites…) or that no Mac text view has (⌘/ comment, ⌘Enter, ⌥↑ move line)
  const EDITOR_KEYS = [
    { key: 'Mod-z', run: undo, preventDefault: true },
    { key: 'Mod-y', mac: 'Mod-Shift-z', run: redo, preventDefault: true },
    { linux: 'Ctrl-Shift-z', run: redo, preventDefault: true },
    { key: 'Escape', run: simplifySelection },
    ...standardKeymap,
  ];

  function extensions() {
    return [
      history(),
      drawSelection(),
      dropCursor(),
      rectangularSelection(),
      highlightActiveLine(),
      EditorView.lineWrapping,
      EditorView.perLineTextDirection.of(true),
      search({ top: true }),
      markup({
        font: measureFont, imageUrl, imagePreviews: () => prefs.imagePreviews, imageLines: () => prefs.imageLines,
        imageColor: () => prefs.imageColor, firstLineIndent: () => prefs.firstLineIndent,
      }),
      shortInserts(() => {}),
      focusMode(() => app.typewriter),
      sheetLinks(() => store),
      readOnly.of(EditorState.readOnly.of(false)),
      dynamic.of(dynExt()),
      proofC.of(proofExt()),
      checkField,
      voiceMarks,
      penMarks(() => ({ on: !!app.revision && prefs.penMarks !== false, write: (req) => { writing = { ...req, text: '' }; }, fail: (why) => toast(why) })),
      keymap.of([
        { key: 'Enter', run: (v) => prefs.smartLists && smartEnter(v) },
        { key: 'Tab', run: (v) => tabKey(v, false) },
        { key: 'Shift-Tab', run: (v) => tabKey(v, true) },
        { key: 'Mod-b', run: (v) => toggleWrap(v, '**') },
        { key: 'Mod-i', run: (v) => toggleWrap(v, '_') },
        { key: 'Mod-k', run: (v) => insertLinkCmd(v) },
        { key: 'Mod-Shift-h', run: (v) => toggleWrap(v, '==') },
        { key: 'Mod-Shift-c', run: (v) => toggleWrap(v, '%%') },
        { key: 'Mod-Shift-d', run: (v) => toggleWrap(v, '{--', '--}') },
        { key: 'Mod-Alt-1', run: (v) => setHeading(v, 1) },
        { key: 'Mod-Alt-2', run: (v) => setHeading(v, 2) },
        { key: 'Mod-Alt-4', run: (v) => setHeading(v, 4) },
        { key: 'Mod-Alt-5', run: (v) => setHeading(v, 5) },
        { key: 'Mod-Alt-6', run: (v) => setHeading(v, 6) },
        { key: 'Mod-Alt-0', run: (v) => setHeading(v, 0) },
        { key: 'Mod-Shift-3', run: (v) => setHeading(v, '+') },
        { key: 'Mod-Alt-8', run: (v) => toggleBlock(v, '- ') },
        { key: 'Mod-Alt-7', run: (v) => toggleBlock(v, '1. ') },
        { key: 'Mod-Alt-q', run: (v) => toggleBlock(v, '> ') },
        { key: 'Mod-Shift-Alt-v', run: (v) => pastePlain(v) },
        { key: 'Mod-Alt-f', run: () => { run('find', 'replace'); return true; } },
        { key: 'Mod-e', run: () => { run('find', 'selection'); return true; } },
        { key: 'Mod-9', run: (v) => { v.__moshe && v.__moshe.markupPanel && v.__moshe.markupPanel(v); return true; } },
        ...searchKeymap,
        ...EDITOR_KEYS,
      ]),
      EditorView.updateListener.of((u) => u.view.__moshe && u.view.__moshe.update(u)),
      EditorView.domEventHandlers({
        mousedown: (e, v) => !!(v.__moshe && v.__moshe.click(e, v, false)),
        dblclick: (e, v) => !!(v.__moshe && v.__moshe.click(e, v, true)),
        contextmenu: (e, v) => !!(v.__moshe && v.__moshe.menu(e, v)),
        paste: (e, v) => !!(v.__moshe && (v.__moshe.images(e, v, e.clipboardData) || v.__moshe.richPaste(e, v))),
        drop: (e, v) => !!(v.__moshe && v.__moshe.images(e, v, e.dataTransfer)),
      }),
    ];
  }

  // the grammar check (editor/proof.js), with what the writer ignored in this sheet
  let proofKeyNow = '';
  function proofExt() {
    const ignored = current ? store.proofIgnored(current) : [];
    proofKeyNow = `${prefs.grammar}|${prefs.hebrewSpelling}|${current}|${ignored.join('\n')}`;
    return [...(prefs.grammar ? [proof] : []), ...(prefs.hebrewSpelling ? [hebrew] : []), proofIgnored.of(ignored)];
  }
  function reproof() {
    if (!view) return;
    const ignored = current ? store.proofIgnored(current) : [];
    if (`${prefs.grammar}|${prefs.hebrewSpelling}|${current}|${ignored.join('\n')}` !== proofKeyNow) view.dispatch({ effects: proofC.reconfigure(proofExt()) });
  }
  $effect(() => { app.version; prefs.grammar; prefs.hebrewSpelling; reproof(); });
  $effect(() => {
    app.version;
    const words = (store && store.setting('dictionary', [])) || [];
    configureProof({ dialect: Number(prefs.dialect) || 0, words });
    configureHebrew(words);
  });

  // Check Text's findings: shown once when a check of this sheet is done
  let shownRun = 0;
  $effect(() => {
    const run = check.run, path = check.path;
    if (!view || stacked) return;
    if (path !== current) { if (view.state.field(checkField, false)?.list.length) showChecked(view, []); return; }
    if (run === shownRun || !check.results) return;
    shownRun = run;
    if (check.forText !== view.state.doc.toString()) { check.status = 'error'; check.error = 'The text changed while it was being checked: check it again.'; return; }
    showChecked(view, check.results);
  });
  // the dashboard asks to see one
  $effect(() => {
    const show = (e) => {
      if (!view || stacked || check.path !== current) return;
      const f = checkedById(view, e.detail.id);
      if (!f) return;
      view.dispatch({ selection: { anchor: f.from, head: f.to }, effects: EditorView.scrollIntoView(f.from, { y: 'center' }) });
      requestAnimationFrame(() => { const c = view.coordsAtPos(f.from); if (c) proofPop = { f, x: c.left, y: c.bottom + 6 }; });
    };
    window.addEventListener('moshe:show-finding', show);
    return () => window.removeEventListener('moshe:show-finding', show);
  });
  function doneWith(f) { if (f && f.src === 'lt') { unshowChecked(view, f.id); dropFinding(f.id); } }

  let proofPop = $state(null);       // {f, x, y}: a finding of the grammar check, and where to show it
  $effect(() => {
    if (!proofPop) return;
    const away = (e) => { if (!e.target.closest || (!e.target.closest('.proofpop') && !e.target.closest('[data-proof]') && !e.target.closest('[data-check]') && !e.target.closest('[data-heb]') && !e.target.closest('.dash'))) proofPop = null; };
    const esc = (e) => { if (e.key === 'Escape') proofPop = null; };
    window.addEventListener('mousedown', away, true);
    window.addEventListener('keydown', esc, true);
    return () => { window.removeEventListener('mousedown', away, true); window.removeEventListener('keydown', esc, true); };
  });
  function fixWith(g) {
    const f = proofPop && $state.snapshot(proofPop.f);    // taken before the popover goes (its f goes with it)
    proofPop = null;
    if (!f) return;
    applySuggestion(view, f, g);
    doneWith(f);
  }
  function ignoreFinding() {
    const f = proofPop && $state.snapshot(proofPop.f);
    proofPop = null;
    if (f && current) store.ignoreFinding(current, findingKey(f));
    doneWith(f);
  }
  function addToDictionary() {
    const f = proofPop && $state.snapshot(proofPop.f);
    proofPop = null;
    if (!f) return;
    const words = store.setting('dictionary', []) || [];
    if (!words.includes(f.problem)) store.setSetting('dictionary', [...words, f.problem].sort());
    doneWith(f);
    toast(`“${f.problem}” is in your dictionary`);
  }
  const uniqueSuggestions = (f) => { const seen = new Set(); return f.suggestions.filter((g) => { const k = `${g.kind}|${g.text}`; if (seen.has(k)) return false; seen.add(k); return true; }); };
  const messageParts = (m) => String(m).split('`');

  function dynExt() {
    return [
      prefs.paragraphNumbers ? paragraphNumbers : [],
      prefs.smartTags ? shortTags : [],
      EditorView.contentAttributes.of({ spellcheck: prefs.spellcheck ? 'true' : 'false', autocorrect: 'on', autocapitalize: 'sentences', 'aria-label': 'Sheet text' }),
    ];
  }

  /** What this editor does when its view changes. */
  function onUpdate(u) {
    if (u.view.__alignListeners) for (const f of u.view.__alignListeners) f(u);
    if (u.docChanged && current && !u.transactions.every((t) => t.isUserEvent('sync'))) {
      dirty = true;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => save(), 700);
    }
    if (u.docChanged) { countSoon(); if (proofPop) proofPop = null; }
    if (u.selectionSet) countSelection();
    if (u.focusChanged && u.view.hasFocus) { app.focus = 'editor'; if (onactive) onactive(current); }
  }

  function stateFor(p) {
    const cached = states.get(p);
    const sheet = store.openSheet(p);
    const body = sheet ? sheet.body : '';
    if (cached && cached.body === body) return { state: cached.state, body, kept: true };
    const state = EditorState.create({ doc: body, extensions: extensions() });
    return { state, body, kept: false };
  }

  // where this editor was scrolled to in each sheet, for coming back to it
  const scrolls = new Map();

  function load(p) {
    if (current && current !== p) flush(true);
    current = p;
    dirty = false;
    if (!p) return;
    const { state, body, kept } = stateFor(p);
    base = body;
    if (!view) {
      view = new EditorView({ state, parent: host });
      view.__moshe = { update: onUpdate, click: clickMark, menu: textMenu, markupPanel, images: addImages, richPaste };
      if (register) register(path, view);
    } else {
      view.setState(state);
      // as it was left, or from the top: never the last sheet's scroll
      const snap = kept && scrolls.get(p);
      if (snap) view.dispatch({ effects: snap });
      else view.scrollDOM.scrollTop = 0;
    }
    reconfigure();
    countNow();
    if (app.pendingJump && app.pendingJump.path === p) { const h = app.pendingJump.heading; app.pendingJump = null; setTimeout(() => jumpToHeading(h), 30); }
  }

  /** The cursor to a heading of this sheet, scrolled to the top. */
  function jumpToHeading(heading) {
    if (!view || !heading) return;
    const want = heading.toLowerCase();
    for (let i = 1; i <= view.state.doc.lines; i++) {
      const line = view.state.doc.line(i);
      const m = /^#{1,6}[ \t]+(.*)$/u.exec(line.text);
      if (m && m[1].trim().toLowerCase() === want) {
        view.dispatch({ selection: { anchor: line.to }, effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 80 }) });
        view.focus();
        return;
      }
    }
  }

  /** The editor's text into the file (merged with what is there, if it
   *  changed). The file is read again first: a save must not land on an
   *  edit made elsewhere since the last scan. */
  let saving = null;
  let inFlight = 0;            // saves under way: until they land, the editor's text is theirs
  /**
   * The editor's text into the file. The text is taken now; then the file is
   * read again (a save must not land on an edit made elsewhere since the
   * last scan) and the store merges the two. If more was typed while that
   * happened, the merged file becomes the other side of the next save's
   * merge, so neither the typing nor the other edit is lost.
   */
  function save(closing = false) {
    clearTimeout(saveTimer);
    if (!view || !current || !store) return saving;
    const path = current, body = view.state.doc.toString(), from = base, wasDirty = dirty;
    if (!wasDirty && !(closing && PROVISIONAL.test(path))) return saving;
    if (wasDirty && store.isArchived(path)) { toast('This project is archived: its sheets cannot be changed.'); return saving; }
    dirty = false;
    inFlight++;
    const run = async () => {
      try { await store.reread(path); } catch { /* saved below all the same */ }
      inFlight--;
      let r;
      try { r = store.saveSheet(path, body, from, { closing }); } catch (e) {
        console.error(e);
        toast(`Could not save: ${e.message}`, 6000);
        if (current === path) dirty = true;
        return;
      }
      if (current !== path && current !== r.path) return;       // another sheet is open now: nothing to show
      if (r.path !== current) { states.delete(current); current = r.path; }
      const now = view.state.doc.toString();
      if (now === body) {
        base = r.body;
        if (r.body !== body) replaceDoc(r.body);
      } else {
        // typed on meanwhile: what this save started from is the base, the
        // merged file the other side — the next save merges them
        base = body;
        dirty = true;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => save(), 300);
      }
      states.set(current, { state: view.state, body: base });
    };
    saving = (saving || Promise.resolve()).then(run, run);
    return saving;
  }

  const PROVISIONAL = /\/Untitled(?: \d+)?\.md$/u;

  function flush(closing = false) {
    if (!view || !current) return;
    scrolls.set(current, view.scrollSnapshot());
    save(closing);
    states.set(current, { state: view.state, body: base });
  }

  /** The document set to `text` with the smallest change: the cursor stays where it was. */
  function replaceDoc(text) {
    const old = view.state.doc.toString();
    if (old === text) return;
    let a = 0;
    while (a < old.length && a < text.length && old[a] === text[a]) a++;
    let b = 0;
    while (b < old.length - a && b < text.length - a && old[old.length - 1 - b] === text[text.length - 1 - b]) b++;
    view.dispatch({ changes: { from: a, to: old.length - b, insert: text.slice(a, text.length - b) }, annotations: [], userEvent: 'sync' });
    dirty = false;
  }

  /** Someone else changed the file: taken now if nothing here is unsaved, merged at the next save if something is. */
  function external(ev) {
    if (!current || !view) return;
    if (ev.renamed && ev.renamed[current]) { current = ev.renamed[current]; return; }
    if (!ev.external || !ev.paths.includes(current)) return;
    const sheet = store.openSheet(current);
    if (!sheet) return;
    if (inFlight) return;                      // the save under way merges it, and shows the result
    if (dirty) { save(); return; }
    if (sheet.body !== view.state.doc.toString()) { replaceDoc(sheet.body); base = sheet.body; }
  }

  let countTimer = null;
  function countSoon() { clearTimeout(countTimer); countTimer = setTimeout(countNow, 300); }
  function countNow() { if (view) counts = stats(view.state.doc.toString()); }
  function countSelection() {
    if (!view) return;
    const s = view.state.selection.main;
    selectionCounts = s.empty ? null : stats(view.state.sliceDoc(s.from, s.to));
    if (view.hasFocus || !selectionCounts) app.selectionStats = selectionCounts;
  }

  function reconfigure() {
    if (!view) return;
    view.dispatch({ effects: [readOnly.reconfigure(EditorState.readOnly.of(store.isArchived(current || '')))] });
  }

  // ---- links, footnotes, annotations: opened in a popover
  function insertLinkCmd(v) {
    const s = v.state.selection.main;
    const text = v.state.sliceDoc(s.from, s.to);
    const insert = `[${text}]()`;
    v.dispatch({ changes: { from: s.from, to: s.to, insert }, selection: { anchor: s.from + insert.length - 1 }, userEvent: 'input' });
    return true;
  }

  function clickMark(e, v, dbl = false) {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return false;
    // a sketch's picture, double-clicked (or double-tapped with the pen): drawn on again
    const img = dbl && t.closest('.cm-imgbox');
    if (img) {
      const sk = sketchOnLine(v, v.posAtDOM(img));
      if (sk) { e.preventDefault(); sketch(v, sk); return true; }
    }
    const pr = !dbl && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.button === 0 && (t.closest('[data-heb]') || t.closest('[data-check]') || t.closest('[data-proof]'));
    if (pr) {
      const f = pr.dataset.heb !== undefined ? hebrewAt(v, pr) : findingAt(v, pr);
      if (f) {
        const r = pr.getBoundingClientRect();
        proofPop = { f, x: r.left, y: r.bottom + 6 };
        // Hebrew suggestions are asked for when wanted
        if (f.src === 'he' && !f.suggestions) hebrewSuggestions(f.word).then((list) => { if (proofPop && proofPop.f.src === 'he' && proofPop.f.from === f.from && proofPop.f.problem === f.problem) proofPop = { ...proofPop, f: { ...f, suggestions: list.map((text) => ({ kind: 0, text })) } }; });   // (proofPop holds a proxy of f: compared by place)
      }
    }
    const at = (el, key) => Number(el.dataset[key]);
    const rect = t.getBoundingClientRect();
    if (t.dataset.fn) {
      const from = at(t, 'fn');
      const src = v.state.doc.toString();
      let depth = 0, end = from + 1;
      for (let i = from + 1; i < src.length; i++) { if (src[i] === '[') depth++; else if (src[i] === ']' && --depth === 0) { end = i; break; } }
      pop = { kind: 'footnote', from, to: end + 1, x: rect.left, y: rect.bottom + 6, value: src.slice(from + 2, end) };
      e.preventDefault();
      return true;
    }
    const wiki = t.closest('.cm-wikilink');
    if (wiki && (e.metaKey || e.ctrlKey)) {
      const [target] = wiki.textContent.split('|');
      const [name, heading] = target.split('#').map((x) => x.trim());
      const n = name.toLowerCase();
      const hit = n ? store.allSheets(true).find((p) => p.split('/').pop().replace(/\.md$/u, '').toLowerCase() === n || store.sheetInfo(p).title.toLowerCase() === n) : current;
      if (hit) {
        app.pendingJump = heading ? { path: hit, heading } : null;
        if (hit === current) jumpToHeading(heading); else { revealSheet(hit); openSheet(hit); }
      } else toast(`No sheet called “${name}”`);
      e.preventDefault();
      return true;
    }
    const linkEl = t.closest('[data-link]');
    if (linkEl && (t.classList.contains('cm-linkmark') || dbl || e.metaKey || e.ctrlKey)) {
      if ((e.metaKey || e.ctrlKey) && linkEl.dataset.href) { openOut(linkEl.dataset.href); e.preventDefault(); return true; }
      const from = at(linkEl, 'link');
      const src = v.state.doc.toString();
      const close = findLinkEnd(src, from);
      if (!close) return false;
      pop = { kind: 'link', from, to: close.end, x: rect.left, y: rect.bottom + 6, value: close.url, extra: close.text };
      e.preventDefault();
      return true;
    }
    const urlEl = t.closest('.cm-url');
    if (urlEl && (e.metaKey || e.ctrlKey)) { openOut(urlEl.dataset.href); e.preventDefault(); return true; }
    const annEl = t.closest('[data-annot]');
    if (annEl && dbl) {
      const from = Number(annEl.dataset.annot);
      const src = v.state.doc.toString();
      const mid = src.indexOf('==}{>>', from);
      const end = src.indexOf('<<}', mid);
      if (mid < 0 || end < 0) return false;
      pop = { kind: 'annotation', from, to: end + 3, x: rect.left, y: rect.bottom + 6, value: src.slice(mid + 6, end), extra: src.slice(from + 3, mid) };
      e.preventDefault();
      return true;
    }
    return false;
  }

  /** A link out: the shell's browser, or a new tab. */
  function openOut(url) {
    const u = /^[a-z][a-z0-9+.-]*:/iu.test(url) ? url : `https://${url}`;
    if (window.mosheShell && window.mosheShell.openExternal) window.mosheShell.openExternal(u);
    else window.open(u, '_blank', 'noopener');
  }

  /** Images pasted or dropped: saved in _media/ beside the sheet, and put in the text as ![](…). */
  // pasting rich text keeps its formatting as markup;
  // text copied in Moshe carries no HTML and pastes as it is. ⌥⇧⌘V pastes plain.
  function richPaste(e, v) {
    const dt = e.clipboardData;
    const html = dt && dt.getData('text/html');
    if (!html) return false;
    const plain = dt.getData('text/plain');
    e.preventDefault();
    const { from, to } = v.state.selection.main;
    import('../lib/importer.js').then((m) => m.markupFromHtml(html)).catch(() => null).then((md) => {
      const insert = md ?? plain;
      if (!insert) return;
      const sel = v.state.selection.main;
      const [a, b] = sel.from === from && sel.to === to ? [from, to] : [sel.from, sel.to];
      v.dispatch({ changes: { from: a, to: b, insert }, selection: { anchor: a + insert.length }, userEvent: 'input.paste', scrollIntoView: true });
    });
    return true;
  }
  function pastePlain(v) {
    navigator.clipboard.readText().then((t) => {
      const s = v.state.selection.main;
      v.dispatch({ changes: { from: s.from, to: s.to, insert: t }, selection: { anchor: s.from + t.length }, userEvent: 'input.paste', scrollIntoView: true });
    }).catch(() => toast('The clipboard can’t be read here: use ⌘V'));
    return true;
  }

  function addImages(e, v, dt) {
    const files = dt && [...(dt.files || [])].filter((f) => /^image\//u.test(f.type));
    if (!files || !files.length || !current) return false;
    const s = theStorage();
    if (!s || !s.writeRaw) { toast('Images can’t be added here yet.'); return true; }
    e.preventDefault();
    const at = e.type === 'drop' ? v.posAtCoords({ x: e.clientX, y: e.clientY }) ?? v.state.selection.main.head : v.state.selection.main.head;
    const dir = current.slice(0, current.lastIndexOf('/'));
    (async () => {
      const parts = [];
      for (const f of files) {
        const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/\+.*$/u, '');
        const base = (f.name && !/^image\.\w+$/u.test(f.name) ? f.name.replace(/\.[^.]+$/u, '') : `Image ${new Date().toISOString().slice(0, 19).replace(/[T:]/gu, '-')}`).replace(/[\\/:*?"<>|#^[\]]/gu, ' ').trim();
        let name = `${base}.${ext}`;
        for (let n = 2; store.exists(`${dir}/_media/${name}`); n++) name = `${base} ${n}.${ext}`;
        try {
          await s.writeRaw(`${dir}/_media/${name}`, f);
          store.makeDirs(`${dir}/_media`);
          parts.push(`![](_media/${encodeURI(name)})`);
        } catch (err) { toast(`Could not add the image: ${err.message}`); }
      }
      if (!parts.length) return;
      const line = v.state.doc.lineAt(Math.min(at, v.state.doc.length));
      const own = line.text.trim() === '';
      const insert = own ? parts.join('\n') : `\n${parts.join('\n')}\n`;
      const pos = own ? line.from : line.to;
      v.dispatch({ changes: { from: pos, to: own ? line.to : pos, insert }, selection: { anchor: pos + insert.length }, userEvent: 'input' });
      await store.scanChanges();
    })();
    return true;
  }

  /** Right-click in the text: the markup and Split Here. */
  function textMenu(e, v) {
    const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
    const sel = v.state.selection.main;
    if (pos !== null && (sel.empty || pos < sel.from || pos > sel.to)) v.dispatch({ selection: { anchor: pos } });
    const wrap = (a, b) => () => { toggleWrap(v, a, b); v.focus(); };
    const sk = pos !== null ? sketchOnLine(v, pos) : null;
    openMenu(e, [
      ...(sk ? [{ label: 'Edit Sketch…', action: () => sketch(v, sk) }, { sep: true }] : []),
      { label: 'Cut', key: '⌘X', action: () => { document.execCommand('cut'); } },
      { label: 'Copy', key: '⌘C', action: () => { document.execCommand('copy'); } },
      { label: 'Paste', key: '⌘V', action: () => { navigator.clipboard.readText().then((t) => { const s = v.state.selection.main; v.dispatch({ changes: { from: s.from, to: s.to, insert: t } }); }).catch(() => toast('Use ⌘V to paste')); } },
      { sep: true },
      { label: 'Strong', key: '⌘B', action: wrap('**') },
      { label: 'Emphasis', key: '⌘I', action: wrap('_') },
      { label: 'Mark', key: '⇧⌘H', action: wrap('==') },
      { label: 'Comment', key: '⇧⌘C', action: wrap('%%') },
      { label: 'Delete', key: '⇧⌘D', action: wrap('{--', '--}') },
      { label: 'Annotation', action: () => { const s = v.state.selection.main; const t = v.state.sliceDoc(s.from, s.to) || 'text'; v.dispatch({ changes: { from: s.from, to: s.to, insert: `{==${t}==}{>><<}` }, selection: { anchor: s.from + t.length + 9 } }); v.focus(); } },
      { label: 'Link', key: '⌘K', action: () => insertLinkCmd(v) },
      { label: 'Footnote', action: () => { const s = v.state.selection.main; v.dispatch({ changes: { from: s.to, insert: '^[]' }, selection: { anchor: s.to + 2 } }); v.focus(); } },
      { sep: true },
      { label: 'Insert Sketch…', action: () => sketch(v) },
      { label: 'Split Here…', action: () => splitHere(v) },
    ]);
    return true;
  }

  function splitHere(v) {
    const pos = v.state.selection.main.head;
    const line = v.state.doc.lineAt(pos);
    save();
    Promise.resolve(saving).then(() => {
      const at = line.from;
      const created = store.splitSheet(current, at);
      toast('Split into two glued sheets');
      openSheet(created);
    });
  }

  /** ⌘9: every tag, to pick from. */
  function markupPanel(v) {
    const r = v.coordsAtPos(v.state.selection.main.head) || { left: 300, bottom: 200 };
    const wrap = (a, b) => () => { toggleWrap(v, a, b); v.focus(); };
    const block = (t) => () => { toggleBlock(v, t); v.focus(); };
    const ins = (t, back = 0) => () => { const s = v.state.selection.main; v.dispatch({ changes: { from: s.from, to: s.to, insert: t }, selection: { anchor: s.from + t.length - back } }); v.focus(); };
    openMenu({ preventDefault() {}, stopPropagation() {}, clientX: r.left, clientY: r.bottom + 4 }, [
      { heading: 'Paragraph' },
      { label: '# Heading 1', action: () => setHeading(v, 1) }, { label: '## Heading 2', action: () => setHeading(v, 2) }, { label: '### Heading 3', action: () => setHeading(v, 3) },
      { label: '- List', action: block('- ') }, { label: '1. Numbered List', action: block('1. ') }, { label: '> Quote', action: block('> ') }, { label: '%% Comment Block', action: block('%% ') },
      { label: '---- Divider', action: ins('\n----\n') }, { label: '``` Code Block', action: ins('```\n\n```', 4) }, { label: '(toc) Table of Contents', action: ins('(toc)') },
      { heading: 'Inline' },
      { label: '**Strong**', action: wrap('**') }, { label: '_Emphasis_', action: wrap('_') }, { label: '==Mark==', action: wrap('==') }, { label: '%%Comment%%', action: wrap('%%') },
      { label: '{--Delete--}', action: wrap('{--', '--}') }, { label: '{++Insert++}', action: wrap('{++', '++}') }, { label: '`Code`', action: wrap('`') }, { label: '$Equation$', action: wrap('$') },
      { label: '[Link](…)', action: () => insertLinkCmd(v) }, { label: '^[Footnote]', action: ins('^[]', 1) }, { label: '![Image](…)', action: ins('![]()', 3) }, { label: 'Sketch…', action: () => sketch(v) },
    ]);
  }

  function findLinkEnd(src, from) {
    let depth = 0, j = -1;
    for (let i = from; i < src.length; i++) { if (src[i] === '[') depth++; else if (src[i] === ']' && --depth === 0) { j = i; break; } }
    if (j < 0 || src[j + 1] !== '(') return null;
    let d = 0, k = -1;
    for (let i = j + 1; i < src.length; i++) { if (src[i] === '(') d++; else if (src[i] === ')' && --d === 0) { k = i; break; } }
    if (k < 0) return null;
    return { text: src.slice(from + 1, j), url: src.slice(j + 2, k), end: k + 1 };
  }

  function commitPop(remove = false) {
    if (!pop || !view) return;
    const p = pop;
    let insert;
    if (p.kind === 'footnote') insert = remove ? '' : `^[${p.value}]`;
    else if (p.kind === 'link') insert = remove ? p.extra : `[${p.extra}](${p.value.trim()})`;
    else if (p.kind === 'annotation') insert = remove ? p.extra : `{==${p.extra}==}{>>${p.value}<<}`;
    view.dispatch({ changes: { from: p.from, to: p.to, insert }, userEvent: 'input' });
    pop = null;
    view.focus();
  }

  // ---- the life of the view
  let off = null;
  onMount(() => {
    load(path);
    off = store.on(external);
    // a handwritten page saved (InkPage): its picture in this sheet loads again
    const drawn = (e) => { redrawn.set(e.detail, Date.now()); if (view) view.dispatch({ effects: dynamicC.reconfigure(dynExt()) }); };
    window.addEventListener('moshe:redrawn', drawn);
    const beforeUnload = () => flush(false);
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('pagehide', beforeUnload);
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('pagehide', beforeUnload); window.removeEventListener('moshe:redrawn', drawn); };
  });
  onDestroy(() => {
    flush(true);
    if (off) off();
    if (register) register(path, null);
    if (view) view.destroy();
    view = null;
  });

  $effect(() => { const p = path; if (view && p !== current) load(p); });
  $effect(() => {
    // settings that change how the text reads: the view reconfigured
    prefs.font; prefs.fontSize; prefs.firstLineIndent; prefs.imagePreviews; prefs.imageLines; prefs.imageColor; prefs.smartTags; prefs.spellcheck; prefs.paragraphNumbers;
    app.typewriter.highlight; app.typewriter.fixed;
    if (view) view.dispatch({ effects: dynamic.reconfigure(dynExt()) });
  });
  $effect(() => { app.version; reconfigure(); });

  export function focus() { view && view.focus(); }
  export function getView() { return view; }
  export function doSearch() { if (view) openSearchPanel(view); }

  // ---- the menus' commands that act on the text (App.svelte's COMMANDS, docs/MENUS.md)
  /** A menu command on this editor's text. → false if it is not one of these */
  export async function run(name, arg) {
    const v = view;
    if (!v) return false;
    const sel = () => v.state.selection.main;
    const wrap = (a, b = a) => toggleWrap(v, a, b);
    const ins = (t, back = 0) => { const s = sel(); v.dispatch({ changes: { from: s.from, to: s.to, insert: t }, selection: { anchor: s.from + t.length - back }, scrollIntoView: true, userEvent: 'input' }); };
    const ownLine = (t, back = 0) => {       // a block on a line of its own
      const s = sel(), line = v.state.doc.lineAt(s.from);
      const before = s.from > line.from ? '\n' : '', after = s.to < line.to ? '\n' : '';
      ins(`${before}${t}${after}`, back + after.length);
    };
    const ownBlock = (t, caret) => {          // a block after the paragraph, never inside it, a blank line either side
      const s = sel(), doc = v.state.doc, line = doc.lineAt(s.from), end = doc.lineAt(s.to);
      const blank = (n) => n < 1 || n > doc.lines || !doc.line(n).text.trim();
      const empty = line.number === end.number && !line.text.trim();
      const from = empty ? line.from : end.to, to = empty ? line.to : end.to;
      const pre = empty ? (blank(line.number - 1) ? '' : '\n') : '\n\n';
      const post = blank(end.number + 1) ? '' : '\n';
      v.dispatch({ changes: { from, to, insert: pre + t + post }, selection: { anchor: from + pre.length + caret }, scrollIntoView: true, userEvent: 'input' });
    };
    const fence = (open) => {                 // the selected lines inside a fence
      const s = sel(), a = v.state.doc.lineAt(s.from), b = v.state.doc.lineAt(s.to);
      const inner = v.state.sliceDoc(a.from, b.to);
      v.dispatch({ changes: { from: a.from, to: b.to, insert: `${open}\n${inner}\n\`\`\`` }, selection: { anchor: a.from + open.length + 1 + inner.length }, userEvent: 'input' });
    };
    // a command from a menu is a step of its own in the history, apart from the typing around it
    const own = !['undo', 'redo', 'find', 'copyAs'].includes(name);
    if (own) v.dispatch({ annotations: isolateHistory.of('full') });
    switch (name) {
      case 'strong': wrap('**'); break;
      case 'emphasis': wrap('_'); break;
      case 'mark': wrap('=='); break;
      case 'comment': wrap('%%'); break;
      case 'code': wrap('`'); break;
      case 'markDelete': wrap('{--', '--}'); break;
      case 'markInsert': wrap('{++', '++}'); break;
      case 'link': insertLinkCmd(v); break;
      case 'heading': setHeading(v, Number(arg) || 0); break;
      case 'annotate': { const s = sel(); const t = v.state.sliceDoc(s.from, s.to) || 'text'; v.dispatch({ changes: { from: s.from, to: s.to, insert: `{==${t}==}{>><<}` }, selection: { anchor: s.from + t.length + 9 } }); break; }
      case 'dashedList': toggleBlock(v, '- '); break;
      case 'numberedList': toggleBlock(v, '1. '); break;
      case 'quote': toggleBlock(v, '> '); break;
      case 'commentBlock': toggleBlock(v, '%% '); break;
      case 'codeBlock': fence('```'); break;
      case 'rawBlock': fence('```raw'); break;
      case 'clearMarkup': clearMarkup(v); break;
      case 'insert':
        switch (arg) {
          case 'lineBreak': ins('\n'); break;
          case 'tab': ins('\t'); break;
          case 'divider': ownLine('----'); break;
          case 'footnote': { const s = sel(); v.dispatch({ changes: { from: s.to, insert: '^[]' }, selection: { anchor: s.to + 2 } }); break; }
          case 'equation': wrap('$'); break;
          case 'table': ownBlock('|  |  |\n| --- | --- |\n|  |  |', 2); break;     // the caret in the first cell
          case 'toc': ownLine('(toc)'); break;
          case 'image': case 'video': pickImages(v); break;
          case 'sketch': sketch(v); break;
          default: return false;
        }
        break;
      case 'split': splitAtSelection(v); break;
      case 'moveLine': (Number(arg) < 0 ? moveLineUp : moveLineDown)(v); break;
      case 'find':
        if (arg === 'next') findNext(v);
        else if (arg === 'previous') findPrevious(v);
        else if (arg === 'selection') { const s = sel(); const t = v.state.sliceDoc(s.from, s.to); if (t) v.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: t })) }); }
        else { openSearchPanel(v); if (arg === 'replace') requestAnimationFrame(() => v.dom.querySelector('.cm-search [name=replace]')?.focus()); }
        break;
      case 'copyAs': await copyAs(v, arg); break;
      case 'pasteAs': await pasteAs(v, arg); break;
      case 'pasteFrom': await pasteFrom(v, arg); break;
      case 'markupPanel': markupPanel(v); break;
      case 'undo': undo(v); break;
      case 'redo': redo(v); break;
      default: return false;
    }
    if (own) v.dispatch({ annotations: isolateHistory.of('full') });
    if (name === 'insert' && arg === 'sketch') return true;     // the drawing has the screen (and no keyboard over it)
    if (name !== 'find' || (arg !== 'open' && arg !== 'replace' && arg)) v.focus();
    return true;
  }

  function closeWriting() { writing = null; if (view) dropWriting(view); }
  /** The box takes the keyboard (and the pen's handwriting) from the editor as it opens. */
  function takeFocus(el) {
    if (view) view.contentDOM.blur();
    el.focus();
    requestAnimationFrame(() => { if (document.activeElement !== el) el.focus(); });
  }
  function commitWritingBox() {
    const w = writing && $state.snapshot(writing);
    writing = null;
    if (w && view) { commitWriting(view, w, w.text); view.focus(); }
  }

  /** Clear Markup: the selected text (or the line) as a reader sees it, the tags gone. */
  function clearMarkup(v) {
    const s = v.state.selection.main, doc = v.state.doc, text = doc.toString();
    const opts = { writer: true, footnotes: true, images: true, math: true };
    const changes = [];
    for (let n = doc.lineAt(s.from).number, last = doc.lineAt(s.to).number; n <= last; n++) {
      const line = doc.line(n);
      const a = s.empty ? line.from : Math.max(line.from, s.from), b = s.empty ? line.to : Math.min(line.to, s.to);
      if (b <= a) continue;
      let plain;
      if (a === line.from && b === line.to) {
        const L = parseLines(text, { from: line.from, to: line.to }).find((x) => x.from === line.from);
        plain = L ? plainLine(text, L, opts) : text.slice(a, b);
      } else plain = plainInline(text, a, b, parseInline(text, a, b), opts);
      if (plain !== text.slice(a, b)) changes.push({ from: a, to: b, insert: plain });
    }
    if (changes.length) v.dispatch({ changes, userEvent: 'input' });
  }

  /** Split at Selection: a new sheet from the cursor on, glued to this one. */
  function splitAtSelection(v) {
    const at = v.state.selection.main.head;
    save();
    Promise.resolve(saving).then(() => { const created = store.splitSheet(current, at); toast('Split into two glued sheets'); openSheet(created); });
  }

  /** The sketch whose picture is on this line, if it's one of Moshe's (an SVG beside the sheet): {path, url}. */
  function sketchOnLine(v, pos) {
    const line = v.state.doc.lineAt(pos);
    const m = /^\s*!\[[^\]\n]*\]\(<?([^)\s>]+\.svg)>?\)\s*$/iu.exec(line.text);
    const path = m && libraryPath(m[1]);
    return path ? { path, url: imageUrl(m[1]) } : null;
  }

  /** Insert › Sketch, or a sketch drawn on again: the drawing window, and the picture saved beside the sheet. */
  async function sketch(v, existing = null) {
    const s = theStorage();
    if (!s || !s.writeRaw || !current) { toast('Sketches can’t be saved here yet.'); return; }
    let strokes = [];
    if (existing) {
      try {
        const back = readSketch(await (await fetch(existing.url)).text());
        if (!back) { toast('That picture wasn’t drawn in Moshe, so it can’t be drawn on here.'); return; }
        strokes = back.strokes;
      } catch (err) { toast(`Could not open the sketch: ${err.message}`); return; }
    }
    const at = v.state.selection.main.head, sheet = current;
    v.contentDOM.blur();                          // a tablet's keyboard away while drawing
    const r = await openDialog('sketch', { strokes });
    if (!r || current !== sheet) return;
    const dir = sheet.slice(0, sheet.lastIndexOf('/'));
    let path = existing && existing.path, name = null;
    if (!path) {
      const d = new Date(), two = (n) => String(n).padStart(2, '0');
      const base = `Sketch ${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}.${two(d.getMinutes())}`;
      name = `${base}.svg`;
      for (let n = 2; store.exists(`${dir}/_media/${name}`); n++) name = `${base} ${n}.svg`;
      path = `${dir}/_media/${name}`;
    }
    try {
      await s.writeRaw(path, new Blob([r.svg], { type: 'image/svg+xml' }));
      store.makeDirs(`${dir}/_media`);
    } catch (err) { toast(`Could not save the sketch: ${err.message}`); return; }
    if (existing) {
      redrawn.set(path, Date.now());
      v.dispatch({ effects: dynamicC.reconfigure(dynExt()) });     // the previews built again, with the new address
    } else {
      const link = `![Sketch](_media/${encodeURI(name)})`;
      const line = v.state.doc.lineAt(Math.min(at, v.state.doc.length));
      const own = line.text.trim() === '';
      const insert = own ? link : `\n${link}`;
      const pos = own ? line.from : line.to;
      v.dispatch({ changes: { from: pos, to: own ? line.to : pos, insert }, selection: { anchor: pos + insert.length }, userEvent: 'input' });
    }
    await store.scanChanges();
    v.focus();
  }

  /** Insert › Image: pictures chosen from the device, saved beside the sheet. */
  function pickImages(v) {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.multiple = true;
    input.onchange = () => addImages({ preventDefault() {}, type: 'paste' }, v, { files: input.files });
    input.click();
  }

  /** Copy as Markdown, HTML or Rich Text: the selection, or the whole sheet. */
  async function copyAs(v, kind) {
    const s = v.state.selection.main;
    const text = s.empty ? v.state.doc.toString() : v.state.sliceDoc(s.from, s.to);
    let html = null;
    if (kind === 'html' || kind === 'rich') {
      const { exportSheets } = await import('@export');
      html = exportSheets([{ title: '', body: text, path: current || 'Sheet.md' }], { format: 'html', full: false }).text;
    }
    const plain = kind === 'html' ? html : text;
    const shell = window.mosheShell;
    try {
      if (shell && shell.copy) await shell.copy({ text: plain, html: kind === 'rich' ? html : null });
      else if (kind === 'rich' && window.ClipboardItem) await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]);
      else await navigator.clipboard.writeText(plain);
      toast(kind === 'html' ? 'Copied as HTML' : kind === 'rich' ? 'Copied as rich text' : 'Copied as Markdown');
    } catch { toast('The clipboard can’t be written here'); }
  }

  const clipboardText = async (arg) => (arg && typeof arg.text === 'string' ? arg.text : navigator.clipboard.readText());

  /** Paste as Code Block or Raw Source Block. */
  async function pasteAs(v, arg) {
    let text;
    try { text = await clipboardText(arg); } catch { toast('The clipboard can’t be read here'); return; }
    const kind = (arg && arg.kind) || arg || 'code';
    const open = kind === 'raw' ? '```raw' : '```';
    const s = v.state.selection.main, line = v.state.doc.lineAt(s.from);
    const block = `${s.from > line.from ? '\n' : ''}${open}\n${text.replace(/\n+$/u, '')}\n\`\`\`\n`;
    v.dispatch({ changes: { from: s.from, to: s.to, insert: block }, selection: { anchor: s.from + block.length }, userEvent: 'input.paste', scrollIntoView: true });
  }

  /** Paste from Markdown (as it is), HTML (its source read as markup) or Rich Text (the clipboard's formatting as markup). */
  async function pasteFrom(v, arg) {
    const kind = (arg && arg.kind) || arg || 'markdown';
    let text = '', html = '';
    try {
      if (arg && typeof arg === 'object') { text = arg.text || ''; html = arg.html || ''; }
      else if (kind === 'rich' && navigator.clipboard.read) {
        for (const item of await navigator.clipboard.read()) {
          if (item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
          if (item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text();
        }
      } else text = await navigator.clipboard.readText();
    } catch { toast('The clipboard can’t be read here'); return; }
    let insert = text;
    if (kind === 'html' || kind === 'rich') {
      const m = await import('../lib/importer.js');
      insert = (await m.markupFromHtml(kind === 'html' ? text : html || text)) ?? text;
    }
    const s = v.state.selection.main;
    v.dispatch({ changes: { from: s.from, to: s.to, insert }, selection: { anchor: s.from + insert.length }, userEvent: 'input.paste', scrollIntoView: true });
  }

  const counterText = $derived.by(() => {
    const c = selectionCounts || counts;
    if (!c) return '';
    const n = { words: c.words, characters: c.characters, sentences: c.sentences, paragraphs: c.paragraphs, pages: c.pages }[app.counter] ?? c.words;
    const label = { words: n === 1 ? 'Word' : 'Words', characters: n === 1 ? 'Character' : 'Characters', sentences: n === 1 ? 'Sentence' : 'Sentences', paragraphs: n === 1 ? 'Paragraph' : 'Paragraphs', pages: n === 1 ? 'Page' : 'Pages' }[app.counter] || 'Words';
    return `${n.toLocaleString()} ${label}`;
  });
  const COUNTERS = ['words', 'characters', 'sentences', 'paragraphs', 'pages'];

  // the sheet's goal at the editor's top right: a ring, and its popover
  const goalNow = $derived.by(() => {
    app.version;
    if (stacked || !path || !counts || !store.exists(path)) return null;
    const info = store.sheetInfo(path);
    return info && info.goal ? { goal: info.goal, g: store.goalProgress(info.goal, counts) } : null;
  });
  let goalPop = $state(null);
  const GOAL_UNIT = { words: 'words', characters: 'characters', 'characters-no-spaces': 'characters', sentences: 'sentences', paragraphs: 'paragraphs', lines: 'lines', pages: 'pages', 'reading-time': 'min' };
  const GOAL_TYPE = { 'at-least': 'at least', 'at-most': 'at most', about: 'about', daily: 'every day' };
</script>

<div class="wrap" class:stacked>
  <div bind:this={host} class="moshe-editor" class:stacked class:revision={app.revision} class:rev-one={app.revision && !!app.revisionKind} class:rev-annotation={app.revision && app.revisionKind === 'annotation'} class:rev-comment={app.revision && app.revisionKind === 'comment'} class:rev-mark={app.revision && app.revisionKind === 'mark'} class:rev-delete={app.revision && app.revisionKind === 'delete'} class:rev-insert={app.revision && app.revisionKind === 'insert'} class:marker={app.typewriter.marker} class:page={prefs.pageBackground && !stacked}
    style="--ed-font:{fontOf()};--ed-size:{prefs.fontSize}px;--ed-lh:{prefs.lineHeight * 1.06};--ed-width:{prefs.lineWidth};--ed-para:{prefs.paragraphSpacing * 0.5}em;--ed-cursor:{prefs.caret === 'text' ? 'var(--ed-text)' : 'var(--accent-fg)'}"></div>
  {#if prefs.showCounter && !stacked && counterText}
    <button class="counter" class:sel={!!selectionCounts} class:ringed={!!goalNow} title="Click to count something else"
      onclick={() => { app.counter = COUNTERS[(COUNTERS.indexOf(app.counter) + 1) % COUNTERS.length]; }}>{counterText}</button>
  {/if}
  {#if goalNow}
    <button class="goalring" class:done={goalNow.g.reached} class:over={goalNow.g.over} style="--p:{Math.min(1, goalNow.g.fraction)}" title="Goal"
      aria-label="Goal: {goalNow.g.value.toLocaleString()} of {goalNow.g.target.toLocaleString()}" onclick={(e) => { goalPop = e.currentTarget.getBoundingClientRect(); }}></button>
  {/if}
</div>

{#if goalPop && goalNow}
  {@const g = goalNow.g}
  <div class="scrim" onmousedown={() => (goalPop = null)} role="presentation"></div>
  <div class="goalpop popover" role="dialog" aria-label="Goal" style="left:{Math.max(8, Math.min(goalPop.left + goalPop.width / 2 - 100, innerWidth - 208))}px;top:{goalPop.bottom + 8}px">
    <div class="bigring" class:done={g.reached} class:over={g.over}>
      <svg viewBox="0 0 150 150" aria-hidden="true">
        <circle class="disc" cx="75" cy="75" r="61" />
        <circle class="arc" cx="75" cy="75" r="68" pathLength="100" stroke-dasharray="{Math.max(0.01, Math.min(1, g.fraction) * 100)} 100" transform="rotate(-90 75 75)" />
      </svg>
      <div><small>{g.reached ? 'Done' : 'Already'}</small><b>{g.value.toLocaleString()}</b><small>{GOAL_UNIT[goalNow.goal.metric] || 'words'}</small></div>
    </div>
    <p>of {GOAL_TYPE[goalNow.goal.type] || ''}<br /><b>{g.target.toLocaleString()}</b> {GOAL_UNIT[goalNow.goal.metric] || 'words'}{#if goalNow.goal.deadline}<br /><span class="dim">by {goalNow.goal.deadline}{#if g.perDay !== undefined} · {g.perDay.toLocaleString()} a day{/if}</span>{/if}</p>
    <button class="link" onclick={() => { goalPop = null; goalFor({ sheet: true, path, goal: goalNow.goal }); }}>Edit Goal…</button>
  </div>
{/if}

<svelte:window bind:innerHeight={winH} />

{#if writing}
  <div class="scrim" onmousedown={closeWriting} role="presentation"></div>
  <div class="popover writebox" role="dialog" aria-label={writing.kind === 'insert' ? 'Insert' : writing.kind === 'comment' ? 'Comment' : 'Write'}
    style="left:{Math.max(8, Math.min(writing.x - 40, innerWidth - 356))}px;top:{Math.max(8, Math.min(writing.y + 10, winH - 250))}px">
    <div class="pop-title">{writing.kind === 'insert' ? 'Insert' : writing.kind === 'comment' ? 'Comment' : 'Write'}</div>
    <textarea class="field area" rows="3" dir="auto" use:takeFocus bind:value={writing.text} placeholder="Write here with the pen, or type"
      onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitWritingBox(); } if (e.key === 'Escape') closeWriting(); }}></textarea>
    <div class="pop-row"><span style="flex:1"></span><button class="btn" onclick={closeWriting}>Cancel</button>
      <button class="btn primary" onclick={commitWritingBox}>{writing.kind === 'comment' ? (writing.text.trim() ? 'Add Comment' : 'Highlight') : 'Insert'}</button></div>
  </div>
{/if}

{#if proofPop}
  {@const f = proofPop.f}
  <div class="popover proofpop" role="dialog" aria-label="Suggestion" style="left:{Math.max(8, Math.min(proofPop.x, innerWidth - 300))}px;top:{Math.min(proofPop.y, innerHeight - 220)}px">
    <div class="pk {f.cls}"><i></i>{KIND_NAMES[f.cls]}{#if f.src === 'lt'}<span class="src">LanguageTool</span>{/if}</div>
    <p>{#each messageParts(f.message) as part, i}{#if i % 2}<b>{part}</b>{:else}{part}{/if}{/each}</p>
    {#if f.src === 'he' && !f.suggestions}<p class="hint">Looking for suggestions…</p>{:else if f.src === 'he' && !f.suggestions.length}<p class="hint">No suggestions.</p>{/if}
    {#if f.suggestions && uniqueSuggestions(f).length}
      <div class="sugs" dir="auto">
        {#each uniqueSuggestions(f) as g}
          <button class="sug" onclick={() => fixWith(g)}>{g.kind === 1 ? `Remove “${f.problem}”` : g.kind === 2 ? `Add “${g.text}”` : g.text}</button>
        {/each}
      </div>
    {/if}
    <div class="acts">
      <button class="link" onclick={ignoreFinding}>Ignore</button>
      {#if f.cls === 'sp'}<button class="link" onclick={addToDictionary}>Add to Dictionary</button>{/if}
    </div>
  </div>
{/if}

{#if pop}
  <div class="scrim" onmousedown={() => commitPop()} role="presentation"></div>
  <div class="popover pop" style="left:{Math.min(pop.x, innerWidth - 340)}px;top:{Math.min(pop.y, innerHeight - 200)}px">
    <div class="pop-title">{pop.kind === 'link' ? 'Link' : pop.kind === 'footnote' ? 'Footnote' : 'Annotation'}</div>
    {#if pop.kind === 'link'}
      <!-- svelte-ignore a11y_autofocus -->
      <input class="field" style="width:100%" bind:value={pop.value} placeholder="https://" autofocus
        onkeydown={(e) => { if (e.key === 'Enter') commitPop(); if (e.key === 'Escape') pop = null; }} />
      <div class="pop-row">
        <button class="btn" onclick={() => openOut(pop.value)}>Open</button>
        <button class="btn danger" onclick={() => commitPop(true)}>Remove Link</button>
        <span style="flex:1"></span>
        <button class="btn primary" onclick={() => commitPop()}>Done</button>
      </div>
    {:else}
      <!-- svelte-ignore a11y_autofocus -->
      <textarea class="field area" bind:value={pop.value} autofocus rows="4"
        onkeydown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commitPop(); if (e.key === 'Escape') pop = null; }}></textarea>
      <div class="pop-row">
        <button class="btn danger" onclick={() => commitPop(true)}>Remove {pop.kind === 'footnote' ? 'Footnote' : 'Annotation'}</button>
        <span style="flex:1"></span>
        <button class="btn primary" onclick={() => commitPop()}>Done</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .wrap { position: relative; height: 100%; min-height: 0; }
  .wrap.stacked { height: auto; }
  .counter {
    position: absolute; top: 26px; right: 28px; border: 0; background: none; color: var(--muted);
    font-size: 13px; padding: 2px 4px; border-radius: 4px; cursor: default; font-variant-numeric: tabular-nums;
  }
  .counter.sel { color: var(--accent-fg); }
  .counter.ringed { right: 50px; }
  .goalring { position: absolute; top: 30px; right: 30px; width: 15px; height: 15px; border-radius: 50%; border: 0; padding: 0; cursor: default;
    background: conic-gradient(#0a84ff calc(var(--p) * 360deg), var(--sel-grey) 0); -webkit-mask: radial-gradient(circle, transparent 3.5px, #000 4px); mask: radial-gradient(circle, transparent 3.5px, #000 4px); }
  .goalring.done { background: #34c759; }
  .goalring.over { background: #ff3b30; }
  .goalpop { position: fixed; z-index: 50; width: 200px; padding: 16px 12px 12px; background: var(--hud-bg, var(--popover-bg)); display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; font-size: 13px; }
  .goalpop p { margin: 0; line-height: 1.4; }
  .goalpop .dim { color: var(--muted); font-size: 11px; }
  .goalpop .link { border: 0; background: none; color: #0a84ff; font-size: 12px; padding: 0; }
  .bigring { width: 150px; height: 150px; position: relative; --ring: #0a84ff; }
  .bigring.done { --ring: #34c759; }
  .bigring.over { --ring: #ff3b30; }
  .bigring svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  .bigring .disc { fill: color-mix(in srgb, var(--ring) 14%, transparent); }
  .bigring .arc { fill: none; stroke: var(--ring); stroke-width: 12; stroke-linecap: round; }
  .bigring > div { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .bigring b { font-size: 34px; font-weight: 400; font-variant-numeric: tabular-nums; line-height: 1.15; }
  .bigring small { font-size: 12px; }
  .counter:hover { background: var(--hint-bg); }
  .scrim { position: fixed; inset: 0; z-index: 49; }
  .proofpop { position: fixed; z-index: 50; width: 280px; padding: 10px 12px; background: var(--hud-bg, var(--popover-bg)); display: flex; flex-direction: column; gap: 8px; font-size: 12.5px; }
  .proofpop p { margin: 0; line-height: 1.4; color: var(--text); }
  .pk { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; color: var(--section); }
  .pk .src { margin-left: auto; font-weight: 400; opacity: 0.7; }
  .pk i { width: 8px; height: 8px; border-radius: 50%; background: var(--pk); }
  .pk.sp { --pk: #e5484d; } .pk.gr { --pk: #f59e0b; } .pk.st { --pk: #3b82f6; } .pk.pu { --pk: #a855f7; }
  .sugs { display: flex; flex-wrap: wrap; gap: 6px; }
  .sug { border: 0; border-radius: 6px; padding: 3px 9px; background: var(--accent); color: var(--on-accent); font-size: 12.5px; }
  .sug:hover { filter: brightness(1.08); }
  .acts { display: flex; gap: 14px; }
  .proofpop .hint { color: var(--muted); font-size: 11.5px; }
  .acts .link { border: 0; background: none; padding: 0; color: var(--accent-soft); font-size: 12px; }
  .pop { width: 320px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  .pop-title { font-size: 11px; font-weight: 600; color: var(--section); text-transform: uppercase; letter-spacing: 0.04em; }
  .pop-row { display: flex; gap: 6px; align-items: center; }
  .area { height: auto; padding: 6px 8px; resize: vertical; font-size: 13px; line-height: 1.4; width: 100%; }
  .writebox { position: fixed; z-index: 50; width: 340px; padding: 12px; display: flex; flex-direction: column; gap: 8px; background: var(--hud-bg, var(--popover-bg)); }
  .writebox .area { font-size: 16px; min-height: 84px; }
</style>
