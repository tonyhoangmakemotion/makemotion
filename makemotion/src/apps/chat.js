// Messaging: a desktop chat app, and a shared conversation renderer that the
// phone app reuses. "them" messages show typing dots first; "me" messages are
// typed into the input bar, then fly up as a bubble.

import { roundRect, wrapText, UI_FONT, avatar, colorFor, caretOn, typed, typingDuration, shadowScale } from './draw.js';
import { EASINGS, clamp, parseChatScript, chatScriptToText } from '../model.js';

export const TYPING_LEAD = 1.3;
const ME_CPS = 20;
const SEND_PAUSE = 0.35;
const draftDuration = (text) => typingDuration(text, ME_CPS) + SEND_PAUSE;

export const DARK = {
  bg: '#17181c', them: '#2a2b31', themText: '#f4f4f8', me: '#2f6fed', meText: '#ffffff',
  inputBg: '#24252b', inputText: '#ececf1', placeholder: '#6f717a', meta: '#7d808a', dots: '220,220,228', font: 15,
};
export const LIGHT = {
  bg: '#ffffff', them: '#e9e9eb', themText: '#111111', me: '#0a84ff', meText: '#ffffff',
  inputBg: '#f1f1f3', inputText: '#111111', placeholder: '#9a9aa0', meta: '#8e8e93', dots: '120,120,128', font: 16,
};

// "[video 0:02]" or "[photo]" as a message shows a media card instead of text.
const MEDIA_RE = /^\[(video|photo)(?:\s+([\d:]+))?\]$/i;
const mediaOf = (m) => { const r = String(m.text || '').trim().match(MEDIA_RE); return r ? { kind: r[1].toLowerCase(), dur: r[2] || '0:02' } : null; };

function drawMediaCard(ctx, x, y, w, h, media, mine) {
  roundRect(ctx, x, y, w, h, 16);
  ctx.fillStyle = '#f7f7f5'; ctx.fill();
  // simple line sketch of a person, like a quick selfie note
  ctx.save();
  roundRect(ctx, x, y, w, h, 16); ctx.clip();
  ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
  const cx = x + w * 0.5, cy = y + h * 0.42;
  ctx.beginPath(); ctx.ellipse(cx, cy, w * 0.13, h * 0.2, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - w * 0.3, y + h); ctx.quadraticCurveTo(cx - w * 0.28, cy + h * 0.32, cx, cy + h * 0.3);
  ctx.quadraticCurveTo(cx + w * 0.28, cy + h * 0.32, cx + w * 0.3, y + h); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy + h * 0.06, w * 0.05, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  ctx.restore();
  if (media.kind === 'video') {
    roundRect(ctx, x + 10, y + h - 30, 46, 20, 10); ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `600 11px ${UI_FONT}`; ctx.textAlign = 'center';
    ctx.fillText(`-${media.dur}`, x + 33, y + h - 16); ctx.textAlign = 'left';
  }
}

export const someoneTyping = (data, t) => (data.messages || []).some((m) => m.from === 'them' && t < m.t && t >= m.t - TYPING_LEAD);

// Draws bubbles + input bar inside box. Shared by chat and phone.
export function drawConversation(ctx, box, data, t, th) {
  let { x, y, w, h } = box;
  const X0 = x, W0 = w;
  const msgs = data.messages || [];
  ctx.fillStyle = th.bg;
  ctx.fillRect(x, y, w, h);

  // Input bar
  const inputH = 58;
  const draft = msgs.find((m) => m.from === 'me' && t < m.t && t >= m.t - draftDuration(m.text));
  const draftText = draft ? typed(draft.text, draft.t - draftDuration(draft.text), ME_CPS, t) : '';
  const iy = y + h - inputH + 10;
  const plus = th.composer ? 40 : 0; // "+" button left of the field, mic inside it
  if (plus) {
    ctx.beginPath(); ctx.arc(x + 32, iy + 18, 16, 0, Math.PI * 2); ctx.fillStyle = th.inputBg; ctx.fill();
    ctx.strokeStyle = '#c9cbd3'; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(x + 32, iy + 11); ctx.lineTo(x + 32, iy + 25); ctx.moveTo(x + 25, iy + 18); ctx.lineTo(x + 39, iy + 18); ctx.stroke();
    x += plus; w -= plus;
  }
  roundRect(ctx, x + 14, iy, w - 28, inputH - 22, 18);
  ctx.fillStyle = th.inputBg; ctx.fill();
  if (plus) {
    roundRect(ctx, x + w - 38, iy + 9, 7, 12, 3.5); ctx.fillStyle = '#8a8d96'; ctx.fill();
    ctx.strokeStyle = '#8a8d96'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(x + w - 34.5, iy + 17, 6, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke();
  }
  ctx.font = `400 ${th.font - 1}px ${UI_FONT}`;
  if (draftText) {
    ctx.fillStyle = th.inputText;
    ctx.fillText(draftText, x + 32, iy + 24, w - 96);
    const tw = Math.min(ctx.measureText(draftText).width, w - 96);
    if (caretOn(t) || draftText.length < draft.text.length) ctx.fillRect(x + 34 + tw, iy + 9, 1.5, 18);
    ctx.beginPath(); ctx.arc(x + w - 36, iy + 18, 12, 0, Math.PI * 2);
    ctx.fillStyle = th.me; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x + w - 36, iy + 24); ctx.lineTo(x + w - 36, iy + 12);
    ctx.moveTo(x + w - 41, iy + 17); ctx.lineTo(x + w - 36, iy + 12); ctx.lineTo(x + w - 31, iy + 17); ctx.stroke();
  } else {
    ctx.fillStyle = th.placeholder;
    ctx.fillText('Message', x + 32, iy + 24);
  }

  x = X0; w = W0;
  // Bubbles grow into the layout so the list scrolls smoothly.
  const top = y + 12, bottom = y + h - inputH - 6;
  const maxBubble = Math.min(w * 0.72, 420);
  ctx.font = `400 ${th.font}px ${UI_FONT}`;
  const lineH = th.font + 6, gap = 8;
  const items = [];
  msgs.forEach((m) => {
    if (m.t > t) return;
    if (m.from === 'sep') items.push({ kind: 'sep', m, age: t - m.t });
    else if (mediaOf(m)) items.push({ kind: 'media', m, media: mediaOf(m), age: t - m.t });
    else items.push({ kind: 'msg', m, lines: wrapText(ctx, m.text, maxBubble - 28), age: t - m.t });
  });
  const pending = msgs.find((m) => m.from === 'them' && t < m.t && t >= m.t - TYPING_LEAD);
  if (pending) items.push({ kind: 'typing', m: pending, age: t - (pending.t - TYPING_LEAD) });
  const lastMine = [...items].reverse().find((it) => it.kind === 'msg' && it.m.from === 'me');
  const replyAfter = lastMine && msgs.find((m) => m.from === 'them' && m.t > lastMine.m.t && m.t - TYPING_LEAD <= t);
  items.forEach((it) => {
    it.h = it.kind === 'typing' ? 38 : it.kind === 'sep' ? 22 : it.kind === 'media' ? Math.min(170, w * 0.32) : it.lines.length * lineH + 18;
    it.receipt = it === lastMine ? 18 : 0;
    it.nameH = (it.kind === 'msg' || it.kind === 'media') && it.m.name ? 16 : 0;     // sender name above (group chats)
    it.reactH = (it.kind === 'msg' || it.kind === 'media') && it.m.react ? 12 : 0;   // emoji badge hangs below
    it.grow = EASINGS.out(clamp(it.age / 0.3, 0, 1));
  });
  const total = items.reduce((a, it) => a + (it.h + gap + it.receipt + it.nameH + it.reactH) * it.grow, 0);
  let cy = Math.min(top, bottom - total);

  ctx.save();
  ctx.beginPath(); ctx.rect(x, top - 6, w, bottom - top + 6); ctx.clip();
  for (const it of items) {
    if (it.kind === 'sep') {
      ctx.save();
      ctx.globalAlpha *= clamp(it.age / 0.3, 0, 1);
      ctx.font = `500 11px ${UI_FONT}`; ctx.fillStyle = th.meta; ctx.textAlign = 'center';
      ctx.fillText(it.m.text, x + w / 2, cy + 15);
      ctx.restore();
      ctx.font = `400 ${th.font}px ${UI_FONT}`;
      cy += (it.h + gap) * it.grow;
      continue;
    }
    if (it.nameH) {
      ctx.save();
      ctx.globalAlpha *= clamp(it.age / 0.15, 0, 1);
      ctx.font = `600 11px ${UI_FONT}`; ctx.fillStyle = colorFor(it.m.name);
      ctx.fillText(it.m.name, x + 20, cy + 11);
      ctx.restore();
      ctx.font = `400 ${th.font}px ${UI_FONT}`;
      cy += it.nameH * it.grow;
    }
    const mine = it.m.from === 'me';
    const k = EASINGS.spring(clamp(it.age / 0.5, 0, 1));
    const fade = clamp(it.age / 0.15, 0, 1);
    const bw = it.kind === 'typing' ? 64 : it.kind === 'media' ? Math.round(it.h * 1.35) : Math.max(...it.lines.map((l) => ctx.measureText(l).width)) + 28;
    const bx = mine ? x + w - 16 - bw : x + 16;
    const by = cy;
    ctx.save();
    ctx.globalAlpha *= fade;
    const rise = mine ? (1 - EASINGS.out(clamp(it.age / 0.35, 0, 1))) * 40 : 0;
    const ox = mine ? bx + bw : bx, oy = by + it.h;
    ctx.translate(ox, oy + rise); ctx.scale(0.7 + 0.3 * k, 0.7 + 0.3 * k); ctx.translate(-ox, -oy);
    if (it.kind === 'media') {
      drawMediaCard(ctx, bx, by, bw, it.h, it.media, mine);
    } else {
      roundRect(ctx, bx, by, bw, it.h, 18);
      ctx.fillStyle = mine ? th.me : th.them;
      ctx.fill();
    }
    if (it.kind === 'media') { /* drawn above */ } else if (it.kind === 'typing') {
      for (let d = 0; d < 3; d++) {
        const bounce = Math.sin(t * 7 - d * 0.9) * 0.5 + 0.5;
        ctx.beginPath();
        ctx.arc(bx + 18 + d * 14, by + it.h / 2 - bounce * 3, 4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${th.dots},${0.4 + bounce * 0.55})`;
        ctx.fill();
      }
    } else {
      ctx.fillStyle = mine ? th.meText : th.themText;
      it.lines.forEach((l, li) => ctx.fillText(l, bx + 14, by + 24 + li * lineH - (16 - th.font)));
    }
    ctx.restore();
    if (it.reactH) {
      // Reaction badge on the bubble's lower corner, pops in a moment after the message.
      const rk = EASINGS.back(clamp((it.age - 0.5) / 0.3, 0, 1));
      if (rk > 0) {
        const rx = mine ? bx + 6 : bx + bw - 22, ry = by + it.h - 4;
        ctx.save();
        ctx.translate(rx + 13, ry + 10); ctx.scale(rk, rk); ctx.translate(-rx - 13, -ry - 10);
        roundRect(ctx, rx, ry, 26, 20, 10);
        ctx.fillStyle = th.them; ctx.fill();
        ctx.strokeStyle = th.bg; ctx.lineWidth = 2; ctx.stroke();
        ctx.font = `400 12px ${UI_FONT}`; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
        ctx.fillText(it.m.react, rx + 13, ry + 14.5);
        ctx.restore();
        ctx.font = `400 ${th.font}px ${UI_FONT}`;
      }
    }
    if (it.receipt) {
      const read = replyAfter || it.age > 1.4;
      ctx.save();
      ctx.globalAlpha *= clamp((it.age - 0.4) / 0.3, 0, 1);
      ctx.font = `500 11px ${UI_FONT}`;
      ctx.fillStyle = th.meta;
      ctx.textAlign = 'right';
      ctx.fillText(read ? 'Read' : 'Delivered', x + w - 20, by + it.h + 14);
      ctx.restore();
      ctx.font = `400 ${th.font}px ${UI_FONT}`;
    }
    cy += (it.h + gap + it.receipt + it.reactH) * it.grow;
  }
  ctx.restore();
}

// ---------- Desktop chat window ----------

const sidebarWidth = (w) => Math.min(220, w * 0.3);

// Round icon button (header actions in the floating style).
function iconBtn(ctx, cx, cy, kind, color) {
  ctx.beginPath(); ctx.arc(cx, cy, 14, 0, Math.PI * 2); ctx.fillStyle = '#2a2b31'; ctx.fill();
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
  if (kind === 'search') { ctx.beginPath(); ctx.arc(cx - 1.5, cy - 1.5, 4.5, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx + 2, cy + 2); ctx.lineTo(cx + 5.5, cy + 5.5); ctx.stroke(); }
  if (kind === 'call') { ctx.beginPath(); ctx.moveTo(cx - 5, cy - 5); ctx.quadraticCurveTo(cx - 6, cy + 4, cx + 5, cy + 5); ctx.lineWidth = 3; ctx.stroke(); }
  if (kind === 'video') { roundRect(ctx, cx - 6, cy - 4, 8, 8, 2); ctx.fill(); ctx.beginPath(); ctx.moveTo(cx + 2, cy); ctx.lineTo(cx + 6, cy - 3); ctx.lineTo(cx + 6, cy + 3); ctx.fill(); }
  if (kind === 'more') for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.arc(cx + i * 4.5, cy, 1.4, 0, Math.PI * 2); ctx.fill(); }
  ctx.lineCap = 'butt';
}

// "Floating" style: the chat list and the conversation are two separate cards on the desktop.
function drawPanels(ctx, area, data, t) {
  const { x, y, w, h } = area;
  const side = Math.min(250, w * 0.34), gap = 8, R = 14;
  const msgs = data.messages || [];
  const typingNow = someoneTyping(data, t);
  const card = (cx, cw) => {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 40 * shadowScale(ctx); ctx.shadowOffsetY = 16 * shadowScale(ctx);
    roundRect(ctx, cx, y, cw, h, R); ctx.fillStyle = '#1c1d22'; ctx.fill();
    ctx.restore();
    roundRect(ctx, cx + 0.5, y + 0.5, cw - 1, h - 1, R); ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1; ctx.stroke();
  };
  // Sidebar card
  card(x, side);
  ctx.save(); roundRect(ctx, x, y, side, h, R); ctx.clip();
  ctx.font = `700 17px ${UI_FONT}`; ctx.fillStyle = '#f2f2f5'; ctx.fillText('Chats', x + 18, y + 34);
  ctx.strokeStyle = '#4c8dff'; ctx.lineWidth = 1.6; roundRect(ctx, x + side - 34, y + 20, 14, 14, 3); ctx.stroke();
  roundRect(ctx, x + 12, y + 48, side - 24, 30, 9); ctx.fillStyle = '#2a2b31'; ctx.fill();
  ctx.font = `400 13px ${UI_FONT}`; ctx.fillStyle = '#7d808a'; ctx.fillText('Search', x + 34, y + 68);
  ctx.beginPath(); ctx.arc(x + 24, y + 62, 4, 0, Math.PI * 2); ctx.strokeStyle = '#7d808a'; ctx.lineWidth = 1.4; ctx.stroke();
  const contacts = data.contacts?.length ? data.contacts : [data.contact];
  const lastVisible = [...msgs].reverse().find((m) => m.t <= t && m.from !== 'sep');
  contacts.forEach((name, i) => {
    const ry = y + 88 + i * 56;
    const active = name === data.contact;
    if (active) { roundRect(ctx, x + 6, ry, side - 12, 50, 10); ctx.fillStyle = '#232c3d'; ctx.fill(); }
    avatar(ctx, x + 32, ry + 25, 17, name, colorFor(name));
    ctx.font = `600 14px ${UI_FONT}`; ctx.fillStyle = '#f0f0f4'; ctx.fillText(name, x + 58, ry + 21, side - 110);
    ctx.font = `400 12px ${UI_FONT}`; ctx.fillStyle = active && typingNow ? '#8fb0ff' : '#8a8d96';
    ctx.fillText(active ? (typingNow ? 'typing…' : lastVisible?.text || '') : 'See you later', x + 58, ry + 38, side - 76);
    ctx.textAlign = 'right'; ctx.font = `400 11px ${UI_FONT}`; ctx.fillStyle = '#7d808a';
    ctx.fillText(active ? 'now' : ['9:12 AM', 'Tue', 'Yesterday'][i % 3], x + side - 14, ry + 21);
    ctx.textAlign = 'left';
  });
  ctx.restore();
  // Conversation card
  const cx = x + side + gap, cw = w - side - gap;
  card(cx, cw);
  ctx.save(); roundRect(ctx, cx, y, cw, h, R); ctx.clip();
  avatar(ctx, cx + 30, y + 32, 15, data.contact, colorFor(data.contact));
  ctx.font = `600 15px ${UI_FONT}`; ctx.fillStyle = '#f0f0f4'; ctx.fillText(data.contact, cx + 54, y + 37, cw - 220);
  ['search', 'call', 'video', 'more'].forEach((k, i) => iconBtn(ctx, cx + cw - 132 + i * 34, y + 32, k, k === 'more' ? '#c9cbd3' : '#4c8dff'));
  ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(cx, y + 62, cw, 1);
  drawConversation(ctx, { x: cx, y: y + 63, w: cw, h: h - 63 }, data, t, { ...DARK, bg: '#1c1d22', them: '#2c2d33', me: '#3b82f6', inputBg: '#26272d', composer: true });
  ctx.restore();
}

function draw(ctx, area, data, t) {
  if (data.style === 'panels') { drawPanels(ctx, area, data, t); return; }
  const { x, y, w, h } = area;
  const side = sidebarWidth(w);
  const msgs = data.messages || [];
  const typingNow = someoneTyping(data, t);

  ctx.fillStyle = '#1b1c21';
  ctx.fillRect(x, y, side, h);
  ctx.fillStyle = '#2a2b31';
  ctx.fillRect(x + side - 1, y, 1, h);
  ctx.font = `600 15px ${UI_FONT}`;
  ctx.fillStyle = '#e9e9ee';
  ctx.fillText('Chats', x + 18, y + 30);
  roundRect(ctx, x + 14, y + 44, side - 28, 28, 8);
  ctx.fillStyle = '#26272d'; ctx.fill();
  ctx.font = `400 13px ${UI_FONT}`;
  ctx.fillStyle = '#6f717a';
  ctx.fillText('Search', x + 26, y + 63);

  const contacts = data.contacts?.length ? data.contacts : [data.contact];
  const lastVisible = [...msgs].reverse().find((m) => m.t <= t && m.from !== 'sep');
  contacts.forEach((name, i) => {
    const ry = y + 86 + i * 58;
    const active = name === data.contact;
    if (active) { roundRect(ctx, x + 8, ry, side - 16, 52, 10); ctx.fillStyle = '#2b3550'; ctx.fill(); }
    avatar(ctx, x + 34, ry + 26, 16, name, colorFor(name));
    ctx.font = `600 14px ${UI_FONT}`;
    ctx.fillStyle = '#ececf1';
    ctx.fillText(name, x + 58, ry + 22, side - 70);
    ctx.font = `400 12px ${UI_FONT}`;
    ctx.fillStyle = active && typingNow ? '#8fb0ff' : '#7d808a';
    ctx.fillText(active ? (typingNow ? 'typing…' : lastVisible?.text || 'No messages yet') : 'See you later', x + 58, ry + 40, side - 74);
  });

  const cx = x + side, cw = w - side;
  ctx.fillStyle = '#17181c';
  ctx.fillRect(cx, y, cw, 62);
  avatar(ctx, cx + 30, y + 31, 15, data.contact, colorFor(data.contact));
  ctx.font = `600 15px ${UI_FONT}`;
  ctx.fillStyle = '#ececf1';
  ctx.fillText(data.contact, cx + 54, y + 29, cw - 80);
  ctx.font = `400 12px ${UI_FONT}`;
  ctx.fillStyle = typingNow ? '#8fb0ff' : '#6f717a';
  ctx.fillText(typingNow ? 'typing…' : 'online', cx + 54, y + 46);
  ctx.fillStyle = '#2a2b31';
  ctx.fillRect(cx, y + 61, cw, 1);
  drawConversation(ctx, { x: cx, y: y + 62, w: cw, h: h - 62 }, data, t, DARK);
}

export const messageFields = [
  { key: 'messages', type: 'script', label: 'Messages, one per line: <code>seconds me|them: text</code>', rows: 7, parse: parseChatScript, format: chatScriptToText },
  { type: 'actions', actions: [
    { label: '+ Their message here', run: (d, t) => { d.messages.push({ t: +t.toFixed(2), from: 'them', text: 'New reply' }); d.messages.sort((a, b) => a.t - b.t); } },
    { label: '+ My message here', run: (d, t) => { d.messages.push({ t: +t.toFixed(2), from: 'me', text: 'New message' }); d.messages.sort((a, b) => a.t - b.t); } },
  ] },
  { type: 'note', text: 'Their messages show typing dots first. Yours are typed into the input bar, then sent. Group chat: <code>3 them(Panda): text</code>. Reaction: end with <code>{👍}</code>. Date line: <code>5 -- Today 9:41 AM</code>. Video note: <code>6 them: [video 0:02]</code>, photo: <code>[photo]</code>.' },
];

export const app = {
  type: 'chat', label: 'Chat', group: 'Messaging', chip: 'chat', size: [760, 540], chrome: 'window',
  chromeFor: (d) => (d.style === 'panels' ? 'none' : 'window'),
  blurb: 'Desktop messenger with typing dots',
  title: (d) => `Messages: ${d.contact}`,
  defaults: (t0) => ({
    style: 'panels', contact: 'Sam', contacts: ['Sam', 'Design crew', 'Mom'],
    messages: [{ t: +(t0 + 1).toFixed(2), from: 'them', text: 'Are you there?' }, { t: +(t0 + 2.8).toFixed(2), from: 'me', text: 'Yeah, what happened?' }],
  }),
  times: ['messages.*.t'],
  regions: (area, d) => [{ key: 'contact', label: 'Contact name', rect: d?.style === 'panels'
    ? { x: area.x + Math.min(250, area.w * 0.34) + 8 + 44, y: area.y + 14, w: 200, h: 36 }
    : { x: area.x + sidebarWidth(area.w) + 44, y: area.y + 12, w: 220, h: 38 } }],
  fields: [
    { key: 'style', type: 'select', label: 'Style', options: [['panels', 'Floating panels'], ['window', 'Classic window']] },
    { key: 'contact', type: 'contact', label: 'Chatting with' },
    { key: 'contacts', type: 'list', label: 'All chats in the sidebar (comma separated)' },
    ...messageFields,
  ],
  draw,
};
