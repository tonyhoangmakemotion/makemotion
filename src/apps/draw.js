import { getMedia } from '../media.js';

// Shared canvas helpers for the fake apps.

// Canvas shadows ignore the current transform, so a zoomed-in camera or the smaller editor
// preview would shrink them. Multiply shadow sizes by this to keep them the same in every view.
export const shadowScale = (ctx) => { const m = ctx.getTransform(); return Math.hypot(m.a, m.b) || 1; };

export const UI_FONT = "'Geist', system-ui, -apple-system, 'Segoe UI', sans-serif";
export const MONO_FONT = "'Geist Mono', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace";

export function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Greedy word wrap. Uses the ctx's current font.
export function wrapText(ctx, text, maxW) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width <= maxW || !line) line = test;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

// Blinking caret: visible half of each 1s cycle.
export const caretOn = (t) => t % 1 < 0.55;

// ---------- Human-like typing ----------
// Each character gets a slightly irregular delay, with pauses after
// punctuation and line breaks. Deterministic: same text = same rhythm.

const scheduleCache = new Map();

function hash01(i) {
  let x = Math.imul(i + 1, 0x9e3779b1) ^ 0x85ebca6b;
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  return ((x ^ (x >>> 13)) >>> 0) / 4294967296;
}

export function typingSchedule(text, cps) {
  const key = `${cps}|${text}`;
  let times = scheduleCache.get(key);
  if (times) return times;
  times = new Float32Array(text.length);
  let acc = 0;
  const base = 1 / Math.max(1, cps);
  for (let i = 0; i < text.length; i++) {
    acc += base * (0.55 + 0.9 * hash01(i));
    times[i] = acc;
    const ch = text[i];
    if (ch === '\n') acc += 0.22;
    else if (/[.,;:!?{}()]/.test(ch)) acc += base * 2.2;
  }
  if (scheduleCache.size > 200) scheduleCache.clear();
  scheduleCache.set(key, times);
  return times;
}

export const typingDuration = (text, cps) => {
  const s = typingSchedule(text, cps);
  return s.length ? s[s.length - 1] : 0;
};

// Number of characters visible at time t.
export function typedCount(text, start, cps, t) {
  if (t < start || !text) return 0;
  const s = typingSchedule(text, cps), local = t - start;
  let lo = 0, hi = s.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (s[mid] <= local) lo = mid + 1; else hi = mid; }
  return lo;
}

export const typed = (text, start, cps, t) => text.slice(0, typedCount(text, start, cps, t));

export function avatar(ctx, x, y, r, name, color) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color; ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `600 ${Math.round(r * 0.9)}px ${UI_FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText((name[0] || '?').toUpperCase(), x, y + 1);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}

const AVATAR_COLORS = ['#c0703f', '#5a7fbf', '#7d9a4f', '#a0579c', '#c49a3a', '#4f9a96'];
export const colorFor = (name) => {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
};

// ---------- Media helpers ----------

// Draw an image/video element cover-fitted into a box (optionally mirrored, zoomed).
export function drawCover(ctx, el, x, y, w, h, { mirror = false, zoom = 1, fit = 'cover' } = {}) {
  const iw = el.videoWidth || el.naturalWidth || el.width, ih = el.videoHeight || el.naturalHeight || el.height;
  if (!iw || !ih) return false;
  const s = (fit === 'contain' ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih)) * zoom;
  const dw = iw * s, dh = ih * s;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  if (mirror) { ctx.translate(x + w / 2, 0); ctx.scale(-1, 1); ctx.translate(-(x + w / 2), 0); }
  try { ctx.drawImage(el, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); } catch { /* not decodable yet */ }
  ctx.restore();
  return true;
}

// Soft gradient placeholder with a person silhouette, used before media is added.
// With a time `t` the person is "live": breathes, sways a little, blinks and looks around,
// so an empty webcam still reads as footage instead of a still image.
export function placeholderPerson(ctx, x, y, w, h, name = '', hue = 210, t = null) {
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, `hsl(${hue} 35% 32%)`);
  g.addColorStop(1, `hsl(${(hue + 40) % 360} 40% 18%)`);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  const s = Math.min(w, h);
  const live = typeof t === 'number';
  const seed = hue * 0.37;
  const sway = live ? Math.sin(t * 0.9 + seed) * s * 0.035 + Math.sin(t * 2.3 + seed) * s * 0.008 : 0;
  const bob = live ? Math.sin(t * 1.6 + seed) * s * 0.012 : 0;
  const tilt = live ? Math.sin(t * 0.7 + seed + 1) * 0.06 : 0;
  const hx = x + w / 2 + sway, hy = y + h * 0.42 + bob, hr = s * 0.17;
  ctx.fillStyle = `hsla(${hue} 40% 85% / 0.55)`;
  ctx.beginPath(); ctx.ellipse(x + w / 2 + sway * 0.4, y + h * 0.42 + s * 0.42 + bob * 0.5, s * 0.3, s * 0.24, 0, Math.PI, 0); ctx.fill();
  ctx.save();
  ctx.translate(hx, hy); ctx.rotate(tilt);
  ctx.beginPath(); ctx.arc(0, 0, hr, 0, Math.PI * 2); ctx.fill();
  if (live) {
    // Face: eyes that blink and glance, a small mouth that moves now and then (talking).
    const look = Math.sin(t * 0.5 + seed) > 0.6 ? hr * 0.12 : Math.sin(t * 0.37 + seed) < -0.7 ? -hr * 0.12 : 0;
    const cyc = (t + seed) % 3.7;
    const blink = cyc < 0.12 ? 0.15 : 1;
    ctx.fillStyle = `hsl(${hue} 30% 22%)`;
    for (const ex of [-0.36, 0.36]) {
      ctx.beginPath(); ctx.ellipse(ex * hr + look, -hr * 0.08, hr * 0.1, hr * 0.12 * blink, 0, 0, Math.PI * 2); ctx.fill();
    }
    const talk = Math.max(0, Math.sin(t * 9 + seed)) * (Math.sin(t * 0.8 + seed) > 0 ? 1 : 0.15);
    ctx.beginPath(); ctx.ellipse(look * 0.5, hr * 0.42, hr * 0.2, hr * (0.04 + 0.1 * talk), 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  if (name) {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = `600 ${Math.max(11, Math.round(s * 0.07))}px ${UI_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(name, x + w / 2, y + h * 0.16);
    ctx.textAlign = 'left';
  }
}

export const hueFor = (name) => { let h = 0; for (const ch of name || '') h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };

// Small rounded app icon with a letter.
export function appIcon(ctx, x, y, s, color, letter) {
  roundRect(ctx, x, y, s, s, s * 0.24);
  ctx.fillStyle = color; ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${Math.round(s * 0.5)}px ${UI_FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(letter, x + s / 2, y + s / 2 + 1);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}

// Parse "seconds rest" lines into [{t, text}] (used by several apps).
export function parseTimed(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const m = line.match(/^\s*(\d+(?:\.\d+)?)\s+(.+)$/);
    if (m) out.push({ t: parseFloat(m[1]), text: m[2].trim() });
  }
  return out.sort((a, b) => a.t - b.t);
}
export const timedToText = (items) => items.map((i) => `${+i.t.toFixed(2)} ${i.text}`).join('\n');

export const getMediaSafe = (id) => getMedia(id);

// Cut text to fit a width, ending with an ellipsis (instead of squishing it).
export function fitText(ctx, text, maxW) {
  text = String(text ?? '');
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid; else hi = mid - 1; }
  return text.slice(0, lo).trimEnd() + '…';
}
