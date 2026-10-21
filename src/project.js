// Project-level helpers: create windows, shift them in time, the demo project,
// and migration of older saved projects.

import { FPS, newId, snapTime, applyEnter, applyExit } from './model.js';
import { APPS } from './apps/index.js';
import { DEFAULT_LOOK, LOOKS } from './look.js';

export const CURSOR_EVENTS = {
  click: 'Click', double: 'Double-click', right: 'Right-click', drag: 'Drag / swipe', scroll: 'Scroll',
};

export function makeLayer(type, t, project) {
  const A = APPS[type];
  const W = project.width, H = project.height;
  const [w, h] = A.size;
  const n = project.layers.length % 5;
  let x = Math.round((W - w) / 2) + n * 30 - 60, y = Math.round((H - h) / 2) + n * 24 - 48;
  if (type === 'facecam') { x = W - w - 80; y = H - h - 80; }
  if (type === 'notification') { x = W - w - 60; y = 60; }
  const t0 = snapTime(t);
  const layer = {
    id: newId(type), type, title: '', name: A.label,
    keys: [{ t: t0, ease: 'smooth', x, y, w, h, opacity: 1, scale: 1 }],
    data: A.defaults(t0),
  };
  applyEnter(layer, t0, A.enter || 'pop');
  return layer;
}

// Walk "a.*.b" style paths and add dt to the numbers found there.
function shiftPath(obj, parts, dt) {
  if (!obj) return;
  const [head, ...rest] = parts;
  if (head === '*') { for (const item of obj) shiftPath(item, rest, dt); return; }
  if (!rest.length) { if (typeof obj[head] === 'number') obj[head] = +(obj[head] + dt).toFixed(3); return; }
  shiftPath(obj[head], rest, dt);
}

// Move a window and everything that happens in it by dt seconds.
export function shiftLayer(layer, dt) {
  // Keep exact times (no re-snapping), so moving a window never changes its timing.
  const mv = (t) => +(t + dt).toFixed(4);
  layer.keys.forEach((k) => { k.t = mv(k.t); });
  if (layer.in != null) layer.in = mv(layer.in);
  if (layer.out != null) layer.out = mv(layer.out);
  for (const p of APPS[layer.type]?.times || []) shiftPath(layer.data, p.split('.'), dt);
}

// Fill in fields added after a project was saved.
export function migrate(p) {
  p.wallpaper = { kind: 'painting', seed: 7, blur: 0, dim: 0, color1: '#1d2433', color2: '#ffaf7b', mediaId: null, ...(p.wallpaper || {}) };
  p.camera ??= { keys: [] };
  p.camera.drift ??= 0.35;
  p.camera.shakes ??= [];
  p.camera.auto ??= false;
  p.camera.blurs ??= [];
  p.camera.autoStyle ??= 'mixed';
  p.cursor ??= { keys: [], events: [] };
  if (!p.cursor.events) p.cursor.events = (p.cursor.clicks || []).map((t) => ({ id: newId('ev'), t, type: 'click' }));
  delete p.cursor.clicks;
  p.cursor.events.forEach((e) => { e.id ??= newId('ev'); });
  p.cursor.size ??= 1;
  p.cursor.clickStyle ??= 'ripple';
  p.captions ??= [];
  p.captions.forEach((c) => { c.id ??= newId('cap'); });
  p.captionStyle ??= { style: 'words', position: 'bottom', size: 1 };
  if (!p.format) p.format = '16:9';
  if (!Array.isArray(p.comments)) p.comments = [];
  if (p.look && p.look.contrast === undefined) p.look.contrast = LOOKS[p.look.preset]?.contrast ?? 0;
  p.look = { ...DEFAULT_LOOK, ...(p.look || {}) };
  p.audio ??= [];
  p.audio.forEach((a) => { a.id ??= newId('au'); });
  p.media ??= {};
  p.autoSfx ??= { clicks: true, messages: true, typing: false, volume: 0.7 };
  p.volume ??= 1;
  p.layers.forEach((l) => {
    l.title ??= '';
    const A = APPS[l.type];
    if (A) l.data = { ...A.defaults(l.keys[0]?.t ?? 0), ...l.data };
  });
  return p;
}

export function createDemoProject() {
  return migrate({
    version: 1,
    name: 'Launch night',
    width: 1920, height: 1080, fps: FPS, duration: 18,
    wallpaper: { kind: 'painting', seed: 7 },
    camera: {
      drift: 0.35,
      keys: [
        { t: 0, ease: 'smooth', cx: 640, cy: 470, zoom: 1.7 },
        { t: 2.6, ease: 'smooth', cx: 640, cy: 470, zoom: 1.55 },
        { t: 4.2, ease: 'smooth', cx: 960, cy: 540, zoom: 1 },
        { t: 5.4, ease: 'smooth', cx: 1290, cy: 520, zoom: 1.45 },
        { t: 9.6, ease: 'smooth', cx: 1290, cy: 560, zoom: 1.5 },
        { t: 10.8, ease: 'smooth', cx: 960, cy: 540, zoom: 1 },
        { t: 12, ease: 'smooth', cx: 900, cy: 600, zoom: 1.3 },
        { t: 15.6, ease: 'smooth', cx: 900, cy: 600, zoom: 1.35 },
        { t: 17.2, ease: 'smooth', cx: 960, cy: 540, zoom: 1 },
      ],
    },
    layers: [
      {
        id: 'code_1', type: 'code', name: 'Code editor', title: '',
        keys: [
          { t: 0, ease: 'smooth', x: 230, y: 190, w: 820, h: 560, opacity: 1, scale: 1 },
          { t: 4.2, ease: 'smooth', x: 160, y: 150, w: 820, h: 560, opacity: 1, scale: 1 },
          { t: 11, ease: 'smooth', x: 160, y: 150, w: 820, h: 560, opacity: 1, scale: 1 },
          { t: 12, ease: 'smooth', x: 120, y: 120, w: 820, h: 560, opacity: 0.55, scale: 0.97 },
        ],
        data: {
          file: 'export.js', start: 0.3, cps: 34,
          code: [
            '// render every frame of the timeline',
            'export async function exportVideo(project) {',
            '  const frames = project.duration * project.fps;',
            '  for (let i = 0; i < frames; i++) {',
            '    renderFrame(ctx, project, i / project.fps);',
            '    await encoder.add(canvas);',
            '  }',
            "  return encoder.finish('mp4');",
            '}',
          ].join('\n'),
        },
      },
      {
        id: 'chat_1', type: 'chat', name: 'Messages', title: '',
        keys: [
          { t: 3.4, ease: 'smooth', x: 940, y: 260, w: 700, h: 520, opacity: 0, scale: 0.86 },
          { t: 3.95, ease: 'spring', x: 940, y: 260, w: 700, h: 520, opacity: 1, scale: 1 },
          { t: 11, ease: 'smooth', x: 940, y: 260, w: 700, h: 520, opacity: 1, scale: 1 },
          { t: 12, ease: 'smooth', x: 1080, y: 200, w: 700, h: 520, opacity: 0.55, scale: 0.97 },
        ],
        data: {
          contact: 'Lena', contacts: ['Lena', 'Beta testers', 'Jonas'],
          messages: [
            { t: 4.6, from: 'them', text: 'is it live yet??' },
            { t: 6.4, from: 'me', text: 'export works. pushing now' },
            { t: 7.8, from: 'them', text: 'send me the link the second it is up' },
            { t: 9.4, from: 'me', text: 'deal. 2 minutes' },
          ],
        },
      },
      {
        id: 'browser_1', type: 'browser', name: 'Browser', title: '',
        keys: [
          { t: 10.8, ease: 'smooth', x: 430, y: 360, w: 980, h: 620, opacity: 0, scale: 1 },
          { t: 11.35, ease: 'out', x: 430, y: 290, w: 980, h: 620, opacity: 1, scale: 1 },
        ],
        data: {
          mode: 'search', url: 'seek.com', engine: 'Seek', query: 'screenlife video editor',
          queryStart: 11.8, cps: 15, resultsAt: 14,
          results: [
            { title: 'MakeMotion: edit videos that live on a desktop', url: 'makemotion.app', snippet: 'Drag windows, chats and code onto a timeline and animate them. Export in one click.' },
            { title: 'What is a screenlife film?', url: 'filmnotes.com/screenlife', snippet: 'Stories told entirely through computer and phone screens, from chats to video calls.' },
            { title: 'Making a desktop thriller on a budget', url: 'indiefilm.org/desktop', snippet: 'Planning chats, browser tabs and video calls shot by shot.' },
          ],
        },
      },
      {
        id: 'notification_1', type: 'notification', name: 'Notification', title: '',
        keys: [
          { t: 15.2, ease: 'smooth', x: 1420, y: 130, w: 440, h: 104, opacity: 0, scale: 1 },
          { t: 15.75, ease: 'out', x: 1420, y: 60, w: 440, h: 104, opacity: 1, scale: 1 },
          { t: 17.3, ease: 'smooth', x: 1420, y: 60, w: 440, h: 104, opacity: 1, scale: 1 },
          { t: 17.7, ease: 'in', x: 1420, y: 60, w: 440, h: 104, opacity: 0, scale: 1 },
        ],
        data: { app: 'Messages', title: 'Lena', body: 'IT WORKS. sending this to everyone', time: 'now', theme: 'dark', color: '#2f6fed' },
      },
    ],
    cursor: {
      size: 1, clickStyle: 'ripple',
      keys: [
        { t: 0, ease: 'smooth', x: 1500, y: 900 },
        { t: 5.8, ease: 'smooth', x: 1420, y: 740 },
        { t: 6.3, ease: 'smooth', x: 1560, y: 735 },
        { t: 9.2, ease: 'smooth', x: 1560, y: 735 },
        { t: 11.6, ease: 'smooth', x: 760, y: 470 },
        { t: 14.6, ease: 'smooth', x: 700, y: 560 },
        { t: 15.3, ease: 'smooth', x: 680, y: 600 },
      ],
      events: [
        { t: 6.35, type: 'click' }, { t: 9.4, type: 'click' }, { t: 15.4, type: 'click' },
      ],
    },
    captionStyle: { style: 'words', position: 'bottom', size: 1 },
    captions: [
      { start: 0.4, end: 3.2, text: 'What if your editor looked like your desktop?' },
      { start: 4.4, end: 9.8, text: 'Chats, code and browsers become the footage.' },
      { start: 11.4, end: 14.8, text: 'Drag, resize, animate. Done.' },
    ],
    autoSfx: { clicks: true, messages: true, typing: true, volume: 0.7 },
    audio: [{ src: 'sfx:whoosh', track: 'sfx', start: 10.7, offset: 0, volume: 0.6, name: 'Whoosh' }],
    media: {},
  });
}

// ---------- Product launch template (about 30s) ----------
// Pain → intro → proof (dashboard, automation) → credibility (stat, testimonial, integrations) → end card.
export function createLaunchTemplate() {
  const p = createDemoProject();
  p.name = 'Product launch';
  p.duration = 30;
  p.layers = []; p.captions = [];
  p.wallpaper = { ...p.wallpaper, kind: 'flow-dark', seed: 22 };
  p.camera = { drift: 0.25, shakes: [], keys: [{ t: 0, ease: 'smooth', cx: 960, cy: 540, zoom: 1 }] };
  p.cursor = { ...p.cursor, hidden: false, size: 1.2, keys: [{ t: 8.0, ease: 'smooth', x: 2000, y: 1000 }], events: [] };
  p.autoSfx = { clicks: true, messages: true, typing: false, volume: 0.7 };
  p.audio = [];
  const add = (type, tIn, tOut, box, data = {}, enter = 'pop', exit = 'fade') => {
    const l = makeLayer(type, tIn, p);
    l.data = { ...l.data, ...data };
    const base = { ...l.keys[l.keys.length - 1], ...box, opacity: 1, scale: 1 };
    l.keys = [{ ...base, t: tIn, ease: 'smooth' }];
    applyEnter(l, tIn, enter);
    if (tOut != null) applyExit(l, tOut, exit);
    p.layers.push(l);
    p.audio.push({ id: newId('au'), src: 'sfx:whoosh', track: 'sfx', start: Math.max(0, tIn - 0.15), offset: 0, volume: 0.45, name: 'Whoosh' });
    return l;
  };
  const center = (w, h, dy = 0) => ({ x: (1920 - w) / 2, y: (1080 - h) / 2 + dy, w, h });

  add('title', 0.2, 3.2, center(1500, 380), { text: 'Your numbers live in *five* different tools.', sub: 'And none of them talk to each other.', start: 0.3 }, 'fade');
  add('title', 3.5, 6.4, center(1400, 360), { text: 'Meet *Acme*.', sub: 'All your business in one calm dashboard.', start: 3.6, size: 150 }, 'fade');
  add('dashboard', 6.6, 15.4, center(1240, 720, 10), { brand: 'Acme', countStart: 7.2, chartStart: 7.8, listStart: 8.6, insightStart: 10.6 }, 'slide');
  add('callout', 9.2, 12.6, { x: 1180, y: 165, w: 380, h: 78 }, { text: 'Live revenue, no spreadsheets', start: 9.3, dx: -330, dy: 150 }, 'fade');
  add('notification', 12.4, 15.2, { x: 1420, y: 60, w: 440, h: 104 }, { app: 'Payments', title: 'Payment received', body: 'Northwind Co. paid $1,200.00', color: '#6c8cff' }, 'slide');
  add('board', 15.8, 19.8, center(1000, 560), { board: 'Launch week', moves: [{ t: 16.8, card: 'Fix export bug', to: 'Done' }, { t: 17.9, card: 'Record demo', to: 'In progress' }, { t: 18.9, card: 'Write launch post', to: 'Done' }] }, 'slide');
  add('stat', 20.1, 23.3, center(760, 320, -170), { value: '10,000+', label: 'teams switched this year', start: 20.3 }, 'pop');
  add('social', 20.9, 23.5, center(640, 330, 150), { countStart: 21.4 }, 'slide');
  add('integrations', 23.7, 26.4, center(720, 720), { name: 'Acme', start: 23.8 }, 'fade');
  add('endcard', 26.6, null, center(1000, 620), { name: 'Acme', tagline: 'Your business, finally in one place.', cta: 'Start free', url: 'acme.app', start: 26.7 }, 'pop');

  // Camera: push into the dashboard numbers, then the chart, then back out.
  p.camera.keys.push(
    { t: 6.6, ease: 'smooth', cx: 960, cy: 540, zoom: 1 },
    { t: 7.6, ease: 'smooth', cx: 960, cy: 300, zoom: 1.55 },
    { t: 9.0, ease: 'smooth', cx: 820, cy: 560, zoom: 1.45 },
    { t: 11.2, ease: 'smooth', cx: 900, cy: 760, zoom: 1.5 },
    { t: 12.6, ease: 'smooth', cx: 960, cy: 540, zoom: 1 },
    { t: 15.8, ease: 'smooth', cx: 960, cy: 540, zoom: 1 },
    { t: 17.0, ease: 'smooth', cx: 1080, cy: 520, zoom: 1.3 },
    { t: 19.6, ease: 'smooth', cx: 960, cy: 540, zoom: 1 },
    { t: 26.6, ease: 'smooth', cx: 960, cy: 540, zoom: 1.05 },
    { t: 29.5, ease: 'smooth', cx: 960, cy: 540, zoom: 1.12 },
  );
  p.camera.shakes.push({ id: newId('sh'), t: 20.3, dur: 0.4, amount: 0.6 });
  // Mouse clicks a payment, then drags a card.
  p.cursor.keys.push(
    { t: 8.4, ease: 'smooth', x: 1500, y: 700 },
    { t: 9.4, ease: 'smooth', x: 1390, y: 470 },
    { t: 16.2, ease: 'smooth', x: 1300, y: 700 },
    { t: 16.6, ease: 'smooth', x: 1160, y: 455 },
    { t: 17.4, ease: 'smooth', x: 1500, y: 455 },
    { t: 19.6, ease: 'smooth', x: 2050, y: 1000 },
  );
  p.cursor.events.push({ id: newId('ev'), t: 9.5, type: 'click' }, { id: newId('ev'), t: 16.7, type: 'drag', dur: 0.7 });
  return migrate(p);
}

// ---------- Launch film template (about 33s) ----------
// Built from the structure of professional startup launch videos (docs/launch-video-analysis.md):
// hook line → tension → logo reveal → the product, one feature at a time (spotlight, click,
// numbers) → proof (metric chain) → promise → logo lockup → CTA. No hard cuts: lines blur out,
// the logo grows and settles, a light wipe bridges product and proof. Black and white only, so
// your logo and your product's own colours are the only colour on screen.
export function createLaunchFilmTemplate(accent = '#f4f4f6') {
  const p = createDemoProject();
  p.name = 'Launch film';
  p.duration = 33;
  p.layers = []; p.captions = []; p.audio = [];
  p.wallpaper = { ...p.wallpaper, kind: 'studio-glow', color1: '#ffffff', blur: 0, dim: 0 };
  p.look = { ...DEFAULT_LOOK, chrome: 'studio', depth: 0.6, grain: 0, vignette: 0.12, contrast: 0, preset: 'custom' }; // true black, no lifted floor
  p.camera = { drift: 0.12, shakes: [], blurs: [], keys: [{ t: 0, ease: 'smooth', cx: 960, cy: 540, zoom: 1 }], auto: true, autoStyle: 'smooth' };
  p.cursor = { ...p.cursor, hidden: false, size: 1.35, color: 'light', clickStyle: 'ripple', keys: [{ t: 0, ease: 'smooth', x: 2500, y: 1400 }], events: [] };
  p.autoSfx = { clicks: true, messages: true, typing: false, volume: 0.6 };
  const mono = { accent, pillText: '#0b0b0d' };
  const add = (type, tIn, tOut, box, data = {}, enter = 'fade', exit = 'fade') => {
    const l = makeLayer(type, tIn, p);
    l.data = { ...l.data, ...mono, ...data };
    const base = { ...l.keys[l.keys.length - 1], ...box, opacity: 1, scale: 1 };
    l.keys = [{ ...base, t: tIn, ease: 'smooth' }];
    applyEnter(l, tIn, enter);
    if (tOut != null) applyExit(l, tOut, exit);
    if (type === 'sentence' || type === 'metrics') l.name = String(l.data.text || l.data.chain || '').replace(/\[([^\]>]*?)[\d.,]+\s*>\s*([\d.,]+)([^\]]*)\]/g, '$1$2$3').replace(/[*[\]{}~]/g, '').slice(0, 32);
    if (type === 'spotlight') l.name = `Spotlight: ${l.data.label}`;
    p.layers.push(l);
    return l;
  };
  const center = (w, h, dy = 0) => ({ x: (1920 - w) / 2, y: (1080 - h) / 2 + dy, w, h });
  const sfx = (t, src, v = 0.4) => p.audio.push({ id: newId('au'), src, track: 'sfx', start: t, offset: 0, volume: v, name: src.slice(4) });
  const line = (tIn, tOut, text, extra = {}) => add('sentence', tIn, tOut, center(1500, 260), { text, start: tIn + 0.08, exitAt: tOut - 0.4, ...extra });

  // Hook and tension: one line each; words blur in, then the line blurs out.
  line(0.15, 2.75, 'You just got [7>22] new customers');
  line(2.75, 5.15, 'But which post actually {sent them?}');
  // Reveal: your logo pops up big and settles next to the name.
  add('logoreveal', 5.1, 8.4, center(1500, 420), { name: 'Lumen', tagline: 'Know what brings you customers.', start: 5.15 });
  sfx(5.1, 'sfx:whoosh', 0.45);
  // Product, one feature at a time: headline on top, the app below, the camera follows the spotlight.
  add('sentence', 8.5, 11.0, { x: 210, y: 40, w: 1500, h: 120 }, { text: 'See [where the money comes from]', start: 8.55, size: 54, exitAt: 10.6 });
  add('dashboard', 8.6, 18.6, center(1240, 720, 70), { brand: 'Lumen', countStart: 9.2, chartStart: 9.7, listStart: 10.5, insightStart: 14.6 }, 'slide');
  add('spotlight', 11.0, 13.4, { x: 352, y: 286, w: 560, h: 150 }, { label: 'Revenue from content', start: 11.05 });
  add('sentence', 13.5, 16.2, { x: 210, y: 40, w: 1500, h: 120 }, { text: 'and [every payment] the moment it lands', start: 13.55, size: 54, exitAt: 15.8 });
  add('notification', 13.9, 16.4, { x: 1380, y: 150, w: 440, h: 104 }, { app: 'Payments', title: 'Payment received', body: 'You received $1,200 from a new customer', color: '#8a8a94' }, 'slide');
  add('spotlight', 16.4, 18.4, { x: 960, y: 560, w: 560, h: 270 }, { label: 'Revenue over time', start: 16.45, labelBelow: true });
  // Bridge to proof without a cut.
  add('wipe', 18.4, 19.6, { x: 0, y: 0, w: 1920, h: 1080 }, { at: 18.95, dur: 1.0, style: 'light' });
  sfx(18.5, 'sfx:whoosh', 0.5);
  add('metrics', 19.1, 23.2, center(1600, 240), { chain: '2.7K Clicks > 5.5% > 148 Leads > 19% > 28 Calls > 41% > 12 Customers', start: 19.2, step: 0.42, size: 64 });
  line(23.3, 25.9, 'Stop making content for [views.]');
  line(25.9, 28.4, 'Double down on {what actually works.}');
  // Close: logo lockup, then the call to action.
  add('logoreveal', 28.4, 31.0, center(1500, 420), { name: 'Lumen', tagline: 'Know what brings you customers.', start: 28.45 });
  add('sentence', 31.0, null, center(1500, 260), { text: 'Start your [free trial] today.', start: 31.05 });
  p.cursor.keys.push(
    { t: 10.4, ease: 'smooth', x: 1500, y: 860 },
    { t: 11.3, ease: 'smooth', x: 760, y: 380 },
    { t: 13.2, ease: 'smooth', x: 1150, y: 640 },
    { t: 16.6, ease: 'smooth', x: 1220, y: 690 },
    { t: 18.2, ease: 'smooth', x: 2500, y: 1400 },
  );
  p.cursor.events.push({ id: newId('ev'), t: 11.45, type: 'click' }, { id: newId('ev'), t: 16.75, type: 'click' });
  return migrate(p);
}

// Devlog / screenlife story in the style of creator videos: chapter cards styled as agent
// permission prompts, an AI agent at work, a webcam feed, a group chat, a window storm.
// The camera is the auto camera (whips, cuts and close-ups) on the Cinematic look.
export function createDevlogTemplate() {
  const p = createDemoProject();
  p.name = 'Devlog';
  p.duration = 20.8;
  p.layers = []; p.captions = []; p.audio = [];
  p.wallpaper = { ...p.wallpaper, kind: 'classical', seed: 11, blur: 0, dim: 0 };
  p.look = { ...DEFAULT_LOOK };
  p.camera = { drift: 0.3, shakes: [{ id: newId('sh'), t: 12.4, dur: 0.45, amount: 0.7 }, { id: newId('sh'), t: 19.8, dur: 0.5, amount: 0.6 }], blurs: [{ id: newId('bl'), t: 17.7, dur: 0.9, amount: 1 }], keys: [{ t: 0, ease: 'smooth', cx: 960, cy: 540, zoom: 1 }], auto: true, autoStyle: 'mixed' };
  p.autoSfx = { clicks: true, messages: true, typing: true, volume: 0.6 };
  const add = (type, tIn, tOut, box, data = {}, enter = 'pop', exit = 'fade') => {
    const l = makeLayer(type, tIn, p);
    l.data = { ...l.data, ...data };
    const base = { ...l.keys[l.keys.length - 1], ...box, opacity: 1, scale: 1 };
    l.keys = [{ ...base, t: tIn, ease: 'smooth' }];
    applyEnter(l, tIn, enter);
    if (tOut != null) applyExit(l, tOut, exit);
    p.layers.push(l);
    p.audio.push({ id: newId('au'), src: 'sfx:whoosh', track: 'sfx', start: Math.max(0, tIn - 0.12), offset: 0, volume: 0.35, name: 'Whoosh' });
    return l;
  };
  const card = { x: 560, y: 384, w: 800, h: 312 };

  add('prompt', 0.2, 2.6, card, { title: 'My Strange Addiction', subtitle: 'It started as a weekend project', command: 'bash ~/webprojects/mystrangeaddiction/chapter-one.sh', choice: 'once', clickAt: 1.7 }, 'fade');
  // Background windows that stay open the whole session, so the desktop always looks lived-in
  // (the reference never shows a lone window).
  add('files', 2.6, 17.4, { x: 180, y: 40, w: 600, h: 400 }, { path: 'gofish', items: ['src', 'assets', 'sprites', 'fish_sprites.png', 'island_map.json', 'devlog_day3.mp4', 'TODO.md'], select: [] }, 'fade');
  add('browser', 2.6, 17.4, { x: 1140, y: 700, w: 780, h: 440 }, { query: 'how to stop fish clipping through boat', queryStart: 2.8, cps: 40, resultsAt: 3.6 }, 'fade');
  const term = add('terminal', 2.6, 17.4, { x: 40, y: 560, w: 760, h: 440 }, {
    user: 'dev', host: 'studio',
    lines: [
      { t: 2.7, kind: 'cmd', text: 'npm run dev' }, { t: 3.4, kind: 'out', text: '  ready in 412 ms' },
      { t: 3.5, kind: 'out', text: '  ➜ Local: http://localhost:5173/' }, { t: 8.9, kind: 'out', text: '  hmr update /src/game/loop.ts' },
      { t: 9.6, kind: 'out', text: '  hmr update /src/login.js' },
    ],
  }, 'fade');
  term.title = 'dev server';
  add('notes', 2.6, 17.4, { x: 1360, y: 70, w: 500, h: 520 }, { style: 'app', title: 'GoFish todo', start: 2.7, cps: 60, text: '☑ fishing rod physics\n☑ coins + shop\n☑ voice commands\n☐ fix lag\n☐ fix login\n☐ secret power up\n☐ sleep' }, 'fade');
  const code = add('code', 2.6, 17.4, { x: 120, y: 150, w: 900, h: 600 }, {
    file: 'src/login.js', start: 2.7, cps: 420,
    code: ['import { connect, AuthToken } from "./db";', '', '// login, production ready, do not touch', 'const AUTH_TIMEOUT_MS = 15000;', 'const MAX_RETRIES = 3;', '', 'export async function login(user, password) {', '  if (!user || !password) return null;', '  const db = await connect();', '  return db.auth(user, password);', '}'].join('\n'),
  }, 'slide');
  code.title = 'src/login.js';
  add('agent', 4.2, 17.4, { x: 760, y: 120, w: 900, h: 560 }, {
    title: '~/webprojects/gofish: agent',
    lines: [
      // earlier in the session (already on screen when the window opens)
      { t: 4.25, kind: 'tool', text: 'Write(src/lib/voice-commands.ts)' },
      { t: 4.25, kind: 'result', text: 'Wrote 201 lines to src/lib/voice-commands.ts' },
      { t: 4.25, kind: 'code', text: "import { THEMES } from './themes';" },
      { t: 4.25, kind: 'code', text: 'export function colorChange() {' },
      { t: 4.25, kind: 'say', text: 'Done. Voice commands are wired up.' },
      { t: 4.25, kind: 'you', text: 'in-game currency?' },
      { t: 4.25, kind: 'say', text: 'In-game currency added successfully.' },
      { t: 6.0, kind: 'you', text: 'fix the lag, and fix the login issue... idk' },
      { t: 7.4, kind: 'tool', text: 'Read(src/login.js)' },
      { t: 7.7, kind: 'result', text: 'Read 212 lines' },
      { t: 8.5, kind: 'tool', text: 'Update(src/game/loop.ts)' },
      { t: 8.8, kind: 'result', text: 'Updated 14 lines' },
      { t: 9.5, kind: 'say', text: 'All done. Frame time is down and login works again.' },
      { t: 11.2, kind: 'you', text: 'add a secret power up' },
      { t: 12.4, kind: 'error', text: "You've hit your weekly limit · resets Oct 1, 9am" },
    ],
  }, 'pop');
  const skip = add('title', 12.8, 13.6, { x: 260, y: 340, w: 1400, h: 400 }, { text: '3 hours later...', sub: '', start: 12.85, anim: 'words', font: 'fun', backdrop: 'pattern', bgColor: '#2b54d6', color: '#ffe14d', size: 150 }, 'fade', 'fade');
  // The obsession, in one picture: an activity grid filling up while the agent works.
  add('streak', 7.4, 9.6, { x: 300, y: 330, w: 980, h: 400 }, { heading: 'Hours coded', weeks: 22, start: 7.5, dur: 1.8, intense: true }, 'pop');
  // A friend's reply as a doodle that draws itself over the chat.
  add('sketch', 15.55, 16.65, { x: 1260, y: 70, w: 410, h: 410 }, { drawing: 'facepalm', start: 15.6, dur: 0.8 }, 'pop');
  // The playtest: live gameplay footage, built in (swap in your own recording later).
  add('game', 9.8, 12.2, { x: 300, y: 200, w: 1000, h: 620 }, { title: 'GoFish', coins: 1250, start: 9.8, speed: 1.5 }, 'pop');
  // The webcam feed sits on top of the agent window, like a live recording overlay.
  add('facecam', 4.6, 17.4, { x: 1340, y: 500, w: 400, h: 300 }, { shape: 'feed', feedTitle: 'Web Cam Feed', clock: '5:55:00', reactive: false }, 'pop');
  add('chat', 13.6, 17.4, { x: 420, y: 230, w: 900, h: 560 }, {
    style: 'panels', contact: 'Beta Test Squad', contacts: ['Beta Test Squad', 'Panda', 'Mr Boss', 'Williams'],
    messages: [
      { t: 13.8, from: 'sep', text: 'Today 9:41 AM' },
      { t: 13.62, from: 'them', name: 'Shalom', text: 'GoFish tournament tonight?' },
      { t: 13.63, from: 'me', text: 'only if I get to play Panda' },
      { t: 13.64, from: 'them', name: 'Panda', text: 'My girl and I are playing GoFish tonight', react: '🔥' },
      { t: 14.1, from: 'them', name: 'Declan', text: 'Why is Panda so OP?', react: '😂' },
      { t: 14.8, from: 'me', text: 'I keep losing at my own game...' },
      { t: 15.8, from: 'them', name: 'Panda', text: 'Skill issue...', react: '💀' },
      { t: 15.3, from: 'them', name: 'Panda', text: '[video 0:03]' },
      { t: 16.6, from: 'them', name: 'Patrick', text: 'Can we add a new power up??' },
    ],
  }, 'slide');
  // Window storm: the code piles up everywhere while things get out of hand.
  for (let i = 0; i < 10; i++) {
    const x = [60, 980, 420, 1240, 200, 760, 1400, 40, 640, 1100][i], y = [80, 60, 420, 380, 560, 120, 600, 300, 640, 240][i];
    const s = add('code', 16.7 + i * 0.07, 17.5, { x, y, w: 620, h: 380 }, { file: `src/patch-${i + 1}.ts`, start: 16.7, cps: 400 }, 'pop');
    s.name = `Storm ${i + 1}`; s.title = `src/patch-${i + 1}.ts`;
  }
  p.audio = p.audio.filter((c, i, a) => i === a.findIndex((d) => Math.abs(d.start - c.start) < 0.3));
  // The time-skip card covers everything, so it goes on top.
  p.layers.splice(p.layers.indexOf(skip), 1); p.layers.push(skip);
  add('prompt', 18.1, null, card, { title: 'Back to Normal', subtitle: 'Close everything and touch grass', command: 'bash ~/webprojects/mystrangeaddiction/back-to-normal.sh', choice: 'deny', clickAt: 19.8 }, 'fade');

  p.cursor = {
    ...p.cursor, hidden: false, size: 1.25, color: 'light', clickStyle: 'ripple',
    keys: [
      { t: 0.5, ease: 'smooth', x: 1560, y: 900 }, { t: 1.5, ease: 'smooth', x: 1262, y: 626 },
      { t: 2.6, ease: 'smooth', x: 1262, y: 626 }, { t: 5.5, ease: 'smooth', x: 1250, y: 610 },
      { t: 9.0, ease: 'smooth', x: 1180, y: 560 }, { t: 15.2, ease: 'smooth', x: 980, y: 700 },
      { t: 18.2, ease: 'smooth', x: 900, y: 760 }, { t: 19.6, ease: 'smooth', x: 640, y: 626 },
    ],
    events: [{ id: newId('ev'), t: 1.7, type: 'click' }, { id: newId('ev'), t: 19.8, type: 'click' }],
  };
  return migrate(p);
}
