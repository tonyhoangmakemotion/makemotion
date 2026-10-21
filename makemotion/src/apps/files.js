// File browser: icons in a folder; items can get selected over time.

import { roundRect, UI_FONT, parseTimed, timedToText } from './draw.js';
import { EASINGS, clamp } from '../model.js';

const KIND_COLORS = { folder: '#5aa9f7', image: '#e8a33d', video: '#d9574c', doc: '#6c8cff', zip: '#9a8f86', audio: '#b06ae0', code: '#46b39b' };

function kindOf(name) {
  if (!name.includes('.')) return 'folder';
  const ext = name.split('.').pop().toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'heic'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'avi'].includes(ext)) return 'video';
  if (['zip', 'rar', '7z'].includes(ext)) return 'zip';
  if (['mp3', 'wav', 'm4a'].includes(ext)) return 'audio';
  if (['js', 'py', 'ts', 'lua', 'html'].includes(ext)) return 'code';
  return 'doc';
}

function icon(ctx, kind, x, y, s) {
  const c = KIND_COLORS[kind];
  if (kind === 'folder') {
    roundRect(ctx, x, y + s * 0.12, s * 0.45, s * 0.2, 4); ctx.fillStyle = c; ctx.fill();
    roundRect(ctx, x, y + s * 0.2, s, s * 0.68, 6); ctx.fillStyle = c; ctx.fill();
    roundRect(ctx, x, y + s * 0.3, s, s * 0.58, 6); ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fill();
    return;
  }
  roundRect(ctx, x + s * 0.14, y, s * 0.72, s * 0.92, 5);
  ctx.fillStyle = '#f4f4f6'; ctx.fill();
  ctx.fillStyle = c;
  roundRect(ctx, x + s * 0.14, y + s * 0.58, s * 0.72, s * 0.34, 4); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${Math.round(s * 0.15)}px ${UI_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(kind.toUpperCase().slice(0, 4), x + s / 2, y + s * 0.82);
  ctx.textAlign = 'left';
}

function draw(ctx, area, d, t) {
  const { x, y, w, h } = area;
  ctx.fillStyle = '#1e1f23';
  ctx.fillRect(x, y, w, h);
  const side = Math.min(170, w * 0.22);
  ctx.fillStyle = '#18191c';
  ctx.fillRect(x, y, side, h);
  ctx.font = `600 11px ${UI_FONT}`;
  ctx.fillStyle = '#6e7079';
  ctx.fillText('FAVORITES', x + 16, y + 26);
  ['Desktop', 'Documents', 'Downloads', 'Pictures'].forEach((f, i) => {
    const fy = y + 54 + i * 30;
    if (f === d.path) { roundRect(ctx, x + 8, fy - 19, side - 16, 28, 6); ctx.fillStyle = '#34363d'; ctx.fill(); }
    ctx.fillStyle = '#d6d7dc';
    ctx.font = `400 13px ${UI_FONT}`;
    ctx.fillText(f, x + 20, fy);
  });
  ctx.fillStyle = '#ececf1';
  ctx.font = `600 16px ${UI_FONT}`;
  ctx.fillText(d.path || 'Documents', x + side + 24, y + 32);
  const sel = (d.select || []).filter((s) => s.t <= t).pop();
  const selAge = sel ? t - sel.t : 0;
  const s = 68, cellW = 128, cellH = 122;
  const cols = Math.max(1, Math.floor((w - side - 30) / cellW));
  (d.items || []).forEach((name, i) => {
    const cx = x + side + 24 + (i % cols) * cellW, cy = y + 60 + Math.floor(i / cols) * cellH;
    if (cy > y + h) return;
    const isSel = sel && sel.text === name;
    if (isSel) {
      const k = EASINGS.out(clamp(selAge / 0.15, 0, 1));
      ctx.globalAlpha = k;
      roundRect(ctx, cx - 4, cy - 6, cellW - 16, cellH - 10, 10);
      ctx.fillStyle = '#2f4f86'; ctx.fill();
      ctx.globalAlpha = 1;
    }
    icon(ctx, kindOf(name), cx + (cellW - 16 - s) / 2 - 4, cy + 4, s);
    ctx.font = `400 12px ${UI_FONT}`;
    ctx.fillStyle = '#e8e8ec';
    ctx.textAlign = 'center';
    ctx.fillText(name, cx + (cellW - 16) / 2 - 4, cy + s + 26, cellW - 20);
    ctx.textAlign = 'left';
  });
}

export const app = {
  type: 'files', label: 'Files', group: 'Work', chip: 'file', size: [860, 520], chrome: 'window',
  blurb: 'Folder of files to click through',
  title: (d) => d.path,
  defaults: (t0) => ({
    path: 'Documents',
    items: ['Evidence', 'camera_0312.jpg', 'last_call.m4a', 'map_route.png', 'do_not_open.zip', 'notes.txt', 'clip_final.mp4'],
    select: [{ t: +(t0 + 1.5).toFixed(2), text: 'do_not_open.zip' }],
  }),
  times: ['select.*.t'],
  fields: [
    { key: 'path', type: 'text', label: 'Folder name' },
    { key: 'items', type: 'list', label: 'Files (comma separated; no dot = folder)' },
    { key: 'select', type: 'script', label: 'Select a file at a time: <code>seconds file name</code>', rows: 3, parse: parseTimed, format: timedToText },
  ],
  draw,
};
