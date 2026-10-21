// Video export and project files.

import { migrate } from './project.js';
import { renderFrame } from './render.js';
import { outSize } from './format.js';
import { syncVideos, pauseAllVideos, exportMediaInline, importMediaInline } from './media.js';
import { audioContext, schedule, autoEvents } from './audio.js';
import { S, hooks, $, replaceProject, toast } from './store.js';

// The claude.ai viewer offers file saving through its downloads capability;
// a normal browser tab uses a plain download link.
const inArtifact = !!window.claude?.use;
const downloadsReady = inArtifact ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);

async function saveFile(filename, data) {
  const downloads = await downloadsReady;
  if (downloads) {
    try { await downloads.save({ filename, data }); toast('Saved'); return true; }
    catch (err) { if (err?.code !== 'declined') toast('Could not save the file here'); return false; }
  }
  if (inArtifact) { toast('Saving files is not available in this view'); return false; }
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data]));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}

const safeName = () => (S.project.name || 'makemotion').replace(/[^\w\- ]+/g, '').trim() || 'makemotion';

// ---------- Video export ----------

let exportJob = null;

function pickMime(withAudio) {
  const options = withAudio
    ? ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    : ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  return options.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || null;
}

async function exportVideo() {
  hooks.pause();
  const P = S.project;
  const actx = audioContext();
  const hasAudio = !!actx && ((P.audio || []).some((c) => !c.muted) || autoEvents(P).length > 0);
  const mime = pickMime(hasAudio);
  $('export-modal').hidden = false;
  $('export-video').hidden = true; $('export-save').hidden = true;
  $('export-bar').style.width = '0%';
  $('export-close').textContent = 'Cancel';
  $('export-title').textContent = 'Exporting';
  if (!mime || !HTMLCanvasElement.prototype.captureStream) {
    $('export-note').textContent = 'This browser cannot record video from a canvas. Try a recent Chrome, Edge or Firefox.';
    $('export-close').textContent = 'Close';
    return;
  }
  $('export-note').textContent = `Rendering ${Math.round(P.duration * P.fps)} frames in real time (${P.duration}s). Keep this tab in front until it finishes.`;

  const off = document.createElement('canvas');
  const { W: OW, H: OH } = outSize(P);
  off.width = OW; off.height = OH;
  const g = off.getContext('2d');
  const stream = off.captureStream(0);
  const track = stream.getVideoTracks()[0];
  let audioDest = null, audioSources = [];
  if (hasAudio) {
    await actx.resume?.();
    audioDest = actx.createMediaStreamDestination();
    stream.addTrack(audioDest.stream.getAudioTracks()[0]);
  }
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 14_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((res) => (rec.onstop = res));
  const job = exportJob = { cancelled: false };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  rec.start(250);
  syncVideos(P, 0, false);
  renderFrame(g, P, 0); track.requestFrame();
  await sleep(150);
  const frames = Math.round(P.duration * P.fps);
  const t0 = performance.now();
  if (audioDest) audioSources = schedule(P, 0, audioDest, actx.currentTime);
  // The recording runs on the wall clock, so every frame shows what belongs at *this* moment.
  // If the computer can't keep up, the heavy finishing touches switch off instead of the
  // video drifting away from the sound.
  let last = -1, slow = 0, fast = false, drawn = 0;
  for (;;) {
    if (job.cancelled) break;
    const i = Math.min(frames, Math.floor(((performance.now() - t0) / 1000) * P.fps));
    if (i !== last) {
      const t = i / P.fps;
      const r0 = performance.now();
      syncVideos(P, t, true);
      try { renderFrame(g, P, t, { fast }); } catch (err) { console.warn('MakeMotion: export frame failed', err); }
      track.requestFrame();
      drawn++;
      if (performance.now() - r0 > 1000 / P.fps * 0.8) { if (++slow > 8) fast = true; } else slow = Math.max(0, slow - 1);
      $('export-bar').style.width = `${(i / frames) * 100}%`;
      last = i;
      if (i >= frames) break;
    }
    await sleep(Math.max(0, t0 + ((last + 1) * 1000) / P.fps - performance.now()));
  }
  const skipped = Math.max(0, frames + 1 - drawn);
  track.requestFrame();
  await sleep(300);
  rec.stop();
  for (const src of audioSources) { try { src.stop(); } catch { /* done */ } }
  pauseAllVideos();
  await stopped;
  if (job.cancelled) return;

  const blob = new Blob(chunks, { type: mime.split(';')[0] });
  const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
  const video = $('export-video');
  if (video.src) URL.revokeObjectURL(video.src);
  video.src = URL.createObjectURL(blob); video.hidden = false;
  $('export-title').textContent = 'Your video is ready';
  $('export-close').textContent = 'Close';
  $('export-note').textContent = `${ext.toUpperCase()}, ${OW}×${OH}, ${hasAudio ? 'with sound' : 'no sound'}, ${(blob.size / 1e6).toFixed(1)} MB.`;
  if (skipped > frames * 0.1) $('export-note').textContent += ' Your computer was busy, so some frames were skipped; close other tabs or pick the Flat look for a smoother export.';
  if (inArtifact && !(await downloadsReady)) {
    $('export-note').textContent += ' Saving files is not available in this view; open the page in claude.ai to save it.';
    return;
  }
  const saveBtn = $('export-save');
  saveBtn.hidden = false;
  saveBtn.onclick = () => saveFile(`${safeName()}.${ext}`, blob);
}

// ---------- Project files ----------

async function saveProject() {
  const inline = await exportMediaInline(S.project);
  const json = JSON.stringify({ ...S.project, mediaInline: inline });
  saveFile(`${safeName()}.makemotion.json`, new Blob([json], { type: 'application/json' }));
}

async function openProject(file) {
  try {
    const p = JSON.parse(await file.text());
    if (!p || p.version !== 1 || !Array.isArray(p.layers)) throw new Error('not a project');
    const inline = p.mediaInline;
    delete p.mediaInline;
    migrate(p);
    if (inline) await importMediaInline(p, inline);
    replaceProject(p);
    toast(`Opened ${p.name || 'project'}`);
  } catch {
    toast('That file is not a MakeMotion project');
  }
}

export function initIO() {
  $('export-btn').addEventListener('click', exportVideo);
  $('export-close').addEventListener('click', () => {
    if (exportJob) exportJob.cancelled = true;
    $('export-modal').hidden = true;
    $('export-video').pause();
  });
  $('save-btn').addEventListener('click', saveProject);
  $('open-btn').addEventListener('click', () => $('open-file').click());
  $('open-file').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) openProject(f);
    e.target.value = '';
  });
}
