// What the menus, buttons and shortcuts do: each a change to the library
// through the store, and whatever the window should show after it.
import { app, store, select, openSheet, openProject, closeProject, persist, toast } from './state.svelte.js';
import { openDialog, confirm } from './ui.svelte.js';

const dirOf = (p) => p.slice(0, p.lastIndexOf('/'));
const nameOf = (p) => p.slice(p.lastIndexOf('/') + 1);

/** The group a new sheet goes in: the selected one, or the Inbox. */
export function targetGroup() {
  const sel = app.selection;
  if (sel.endsWith('#pending')) return sel.slice(0, -8);
  if (store.exists(sel) && !sel.includes('#') && sel !== 'Projects') return sel;
  if (app.sheet) return dirOf(app.sheet);
  return app.project ? app.project : 'Notes';
}

export function newSheet({ material = false, text = '' } = {}) {
  const dir = targetGroup();
  if (store.isArchived(dir)) { toast('This project is archived.'); return null; }
  const after = app.sheet && dirOf(app.sheet) === dir ? app.sheet : null;
  const p = store.createSheet(dir, { after, material, text });
  if (!store.sheetList(app.selection).sections.some((s) => s.sheets.some((x) => x.path === p))) select(dir, { keepSheet: true });
  openSheet(p);
  app.focus = 'editor';
  setTimeout(() => window.dispatchEvent(new CustomEvent('moshe:focus-editor')), 30);
  return p;
}

export async function newGroup(parent = null) {
  const where = parent || (app.project ? app.project : (store.exists(app.selection) && !app.selection.includes('#') ? app.selection : 'Notes'));
  const r = await openDialog('group', { title: 'New Group', name: 'New Group' });
  if (!r) return;
  const p = store.createGroup(where === 'Projects' ? 'Notes' : where, r.name, { icon: r.icon, color: r.color });
  if (where !== 'Notes') app.expanded = { ...app.expanded, [where]: true };
  select(p);
}

export async function editGroup(node) {
  const r = await openDialog('group', { title: node.filter ? 'Edit Filter' : 'Edit Group', name: node.name, icon: node.icon, color: node.color, filter: node.filter, rules: node.rules });
  if (!r) return;
  if (node.filter) {
    store.saveFilter(node.parent, { ...node, name: r.name, icon: r.icon, color: r.color, rules: r.rules || node.rules });
    return;
  }
  store.editGroup(node.path, { name: r.name, icon: r.icon, color: r.color });
}

export async function newProject() {
  const r = await openDialog('project', { title: 'New Project' });
  if (!r) return;
  const p = store.createProject(r.name, { template: r.template, icon: r.icon, color: r.color, goal: r.goal });
  openProject(p);
}

export async function editProject(node) {
  const r = await openDialog('project', { title: 'Edit Project', name: node.name, icon: node.icon, color: node.color, goal: node.goal, editing: true });
  if (!r) return;
  store.editGroup(node.path, { name: r.name, icon: r.icon, color: r.color, goal: r.goal || null });
}

export async function trashGroup(node) {
  const n = store.sheetsUnder(node.path).length;
  if (n && !(await confirm(`Move “${node.name}” to the Trash?`, `It holds ${n} sheet${n === 1 ? '' : 's'}. You can put it back from the Trash.`, 'Move to Trash', true))) return;
  const parent = dirOf(node.path);
  store.trashGroup(node.path);
  if (app.selection === node.path || app.selection.startsWith(node.path + '/')) select(store.exists(parent) && parent !== 'Projects' ? parent : 'Notes');
  if (app.project === node.path) closeProject();
}

export async function goalFor(target) {
  const r = await openDialog('goal', { goal: target.goal, group: !target.sheet, title: target.sheet ? 'Sheet Goal' : `Goal for ${target.name}` });
  if (r === null || r === undefined) return;
  if (target.sheet) store.setSheetMeta(target.path, { goal: r === false ? null : r });
  else store.editGroup(target.path, { goal: r === false ? null : r });
}

export function trashSheets(paths) {
  if (!paths.length) return;
  const list = store.sheetList(app.selection).sections.flatMap((s) => s.sheets.map((x) => x.path));
  const last = list.indexOf(paths[paths.length - 1]);
  for (const p of paths) store.trashSheet(p);
  const rest = list.filter((p) => !paths.includes(p));
  const next = rest[Math.min(last - paths.length + 1, rest.length - 1)] || rest[rest.length - 1] || null;
  openSheet(next, { fromList: true });
  toast(paths.length === 1 ? 'Moved to the Trash' : `${paths.length} sheets moved to the Trash`);
}

export function groupMenu(node) {
  const p = node.path;
  if (node.filter) {
    return [
      { label: 'Edit Filter…', action: () => editGroup(node) },
      { sep: true },
      { label: 'Delete Filter', action: () => store.removeFilter(node.path) },
    ];
  }
  const isNotes = p === 'Notes';
  const inProject = !!store.projectOf(p);
  return [
    { label: 'New Sheet', icon: 'square-pen', action: () => { select(p, { keepSheet: true }); newSheet(); } },
    { label: 'New Group…', icon: 'folder-plus', action: () => newGroup(p), disabled: node.templates },
    { label: 'New Filter…', icon: 'list-filter', action: () => newFilter(p) },
    { sep: true },
    !isNotes && !node.templates && { label: 'Edit…', action: () => editGroup(node) },
    { label: node.goal ? 'Edit Goal…' : 'Goal…', icon: 'target', action: () => goalFor({ path: p, name: node.name, goal: node.goal }) },
    { label: 'Statistics', icon: 'chart-line', action: () => openDialog('stats', { path: p, name: node.name }) },
    { label: 'Sort by', submenu: sortItems(p) },
    { sep: true },
    { label: 'Export…', icon: 'share', action: () => openDialog('export', { paths: store.sheetsUnder(p).filter((x) => !store.sheetInfo(x).material), title: node.name }) },
    !isNotes && !inProject && { label: 'Convert to Project', action: () => { const np = store.groupToProject(p); openProject(np); } },
    !isNotes && !node.templates && { sep: true },
    !isNotes && !node.templates && { label: 'Move to Trash', icon: 'trash-2', action: () => trashGroup(node) },
  ];
}

export function sortItems(dir) {
  const cur = store.sget(dir, 'sort', 'manual') || 'manual';
  const base = cur.replace(/^-/u, ''), rev = cur.startsWith('-');
  return [
    { label: 'Manually', checked: base === 'manual', action: () => store.setSort(dir, 'manual') },
    { label: 'By Title', checked: base === 'title', action: () => store.setSort(dir, rev ? '-title' : 'title') },
    { label: 'By Modification Date', checked: base === 'modified', action: () => store.setSort(dir, rev ? 'modified' : '-modified') },
    { label: 'By Creation Date', checked: base === 'created', action: () => store.setSort(dir, rev ? 'created' : '-created') },
    { sep: true },
    { label: 'Reverse Order', checked: rev, disabled: base === 'manual', action: () => store.setSort(dir, rev ? base : `-${base}`) },
  ];
}

export async function newFilter(parent) {
  const r = await openDialog('group', { title: 'New Filter', name: 'New Filter', icon: 'list-filter', filter: true, rules: { match: 'all', items: [{ field: 'keyword', op: 'is', value: '' }] } });
  if (!r) return;
  const id = store.saveFilter(parent, { name: r.name, icon: r.icon, color: r.color, rules: r.rules });
  app.expanded = { ...app.expanded, [parent]: true };
  select(id);
}

export function sheetMenu(paths) {
  const one = paths.length === 1 ? store.sheetInfo(paths[0]) : null;
  const dir = dirOf(paths[0]);
  const manual = (store.sget(dir, 'sort', 'manual') || 'manual') === 'manual';
  const same = paths.every((p) => dirOf(p) === dir);
  return [
    one && { label: 'Open in Second Editor', icon: 'columns-2', action: () => { app.second = paths[0]; } },
    one && { sep: true },
    { label: one && one.favorite ? 'Remove from Favorites' : 'Add to Favorites', icon: 'star', action: () => { const on = !(one && one.favorite); for (const p of paths) store.setFavorite(p, on); } },
    { label: one && one.material ? 'Mark as Regular Sheet' : 'Mark as Material', icon: 'paperclip', action: () => { const on = !(one && one.material); for (const p of paths) store.setSheetMeta(p, { material: on }); } },
    { label: 'Keywords…', icon: 'tag', action: () => openDialog('keywords', { paths }) },
    one && { label: one.goal ? 'Edit Goal…' : 'Goal…', icon: 'target', action: () => goalFor({ sheet: true, path: one.path, goal: one.goal }) },
    { sep: true },
    paths.length > 1 && same && { label: 'Merge Sheets', icon: 'merge', action: async () => { if (await confirm('Merge these sheets?', 'Their text becomes one sheet, in this order; the others go to the Trash.', 'Merge')) { const p = store.mergeSheets(paths); openSheet(p); } } },
    paths.length > 1 && same && manual && { label: 'Glue Sheets', action: () => glue(paths) },
    one && one.glued && { label: 'Unglue Sheet', action: () => store.setGlued(one.path, false) },
    one && { label: 'Duplicate', icon: 'copy', action: () => openSheet(store.duplicateSheet(paths[0])) },
    one && /\/Untitled( \d+)?\.md$/u.test(one.path) === false && one.title && { label: 'Rename File to Match Title', action: () => store.renameSheet(one.path, one.title) },
    { label: 'Export…', icon: 'share', action: () => openDialog('export', { paths, title: one ? one.title : `${paths.length} sheets` }) },
    { sep: true },
    { label: 'Move to Trash', icon: 'trash-2', key: '⌘⌫', action: () => trashSheets(paths) },
  ];
}

export function glue(paths) {
  const dir = dirOf(paths[0]);
  const order = store.sheetsIn(dir);
  const sorted = [...paths].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  // glued sheets sit together: the others follow the first
  const rest = order.filter((p) => !sorted.includes(p));
  const at = order.indexOf(sorted[0]) - order.slice(0, order.indexOf(sorted[0])).filter((p) => sorted.includes(p)).length;
  rest.splice(at, 0, ...sorted);
  store.reorderSheets(dir, rest);
  sorted.slice(0, -1).forEach((p) => store.setGlued(p, true));
  toast('Glued');
}

export function projectMenu(node) {
  return [
    { label: 'Open Project', action: () => openProject(node.path) },
    { label: 'Edit Project…', action: () => editProject(node) },
    { label: 'Statistics', icon: 'chart-line', action: () => openDialog('stats', { path: node.path, name: node.name }) },
    { label: 'Export…', icon: 'share', action: () => openDialog('export', { paths: store.projectSheets(node.path).filter((x) => !store.sheetInfo(x).material), title: node.name, project: node.path }) },
    { sep: true },
    { label: 'Duplicate', icon: 'copy', action: () => store.duplicateProject(node.path) },
    { label: 'Share Project…', icon: 'share', action: () => import('./share.js').then((m) => m.shareProject(node.path)) },
    { label: node.archived ? 'Restore from Archive' : 'Archive', icon: 'archive', action: () => { store.setArchived(node.path, !node.archived); if (!node.archived && app.project === node.path) closeProject(); } },
    { sep: true },
    { label: 'Move to Trash', icon: 'trash-2', action: () => trashGroup(node) },
  ];
}

export { dirOf, nameOf, persist };
