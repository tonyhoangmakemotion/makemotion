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
//          (one|two|three) a word that rolls through options · ~ a coloured dot (like a logo mark)
// Effects (d.effect), from the launch videos in docs/launch-video-analysis.md:
//   blur      words blur in and rise one by one (default)
//   type      typewriter: letters appear at d.cps per second with a caret
//   stickers  each word slams in on its own coloured block, staggered up and down
//   scramble  each word decodes from random letters
export function tokenize(src) {
  const toks = [];
  const re = /\*([^*]+)\*|\[([^\]]+)\]|\{([^}]+)\}|\(([^()|]+(?:\|[^()|]+)+)\)|(~)|(\S+)/g;
  let m;
  while ((m = re.exec(String(src || '')))) {
    if (m[1]) toks.push({ kind: 'accent', text: m[1] });
    else if (m[2]) {
      const c = /^\s*([^\d-]*)(-?[\d.,]+)\s*>\s*(-?[\d.,]+)(.*)$/.exec(m[2]);
      if (c) toks.push({ kind: 'count', pre: c[1], from: parseFloat(c[2].replace(/,/g, '')), to: parseFloat(c[3].replace(/,/g, '')), post: c[4], dec: (c[3].split('.')[1] || '').length, text: m[2] });
      else toks.push({ kind: 'pill', text: m[2] });
    } else if (m[3]) toks.push({ kind: 'outline', text: m[3] });
    else if (m[4]) { const opts = m[4].split('|').map((o) => o.trim()).filter(Boolean); toks.push({ kind: 'roll', opts, text: opts[0] }); }
    else if (m[5]) toks.push({ kind: 'dot', text: '' });
    else toks.push({ kind: 'word', text: m[6] });
  }
  return toks;
}

const fmtNum = (v, dec) => v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const STICKERS = ['#ececee', '#c6f5a0', '#fbf38a', '#cfe0ff', '#ffd3c4'];
const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&*+<>?/{}';
const hash = (n) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };

// Which option a rolling word shows at t, and how far into the change to the next one it is.
function rollState(tk, t, every) {
  const n = tk.opts.length, e = Math.max(0.2, every);
  const p = Math.max(0, t - tk.t0) / e;
  const i = Math.min(n - 1, Math.floor(p));
  const k = i >= n - 1 ? 0 : out(clamp((p - i - (1 - 0.3 / e)) / (0.3 / e), 0, 1));
  return { i, k };
}

function drawSentence(ctx, area, d, t) {
  const { x, y, w, h } = area;
  const toks = tokenize(d.text);
  if (!toks.length) return;
  const effect = d.effect || 'blur';
  const fs = d.size || 72;
  const font = `${d.weight || 600} ${fs}px ${UI_FONT}`;
  ctx.save();
  ctx.font = font;
  const stick = effect === 'stickers';
  const space = stick ? -fs * 0.06 : fs * 0.28, padX = fs * 0.3, pillH = fs * 1.18;
  const gap = d.gap ?? 0.22, start = d.start ?? 0, every = d.rollEvery ?? 0.7;
  const mw = (s) => ctx.measureText(s).width;
  // Measure each token at full size.
  for (const tk of toks) {
    if (tk.kind === 'dot') tk.w = fs * 0.78;
    else if (tk.kind === 'count') tk.w = Math.max(mw(tk.pre + fmtNum(tk.from, tk.dec) + tk.post), mw(tk.pre + fmtNum(tk.to, tk.dec) + tk.post)) + padX * 2;
    else if (tk.kind === 'roll') { tk.ws = tk.opts.map(mw); tk.w = Math.max(...tk.ws); }
    else tk.w = mw(tk.text) + (tk.kind === 'pill' || tk.kind === 'outline' ? padX * 2 : 0);
    if (stick) tk.w += padX * 2;
  }
  // Wrap into lines that fit the window.
  const lines = [[]];
  let lw = 0;
  for (const tk of toks) {
    const add = (lines[lines.length - 1].length ? space : 0) + tk.w;
    if (lw + add > w && lines[lines.length - 1].length) { lines.push([]); lw = 0; }
    lines[lines.length - 1].push(tk); lw += (lines[lines.length - 1].length > 1 ? space : 0) + tk.w;
  }
  // Timing: one word per `gap`, or for the typewriter one letter per 1/cps.
  const cps = d.cps || 26;
  let i = 0, c = 0;
  for (const ln of lines) for (const tk of ln) {
    tk.t0 = start + i * gap; i++;
    tk.c0 = c; tk.len = tk.kind === 'word' || tk.kind === 'accent' || tk.kind === 'roll' ? tk.text.length : 1; c += tk.len + 1;
    if (effect === 'type') tk.t0 = start + tk.c0 / cps;
  }
  const typed = (t - start) * cps;
  const exitK = d.exitAt != null && d.exitAt > start ? clamp((t - d.exitAt) / 0.35, 0, 1) : 0;
  const lineH = fs * (stick ? 1.7 : 1.32);
  const top = y + h / 2 - (lines.length * lineH) / 2 + lineH / 2;
  const accent = d.accent || '#f4f4f6';
  const textCol = d.color || '#ffffff';
  // How revealed a token is (0-1) and how wide it currently is.
  const kOf = (tk) => {
    if (effect === 'type') return typed >= tk.c0 ? 1 : 0;
    return out(clamp((t - tk.t0) / (stick ? 0.26 : 0.32), 0, 1));
  };
  const widthOf = (tk, k) => {
    if (effect === 'type') {
      if (tk.kind === 'word' || tk.kind === 'accent' || tk.kind === 'roll') return mw((tk.kind === 'roll' ? tk.opts[0] : tk.text).slice(0, Math.max(0, Math.min(tk.len, Math.ceil(typed - tk.c0)))));
      return tk.w;
    }
    if (tk.kind === 'roll') { const r = rollState(tk, t, every); const cur = tk.ws[r.i], nxt = tk.ws[Math.min(tk.opts.length - 1, r.i + 1)]; return (lerp(cur, nxt, r.k) + (stick ? padX * 2 : 0)) * (effect === 'blur' ? 0.55 + 0.45 * k : 1); }
    return tk.w * (effect === 'blur' ? 0.55 + 0.45 * k : 1);
  };
  let caret = null;
  lines.forEach((ln, li) => {
    // The line re-centres as it grows: only revealed words take up room.
    let width = 0, nVis = 0;
    ln.forEach((tk) => { const k = kOf(tk); if (k > 0) { width += (nVis ? space : 0) * Math.min(1, k * 2) + widthOf(tk, k); nVis++; } });
    let cx = d.align === 'left' ? x : x + (w - width) / 2;
    const cy = top + li * lineH;
    let first = true;
    ln.forEach((tk, j) => {
      const k = kOf(tk);
      if (k <= 0) return;
      if (!first) cx += space * Math.min(1, k * 2);
      first = false;
      const tw = widthOf(tk, k);
      ctx.save();
      ctx.globalAlpha *= (effect === 'type' ? 1 : Math.min(1, k * 1.6)) * (1 - exitK);
      let blur = exitK * 14, dy = 0, sc = 1;
      if (effect === 'blur') { blur += (1 - k) * 10; dy = (1 - k) * fs * 0.32; sc = 0.55 + 0.45 * k; }
      else if (stick) { const kb = EASINGS.back(clamp((t - tk.t0) / 0.3, 0, 1)); sc = 1.5 - 0.5 * kb; blur += (1 - k) * 6; dy = [0, 0.42, -0.22, 0.3, -0.12][j % 5] * fs; }
      else if (effect === 'scramble') { blur += (1 - k) * 4; }
      if (canFilter && blur > 0.3) ctx.filter = `blur(${blur.toFixed(1)}px)`;
      ctx.translate(cx + tw / 2, cy + dy); ctx.scale(sc, sc); ctx.translate(-tw / 2, 0);
      ctx.textBaseline = 'middle';
      const inset = stick ? padX : 0;
      if (stick) { ctx.fillStyle = (d.blocks && d.blocks.length ? d.blocks : STICKERS)[j % (d.blocks?.length || STICKERS.length)]; ctx.fillRect(0, -fs * 0.66, tw, fs * 1.32); }
      if (tk.kind === 'pill' || tk.kind === 'count') {
        const pw = tk.w - inset * 2;
        roundRect(ctx, inset, -pillH / 2, pw, pillH, fs * 0.22);
        ctx.fillStyle = accent; ctx.fill();
        ctx.fillStyle = d.pillText || '#0b0b0d';
        let label = tk.text;
        if (tk.kind === 'count') { const cc = out(clamp((t - tk.t0 - 0.15) / (d.countDur ?? 0.9), 0, 1)); label = tk.pre + fmtNum(lerp(tk.from, tk.to, cc), tk.dec) + tk.post; }
        ctx.textAlign = 'center'; ctx.fillText(label, inset + pw / 2, fs * 0.04); ctx.textAlign = 'left';
      } else if (tk.kind === 'outline') {
        roundRect(ctx, inset, -pillH / 2, tk.w - inset * 2, pillH, pillH / 2);
        ctx.strokeStyle = textCol; ctx.lineWidth = Math.max(2, fs * 0.04); ctx.stroke();
        ctx.fillStyle = textCol;
        ctx.fillText(tk.text, inset + padX, fs * 0.04);
      } else if (tk.kind === 'dot') {
        ctx.beginPath(); ctx.arc(tw / 2, 0, fs * 0.36, 0, Math.PI * 2); ctx.fillStyle = accent; ctx.fill();
      } else {
        const col = stick ? (d.pillText || '#0b0b0d') : (tk.kind === 'word' ? textCol : accent);
        ctx.fillStyle = col;
        if (tk.kind === 'roll' && effect !== 'type') {
          // The current option slides up and out, the next comes up from below, clipped to the line.
          const r = rollState(tk, t, every);
          ctx.save(); ctx.beginPath(); ctx.rect(-fs * 0.2, -fs * 0.72, tw + fs * 0.4, fs * 1.44); ctx.clip();
          ctx.globalAlpha *= 1 - r.k; ctx.fillText(tk.opts[r.i], inset, fs * 0.04 - r.k * fs * 0.9);
          ctx.restore();
          if (r.k > 0) { ctx.save(); ctx.beginPath(); ctx.rect(-fs * 0.2, -fs * 0.72, tw + fs * 0.4, fs * 1.44); ctx.clip(); ctx.globalAlpha *= r.k; ctx.fillText(tk.opts[r.i + 1], inset, fs * 0.04 + (1 - r.k) * fs * 0.9); ctx.restore(); }
        } else if (effect === 'type') {
          const n = Math.max(0, Math.min(tk.len, Math.ceil(typed - tk.c0)));
          const str = (tk.kind === 'roll' ? tk.opts[0] : tk.text).slice(0, n);
          ctx.fillText(str, 0, fs * 0.04);
          caret = { x: cx + mw(str), y: cy };
        } else if (effect === 'scramble') {
          const res = clamp((t - tk.t0) / 0.45, 0, 1), L = tk.text.length, solid = Math.floor(res * L);
          let str = tk.text.slice(0, solid);
          for (let q = solid; q < L; q++) str += tk.text[q] === ' ' ? ' ' : GLYPHS[Math.floor(hash(q * 31 + Math.floor(t * 24) + j * 7) * GLYPHS.length)];
          ctx.fillText(str, 0, fs * 0.04);
        } else ctx.fillText(tk.text, inset, fs * 0.04);
      }
      ctx.restore();
      if (effect === 'type' && tk.kind !== 'word' && tk.kind !== 'accent' && tk.kind !== 'roll') caret = { x: cx + tw, y: cy };
      cx += tw;
    });
  });
  // Typewriter caret: solid while typing, then blinks until the line leaves.
  if (effect === 'type' && caret && t >= start && d.caret !== false) {
    const done = typed >= c, on = !done || Math.floor((t - start - c / cps) * 2.2) % 2 === 0;
    if (on) { ctx.globalAlpha *= 1 - exitK; ctx.fillStyle = textCol; ctx.fillRect(caret.x + fs * 0.06, caret.y - fs * 0.45, Math.max(2, fs * 0.05), fs * 0.9); }
  }
  ctx.restore();
}

export const sentenceApp = {
  type: 'sentence', label: 'Kinetic line', group: 'Launch', chip: 'kin', size: [1500, 260], chrome: 'none',
  blurb: 'Words blur in, type, slam onto blocks or decode, with pills, counters and rolling words',
  title: (d) => String(d.text || '').replace(/\(([^()|]+)\|[^()]*\)/g, '$1').replace(/[*[\]{}~]/g, ''),
  defaults: (t0) => ({ text: 'You just got [7>22] warm leads', start: +(t0 + 0.1).toFixed(2), gap: 0.22, size: 76, weight: 600, color: '#ffffff', accent: '#f4f4f6', pillText: '#0b0b0d', align: 'center', exitAt: null, countDur: 0.9, effect: 'blur', cps: 26, rollEvery: 0.7 }),
  times: ['start', 'exitAt'],
  fields: [
    { key: 'text', type: 'textarea', rows: 2, count: 60, label: 'Content <span class="hint"><code>[pill]</code> <code>{outline}</code> <code>*accent*</code> <code>[7&gt;22]</code> <code>(a|b|c)</code></span>' },
    { key: 'effect', type: 'select', label: 'Animation', options: [['blur', 'Blur in word by word'], ['type', 'Typewriter'], ['stickers', 'Words on coloured blocks'], ['scramble', 'Decode (scrambled letters)']] },
    { key: 'start', type: 'time', label: 'First word at' },
    { key: 'gap', type: 'number', label: 'Seconds between words', min: 0.05, max: 1.5, step: 0.01, when: (d) => d.effect !== 'type' },
    { key: 'cps', type: 'number', label: 'Letters per second', min: 4, max: 80, step: 1, when: (d) => d.effect === 'type' },
    { key: 'rollEvery', type: 'number', label: 'Rolling word: seconds per option', min: 0.2, max: 3, step: 0.05, when: (d) => /\([^()]*\|/.test(d.text || '') },
    { key: 'exitAt', type: 'time', label: 'Blur out at (0 = stays)' },
    { key: 'size', type: 'number', label: 'Text size', min: 20, max: 240, step: 2 },
    { key: 'weight', type: 'select', label: 'Weight', options: [[400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Extra bold']] },
    { key: 'color', type: 'color', label: 'Text colour' },
    { key: 'accent', type: 'color', label: 'Accent (pills, coloured words)' },
    { key: 'pillText', type: 'color', label: 'Text inside pills and on blocks' },
    { key: 'align', type: 'select', label: 'Align', options: [['center', 'Centre (re-centres as it grows)'], ['left', 'Left']] },
  ],
  draw: drawSentence,
};

// ---------- Logo reveal ----------

// Where the ink is in an image (transparent PNG logos): its bounding box and, for a written-out
// name, where the first letter (the mark) ends. Cached per image, so drawing stays pure and cheap.
const INK = new WeakMap();
function inkInfo(img) {
  if (INK.has(img)) return INK.get(img);
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  let info = { x0: 0, y0: 0, x1: 1, y1: 1, split: 0.15, m: { x0: 0, y0: 0, x1: 0.15, y1: 1 } };
  try {
    const k = Math.min(1, 1200 / iw), cw = Math.max(1, Math.round(iw * k)), ch = Math.max(1, Math.round(ih * k));
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, cw, ch);
    const px = g.getImageData(0, 0, cw, ch).data;
    const ink = (i, j) => px[(j * cw + i) * 4 + 3] > 60;
    const colInk = new Array(cw).fill(0);
    let x0 = cw, x1 = -1, y0 = ch, y1 = -1;
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) if (ink(i, j)) { colInk[i]++; if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
    if (x1 >= 0) {
      let s = x0; while (s <= x1 && colInk[s] > 0) s++;
      let my0 = ch, my1 = -1;
      for (let j = 0; j < ch; j++) for (let i = x0; i < s; i++) if (ink(i, j)) { if (j < my0) my0 = j; if (j > my1) my1 = j; break; }
      info = { x0: x0 / cw, y0: y0 / ch, x1: (x1 + 1) / cw, y1: (y1 + 1) / ch, split: s / cw, m: { x0: x0 / cw, y0: my0 / ch, x1: s / cw, y1: (my1 + 1) / ch } };
    }
    INK.set(img, info);
  } catch { /* not decoded yet: try again next frame */ }
  return info;
}

// With a written-out name (wordmark image): the mark pops big, shrinks into the wordmark's first
// letter, the rest of the name slides out of it, the tagline rises in underneath.
function drawWordmarkReveal(ctx, area, d, a, word, logo) {
  const { x, y, w, h } = area;
  const fs = d.size || 96;
  const tag = d.tagline || '';
  const wi = inkInfo(word.el);
  const WW = word.el.naturalWidth || word.el.width, WH = word.el.naturalHeight || word.el.height;
  // Size the wordmark by its ink height (fs*1.15), capped to the window width.
  let sc = (fs * 1.15) / ((wi.y1 - wi.y0) * WH);
  sc = Math.min(sc, (w * 0.92) / ((wi.x1 - wi.x0) * WW));
  const cx = x + w / 2, cy = y + h / 2 - (tag ? fs * 0.3 : 0);
  const ox = cx - ((wi.x0 + wi.x1) / 2) * WW * sc, oy = cy - ((wi.y0 + wi.y1) / 2) * WH * sc;
  const mb = { x: ox + wi.m.x0 * WW * sc, y: oy + wi.m.y0 * WH * sc, w: (wi.m.x1 - wi.m.x0) * WW * sc, h: (wi.m.y1 - wi.m.y0) * WH * sc };
  // The mark: your logo if uploaded, otherwise the wordmark's own first letter.
  let src, sx, sy, sw, sh;
  if (logo) {
    const li = inkInfo(logo.el), LW = logo.el.naturalWidth || logo.el.width, LH = logo.el.naturalHeight || logo.el.height;
    src = logo.el; sx = li.x0 * LW; sy = li.y0 * LH; sw = (li.x1 - li.x0) * LW; sh = (li.y1 - li.y0) * LH;
  } else { src = word.el; sx = wi.m.x0 * WW; sy = wi.m.y0 * WH; sw = (wi.m.x1 - wi.m.x0) * WW; sh = (wi.m.y1 - wi.m.y0) * WH; }
  const pop = EASINGS.back(clamp(a / 0.55, 0, 1));
  const shrink = EASINGS.smooth(clamp((a - 0.9) / 0.6, 0, 1));
  const bigH = Math.min(h * 0.62, (w * 0.5) * (sh / sw), fs * 3.4) * Math.max(0, pop);
  const fh = lerp(bigH, mb.h, shrink), fw = fh * (sw / sh);
  const mcx = lerp(x + w / 2, mb.x + mb.w / 2, shrink), mcy = lerp(y + h / 2, mb.y + mb.h / 2, shrink);
  const blurIn = (1 - clamp(a / 0.35, 0, 1)) * 14;
  ctx.save();
  ctx.globalAlpha *= clamp(a / 0.2, 0, 1);
  if (canFilter && blurIn > 0.3) ctx.filter = `blur(${blurIn.toFixed(1)}px)`;
  if (fh > 0.5) { try { ctx.drawImage(src, sx, sy, sw, sh, mcx - fw / 2, mcy - fh / 2, fw, fh); } catch { /* decoding */ } }
  ctx.restore();
  // The rest of the name slides out from behind the mark (1.3-1.95 s).
  const nameK = out(clamp((a - 1.3) / 0.65, 0, 1));
  if (nameK > 0) {
    const restX = ox + wi.split * WW * sc, restW = (wi.x1 - wi.split) * WW * sc;
    ctx.save();
    ctx.beginPath(); ctx.rect(restX, oy, restW + 8, WH * sc); ctx.clip();
    ctx.globalAlpha *= nameK;
    const shift = -(1 - nameK) * restW * 0.45;
    try { ctx.drawImage(word.el, wi.split * WW, 0, (1 - wi.split) * WW, WH, restX + shift, oy, (1 - wi.split) * WW * sc, WH * sc); } catch { /* decoding */ }
    ctx.restore();
  }
  // Tagline rises in under the name (2.0-2.7 s).
  if (tag) {
    const tk = out(clamp((a - 2.0) / 0.7, 0, 1));
    if (tk > 0) {
      ctx.save();
      ctx.globalAlpha *= tk * 0.78;
      if (canFilter && tk < 0.98) ctx.filter = `blur(${((1 - tk) * 8).toFixed(1)}px)`;
      ctx.fillStyle = d.color || '#ffffff';
      ctx.font = `500 ${fs * 0.3}px ${UI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(tag, cx, oy + wi.y1 * WH * sc + fs * 0.55 + (1 - tk) * fs * 0.25);
      ctx.restore();
    }
  }
}

function drawLogoReveal(ctx, area, d, t) {
  const { x, y, w, h } = area;
  const a = t - (d.start ?? 0);
  if (a < 0) return;
  const word = getMediaSafe(d.wordmarkId);
  if (word?.el && (word.el.naturalWidth || word.el.width)) {
    const lg = getMediaSafe(d.logoId);
    return drawWordmarkReveal(ctx, area, d, a, word, lg?.el && (lg.el.naturalWidth || lg.el.width) ? lg : null);
  }
  const accent = d.accent || '#f4f4f6';
  const fs = d.size || 96;
  const markR = fs * 0.46;
  ctx.save();
  ctx.font = `600 ${fs}px ${UI_FONT}`;
  const nameW = ctx.measureText(d.name || '').width;
  const gap = fs * 0.24;
  const tag = d.tagline || '';
  ctx.font = `500 ${fs * 0.26}px ${UI_FONT}`;
  const tagW = tag ? Math.max(ctx.measureText(tag).width * 0.62, fs * 2.2) : 0;
  const total = markR * 2 + gap + nameW + (tag ? gap * 1.2 + tagW : 0);
  const cx = x + w / 2, cy = y + h / 2;
  // 1) The logo pops up big in the middle (0-0.55 s), holds, 2) then shrinks into its place
  //    next to the name (0.9-1.5 s).
  const pop = EASINGS.back(clamp(a / 0.55, 0, 1));
  const shrink = EASINGS.smooth(clamp((a - 0.9) / 0.6, 0, 1));
  const bigR = Math.min(w * 0.3, h * 0.42);
  const r = lerp(bigR * Math.max(0, pop), markR, shrink);
  const finalMx = x + (w - total) / 2 + markR;
  const mx = lerp(cx, finalMx, shrink);
  const blurIn = (1 - clamp(a / 0.35, 0, 1)) * 14;
  ctx.save();
  ctx.globalAlpha *= clamp(a / 0.2, 0, 1);
  if (canFilter && blurIn > 0.3) ctx.filter = `blur(${blurIn.toFixed(1)}px)`;
  const logo = getMediaSafe(d.logoId);
  const lw = logo?.el?.naturalWidth || logo?.el?.width, lh = logo?.el?.naturalHeight || logo?.el?.height;
  if (lw && lh) {
    // Your uploaded logo, kept in proportion inside the mark's square.
    const sc = (r * 2) / Math.max(lw, lh);
    try { ctx.drawImage(logo.el, mx - (lw * sc) / 2, cy - (lh * sc) / 2, lw * sc, lh * sc); } catch { /* not decoded yet */ }
  } else {
    // No logo yet: a clean monogram (first letter of the name).
    ctx.beginPath(); ctx.arc(mx, cy, r, 0, Math.PI * 2); ctx.fillStyle = accent; ctx.fill();
    ctx.fillStyle = d.markText || '#0b0b0d';
    ctx.font = `700 ${r * 1.1}px ${UI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(d.name || '?').trim().charAt(0).toUpperCase(), mx, cy + r * 0.04);
  }
  ctx.restore();
  // 3) the name slides out from behind the mark (1.3-1.9 s)
  const nameK = out(clamp((a - 1.3) / 0.6, 0, 1));
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
  // 4) tagline panel wipes in with a light sweep (2.0-2.8 s)
  if (tag) {
    const tk = EASINGS.smooth(clamp((a - 2.0) / 0.8, 0, 1));
    if (tk > 0) {
      const px = finalMx + markR + gap + nameW + gap * 1.2, ph = fs * 0.9, pw = tagW;
      ctx.save();
      ctx.beginPath(); ctx.rect(px, cy - ph / 2, pw * tk, ph); ctx.clip();
      const gr = ctx.createLinearGradient(px, 0, px + pw, 0);
      gr.addColorStop(0, accent); gr.addColorStop(0.05, accent); gr.addColorStop(0.06, hexA(accent, 0.22)); gr.addColorStop(1, hexA(accent, 0));
      ctx.fillStyle = gr; ctx.fillRect(px, cy - ph / 2, pw, ph);
      ctx.fillStyle = d.color || '#ffffff';
      ctx.font = `500 ${fs * 0.22}px ${UI_FONT}`; ctx.textBaseline = 'middle';
      const words = tag.split(' '); const half = Math.ceil(words.length / 2);
      const l1 = words.slice(0, half).join(' '), l2 = words.slice(half).join(' ');
      ctx.fillText(l1, px + fs * 0.24, cy - (l2 ? fs * 0.14 : 0));
      if (l2) ctx.fillText(l2, px + fs * 0.24, cy + fs * 0.16);
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
  blurb: 'Your logo pops up big, shrinks into place, name and tagline appear',
  title: (d) => d.name,
  defaults: (t0) => ({ name: 'Lumen', tagline: 'Know what brings you customers.', start: +(t0 + 0.1).toFixed(2), size: 110, color: '#ffffff', accent: '#f4f4f6', markText: '#0b0b0d', logoId: null, wordmarkId: null }),
  times: ['start'],
  fields: [
    { key: 'name', type: 'text', label: 'Product name' },
    { key: 'tagline', type: 'text', label: 'Tagline (optional)' },
    { key: 'logoId', type: 'media', accept: 'image', label: 'Your logo (pops up big, then shrinks into place)' },
    { key: 'wordmarkId', type: 'media', accept: 'image', label: 'Your name written out (optional, transparent PNG; the logo shrinks into its first letter)' },
    { key: 'start', type: 'time', label: 'Reveal starts' },
    { key: 'size', type: 'number', label: 'Size', min: 30, max: 240, step: 2 },
    { key: 'color', type: 'color', label: 'Text colour' },
    { key: 'accent', type: 'color', label: 'Mark and tagline colour (when no logo)' },
    { key: 'markText', type: 'color', label: 'Letter on the mark' },
  ],
  draw: drawLogoReveal,
};
