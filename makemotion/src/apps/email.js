// Email inbox: a new email can arrive, then open in the reading pane.

import { roundRect, UI_FONT, wrapText, avatar, colorFor } from './draw.js';
import { EASINGS, clamp } from '../model.js';

export function parseInbox(text) {
  return String(text).split('\n').map((l) => l.split('|').map((s) => s.trim())).filter((p) => p[0])
    .map(([from, subject = '', preview = '']) => ({ from, subject, preview }));
}
const inboxToText = (rows) => rows.map((r) => `${r.from} | ${r.subject} | ${r.preview}`).join('\n');

function draw(ctx, area, d, t) {
  const { x, y, w, h } = area;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, w, h);
  const side = Math.min(170, w * 0.2), listW = Math.min(340, w * 0.36);
  ctx.fillStyle = '#f3f4f7';
  ctx.fillRect(x, y, side, h);
  roundRect(ctx, x + 14, y + 16, side - 28, 38, 12);
  ctx.fillStyle = '#d8e3ff'; ctx.fill();
  ctx.fillStyle = '#1f2a44';
  ctx.font = `600 13px ${UI_FONT}`;
  ctx.fillText('Compose', x + 30, y + 40);
  const arrived = d.arriveAt == null || t >= d.arriveAt;
  ['Inbox', 'Starred', 'Sent', 'Drafts', 'Spam'].forEach((f, i) => {
    const fy = y + 84 + i * 34;
    if (i === 0) { roundRect(ctx, x + 6, fy - 20, side - 12, 30, 15); ctx.fillStyle = '#e1e7f5'; ctx.fill(); }
    ctx.fillStyle = '#333';
    ctx.font = `${i === 0 ? 600 : 400} 13px ${UI_FONT}`;
    ctx.fillText(f, x + 22, fy);
    if (i === 0) { ctx.textAlign = 'right'; ctx.fillText(String((d.inbox?.length || 0) + (arrived ? 1 : 0)), x + side - 18, fy); ctx.textAlign = 'left'; }
  });

  // List
  const lx = x + side;
  ctx.fillStyle = '#e6e7eb';
  ctx.fillRect(lx + listW, y, 1, h);
  const items = [...(d.inbox || [])];
  const fresh = { from: d.from, subject: d.subject, preview: (d.body || '').split('\n')[0], fresh: true };
  const k = d.arriveAt == null ? 1 : EASINGS.out(clamp((t - d.arriveAt) / 0.4, 0, 1));
  const rowH = 74;
  let ry = y + (arrived ? 0 : -rowH) + (arrived ? -(1 - k) * rowH : 0);
  const opened = d.openAt != null && t >= d.openAt;
  [fresh, ...items].forEach((r, i) => {
    if (i === 0 && !arrived) { ry += rowH; return; }
    if (i === 0) { ctx.save(); ctx.globalAlpha = k; }
    if (i === 0 && opened) { ctx.fillStyle = '#e8f0fe'; ctx.fillRect(lx, ry, listW, rowH); }
    else if (i === 0) { ctx.fillStyle = '#fffbe6'; ctx.fillRect(lx, ry, listW, rowH); }
    ctx.fillStyle = '#ececf0';
    ctx.fillRect(lx, ry + rowH - 1, listW, 1);
    const unread = i === 0 && !opened;
    if (unread) { ctx.beginPath(); ctx.arc(lx + 12, ry + 24, 4, 0, Math.PI * 2); ctx.fillStyle = '#1a73e8'; ctx.fill(); }
    ctx.fillStyle = '#111';
    ctx.font = `${unread ? 700 : 500} 14px ${UI_FONT}`;
    ctx.fillText(r.from, lx + 24, ry + 28, listW - 90);
    ctx.font = `400 12px ${UI_FONT}`;
    ctx.fillStyle = '#777';
    ctx.textAlign = 'right'; ctx.fillText(i === 0 ? 'now' : `${9 + i}:0${i}`, lx + listW - 14, ry + 28); ctx.textAlign = 'left';
    ctx.fillStyle = '#222';
    ctx.font = `${unread ? 600 : 400} 13px ${UI_FONT}`;
    ctx.fillText(r.subject, lx + 24, ry + 47, listW - 40);
    ctx.fillStyle = '#777';
    ctx.font = `400 12px ${UI_FONT}`;
    ctx.fillText(r.preview, lx + 24, ry + 64, listW - 40);
    if (i === 0) ctx.restore();
    ry += rowH;
  });

  // Reading pane
  const rx = lx + listW + 32, rw = w - (rx - x) - 32;
  if (!opened) {
    ctx.fillStyle = '#9aa0a6';
    ctx.font = `400 14px ${UI_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('Select a message to read', rx + rw / 2, y + h / 2);
    ctx.textAlign = 'left';
    return;
  }
  const ok = EASINGS.out(clamp((t - d.openAt) / 0.3, 0, 1));
  ctx.save();
  ctx.globalAlpha = ok; ctx.translate(0, (1 - ok) * 10);
  ctx.fillStyle = '#111';
  ctx.font = `600 22px ${UI_FONT}`;
  let yy = y + 50;
  for (const line of wrapText(ctx, d.subject || '', rw)) { ctx.fillText(line, rx, yy); yy += 28; }
  yy += 14;
  avatar(ctx, rx + 18, yy + 8, 18, d.from || '?', colorFor(d.from || '?'));
  ctx.font = `600 14px ${UI_FONT}`;
  ctx.fillStyle = '#111';
  ctx.fillText(d.from || '', rx + 46, yy + 4, rw - 50);
  ctx.font = `400 12px ${UI_FONT}`;
  ctx.fillStyle = '#777';
  ctx.fillText(`to me · ${d.fromAddress || ''}`, rx + 46, yy + 22, rw - 50);
  yy += 62;
  ctx.font = `400 15px ${UI_FONT}`;
  ctx.fillStyle = '#222';
  for (const para of String(d.body || '').split('\n')) {
    for (const line of wrapText(ctx, para, rw)) { ctx.fillText(line, rx, yy); yy += 23; }
    yy += 10;
  }
  ctx.restore();
}

export const app = {
  type: 'email', label: 'Email', group: 'Messaging', chip: 'mail', size: [1080, 620], chrome: 'window',
  blurb: 'Inbox where a new email arrives',
  title: () => 'Inbox',
  defaults: (t0) => ({
    from: 'No Reply', fromAddress: 'unknown@protonmail.com', subject: 'You should not have looked.',
    body: 'We know you opened the file.\nDelete it before midnight.',
    arriveAt: +(t0 + 1).toFixed(2), openAt: +(t0 + 2.6).toFixed(2),
    inbox: [
      { from: 'Jonas', subject: 'Re: launch party', preview: 'Bring the speakers, I got snacks' },
      { from: 'Bank', subject: 'Your statement is ready', preview: 'View your monthly statement' },
      { from: 'Mom', subject: 'Call me back', preview: 'Did you eat today?' },
    ],
  }),
  times: ['arriveAt', 'openAt'],
  fields: [
    { key: 'from', type: 'text', label: 'New email from' },
    { key: 'fromAddress', type: 'text', label: 'Sender address' },
    { key: 'subject', type: 'text', label: 'Subject' },
    { key: 'body', type: 'textarea', label: 'Email text', rows: 4 },
    { key: 'arriveAt', type: 'time', label: 'Arrives at' },
    { key: 'openAt', type: 'time', label: 'Opens at' },
    { key: 'inbox', type: 'script', label: 'Older emails: <code>from | subject | preview</code>', rows: 4, parse: parseInbox, format: inboxToText },
  ],
  draw,
};
