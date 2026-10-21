// Game preview: a live, built-in "gameplay" window (a little fishing game) so videos have
// moving footage even before you add your own recordings. Pure function of t.

import { roundRect, UI_FONT } from './draw.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function fish(ctx, x, y, s, color, dir) {
  ctx.save();
  ctx.translate(x, y); ctx.scale(dir * s, s);
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.ellipse(0, 0, 18, 9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(-28, -9); ctx.lineTo(-28, 9); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath(); ctx.ellipse(2, -3, 10, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#10151c';
  ctx.beginPath(); ctx.arc(10, -2, 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function draw(ctx, area, d, t) {
  const { x, y, w, h } = area;
  const k = w / 900; // scale everything with the window
  const speed = d.speed ?? 1;
  const T = t * speed;
  const sea = y + h * 0.42;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();

  // Sky, sun, clouds
  const sky = ctx.createLinearGradient(0, y, 0, sea);
  sky.addColorStop(0, d.night ? '#1b2350' : '#5cb8ff'); sky.addColorStop(1, d.night ? '#5b4a8a' : '#bfe6ff');
  ctx.fillStyle = sky; ctx.fillRect(x, y, w, sea - y);
  ctx.fillStyle = d.night ? '#f4f1d0' : '#fff3a8';
  ctx.beginPath(); ctx.arc(x + w * 0.8, y + h * 0.13, 34 * k, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  for (let i = 0; i < 4; i++) {
    const cx = x + ((rnd(i) * w + T * 18 * k * (1 + i * 0.3)) % (w + 200 * k)) - 100 * k, cy = y + h * (0.08 + rnd(i + 9) * 0.18);
    for (let j = 0; j < 3; j++) { ctx.beginPath(); ctx.ellipse(cx + j * 26 * k, cy - (j === 1 ? 10 * k : 0), 30 * k, 16 * k, 0, 0, Math.PI * 2); ctx.fill(); }
  }
  // Island with a palm tree
  const ix = x + w * 0.16, iy = sea + 4 * k;
  ctx.fillStyle = '#f2d48b'; ctx.beginPath(); ctx.ellipse(ix, iy, 120 * k, 26 * k, 0, Math.PI, 0); ctx.fill();
  ctx.strokeStyle = '#7a5230'; ctx.lineWidth = 9 * k; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(ix, iy - 20 * k); ctx.quadraticCurveTo(ix + 14 * k, iy - 80 * k, ix + 4 * k, iy - 120 * k); ctx.stroke();
  ctx.fillStyle = '#2fae5b';
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i - 2) * 0.6 + Math.sin(T * 1.5 + i) * 0.05;
    ctx.beginPath(); ctx.ellipse(ix + 4 * k + Math.cos(a) * 34 * k, iy - 120 * k + Math.sin(a) * 18 * k + 10 * k, 40 * k, 10 * k, a, 0, Math.PI * 2); ctx.fill();
  }

  // Sea: depth gradient + moving wave bands
  const water = ctx.createLinearGradient(0, sea, 0, y + h);
  water.addColorStop(0, '#1fa2d6'); water.addColorStop(1, '#063a6b');
  ctx.fillStyle = water; ctx.fillRect(x, sea, w, y + h - sea);
  for (let b = 0; b < 3; b++) {
    ctx.fillStyle = `rgba(255,255,255,${0.16 - b * 0.04})`;
    ctx.beginPath(); ctx.moveTo(x, sea + b * 22 * k);
    for (let px = 0; px <= w; px += 12) ctx.lineTo(x + px, sea + b * 22 * k + Math.sin(px / (60 * k) + T * (2 - b * 0.5)) * 5 * k);
    ctx.lineTo(x + w, sea + b * 22 * k + 8 * k); ctx.lineTo(x, sea + b * 22 * k + 8 * k); ctx.closePath(); ctx.fill();
  }
  // Light rays
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < 5; i++) {
    const rx = x + w * (0.1 + i * 0.2) + Math.sin(T * 0.6 + i) * 20 * k;
    ctx.beginPath(); ctx.moveTo(rx, sea); ctx.lineTo(rx + 40 * k, sea); ctx.lineTo(rx + 120 * k, y + h); ctx.lineTo(rx + 40 * k, y + h); ctx.closePath(); ctx.fill();
  }
  // Fish
  const COLORS = ['#ff8a3d', '#ffd23f', '#ff5d8f', '#7cf0b0', '#b48cff'];
  for (let i = 0; i < 9; i++) {
    const dir = i % 2 ? 1 : -1, v = (40 + rnd(i) * 70) * k;
    const span = w + 120 * k;
    let fx = (rnd(i + 3) * span + T * v) % span; if (dir < 0) fx = span - fx;
    const fy = sea + 70 * k + rnd(i + 5) * (y + h - sea - 170 * k) + Math.sin(T * 2 + i) * 6 * k;
    fish(ctx, x + fx - 60 * k, fy, k * (0.8 + rnd(i + 7) * 0.7), COLORS[i % COLORS.length], dir);
  }
  // Bubbles
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5 * k;
  for (let i = 0; i < 14; i++) {
    const life = (T * 0.5 + rnd(i)) % 1;
    const bx = x + rnd(i + 20) * w + Math.sin(T * 3 + i) * 6 * k, by = y + h - life * (y + h - sea);
    ctx.beginPath(); ctx.arc(bx, by, (2 + rnd(i + 30) * 4) * k, 0, Math.PI * 2); ctx.stroke();
  }
  // Boat bobbing, with a fishing line
  const bx = x + w * 0.55, by = sea - 6 * k + Math.sin(T * 2.2) * 5 * k, tilt = Math.sin(T * 1.7) * 0.05;
  ctx.save(); ctx.translate(bx, by); ctx.rotate(tilt);
  ctx.fillStyle = '#c4462f';
  ctx.beginPath(); ctx.moveTo(-80 * k, -18 * k); ctx.lineTo(80 * k, -18 * k); ctx.lineTo(56 * k, 14 * k); ctx.lineTo(-56 * k, 14 * k); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#f4efe6'; ctx.fillRect(-80 * k, -24 * k, 160 * k, 7 * k);
  // fisher
  ctx.fillStyle = '#ffcf9e'; ctx.beginPath(); ctx.arc(-10 * k, -52 * k, 12 * k, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2d6cdf'; roundRect(ctx, -22 * k, -42 * k, 24 * k, 26 * k, 6 * k); ctx.fill();
  ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.ellipse(-10 * k, -62 * k, 16 * k, 5 * k, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#3b2a1a'; ctx.lineWidth = 3 * k;
  ctx.beginPath(); ctx.moveTo(0, -36 * k); ctx.lineTo(70 * k, -96 * k); ctx.stroke();
  ctx.restore();
  const tipX = bx + 70 * k, tipY = by - 96 * k, bobY = sea + 70 * k + Math.sin(T * 3) * 10 * k;
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.2 * k;
  ctx.beginPath(); ctx.moveTo(tipX, tipY); ctx.lineTo(tipX + 10 * k, bobY); ctx.stroke();
  ctx.fillStyle = '#ff4d4d'; ctx.beginPath(); ctx.arc(tipX + 10 * k, bobY, 5 * k, 0, Math.PI * 2); ctx.fill();

  // A fish leaps out of the water every couple of seconds
  const period = 2.4, ph = (T % period) / 0.9;
  if (ph < 1) {
    const n = Math.floor(T / period), jx = x + w * (0.3 + rnd(n) * 0.4);
    const jy = sea - Math.sin(ph * Math.PI) * 90 * k;
    fish(ctx, jx + ph * 90 * k, jy, 1.2 * k, COLORS[n % COLORS.length], 1);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (let i = 0; i < 6; i++) { const a = Math.PI + (i / 5) * Math.PI; ctx.beginPath(); ctx.arc(jx + Math.cos(a) * 20 * k * (1 + ph), sea + Math.sin(a) * 14 * k * ph, 3 * k, 0, Math.PI * 2); ctx.fill(); }
  }

  // HUD
  ctx.font = `800 ${20 * k}px ${UI_FONT}`;
  const title = d.title || 'GoFish';
  const tw = ctx.measureText(title).width;
  roundRect(ctx, x + 16 * k, y + 14 * k, tw + 28 * k, 36 * k, 18 * k); ctx.fillStyle = 'rgba(10,20,40,0.55)'; ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillText(title, x + 30 * k, y + 39 * k);
  const coins = Math.floor((d.coins ?? 1200) + Math.max(0, t - (d.start ?? 0)) * 37);
  const ct = `${coins.toLocaleString('en-US')}`;
  const cw = ctx.measureText(ct).width;
  roundRect(ctx, x + w - cw - 70 * k, y + 14 * k, cw + 54 * k, 36 * k, 18 * k); ctx.fillStyle = 'rgba(10,20,40,0.55)'; ctx.fill();
  ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(x + w - cw - 48 * k, y + 32 * k, 10 * k, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillText(ct, x + w - cw - 30 * k, y + 39 * k);
  // hotbar
  const slots = 5, sw = 54 * k, gap = 8 * k, hx = x + w / 2 - (slots * sw + (slots - 1) * gap) / 2, hy = y + h - sw - 14 * k;
  const sel = Math.floor(T / 1.5) % slots;
  for (let i = 0; i < slots; i++) {
    roundRect(ctx, hx + i * (sw + gap), hy, sw, sw, 10 * k);
    ctx.fillStyle = i === sel ? 'rgba(255,255,255,0.35)' : 'rgba(10,20,40,0.5)'; ctx.fill();
    if (i === sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * k; ctx.stroke(); }
    fish(ctx, hx + i * (sw + gap) + sw / 2 + 4 * k, hy + sw / 2, 0.7 * k, COLORS[i], 1);
  }
  ctx.restore();
}

export const app = {
  type: 'game', label: 'Game preview', group: 'Media', chip: 'game', size: [900, 560], chrome: 'window',
  blurb: 'Live gameplay, built in (no recording needed)',
  title: (d) => `${d.title} (playtest)`,
  defaults: (t0) => ({ title: 'GoFish', coins: 1200, start: t0, speed: 1, night: false }),
  times: ['start'],
  fields: [
    { key: 'title', type: 'text', label: 'Game name' },
    { key: 'coins', type: 'number', label: 'Starting coins', min: 0, max: 999999 },
    { key: 'speed', type: 'number', label: 'Speed', min: 0.25, max: 3, step: 0.25 },
    { key: 'night', type: 'check', label: 'Night time' },
    { type: 'note', text: 'Moving footage without recording anything. Got a real recording? Use a Video player window instead.' },
  ],
  draw,
};
