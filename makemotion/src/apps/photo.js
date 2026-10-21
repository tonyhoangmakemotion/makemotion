// Photo viewer and video player windows for your own media.

import { UI_FONT, drawCover, getMediaSafe, roundRect } from './draw.js';
import { clamp } from '../model.js';

function empty(ctx, x, y, w, h, label) {
  ctx.fillStyle = '#202125';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#4a4c55'; ctx.setLineDash([8, 6]); ctx.lineWidth = 2;
  roundRect(ctx, x + 24, y + 24, w - 48, h - 48, 12); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#9a9ca6';
  ctx.font = `500 15px ${UI_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(label, x + w / 2, y + h / 2);
  ctx.textAlign = 'left';
}

function drawPhoto(ctx, area, d, t) {
  const { x, y, w, h } = area;
  const m = getMediaSafe(d.mediaId);
  if (!m?.el) return empty(ctx, x, y, w, h, 'Choose a photo in the inspector, or drop one on the stage');
  ctx.fillStyle = '#0e0e10';
  ctx.fillRect(x, y, w, h);
  const span = Math.max(0.5, (d.zoomEnd ?? 0) - (d.zoomStart ?? 0));
  const k = d.kenBurns ? clamp((t - (d.zoomStart ?? 0)) / span, 0, 1) : 0;
  drawCover(ctx, m.el, x, y, w, h, { fit: d.fit || 'contain', zoom: 1 + k * 0.18 });
  if (d.caption) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x, y + h - 40, w, 40);
    ctx.fillStyle = '#fff';
    ctx.font = `400 14px ${UI_FONT}`;
    ctx.fillText(d.caption, x + 16, y + h - 15, w - 32);
  }
}

function drawVideo(ctx, area, d, t) {
  const { x, y, w, h } = area;
  const m = getMediaSafe(d.mediaId);
  if (!m?.el) return empty(ctx, x, y, w, h, 'Choose a video in the inspector, or drop one on the stage');
  ctx.fillStyle = '#000';
  ctx.fillRect(x, y, w, h);
  drawCover(ctx, m.el, x, y, w, h - (d.controls ? 44 : 0), { fit: d.fit || 'contain' });
  if (!d.controls) return;
  const dur = m.duration || m.el.duration || 1;
  const pos = d.loop ? (Math.max(0, t - d.videoStart) % dur) : clamp(t - d.videoStart, 0, dur);
  const by = y + h - 44;
  ctx.fillStyle = '#141416';
  ctx.fillRect(x, by, w, 44);
  ctx.fillStyle = '#fff';
  if (t < d.videoStart) { ctx.beginPath(); ctx.moveTo(x + 18, by + 13); ctx.lineTo(x + 18, by + 31); ctx.lineTo(x + 32, by + 22); ctx.fill(); }
  else { ctx.fillRect(x + 18, by + 13, 5, 18); ctx.fillRect(x + 27, by + 13, 5, 18); }
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  ctx.font = `500 12px ${UI_FONT}`;
  ctx.fillText(`${fmt(pos)} / ${fmt(dur)}`, x + 46, by + 27);
  const bx = x + 140, bw = w - 160;
  roundRect(ctx, bx, by + 19, bw, 5, 3); ctx.fillStyle = '#3a3b40'; ctx.fill();
  roundRect(ctx, bx, by + 19, bw * (pos / dur), 5, 3); ctx.fillStyle = '#e5484d'; ctx.fill();
  ctx.beginPath(); ctx.arc(bx + bw * (pos / dur), by + 21.5, 7, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
}

export const photoApp = {
  type: 'photo', label: 'Photo', group: 'Media', chip: 'img', size: [800, 560], chrome: 'window',
  blurb: 'Show your own image',
  title: (d) => getMediaSafe(d.mediaId)?.name || 'Photo',
  defaults: (t0) => ({ mediaId: null, fit: 'contain', caption: '', kenBurns: true, zoomStart: +t0.toFixed(2), zoomEnd: +(t0 + 6).toFixed(2) }),
  times: ['zoomStart', 'zoomEnd'],
  fields: [
    { key: 'mediaId', type: 'media', accept: 'image', label: 'Photo' },
    { key: 'fit', type: 'select', label: 'Fit', options: [['contain', 'Show whole photo'], ['cover', 'Fill the window']] },
    { key: 'kenBurns', type: 'check', label: 'Slow zoom in' },
    { key: 'zoomStart', type: 'time', label: 'Zoom starts', when: (d) => d.kenBurns },
    { key: 'zoomEnd', type: 'time', label: 'Zoom ends', when: (d) => d.kenBurns },
    { key: 'caption', type: 'text', label: 'Caption (optional)' },
  ],
  draw: drawPhoto,
};

export const videoApp = {
  type: 'video', label: 'Video player', group: 'Media', chip: 'vid', size: [880, 560], chrome: 'window',
  blurb: 'Play your own video clip',
  title: (d) => getMediaSafe(d.mediaId)?.name || 'Video',
  defaults: (t0) => ({ mediaId: null, fit: 'contain', controls: true, loop: false, videoStart: +(t0 + 0.4).toFixed(2) }),
  times: ['videoStart'],
  fields: [
    { key: 'mediaId', type: 'media', accept: 'video', label: 'Video' },
    { key: 'videoStart', type: 'time', label: 'Starts playing at' },
    { key: 'fit', type: 'select', label: 'Fit', options: [['contain', 'Show whole video'], ['cover', 'Fill the window']] },
    { key: 'controls', type: 'check', label: 'Show player controls' },
    { key: 'loop', type: 'check', label: 'Loop' },
    { type: 'note', text: 'The video plays muted. To hear it, add the same file to the Music or Sound FX track.' },
  ],
  draw: drawVideo,
};
