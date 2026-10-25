// Right panel: edits whatever is selected. Window content forms are built from
// each app's `fields` schema (see src/apps/index.js).

import {
  sample, upsertKey, keyAt, removeKey, clamp, snapTime, newId, EASINGS, EASE_LABELS, LAYER_PROPS, CAMERA_PROPS, CURSOR_PROPS,
  applyEnter, applyExit,
} from './model.js';
import { CURSOR_EVENTS, textLayerName } from './project.js';
import { layerRange } from './cut.js';
import { APPS, chromeOf } from './apps/index.js';
import { layerState, windowTitle, cursorAt } from './render.js';
import { addMediaFile, getMedia, kindOf } from './media.js';
import { SFX, previewSfx, clipLength } from './audio.js';
import { S, hooks, $, changed, seek, fmt, esc, toast, selectedLayer, selectedCaption, selectedClip } from './store.js';
import { duplicateLayer, deleteLayer } from './panels.js';
import { WALLPAPERS, wallpaperThumb } from './wallpapers.js';
import { ttsBlock, bindTts } from './tts.js';
import { MOVES, addMove, addShake, startCamRecording, stopCamRecording, isCamRecording, camSet, inCameraMode, transitionTo, addBlurTransition } from './camera.js';
import { autoCameraKeys } from './autocam.js';
import { LOOKS } from './look.js';
import { viewSize, minAutoZoom } from './format.js';

const PROP_STEP = { opacity: 0.05, scale: 0.01, zoom: 0.05 };
const PROP_LABEL = { x: 'X', y: 'Y', w: 'Width', h: 'Height', opacity: 'Opacity', scale: 'Scale', cx: 'Center X', cy: 'Center Y', zoom: 'Zoom' };
const TRACK_LABEL = { voice: 'Voiceover', sfx: 'Sound effects', music: 'Music' };
const round = (v, step) => (step < 1 ? +v.toFixed(2) : Math.round(v));
const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
const rerender = () => hooks.inspector();

function keyTarget() {
  const l = selectedLayer();
  if (l) return { keys: l.keys, props: LAYER_PROPS };
  if (S.sel?.kind === 'camera') return { keys: S.project.camera.keys, props: CAMERA_PROPS };
  if (S.sel?.kind === 'cursor') return { keys: S.project.cursor.keys, props: CURSOR_PROPS };
  return null;
}

// ---------- Building blocks ----------

const section = (title, body, aside = '') =>
  `<section class="group"><div class="group-title"><b>${title}</b>${aside ? `<span>${aside}</span>` : ''}</div>${body}</section>`;
const field = (id, label, value, attrs = '') =>
  `<div class="field"><label for="${id}">${label}</label><input id="${id}" value="${esc(value)}" ${attrs}></div>`;
const UNIT = { x: 'px', y: 'px', w: 'px', h: 'px', cx: 'px', cy: 'px', opacity: '', scale: '×', zoom: '×' };
const numField = (id, label, value, step) => {
  const u = UNIT[id.slice(2)];
  return `<div class="field"><label for="${id}">${label}</label><div class="unit-input"><input type="number" id="${id}" data-prop="${id.slice(2)}" step="${step}" value="${value}">${u ? `<span class="unit">${u}</span>` : ''}</div></div>`;
};
// Easing curve preview (how the move into this keyframe accelerates), drawn from the real curve.
function easeCurve(name) {
  const E = EASINGS[name] || EASINGS.smooth;
  const pts = [];
  for (let i = 0; i <= 40; i++) { const u = i / 40; const v = name === 'hold' ? (u < 1 ? 0 : 1) : E(u); pts.push(`${(12 + u * 276).toFixed(1)},${(118 - v * 96).toFixed(1)}`); }
  // Drawn like the site's mockup: white curve, violet bezier-style handles.
  return `<div class="ease-curve" aria-hidden="true"><svg viewBox="0 0 300 130" preserveAspectRatio="none"><polyline points="${pts.join(' ')}" fill="none" stroke="#f2f2f4" stroke-width="2" vector-effect="non-scaling-stroke"/><path d="M12 118 L80 118 M288 22 L110 24" stroke="#8b6cff" stroke-width="1.2" vector-effect="non-scaling-stroke"/><circle cx="80" cy="118" r="4" fill="#8b6cff"/><circle cx="110" cy="24" r="4" fill="#8b6cff"/></svg></div><span class="ease-name">${EASE_LABELS[name] || name}</span>`;
}

function keyframeControls(target) {
  const k = keyAt(target.keys, S.t);
  if (!k) return `<div class="row"><button class="btn small" id="key-add">Add keyframe here <kbd>K</kbd></button></div>`;
  return `<div class="row keyrow"><span class="keypill">Keyframe</span>
    <select id="key-ease" aria-label="How it moves into this keyframe">
      ${Object.keys(EASINGS).map((e) => `<option value="${e}" ${k.ease === e ? 'selected' : ''}>${EASE_LABELS[e]}</option>`).join('')}
    </select>
    <button class="btn small danger" id="key-del" ${target.keys.length <= 1 ? 'disabled' : ''}>Delete</button></div>
    <div class="field"><span>Move easing</span>${easeCurve(k.ease)}</div>`;
}

function propsBlock(target, title) {
  const s = sample(target.keys, S.t, target.props);
  const fields = target.props.map((p) => numField(`f-${p}`, PROP_LABEL[p], round(s[p] ?? 0, PROP_STEP[p] || 1), PROP_STEP[p] || 1)).join('');
  return section(title, `<div class="grid2">${fields}</div>${keyframeControls(target)}`, `at ${fmt(S.t)}`);
}

// ---------- Schema-driven window content ----------

function mediaOptions(accept) {
  const kinds = accept.split(',');
  return Object.entries(S.project.media).filter(([, m]) => kinds.includes(m.kind));
}

function fieldHtml(f, d, fi = 0) {
  const id = `fd-${f.key}`;
  const v = d[f.key];
  switch (f.type) {
    case 'text': case 'contact': return field(id, f.label, v ?? '');
    case 'list': return field(id, f.label, (v || []).join(', '));
    case 'number': return `<div class="field"><label for="${id}">${f.label}</label><input type="number" id="${id}" step="${f.step ?? 1}" ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} value="${v ?? 0}"></div>`;
    case 'time': return `<div class="field"><label for="${id}">${f.label} (s)</label><div class="inline"><input type="number" id="${id}" step="0.1" min="0" value="${+(v ?? 0).toFixed(2)}"><button class="btn small" data-now="${f.key}" title="Set to the playhead">Now</button></div></div>`;
    case 'textarea': return `<div class="field"><label for="${id}">${f.label}</label>${f.count ? '<div class="counted">' : ''}<textarea id="${id}" rows="${f.rows || 4}" ${f.mono ? 'class="mono" spellcheck="false"' : ''}>${esc(v ?? '')}</textarea>${f.count ? `<span class="count" id="${id}-n">${String(v ?? '').length} / ${f.count}</span></div>` : ''}</div>`;
    case 'script': return `<div class="field"><label for="${id}">${f.label}</label><textarea id="${id}" rows="${f.rows || 5}" class="mono" spellcheck="false">${esc(f.format(v || []))}</textarea></div>`;
    case 'select': return `<div class="field"><label for="${id}">${f.label}</label><select id="${id}">${f.options.map(([val, l]) => `<option value="${val}" ${v === val ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
    case 'check': return `<label class="check"><input type="checkbox" id="${id}" ${v ? 'checked' : ''}> ${f.label}</label>`;
    case 'color': return `<div class="field color"><label for="${id}">${f.label}</label><input type="color" id="${id}" value="${esc(v || '#ffffff')}"></div>`;
    case 'media': {
      const m = getMedia(v);
      const opts = mediaOptions(f.accept);
      return `<div class="field"><span>${f.label}</span>
        <div class="media-pick">${m ? `<span class="media-name">${esc(S.project.media[v]?.name || 'File')}</span>` : '<span class="media-name muted">Nothing chosen</span>'}
        <button class="btn small" data-pick="${f.key}" data-accept="${f.accept}">Choose file</button>
        ${v ? `<button class="icon-btn danger" data-clear="${f.key}" title="Remove" aria-label="Remove">✕</button>` : ''}</div>
        ${opts.length > 1 || (opts.length === 1 && opts[0][0] !== v) ? `<select data-reuse="${f.key}" aria-label="Use a file already in this project"><option value="">Use a file already in this project…</option>${opts.map(([mid, mm]) => `<option value="${mid}">${esc(mm.name)}</option>`).join('')}</select>` : ''}
        </div>`;
    }
    case 'actions': return `<div class="row">${f.actions.map((a, i) => `<button class="btn small" data-action="${fi}:${i}">${a.label}</button>`).join('')}</div>`;
    case 'note': return `<p class="note">${f.text}</p>`;
    default: return '';
  }
}

function contentBlock(l) {
  const A = APPS[l.type];
  const d = l.data;
  return section('Content', A.fields.map((f, fi) => (!f.when || f.when(d) ? fieldHtml(f, d, fi) : '')).join(''));
}

function bindContent(l) {
  const A = APPS[l.type];
  const d = l.data;
  const typing = { coalesce: true };
  // A text layer still named after its words follows them when they change (the stage tag reads 'Text · <name>').
  const syncName = (before) => {
    const auto = textLayerName(l.type, before), now = textLayerName(l.type, d);
    if (auto && l.name === auto && now && now !== auto) { l.name = now; hooks.layers?.(); const n = $('layer-name'); if (n) n.value = now; }
  };
  A.fields.forEach((f, fi) => {
    if (f.when && !f.when(d)) return;
    const id = `fd-${f.key}`;
    switch (f.type) {
      case 'text': on(id, 'input', (e) => { const before = { ...d }; d[f.key] = e.target.value; syncName(before); changed(typing); }); break;
      case 'contact': on(id, 'input', (e) => {
        const val = e.target.value.trim(); if (!val) return;
        const i = (d.contacts || []).indexOf(d.contact);
        if (i >= 0) d.contacts[i] = val; else d.contacts?.unshift(val);
        d.contact = val; changed(typing);
      }); break;
      case 'list': on(id, 'change', (e) => { d[f.key] = e.target.value.split(',').map((s) => s.trim()).filter(Boolean); changed(); }); break;
      case 'number': on(id, 'change', (e) => { const n = parseFloat(e.target.value); if (!Number.isNaN(n)) { d[f.key] = clamp(n, f.min ?? -Infinity, f.max ?? Infinity); changed(); } }); break;
      case 'time': on(id, 'change', (e) => { d[f.key] = Math.max(0, +e.target.value || 0); changed(); }); break;
      case 'textarea': on(id, 'input', (e) => { const before = { ...d }; d[f.key] = e.target.value; syncName(before); if (f.count && $(`${id}-n`)) $(`${id}-n`).textContent = `${e.target.value.length} / ${f.count}`; changed(typing); }); break;
      case 'script': on(id, 'input', (e) => { d[f.key] = f.parse(e.target.value); changed(typing); }); break;
      case 'select': on(id, 'change', (e) => { d[f.key] = e.target.value; changed({ inspector: true }); }); break;
      case 'check': on(id, 'change', (e) => { d[f.key] = e.target.checked; changed({ inspector: true }); }); break;
      case 'color': on(id, 'input', (e) => { d[f.key] = e.target.value; changed(typing); }); break;
      case 'actions': f.actions.forEach((a, i) => {
        document.querySelector(`#insp-body [data-action="${fi}:${i}"]`)?.addEventListener('click', () => { a.run(d, S.t); changed({ inspector: true }); });
      }); break;
      default:
    }
  });
  document.querySelectorAll('#insp-body [data-now]').forEach((b) => b.addEventListener('click', () => { d[b.dataset.now] = +S.t.toFixed(2); changed({ inspector: true }); }));
  document.querySelectorAll('#insp-body [data-pick]').forEach((b) => b.addEventListener('click', () => {
    pickFile(b.dataset.accept.split(',').map((k) => `${k}/*`).join(','), async (file) => {
      try {
        const id = await addMediaFile(S.project, file);
        d[b.dataset.pick] = id;
        changed({ inspector: true });
        toast(`${file.name} added`);
      } catch { toast('That file type is not supported'); }
    });
  }));
  document.querySelectorAll('#insp-body [data-clear]').forEach((b) => b.addEventListener('click', () => { d[b.dataset.clear] = null; changed({ inspector: true }); }));
  document.querySelectorAll('#insp-body [data-reuse]').forEach((s) => s.addEventListener('change', () => { if (s.value) { d[s.dataset.reuse] = s.value; changed({ inspector: true }); } }));
}

export function pickFile(accept, cb) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = accept;
  input.addEventListener('change', () => { const f = input.files?.[0]; if (f) cb(f); });
  input.click();
}

// ---------- Window ----------

function windowBlock(l) {
  if (chromeOf(l) === 'none') return '';
  return section('Window', `${field('w-title', chromeOf(l) === 'browser' ? 'Tab title' : 'Title bar', l.title, `placeholder="${esc(windowTitle({ ...l, title: '' }, S.t))}"`)}
    <p class="note">Tip: double-click a title, address or name on the stage to edit it right there.</p>`);
}

function animateBlock(l) {
  const btn = (kind, label, dir) => `<button data-${dir}="${kind}">${label}</button>`;
  return section('Animate', `
    <div class="field"><span>Appears with</span><div class="segbar" role="group" aria-label="Appears with">${btn('pop', 'Pop', 'enter')}${btn('slide', 'Slide', 'enter')}${btn('fade', 'Fade', 'enter')}</div></div>
    <div class="field"><span>Leaves with</span><div class="segbar" role="group" aria-label="Leaves with">${btn('pop', 'Pop', 'exit')}${btn('slide', 'Slide', 'exit')}${btn('fade', 'Fade', 'exit')}</div></div>
    <p class="note">Starts at the playhead (${fmt(S.t)}).</p>${trimNote(l)}
    <div class="row"><button class="btn small" id="w-storm" title="Pile up 12 copies of this window over one second, for chaotic montage moments">Window storm</button></div>`);
}

// Shown when a window is trimmed or split: where it starts/ends, and a way back.
// "Window storm": copies of a window pop up all over the desktop in quick succession.
function windowStorm(l) {
  const P = S.project, s = layerState(l, S.t), n = 12;
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const at = P.layers.indexOf(l);
  for (let i = 0; i < n; i++) {
    const copy = JSON.parse(JSON.stringify(l));
    copy.id = newId(l.type);
    copy.name = `${l.name} ${i + 1}`;
    delete copy.in; delete copy.out;
    const t0 = S.t + i * (1 / n);
    const x = Math.round(rnd() * (P.width - s.w * 0.8) - s.w * 0.1), y = Math.round(rnd() * (P.height - s.h * 0.7) - s.h * 0.1);
    copy.keys = [{ t: t0, ease: 'smooth', x, y, w: s.w, h: s.h, opacity: 1, scale: 1 }];
    applyEnter(copy, t0, 'pop');
    P.layers.splice(at + 1 + i, 0, copy);
  }
  changed({ structure: true });
  toast(`${n} copies pile up from ${fmt(S.t)}. Ctrl+Z removes them`);
}

function trimNote(l) {
  if (!l || (l.in == null && l.out == null)) return '';
  const r = layerRange(l, S.project.duration);
  return `<div class="anim-row trim-row"><span>Shown</span><span class="trim-range">${fmt(r.start)} to ${fmt(r.end)}</span>
    <button class="btn small" id="trim-reset" title="Show the whole window again">Undo trim</button></div>`;
}

function cameraBlock() {
  return section('Camera', `<div class="field"><span>Camera into this window</span><div class="segbar" role="group" aria-label="Camera into this window">
    <button data-trans="whip" title="A fast whip pan from the current shot to this window, with motion blur">Whip</button>
    <button data-trans="cut" title="A hard cut from the current shot to this window">Cut</button>
    <button data-shot="medium" title="A smooth glide to frame this window">Glide</button>
    <button data-shot="close" title="A close-up on this window">Close-up</button></div></div>
    <div class="row"><button class="btn small" data-shot="wide">Whole desktop</button>
    <button class="btn small" data-shot="mouse">Move mouse here</button></div>
    <p class="note">Each adds a keyframe at the playhead.</p>`);
}

function bindWindow(l) {
  const typing = { coalesce: true };
  on('layer-name', 'input', (e) => { l.name = e.target.value || l.name; changed(typing); hooks.layers(); });
  on('w-title', 'input', (e) => { l.title = e.target.value; changed(typing); });
  on('trim-reset', 'click', () => { delete l.in; delete l.out; changed({ inspector: true }); toast('Whole window shown again'); });
  document.querySelectorAll('#insp-body [data-enter]').forEach((b) => b.addEventListener('click', () => {
    if (l.in != null && l.in > S.t) delete l.in; // the new entrance decides when it appears
    applyEnter(l, S.t, b.dataset.enter); changed({ inspector: true }); toast('Entrance added');
  }));
  document.querySelectorAll('#insp-body [data-exit]').forEach((b) => b.addEventListener('click', () => {
    if (l.out != null && l.out < S.t + 0.5) delete l.out; // the new exit decides when it leaves
    applyExit(l, S.t, b.dataset.exit); changed({ inspector: true }); toast('Exit added');
  }));
  document.querySelectorAll('#insp-body [data-trans]').forEach((b) => b.addEventListener('click', () => {
    const s = layerState(l, S.t);
    hooks.view(true);
    transitionTo({ x: s.x + (s.w * (1 - s.scale)) / 2, y: s.y + (s.h * (1 - s.scale)) / 2, w: s.w * s.scale, h: s.h * s.scale }, b.dataset.trans);
  }));
  on('w-storm', 'click', () => windowStorm(l));
  document.querySelectorAll('#insp-body [data-shot]').forEach((b) => b.addEventListener('click', () => {
    const s = layerState(l, S.t), shot = b.dataset.shot, P = S.project;
    if (shot === 'mouse') {
      upsertKey(P.cursor.keys, S.t, { x: Math.round(s.x + s.w * 0.55), y: Math.round(s.y + s.h * 0.55) }, CURSOR_PROPS);
      P.cursor.hidden = false;
      changed(); toast('Mouse keyframe added'); return;
    }
    const values = shot === 'wide'
      ? { cx: P.width / 2, cy: P.height / 2, zoom: 1 }
      : {
        cx: Math.round(s.x + s.w / 2), cy: Math.round(s.y + s.h / 2),
        zoom: +clamp(Math.min(viewSize(P).w / (s.w * (shot === 'close' ? 1.15 : 1.6)), viewSize(P).h / (s.h * (shot === 'close' ? 1.15 : 1.6))), minAutoZoom(P), 4).toFixed(2),
      };
    upsertKey(P.camera.keys, S.t, values, CAMERA_PROPS);
    hooks.view(true);
    changed();
    toast('Camera keyframe added');
  }));
  on('layer-dup', 'click', () => duplicateLayer(l));
  on('layer-del', 'click', () => { deleteLayer(l); toast('Window deleted. Ctrl+Z brings it back'); });
  bindContent(l);
}

// ---------- Mouse ----------

function mouseBlock() {
  const cur = S.project.cursor;
  const ev = [...cur.events].sort((a, b) => a.t - b.t);
  const opt = (v, l, c) => `<option value="${v}" ${String(c) === String(v) ? 'selected' : ''}>${l}</option>`;
  const rows = ev.map((e) => `<li class="ev-row${S.sel?.eventId === e.id ? ' sel' : ''}">
      <span class="ev-type">${CURSOR_EVENTS[e.type]}</span>
      <input type="number" step="0.05" min="0" id="ev-${e.id}-t" aria-label="Time (s)" value="${+e.t.toFixed(2)}">
      ${['drag', 'scroll', 'right'].includes(e.type) ? `<input type="number" step="0.1" min="0.1" id="ev-${e.id}-dur" aria-label="Length (s)" title="Length (s)" value="${+(e.dur || 0.6).toFixed(2)}">` : '<span></span>'}
      <button class="icon-btn" data-ev-go="${e.id}" title="Go to" aria-label="Go to">Go</button>
      <button class="icon-btn danger" data-ev-del="${e.id}" title="Delete" aria-label="Delete">✕</button></li>`).join('');
  return `<div class="mode-banner"><b>Mouse mode is on.</b> Click on the stage to move the pointer there at the playhead. Double-click to move <i>and</i> click.</div>`
    + section('Action at the playhead', `<div class="ev-buttons">
        ${Object.entries(CURSOR_EVENTS).map(([k, label]) => `<button class="btn small" data-ev-add="${k}">${label}</button>`).join('')}</div>
        <p class="note">For a drag or swipe, add it here, then move the playhead to its end and click on the stage where it should end.</p>`)
    + propsBlock({ keys: cur.keys, props: CURSOR_PROPS }, 'Pointer position')
    + section(`Actions (${ev.length})`, rows ? `<ul class="ev-list">${rows}</ul>` : '<p class="note">No clicks yet.</p>')
    + section('Look', `<div class="grid2">
        <div class="field"><label for="cur-size">Size</label><select id="cur-size">${opt(0.8, 'Small', cur.size)}${opt(1, 'Normal', cur.size)}${opt(1.3, 'Large', cur.size)}${opt(1.7, 'Huge', cur.size)}</select></div>
        <div class="field"><label for="cur-color">Color</label><select id="cur-color">${opt('light', 'White', cur.color || 'light')}${opt('dark', 'Black', cur.color || 'light')}</select></div>
        <div class="field"><label for="cur-click">Click effect</label><select id="cur-click">${opt('ripple', 'Ripple', cur.clickStyle)}${opt('ring', 'Yellow glow', cur.clickStyle)}${opt('none', 'None', cur.clickStyle)}</select></div>
      </div>
      <label class="check"><input type="checkbox" id="cur-hidden" ${cur.hidden ? 'checked' : ''}> Hide the mouse</label>
      <label class="check"><input type="checkbox" id="cur-sfx" ${S.project.autoSfx.clicks ? 'checked' : ''}> Play click sounds</label>`);
}

function bindMouse() {
  const cur = S.project.cursor;
  document.querySelectorAll('#insp-body [data-ev-add]').forEach((b) => b.addEventListener('click', () => {
    const type = b.dataset.evAdd;
    const t = +S.t.toFixed(2);
    const e = { id: newId('ev'), t, type };
    if (type === 'drag') {
      e.dur = 0.8;
      const p = cursorAt(cur, t);
      upsertKey(cur.keys, t, { x: Math.round(p.x), y: Math.round(p.y) }, CURSOR_PROPS);
      const end = upsertKey(cur.keys, snapTime(t + e.dur), { x: Math.round(p.x + 260), y: Math.round(p.y) }, CURSOR_PROPS);
      end.ease = 'smooth';
    }
    if (type === 'scroll') e.dur = 1.2;
    if (type === 'right') e.dur = 1.2;
    cur.events.push(e);
    cur.hidden = false;
    S.sel = { kind: 'cursor', eventId: e.id };
    changed({ inspector: true });
    toast(`${CURSOR_EVENTS[type]} added at ${fmt(t)}`);
  }));
  for (const e of cur.events) {
    on(`ev-${e.id}-t`, 'change', (ev) => { e.t = Math.max(0, +ev.target.value || 0); changed(); });
    on(`ev-${e.id}-dur`, 'change', (ev) => { e.dur = Math.max(0.1, +ev.target.value || 0.6); changed(); });
  }
  document.querySelectorAll('#insp-body [data-ev-go]').forEach((b) => b.addEventListener('click', () => {
    const e = cur.events.find((x) => x.id === b.dataset.evGo);
    S.sel = { kind: 'cursor', eventId: e.id };
    seek(e.t); hooks.timeline();
  }));
  document.querySelectorAll('#insp-body [data-ev-del]').forEach((b) => b.addEventListener('click', () => {
    cur.events = cur.events.filter((x) => x.id !== b.dataset.evDel);
    changed({ inspector: true });
  }));
  on('cur-size', 'change', (e) => { cur.size = +e.target.value; changed(); });
  on('cur-color', 'change', (e) => { cur.color = e.target.value; changed(); });
  on('cur-click', 'change', (e) => { cur.clickStyle = e.target.value; changed(); });
  on('cur-hidden', 'change', (e) => { cur.hidden = e.target.checked; changed(); });
  on('cur-sfx', 'change', (e) => { S.project.autoSfx.clicks = e.target.checked; changed(); });
}

// ---------- Captions ----------

function captionsBlock() {
  const st = S.project.captionStyle;
  const sel = selectedCaption();
  const opt = (v, label, cur) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${label}</option>`;
  const rows = S.project.captions.map((c) => `
    <li class="cap-row${sel === c ? ' sel' : ''}" data-cap="${c.id}">
      <div class="cap-times">
        <input type="number" step="0.1" min="0" id="cap-${c.id}-start" aria-label="Start (s)" value="${+c.start.toFixed(2)}">
        <span>to</span>
        <input type="number" step="0.1" min="0" id="cap-${c.id}-end" aria-label="End (s)" value="${+c.end.toFixed(2)}">
        <button class="icon-btn" data-go="${c.id}" title="Go to caption" aria-label="Go to caption">Go</button>
        <button class="icon-btn danger" data-del="${c.id}" title="Delete caption" aria-label="Delete caption">✕</button>
      </div>
      <textarea id="cap-${c.id}-text" rows="2" aria-label="Caption text">${esc(c.text)}</textarea>
    </li>`).join('');
  return section('Look', `<div class="grid2">
      <div class="field"><label for="cap-style">Style</label><select id="cap-style">
        ${opt('box', 'Red box', st.style)}${opt('clean', 'Clean subtitle', st.style)}${opt('words', 'Word by word', st.style)}</select></div>
      <div class="field"><label for="cap-pos">Position</label><select id="cap-pos">
        ${opt('bottom', 'Bottom', st.position)}${opt('center', 'Center', st.position)}${opt('top', 'Top', st.position)}</select></div>
      <div class="field"><label for="cap-size">Size</label><select id="cap-size">
        ${opt('0.8', 'Small', String(st.size))}${opt('1', 'Medium', String(st.size))}${opt('1.3', 'Large', String(st.size))}</select></div>
    </div>`)
    + section(`Captions (${S.project.captions.length})`, `
      <button class="btn small" id="cap-add">+ Add caption at playhead <kbd>C</kbd></button>
      ${rows ? `<ul class="cap-list">${rows}</ul>` : '<p class="note">No captions yet.</p>'}
      <p class="note">Drag caption blocks on the timeline to move them, drag their edges to change length, or double-click a caption on the stage to edit its text.</p>`);
}

function bindCaptions() {
  const st = S.project.captionStyle;
  on('cap-style', 'change', (e) => { st.style = e.target.value; changed(); });
  on('cap-pos', 'change', (e) => { st.position = e.target.value; changed(); });
  on('cap-size', 'change', (e) => { st.size = +e.target.value; changed(); });
  on('cap-add', 'click', () => hooks.addCaption());
  for (const c of S.project.captions) {
    const sortAndSave = () => { S.project.captions.sort((a, b) => a.start - b.start); changed(); };
    on(`cap-${c.id}-text`, 'input', (e) => { c.text = e.target.value.replace(/\s*\n\s*/g, ' '); changed({ coalesce: true }); });
    on(`cap-${c.id}-text`, 'focus', () => {
      if (S.sel?.id !== c.id) {
        S.sel = { kind: 'caption', id: c.id };
        document.querySelectorAll('.cap-row').forEach((r) => r.classList.toggle('sel', r.dataset.cap === c.id));
        if (S.t < c.start || S.t >= c.end) seek(c.start + 0.3, { refresh: false });
        hooks.timeline();
      }
    });
    on(`cap-${c.id}-start`, 'change', (e) => { delete c.wordStart; delete c.wordEnd; c.start = clamp(+e.target.value || 0, 0, c.end - 0.2); e.target.value = +c.start.toFixed(2); sortAndSave(); });
    on(`cap-${c.id}-end`, 'change', (e) => { delete c.wordStart; delete c.wordEnd; c.end = clamp(+e.target.value || 0, c.start + 0.2, S.project.duration); e.target.value = +c.end.toFixed(2); sortAndSave(); });
  }
  document.querySelectorAll('#insp-body [data-go]').forEach((b) => b.addEventListener('click', () => {
    const c = S.project.captions.find((x) => x.id === b.dataset.go);
    S.sel = { kind: 'caption', id: c.id };
    seek(c.start + 0.3); hooks.timeline();
  }));
  document.querySelectorAll('#insp-body [data-del]').forEach((b) => b.addEventListener('click', () => {
    S.project.captions = S.project.captions.filter((x) => x.id !== b.dataset.del);
    S.sel = { kind: 'captions' };
    changed({ inspector: true });
    toast('Caption deleted. Ctrl+Z brings it back');
  }));
}

// ---------- Audio ----------

export async function addAudioFile(file, track, start = S.t) {
  if (kindOf(file.type || '') !== 'audio' && kindOf(file.type || '') !== 'video') { toast('Choose an audio file (mp3, wav, m4a…)'); return null; }
  const id = await addMediaFile(S.project, file);
  const clip = { id: newId('au'), src: `media:${id}`, track, start: +start.toFixed(2), offset: 0, volume: 1, name: file.name };
  S.project.audio.push(clip);
  S.sel = { kind: 'audio', id: clip.id, track };
  changed({ inspector: true });
  toast(`${file.name} added to ${TRACK_LABEL[track]}`);
  return clip;
}

function addSfx(name) {
  const clip = { id: newId('au'), src: `sfx:${name}`, track: 'sfx', start: +S.t.toFixed(2), offset: 0, volume: 0.9, name: SFX[name] };
  S.project.audio.push(clip);
  S.sel = { kind: 'audio', id: clip.id, track: 'sfx' };
  changed({ inspector: true });
  toast(`${SFX[name]} added at ${fmt(S.t)}`);
}

function audioBlock() {
  const clip = selectedClip();
  const track = clip?.track || S.sel?.track || 'voice';
  const a = S.project.autoSfx;
  let html = '';
  if (clip) {
    const len = clipLength(clip);
    html += section(clip.name || 'Clip', `
      <div class="grid2">
        <div class="field"><label for="au-start">Starts at (s)</label><div class="inline"><input type="number" id="au-start" step="0.05" min="0" value="${+clip.start.toFixed(2)}"><button class="btn small" id="au-now">Now</button></div></div>
        <div class="field"><label for="au-len">Length (s)</label><input type="number" id="au-len" step="0.05" min="0.05" value="${+len.toFixed(2)}"></div>
        <div class="field"><label for="au-off">Skip the first (s)</label><input type="number" id="au-off" step="0.05" min="0" value="${+(clip.offset || 0).toFixed(2)}"></div>
      </div>
      <div class="field"><label for="au-vol">Volume: <span id="au-vol-val">${Math.round((clip.volume ?? 1) * 100)}%</span></label><input type="range" id="au-vol" min="0" max="1.5" step="0.05" value="${clip.volume ?? 1}"></div>
      <label class="check"><input type="checkbox" id="au-mute" ${clip.muted ? 'checked' : ''}> Mute this clip</label>
      <div class="row"><button class="btn small" id="au-go">Play from here</button><button class="btn small danger" id="au-del">Delete clip</button></div>`);
  }
  if (track === 'voice') {
    html += section('Voiceover', `
      <div class="row"><button class="btn small rec" id="vo-rec">${S.recording ? 'Stop recording' : '● Record at playhead'}</button><button class="btn small" id="vo-up">Upload audio</button></div>
      <p class="note">Recording plays the video silently so you can talk over it. Face cams and your video-call tile glow while you speak.</p>`)
      + ttsBlock();
  } else if (track === 'sfx') {
    html += section('Sound effects', `<ul class="sfx-list">${Object.entries(SFX).map(([k, label]) => `<li>
        <button class="icon-btn" data-sfx-play="${k}" title="Listen" aria-label="Listen to ${label}">▶</button><span>${label}</span>
        <button class="btn small" data-sfx-add="${k}">Add here</button></li>`).join('')}</ul>
      <div class="row"><button class="btn small" id="sfx-up">Upload your own sound</button></div>`);
  } else {
    html += section('Music', `<div class="row"><button class="btn small" id="mu-up">Upload music</button></div>
      <p class="note">Tip: lower the music volume to about 30% under a voiceover.</p>`);
  }
  html += section('Automatic sounds', `
    <label class="check"><input type="checkbox" id="auto-clicks" ${a.clicks ? 'checked' : ''}> Mouse clicks</label>
    <label class="check"><input type="checkbox" id="auto-msgs" ${a.messages ? 'checked' : ''}> Messages, emails and notifications</label>
    <label class="check"><input type="checkbox" id="auto-typing" ${a.typing ? 'checked' : ''}> Keyboard typing</label>
    <div class="field"><label for="auto-vol">Volume: <span id="auto-vol-val">${Math.round(a.volume * 100)}%</span></label><input type="range" id="auto-vol" min="0" max="1.5" step="0.05" value="${a.volume}"></div>`);
  return html;
}

function bindAudio() {
  const clip = selectedClip();
  const track = clip?.track || S.sel?.track || 'voice';
  if (clip) {
    on('au-start', 'change', (e) => { clip.start = Math.max(0, +e.target.value || 0); changed(); });
    on('au-now', 'click', () => { clip.start = +S.t.toFixed(2); changed({ inspector: true }); });
    on('au-len', 'change', (e) => { clip.dur = Math.max(0.05, +e.target.value || 0.1); changed(); });
    on('au-off', 'change', (e) => { clip.offset = Math.max(0, +e.target.value || 0); changed(); });
    on('au-vol', 'input', (e) => { clip.volume = +e.target.value; $('au-vol-val').textContent = `${Math.round(clip.volume * 100)}%`; changed({ coalesce: true }); });
    on('au-mute', 'change', (e) => { clip.muted = e.target.checked; changed(); });
    on('au-go', 'click', () => { seek(clip.start); hooks.play(); });
    on('au-del', 'click', () => { S.project.audio = S.project.audio.filter((c) => c !== clip); S.sel = { kind: 'audio', track }; changed({ inspector: true }); toast('Clip deleted. Ctrl+Z brings it back'); });
  }
  on('vo-rec', 'click', () => hooks.toggleRecording());
  if (track === 'voice') bindTts();
  on('vo-up', 'click', () => pickFile('audio/*', (f) => addAudioFile(f, 'voice')));
  on('sfx-up', 'click', () => pickFile('audio/*', (f) => addAudioFile(f, 'sfx')));
  on('mu-up', 'click', () => pickFile('audio/*', (f) => addAudioFile(f, 'music')));
  document.querySelectorAll('#insp-body [data-sfx-play]').forEach((b) => b.addEventListener('click', () => previewSfx(b.dataset.sfxPlay)));
  document.querySelectorAll('#insp-body [data-sfx-add]').forEach((b) => b.addEventListener('click', () => addSfx(b.dataset.sfxAdd)));
  const a = S.project.autoSfx;
  on('auto-clicks', 'change', (e) => { a.clicks = e.target.checked; changed(); });
  on('auto-msgs', 'change', (e) => { a.messages = e.target.checked; changed(); });
  on('auto-typing', 'change', (e) => { a.typing = e.target.checked; changed(); });
  on('auto-vol', 'input', (e) => { a.volume = +e.target.value; $('auto-vol-val').textContent = `${Math.round(a.volume * 100)}%`; changed({ coalesce: true }); });
}

// ---------- Desktop / wallpaper ----------


// ---------- Look (depth of field, glass, vignette, grain) + auto camera ----------

function lookBlock() {
  const L = S.project.look;
  const slider = (id, label, v) => `<div class="field"><label for="look-${id}">${label}: <span id="look-${id}-val">${Math.round(v * 100)}%</span></label>
    <input type="range" id="look-${id}" min="0" max="1" step="0.05" value="${v}"></div>`;
  return section('Look', `<div class="grid3">${Object.entries(LOOKS).map(([k, v]) =>
      `<button class="btn small toggle" data-look="${k}" aria-pressed="${L.preset === k}">${v.label}</button>`).join('')}</div>
    ${slider('depth', 'Background blur when zoomed', L.depth)}
    ${slider('contrast', 'Contrast punch', L.contrast ?? 0)}
    ${slider('vignette', 'Vignette', L.vignette)}
    ${slider('grain', 'Film grain', L.grain)}
    <div class="field"><label for="look-chrome">Window style</label><select id="look-chrome">
      <option value="studio" ${L.chrome === 'studio' ? 'selected' : ''}>Studio: compact bar, title left</option>
      <option value="macos" ${L.chrome !== 'studio' ? 'selected' : ''}>macOS: centered title</option></select></div>
    <label class="check"><input type="checkbox" id="look-glass" ${L.glass ? 'checked' : ''}> Frosted-glass title bars (macOS style)</label>
    <label class="check"><input type="checkbox" id="look-mblur" ${L.motionBlur !== false ? 'checked' : ''}> Motion blur on fast camera moves</label>
    <p class="note">Applies to the whole video, in the preview and the export.</p>`)
    + autoCamSection();
}

function autoCamSection() {
  const on = !!S.project.camera.auto;
  const st = S.project.camera.autoStyle || 'mixed';
  const opt = (v, l) => `<option value="${v}" ${st === v ? 'selected' : ''}>${l}</option>`;
  return section('Auto camera', `<button class="btn${on ? ' on' : ''}" id="auto-cam" aria-pressed="${on}">${on ? '✦ Auto camera is on' : '✦ Turn on auto camera'}</button>
    <div class="field"><label for="auto-style">Transitions</label><select id="auto-style">
      ${opt('mixed', 'Mixed: whip pans + cuts + close-ups')}${opt('whip', 'Whip pans')}${opt('cut', 'Hard cuts + close-ups')}${opt('smooth', 'Smooth glides')}</select></div>
    <p class="note">${on
      ? 'The camera follows your windows and keeps updating as you edit: each window gets the shot when it appears, with a slow push-in, and pop-ups stay in view. Moving the camera yourself turns it off.'
      : 'Builds the camera for you and keeps it updated as you edit. Replaces the current camera keyframes; Ctrl+Z brings them back.'}</p>`);
}

export function runAutoCamera() {
  const cam = S.project.camera;
  if (cam.auto) { cam.auto = false; changed({ inspector: true }); toast('Auto camera off. The camera stays where it is'); return; }
  if (!autoCameraKeys(S.project)) { toast('Add a window first, then the camera has something to follow'); return; }
  cam.auto = true;
  hooks.view?.(true);
  changed({ inspector: true });
  toast(`Auto camera on: ${cam.keys.length} keyframes. Press Space to watch`);
}

function bindLook() {
  const L = S.project.look;
  document.querySelectorAll('#insp-body [data-look]').forEach((b) => b.addEventListener('click', () => {
    const { label, ...v } = LOOKS[b.dataset.look];
    Object.assign(L, v, { preset: b.dataset.look });
    changed({ inspector: true });
  }));
  for (const id of ['depth', 'contrast', 'vignette', 'grain']) {
    on(`look-${id}`, 'input', (e) => {
      L[id] = +e.target.value; L.preset = 'custom';
      $(`look-${id}-val`).textContent = `${Math.round(L[id] * 100)}%`;
      document.querySelectorAll('#insp-body [data-look]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      changed({ coalesce: true });
    });
  }
  on('look-glass', 'change', (e) => { L.glass = e.target.checked; L.preset = 'custom'; changed({ inspector: true }); });
  on('look-chrome', 'change', (e) => { L.chrome = e.target.value; L.preset = 'custom'; changed({ inspector: true }); });
  on('look-mblur', 'change', (e) => { L.motionBlur = e.target.checked; L.preset = 'custom'; changed({ inspector: true }); });
  on('auto-style', 'change', (e) => { S.project.camera.autoStyle = e.target.value; changed({ inspector: true }); });
  on('auto-cam', 'click', runAutoCamera);
}

function desktopBlock() {
  const wp = S.project.wallpaper;
  const tile = (attrs, label, url, on) => `<button class="wp-tile${on ? ' on' : ''}" ${attrs} title="${esc(label)}" aria-label="${esc(label)}" aria-pressed="${on}">
      <img src="${url}" alt=""><span>${esc(label)}</span></button>`;
  const presets = WALLPAPERS.filter((w) => !w.hidden || w.id === wp.kind).map((w) => tile(`data-wp="${w.id}"`, w.label,
    wallpaperThumb({ ...wp, kind: w.id, blur: 0, dim: 0 }), wp.kind === w.id)).join('');
  const images = Object.entries(S.project.media).filter(([, m]) => m.kind === 'image').map(([id, m]) =>
    tile(`data-wp-media="${id}"`, m.name, wallpaperThumb({ ...wp, kind: 'image', mediaId: id, blur: 0, dim: 0 }), wp.kind === 'image' && wp.mediaId === id)).join('');
  let options = '';
  if (wp.kind === 'solid' || wp.kind === 'studio-glow') options += `<div class="field color"><label for="wp-c1">Color</label><input type="color" id="wp-c1" value="${esc(wp.color1)}"></div>`;
  if (wp.kind === 'gradient') options += `<div class="grid2"><div class="field color"><label for="wp-c1">From</label><input type="color" id="wp-c1" value="${esc(wp.color1)}"></div>
    <div class="field color"><label for="wp-c2">To</label><input type="color" id="wp-c2" value="${esc(wp.color2)}"></div></div>`;
  if (WALLPAPERS.find((w) => w.id === wp.kind)?.seeded) options += '<div class="row"><button class="btn small" id="wp-shuffle">Shuffle this wallpaper</button></div>';
  return `<section class="group"><div class="group-title"><b>Wallpaper</b></div>
      <div class="wp-grid">${presets}</div>
      <div class="group-title"><b>Your images</b></div>
      <div class="wp-grid">${images}<button class="wp-tile wp-upload" id="wp-upload"><span class="plus">+</span><span>Upload image</span></button></div>
      ${options}
      <div class="field"><label for="wp-blur">Blur: <span id="wp-blur-val">${wp.blur}px</span></label><input type="range" id="wp-blur" min="0" max="40" step="1" value="${wp.blur}"></div>
      <div class="field"><label for="wp-dim">Darken: <span id="wp-dim-val">${Math.round(wp.dim * 100)}%</span></label><input type="range" id="wp-dim" min="0" max="0.7" step="0.05" value="${wp.dim}"></div>
      <p class="note">Blur and darken help windows stand out on busy photos.</p>
    </section>`;
}

function bindDesktop() {
  const wp = S.project.wallpaper;
  document.querySelectorAll('#insp-body [data-wp]').forEach((b) => b.addEventListener('click', () => { wp.kind = b.dataset.wp; changed({ inspector: true }); }));
  document.querySelectorAll('#insp-body [data-wp-media]').forEach((b) => b.addEventListener('click', () => { wp.kind = 'image'; wp.mediaId = b.dataset.wpMedia; changed({ inspector: true }); }));
  on('wp-upload', 'click', () => pickFile('image/*', async (file) => {
    try {
      const id = await addMediaFile(S.project, file);
      wp.kind = 'image'; wp.mediaId = id;
      changed({ inspector: true });
      toast('Wallpaper set');
    } catch { toast('Choose an image file (jpg, png, webp…)'); }
  }));
  on('wp-c1', 'input', (e) => { wp.color1 = e.target.value; changed({ coalesce: true }); });
  on('wp-c2', 'input', (e) => { wp.color2 = e.target.value; changed({ coalesce: true }); });
  on('wp-shuffle', 'click', () => { wp.seed = Math.floor(Math.random() * 9999) + 1; changed({ inspector: true }); });
  on('wp-blur', 'input', (e) => { wp.blur = +e.target.value; $('wp-blur-val').textContent = `${wp.blur}px`; changed({ coalesce: true }); });
  on('wp-dim', 'input', (e) => { wp.dim = +e.target.value; $('wp-dim-val').textContent = `${Math.round(wp.dim * 100)}%`; changed({ coalesce: true }); });
}

// ---------- Camera ----------

let moveDur = 2;

function cameraPanel() {
  const recording = isCamRecording();
  const shakes = [...S.project.camera.shakes].sort((a, b) => a.t - b.t);
  return `<div class="mode-banner cam"><b>Camera mode is on.</b> Scroll or pinch over the video to zoom the shot in or out where your pointer is. Drag to move it. Double-click a window to frame it. Every change saves a camera keyframe at the playhead.</div>`
    + autoCamSection()
    + section('Record a move', `<button class="btn rec-cam${recording ? ' on' : ''}" id="cam-rec">${recording ? '■ Stop recording' : '● Record a camera move'}</button>
      <p class="note">The video plays from the playhead while you scroll and drag. Your movement is recorded and smoothed. Press Space to stop. Moves after the recording are kept.</p>`)
    + section('Quick moves', `<div class="grid3">${Object.entries(MOVES).map(([k, l]) => `<button class="btn small" data-move="${k}">${l}</button>`).join('')}</div>
      <div class="row"><span class="note">Length</span>${[1, 2, 3, 5].map((d) => `<button class="btn small toggle" data-dur="${d}" aria-pressed="${moveDur === d}">${d}s</button>`).join('')}</div>
      <div class="row"><button class="btn small" id="cam-wide">Whole desktop here</button><button class="btn small" id="cam-shake">Camera shake here</button></div>
      <div class="row"><button class="btn small" id="cam-blur" title="The whole picture melts into blur and back, centred on the playhead">Blur transition here</button>${(S.project.camera.blurs || []).length ? `<button class="btn small" id="cam-blur-clear">Remove ${S.project.camera.blurs.length} blur transition${S.project.camera.blurs.length > 1 ? 's' : ''}</button>` : ''}</div>
      <p class="note">Moves start at the playhead (${fmt(S.t)}).</p>`)
    + propsBlock({ keys: S.project.camera.keys, props: CAMERA_PROPS }, 'Framing')
    + (shakes.length ? section(`Shakes (${shakes.length})`, `<ul class="ev-list">${shakes.map((sh) => `<li class="ev-row">
        <span class="ev-type">Shake</span>
        <input type="number" step="0.05" min="0" id="sh-${sh.id}-t" aria-label="Time (s)" value="${+sh.t.toFixed(2)}">
        <select id="sh-${sh.id}-a" aria-label="Strength">${[[0.5, 'Light'], [1, 'Medium'], [2, 'Strong']].map(([v, l]) => `<option value="${v}" ${sh.amount === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button class="icon-btn" data-sh-go="${sh.id}" title="Go to" aria-label="Go to">Go</button>
        <button class="icon-btn danger" data-sh-del="${sh.id}" title="Delete" aria-label="Delete">✕</button></li>`).join('')}</ul>`) : '')
    + section('Handheld feel', `<div class="field"><label for="cam-drift">Drift: <span id="cam-drift-val">${Math.round(S.project.camera.drift * 100)}%</span></label>
        <input type="range" id="cam-drift" min="0" max="1" step="0.05" value="${S.project.camera.drift}"></div>
        <p class="note">A slow, subtle float, like a camera held by hand. 0% is perfectly still.</p>`);
}

function bindCamera() {
  on('cam-rec', 'click', () => (isCamRecording() ? hooks.pause() : (hooks.view(true), startCamRecording())));
  document.querySelectorAll('#insp-body [data-move]').forEach((b) => b.addEventListener('click', () => addMove(b.dataset.move, moveDur)));
  document.querySelectorAll('#insp-body [data-dur]').forEach((b) => b.addEventListener('click', () => { moveDur = +b.dataset.dur; rerender(); }));
  on('cam-wide', 'click', () => { camSet({ cx: S.project.width / 2, cy: S.project.height / 2, zoom: 1 }); changed({ inspector: true }); });
  on('cam-shake', 'click', () => addShake(1, 0.5));
  on('cam-blur', 'click', () => addBlurTransition(0.8));
  on('auto-style', 'change', (e) => { S.project.camera.autoStyle = e.target.value; changed({ inspector: true }); });
  on('cam-blur-clear', 'click', () => { S.project.camera.blurs = []; changed({ inspector: true }); toast('Blur transitions removed'); });
  on('auto-cam', 'click', runAutoCamera);
  for (const sh of S.project.camera.shakes) {
    on(`sh-${sh.id}-t`, 'change', (e) => { sh.t = Math.max(0, +e.target.value || 0); changed(); });
    on(`sh-${sh.id}-a`, 'change', (e) => { sh.amount = +e.target.value; changed(); });
  }
  document.querySelectorAll('#insp-body [data-sh-go]').forEach((b) => b.addEventListener('click', () => { const sh = S.project.camera.shakes.find((x) => x.id === b.dataset.shGo); seek(sh.t); hooks.play(); }));
  document.querySelectorAll('#insp-body [data-sh-del]').forEach((b) => b.addEventListener('click', () => {
    S.project.camera.shakes = S.project.camera.shakes.filter((x) => x.id !== b.dataset.shDel); changed({ inspector: true });
  }));
}

// ---------- Render ----------

export function renderInspector() {
  const body = $('insp-body');
  const scroll = $('insp').scrollTop;
  const l = selectedLayer();
  let title = 'Inspector', html = '', subtitle = '';
  if (l) {
    title = ['sentence', 'title'].includes(l.type) ? 'Text layer' : APPS[l.type]?.label || 'Window';
    subtitle = l.name && l.name !== title ? l.name : (APPS[l.type]?.chip || '').toUpperCase();
    html = field('layer-name', 'Layer name (only you see this)', l.name)
      + windowBlock(l) + contentBlock(l) + animateBlock(l)
      + propsBlock({ keys: l.keys, props: LAYER_PROPS }, 'Position and size')
      + cameraBlock()
      + `<div class="row"><button class="btn small" id="layer-dup">Duplicate <kbd>Ctrl D</kbd></button><button class="btn small danger" id="layer-del">Delete window</button></div>`;
  } else if (S.sel?.kind === 'camera') {
    title = 'Camera';
    html = cameraPanel();
  } else if (S.sel?.kind === 'cursor') {
    title = 'Mouse';
    html = mouseBlock();
  } else if (S.sel?.kind === 'captions' || S.sel?.kind === 'caption') {
    title = 'Captions';
    html = captionsBlock();
  } else if (S.sel?.kind === 'audio') {
    title = TRACK_LABEL[selectedClip()?.track || S.sel.track] || 'Audio';
    html = audioBlock();
  } else {
    title = 'Desktop';
    html = lookBlock() + desktopBlock() + `<section class="group"><p class="note">Select a window on the stage, or a row in the timeline.</p>
      <ol class="steps">
        <li>Move the playhead to a moment.</li>
        <li>Drag or resize a window. That sets a keyframe.</li>
        <li>Move the playhead again and change it. The window animates between the two.</li>
      </ol>
      <div class="row"><button class="btn small" id="insp-add">+ Add window</button></div>
      <p class="note">You can also drop images, videos or audio files onto the stage or the timeline.</p></section>`;
  }
  $('insp-title').innerHTML = `<span>${esc(title)}</span>${subtitle ? `<small>${esc(subtitle)}</small>` : ''}`;
  body.innerHTML = html;
  $('insp').scrollTop = scroll;
  bind(l);
}

function bind(l) {
  const target = keyTarget();
  if (target) {
    document.querySelectorAll('#insp-body input[data-prop]').forEach((inp) => {
      inp.addEventListener('change', () => {
        let v = parseFloat(inp.value);
        if (Number.isNaN(v)) return;
        const prop = inp.dataset.prop;
        const limits = { w: [80, 6000], h: [50, 6000], opacity: [0, 1], scale: [0.05, 10], zoom: [0.8, 6] }[prop];
        if (limits) { v = clamp(v, ...limits); inp.value = v; }
        upsertKey(target.keys, S.t, { [prop]: v }, target.props);
        changed({ inspector: true });
      });
    });
    on('key-add', 'click', () => { upsertKey(target.keys, S.t, {}, target.props); changed({ inspector: true }); });
    on('key-ease', 'change', (e) => { const k = keyAt(target.keys, S.t); if (k) { k.ease = e.target.value; changed({ inspector: true }); } });
    on('key-del', 'click', () => { const k = keyAt(target.keys, S.t); if (k && removeKey(target.keys, k)) changed({ inspector: true }); });
  }
  on('insp-add', 'click', (e) => { e.stopPropagation(); hooks.openAddMenu(); });
  if (l) bindWindow(l);
  if (S.sel?.kind === 'cursor') bindMouse();
  if (S.sel?.kind === 'captions' || S.sel?.kind === 'caption') bindCaptions();
  if (S.sel?.kind === 'audio') bindAudio();
  if (!S.sel) { bindDesktop(); bindLook(); }
  if (S.sel?.kind === 'camera') bindCamera();
  $('cam-btn')?.setAttribute('aria-pressed', String(inCameraMode()));
  on('cam-drift', 'input', (e) => { S.project.camera.drift = +e.target.value; $('cam-drift-val').textContent = `${Math.round(+e.target.value * 100)}%`; changed({ coalesce: true }); });
}

function refreshValues() {
  const target = keyTarget();
  if (!target) return;
  const s = sample(target.keys, S.t, target.props);
  document.querySelectorAll('#insp-body input[data-prop]').forEach((inp) => {
    if (document.activeElement === inp) return;
    const p = inp.dataset.prop;
    inp.value = round(s[p] ?? 0, PROP_STEP[p] || 1);
  });
}

export function initInspector() {
  hooks.inspector = renderInspector;
  hooks.inspectorValues = refreshValues;
  hooks.focusCaption = (id) => {
    const el = $(`cap-${id}-text`);
    if (el) { el.focus(); el.select(); el.scrollIntoView({ block: 'nearest' }); }
  };
}
