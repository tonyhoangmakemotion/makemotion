// MakeMotion project model: plain JSON data + keyframe helpers.
// Rule: the project is pure data. Rendering reads it; the editor changes it.

export const FPS = 30;

export const EASINGS = {
  smooth: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  out: (p) => 1 - Math.pow(1 - p, 3),
  in: (p) => p * p * p,
  back: (p) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); },
  spring: (p) => (p >= 1 ? 1 : 1 - Math.exp(-6 * p) * Math.cos(4.5 * Math.PI * p)),
  linear: (p) => p,
  hold: () => 0,
};
export const EASE_LABELS = {
  smooth: 'Smooth', out: 'Ease out', in: 'Ease in', back: 'Overshoot', spring: 'Spring',
  linear: 'Linear', hold: 'Hold, then jump',
};

export const LAYER_PROPS = ['x', 'y', 'w', 'h', 'opacity', 'scale'];
export const CAMERA_PROPS = ['cx', 'cy', 'zoom'];
export const CURSOR_PROPS = ['x', 'y'];

export const snapTime = (t) => Math.round(t * FPS) / FPS;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Sample keyframes at time t. Each key: { t, ease, span?, ...props }.
// The ease on key B shapes the segment from key A to key B. `span: [u0, u1]` means the
// segment uses only that part of the ease curve (set when a move is cut in two, so the
// motion stays exactly the same). Two keys on the same time = a hard jump at that time.
export function easeAt(key, raw) {
  const E = EASINGS[key.ease] || EASINGS.smooth;
  if (!key.span) return E(raw);
  const [u0, u1] = key.span, e0 = E(u0), e1 = E(u1);
  if (Math.abs(e1 - e0) < 1e-9) return key.ease === 'hold' ? 0 : raw;
  return (E(u0 + raw * (u1 - u0)) - e0) / (e1 - e0);
}

export function sample(keys, t, props) {
  const out = {};
  if (!keys || keys.length === 0) return out;
  if (t <= keys[0].t) { for (const p of props) out[p] = keys[0][p]; return out; }
  const last = keys[keys.length - 1];
  if (t >= last.t) { for (const p of props) out[p] = last[p]; return out; }
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
  const a = keys[i], b = keys[i + 1];
  const span = b.t - a.t;
  const raw = span > 0 ? (t - a.t) / span : 1;
  const e = easeAt(b, raw);
  for (const p of props) out[p] = a[p] + (b[p] - a[p]) * e;
  return out;
}

// Set values at time t: update the key at t, or insert one that starts from
// the current sampled state (so other props don't jump).
export function upsertKey(keys, t, values, props) {
  t = snapTime(t);
  // findLast: at a hard jump (two keys on one time) the later key is the one you see.
  let k = keys.findLast((key) => Math.abs(key.t - t) < 1e-4);
  if (!k) {
    k = { t, ease: 'smooth', ...sample(keys, t, props) };
    keys.push(k);
    keys.sort((a, b) => a.t - b.t);
  }
  Object.assign(k, values);
  return k;
}

// A window exists from its first keyframe on, inside its trim range (layer.in / layer.out).
export const layerAlive = (l, t) => l.keys.length > 0 && t >= l.keys[0].t && t >= (l.in ?? -Infinity) && t < (l.out ?? Infinity);

export const keyAt = (keys, t) => keys.findLast((k) => Math.abs(k.t - snapTime(t)) < 1e-4) || null;

export function removeKey(keys, key) {
  if (keys.length <= 1) return false;
  const i = keys.indexOf(key);
  if (i >= 0) keys.splice(i, 1);
  return i >= 0;
}

let idCounter = 0;
export const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${(idCounter++).toString(36)}`;

// ---------- Enter / exit presets ----------

const PRESET_FROM = {
  pop: (s) => ({ opacity: 0, scale: 0.86 }),
  slide: (s) => ({ opacity: 0, y: s.y + 70, scale: 1 }),
  fade: (s) => ({ opacity: 0 }),
};

// Window appears at t: nothing before t, animates to its current look.
export function applyEnter(layer, t, kind) {
  t = snapTime(t);
  const dur = kind === 'fade' ? 0.4 : 0.55;
  const target = sample(layer.keys, t + dur, LAYER_PROPS);
  if (target.opacity < 0.05) target.opacity = 1;
  if (target.scale < 0.5) target.scale = 1;
  layer.keys = layer.keys.filter((k) => k.t > t + dur + 1e-4);
  layer.keys.unshift(
    { t, ease: 'smooth', ...target, ...PRESET_FROM[kind](target) },
    { t: snapTime(t + dur), ease: kind === 'pop' ? 'spring' : 'out', ...target },
  );
}

// Window leaves at t: holds its look until t, then animates out.
export function applyExit(layer, t, kind) {
  t = snapTime(t);
  const dur = kind === 'fade' ? 0.4 : 0.45;
  const from = sample(layer.keys, t, LAYER_PROPS);
  layer.keys = layer.keys.filter((k) => k.t < t - 1e-4);
  layer.keys.push(
    { t, ease: 'smooth', ...from },
    { t: snapTime(t + dur), ease: 'in', ...from, ...PRESET_FROM[kind](from), ...(kind === 'pop' ? { scale: 0.9 } : {}) },
  );
}

// ---------- Content parsing (text formats used by the inspector) ----------

// Chat script: one message per line, "2.5 them: Hello" or "4 me: Hi".
// Extras: a sender name for group chats "3 them(Panda): Skill issue",
// a reaction at the end "Nice {👍}", and a date line "5 -- Today 9:41 AM".
export function parseChatScript(text) {
  const msgs = [];
  for (const line of text.split('\n')) {
    const sep = line.match(/^\s*(\d+(?:\.\d+)?)\s+--\s*(.+)$/);
    if (sep) { msgs.push({ t: parseFloat(sep[1]), from: 'sep', text: sep[2].trim() }); continue; }
    const m = line.match(/^\s*(\d+(?:\.\d+)?)\s+(me|them)(?:\(([^)]*)\))?\s*:\s*(.+)$/i);
    if (!m) continue;
    const msg = { t: parseFloat(m[1]), from: m[2].toLowerCase(), text: m[4].trim() };
    if (m[3]?.trim()) msg.name = m[3].trim();
    const r = msg.text.match(/^(.*?)\s*\{([^}]+)\}\s*$/);
    if (r && r[1]) { msg.text = r[1]; msg.react = r[2].trim(); }
    msgs.push(msg);
  }
  return msgs.sort((a, b) => a.t - b.t);
}
export const chatScriptToText = (msgs) => msgs.map((m) => (m.from === 'sep'
  ? `${+m.t.toFixed(2)} -- ${m.text}`
  : `${+m.t.toFixed(2)} ${m.from}${m.name ? `(${m.name})` : ''}: ${m.text}${m.react ? ` {${m.react}}` : ''}`)).join('\n');

// Search results: "Title | url | snippet" per line.
export function parseResults(text) {
  return text.split('\n').map((l) => l.split('|').map((s) => s.trim()))
    .filter((p) => p[0]).map(([title, url = '', snippet = '']) => ({ title, url, snippet }));
}
export const resultsToText = (rs) => rs.map((r) => `${r.title} | ${r.url} | ${r.snippet}`).join('\n');

export const makeCaption = (start, text = 'New caption') =>
  ({ id: newId('cap'), start: +start.toFixed(2), end: +(start + 2.5).toFixed(2), text });

// Add a caption at t without overlapping others. Inside an existing caption,
// it splits that caption at t; otherwise it fills the gap up to 2.5s.
export function insertCaption(project, t) {
  t = +snapTime(clamp(t, 0, project.duration - 0.3)).toFixed(2);
  const caps = project.captions;
  const inside = caps.find((c) => t > c.start + 0.25 && t < c.end - 0.25);
  const cap = makeCaption(t);
  if (inside) {
    cap.end = inside.end;
    inside.end = t;
  } else {
    const next = caps.filter((c) => c.start >= t).sort((a, b) => a.start - b.start)[0];
    cap.end = +Math.min(project.duration, t + 2.5, next ? next.start : Infinity).toFixed(2);
    if (cap.end - cap.start < 0.5) cap.end = +Math.min(project.duration, cap.start + 0.5).toFixed(2);
  }
  caps.push(cap);
  caps.sort((a, b) => a.start - b.start);
  return cap;
}

