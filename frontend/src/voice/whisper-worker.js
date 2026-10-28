// Whisper, in a worker so the page never stalls while it works out the words
// (voice/mic.js). transformers.js and the model are fetched the first time and
// kept by the browser; on a graphics chip (WebGPU) it's several times faster.
let TF = null, pipe = null;
const progress = {};

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'load') {
    try {
      TF = TF || (await import(/* @vite-ignore */ m.lib));
      TF.env.allowLocalModels = false;
      const opts = m.device === 'webgpu' ? { device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } } : { device: 'wasm', dtype: 'q8' };
      for (const k of Object.keys(progress)) delete progress[k];
      pipe = await TF.pipeline('automatic-speech-recognition', m.repo, { ...opts, progress_callback: (p) => {
        if (p.status !== 'progress' || !p.total) return;
        progress[p.file] = [p.loaded, p.total];
        let l = 0, t = 0;
        for (const [a, b] of Object.values(progress)) { l += a; t += b; }
        self.postMessage({ type: 'progress', pct: Math.round((100 * l) / t) });
      } });
      await pipe(new Float32Array(8000), m.gen);      // a first run, so the first real utterance isn't slow
      self.postMessage({ type: 'ready', key: m.key, device: opts.device });
    } catch (err) {
      self.postMessage({ type: 'loadError', key: m.key, device: m.device, message: String((err && err.message) || err) });
    }
  } else if (m.type === 'run') {
    try {
      const t0 = performance.now(), out = await pipe(m.audio, m.gen);
      self.postMessage({ type: 'result', id: m.id, text: out && out.text, took: performance.now() - t0 });
    } catch (err) {
      self.postMessage({ type: 'result', id: m.id, error: String((err && err.message) || err) });
    }
  }
};
