// User media (images, videos, audio). Files live in IndexedDB in this browser;
// the project only stores ids + metadata in project.media.

import { newId, clamp } from './model.js';

const DB_NAME = 'finischd-media', STORE = 'blobs';
const registry = new Map(); // id -> { kind, url, el, buffer, peaks, duration, name }
let onReady = () => {};
export const onMediaReady = (fn) => { onReady = fn; };

function openDB() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
}
async function idb(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const r = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(r?.result);
    tx.onerror = () => reject(tx.error);
  });
}
const putBlob = (id, blob) => idb('readwrite', (s) => s.put(blob, id)).catch(() => {});
export const getBlob = (id) => idb('readonly', (s) => s.get(id)).catch(() => null);

export const kindOf = (type) => (type.startsWith('image/') ? 'image' : type.startsWith('video/') ? 'video' : type.startsWith('audio/') ? 'audio' : null);

let audioCtxGetter = () => null;
export const setAudioContextGetter = (fn) => { audioCtxGetter = fn; };

function computePeaks(buffer, n = 600) {
  const data = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / n));
  const peaks = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j += 4) m = Math.max(m, Math.abs(data[j]));
    peaks[i] = m;
  }
  return peaks;
}

async function load(id, blob, meta) {
  const kind = meta.kind;
  const url = URL.createObjectURL(blob);
  const entry = { kind, url, name: meta.name, duration: meta.duration || 0, ready: false };
  registry.set(id, entry);
  if (kind === 'image') {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {});
    entry.el = img; entry.ready = true;
  } else if (kind === 'video') {
    const v = document.createElement('video');
    v.src = url; v.muted = true; v.playsInline = true; v.preload = 'auto';
    await new Promise((res) => { v.onloadeddata = res; v.onerror = res; setTimeout(res, 4000); });
    v.addEventListener('seeked', () => onReady());
    entry.el = v; entry.duration = v.duration || meta.duration || 0; entry.ready = true;
  }
  if (kind === 'audio' || kind === 'video') {
    try {
      const ctx = audioCtxGetter();
      if (ctx) {
        entry.buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
        entry.duration = entry.buffer.duration;
        entry.peaks = computePeaks(entry.buffer);
        entry.ready = true;
      }
    } catch { /* video without sound track, or undecodable audio */ }
  }
  onReady();
  return entry;
}

export const getMedia = (id) => (id ? registry.get(id) || null : null);

// Add a user file to the project. Returns the new media id.
export async function addMediaFile(project, file) {
  const kind = kindOf(file.type || '');
  if (!kind) throw new Error('unsupported');
  const id = newId('m');
  await putBlob(id, file);
  const entry = await load(id, file, { kind, name: file.name || `${kind} file` });
  project.media[id] = { kind, name: file.name || `${kind} file`, duration: entry.duration || 0 };
  return id;
}

// Load every media file the project refers to (on boot, undo, open).
export async function loadProjectMedia(project) {
  const jobs = [];
  for (const [id, meta] of Object.entries(project.media || {})) {
    if (registry.has(id)) continue;
    jobs.push(getBlob(id).then((blob) => (blob ? load(id, blob, meta) : null)));
  }
  await Promise.all(jobs);
}

// Project files carry their media inline so they open on another computer.
export async function exportMediaInline(project) {
  const out = {};
  for (const id of Object.keys(project.media || {})) {
    const blob = await getBlob(id);
    if (!blob) continue;
    out[id] = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
  }
  return out;
}
export async function importMediaInline(project, inline) {
  for (const [id, dataUrl] of Object.entries(inline || {})) {
    const blob = await (await fetch(dataUrl)).blob();
    await putBlob(id, blob);
    if (!registry.has(id)) await load(id, blob, project.media[id] || { kind: kindOf(blob.type), name: id });
  }
}

// Loudness 0..1 of an audio/video media at a time (for face cam "speaking" glow).
export function levelAt(id, time) {
  const m = registry.get(id);
  if (!m?.peaks || !m.duration || time < 0 || time > m.duration) return 0;
  return m.peaks[Math.min(m.peaks.length - 1, Math.floor((time / m.duration) * m.peaks.length))];
}

// Keep <video> elements in step with the timeline. Preview and export call this each frame.
export function syncVideos(project, t, playing) {
  // A split window shares its video with its other piece: let the piece on screen drive it.
  const driver = new Map();
  const alive = (l) => !l.hidden && l.keys.length && t >= l.keys[0].t && t >= (l.in ?? -Infinity) && t < (l.out ?? Infinity);
  for (const layer of project.layers) {
    for (const id of [layer.data?.mediaId, layer.data?.selfMedia]) {
      if (id && (!driver.has(id) || (alive(layer) && !alive(driver.get(id))))) driver.set(id, layer);
    }
  }
  for (const layer of project.layers) {
   for (const id of [layer.data?.mediaId, layer.data?.selfMedia]) {
    if (!id || driver.get(id) !== layer) continue;
    const m = getMedia(id);
    if (!m || m.kind !== 'video' || !m.el) continue;
    const v = m.el;
    const start = layer.data.videoStart ?? layer.keys[0]?.t ?? 0;
    const dur = v.duration || 0;
    let want = Math.max(0, t - start);
    if (layer.data.loop && dur) want %= dur; else want = clamp(want, 0, Math.max(0, dur - 0.05));
    const active = playing && alive(layer) && t >= start && (layer.data.loop || t - start < dur);
    if (active) {
      if (v.paused) { v.currentTime = want; v.play().catch(() => {}); }
      else if (Math.abs(v.currentTime - want) > 0.3) v.currentTime = want;
    } else {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - want) > 0.04 && !v.seeking) v.currentTime = want;
    }
   }
  }
}
export function pauseAllVideos() {
  for (const m of registry.values()) if (m.kind === 'video' && m.el && !m.el.paused) m.el.pause();
}
