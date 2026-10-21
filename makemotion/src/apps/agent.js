// AI coding agent in a terminal: your prompts are typed into the input box, the agent
// answers with bullets, tool calls and results, and "thinks" in between.
// Script lines:  seconds > prompt   · seconds * reply   · seconds + Tool(args)
//                seconds | result   · seconds ! error    · seconds ~ code line

import { MONO_FONT, caretOn, typed, typingDuration, roundRect } from './draw.js';

const KINDS = { '>': 'you', '*': 'say', '+': 'tool', '|': 'result', '!': 'error', '~': 'code' };
const SYMBOL = { you: '>', say: '*', tool: '+', result: '|', error: '!', code: '~' };
const CPS = 18;
const draftTime = (text) => typingDuration(text, CPS) + 0.35;

export function parseAgent(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const m = line.match(/^\s*(\d+(?:\.\d+)?)\s+([>*+|!~])\s?(.*)$/);
    if (m) out.push({ t: parseFloat(m[1]), kind: KINDS[m[2]], text: m[3] });
  }
  return out.sort((a, b) => a.t - b.t);
}
const agentToText = (ls) => ls.map((l) => `${+l.t.toFixed(2)} ${SYMBOL[l.kind] || '*'} ${l.text}`).join('\n');

const SPIN = ['✻', '✶', '✳', '✢', '·', '✢', '✳', '✶'];

function draw(ctx, area, d, t) {
  const { x, y, w, h } = area;
  const fs = d.fontSize || 15, lh = Math.round(fs * 1.6);
  ctx.fillStyle = '#191919';
  ctx.fillRect(x, y, w, h);
  ctx.font = `400 ${fs}px ${MONO_FONT}`;
  const padX = 22;
  const lines = d.lines || [];

  // What is visible: everything up to t; prompts appear once they have been typed and sent.
  const rows = [];
  for (const l of lines) if (l.t <= t) rows.push(l);
  const draft = lines.find((l) => l.kind === 'you' && t < l.t && t >= l.t - draftTime(l.text));
  const lastShown = rows[rows.length - 1];
  const next = lines.find((l) => l.t > t);
  // The agent is "thinking" after your prompt until its next line arrives.
  const thinking = lastShown && lastShown.kind !== 'say' && lastShown.kind !== 'error' && next && next.kind !== 'you' && !draft;

  // Layout bottom-up: footer, input box, then the transcript above it.
  const footerY = y + h - 16;
  const boxH = lh + 18, boxY = footerY - 22 - boxH;
  ctx.fillStyle = '#8b8b8b';
  ctx.font = `400 ${Math.round(fs * 0.85)}px ${MONO_FONT}`;
  ctx.fillText('? for shortcuts', x + padX, footerY);
  ctx.textAlign = 'right';
  ctx.fillText(d.footer || 'Thinking off (tab to toggle)', x + w - padX, footerY);
  ctx.textAlign = 'left';
  ctx.font = `400 ${fs}px ${MONO_FONT}`;
  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(x + padX - 8, boxY, w - padX * 2 + 16, 1);
  ctx.fillRect(x + padX - 8, boxY + boxH, w - padX * 2 + 16, 1);
  const draftText = draft ? typed(draft.text, draft.t - draftTime(draft.text), CPS, t) : '';
  ctx.fillStyle = '#e8e8e8';
  ctx.fillText('>', x + padX, boxY + boxH / 2 + fs * 0.35);
  const inputX = x + padX + fs * 1.3;
  if (draftText || !d.placeholder) ctx.fillText(draftText, inputX, boxY + boxH / 2 + fs * 0.35, w - padX * 2 - fs * 2);
  else { ctx.fillStyle = '#6b6b6b'; ctx.fillText(d.placeholder, inputX, boxY + boxH / 2 + fs * 0.35, w - padX * 2 - fs * 2); }
  if (draft || caretOn(t)) {
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(inputX + ctx.measureText(draftText).width + 1, boxY + boxH / 2 - fs * 0.6, fs * 0.55, fs * 1.15);
  }

  // Transcript rows (each with its own height), newest at the bottom.
  const items = rows.map((l) => ({ l, h: l.kind === 'you' ? lh + 10 : lh, gapBefore: l.kind === 'you' || l.kind === 'say' || l.kind === 'tool' ? lh * 0.55 : 0 }));
  if (thinking) items.push({ think: true, h: lh, gapBefore: lh * 0.55 });
  let cy = boxY - 14;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, boxY - y - 6); ctx.clip();
  for (let i = items.length - 1; i >= 0 && cy > y; i--) {
    const it = items[i];
    const top = cy - it.h;
    const base = top + it.h / 2 + fs * 0.35;
    const age = it.think ? 1 : t - it.l.t;
    ctx.globalAlpha = Math.min(1, age / 0.12);
    if (it.think) {
      const k = Math.floor(t * 10) % SPIN.length;
      ctx.fillStyle = '#d97757';
      ctx.fillText(`${SPIN[k]} ${d.thinkingWord || 'Thinking'}… `, x + padX, base);
      ctx.fillStyle = '#8b8b8b';
      const tw = ctx.measureText(`${SPIN[k]} ${d.thinkingWord || 'Thinking'}… `).width;
      ctx.fillText('(esc to interrupt)', x + padX + tw, base);
    } else {
      const { kind, text } = it.l;
      const tx = x + padX + fs * 1.3;
      const maxW = w - padX * 2 - fs * 1.3;
      if (kind === 'you') {
        roundRect(ctx, x + padX - 6, top + 2, Math.min(w - padX * 2 + 12, ctx.measureText(`> ${text}`).width + 18), it.h - 4, 3);
        ctx.fillStyle = '#373737'; ctx.fill();
        ctx.fillStyle = '#d0d0d0';
        ctx.fillText(`> ${text}`, x + padX + 2, base, w - padX * 2);
      } else if (kind === 'say') {
        ctx.fillStyle = '#e8e8e8';
        ctx.fillText('●', x + padX, base);
        ctx.fillText(text, tx, base, maxW);
      } else if (kind === 'tool') {
        ctx.fillStyle = '#4ec97a';
        ctx.fillText('●', x + padX, base);
        const m = text.match(/^([\w.]+)(\(.*)?$/);
        ctx.font = `700 ${fs}px ${MONO_FONT}`;
        ctx.fillStyle = '#f0f0f0';
        const name = m ? m[1] : text;
        ctx.fillText(name, tx, base);
        const nw = ctx.measureText(name).width;
        ctx.font = `400 ${fs}px ${MONO_FONT}`;
        if (m?.[2]) { ctx.fillStyle = '#bdbdbd'; ctx.fillText(m[2], tx + nw, base, maxW - nw); }
      } else if (kind === 'result') {
        ctx.fillStyle = '#8b8b8b';
        ctx.fillText(`⎿  ${text}`, tx, base, maxW);
      } else if (kind === 'error') {
        ctx.fillStyle = '#8b8b8b';
        ctx.fillText('⎿', tx, base);
        ctx.fillStyle = '#e5534b';
        ctx.fillText(text, tx + fs * 1.8, base, maxW - fs * 1.8);
      } else if (kind === 'code') {
        ctx.fillStyle = '#9cdcfe';
        ctx.fillText(text, tx + fs * 2.2, base, maxW - fs * 2.2);
      }
    }
    ctx.globalAlpha = 1;
    cy = top - it.gapBefore;
  }
  ctx.restore();
}

export const app = {
  type: 'agent', label: 'AI agent terminal', group: 'Work', chip: 'ai', size: [860, 560], chrome: 'window',
  blurb: 'Prompts, thinking, tool calls',
  title: (d) => d.title,
  defaults: (t0) => ({
    title: '~/projects/game: agent', placeholder: 'Try "edit <filepath> to …"', thinkingWord: 'Thinking', fontSize: 15,
    lines: parseAgent([
      `${(t0 + 2.4).toFixed(1)} > fix the lag, and fix the login issue`,
      `${(t0 + 4.2).toFixed(1)} + Read(src/login.js)`,
      `${(t0 + 4.5).toFixed(1)} | Read 212 lines`,
      `${(t0 + 5.6).toFixed(1)} + Update(src/game/loop.ts)`,
      `${(t0 + 5.9).toFixed(1)} | Updated 14 lines`,
      `${(t0 + 7.0).toFixed(1)} * Done. Frame time is down from 34ms to 9ms and login works again.`,
    ].join('\n')),
  }),
  times: ['lines.*.t'],
  fields: [
    { key: 'lines', type: 'script', mono: true, rows: 9, parse: parseAgent, format: agentToText,
      label: 'Transcript: <code>s &gt; prompt</code> <code>s * reply</code> <code>s + Tool(args)</code> <code>s | result</code> <code>s ! error</code> <code>s ~ code</code>' },
    { key: 'placeholder', type: 'text', label: 'Input placeholder' },
    { key: 'thinkingWord', type: 'text', label: 'Thinking word' },
    { key: 'fontSize', type: 'number', label: 'Text size', min: 10, max: 28 },
    { type: 'note', text: 'Your prompts are typed into the box first, then sent. Between your prompt and the next reply, the agent shows a thinking spinner.' },
  ],
  draw,
};
