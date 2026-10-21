// Registry of every window type. Each app module exports an `app` object:
// { type, label, group, chip, size, chrome: 'window'|'browser'|'none', blurb,
//   title(data, t), defaults(t0), times[], regions?(area, data), fields[], draw(ctx, area, data, t, env) }

import { app as chat } from './chat.js';
import { app as phone } from './phone.js';
import { app as notification } from './notification.js';
import { app as email } from './email.js';
import { app as code } from './code.js';
import { app as terminal } from './terminal.js';
import { app as notes } from './notes.js';
import { app as files } from './files.js';
import { app as browser } from './browser.js';
import { app as map } from './map.js';
import { app as facecam } from './facecam.js';
import { app as videocall } from './videocall.js';
import { photoApp, videoApp } from './photo.js';
import { app as dashboard } from './dashboard.js';
import { app as social } from './social.js';
import { app as board } from './board.js';
import { titleApp, endcardApp, statApp, calloutApp, integrationsApp } from './launch.js';
import { app as agent } from './agent.js';
import { app as prompt } from './prompt.js';
import { sentenceApp, logoRevealApp } from './motion.js';
import { spotlightApp, metricsApp, wipeApp } from './motion2.js';
import { app as game } from './game.js';
import { app as sketch } from './sketch.js';
import { app as streak } from './streak.js';

export const APP_LIST = [
  titleApp, sentenceApp, logoRevealApp, spotlightApp, metricsApp, wipeApp, prompt, statApp, calloutApp, dashboard, integrationsApp, endcardApp,
  chat, phone, notification, email, code, agent, terminal, notes, files, board, browser, map, social, facecam, videocall, photoApp, videoApp, game, sketch, streak,
];
export const APPS = Object.fromEntries(APP_LIST.map((a) => [a.type, a]));
export const GROUPS = ['Launch', 'Messaging', 'Work', 'Web', 'Media'];

export const chromeOf = (layer) => APPS[layer.type]?.chromeFor?.(layer.data) ?? APPS[layer.type]?.chrome ?? 'window';
