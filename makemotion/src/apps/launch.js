// Launch-video building blocks (no window frame): animated titles, end card,
// big counting stat, feature callout and an integrations hub.

import { roundRect, UI_FONT, wrapText, appIcon, drawCover, getMediaSafe, fitText, shadowScale } from './draw.js';
import { EASINGS, clamp } from '../model.js';
import { countUp } from './dashboard.js';

const DISPLAY = "'Geist', system-ui, sans-serif";
const FONTS = {
  sans: DISPLAY,
  pixel: "'Silkscreen', 'Geist Mono', monospace",
  fun: "'Lilita One', 'Geist', system-ui, sans-serif",
};

// Full-screen patterned backdrop for "time skip" cards ("3 hours later…").
function patternBackdrop(ctx, area, d) {
  const { x, y, w, h } = area;
  const X = x - 3000, Y = y - 3000, W = w + 6000, H = h + 6000;
  ctx.fillStyle = d.bgColor || '#2b54d6';
  ctx.fillRect(X, Y, W, H);
  const cell = 120;
  ctx.fillStyle = d.patternColor || 'rgba(255,255,255,0.16)';
  for (let gy = Math.floor(Y / cell) * cell; gy < Y + H; gy += cell) {
    for (let gx = Math.floor(X / cell) * cell; gx < X + W; gx += cell) {
      const odd = ((gx / cell) + (gy / cell)) % 2 === 0;
      const cx = gx + cell / 2, cy = gy + cell / 2, r = odd ? 26 : 16;
      for (let p = 0; p < 4; p++) {
        const a = (p / 4) * Math.PI * 2 + (odd ? 0 : Math.PI / 4);
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, r * 0.75, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
}

// Caution-tape backdrop: dark floor, two crossing hazard tapes that slide (a "this went wrong" card).
function tapeBackdrop(ctx, area, d, t) {
  const { x, y, w, h } = area;
  ctx.fillStyle = d.bgColor && d.bgColor !== '#2b54d6' ? d.bgColor : '#1d1d20';
  ctx.fillRect(x - 3000, y - 3000, w + 6000, h + 6000);
  const cx = x + w / 2, cy = y + h / 2, band = 70;
  [[-0.16, 1], [0.12, -1]].forEach(([ang, dir], i) => {
    ctx.save();
    ctx.translate(cx, cy + (i ? 230 : -220)); ctx.rotate(ang);
    const L = 6000;
    ctx.fillStyle = '#f5c518'; ctx.fillRect(-L / 2, -band / 2, L, band);
    ctx.beginPath(); ctx.rect(-L / 2, -band / 2, L, band); ctx.clip();
    const off = ((t * 120 * dir) % 120 + 120) % 120;
    ctx.fillStyle = '#16161a';
    for (let sx = -L / 2 - 240 + off; sx < L / 2; sx += 120) {
      ctx.beginPath(); ctx.moveTo(sx, -band / 2); ctx.lineTo(sx + 50, -band / 2); ctx.lineTo(sx + 50 + band, band / 2); ctx.lineTo(sx + band, band / 2); ctx.closePath(); ctx.fill();
    }
    ctx.font = `900 30px ${UI_FONT}`; ctx.textBaseline = 'middle';
    const word = d.tapeText || 'CAUTION';
    for (let sx = -L / 2 + off * 3; sx < L / 2; sx += 420) {
      const tw = ctx.measureText(word).width;
      ctx.fillStyle = '#f5c518'; ctx.fillRect(sx - 14, -22, tw + 28, 44);
      ctx.fillStyle = '#16161a'; ctx.fillText(word, sx, 1);
    }
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  });
}

// Words wrapped in *stars* get the accent color.
function tokens(text) {
  return String(text).split(/\s+/).filter(Boolean).map((w) => ({ word: w.replace(/\*/g, ''), hi: /^\*.*\*$/.test(w) || /^\*/.test(w) || /\*$/.test(w) }));
}

// ---------- Title ----------

function fitFont(ctx, words, maxW, maxH, weight, maxSize, family = DISPLAY) {
  for (let fs = maxSize; fs > 14; fs -= 2) {
    ctx.font = `${weight} ${fs}px ${family}`;
    const lines = wrapText(ctx, words.map((t) => t.word).join(' '), maxW);
    if (lines.length * fs * 1.12 <= maxH) return fs;
  }
  return 14;
}

function drawTitle(ctx, area, d, t) {
  const { x, y, w, h } = area;
  if (d.backdrop === 'pattern') patternBackdrop(ctx, area, d);
  if (d.backdrop === 'tape') tapeBackdrop(ctx, area, d, t);
  if (d.panel) { roundRect(ctx, x, y, w, h, 24); ctx.fillStyle = d.panelColor || 'rgba(10,10,14,0.72)'; ctx.fill(); }
  const pad = d.panel ? 40 : 0;
  const words = tokens(d.text);
  const subH = d.sub ? Math.min(60, h * 0.2) : 0;
  const family = FONTS[d.font] || DISPLAY;
  const weight = d.font === 'sans' || !d.font ? 800 : 400;
  const fs = fitFont(ctx, words, w - pad * 2, h - pad * 2 - subH, weight, d.size || 120, family);
  ctx.font = `${weight} ${fs}px ${family}`;
  // Lay out words into lines ourselves so each word can animate.
  const lines = [];
  let line = [], lw = 0;
  const space = ctx.measureText(' ').width;
  for (const tk of words) {
    const ww = ctx.measureText(tk.word).width;
    if (line.length && lw + space + ww > w - pad * 2) { lines.push({ words: line, width: lw }); line = []; lw = 0; }
    line.push({ ...tk, w: ww }); lw += (line.length > 1 ? space : 0) + ww;
  }
  if (line.length) lines.push({ words: line, width: lw });
  const lh = fs * 1.12;
  const blockH = lines.length * lh + (d.sub ? subH : 0);
  let ly = y + (h - blockH) / 2 + fs * 0.85;
  let idx = 0;
  const age = t - d.start;
  for (const L of lines) {
    let lx = d.align === 'left' ? x + pad : x + (w - L.width) / 2;
    for (const tk of L.words) {
      const local = d.anim === 'fade' ? age : d.anim === 'type' ? age - idx * 0.12 : age - idx * 0.08;
      const k = clamp(local / (d.anim === 'type' ? 0.05 : 0.45), 0, 1);
      if (k > 0) {
        ctx.save();
        ctx.globalAlpha *= d.anim === 'type' ? (k > 0 ? 1 : 0) : EASINGS.out(k);
        const rise = d.anim === 'words' ? (1 - EASINGS.out(k)) * fs * 0.5 : 0;
        const blur = d.anim === 'words' ? (1 - k) * 8 : 0;
        if (blur > 0.5) ctx.filter = `blur(${blur}px)`;
        if (d.font === 'fun') {
          // Cartoon card look: thick dark outline under the fill.
          ctx.lineJoin = 'round'; ctx.lineWidth = fs * 0.12; ctx.strokeStyle = 'rgba(20,20,40,0.85)';
          ctx.strokeText(tk.word, lx, ly + rise);
        }
        ctx.fillStyle = tk.hi ? (d.accent || '#ff6a3d') : (d.color || '#ffffff');
        ctx.shadowColor = d.panel ? 'transparent' : 'rgba(0,0,0,0.35)'; ctx.shadowBlur = (d.panel ? 0 : 18) * shadowScale(ctx);
        ctx.fillText(tk.word, lx, ly + rise);
        ctx.restore();
      }
      lx += tk.w + space; idx++;
    }
    ly += lh;
  }
  if (d.sub) {
    const k = EASINGS.out(clamp((age - idx * 0.08 - 0.15) / 0.5, 0, 1));
    ctx.save();
    ctx.globalAlpha *= k;
    ctx.font = `500 ${Math.round(Math.min(subH * 0.62, fs * 0.36))}px ${UI_FONT}`;
    ctx.fillStyle = d.subColor || 'rgba(255,255,255,0.75)';
    ctx.textAlign = d.align === 'left' ? 'left' : 'center';
    ctx.fillText(fitText(ctx, d.sub, w - pad * 2), d.align === 'left' ? x + pad : x + w / 2, ly - fs * 0.85 + subH * 0.75 + (1 - k) * 10);
    ctx.restore();
  }
}

export const titleApp = {
  type: 'title', label: 'Title text', group: 'Launch', chip: 'ttl', size: [1400, 360], chrome: 'none',
  blurb: 'Big animated headline',
  title: (d) => d.text, enter: 'fade',
  defaults: (t0) => ({ text: 'Meet the *fastest* way to edit', sub: 'Screen videos, made in minutes.', start: +(t0 + 0.2).toFixed(2), anim: 'words', align: 'center', color: '#ffffff', accent: '#ff6a3d', panel: false, size: 120, font: 'sans', backdrop: 'none', bgColor: '#2b54d6' }),
  times: ['start'],
  fields: [
    { key: 'text', type: 'textarea', label: 'Headline (wrap a word in *stars* to color it)', rows: 2 },
    { key: 'sub', type: 'text', label: 'Line below (optional)' },
    { key: 'font', type: 'select', label: 'Font', options: [['sans', 'Clean'], ['fun', 'Playful (cartoon card)'], ['pixel', 'Pixel']] },
    { key: 'backdrop', type: 'select', label: 'Backdrop', options: [['none', 'None (desktop shows)'], ['pattern', 'Full-screen pattern (time skip card)'], ['tape', 'Caution tape (something went wrong)']] },
    { key: 'bgColor', type: 'color', label: 'Backdrop color', when: (d) => d.backdrop === 'pattern' },
    { key: 'tapeText', type: 'text', label: 'Tape text', when: (d) => d.backdrop === 'tape' },
    { key: 'start', type: 'time', label: 'Animation starts' },
    { key: 'anim', type: 'select', label: 'Animation', options: [['words', 'Words rise in'], ['type', 'Typewriter'], ['fade', 'Fade in']] },
    { key: 'align', type: 'select', label: 'Align', options: [['center', 'Center'], ['left', 'Left']] },
    { key: 'size', type: 'number', label: 'Largest text size', min: 30, max: 240, step: 5 },
    { key: 'color', type: 'color', label: 'Text color' },
    { key: 'accent', type: 'color', label: 'Highlight color' },
    { key: 'panel', type: 'check', label: 'Dark panel behind the text' },
  ],
  draw: drawTitle,
};

// ---------- End card ----------

function drawEndcard(ctx, area, d, t) {
  const { x, y, w, h } = area;
  const age = t - d.start;
  if (d.panel) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = (50) * shadowScale(ctx); ctx.shadowOffsetY = (18) * shadowScale(ctx);
    roundRect(ctx, x, y, w, h, 32);
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, d.bg1 || '#14112e'); g.addColorStop(1, d.bg2 || '#2a1640');
    ctx.fillStyle = g; ctx.fill();
    ctx.restore();
  }
  const cx = x + w / 2;
  const s = Math.min(w, h) * 0.22;
  const k1 = EASINGS.spring(clamp(age / 0.7, 0, 1));
  ctx.save();
  ctx.translate(cx, y + h * 0.3); ctx.scale(k1, k1); ctx.translate(-cx, -(y + h * 0.3));
  const m = getMediaSafe(d.logoId);
  if (m?.el) { ctx.save(); roundRect(ctx, cx - s / 2, y + h * 0.3 - s / 2, s, s, s * 0.24); ctx.clip(); drawCover(ctx, m.el, cx - s / 2, y + h * 0.3 - s / 2, s, s); ctx.restore(); }
  else {
    ctx.save();
    ctx.shadowColor = (d.accent || '#ff6a3d') + '88'; ctx.shadowBlur = (40) * shadowScale(ctx);
    const g = ctx.createLinearGradient(cx - s / 2, y, cx + s / 2, y + s);
    g.addColorStop(0, d.accent || '#ff6a3d'); g.addColorStop(1, d.accent2 || '#8a5cff');
    roundRect(ctx, cx - s / 2, y + h * 0.3 - s / 2, s, s, s * 0.26); ctx.fillStyle = g; ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#fff'; ctx.font = `800 ${Math.round(s * 0.55)}px ${DISPLAY}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText((d.name || 'A')[0].toUpperCase(), cx, y + h * 0.3 + s * 0.03);
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  }
  ctx.restore();
  const step = (i) => EASINGS.out(clamp((age - 0.35 - i * 0.15) / 0.45, 0, 1));
  ctx.textAlign = 'center';
  const parts = [
    [d.name, `800 ${Math.round(h * 0.11)}px ${DISPLAY}`, d.color || '#ffffff', h * 0.58],
    [d.tagline, `500 ${Math.round(h * 0.045)}px ${UI_FONT}`, 'rgba(255,255,255,0.72)', h * 0.67],
  ];
  parts.forEach(([text, font, color, py], i) => {
    if (!text) return;
    const k = step(i);
    ctx.save(); ctx.globalAlpha *= k;
    ctx.font = font; ctx.fillStyle = color;
    ctx.fillText(fitText(ctx, text, w * 0.9), cx, y + py + (1 - k) * 14);
    ctx.restore();
  });
  if (d.cta) {
    const k = step(2);
    ctx.save(); ctx.globalAlpha *= k;
    ctx.font = `700 ${Math.round(h * 0.04)}px ${UI_FONT}`;
    const bw = ctx.measureText(d.cta).width + h * 0.1, bh = h * 0.085;
    const by = y + h * 0.74 + (1 - k) * 14;
    const pulse = 1 + 0.03 * Math.sin(Math.max(0, age - 1.4) * 4) * (age > 1.4 ? 1 : 0);
    ctx.translate(cx, by + bh / 2); ctx.scale(pulse, pulse); ctx.translate(-cx, -(by + bh / 2));
    roundRect(ctx, cx - bw / 2, by, bw, bh, bh / 2); ctx.fillStyle = d.accent || '#ff6a3d'; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(d.cta, cx, by + bh * 0.66);
    ctx.restore();
  }
  if (d.url) {
    const k = step(3);
    ctx.save(); ctx.globalAlpha *= k * 0.8;
    ctx.font = `500 ${Math.round(h * 0.035)}px ${UI_FONT}`; ctx.fillStyle = '#fff';
    ctx.fillText(d.url, cx, y + h * 0.92);
    ctx.restore();
  }
  ctx.textAlign = 'left';
}

export const endcardApp = {
  type: 'endcard', label: 'End card', group: 'Launch', chip: 'end', size: [1000, 620], chrome: 'none',
  blurb: 'Logo, name, call to action',
  title: (d) => d.name, enter: 'fade',
  defaults: (t0) => ({ name: 'MakeMotion', tagline: 'Edit videos that live on a desktop.', cta: 'Try it free', url: 'makemotion.app', logoId: null, start: +(t0 + 0.1).toFixed(2), accent: '#ff6a3d', accent2: '#8a5cff', color: '#ffffff', panel: true, bg1: '#14112e', bg2: '#2a1640' }),
  times: ['start'],
  fields: [
    { key: 'name', type: 'text', label: 'Product name' },
    { key: 'tagline', type: 'text', label: 'Tagline' },
    { key: 'cta', type: 'text', label: 'Button text (empty to hide)' },
    { key: 'url', type: 'text', label: 'Website' },
    { key: 'logoId', type: 'media', accept: 'image', label: 'Logo (optional)' },
    { key: 'start', type: 'time', label: 'Animation starts' },
    { key: 'accent', type: 'color', label: 'Brand color' },
    { key: 'accent2', type: 'color', label: 'Second color (logo gradient)' },
    { key: 'panel', type: 'check', label: 'Background card' },
    { key: 'bg1', type: 'color', label: 'Card color top', when: (d) => d.panel },
    { key: 'bg2', type: 'color', label: 'Card color bottom', when: (d) => d.panel },
  ],
  draw: drawEndcard,
};

// ---------- Big stat ----------

function drawStat(ctx, area, d, t) {
  const { x, y, w, h } = area;
  if (d.panel) { roundRect(ctx, x, y, w, h, 24); ctx.fillStyle = 'rgba(12,12,18,0.78)'; ctx.fill(); }
  const p = EASINGS.out(clamp((t - d.start) / (d.dur || 1.5), 0, 1));
  const shown = countUp(d.value, p);
  ctx.textAlign = 'center';
  let fs = h * 0.5;
  ctx.font = `800 ${fs}px ${DISPLAY}`;
  while (ctx.measureText(d.value).width > w * 0.9 && fs > 20) { fs -= 4; ctx.font = `800 ${fs}px ${DISPLAY}`; }
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, d.color || '#ffffff'); g.addColorStop(1, d.accent || '#ffb36b');
  ctx.fillStyle = g;
  ctx.globalAlpha *= clamp((t - d.start + 0.2) / 0.3, 0, 1);
  ctx.fillText(shown, x + w / 2, y + h * 0.58);
  ctx.font = `500 ${Math.round(h * 0.11)}px ${UI_FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText(fitText(ctx, d.label || '', w * 0.9), x + w / 2, y + h * 0.82);
  ctx.textAlign = 'left';
}

export const statApp = {
  type: 'stat', label: 'Big number', group: 'Launch', chip: 'num', size: [700, 320], chrome: 'none',
  blurb: 'A number that counts up',
  title: (d) => d.value, enter: 'pop',
  defaults: (t0) => ({ value: '3.5x', label: 'faster than editing by hand', start: +(t0 + 0.2).toFixed(2), dur: 1.5, color: '#ffffff', accent: '#ffb36b', panel: false }),
  times: ['start'],
  fields: [
    { key: 'value', type: 'text', label: 'Number (like $1.2M, 98%, 3.5x)' },
    { key: 'label', type: 'text', label: 'Label' },
    { key: 'start', type: 'time', label: 'Counting starts' },
    { key: 'dur', type: 'number', label: 'Counting length (s)', min: 0.2, max: 10, step: 0.1 },
    { key: 'color', type: 'color', label: 'Color' },
    { key: 'accent', type: 'color', label: 'Gradient color' },
    { key: 'panel', type: 'check', label: 'Dark panel behind' },
  ],
  draw: drawStat,
};

// ---------- Callout ----------

function drawCallout(ctx, area, d, t) {
  const { x, y, w, h } = area;
  const age = t - d.start;
  const k = EASINGS.out(clamp(age / 0.5, 0, 1));
  const color = d.color || '#ffd23f';
  // Arrow from the label toward a point (offset from the label's center).
  const sx = x + w / 2, sy = y + h / 2;
  const tx = sx + (d.dx ?? -260), ty = sy + (d.dy ?? 140);
  const ang = Math.atan2(ty - sy, tx - sx);
  const startX = sx + Math.cos(ang) * (w / 2) * 0.9, startY = sy + Math.sin(ang) * (h / 2) * 1.1;
  const ex = startX + (tx - startX) * k, ey = startY + (ty - startY) * k;
  if (d.arrow && k > 0) {
    const mx = (startX + ex) / 2 - (ey - startY) * 0.18, my = (startY + ey) / 2 + (ex - startX) * 0.18;
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = (8) * shadowScale(ctx);
    ctx.beginPath(); ctx.moveTo(startX, startY); ctx.quadraticCurveTo(mx, my, ex, ey); ctx.stroke();
    if (k > 0.9) {
      const a2 = Math.atan2(ey - my, ex - mx);
      ctx.beginPath();
      ctx.moveTo(ex, ey); ctx.lineTo(ex - 18 * Math.cos(a2 - 0.45), ey - 18 * Math.sin(a2 - 0.45));
      ctx.moveTo(ex, ey); ctx.lineTo(ex - 18 * Math.cos(a2 + 0.45), ey - 18 * Math.sin(a2 + 0.45));
      ctx.stroke();
      ctx.beginPath(); ctx.arc(tx, ty, 14 + 6 * Math.sin(age * 5), 0, Math.PI * 2);
      ctx.strokeStyle = color + '88'; ctx.lineWidth = 3; ctx.stroke();
    }
    ctx.restore();
  }
  const pk = EASINGS.spring(clamp(age / 0.55, 0, 1));
  ctx.save();
  ctx.translate(sx, sy); ctx.scale(0.6 + 0.4 * pk, 0.6 + 0.4 * pk); ctx.translate(-sx, -sy);
  ctx.globalAlpha *= clamp(age / 0.15, 0, 1);
  ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = (20) * shadowScale(ctx); ctx.shadowOffsetY = (6) * shadowScale(ctx);
  roundRect(ctx, x, y, w, h, Math.min(h / 2, 22)); ctx.fillStyle = color; ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = d.textColor || '#141414';
  let fs = Math.round(h * 0.42);
  ctx.font = `700 ${fs}px ${UI_FONT}`;
  while (ctx.measureText(d.text).width > w - 40 && fs > 12) { fs -= 1; ctx.font = `700 ${fs}px ${UI_FONT}`; }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(d.text, sx, sy + 1);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.restore();
}

export const calloutApp = {
  type: 'callout', label: 'Callout', group: 'Launch', chip: 'note', size: [380, 80], chrome: 'none',
  blurb: 'Label with an arrow to a feature',
  title: (d) => d.text, enter: 'fade',
  defaults: (t0) => ({ text: 'One-click export', start: +(t0 + 0.1).toFixed(2), arrow: true, dx: -260, dy: 140, color: '#ffd23f', textColor: '#141414' }),
  times: ['start'],
  fields: [
    { key: 'text', type: 'text', label: 'Label' },
    { key: 'start', type: 'time', label: 'Appears at' },
    { key: 'arrow', type: 'check', label: 'Show arrow' },
    { key: 'dx', type: 'number', label: 'Arrow points left/right (px)', min: -2000, max: 2000, step: 10, when: (d) => d.arrow },
    { key: 'dy', type: 'number', label: 'Arrow points up/down (px)', min: -2000, max: 2000, step: 10, when: (d) => d.arrow },
    { key: 'color', type: 'color', label: 'Color' },
    { key: 'textColor', type: 'color', label: 'Text color' },
    { type: 'note', text: 'Tip: put the callout next to a window, then set where the arrow points with the two numbers.' },
  ],
  draw: drawCallout,
};

// ---------- Integrations hub ----------

const ICON_COLORS = ['#4f8cff', '#ff6a3d', '#2fb35a', '#a259ff', '#ffb020', '#16b3a3', '#ff4f7b', '#5b6cff'];

function drawIntegrations(ctx, area, d, t) {
  const { x, y, w, h } = area;
  const age = t - d.start;
  const cx = x + w / 2, cy = y + h / 2, R = Math.min(w, h) * 0.38;
  const apps = (d.apps || []).slice(0, 10);
  const hub = Math.min(w, h) * 0.17, tile = Math.min(w, h) * 0.12;
  apps.forEach((name, i) => {
    const a = -Math.PI / 2 + (i / apps.length) * Math.PI * 2;
    const ax = cx + Math.cos(a) * R, ay = cy + Math.sin(a) * R;
    const lk = EASINGS.out(clamp((age - 0.3 - i * 0.1) / 0.4, 0, 1));
    if (lk > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 2; ctx.setLineDash([6, 8]);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + (ax - cx) * lk, cy + (ay - cy) * lk); ctx.stroke();
      ctx.setLineDash([]);
      if (lk >= 1) {
        const f = ((age * 0.6 + i * 0.37) % 1);
        ctx.beginPath(); ctx.arc(ax + (cx - ax) * f, ay + (cy - ay) * f, 4, 0, Math.PI * 2);
        ctx.fillStyle = ICON_COLORS[i % ICON_COLORS.length]; ctx.fill();
      }
    }
    const tk = EASINGS.spring(clamp((age - 0.5 - i * 0.1) / 0.5, 0, 1));
    if (tk > 0) {
      ctx.save();
      ctx.translate(ax, ay); ctx.scale(tk, tk); ctx.translate(-ax, -ay);
      ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = (16) * shadowScale(ctx);
      appIcon(ctx, ax - tile / 2, ay - tile / 2, tile, ICON_COLORS[i % ICON_COLORS.length], (name[0] || '?').toUpperCase());
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = `500 ${Math.round(tile * 0.22)}px ${UI_FONT}`;
      ctx.textAlign = 'center'; ctx.fillText(fitText(ctx, name, tile * 1.8), ax, ay + tile / 2 + tile * 0.32); ctx.textAlign = 'left';
      ctx.restore();
    }
  });
  const hk = EASINGS.spring(clamp(age / 0.6, 0, 1));
  ctx.save();
  ctx.translate(cx, cy); ctx.scale(hk, hk); ctx.translate(-cx, -cy);
  ctx.shadowColor = (d.accent || '#ff6a3d') + 'aa'; ctx.shadowBlur = (40 + 10 * Math.sin(age * 3)) * shadowScale(ctx);
  const g = ctx.createLinearGradient(cx - hub, cy - hub, cx + hub, cy + hub);
  g.addColorStop(0, d.accent || '#ff6a3d'); g.addColorStop(1, '#8a5cff');
  roundRect(ctx, cx - hub / 2, cy - hub / 2, hub, hub, hub * 0.26); ctx.fillStyle = g; ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#fff'; ctx.font = `800 ${Math.round(hub * 0.5)}px ${DISPLAY}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText((d.name || 'A')[0].toUpperCase(), cx, cy + 2);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.restore();
}

export const integrationsApp = {
  type: 'integrations', label: 'Integrations', group: 'Launch', chip: 'hub', size: [760, 760], chrome: 'none',
  blurb: 'Your product connected to apps',
  title: (d) => d.name, enter: 'fade',
  defaults: (t0) => ({ name: 'MakeMotion', apps: ['Docs', 'Chat', 'Mail', 'Calendar', 'Drive', 'Pay', 'Analytics', 'Tasks'], start: +(t0 + 0.1).toFixed(2), accent: '#ff6a3d' }),
  times: ['start'],
  fields: [
    { key: 'name', type: 'text', label: 'Your product' },
    { key: 'apps', type: 'list', label: 'Connected apps (comma separated, up to 10)' },
    { key: 'start', type: 'time', label: 'Animation starts' },
    { key: 'accent', type: 'color', label: 'Brand color' },
    { type: 'note', text: 'Use generic names (Docs, Chat…) or your own partners. Real company logos are not drawn.' },
  ],
  draw: drawIntegrations,
};
