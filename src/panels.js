// Left panel (windows list, add-window menu, project), top bar buttons, shortcuts help.

import { clamp, newId } from './model.js';
import { makeLayer, createDemoProject, createLaunchTemplate, createDevlogTemplate, createLaunchFilmTemplate } from './project.js';
import { APP_LIST, APPS, GROUPS } from './apps/index.js';
import { S, hooks, $, changed, select, seek, replaceProject, undo, redo, confirmClick, toast, esc } from './store.js';
import { autoCameraKeys } from './autocam.js';
import { FORMATS, SAFE_AREAS, formatOf } from './format.js';
import { syncReviewButtons } from './review.js';
import { onHistoryChange, canUndo, canRedo } from './history.js';

export const typeChip = (type) => APPS[type]?.chip || type;

export function addLayer(type, extra = {}) {
  hooks.pause();
  const layer = makeLayer(type, S.t, S.project);
  Object.assign(layer.data, extra);
  S.project.layers.push(layer);
  S.sel = { kind: 'layer', id: layer.id };
  changed({ structure: true });
  toast(`${layer.name} added at ${S.t.toFixed(1)}s`);
  return layer;
}

export function duplicateLayer(l) {
  const copy = JSON.parse(JSON.stringify(l));
  copy.id = newId(l.type);
  copy.name = `${l.name} copy`;
  copy.keys.forEach((k) => { k.x += 40; k.y += 40; });
  S.project.layers.splice(S.project.layers.indexOf(l) + 1, 0, copy);
  S.sel = { kind: 'layer', id: copy.id };
  changed({ structure: true });
  toast('Window duplicated');
}

export function deleteLayer(l) {
  S.project.layers = S.project.layers.filter((x) => x !== l);
  S.sel = null;
  changed({ structure: true });
}

const EYE = '<svg width="14" height="14" viewBox="0 0 14 14"><path d="M1 7s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="7" cy="7" r="1.8" fill="currentColor"/></svg>';
const EYE_OFF = '<svg width="14" height="14" viewBox="0 0 14 14"><path d="M1 7s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M2 12 12 2" stroke="currentColor" stroke-width="1.3"/></svg>';

function renderLayerList() {
  const ul = $('layer-list');
  ul.innerHTML = '';
  if (!S.project.layers.length) {
    ul.innerHTML = '<li class="empty">No windows yet. Add one below.</li>';
    return;
  }
  [...S.project.layers].reverse().forEach((l) => {
    const li = document.createElement('li');
    li.className = 'layer-item' + (l.hidden ? ' is-hidden' : '');
    li.setAttribute('aria-selected', String(S.sel?.kind === 'layer' && S.sel.id === l.id));
    li.tabIndex = 0;
    li.innerHTML = `<span class="chip">${esc(typeChip(l.type))}</span><span class="name"></span>
      <span class="item-actions">
        <button class="icon-btn" data-act="up" title="Bring forward" aria-label="Bring forward"><svg width="10" height="10" viewBox="0 0 10 10"><path d="M5 2 9 7H1z" fill="currentColor"/></svg></button>
        <button class="icon-btn" data-act="down" title="Send backward" aria-label="Send backward"><svg width="10" height="10" viewBox="0 0 10 10"><path d="M5 8 1 3h8z" fill="currentColor"/></svg></button>
        <button class="icon-btn" data-act="hide" title="${l.hidden ? 'Show' : 'Hide'}" aria-label="${l.hidden ? 'Show' : 'Hide'}">${l.hidden ? EYE_OFF : EYE}</button>
      </span>`;
    li.querySelector('.name').textContent = l.name;
    const act = (name) => {
      const i = S.project.layers.indexOf(l);
      if (name === 'up' && i < S.project.layers.length - 1) { S.project.layers.splice(i, 1); S.project.layers.splice(i + 1, 0, l); changed({ structure: true }); }
      else if (name === 'down' && i > 0) { S.project.layers.splice(i, 1); S.project.layers.splice(i - 1, 0, l); changed({ structure: true }); }
      else if (name === 'hide') { l.hidden = !l.hidden; changed({ structure: true }); }
    };
    li.addEventListener('click', (e) => {
      const a = e.target.closest('[data-act]')?.dataset.act;
      if (a) { act(a); return; }
      select({ kind: 'layer', id: l.id });
      if (S.t < l.keys[0].t) seek(l.keys[0].t + 0.6);
    });
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter') li.click(); });
    ul.appendChild(li);
  });
}

function buildAddMenu() {
  const menu = $('add-menu');
  menu.innerHTML = '<input class="menu-search" id="add-search" type="search" placeholder="Search windows… (Enter adds the first match)" aria-label="Search window types">' + GROUPS.map((g) => `<div class="menu-group"><h4>${g}</h4><div class="menu-grid">${
    APP_LIST.filter((a) => a.group === g).map((a) => `<button class="menu-item" data-add="${a.type}">
      <span class="chip">${esc(a.chip)}</span><span><b>${esc(a.label)}</b><small>${esc(a.blurb || '')}</small></span></button>`).join('')
  }</div></div>`).join('');
  menu.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => { closeMenu(); addLayer(b.dataset.add); }));
  const search = $('add-search');
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    menu.querySelectorAll('.menu-item').forEach((b) => { b.hidden = !!q && !b.textContent.toLowerCase().includes(q); });
    menu.querySelectorAll('.menu-group').forEach((g) => { g.hidden = ![...g.querySelectorAll('.menu-item')].some((b) => !b.hidden); });
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const first = [...menu.querySelectorAll('.menu-item')].find((b) => !b.hidden); if (first) first.click(); }
  });
}
const closeMenu = () => { $('add-menu').hidden = true; $('add-btn').setAttribute('aria-expanded', 'false'); };
export const openAddMenu = () => {
  $('add-menu').hidden = false; $('add-btn').setAttribute('aria-expanded', 'true');
  const q = $('add-search'); q.value = ''; q.dispatchEvent(new Event('input')); setTimeout(() => q.focus(), 0);
};

function syncProjectFields() {
  $('proj-name').value = S.project.name;
  $('proj-duration').value = S.project.duration;
  syncFormatChips();
  syncReviewButtons();
}
// Top-bar format chips (ratio, length, fps, look), refreshed on every edit.
export function syncFormatChips() {
  const p = S.project;
  const set = (id, v) => { const el = document.getElementById(id); if (el && el.textContent !== v) el.textContent = v; };
  set('chip-ratio-val', formatOf(p));
  const d = p.duration; set('chip-len', `${Math.floor(d / 60)}:${(d % 60).toFixed(1).padStart(4, '0')}`);
  set('chip-fps', `${p.fps || 30} fps`);
  const preset = p.look?.preset || 'custom';
  set('chip-look', preset.charAt(0).toUpperCase() + preset.slice(1));
}
function syncHistoryButtons() {
  $('undo-btn').disabled = !canUndo();
  $('redo-btn').disabled = !canRedo();
}

export function initPanels() {
  hooks.layers = renderLayerList;
  hooks.project = syncProjectFields;
  hooks.chips = syncFormatChips;
  onHistoryChange(syncHistoryButtons);
  syncHistoryButtons();
  buildAddMenu();

  $('add-btn').addEventListener('click', (e) => { e.stopPropagation(); $('add-menu').hidden ? openAddMenu() : closeMenu(); });
  document.addEventListener('pointerdown', (e) => { if (!$('add-menu').hidden && !e.target.closest('#add-menu, #add-btn')) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('add-menu').hidden) closeMenu(); });
  $('add-caption').addEventListener('click', () => hooks.addCaption());
  $('undo-btn').addEventListener('click', undo);
  $('redo-btn').addEventListener('click', redo);

  $('proj-name').addEventListener('change', (e) => { S.project.name = e.target.value.trim() || 'Untitled'; changed(); });
  $('proj-duration').addEventListener('change', (e) => {
    S.project.duration = clamp(Math.round((+e.target.value || S.project.duration) * 10) / 10, 1, 600);
    e.target.value = S.project.duration;
    seek(Math.min(S.t, S.project.duration));
    changed();
  });

  // Templates menu
  const tpl = $('tpl-menu');
  const closeTpl = () => { tpl.hidden = true; $('reset-btn').setAttribute('aria-expanded', 'false'); };
  $('reset-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    tpl.hidden = !tpl.hidden;
    $('reset-btn').setAttribute('aria-expanded', String(!tpl.hidden));
  });
  document.addEventListener('pointerdown', (e) => { if (!tpl.hidden && !e.target.closest('#tpl-menu, #reset-btn')) closeTpl(); });
  tpl.querySelectorAll('[data-tpl]').forEach((b) => b.addEventListener('click', () => {
    closeTpl();
    const p = b.dataset.tpl === 'film' ? createLaunchFilmTemplate() : b.dataset.tpl === 'launch' ? createLaunchTemplate() : b.dataset.tpl === 'devlog' ? createDevlogTemplate() : createDemoProject();
    if (p.camera.auto) p.camera.keys = autoCameraKeys(p) || p.camera.keys;
    replaceProject(p);
    S.sel = null;
    hooks.layers(); hooks.inspector(); hooks.timeline();
    toast(`${p.name} loaded. Ctrl+Z brings back your previous project`);
  }));
  $('new-btn').addEventListener('click', (e) => confirmClick(e.currentTarget, 'Start empty?', () => {
    const p = createDemoProject();
    p.name = 'Untitled'; p.layers = []; p.captions = []; p.audio = [];
    p.camera.keys = [{ t: 0, ease: 'smooth', cx: p.width / 2, cy: p.height / 2, zoom: 1 }];
    p.camera.auto = true; // the camera follows new windows until the person directs it
    p.cursor = { ...p.cursor, keys: [{ t: 0, ease: 'smooth', x: p.width * 0.7, y: p.height * 0.75 }], events: [], hidden: true };
    p.duration = 15;
    replaceProject(p);
    e.currentTarget.textContent = 'New';
    toast('Empty project. Add a window to begin');
  }));

  initFormatMenu();

  const help = $('help-pop');
  $('help-btn').addEventListener('click', () => { help.hidden = !help.hidden; $('help-btn').setAttribute('aria-expanded', String(!help.hidden)); });
  $('help-close').addEventListener('click', () => { help.hidden = true; $('help-btn').setAttribute('aria-expanded', 'false'); });
}

// ---------- Format menu (top bar): output shape + platform safe areas ----------
function initFormatMenu() {
  const menu = $('fmt-menu'), btn = $('chip-ratio');
  const render = () => {
    const cur = formatOf(S.project);
    $('fmt-grid').innerHTML = Object.entries(FORMATS).map(([k, f]) => {
      const sw = f.w >= f.h ? 30 : Math.round(30 * f.w / f.h), sh = f.h >= f.w ? 30 : Math.round(30 * f.h / f.w);
      return `<button class="fmt-opt" data-fmt="${k}" aria-pressed="${k === cur}"><span class="fmt-shape"><i style="width:${sw - 4}px;height:${sh - 4}px"></i></span><span><b>${f.label} <span class="r">${k}</span></b><small>${f.for}</small></span></button>`;
    }).join('');
    const opts = [['', 'Off'], ...Object.entries(SAFE_AREAS).map(([k, v]) => [k, v.label.replace('Instagram ', '').replace('YouTube ', '')])];
    $('fmt-safe').innerHTML = opts.map(([k, l]) => `<button data-safe="${k}" aria-pressed="${(S.safeArea || '') === k}">${l}</button>`).join('');
  };
  const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', (e) => { e.stopPropagation(); if (menu.hidden) { render(); menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); } else close(); });
  document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !e.target.closest('#fmt-menu, #chip-ratio')) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) close(); });
  menu.addEventListener('click', (e) => {
    const f = e.target.closest('[data-fmt]')?.dataset.fmt;
    if (f && f !== formatOf(S.project)) {
      S.project.format = f;
      // A vertical video wants the matching safe area on by default.
      if (f === '9:16' && !S.safeArea) S.safeArea = 'tiktok';
      if (f !== '9:16' && ['tiktok', 'reels', 'shorts'].includes(S.safeArea)) S.safeArea = '';
      S.dirty = true;
      changed({ inspector: true });
      syncFormatChips();
      toast(`${FORMATS[f].label} ${f}: every shot re-framed${S.project.camera.auto ? ' by the auto camera' : ''}`);
      render();
      return;
    }
    const sa = e.target.closest('[data-safe]');
    if (sa) { S.safeArea = sa.dataset.safe; S.dirty = true; render(); }
  });
}
