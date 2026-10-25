// Prompt panel: describe the video in a chat and Claude builds or edits the project.
// Claude answers with a small JSON edit plan ({reply, ops}); the page applies the ops itself,
// as ONE undo step. Runs on the viewer's own Claude account through the artifact's `sample`
// capability; where that is unavailable (opened outside claude.ai) the panel says so.

import { applyEnter, applyExit, clamp, newId, snapTime } from './model.js';
import { makeLayer, shiftLayer, textLayerName } from './project.js';
import { APP_LIST, APPS } from './apps/index.js';
import { LOOKS } from './look.js';
import { FORMATS, formatOf } from './format.js';
import { S, $, hooks, changed, toast, esc, seek } from './store.js';
import { SFX } from './audio.js';

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
  const media = Object.entries(P.media || {}).map(([id, m]) => `- ${id}: ${m.kind} "${m.name}"${m.duration ? ` ${m.duration.toFixed(1)}s` : ''}`).join('\n') || '(none uploaded)';
  return `Project "${P.name}": ${P.duration}s long, format ${formatOf(P)}, look ${P.look?.preset || 'custom'}, auto camera ${P.camera.auto ? `on (${P.camera.autoStyle || 'mixed'})` : 'off'}.
Windows, back to front:
${windows}
Captions:
${caps}
Uploaded media (use these ids in logoId, wordmarkId, mediaId):
${media}`;
}

// ---------- What MakeMotion remembers (per browser) ----------
// Lessons the user taught the AI ("remember" in a reply) and short outlines of videos built here,
// so the next video starts from what worked before. Stored in localStorage; the user can clear it.
const MEM_KEY = 'finischd.ai.memory.v1';
function loadMem() {
  try { const m = JSON.parse(localStorage.getItem(MEM_KEY) || '{}'); return { lessons: Array.isArray(m.lessons) ? m.lessons : [], projects: Array.isArray(m.projects) ? m.projects : [] }; }
  catch { return { lessons: [], projects: [] }; }
}
function saveMem(m) { try { localStorage.setItem(MEM_KEY, JSON.stringify(m)); } catch { /* storage off */ } renderMemNote(); }
export function rememberLesson(text) {
  text = String(text || '').trim().slice(0, 200);
  if (!text) return;
  const m = loadMem();
  if (m.lessons.some((l) => l.toLowerCase() === text.toLowerCase())) return;
  m.lessons.push(text); while (m.lessons.length > 20) m.lessons.shift();
  saveMem(m);
}
const outlineText = (l) => String(l.data?.text || l.data?.name || l.data?.chain || l.data?.title || l.data?.headline || l.name || '').replace(/\s+/g, ' ').slice(0, 60);
export function rememberProject(P) {
  const beats = P.layers.slice().sort((a, b) => (a.in ?? a.keys[0].t) - (b.in ?? b.keys[0].t))
    .map((l) => `${(l.in ?? l.keys[0].t).toFixed(1)} ${l.type}${outlineText(l) ? ` "${outlineText(l)}"` : ''}`);
  if (!beats.length) return;
  const m = loadMem();
  const entry = { name: P.name, duration: P.duration, format: formatOf(P), wallpaper: P.wallpaper?.kind, beats: beats.slice(0, 24) };
  m.projects = m.projects.filter((p) => p.name !== entry.name); m.projects.push(entry);
  while (m.projects.length > 5) m.projects.shift();
  saveMem(m);
}
function memoryBlock() {
  const m = loadMem();
  let out = '';
  if (m.lessons.length) out += `What this user has taught you (follow it):\n${m.lessons.map((l) => `- ${l}`).join('\n')}\n\n`;
  if (m.projects.length) out += `Videos this user built here before (reuse what fits):\n${m.projects.map((p) => `- "${p.name}" ${p.duration}s ${p.format} ${p.wallpaper || ''}: ${p.beats.join(' | ')}`).join('\n')}\n\n`;
  return out;
}
function renderMemNote() {
  const el = $('ai-mem'); if (!el) return;
  const m = loadMem(), n = m.lessons.length + m.projects.length;
  el.hidden = !n;
  const parts = [m.lessons.length && `${m.lessons.length} preference${m.lessons.length === 1 ? '' : 's'}`, m.projects.length && `${m.projects.length} past video${m.projects.length === 1 ? '' : 's'}`].filter(Boolean);
  el.querySelector('span').textContent = `Remembers ${parts.join(' and ')}`;
  el.title = [...m.lessons, ...m.projects.map((p) => `Video: ${p.name}`)].join('\n');
}

const RULES = () => `You are the editor inside MakeMotion, a "screenlife" video editor: fake desktop windows (chats, code editors, AI agents, browsers, prompt cards, games, webcams...) animate on a 1920x1080 desktop, and a camera films them. You turn the user's description into edits.

About MakeMotion (from makemotion.studio; tagline "Motion videos, made from a prompt."): a prompt-driven motion editor for people who ship ten videos a week: UGC editors (creator clips into finished ads with beat-synced captions and hooks), brands (on-brand videos across many creators, quick price/offer swaps) and agencies (A/B hook variations without more editors). Principles: real layers, not flat files (every word and keyframe stays editable); your brand every time; the user stays in control (you draft, they decide). Users brief you like they'd brief an editor: length, format, footage, mood. Follow-up prompts revise the existing cut instead of starting over.
- Default to short-form social unless told otherwise: format "9:16", 10-20 s, text clear of platform UI (keep text inside the middle 70% vertically), a hook in the first second. With the camera centred at zoom 1, a format shows only part of the 1920×1080 desktop: 9:16 shows x 656-1264, 4:5 x 528-1392, 1:1 x 420-1500. Keep every text and window at least 40 px inside that strip (for 9:16: x 700-1220), or it gets cut off at the frame edge.
- Keep copy as live text in sentence/title windows, never baked into images, so any word can be changed later without breaking timing.
- For ads: a hook line, the offer or product, one proof, a clear CTA. When asked for variations or A/B hooks, change only the hook beat and keep the rest identical.

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
  {"op":"add_sound", "t" (s), "sound" (${Object.keys(SFX).join('|')}), "volume"? (0-1)}  — a sound effect on the timeline
Optionally add "questions": [2-4 short strings] when you need more context before building (then "ops" is []).
Optionally add "remember": a short sentence with a lasting preference or lesson the user just expressed about how they want videos made (e.g. "Prefers fast pacing, no outline boxes"). Only for real preferences, not one-off edits.
Rules:
- All times are absolute seconds on the video timeline, including every time inside "data" (message times, typing starts, clickAt...). Keep everything inside the duration.
- "data" replaces whole fields; give complete arrays (e.g. all chat messages). Use the field names and shapes from the examples below exactly.
- Windows live on a 1920x1080 desktop. Keep them on screen, overlapping a little like a real busy desktop; later windows are drawn on top.
- Pace like a short-form edit: a new beat every 1.5-3 s, chapter/prompt cards for big moments, keep the desktop lived-in (2-5 windows visible).
- For a new video: set a duration that fits, turn autoCamera on (style "mixed"), use look "cinematic".
- For any NEW video, if the request is too vague to make it about something specific (no product, topic or story), ask 2-4 questions first (see "questions") instead of guessing.
- Keep changes minimal when the user asks for a tweak. Never invent real brands or logos.

For a SCREENLIFE story (devlog, "I built…", vlog, story told through a desktop), match the user's reference video (a 7:48 dev vlog, analysed in docs/screenlife-reference.md):
- Look: wallpaper "painting" or "classical", look "cinematic" (depth of field, contrast, vignette, grain), dark-theme windows. Auto camera on, style "mixed": the camera should almost never stop (push in on what is typed, pull back to the cluster, pan to the next window).
- Dense desktop: 4-8 windows overlapping in a cluster, big in frame; a new window or event every 1.5-4 s; each gets the shot when it appears.
- Real-looking content: an "agent" terminal with a typed prompt, "Thinking…" and a red warning; "code" with "errors" (red lines, e.g. "4, 7") lighting up when something breaks; "chat" messages from friends pushing the story; browser/social/game/map windows for context.
- "facecam" pops in big for reactions, then sits in a corner. Chapters: a "prompt" card ("run Chapter One?") between acts. Inserts: "photo"/"video" windows for jokes, "notes" as a sticky note with one word, captions as pills.

For a product or startup LAUNCH video, a promo, or "motion design", use this playbook (learned from professional launch films, e.g. the Base44 launch, and from the user's feedback):
- Pace is everything. Think in beats of ~0.45 s (135 BPM): something new lands every 1-4 beats (0.5-1.8 s). Never hold a static frame longer than ~2.5 s, except the final line (2-3 s). Total 25-45 s. Slow, evenly spaced beats make people scroll away.
- Arc: hook (3-6 s: 1-3 tiny lines that build word by word, e.g. "Make" → "Make videos" → "that move.") → logo reveal (~3 s) → the product, ONE piece at a time (the prompt being typed, the result, a list, a button) → proof (a "metrics" chain or a number) → promise line ("No editing skills. Just [your idea.]") → logo again → short CTA ("Start creating [for free.]").
- Copy: "sentence" windows, 2-6 words, ONE highlight per line ([pill], {outline pill}, [7>22] counting pill, *accent word*). Small, calm type (size 56-72). Lines blur out ("exitAt" ~0.35 s before the next one starts); no hard cuts between lines.
- Show the product isolated and big: give each UI piece its own beat as the only new window (a prompt card, one app window, a phone), so the auto camera frames it full. Show the result right after the action that made it.
- Do NOT draw "spotlight" outline boxes over parts of a recording, screenshot or video: you can't see where things are inside it, and a box that misses its target looks broken. Only use a spotlight when its box equals a window's exact x/y/w/h, and prefer none.
- Bridge sections with "wipe" (style "iridescent" or "light") instead of cuts; keep one backdrop: wallpaper "studio-paper" (light, warm) or "studio-glow" (dark), black/white plus at most one accent. Auto camera on, style "smooth" (or "mixed" for faster edits).
- Sound sells the pace: add_sound "swish" or "pop" when words/cards land, "whoosh" on transitions and wipes, "click" on every cursor click, "riser" ~1.8 s before a big moment and "impact" on it (logo reveal, first product shot), "snap" for quick changes (format, tiles), "ding" on success. Roughly one sound per beat in busy parts.

Reference library: 16 professional launch videos the user collected as the quality bar (analysed frame by frame; details in docs/launch-video-library.md). What they share, so copy it:
- One idea per frame: a 2-6 word line plus ONE supporting visual. Clean backdrop: pure white/off-white most often ("studio-paper" or "solid" #ffffff), else near-black ("flow-dark"/"solid" #0b0b0d) or one vivid brand gradient. Black/white type plus one accent colour.
- Mostly one continuous take: change happens inside the frame (things enter/leave, the camera pushes in or pulls back, light/dark flips between acts), not with hard cuts. Each move is a short eased burst (0.3-0.6 s) on a beat, then the frame HOLDS long enough to read (1-3 s). Fast cuts only for the hook, a montage or a stat run.
- Text: sentence case, one sans, small for lines (size 56-80), huge only for hero words, numbers and the name. Mix the Kinetic line "effect"s instead of using one everywhere: "type" for prompts and the opening line (letters at cps 22-30, caret), "blur" for statements, "stickers" for a 2-4 word punch line (e.g. "now you can"), "scramble" for tech/privacy moments, and the rolling word "(a|b|c)" to list options in place ("Get ad (ideas|hooks|feedback)", "Works in (chat|email|docs)"; rollEvery 0.5-0.8). Counters "[0>157%]" on every number.
- UI isolated and big: one card/window at a time, centred or right of a left-aligned headline, numbers counting, the cursor gliding in to click (button squash). Push the camera into the important detail (the text being typed, the button), then pull back to show the whole thing.
- Story shapes that work: (A) problem lines -> reveal the name -> 3-4 features -> proof (numbers, benchmark) -> CTA; (B) prompt demo: a prompt typed in a field -> click -> the result streams in -> 2-4 feature beats -> logo; (C) feature list: headline on the left, its card on the right, ~3 s each, same layout every time; (D) stat reel: one big counted number per beat; (E) word-per-beat opener over different photos/textures.
- Endings: logo pops then the name slides out ("logoreveal"), or a black CTA pill clicked, or the URL alone, with a final rolling line ("Anything you can do in a (browser|chat|doc)").
- Default for any new launch, promo or B-roll video: the house style above + the MakeMotion launch v4 rhythm below (music-locked, a beat every 0.5-1.8 s during demos, holds on statements), unless the user asks for another style.

How to start a launch video (the workflow that made the three launch films below):
1. Gather context first. You need: (a) the product name and what it does in one sentence, (b) who it is for, (c) the 2-4 features or moments to show, (d) one proof point (a number, a result), (e) the call to action, (f) the look: logo uploaded? colours (or black/white), light or dark, (g) length and format (default 30-40 s, 16:9). References the user likes (a video, a style) help a lot.
2. If (a) or (c) is missing, or the request is just "make a launch video", do NOT build yet: reply with "ops": [] and put 2-4 short, concrete questions in "questions" (e.g. "What does the product do, in one sentence?", "Which 3 things should the video show?", "Do you have a logo? Upload it in Media and tell me.", "Light or dark, and any brand colours?"). Offer sensible defaults so they can just say "go". When the user answers, build right away; don't ask twice.
3. Plan before you add windows: write the beat sheet on a 0.45 s grid (hook → logo → features → proof → promise → logo → CTA), decide what lands on each beat, then where the sounds go.
4. Build it in one go (clear, set_project, windows, sounds). Use uploaded media: a logo image goes in logoreveal "logoId" (and a written-out name image in "wordmarkId"); screen recordings go in "video" windows.
5. In "reply", say what you built in one sentence and suggest the one change most likely to make it better.

The launch films built so far, and how each started:
- Lumen launch (33 s, studio-glow). Started from: three uploaded launch videos to analyse (structure: hook → tension → reveal → product → proof → close) and a made-up product (content analytics). Built: "You just got [7>22] new customers" → "But which post actually {sent them?}" → logoreveal → dashboard with a headline above it every ~2.5 s, a notification sliding in → light wipe → metrics chain → "Stop making content for [views.]" → "Double down on {what actually works.}" → logoreveal → "Start your [free trial] today." Lesson: green accents were rejected; keep black and white.
- MakeMotion launch v1 (54 s, studio-glow). Started from: the product itself, the uploaded logo mark and wordmark, and recordings of the real editor. Built: three hook lines → logo (mark shrinks into the wordmark) → each feature as a recorded clip with a headline and a spotlight box → metrics → promise → logo → CTA. Lessons from the user: too slow (a beat every ~2.5-6 s, people scroll away) and the spotlight outlines missed the parts of the recordings they targeted. Never repeat either.
- MakeMotion launch v2 (41 s, studio-paper, 135 BPM). Started from: the user's favourite reference (a fast app-builder launch video), analysed for pacing (a hit every 0.22 s in the music, a new visual every 0.5-1.8 s), sound (music plus effects on nearly every hit, no narrator) and how it shows UI (one isolated piece per beat, big, no boxes). Built: 0.1 "Make videos" builds word by word → 1.3 "that move." → 2.5 collage of small app windows popping in from the edges (riser) → 3.9 logoreveal (impact) → 5.9 prompt card typed, Build clicked (typing, click, whoosh) → 7.9 the result, cut every ~0.7 s between its beats → 10.0 a list of scenes appearing one per 0.25 s → 11.6 timeline → 13.4 "Change {any word}" → 14.7 live editing (typing) → 17.0 the same frame in 16:9, 9:16, 4:5, 1:1 (snap each) → 20.0 phone mockup → 21.8 click Export → 23.1 dark terminal "export video.mp4" with progress → 25.3 montage of outputs, one per 0.22-0.44 s → 27.6 four number tiles pop on the beat → 29.8 "No editing skills. Just [your idea.]" → 31.6 big Export button clicked → 35.1 logo (riser, impact) → 38.0 "Make it [move]" held to the end. This is the one the user liked: start new launch videos from this rhythm.
- MakeMotion launch v4 (39 s, light paper, 125 BPM, the first official one). Started from: v3 plus the user's feedback "too slow; hook me in the first second; show that you can also build it yourself without the prompt". Built: frame 1 is the song's drop with four finished videos cut every half beat → 1.0 "All of this took [one prompt.]" → 1.9 prompt typed fast, Build → 3.8 logo (flash, shake) → 5.8 real editor recordings with snap zooms on the beat and captions on dark pills → 8.4 a price edit → 11.3 the manual path (+ Window → Phone chat → type → drag writes a keyframe → play) captioned "Or skip the AI. Pick a window. Type your text. Move it. Made for beginners." → 15.3 a new format every beat → 18.2 comments and versions → 20.1 export → 22.0 montage → 24.0 layers → 26.8 promise in the music break → 30.7 logo and tagline as the music returns → waitlist → "made with makemotion". Lessons: start on the drop, never let a shot sit longer than about 2.5 s, keep text inside the 9:16 safe strip.

${memoryBlock()}Window types:
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
      P.layers = []; P.captions = []; P.audio = (P.audio || []).filter((a) => a.track !== 'sfx'); did.del++;
      // A new video starts with a calm, centred camera (old camera moves belong to the old video).
      P.camera.keys = [{ t: 0, ease: 'smooth', cx: P.width / 2, cy: P.height / 2, zoom: 1 }]; P.camera.shakes = []; P.camera.blurs = [];
    } else if (op.op === 'add_sound' && SFX[op.sound]) {
      P.audio ??= [];
      P.audio.push({ id: newId('au'), src: `sfx:${op.sound}`, track: 'sfx', start: +clamp(num(op.t, 0), 0, P.duration).toFixed(2), offset: 0, volume: clamp(num(op.volume, 0.7), 0, 1), name: SFX[op.sound] });
      did.snd = (did.snd || 0) + 1;
    } else if (op.op === 'add_window' && APPS[op.type]) {
      const start = snapTime(clamp(num(op.start, 0), 0, P.duration));
      const l = makeLayer(op.type, start, P);
      if (op.data && typeof op.data === 'object') Object.assign(l.data, op.data);
      if (op.name) l.name = String(op.name).slice(0, 60);
      else { const t = textLayerName(op.type, l.data); if (t) l.name = t; }
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

const summarize = (d) => [d.add && `${d.add} window${d.add > 1 ? 's' : ''} added`, d.upd && `${d.upd} changed`, d.del && `${d.del} removed`, d.cap && `captions updated`, d.snd && `${d.snd} sound${d.snd > 1 ? 's' : ''}`].filter(Boolean).join(' · ');

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
  box.innerHTML = log.length ? log.map((m) => `<div class="ai-msg ${m.who}">${esc(m.text)}${m.questions?.length ? `<ol class="ai-qs">${m.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ol>` : ''}${m.ops ? `<span class="ai-ops">${esc(m.ops)}</span>` : ''}</div>`).join('')
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
    if (plan?.remember) rememberLesson(plan.remember);
    if (did.add >= 3) rememberProject(S.project);
    const reply = String(plan?.reply || 'Done.');
    turns.push({ role: 'assistant', content: JSON.stringify({ reply, ops: '(applied)' }) });
    const qs = Array.isArray(plan?.questions) ? plan.questions.map((q) => String(q).slice(0, 200)).filter(Boolean).slice(0, 5) : [];
    log.push({ who: 'ai', text: reply, questions: qs, ops: qs.length && !plan?.ops?.length ? '' : summarize(did) || 'No changes' });
    if (did.add || did.upd || did.del || did.cap || did.snd || plan?.ops?.length) {
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
    $('scene-pane').hidden = tab !== 'scenes';
    const panel = $('ai-pane').closest('.layers');
    panel.classList.toggle('prompt-tab', tab === 'prompt');
    panel.classList.toggle('scenes-tab', tab === 'scenes');
    if (tab !== 'windows') hooks.timeline();
    try { localStorage.setItem('finischd.ltab', tab); } catch { /* ignore */ }
  }));
  let tab = 'prompt';
  try { tab = localStorage.getItem('finischd.ltab') || 'prompt'; } catch { /* ignore */ }
  document.querySelector(`[data-ltab="${tab}"]`)?.click();
  renderLog();
  renderMemNote();
  $('ai-mem-clear')?.addEventListener('click', () => { saveMem({ lessons: [], projects: [] }); toast('Prompt memory cleared'); });
  const claude = window.claude;
  if (claude?.use) {
    claude.use('sample').then((s) => {
      sample = s;
      if (!s) $('ai-note').hidden = false;
    }).catch(() => { $('ai-note').hidden = false; });
  } else $('ai-note').hidden = false;
}
