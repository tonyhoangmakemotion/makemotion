// Social post / testimonial card with like and repost counters that count up.

import { roundRect, UI_FONT, wrapText, avatar, colorFor, drawCover, getMediaSafe, fitText, shadowScale } from './draw.js';
import { EASINGS, clamp } from '../model.js';
import { countUp } from './dashboard.js';

function draw(ctx, area, d, t) {
  const { x, y, w, h } = area;
  const dark = d.theme === 'dark';
  const fg = dark ? '#e7e9ea' : '#0f1419', muted = dark ? '#71767b' : '#536471';
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = (40) * shadowScale(ctx); ctx.shadowOffsetY = (14) * shadowScale(ctx);
  roundRect(ctx, x, y, w, h, 20); ctx.fillStyle = dark ? '#000000' : '#ffffff'; ctx.fill();
  ctx.restore();
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 20); ctx.strokeStyle = dark ? '#2f3336' : '#e6ecf0'; ctx.lineWidth = 1; ctx.stroke();
  const pad = 26, av = 52;
  const m = getMediaSafe(d.avatarId);
  if (m?.el) {
    ctx.save(); ctx.beginPath(); ctx.arc(x + pad + av / 2, y + pad + av / 2, av / 2, 0, Math.PI * 2); ctx.clip();
    drawCover(ctx, m.el, x + pad, y + pad, av, av); ctx.restore();
  } else avatar(ctx, x + pad + av / 2, y + pad + av / 2, av / 2, d.name, colorFor(d.name));
  const nx = x + pad + av + 14;
  ctx.fillStyle = fg; ctx.font = `700 17px ${UI_FONT}`;
  const name = fitText(ctx, d.name, w - (nx - x) - 80);
  ctx.fillText(name, nx, y + pad + 22);
  if (d.verified) {
    const vx = nx + ctx.measureText(name).width + 14, vy = y + pad + 16;
    ctx.beginPath(); ctx.arc(vx, vy, 9, 0, Math.PI * 2); ctx.fillStyle = '#1d9bf0'; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(vx - 4, vy); ctx.lineTo(vx - 1, vy + 3); ctx.lineTo(vx + 4.5, vy - 3.5); ctx.stroke();
  }
  ctx.fillStyle = muted; ctx.font = `400 15px ${UI_FONT}`;
  ctx.fillText(`${d.handle}`, nx, y + pad + 44);
  ctx.fillStyle = fg; ctx.font = `400 ${d.big ? 24 : 19}px ${UI_FONT}`;
  const lh = d.big ? 33 : 27;
  const lines = wrapText(ctx, d.text, w - pad * 2);
  const maxLines = Math.max(1, Math.floor((h - pad * 2 - av - 70) / lh));
  lines.slice(0, maxLines).forEach((l, i) => ctx.fillText(l, x + pad, y + pad + av + 34 + i * lh));
  ctx.fillStyle = muted; ctx.font = `400 14px ${UI_FONT}`;
  ctx.fillText(d.time || '', x + pad, y + h - 64);
  ctx.fillStyle = dark ? '#2f3336' : '#eff3f4'; ctx.fillRect(x + pad, y + h - 50, w - pad * 2, 1);
  const p = EASINGS.out(clamp((t - d.countStart) / 2.2, 0, 1));
  const liked = t >= d.countStart + 0.6;
  const stats = [['↩', d.replies], ['⟲', d.reposts], [liked ? '♥' : '♡', d.likes]];
  ctx.font = `500 15px ${UI_FONT}`;
  stats.forEach(([icon, v], i) => {
    const sx = x + pad + i * ((w - pad * 2) / 3), sy = y + h - 20;
    const pop = i === 2 && liked ? 1 + 0.35 * Math.max(0, 1 - (t - d.countStart - 0.6) / 0.25) : 1;
    ctx.save();
    ctx.translate(sx + 8, sy - 5); ctx.scale(pop, pop); ctx.translate(-(sx + 8), -(sy - 5));
    ctx.fillStyle = i === 2 && liked ? '#f91880' : muted;
    ctx.fillText(icon, sx, sy);
    ctx.restore();
    ctx.fillStyle = i === 2 && liked ? '#f91880' : muted;
    ctx.fillText(countUp(v || '0', p), sx + 26, sy);
  });
}

export const app = {
  type: 'social', label: 'Social post', group: 'Web', chip: 'post', size: [640, 330], chrome: 'none',
  blurb: 'Testimonial post with counting likes',
  title: (d) => d.name, enter: 'pop',
  defaults: (t0) => ({
    name: 'Mara Lindqvist', handle: '@maramakes', verified: true, avatarId: null, theme: 'light', big: false,
    text: 'Just made our whole launch video in one evening. No After Effects, no tears. This is the tool I wanted for years.',
    time: '9:41 PM · Oct 18, 2026', replies: '214', reposts: '1,280', likes: '12.4k', countStart: +(t0 + 0.4).toFixed(2),
  }),
  times: ['countStart'],
  fields: [
    { key: 'name', type: 'text', label: 'Name' },
    { key: 'handle', type: 'text', label: 'Handle' },
    { key: 'verified', type: 'check', label: 'Verified badge' },
    { key: 'avatarId', type: 'media', accept: 'image', label: 'Profile photo (optional)' },
    { key: 'text', type: 'textarea', label: 'Post text', rows: 4 },
    { key: 'time', type: 'text', label: 'Date line' },
    { key: 'replies', type: 'text', label: 'Replies' },
    { key: 'reposts', type: 'text', label: 'Reposts' },
    { key: 'likes', type: 'text', label: 'Likes' },
    { key: 'countStart', type: 'time', label: 'Numbers count up at' },
    { key: 'theme', type: 'select', label: 'Look', options: [['light', 'Light'], ['dark', 'Dark']] },
    { key: 'big', type: 'check', label: 'Bigger text' },
  ],
  draw,
};
