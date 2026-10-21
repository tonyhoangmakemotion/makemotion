// Video call grid: tiles for each person, speaking highlights, call timer.

import { roundRect, UI_FONT, drawCover, placeholderPerson, getMediaSafe, hueFor, parseTimed, timedToText } from './draw.js';

function layout(n, w, h) {
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  return { cols, rows, tw: w / cols, th: h / rows };
}

function draw(ctx, area, d, t, env) {
  const { x, y, w, h } = area;
  ctx.fillStyle = '#121316';
  ctx.fillRect(x, y, w, h);
  const people = d.people?.length ? d.people : ['You'];
  const barH = 64, pad = 10;
  const L = layout(people.length, w - pad, h - barH - pad);
  const speaking = (d.speakers || []).filter((s) => s.t <= t).pop()?.text;
  const myLevel = env.voiceLevel(t);
  people.forEach((name, i) => {
    const tx = x + pad + (i % L.cols) * L.tw, ty = y + pad + Math.floor(i / L.cols) * L.th;
    const tw = L.tw - pad, th = L.th - pad;
    ctx.save();
    roundRect(ctx, tx, ty, tw, th, 12);
    ctx.clip();
    const mediaId = i === 0 ? d.selfMedia : (d.otherMedia || [])[i - 1];
    const m = getMediaSafe(mediaId);
    if (m?.el) { ctx.fillStyle = '#000'; ctx.fillRect(tx, ty, tw, th); drawCover(ctx, m.el, tx, ty, tw, th, { mirror: i === 0 }); }
    else placeholderPerson(ctx, tx, ty, tw, th, '', hueFor(name), t);
    ctx.restore();
    const talking = speaking === name || (i === 0 && myLevel > 0.05);
    if (talking) {
      roundRect(ctx, tx + 1.5, ty + 1.5, tw - 3, th - 3, 12);
      ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 3; ctx.stroke();
    }
    ctx.font = `500 13px ${UI_FONT}`;
    const lw = ctx.measureText(name).width + 34;
    roundRect(ctx, tx + 10, ty + th - 36, lw, 26, 8);
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(name, tx + 34, ty + th - 18);
    // mic icon with level bars
    ctx.fillStyle = talking ? '#4ade80' : '#c9c9cf';
    for (let b = 0; b < 3; b++) {
      const lv = talking ? 0.3 + 0.7 * Math.abs(Math.sin(t * 9 + b * 1.7)) : 0.3;
      ctx.fillRect(tx + 18 + b * 4, ty + th - 18 - 10 * lv, 2.5, 10 * lv);
    }
  });
  // Control bar
  const by = y + h - barH;
  ctx.fillStyle = '#18191d';
  ctx.fillRect(x, by, w, barH);
  const el = Math.max(0, t - (d.startAt ?? 0)) + (d.timerOffset || 0);
  ctx.font = `500 14px ${UI_FONT}`;
  ctx.fillStyle = '#d6d7dc';
  ctx.fillText(`${String(Math.floor(el / 60)).padStart(2, '0')}:${String(Math.floor(el % 60)).padStart(2, '0')}  |  ${d.room || 'Team sync'}`, x + 20, by + 38);
  const icons = ['#2c2e34', '#2c2e34', '#2c2e34', '#e5484d'];
  icons.forEach((c, i) => {
    const cx = x + w / 2 - 78 + i * 52;
    ctx.beginPath(); ctx.arc(cx, by + barH / 2, 20, 0, Math.PI * 2);
    ctx.fillStyle = c; ctx.fill();
    ctx.fillStyle = '#fff';
    if (i === 3) { roundRect(ctx, cx - 11, by + barH / 2 - 4, 22, 8, 4); ctx.fill(); }
    else if (i === 0) { roundRect(ctx, cx - 4, by + barH / 2 - 9, 8, 13, 4); ctx.fill(); }
    else if (i === 1) { roundRect(ctx, cx - 10, by + barH / 2 - 6, 14, 12, 3); ctx.fill(); ctx.beginPath(); ctx.moveTo(cx + 5, by + barH / 2); ctx.lineTo(cx + 11, by + barH / 2 - 5); ctx.lineTo(cx + 11, by + barH / 2 + 5); ctx.fill(); }
    else { ctx.fillRect(cx - 9, by + barH / 2 - 7, 18, 12); }
  });
}

export const app = {
  type: 'videocall', label: 'Video call', group: 'Media', chip: 'call', size: [960, 600], chrome: 'window',
  blurb: 'Call grid with speaking highlights',
  title: (d) => `${d.room} - Call`,
  defaults: (t0) => ({
    room: 'Team sync', people: ['You', 'Lena', 'Jonas', 'Mara'], selfMedia: null, otherMedia: [],
    startAt: +t0.toFixed(2), timerOffset: 754,
    speakers: [{ t: +(t0 + 0.5).toFixed(2), text: 'Lena' }, { t: +(t0 + 3).toFixed(2), text: 'Jonas' }],
  }),
  times: ['startAt', 'speakers.*.t'],
  fields: [
    { key: 'room', type: 'text', label: 'Call name' },
    { key: 'people', type: 'list', label: 'People (comma separated, first is you)' },
    { key: 'selfMedia', type: 'media', accept: 'image,video', label: 'Your camera (photo or video)' },
    { key: 'speakers', type: 'script', label: 'Who speaks when: <code>seconds name</code>', rows: 4, parse: parseTimed, format: timedToText },
    { key: 'timerOffset', type: 'number', label: 'Call timer starts at (seconds)', min: 0, max: 36000 },
    { type: 'note', text: 'Your tile glows while your voiceover plays.' },
  ],
  draw,
};
