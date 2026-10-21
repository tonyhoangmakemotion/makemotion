// Versions (named snapshots you can go back to) and comments pinned to a moment.
// Versions live in this browser (localStorage); comments are part of the project (project.comments),
// so they travel with saved project files.

import { newId } from './model.js';
import { S, $, changed, seek, replaceProject, toast, esc, fmt } from './store.js';

const VKEY = 'finischd.versions.v1';
const MAX_VERSIONS = 30;

function loadVersions() {
  try { const v = JSON.parse(localStorage.getItem(VKEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function storeVersions(list) {
  try { localStorage.setItem(VKEY, JSON.stringify(list.slice(0, MAX_VERSIONS))); return true; }
  catch { toast('Could not save the version here (browser storage is full or blocked)'); return false; }
}

const ago = (ms) => {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
};

export function saveVersion(name) {
  const list = loadVersions();
  const n = (list[0]?.n || 0) + 1;
  const v = { id: newId('v'), n, name: (name || '').trim() || `Version ${n}`, at: Date.now(), data: JSON.stringify(S.project) };
  if (storeVersions([v, ...list])) { syncReviewButtons(); toast(`Saved v${n}: ${v.name}`); }
}

function restoreVersion(id) {
  const v = loadVersions().find((x) => x.id === id);
  if (!v) return;
  try { replaceProject(JSON.parse(v.data)); toast(`Back to v${v.n}. Ctrl+Z returns to where you were`); }
  catch { toast('That version could not be opened'); }
}

// ---------- Comments ----------

export const comments = () => (S.project.comments ||= []);

export function addComment(text, t = S.t) {
  text = String(text || '').trim();
  if (!text) return null;
  const c = { id: newId('cm'), t: +t.toFixed(2), text, done: false, at: Date.now() };
  comments().push(c);
  comments().sort((a, b) => a.t - b.t);
  changed();
  syncReviewButtons();
  return c;
}

// Pins on the timeline ruler, one per open comment.
export function addCommentPins(ruler, pct) {
  comments().forEach((c, i) => {
    if (c.done) return;
    const pin = document.createElement('button');
    pin.className = 'cm-pin';
    pin.style.left = pct(c.t);
    pin.textContent = String(i + 1);
    pin.title = `${fmt(c.t)}  ${c.text}`;
    pin.setAttribute('aria-label', `Comment at ${fmt(c.t)}: ${c.text}`);
    pin.addEventListener('pointerdown', (e) => e.stopPropagation());
    pin.addEventListener('click', (e) => { e.stopPropagation(); seek(c.t); openPanel('comments', c.id); });
    ruler.appendChild(pin);
  });
}

// ---------- Popovers ----------

let openKind = null;

function renderComments(focusId) {
  const list = comments();
  const open = list.filter((c) => !c.done).length;
  return `<h4>Comments <small>${open} open · pinned to the timeline</small></h4>
    <div class="cm-add"><input id="cm-text" placeholder="Leave a note at ${fmt(S.t)}…" aria-label="New comment"><button class="btn small" id="cm-add-btn">Add at ${fmt(S.t)}</button></div>
    <ul class="cm-list">${list.length ? list.map((c, i) => `<li class="cm-row${c.done ? ' done' : ''}${c.id === focusId ? ' focus' : ''}">
      <button class="cm-time" data-seek="${c.t}" title="Jump there">${fmt(c.t)}</button>
      <span class="cm-text"><b>${i + 1}</b> ${esc(c.text)}</span>
      <button class="icon-btn" data-done="${c.id}" title="${c.done ? 'Reopen' : 'Resolve'}" aria-label="${c.done ? 'Reopen' : 'Resolve'}">${c.done ? '↺' : '✓'}</button>
      <button class="icon-btn danger" data-del="${c.id}" title="Delete" aria-label="Delete comment">✕</button></li>`).join('')
      : '<li class="empty">No comments yet. Pause where something needs work and write a note.</li>'}</ul>`;
}

function renderVersions() {
  const list = loadVersions();
  return `<h4>Versions <small>saved in this browser</small></h4>
    <div class="cm-add"><input id="v-name" placeholder="What changed? e.g. End card in green" aria-label="Version name"><button class="btn small" id="v-save">Save version</button></div>
    <ul class="cm-list">${list.length ? list.map((v, i) => `<li class="cm-row">
      <span class="v-badge">v${v.n}</span>
      <span class="cm-text">${esc(v.name)}<small>${ago(v.at)}${i === 0 ? ' · latest' : ''}</small></span>
      <button class="btn small" data-restore="${v.id}">Restore</button>
      <button class="icon-btn danger" data-vdel="${v.id}" title="Delete version" aria-label="Delete version">✕</button></li>`).join('')
      : '<li class="empty">No versions yet. Save one before a big change, so you can always go back.</li>'}</ul>`;
}

export function openPanel(kind, focusId) {
  const pop = $('review-pop');
  openKind = kind;
  pop.innerHTML = kind === 'comments' ? renderComments(focusId) : renderVersions();
  pop.hidden = false;
  $('comments-btn').setAttribute('aria-expanded', String(kind === 'comments'));
  $('versions-btn').setAttribute('aria-expanded', String(kind === 'versions'));
  const input = pop.querySelector('input');
  setTimeout(() => input?.focus(), 0);
}
function closePanel() {
  $('review-pop').hidden = true; openKind = null;
  $('comments-btn').setAttribute('aria-expanded', 'false');
  $('versions-btn').setAttribute('aria-expanded', 'false');
}

export function syncReviewButtons() {
  const open = (S.project.comments || []).filter((c) => !c.done).length;
  const cb = $('comments-count'); if (cb) { cb.textContent = String(open); cb.hidden = !open; }
  const v = loadVersions()[0];
  const vb = $('versions-label'); if (vb) vb.textContent = v ? `v${v.n}` : 'Versions';
}

export function initReview() {
  const pop = $('review-pop');
  $('comments-btn').addEventListener('click', (e) => { e.stopPropagation(); openKind === 'comments' ? closePanel() : openPanel('comments'); });
  $('versions-btn').addEventListener('click', (e) => { e.stopPropagation(); openKind === 'versions' ? closePanel() : openPanel('versions'); });
  document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !e.target.closest('#review-pop, #comments-btn, #versions-btn, .cm-pin')) closePanel(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) closePanel(); });
  const submit = () => {
    if (openKind === 'comments') { if (addComment($('cm-text').value)) openPanel('comments'); }
    else if (openKind === 'versions') { saveVersion($('v-name').value); openPanel('versions'); }
  };
  pop.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); submit(); } });
  pop.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'cm-add-btn' || b.id === 'v-save') return submit();
    if (b.dataset.seek) { seek(+b.dataset.seek); return; }
    if (b.dataset.done) { const c = comments().find((x) => x.id === b.dataset.done); if (c) { c.done = !c.done; changed(); syncReviewButtons(); openPanel('comments'); } return; }
    if (b.dataset.del) { S.project.comments = comments().filter((x) => x.id !== b.dataset.del); changed(); syncReviewButtons(); openPanel('comments'); return; }
    if (b.dataset.restore) { restoreVersion(b.dataset.restore); closePanel(); return; }
    if (b.dataset.vdel) { storeVersions(loadVersions().filter((x) => x.id !== b.dataset.vdel)); syncReviewButtons(); openPanel('versions'); }
  });
  syncReviewButtons();
}
