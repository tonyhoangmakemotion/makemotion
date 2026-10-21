// MakeMotion editor entry: the stage (select, drag, snap, inline edit),
// playback and keyboard shortcuts. Panels live in their own modules.

import {
  upsertKey, removeKey, clamp, snapTime, LAYER_PROPS, CAMERA_PROPS, CURSOR_PROPS, insertCaption,
} from './model.js';
import {
  renderFrame, cameraAt, layerState, layerVisible, editRegions, windowTitle, activeCaption, captionLayout,
} from './render.js';
import {
  S, hooks, $, initProject, changed, select, seek, fmt, toast, undo, redo, selectedLayer, isTyping,
} from './store.js';
import { initPanels, duplicateLayer, deleteLayer, addLayer, openAddMenu } from './panels.js';
import { initInspector, addAudioFile, pickFile } from './inspector.js';
import { addMediaFile, kindOf, syncVideos, pauseAllVideos, onMediaReady } from './media.js';
import { startPlayback, stopPlayback, startRecording, audioContext } from './audio.js';
import { APPS } from './apps/index.js';
import { outSize, viewSize, SAFE_AREAS } from './format.js';
import { initTimeline, timelineKeys , splitHere, cutRange, hasRange, clearRange } from './timeline.js';
import { initIO } from './io.js';
import { initReview } from './review.js';
import { initAI } from './ai.js';
import { initScenes } from './scenes.js';
import { initPreview, openPreview, isPreviewOpen, drawPreview } from './preview.js';
import { inCameraMode, isCamRecording, camZoomAt, camPanBy, camSet, camFrame, camTick, stopCamRecording, CAM_MIN, CAM_MAX } from './camera.js';

initProject();

// ---------- Stage ----------

const canvas = $('stage');
const ctx = canvas.getContext('2d');
let worldMatrix = new DOMMatrix();
let baseMatrix = new DOMMatrix();

// Stage view zoom (only changes how you look at the stage, never the video).
// z = zoom factor; x/y = pan offset in canvas pixels.
const view = { z: 1, x: 0, y: 0 };

function fitStage() {
  const box = $('stage-box').getBoundingClientRect();
  const { W: OW, H: OH } = outSize(S.project), ar = OW / OH;
  let w = box.width - 24, h = w / ar;
  if (h > box.height - 24) { h = box.height - 24; w = h * ar; }
  canvas.style.width = `${Math.max(80, w)}px`;
  canvas.style.height = `${Math.max(45, h)}px`;
  closeInlineEditor(true);
}
new ResizeObserver(fitStage).observe($('stage-box'));

// Canvas pixels per world unit right now (camera zoom x stage zoom).
const viewZoom = () => Math.hypot(worldMatrix.a, worldMatrix.b) || 1;

function scaledRect(s) {
  const w = s.w * s.scale, h = s.h * s.scale;
  return { x: s.x + (s.w - w) / 2, y: s.y + (s.h - h) / 2, w, h };
}
// Map a rect in a window's unscaled coords through the window's scale.
function throughScale(r, s) {
  const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
  return { x: cx + (r.x - cx) * s.scale, y: cy + (r.y - cy) * s.scale, w: r.w * s.scale, h: r.h * s.scale };
}

function draw() {
  const p = S.project;
  const { W: OW, H: OH } = outSize(p);
  if (canvas.width !== OW || canvas.height !== OH) { canvas.width = OW; canvas.height = OH; fitStage(); }
  // Whole-desktop view: the desktop fitted into the frame with a 5% margin.
  const fitS = Math.min(OW / p.width, OH / p.height) * 0.9;
  const modeBase = S.cameraView ? new DOMMatrix() : new DOMMatrix().translate((OW - p.width * fitS) / 2, (OH - p.height * fitS) / 2).scale(fitS);
  baseMatrix = new DOMMatrix().translate(view.x, view.y).scale(view.z).multiply(modeBase);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  worldMatrix = renderFrame(ctx, p, S.t, { camera: S.cameraView, base: baseMatrix });

  ctx.save();
  ctx.setTransform(worldMatrix);
  const px = 1 / viewZoom();

  if (!S.cameraView) {
    const c = cameraAt(p, S.t);
    const { w: fw, h: fh } = viewSize(p, c.zoom);
    ctx.setLineDash([16 * px, 10 * px]);
    ctx.strokeStyle = '#e48c42'; ctx.lineWidth = 3 * px;
    ctx.strokeRect(c.cx - fw / 2, c.cy - fh / 2, fw, fh);
    ctx.setLineDash([]);
    ctx.fillStyle = '#e48c42';
    ctx.font = `600 ${22 * px}px Geist, sans-serif`;
    ctx.fillText(`Camera ${c.zoom.toFixed(2)}×`, c.cx - fw / 2, c.cy - fh / 2 - 10 * px);
  }

  // Snap guides
  ctx.strokeStyle = '#ff5fd2'; ctx.lineWidth = 2 * px;
  for (const g of S.guides) {
    ctx.beginPath();
    if (g.x !== undefined) { ctx.moveTo(g.x, -2000); ctx.lineTo(g.x, p.height + 2000); }
    else { ctx.moveTo(-2000, g.y); ctx.lineTo(p.width + 2000, g.y); }
    ctx.stroke();
  }

  const layer = selectedLayer();
  if (layer && layerVisible(layer, S.t) && !layer.hidden) {
    const s = layerState(layer, S.t);
    const r = scaledRect(s);
    const ACC = '#7c5cff';
    ctx.strokeStyle = ACC; ctx.lineWidth = 3 * px;
    ctx.strokeRect(r.x - 3 * px, r.y - 3 * px, r.w + 6 * px, r.h + 6 * px);
    // Corner handles: white squares with an accent edge (the bottom-right one resizes).
    const hs = 16 * px;
    for (const [hx, hy] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]) {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
      ctx.strokeStyle = ACC; ctx.lineWidth = 2.5 * px; ctx.strokeRect(hx - hs / 2, hy - hs / 2, hs, hs);
    }
    // Name tag under the selection: "Type · name".
    const kind = APPS[layer.type]?.label || layer.type;
    const tag = layer.name && layer.name !== kind ? `${kind} · ${layer.name}` : kind;
    ctx.font = `500 ${22 * px}px 'Geist Mono', monospace`;
    const tw = ctx.measureText(tag).width, th = 36 * px, ty = r.y + r.h + 14 * px;
    ctx.fillStyle = ACC;
    ctx.beginPath(); ctx.roundRect(r.x, ty, tw + 24 * px, th, 7 * px); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'middle';
    ctx.fillText(tag, r.x + 12 * px, ty + th / 2 + 1 * px);
    ctx.textBaseline = 'alphabetic';
    // Hovered editable region
    if (hoverRegion && hoverRegion.layer === layer) {
      const rr = throughScale(hoverRegion.rect, s);
      ctx.strokeStyle = 'rgba(196,178,255,0.95)'; ctx.lineWidth = 2 * px;
      ctx.strokeRect(rr.x, rr.y, rr.w, rr.h);
    }
  }
  ctx.restore();
  if (S.cameraView && S.safeArea && SAFE_AREAS[S.safeArea]) drawSafeArea(SAFE_AREAS[S.safeArea]);
  if (inCameraMode()) drawCameraHud();
}

// Platform safe area (editor only, never exported): the margins where the app's buttons and
// captions sit are shaded, the safe box is outlined.
function drawSafeArea(sa) {
  const { W, H } = outSize(S.project);
  const x = W * sa.left, y = H * sa.top, w = W * (1 - sa.left - sa.right), h = H * (1 - sa.top - sa.bottom);
  ctx.save();
  ctx.setTransform(baseMatrix);
  ctx.fillStyle = 'rgba(10,10,14,0.42)';
  ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.rect(x, y, w, h); ctx.fill('evenodd');
  const px = 1 / view.z;
  ctx.setLineDash([14 * px, 10 * px]);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 2.5 * px;
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
  ctx.font = `600 ${Math.round(W * 0.022)}px 'Geist Mono', monospace`;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(`${sa.label} safe area`, x + 10, y - 12);
  ctx.restore();
}

// Framing guides and a status label while in camera mode.
function drawCameraHud() {
  const c = cameraAt(S.project, S.t);
  ctx.save();
  ctx.setTransform(baseMatrix);
  const { W, H } = S.cameraView ? outSize(S.project) : { W: S.project.width, H: S.project.height };
  if (S.cameraView) {
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1.5;
    for (const f of [1 / 3, 2 / 3]) {
      ctx.beginPath(); ctx.moveTo(W * f, 0); ctx.lineTo(W * f, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, H * f); ctx.lineTo(W, H * f); ctx.stroke();
    }
  }
  const recording = isCamRecording();
  const text = recording ? `REC  camera ${c.zoom.toFixed(2)}x` : `Camera ${c.zoom.toFixed(2)}x  ·  scroll to zoom, drag to move`;
  ctx.font = '600 26px Geist, sans-serif';
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = recording ? 'rgba(200,30,40,0.9)' : 'rgba(20,18,16,0.78)';
  ctx.beginPath(); ctx.roundRect(24, 24, tw + 36, 48, 10); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(text, 42, 57);
  // zoom meter
  const mx = 24, my = 84, mw = 300;
  ctx.fillStyle = 'rgba(20,18,16,0.6)'; ctx.fillRect(mx, my, mw, 8);
  const k = (Math.log(c.zoom) - Math.log(CAM_MIN)) / (Math.log(CAM_MAX) - Math.log(CAM_MIN));
  ctx.fillStyle = '#e48c42'; ctx.fillRect(mx, my, mw * k, 8);
  if (recording) { ctx.strokeStyle = 'rgba(220,40,50,0.9)'; ctx.lineWidth = 8; ctx.strokeRect(4, 4, W - 8, H - 8); }
  ctx.restore();
}

function canvasPoint(e) {
  const r = canvas.getBoundingClientRect();
  return new DOMPoint(((e.clientX - r.left) / r.width) * canvas.width, ((e.clientY - r.top) / r.height) * canvas.height);
}
const toWorld = (e) => worldMatrix.inverse().transformPoint(canvasPoint(e));
const toFrame = (e) => baseMatrix.inverse().transformPoint(canvasPoint(e));

function hitTest(p) {
  const zoom = viewZoom();
  const sel = selectedLayer();
  if (sel && !sel.hidden && layerVisible(sel, S.t)) {
    const r = scaledRect(layerState(sel, S.t));
    const hs = 24 / zoom;
    if (Math.abs(p.x - (r.x + r.w)) < hs && Math.abs(p.y - (r.y + r.h)) < hs) return { layer: sel, mode: 'resize' };
  }
  for (let i = S.project.layers.length - 1; i >= 0; i--) {
    const l = S.project.layers[i];
    if (l.hidden || !layerVisible(l, S.t)) continue;
    const s = layerState(l, S.t);
    if (s.opacity < 0.05) continue;
    const r = scaledRect(s);
    if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return { layer: l, mode: 'move' };
  }
  return null;
}

function regionAt(p) {
  for (let i = S.project.layers.length - 1; i >= 0; i--) {
    const l = S.project.layers[i];
    if (l.hidden || !layerVisible(l, S.t)) continue;
    const s = layerState(l, S.t);
    if (s.opacity < 0.05) continue;
    const r = scaledRect(s);
    if (!(p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h)) continue;
    for (const reg of editRegions(l, s, S.project)) {
      const rr = throughScale(reg.rect, s);
      if (p.x >= rr.x && p.x <= rr.x + rr.w && p.y >= rr.y && p.y <= rr.y + rr.h) return { ...reg, layer: l };
    }
    return null;
  }
  return null;
}

function captionHit(e) {
  const cap = activeCaption(S.project, S.t);
  if (!cap) return null;
  const fp = toFrame(e);
  const L = captionLayout(ctx, S.project, cap);
  return fp.x >= L.x && fp.x <= L.x + L.w && fp.y >= L.y && fp.y <= L.y + L.h ? { cap, L } : null;
}

// Snap a moving window's edges/center to the desktop and other windows.
function snapMove(layer, x, y, w, h) {
  S.guides = [];
  if (!S.snapping) return { x, y };
  const th = 10 / viewZoom();
  const W = S.project.width, H = S.project.height;
  const xs = [0, W / 2, W], ys = [0, H / 2, H];
  for (const o of S.project.layers) {
    if (o === layer || o.hidden || !layerVisible(o, S.t)) continue;
    const s = layerState(o, S.t);
    if (s.opacity < 0.05) continue;
    xs.push(s.x, s.x + s.w / 2, s.x + s.w);
    ys.push(s.y, s.y + s.h / 2, s.y + s.h);
  }
  const best = (pos, size, lines) => {
    let hit = null;
    for (const [off] of [[0], [size / 2], [size]]) {
      for (const L of lines) {
        const d = L - (pos + off);
        if (Math.abs(d) < th && (!hit || Math.abs(d) < Math.abs(hit.d))) hit = { d, line: L };
      }
    }
    return hit;
  };
  const bx = best(x, w, xs), by = best(y, h, ys);
  if (bx) { x += bx.d; S.guides.push({ x: bx.line }); }
  if (by) { y += by.d; S.guides.push({ y: by.line }); }
  return { x, y };
}

let drag = null;
let hoverRegion = null;

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  if (isCamRecording()) { startCamDrag(e); return; } // keep playing while recording a camera move
  hooks.pause();
  closeInlineEditor(true);
  const p = toWorld(e);
  if (S.sel?.kind === 'cursor') { placeMouse(p, false); return; }
  if (inCameraMode()) { startCamDrag(e); return; }
  const hit = hitTest(p);
  if (!hit) {
    const ch = captionHit(e);
    if (ch) { select({ kind: 'caption', id: ch.cap.id }); return; }
    if (view.z > 1) { startPan(e); return; }
    select(null);
    return;
  }
  if (S.sel?.id !== hit.layer.id) select({ kind: 'layer', id: hit.layer.id });
  drag = { ...hit, start: p, s0: layerState(hit.layer, S.t), moved: false };
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  const p = toWorld(e);
  if (S.sel?.kind === 'cursor' && !drag) { canvas.style.cursor = 'crosshair'; canvas.title = 'Click to move the mouse here at the playhead'; return; }
  if (inCameraMode() && !drag) { canvas.style.cursor = 'grab'; canvas.title = 'Scroll to zoom the camera, drag to move it, double-click a window to frame it'; return; }
  if (!drag) {
    const hit = hitTest(p);
    const reg = hit ? regionAt(p) : null;
    if ((reg?.key) !== (hoverRegion?.key) || reg?.layer !== hoverRegion?.layer) { hoverRegion = reg; S.dirty = true; }
    canvas.style.cursor = reg ? 'text' : hit ? (hit.mode === 'resize' ? 'nwse-resize' : 'move') : captionHit(e) ? 'pointer' : view.z > 1 ? 'grab' : 'default';
    canvas.title = reg ? `Double-click to edit the ${reg.label.toLowerCase()}` : '';
    return;
  }
  const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
  if (!drag.moved && Math.hypot(dx, dy) < 3 / viewZoom()) return;
  drag.moved = true;
  const s0 = drag.s0;
  let values;
  if (drag.mode === 'move') {
    const snapped = e.altKey ? (S.guides = [], { x: s0.x + dx, y: s0.y + dy }) : snapMove(drag.layer, s0.x + dx, s0.y + dy, s0.w, s0.h);
    values = { x: Math.round(snapped.x), y: Math.round(snapped.y) };
  } else {
    values = { w: Math.round(Math.max(300, s0.w + dx / s0.scale)), h: Math.round(Math.max(220, s0.h + dy / s0.scale)) };
  }
  upsertKey(drag.layer.keys, S.t, values, LAYER_PROPS);
  S.dirty = true;
  hooks.inspectorValues?.();
});

function endDrag() {
  if (drag?.moved) changed({ inspector: true });
  drag = null;
  if (S.guides.length) { S.guides = []; S.dirty = true; }
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('pointerleave', () => { if (hoverRegion) { hoverRegion = null; S.dirty = true; } });

// ---------- Inline editing (double-click titles, addresses, names, captions) ----------

let inline = null;

function openInline({ value, placeholder, canvasRect, fontPx, onCommit, multiline = false }) {
  closeInlineEditor(true);
  const cr = canvas.getBoundingClientRect(), br = $('stage-box').getBoundingClientRect();
  const sx = cr.width / canvas.width;
  const el = document.createElement(multiline ? 'textarea' : 'input');
  el.className = 'inline-edit';
  el.value = value; el.placeholder = placeholder || '';
  el.setAttribute('aria-label', placeholder || 'Edit text');
  Object.assign(el.style, {
    left: `${cr.left - br.left + canvasRect.x * sx}px`,
    top: `${cr.top - br.top + canvasRect.y * sx}px`,
    width: `${Math.max(140, canvasRect.w * sx)}px`,
    height: `${Math.max(26, canvasRect.h * sx)}px`,
    fontSize: `${clamp(fontPx * sx, 12, 22)}px`,
  });
  $('stage-box').appendChild(el);
  el.focus(); el.select();
  inline = { el, onCommit, original: value };
  el.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter' && !(multiline && ev.shiftKey)) { ev.preventDefault(); closeInlineEditor(true); }
    if (ev.key === 'Escape') { ev.preventDefault(); closeInlineEditor(false); }
  });
  el.addEventListener('blur', () => closeInlineEditor(true));
}

function closeInlineEditor(commit) {
  if (!inline) return;
  const { el, onCommit, original } = inline;
  inline = null;
  const v = el.value;
  el.remove();
  if (commit && v !== original) onCommit(v);
}

function worldRectToCanvas(r) {
  const a = worldMatrix.transformPoint(new DOMPoint(r.x, r.y));
  const b = worldMatrix.transformPoint(new DOMPoint(r.x + r.w, r.y + r.h));
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
}

// Mouse mode: clicking the stage sets where the pointer is at the playhead.
function placeMouse(p, withClick) {
  const cur = S.project.cursor;
  upsertKey(cur.keys, S.t, { x: Math.round(p.x), y: Math.round(p.y) }, CURSOR_PROPS);
  cur.hidden = false;
  if (withClick && !cur.events.some((ev) => Math.abs(ev.t - S.t) < 0.05)) {
    cur.events.push({ id: `ev_${Date.now().toString(36)}`, t: +S.t.toFixed(2), type: 'click' });
  }
  changed({ inspector: true });
  if (!withClick) toast(`Mouse at ${fmt(S.t)}`);
}

canvas.addEventListener('dblclick', (e) => {
  hooks.pause();
  const p = toWorld(e);
  if (S.sel?.kind === 'cursor') { placeMouse(p, true); toast(`Click at ${fmt(S.t)}`); return; }
  if (inCameraMode()) {
    const hit = hitTest(p);
    if (hit) { camFrame(scaledRect(layerState(hit.layer, S.t))); toast(`Camera framed on ${hit.layer.name}`); }
    else { camSet({ cx: S.project.width / 2, cy: S.project.height / 2, zoom: 1 }); toast('Camera shows the whole desktop'); }
    return;
  }
  const reg = regionAt(p);
  if (reg) {
    const l = reg.layer, s = layerState(l, S.t);
    const rect = worldRectToCanvas(throughScale(reg.rect, s));
    const value = reg.target === 'layer' ? l.title : l.data[reg.key];
    select({ kind: 'layer', id: l.id });
    openInline({
      value, placeholder: reg.target === 'layer' ? windowTitle({ ...l, title: '' }) : reg.label,
      canvasRect: rect, fontPx: 14 * viewZoom() * s.scale,
      onCommit: (v) => {
        v = v.trim();
        if (reg.target === 'layer') l.title = v;
        else if (v) {
          if (reg.key === 'contact') {
            const i = l.data.contacts.indexOf(l.data.contact);
            if (i >= 0) l.data.contacts[i] = v; else l.data.contacts.unshift(v);
          }
          l.data[reg.key] = v;
        }
        changed({ inspector: true });
      },
    });
    return;
  }
  const ch = captionHit(e);
  if (ch) {
    select({ kind: 'caption', id: ch.cap.id });
    const a = baseMatrix.transformPoint(new DOMPoint(ch.L.x, ch.L.y));
    const sc = Math.hypot(baseMatrix.a, baseMatrix.b);
    openInline({
      value: ch.cap.text, placeholder: 'Caption text',
      canvasRect: { x: a.x, y: a.y, w: ch.L.w * sc, h: ch.L.h * sc }, fontPx: ch.L.fs * sc, multiline: true,
      onCommit: (v) => { if (v.trim()) { ch.cap.text = v.trim().replace(/\s*\n\s*/g, ' '); changed({ inspector: true }); } },
    });
  }
});

// Camera mode: drag the shot. In camera view you grab the picture; on the whole
// desktop you move the camera frame itself.
function startCamDrag(e) {
  const r = canvas.getBoundingClientRect();
  const s = viewZoom() * (r.width / canvas.width);
  const sign = S.cameraView ? -1 : 1;
  let lx = e.clientX, ly = e.clientY;
  canvas.setPointerCapture(e.pointerId);
  canvas.style.cursor = 'grabbing';
  const move = (ev) => {
    camPanBy(sign * (ev.clientX - lx) / s, sign * (ev.clientY - ly) / s);
    lx = ev.clientX; ly = ev.clientY;
  };
  const up = () => { canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.style.cursor = ''; };
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
}

// ---------- Stage zoom (pinch, mouse wheel, buttons) ----------

const MAX_VIEW_ZOOM = 8;

function clampPan() {
  const W = canvas.width, H = canvas.height;
  view.x = clamp(view.x, W * (1 - view.z), 0);
  view.y = clamp(view.y, H * (1 - view.z), 0);
}

// Zoom so the canvas point (cx, cy) stays under the pointer.
function zoomAt(newZ, cx, cy) {
  newZ = clamp(newZ, 1, MAX_VIEW_ZOOM);
  if (cx == null) { cx = canvas.width / 2; cy = canvas.height / 2; }
  view.x = cx - (cx - view.x) * (newZ / view.z);
  view.y = cy - (cy - view.y) * (newZ / view.z);
  view.z = newZ;
  if (Math.abs(view.z - 1) < 0.01) { view.z = 1; view.x = 0; view.y = 0; }
  clampPan();
  closeInlineEditor(true);
  updateZoomUI();
  S.dirty = true;
}
export const resetView = () => zoomAt(1);

function updateZoomUI() {
  $('vz-label').textContent = `${Math.round(view.z * 100)}%`;
  $('vz-reset').disabled = view.z === 1;
  $('stage-box').classList.toggle('zoomed', view.z > 1);
}

function canvasPointFromClient(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return { x: ((clientX - r.left) / r.width) * canvas.width, y: ((clientY - r.top) / r.height) * canvas.height };
}

// Trackpad pinch arrives as wheel + ctrlKey (Chrome, Edge, Firefox).
// A mouse wheel sends big whole-number steps; a two-finger trackpad swipe sends small ones and pans.
$('stage-box').addEventListener('wheel', (e) => {
  e.preventDefault();
  const pt = canvasPointFromClient(e.clientX, e.clientY);
  const isMouseWheel = e.deltaMode !== 0 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50);
  if (inCameraMode()) {
    // Camera mode: scrolling moves the real camera (saved as keyframes), not just your view.
    if (e.ctrlKey || e.metaKey || isMouseWheel) {
      const step = e.ctrlKey ? Math.exp(-clamp(e.deltaY, -30, 30) * 0.008) : (e.deltaY < 0 ? 1.12 : 1 / 1.12);
      camZoomAt(toWorld(e), step);
    } else {
      const s = viewZoom() * (canvas.getBoundingClientRect().width / canvas.width);
      camPanBy(e.deltaX / s, e.deltaY / s);
    }
    return;
  }
  if (e.ctrlKey || e.metaKey || isMouseWheel) {
    const step = e.ctrlKey ? Math.exp(-clamp(e.deltaY, -30, 30) * 0.009) : (e.deltaY < 0 ? 1.18 : 1 / 1.18);
    zoomAt(view.z * step, pt.x, pt.y);
  } else if (view.z > 1) {
    const r = canvas.getBoundingClientRect();
    const k = canvas.width / r.width;
    view.x -= e.deltaX * k; view.y -= e.deltaY * k;
    clampPan();
    closeInlineEditor(true);
    S.dirty = true;
  }
}, { passive: false });

// Safari sends pinch as gesture events instead.
let gestureStartZ = 1;
let lastGestureScale = 1;
$('stage-box').addEventListener('gesturestart', (e) => { e.preventDefault(); gestureStartZ = view.z; lastGestureScale = 1; });
$('stage-box').addEventListener('gesturechange', (e) => {
  e.preventDefault();
  if (inCameraMode()) { camZoomAt(toWorld(e), e.scale / lastGestureScale); lastGestureScale = e.scale; return; }
  const pt = canvasPointFromClient(e.clientX, e.clientY);
  zoomAt(gestureStartZ * e.scale, pt.x, pt.y);
});
$('stage-box').addEventListener('gestureend', (e) => e.preventDefault());

// Drag on empty space while zoomed in to move around.
function startPan(e) {
  const r = canvas.getBoundingClientRect();
  const k = canvas.width / r.width;
  const x0 = e.clientX, y0 = e.clientY, vx = view.x, vy = view.y;
  let moved = false;
  canvas.setPointerCapture(e.pointerId);
  canvas.style.cursor = 'grabbing';
  const move = (ev) => {
    if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 3) moved = true;
    view.x = vx + (ev.clientX - x0) * k; view.y = vy + (ev.clientY - y0) * k;
    clampPan(); S.dirty = true;
  };
  const up = () => {
    canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up);
    canvas.style.cursor = '';
    if (!moved) select(null);
  };
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
}

$('vz-in').addEventListener('click', () => zoomAt(view.z * 1.4));
$('vz-out').addEventListener('click', () => zoomAt(view.z / 1.4));
$('vz-reset').addEventListener('click', resetView);
updateZoomUI();

// ---------- Playback ----------

const ICON_PLAY = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5v11l9-5.5z" fill="currentColor"/></svg>';
const ICON_PAUSE = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5h3v11H3zM8 1.5h3v11H8z" fill="currentColor"/></svg>';

let lastTs = 0;
let frameErrorShown = false;
function frame(ts) {
  if (S.playing) {
    const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0;
    S.t += dt;
    if (S.t >= S.project.duration) {
      if (S.loop && !S.recording) { S.t = 0; if (!S.recording) startPlayback(S.project, 0); }
      else { S.t = S.project.duration; if (S.recording) toggleRecording(); else pause(); }
    }
    S.dirty = true;
  }
  camTick();
  syncVideos(S.project, S.t, S.playing);
  lastTs = ts;
  if (S.dirty) {
    S.dirty = false;
    // Keep the loop alive even if a frame fails, or the stage would freeze for good.
    try { if (isPreviewOpen()) drawPreview(); else draw(); }
    catch (err) { if (!frameErrorShown) { frameErrorShown = true; console.warn('MakeMotion: a frame failed to draw', err); } }
    updateClock();
  }
  requestAnimationFrame(frame);
}

function play({ silent = false } = {}) {
  closeInlineEditor(true);
  if (S.t >= S.project.duration - 0.01) S.t = 0;
  S.playing = true; lastTs = 0;
  if (!silent) startPlayback(S.project, S.t);
  $('play-btn').innerHTML = ICON_PAUSE; $('play-btn').setAttribute('aria-label', 'Pause');
}
function pause() {
  if (!S.playing) return;
  if (S.recording) { toggleRecording(); return; }
  S.playing = false;
  if (isCamRecording()) stopCamRecording();
  stopPlayback();
  pauseAllVideos();
  S.t = snapTime(S.t);
  $('play-btn').innerHTML = ICON_PLAY; $('play-btn').setAttribute('aria-label', 'Play');
  S.dirty = true;
  hooks.inspector();
}
hooks.pause = pause;
hooks.play = () => play();
hooks.stopAudio = stopPlayback;
hooks.openAddMenu = openAddMenu;
hooks.addAudioFile = addAudioFile;
hooks.pickAudio = (track) => pickFile('audio/*', (f) => addAudioFile(f, track));
onMediaReady(() => { S.dirty = true; });

// ---------- Voiceover recording ----------

async function toggleRecording() {
  if (S.recording) {
    const { rec, start } = S.recording;
    S.recording = null;
    S.playing = false;
    $('play-btn').innerHTML = ICON_PLAY;
    document.body.classList.remove('recording');
    pauseAllVideos();
    const file = await rec.stop();
    audioContext();
    await addAudioFile(file, 'voice', start);
    return;
  }
  try {
    audioContext()?.resume?.();
    const rec = await startRecording();
    S.recording = { rec, start: +S.t.toFixed(2) };
    document.body.classList.add('recording');
    hooks.inspector();
    play({ silent: true });
    toast('Recording. Press Space or Stop to finish');
  } catch {
    toast('Microphone not available here. Upload a recording instead.');
  }
}
hooks.toggleRecording = toggleRecording;

// ---------- Dropping files on the stage ----------

async function addMediaWindow(file) {
  const kind = kindOf(file.type || '');
  if (kind === 'audio') { await addAudioFile(file, 'voice', S.t); return; }
  if (kind !== 'image' && kind !== 'video') { toast('Drop an image, video or audio file'); return; }
  const id = await addMediaFile(S.project, file);
  const l = selectedLayer();
  const mediaField = l && APPS[l.type].fields.find((f) => f.type === 'media' && f.accept.split(',').includes(kind) && !l.data[f.key]);
  if (mediaField) { l.data[mediaField.key] = id; changed({ inspector: true }); toast(`${file.name} added to ${l.name}`); return; }
  const layer = addLayer(kind === 'image' ? 'photo' : 'video');
  layer.data.mediaId = id;
  layer.name = file.name.replace(/\.[^.]+$/, '').slice(0, 30) || layer.name;
  changed({ structure: true });
}
hooks.addMediaWindow = addMediaWindow;
const stageBox = $('stage-box');
stageBox.addEventListener('dragover', (e) => { e.preventDefault(); stageBox.classList.add('drop'); });
stageBox.addEventListener('dragleave', () => stageBox.classList.remove('drop'));
stageBox.addEventListener('drop', (e) => {
  e.preventDefault(); stageBox.classList.remove('drop');
  const f = e.dataTransfer.files?.[0];
  if (f) addMediaWindow(f).catch(() => toast('Could not add that file'));
});
const togglePlay = () => (S.playing ? pause() : play());
$('play-btn').innerHTML = ICON_PLAY;
$('play-btn').addEventListener('click', togglePlay);

function updateClock() {
  $('time-label').innerHTML = `${fmt(S.t)} <span class="of">/ ${fmt(S.project.duration)}</span>`;
  hooks.playhead?.();
  if (!S.playing) hooks.inspectorValues?.();
}

// Jump to the previous/next keyframe of the selection (or of anything).
function jumpKey(dir) {
  hooks.pause();
  const times = [...new Set(timelineKeys().map((k) => k.t))].sort((a, b) => a - b);
  const next = dir > 0 ? times.find((t) => t > S.t + 1e-3) : [...times].reverse().find((t) => t < S.t - 1e-3);
  if (next !== undefined) seek(next);
}
$('prev-key').addEventListener('click', () => jumpKey(-1));
$('next-key').addEventListener('click', () => jumpKey(1));

function setToggle(id, on) { $(id).setAttribute('aria-pressed', String(on)); }
$('cam-btn').addEventListener('click', () => select(inCameraMode() ? null : { kind: 'camera' }));
$('loop-btn').addEventListener('click', () => { S.loop = !S.loop; setToggle('loop-btn', S.loop); });
$('snap-btn').addEventListener('click', () => { S.snapping = !S.snapping; setToggle('snap-btn', S.snapping); });

// ---------- View ----------

function setView(cameraView) {
  S.cameraView = cameraView;
  setToggle('view-camera', cameraView);
  setToggle('view-desktop', !cameraView);
  closeInlineEditor(true);
  S.dirty = true;
}
hooks.view = setView;
$('view-camera').addEventListener('click', () => setView(true));
$('view-desktop').addEventListener('click', () => setView(false));

// ---------- Keyboard ----------

export function addCaptionAtPlayhead() {
  hooks.pause();
  const cap = insertCaption(S.project, S.t);
  S.sel = { kind: 'caption', id: cap.id };
  changed({ structure: true });
  hooks.focusCaption?.(cap.id);
}
hooks.addCaption = addCaptionAtPlayhead;

function addKeyHere() {
  const l = selectedLayer();
  if (l) upsertKey(l.keys, S.t, {}, LAYER_PROPS);
  else if (S.sel?.kind === 'camera') upsertKey(S.project.camera.keys, S.t, {}, CAMERA_PROPS);
  else if (S.sel?.kind === 'cursor') upsertKey(S.project.cursor.keys, S.t, {}, CURSOR_PROPS);
  else return;
  changed({ inspector: true });
  toast(`Keyframe at ${fmt(S.t)}`);
}

function deleteSelection() {
  if (S.selKey) {
    const entry = timelineKeys({ all: true }).find((k) => k.key === S.selKey);
    if (entry && removeKey(entry.keys, S.selKey)) { S.selKey = null; changed({ inspector: true }); }
    else if (entry) toast('A track needs at least one keyframe');
    return;
  }
  if (S.sel?.kind === 'cursor' && S.sel.eventId) {
    S.project.cursor.events = S.project.cursor.events.filter((ev) => ev.id !== S.sel.eventId);
    S.sel = { kind: 'cursor' };
    changed({ inspector: true });
    return;
  }
  if (S.sel?.kind === 'audio' && S.sel.id) {
    S.project.audio = S.project.audio.filter((c) => c.id !== S.sel.id);
    S.sel = { kind: 'audio', track: S.sel.track };
    changed({ inspector: true });
    toast('Clip deleted. Ctrl+Z brings it back');
    return;
  }
  if (S.sel?.kind === 'caption') {
    S.project.captions = S.project.captions.filter((c) => c.id !== S.sel.id);
    S.sel = { kind: 'captions' };
    changed({ structure: true });
    toast('Caption deleted. Ctrl+Z brings it back');
    return;
  }
  const l = selectedLayer();
  if (l) { deleteLayer(l); toast('Window deleted. Ctrl+Z brings it back'); }
}

// Space is our play/pause key. Browsers also "click" a focused button when Space is
// released, which would toggle things twice; block that.
document.addEventListener('keyup', (e) => {
  if (e.key === ' ' && !isTyping() && document.activeElement?.tagName === 'BUTTON') e.preventDefault();
}, true);

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (isTyping()) return;
  if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); const l = selectedLayer(); if (l) duplicateLayer(l); return; }
  if (mod || e.altKey) return;
  switch (e.key) {
    case ' ': e.preventDefault(); if (S.recording) toggleRecording(); else togglePlay(); break;
    case 'a': case 'A': e.preventDefault(); openAddMenu(); break;
    case 'p': case 'P': e.preventDefault(); openPreview(); break;
    case '0': resetView(); break;
    case '=': case '+': zoomAt(view.z * 1.4); break;
    case '-': zoomAt(view.z / 1.4); break;
    case 'm': case 'M': select(S.sel?.kind === 'cursor' ? null : { kind: 'cursor' }); break;
    case 'z': case 'Z': select(inCameraMode() ? null : { kind: 'camera' }); break;
    case 'ArrowRight': case 'ArrowLeft': {
      e.preventDefault(); hooks.pause();
      const step = e.shiftKey ? 1 : 1 / S.project.fps;
      seek(S.t + (e.key === 'ArrowRight' ? step : -step));
      break;
    }
    case 'Home': e.preventDefault(); hooks.pause(); seek(0); break;
    case 'End': e.preventDefault(); hooks.pause(); seek(S.project.duration); break;
    case ',': jumpKey(-1); break;
    case '.': jumpKey(1); break;
    case 'k': case 'K': addKeyHere(); break;
    // preventDefault so the key press doesn't land in the caption box that gets focused
    case 'c': case 'C': e.preventDefault(); addCaptionAtPlayhead(); break;
    case 'v': case 'V': setView(!S.cameraView); break;
    case 'l': case 'L': $('loop-btn').click(); break;
    case 's': case 'S': e.preventDefault(); splitHere(); break;
    case 'Delete': case 'Backspace': e.preventDefault(); if (hasRange()) cutRange(); else deleteSelection(); break;
    case 'Escape': if (!clearRange()) select(null); break;
    case '?': $('help-btn').click(); break;
    default:
  }
});

// ---------- Boot ----------

initPanels();
initInspector();
initTimeline();
initIO();
initReview();
initAI();
initScenes();
initPreview();
hooks.project();
hooks.layers();
hooks.inspector();
hooks.timeline();
fitStage();
document.fonts?.ready.then(() => { S.dirty = true; });
requestAnimationFrame(frame);

