// The pause detector (docs/VOICE.md), on the browser's audio thread so nothing
// the page does can drop a word. It keeps a running guess at the room's noise,
// hears speech start when the sound rises well above it, and ends the utterance
// at the first pause of `pause` ms: that pause is where text and command part.
// It hands over the utterance as 16 kHz samples, which is what Whisper takes.
class MosheVad extends AudioWorkletProcessor {
  constructor(o) {
    super();
    const p = o.processorOptions || {};
    this.vad = p.vad !== false; this.pause = p.pause || 700; this.max = p.max || 15000; this.min = p.min || 250;
    this.ratio = sampleRate / 16000; this.n = Math.round(sampleRate * 0.02); this.ms = (this.n / sampleRate) * 1000;   // 20 ms blocks
    this.acc = new Float32Array(this.n); this.k = 0;
    this.noise = 0.004; this.speaking = false; this.voiced = 0; this.quiet = 0; this.spoken = 0; this.pre = []; this.buf = []; this.tick = 0;
    this.port.onmessage = (e) => { if (e.data && e.data.pause) this.pause = e.data.pause; };
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) { this.acc[this.k++] = ch[i]; if (this.k === this.n) { this.block(this.acc); this.k = 0; } }
    return true;
  }

  block(x) {
    let s = 0;
    for (let i = 0; i < x.length; i++) s += x[i] * x[i];
    const rms = Math.sqrt(s / x.length);
    if (++this.tick % 3 === 0) this.port.postMessage({ type: 'level', v: Math.min(1, rms * 14) });
    this.noise = rms < this.noise ? this.noise * 0.9 + rms * 0.1 : this.noise * 0.999 + rms * 0.001;   // falls fast, rises slowly
    if (!this.vad) return;
    const m = Math.floor(x.length / this.ratio), y = new Float32Array(m);
    for (let i = 0; i < m; i++) {
      const a = Math.floor(i * this.ratio), b = Math.min(x.length, Math.floor((i + 1) * this.ratio));
      let t = 0;
      for (let j = a; j < b; j++) t += x[j];
      y[i] = t / Math.max(1, b - a);
    }
    const on = Math.max(this.noise * 3, 0.01), off = Math.max(this.noise * 2, 0.007);
    if (!this.speaking) {
      this.pre.push(y);
      if (this.pre.length > 15) this.pre.shift();             // 300 ms kept from before the start
      if (rms > on) { if (++this.voiced >= 3) { this.speaking = true; this.buf = this.pre; this.pre = []; this.quiet = 0; this.spoken = 0; this.port.postMessage({ type: 'start' }); } }
      else this.voiced = 0;
      return;
    }
    this.buf.push(y);
    this.spoken += this.ms;
    this.quiet = rms < off ? this.quiet + this.ms : 0;
    if (this.quiet >= this.pause || this.spoken >= this.max) {
      this.speaking = false; this.voiced = 0;
      const keep = this.buf.length - Math.max(0, Math.floor((this.quiet - 200) / this.ms)), parts = this.buf.slice(0, keep);
      this.buf = [];
      if (this.spoken - this.quiet < this.min) { this.port.postMessage({ type: 'short' }); return; }
      const audio = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
      let o = 0;
      for (const p of parts) { audio.set(p, o); o += p.length; }
      this.port.postMessage({ type: 'utterance', audio }, [audio.buffer]);
    }
  }
}
registerProcessor('moshe-vad', MosheVad);
