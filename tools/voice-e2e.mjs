// Voice, end to end (docs/VOICE.md): the real app in headless Chromium, on the
// demo's sample library, saying things to it and checking what the text became.
//
//   node tools/voice-e2e.mjs APP_DIR             what's said is handed over as if heard (window.mosheVoice.final)
//   node tools/voice-e2e.mjs APP_DIR --audio     spoken by the Mac's `say` (on Windows, its own voice) into the fake microphone, heard by Whisper
//   … --gpu (Whisper on the graphics chip), --shot FILE.png (a picture at the end), --keep (print every step)
//
// APP_DIR is the demo build with its library and the word files beside it:
//   (cd frontend && MOSHE_DEMO_OUT=/tmp/d npx vite build --config ../demo/vite.config.mjs) && node demo/make-library.mjs --json /tmp/d/library.json
//   cp -R frontend/public/words /tmp/d/
// On Windows, in PowerShell, with $d a new folder:
//   $env:MOSHE_DEMO_OUT = $d; cd frontend; npx vite build --config ../demo/vite.config.mjs; cd ..; node demo/make-library.mjs --json $d\library.json
//   Copy-Item -Recurse frontend\public\words $d
// Needs Chromium, Chrome or Edge (CHROME=path), and for --audio a Mac or Windows and the network (Whisper's first download).
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { sentenceRanges } from '../engine/src/voice.js';

const args = process.argv.slice(2);
const dir = resolve(args.find((a) => !a.startsWith('--') && !/\.png$/u.test(a)) || '');
const flag = (f) => args.includes(f);
const shotAt = args.includes('--shot') ? args[args.indexOf('--shot') + 1] : null;
if (!existsSync(join(dir, 'app.html'))) { console.error('usage: node tools/voice-e2e.mjs APP_DIR [--audio] [--gpu] [--shot FILE.png]'); process.exit(2); }
const CHROME = process.env.CHROME || ['/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/google-chrome',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'moshe-voice-'));

// ---- the app, served from its folder (the page fetches its library and the word files)
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

// ---- what's said, as audio: one utterance after another, a pause between
const SPOKEN = ['Go to the kitchen.', 'Select the water tower.', 'Two.', 'Synonyms for cold.', 'Use two.', 'Scratch that.',
  'Go to the end of the paragraph.', 'New paragraph.', "Avner's truck was not in the yard."];
function speakToWav() {
  const rate = 48000, parts = [Buffer.alloc(rate * 2 * 1.5)];
  const wavs = SPOKEN.map((_, i) => join(tmp, `u${i}.wav`));
  if (process.platform === 'win32') {
    // Windows' own voice (System.Speech, in Windows PowerShell), one WAV each, 16-bit mono at the same rate
    const ps = 'Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; '
      + `$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(${rate}, ([System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen), ([System.Speech.AudioFormat.AudioChannel]::Mono)); `
      + 'foreach ($u in ($env:MOSHE_SAY | ConvertFrom-Json)) { $s.SetOutputToWaveFile($u.wav, $f); $s.Speak($u.text); $s.SetOutputToNull() }';
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { env: { ...process.env, MOSHE_SAY: JSON.stringify(SPOKEN.map((text, i) => ({ text, wav: wavs[i] }))) } });
  } else {
    for (const [i, u] of SPOKEN.entries()) {
      const aiff = join(tmp, `u${i}.aiff`);
      execFileSync('say', ['-o', aiff, u]);
      execFileSync('afconvert', ['-f', 'WAVE', '-d', `LEI16@${rate}`, '-c', '1', aiff, wavs[i]]);
    }
  }
  for (const wav of wavs) {
    const b = readFileSync(wav);
    parts.push(b.subarray(b.indexOf('data') + 8), Buffer.alloc(rate * 2 * 2.2));
  }
  const data = Buffer.concat(parts), head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVEfmt ', 8); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(data.length, 40);
  const out = join(tmp, 'spoken.wav');
  writeFileSync(out, Buffer.concat([head, data]));
  return out;
}

const chromeArgs = ['--headless=new', '--no-first-run', `--user-data-dir=${join(tmp, 'profile')}`, '--remote-debugging-port=0', '--autoplay-policy=no-user-gesture-required',
  ...(flag('--gpu') ? ['--enable-unsafe-webgpu', '--enable-gpu'] : ['--disable-gpu']), '--window-size=1400,950'];
if (flag('--audio')) chromeArgs.push('--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${speakToWav()}%noloop`,
  '--disable-features=AudioServiceOutOfProcess');   // the audio service in its own process can't read the file
const chrome = spawn(CHROME, [...chromeArgs, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
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
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'evaluate failed'); return r.result?.result?.value; };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url });
  for (let i = 0; i < 80 && !(await ev('!!(window.mosheMenuState && window.mosheMenuState().commands.length)').catch(() => false)); i++) await sleep(250);

  // voice on, the dashboard's Voice view, and Late Apples' second chapter open
  const lib = JSON.parse(readFileSync(join(dir, 'library.json'), 'utf8'));
  const arrival = Object.keys(lib.files).find((p) => lib.files[p].includes('## Two: Arrival'));
  await ev(`(() => { if (!mosheMenuState().dashboardViews.some((v) => v.id === 'voice')) mosheCommand('voice'); mosheCommand('select', ${JSON.stringify(arrival.slice(0, arrival.lastIndexOf('/')))}); return 1; })()`);
  await sleep(600);
  const st = () => ev('__mosheVoice.state()');
  const say = async (text, alternatives = []) => {
    const before = (await st()).count;
    await ev(`(window.mosheVoice.final(${JSON.stringify(text)}, { how: 'e2e', alternatives: ${JSON.stringify(alternatives)} }), 1)`);
    for (let i = 0; i < 120 && (await st()).count === before; i++) await sleep(50);
    await sleep(120);
  };
  await say('open two arrival');
  await ev("(mosheCommand('dashboardView', 'voice'), 1)");
  await sleep(1200);                                       // the names, gathered from the project

  const ctx = async () => {
    const s = await st(), doc = await ev('__mosheVoice.text()'), sel = await ev('__mosheVoice.selection()');
    return { s, last: s.last || {}, doc, sel, picked: doc.slice(sel[0], sel[1]), menu: await ev('mosheMenuState()') };
  };
  const check = (label, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? '✔' : '✖'} ${label}${!ok && detail ? `\n    ${detail}` : ''}`); };

  if (flag('--audio')) {
    // ---- heard by Whisper, from the Mac's own voice
    await ev("(mosheCommand('listen'), 1)");
    const t0 = Date.now();
    let s = await st();
    const start = s.count;
    while (Date.now() - t0 < 300000 && (s.count - start < SPOKEN.length || ['hearing', 'working', 'loading'].includes(s.mic))) {
      await sleep(1000);
      s = await st();
      if (s.mic === 'error') break;
    }
    const heard = s.heard.slice(0, s.count - start).reverse();
    for (const h of heard) console.log(`  “${h.said}” → ${h.kind} · ${h.msg}${h.how ? `   (${h.how})` : ''}`);
    const c = await ctx();
    check(`all ${SPOKEN.length} utterances heard`, heard.length === SPOKEN.length, `heard ${heard.length}; ${s.caption || ''}`);
    check('the commands were taken as commands', heard.slice(0, -1).every((h) => h.kind === 'command'), heard.map((h) => h.kind).join(' '));
    check('the last one typed', heard.length && heard[heard.length - 1].kind === 'text');
    check('the synonym was used, then scratched', c.doc.includes('already turned cold'), '');
    check('the name came out right', /\n\nAvner's truck was not in the yard\./u.test(c.doc), JSON.stringify(c.doc.slice(c.doc.indexOf('kitchen.'), c.doc.indexOf('kitchen.') + 80)));
  } else {
    // ---- said, step by step: [what's said, what must be true after]
    const firstWater = (d) => d.indexOf('the water tower'), secondWater = (d) => d.indexOf('the water tower', firstWater(d) + 1);
    const STEPS = [
      ['go to the kitchen', (c) => c.doc.slice(c.sel[1]).startsWith('Avner was not there')],
      ['select the water tower', (c) => c.s.choice && c.s.choice.items.length === 2],
      ['two', (c) => c.sel[0] === secondWater(c.doc) && c.picked === 'the water tower'],
      ['select a lamp burning in the kitchen', (c) => c.picked === 'a lamp burning in the kitchen'],
      ['comment who lit it?', (c) => c.doc.includes('{==a lamp burning in the kitchen==}{>>Who lit it?<<}')],
      ['go to the end of the paragraph', (c) => c.doc.slice(0, c.sel[0]).endsWith('lit it?<<}.')],
      ['Um, she stood in the doorway for a long time and listened.', (c) => c.doc.includes('<<}. She stood in the doorway for a long time and listened.') && /filler/u.test(c.last.msg)],
      ['new paragraph', (c) => c.doc.slice(c.sel[0] - 11, c.sel[0]) === 'listened.\n\n'],
      ["Abner's truck was not in the yard.", (c) => c.doc.includes("listened.\n\nAvner's truck was not in the yard.") && /Abner → Avner/u.test(c.last.how)],
      ['synonyms for cold', (c) => c.s.choice && c.s.choice.kind === 'syn' && c.s.words.list.length > 3],
      ['use 2', (c) => c.doc.includes(`already turned ${c.s.words.list[1]}`)],
      ['scratch that', (c) => c.doc.includes('already turned cold')],
      ['revision mode', (c) => c.menu.revision === true],
      ['strike already', (c) => c.doc.includes('had {--already--} turned cold')],
      ['replace slanting with careful', (c) => c.doc.includes('{~~slanting~>careful~~}')],
      ['Quietly.', (c) => /\{\+\+ ?quietly\+\+\}/u.test(c.doc)],              // as the pen writes it, mid-sentence: small, no stop
      ['delete that', (c) => !/quietly/u.test(c.doc)],
      ['stop revising', (c) => c.menu.revision === false],
      ['accept all', (c) => !c.doc.includes('{--') && !c.doc.includes('{~~') && c.doc.includes('same careful hand') && c.doc.includes('had turned cold')],
      ['scratch that', (c) => c.doc.includes('{--already--}') && c.doc.includes('{~~slanting~>careful~~}')],
      ['show numbers', (c) => c.last.kind === 'command'],
      ['sentence 4', (c) => { const r = sentenceRanges(c.doc)[3]; return c.sel[0] === r[0] && c.sel[1] === r[1]; }],
      ['hide numbers', (c) => c.last.kind === 'command'],
      ['select she did through stones', (c) => c.picked.startsWith('She did not reach') && c.picked.endsWith('stones')],
      ['bold that', (c) => c.doc.includes('**She did not reach the water tower.')],
      ['scratch that', (c) => !c.doc.includes('**She did not reach')],
      ['She said delete that and left.', (c) => c.last.kind === 'text' && /delete that/u.test(c.last.why)],
      ['scratch that', (c) => !c.doc.includes('She said delete that')],
      ['go to sleep', (c) => c.s.asleep === true],
      ['what do you think of it so far', (c) => c.last.kind === 'ignored' && !c.doc.includes('think of it so far')],
      ['wake up', (c) => c.s.asleep === false],
      ['define orchard', (c) => c.s.words && c.s.words.entry && c.s.words.entry.lemma === 'orchard'],
      ['correct cold', (c) => c.s.choice && c.s.choice.kind === 'fix' && c.s.words.list.includes('called')],
      ['cancel', (c) => !c.s.choice],
      ['go to the market he said', (c) => c.last.kind === 'text' && /no “the market he said”/u.test(c.last.why)],
      ['scratch that', (c) => !/[Gg]o to the market/u.test(c.doc)],
      ['stop', (c) => c.last.kind === 'text'],
      ['scratch that', (c) => !/\bStop\.?\s*$/u.test(c.doc.slice(0, c.sel[0]))],
      ['word count', (c) => /^\d+ words$/u.test(c.last.msg)],
      ['read this paragraph', (c) => c.last.msg === 'Reading'],
      ['stop reading', (c) => c.s.reading === false],
      ['show sheets', (c) => c.s.choice && c.s.choice.kind === 'sheet' && c.s.choice.items.length >= 3],
      ['four', (c) => c.doc.startsWith('## Three: Frost')],                      // the group's title sheet is number 1
      ['open two arrival', (c) => c.doc.includes('## Two: Arrival')],
      ['open the window', (c) => c.last.kind === 'text'],
      ['scratch that', (c) => !c.doc.includes('pen the window')],
      ['select the house found her first', (c) => c.picked === 'The house found her first'],
      // fuzziness: a near miss done, a recognizer's other guess taken, an open-ended miss put right
      ['Build that.', (c) => c.doc.includes('**The house found her first**') && /taken as “bold that”/u.test(c.last.why)],
      ['scratch that', (c) => !c.doc.includes('**The house') && c.picked === 'The house found her first'],
      [['I like that.', ['highlight that']], (c) => c.last.kind === 'command' && /took its other guess “highlight that”/u.test(c.last.how) && !c.doc.includes('I like that')],
      ['scratch that', (c) => !c.doc.includes('====The house')],
      ['Highlight dad', (c) => c.last.kind === 'command' && /taken as “highlight that”/u.test(c.last.why) && !c.doc.includes('dad')],
      ['scratch that', (c) => !c.doc.includes('====The house')],
      ['I like that.', (c) => c.last.kind === 'text' && c.doc.includes('I like that')],
      ['scratch that', (c) => !c.doc.includes('I like that')],
      ['select the house found her first', (c) => c.picked === 'The house found her first'],
      ['Please capitalize that.', (c) => c.doc.includes('The House Found Her First')],
      ['scratch that', (c) => c.doc.includes('==The house found her first==')],
      ['select the house found her first', (c) => c.picked === 'The house found her first'],
      ['put that in quotes', (c) => c.doc.includes('“The house found her first”')],
      ['scratch that', (c) => !c.doc.includes('“The house found her first”')],
      ['go to the kitchen', (c) => c.doc.slice(c.sel[1]).startsWith('Avner was not there')],
      ['next sentence', (c) => c.doc.slice(c.sel[1]).startsWith('On the table')],
      ['do that again', (c) => /^Again/u.test(c.last.msg) && !c.doc.slice(c.sel[1]).startsWith('On the table')],
      ['go to the end of the paragraph', (c) => c.last.kind === 'command'],
      ['new paragraph', (c) => c.last.kind === 'command'],
      ['Okay, so the night came on.', (c) => c.doc.includes('so the night came on')],
      ['undo two times', (c) => !c.doc.includes('so the night came on') && /Undone 2 steps/u.test(c.last.msg)],
      ['select the house found her first', (c) => c.picked === 'The house found her first'],
      ['synonyms', (c) => c.s.words.kind === 'syn' && c.s.words.word === 'first'],   // more than a word selected: the one at the cursor
      ['cancel', (c) => !c.s.choice],
    ];
    for (const [step, ok] of STEPS) {
      const [said, alternatives] = Array.isArray(step) ? step : [step, []];
      await say(said, alternatives);
      const c = await ctx();
      let pass = false;
      try { pass = !!ok(c); } catch { pass = false; }
      check(`“${said}” → ${c.last.kind} · ${c.last.msg}`, pass, `${c.last.why || ''} | picked: ${JSON.stringify(c.picked.slice(0, 60))} | near: ${JSON.stringify(c.doc.slice(Math.max(0, c.sel[0] - 50), c.sel[0] + 30))}`);
    }
  }
  check('no errors on the page', !errors.length, errors.slice(0, 5).join('\n    '));
  if (shotAt) { const shot = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(shotAt, Buffer.from(shot.result.data, 'base64')); }
} finally {
  chrome.kill();
  server.close();
}
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
