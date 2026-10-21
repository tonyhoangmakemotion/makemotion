// Web browser with two page types:
// - search: a familiar search-engine home page that types a query, loads, and shows results
// - article: a news/blog page that can scroll over time

import { roundRect, wrapText, UI_FONT, caretOn, typed, typingDuration, drawCover, getMediaSafe, fitText, shadowScale } from './draw.js';
import { EASINGS, clamp, parseResults, resultsToText } from '../model.js';

const SERIF = "'Instrument Serif', Georgia, 'Times New Roman', serif";
const LOGO_COLORS = ['#5b6cff', '#ff4f7b', '#ffaa1f', '#16a99b', '#ff7a45', '#3d8bff', '#9b5cff'];

export function pageTitle(d, t) {
  if (d.mode === 'article') return d.headline || d.site;
  return t >= d.resultsAt && d.query ? `${d.query} - ${d.engine} Search` : d.engine || 'New tab';
}

function logo(ctx, text, cx, cy, size) {
  ctx.font = `600 ${size}px ${UI_FONT}`;
  const total = ctx.measureText(text).width;
  let x = cx - total / 2;
  [...text].forEach((ch, i) => {
    ctx.fillStyle = LOGO_COLORS[i % LOGO_COLORS.length];
    ctx.fillText(ch, x, cy);
    x += ctx.measureText(ch).width;
  });
}
function lens(ctx, x, y, s, color) {
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + s * 0.7, y + s * 0.7); ctx.lineTo(x + s * 1.5, y + s * 1.5); ctx.stroke();
}
function mic(ctx, x, y) {
  roundRect(ctx, x - 4, y - 9, 8, 13, 4);
  ctx.fillStyle = '#5b6cff'; ctx.fill();
  ctx.strokeStyle = '#ff4f7b'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(x, y, 7, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, y + 7); ctx.lineTo(x, y + 11); ctx.stroke();
}

function searchBox(ctx, x, y, w, h, text, focused, caret) {
  ctx.save();
  ctx.shadowColor = focused ? 'rgba(32,33,36,0.28)' : 'rgba(0,0,0,0)';
  ctx.shadowBlur = (focused ? 8 : 0) * shadowScale(ctx); ctx.shadowOffsetY = (1) * shadowScale(ctx);
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = '#fff'; ctx.fill();
  ctx.restore();
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.strokeStyle = focused ? 'rgba(223,225,229,0)' : '#dfe1e5'; ctx.lineWidth = 1; ctx.stroke();
  lens(ctx, x + 22, y + h / 2 - 2, 6.5, '#9aa0a6');
  mic(ctx, x + w - 26, y + h / 2);
  ctx.font = `400 16px ${UI_FONT}`;
  ctx.fillStyle = '#202124';
  ctx.fillText(text, x + 48, y + h / 2 + 6, w - 100);
  if (caret) {
    const tw = Math.min(ctx.measureText(text).width, w - 100);
    ctx.fillRect(x + 50 + tw, y + h / 2 - 10, 1.5, 20);
  }
}

function drawSearch(ctx, px, py, w, ph, d, t) {
  const showResults = t >= d.resultsAt;
  const query = typed(d.query || '', d.queryStart, d.cps || 15, t);
  const doneTyping = t >= d.queryStart + typingDuration(d.query || '', d.cps || 15);
  const typing = t >= d.queryStart - 0.6 && !showResults;

  if (!showResults) {
    // Home page
    ctx.font = `400 13px ${UI_FONT}`;
    ctx.fillStyle = '#202124';
    ctx.textAlign = 'right';
    ctx.fillText('Images', px + w - 96, py + 30);
    ctx.fillText('Mail', px + w - 150, py + 30);
    ctx.textAlign = 'left';
    for (let i = 0; i < 9; i++) { ctx.fillStyle = '#5f6368'; ctx.fillRect(px + w - 78 + (i % 3) * 6, py + 20 + Math.floor(i / 3) * 6, 3.5, 3.5); }
    ctx.beginPath(); ctx.arc(px + w - 32, py + 26, 14, 0, Math.PI * 2); ctx.fillStyle = '#7b61ff'; ctx.fill();
    const lsize = Math.min(88, w * 0.11);
    logo(ctx, d.engine || 'Seek', px + w / 2, py + ph * 0.36, lsize);
    const bw = Math.min(w - 80, 580);
    searchBox(ctx, px + (w - bw) / 2, py + ph * 0.36 + 28, bw, 46, query, typing, typing && (caretOn(t) || !doneTyping));
    // Buttons
    const by = py + ph * 0.36 + 100;
    ctx.font = `400 14px ${UI_FONT}`;
    const labels = ['Search', 'Feeling curious'];
    const widths = labels.map((l) => ctx.measureText(l).width + 32);
    let bx = px + w / 2 - (widths[0] + widths[1] + 12) / 2;
    const press = clamp(1 - Math.abs(t - (d.resultsAt - 0.25)) / 0.1, 0, 1);
    labels.forEach((l, i) => {
      roundRect(ctx, bx, by, widths[i], 36, 6);
      ctx.fillStyle = i === 0 && press > 0 ? '#e8eaed' : '#f8f9fa'; ctx.fill();
      ctx.fillStyle = '#3c4043';
      ctx.fillText(l, bx + 16, by + 23);
      bx += widths[i] + 12;
    });
    // Footer
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(px, py + ph - 44, w, 44);
    ctx.fillStyle = '#70757a';
    ctx.font = `400 13px ${UI_FONT}`;
    ctx.fillText('About   Advertising   Business', px + 24, py + ph - 17);
    ctx.textAlign = 'right';
    ctx.fillText('Privacy   Terms   Settings', px + w - 24, py + ph - 17);
    ctx.textAlign = 'left';
    return;
  }

  // Results page
  const age = t - d.resultsAt;
  ctx.font = `600 26px ${UI_FONT}`;
  logo(ctx, d.engine || 'Seek', px + 28 + ctx.measureText(d.engine || 'Seek').width / 2, py + 44, 26);
  ctx.font = `600 26px ${UI_FONT}`;
  const lw = ctx.measureText(d.engine || 'Seek').width;
  const sbx = px + 56 + lw, sbw = Math.min(w - (sbx - px) - 30, 640);
  searchBox(ctx, sbx, py + 20, sbw, 42, d.query, false, false);
  // Tabs
  const tabs = ['All', 'Images', 'Videos', 'News', 'Maps', 'More'];
  ctx.font = `400 13px ${UI_FONT}`;
  let tx = sbx + 14;
  tabs.forEach((tb, i) => {
    ctx.fillStyle = i === 0 ? '#1a73e8' : '#5f6368';
    ctx.fillText(tb, tx, py + 92);
    if (i === 0) { ctx.fillRect(tx - 2, py + 102, ctx.measureText(tb).width + 4, 3); }
    tx += ctx.measureText(tb).width + 26;
  });
  ctx.fillStyle = '#ebebeb';
  ctx.fillRect(px, py + 105, w, 1);
  ctx.globalAlpha = clamp(age / 0.3, 0, 1);
  ctx.fillStyle = '#70757a';
  ctx.font = `400 13px ${UI_FONT}`;
  ctx.fillText(`About ${((d.results?.length || 1) * 1.24).toFixed(2)} million results (0.42 seconds)`, sbx + 14, py + 132);
  ctx.globalAlpha = 1;

  let ry = py + 158;
  const rx = sbx + 14, maxW = Math.min(w - (rx - px) - 30, 600);
  (d.results || []).forEach((r, i) => {
    const k = clamp((age - 0.25 - i * 0.12) / 0.4, 0, 1);
    if (k <= 0 || ry > py + ph) return;
    ctx.save();
    ctx.globalAlpha = EASINGS.out(k);
    ctx.translate(0, (1 - EASINGS.back(k)) * 16);
    const site = (r.url || '').split('/')[0] || 'site';
    ctx.beginPath(); ctx.arc(rx + 13, ry + 13, 13, 0, Math.PI * 2);
    ctx.fillStyle = '#f1f3f4'; ctx.fill();
    ctx.fillStyle = LOGO_COLORS[(site.length + i) % LOGO_COLORS.length];
    ctx.font = `700 12px ${UI_FONT}`;
    ctx.textAlign = 'center'; ctx.fillText(site[0].toUpperCase(), rx + 13, ry + 17); ctx.textAlign = 'left';
    ctx.font = `400 14px ${UI_FONT}`;
    ctx.fillStyle = '#202124';
    ctx.fillText(site.replace(/^www\./, '').split('.')[0].replace(/^\w/, (c) => c.toUpperCase()), rx + 36, ry + 11, maxW - 40);
    ctx.font = `400 12px ${UI_FONT}`;
    ctx.fillStyle = '#4d5156';
    ctx.fillText(`https://${r.url.replace(/\//g, ' › ')}`, rx + 36, ry + 27, maxW - 40);
    ctx.font = `400 20px ${UI_FONT}`;
    ctx.fillStyle = '#1a0dab';
    ctx.fillText(fitText(ctx, r.title, maxW), rx, ry + 58);
    ctx.font = `400 14px ${UI_FONT}`;
    ctx.fillStyle = '#4d5156';
    wrapText(ctx, r.snippet, maxW).slice(0, 2).forEach((l, li) => ctx.fillText(l, rx, ry + 82 + li * 21));
    ctx.restore();
    ry += 128;
  });
}

function drawArticle(ctx, px, py, w, ph, d, t) {
  const span = Math.max(0.1, (d.scrollEnd ?? 0) - (d.scrollStart ?? 0));
  const scroll = (d.scrollBy || 0) * EASINGS.smooth(clamp((t - (d.scrollStart ?? 0)) / span, 0, 1));
  ctx.save();
  ctx.beginPath(); ctx.rect(px, py, w, ph); ctx.clip();
  ctx.translate(0, -scroll);
  // Site header
  ctx.fillStyle = '#111';
  ctx.fillRect(px, py, w, 64);
  ctx.fillStyle = '#fff';
  ctx.font = `italic 32px ${SERIF}`;
  ctx.fillText(d.site || 'The Daily', px + 32, py + 42);
  ctx.font = `500 13px ${UI_FONT}`;
  ctx.fillStyle = '#bbb';
  ctx.textAlign = 'right';
  ctx.fillText('World   Local   Tech   Opinion', px + w - 32, py + 38);
  ctx.textAlign = 'left';
  const cw = Math.min(w - 64, 700), cx = px + (w - cw) / 2;
  let y = py + 110;
  ctx.fillStyle = '#c0262d';
  ctx.font = `700 12px ${UI_FONT}`;
  ctx.fillText((d.kicker || 'BREAKING').toUpperCase(), cx, y);
  y += 20;
  ctx.fillStyle = '#111';
  ctx.font = `400 42px ${SERIF}`;
  for (const line of wrapText(ctx, d.headline || '', cw)) { y += 44; ctx.fillText(line, cx, y); }
  y += 30;
  ctx.font = `400 13px ${UI_FONT}`;
  ctx.fillStyle = '#666';
  ctx.fillText(d.byline || '', cx, y);
  y += 22;
  const ih = Math.round(cw * 0.5);
  const m = getMediaSafe(d.imageId);
  if (m?.el) drawCover(ctx, m.el, cx, y, cw, ih);
  else {
    const g = ctx.createLinearGradient(cx, y, cx + cw, y + ih);
    g.addColorStop(0, '#c9d6df'); g.addColorStop(1, '#8aa1b1');
    ctx.fillStyle = g; ctx.fillRect(cx, y, cw, ih);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = `500 14px ${UI_FONT}`;
    ctx.textAlign = 'center'; ctx.fillText('Add a photo in the inspector', cx + cw / 2, y + ih / 2); ctx.textAlign = 'left';
  }
  y += ih + 34;
  ctx.font = `400 18px ${SERIF}`;
  ctx.fillStyle = '#222';
  for (const para of String(d.body || '').split(/\n+/)) {
    for (const line of wrapText(ctx, para, cw)) { ctx.fillText(line, cx, y); y += 28; }
    y += 14;
  }
  ctx.restore();
}

function draw(ctx, area, d, t) {
  const { x, y, w, h } = area;
  const showResults = d.mode !== 'article' && t >= d.resultsAt;

  // Toolbar
  ctx.fillStyle = '#f1f3f4';
  ctx.fillRect(x, y, w, 46);
  ctx.strokeStyle = '#5f6368'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x + 26, y + 17); ctx.lineTo(x + 20, y + 23); ctx.lineTo(x + 26, y + 29); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + 44, y + 17); ctx.lineTo(x + 50, y + 23); ctx.lineTo(x + 44, y + 29); ctx.stroke();
  ctx.lineCap = 'butt';
  roundRect(ctx, x + 72, y + 8, w - 96, 30, 15);
  ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.strokeStyle = '#5f6368'; ctx.lineWidth = 1.4;
  ctx.strokeRect(x + 88, y + 22, 9, 7);
  ctx.beginPath(); ctx.arc(x + 92.5, y + 22, 3, Math.PI, 0); ctx.stroke();
  ctx.font = `400 14px ${UI_FONT}`;
  ctx.fillStyle = '#202124';
  const shownUrl = d.mode === 'article' ? d.articleUrl : showResults && d.query ? `${d.url}/search?q=${encodeURIComponent(d.query).replace(/%20/g, '+')}` : d.url;
  ctx.fillText(fitText(ctx, shownUrl || '', w - 140), x + 106, y + 28);
  ctx.fillStyle = '#dadce0';
  ctx.fillRect(x, y + 45, w, 1);

  const py = y + 46, ph = h - 46;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, py, w, ph);
  const loadAt = d.mode === 'article' ? (d.loadAt ?? -10) : d.resultsAt;
  const loadAge = t - loadAt;
  if (d.mode === 'article' && loadAge < 0 && loadAge > -10) { /* page not loaded yet: blank */ }
  else if (d.mode === 'article') drawArticle(ctx, x, py, w, ph, d, t);
  else drawSearch(ctx, x, py, w, ph, d, t);
  if (loadAge >= -0.35 && loadAge < 0.5) {
    const p = clamp((loadAge + 0.35) / 0.85, 0, 1);
    ctx.globalAlpha = loadAge > 0.3 ? 1 - (loadAge - 0.3) / 0.2 : 1;
    ctx.fillStyle = '#1a73e8';
    ctx.fillRect(x, py, w * EASINGS.out(p), 3);
    ctx.globalAlpha = 1;
  }
}

export const app = {
  type: 'browser', label: 'Browser', group: 'Web', chip: 'web', size: [980, 640], chrome: 'browser',
  blurb: 'Search page or news article',
  title: (d, t) => pageTitle(d, t),
  defaults: (t0) => ({
    mode: 'search', url: 'seek.com', engine: 'Seek', query: 'how to make a screenlife video',
    queryStart: +(t0 + 0.6).toFixed(2), cps: 16, resultsAt: +(t0 + 3.4).toFixed(2),
    results: [
      { title: 'Screenlife: a beginner guide', url: 'filmnotes.com/screenlife', snippet: 'Everything happens on a computer screen. Here is how to plan it, shot by shot.' },
      { title: 'Making a desktop thriller on a budget', url: 'indiefilm.org/desktop', snippet: 'Planning chats, browser tabs and video calls before you record.' },
    ],
    articleUrl: 'dailyledger.news/local/missing-developer', site: 'The Daily Ledger', kicker: 'Breaking', headline: 'Local developer goes missing after mysterious launch',
    byline: 'By Ana Ruiz · Updated 2 hours ago', imageId: null,
    body: 'Friends say he had not been seen since the night his app went live.\nThe last message he sent read simply: "it works."',
    loadAt: +(t0 + 0.3).toFixed(2), scrollStart: +(t0 + 2).toFixed(2), scrollEnd: +(t0 + 4.5).toFixed(2), scrollBy: 260,
  }),
  times: ['queryStart', 'resultsAt', 'loadAt', 'scrollStart', 'scrollEnd'],
  regions: (area, d) => [{ key: d.mode === 'article' ? 'articleUrl' : 'url', label: 'Address', rect: { x: area.x + 72, y: area.y + 8, w: area.w - 96, h: 30 } }],
  fields: [
    { key: 'mode', type: 'select', label: 'Page', options: [['search', 'Search engine'], ['article', 'News article']] },
    { key: 'url', type: 'text', label: 'Address bar', when: (d) => d.mode !== 'article' },
    { key: 'articleUrl', type: 'text', label: 'Address bar', when: (d) => d.mode === 'article' },
    { key: 'engine', type: 'text', label: 'Search site name (logo)', when: (d) => d.mode !== 'article' },
    { key: 'query', type: 'text', label: 'Search query', when: (d) => d.mode !== 'article' },
    { key: 'queryStart', type: 'time', label: 'Typing starts', when: (d) => d.mode !== 'article' },
    { key: 'resultsAt', type: 'time', label: 'Results load', when: (d) => d.mode !== 'article' },
    { key: 'cps', type: 'number', label: 'Typing speed (chars/s)', min: 1, max: 200, when: (d) => d.mode !== 'article' },
    { key: 'results', type: 'script', label: 'Results, one per line: <code>title | address | snippet</code>', rows: 5, parse: parseResults, format: resultsToText, when: (d) => d.mode !== 'article' },
    { key: 'site', type: 'text', label: 'Site name', when: (d) => d.mode === 'article' },
    { key: 'kicker', type: 'text', label: 'Label above headline', when: (d) => d.mode === 'article' },
    { key: 'headline', type: 'text', label: 'Headline', when: (d) => d.mode === 'article' },
    { key: 'byline', type: 'text', label: 'Byline', when: (d) => d.mode === 'article' },
    { key: 'imageId', type: 'media', accept: 'image', label: 'Article photo', when: (d) => d.mode === 'article' },
    { key: 'body', type: 'textarea', label: 'Article text (blank line = new paragraph)', rows: 6, when: (d) => d.mode === 'article' },
    { key: 'loadAt', type: 'time', label: 'Page loads', when: (d) => d.mode === 'article' },
    { key: 'scrollStart', type: 'time', label: 'Scroll starts', when: (d) => d.mode === 'article' },
    { key: 'scrollEnd', type: 'time', label: 'Scroll ends', when: (d) => d.mode === 'article' },
    { key: 'scrollBy', type: 'number', label: 'Scroll distance (px)', min: 0, max: 3000, step: 10, when: (d) => d.mode === 'article' },
  ],
  draw,
};
