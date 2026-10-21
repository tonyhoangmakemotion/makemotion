// Output formats. The desktop (the world windows live on) is always project.width × project.height
// (1920×1080); the format only decides the shape of the exported frame. The camera looks at the
// desktop through that frame: at zoom 1 a 9:16 frame shows a full-height vertical slice.

export const FORMATS = {
  '16:9': { w: 1920, h: 1080, label: 'Landscape', for: 'YouTube, websites' },
  '9:16': { w: 1080, h: 1920, label: 'Vertical', for: 'TikTok, Reels, Shorts' },
  '4:5': { w: 1080, h: 1350, label: 'Portrait', for: 'Instagram and Meta feed' },
  '1:1': { w: 1080, h: 1080, label: 'Square', for: 'Feeds, LinkedIn' },
};

export const formatOf = (p) => (FORMATS[p?.format] ? p.format : '16:9');

// Size of the exported frame in pixels.
export function outSize(p) {
  const f = FORMATS[formatOf(p)];
  return { W: f.w, H: f.h };
}

// Frame pixels per desktop pixel at camera zoom 1 (the frame is filled, never letterboxed).
export function viewK(p) {
  const { W, H } = outSize(p);
  return Math.max(W / p.width, H / p.height);
}

// How much of the desktop (in desktop pixels) the camera sees at a zoom.
export function viewSize(p, zoom = 1) {
  const { W, H } = outSize(p), k = viewK(p);
  return { w: W / (k * zoom), h: H / (k * zoom) };
}

// Smallest zoom the automatic camera may use. Landscape stays at 1; other shapes may pull back a
// little (into the painted wallpaper margin) so wide windows still fit.
export function minAutoZoom(p, margin = 210) {
  if (formatOf(p) === '16:9') return 1;
  const v = viewSize(p, 1);
  return Math.min(1, Math.max(v.w / (p.width + 2 * margin), v.h / (p.height + 2 * margin)));
}

// Platform safe areas for vertical video: insets as fractions of the frame (approximate; each
// app's buttons and captions sit in these margins).
export const SAFE_AREAS = {
  tiktok: { label: 'TikTok', top: 0.08, bottom: 0.24, left: 0.06, right: 0.15 },
  reels: { label: 'Instagram Reels', top: 0.12, bottom: 0.22, left: 0.06, right: 0.12 },
  shorts: { label: 'YouTube Shorts', top: 0.08, bottom: 0.2, left: 0.06, right: 0.14 },
  title: { label: 'Title safe (5%)', top: 0.05, bottom: 0.05, left: 0.05, right: 0.05 },
};
