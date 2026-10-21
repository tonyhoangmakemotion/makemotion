// Permission prompt card: "run <Title>?" with Deny / Always allow / Allow once.
// Great as a chapter card: the mouse clicks a choice, the scene continues.

import { roundRect, UI_FONT, MONO_FONT, wrapText, shadowScale } from './draw.js';
import { EASINGS, clamp } from '../model.js';

function burst(ctx, cx, cy, r, color) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1.5, r * 0.22);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2, r0 = r * (i % 2 ? 0.35 : 0.25);
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); ctx.stroke();
  }
  ctx.restore();
}

function draw(ctx, area, d, t) {
  const { x, y, w, h } = area;
  const s = w / 640; // everything scales with the card
  if (d.dim > 0) {
    // Dim the whole desktop behind the card, like a modal dialog.
    ctx.fillStyle = `rgba(0,0,0,${Math.min(0.95, d.dim)})`;
    ctx.fillRect(x - 6000, y - 6000, w + 12000, h + 12000);
  }
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 50 * s * shadowScale(ctx); ctx.shadowOffsetY = 18 * s * shadowScale(ctx);
  roundRect(ctx, x, y, w, h, 18 * s); ctx.fillStyle = '#232323'; ctx.fill();
  ctx.restore();
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 18 * s); ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.stroke();

  const pad = 28 * s;
  burst(ctx, x + pad + 10 * s, y + 46 * s, 11 * s, d.accent || '#d97757');
  ctx.font = `400 ${22 * s}px ${UI_FONT}`;
  ctx.fillStyle = '#e8e8e8';
  const pre = `${d.verb || 'run'} `;
  ctx.fillText(pre, x + pad + 34 * s, y + 54 * s);
  const pw = ctx.measureText(pre).width;
  ctx.font = `700 ${22 * s}px ${UI_FONT}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(d.title || 'Something', x + pad + 34 * s + pw, y + 54 * s);
  const tw = ctx.measureText(d.title || 'Something').width;
  ctx.font = `400 ${22 * s}px ${UI_FONT}`; ctx.fillStyle = '#e8e8e8';
  ctx.fillText('?', x + pad + 34 * s + pw + tw, y + 54 * s);

  ctx.font = `400 ${14 * s}px ${UI_FONT}`;
  ctx.fillStyle = '#8f8f8f';
  ctx.fillText(d.subtitle || '', x + pad, y + 92 * s, w - pad * 2);

  // Command box
  const bx = x + pad, by = y + 110 * s, bw = w - pad * 2;
  ctx.font = `400 ${14 * s}px ${MONO_FONT}`;
  const cmd = wrapText(ctx, d.command || '', bw - 28 * s).slice(0, 3);
  const bh = (cmd.length * 22 + 22) * s;
  roundRect(ctx, bx, by, bw, bh, 8 * s); ctx.fillStyle = '#2e2e2e'; ctx.fill();
  ctx.fillStyle = '#9a9a9a';
  cmd.forEach((l, i) => ctx.fillText(l, bx + 14 * s, by + (26 + i * 22) * s));

  // Buttons. The chosen one lights up when it is clicked (at clickAt).
  const opts = [d.deny || 'Deny', d.always || 'Always allow', d.once || 'Allow once'];
  const pick = { deny: 0, always: 1, once: 2 }[d.choice] ?? 2;
  const clicked = t >= (d.clickAt ?? Infinity);
  const press = clamp(1 - Math.abs(t - (d.clickAt ?? -9)) / 0.12, 0, 1);
  const rowY = by + bh + 22 * s, btnH = 34 * s;
  ctx.font = `600 ${14 * s}px ${UI_FONT}`;
  const widths = opts.map((o) => ctx.measureText(o).width + 48 * s);
  const pos = [x + pad - 8 * s, 0, 0];
  pos[2] = x + w - pad - widths[2] + 8 * s;
  pos[1] = pos[2] - 10 * s - widths[1];
  opts.forEach((o, i) => {
    const bxx = pos[i];
    const lit = i === pick && (clicked || i === 2);
    const k = i === pick ? 1 - 0.06 * press : 1;
    ctx.save();
    ctx.translate(bxx + widths[i] / 2, rowY + btnH / 2); ctx.scale(k, k); ctx.translate(-(bxx + widths[i] / 2), -(rowY + btnH / 2));
    if (lit) { roundRect(ctx, bxx, rowY, widths[i], btnH, 9 * s); ctx.fillStyle = clicked && i === pick ? '#ffffff' : '#3a3a3a'; ctx.fill(); }
    ctx.fillStyle = lit && clicked && i === pick ? '#111' : '#cfcfcf';
    ctx.fillText(o, bxx + 14 * s, rowY + 22 * s);
    const ow = ctx.measureText(o).width;
    roundRect(ctx, bxx + 20 * s + ow, rowY + 9 * s, 16 * s, 16 * s, 4 * s);
    ctx.fillStyle = lit && clicked && i === pick ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.08)'; ctx.fill();
    ctx.font = `600 ${10 * s}px ${UI_FONT}`;
    ctx.fillStyle = lit && clicked && i === pick ? '#333' : '#8f8f8f';
    ctx.textAlign = 'center'; ctx.fillText(String(i + 1), bxx + 28 * s + ow, rowY + 21 * s); ctx.textAlign = 'left';
    ctx.font = `600 ${14 * s}px ${UI_FONT}`;
    ctx.restore();
  });
}

export const app = {
  type: 'prompt', label: 'Prompt card', group: 'Launch', chip: 'ask', size: [640, 250], chrome: 'none', enter: 'fade',
  blurb: '"run Chapter One?" chapter card',
  title: (d) => `${d.verb} ${d.title}?`,
  defaults: (t0) => ({
    verb: 'run', title: 'My Strange Addiction', subtitle: 'Let the story start where it all began',
    command: 'bash ~/webprojects/mystrangeaddiction/chapter-one.sh', choice: 'once', clickAt: +(t0 + 1.6).toFixed(2), accent: '#d97757', dim: 0.8,
    deny: 'Deny', always: 'Always allow', once: 'Allow once',
  }),
  times: ['clickAt'],
  fields: [
    { key: 'verb', type: 'text', label: 'First word' },
    { key: 'title', type: 'text', label: 'Title (bold)' },
    { key: 'subtitle', type: 'text', label: 'Line under the title' },
    { key: 'command', type: 'textarea', rows: 2, label: 'Command box' },
    { key: 'choice', type: 'select', label: 'Button that gets clicked', options: [['once', 'Allow once'], ['always', 'Always allow'], ['deny', 'Deny']] },
    { key: 'clickAt', type: 'time', label: 'Clicked at' },
    { key: 'accent', type: 'color', label: 'Icon color' },
    { key: 'dim', type: 'number', label: 'Darken the desktop behind (0 to 0.95)', min: 0, max: 0.95, step: 0.05 },
    { type: 'note', text: 'Tip: put the mouse on the button at the click time (Mouse panel) so the click lands on it.' },
  ],
  draw,
};
