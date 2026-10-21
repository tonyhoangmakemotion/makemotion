// MakeMotion render engine.
// renderFrame(ctx, project, t) is PURE: same project + same t = same pixels.
// The live preview and the video export both call it.

import { layerAlive, sample, LAYER_PROPS, CAMERA_PROPS, CURSOR_PROPS, clamp, EASINGS, FPS } from './model.js';
import { APPS, chromeOf } from './apps/index.js';
import { roundRect, UI_FONT, wrapText, fitText, shadowScale } from './apps/draw.js';
import { levelAt } from './media.js';
import { getWallpaper } from './wallpapers.js';
import { outSize, viewK } from './format.js';
import { glassOf, focusIndex, depthAmount, canFilter, scratch, drawBlurred, drawFinish } from './look.js';
import { drawWindow, windowTitle, TITLEBAR, titlebarHeight } from './chrome.js';

export { windowTitle, TITLEBAR, titlebarHeight };


// Safety net: a negative radius (from a window squeezed very small) throws in canvas.
// Clamp it instead so one odd size can never break drawing.
for (const C of [globalThis.CanvasRenderingContext2D, globalThis.OffscreenCanvasRenderingContext2D]) {
  if (!C || C.prototype.__finischdSafe) continue;
  const arc = C.prototype.arc, ellipse = C.prototype.ellipse;
  C.prototype.arc = function (x, y, r, ...rest) { return arc.call(this, x, y, Math.max(0, r || 0), ...rest); };
  C.prototype.ellipse = function (x, y, rx, ry, ...rest) { return ellipse.call(this, x, y, Math.max(0, rx || 0), Math.max(0, ry || 0), ...rest); };
  C.prototype.__finischdSafe = true;
}
const MIN_W = 80, MIN_H = 50;
const warned = new Set();

// ---------- Camera ----------

export function cameraAt(project, t) {
  const c = sample(project.camera.keys, t, CAMERA_PROPS);
  return { cx: c.cx ?? project.width / 2, cy: c.cy ?? project.height / 2, zoom: c.zoom ?? 1 };
}

// Gentle handheld motion: a sum of slow sines, so it is smooth and repeatable.
function drift(project, t) {
  const a = project.camera.drift || 0;
  if (!a) return { dx: 0, dy: 0, rot: 0 };
  return {
    dx: a * (Math.sin(t * 0.61) * 7 + Math.sin(t * 1.37 + 1.3) * 3),
    dy: a * (Math.sin(t * 0.47 + 2.1) * 6 + Math.sin(t * 1.13) * 2.5),
    rot: a * 0.0035 * Math.sin(t * 0.39 + 0.7),
  };
}

// Matrix that maps world (desktop) coords to frame coords.
// Camera shakes: a quick, decaying jolt (impacts, surprises, jump scares).
function shake(project, t) {
  let dx = 0, dy = 0, rot = 0;
  for (const s of project.camera.shakes || []) {
    const age = t - s.t;
    if (age < 0 || age > s.dur) continue;
    const decay = (1 - age / s.dur) ** 2 * (s.amount ?? 1);
    dx += 22 * decay * Math.sin(age * 57);
    dy += 16 * decay * Math.sin(age * 43 + 1.3);
    rot += 0.012 * decay * Math.sin(age * 37 + 0.4);
  }
  return { dx, dy, rot };
}

export function cameraTransform(project, t) {
  const { cx, cy, zoom } = cameraAt(project, t);
  const d = drift(project, t), sh = shake(project, t);
  const { W, H } = outSize(project), k = viewK(project);
  return new DOMMatrix()
    .translate(W / 2 + (d.dx + sh.dx) * k, H / 2 + (d.dy + sh.dy) * k)
    .rotate(((d.rot + sh.rot) * 180) / Math.PI)
    .scale(zoom * k)
    .translate(-cx, -cy);
}

export const layerState = (layer, t) => sample(layer.keys, t, LAYER_PROPS);

// A layer exists from its first keyframe on, inside its trim range.
export const layerVisible = layerAlive;


// Places on a window you can double-click to edit, in world coords
// (before the window's own scale is applied).
export function editRegions(layer, s, project) {
  const chrome = chromeOf(layer);
  const bar = titlebarHeight(project, layer);
  const out = chrome === 'none' ? [] : [chrome === 'browser'
    ? { key: 'title', label: 'Tab title', target: 'layer', rect: { x: s.x + 84, y: s.y + 6, w: Math.min(260, s.w - 120), h: TITLEBAR - 6 } }
    : project?.look?.chrome === 'studio'
      ? { key: 'title', label: 'Window title', target: 'layer', rect: { x: s.x + 10, y: s.y, w: s.w - 90, h: bar } }
      : { key: 'title', label: 'Window title', target: 'layer', rect: { x: s.x + 80, y: s.y, w: s.w - 160, h: TITLEBAR } }];
  const area = { x: s.x, y: s.y + bar, w: s.w, h: s.h - bar };
  for (const r of APPS[layer.type]?.regions?.(area, layer.data) || []) out.unshift({ ...r, target: 'data' });
  return out;
}

// How loud the user's voiceover is at time t (0..1), for face cams that react to speech.
function voiceLevelFn(project) {
  const clips = (project.audio || []).filter((a) => a.track === 'voice' && a.src.startsWith('media:') && !a.muted);
  return (t) => {
    for (const c of clips) {
      const local = t - c.start + (c.offset || 0);
      if (t >= c.start && (!c.dur || t < c.start + c.dur)) {
        const v = levelAt(c.src.slice(6), local);
        if (v) return Math.min(1, v * 1.6 * (c.volume ?? 1));
      }
    }
    return 0;
  };
}

// ---------- Cursor ----------

// Cursor travels on a gentle arc between keys, like a real hand.
export function cursorAt(cur, t) {
  const keys = cur.keys;
  const p = sample(keys, t, CURSOR_PROPS);
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
  const a = keys[i], b = keys[i + 1];
  if (!b || t <= a.t) return p;
  const raw = (t - a.t) / (b.t - a.t);
  const dx = b.x - a.x, dy = b.y - a.y;
  // Drags travel straight; free moves curve a little.
  const dragging = (cur.events || []).some((e) => e.type === 'drag' && a.t >= e.t - 0.05 && b.t <= e.t + (e.dur || 0.6) + 0.05);
  const bend = dragging ? 0 : Math.sin(Math.PI * raw) * 0.12 * (i % 2 ? -1 : 1);
  return { x: p.x - dy * bend, y: p.y + dx * bend };
}

function arrowPath(ctx) {
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(0, 17); ctx.lineTo(4.2, 13); ctx.lineTo(7.2, 19.5);
  ctx.lineTo(9.8, 18.4); ctx.lineTo(6.9, 12.2); ctx.lineTo(12.4, 12.2); ctx.closePath();
}

function drawCursor(ctx, project, t) {
  const cur = project.cursor;
  if (!cur || cur.hidden || !cur.keys.length || t < cur.keys[0].t) return;
  const { x, y } = cursorAt(cur, t);
  const size = 1.4 * (cur.size || 1);
  const events = cur.events || [];
  let press = 0;

  // Drag trail
  for (const e of events) {
    const end = e.t + (e.dur || 0.6);
    if (e.type === 'drag' && t >= e.t && t <= end + 0.35) {
      press = Math.max(press, t <= end ? 1 : 0);
      const fade = t > end ? 1 - (t - end) / 0.35 : 1;
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let i = 1; i <= 14; i++) {
        const ta = Math.max(e.t, t - i * 0.025), tb = Math.max(e.t, t - (i - 1) * 0.025);
        if (ta >= tb) break;
        const pa = cursorAt(cur, ta), pb = cursorAt(cur, tb);
        ctx.strokeStyle = `rgba(147,178,255,${0.55 * fade * (1 - i / 14)})`;
        ctx.lineWidth = 10 * (1 - i / 16) * (cur.size || 1);
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
      }
      ctx.restore();
    }
  }
  // Click feedback
  for (const e of events) {
    const presses = e.type === 'double' ? [e.t, e.t + 0.14] : (e.type === 'click' || e.type === 'right') ? [e.t] : [];
    for (const pt of presses) {
      press = Math.max(press, 1 - Math.abs(t - pt) / 0.1);
      const age = t - pt;
      if (age >= 0 && age < 0.5 && cur.clickStyle !== 'none') {
        const p = age / 0.5;
        ctx.beginPath(); ctx.arc(x, y, (8 + 26 * EASINGS.out(p)) * (cur.size || 1), 0, Math.PI * 2);
        if (cur.clickStyle === 'ring') { ctx.fillStyle = `rgba(255,214,64,${0.35 * (1 - p)})`; ctx.fill(); }
        ctx.strokeStyle = cur.clickStyle === 'ring' ? `rgba(255,214,64,${0.9 * (1 - p)})` : `rgba(255,255,255,${0.75 * (1 - p)})`;
        ctx.lineWidth = 3; ctx.stroke();
      }
    }
    // Right-click: small context menu
    if (e.type === 'right' && t >= e.t + 0.08 && t < e.t + (e.dur || 1.2)) {
      const k = EASINGS.out(clamp((t - e.t - 0.08) / 0.15, 0, 1));
      const items = ['Open', 'Copy', 'Get Info', 'Move to Trash'];
      ctx.save();
      ctx.globalAlpha = k;
      ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = (18) * shadowScale(ctx); ctx.shadowOffsetY = (6) * shadowScale(ctx);
      roundRect(ctx, x + 6, y + 6, 180, items.length * 30 + 10, 8);
      ctx.fillStyle = 'rgba(40,41,46,0.97)'; ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.font = `400 14px ${UI_FONT}`;
      items.forEach((it, i) => {
        ctx.fillStyle = i === items.length - 1 ? '#ff7b72' : '#ececf1';
        ctx.fillText(it, x + 22, y + 32 + i * 30);
      });
      ctx.restore();
    }
    // Scroll: wheel indicator beside the pointer
    if (e.type === 'scroll' && t >= e.t && t < e.t + (e.dur || 1)) {
      const k = clamp(Math.min(t - e.t, e.t + (e.dur || 1) - t) / 0.15, 0, 1);
      ctx.save();
      ctx.globalAlpha = k;
      roundRect(ctx, x + 22, y + 6, 22, 34, 11);
      ctx.fillStyle = 'rgba(20,20,24,0.85)'; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
      const off = ((t - e.t) * 3) % 1;
      ctx.fillStyle = '#fff';
      ctx.fillRect(x + 31.5, y + 12 + off * 14, 3, 7);
      ctx.restore();
    }
  }
  const sc = size * (1 - 0.13 * clamp(press, 0, 1));
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  arrowPath(ctx);
  ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = (4) * shadowScale(ctx); ctx.shadowOffsetY = (1) * shadowScale(ctx);
  ctx.fillStyle = cur.color === 'dark' ? '#111' : '#ffffff'; ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 1.1; ctx.strokeStyle = cur.color === 'dark' ? '#fff' : '#111'; ctx.stroke();
  ctx.restore();
}

// ---------- Captions (frame space, not affected by camera) ----------

export const activeCaption = (project, t) => (project.captions || []).find((c) => t >= c.start && t < c.end) || null;

// Box geometry for a caption, used for drawing and for hit testing.
export function captionLayout(ctx, project, cap) {
  const { W, H } = outSize(project);
  const st = project.captionStyle || {};
  const fs = Math.round(H * 0.036 * (st.size || 1));
  ctx.font = `700 ${fs}px ${UI_FONT}`;
  const lines = wrapText(ctx, cap.text, W * 0.72);
  const lineH = fs * 1.25;
  const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const padX = fs * 0.55, padY = fs * 0.32;
  const bw = tw + padX * 2, bh = lines.length * lineH + padY * 2 - (lineH - fs);
  const tall = H > W * 1.1; // vertical: keep captions above the app buttons
  const cy = st.position === 'top' ? H * (tall ? 0.16 : 0.12) : st.position === 'center' ? H * 0.5 : H * (tall ? 0.72 : 0.86);
  return { fs, lines, lineH, x: (W - bw) / 2, y: cy - bh / 2, w: bw, h: bh, padY };
}

function drawCaptions(ctx, project, t) {
  const cap = activeCaption(project, t);
  if (!cap) return;
  const style = project.captionStyle?.style || 'box';
  const age = t - cap.start, left = cap.end - t;
  const k = EASINGS.out(clamp(Math.min(age, left) / 0.18, 0, 1));
  const { W } = outSize(project);
  ctx.save();
  const L = captionLayout(ctx, project, cap);
  const midY = L.y + L.h / 2;
  ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  const lineY = (i) => L.y + L.padY + L.fs / 2 + i * L.lineH + 1;

  if (style === 'words') {
    // Word by word: each word pops in, the newest one is highlighted.
    const words = cap.text.split(/\s+/);
    const ws = cap.wordStart ?? cap.start, we = cap.wordEnd ?? cap.end;
    const wage0 = t - ws;
    const span = Math.min(we - ws, words.length * 0.32) * 0.85;
    const per = span / words.length;
    ctx.globalAlpha = clamp(left / 0.15, 0, 1);
    let wi = 0;
    L.lines.forEach((line, li) => {
      const lw = line.split(/\s+/);
      let wx = W / 2 - ctx.measureText(line).width / 2;
      ctx.textAlign = 'left';
      for (const word of lw) {
        const wage = wage0 - wi * per;
        const ww = ctx.measureText(word + ' ').width;
        if (wage >= 0) {
          const pk = EASINGS.back(clamp(wage / 0.22, 0, 1));
          const current = wage < per;
          ctx.save();
          const ccx = wx + ctx.measureText(word).width / 2, ccy = lineY(li);
          ctx.translate(ccx, ccy); ctx.scale(0.6 + 0.4 * pk, 0.6 + 0.4 * pk); ctx.translate(-ccx, -ccy);
          ctx.lineWidth = L.fs * 0.16; ctx.lineJoin = 'round';
          ctx.strokeStyle = 'rgba(0,0,0,0.85)';
          ctx.strokeText(word, wx, lineY(li));
          ctx.fillStyle = current ? '#ffd23f' : '#ffffff';
          ctx.fillText(word, wx, lineY(li));
          ctx.restore();
        }
        wx += ww; wi++;
      }
    });
    ctx.restore();
    return;
  }

  ctx.globalAlpha = k;
  ctx.translate(W / 2, midY);
  ctx.scale(0.9 + 0.1 * k, 0.9 + 0.1 * k);
  ctx.translate(-W / 2, -midY);
  if (style === 'box') {
    roundRect(ctx, L.x, L.y, L.w, L.h, 8);
    ctx.fillStyle = '#d7262f';
    ctx.fill();
    ctx.fillStyle = '#fff';
  } else {
    ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = (14) * shadowScale(ctx); ctx.shadowOffsetY = (2) * shadowScale(ctx);
    ctx.fillStyle = '#fff';
  }
  L.lines.forEach((l, i) => ctx.fillText(l, W / 2, lineY(i)));
  ctx.restore();
}

// ---------- Frame ----------

// Full-frame blur transitions (project.camera.blurs): the picture melts into blur and back.
function blurTransitionAt(project, t) {
  let k = 0;
  for (const b of project.camera?.blurs || []) {
    const half = (b.dur || 0.8) / 2, d = Math.abs(t - b.t);
    if (d < half) k = Math.max(k, (b.amount ?? 1) * (0.5 + 0.5 * Math.cos((d / half) * Math.PI)));
  }
  return k;
}

// How far (in frame pixels) the picture moves during half a frame: drives motion blur.
const SHUTTER = 0.5 / FPS;
function cameraSmear(project, t) {
  const C = cameraTransform(project, t), P = cameraTransform(project, t - SHUTTER);
  const M = P.multiply(C.inverse());
  const { W, H } = outSize(project);
  let d = 0;
  for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H], [W / 2, H / 2]]) {
    const q = M.transformPoint(new DOMPoint(x, y));
    d = Math.max(d, Math.hypot(q.x - x, q.y - y));
  }
  return { d, C };
}

export function renderFrame(ctx, project, t, opts = {}) {
  const { W, H } = outSize(project);
  const camera = opts.camera !== false;
  const base = opts.base || new DOMMatrix();
  const bs = Math.hypot(base.a, base.b);
  const look = project.look || {};
  ctx.save();
  ctx.setTransform(base);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  const world = camera ? base.multiply(cameraTransform(project, t)) : base;
  const wp = getWallpaper(project);

  const items = [];
  for (const layer of project.layers) {
    if (layer.hidden || !layerVisible(layer, t)) continue;
    const s = layerState(layer, t);
    if (s.opacity <= 0.001) continue;
    s.w = Math.max(MIN_W, s.w); s.h = Math.max(MIN_H, s.h);
    items.push({ layer, s });
  }
  // The front window is the active one (coloured traffic lights, bigger shadow).
  let active = null;
  for (let i = items.length - 1; i >= 0; i--) {
    if (chromeOf(items[i].layer) !== 'none' && items[i].s.opacity > 0.5) { active = items[i].layer.id; break; }
  }
  const env = {
    project, voiceLevel: voiceLevelFn(project), active,
    dimInactive: look.glass !== false && !!project.look, glass: look.glass ? glassOf(wp) : null,
  };
  const draw = (g, { layer, s }) => {
    // One broken window must never stop the rest of the frame from drawing.
    g.save();
    try { drawWindow(g, layer, s, t, env); }
    catch (err) { if (!warned.has(layer.type)) { warned.add(layer.type); console.warn(`MakeMotion: could not draw ${layer.type}`, err); } }
    g.restore();
  };
  const cv = ctx.canvas;

  // Depth of field: when the camera pushes in, what it isn't looking at softens and darkens:
  // the desktop and windows behind the focused one, and windows in front that are off to the side.
  const cam = camera ? cameraAt(project, t) : null;
  const depth = cam && canFilter && !opts.fast ? depthAmount(look, cam.zoom) : 0;
  const focus = depth > 0.02 ? focusIndex(items, cam) : -1;
  const r = depth * 30 * bs;

  const drawScene = (g) => {
    g.setTransform(world);
    if (focus < 0) {
      g.drawImage(wp.canvas, -wp.pad, -wp.pad);
      for (const it of items) draw(g, it);
    } else {
      const off = scratch(cv.width, cv.height, 0);
      const o = off.getContext('2d');
      o.setTransform(world);
      o.drawImage(wp.canvas, -wp.pad, -wp.pad);
      for (let i = 0; i < focus; i++) draw(o, items[i]);
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(off, 0, 0); // sharp copy underneath keeps the frame edges from going dark
      drawBlurred(g, off, r);
      g.setTransform(base);
      g.fillStyle = `rgba(0,0,0,${(0.03 * depth).toFixed(3)})`;
      g.fillRect(0, 0, W, H);
      g.restore();
      g.setTransform(world);
      draw(g, items[focus]);
      // In front of the focus: pop-ups stay sharp, other windows are out of focus.
      const front = items.slice(focus + 1);
      const soft = front.filter((it) => !isOverlay(it.layer));
      if (soft.length && r > 1) {
        const fo = scratch(cv.width, cv.height, 2), f = fo.getContext('2d');
        f.setTransform(world);
        for (const it of soft) draw(f, it);
        g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalAlpha = 0.92;
        drawBlurred(g, fo, r * 0.8);
        g.restore();
        g.setTransform(world);
      } else for (const it of soft) draw(g, it);
      for (const it of front) if (isOverlay(it.layer)) draw(g, it);
    }
    drawCursor(g, project, t);
  };

  // Motion blur: during fast camera moves (whip pans, punches, shakes) the picture smears
  // along the move, like a real camera with a 180° shutter.
  const smear = camera && look.motionBlur !== false && !opts.fast ? cameraSmear(project, t) : null;
  if (smear && smear.d > 4) {
    const sc = scratch(cv.width, cv.height, 3), g = sc.getContext('2d');
    drawScene(g);
    const n = Math.max(3, Math.min(14, Math.ceil(smear.d / 5)));
    const invC = smear.C.inverse(), invB = base.inverse();
    ctx.save();
    for (let i = 0; i < n; i++) {
      const ti = t - (SHUTTER * i) / (n - 1);
      const M = base.multiply(cameraTransform(project, ti)).multiply(invC).multiply(invB);
      ctx.setTransform(M);
      ctx.globalAlpha = 1 / (i + 1);
      ctx.drawImage(sc, 0, 0);
    }
    ctx.restore();
  } else {
    drawScene(ctx);
  }

  // Blur transition
  const bt = canFilter && !opts.fast ? blurTransitionAt(project, t) : 0;
  if (bt > 0.01) {
    const copy = scratch(cv.width, cv.height, 4), c = copy.getContext('2d');
    c.drawImage(cv, 0, 0);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawBlurred(ctx, copy, bt * 40 * bs);
    ctx.restore();
  }

  ctx.setTransform(base);
  if (opts.finish !== false) drawFinish(ctx, project, t, opts.fast);
  if (opts.captions !== false) drawCaptions(ctx, project, t);
  ctx.restore();
  return world;
}

const OVERLAY_TYPES = new Set(['notification', 'facecam', 'callout', 'prompt', 'spotlight', 'wipe']);
const isOverlay = (layer) => OVERLAY_TYPES.has(layer.type);
