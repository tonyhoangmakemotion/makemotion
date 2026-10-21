// Auto camera: builds camera keyframes that follow the story, like an editor would.
// Each window gets the shot when it appears (framed with breathing room), the camera slowly
// pushes in while you read it, widens to include pop-ups (notifications, callouts) and
// goes back to the whole desktop when nothing is on screen. Pure: project in, keys out.

import { snapTime, clamp, sample, LAYER_PROPS } from './model.js';
import { layerRange } from './cut.js';
import { viewSize, formatOf, minAutoZoom } from './format.js';

const OVERLAYS = new Set(['notification', 'callout']);
const IGNORE = new Set(['facecam', 'wipe']); // a face cam sits in a corner and never steals the shot
const MOVE = 0.9;      // seconds a camera move takes
const MIN_GAP = 0.7;   // targets closer than this merge
const MAX_ZOOM = 2.4;
const ACTION_BOTTOM = new Set(['agent', 'terminal', 'chat', 'phone', 'notes']);
const NO_PUNCH = new Set(['title', 'stat', 'endcard', 'prompt', 'integrations', 'photo', 'video', 'sentence', 'logoreveal', 'metrics', 'spotlight']);

const rectOf = (s) => {
  const w = s.w * s.scale, h = s.h * s.scale;
  return { x: s.x + (s.w - w) / 2, y: s.y + (s.h - h) / 2, w, h };
};
const union = (a, b) => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

function frameFor(P, r, room = 1) {
  const W = P.width, H = P.height, v = viewSize(P, 1);
  // Landscape leaves room around a window; narrow formats fill their width with it.
  const padW = formatOf(P) === '16:9' ? 1.38 : 1.06;
  const zoom = clamp(Math.min(v.w / (r.w * padW * room), v.h / (r.h * 1.42 * room)), minAutoZoom(P), MAX_ZOOM);
  const hw = v.w / (2 * zoom), hh = v.h / (2 * zoom);
  const fit = (v, half, size) => (half * 2 >= size ? size / 2 : clamp(v, half, size - half));
  return { cx: Math.round(fit(r.x + r.w / 2, hw, W)), cy: Math.round(fit(r.y + r.h / 2, hh, H)), zoom: +zoom.toFixed(3) };
}

export function autoCameraKeys(project) {
  const P = project;
  const full = { x: 0, y: 0, w: P.width, h: P.height };

  // Every regular window is a subject from when it appears until it leaves or fades into the
  // background. A window that travels gets new framings along the way (same subject).
  const subjects = [];
  const pops = [];
  for (const l of P.layers) {
    if (l.hidden || IGNORE.has(l.type)) continue;
    const r = layerRange(l, P.duration);
    if (r.end - r.start < 0.5) continue;
    const settle = Math.min(r.end, r.start + 0.7);
    const at = (t) => sample(l.keys, t, LAYER_PROPS);
    let end = r.end;
    for (let t = settle; t < r.end; t += 0.1) if (at(t).opacity < 0.6) { end = t; break; }
    const frames = [{ t: r.start, rect: rectOf(at(settle)) }];
    for (let t = settle + 0.5; t < end - 0.3; t += 0.25) {
      const rr = rectOf(at(t)), last = frames[frames.length - 1].rect;
      if (Math.hypot(rr.x - last.x, rr.y - last.y) + Math.abs(rr.w - last.w) + Math.abs(rr.h - last.h) > 150) frames.push({ t: t - 0.3, rect: rr });
    }
    (OVERLAYS.has(l.type) ? pops : subjects).push({ start: r.start, end, frames, type: l.type });
  }
  if (!subjects.length && !pops.length) return null;
  const rectAt = (sub, t) => { let r = sub.frames[0].rect; for (const f of sub.frames) if (f.t <= t + 1e-3) r = f.rect; return r; };

  // What the shot shows at time t: the newest open window, together with any windows
  // that arrived with it (a scene), plus pop-ups that are on screen.
  const targetAt = (t) => {
    const open = subjects.filter((x) => x.start <= t + 1e-3 && t < x.end);
    let rect = full, type = null;
    if (open.length) {
      const newest = Math.max(...open.map((x) => x.start));
      const scene = open.filter((x) => x.start >= newest - 1.2);
      rect = scene.map((x) => rectAt(x, t)).reduce(union);
      type = scene.length === 1 ? scene[0].type : null;
    }
    for (const p of pops) if (p.start <= t + 1e-3 && t < p.end) { rect = union(rect, p.frames[0].rect); type = null; }
    return { rect, type };
  };

  // Moments the shot may change.
  const marks = new Set([0]);
  for (const x of [...subjects, ...pops]) { marks.add(x.start); marks.add(x.end); x.frames.forEach((f) => marks.add(f.t)); }
  const targets = [];
  for (const t of [...marks].filter((t) => t >= 0 && t < P.duration).sort((a, b) => a - b)) {
    const { rect, type } = targetAt(t);
    const prev = targets[targets.length - 1];
    if (prev && Math.hypot(prev.rect.x - rect.x, prev.rect.y - rect.y) + Math.abs(prev.rect.w - rect.w) + Math.abs(prev.rect.h - rect.h) < 20) continue;
    if (prev && t - prev.t < MIN_GAP) { prev.rect = rect; prev.type = type; continue; }
    targets.push({ t, rect, type });
  }

  // Don't zoom in on something only to pull out a moment later: if the next shot comes soon
  // and already contains this one, go straight to the next shot.
  const contains = (a, b) => b.x >= a.x - 1 && b.y >= a.y - 1 && b.x + b.w <= a.x + a.w + 1 && b.y + b.h <= a.y + a.h + 1;
  for (let i = targets.length - 2; i >= 0; i--) {
    const a = targets[i], b = targets[i + 1];
    if (b.t - a.t < 1.4 && contains(b.rect, a.rect)) { b.t = a.t; targets.splice(i, 1); }
  }

  // Turn targets into keyframes. How the camera gets to each new shot depends on the style:
  //   smooth: a calm ~0.9s glide      whip: a fast 0.3s whip pan (motion blur sells it)
  //   cut:    a hard cut              mixed: whips and cuts alternate, like an edited devlog
  // While a shot holds, the camera slowly pushes in; in cut/mixed styles long holds also get
  // a punch-in: a cut to a tighter close-up halfway through.
  const style = P.camera.autoStyle || 'smooth';
  const how = (i) => (style === 'mixed' ? (i % 2 ? 'cut' : 'whip') : style);
  const FRAME = 1 / 30;
  const keys = [];
  let cur = null;
  targets.forEach((tg, i) => {
    const next = targets[i + 1]?.t ?? P.duration;
    const f = frameFor(P, tg.rect, tg.type === 'prompt' ? 1.55 : 1);
    if (!cur) {
      keys.push({ t: 0, ease: 'smooth', ...(tg.t <= 0.05 ? f : frameFor(P, full)) });
      cur = keys[0];
      if (tg.t <= 0.05) { hold(tg); return; }
    }
    const t0 = snapTime(Math.max(tg.t, cur.t + 0.05));
    const mode = how(i);
    if (t0 > cur.t + 1e-3) keys.push({ ...cur, t: t0, ease: cur.ease === 'linear' ? 'linear' : 'smooth' });
    if (mode === 'cut') {
      cur = { t: snapTime(t0 + FRAME), ease: 'hold', ...f };
    } else {
      const dur = mode === 'whip' ? 0.3 : MOVE;
      cur = { t: snapTime(Math.min(t0 + dur, Math.max(t0 + 0.2, next - 0.1))), ease: 'smooth', ...f };
    }
    keys.push(cur);
    hold(tg);
  });

  function hold(tg) {
    const i = targets.indexOf(tg);
    const next = targets[i + 1]?.t ?? P.duration;
    const holdEnd = snapTime(next - 0.05);
    const span = holdEnd - cur.t;
    if (span < 1.2) return;
    const punch = (style === 'cut' || style === 'mixed') && span > 2.8 && tg.type && !NO_PUNCH.has(tg.type);
    if (punch) {
      // Hold the wide shot, then cut to a close-up on the upper part of the window
      // (where titles, latest lines and messages usually are).
      const mid = snapTime(cur.t + span * 0.45);
      const z1 = Math.min(MAX_ZOOM * 1.05, cur.zoom * 1.06);
      keys.push(cur = { t: mid, ease: 'linear', cx: cur.cx, cy: cur.cy, zoom: +z1.toFixed(3) });
      const r = tg.rect;
      // Where the action is: the newest lines/messages sit at the bottom of these windows.
      const bottom = ACTION_BOTTOM.has(tg.type);
      const wide = formatOf(P) === '16:9';
      // Narrow formats: the close-up keeps the start of the lines (text reads left to right).
      const close = wide
        ? frameFor(P, { x: r.x + r.w * 0.04, y: r.y + r.h * (bottom ? 0.4 : 0.1), w: r.w * 0.66, h: r.h * 0.55 })
        : frameFor(P, { x: r.x, y: r.y + r.h * (bottom ? 0.4 : 0.1), w: r.w * 0.78, h: r.h * 0.55 });
      if (wide) close.zoom = +Math.min(3.0, Math.max(close.zoom, cur.zoom * 1.35)).toFixed(3);
      else if (close.zoom <= cur.zoom * 1.05) close.zoom = +Math.min(3.0, cur.zoom * 1.15).toFixed(3);
      const cv = viewSize(P, close.zoom), hw = cv.w / 2, hh = cv.h / 2;
      const fitC = (v, half, size) => (half * 2 >= size ? size / 2 : clamp(v, half, size - half));
      close.cx = Math.round(fitC(close.cx, hw, P.width)); close.cy = Math.round(fitC(close.cy, hh, P.height));
      keys.push(cur = { t: snapTime(mid + FRAME), ease: 'hold', ...close });
      keys.push(cur = { t: holdEnd, ease: 'linear', cx: close.cx, cy: close.cy, zoom: +(close.zoom * 1.12).toFixed(3) });
      return;
    }
    const z = Math.min(MAX_ZOOM * 1.05, cur.zoom * (1 + Math.min(0.15, span * 0.04)));
    keys.push(cur = { t: holdEnd, ease: 'linear', cx: cur.cx, cy: cur.cy, zoom: +z.toFixed(3) });
  }

  keys.sort((a, b) => a.t - b.t);
  return keys.filter((k, i) => !(keys[i + 1] && Math.abs(keys[i + 1].t - k.t) < 1e-4));
}
