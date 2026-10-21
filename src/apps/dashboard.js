// Business dashboard: KPI cards that count up, a line chart that draws itself,
// a list of recent payments and an AI summary paragraph that types out.

import { roundRect, UI_FONT, typedCount, wrapText, caretOn, fitText } from './draw.js';
import { EASINGS, clamp } from '../model.js';

// "Revenue | $48,290 | +18.2%" per line
export function parseKpis(text) {
  return String(text).split('\n').map((l) => l.split('|').map((s) => s.trim())).filter((p) => p[0])
    .map(([label, value = '0', change = '']) => ({ label, value, change }));
}
const kpisToText = (k) => k.map((x) => `${x.label} | ${x.value} | ${x.change}`).join('\n');
export const parseNumbers = (text) => String(text).split(/[\s,;]+/).map(Number).filter((n) => !Number.isNaN(n));
const numbersToText = (a) => a.join(', ');
export function parseRows(text) {
  return String(text).split('\n').map((l) => l.split('|').map((s) => s.trim())).filter((p) => p[0])
    .map(([name, amount = '', when = '']) => ({ name, amount, when }));
}
const rowsToText = (r) => r.map((x) => `${x.name} | ${x.amount} | ${x.when}`).join('\n');

// Count a formatted value like "$48,290", "12.4k" or "1.8%" up from zero.
export function countUp(value, p) {
  const m = String(value).match(/^([^\d-]*)(-?[\d,]*\.?\d+)(.*)$/);
  if (!m) return value;
  const [, pre, num, post] = m;
  const target = parseFloat(num.replace(/,/g, ''));
  const decimals = (num.split('.')[1] || '').length;
  const v = target * p;
  const fixed = v.toFixed(decimals);
  const [int, dec] = fixed.split('.');
  const withCommas = num.includes(',') ? int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : int;
  return `${pre}${withCommas}${dec ? '.' + dec : ''}${post}`;
}

const THEMES = {
  dark: { bg: '#0f1115', side: '#14171d', card: '#181b22', line: '#252a33', text: '#eef0f4', muted: '#8a91a0', accent: '#6c8cff', up: '#3ecf8e', down: '#ff6b6b' },
  light: { bg: '#f6f7f9', side: '#ffffff', card: '#ffffff', line: '#e6e8ec', text: '#14161a', muted: '#6b7280', accent: '#4f46e5', up: '#059669', down: '#dc2626' },
};

function draw(ctx, area, d, t) {
  const { x, y, w, h } = area;
  const th = THEMES[d.theme] || THEMES.dark;
  ctx.fillStyle = th.bg; ctx.fillRect(x, y, w, h);
  const side = Math.min(190, w * 0.18);
  ctx.fillStyle = th.side; ctx.fillRect(x, y, side, h);
  ctx.fillStyle = th.line; ctx.fillRect(x + side - 1, y, 1, h);
  roundRect(ctx, x + 18, y + 18, 26, 26, 7); ctx.fillStyle = th.accent; ctx.fill();
  ctx.fillStyle = th.text; ctx.font = `700 15px ${UI_FONT}`;
  ctx.fillText(fitText(ctx, d.brand || 'Acme', side - 70), x + 54, y + 36);
  ['Overview', 'Revenue', 'Customers', 'Reports', 'Settings'].forEach((n, i) => {
    const ny = y + 78 + i * 36;
    if (i === 0) { roundRect(ctx, x + 10, ny - 22, side - 20, 32, 8); ctx.fillStyle = d.theme === 'light' ? '#eef0ff' : '#1d2230'; ctx.fill(); }
    ctx.fillStyle = i === 0 ? th.text : th.muted; ctx.font = `${i === 0 ? 600 : 400} 13px ${UI_FONT}`;
    ctx.fillText(n, x + 24, ny);
  });

  const cx = x + side + 24, cw = w - side - 48;
  ctx.fillStyle = th.text; ctx.font = `700 22px ${UI_FONT}`;
  ctx.fillText(d.title || 'Overview', cx, y + 42);
  ctx.font = `500 12px ${UI_FONT}`;
  const pill = d.range || 'Last 30 days';
  const pw = ctx.measureText(pill).width + 24;
  roundRect(ctx, cx + cw - pw, y + 22, pw, 28, 14); ctx.fillStyle = th.card; ctx.fill();
  ctx.strokeStyle = th.line; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = th.muted; ctx.fillText(pill, cx + cw - pw + 12, y + 40);

  // KPI cards
  const kpis = (d.kpis || []).slice(0, 4);
  const gap = 14, kh = 96, kw = (cw - gap * (kpis.length - 1)) / Math.max(1, kpis.length);
  const cp = EASINGS.out(clamp((t - d.countStart) / (d.countDur || 1.4), 0, 1));
  kpis.forEach((k, i) => {
    const kx = cx + i * (kw + gap), ky = y + 70;
    const appear = EASINGS.out(clamp((t - d.countStart + 0.3 - i * 0.08) / 0.35, 0, 1));
    ctx.save(); ctx.globalAlpha *= appear; ctx.translate(0, (1 - appear) * 10);
    roundRect(ctx, kx, ky, kw, kh, 12); ctx.fillStyle = th.card; ctx.fill(); ctx.strokeStyle = th.line; ctx.stroke();
    ctx.fillStyle = th.muted; ctx.font = `500 12px ${UI_FONT}`;
    ctx.fillText(fitText(ctx, k.label, kw - 32), kx + 16, ky + 26);
    ctx.fillStyle = th.text; ctx.font = `700 ${Math.min(26, kw / 7)}px ${UI_FONT}`;
    ctx.fillText(fitText(ctx, countUp(k.value, cp), kw - 32), kx + 16, ky + 60);
    if (k.change) {
      const up = !k.change.trim().startsWith('-');
      ctx.fillStyle = up ? th.up : th.down; ctx.font = `600 12px ${UI_FONT}`;
      ctx.fillText(`${up ? '▲' : '▼'} ${k.change.replace(/^[+-]/, '')}`, kx + 16, ky + 82);
    }
    ctx.restore();
  });

  // Line chart
  const gy = y + 70 + kh + 18, gh = Math.max(120, h - (gy - y) - (d.insight ? 112 : 24));
  const gw = cw * 0.64;
  roundRect(ctx, cx, gy, gw, gh, 12); ctx.fillStyle = th.card; ctx.fill(); ctx.strokeStyle = th.line; ctx.stroke();
  ctx.fillStyle = th.text; ctx.font = `600 14px ${UI_FONT}`;
  ctx.fillText(d.chartTitle || 'Revenue', cx + 18, gy + 28);
  const pts = d.series?.length ? d.series : [1, 2, 3];
  const max = Math.max(...pts) * 1.1, min = Math.min(0, Math.min(...pts));
  const px0 = cx + 18, px1 = cx + gw - 18, py0 = gy + 48, py1 = gy + gh - 30;
  ctx.strokeStyle = th.line; ctx.lineWidth = 1;
  for (let i = 0; i <= 3; i++) { const ly = py0 + ((py1 - py0) * i) / 3; ctx.beginPath(); ctx.moveTo(px0, ly); ctx.lineTo(px1, ly); ctx.stroke(); }
  const labels = (d.labels || '').split(',').map((s) => s.trim()).filter(Boolean);
  ctx.fillStyle = th.muted; ctx.font = `400 11px ${UI_FONT}`;
  labels.forEach((l, i) => ctx.fillText(l, px0 + ((px1 - px0) * i) / Math.max(1, labels.length - 1) - 8, py1 + 20));
  const lp = EASINGS.smooth(clamp((t - d.chartStart) / (d.chartDur || 1.6), 0, 1));
  const P = pts.map((v, i) => [px0 + ((px1 - px0) * i) / Math.max(1, pts.length - 1), py1 - ((v - min) / (max - min)) * (py1 - py0)]);
  const drawUntil = lp * (P.length - 1);
  const path = [];
  for (let i = 0; i < P.length; i++) {
    if (i <= drawUntil) path.push(P[i]);
    else { const f = drawUntil - Math.floor(drawUntil); const a = P[i - 1]; path.push([a[0] + (P[i][0] - a[0]) * f, a[1] + (P[i][1] - a[1]) * f]); break; }
  }
  if (path.length > 1 && lp > 0) {
    const grad = ctx.createLinearGradient(0, py0, 0, py1);
    grad.addColorStop(0, th.accent + '55'); grad.addColorStop(1, th.accent + '00');
    ctx.beginPath(); ctx.moveTo(path[0][0], py1);
    path.forEach(([px, py]) => ctx.lineTo(px, py));
    ctx.lineTo(path[path.length - 1][0], py1); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath(); path.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.strokeStyle = th.accent; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.stroke();
    const [ex, ey] = path[path.length - 1];
    ctx.beginPath(); ctx.arc(ex, ey, 5, 0, Math.PI * 2); ctx.fillStyle = th.accent; ctx.fill();
    ctx.beginPath(); ctx.arc(ex, ey, 10 + 4 * Math.sin(t * 5), 0, Math.PI * 2); ctx.fillStyle = th.accent + '33'; ctx.fill();
  }

  // Recent payments
  const lx = cx + gw + 14, lw = cw - gw - 14;
  roundRect(ctx, lx, gy, lw, gh, 12); ctx.fillStyle = th.card; ctx.fill(); ctx.strokeStyle = th.line; ctx.stroke();
  ctx.fillStyle = th.text; ctx.font = `600 14px ${UI_FONT}`;
  ctx.fillText(d.listTitle || 'Recent payments', lx + 16, gy + 28);
  (d.rows || []).forEach((r, i) => {
    const ry = gy + 52 + i * 44;
    if (ry + 30 > gy + gh) return;
    const k = EASINGS.out(clamp((t - d.listStart - i * 0.35) / 0.35, 0, 1));
    if (k <= 0) return;
    ctx.save(); ctx.globalAlpha *= k; ctx.translate((1 - k) * 16, 0);
    ctx.beginPath(); ctx.arc(lx + 30, ry + 12, 14, 0, Math.PI * 2); ctx.fillStyle = th.accent + '33'; ctx.fill();
    ctx.fillStyle = th.accent; ctx.font = `700 12px ${UI_FONT}`; ctx.textAlign = 'center';
    ctx.fillText((r.name[0] || '?').toUpperCase(), lx + 30, ry + 16); ctx.textAlign = 'left';
    ctx.fillStyle = th.text; ctx.font = `500 13px ${UI_FONT}`;
    ctx.fillText(fitText(ctx, r.name, lw - 140), lx + 52, ry + 10);
    ctx.fillStyle = th.muted; ctx.font = `400 11px ${UI_FONT}`;
    ctx.fillText(r.when, lx + 52, ry + 26);
    ctx.fillStyle = th.up; ctx.font = `600 13px ${UI_FONT}`; ctx.textAlign = 'right';
    ctx.fillText(r.amount, lx + lw - 16, ry + 17); ctx.textAlign = 'left';
    ctx.restore();
  });

  // AI summary paragraph
  if (d.insight) {
    const iy = gy + gh + 14, ih = h - (iy - y) - 14;
    if (ih > 50) {
      roundRect(ctx, cx, iy, cw, ih, 12); ctx.fillStyle = th.card; ctx.fill(); ctx.strokeStyle = th.line; ctx.stroke();
      ctx.fillStyle = th.accent; ctx.font = `600 12px ${UI_FONT}`;
      ctx.fillText('✦ AI SUMMARY', cx + 18, iy + 24);
      const n = typedCount(d.insight, d.insightStart, d.cps || 45, t);
      ctx.fillStyle = th.text; ctx.font = `400 14px ${UI_FONT}`;
      const lines = wrapText(ctx, d.insight.slice(0, n), cw - 36);
      lines.slice(0, Math.floor((ih - 36) / 20)).forEach((l, i) => ctx.fillText(l, cx + 18, iy + 46 + i * 20));
      if (t >= d.insightStart && (n < d.insight.length || caretOn(t)) && lines.length) {
        const last = lines[Math.min(lines.length, Math.floor((ih - 36) / 20)) - 1] || '';
        ctx.fillRect(cx + 20 + ctx.measureText(last).width, iy + 34 + (Math.min(lines.length, Math.floor((ih - 36) / 20)) - 1) * 20, 2, 16);
      }
    }
  }
}

export const app = {
  type: 'dashboard', label: 'Dashboard', group: 'Launch', chip: 'dash', size: [1240, 720], chrome: 'window',
  blurb: 'Income, stats, chart and AI summary',
  title: (d) => `${d.brand} - Dashboard`,
  defaults: (t0) => ({
    brand: 'Acme', title: 'Overview', range: 'Last 30 days', theme: 'dark',
    kpis: parseKpis('Revenue | $48,290 | +18.2%\nActive users | 12,408 | +9.4%\nMRR | $14,920 | +22.1%\nChurn | 1.8% | -0.4%'),
    countStart: +(t0 + 0.4).toFixed(2), countDur: 1.4,
    chartTitle: 'Revenue', series: [12, 15, 14, 19, 24, 22, 31, 38, 36, 47, 55, 64], labels: 'Jan, Mar, May, Jul, Sep, Nov',
    chartStart: +(t0 + 0.8).toFixed(2), chartDur: 1.8,
    listTitle: 'Recent payments', rows: parseRows('Lena Fischer | +$49.00 | just now\nNorthwind Co. | +$1,200.00 | 2 min ago\nJonas Weber | +$19.00 | 8 min ago\nStudio Kai | +$99.00 | 14 min ago'),
    listStart: +(t0 + 1.2).toFixed(2),
    insight: 'Revenue grew 18% this month, driven mostly by annual plans. Churn is the lowest it has been all year.',
    insightStart: +(t0 + 2.4).toFixed(2), cps: 45,
  }),
  times: ['countStart', 'chartStart', 'listStart', 'insightStart'],
  fields: [
    { key: 'brand', type: 'text', label: 'Company name' },
    { key: 'title', type: 'text', label: 'Page title' },
    { key: 'theme', type: 'select', label: 'Look', options: [['dark', 'Dark'], ['light', 'Light']] },
    { key: 'kpis', type: 'script', label: 'Stat cards (up to 4): <code>label | value | change</code>', rows: 4, parse: parseKpis, format: kpisToText },
    { key: 'countStart', type: 'time', label: 'Numbers count up at' },
    { key: 'chartTitle', type: 'text', label: 'Chart title' },
    { key: 'series', type: 'script', label: 'Chart values (comma separated)', rows: 2, parse: parseNumbers, format: numbersToText },
    { key: 'labels', type: 'text', label: 'Chart labels (comma separated)' },
    { key: 'chartStart', type: 'time', label: 'Chart draws at' },
    { key: 'listTitle', type: 'text', label: 'List title' },
    { key: 'rows', type: 'script', label: 'List rows: <code>name | amount | when</code>', rows: 4, parse: parseRows, format: rowsToText },
    { key: 'listStart', type: 'time', label: 'List appears at' },
    { key: 'insight', type: 'textarea', label: 'Summary paragraph (leave empty to hide)', rows: 3 },
    { key: 'insightStart', type: 'time', label: 'Summary types at' },
  ],
  draw,
};
