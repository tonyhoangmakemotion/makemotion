// Shared editor state and the actions every panel uses.

import { snapTime, clamp, FPS } from './model.js';
import { createDemoProject, migrate } from './project.js';
import { loadProjectMedia } from './media.js';
import * as history from './history.js';
import { autoCameraKeys } from './autocam.js';

const STORE_KEY = 'finischd.project.v1';

export const $ = (id) => document.getElementById(id);

export const S = {
  project: null,
  t: 0,
  playing: false,
  sel: null,        // { kind: 'layer'|'camera'|'cursor'|'captions'|'caption'|'audio', id?, track? }
  selKey: null,     // keyframe object picked in the timeline
  cameraView: true,
  snapping: true,
  loop: false,
  guides: [],       // snap guide lines while dragging
  dirty: true,      // stage needs a redraw
  safeArea: '',     // editor-only safe-area overlay (format.js SAFE_AREAS key)
};

// Panels register their render functions here.
export const hooks = {
  layers() {}, inspector() {}, timeline() {}, project() {}, pause() {}, view() {}, stopAudio() {},
};

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const p = raw ? JSON.parse(raw) : null;
    return p && p.version === 1 && Array.isArray(p.layers) ? migrate(p) : null;
  } catch { return null; }
}

let saveTimer = 0;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S.project)); } catch { /* storage unavailable */ }
  }, 400);
}

export function initProject() {
  S.project = loadSaved() || createDemoProject();
  S.sel = S.project.layers[1] ? { kind: 'layer', id: S.project.layers[1].id } : null;
  history.resetHistory(S.project);
  loadProjectMedia(S.project).then(() => { S.dirty = true; hooks.timeline(); hooks.inspector(); });
}

function refreshAll() {
  S.dirty = true;
  hooks.stopAudio?.();
  loadProjectMedia(S.project).then(() => { S.dirty = true; hooks.timeline(); });
  hooks.project(); hooks.layers(); hooks.inspector(); hooks.timeline();
}

// Call after any edit. `structure`: the list of windows/captions changed.
// `coalesce`: a typing edit, merged into one undo step.
// Auto camera: while project.camera.auto is on, the camera is rebuilt after every edit so it
// keeps following the windows. If the camera keys were changed by hand, the person is
// directing now: auto switches off.
let lastAuto = null;
export function updateAutoCamera() {
  const cam = S.project.camera;
  if (!cam.auto) { lastAuto = null; return false; }
  if (lastAuto && JSON.stringify(cam.keys) !== lastAuto) {
    cam.auto = false; lastAuto = null;
    toast('You moved the camera yourself, so Auto camera is off. Turn it back on in the Look panel');
    return false;
  }
  const keys = autoCameraKeys(S.project);
  if (keys) cam.keys = keys;
  lastAuto = JSON.stringify(cam.keys);
  return true;
}

export function changed({ structure = false, coalesce = false, inspector = false } = {}) {
  const wasAuto = !!S.project.camera.auto;
  updateAutoCamera();
  if (wasAuto && !S.project.camera.auto) inspector = true;
  S.dirty = true;
  persist();
  history.record(S.project, coalesce);
  if (structure) hooks.layers();
  if (structure || inspector) hooks.inspector();
  hooks.timeline();
  hooks.chips?.();
}

// Replace the whole project (open file, load demo). Undo can bring the old one back.
export function replaceProject(p) {
  lastAuto = null;
  S.project = migrate(p);
  S.t = 0; S.selKey = null;
  S.sel = null;
  persist();
  history.record(S.project);
  refreshAll();
}

function restore(p) {
  if (!p) return false;
  S.project = migrate(p);
  S.selKey = null;
  const sel = S.sel;
  if (sel?.kind === 'layer' && !S.project.layers.some((l) => l.id === sel.id)) S.sel = null;
  if (sel?.kind === 'caption' && !S.project.captions.some((c) => c.id === sel.id)) S.sel = { kind: 'captions' };
  if (sel?.kind === 'audio' && sel.id && !S.project.audio.some((c) => c.id === sel.id)) S.sel = { kind: 'audio', track: sel.track };
  S.t = Math.min(S.t, S.project.duration);
  persist();
  refreshAll();
  return true;
}
export const undo = () => (lastAuto = null, restore(history.undo())) && toast('Undone');
export const redo = () => (lastAuto = null, restore(history.redo())) && toast('Redone');

export const selectedLayer = () => (S.sel?.kind === 'layer' ? S.project.layers.find((l) => l.id === S.sel.id) || null : null);
export const selectedClip = () => (S.sel?.kind === 'audio' && S.sel.id ? S.project.audio.find((c) => c.id === S.sel.id) || null : null);
export const selectedCaption = () => (S.sel?.kind === 'caption' ? S.project.captions.find((c) => c.id === S.sel.id) || null : null);

export function select(sel) {
  S.sel = sel;
  S.selKey = null;
  S.dirty = true;
  hooks.layers(); hooks.inspector(); hooks.timeline();
}

export function seek(t, { refresh = true } = {}) {
  S.t = clamp(snapTime(t), 0, S.project.duration);
  S.dirty = true;
  if (refresh && !S.playing) hooks.inspector();
}

export const fmt = (t) => {
  const fr = Math.min(FPS - 1, Math.round((t % 1) * FPS));
  const s = Math.floor(t) % 60, m = Math.floor(t / 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(fr).padStart(2, '0')}`;
};

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let toastTimer = 0;
export function toast(text) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = text; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 1600);
  return true;
}

// Two-click confirmation for destructive buttons.
export function confirmClick(btn, label, action) {
  if (btn.dataset.armed) { delete btn.dataset.armed; action(); return; }
  const original = btn.textContent;
  btn.dataset.armed = '1'; btn.textContent = label;
  setTimeout(() => { if (btn.isConnected && btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = original; } }, 3000);
}

export const isTyping = () => {
  const el = document.activeElement;
  return !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && !['button', 'checkbox', 'range'].includes(el.type)));
};
