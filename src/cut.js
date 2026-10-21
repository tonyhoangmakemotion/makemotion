// Cutting and trimming. Pure functions on the project data, so undo, saving and export just work.
//
// Windows are trimmed non-destructively with optional `layer.in` / `layer.out` (seconds):
// the window is only shown while in <= t < out. Keyframes and content stay untouched,
// so dragging a trimmed edge back out restores what was there.

import { FPS, newId, snapTime, sample, CAMERA_PROPS, CURSOR_PROPS } from './model.js';
import { shiftLayer } from './project.js';
import { APPS } from './apps/index.js';
import { clipLength } from './audio.js';

const EPS = 1e-4;
const MIN_PIECE = 0.1;
const r3 = (v) => +v.toFixed(3);

// Where a window starts and ends on the timeline. `open` = it stays until the end of the video.
export function layerRange(l, duration) {
  const keys = l.keys;
  const first = keys[0]?.t ?? 0, last = keys[keys.length - 1];
  const natural = last && last.opacity > 0.05 ? duration : (last?.t ?? duration);
  const start = Math.max(first, l.in ?? -Infinity);
  const end = Math.min(natural, l.out ?? Infinity);
  return { start, end, open: l.out == null && natural === duration, first, natural };
}

// Trim a window's start or end. Returns the value actually applied.
export function trimLayer(l, edge, t, duration) {
  const { start, end, first, natural } = layerRange(l, duration);
  if (edge === 'start') {
    const v = snapTime(Math.min(Math.max(t, first), end - MIN_PIECE));
    if (v <= first + EPS) delete l.in; else l.in = v;
    return v;
  }
  const v = snapTime(Math.max(Math.min(t, natural), start + MIN_PIECE));
  if (v >= natural - EPS) delete l.out; else l.out = v;
  return v;
}

// ---------- Split ----------

export function splitLayer(project, l, t) {
  const { start, end } = layerRange(l, project.duration);
  t = snapTime(t);
  if (t - start < MIN_PIECE || end - t < MIN_PIECE) return null;
  const copy = JSON.parse(JSON.stringify(l));
  copy.id = newId(l.type);
  copy.name = `${l.name.replace(/ \(\d+\)$/, '')} (2)`;
  l.out = t;
  copy.in = t;
  project.layers.splice(project.layers.indexOf(l) + 1, 0, copy);
  return copy;
}

// Word-by-word captions reveal their words over the caption's original time span
// (wordStart..wordEnd). Pieces of a split or cut caption keep that span, so the words
// carry on where they were instead of starting over.
const keepWords = (c) => { c.wordStart ??= c.start; c.wordEnd ??= c.end; };

export function splitCaption(project, c, t) {
  if (t - c.start < MIN_PIECE || c.end - t < MIN_PIECE) return null;
  keepWords(c);
  const copy = { ...c, id: newId('cap'), start: r3(t) };
  c.end = r3(t);
  project.captions.splice(project.captions.indexOf(c) + 1, 0, copy);
  return copy;
}

export function splitClip(project, c, t) {
  const len = clipLength(c), into = t - c.start;
  if (into < MIN_PIECE || len - into < MIN_PIECE) return null;
  const copy = { ...c, id: newId('au'), start: r3(t), offset: r3((c.offset || 0) + into), dur: r3(len - into) };
  c.dur = r3(into);
  project.audio.splice(project.audio.indexOf(c) + 1, 0, copy);
  return copy;
}

// Split the selected window/caption/clip at t. With no item selected, split everything under t.
// Returns { count, sel } where sel is the new selection (the right-hand piece).
export function splitAt(project, sel, t) {
  const P = project;
  if (sel?.kind === 'layer') {
    const l = P.layers.find((x) => x.id === sel.id);
    const c = l && splitLayer(P, l, t);
    if (c) return { count: 1, sel: { kind: 'layer', id: c.id } };
  }
  if (sel?.kind === 'caption') {
    const cap = P.captions.find((x) => x.id === sel.id);
    const c = cap && splitCaption(P, cap, t);
    if (c) return { count: 1, sel: { kind: 'caption', id: c.id } };
  }
  if (sel?.kind === 'audio' && sel.id) {
    const clip = P.audio.find((x) => x.id === sel.id);
    const c = clip && splitClip(P, clip, t);
    if (c) return { count: 1, sel: { kind: 'audio', id: c.id, track: c.track } };
  }
  // A specific window, caption or clip is selected but the playhead isn't inside it.
  if (sel && (sel.kind === 'layer' || sel.kind === 'caption' || (sel.kind === 'audio' && sel.id))) return { count: 0, sel: null, outside: true };
  let count = 0;
  for (const l of [...P.layers]) if (!l.hidden && splitLayer(P, l, t)) count++;
  for (const c of [...P.captions]) if (splitCaption(P, c, t)) count++;
  for (const c of [...P.audio]) if (splitClip(P, c, t)) count++;
  return { count, sel: null };
}

// ---------- Remove a section of time (ripple cut) ----------

// Map "a.*.b" data paths through fn.
function mapPath(obj, parts, fn) {
  if (!obj) return;
  const [head, ...rest] = parts;
  if (head === '*') { if (Array.isArray(obj)) for (const item of obj) mapPath(item, rest, fn); return; }
  if (!rest.length) { if (typeof obj[head] === 'number') obj[head] = r3(fn(obj[head])); return; }
  mapPath(obj[head], rest, fn);
}
export function mapLayerTimes(l, fn) {
  for (const p of APPS[l.type]?.times || []) mapPath(l.data, p.split('.'), fn);
}

// Where t falls inside a keyframe segment: the key that ends the segment and the point u on
// its ease curve (respecting an existing span). null when t is not strictly inside a segment.
function segmentAt(keys, t) {
  for (let i = 0; i < keys.length - 1; i++) {
    const k0 = keys[i], k1 = keys[i + 1];
    if (t > k0.t + EPS && t < k1.t - EPS) {
      const [s0, s1] = k1.span || [0, 1];
      return { k1, s0, s1, u: s0 + ((t - k0.t) / (k1.t - k0.t)) * (s1 - s0) };
    }
  }
  return null;
}

// Keyframes of a single track (camera, mouse) across a cut from a to b: the motion before a
// and after b stays exactly as it was, with a hard jump at a. Keys after b move earlier.
function cutKeys(keys, a, b, props) {
  if (!keys.length) return keys;
  const d = b - a;
  const first = keys[0].t, last = keys[keys.length - 1].t;
  if (last <= a + EPS) return keys;
  if (first >= b - EPS) return keys.map((k) => ({ ...k, t: +(k.t - d).toFixed(4) }));

  const out = keys.filter((k) => k.t < a - EPS);
  const atA = keys.findLast((k) => Math.abs(k.t - a) < EPS);
  const segA = segmentAt(keys, a);
  const left = { ...sample(keys, a, props), t: snapTime(a), ease: 'smooth' };
  if (atA) { left.ease = atA.ease; if (atA.span) left.span = atA.span; }
  else if (segA) { left.ease = segA.k1.ease; left.span = [segA.s0, segA.u]; }
  out.push(left);
  const right = { ...sample(keys, b, props), t: snapTime(a), ease: 'hold' };
  const same = props.every((p) => Math.abs(right[p] - left[p]) < 1e-6);
  if (!same) out.push(right);

  const segB = segmentAt(keys, b);
  for (const k of keys) {
    if (k.t <= b + EPS) continue;
    const moved = { ...k, t: +(k.t - d).toFixed(4) };
    if (segB && k === segB.k1) moved.span = [segB.u, segB.s1];
    out.push(moved);
  }
  return out;
}

export function removeTime(project, a, b) {
  const P = project;
  a = snapTime(Math.max(0, Math.min(a, b)));
  b = snapTime(Math.min(P.duration, Math.max(a, b)));
  const d = b - a;
  if (d < 1 / FPS) return 0;
  const f = (t) => (t <= a ? t : t >= b ? t - d : a);

  // Windows: a window that spans the cut becomes two pieces, the second one moved earlier,
  // so everything inside it (typing, messages, video) jumps forward too.
  const layers = [];
  for (const l of P.layers) {
    const { start, end } = layerRange(l, P.duration);
    if (end <= a + EPS) { layers.push(l); continue; }
    if (start >= b - EPS) { shiftLayer(l, -d); layers.push(l); continue; }
    if (start >= a - EPS && end <= b + EPS) continue; // fully inside: removed
    if (start < a && end > b) {
      const after = JSON.parse(JSON.stringify(l));
      after.id = newId(l.type);
      after.name = `${l.name.replace(/ \(\d+\)$/, '')} (2)`;
      l.out = a;
      shiftLayer(after, -d);
      after.in = a;
      layers.push(l, after);
    } else if (start < a) {
      l.out = a; layers.push(l);
    } else {
      shiftLayer(l, -d); l.in = a; layers.push(l);
    }
  }
  P.layers = layers;

  P.camera.keys = cutKeys(P.camera.keys, a, b, CAMERA_PROPS);
  P.camera.shakes = (P.camera.shakes || []).filter((s) => s.t <= a || s.t >= b).map((s) => ({ ...s, t: r3(f(s.t)) }));
  P.camera.blurs = (P.camera.blurs || []).filter((s) => s.t <= a || s.t >= b).map((s) => ({ ...s, t: r3(f(s.t)) }));
  P.cursor.keys = cutKeys(P.cursor.keys, a, b, CURSOR_PROPS);
  P.cursor.events = P.cursor.events.filter((e) => e.t <= a || e.t >= b).map((e) => ({ ...e, t: r3(f(e.t)) }));

  const caps = [];
  for (const c0 of P.captions) {
    const c = { ...c0 };
    if (c.end <= a + EPS) { caps.push(c); continue; }
    if (c.start >= b - EPS) {
      caps.push({ ...c, start: r3(c.start - d), end: r3(c.end - d),
        ...(c.wordStart != null ? { wordStart: r3(c.wordStart - d), wordEnd: r3(c.wordEnd - d) } : {}) });
      continue;
    }
    keepWords(c);
    // Part before the cut keeps its timing; part after the cut moves earlier.
    if (c.start < a) caps.push({ ...c, end: r3(a) });
    if (c.end > b) caps.push({ ...c, id: c.start < a ? newId('cap') : c.id, start: r3(a), end: r3(c.end - d), wordStart: r3(c.wordStart - d), wordEnd: r3(c.wordEnd - d) });
  }
  P.captions = caps.filter((c) => c.end - c.start >= MIN_PIECE);

  const audio = [];
  for (const c of P.audio) {
    const len = clipLength(c), s = c.start, e = s + len;
    if (e <= a + EPS) { audio.push(c); continue; }
    if (s >= b - EPS) { audio.push({ ...c, start: r3(s - d) }); continue; }
    if (s < a) audio.push({ ...c, dur: r3(a - s) });
    if (e > b) {
      const skip = Math.max(0, b - s);
      audio.push({ ...c, id: s < a ? newId('au') : c.id, start: r3(Math.max(a, s - d)), offset: r3((c.offset || 0) + skip), dur: r3(e - Math.max(b, s)) });
    }
  }
  P.audio = audio.filter((c) => clipLength(c) >= 0.05);

  P.duration = Math.max(1, r3(P.duration - d));
  return d;
}

// ---------- Video length ----------

// The time the last thing happens, so the video can end right after it.
export function contentEnd(project) {
  const P = project;
  let end = 0;
  const see = (t) => { if (Number.isFinite(t)) end = Math.max(end, t); };
  for (const l of P.layers) {
    if (l.hidden) continue;
    const r = layerRange(l, P.duration);
    if (!r.open) see(r.end);
    l.keys.forEach((k) => see(Math.min(k.t, r.end)));
    mapLayerTimes(l, (t) => { see(Math.min(t, r.end)); return t; });
  }
  P.camera.keys.forEach((k) => see(k.t));
  P.cursor.keys.forEach((k) => see(k.t));
  P.cursor.events.forEach((e) => see(e.t + (e.dur || 0)));
  P.captions.forEach((c) => see(c.end));
  P.audio.forEach((c) => see(c.start + clipLength(c)));
  return end;
}
