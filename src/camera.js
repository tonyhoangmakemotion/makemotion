// Camera tools: direct control (scroll to zoom, drag to move), live recording of
// a camera move, one-click moves (push in, pull out, pans) and camera shakes.

import { upsertKey, CAMERA_PROPS, clamp, snapTime, newId } from './model.js';
import { cameraAt } from './render.js';
import { PAD } from './wallpapers.js';
import { viewSize, minAutoZoom } from './format.js';
import { S, hooks, changed, toast, fmt } from './store.js';

export const CAM_MIN = 0.8;
export const CAM_MAX = 6;

export const inCameraMode = () => S.sel?.kind === 'camera';
export const isCamRecording = () => !!rec;

// Keep the shot on the desktop (a little slack so edges can be framed).
export function clampCam(c) {
  const P = S.project;
  const z = clamp(c.zoom, CAM_MIN, CAM_MAX);
  const v = viewSize(P, z), hw = v.w / 2, hh = v.h / 2;
  // Slack past the desktop edge stays inside the painted wallpaper margin (PAD minus room for drift/shake).
  const m = PAD - 50;
  const fit = (v, half, size) => {
    const lo = half - m, hi = size - half + m;
    return lo > hi ? size / 2 : clamp(v, lo, hi);
  };
  return { cx: fit(c.cx, hw, P.width), cy: fit(c.cy, hh, P.height), zoom: z };
}

let rec = null; // { t0, after: [], live: {cx,cy,zoom} }
let commitTimer = 0;

function writeCam(c) {
  c = clampCam(c);
  const values = { cx: Math.round(c.cx), cy: Math.round(c.cy), zoom: +c.zoom.toFixed(3) };
  if (rec) { rec.live = values; S.dirty = true; return; }
  upsertKey(S.project.camera.keys, S.t, values, CAMERA_PROPS);
  S.dirty = true;
  hooks.inspectorValues?.();
  // Many scroll ticks become one undo step.
  clearTimeout(commitTimer);
  commitTimer = setTimeout(() => changed(), 250);
}

const current = () => (rec ? { ...rec.live } : cameraAt(S.project, S.t));

// Zoom the shot toward a desktop point, keeping that point under the pointer.
export function camZoomAt(world, factor) {
  if (S.playing && !rec) hooks.pause();
  const c = current();
  const z2 = clamp(c.zoom * factor, CAM_MIN, CAM_MAX);
  const k = c.zoom / z2;
  writeCam({ cx: world.x - (world.x - c.cx) * k, cy: world.y - (world.y - c.cy) * k, zoom: z2 });
}

export function camPanBy(dx, dy) {
  if (S.playing && !rec) hooks.pause();
  const c = current();
  writeCam({ cx: c.cx + dx, cy: c.cy + dy, zoom: c.zoom });
}

export function camSet(c) { writeCam({ ...current(), ...c }); }

// Frame a rectangle (a window) so it fills most of the shot.
export function camFrame(r, fill = 0.85) {
  const P = S.project;
  const v = viewSize(P);
  writeCam({ cx: r.x + r.w / 2, cy: r.y + r.h / 2, zoom: Math.min(v.w * fill / r.w, v.h * fill / r.h) });
}

// ---------- One-click moves ----------

export const MOVES = {
  push: 'Push in', pull: 'Pull out', left: 'Pan left', right: 'Pan right', up: 'Pan up', down: 'Pan down',
};

export function addMove(kind, dur) {
  hooks.pause();
  const P = S.project, keys = P.camera.keys;
  const t = snapTime(S.t), t1 = snapTime(Math.min(P.duration, t + dur));
  const c = cameraAt(P, t);
  const e = { ...c };
  const step = viewSize(P, c.zoom).w * 0.2;
  if (kind === 'push') e.zoom = c.zoom * 1.3;
  if (kind === 'pull') e.zoom = c.zoom / 1.3;
  if (kind === 'left') e.cx -= step;
  if (kind === 'right') e.cx += step;
  if (kind === 'up') e.cy -= step * 0.6;
  if (kind === 'down') e.cy += step * 0.6;
  P.camera.keys = keys.filter((k) => k.t <= t + 1e-4 || k.t >= t1 - 1e-4);
  upsertKey(P.camera.keys, t, { cx: Math.round(c.cx), cy: Math.round(c.cy), zoom: +c.zoom.toFixed(3) }, CAMERA_PROPS);
  const end = clampCam(e);
  const k1 = upsertKey(P.camera.keys, t1, { cx: Math.round(end.cx), cy: Math.round(end.cy), zoom: +end.zoom.toFixed(3) }, CAMERA_PROPS);
  k1.ease = 'smooth';
  changed({ inspector: true });
  toast(`${MOVES[kind]} from ${fmt(t)} to ${fmt(t1)}`);
}

// Whip pan / hard cut from the current shot to a window at the playhead.
export function transitionTo(rect, kind = 'whip') {
  hooks.pause();
  const P = S.project, keys = P.camera.keys;
  const t = snapTime(S.t);
  const c = cameraAt(P, t);
  const v = viewSize(P);
  const zoom = clamp(Math.min(v.w / (rect.w * 1.2), v.h / (rect.h * 1.25)), minAutoZoom(P), 3.4);
  const end = clampCam({ cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2, zoom });
  const t1 = snapTime(Math.min(P.duration, t + (kind === 'cut' ? 1 / 30 : 0.3)));
  P.camera.keys = keys.filter((k) => k.t <= t + 1e-4 || k.t >= t1 - 1e-4);
  upsertKey(P.camera.keys, t, { cx: Math.round(c.cx), cy: Math.round(c.cy), zoom: +c.zoom.toFixed(3) }, CAMERA_PROPS);
  const k1 = upsertKey(P.camera.keys, t1, { cx: Math.round(end.cx), cy: Math.round(end.cy), zoom: +end.zoom.toFixed(3) }, CAMERA_PROPS);
  k1.ease = kind === 'cut' ? 'hold' : 'smooth';
  changed({ inspector: true });
  toast(kind === 'cut' ? `Cut at ${fmt(t)}` : `Whip pan at ${fmt(t)}`);
}

export function addBlurTransition(dur = 0.8) {
  hooks.pause();
  const b = { id: newId('bl'), t: +S.t.toFixed(2), dur, amount: 1 };
  (S.project.camera.blurs ||= []).push(b);
  changed({ inspector: true });
  toast(`Blur transition at ${fmt(b.t)}`);
}

export function addShake(amount = 1, dur = 0.5) {
  hooks.pause();
  const sh = { id: newId('sh'), t: +S.t.toFixed(2), dur, amount };
  S.project.camera.shakes.push(sh);
  changed({ inspector: true });
  toast(`Camera shake at ${fmt(sh.t)}`);
}

// ---------- Recording a camera move ----------

export function startCamRecording() {
  if (rec) return;
  const P = S.project;
  const t0 = snapTime(S.t >= P.duration - 0.05 ? 0 : S.t);
  S.t = t0;
  const c = cameraAt(P, t0);
  rec = {
    t0,
    after: P.camera.keys.filter((k) => k.t > t0 + 1e-4).map((k) => ({ ...k })),
    live: { cx: Math.round(c.cx), cy: Math.round(c.cy), zoom: +c.zoom.toFixed(3) },
  };
  P.camera.keys = P.camera.keys.filter((k) => k.t <= t0 + 1e-4);
  upsertKey(P.camera.keys, t0, rec.live, CAMERA_PROPS);
  document.body.classList.add('cam-recording');
  hooks.inspector();
  hooks.play();
  toast('Recording the camera. Scroll and drag over the video. Space stops.');
}

// Called every frame while playing.
export function camTick() {
  if (!rec || !S.playing) return;
  const k = upsertKey(S.project.camera.keys, S.t, rec.live, CAMERA_PROPS);
  k.ease = 'linear';
}

// Douglas-Peucker on (t, cx, cy, zoom): drop keys that a straight line already explains.
function simplify(pts) {
  if (pts.length < 3) return pts;
  const tol = { cx: 6, cy: 6, zoom: 0.008 };
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let worst = -1, wi = -1;
    for (let i = a + 1; i < b; i++) {
      const u = (pts[i].t - pts[a].t) / (pts[b].t - pts[a].t);
      let d = 0;
      for (const p of ['cx', 'cy', 'zoom']) d = Math.max(d, Math.abs(pts[i][p] - (pts[a][p] + (pts[b][p] - pts[a][p]) * u)) / tol[p]);
      if (d > worst) { worst = d; wi = i; }
    }
    if (worst > 1) { keep[wi] = true; stack.push([a, wi], [wi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

export function stopCamRecording() {
  if (!rec) return;
  const P = S.project;
  const t1 = snapTime(S.t);
  camTick();
  const { t0, after } = rec;
  rec = null;
  document.body.classList.remove('cam-recording');
  const inside = P.camera.keys.filter((k) => k.t >= t0 - 1e-4 && k.t <= t1 + 1e-4).sort((a, b) => a.t - b.t);
  const before = P.camera.keys.filter((k) => k.t < t0 - 1e-4);
  // Smooth the hand movement (centered moving average, ~0.4s), then thin it out.
  const R = 6;
  const smooth = inside.map((k, i) => {
    const out = { t: k.t, ease: 'linear' };
    for (const p of ['cx', 'cy', 'zoom']) {
      let s = 0, n = 0;
      for (let j = Math.max(0, i - R); j <= Math.min(inside.length - 1, i + R); j++) { s += inside[j][p]; n++; }
      out[p] = p === 'zoom' ? +(s / n).toFixed(3) : Math.round(s / n);
    }
    return out;
  });
  const kept = simplify(smooth);
  if (kept.length) { kept[0].ease = inside[0]?.ease || 'smooth'; if (kept.length > 1) kept[1].ease = 'smooth'; }
  P.camera.keys = [...before, ...kept, ...after.filter((k) => k.t > t1 + 0.3)].sort((a, b) => a.t - b.t);
  changed({ inspector: true });
  toast(`Camera move recorded: ${fmt(t0)} to ${fmt(t1)}, ${kept.length} keyframes`);
}
