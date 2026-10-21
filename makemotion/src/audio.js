// Audio: built-in sound effects (synthesized, no files), user clips (voiceover,
// sound effects, music), automatic sounds for clicks/messages/typing, and mixing.

import { getMedia, setAudioContextGetter } from './media.js';
import { typingSchedule } from './apps/draw.js';

let ctx = null;
export function audioContext() {
  if (!ctx) {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { ctx = null; }
  }
  return ctx;
}
setAudioContextGetter(audioContext);

// ---------- Built-in sound effects ----------

export const SFX = {
  click: 'Mouse click', double: 'Double click', pop: 'Pop', ding: 'Message ding', send: 'Message sent',
  notify: 'Notification', whoosh: 'Whoosh', typing: 'Keyboard typing', error: 'Error buzz', shutter: 'Camera shutter',
  key: 'Key press',
};

const sfxCache = new Map();

function synth(name, sr) {
  const len = { click: 0.06, double: 0.18, pop: 0.16, ding: 1.1, send: 0.3, notify: 0.9, whoosh: 0.7, typing: 1.6, error: 0.55, shutter: 0.3, key: 0.05 }[name] || 0.2;
  const n = Math.floor(len * sr);
  const out = new Float32Array(n);
  let seed = 1234567;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; };
  const tick = (at, amp, freq = 2200, decay = 0.012) => {
    const s0 = Math.floor(at * sr);
    for (let i = 0; i < Math.min(n - s0, sr * 0.05); i++) {
      const t = i / sr;
      out[s0 + i] += amp * Math.exp(-t / decay) * (0.6 * Math.sin(2 * Math.PI * freq * t) + 0.4 * rnd());
    }
  };
  const tone = (at, freq, dur, amp, decay, f2 = freq) => {
    const s0 = Math.floor(at * sr);
    let ph = 0;
    for (let i = 0; i < Math.min(n - s0, dur * sr); i++) {
      const t = i / sr, f = freq + (f2 - freq) * (t / dur);
      ph += (2 * Math.PI * f) / sr;
      out[s0 + i] += amp * Math.exp(-t / decay) * Math.sin(ph) * Math.min(1, t * 400);
    }
  };
  switch (name) {
    case 'click': tick(0, 0.7); break;
    case 'key': tick(0, 0.35, 3200, 0.008); break;
    case 'double': tick(0, 0.7); tick(0.1, 0.65); break;
    case 'pop': tone(0, 380, 0.15, 0.6, 0.05, 900); break;
    case 'ding': tone(0, 1318, 1.0, 0.35, 0.35); tone(0.09, 1760, 0.9, 0.28, 0.3); break;
    case 'send': tone(0, 420, 0.25, 0.4, 0.09, 1400); break;
    case 'notify': tone(0, 988, 0.5, 0.35, 0.18); tone(0.16, 1480, 0.7, 0.32, 0.25); break;
    case 'whoosh': {
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n, env = Math.sin(Math.PI * t) ** 2, a = 0.02 + 0.25 * Math.sin(Math.PI * t);
        lp += a * (rnd() - lp);
        out[i] += lp * env * 1.6;
      }
      break;
    }
    case 'typing': {
      let at = 0.02;
      while (at < len - 0.06) { tick(at, 0.3 + 0.15 * Math.abs(rnd()), 2600 + 900 * rnd(), 0.009); at += 0.07 + 0.09 * Math.abs(rnd()); }
      break;
    }
    case 'error': for (let k = 0; k < 2; k++) {
      const s0 = Math.floor(k * 0.27 * sr);
      for (let i = 0; i < 0.22 * sr && s0 + i < n; i++) out[s0 + i] += 0.22 * Math.sign(Math.sin(2 * Math.PI * 180 * i / sr)) * Math.min(1, (0.22 * sr - i) / 400);
    } break;
    case 'shutter': tick(0, 0.8, 1200, 0.02); tick(0.11, 0.6, 900, 0.03); break;
    default: tick(0, 0.5);
  }
  return out;
}

export function sfxBuffer(name) {
  const c = audioContext();
  if (!c) return null;
  if (!sfxCache.has(name)) {
    const data = synth(name, c.sampleRate);
    const b = c.createBuffer(1, data.length, c.sampleRate);
    b.copyToChannel(data, 0);
    sfxCache.set(name, b);
  }
  return sfxCache.get(name);
}

export function clipBuffer(clip) {
  if (clip.src.startsWith('sfx:')) return sfxBuffer(clip.src.slice(4));
  return getMedia(clip.src.slice(6))?.buffer || null;
}
export const clipLength = (clip) => {
  if (clip.dur) return clip.dur;
  if (clip.src.startsWith('sfx:')) return sfxBuffer(clip.src.slice(4))?.duration || 0.3;
  const m = getMedia(clip.src.slice(6));
  return Math.max(0.1, (m?.duration || 1) - (clip.offset || 0));
};

// ---------- Automatic sounds ----------

export function autoEvents(project) {
  const a = project.autoSfx || {};
  const ev = [];
  if (a.clicks) {
    for (const e of project.cursor.events || []) {
      if (e.type === 'click' || e.type === 'right') ev.push({ t: e.t, sfx: 'click', vol: 0.8 });
      if (e.type === 'double') ev.push({ t: e.t, sfx: 'double', vol: 0.8 });
      if (e.type === 'drag') { ev.push({ t: e.t, sfx: 'click', vol: 0.6 }); ev.push({ t: e.t + (e.dur || 0.6), sfx: 'click', vol: 0.5 }); }
    }
  }
  for (const l of project.layers) {
    if (l.hidden) continue;
    const d = l.data || {};
    const from = Math.max(l.keys[0]?.t ?? 0, l.in ?? -Infinity), to = l.out ?? Infinity;
    const n0 = ev.length;
    collectLayerSounds(l, d);
    // A trimmed window makes no sound outside its trim range.
    for (let i = ev.length - 1; i >= n0; i--) if (ev[i].t < from - 0.01 || ev[i].t >= to) ev.splice(i, 1);
  }
  return ev;

  function collectLayerSounds(l, d) {
    if (a.messages && (l.type === 'chat' || l.type === 'phone')) {
      for (const m of d.messages || []) if (m.from !== 'sep') ev.push({ t: m.t, sfx: m.from === 'me' ? 'send' : 'ding', vol: m.from === 'me' ? 0.5 : 0.45 });
    }
    if (a.messages && l.type === 'notification' && l.keys[0]) ev.push({ t: l.keys[0].t + 0.05, sfx: 'notify', vol: 0.5 });
    if (a.messages && l.type === 'email' && d.arriveAt != null) ev.push({ t: d.arriveAt, sfx: 'notify', vol: 0.4 });
    if (a.typing) {
      const typingOf = (text, start, cps) => {
        if (!text) return;
        const s = typingSchedule(text, cps);
        for (let i = 0; i < s.length; i += 1) if (!/\s/.test(text[i])) ev.push({ t: start + s[i], sfx: 'key', vol: 0.35 });
      };
      if (l.type === 'code' || l.type === 'notes') typingOf(d.code ?? d.text, d.start, d.cps || 30);
      if (l.type === 'browser') typingOf(d.query, d.queryStart, d.cps || 15);
    }
  }
}

// ---------- Playback / mixing ----------

let live = [];

// Schedule everything from timeline time `fromT` into `dest`, starting at ctx time `startAt`.
export function schedule(project, fromT, dest, startAt) {
  const c = audioContext();
  if (!c) return [];
  const master = c.createGain();
  master.gain.value = project.volume ?? 1;
  master.connect(dest);
  const sources = [];
  const play = (buffer, when, offset, length, vol) => {
    if (!buffer || length <= 0) return;
    const src = c.createBufferSource();
    src.buffer = buffer;
    const g = c.createGain();
    g.gain.value = vol;
    src.connect(g).connect(master);
    src.start(Math.max(c.currentTime, when), Math.max(0, offset), length);
    sources.push(src);
  };
  for (const clip of project.audio || []) {
    if (clip.muted) continue;
    const buffer = clipBuffer(clip);
    if (!buffer) continue;
    const len = Math.min(clipLength(clip), buffer.duration - (clip.offset || 0));
    if (clip.start + len <= fromT) continue;
    const skip = Math.max(0, fromT - clip.start);
    play(buffer, startAt + Math.max(0, clip.start - fromT), (clip.offset || 0) + skip, len - skip, clip.volume ?? 1);
  }
  const autoVol = project.autoSfx?.volume ?? 0.7;
  for (const e of autoEvents(project)) {
    if (e.t < fromT - 0.01 || e.t > project.duration) continue;
    const b = sfxBuffer(e.sfx);
    play(b, startAt + (e.t - fromT), 0, b.duration, e.vol * autoVol);
  }
  sources.master = master;
  return sources;
}

export function startPlayback(project, fromT) {
  stopPlayback();
  const c = audioContext();
  if (!c) return;
  c.resume?.();
  live = schedule(project, fromT, c.destination, c.currentTime + 0.03);
}
export function stopPlayback() {
  for (const s of live) { try { s.stop(); } catch { /* already stopped */ } }
  try { live.master?.disconnect(); } catch { /* ignore */ }
  live = [];
}

export function previewSfx(name) {
  const c = audioContext();
  const b = sfxBuffer(name);
  if (!c || !b) return;
  c.resume?.();
  const src = c.createBufferSource();
  src.buffer = b; src.connect(c.destination); src.start();
}

// ---------- Voiceover recording ----------

export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start(200);
  return {
    stop: () => new Promise((res) => {
      rec.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const type = (rec.mimeType || 'audio/webm').split(';')[0];
        res(new File([new Blob(chunks, { type })], `Voiceover ${new Date().toLocaleTimeString()}.${type.includes('mp4') ? 'm4a' : 'webm'}`, { type }));
      };
      rec.stop();
    }),
  };
}
