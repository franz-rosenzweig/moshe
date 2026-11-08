// The voice tutorial's lessons, end to end (engine/src/tutorial.js): the real app in headless
// Chromium, each lesson started and each step said as the card shows it, then checked done. Every
// line is said twice over: as written ("replace six with five") and as a recognizer writes it
// ("Replace 6 with 5."), so the lessons are also a test of the commands under real dictation.
//
//   node tools/lessons-e2e.mjs APP_DIR                    every lesson, both ways, at desktop size
//   … --phone (a phone's size, by touch), --plain or --said (one way), --lesson ID, --keep (every step)
//
// APP_DIR is the demo build with its library and the word files beside it, as for tools/voice-e2e.mjs.
// Needs Chromium, Chrome or Edge (CHROME=path).
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
const dir = resolve(args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--lesson') || '');
const flag = (f) => args.includes(f);
const only = flag('--lesson') ? args[args.indexOf('--lesson') + 1] : null;
const styles = flag('--plain') ? ['plain'] : flag('--said') ? ['said'] : ['plain', 'said'];
if (!existsSync(join(dir, 'app.html'))) { console.error('usage: node tools/lessons-e2e.mjs APP_DIR [--phone] [--plain|--said] [--lesson ID] [--keep]'); process.exit(2); }
const CHROME = process.env.CHROME || ['/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/google-chrome',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'moshe-lessons-'));

// ---- a line, as a recognizer writes it: a capital, digits for numbers, and a full stop
const DIGITS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const NUMBERED = /^(use|sentence|paragraph|mark|undo|read sentence|replace) /iu;
function asDictated(line) {
  let t = line;
  if (NUMBERED.test(t)) t = t.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/giu, (w) => String(DIGITS[w.toLowerCase()]));
  t = t[0].toUpperCase() + t.slice(1);
  return /^(what|how)\b/iu.test(t) ? `${t}?` : `${t}.`;
}

// sentences a writer may dictate that begin with a command's words: none of them names words in the sheet
const PROSE = ['Stop the car, she said.', 'Open the door slowly.', 'Go to the store and buy milk.', 'Go to sleep, the mother said.',
  'Select few were chosen.', 'Delete nothing until we know more.', 'Replace the battery with a new one.', 'Change came to the village.',
  'Insert the key before you turn it.', 'Bold men went first.', 'Highlight of the year was the trip.', 'Define your terms.',
  'Spell it out for me.', 'Correct me if I am wrong.', 'Mark my words.', 'Comment on the photo later.', 'Type of person who reads.',
  'Strike while the iron is hot.', 'Read the letter twice.', 'Cancel the meeting on Friday.', 'Help me understand this.',
  'Move the table after dinner.', 'Show me the numbers.', 'Focus on the work.', 'Go back to bed.', 'Undo the knot first.'];

// ---- the app, served from its folder
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const p = join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  let body = null;
  try { if (p.startsWith(dir)) body = readFileSync(p); } catch { /* not a file */ }
  if (!body) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' });
  res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/app.html`;

const chrome = spawn(CHROME, ['--headless=new', '--no-first-run', `--user-data-dir=${join(tmp, 'profile')}`, '--remote-debugging-port=0', '--disable-gpu',
  '--window-size=1400,950', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const port = await new Promise((res, rej) => { let s = ''; chrome.stderr.on('data', (d) => { s += d; const m = /DevTools listening on ws:\/\/[^:]+:(\d+)/u.exec(s); if (m) res(m[1]); }); setTimeout(() => rej(new Error('Chromium did not start')), 20000); });

let failures = 0;
try {
  const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0;
  const waiting = new Map(), errors = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'evaluate failed'); return r.result?.result?.value; };
  await send('Runtime.enable');
  await send('Page.enable');
  if (flag('--phone')) {
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  } else await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  for (let i = 0; i < 80 && !(await ev('!!(window.mosheMenuState && window.mosheMenuState().commands.length && window.__mosheTutorial)').catch(() => false)); i++) await sleep(250);

  const st = () => ev('__mosheVoice.state()');
  const tut = () => ev('__mosheTutorial.state()');
  const say = async (text) => {
    const before = (await st()).count;
    await ev(`(window.mosheVoice.final(${JSON.stringify(text)}, { how: 'e2e' }), 1)`);
    for (let i = 0; i < 120 && (await st()).count === before; i++) await sleep(50);
  };
  /** The number to say for a numbered list's item: its words, or its number. */
  const numberFor = async (want) => {
    if (typeof want === 'number') return want;
    const items = ((await st()).choice || { items: [] }).items;
    const i = items.findIndex((x) => String(x.label).toLowerCase().includes(String(want).toLowerCase()));
    return i >= 0 ? i + 1 : 1;
  };

  const lessons = (await ev('__mosheTutorial.lessons()')).filter((l) => !only || l.id === only);
  const results = [];
  for (const style of styles) {
    console.log(`\n== ${style === 'plain' ? 'as written' : 'as a recognizer writes it'}${flag('--phone') ? ', on a phone' : ''}`);
    for (const l of lessons) {
      await ev("(mosheVoice.state('listening'), mosheVoice.level(0.1), 1)");
      await ev(`__mosheTutorial.start(${JSON.stringify(l.id)})`);
      await sleep(700);
      let passed = 0, failed = 0;
      for (let guard = 0; guard < 40; guard++) {
        const t = await tut();
        if (!t.card) break;
        const c = t.card;
        let line;
        if (c.do === 'listen') { await ev("(mosheVoice.state('listening'), 1)"); line = null; }
        else if (c.do === 'number') { const n = await numberFor(c.want); line = style === 'plain' ? ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][n] : `${n}.`; }
        else line = style === 'plain' ? c.say : asDictated(c.say);
        if (line) await say(line);
        // done: ticked, or moved on
        let after = await tut();
        for (let i = 0; i < 50 && after.step === t.step && !after.ticked; i++) { await sleep(60); after = await tut(); }
        const ok = after.step !== t.step || after.ticked;
        const s = await st(), text = await ev('__mosheVoice.text()'), sel = await ev('__mosheVoice.selection()');
        if (ok) passed++; else failed++;
        if (!ok || flag('--keep')) {
          console.log(`  ${ok ? '✔' : '✖'} ${l.id} ${t.step}: ${JSON.stringify(line || c.text)} → ${s.last ? `${s.last.kind}${s.last.id ? ` ${s.last.id}` : ''} “${s.last.msg}”` : '-'}`);
          if (!ok) {
            const at = sel && text != null ? (sel[0] === sel[1] ? `cursor: …${JSON.stringify(text.slice(Math.max(0, sel[0] - 20), sel[0]))}|${JSON.stringify(text.slice(sel[0], sel[0] + 20))}…` : `selected: ${JSON.stringify(text.slice(sel[0], sel[1]))}`) : '';
            console.log(`      sheet: ${JSON.stringify(text)}\n      ${at}`);
          }
        }
        if (!ok) await ev('(document.querySelector(".tut .skip") || { click() {} }).click(), 1');
        // past the tick
        for (let i = 0; i < 40; i++) { const x = await tut(); if (!x.ticked) break; await sleep(60); }
      }
      failures += failed;
      results.push({ style, lesson: l.id, passed, failed });
      console.log(`${failed ? '✖' : '✔'} ${l.title}: ${passed} of ${passed + failed}`);
    }
  }
  const total = results.reduce((n, r) => n + r.passed + r.failed, 0);
  console.log(`\n${total - failures} of ${total} steps done${failures ? `, ${failures} not` : ''}`);

  // ---- sentences that start like a command, dictated into a sheet whose words they don't name: each is typed
  if (!only) {
    console.log('\n== sentences that start like a command');
    await ev("(__mosheTutorial.start('selecting'), __mosheTutorial.stop(), 1)");
    await sleep(700);
    await say('go to the end');
    let typed = 0;
    for (const line of PROSE) {
      const before = await ev('__mosheVoice.text()');
      await say(line);
      await sleep(250);
      const now = await ev('__mosheVoice.text()'), s = await st();
      const ok = now !== before && now.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').includes(line.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim());
      if (ok) typed++; else failures++;
      if (!ok || flag('--keep')) console.log(`  ${ok ? '✔' : '✖'} ${JSON.stringify(line)} → ${s.last ? `${s.last.kind}${s.last.id ? ` ${s.last.id}` : ''} “${s.last.msg}”` : '-'}`);
      if (now !== before) await say('scratch that');
    }
    console.log(`${typed === PROSE.length ? '✔' : '✖'} typed: ${typed} of ${PROSE.length}`);
  }
  if (errors.length) { console.log(`page errors:\n  ${errors.slice(0, 5).join('\n  ')}`); failures += errors.length; }
} finally {
  chrome.kill();
  server.close();
}
process.exit(failures ? 1 : 0);
