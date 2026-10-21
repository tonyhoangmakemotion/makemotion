// A notification banner (chromeless). Animate it in/out with Enter/Exit presets.

import { roundRect, UI_FONT, appIcon, wrapText } from './draw.js';

function draw(ctx, area, d) {
  const { x, y, w, h } = area;
  const dark = d.theme !== 'light';
  roundRect(ctx, x, y, w, h, 20);
  ctx.fillStyle = dark ? 'rgba(38,38,44,0.94)' : 'rgba(246,246,248,0.96)';
  ctx.fill();
  ctx.strokeStyle = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'; ctx.lineWidth = 1; ctx.stroke();
  const s = Math.min(46, h - 30);
  appIcon(ctx, x + 16, y + (h - s) / 2, s, d.color || '#2fb35a', (d.app || 'A')[0].toUpperCase());
  const tx = x + 30 + s, tw = w - (tx - x) - 18;
  ctx.font = `500 12px ${UI_FONT}`;
  ctx.fillStyle = dark ? '#a0a0a8' : '#6e6e73';
  ctx.fillText((d.app || '').toUpperCase(), tx, y + 24, tw - 50);
  ctx.textAlign = 'right';
  ctx.fillText(d.time || 'now', x + w - 18, y + 24);
  ctx.textAlign = 'left';
  ctx.font = `600 15px ${UI_FONT}`;
  ctx.fillStyle = dark ? '#fff' : '#111';
  ctx.fillText(d.title || '', tx, y + 46, tw);
  ctx.font = `400 14px ${UI_FONT}`;
  ctx.fillStyle = dark ? '#d8d8de' : '#333';
  wrapText(ctx, d.body || '', tw).slice(0, Math.max(1, Math.floor((h - 56) / 19))).forEach((l, i) => ctx.fillText(l, tx, y + 66 + i * 19, tw));
}

export const app = {
  type: 'notification', label: 'Notification', group: 'Messaging', chip: 'ntf', size: [440, 104], chrome: 'none', shadow: 'soft',
  blurb: 'Banner that pops in',
  title: (d) => d.title,
  defaults: () => ({ app: 'Messages', title: 'Unknown number', body: 'I know what you did.', time: 'now', theme: 'dark', color: '#2fb35a' }),
  enter: 'slide',
  times: [],
  fields: [
    { key: 'app', type: 'text', label: 'App name' },
    { key: 'title', type: 'text', label: 'Title' },
    { key: 'body', type: 'text', label: 'Message' },
    { key: 'time', type: 'text', label: 'Time label' },
    { key: 'color', type: 'color', label: 'Icon color' },
    { key: 'theme', type: 'select', label: 'Look', options: [['dark', 'Dark'], ['light', 'Light']] },
    { type: 'note', text: 'Tip: use Enter "Slide up" and Exit "Fade" to make it pop in and leave.' },
  ],
  draw,
};
