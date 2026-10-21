// Full-screen preview: plays the finished video exactly as it will export
// (camera on, no selection outlines), with sound.

import { renderFrame } from './render.js';
import { outSize } from './format.js';
import { S, hooks, $, fmt, seek } from './store.js';

let open = false;
let canvas, ctx, hideTimer = 0;

export const isPreviewOpen = () => open;

const ICON_PLAY = '<svg width="20" height="20" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5v11l9-5.5z" fill="currentColor"/></svg>';
const ICON_PAUSE = '<svg width="20" height="20" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5h3v11H3zM8 1.5h3v11H8z" fill="currentColor"/></svg>';

function showControls() {
  $('preview').classList.remove('idle');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { if (S.playing && open) $('preview').classList.add('idle'); }, 2200);
}

export function openPreview() {
  if (open) return;
  open = true;
  $('preview').hidden = false;
  { const { W, H } = outSize(S.project); if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; } }
  $('pv-scrub').max = String(S.project.duration);
  if (S.t >= S.project.duration - 0.05) seek(0, { refresh: false });
  S.dirty = true;
  hooks.play();
  showControls();
  $('pv-play').focus();
}

export function closePreview() {
  if (!open) return;
  hooks.pause();
  open = false;
  $('preview').hidden = true;
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  S.dirty = true;
  $('preview-btn').focus();
}

export function drawPreview() {
  renderFrame(ctx, S.project, S.t);
  $('pv-time').textContent = `${fmt(S.t)} / ${fmt(S.project.duration)}`;
  if (document.activeElement !== $('pv-scrub')) $('pv-scrub').value = String(S.t);
  $('pv-play').innerHTML = S.playing ? ICON_PAUSE : ICON_PLAY;
  $('pv-play').setAttribute('aria-label', S.playing ? 'Pause' : 'Play');
  if (!S.playing) $('preview').classList.remove('idle');
}

async function toggleFullscreen() {
  const el = $('preview');
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await el.requestFullscreen();
  } catch {
    // Some views (like an embedded preview) block real fullscreen; the overlay already fills the window.
  }
}

export function initPreview() {
  canvas = $('pv-canvas');
  ctx = canvas.getContext('2d');
  $('preview-btn').addEventListener('click', openPreview);
  $('pv-close').addEventListener('click', closePreview);
  $('pv-play').addEventListener('click', () => (S.playing ? hooks.pause() : hooks.play()));
  $('pv-restart').addEventListener('click', () => { seek(0, { refresh: false }); hooks.pause(); hooks.play(); });
  $('pv-full').addEventListener('click', toggleFullscreen);
  $('pv-scrub').addEventListener('input', (e) => { hooks.pause(); seek(+e.target.value, { refresh: false }); });
  // Click the video itself to play/pause, like a normal player.
  canvas.addEventListener('click', () => (S.playing ? hooks.pause() : hooks.play()));
  $('preview').addEventListener('pointermove', showControls);
  // Capture phase so the editor's shortcuts don't also fire.
  document.addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closePreview(); }
    else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); e.stopImmediatePropagation(); toggleFullscreen(); }
    else if (![' ', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'l', 'L'].includes(e.key)) e.stopImmediatePropagation();
    showControls();
  }, true);
}
