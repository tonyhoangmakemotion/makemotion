// Scenes tab (left panel): the video as a list of beats, built from when windows appear.
// Click a scene to jump there and select its main window.

import { APPS } from './apps/index.js';
import { layerRange } from './cut.js';
import { S, $, hooks, select, seek, esc, fmt } from './store.js';

// Windows that decorate a scene rather than start one.
const DECOR = new Set(['notification', 'callout', 'spotlight', 'wipe', 'facecam']);
const THUMB = { code: '#1d2a3a', agent: '#3a2a22', terminal: '#1a2a1d', chat: '#22304a', browser: '#2a2f3a', game: '#1f4a6b', title: '#2b3a6b', sentence: '#2a2a30', logoreveal: '#30302a', metrics: '#26302a', prompt: '#3a2c22', dashboard: '#24243a', streak: '#1d3324' };

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
  return scenes.map((sc, i) => {
    const main = sc.layers[0];
    const label = APPS[main.type]?.label || main.type;
    // Text beats are named by what they say; windows by their name.
    const textual = ['sentence', 'title', 'logoreveal', 'metrics', 'prompt'].includes(main.type) && summary(main);
    const name = textual ? summary(main) : (main.name || label);
    const sub = textual ? label : (summary(main) || APPS[main.type]?.blurb || '');
    return { start: sc.start, end: scenes[i + 1]?.start ?? P.duration, main, name, sub, chip: APPS[main.type]?.chip || '', type: main.type, count: sc.layers.length };
  });
}

export function renderScenes() {
  const box = $('scene-list');
  if (!box || $('scene-pane')?.hidden) return;
  const P = S.project;
  const list = computeScenes(P);
  const cur = list.findLast((sc) => S.t >= sc.start - 1e-3);
  $('scene-meta').innerHTML = `<b>${list.length} scene${list.length === 1 ? '' : 's'}</b> · ${esc(fmt(P.duration))}${P.camera.auto ? ` · auto camera <b>${esc(P.camera.autoStyle || 'mixed')}</b>` : ''}. Click a scene to jump there.`;
  box.innerHTML = list.length ? list.map((sc, i) => `<li><button class="scene-card${sc === cur ? ' on' : ''}" data-i="${i}">
      <span class="scene-thumb" style="background:${THUMB[sc.type] || '#26262d'}">${esc(sc.chip)}</span>
      <span class="scene-text"><b></b><small></small></span>
      <span class="scene-time">${fmt(sc.start).slice(0, 5)}</span></button></li>`).join('')
    : '<li class="empty">No scenes yet. Describe your video in Prompt, or add a window.</li>';
  box.querySelectorAll('.scene-card').forEach((b) => {
    const sc = list[+b.dataset.i];
    b.querySelector('b').textContent = sc.name;
    b.querySelector('small').textContent = sc.sub + (sc.count > 1 ? ` · +${sc.count - 1}` : '');
    b.addEventListener('click', () => { seek(sc.start + 0.6); select({ kind: 'layer', id: sc.main.id }); renderScenes(); });
  });
}

export function initScenes() {
  const prev = hooks.timeline;
  hooks.timeline = () => { prev(); renderScenes(); };
  $('scene-add').addEventListener('click', () => $('add-btn').click());
  $('scene-tpl').addEventListener('click', (e) => { e.stopPropagation(); $('reset-btn').click(); });
  $('scene-voice').addEventListener('click', () => select({ kind: 'audio', track: 'voice' }));
}
