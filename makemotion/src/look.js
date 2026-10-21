// The "look" of the final video: depth of field, frosted-glass title bars, vignette and film grain.
// Everything here is deterministic (same project + same t = same pixels), like the rest of rendering.

import { clamp, FPS } from './model.js';
import { outSize } from './format.js';

export const LOOKS = {
  cinematic: { label: 'Cinematic', depth: 0.9, contrast: 0.3, vignette: 0.22, grain: 0.35, glass: true, chrome: 'studio', motionBlur: true },
  clean: { label: 'Clean', depth: 0.5, contrast: 0.25, vignette: 0.15, grain: 0, glass: true, chrome: 'macos', motionBlur: true },
  flat: { label: 'Flat', depth: 0, contrast: 0, vignette: 0, grain: 0, glass: false, chrome: 'macos', motionBlur: false },
};
export const DEFAULT_LOOK = { preset: 'cinematic', ...LOOKS.cinematic };
delete DEFAULT_LOOK.label;

const hasOffscreen = typeof OffscreenCanvas !== 'undefined';
const makeCanvas = (w, h) => {
  if (hasOffscreen) return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
};

// Canvas blur filters exist in Chrome, Edge, Firefox and Safari 18+. Without them we skip blur.
export const canFilter = (() => {
  try { const g = makeCanvas(1, 1).getContext('2d'); g.filter = 'blur(2px)'; return g.filter === 'blur(2px)'; } catch { return false; }
})();

// Reusable scratch canvases (one per slot), cleared on each use.
const scratches = new Map();
export function scratch(w, h, slot = 0) {
  let c = scratches.get(slot);
  if (!c || c.width !== w || c.height !== h) { c = makeCanvas(w, h); scratches.set(slot, c); }
  const g = c.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.filter = 'none';
  g.clearRect(0, 0, w, h);
  return c;
}

// Blur a full-frame canvas cheaply: blur at half size, then scale back up.
export function drawBlurred(ctx, src, r) {
  const w = src.width, h = src.height;
  const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
  const small = scratch(hw, hh, 1);
  const g = small.getContext('2d');
  g.filter = `blur(${(r / 2).toFixed(2)}px)`;
  g.drawImage(src, 0, 0, hw, hh);
  g.filter = 'none';
  ctx.drawImage(small, 0, 0, w, h);
}

// ---------- Frosted glass (blurred wallpaper behind title bars) ----------

const glassCache = new WeakMap();
export function glassOf(wp) {
  if (!canFilter) return null;
  let g = glassCache.get(wp.canvas);
  if (g) return g;
  const sw = Math.max(1, Math.round(wp.canvas.width / 6)), sh = Math.max(1, Math.round(wp.canvas.height / 6));
  const c = makeCanvas(sw, sh);
  const x = c.getContext('2d');
  x.filter = 'blur(6px) saturate(1.5)';
  x.drawImage(wp.canvas, 0, 0, sw, sh);
  g = { canvas: c, pad: wp.pad, w: wp.canvas.width, h: wp.canvas.height };
  glassCache.set(wp.canvas, g);
  return g;
}

// ---------- Depth of field ----------

// Overlays stay sharp and never become the focus.
const OVERLAYS = new Set(['notification', 'facecam', 'callout', 'prompt', 'spotlight', 'wipe']);

// The window the camera is looking at: topmost one under the centre of the shot.
export function focusIndex(items, cam) {
  for (let i = items.length - 1; i >= 0; i--) {
    const { layer, s } = items[i];
    if (OVERLAYS.has(layer.type) || s.opacity < 0.5) continue;
    const w = s.w * s.scale, h = s.h * s.scale, x = s.x + (s.w - w) / 2, y = s.y + (s.h - h) / 2;
    if (cam.cx >= x && cam.cx <= x + w && cam.cy >= y && cam.cy <= y + h) return i;
  }
  return -1;
}

// How strong the background blur is (0..1): more as the camera pushes in.
export const depthAmount = (look, zoom) => (look?.depth || 0) * clamp((zoom - 1.03) / 0.55, 0, 1);

// ---------- Vignette + grain (frame space) ----------

let grainTile = null;
function grain() {
  if (grainTile) return grainTile;
  const N = 256;
  const c = makeCanvas(N, N);
  const g = c.getContext('2d');
  const img = g.createImageData(N, N);
  let seed = 987654321;
  for (let i = 0; i < N * N; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const v = (seed / 0x7fffffff) - 0.5; // -0.5..0.5: darker or lighter speck
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v > 0 ? 255 : 0;
    img.data[i * 4 + 3] = Math.round(Math.abs(v) * 2 * 255);
  }
  g.putImageData(img, 0, 0);
  grainTile = c;
  return c;
}

// The vignette is drawn once (at a quarter size; it is smooth) and reused.
let vig = null;
function vignetteImage(W, H) {
  if (vig && vig.key === `${W}x${H}`) return vig.canvas;
  const w = Math.max(1, W >> 2), h = Math.max(1, H >> 2);
  const c = makeCanvas(w, h), g = c.getContext('2d');
  const r = Math.hypot(w, h) / 2;
  const v = g.createRadialGradient(w / 2, h / 2, r * 0.45, w / 2, h / 2, r * 1.02);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(0.6, 'rgba(0,0,0,0.12)');
  v.addColorStop(1, 'rgba(0,0,0,0.42)');
  g.fillStyle = v; g.fillRect(0, 0, w, h);
  vig = { key: `${W}x${H}`, canvas: c };
  return c;
}

export function drawFinish(ctx, project, t, fast = false) {
  const look = project.look;
  if (!look) return;
  const { W, H } = outSize(project);
  if (look.contrast > 0) {
    // Punchier tones: blend the frame onto itself in soft-light (a gentle S-curve:
    // darks get deeper, lights brighter, mid-grey stays put).
    const src = ctx.canvas, copy = scratch(src.width, src.height, 'contrast');
    copy.getContext('2d').drawImage(src, 0, 0);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = Math.min(1, look.contrast);
    ctx.drawImage(copy, 0, 0);
    // A faint warm grade, like the reference's footage.
    ctx.globalAlpha = Math.min(1, look.contrast) * 0.5;
    ctx.fillStyle = '#ffb070';
    ctx.fillRect(0, 0, src.width, src.height);
    // Keep the darkest UI greys from crushing to pure black (the reference never does).
    ctx.globalCompositeOperation = 'lighten';
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgb(21,21,25)';
    ctx.fillRect(0, 0, src.width, src.height);
    ctx.restore();
  }
  if (look.vignette > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, look.vignette / 0.6);
    ctx.drawImage(vignetteImage(W, H), 0, 0, W, H);
    ctx.restore();
  }
  if (look.grain > 0 && !fast) {
    const tile = grain();
    // Fixed grain, not dancing: the reference holds ~23% of its frames perfectly still, and
    // per-frame grain makes every frame change (it also turns to blocky mush on YouTube).
    const ox = 0, oy = 0;
    ctx.save();
    ctx.globalAlpha = 0.12 * look.grain;
    const pat = ctx.createPattern(tile, 'repeat');
    pat.setTransform?.(new DOMMatrix().translate(-ox, -oy).scale(1.5));
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}
