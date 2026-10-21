// Map: a search box types a place, the map zooms in, a pin drops, an info card slides in.

import { roundRect, UI_FONT, typed, caretOn, wrapText, shadowScale } from './draw.js';
import { EASINGS, clamp } from '../model.js';

function rng(seed) {
  let a = seed | 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function drawWorld(ctx, seed) {
  const r = rng(seed);
  const R = 1600;
  ctx.fillStyle = '#eef0e6';
  ctx.fillRect(-R, -R, R * 2, R * 2);
  // Water along one side
  ctx.fillStyle = '#a9d3e3';
  ctx.beginPath();
  ctx.moveTo(R * 0.25, -R);
  for (let y = -R; y <= R; y += 200) ctx.lineTo(R * 0.25 + Math.sin(y * 0.004 + seed) * 120 + r() * 40, y);
  ctx.lineTo(R, R); ctx.lineTo(R, -R); ctx.closePath(); ctx.fill();
  // Parks
  ctx.fillStyle = '#c9e7b3';
  for (let i = 0; i < 9; i++) {
    const px = -R + r() * R * 1.2, py = -R + r() * R * 2;
    ctx.beginPath(); ctx.ellipse(px, py, 60 + r() * 140, 40 + r() * 90, r() * 3, 0, Math.PI * 2); ctx.fill();
  }
  // Blocks
  ctx.fillStyle = '#e3e5dc';
  for (let i = 0; i < 90; i++) ctx.fillRect(-R + r() * R * 1.25, -R + r() * R * 2, 30 + r() * 70, 30 + r() * 70);
  // Minor roads
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 9;
  for (let i = -8; i <= 8; i++) {
    const off = i * 170 + r() * 50, a = 0.12 * (r() - 0.5);
    ctx.beginPath(); ctx.moveTo(-R, off); ctx.lineTo(R * 0.3, off + a * R); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(off - 300, -R); ctx.lineTo(off - 300 + a * R, R); ctx.stroke();
  }
  // Highways
  ctx.lineCap = 'round';
  for (let i = 0; i < 2; i++) {
    const y0 = -R + r() * R * 2, y1 = -R + r() * R * 2;
    ctx.strokeStyle = '#e7b54a'; ctx.lineWidth = 22;
    ctx.beginPath(); ctx.moveTo(-R, y0); ctx.quadraticCurveTo(0, (y0 + y1) / 2 + 200, R * 0.3, y1); ctx.stroke();
    ctx.strokeStyle = '#fbd96f'; ctx.lineWidth = 15; ctx.stroke();
  }
  ctx.lineCap = 'butt';
}

function draw(ctx, area, d, t) {
  const { x, y, w, h } = area;
  const pinAge = t - d.pinAt;
  const zk = EASINGS.smooth(clamp((t - (d.pinAt - 1.4)) / 1.4, 0, 1));
  const zoom = 0.35 + (1.15 - 0.35) * zk;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.translate(x + w * 0.6, y + h * 0.55);
  ctx.scale(zoom, zoom);
  drawWorld(ctx, d.seed || 3);
  ctx.restore();

  // Pin
  if (pinAge >= 0) {
    const drop = EASINGS.back(clamp(pinAge / 0.45, 0, 1));
    const px = x + w * 0.6, py = y + h * 0.55 - (1 - drop) * 80;
    ctx.save();
    ctx.globalAlpha = clamp(pinAge / 0.15, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath(); ctx.ellipse(x + w * 0.6, y + h * 0.55 + 2, 10 * drop, 4 * drop, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8453c';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.bezierCurveTo(px - 4, py - 14, px - 18, py - 22, px - 18, py - 36);
    ctx.arc(px, py - 36, 18, Math.PI, 0);
    ctx.bezierCurveTo(px + 18, py - 22, px + 4, py - 14, px, py);
    ctx.fill();
    ctx.fillStyle = '#7a1510';
    ctx.beginPath(); ctx.arc(px, py - 36, 6.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // Search box
  const q = typed(d.query || '', d.queryStart, d.cps || 14, t);
  roundRect(ctx, x + 18, y + 16, Math.min(380, w - 36), 46, 23);
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.18)'; ctx.shadowBlur = (8) * shadowScale(ctx); ctx.shadowOffsetY = (2) * shadowScale(ctx);
  ctx.fillStyle = '#fff'; ctx.fill(); ctx.restore();
  ctx.font = `400 15px ${UI_FONT}`;
  ctx.fillStyle = q ? '#202124' : '#80868b';
  ctx.fillText(q || 'Search maps', x + 40, y + 45, Math.min(380, w - 36) - 50);
  if (t >= d.queryStart && t < d.pinAt && caretOn(t)) {
    ctx.fillStyle = '#202124';
    ctx.fillRect(x + 42 + ctx.measureText(q).width, y + 29, 1.5, 20);
  }

  // Info card
  if (pinAge > 0.3) {
    const k = EASINGS.out(clamp((pinAge - 0.3) / 0.45, 0, 1));
    const cw = Math.min(360, w * 0.42), cx = x + 18 - (1 - k) * (cw + 30), cy = y + 76;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.2)'; ctx.shadowBlur = (16) * shadowScale(ctx); ctx.shadowOffsetY = (4) * shadowScale(ctx);
    roundRect(ctx, cx, cy, cw, Math.min(h - 96, 260), 14);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.restore();
    const g = ctx.createLinearGradient(cx, cy, cx + cw, cy + 100);
    g.addColorStop(0, '#7fb7d9'); g.addColorStop(1, '#d9c27f');
    ctx.save(); roundRect(ctx, cx, cy, cw, 100, 14); ctx.clip(); ctx.fillStyle = g; ctx.fillRect(cx, cy, cw, 100); ctx.restore();
    ctx.fillStyle = '#202124';
    ctx.font = `500 20px ${UI_FONT}`;
    ctx.fillText(d.place || '', cx + 18, cy + 134, cw - 36);
    ctx.font = `400 14px ${UI_FONT}`;
    ctx.fillStyle = '#70757a';
    const stars = '★★★★★'.slice(0, Math.round(d.rating || 4));
    ctx.fillText(`${(d.rating || 4.4).toFixed(1)}`, cx + 18, cy + 160);
    ctx.fillStyle = '#fbbc04';
    ctx.fillText(stars, cx + 46, cy + 160);
    ctx.fillStyle = '#70757a';
    ctx.fillText(`(${d.reviews || 299})`, cx + 52 + ctx.measureText(stars).width, cy + 160);
    ctx.fillText(d.kind || '', cx + 18, cy + 184, cw - 36);
    ctx.fillStyle = '#188038';
    wrapText(ctx, d.hours || '', cw - 36).slice(0, 1).forEach((l) => ctx.fillText(l, cx + 18, cy + 208));
  }
}

export const app = {
  type: 'map', label: 'Map', group: 'Web', chip: 'map', size: [960, 600], chrome: 'window',
  blurb: 'Search a place, pin drops',
  title: (d) => `${d.place} - Maps`,
  defaults: (t0) => ({
    query: 'Playa Marbella', place: 'Playa Marbella', kind: 'Tourist attraction', hours: 'Open 24 hours',
    rating: 4.4, reviews: 299, seed: 3,
    queryStart: +(t0 + 0.5).toFixed(2), cps: 12, pinAt: +(t0 + 2.8).toFixed(2),
  }),
  times: ['queryStart', 'pinAt'],
  fields: [
    { key: 'query', type: 'text', label: 'Search text' },
    { key: 'place', type: 'text', label: 'Place name' },
    { key: 'kind', type: 'text', label: 'Type of place' },
    { key: 'hours', type: 'text', label: 'Opening hours' },
    { key: 'rating', type: 'number', label: 'Rating', min: 1, max: 5, step: 0.1 },
    { key: 'queryStart', type: 'time', label: 'Typing starts' },
    { key: 'pinAt', type: 'time', label: 'Pin drops' },
    { key: 'seed', type: 'number', label: 'Map layout (try 1 to 20)', min: 1, max: 999 },
  ],
  draw,
};
