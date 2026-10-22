// The taste page: the app goes in the frame on a wide screen (a phone gets a
// card that opens it full screen instead, so it doesn't load it for nothing),
// and "Reset the demo" puts the sample library back: the browser's copy of it
// (IndexedDB "moshe-taste") and the app's own remembered state (moshe.*).
const frame = document.getElementById('demo');
const wide = matchMedia('(min-width: 760px)');

function load() {
  if (wide.matches && !frame.getAttribute('src')) frame.src = frame.dataset.src;
}
load();
wide.addEventListener('change', load);

function forget() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('moshe.')) localStorage.removeItem(k);
  } catch { /* nothing kept */ }
  return new Promise((resolve) => {
    let req;
    try { req = indexedDB.deleteDatabase('moshe-taste'); } catch { resolve(); return; }
    req.onsuccess = req.onerror = () => resolve();
    req.onblocked = () => setTimeout(resolve, 1500);
  });
}

async function reset(e) {
  const b = e.currentTarget;
  b.disabled = true;
  const had = frame.getAttribute('src');
  if (had) frame.src = 'about:blank';          // let go of the database first
  await new Promise((r) => setTimeout(r, 150));
  await forget();
  if (had) frame.src = frame.dataset.src;
  b.textContent = 'Reset';
  setTimeout(() => { b.textContent = b.id === 'resetDemo' ? 'Reset the demo' : 'Reset it'; b.disabled = false; }, 1600);
}
for (const id of ['resetDemo', 'resetDemo2']) document.getElementById(id).addEventListener('click', reset);
