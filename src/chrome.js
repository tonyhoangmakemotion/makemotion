// Window chrome: shadows, title bars (macOS or Studio style), hairline edges.
// Called by renderFrame for every visible window.

import { LAYER_PROPS, sample, clamp, FPS } from './model.js';
import { APPS, chromeOf } from './apps/index.js';
import { roundRect, UI_FONT, fitText, shadowScale } from './apps/draw.js';

export const TITLEBAR = 40;        // macOS style
export const STUDIO_BAR = 34;      // Studio style: compact, title on the left, dots on the right

// Height of the title bar for a window (0 when it draws its own chrome).
export function titlebarHeight(project, layer) {
  const chrome = chromeOf(layer);
  if (chrome === 'none') return 0;
  if (chrome === 'browser') return TITLEBAR;
  return project?.look?.chrome === 'studio' ? STUDIO_BAR : TITLEBAR;
}

const layerState = (layer, t) => sample(layer.keys, t, LAYER_PROPS);

export function windowTitle(layer, t = 0) {
  if (layer.title) return layer.title;
  return APPS[layer.type]?.title?.(layer.data, t) || layer.name;
}

export function drawWindow(ctx, layer, s, t, env) {
  const { x, y, w, h } = s;
  const A = APPS[layer.type];
  if (!A) return;
  const chrome = chromeOf(layer);
  // Faster-moving windows lift off the desktop: deeper, softer shadow.
  const prev = layerState(layer, t - 1 / FPS);
  const speed = Math.hypot(s.x - prev.x, s.y - prev.y) * FPS + Math.abs(s.scale - prev.scale) * 3000;
  const lift = clamp(speed / 1600, 0, 1);

  ctx.save();
  ctx.globalAlpha *= clamp(s.opacity, 0, 1);
  const cx = x + w / 2, cy = y + h / 2;
  ctx.translate(cx, cy); ctx.scale(s.scale, s.scale); ctx.translate(-cx, -cy);

  if (chrome === 'none') {
    if (A.shadow === 'soft' && !(layer.type === 'facecam' && layer.data.shape === 'circle')) {
      ctx.save();
      ctx.shadowColor = `rgba(0,0,0,${0.45 + lift * 0.15})`; ctx.shadowBlur = (36 + lift * 40) * shadowScale(ctx); ctx.shadowOffsetY = (12 + lift * 16) * shadowScale(ctx);
      roundRect(ctx, x + 6, y + 6, w - 12, h - 12, 18); ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fill();
      ctx.restore();
    } else if (layer.type === 'facecam' && layer.data.shape === 'circle') {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = (40) * shadowScale(ctx); ctx.shadowOffsetY = (14) * shadowScale(ctx);
      ctx.beginPath(); ctx.ellipse(cx, cy, w / 2 - 4, h / 2 - 4, 0, 0, Math.PI * 2); ctx.fillStyle = '#000'; ctx.fill();
      ctx.restore();
    } else if (layer.type === 'phone' || (layer.type === 'notes')) {
      ctx.save();
      ctx.shadowColor = `rgba(0,0,0,${0.5 + lift * 0.15})`; ctx.shadowBlur = (50 + lift * 50) * shadowScale(ctx); ctx.shadowOffsetY = (18 + lift * 22) * shadowScale(ctx);
      roundRect(ctx, x, y, w, h, layer.type === 'phone' ? Math.min(w, h) * 0.13 : 4); ctx.fillStyle = '#000'; ctx.fill();
      ctx.restore();
    }
    ctx.save();
    if (layer.type === 'notes') { ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); }
    A.draw(ctx, { x, y, w, h }, layer.data, t, env);
    ctx.restore();
    ctx.restore();
    return;
  }

  const look = env.project.look || {};
  const active = env.active === layer.id;
  const light = chrome === 'browser';
  const studio = !light && look.chrome === 'studio';
  const BAR = studio ? STUDIO_BAR : TITLEBAR;
  const R = studio ? 11 : 14;
  const k = shadowScale(ctx);

  // Two shadows, like real macOS windows: a wide soft one for depth, a tight one for contact.
  // The active (front) window floats higher than the rest.
  ctx.save();
  roundRect(ctx, x, y, w, h, R);
  ctx.fillStyle = '#17181c';
  ctx.shadowColor = `rgba(0,0,0,${(active ? 0.5 : 0.36) + lift * 0.12})`;
  ctx.shadowBlur = ((active ? 80 : 46) + lift * 50) * k; ctx.shadowOffsetY = ((active ? 30 : 16) + lift * 22) * k;
  ctx.fill();
  ctx.shadowColor = 'rgba(0,0,0,0.38)'; ctx.shadowBlur = 5 * k; ctx.shadowOffsetY = 1.5 * k;
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, x, y, w, h, R);
  ctx.clip();
  // Title bar: frosted glass showing the blurred desktop behind it, or a solid fill.
  const glass = look.glass && env.glass && !studio;
  if (studio) {
    drawStudioBar(ctx, layer, x, y, w, BAR, t, active || !env.dimInactive);
  } else {
  if (glass) {
    ctx.drawImage(env.glass.canvas, -env.glass.pad, -env.glass.pad, env.glass.w, env.glass.h);
    ctx.fillStyle = light ? 'rgba(232,234,238,0.82)' : 'rgba(30,31,37,0.74)';
  } else ctx.fillStyle = light ? '#dee1e6' : '#202127';
  ctx.fillRect(x, y, w, TITLEBAR);
  const sheen = ctx.createLinearGradient(0, y, 0, y + TITLEBAR);
  sheen.addColorStop(0, light ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.05)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen; ctx.fillRect(x, y, w, TITLEBAR);
  ctx.fillStyle = light ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.45)';
  ctx.fillRect(x, y + TITLEBAR - 1, w, 1);
  // Traffic lights: coloured on the front window, grey on the others (like macOS).
  const lit = active || !env.dimInactive;
  ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => {
    ctx.beginPath(); ctx.arc(x + 22 + i * 20, y + TITLEBAR / 2, 6, 0, Math.PI * 2);
    ctx.fillStyle = lit ? c : (light ? '#c8cacf' : '#45464c'); ctx.fill();
    ctx.lineWidth = 0.75; ctx.strokeStyle = lit ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.12)'; ctx.stroke();
  });
  const title = windowTitle(layer, t);
  if (light) {
    // Browser tab
    const tw = Math.min(260, w - 120);
    const tx = x + 84, ty = y + 6;
    ctx.beginPath();
    ctx.moveTo(tx - 8, y + TITLEBAR); ctx.quadraticCurveTo(tx, y + TITLEBAR, tx, y + TITLEBAR - 8);
    ctx.lineTo(tx, ty + 8); ctx.quadraticCurveTo(tx, ty, tx + 8, ty);
    ctx.lineTo(tx + tw - 8, ty); ctx.quadraticCurveTo(tx + tw, ty, tx + tw, ty + 8);
    ctx.lineTo(tx + tw, y + TITLEBAR - 8); ctx.quadraticCurveTo(tx + tw, y + TITLEBAR, tx + tw + 8, y + TITLEBAR);
    ctx.closePath();
    ctx.fillStyle = '#f1f3f4'; ctx.fill();
    ctx.beginPath(); ctx.arc(tx + 18, ty + 17, 7, 0, Math.PI * 2); ctx.fillStyle = '#5b6cff'; ctx.fill();
    ctx.fillStyle = '#202124';
    ctx.font = `500 13px ${UI_FONT}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(fitText(ctx, title, tw - 58), tx + 32, ty + 17);
    ctx.fillStyle = '#5f6368';
    ctx.fillText('×', tx + tw - 20, ty + 16);
    ctx.font = `400 18px ${UI_FONT}`;
    ctx.fillText('+', tx + tw + 14, ty + 16);
    ctx.textBaseline = 'alphabetic';
  } else {
    ctx.fillStyle = lit ? '#c9cbd3' : '#7d7f88';
    ctx.font = `600 14px ${UI_FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(fitText(ctx, title, w - 180), x + w / 2, y + TITLEBAR / 2);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }
  }

  const area = { x, y: y + BAR, w, h: h - BAR };
  ctx.beginPath(); ctx.rect(area.x, area.y, area.w, area.h); ctx.clip();
  A.draw(ctx, area, layer.data, t, env);
  ctx.restore();

  // Hairline edges: a dark outline that separates the window from anything behind it,
  // and a faint light rim on top that catches the light.
  ctx.lineWidth = 1;
  roundRect(ctx, x - 0.5, y - 0.5, w + 1, h + 1, R + 0.5);
  ctx.strokeStyle = light ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.7)'; ctx.stroke();
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, R - 0.5);
  const rim = ctx.createLinearGradient(0, y, 0, y + h);
  rim.addColorStop(0, light ? 'rgba(255,255,255,0.7)' : studio ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.16)');
  rim.addColorStop(0.25, light ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.06)');
  rim.addColorStop(1, light ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)');
  ctx.strokeStyle = rim; ctx.stroke();
  ctx.restore();
}

// Studio title bar: compact, file icon + title on the left, window dots on the right.
const ICON_COLORS = { code: '#3b9cff', terminal: '#9aa0a6', agent: '#d97757', chat: '#4c8dff', notes: '#f2c94c', files: '#5ac8fa', dashboard: '#7c6cff', board: '#34c759', map: '#34c759', email: '#ff9f0a', game: '#ff8a3d', streak: '#39d353' };
function drawStudioBar(ctx, layer, x, y, w, bar, t, lit) {
  ctx.fillStyle = '#1e1e1f';
  ctx.fillRect(x, y, w, bar);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(x, y + bar - 1, w, 1);
  const color = ICON_COLORS[layer.type] || '#8e8e93';
  // small document glyph
  const ix = x + 12, iy = y + bar / 2 - 7;
  roundRect(ctx, ix, iy, 11, 14, 2); ctx.fillStyle = lit ? color : '#5a5a5e'; ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(ix + 2.5, iy + 5, 6, 1.4); ctx.fillRect(ix + 2.5, iy + 8.5, 4, 1.4);
  ctx.font = `600 13px ${UI_FONT}`;
  ctx.fillStyle = lit ? '#e6e6e8' : '#8a8a90';
  ctx.textBaseline = 'middle';
  ctx.fillText(fitText(ctx, windowTitle(layer, t), w - 110), x + 31, y + bar / 2 + 0.5);
  ctx.textBaseline = 'alphabetic';
  ['#28c840', '#febc2e', '#ff5f57'].forEach((c, i) => {
    ctx.beginPath(); ctx.arc(x + w - 54 + i * 17, y + bar / 2, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = lit ? c : '#4a4a4e'; ctx.fill();
  });
}
