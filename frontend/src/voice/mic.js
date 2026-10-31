// The microphone side of voice (docs/VOICE.md): it listens, and at each pause
// hands the page what it heard (voice.svelte.js's hear). Three ways to listen:
// a native app's own recognizer (window.mosheShell.voice: Apple's on the Mac,
// Android's on a phone), Whisper running in the page, or the browser's own
// recognizer (Chrome sends the audio to Google, Safari to Apple). Whichever it
// is, it reports through the same window.mosheVoice the native apps call.
import vadUrl from './vad-worklet.js?url&no-inline';
import { voice, hear, partial, onLanguage } from './voice.svelte.js';
import { prefs } from '../lib/state.svelte.js';

const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
/** Whisper's sizes: MB to download on the processor (cpu) or the graphics chip (gpu). */
export const MODELS = {
  tiny: { repo: 'onnx-community/whisper-tiny.en', cpu: 41, gpu: 120, label: 'Whisper tiny' },
  base: { repo: 'onnx-community/whisper-base.en', cpu: 77, gpu: 206, label: 'Whisper base' },
  small: { repo: 'onnx-community/whisper-small.en', cpu: 249, gpu: 586, label: 'Whisper small' },
  he: { repo: 'onnx-community/whisper-base', cpu: 77, gpu: 206, label: 'Whisper base, multilingual' },
};
const PAUSE_MS = 700, MAX_MS = 15000, MIN_MS = 250;
const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
export const browserCanListen = !!SR;
const shell = () => (typeof window !== 'undefined' && window.mosheShell && window.mosheShell.voice) || null;

let running = false, speaking = false, pending = 0;
const set = (mic, { pct = null, caption = null } = {}) => {
  voice.mic = mic;
  if (pct != null) voice.loadPct = pct;
  if (caption != null) voice.caption = caption;
};
const idle = () => (speaking ? 'hearing' : pending ? 'working' : 'listening');
/** The engine to use now: the app's own recognizer when there is one and it isn't overridden. */
export const engine = () => (prefs.voice.engine === 'auto' || !prefs.voice.engine ? (shell() ? 'app' : 'whisper') : prefs.voice.engine);

// ---- what a native app (or the page's own engines) calls: the contract in docs/VOICE.md

if (typeof window !== 'undefined') {
  window.mosheVoice = {
    partial: (text) => partial(text || ''),
    final: (text, meta = {}) => { if (text) hear(text, { source: 'mic', how: meta.how || meta.engine || '' }); else partial(''); },
    state: (s, pct) => set(s === 'error' ? 'error' : s, { pct }),
    level: (v) => { voice.level = Math.max(0, Math.min(1, Number(v) || 0)); },
  };
}

// ---- Whisper, in its worker

let W = null, ready = null, load = null, runId = 0, device = 'wasm', gpuChecked = null, tq = Promise.resolve();
const runs = new Map();
const gen = (key) => ({ max_new_tokens: 96, ...(key === 'he' ? { language: 'hebrew', task: 'transcribe' } : {}) });
const modelKey = () => (voice.lang === 'he' ? 'he' : MODELS[prefs.voice.model] ? prefs.voice.model : 'base');
/** Whether the graphics chip can run Whisper here: much faster, a bigger download. */
export function checkGpu() {
  gpuChecked ||= (async () => { try { if (navigator.gpu && (await navigator.gpu.requestAdapter())) device = 'webgpu'; } catch { /* the processor, then */ } return device; })();
  return gpuChecked;
}
function worker() {
  if (W) return W;
  W = new Worker(new URL('./whisper-worker.js', import.meta.url), { type: 'module' });
  W.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'progress') { if (load) set('loading', { pct: m.pct }); }
    else if (m.type === 'ready') { ready = { key: m.key, device: m.device }; const l = load; load = null; if (l) l.res(); }
    else if (m.type === 'loadError') {
      if (m.device === 'webgpu') { device = 'wasm'; W.postMessage({ type: 'load', key: m.key, repo: MODELS[m.key].repo, lib: LIB, device, gen: gen(m.key) }); return; }
      const l = load; load = null; if (l) l.rej(new Error(m.message));
    } else if (m.type === 'result') { const r = runs.get(m.id); runs.delete(m.id); if (r) (m.error ? r.rej(new Error(m.error)) : r.res(m)); }
  };
  W.onerror = (e) => { const l = load; load = null; if (l) l.rej(new Error(e.message || 'the worker did not start')); };
  return W;
}
async function getModel(key) {
  await checkGpu();
  if (ready && ready.key === key) return;
  if (load && load.key === key) return load.p;
  const m = MODELS[key];
  set('loading', { pct: 0, caption: `Downloading ${m.label}, about ${device === 'webgpu' ? m.gpu : m.cpu} MB${device === 'webgpu' ? ', to run on the graphics chip' : ''}. Once; then the browser keeps it.` });
  let res, rej;
  const p = new Promise((a, b) => { res = a; rej = b; });
  load = { key, p, res, rej };
  ready = null;
  worker().postMessage({ type: 'load', key, repo: m.repo, lib: LIB, device, gen: gen(key) });
  await p;
  set(idle(), { caption: '' });
}
const whisper = (audio, key) => new Promise((res, rej) => { const id = ++runId; runs.set(id, { res, rej }); worker().postMessage({ type: 'run', id, audio, gen: gen(key) }, [audio.buffer]); });

const NOISE = /^(?:you|thank you|thanks for watching|bye)[.!]*$/iu;
/** What Whisper wrote, without what it makes up from noise. */
function clean(t) {
  t = String(t || '').replace(/\[[^\]]*\]|\([^)]*\)|♪/gu, '').replace(/\s+/gu, ' ').trim();
  if (!/[\p{L}\p{N}]/u.test(t) || NOISE.test(t)) return '';
  if (/([\p{L}]{1,12})(?:[\s,-]+\1){5,}/iu.test(t)) return '';          // “buh-buh-buh…”: looping on noise
  const q = t.match(/^["“](.*)["”]$/u);
  return q && !/["“”]/u.test(q[1]) ? q[1].trim() : t;
}
function transcribe(audio) {
  pending++;
  set('working');
  const key = modelKey(), secs = audio.length / 16000;
  tq = tq.then(async () => {
    try {
      await getModel(key);
      const r = await whisper(audio, key), text = clean(r.text);
      pending--;
      if (running) set(idle());
      const how = `${MODELS[key].label}${ready && ready.device === 'webgpu' ? ' on the graphics chip' : ''} · ${secs.toFixed(1)} s of speech, words in ${(r.took / 1000).toFixed(1)} s`;
      if (text) hear(text, { source: 'mic', how }); else partial('');
    } catch (e) {
      pending--;
      console.error(e);
      set('error', { caption: `Whisper didn't load (${String(e.message || e).slice(0, 120)}). Check the connection, or choose another way to listen in Settings › Voice.` });
      stopListening(true);
    }
  });
}

// ---- the microphone

let stream = null, ctx = null, src = null, node = null;
async function openMic(vad) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error('insecure'), { name: 'Insecure' });
  stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') await ctx.resume();
  await ctx.audioWorklet.addModule(vadUrl);
  src = ctx.createMediaStreamSource(stream);
  node = new AudioWorkletNode(ctx, 'moshe-vad', { processorOptions: { vad, pause: PAUSE_MS, max: MAX_MS, min: MIN_MS } });
  node.port.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'level') voice.level = m.v;
    else if (m.type === 'start') { speaking = true; if (!load) set('hearing'); }
    else if (m.type === 'short') { speaking = false; if (!load) set(idle()); }
    else if (m.type === 'utterance') { speaking = false; transcribe(m.audio); }
  };
  src.connect(node);
  node.connect(ctx.destination);
}

// ---- the browser's own recognizer

let rec = null, recWanted = false;
function startBrowser() {
  rec = new SR();
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 3;
  rec.lang = voice.lang === 'he' ? 'he-IL' : 'en-US';
  rec.onresult = (e) => {
    let guess = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) {
        const alts = [...r].map((a) => a.transcript.trim()).filter(Boolean);
        if (alts[0]) hear(alts[0], { source: 'mic', how: `the browser's own${alts.length > 1 ? ` · also heard: ${alts.slice(1).join(' / ')}` : ''}` });
      } else guess += r[0].transcript;
    }
    if (guess.trim()) partial(guess.trim());
  };
  rec.onerror = (e) => {
    const why = { 'not-allowed': 'The microphone was blocked.', 'service-not-allowed': 'This browser has speech recognition but won’t run it here.',
      network: 'This browser’s recognizer needs a service it can’t reach (Chromium has none). Choose Whisper in Settings › Voice.', 'audio-capture': 'No microphone found.' }[e.error];
    if (why) { recWanted = false; set('error', { caption: why }); stopListening(true); }
  };
  rec.onend = () => { if (recWanted) { try { rec.lang = voice.lang === 'he' ? 'he-IL' : 'en-US'; rec.start(); } catch { /* it restarts by itself */ } } };
  recWanted = true;
  rec.start();
}

// ---- start and stop

export const isListening = () => running;
export async function startListening() {
  if (running) return;
  running = true;
  set('listening', { caption: '' });
  try {
    const how = engine();
    if (how === 'app') {
      shell().start({ lang: voice.lang, words: [...voice.names], pause: PAUSE_MS });
    } else if (how === 'browser') {
      if (!SR) throw Object.assign(new Error('This browser has no speech recognition of its own. Choose Whisper in Settings › Voice.'), { name: 'NoRecognizer' });
      await openMic(false);
      startBrowser();
    } else {
      await openMic(true);
      await getModel(modelKey());
    }
  } catch (e) {
    const why = e.name === 'NotAllowedError' ? 'The microphone was blocked. Allow it for Moshe, then start listening again.'
      : e.name === 'NotFoundError' ? 'No microphone found.'
      : e.name === 'Insecure' ? 'The browser allows the microphone only over https or on this computer (localhost).'
      : `Listening didn't start: ${String(e.message || e).slice(0, 140)}`;
    set('error', { caption: why });
    stopListening(true);
  }
}
export function stopListening(keepCaption = false) {
  const was = running;
  running = false; recWanted = false; speaking = false;
  try { if (shell() && was && engine() === 'app') shell().stop(); } catch { /* the app stopped already */ }
  try { if (rec) rec.stop(); } catch { /* stopped */ }
  try { if (node) node.port.onmessage = null; if (src) src.disconnect(); if (node) node.disconnect(); } catch { /* gone */ }
  try { if (stream) stream.getTracks().forEach((t) => t.stop()); } catch { /* gone */ }
  try { if (ctx) ctx.close(); } catch { /* gone */ }
  stream = ctx = src = node = rec = null;
  voice.level = 0;
  partial('');
  if (voice.mic !== 'error') set('off', { caption: keepCaption ? null : '' });
}
export const toggleListening = () => (running ? stopListening() : startListening());

// a new language: the recognizer starts over in it
onLanguage((lang) => {
  if (!running) return;
  if (engine() === 'app') { try { shell().language(lang); } catch { /* the app hasn't that yet */ } }
  else if (rec) { try { rec.stop(); } catch { /* restarts */ } }
  else getModel(modelKey()).catch(() => {});
});
