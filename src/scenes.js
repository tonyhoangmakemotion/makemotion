// Scenes tab (left panel): the video as a list of beats, built from when windows appear.
// Click a scene to jump there and select its main window.

import { APPS } from './apps/index.js';
import { layerRange } from './cut.js';
import { S, $, hooks, select, seek, esc, fmt } from './store.js';
import { renderFrame } from './render.js';
import { outSize } from './format.js';

// Windows that decorate a scene rather than start one.
const DECOR = new Set(['notification', 'callout', 'spotlight', 'wipe', 'facecam']);

const summary = (l) => {
  const d = l.data || {};
  const s = d.text || d.title || d.headline || d.query || d.name || d.contact || d.chain || d.file || d.heading || d.value || '';
  return String(s).replace(/\[([^\]>]*?)[\d.,]+\s*>\s*([\d.,]+)([^\]]*)\]/g, '$1$2$3').replace(/[*[\]{}~]/g, '').replace(/\s+/g, ' ').trim();
};

export function computeScenes(P) {
  const items = P.layers.filter((l) => !l.hidden && !DECOR.has(l.type))
    .map((l) => ({ l, start: layerRange(l, P.duration).start }))
    .sort((a, b) => a.start - b.start);
  const scenes = [];
  for (const it of items) {
    const last = scenes[scenes.length - 1];
    if (last && it.start - last.start < 0.5) { last.layers.push(it.l); continue; }
    scenes.push({ start: it.start, layers: [it.l] });
  }
  const TEXT = ['sentence', 'title', 'logoreveal', 'metrics', 'prompt'];
  return scenes.map((sc, i) => {
    const main = sc.layers[0];
    // The beat this scene plays in the edit, named like an editor would (Hook, Reveal, ...).
    const role = i === 0 ? 'Hook' : main.type === 'logoreveal' ? 'Reveal' : main.type === 'metrics' ? 'Proof'
      : i === scenes.length - 1 && scenes.length > 2 ? 'End card' : TEXT.includes(main.type) ? 'Line' : (APPS[main.type]?.label || 'Scene');
    const label = APPS[main.type]?.label || main.type;
    // Text beats are named by what they say; windows by their name.
    const textual = ['sentence', 'title', 'logoreveal', 'metrics', 'prompt'].includes(main.type) && summary(main);
    const name = textual ? summary(main) : (main.name || label);
    const sub = textual ? label : (summary(main) || APPS[main.type]?.blurb || '');
    return { start: sc.start, end: scenes[i + 1]?.start ?? P.duration, main, name, sub, role, chip: APPS[main.type]?.chip || '', type: main.type, count: sc.layers.length };
  });
}

// Small frame thumbnails for the scene cards (rendered from the real project, centre-cropped).
let thumbTimer = 0;
const scratch = document.createElement('canvas');
function drawThumbs(list, boxes) {
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(() => {
    const P = S.project, { W, H } = outSize(P), k = 160 / Math.max(W, H);
    scratch.width = Math.round(W * k); scratch.height = Math.round(H * k);
    const g = scratch.getContext('2d');
    for (const box of boxes) {
      box.querySelectorAll('canvas[data-i]').forEach((c) => {
        const sc = list[+c.dataset.i]; if (!sc) return;
        try {
          renderFrame(g, P, Math.min(sc.end - 0.05, sc.start + 0.9), { base: new DOMMatrix().scale(k) });
          const cg = c.getContext('2d'), r = Math.max(c.width / scratch.width, c.height / scratch.height);
          const sw = c.width / r, sh = c.height / r;
          cg.drawImage(scratch, (scratch.width - sw) / 2, (scratch.height - sh) / 2, sw, sh, 0, 0, c.width, c.height);
        } catch { /* a frame that cannot draw yet keeps its blank tile */ }
      });
    }
  }, 150);
}

function cardsHtml(list, cur) {
  return list.map((sc, i) => `<li><button class="scene-card${sc === cur ? ' on' : ''}" data-i="${i}">
      <span class="scene-thumb"><canvas width="56" height="76" data-i="${i}"></canvas></span>
      <span class="scene-text"><b></b><small></small></span>
      <span class="scene-time">${fmt(sc.start).slice(0, 5).replace(/^0/, '')}</span></button></li>`).join('');
}

function fill(box, list) {
  box.querySelectorAll('.scene-card').forEach((b) => {
    const sc = list[+b.dataset.i];
    b.querySelector('b').textContent = sc.role;
    b.querySelector('small').textContent = sc.name + (sc.count > 1 ? ` · +${sc.count - 1}` : '');
    b.title = `${sc.role}: ${sc.name} (${sc.sub})`;
    b.addEventListener('click', () => { seek(sc.start + 0.6); select({ kind: 'layer', id: sc.main.id }); renderScenes(); });
  });
}

export function renderScenes() {
  const P = S.project;
  const list = computeScenes(P);
  const cur = list.findLast((sc) => S.t >= sc.start - 1e-3);
  const boxes = [];
  const box = $('scene-list');
  if (box && !$('scene-pane')?.hidden) {
    $('scene-meta').innerHTML = `<b>${list.length} scene${list.length === 1 ? '' : 's'}</b> · ${esc(fmt(P.duration))}${P.camera.auto ? ` · auto camera <b>${esc(P.camera.autoStyle || 'mixed')}</b>` : ''}. Click a scene to jump there.`;
    const key = list.map((sc) => `${sc.main.id}${sc.start}${sc.name}`).join('|') + (cur ? cur.main.id : '') + JSON.stringify(P.format);
    if (box.dataset.key !== key || !box.children.length) {
      box.dataset.key = key;
      box.innerHTML = list.length ? cardsHtml(list, cur) : '<li class="empty">No scenes yet. Describe your video in Prompt, or add a window.</li>';
      fill(box, list); boxes.push(box);
    }
  }
  // The Prompt tab shows the scenes the chat built, under the conversation (as on makemotion.studio).
  const mini = $('ai-scenes');
  if (mini && !$('ai-pane')?.hidden) {
    const key = list.map((sc) => `${sc.main.id}${sc.start}${sc.name}`).join('|') + (cur ? cur.main.id : '');
    if (mini.dataset.key !== key || !mini.children.length) {
      mini.dataset.key = key;
      mini.innerHTML = cardsHtml(list.slice(0, 3), cur) + (list.length > 3 ? `<li><button class="scene-more" type="button">+${list.length - 3} more scenes</button></li>` : '');
      mini.querySelector('.scene-more')?.addEventListener('click', () => document.querySelector('[data-ltab="scenes"]')?.click());
      fill(mini, list); boxes.push(mini);
    }
    mini.hidden = !list.length;
  }
  if (boxes.length) drawThumbs(list, boxes);
}

export function initScenes() {
  const prev = hooks.timeline;
  hooks.timeline = () => { prev(); renderScenes(); };
  $('scene-add').addEventListener('click', () => $('add-btn').click());
  $('scene-tpl').addEventListener('click', (e) => { e.stopPropagation(); $('reset-btn').click(); });
  $('scene-voice').addEventListener('click', () => select({ kind: 'audio', track: 'voice' }));
}
