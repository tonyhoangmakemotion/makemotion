// A phone with a text conversation, great for "text story" videos.
// Chromeless: the phone body is the window.

import { roundRect, UI_FONT, avatar, colorFor } from './draw.js';
import { drawConversation, LIGHT, DARK, someoneTyping, messageFields } from './chat.js';

function draw(ctx, area, data, t) {
  const { x, y, w, h } = area;
  const dark = data.theme === 'dark';
  const th = dark ? DARK : LIGHT;
  const r = Math.min(w, h) * 0.13;

  // Body + screen
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = '#0b0b0d'; ctx.fill();
  ctx.strokeStyle = '#3a3a40'; ctx.lineWidth = 3; ctx.stroke();
  const b = Math.max(8, w * 0.035);
  const sx = x + b, sy = y + b, sw = w - b * 2, sh = h - b * 2;
  ctx.save();
  roundRect(ctx, sx, sy, sw, sh, r - b * 0.8);
  ctx.clip();
  ctx.fillStyle = th.bg; ctx.fillRect(sx, sy, sw, sh);

  // Status bar
  const fg = dark ? '#fff' : '#000';
  ctx.fillStyle = fg;
  ctx.font = `600 ${Math.round(sw * 0.042)}px ${UI_FONT}`;
  ctx.fillText(data.clock || '9:41', sx + sw * 0.1, sy + sw * 0.085);
  // signal bars + battery
  for (let i = 0; i < 4; i++) ctx.fillRect(sx + sw * 0.72 + i * 6, sy + sw * 0.075 - i * 3, 4, 4 + i * 3);
  roundRect(ctx, sx + sw * 0.82, sy + sw * 0.05, sw * 0.08, sw * 0.04, 4);
  ctx.strokeStyle = fg; ctx.lineWidth = 1.4; ctx.stroke();
  ctx.fillRect(sx + sw * 0.825, sy + sw * 0.055, sw * 0.055, sw * 0.03);
  // Island
  roundRect(ctx, sx + sw * 0.34, sy + sw * 0.03, sw * 0.32, sw * 0.08, sw * 0.04);
  ctx.fillStyle = '#000'; ctx.fill();

  // Header
  const hy = sy + sw * 0.15, hh = sw * 0.28;
  ctx.fillStyle = dark ? '#1c1c1e' : '#f6f6f8';
  ctx.fillRect(sx, hy, sw, hh);
  ctx.fillStyle = dark ? '#2c2c2e' : '#dcdce0';
  ctx.fillRect(sx, hy + hh - 1, sw, 1);
  ctx.strokeStyle = '#0a84ff'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(sx + 26, hy + hh * 0.3); ctx.lineTo(sx + 16, hy + hh * 0.42); ctx.lineTo(sx + 26, hy + hh * 0.54); ctx.stroke();
  avatar(ctx, sx + sw / 2, hy + hh * 0.38, sw * 0.075, data.contact, colorFor(data.contact));
  ctx.fillStyle = fg;
  ctx.font = `500 ${Math.round(sw * 0.036)}px ${UI_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(data.contact, sx + sw / 2, hy + hh * 0.82, sw * 0.7);
  if (someoneTyping(data, t)) {
    ctx.fillStyle = th.meta;
    ctx.font = `400 ${Math.round(sw * 0.028)}px ${UI_FONT}`;
    ctx.fillText('typing…', sx + sw / 2, hy + hh * 0.97);
  }
  ctx.textAlign = 'left';

  drawConversation(ctx, { x: sx, y: hy + hh, w: sw, h: sh - (hy + hh - sy) - sw * 0.05 }, data, t, th);
  // Home indicator
  roundRect(ctx, sx + sw * 0.33, sy + sh - sw * 0.035, sw * 0.34, 5, 3);
  ctx.fillStyle = dark ? '#fff' : '#111'; ctx.fill();
  ctx.restore();
}

export const app = {
  type: 'phone', label: 'Phone chat', group: 'Messaging', chip: 'tel', size: [400, 820], chrome: 'none',
  blurb: 'Text conversation on a phone',
  title: (d) => d.contact,
  defaults: (t0) => ({
    contact: 'Mara', theme: 'light', clock: '23:47',
    messages: [
      { t: +(t0 + 1).toFixed(2), from: 'them', text: 'did you see what he posted' },
      { t: +(t0 + 2.6).toFixed(2), from: 'me', text: 'no?? send it' },
      { t: +(t0 + 4.4).toFixed(2), from: 'them', text: 'check your email. now.' },
    ],
  }),
  times: ['messages.*.t'],
  regions: () => [],
  fields: [
    { key: 'contact', type: 'text', label: 'Contact name' },
    { key: 'theme', type: 'select', label: 'Look', options: [['light', 'Light'], ['dark', 'Dark']] },
    { key: 'clock', type: 'text', label: 'Clock in the status bar' },
    ...messageFields,
  ],
  draw,
};
