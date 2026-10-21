// Runs the open-source Kokoro voice model (Apache-2.0) inside the browser, off the main thread.
// The library loads from jsDelivr; the model weights (~90 MB, once) load from Hugging Face.

const KOKORO_URL = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.0/+esm';
const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

let tts = null;
let loading = null;

async function load() {
  const { KokoroTTS } = await import(KOKORO_URL);
  const files = {};
  const progress_callback = (p) => {
    if (p.status !== 'progress' || !p.total) return;
    files[p.file] = { loaded: p.loaded, total: p.total };
    const all = Object.values(files);
    const loaded = all.reduce((a, f) => a + f.loaded, 0), total = all.reduce((a, f) => a + f.total, 0);
    postMessage({ type: 'progress', stage: 'download', loaded, total });
  };
  // WebGPU is much faster where available; fall back to WebAssembly.
  if (self.navigator?.gpu) {
    try {
      tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: 'fp32', device: 'webgpu', progress_callback });
      return 'webgpu';
    } catch { /* fall back below */ }
  }
  tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: 'q8', device: 'wasm', progress_callback });
  return 'wasm';
}

// Split a script into sentences (long ones at commas) so each gets its own caption.
function splitScript(text) {
  const sentences = text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?…])\s+/).filter(Boolean);
  const out = [];
  for (const s of sentences) {
    if (s.length <= 160) { out.push(s); continue; }
    let cur = '';
    for (const part of s.split(/(?<=,)\s+/)) {
      if ((cur + ' ' + part).trim().length > 160 && cur) { out.push(cur.trim()); cur = part; }
      else cur = `${cur} ${part}`;
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out;
}

self.onmessage = async (e) => {
  const { type, id, text, voice, speed } = e.data;
  if (type !== 'generate') return;
  try {
    if (!tts) {
      loading ??= load();
      const device = await loading;
      postMessage({ type: 'ready', device });
    }
    const parts = splitScript(text);
    const chunks = [];
    const segments = [];
    let sampleRate = 24000, t = 0;
    for (let i = 0; i < parts.length; i++) {
      postMessage({ type: 'progress', stage: 'generate', done: i, total: parts.length });
      const audio = await tts.generate(parts[i], { voice, speed });
      sampleRate = audio.sampling_rate || sampleRate;
      const samples = audio.audio;
      segments.push({ text: parts[i], start: t, end: t + samples.length / sampleRate });
      t += samples.length / sampleRate;
      chunks.push(samples);
      if (i < parts.length - 1) {
        const gap = new Float32Array(Math.round(sampleRate * 0.18));
        chunks.push(gap);
        t += gap.length / sampleRate;
      }
    }
    const total = chunks.reduce((a, c) => a + c.length, 0);
    const out = new Float32Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    postMessage({ type: 'done', id, samples: out, sampleRate, segments }, [out.buffer]);
  } catch (err) {
    loading = null; tts = null;
    postMessage({ type: 'error', id, message: String(err?.message || err) });
  }
};
