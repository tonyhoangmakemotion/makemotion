// Task board: cards slide between columns at the times you set.

import { roundRect, UI_FONT, fitText, colorFor, shadowScale } from './draw.js';
import { EASINGS, clamp } from '../model.js';

// "Design landing page | To do | Mara"
export function parseCards(text) {
  return String(text).split('\n').map((l) => l.split('|').map((s) => s.trim())).filter((p) => p[0])
    .map(([title, column = '', who = '']) => ({ title, column, who }));
}
const cardsToText = (c) => c.map((x) => `${x.title} | ${x.column} | ${x.who}`).join('\n');
// "2.5 Design landing page > Done"
export function parseMoves(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const m = line.match(/^\s*(\d+(?:\.\d+)?)\s+(.+?)\s*>\s*(.+)$/);
    if (m) out.push({ t: parseFloat(m[1]), card: m[2].trim(), to: m[3].trim() });
  }
  return out.sort((a, b) => a.t - b.t);
}
const movesToText = (m) => m.map((x) => `${+x.t.toFixed(2)} ${x.card} > ${x.to}`).join('\n');

const MOVE = 0.6;

function columnsAt(d, cols, time) {
  const where = new Map(d.cards.map((c) => [c.title, cols.includes(c.column) ? c.column : cols[0]]));
  for (const m of d.moves || []) if (m.t <= time && where.has(m.card) && cols.includes(m.to)) where.set(m.card, m.to);
  return where;
}

function draw(ctx, area, d, t) {
  const { x, y, w, h } = area;
  ctx.fillStyle = '#f4f5f7'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#172b4d'; ctx.font = `700 20px ${UI_FONT}`;
  ctx.fillText(d.board || 'Launch', x + 24, y + 38);
  const cols = (d.columns || []).length ? d.columns : ['To do', 'In progress', 'Done'];
  const pad = 20, gap = 14, top = y + 60;
  const cw = (w - pad * 2 - gap * (cols.length - 1)) / cols.length;
  const cardH = 74, cardGap = 10;
  cols.forEach((c, i) => {
    const cx = x + pad + i * (cw + gap);
    roundRect(ctx, cx, top, cw, h - (top - y) - 18, 12); ctx.fillStyle = '#ebecf0'; ctx.fill();
    ctx.fillStyle = '#5e6c84'; ctx.font = `600 12px ${UI_FONT}`;
    ctx.fillText(c.toUpperCase(), cx + 14, top + 24);
  });
  const slotPos = (where) => {
    const pos = new Map(), counts = new Map();
    for (const card of d.cards) {
      const col = where.get(card.title);
      const ci = cols.indexOf(col), n = counts.get(col) || 0;
      counts.set(col, n + 1);
      pos.set(card.title, { x: x + pad + ci * (cw + gap) + 10, y: top + 40 + n * (cardH + cardGap) });
    }
    return pos;
  };
  const now = slotPos(columnsAt(d, cols, t));
  const active = (d.moves || []).filter((m) => t >= m.t && t < m.t + MOVE).pop();
  let blendFrom = null, k = 1;
  if (active) { blendFrom = slotPos(columnsAt(d, cols, active.t - 1e-3)); k = EASINGS.smooth((t - active.t) / MOVE); }
  const draws = d.cards.map((card) => {
    const p1 = now.get(card.title), p0 = blendFrom ? blendFrom.get(card.title) : p1;
    const moving = active && active.card === card.title;
    return { card, x: p0.x + (p1.x - p0.x) * k, y: p0.y + (p1.y - p0.y) * k, moving };
  });
  draws.sort((a, b) => (a.moving ? 1 : 0) - (b.moving ? 1 : 0));
  for (const dc of draws) {
    ctx.save();
    const lift = dc.moving ? Math.sin(Math.PI * k) : 0;
    ctx.shadowColor = `rgba(9,30,66,${0.15 + lift * 0.25})`; ctx.shadowBlur = (4 + lift * 20) * shadowScale(ctx); ctx.shadowOffsetY = (1 + lift * 8) * shadowScale(ctx);
    ctx.translate(dc.x + (cw - 20) / 2, dc.y + cardH / 2); ctx.rotate(lift * 0.04); ctx.scale(1 + lift * 0.04, 1 + lift * 0.04); ctx.translate(-(dc.x + (cw - 20) / 2), -(dc.y + cardH / 2));
    roundRect(ctx, dc.x, dc.y, cw - 20, cardH, 10); ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.shadowColor = 'transparent';
    const done = columnsAt(d, cols, t).get(dc.card.title) === cols[cols.length - 1];
    ctx.fillStyle = done ? '#36b37e' : colorFor(dc.card.title);
    roundRect(ctx, dc.x + 12, dc.y + 12, 40, 6, 3); ctx.fill();
    ctx.fillStyle = '#172b4d'; ctx.font = `500 14px ${UI_FONT}`;
    ctx.fillText(fitText(ctx, dc.card.title, cw - 80), dc.x + 12, dc.y + 40);
    if (dc.card.who) {
      ctx.beginPath(); ctx.arc(dc.x + cw - 44, dc.y + cardH - 20, 11, 0, Math.PI * 2); ctx.fillStyle = colorFor(dc.card.who); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `700 10px ${UI_FONT}`; ctx.textAlign = 'center';
      ctx.fillText(dc.card.who[0].toUpperCase(), dc.x + cw - 44, dc.y + cardH - 16); ctx.textAlign = 'left';
    }
    if (done) { ctx.fillStyle = '#36b37e'; ctx.font = `600 11px ${UI_FONT}`; ctx.fillText('✓ Done', dc.x + 12, dc.y + cardH - 14); }
    ctx.restore();
  }
}

export const app = {
  type: 'board', label: 'Task board', group: 'Work', chip: 'task', size: [1000, 560], chrome: 'window',
  blurb: 'Cards move between columns',
  title: (d) => `${d.board} - Board`,
  defaults: (t0) => ({
    board: 'Launch week', columns: ['To do', 'In progress', 'Done'],
    cards: parseCards('Record demo | To do | Mara\nWrite launch post | In progress | Lena\nFix export bug | In progress | Jonas\nDesign end card | To do | Sam\nSet up pricing | Done | Lena'),
    moves: [{ t: +(t0 + 1).toFixed(2), card: 'Fix export bug', to: 'Done' }, { t: +(t0 + 2.2).toFixed(2), card: 'Record demo', to: 'In progress' }],
  }),
  times: ['moves.*.t'],
  fields: [
    { key: 'board', type: 'text', label: 'Board name' },
    { key: 'columns', type: 'list', label: 'Columns (comma separated)' },
    { key: 'cards', type: 'script', label: 'Cards: <code>title | column | person</code>', rows: 5, parse: parseCards, format: cardsToText },
    { key: 'moves', type: 'script', label: 'Moves: <code>seconds card title &gt; column</code>', rows: 3, parse: parseMoves, format: movesToText },
  ],
  draw,
};
