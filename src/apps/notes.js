// Notes: a notes app or a sticky note, typing its text out.

import { UI_FONT, caretOn, typedCount, wrapText, roundRect } from './draw.js';

const HAND = "'Instrument Serif', Georgia, serif";

function draw(ctx, area, d, t) {
  const { x, y, w, h } = area;
  const sticky = d.style === 'sticky';
  const n = typedCount(d.text || '', d.start, d.cps || 25, t);
  const shown = (d.text || '').slice(0, n);
  const typing = t >= d.start && n < (d.text || '').length;
  if (sticky) {
    ctx.fillStyle = d.paper || '#fde68a';
    ctx.fillRect(x, y, w, h);
    const g = ctx.createLinearGradient(x, y, x, y + 30);
    g.addColorStop(0, 'rgba(0,0,0,0.08)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(x, y, w, 30);
  } else {
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(x, y, w * 0.3, h);
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(x + w * 0.3 - 1, y, 1, h);
    ctx.font = `600 13px ${UI_FONT}`;
    ctx.fillStyle = '#9a9a9a';
    ctx.fillText('Today', x + 16, y + 28);
    roundRect(ctx, x + 8, y + 40, w * 0.3 - 16, 54, 8);
    ctx.fillStyle = '#d6a500'; ctx.fill();
    ctx.fillStyle = '#111';
    ctx.font = `600 14px ${UI_FONT}`;
    ctx.fillText(d.title || 'Note', x + 18, y + 62, w * 0.3 - 36);
    ctx.font = `400 12px ${UI_FONT}`;
    ctx.fillText(shown.split('\n')[0].slice(0, 40) || 'No additional text', x + 18, y + 80, w * 0.3 - 36);
    ctx.fillStyle = '#171717';
    ctx.fillRect(x + w * 0.3, y, w * 0.7, h);
  }
  const bx = sticky ? x + 26 : x + w * 0.3 + 30;
  const bw = sticky ? w - 52 : w * 0.7 - 60;
  let ly = y + (sticky ? 52 : 40);
  if (!sticky) {
    ctx.fillStyle = '#8a8a8a';
    ctx.font = `400 12px ${UI_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(d.date || 'October 13, 2026 at 23:41', x + w * 0.65, y + 22);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f2f2f2';
    ctx.font = `700 24px ${UI_FONT}`;
    ctx.fillText(d.title || 'Note', bx, ly + 14, bw);
    ly += 50;
  }
  const fs = sticky ? 30 : 16, lh = sticky ? 34 : 24;
  ctx.font = sticky ? `400 ${fs}px ${HAND}` : `400 ${fs}px ${UI_FONT}`;
  ctx.fillStyle = sticky ? '#3a2c00' : '#e6e6e6';
  let caretX = bx, caretY = ly;
  for (const para of shown.split('\n')) {
    const lines = para ? wrapText(ctx, para, bw) : [''];
    for (const line of lines) {
      ctx.fillText(line, bx, ly);
      caretX = bx + ctx.measureText(line).width; caretY = ly;
      ly += lh;
    }
  }
  if (t >= d.start && (typing || caretOn(t))) {
    ctx.fillStyle = sticky ? '#3a2c00' : '#d6a500';
    ctx.fillRect(caretX + 2, caretY - fs + 2, 2, fs + 2);
  }
}

export const app = {
  type: 'notes', label: 'Notes', group: 'Work', chip: 'note', size: [720, 480], chrome: 'window',
  blurb: 'Notes app or sticky note',
  title: (d) => (d.style === 'sticky' ? '' : 'Notes'),
  chromeFor: (d) => (d.style === 'sticky' ? 'none' : 'window'),
  defaults: (t0) => ({
    style: 'app', title: 'Things I know', start: +(t0 + 0.6).toFixed(2), cps: 22, paper: '#fde68a',
    text: '1. He left at 23:12\n2. The car was still there\n3. Who sent the email?',
  }),
  times: ['start'],
  fields: [
    { key: 'style', type: 'select', label: 'Look', options: [['app', 'Notes app'], ['sticky', 'Sticky note']] },
    { key: 'title', type: 'text', label: 'Note title', when: (d) => d.style !== 'sticky' },
    { key: 'paper', type: 'color', label: 'Paper color', when: (d) => d.style === 'sticky' },
    { key: 'start', type: 'time', label: 'Starts typing at' },
    { key: 'cps', type: 'number', label: 'Speed (characters/s)', min: 1, max: 200 },
    { key: 'text', type: 'textarea', label: 'Text', rows: 6 },
  ],
  draw,
};
