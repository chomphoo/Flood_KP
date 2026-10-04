// Rasterise assets/icon.svg's shapes into PNG app icons (no dependencies).
// Run once: node scripts/tools/make-icons.mjs  → assets/icons/*.png
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ROOT } from '../lib/config.mjs';

const OUT = path.join(ROOT, 'assets', 'icons');
fs.mkdirSync(OUT, { recursive: true });

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const STOPS = [[0, hex('#2dd4bf')], [0.55, hex('#38bdf8')], [1, hex('#818cf8')]];
const grad = (t) => {
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i][0]) return lerp(STOPS[i - 1][1], STOPS[i][1], (t - STOPS[i - 1][0]) / (STOPS[i][0] - STOPS[i - 1][0]));
  }
  return STOPS.at(-1)[1];
};

const inRRect = (x, y, x0, y0, w, h, r) => {
  if (x < x0 || y < y0 || x > x0 + w || y > y0 + h) return false;
  const cx = Math.min(Math.max(x, x0 + r), x0 + w - r);
  const cy = Math.min(Math.max(y, y0 + r), y0 + h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const cubic = (p0, p1, p2, p3, n = 40) => Array.from({ length: n + 1 }, (_, i) => {
  const t = i / n;
  const u = 1 - t;
  return [0, 1].map((k) => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]);
});
// Drop outline
const drop = [
  ...cubic([256, 116], [212, 186], [144, 240], [144, 310]),
  ...Array.from({ length: 61 }, (_, i) => {
    const a = Math.PI - (i / 60) * Math.PI; // 180° → 0° through the bottom
    return [256 + 112 * Math.cos(a), 310 + 112 * Math.sin(a)];
  }),
  ...cubic([368, 310], [368, 240], [324, 186], [256, 116]),
];
const inPoly = (x, y, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const wave = [...cubic([190, 330], [212, 344], [234, 344], [256, 330]), ...cubic([256, 330], [278, 316], [300, 316], [322, 330])];
const distSeg = (x, y, [ax, ay], [bx, by]) => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
};
const nearWave = (x, y) => wave.some((p, i) => i && distSeg(x, y, wave[i - 1], p) <= 9);

/** Colour at a point in the 512 design space; null = transparent. */
function sample(x, y, maskable) {
  let c = null;
  if (maskable ? true : inRRect(x, y, 0, 0, 512, 512, 112)) c = hex('#060a13');
  // maskable: shrink the artwork into the 80% safe zone
  const s = maskable ? 0.78 : 1;
  const X = (x - 256) / s + 256;
  const Y = (y - 256) / s + 256;
  if (inRRect(X, Y, 56, 56, 400, 400, 96)) c = grad((X + Y - 112) / 800);
  if (inPoly(X, Y, drop)) c = hex('#062a26');
  if (nearWave(X, Y)) c = hex('#2dd4bf');
  return c;
}

function render(size, maskable) {
  const SS = 4;
  const px = Buffer.alloc(size * (size * 4 + 1));
  for (let j = 0; j < size; j++) {
    px[j * (size * 4 + 1)] = 0;
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample(((i + (sx + 0.5) / SS) / size) * 512, ((j + (sy + 0.5) / SS) / size) * 512, maskable);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
        }
      }
      const o = j * (size * 4 + 1) + 1 + i * 4;
      px[o] = a ? r / a : 0; px[o + 1] = a ? g / a : 0; px[o + 2] = a ? b / a : 0; px[o + 3] = (a / (SS * SS)) * 255;
    }
  }
  return png(size, size, px);
}

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

for (const [name, size, maskable] of [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-maskable-512.png', 512, true], ['apple-touch-icon.png', 180, true]]) {
  fs.writeFileSync(path.join(OUT, name), render(size, maskable));
  console.log('wrote', name);
}
