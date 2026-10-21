// Sketch: a white card where a quick hand-drawn doodle draws itself, stroke by stroke
// (the "sent a drawing" / reaction-doodle beat). Pure function of t.

import { UI_FONT } from './draw.js';
import { clamp } from '../model.js';

// Strokes in a 0..1 box: arrays of [x, y] points.
const arc = (cx, cy, rx, ry, a0, a1, n = 24) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * (i / n); return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]; });
const DRAWINGS = {
  facepalm: [
    arc(0.5, 0.42, 0.17, 0.22, Math.PI * 0.95, Math.PI * 2.75),            // head
    [[0.36, 0.62], [0.3, 0.95]], [[0.64, 0.62], [0.72, 0.95]],               // shoulders
    [[0.2, 0.95], [0.25, 0.6], [0.33, 0.38], [0.42, 0.3], [0.5, 0.33]],     // arm up
    [[0.42, 0.3], [0.47, 0.22], [0.55, 0.2]], [[0.44, 0.34], [0.55, 0.3]], [[0.46, 0.4], [0.56, 0.38]], // fingers
    arc(0.56, 0.56, 0.06, 0.03, 0.1, Math.PI - 0.1, 10),                     // mouth
  ],
  stickman: [
    arc(0.3, 0.3, 0.08, 0.1, 0, Math.PI * 2),
    [[0.3, 0.4], [0.3, 0.68]], [[0.3, 0.68], [0.22, 0.9]], [[0.3, 0.68], [0.38, 0.9]],
    [[0.3, 0.5], [0.45, 0.58]], [[0.45, 0.58], [0.55, 0.56]],
    [[0.5, 0.4], [0.88, 0.4], [0.88, 0.68], [0.5, 0.68], [0.5, 0.4]],       // laptop screen
    [[0.46, 0.72], [0.92, 0.72]],
    arc(0.69, 0.56, 0.04, 0.025, Math.PI + 0.2, Math.PI * 2 - 0.2, 8),      // sad face on screen
    [[0.64, 0.5], [0.645, 0.505]], [[0.74, 0.5], [0.745, 0.505]],
  ],
  fish: [
    arc(0.48, 0.5, 0.26, 0.17, 0, Math.PI * 2, 32),
    [[0.22, 0.5], [0.08, 0.32], [0.08, 0.68], [0.22, 0.5]],
    arc(0.64, 0.45, 0.025, 0.025, 0, Math.PI * 2, 10),
    arc(0.48, 0.5, 0.08, 0.12, -Math.PI / 2, Math.PI / 2, 10),
    [[0.85, 0.3], [0.9, 0.22]], [[0.9, 0.35], [0.97, 0.3]],
  ],
  rocket: [
    [[0.5, 0.08], [0.62, 0.3], [0.62, 0.68], [0.38, 0.68], [0.38, 0.3], [0.5, 0.08]],
    arc(0.5, 0.38, 0.05, 0.05, 0, Math.PI * 2, 14),
    [[0.38, 0.55], [0.26, 0.74], [0.38, 0.68]], [[0.62, 0.55], [0.74, 0.74], [0.62, 0.68]],
    [[0.44, 0.7], [0.47, 0.86], [0.5, 0.76], [0.53, 0.9], [0.56, 0.7]],
  ],
};

function draw(ctx, area, d, t) {
  const { x, y, w, h } = area;
  ctx.fillStyle = d.paper || '#ffffff';
  ctx.fillRect(x, y, w, h);
  const strokes = DRAWINGS[d.drawing] || DRAWINGS.facepalm;
  const pad = Math.min(w, h) * 0.08, top = d.caption ? 56 : 0;
  const bw = w - pad * 2, bh = h - pad * 2 - top;
  const side = Math.min(bw, bh);
  const ox = x + (w - side) / 2, oy = y + top + pad + (bh - side) / 2;
  if (d.caption) {
    ctx.fillStyle = '#1a1a1a'; ctx.font = `600 ${Math.round(Math.min(26, w / 22))}px ${UI_FONT}`;
    ctx.textAlign = 'center'; ctx.fillText(d.caption, x + w / 2, y + 44, w - 40); ctx.textAlign = 'left';
  }
  // Total ink length, drawn at a steady pace over `dur` seconds.
  const lens = strokes.map((s) => s.reduce((a, p, i) => a + (i ? Math.hypot(p[0] - s[i - 1][0], p[1] - s[i - 1][1]) : 0), 0) + 0.04);
  const total = lens.reduce((a, b) => a + b, 0);
  let ink = clamp((t - (d.start ?? 0)) / Math.max(0.2, d.dur ?? 2.2), 0, 1) * total;
  ctx.strokeStyle = d.ink || '#151515'; ctx.lineWidth = Math.max(2, side / 110); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  let pen = null;
  const P = (p, si, i) => [ox + (p[0] + Math.sin(si * 7.1 + i * 1.3) * 0.004) * side, oy + (p[1] + Math.cos(si * 3.7 + i * 2.1) * 0.004) * side];
  for (let si = 0; si < strokes.length && ink > 0; si++) {
    const s = strokes[si];
    ctx.beginPath();
    let [px, py] = P(s[0], si, 0); ctx.moveTo(px, py); pen = [px, py];
    for (let i = 1; i < s.length; i++) {
      const seg = Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
      const [qx, qy] = P(s[i], si, i);
      if (ink >= seg) { ctx.lineTo(qx, qy); ink -= seg; pen = [qx, qy]; }
      else { const k = ink / seg; pen = [pen[0] + (qx - pen[0]) * k, pen[1] + (qy - pen[1]) * k]; ctx.lineTo(pen[0], pen[1]); ink = 0; break; }
    }
    ctx.stroke();
    ink -= 0.04;
  }
  const done = (t - (d.start ?? 0)) >= (d.dur ?? 2.2);
  if (pen && !done && t >= (d.start ?? 0)) { ctx.fillStyle = d.ink || '#151515'; ctx.beginPath(); ctx.arc(pen[0], pen[1], ctx.lineWidth * 1.4, 0, Math.PI * 2); ctx.fill(); }
}

export const app = {
  type: 'sketch', label: 'Sketch', group: 'Media', chip: 'draw', size: [520, 520], chrome: 'none', shadow: 'soft',
  blurb: 'A doodle that draws itself',
  title: (d) => d.caption || 'Sketch',
  defaults: (t0) => ({ drawing: 'facepalm', caption: '', start: +(t0 + 0.2).toFixed(2), dur: 2.2, ink: '#151515', paper: '#ffffff' }),
  times: ['start'],
  fields: [
    { key: 'drawing', type: 'select', label: 'Drawing', options: [['facepalm', 'Facepalm'], ['stickman', 'Sad stick figure at a laptop'], ['fish', 'Fish'], ['rocket', 'Rocket']] },
    { key: 'caption', type: 'text', label: 'Caption above (optional)' },
    { key: 'start', type: 'time', label: 'Starts drawing at' },
    { key: 'dur', type: 'number', label: 'Drawing takes (seconds)', min: 0.2, max: 10, step: 0.1 },
    { key: 'ink', type: 'color', label: 'Ink' },
    { key: 'paper', type: 'color', label: 'Paper' },
  ],
  draw,
};
