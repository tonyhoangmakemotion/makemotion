// Activity grid: a contribution-style grid of days that fills in square by square,
// with a streak counter ("I coded every day for 9 weeks"). Pure function of t.

import { UI_FONT, roundRect } from './draw.js';
import { clamp } from '../model.js';

const rnd = (i) => { const x = Math.sin(i * 91.7 + 17.3) * 43758.5453; return x - Math.floor(x); };

function draw(ctx, area, d, t) {
  const { x, y, w, h } = area;
  ctx.fillStyle = '#16171b';
  ctx.fillRect(x, y, w, h);
  const pad = 26, head = 58;
  const weeks = clamp(Math.round(d.weeks ?? 20), 4, 52);
  const cell = Math.min((w - pad * 2) / weeks, (h - head - pad - 34) / 7);
  const gap = cell * 0.18, sq = cell - gap;
  const gx = x + (w - weeks * cell) / 2, gy = y + head;
  const days = weeks * 7;
  const k = clamp((t - (d.start ?? 0)) / Math.max(0.3, d.dur ?? 2.5), 0, 1);
  const filled = Math.floor(k * days);
  const color = d.color || '#39d353';
  const level = (i) => { const r = rnd(i); return d.intense ? (r < 0.08 ? 1 : r < 0.3 ? 3 : 4) : (r < 0.25 ? 0 : r < 0.5 ? 1 : r < 0.75 ? 2 : r < 0.92 ? 3 : 4); };
  for (let i = 0; i < days; i++) {
    const col = Math.floor(i / 7), row = i % 7;
    const cx = gx + col * cell, cy = gy + row * cell;
    roundRect(ctx, cx, cy, sq, sq, sq * 0.22);
    const lv = i < filled ? level(i) : 0;
    if (lv === 0) { ctx.fillStyle = '#262830'; ctx.fill(); continue; }
    ctx.save();
    // The newest square pops in.
    const age = (k * days - i) / 3;
    const s = age < 1 ? 0.6 + 0.4 * age : 1;
    ctx.translate(cx + sq / 2, cy + sq / 2); ctx.scale(s, s); ctx.translate(-(cx + sq / 2), -(cy + sq / 2));
    roundRect(ctx, cx, cy, sq, sq, sq * 0.22);
    ctx.globalAlpha = [0, 0.3, 0.5, 0.75, 1][lv];
    ctx.fillStyle = color; ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = '#e8e8ea';
  ctx.font = `700 ${Math.round(Math.min(26, w / 30))}px ${UI_FONT}`;
  ctx.fillText(d.heading || 'Hours coded', x + pad, y + 44);
  const streak = Math.max(0, Math.round(filled * (d.intense ? 1 : 0.6)));
  const label = `🔥 ${streak} day streak`;
  ctx.font = `600 ${Math.round(Math.min(20, w / 40))}px ${UI_FONT}`;
  ctx.textAlign = 'right'; ctx.fillStyle = '#ffb547'; ctx.fillText(label, x + w - pad, y + 44); ctx.textAlign = 'left';
  // legend
  const ly = gy + 7 * cell + 10;
  ctx.font = `400 13px ${UI_FONT}`; ctx.fillStyle = '#8b8d96';
  ctx.fillText('Less', x + w - pad - 5 * 16 - 70, ly + 11);
  for (let i = 0; i < 5; i++) {
    roundRect(ctx, x + w - pad - 5 * 16 - 30 + i * 16, ly, 12, 12, 3);
    ctx.fillStyle = i ? color : '#262830'; ctx.globalAlpha = i ? [0, 0.3, 0.5, 0.75, 1][i] : 1; ctx.fill(); ctx.globalAlpha = 1;
  }
  ctx.fillStyle = '#8b8d96'; ctx.fillText('More', x + w - pad - 26, ly + 11);
}

export const app = {
  type: 'streak', label: 'Activity grid', group: 'Work', chip: 'grid', size: [860, 300], chrome: 'window',
  blurb: 'Days filling in, streak counter',
  title: (d) => d.heading || 'Activity',
  defaults: (t0) => ({ heading: 'Hours coded', weeks: 20, start: +(t0 + 0.2).toFixed(2), dur: 2.5, color: '#39d353', intense: false }),
  times: ['start'],
  fields: [
    { key: 'heading', type: 'text', label: 'Heading' },
    { key: 'weeks', type: 'number', label: 'Weeks shown', min: 4, max: 52 },
    { key: 'start', type: 'time', label: 'Starts filling at' },
    { key: 'dur', type: 'number', label: 'Fill takes (seconds)', min: 0.3, max: 20, step: 0.1 },
    { key: 'color', type: 'color', label: 'Color' },
    { key: 'intense', type: 'check', label: 'Obsessed mode (almost every day, mostly dark)' },
  ],
  draw,
};
