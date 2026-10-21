// Prompt panel: describe the video in a chat and Claude builds or edits the project.
// Claude answers with a small JSON edit plan ({reply, ops}); the page applies the ops itself,
// as ONE undo step. Runs on the viewer's own Claude account through the artifact's `sample`
// capability; where that is unavailable (opened outside claude.ai) the panel says so.

import { applyEnter, applyExit, clamp, newId, snapTime } from './model.js';
import { makeLayer, shiftLayer } from './project.js';
import { APP_LIST, APPS } from './apps/index.js';
import { LOOKS } from './look.js';
import { FORMATS, formatOf } from './format.js';
import { S, $, hooks, changed, toast, esc, seek } from './store.js';

let sample = null;          // the capability, once resolved
let busy = null;            // AbortController of the running call
const turns = [];           // [{role, content}] the conversation the page keeps (Claude keeps nothing)
const log = [];             // what the panel shows: {who: 'me'|'ai'|'err', text, ops?}

// ---------- What Claude is told ----------

const ENTERS = ['pop', 'slide', 'fade'];

function catalog() {
  return APP_LIST.map((a) => {
    let d = '';
    try { d = JSON.stringify(a.defaults(0)); } catch { /* ignore */ }
    if (d.length > 700) d = d.slice(0, 700) + '…';
    return `- ${a.type} (${a.label}; ${a.blurb || ''}) size ${a.size.join('x')}. Example data: ${d}`;
  }).join('\n');
}

function projectSummary() {
  const P = S.project;
  const windows = P.layers.map((l) => {
    const k = l.keys[0], last = l.keys[l.keys.length - 1];
    const end = l.out ?? (last.opacity <= 0.01 ? last.t : null);
    let d = JSON.stringify(l.data);
    if (d.length > 500) d = d.slice(0, 500) + '…';
    return `- id ${l.id}: ${l.type} "${l.name}" from ${(l.in ?? k.t).toFixed(2)}s${end != null ? ` to ${end.toFixed(2)}s` : ''} at x${Math.round(k.x)} y${Math.round(k.y)} w${Math.round(k.w)} h${Math.round(k.h)}${l.hidden ? ' (hidden)' : ''}. Data: ${d}`;
  }).join('\n') || '(no windows yet)';
  const caps = (P.captions || []).map((c) => `- ${c.start}-${c.end}s: ${c.text}`).join('\n') || '(none)';
  return `Project "${P.name}": ${P.duration}s long, format ${formatOf(P)}, look ${P.look?.preset || 'custom'}, auto camera ${P.camera.auto ? `on (${P.camera.autoStyle || 'mixed'})` : 'off'}.
Windows, back to front:
${windows}
Captions:
${caps}`;
}

const RULES = () => `You are the editor inside MakeMotion, a "screenlife" video editor: fake desktop windows (chats, code editors, AI agents, browsers, prompt cards, games, webcams...) animate on a 1920x1080 desktop, and a camera films them. You turn the user's description into edits.

Reply with ONLY one JSON object: {"reply": string, "ops": [ ... ]}
- "reply": 1-2 short sentences to the user about what you built or changed (no JSON, no lists).
- "ops": the edits, applied in order. Allowed ops:
  {"op":"set_project", "name"?, "duration"? (seconds, 3-180), "wallpaper"? ("studio-glow"|"studio-paper"|"solid"|"painting"|"classical"|"flow-dark"|"flow-light"), "wallpaperColor"? (hex), "format"? ("16:9"|"9:16"|"4:5"|"1:1"), "look"? ("cinematic"|"clean"|"flat"), "autoCamera"? (true|false), "cameraStyle"? ("mixed"|"whip"|"cut"|"smooth")}
  {"op":"clear"}  — remove all windows and captions (only when the user wants a new video)
  {"op":"add_window", "type", "start" (s), "end"? (s), "x"?, "y"?, "w"?, "h"?, "name"?, "title"? (title bar text), "enter"? ("pop"|"slide"|"fade"), "data"? {fields to set}}
  {"op":"update_window", "id", "start"?, "end"?, "x"?, "y"?, "w"?, "h"?, "name"?, "title"?, "hidden"?, "data"? {fields to set}}
  {"op":"remove_window", "id"}
  {"op":"add_caption", "start", "end", "text"}
  {"op":"remove_caption", "start"}  — removes the caption starting at that second
Rules:
- All times are absolute seconds on the video timeline, including every time inside "data" (message times, typing starts, clickAt...). Keep everything inside the duration.
- "data" replaces whole fields; give complete arrays (e.g. all chat messages). Use the field names and shapes from the examples below exactly.
- Windows live on a 1920x1080 desktop. Keep them on screen, overlapping a little like a real busy desktop; later windows are drawn on top.
- Pace like a short-form edit: a new beat every 1.5-3 s, chapter/prompt cards for big moments, keep the desktop lived-in (2-5 windows visible).
- For a new video: set a duration that fits, turn autoCamera on (style "mixed"), use look "cinematic".
- Keep changes minimal when the user asks for a tweak. Never invent real brands or logos.

For a product or startup LAUNCH video (or when the user asks for motion design / a promo), follow how professional launch films are built:
- Arc: hook line (a number or bold claim) → tension (the pain, often a question) → logo reveal → the product, one feature at a time → proof (numbers in motion) → logo + tagline → CTA line.
- Use the motion windows: "sentence" for every line of copy (3-7 words, one highlight: *accent word*, [pill], [7>22] counting pill), "logoreveal" for the brand, "spotlight" boxes over the exact control you talk about (with a short label), "metrics" for funnels and growth, "wipe" to bridge two scenes, "endcard" or a final sentence for the CTA.
- Calm look: set the backdrop with set_project wallpaper "studio-glow" (dark) or "studio-paper" (light) and one accent colour reused on every window ("accent").
- No hard cuts: each line blurs out (sentence "exitAt" ~0.4 s before the next starts) or a wipe covers the change. A new beat every 1.5-2.5 s; hold the ending 2-3 s. 20-35 s total.
- Camera: auto camera on with style "smooth" so it glides to each spotlight.

Window types:
${catalog()}

The project now:
${projectSummary()}`;

// ---------- Applying the plan ----------

const num = (v, d) => (Number.isFinite(+v) ? +v : d);

function applyBox(l, op) {
  const keys = ['x', 'y', 'w', 'h'].filter((k) => op[k] != null);
  if (!keys.length) return;
  for (const key of l.keys) for (const k of keys) key[k] = Math.round(num(op[k], key[k]));
}

export function applyOps(ops) {
  const P = S.project;
  const did = { add: 0, upd: 0, del: 0, cap: 0 };
  for (const op of Array.isArray(ops) ? ops : []) {
    if (!op || typeof op !== 'object') continue;
    if (op.op === 'set_project') {
      if (op.name) P.name = String(op.name).slice(0, 80);
      if (op.duration != null) P.duration = clamp(Math.round(num(op.duration, P.duration) * 10) / 10, 1, 600);
      if (FORMATS[op.format]) P.format = op.format;
      if (LOOKS[op.look]) { const { label, ...v } = LOOKS[op.look]; Object.assign(P.look, v, { preset: op.look }); }
      if (['studio-glow', 'studio-paper', 'solid', 'painting', 'classical', 'flow-dark', 'flow-light'].includes(op.wallpaper)) P.wallpaper = { ...P.wallpaper, kind: op.wallpaper, blur: 0, dim: 0 };
      if (/^#[0-9a-f]{6}$/i.test(op.wallpaperColor || '')) P.wallpaper = { ...P.wallpaper, color1: op.wallpaperColor };
      if (op.autoCamera != null) P.camera.auto = !!op.autoCamera;
      if (['mixed', 'whip', 'cut', 'smooth'].includes(op.cameraStyle)) P.camera.autoStyle = op.cameraStyle;
    } else if (op.op === 'clear') {
      P.layers = []; P.captions = []; did.del++;
    } else if (op.op === 'add_window' && APPS[op.type]) {
      const start = snapTime(clamp(num(op.start, 0), 0, P.duration));
      const l = makeLayer(op.type, start, P);
      if (op.data && typeof op.data === 'object') Object.assign(l.data, op.data);
      if (op.name) l.name = String(op.name).slice(0, 60);
      if (op.title) l.title = String(op.title).slice(0, 120);
      applyBox(l, op);
      const base = { ...l.keys[0], opacity: 1, scale: 1 };
      l.keys = [{ ...base, t: start, ease: 'smooth' }];
      applyEnter(l, start, ENTERS.includes(op.enter) ? op.enter : 'pop');
      if (op.end != null && num(op.end, 0) > start + 0.3) applyExit(l, snapTime(Math.min(num(op.end, 0), P.duration)), 'fade');
      P.layers.push(l);
      did.add++;
    } else if (op.op === 'update_window') {
      const l = P.layers.find((x) => x.id === op.id);
      if (!l) continue;
      if (op.start != null) {
        const cur = l.in ?? l.keys[0].t;
        const dt = num(op.start, cur) - cur;
        if (Math.abs(dt) > 1e-3) shiftLayer(l, dt);
      }
      if (op.end != null) l.out = +clamp(num(op.end, P.duration), (l.in ?? l.keys[0].t) + 0.2, P.duration).toFixed(2);
      if (op.data && typeof op.data === 'object') Object.assign(l.data, op.data);
      if (op.name) l.name = String(op.name).slice(0, 60);
      if (op.title != null) l.title = String(op.title).slice(0, 120);
      if (op.hidden != null) l.hidden = !!op.hidden;
      applyBox(l, op);
      did.upd++;
    } else if (op.op === 'remove_window') {
      const n = P.layers.length;
      P.layers = P.layers.filter((x) => x.id !== op.id);
      if (P.layers.length < n) did.del++;
    } else if (op.op === 'add_caption' && op.text) {
      const s0 = clamp(num(op.start, 0), 0, P.duration - 0.2), s1 = clamp(num(op.end, s0 + 2), s0 + 0.2, P.duration);
      P.captions = (P.captions || []).filter((c) => c.end <= s0 || c.start >= s1);
      P.captions.push({ id: newId('cap'), start: +s0.toFixed(2), end: +s1.toFixed(2), text: String(op.text).slice(0, 200) });
      P.captions.sort((a, b) => a.start - b.start);
      did.cap++;
    } else if (op.op === 'remove_caption') {
      P.captions = (P.captions || []).filter((c) => Math.abs(c.start - num(op.start, -1)) > 0.05);
      did.cap++;
    }
  }
  return did;
}

const summarize = (d) => [d.add && `${d.add} window${d.add > 1 ? 's' : ''} added`, d.upd && `${d.upd} changed`, d.del && `${d.del} removed`, d.cap && `captions updated`].filter(Boolean).join(' · ');

// ---------- Panel ----------

const ERR = {
  not_granted: 'Claude isn’t allowed for this page. You can allow it from the artifact’s Permissions menu.',
  sampling_disabled: 'Claude isn’t available on this account.',
  rate_limited: 'Too many requests right now. Wait a moment, then send again.',
  session_expired: 'Your session expired. Reload the page and sign in again.',
  refused: 'Claude declined that one. Try describing it differently.',
  invalid_json: 'The answer came back garbled. Send again, or ask for a smaller change.',
  prompt_too_large: 'This project is too big to send in one go. Ask about one part at a time.',
};

function renderLog() {
  const box = $('ai-log');
  if (!box) return;
  box.innerHTML = log.length ? log.map((m) => `<div class="ai-msg ${m.who}">${esc(m.text)}${m.ops ? `<span class="ai-ops">${esc(m.ops)}</span>` : ''}</div>`).join('')
    : `<div class="ai-empty"><b>Describe your video.</b> Claude builds the windows, timing and captions, and you can change anything after.<br><br>Try: “20s devlog about building a fishing game with an AI agent. Start with a chapter card, show the code, a group chat roasting me, end on a ‘3 hours later’ card.”</div>`;
  if (busy) box.insertAdjacentHTML('beforeend', '<div class="ai-msg ai thinking">Building…</div>');
  box.scrollTop = box.scrollHeight;
}

function setBusy(on) {
  $('ai-send').hidden = !!on;
  $('ai-stop').hidden = !on;
  $('ai-input').disabled = !!on;
  renderLog();
}

export async function sendPrompt(text) {
  text = String(text || '').trim();
  if (!text || busy) return;
  if (!sample) { toast('Building with Claude works when MakeMotion is opened in claude.ai'); return; }
  log.push({ who: 'me', text });
  turns.push({ role: 'user', content: text });
  while (turns.length > 12) turns.splice(0, 2);
  const ctl = busy = new AbortController();
  setBusy(true);
  try {
    // Standing instructions + current project go first; the chat follows.
    const input = [{ role: 'user', content: RULES() }, ...turns];
    const plan = await sample.json(input, { signal: ctl.signal, cache: false });
    const did = applyOps(plan?.ops);
    const reply = String(plan?.reply || 'Done.');
    turns.push({ role: 'assistant', content: JSON.stringify({ reply, ops: '(applied)' }) });
    log.push({ who: 'ai', text: reply, ops: summarize(did) || 'No changes' });
    if (did.add || did.upd || did.del || did.cap || plan?.ops?.length) {
      S.sel = null;
      changed({ structure: true, inspector: true });
      hooks.project();
      seek(Math.min(S.t, S.project.duration));
    }
  } catch (e) {
    turns.pop();
    if (e?.code !== 'cancelled') log.push({ who: 'err', text: ERR[e?.code] || 'Something went wrong on the way. Send again in a moment.' });
  } finally {
    busy = null;
    setBusy(false);
  }
}

export function initAI() {
  const input = $('ai-input');
  const send = () => { const v = input.value; input.value = ''; sendPrompt(v); };
  $('ai-send').addEventListener('click', send);
  $('ai-stop').addEventListener('click', () => busy?.abort());
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  document.querySelectorAll('[data-ai-chip]').forEach((b) => b.addEventListener('click', () => sendPrompt(b.dataset.aiChip)));
  // Left panel tabs: Prompt | Windows.
  document.querySelectorAll('[data-ltab]').forEach((b) => b.addEventListener('click', () => {
    const tab = b.dataset.ltab;
    document.querySelectorAll('[data-ltab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    $('ai-pane').hidden = tab !== 'prompt';
    $('win-pane').hidden = tab !== 'windows';
    $('ai-pane').closest('.layers').classList.toggle('prompt-tab', tab === 'prompt');
    try { localStorage.setItem('finischd.ltab', tab); } catch { /* ignore */ }
  }));
  let tab = 'prompt';
  try { tab = localStorage.getItem('finischd.ltab') || 'prompt'; } catch { /* ignore */ }
  document.querySelector(`[data-ltab="${tab}"]`)?.click();
  renderLog();
  const claude = window.claude;
  if (claude?.use) {
    claude.use('sample').then((s) => {
      sample = s;
      if (!s) $('ai-note').hidden = false;
    }).catch(() => { $('ai-note').hidden = false; });
  } else $('ai-note').hidden = false;
}
