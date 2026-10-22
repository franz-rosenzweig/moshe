// Share Project: the whole project as a zip —
// its folders, sheets, settings and images, as they are on disk — to keep
// as a backup or to hand to someone. Unzipped into Projects/, it is the
// project again.
import { createZip } from '@export';
import { store, theStorage, toast } from './state.svelte.js';

const bytesOf = (s) => new TextEncoder().encode(s);

/** A zip of every file under a folder of the library, named after it. */
export async function zipFolder(dir) {
  const name = dir.split('/').pop();
  const entries = [];
  const s = theStorage();
  const files = [...store.tree.files].filter((f) => f.startsWith(dir + '/')).sort();
  for (const f of files) {
    const rel = `${name}/${f.slice(dir.length + 1)}`;
    const text = store.text(f);
    if (text !== null) { entries.push({ name: rel, data: bytesOf(text) }); continue; }
    if (s && s.rawUrl) {
      try {
        const r = await fetch(s.rawUrl(f), { credentials: 'same-origin' });
        if (r.ok) entries.push({ name: rel, data: new Uint8Array(await r.arrayBuffer()) });
      } catch { /* left out */ }
    }
  }
  return { name: `${name}.zip`, bytes: createZip(entries) };
}

export async function shareProject(dir) {
  const { name, bytes } = await zipFolder(dir);
  const shell = window.mosheShell;
  if (shell && shell.saveFile) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    await shell.saveFile(name, btoa(bin), 'application/zip');
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  toast(`${name} saved`);
}
