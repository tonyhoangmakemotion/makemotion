// Free AI voiceover with the open-source Kokoro model, running in the browser.
// No API key, no per-minute cost. The model downloads once (~90 MB) and is cached by the browser.

import { newId } from './model.js';
import { audioContext } from './audio.js';
import { S, hooks, $, changed, esc, toast, fmt } from './store.js';

export const VOICES = [
  ['af_heart', 'Heart', 'US', 'female'], ['af_bella', 'Bella', 'US', 'female'], ['af_nicole', 'Nicole (whispery)', 'US', 'female'],
  ['af_sarah', 'Sarah', 'US', 'female'], ['af_sky', 'Sky', 'US', 'female'], ['af_nova', 'Nova', 'US', 'female'],
  ['af_river', 'River', 'US', 'female'], ['af_jessica', 'Jessica', 'US', 'female'], ['af_kore', 'Kore', 'US', 'female'],
  ['af_alloy', 'Alloy', 'US', 'female'], ['af_aoede', 'Aoede', 'US', 'female'],
  ['am_michael', 'Michael', 'US', 'male'], ['am_adam', 'Adam', 'US', 'male'], ['am_fenrir', 'Fenrir', 'US', 'male'],
  ['am_puck', 'Puck', 'US', 'male'], ['am_echo', 'Echo', 'US', 'male'], ['am_eric', 'Eric', 'US', 'male'],
  ['am_liam', 'Liam', 'US', 'male'], ['am_onyx', 'Onyx', 'US', 'male'], ['am_santa', 'Santa', 'US', 'male'],
  ['bf_emma', 'Emma', 'UK', 'female'], ['bf_isabella', 'Isabella', 'UK', 'female'], ['bf_alice', 'Alice', 'UK', 'female'],
  ['bf_lily', 'Lily', 'UK', 'female'],
  ['bm_george', 'George', 'UK', 'male'], ['bm_fable', 'Fable', 'UK', 'male'], ['bm_lewis', 'Lewis', 'UK', 'male'],
  ['bm_daniel', 'Daniel', 'UK', 'male'],
];

// Settings the panel remembers while you work.
const draft = { text: '', voice: 'af_heart', speed: 1, captions: true };
try { Object.assign(draft, JSON.parse(localStorage.getItem('finischd.tts') || '{}')); } catch { /* storage unavailable */ }
const saveDraft = () => { try { localStorage.setItem('finischd.tts', JSON.stringify(draft)); } catch { /* ignore */ } };

const state = { busy: false, status: '', error: '', modelReady: false };
let worker = null;
let jobs = 0;
const pending = new Map();

const inArtifact = !!window.claude?.use;

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./tts-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'progress') {
      if (m.stage === 'download') setStatus(`Downloading the voice model (first time only)… ${Math.round((m.loaded / m.total) * 100)}%`);
      else setStatus(m.total > 1 ? `Speaking sentence ${m.done + 1} of ${m.total}…` : 'Generating…');
    } else if (m.type === 'ready') {
      state.modelReady = true;
      setStatus(`Voice model ready (${m.device === 'webgpu' ? 'fast GPU mode' : 'standard mode'}). Generating…`);
    } else if (m.type === 'done' || m.type === 'error') {
      const job = pending.get(m.id);
      pending.delete(m.id);
      if (job) (m.type === 'done' ? job.resolve(m) : job.reject(new Error(m.message)));
    }
  };
  worker.onerror = (e) => {
    for (const job of pending.values()) job.reject(new Error(e.message || 'The voice engine could not start'));
    pending.clear();
    worker = null;
  };
  return worker;
}

function speak(text, voice, speed) {
  const id = ++jobs;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ type: 'generate', id, text, voice, speed });
  });
}

function setStatus(text) {
  state.status = text;
  const el = $('tts-status');
  if (el) { el.textContent = text; el.classList.toggle('err', !!state.error); }
}

// 16-bit PCM WAV from float samples.
export function encodeWav(samples, sampleRate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

function failMessage(err) {
  if (inArtifact) return 'AI voices can’t download inside the claude.ai preview. Run MakeMotion on your computer to use them.';
  if (!navigator.onLine) return 'You are offline. The voice model needs internet the first time.';
  if (/fetch|import|network|load/i.test(err.message)) return 'The voice engine could not be downloaded. Check your internet connection and try again.';
  return `The voice could not be generated (${err.message}). Try a shorter script or another voice.`;
}

async function generate() {
  const text = draft.text.trim();
  if (!text) { toast('Type what the voice should say first'); $('tts-text')?.focus(); return; }
  if (state.busy) return;
  state.busy = true; state.error = '';
  const startAt = +S.t.toFixed(2);
  setStatus(state.modelReady ? 'Generating…' : 'Starting the voice engine…');
  syncButtons();
  try {
    const res = await speak(text, draft.voice, draft.speed);
    const file = new File([encodeWav(res.samples, res.sampleRate)], `AI voice - ${text.slice(0, 28)}.wav`, { type: 'audio/wav' });
    audioContext();
    const clip = await hooks.addAudioFile(file, 'voice', startAt);
    if (clip) {
      clip.name = `AI: ${text.slice(0, 40)}`;
      const len = res.samples.length / res.sampleRate;
      let replaced = 0;
      if (draft.captions) {
        // New captions replace any captions in the same stretch of time, so they never overlap.
        const before = S.project.captions.length;
        S.project.captions = S.project.captions.filter((c) => c.end <= startAt || c.start >= startAt + len);
        replaced = before - S.project.captions.length;
        for (const seg of res.segments) {
          S.project.captions.push({ id: newId('cap'), start: +(startAt + seg.start).toFixed(2), end: +(startAt + seg.end + 0.12).toFixed(2), text: seg.text });
        }
        S.project.captions.sort((a, b) => a.start - b.start);
      }
      if (startAt + len > S.project.duration) S.project.duration = Math.ceil(startAt + len + 0.5);
      changed({ structure: true });
      hooks.project();
      setStatus(`Added ${len.toFixed(1)}s of voice at ${fmt(startAt)}${draft.captions ? ` with ${res.segments.length} caption${res.segments.length > 1 ? 's' : ''}` : ''}${replaced ? ` (replaced ${replaced} older caption${replaced > 1 ? 's' : ''})` : ''}.`);
    }
  } catch (err) {
    state.error = failMessage(err);
    setStatus(state.error);
  } finally {
    state.busy = false;
    syncButtons();
  }
}

async function listen() {
  if (state.busy) return;
  state.busy = true; state.error = '';
  setStatus(state.modelReady ? 'Generating a sample…' : 'Starting the voice engine…');
  syncButtons();
  try {
    const name = VOICES.find((v) => v[0] === draft.voice)?.[1] || 'this voice';
    const res = await speak(`Hi, I'm ${name.split(' ')[0]}. This is how your voiceover will sound.`, draft.voice, draft.speed);
    const c = audioContext();
    await c.resume?.();
    const b = c.createBuffer(1, res.samples.length, res.sampleRate);
    b.copyToChannel(res.samples, 0);
    const src = c.createBufferSource();
    src.buffer = b; src.connect(c.destination); src.start();
    setStatus('Playing a sample.');
  } catch (err) {
    state.error = failMessage(err);
    setStatus(state.error);
  } finally {
    state.busy = false;
    syncButtons();
  }
}

function syncButtons() {
  for (const id of ['tts-go', 'tts-listen']) { const b = $(id); if (b) b.disabled = state.busy; }
  const go = $('tts-go');
  if (go) go.textContent = state.busy ? 'Working…' : 'Generate voice at playhead';
}

export function ttsBlock() {
  const groups = [['US', 'female', 'American, female'], ['US', 'male', 'American, male'], ['UK', 'female', 'British, female'], ['UK', 'male', 'British, male']];
  const options = groups.map(([acc, g, label]) => `<optgroup label="${label}">${
    VOICES.filter((v) => v[2] === acc && v[3] === g).map(([id, name]) => `<option value="${id}" ${draft.voice === id ? 'selected' : ''}>${esc(name)}</option>`).join('')
  }</optgroup>`).join('');
  return `<section class="group"><div class="group-title"><b>AI voice</b><span>free, open source</span></div>
    <div class="field"><label for="tts-text">What should the voice say?</label>
      <textarea id="tts-text" rows="5" placeholder="Type your script. Each sentence becomes its own caption.">${esc(draft.text)}</textarea></div>
    <div class="grid2">
      <div class="field"><label for="tts-voice">Voice</label><select id="tts-voice">${options}</select></div>
      <div class="field"><label for="tts-speed">Speed: <span id="tts-speed-val">${draft.speed.toFixed(2)}×</span></label><input type="range" id="tts-speed" min="0.7" max="1.3" step="0.05" value="${draft.speed}"></div>
    </div>
    <label class="check"><input type="checkbox" id="tts-caps" ${draft.captions ? 'checked' : ''}> Also add captions, one per sentence</label>
    <div class="row"><button class="btn small primary-soft" id="tts-go" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Working…' : 'Generate voice at playhead'}</button>
      <button class="btn small" id="tts-listen" ${state.busy ? 'disabled' : ''}>Listen to this voice</button></div>
    <p class="note tts-status${state.error ? ' err' : ''}" id="tts-status" role="status">${esc(state.status || (inArtifact
      ? 'Note: inside the claude.ai preview the voice model can’t download. It works when you run MakeMotion on your computer.'
      : 'Runs on your computer with the Kokoro model. The first time, it downloads about 90 MB; after that it’s instant and works offline.'))}</p>
  </section>`;
}

export function bindTts() {
  const t = $('tts-text');
  if (!t) return;
  t.addEventListener('input', () => { draft.text = t.value; saveDraft(); });
  $('tts-voice').addEventListener('change', (e) => { draft.voice = e.target.value; saveDraft(); });
  $('tts-speed').addEventListener('input', (e) => { draft.speed = +e.target.value; $('tts-speed-val').textContent = `${draft.speed.toFixed(2)}×`; saveDraft(); });
  $('tts-caps').addEventListener('change', (e) => { draft.captions = e.target.checked; saveDraft(); });
  $('tts-go').addEventListener('click', generate);
  $('tts-listen').addEventListener('click', listen);
}
