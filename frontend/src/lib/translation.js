// Translation mode: a sheet and its counterpart side by side, paragraph
// beside paragraph. The two live in paired groups — "Original" and
// "Translation" (or "Source" and "Target") side by side in one group or
// project, or any two a group's settings pair — and a sheet's counterpart is
// the one with the same file name there, or else the one in the same place
// in the other's order.

const PAIRS = [['original', 'translation'], ['source', 'target'], ['מקור', 'תרגום'], ['hebrew', 'english'], ['english', 'hebrew']];
const dirOf = (p) => p.slice(0, p.lastIndexOf('/'));
const nameOf = (p) => p.slice(p.lastIndexOf('/') + 1);

/** The group paired with this one, and which side this is: {dir, side} or null. */
export function pairedGroup(store, dir) {
  const set = store.sget(dir, 'pair', null);
  const parent = dirOf(dir);
  if (set) return { dir: `${parent}/${set}`, side: store.sget(dir, 'pairSide', 'original') };
  const name = nameOf(dir).toLowerCase();
  for (const [a, b] of PAIRS) {
    const other = name === a ? b : name === b ? a : null;
    if (!other) continue;
    const sib = store.subgroups(parent).find((g) => nameOf(g).toLowerCase() === other);
    if (sib) return { dir: sib, side: name === a ? 'original' : 'translation' };
  }
  return null;
}

/** A sheet's counterpart: {other (path or null), dir, side, name}. */
export function translationPair(store, path) {
  let dir = dirOf(path);
  // a sheet deeper in the paired group (a chapter folder) pairs with the same place in the other
  let rel = nameOf(path);
  let g = pairedGroup(store, dir);
  let d = dir;
  while (!g && d.includes('/')) {
    rel = `${nameOf(d)}/${rel}`;
    d = dirOf(d);
    g = pairedGroup(store, d);
  }
  if (!g) return null;
  const want = `${g.dir}/${rel}`;
  if (store.exists(want)) return { other: want, dir: dirOf(want), side: g.side, name: nameOf(want) };
  const mine = store.sheetsIn(dirOf(path));
  const theirs = store.sheetsIn(dirOf(want));
  const i = mine.indexOf(path);
  const other = i >= 0 && theirs[i] && !mine.map(nameOf).includes(nameOf(theirs[i])) ? theirs[i] : null;
  return { other, dir: dirOf(want), side: g.side, name: nameOf(want) };
}

/** A counterpart made for a sheet that has none: its headings, and a blank line for each paragraph. */
export function startTranslation(store, path) {
  const pair = translationPair(store, path);
  if (!pair) return null;
  if (pair.other) return pair.other;
  const body = store.openSheet(path).body;
  const skeleton = body.split('\n').map((l) => (/^#{1,6}\s/u.test(l) ? l.replace(/^(#{1,6}\s).*/u, '$1') : /^\s*$/u.test(l) ? '' : '')).join('\n');
  store.makeDirs(pair.dir);
  const p = store.createSheet(pair.dir, { text: skeleton });
  return store.renameSheet(p, pair.name.replace(/\.md$/u, ''));
}
