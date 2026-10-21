// Code editor that types its code out with a human rhythm.

import { MONO_FONT, UI_FONT, caretOn, typedCount } from './draw.js';

const KEYWORDS = /^(const|let|var|function|return|await|async|for|while|if|else|import|from|export|new|class|of|in|true|false|null|def|local|end|then|print)$/;
const COLORS = {
  text: '#d6d7de', keyword: '#c792ea', string: '#c3e88d', comment: '#6b7089',
  number: '#f78c6c', fn: '#82aaff', punct: '#89ddff',
};
const FS = 17, LH = 27, TOP = 56, GUTTER = 54;

function tokenize(line) {
  const out = [];
  const re = /(\/\/.*$|#.*$|--.*$)|('[^']*'?|"[^"]*"?|`[^`]*`?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|(\s+)|([^\w\s])/g;
  let m;
  while ((m = re.exec(line))) {
    const [tok, comment, str, num, word, , punct] = m;
    let color = COLORS.text;
    if (comment) color = COLORS.comment;
    else if (str) color = COLORS.string;
    else if (num) color = COLORS.number;
    else if (word) color = KEYWORDS.test(word) ? COLORS.keyword : line[re.lastIndex] === '(' ? COLORS.fn : COLORS.text;
    else if (punct) color = COLORS.punct;
    out.push({ text: tok, color });
  }
  return out;
}

const lineCountAt = (data, t) => {
  const n = typedCount(data.code || '', data.start, data.cps || 30, t);
  return (data.code || '').slice(0, n).split('\n').length;
};

function langFor(file) {
  const ext = (file.split('.').pop() || '').toLowerCase();
  return { js: 'JavaScript', ts: 'TypeScript', py: 'Python', html: 'HTML', css: 'CSS', json: 'JSON', lua: 'Lua', luau: 'Luau', md: 'Markdown' }[ext] || 'Plain text';
}

function draw(ctx, area, data, t) {
  const { x, y, w, h } = area;
  ctx.fillStyle = '#14151a';
  ctx.fillRect(x, y, w, h);

  ctx.fillStyle = '#1b1c22';
  ctx.fillRect(x, y, w, 36);
  ctx.font = `500 13px ${UI_FONT}`;
  const tabW = Math.min(Math.max(120, ctx.measureText(data.file).width + 40), w - 24);
  ctx.fillStyle = '#14151a';
  ctx.fillRect(x + 12, y + 6, tabW, 30);
  ctx.fillStyle = '#e2b340';
  ctx.fillRect(x + 12, y + 6, tabW, 2);
  ctx.fillStyle = '#d6d7de';
  ctx.fillText(data.file, x + 26, y + 26, tabW - 28);

  const full = data.code || '';
  const count = typedCount(full, data.start, data.cps || 30, t);
  const lines = full.slice(0, count).split('\n');
  const maxLines = Math.max(1, Math.floor((h - 76) / LH));
  let scroll = 0;
  for (let i = 0; i < 5; i++) scroll += Math.max(0, lineCountAt(data, t - i * 0.05) - maxLines);
  scroll /= 5;

  ctx.save();
  ctx.beginPath(); ctx.rect(x, y + 40, w, h - 66); ctx.clip();
  ctx.font = `400 ${FS}px ${MONO_FONT}`;
  const first = Math.floor(scroll);
  for (let n = first; n < Math.min(lines.length, first + maxLines + 1); n++) {
    const ly = y + TOP + (n - scroll) * LH + FS;
    const isCurrent = n === lines.length - 1;
    if (isCurrent) { ctx.fillStyle = 'rgba(255,255,255,0.045)'; ctx.fillRect(x, ly - FS - 4, w, LH); }
    ctx.fillStyle = isCurrent ? '#a9abb6' : '#4a4d5c';
    ctx.textAlign = 'right';
    ctx.fillText(String(n + 1), x + GUTTER - 14, ly);
    ctx.textAlign = 'left';
    let cx = x + GUTTER;
    for (const tok of tokenize(lines[n])) {
      ctx.fillStyle = tok.color;
      ctx.fillText(tok.text, cx, ly);
      cx += ctx.measureText(tok.text).width;
    }
    if (isCurrent && t >= data.start && (count < full.length || caretOn(t))) {
      ctx.fillStyle = '#e2b340';
      ctx.fillRect(cx + 1, ly - FS + 1, 2, FS + 4);
    }
  }
  ctx.restore();

  ctx.fillStyle = '#1b1c22';
  ctx.fillRect(x, y + h - 26, w, 26);
  ctx.font = `400 12px ${UI_FONT}`;
  ctx.fillStyle = '#7d808a';
  const typing = t >= data.start && count < full.length;
  ctx.fillText(`Ln ${lines.length}, Col ${(lines[lines.length - 1] || '').length + 1}   ${typing ? 'Editing' : 'Saved'}`, x + 14, y + h - 9);
  ctx.textAlign = 'right';
  ctx.fillText(langFor(data.file), x + w - 14, y + h - 9);
  ctx.textAlign = 'left';
}

export const app = {
  type: 'code', label: 'Code editor', group: 'Work', chip: 'code', size: [820, 560], chrome: 'window',
  blurb: 'Types code with syntax colors',
  title: (d) => d.file,
  defaults: (t0) => ({ file: 'main.js', start: +(t0 + 0.6).toFixed(2), cps: 30, code: "function hello() {\n  return 'world';\n}" }),
  times: ['start'],
  regions: (area) => [{ key: 'file', label: 'File name', rect: { x: area.x + 12, y: area.y + 6, w: 170, h: 30 } }],
  fields: [
    { key: 'file', type: 'text', label: 'File name' },
    { key: 'start', type: 'time', label: 'Starts typing at' },
    { key: 'cps', type: 'number', label: 'Speed (characters/s)', min: 1, max: 400 },
    { key: 'code', type: 'textarea', label: 'Code', rows: 9, mono: true },
  ],
  draw,
};
