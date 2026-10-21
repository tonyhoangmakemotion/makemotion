// Terminal: commands are typed, output lines appear.

import { MONO_FONT, caretOn, typed, typingDuration } from './draw.js';

export function parseTerm(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const m = line.match(/^\s*(\d+(?:\.\d+)?)\s+([$>])\s?(.*)$/);
    if (m) out.push({ t: parseFloat(m[1]), kind: m[2] === '$' ? 'cmd' : 'out', text: m[3] });
  }
  return out.sort((a, b) => a.t - b.t);
}
const termToText = (ls) => ls.map((l) => `${+l.t.toFixed(2)} ${l.kind === 'cmd' ? '$' : '>'} ${l.text}`).join('\n');
const CPS = 22;

function draw(ctx, area, d, t) {
  const { x, y, w, h } = area;
  ctx.fillStyle = '#0d0f0e';
  ctx.fillRect(x, y, w, h);
  const fs = 16, lh = 24;
  ctx.font = `400 ${fs}px ${MONO_FONT}`;
  const prompt = `${d.user || 'user'}@${d.host || 'mac'} ~ %`;
  const rows = [];
  let typingNow = null;
  for (const l of d.lines || []) {
    if (t < l.t) break;
    if (l.kind === 'cmd') {
      const shown = typed(l.text, l.t, CPS, t);
      rows.push({ prompt: true, text: shown });
      if (shown.length < l.text.length) typingNow = rows[rows.length - 1];
    } else rows.push({ prompt: false, text: l.text });
  }
  const last = (d.lines || []).filter((l) => l.t <= t).pop();
  const idle = !typingNow && (!last || last.kind === 'out' || t >= last.t + typingDuration(last.text, CPS) + 0.3);
  if (idle) rows.push({ prompt: true, text: '', idle: true });
  const max = Math.floor((h - 24) / lh);
  const visible = rows.slice(-max);
  visible.forEach((r, i) => {
    const ly = y + 22 + i * lh + fs * 0.8;
    let cx = x + 16;
    if (r.prompt) {
      ctx.fillStyle = d.color || '#58e07a';
      ctx.fillText(prompt, cx, ly);
      cx += ctx.measureText(prompt + ' ').width;
    }
    ctx.fillStyle = r.prompt ? '#f2f2f2' : '#b8c0bb';
    ctx.fillText(r.text, cx, ly, w - (cx - x) - 16);
    if ((r === typingNow || (r.idle && caretOn(t))) && i === visible.length - 1) {
      ctx.fillStyle = '#f2f2f2';
      ctx.fillRect(cx + ctx.measureText(r.text).width + 2, ly - fs + 3, fs * 0.55, fs + 1);
    }
  });
}

export const app = {
  type: 'terminal', label: 'Terminal', group: 'Work', chip: 'term', size: [760, 440], chrome: 'window',
  blurb: 'Typed commands and output',
  title: (d) => `${d.user}@${d.host}: zsh`,
  defaults: (t0) => ({
    user: 'nesi', host: 'macbook', color: '#58e07a',
    lines: parseTerm([
      `${(t0 + 0.6).toFixed(1)} $ npm run build`,
      `${(t0 + 2.2).toFixed(1)} > vite building for production...`,
      `${(t0 + 2.6).toFixed(1)} > ✓ 128 modules transformed.`,
      `${(t0 + 3.0).toFixed(1)} > dist/index.html  0.46 kB`,
      `${(t0 + 3.6).toFixed(1)} $ git push origin main`,
      `${(t0 + 5.0).toFixed(1)} > To github.com:nesi/makemotion.git`,
    ].join('\n')),
  }),
  times: ['lines.*.t'],
  fields: [
    { key: 'user', type: 'text', label: 'User name' },
    { key: 'host', type: 'text', label: 'Computer name' },
    { key: 'color', type: 'color', label: 'Prompt color' },
    { key: 'lines', type: 'script', label: 'Lines: <code>seconds $ command</code> or <code>seconds &gt; output</code>', rows: 8, parse: parseTerm, format: termToText, mono: true },
  ],
  draw,
};
