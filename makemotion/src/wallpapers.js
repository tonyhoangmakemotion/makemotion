// Desktop wallpapers: procedural presets (no image files needed), solid colors,
// gradients and your own uploaded images. Rendered once and cached.

import { getMedia } from './media.js';

export const PAD = 260; // painted larger than the frame so camera drift, shakes and zooming out never show an edge

function rng(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function blobs(g, W, H, r, colors, count, minR, maxR, alpha = 'cc') {
  for (let i = 0; i < count; i++) {
    const x = r() * W, y = r() * H, rad = minR + r() * (maxR - minR);
    const col = colors[Math.floor(r() * colors.length)];
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, col + alpha);
    grad.addColorStop(1, col + '00');
    g.fillStyle = grad;
    g.beginPath(); g.ellipse(x, y, rad * (1 + r()), rad, r() * Math.PI, 0, Math.PI * 2); g.fill();
  }
}

function vignette(g, W, H, amount = 0.55) {
  const v = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, `rgba(0,0,0,${amount})`);
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
}

function ridge(g, W, H, r, baseY, rough, color) {
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(0, H);
  let y = baseY;
  for (let x = 0; x <= W + 40; x += 40) {
    y += (r() - 0.5) * rough;
    y = Math.min(Math.max(y, baseY - rough * 2.5), baseY + rough * 1.5);
    g.lineTo(x, y);
  }
  g.lineTo(W, H); g.closePath(); g.fill();
}

const linear = (g, x0, y0, x1, y1, stops) => {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  stops.forEach(([o, c]) => gr.addColorStop(o, c));
  return gr;
};


// Fine film grain so gradients look like real wallpapers instead of flat fills.
let grainTile = null;
function grain(g, W, H, amount) {
  if (!grainTile) {
    grainTile = new OffscreenCanvas(256, 256);
    const gg = grainTile.getContext('2d');
    const img = gg.createImageData(256, 256);
    let s = 12345;
    for (let i = 0; i < img.data.length; i += 4) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const v = (s >> 16) & 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    gg.putImageData(img, 0, 0);
  }
  g.save();
  g.globalAlpha = amount;
  g.globalCompositeOperation = 'overlay';
  g.fillStyle = g.createPattern(grainTile, 'repeat');
  g.fillRect(0, 0, W, H);
  g.restore();
}

// Stacked flowing color layers with soft shadows between them.
function flowBands(g, W, H, r, colors, shadow) {
  colors.forEach(([a, b], i) => {
    const base = H * (0.18 + i * 0.17), amp = H * (0.09 + r() * 0.07);
    const f1 = 0.8 + r() * 0.9, f2 = 1.7 + r() * 1.4, p1 = r() * 6, p2 = r() * 6, tilt = (r() - 0.5) * H * 0.25;
    const edge = (x) => base + tilt * (x / W - 0.5) - amp * Math.sin((x / W) * Math.PI * f1 + p1) - amp * 0.35 * Math.sin((x / W) * Math.PI * f2 + p2);
    g.save();
    g.shadowColor = shadow; g.shadowBlur = H * 0.06; g.shadowOffsetY = -H * 0.012;
    g.fillStyle = linear(g, 0, base - amp, W, base + H * 0.5, [[0, a], [1, b]]);
    g.beginPath(); g.moveTo(-20, H + 20);
    for (let x = -20; x <= W + 20; x += W / 90) g.lineTo(x, edge(x));
    g.lineTo(W + 20, H + 20); g.closePath(); g.fill();
    g.restore();
  });
}

export const WALLPAPERS = [
  // ---- macOS-inspired originals (in the spirit of Apple's wallpapers, not copies) ----
  {
    id: 'flow-light', label: 'Flow light', seeded: true,
    draw(g, W, H, wp) {
      const r = rng(wp.seed || 21);
      g.fillStyle = linear(g, 0, 0, W, H, [[0, '#fbefe3'], [1, '#f6d9cf']]);
      g.fillRect(0, 0, W, H);
      flowBands(g, W, H, r, [['#ffd9a8', '#ffb98c'], ['#ffa58c', '#ff7a95'], ['#f07ab8', '#c46ce6'], ['#9f78f5', '#6c74ff'], ['#4d6bf5', '#3448d6']], 'rgba(120,40,80,0.28)');
      grain(g, W, H, 0.05);
    },
  },
  {
    id: 'flow-dark', label: 'Flow dark', seeded: true,
    draw(g, W, H, wp) {
      const r = rng(wp.seed || 22);
      g.fillStyle = linear(g, 0, 0, W, H, [[0, '#090a1f'], [1, '#14112e']]);
      g.fillRect(0, 0, W, H);
      flowBands(g, W, H, r, [['#1f2a7a', '#2f3fb8'], ['#3a32a8', '#6a3fd6'], ['#7a35c9', '#b844d6'], ['#c23fa4', '#ff5c8a'], ['#ff6b5c', '#ffa06b']], 'rgba(0,0,0,0.55)');
      grain(g, W, H, 0.05);
    },
  },
  {
    id: 'petals', label: 'Petals', seeded: true,
    draw(g, W, H, wp) {
      const r = rng(wp.seed || 23);
      const bg = g.createRadialGradient(W * 0.5, H * 1.05, 0, W * 0.5, H * 1.05, H * 1.4);
      bg.addColorStop(0, '#ffb347'); bg.addColorStop(0.55, '#ff6a3d'); bg.addColorStop(1, '#c2264a');
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      const cx = W * 0.5, cy = H * 1.08;
      const n = 9;
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.24 + (r() - 0.5) * 0.06;
        const len = H * (0.95 + r() * 0.35), wid = H * (0.2 + r() * 0.08);
        g.save();
        g.translate(cx, cy); g.rotate(a + Math.PI / 2);
        g.shadowColor = 'rgba(110,20,30,0.45)'; g.shadowBlur = H * 0.05; g.shadowOffsetX = -H * 0.01;
        const pg = g.createLinearGradient(-wid, 0, wid, 0);
        pg.addColorStop(0, '#ffe08a'); pg.addColorStop(0.55, '#ff9a4a'); pg.addColorStop(1, '#e8492f');
        g.fillStyle = pg;
        g.beginPath();
        g.moveTo(0, 0);
        g.bezierCurveTo(-wid, -len * 0.35, -wid * 0.8, -len * 0.85, 0, -len);
        g.bezierCurveTo(wid * 0.8, -len * 0.85, wid, -len * 0.35, 0, 0);
        g.fill();
        g.restore();
      }
      grain(g, W, H, 0.05);
    },
  },
  {
    id: 'coast', label: 'Coast at dusk', seeded: true,
    draw(g, W, H, wp) {
      const r = rng(wp.seed || 24);
      const hz = H * 0.58;
      g.fillStyle = linear(g, 0, 0, 0, hz, [[0, '#18245c'], [0.45, '#4d4a9a'], [0.8, '#c47a9a'], [1, '#f4b08c']]);
      g.fillRect(0, 0, W, hz);
      g.fillStyle = linear(g, 0, hz, 0, H, [[0, '#4b4f8f'], [0.3, '#26306a'], [1, '#101634']]);
      g.fillRect(0, hz, W, H - hz);
      // shimmer on the water
      g.globalAlpha = 0.18;
      for (let i = 0; i < 70; i++) {
        const y = hz + Math.pow(r(), 1.6) * (H - hz), w = 20 + r() * 160 * (1 - (y - hz) / (H - hz) * 0.3);
        g.fillStyle = '#f6c3a5'; g.fillRect(W * 0.2 + r() * W * 0.5, y, w, 1.5);
      }
      g.globalAlpha = 1;
      // headlands from the right, far to near
      const layers = [['#8b84bd', 0.34, 0.55], ['#5e5a9a', 0.5, 0.5], ['#3a3a78', 0.66, 0.44], ['#1d2150', 0.82, 0.36]];
      layers.forEach(([c, startX, peak], li) => {
        const x0 = W * startX, top = H * peak, sea = hz + li * H * 0.03;
        g.fillStyle = c;
        g.beginPath();
        g.moveTo(x0 - W * 0.03, sea);
        for (let x = x0; x <= W + 20; x += W / 60) {
          const k = Math.min(1, (x - x0) / (W * 0.18));
          g.lineTo(x, sea - (sea - top) * Math.pow(k, 0.7) + (r() - 0.5) * H * 0.01);
        }
        g.lineTo(W + 20, sea); g.closePath(); g.fill();
        // soft reflection of the headland in the water
        g.save(); g.globalAlpha = 0.18; g.fillStyle = c;
        g.beginPath(); g.moveTo(x0 - W * 0.03, sea); g.lineTo(x0 + W * 0.18, sea + (sea - top) * 0.35); g.lineTo(W + 20, sea + (sea - top) * 0.35); g.lineTo(W + 20, sea); g.closePath(); g.fill();
        g.restore();
        g.fillStyle = linear(g, 0, hz - 30, 0, hz + 30, [[0, 'rgba(244,176,140,0)'], [0.5, 'rgba(244,176,140,0.18)'], [1, 'rgba(244,176,140,0)']]);
        g.fillRect(0, hz - 30, W, 60);
      });
      grain(g, W, H, 0.04);
    },
  },
  {
    id: 'island', label: 'Island', seeded: true,
    draw(g, W, H, wp) {
      const r = rng(wp.seed || 25);
      const hz = H * 0.62;
      g.fillStyle = linear(g, 0, 0, 0, hz, [[0, '#23336f'], [0.55, '#8c6fae'], [0.85, '#e39aa0'], [1, '#f6c79e']]);
      g.fillRect(0, 0, W, hz);
      g.fillStyle = linear(g, 0, hz, 0, H, [[0, '#6a6aa6'], [0.25, '#2c3a73'], [1, '#0d1534']]);
      g.fillRect(0, hz, W, H - hz);
      // island silhouette with a lit left face
      const cx = W * 0.42, base = hz + H * 0.01, iw = W * 0.34, ih = H * 0.36;
      const pts = [];
      for (let i = 0; i <= 40; i++) {
        const u = i / 40;
        const bump = Math.sin(u * Math.PI) ** 0.8 + (r() - 0.5) * 0.025 + Math.sin(u * 7 + 1) * 0.015;
        pts.push([cx - iw / 2 + u * iw, base - ih * Math.max(0, bump) * (u < 0.35 ? 1.08 : 0.94)]);
      }
      const isl = g.createLinearGradient(cx - iw / 2, 0, cx + iw / 2, 0);
      isl.addColorStop(0, '#6b5c8f'); isl.addColorStop(0.4, '#3b3466'); isl.addColorStop(1, '#1a1838');
      g.fillStyle = isl;
      g.beginPath(); g.moveTo(pts[0][0], base);
      pts.forEach(([x, y]) => g.lineTo(x, y));
      g.lineTo(pts[pts.length - 1][0], base); g.closePath(); g.fill();
      // reflection
      g.save();
      g.globalAlpha = 0.28;
      g.translate(0, base * 2); g.scale(1, -1);
      g.fillStyle = isl;
      g.beginPath(); g.moveTo(pts[0][0], base);
      pts.forEach(([x, y]) => g.lineTo(x, base + (y - base) * 0.6));
      g.lineTo(pts[pts.length - 1][0], base); g.closePath(); g.fill();
      g.restore();
      g.fillStyle = linear(g, 0, hz - 20, 0, hz + 20, [[0, 'rgba(246,199,158,0)'], [0.5, 'rgba(246,199,158,0.25)'], [1, 'rgba(246,199,158,0)']]);
      g.fillRect(0, hz - 20, W, 40);
      grain(g, W, H, 0.04);
    },
  },
  {
    id: 'dunes', label: 'Dunes', seeded: true,
    draw(g, W, H, wp) {
      const r = rng(wp.seed || 26);
      g.fillStyle = linear(g, 0, 0, 0, H * 0.6, [[0, '#f2c9a0'], [1, '#f8e2c4']]);
      g.fillRect(0, 0, W, H);
      const layers = [['#e9b98a', '#d4955f', 0.48], ['#e3a56c', '#c27740', 0.58], ['#d98f52', '#ad5f2c', 0.7], ['#c97a3e', '#8e4520', 0.84]];
      layers.forEach(([lit, shade, base], li) => {
        const peakX = W * (0.2 + r() * 0.6), amp = H * (0.08 + r() * 0.06);
        const top = (x) => H * base - amp * Math.exp(-(((x - peakX) / (W * 0.28)) ** 2)) + Math.sin(x / W * 6 + li) * H * 0.012;
        const shape = new Path2D();
        shape.moveTo(0, H);
        for (let x = 0; x <= W; x += W / 80) shape.lineTo(x, top(x));
        shape.lineTo(W, H); shape.closePath();
        g.fillStyle = linear(g, 0, H * base - amp, 0, H, [[0, lit], [1, shade]]);
        g.fill(shape);
        // Shadow side: starts at the crest and sweeps down to the right in a curve.
        g.save(); g.clip(shape);
        const sh = g.createLinearGradient(peakX, 0, peakX + W * 0.12, 0);
        sh.addColorStop(0, shade); sh.addColorStop(1, shade + 'cc');
        g.fillStyle = sh;
        g.beginPath();
        g.moveTo(peakX, top(peakX) - 2);
        g.bezierCurveTo(peakX + W * 0.04, H * base, peakX + W * 0.02, H * (base + 0.08), peakX + W * 0.1, H);
        g.lineTo(W + 10, H); g.lineTo(W + 10, top(W) - 10);
        for (let x = W; x >= peakX; x -= W / 80) g.lineTo(x, top(x) - 2);
        g.closePath(); g.fill();
        g.restore();
      });
      grain(g, W, H, 0.06);
    },
  },
  {
    id: 'hills', label: 'Rolling hills', seeded: true,
    draw(g, W, H, wp) {
      const r = rng(wp.seed || 27);
      g.fillStyle = linear(g, 0, 0, 0, H * 0.6, [[0, '#8fbbe8'], [1, '#e8f0f2']]);
      g.fillRect(0, 0, W, H);
      const cols = [['#a7bfd0', '#93acbf'], ['#9db88a', '#7fa06b'], ['#c9b45f', '#a99246'], ['#7fa35d', '#5f8445'], ['#5d8a45', '#3f6b32']];
      cols.forEach(([a, b], i) => {
        const base = H * (0.5 + i * 0.1), amp = H * (0.05 + r() * 0.04), f = 2 + r() * 2, ph = r() * 6;
        g.fillStyle = linear(g, 0, base - amp, 0, H, [[0, a], [1, b]]);
        g.beginPath(); g.moveTo(0, H);
        for (let x = 0; x <= W; x += W / 80) g.lineTo(x, base - amp * Math.sin((x / W) * Math.PI * f + ph) - amp * 0.4 * Math.sin((x / W) * Math.PI * f * 2.3 + ph));
        g.lineTo(W, H); g.closePath();
        g.save(); g.shadowColor = 'rgba(30,50,20,0.25)'; g.shadowBlur = H * 0.03; g.shadowOffsetY = -H * 0.005; g.fill(); g.restore();
      });
      grain(g, W, H, 0.04);
    },
  },
  {
    id: 'bloom', label: 'Bloom', seeded: true,
    draw(g, W, H, wp) {
      const r = rng(wp.seed || 28);
      g.fillStyle = linear(g, 0, 0, 0, H, [[0, '#05060f'], [1, '#0d0b22']]);
      g.fillRect(0, 0, W, H);
      const cx = W * 0.5, cy = H * 0.56, colors = ['#3d7bff', '#7a5cff', '#c65cff', '#ff5ca8', '#2fd3ff', '#5cffc8'];
      g.globalCompositeOperation = 'lighter';
      const n = 14;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r() * 0.2;
        const len = H * (0.32 + r() * 0.12), wid = H * 0.09;
        g.save();
        g.translate(cx, cy); g.rotate(a);
        const pg = g.createLinearGradient(0, 0, len, 0);
        const c = colors[i % colors.length];
        pg.addColorStop(0, c + '00'); pg.addColorStop(0.4, c + '88'); pg.addColorStop(1, c + '00');
        g.fillStyle = pg;
        g.beginPath(); g.ellipse(len / 2, 0, len / 2, wid, 0, 0, Math.PI * 2); g.fill();
        g.restore();
      }
      const core = g.createRadialGradient(cx, cy, 0, cx, cy, H * 0.18);
      core.addColorStop(0, 'rgba(255,255,255,0.55)'); core.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = core; g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'source-over';
      grain(g, W, H, 0.05);
    },
  },
  {
    id: 'painting', label: 'Oil painting', seeded: true,
    draw(g, W, H, wp) {
      const r = rng(wp.seed || 7);
      g.fillStyle = linear(g, 0, 0, W, H, [[0, '#2a1d14'], [0.5, '#4a3322'], [1, '#1a120d']]);
      g.fillRect(0, 0, W, H);
      g.filter = 'blur(40px)';
      blobs(g, W, H, r, ['#8a6a43', '#b38a55', '#5b4330', '#3d4a52', '#6e5a48', '#c7a46f', '#2c2219'], 70, 80, 400);
      g.filter = 'none';
      g.globalAlpha = 0.06;
      for (let i = 0; i < 500; i++) {
        g.strokeStyle = r() > 0.5 ? '#e8d3a8' : '#120c08';
        g.lineWidth = 1 + r() * 4;
        const x = r() * W, y = r() * H, len = 20 + r() * 90, a = -0.6 + r() * 0.5;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
      }
      g.globalAlpha = 1;
      vignette(g, W, H);
    },
  },
  {
    // Light classical painting: pale sky, cream clouds, warm ochre and soft flesh tones,
    // like an old master's ceiling fresco behind the windows.
    id: 'classical', label: 'Classical painting', seeded: true,
    draw(g, W, H, wp) {
      const r = rng(wp.seed || 11);
      g.fillStyle = linear(g, 0, 0, W * 0.3, H, [[0, '#c9c9bf'], [0.45, '#b2a68e'], [1, '#76644f']]);
      g.fillRect(0, 0, W, H);
      g.filter = 'blur(46px)';
      blobs(g, W, H, r, ['#e6e2d4', '#d2c4a8', '#eeeae0', '#a9b8c2', '#bfa088', '#857560', '#dcccb4', '#5f5446', '#9fb0bb'], 80, 90, 420);
      g.filter = 'blur(18px)';
      blobs(g, W, H, r, ['#f4ead6', '#dcb894', '#b28a66', '#efe2c8'], 40, 40, 160);
      g.filter = 'none';
      g.globalAlpha = 0.07;
      for (let i = 0; i < 700; i++) {
        g.strokeStyle = r() > 0.45 ? '#fff6e4' : '#4a3826';
        g.lineWidth = 1 + r() * 5;
        const x = r() * W, y = r() * H, len = 25 + r() * 110, a = -0.9 + r() * 0.8;
        g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * len * 0.5, y + Math.sin(a) * len * 0.5 - 10, x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
      }
      g.globalAlpha = 0.35;
      vignette(g, W, H);
      g.globalAlpha = 1;
    },
  },
  {
    id: 'aurora', label: 'Aurora', seeded: true,
    draw(g, W, H, wp) {
      const r = rng(wp.seed || 3);
      g.fillStyle = linear(g, 0, 0, 0, H, [[0, '#060a1f'], [1, '#0d1633']]);
      g.fillRect(0, 0, W, H);
      g.filter = 'blur(70px)';
      blobs(g, W, H, r, ['#19d3a2', '#6a5cff', '#2a7fff', '#b14cff', '#0fb5c8'], 26, 120, 420, '99');
      g.filter = 'none';
      vignette(g, W, H, 0.5);
    },
  },
  {
    id: 'sunset', label: 'Sunset hills', hidden: true,
    draw(g, W, H, wp) {
      const r = rng(wp.seed || 5);
      g.fillStyle = linear(g, 0, 0, 0, H, [[0, '#2b1055'], [0.45, '#d53369'], [0.75, '#f9a03f'], [1, '#ffd29b']]);
      g.fillRect(0, 0, W, H);
      const sx = W * 0.62, sy = H * 0.6;
      const glow = g.createRadialGradient(sx, sy, 0, sx, sy, H * 0.45);
      glow.addColorStop(0, 'rgba(255,230,180,0.95)'); glow.addColorStop(0.15, 'rgba(255,200,140,0.6)'); glow.addColorStop(1, 'rgba(255,160,90,0)');
      g.fillStyle = glow; g.fillRect(0, 0, W, H);
      ['#a8336a', '#7a2459', '#4d1847', '#2a0f33'].forEach((c, i) => ridge(g, W, H, r, H * (0.62 + i * 0.09), 34 - i * 4, c));
    },
  },
  {
    id: 'mountains', label: 'Misty mountains', hidden: true,
    draw(g, W, H, wp) {
      const r = rng(wp.seed || 11);
      g.fillStyle = linear(g, 0, 0, 0, H, [[0, '#9fb7c9'], [0.6, '#dfe6ea'], [1, '#eef1f2']]);
      g.fillRect(0, 0, W, H);
      ['#a9b8c4', '#8b9cab', '#6b7d8f', '#4c5d70', '#2f3d4e'].forEach((c, i) => {
        ridge(g, W, H, r, H * (0.42 + i * 0.11), 70 - i * 9, c);
        const mist = linear(g, 0, H * (0.42 + i * 0.11) - 40, 0, H * (0.42 + i * 0.11) + 120, [[0, 'rgba(238,241,242,0)'], [1, 'rgba(238,241,242,0.35)']]);
        g.fillStyle = mist; g.fillRect(0, 0, W, H);
      });
    },
  },
  {
    id: 'waves', label: 'Color waves', hidden: true,
    draw(g, W, H) {
      g.fillStyle = linear(g, 0, 0, W, H, [[0, '#1b0f3b'], [1, '#3a1450']]);
      g.fillRect(0, 0, W, H);
      const bands = [['#ff7a59', '#ffb36b'], ['#ff4f8b', '#ff8a9a'], ['#8a5cff', '#c06bff'], ['#3d7bff', '#6ac8ff']];
      g.filter = 'blur(6px)';
      bands.forEach(([a, b], i) => {
        const y0 = H * (0.25 + i * 0.16);
        g.fillStyle = linear(g, 0, y0 - 200, W, y0 + 200, [[0, a], [1, b]]);
        g.beginPath();
        g.moveTo(-50, y0 + 120);
        g.bezierCurveTo(W * 0.3, y0 - 260 + i * 40, W * 0.6, y0 + 260 - i * 30, W + 50, y0 - 80);
        g.lineTo(W + 50, H + 50); g.lineTo(-50, H + 50); g.closePath();
        g.globalAlpha = 0.85; g.fill(); g.globalAlpha = 1;
      });
      g.filter = 'none';
      vignette(g, W, H, 0.35);
    },
  },
  {
    id: 'midnight', label: 'Midnight stars', seeded: true,
    draw(g, W, H, wp) {
      const r = rng(wp.seed || 9);
      g.fillStyle = linear(g, 0, 0, W, H, [[0, '#04060f'], [1, '#101a3a']]);
      g.fillRect(0, 0, W, H);
      g.filter = 'blur(80px)';
      blobs(g, W, H, r, ['#2b3d8f', '#5a2b7a', '#1f5f8f'], 8, 200, 500, '66');
      g.filter = 'none';
      for (let i = 0; i < 420; i++) {
        const s = r() * 1.8 + 0.3;
        g.fillStyle = `rgba(255,255,255,${0.25 + r() * 0.75})`;
        g.beginPath(); g.arc(r() * W, r() * H, s, 0, Math.PI * 2); g.fill();
      }
    },
  },
  {
    id: 'grid', label: 'Neon grid', hidden: true,
    draw(g, W, H) {
      g.fillStyle = linear(g, 0, 0, 0, H, [[0, '#07060d'], [0.55, '#1a0b2e'], [1, '#07060d']]);
      g.fillRect(0, 0, W, H);
      const hy = H * 0.55;
      const glow = g.createRadialGradient(W / 2, hy, 0, W / 2, hy, W * 0.5);
      glow.addColorStop(0, 'rgba(255,60,200,0.45)'); glow.addColorStop(1, 'rgba(255,60,200,0)');
      g.fillStyle = glow; g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(80,220,255,0.55)'; g.lineWidth = 2;
      for (let i = -24; i <= 24; i++) { g.beginPath(); g.moveTo(W / 2, hy); g.lineTo(W / 2 + i * W * 0.12, H); g.stroke(); }
      for (let k = 1; k < 16; k++) { const y = hy + (H - hy) * Math.pow(k / 15, 2.2); g.globalAlpha = 0.3 + 0.7 * (k / 15); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
      g.globalAlpha = 1;
    },
  },
  {
    id: 'paper', label: 'Warm paper', hidden: true,
    draw(g, W, H, wp) {
      const r = rng(wp.seed || 2);
      g.fillStyle = '#e9e1d3'; g.fillRect(0, 0, W, H);
      g.globalAlpha = 0.05;
      for (let i = 0; i < 9000; i++) { g.fillStyle = r() > 0.5 ? '#000' : '#fff'; g.fillRect(r() * W, r() * H, 2, 2); }
      g.globalAlpha = 1;
      vignette(g, W, H, 0.18);
    },
  },
  {
    id: 'studio-glow', label: 'Studio glow',
    draw(g, W, H, wp) {
      g.fillStyle = '#050506'; g.fillRect(0, 0, W, H);
      const c = wp.color1 && wp.color1 !== '#1d2433' ? wp.color1 : '#2ee66b';
      const r = g.createRadialGradient(W * 0.5, H * 0.7, 0, W * 0.5, H * 0.7, H * 0.65);
      r.addColorStop(0, c + '30'); r.addColorStop(0.5, c + '0c'); r.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = r; g.fillRect(0, 0, W, H);
    },
  },
  {
    id: 'studio-paper', label: 'Studio paper',
    draw(g, W, H) {
      g.fillStyle = linear(g, 0, 0, 0, H, [[0, '#f1eee9'], [1, '#ebe6df']]); g.fillRect(0, 0, W, H);
      grain(g, W, H, 0.025);
    },
  },
  {
    id: 'solid', label: 'Solid color',
    draw(g, W, H, wp) { g.fillStyle = wp.color1 || '#1d2433'; g.fillRect(0, 0, W, H); },
  },
  {
    id: 'gradient', label: 'Gradient',
    draw(g, W, H, wp) {
      g.fillStyle = linear(g, 0, 0, W, H, [[0, wp.color1 || '#3a1c71'], [1, wp.color2 || '#ffaf7b']]);
      g.fillRect(0, 0, W, H);
    },
  },
];
export const WALLPAPER_BY_ID = Object.fromEntries(WALLPAPERS.map((w) => [w.id, w]));

function drawImageWallpaper(g, W, H, wp) {
  const m = getMedia(wp.mediaId);
  const el = m?.el;
  g.fillStyle = '#111'; g.fillRect(0, 0, W, H);
  if (!el) return false;
  const iw = el.videoWidth || el.naturalWidth, ih = el.videoHeight || el.naturalHeight;
  if (!iw || !ih) return false;
  const s = Math.max(W / iw, H / ih);
  g.drawImage(el, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s);
  return true;
}

// Draw a wallpaper into a context of size W x H (used for the cache and for thumbnails).
export function paintWallpaper(g, W, H, wp) {
  let ready = true;
  if (wp.kind === 'image') ready = drawImageWallpaper(g, W, H, wp);
  else (WALLPAPER_BY_ID[wp.kind] || WALLPAPERS[0]).draw(g, W, H, wp);
  if (wp.blur > 0) {
    // Blur by redrawing the result through a filter.
    const c2 = new OffscreenCanvas(W, H);
    const g2 = c2.getContext('2d');
    g2.filter = `blur(${wp.blur}px)`;
    g2.drawImage(g.canvas, 0, 0);
    g.clearRect(0, 0, W, H);
    g.drawImage(c2, 0, 0);
  }
  if (wp.dim > 0) { g.fillStyle = `rgba(0,0,0,${wp.dim})`; g.fillRect(0, 0, W, H); }
  return ready;
}

const cache = new Map();

export function getWallpaper(project) {
  const wp = project.wallpaper;
  const key = JSON.stringify([wp, project.width, project.height]);
  const hit = cache.get(key);
  if (hit) return hit;
  const W = project.width + PAD * 2, H = project.height + PAD * 2;
  const c = new OffscreenCanvas(W, H);
  const ready = paintWallpaper(c.getContext('2d'), W, H, wp);
  const entry = { canvas: c, pad: PAD };
  if (ready) {
    if (cache.size > 6) cache.delete(cache.keys().next().value);
    cache.set(key, entry);
  }
  return entry;
}

// Small preview image for the wallpaper picker.
const thumbs = new Map();
export function wallpaperThumb(wp, w = 160, h = 90) {
  const key = JSON.stringify(wp);
  if (thumbs.has(key)) return thumbs.get(key);
  // Paint at a moderate size so blur sizes look right, then scale down.
  const BW = 640, BH = 360;
  const big = document.createElement('canvas');
  big.width = BW; big.height = BH;
  const ready = paintWallpaper(big.getContext('2d'), BW, BH, { ...wp, blur: (wp.blur || 0) / 3 });
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(big, 0, 0, w, h);
  const url = c.toDataURL('image/jpeg', 0.8);
  if (ready) thumbs.set(key, url);
  return url;
}
