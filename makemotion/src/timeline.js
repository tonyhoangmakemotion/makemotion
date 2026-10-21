// Bottom timeline: ruler, rows for camera, windows, mouse, captions and audio.
// Zoom with the +/- buttons or Ctrl+scroll; drag a window's bar to move it in time,
// drag its edges to trim it. Cutting: S splits at the playhead, Shift+drag selects a
// stretch of time and Delete cuts it out, the handle at the end of the ruler sets the length.

import { snapTime, clamp, insertCaption } from './model.js';
import { shiftLayer, CURSOR_EVENTS } from './project.js';
import { typingDuration } from './apps/draw.js';
import { APPS } from './apps/index.js';
import { getMedia, kindOf } from './media.js';
import { clipLength } from './audio.js';
import { addCommentPins } from './review.js';
import { S, hooks, $, changed, select, seek, fmt, toast } from './store.js';
import { layerRange, trimLayer, splitAt, removeTime, contentEnd } from './cut.js';

const ROW_COLOR = { camera: 'var(--cam)', layer: 'var(--win)', cursor: 'var(--cur)', captions: 'var(--cap)', audio: 'var(--aud)' };
const TRACKS = [['voice', 'Voiceover', 'vo'], ['sfx', 'Sound FX', 'sfx'], ['music', 'Music', 'mus']];
const tracksEl = () => $('tl-tracks');
let zoom = 1;
let range = null; // { a, b } stretch of time picked with Shift+drag (editor state, not saved)

function rows() {
  const P = S.project;
  const out = [{ kind: 'camera', label: 'Camera', chip: ['cam', 'cam'], keys: P.camera.keys }];
  [...P.layers].reverse().forEach((l) => out.push({ kind: 'layer', id: l.id, label: l.name, chip: ['', APPS[l.type]?.chip || l.type], keys: l.keys, layer: l }));
  out.push({ kind: 'cursor', label: 'Mouse', chip: ['cur', 'ptr'], keys: P.cursor.keys });
  out.push({ kind: 'captions', label: 'Captions', chip: ['cap', 'txt'], keys: null });
  for (const [track, label, chip] of TRACKS) out.push({ kind: 'audio', track, label, chip: ['aud', chip], keys: null });
  return out;
}

const isSelectedRow = (r) => {
  if (!S.sel) return false;
  if (r.kind === 'captions') return S.sel.kind === 'captions' || S.sel.kind === 'caption';
  if (r.kind === 'audio') {
    if (S.sel.kind !== 'audio') return false;
    const clip = S.sel.id && S.project.audio.find((c) => c.id === S.sel.id);
    return (clip?.track || S.sel.track) === r.track;
  }
  return S.sel.kind === r.kind && (r.kind !== 'layer' || S.sel.id === r.id);
};
const rowSel = (r) => (r.kind === 'layer' ? { kind: 'layer', id: r.id } : r.kind === 'audio' ? { kind: 'audio', track: r.track } : { kind: r.kind });

export function timelineKeys({ all = false } = {}) {
  const rs = rows().filter((r) => r.keys);
  const sel = rs.filter(isSelectedRow);
  return (all || !sel.length ? rs : sel).flatMap((r) => r.keys.map((key) => ({ t: key.t, key, keys: r.keys })));
}

const D = () => S.project.duration;
const pct = (t) => `${(clamp(t, 0, D()) / D()) * 100}%`;
const timeFromX = (clientX) => { const r = tracksEl().getBoundingClientRect(); return ((clientX - r.left) / r.width) * D(); };
const pxPerSec = () => tracksEl().getBoundingClientRect().width / D();

// Snap a time to the playhead or a whole/half second when within a few pixels.
function snapT(t) {
  const px = pxPerSec();
  if (Math.abs(t - S.t) * px < 7) return S.t;
  const half = Math.round(t * 2) / 2;
  if (Math.abs(t - half) * px < 4) return half;
  return snapTime(t);
}

function el(tag, cls, parent) { const e = document.createElement(tag); if (cls) e.className = cls; parent?.appendChild(e); return e; }

// Generic horizontal drag helper. onMove gets dt in seconds.
function dragX(e, target, onMove, onEnd) {
  e.stopPropagation();
  hooks.pause();
  const x0 = e.clientX;
  let moved = false;
  target.setPointerCapture(e.pointerId);
  const move = (ev) => {
    if (!moved && Math.abs(ev.clientX - x0) < 3) return;
    moved = true;
    onMove((ev.clientX - x0) / pxPerSec(), ev);
    S.dirty = true;
  };
  const up = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); onEnd(moved); };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up);
}

function render() {
  const labels = $('tl-labels'), tracks = tracksEl();
  labels.innerHTML = '<div class="ruler-pad"></div>';
  tracks.innerHTML = '';
  tracks.style.width = `${zoom * 100}%`;
  const P = S.project;

  const ruler = el('div', 'ruler', tracks);
  const pps = pxPerSec() || 50;
  const step = [0.5, 1, 2, 5, 10, 30, 60].find((s) => s * pps >= 55) || 60;
  for (let s = 0; s < P.duration; s += step) {
    const tick = el('div', 'tick', ruler);
    tick.style.left = pct(s);
    tick.textContent = step < 1 ? `${s.toFixed(1)}s` : `${s}s`;
  }

  addCommentPins(ruler, pct);

  const endH = el('div', 'end-handle', ruler);
  endH.title = 'Drag to set where the video ends. Double-click to end right after the last thing that happens';
  endH.addEventListener('pointerdown', startEndDrag);
  endH.addEventListener('dblclick', (e) => { e.stopPropagation(); fitLength(); });

  for (const r of rows()) {
    const lab = el('div', 'tl-label', labels);
    lab.setAttribute('aria-selected', String(isSelectedRow(r)));
    lab.innerHTML = `<span class="chip ${r.chip[0]}">${r.chip[1]}</span><span class="name"></span>`;
    lab.querySelector('.name').textContent = r.label;
    if (r.layer?.hidden) lab.classList.add('is-hidden');
    lab.addEventListener('click', () => select(rowSel(r)));

    const tr = el('div', `track track-${r.kind}`, tracks);
    tr.setAttribute('aria-selected', String(isSelectedRow(r)));
    tr.dataset.kind = r.kind;
    if (r.id) tr.dataset.id = r.id;
    if (r.track) tr.dataset.track = r.track;
    const color = ROW_COLOR[r.kind];

    if (r.layer) lifeBar(tr, r.layer);
    else if (r.keys && r.keys.length > 1) addSpan(tr, r.keys[0].t, r.keys[r.keys.length - 1].t, color);
    if (r.layer) addContentMarks(tr, r.layer);
    if (r.kind === 'cursor') P.cursor.events.forEach((e) => tr.appendChild(eventPill(e)));
    if (r.kind === 'camera') (P.camera.shakes || []).forEach((sh) => addMark(tr, sh.t, '#ff5f5f', `Camera shake at ${fmt(sh.t)}`));
    if (r.kind === 'camera') (P.camera.blurs || []).forEach((b) => addMark(tr, b.t, '#c9b6ff', `Blur transition at ${fmt(b.t)}`));
    if (r.kind === 'captions') { tr.title = 'Double-click to add a caption here'; P.captions.forEach((c) => tr.appendChild(captionBlock(c))); }
    if (r.kind === 'audio') {
      tr.title = 'Drop an audio file here, or double-click to choose one';
      P.audio.filter((c) => c.track === r.track).forEach((c) => tr.appendChild(clipBlock(c)));
    }
    const live = r.layer ? layerRange(r.layer, D()) : null;
    (r.keys || []).forEach((k) => {
      const d = el('div', 'diamond' + (S.selKey === k ? ' sel' : ''), tr);
      if (live && (k.t < live.start - 1e-3 || k.t > live.end + 1e-3)) { d.classList.add('outside'); d.title = `Keyframe at ${fmt(k.t)}, in the trimmed-away part`; }
      d.style.left = pct(k.t); d.style.background = color;
      d.title ||= `Keyframe at ${fmt(k.t)}. Drag to move, Delete to remove`;
      d.addEventListener('pointerdown', (e) => startKeyDrag(e, r, k));
    });
  }

  if (range) drawRange(tracks);
  const ph = el('div', 'playhead', tracks);
  ph.id = 'playhead';
  ph.style.left = pct(S.t);
  $('zoom-label').textContent = `${Math.round(zoom * 100)}%`;
}

function addSpan(tr, a, b, color, cls = '') {
  const s = el('div', `span ${cls}`, tr);
  s.style.left = pct(a); s.style.width = `calc(${pct(b)} - ${pct(a)})`; s.style.background = color;
  return s;
}
function addMark(tr, t, color, title = '') {
  const m = el('div', 'mark', tr);
  m.style.left = pct(t); m.style.background = color;
  if (title) m.title = title;
}
function addContentMarks(tr, l) {
  const d = l.data;
  const typing = (start, text, cps) => addSpan(tr, start, start + typingDuration(text || '', cps || 20), '#e2b340', 'typing');
  if (l.type === 'chat' || l.type === 'phone') d.messages.filter((m) => m.from !== 'sep').forEach((m) => addMark(tr, m.t, m.from === 'me' ? '#6f9cff' : '#d8d8de', `${m.from === 'me' ? 'You' : 'Them'}: ${m.text}`));
  if (l.type === 'code') typing(d.start, d.code, d.cps);
  if (l.type === 'notes') typing(d.start, d.text, d.cps);
  if (l.type === 'browser' && d.mode !== 'article') { typing(d.queryStart, d.query, d.cps); addMark(tr, d.resultsAt, '#ffffff', 'Results load'); }
  if (l.type === 'terminal') d.lines.forEach((ln) => addMark(tr, ln.t, ln.kind === 'cmd' ? '#e2b340' : '#9aa0a6', ln.text));
  if (l.type === 'email') { addMark(tr, d.arriveAt, '#ffffff', 'Email arrives'); addMark(tr, d.openAt, '#6f9cff', 'Email opens'); }
  if (l.type === 'map') { typing(d.queryStart, d.query, d.cps); addMark(tr, d.pinAt, '#e8453c', 'Pin drops'); }
}

// A window's lifetime bar. Drag it to move the whole window (and everything in it) in time,
// drag an edge to trim where it appears or disappears. Trims keep the content, so dragging back restores it.
function lifeBar(tr, l) {
  const range0 = layerRange(l, D());
  if (l.in != null || l.out != null) {
    const ghost = el('div', 'lifeghost', tr);
    ghost.style.left = pct(range0.first); ghost.style.width = `calc(${pct(range0.natural)} - ${pct(range0.first)})`;
  }
  const bar = el('div', 'lifebar' + (S.sel?.id === l.id ? ' sel' : ''), tr);
  bar.innerHTML = '<span class="grip l" title="Drag to trim the start"></span><span class="grip r" title="Drag to trim the end"></span>';
  const place = () => {
    const r = layerRange(l, D());
    bar.style.left = pct(r.start); bar.style.width = `calc(${pct(r.end)} - ${pct(r.start)})`;
    bar.classList.toggle('open', r.open);
    bar.classList.toggle('cut-l', l.in != null);
    bar.classList.toggle('cut-r', l.out != null);
  };
  place();
  bar.title = 'Drag to move this window in time. Drag an edge to trim it';
  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const mode = e.target.classList.contains('l') ? 'start' : e.target.classList.contains('r') ? 'end' : 'move';
    if (S.sel?.id !== l.id) { S.sel = { kind: 'layer', id: l.id }; hooks.layers(); hooks.inspector(); }
    const r0 = layerRange(l, D());
    if (mode !== 'move') {
      const edge0 = mode === 'start' ? r0.start : r0.end;
      dragX(e, bar, (dt) => { trimLayer(l, mode, snapT(edge0 + dt), D()); place(); }, (moved) => {
        if (moved) {
          const r = layerRange(l, D());
          changed({ inspector: true });
          toast(mode === 'start' ? `Starts at ${fmt(r.start)}` : `Ends at ${fmt(r.end)}`);
        }
      });
      return;
    }
    const first = r0.start;
    let applied = 0;
    dragX(e, bar, (dt) => {
      const want = clamp(snapT(first + dt) - first, -Math.min(first, l.keys[0].t), D() - first - 0.1);
      shiftLayer(l, want - applied);
      applied = want;
      place();
    }, (moved) => {
      if (moved && Math.abs(applied) > 1e-3) { changed({ inspector: true }); toast(`Moved ${applied > 0 ? '+' : ''}${applied.toFixed(2)}s`); }
      else if (!moved) { seek(timeFromX(e.clientX)); render(); }
    });
  });
}

// ---------- Cutting ----------

function drawRange(tracks) {
  const box = el('div', 'tl-range', tracks);
  box.id = 'tl-range';
  const btn = el('button', 'range-cut', box);
  btn.type = 'button';
  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
  btn.addEventListener('click', cutRange);
  placeRange();
}
function placeRange() {
  const box = $('tl-range');
  if (!box || !range) return;
  box.style.left = pct(range.a); box.style.width = `calc(${pct(range.b)} - ${pct(range.a)})`;
  box.querySelector('.range-cut').textContent = `Cut out ${(range.b - range.a).toFixed(1)}s`;
  box.querySelector('.range-cut').title = `Remove ${fmt(range.a)} to ${fmt(range.b)} and close the gap (Delete)`;
}
function syncCutButtons() {
  const b = $('cut-range-btn');
  if (b) b.disabled = !range;
}
export const hasRange = () => !!range;
export function clearRange() { if (!range) return false; range = null; syncCutButtons(); render(); return true; }

export function splitHere() {
  hooks.pause();
  const { count, sel, outside } = splitAt(S.project, S.sel, S.t);
  if (!count) {
    toast(outside ? 'Move the playhead inside the selected item to split it' : 'Nothing to split at the playhead');
    return;
  }
  if (sel) S.sel = sel;
  changed({ structure: true });
  toast(count === 1 ? `Split at ${fmt(S.t)}` : `Split ${count} items at ${fmt(S.t)}`);
}

export function cutRange() {
  if (!range) { toast('Shift+drag on the timeline to pick the part to cut out'); return; }
  hooks.pause();
  const { a, b } = range;
  const d = removeTime(S.project, a, b);
  range = null;
  syncCutButtons();
  if (!d) { render(); return; }
  if (S.sel?.kind === 'layer' && !S.project.layers.some((l) => l.id === S.sel.id)) S.sel = null;
  if (S.sel?.kind === 'caption' && !S.project.captions.some((c) => c.id === S.sel.id)) S.sel = { kind: 'captions' };
  if (S.sel?.kind === 'audio' && S.sel.id && !S.project.audio.some((c) => c.id === S.sel.id)) S.sel = { kind: 'audio', track: S.sel.track };
  S.selKey = null;
  seek(Math.min(a, S.project.duration), { refresh: false });
  changed({ structure: true });
  hooks.project();
  toast(`Cut out ${d.toFixed(1)}s. The video is now ${S.project.duration.toFixed(1)}s. Ctrl+Z brings it back`);
}

function setLength(len, message) {
  const P = S.project;
  len = Math.round(clamp(len, 1, 600) * 10) / 10;
  if (Math.abs(len - P.duration) < 0.01) { toast(`The video is already ${len}s`); return; }
  P.duration = len;
  if (range) { range.b = Math.min(range.b, len); if (range.b - range.a < 0.05) range = null; syncCutButtons(); }
  seek(Math.min(S.t, len), { refresh: false });
  changed({ inspector: true });
  hooks.project();
  toast(message || `The video is now ${len}s`);
}
export function endHere() {
  if (S.t < 1) { toast('Move the playhead to where the video should end'); return; }
  setLength(S.t, `The video now ends at ${fmt(S.t)}. Everything after it is kept, drag the end handle to bring it back`);
}
export function fitLength() {
  const end = contentEnd(S.project);
  if (end <= 0) { toast('Nothing in the video yet'); return; }
  setLength(Math.ceil((end + 0.5) * 10) / 10, null);
}

// Drag the handle at the end of the ruler to make the video shorter or longer.
function startEndDrag(e) {
  if (e.button !== 0) return;
  e.stopPropagation(); e.preventDefault();
  hooks.pause();
  const handle = e.currentTarget;
  handle.setPointerCapture(e.pointerId);
  const D0 = D(), pps = pxPerSec(), x0 = e.clientX;
  const ghost = el('div', 'end-ghost', tracksEl());
  const label = el('div', 'end-label', ghost);
  let len = D0;
  const show = () => {
    const w = len < D0 ? `${((D0 - len) / D0) * 100}%` : '0px';
    ghost.style.width = w;
    label.textContent = `${len.toFixed(1)}s`;
  };
  const move = (ev) => {
    let t = D0 + (ev.clientX - x0) / pps;
    if (Math.abs(t - S.t) * pps < 7) t = S.t;
    len = clamp(Math.round(t * 10) / 10, 1, 600);
    show();
  };
  const up = () => {
    handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up);
    ghost.remove();
    if (Math.abs(len - D0) >= 0.05) setLength(len);
  };
  show();
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
}

// ---------- Caption blocks ----------

function captionBlock(c) {
  const b = el('div', 'capblock' + (S.sel?.kind === 'caption' && S.sel.id === c.id ? ' sel' : ''));
  b.style.left = pct(c.start); b.style.width = `calc(${pct(c.end)} - ${pct(c.start)})`;
  b.innerHTML = '<span class="grip l"></span><span class="txt"></span><span class="grip r"></span>';
  b.querySelector('.txt').textContent = c.text;
  b.title = `${c.text} (${c.start.toFixed(1)}s to ${c.end.toFixed(1)}s)`;
  b.addEventListener('pointerdown', (e) => {
    const mode = e.target.classList.contains('l') ? 'start' : e.target.classList.contains('r') ? 'end' : 'move';
    const s0 = c.start, e0 = c.end, len = e0 - s0, w0 = c.wordStart, w1 = c.wordEnd;
    dragX(e, b, (dt) => {
      if (mode !== 'move') { delete c.wordStart; delete c.wordEnd; }
      if (mode === 'move') {
        c.start = clamp(snapT(s0 + dt), 0, D() - len); c.end = +(c.start + len).toFixed(3);
        if (w0 != null) { c.wordStart = +(w0 + c.start - s0).toFixed(3); c.wordEnd = +(w1 + c.start - s0).toFixed(3); }
      }
      else if (mode === 'start') c.start = clamp(snapT(s0 + dt), 0, c.end - 0.2);
      else c.end = clamp(snapT(e0 + dt), c.start + 0.2, D());
      b.style.left = pct(c.start); b.style.width = `calc(${pct(c.end)} - ${pct(c.start)})`;
    }, (moved) => {
      S.sel = { kind: 'caption', id: c.id };
      if (moved) { S.project.captions.sort((a, z) => a.start - z.start); changed({ inspector: true }); }
      else { seek(Math.min(c.start + 0.3, c.end - 0.05), { refresh: false }); hooks.layers(); hooks.inspector(); render(); hooks.focusCaption(c.id); }
    });
  });
  return b;
}

// ---------- Mouse action pills ----------

function eventPill(ev) {
  const long = ['drag', 'scroll', 'right'].includes(ev.type);
  const p = el('div', `evpill ev-${ev.type}` + (S.sel?.eventId === ev.id ? ' sel' : ''));
  p.style.left = pct(ev.t);
  if (long) p.style.width = `calc(${pct(ev.t + (ev.dur || 0.6))} - ${pct(ev.t)})`;
  p.textContent = { click: '●', double: '●●', right: 'R', drag: 'drag', scroll: 'scroll' }[ev.type];
  p.title = `${CURSOR_EVENTS[ev.type]} at ${fmt(ev.t)}. Drag to move`;
  p.addEventListener('pointerdown', (e) => {
    const t0 = ev.t;
    dragX(e, p, (dt) => { ev.t = clamp(snapT(t0 + dt), 0, D()); p.style.left = pct(ev.t); if (long) p.style.width = `calc(${pct(ev.t + (ev.dur || 0.6))} - ${pct(ev.t)})`; }, (moved) => {
      S.sel = { kind: 'cursor', eventId: ev.id };
      if (moved) changed({ inspector: true });
      else { seek(ev.t, { refresh: false }); hooks.inspector(); render(); }
    });
  });
  return p;
}

// ---------- Audio clips ----------

function clipBlock(c) {
  const len = clipLength(c);
  const b = el('div', `clip track-${c.track}` + (S.sel?.id === c.id ? ' sel' : '') + (c.muted ? ' muted' : ''));
  b.style.left = pct(c.start); b.style.width = `calc(${pct(c.start + len)} - ${pct(c.start)})`;
  b.innerHTML = '<canvas class="wave"></canvas><span class="grip l"></span><span class="txt"></span><span class="grip r"></span>';
  b.querySelector('.txt').textContent = c.name || 'Clip';
  b.title = `${c.name || 'Clip'} (${c.start.toFixed(1)}s, ${len.toFixed(1)}s long). Drag to move, drag edges to trim`;
  requestAnimationFrame(() => drawWave(b.querySelector('.wave'), c, len));
  b.addEventListener('pointerdown', (e) => {
    const mode = e.target.classList.contains('l') ? 'start' : e.target.classList.contains('r') ? 'end' : 'move';
    const s0 = c.start, o0 = c.offset || 0, l0 = len;
    const src = c.src.startsWith('media:') ? getMedia(c.src.slice(6)) : null;
    const maxLen = src?.duration ? src.duration - o0 : Infinity;
    dragX(e, b, (dt) => {
      if (mode === 'move') c.start = clamp(snapT(s0 + dt), 0, D() - 0.05);
      else if (mode === 'end') c.dur = clamp(snapT(s0 + l0 + dt) - s0, 0.05, maxLen);
      else { const d = clamp(dt, -o0, l0 - 0.05); c.start = +(s0 + d).toFixed(3); c.offset = +(o0 + d).toFixed(3); c.dur = +(l0 - d).toFixed(3); }
      const nl = clipLength(c);
      b.style.left = pct(c.start); b.style.width = `calc(${pct(c.start + nl)} - ${pct(c.start)})`;
    }, (moved) => {
      S.sel = { kind: 'audio', id: c.id, track: c.track };
      if (moved) changed({ inspector: true });
      else { hooks.layers(); hooks.inspector(); render(); }
    });
  });
  return b;
}

function drawWave(cv, c, len) {
  if (!cv?.isConnected) return;
  const r = cv.getBoundingClientRect();
  cv.width = Math.max(1, Math.round(r.width)); cv.height = Math.max(1, Math.round(r.height));
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,0.55)';
  const m = c.src.startsWith('media:') ? getMedia(c.src.slice(6)) : null;
  const mid = cv.height / 2;
  for (let x = 0; x < cv.width; x += 2) {
    let v;
    if (m?.peaks) {
      const time = (c.offset || 0) + (x / cv.width) * len;
      v = m.peaks[Math.min(m.peaks.length - 1, Math.floor((time / m.duration) * m.peaks.length))] || 0;
    } else v = c.src.startsWith('sfx:') ? Math.max(0, 1 - x / cv.width) * 0.8 : 0.1;
    const hh = Math.max(1, v * mid * 0.95);
    g.fillRect(x, mid - hh, 1.5, hh * 2);
  }
}

// ---------- Keyframe drag ----------

function startKeyDrag(e, row, key) {
  const d = e.currentTarget;
  if (!isSelectedRow(row)) { S.sel = rowSel(row); hooks.layers(); }
  S.selKey = key;
  document.querySelectorAll('.diamond.sel').forEach((x) => x.classList.remove('sel'));
  d.classList.add('sel');
  const t0 = key.t;
  dragX(e, d, (dt) => {
    const t = clamp(snapT(t0 + dt), 0, D());
    if (row.keys.some((k) => k !== key && Math.abs(k.t - t) < 1e-4)) return;
    key.t = t;
    row.keys.sort((a, b) => a.t - b.t);
    d.style.left = pct(t);
  }, (moved) => {
    if (moved) changed({ inspector: true });
    else { seek(key.t); render(); }
  });
}

// ---------- Zoom ----------

function setZoom(z, anchorClientX) {
  const scroller = $('tl-scroll');
  const r = tracksEl().getBoundingClientRect();
  const anchorT = anchorClientX != null ? timeFromX(anchorClientX) : S.t;
  zoom = clamp(z, 1, 20);
  render();
  const nr = tracksEl().getBoundingClientRect();
  const sx = scroller.getBoundingClientRect().left;
  const anchorX = anchorClientX != null ? anchorClientX - sx : (r.width ? ((S.t / D()) * r.width) - scroller.scrollLeft : 0);
  scroller.scrollLeft = (anchorT / D()) * nr.width - anchorX;
}

function followPlayhead() {
  if (zoom <= 1) return;
  const scroller = $('tl-scroll');
  const w = tracksEl().getBoundingClientRect().width;
  const x = (S.t / D()) * w;
  if (x < scroller.scrollLeft + 20 || x > scroller.scrollLeft + scroller.clientWidth - 40) scroller.scrollLeft = x - scroller.clientWidth * 0.2;
}

// ---------- Init ----------

export function initTimeline() {
  hooks.timeline = render;
  hooks.playhead = () => {
    const ph = $('playhead');
    if (ph) ph.style.left = pct(S.t);
    if (S.playing) followPlayhead();
  };
  const tracks = tracksEl();
  tracks.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.end-handle, .range-cut')) return;
    // Shift+drag picks a stretch of time anywhere, even starting on a clip or caption.
    if (e.shiftKey) {
      e.stopPropagation(); e.preventDefault();
      hooks.pause();
      const a0 = clamp(snapT(timeFromX(e.clientX)), 0, D());
      range = { a: a0, b: a0 };
      render();
      tracks.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const t = clamp(snapT(timeFromX(ev.clientX)), 0, D());
        range = { a: Math.min(a0, t), b: Math.max(a0, t) };
        placeRange();
      };
      const up = () => {
        tracks.removeEventListener('pointermove', move); tracks.removeEventListener('pointerup', up);
        if (range.b - range.a < 0.05) range = null;
        else toast(`${(range.b - range.a).toFixed(1)}s picked. Delete or "Cut out" removes it, Esc cancels`);
        syncCutButtons();
        render();
      };
      tracks.addEventListener('pointermove', move);
      tracks.addEventListener('pointerup', up);
      return;
    }
  }, true);
  tracks.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.diamond, .capblock, .clip, .evpill, .lifebar, .end-handle, .range-cut')) return;
    hooks.pause();
    if (range) { range = null; syncCutButtons(); render(); }
    const tr = e.target.closest('.track');
    if (tr) {
      const r = rows().find((x) => x.kind === tr.dataset.kind && (x.kind !== 'layer' || x.id === tr.dataset.id) && (x.kind !== 'audio' || x.track === tr.dataset.track));
      if (r && !isSelectedRow(r)) select(rowSel(r));
    }
    seek(timeFromX(e.clientX), { refresh: false });
    tracks.setPointerCapture(e.pointerId);
    const move = (ev) => seek(timeFromX(ev.clientX), { refresh: false });
    const up = () => { tracks.removeEventListener('pointermove', move); tracks.removeEventListener('pointerup', up); hooks.inspector(); };
    tracks.addEventListener('pointermove', move);
    tracks.addEventListener('pointerup', up);
  });
  tracks.addEventListener('dblclick', (e) => {
    const tr = e.target.closest('.track');
    if (!tr || e.target.closest('.capblock, .clip, .evpill, .diamond')) return;
    if (tr.dataset.kind === 'captions') {
      const cap = insertCaption(S.project, timeFromX(e.clientX));
      S.sel = { kind: 'caption', id: cap.id };
      seek(cap.start + 0.3, { refresh: false });
      changed({ structure: true });
      hooks.focusCaption(cap.id);
    } else if (tr.dataset.kind === 'audio') {
      seek(timeFromX(e.clientX), { refresh: false });
      hooks.pickAudio(tr.dataset.track);
    }
  });
  // Drop audio/images/videos onto the timeline
  tracks.addEventListener('dragover', (e) => { e.preventDefault(); tracks.classList.add('drop'); });
  tracks.addEventListener('dragleave', () => tracks.classList.remove('drop'));
  tracks.addEventListener('drop', (e) => {
    e.preventDefault(); tracks.classList.remove('drop');
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    const t = snapTime(clamp(timeFromX(e.clientX), 0, D()));
    seek(t, { refresh: false });
    const tr = e.target.closest('.track');
    const kind = kindOf(f.type || '');
    if (kind === 'audio') hooks.addAudioFile(f, tr?.dataset.track || 'voice', t);
    else if (kind === 'image' || kind === 'video') hooks.addMediaWindow(f);
    else toast('Drop an audio, image or video file');
  });

  $('split-btn').addEventListener('click', splitHere);
  $('cut-range-btn').addEventListener('click', cutRange);
  $('end-here-btn').addEventListener('click', endHere);
  $('fit-length-btn').addEventListener('click', fitLength);
  syncCutButtons();

  $('zoom-in').addEventListener('click', () => setZoom(zoom * 1.5));
  $('zoom-out').addEventListener('click', () => setZoom(zoom / 1.5));
  $('zoom-fit').addEventListener('click', () => setZoom(1));
  $('tl-scroll').addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    setZoom(zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX);
  }, { passive: false });
  new ResizeObserver(() => render()).observe($('tl-scroll'));

  // Drag the bar above the timeline to resize it. Remembered in this browser.
  const app = document.querySelector('.app');
  try { const h = localStorage.getItem('finischd.tlHeight'); if (h) app.style.setProperty('--tl-h', `${h}px`); } catch { /* storage unavailable */ }
  $('tl-resize').addEventListener('pointerdown', (e) => {
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const y0 = e.clientY, h0 = $('tl-scroll').closest('.timeline').getBoundingClientRect().height;
    const move = (ev) => {
      const h = clamp(h0 - (ev.clientY - y0), 140, window.innerHeight * 0.6);
      app.style.setProperty('--tl-h', `${Math.round(h)}px`);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up);
      try { localStorage.setItem('finischd.tlHeight', parseInt(app.style.getPropertyValue('--tl-h'), 10)); } catch { /* ignore */ }
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}
