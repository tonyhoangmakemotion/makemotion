// Face cam bubble: your photo, video or a placeholder. Glows while your voiceover plays.

import { roundRect, UI_FONT, drawCover, placeholderPerson, getMediaSafe, hueFor, shadowScale } from './draw.js';

function shapePath(ctx, x, y, w, h, shape) {
  if (shape === 'circle') { ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); }
  else roundRect(ctx, x, y, w, h, shape === 'rounded' ? Math.min(w, h) * 0.16 : shape === 'feed' ? 12 : 4);
}

// "h:mm:ss" + seconds → "h:mm:ss"
function clockAt(base, secs) {
  const p = String(base || '0:00:00').split(':').map((n) => parseInt(n, 10) || 0);
  while (p.length < 3) p.unshift(0);
  let total = p[0] * 3600 + p[1] * 60 + p[2] + Math.max(0, Math.floor(secs));
  const hh = Math.floor(total / 3600); total %= 3600;
  return `${hh}:${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// Webcam-feed overlay: title + window dots over the video, recording dot and running clock.
function drawFeedChrome(ctx, x, y, w, h, d, t) {
  const g = ctx.createLinearGradient(0, y, 0, y + 54);
  g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(x, y, w, 54);
  const fs = Math.max(12, Math.round(w * 0.042));
  ctx.font = `600 ${fs}px ${UI_FONT}`; ctx.fillStyle = '#fff';
  ctx.fillText(d.feedTitle || 'Web Cam Feed', x + 14, y + fs + 10, w - 90);
  ['#28c840', '#febc2e', '#ff5f57'].forEach((c, i) => {
    ctx.beginPath(); ctx.arc(x + w - 46 + i * 15, y + fs * 0.65 + 10, 5, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill();
  });
  const by = y + h - 18;
  const blink = Math.floor(t * 1.4) % 2 === 0;
  ctx.beginPath(); ctx.arc(x + 22, by, 8, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.beginPath(); ctx.arc(x + 22, by, 5, 0, Math.PI * 2); ctx.fillStyle = blink ? '#ff3b30' : '#b3261e'; ctx.fill();
  ctx.font = `600 ${Math.max(11, Math.round(fs * 0.85))}px ${UI_FONT}`;
  ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 4 * shadowScale(ctx);
  ctx.fillText(clockAt(d.clock, t - (d.videoStart ?? 0)), x + 36, by + 5);
  ctx.shadowColor = 'transparent';
}

function draw(ctx, area, d, t, env) {
  const { x, y, w, h } = area;
  const level = d.reactive ? env.voiceLevel(t) : 0;
  // Speaking glow
  if (level > 0.02) {
    ctx.save();
    ctx.shadowColor = d.ring || '#7cf29b'; ctx.shadowBlur = (20 + level * 60) * shadowScale(ctx);
    shapePath(ctx, x, y, w, h, d.shape);
    ctx.strokeStyle = d.ring || '#7cf29b'; ctx.lineWidth = 4 + level * 6; ctx.stroke();
    ctx.restore();
  }
  ctx.save();
  shapePath(ctx, x, y, w, h, d.shape);
  ctx.clip();
  const m = getMediaSafe(d.mediaId);
  if (m?.el) {
    ctx.fillStyle = '#000'; ctx.fillRect(x, y, w, h);
    drawCover(ctx, m.el, x, y, w, h, { mirror: d.mirror, zoom: d.zoom || 1 });
  } else {
    placeholderPerson(ctx, x, y, w, h, '', hueFor(d.name), t);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = `500 ${Math.max(11, Math.round(w * 0.05))}px ${UI_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('Add a photo or video', x + w / 2, y + h * 0.9);
    ctx.textAlign = 'left';
  }
  if (d.shape === 'feed') drawFeedChrome(ctx, x, y, w, h, d, t);
  ctx.restore();
  if (d.shape === 'feed') {
    shapePath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 'feed');
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; ctx.stroke();
  } else if (d.border) {
    shapePath(ctx, x, y, w, h, d.shape);
    ctx.strokeStyle = d.borderColor || '#ffffff'; ctx.lineWidth = Math.max(3, w * 0.015); ctx.stroke();
  }
  if (d.showName && d.name && d.shape !== 'feed') {
    ctx.font = `600 ${Math.max(12, Math.round(w * 0.055))}px ${UI_FONT}`;
    const tw = ctx.measureText(d.name).width + 20;
    const ty = d.shape === 'circle' ? y + h - 4 : y + h - 14;
    roundRect(ctx, x + (w - tw) / 2, ty - 24, tw, 28, 14);
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(d.name, x + w / 2, ty - 5);
    ctx.textAlign = 'left';
  }
}

export const app = {
  type: 'facecam', label: 'Face cam', group: 'Media', chip: 'face', size: [320, 320], chrome: 'none', shadow: 'soft',
  blurb: 'Your photo or video in a bubble',
  title: (d) => d.name,
  defaults: (t0) => ({ mediaId: null, shape: 'circle', feedTitle: 'Web Cam Feed', clock: '5:55:00', name: 'Me', showName: false, mirror: false, border: true, borderColor: '#ffffff', ring: '#7cf29b', reactive: true, zoom: 1, videoStart: +t0.toFixed(2), loop: true }),
  times: ['videoStart'],
  fields: [
    { key: 'mediaId', type: 'media', accept: 'image,video', label: 'Photo or video' },
    { key: 'shape', type: 'select', label: 'Shape', options: [['circle', 'Circle'], ['rounded', 'Rounded'], ['square', 'Square'], ['feed', 'Webcam feed window']] },
    { key: 'feedTitle', type: 'text', label: 'Feed title', when: (d) => d.shape === 'feed' },
    { key: 'clock', type: 'text', label: 'Recording clock starts at (h:mm:ss)', when: (d) => d.shape === 'feed' },
    { key: 'zoom', type: 'number', label: 'Zoom', min: 1, max: 3, step: 0.05 },
    { key: 'mirror', type: 'check', label: 'Mirror' },
    { key: 'border', type: 'check', label: 'Border', when: (d) => d.shape !== 'feed' },
    { key: 'borderColor', type: 'color', label: 'Border color', when: (d) => d.border },
    { key: 'reactive', type: 'check', label: 'Glow while my voiceover plays' },
    { key: 'ring', type: 'color', label: 'Glow color', when: (d) => d.reactive },
    { key: 'name', type: 'text', label: 'Name' },
    { key: 'showName', type: 'check', label: 'Show name tag' },
    { key: 'videoStart', type: 'time', label: 'Video starts at', when: (d) => getMediaSafe(d.mediaId)?.kind === 'video' },
    { key: 'loop', type: 'check', label: 'Loop video', when: (d) => getMediaSafe(d.mediaId)?.kind === 'video' },
  ],
  draw,
};
