// Links between sheets, as Obsidian writes them: [[Name]], [[Name#Heading]],
// [[Name|shown as]]. Typing [[ offers the library's sheets (by title and by
// file name), and after # the headings of the chosen one. Links between
// sheets, in a form Obsidian follows too.
import { autocompletion } from '@codemirror/autocomplete';

/** @param {() => import('@engine/store.js').Store} getStore */
export function sheetLinks(getStore) {
  return autocompletion({
    activateOnTyping: true,
    icons: false,
    override: [(ctx) => {
      const before = ctx.state.doc.sliceString(Math.max(0, ctx.pos - 200), ctx.pos);
      const m = /\[\[([^\]\n|]*)$/u.exec(before);
      if (!m) return null;
      const store = getStore();
      if (!store) return null;
      const typed = m[1];
      const hash = typed.indexOf('#');
      const from = ctx.pos - typed.length + (hash >= 0 ? hash + 1 : 0);
      const after = ctx.state.doc.sliceString(ctx.pos, ctx.pos + 2);
      const close = after === ']]' ? '' : ']]';
      if (hash >= 0) {
        const name = typed.slice(0, hash).toLowerCase();
        const path = store.allSheets(true).find((p) => p.split('/').pop().replace(/\.md$/u, '').toLowerCase() === name);
        if (!path) return null;
        const heads = (store.openSheet(path).body.match(/^#{1,6}[ \t]+.+$/gmu) || []).map((h) => h.replace(/^#+[ \t]+/u, '').trim());
        return { from, options: heads.map((h) => ({ label: h, apply: h + close, type: 'text' })), validFor: /^[^\]\n#|]*$/u };
      }
      const options = store.allSheets(true).map((p) => {
        const info = store.sheetInfo(p);
        const name = p.split('/').pop().replace(/\.md$/u, '');
        return { label: info.title || name, detail: name !== info.title ? name : p.split('/').slice(1, -1).join(' › '), apply: name + close, boost: 0 };
      });
      return { from, options, validFor: /^[^\]\n#|]*$/u };
    }],
  });
}
