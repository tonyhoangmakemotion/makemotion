// Motion-design windows for launch videos (see docs/launch-video-analysis.md):
// - sentence: a line that builds word by word (blur + rise), with accent words, pills and counters
// - logoreveal: a dot grows, settles into the logo mark, the name slides out, a tagline wipes in
// All are pure functions of t and draw without window chrome.

import { UI_FONT, roundRect, getMediaSafe, drawCover } from './draw.js';
import { EASINGS, clamp } from '../model.js';
import { canFilter } from '../look.js';

const out = EASINGS.out;
const lerp = (a, b, k) => a + (b - a) * k;

// ---------- Sentence ----------
// Markup:  *word*  accent colour · [text] filled pill · {text} outlined pill · [7>22] counting pill
//          ~ a coloured dot (like a logo mark)
export function tokenize(src) {
  const toks = [];
  const re = /\*([^*]+)\*|\[([^\]]+)\]|\{([^}]+)\}|(~)|(\S+)/g;
  let m;
  while ((m = re.exec(String(src || '')))) {
    if (m[1]) toks.push({ kind: 'accent', text: m[1] });
    else if (m[2]) {
      const c = /^\s*([^\d-]*)(-?[\d.,]+)\s*>\s*(-?[\d.,]+)(.*)$/.exec(m[2]);
      if (c) toks.push({ kind: 'count', pre: c[1], from: parseFloat(c[2].replace(/,/g, '')), to: parseFloat(c[3].replace(/,/g, '')), post: c[4], dec: (c[3].split('.')[1] || '').length, text: m[2] });
      else toks.push({ kind: 'pill', text: m[2] });
    } else if (m[3]) toks.push({ kind: 'outline', text: m[3] });
    else if (m[4]) toks.push({ kind: 'dot', text: '' });
    else toks.push({ kind: 'word', text: m[5] });
  }
  return toks;
}

const fmtNum = (v, dec) => v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });

function drawSentence(ctx, area, d, t) {
  const { x, y, w, h } = area;
  const toks = tokenize(d.text);
  if (!toks.length) return;
  const fs = d.size || 72;
  const font = `${d.weight || 600} ${fs}px ${UI_FONT}`;
  ctx.save();
  ctx.font = font;
  const space = fs * 0.28, padX = fs * 0.3, pillH = fs * 1.18;
  const gap = d.gap ?? 0.22, start = d.start ?? 0;
  // Measure each token at full size.
  for (const tk of toks) {
    if (tk.kind === 'dot') tk.w = fs * 0.78;
    else if (tk.kind === 'count') tk.w = Math.max(ctx.measureText(tk.pre + fmtNum(tk.from, tk.dec) + tk.post).width, ctx.measureText(tk.pre + fmtNum(tk.to, tk.dec) + tk.post).width) + padX * 2;
    else tk.w = ctx.measureText(tk.text).width + (tk.kind === 'pill' || tk.kind === 'outline' ? padX * 2 : 0);
  }
  // Wrap into lines that fit the window.
  const lines = [[]];
  let lw = 0;
  for (const tk of toks) {
    const add = (lines[lines.length - 1].length ? space : 0) + tk.w;
    if (lw + add > w && lines[lines.length - 1].length) { lines.push([]); lw = 0; }
    lines[lines.length - 1].push(tk); lw += (lines[lines.length - 1].length > 1 ? space : 0) + tk.w;
  }
  let i = 0;
  for (const ln of lines) for (const tk of ln) { tk.t0 = start + i * gap; i++; }
  const exitK = d.exitAt != null && d.exitAt > start ? clamp((t - d.exitAt) / 0.35, 0, 1) : 0;
  const lineH = fs * 1.32;
  const top = y + h / 2 - (lines.length * lineH) / 2 + lineH / 2;
  const accent = d.accent || '#2ee66b';
  lines.forEach((ln, li) => {
    // The line re-centres as it grows: only revealed words take up room.
    const kOf = (tk) => out(clamp((t - tk.t0) / 0.32, 0, 1));
    let width = 0;
    ln.forEach((tk, j) => { const k = kOf(tk); if (k > 0) width += (j ? space : 0) * Math.min(1, k * 2) + tk.w * (0.55 + 0.45 * k); });
    let cx = d.align === 'left' ? x : x + (w - width) / 2;
    const cy = top + li * lineH;
    ln.forEach((tk, j) => {
      const k = kOf(tk);
      if (k <= 0) return;
      cx += (j ? space : 0) * Math.min(1, k * 2);
      const tw = tk.w * (0.55 + 0.45 * k);
      ctx.save();
      ctx.globalAlpha *= k * (1 - exitK);
      const blur = (1 - k) * 10 + exitK * 14;
      if (canFilter && blur > 0.3) ctx.filter = `blur(${blur.toFixed(1)}px)`;
      const rise = (1 - k) * fs * 0.32;
      ctx.translate(cx + tw / 2, cy + rise); ctx.scale(0.55 + 0.45 * k, 0.55 + 0.45 * k); ctx.translate(-tk.w / 2, 0);
      ctx.textBaseline = 'middle';
      if (tk.kind === 'pill' || tk.kind === 'count') {
        roundRect(ctx, 0, -pillH / 2, tk.w, pillH, fs * 0.22);
        ctx.fillStyle = accent; ctx.fill();
        ctx.fillStyle = d.pillText || '#06120a';
        let label = tk.text;
        if (tk.kind === 'count') { const c = out(clamp((t - tk.t0 - 0.15) / (d.countDur ?? 0.9), 0, 1)); label = tk.pre + fmtNum(lerp(tk.from, tk.to, c), tk.dec) + tk.post; }
        ctx.textAlign = 'center'; ctx.fillText(label, tk.w / 2, fs * 0.04); ctx.textAlign = 'left';
      } else if (tk.kind === 'outline') {
        roundRect(ctx, 0, -pillH / 2, tk.w, pillH, pillH / 2);
        ctx.strokeStyle = d.color || '#ffffff'; ctx.lineWidth = Math.max(2, fs * 0.04); ctx.stroke();
        ctx.fillStyle = d.color || '#ffffff';
        ctx.fillText(tk.text, padX, fs * 0.04);
      } else if (tk.kind === 'dot') {
        ctx.beginPath(); ctx.arc(tk.w / 2, 0, fs * 0.36, 0, Math.PI * 2); ctx.fillStyle = accent; ctx.fill();
      } else {
        ctx.fillStyle = tk.kind === 'accent' ? accent : (d.color || '#ffffff');
        ctx.fillText(tk.text, 0, fs * 0.04);
      }
      ctx.restore();
      cx += tw;
    });
  });
  ctx.restore();
}

export const sentenceApp = {
  type: 'sentence', label: 'Kinetic line', group: 'Launch', chip: 'kin', size: [1500, 260], chrome: 'none',
  blurb: 'Words blur in one by one, with pills and counters',
  title: (d) => String(d.text || '').replace(/[*[\]{}~]/g, ''),
  defaults: (t0) => ({ text: 'You just got [7>22] warm leads', start: +(t0 + 0.1).toFixed(2), gap: 0.22, size: 76, weight: 600, color: '#ffffff', accent: '#2ee66b', pillText: '#06120a', align: 'center', exitAt: null, countDur: 0.9 }),
  times: ['start', 'exitAt'],
  fields: [
    { key: 'text', type: 'textarea', rows: 2, label: 'Line: <code>*word*</code> colour · <code>[text]</code> pill · <code>{text}</code> outline · <code>[7&gt;22]</code> counter · <code>~</code> dot' },
    { key: 'start', type: 'time', label: 'First word at' },
    { key: 'gap', type: 'number', label: 'Seconds between words', min: 0.05, max: 1.5, step: 0.01 },
    { key: 'exitAt', type: 'time', label: 'Blur out at (0 = stays)' },
    { key: 'size', type: 'number', label: 'Text size', min: 20, max: 240, step: 2 },
    { key: 'weight', type: 'select', label: 'Weight', options: [[400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold']] },
    { key: 'color', type: 'color', label: 'Text colour' },
    { key: 'accent', type: 'color', label: 'Accent (pills, coloured words)' },
    { key: 'pillText', type: 'color', label: 'Text inside pills' },
    { key: 'align', type: 'select', label: 'Align', options: [['center', 'Centre (re-centres as it grows)'], ['left', 'Left']] },
  ],
  draw: drawSentence,
};

// ---------- Logo reveal ----------

function drawLogoReveal(ctx, area, d, t) {
  const { x, y, w, h } = area;
  const s = (d.start ?? 0);
  const a = t - s;
  if (a < 0) return;
  const accent = d.accent || '#2ee66b';
  const fs = d.size || 96;
  const markR = fs * 0.42;
  ctx.save();
  ctx.font = `600 ${fs}px ${UI_FONT}`;
  const nameW = ctx.measureText(d.name || '').width;
  const gap = fs * 0.22;
  const tag = d.tagline || '';
  ctx.font = `500 ${fs * 0.26}px ${UI_FONT}`;
  const tagW = tag ? Math.max(ctx.measureText(tag).width * 0.62, fs * 2.2) : 0;
  const total = markR * 2 + gap + nameW + (tag ? gap * 1.2 + tagW : 0);
  const cx = x + w / 2, cy = y + h / 2;
  // 1) the mark grows big (0-0.7s), 2) settles to its size and moves left (0.7-1.3s)
  const grow = out(clamp(a / 0.7, 0, 1));
  const settle = EASINGS.smooth(clamp((a - 0.7) / 0.6, 0, 1));
  const bigR = Math.min(w, h) * 0.42;
  const r = lerp(lerp(0, bigR, grow), markR, settle);
  const finalMx = x + (w - total) / 2 + markR;
  const mx = lerp(cx, finalMx, settle);
  // Ripple rings while it is big.
  if (settle < 1) {
    ctx.save();
    ctx.globalAlpha = (1 - settle) * 0.5;
    for (let i = 1; i <= 2; i++) { ctx.beginPath(); ctx.arc(mx, cy, r * (1 + i * 0.45 * grow), 0, Math.PI * 2); ctx.strokeStyle = accent; ctx.lineWidth = r * 0.12; ctx.stroke(); }
    ctx.restore();
  }
  const logo = getMediaSafe(d.logoId);
  if (logo?.el && settle > 0.6) {
    ctx.save(); ctx.globalAlpha = clamp((settle - 0.6) / 0.4, 0, 1);
    ctx.beginPath(); ctx.arc(mx, cy, r, 0, Math.PI * 2); ctx.clip();
    drawCover(ctx, logo.el, mx - r, cy - r, r * 2, r * 2, { fit: 'contain' });
    ctx.restore();
    if (settle < 1) { ctx.globalAlpha = 1 - (settle - 0.6) / 0.4; ctx.beginPath(); ctx.arc(mx, cy, r, 0, Math.PI * 2); ctx.fillStyle = accent; ctx.fill(); ctx.globalAlpha = 1; }
  } else {
    ctx.beginPath(); ctx.arc(mx, cy, r, 0, Math.PI * 2); ctx.fillStyle = accent; ctx.fill();
  }
  // 3) the name slides out from behind the mark (1.1-1.7s)
  const nameK = out(clamp((a - 1.1) / 0.6, 0, 1));
  if (nameK > 0) {
    const nx = finalMx + markR + gap;
    ctx.save();
    ctx.beginPath(); ctx.rect(nx, cy - fs, nameW + 4, fs * 2); ctx.clip();
    ctx.globalAlpha = nameK;
    ctx.font = `600 ${fs}px ${UI_FONT}`;
    ctx.fillStyle = d.color || '#ffffff'; ctx.textBaseline = 'middle';
    ctx.fillText(d.name || '', nx - (1 - nameK) * nameW * 0.6, cy + fs * 0.04);
    ctx.restore();
  }
  // 4) tagline panel wipes in with a light sweep (1.8-2.6s)
  if (tag) {
    const tk = EASINGS.smooth(clamp((a - 1.8) / 0.8, 0, 1));
    if (tk > 0) {
      const px = finalMx + markR + gap + nameW + gap * 1.2, ph = fs * 0.9, pw = tagW;
      ctx.save();
      ctx.beginPath(); ctx.rect(px, cy - ph / 2, pw * tk, ph); ctx.clip();
      const gr = ctx.createLinearGradient(px, 0, px + pw, 0);
      gr.addColorStop(0, accent); gr.addColorStop(0.06, accent); gr.addColorStop(0.07, hexA(accent, 0.55)); gr.addColorStop(1, hexA(accent, 0));
      ctx.fillStyle = gr; ctx.fillRect(px, cy - ph / 2, pw, ph);
      ctx.fillStyle = d.color || '#ffffff';
      ctx.font = `500 ${fs * 0.22}px ${UI_FONT}`; ctx.textBaseline = 'middle';
      const words = tag.split(' '); const half = Math.ceil(words.length / 2);
      const l1 = words.slice(0, half).join(' '), l2 = words.slice(half).join(' ');
      ctx.fillText(l1, px + fs * 0.22, cy - (l2 ? fs * 0.14 : 0));
      if (l2) ctx.fillText(l2, px + fs * 0.22, cy + fs * 0.16);
      ctx.restore();
    }
  }
  ctx.restore();
}

export function hexA(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return `rgba(255,255,255,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

export const logoRevealApp = {
  type: 'logoreveal', label: 'Logo reveal', group: 'Launch', chip: 'logo', size: [1400, 400], chrome: 'none',
  blurb: 'A dot grows, becomes your logo, name and tagline appear',
  title: (d) => d.name,
  defaults: (t0) => ({ name: 'Pulse', tagline: 'Intelligent tracking for content funnels.', start: +(t0 + 0.1).toFixed(2), size: 110, color: '#ffffff', accent: '#2ee66b', logoId: null }),
  times: ['start'],
  fields: [
    { key: 'name', type: 'text', label: 'Product name' },
    { key: 'tagline', type: 'text', label: 'Tagline (optional)' },
    { key: 'logoId', type: 'media', accept: 'image', label: 'Logo mark (optional, round)' },
    { key: 'start', type: 'time', label: 'Reveal starts' },
    { key: 'size', type: 'number', label: 'Size', min: 30, max: 240, step: 2 },
    { key: 'color', type: 'color', label: 'Text colour' },
    { key: 'accent', type: 'color', label: 'Brand colour' },
  ],
  draw: drawLogoReveal,
};
