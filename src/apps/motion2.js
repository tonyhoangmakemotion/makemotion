// More motion-design windows for launch videos:
// - spotlight: dims everything except one area, glow ring + label (point at one control in your UI)
// - metrics: a chain of value pills joined by arrow + rate chips (2.7K Clicks → 5.5% → 110 Leads)
// - wipe: a full-frame sweep (accent, light or iridescent) that bridges two scenes without a cut

import { UI_FONT, roundRect, shadowScale } from './draw.js';
import { EASINGS, clamp } from '../model.js';
import { hexA } from './motion.js';

const out = EASINGS.out;

// ---------- Spotlight ----------
function drawSpotlight(ctx, area, d, t) {
  const { x, y, w, h } = area;
  const a = t - (d.start ?? 0);
  if (a < 0) return;
  const k = out(clamp(a / 0.45, 0, 1));
  const accent = d.accent || '#f4f4f6';
  const R = Math.min(d.radius ?? 14, w / 2, h / 2);
  ctx.save();
  // Dim everything else (a huge rect with this window cut out).
  ctx.beginPath();
  ctx.rect(x - 6000, y - 6000, w + 12000, h + 12000);
  roundRect(ctx, x, y, w, h, R);
  ctx.fillStyle = `rgba(0,0,0,${(d.dim ?? 0.55) * k})`;
  ctx.fill('evenodd');
  // Glow ring, gently pulsing.
  const pulse = d.pulse === false ? 1 : 0.85 + 0.15 * Math.sin(a * 4);
  ctx.globalAlpha = k;
  ctx.shadowColor = accent; ctx.shadowBlur = 36 * pulse * shadowScale(ctx);
  roundRect(ctx, x, y, w, h, R);
  ctx.strokeStyle = accent; ctx.lineWidth = 3; ctx.stroke();
  ctx.shadowBlur = 0;
  roundRect(ctx, x, y, w, h, R);
  ctx.fillStyle = hexA(accent, 0.08 * k); ctx.fill();
  if (d.label) {
    const fs = d.labelSize || 22;
    ctx.font = `600 ${fs}px ${UI_FONT}`;
    const lw = ctx.measureText(d.label).width + fs * 1.2, lh = fs * 1.7;
    const ly = d.labelBelow ? y + h + 14 : y - lh - 14;
    const lk = out(clamp((a - 0.2) / 0.4, 0, 1));
    ctx.globalAlpha = lk;
    roundRect(ctx, x, ly + (1 - lk) * 10, lw, lh, lh * 0.3);
    ctx.fillStyle = accent; ctx.fill();
    ctx.fillStyle = d.labelText || '#0b0b0d'; ctx.textBaseline = 'middle';
    ctx.fillText(d.label, x + fs * 0.6, ly + (1 - lk) * 10 + lh / 2 + 1);
  }
  ctx.restore();
}

export const spotlightApp = {
  type: 'spotlight', label: 'Spotlight', group: 'Launch', chip: 'spot', size: [420, 120], chrome: 'none',
  blurb: 'Dim the rest, glow around one part of your UI',
  title: (d) => d.label || 'Spotlight',
  defaults: (t0) => ({ label: 'Track conversions', start: +(t0 + 0.1).toFixed(2), dim: 0.55, accent: '#f4f4f6', labelText: '#0b0b0d', radius: 14, labelBelow: false, pulse: true, labelSize: 22 }),
  times: ['start'],
  fields: [
    { type: 'note', text: 'Place and size this box over the part of a window you want people to look at.' },
    { key: 'label', type: 'text', label: 'Label (optional)' },
    { key: 'start', type: 'time', label: 'Appears at' },
    { key: 'dim', type: 'number', label: 'Darken the rest (0 to 0.9)', min: 0, max: 0.9, step: 0.05 },
    { key: 'accent', type: 'color', label: 'Glow colour' },
    { key: 'labelText', type: 'color', label: 'Label text colour' },
    { key: 'radius', type: 'number', label: 'Corner radius', min: 0, max: 200 },
    { key: 'labelBelow', type: 'check', label: 'Label below the box' },
    { key: 'pulse', type: 'check', label: 'Pulse' },
  ],
  draw: drawSpotlight,
};

// ---------- Metric chain ----------
// "2.7K Clicks > 5.5% > 110 Leads > 0% > 28 Calls": values become pills, % become arrow chips.
export function parseChain(s) {
  return String(s || '').split('>').map((p) => p.trim()).filter(Boolean).map((p) => (/^[\d.,]+\s*%$/.test(p) ? { kind: 'rate', text: p } : { kind: 'value', text: p }));
}

function drawMetrics(ctx, area, d, t) {
  const { x, y, w, h } = area;
  const items = parseChain(d.chain);
  if (!items.length) return;
  const fs = d.size || 44;
  const accent = d.accent || '#f4f4f6';
  const step = d.step ?? 0.45;
  const pillH = fs * 1.7, chipW = fs * 1.9, chipH = fs * 2.3, gap = fs * 0.25;
  ctx.save();
  ctx.font = `600 ${fs}px ${UI_FONT}`;
  const ws = items.map((it) => (it.kind === 'rate' ? chipW : ctx.measureText(it.text).width + fs * 1.1));
  // Where each item starts, and how far the whole chain has slid so the newest stays in view.
  const xs = []; let acc = 0;
  ws.forEach((wi, i) => { xs.push(acc); acc += wi + gap; });
  const ks = items.map((_, i) => out(clamp((t - (d.start ?? 0) - i * step) / 0.4, 0, 1)));
  let shown = 0; ks.forEach((k, i) => { if (k > 0) shown = xs[i] + ws[i] * k; });
  const slide = Math.max(0, shown - w);
  // A chain shorter than its box sits in the middle of it.
  const total = acc - gap, off = total < w ? (w - total) / 2 : 0;
  const cy = y + h / 2;
  ctx.beginPath(); ctx.rect(x - 4, y - chipH, w + 8, h + chipH * 2); ctx.clip();
  items.forEach((it, i) => {
    const k = ks[i];
    if (k <= 0) return;
    const ix = x + off + xs[i] - slide;
    ctx.save();
    ctx.globalAlpha = k;
    ctx.translate(ix + ws[i] / 2, cy); ctx.scale(0.7 + 0.3 * k, 0.7 + 0.3 * k); ctx.translate(-ws[i] / 2, 0);
    if (it.kind === 'rate') {
      roundRect(ctx, 0, -chipH / 2, chipW, chipH, fs * 0.3); ctx.fillStyle = accent; ctx.fill();
      ctx.strokeStyle = d.chipText || '#0b0b0d'; ctx.lineWidth = fs * 0.09; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const ax = chipW / 2, ay = -fs * 0.35;
      ctx.beginPath(); ctx.moveTo(ax - fs * 0.35, ay); ctx.lineTo(ax + fs * 0.35, ay); ctx.moveTo(ax + fs * 0.12, ay - fs * 0.25); ctx.lineTo(ax + fs * 0.37, ay); ctx.lineTo(ax + fs * 0.12, ay + fs * 0.25); ctx.stroke();
      roundRect(ctx, fs * 0.15, fs * 0.12, chipW - fs * 0.3, fs * 0.82, fs * 0.2); ctx.fillStyle = d.dark === false ? '#ffffff' : '#0b0b0d'; ctx.fill();
      ctx.font = `600 ${fs * 0.5}px ${UI_FONT}`; ctx.fillStyle = accent; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(it.text, chipW / 2, fs * 0.54);
    } else {
      roundRect(ctx, 0, -pillH / 2, ws[i], pillH, fs * 0.3);
      ctx.fillStyle = d.dark === false ? '#f2f2f4' : '#121214'; ctx.fill();
      ctx.strokeStyle = d.dark === false ? '#e2e2e6' : '#2a2a30'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = d.dark === false ? '#0b0b0d' : '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(it.text, ws[i] / 2, fs * 0.04);
    }
    ctx.restore();
  });
  ctx.restore();
}

export const metricsApp = {
  type: 'metrics', label: 'Metric chain', group: 'Launch', chip: 'kpi', size: [1500, 200], chrome: 'none',
  blurb: '2.7K Clicks → 5.5% → 110 Leads, sliding in',
  title: (d) => String(d.chain || '').split('>')[0],
  defaults: (t0) => ({ chain: '2.7K Clicks > 5.5% > 110 Leads > 12% > 28 Calls > 41% > 15 Customers', start: +(t0 + 0.1).toFixed(2), step: 0.45, size: 44, accent: '#f4f4f6', chipText: '#0b0b0d', dark: true }),
  times: ['start'],
  fields: [
    { key: 'chain', type: 'textarea', rows: 2, label: 'Chain: values and rates separated by <code>&gt;</code> (a rate ends with %)' },
    { key: 'start', type: 'time', label: 'First item at' },
    { key: 'step', type: 'number', label: 'Seconds between items', min: 0.1, max: 2, step: 0.05 },
    { key: 'size', type: 'number', label: 'Text size', min: 16, max: 120 },
    { key: 'accent', type: 'color', label: 'Accent' },
    { key: 'dark', type: 'check', label: 'Dark pills (off for light backgrounds)' },
  ],
  draw: drawMetrics,
};

// ---------- Wipe ----------
const IRIDESCENT = ['#ffb36b', '#ff7ac6', '#c4a2ff', '#7fd8ff', '#fff1b8', '#ff9a5a'];

function drawWipe(ctx, area, d, t) {
  const { x, y, w, h } = area;
  const dur = Math.max(0.2, d.dur ?? 0.9), at = d.at ?? 0;
  const p = (t - (at - dur / 2)) / dur; // 0 → band enters, 0.5 → fully covered, 1 → gone
  if (p <= 0 || p >= 1) return;
  const e = EASINGS.smooth(p);
  ctx.save();
  // The band is wider than the frame so it fully covers it halfway through.
  const X = x - w * 0.5, W = w * 2, Y = y - h * 0.5, H = h * 2;
  const bandW = W * 0.9;
  const dir = d.direction === 'left' ? -1 : 1;
  const bx = dir > 0 ? lerpN(X - bandW, X + W, e) : lerpN(X + W, X - bandW, e);
  const g = ctx.createLinearGradient(bx, 0, bx + bandW, 0);
  const style = d.style || 'iridescent';
  const cols = style === 'iridescent' ? IRIDESCENT : style === 'light' ? ['#ffffff', '#f4f1ec', '#ffffff'] : [d.color || '#f4f4f6', d.color2 || hexToSoft(d.color || '#f4f4f6'), d.color || '#f4f4f6'];
  g.addColorStop(0, 'rgba(255,255,255,0)');
  cols.forEach((c, i) => g.addColorStop(0.12 + (0.76 * i) / (cols.length - 1), c));
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(bx, Y, bandW, H);
  // A soft wash over everything at the midpoint hides the change underneath.
  const wash = 1 - Math.abs(p - 0.5) * 2;
  ctx.globalAlpha = clamp(wash * 1.4 - 0.2, 0, 1);
  ctx.fillStyle = style === 'iridescent' ? '#ffd9c2' : style === 'light' ? '#ffffff' : (d.color || '#f4f4f6');
  ctx.fillRect(X, Y, W, H);
  ctx.restore();
}
const lerpN = (a, b, k) => a + (b - a) * k;
const hexToSoft = (hex) => hexA(hex, 0.6);

export const wipeApp = {
  type: 'wipe', label: 'Wipe transition', group: 'Launch', chip: 'wipe', size: [1920, 1080], chrome: 'none',
  blurb: 'Colour sweep that hides a scene change',
  title: () => 'Wipe',
  defaults: (t0) => ({ at: +(t0 + 0.5).toFixed(2), dur: 0.9, style: 'iridescent', direction: 'right', color: '#f4f4f6' }),
  times: ['at'],
  fields: [
    { type: 'note', text: 'Put the change between scenes at the middle of the wipe. Keep this window over the whole desktop.' },
    { key: 'at', type: 'time', label: 'Fully covered at' },
    { key: 'dur', type: 'number', label: 'Length (s)', min: 0.2, max: 3, step: 0.1 },
    { key: 'style', type: 'select', label: 'Style', options: [['iridescent', 'Iridescent'], ['light', 'Light'], ['accent', 'Brand colour']] },
    { key: 'color', type: 'color', label: 'Brand colour', when: (d) => d.style === 'accent' },
    { key: 'direction', type: 'select', label: 'Direction', options: [['right', 'Left to right'], ['left', 'Right to left']] },
  ],
  draw: drawWipe,
};
