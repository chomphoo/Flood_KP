// Assemble the static site into _site/ for GitHub Pages:
//   site files (index.html, stats.html, assets/)  +  data/static  +  out/live  +  store/risk + store/stats
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, CONFIG } from './lib/config.mjs';
import { packGeo } from './lib/pack.mjs';

const SITE = CONFIG.dirs.site;
fs.rmSync(SITE, { recursive: true, force: true });
fs.mkdirSync(SITE, { recursive: true });

const copy = (src, dest) => {
  if (!fs.existsSync(src)) return console.warn(`[site] missing (skipped): ${path.relative(ROOT, src)}`);
  fs.cpSync(src, dest, { recursive: true });
};

for (const f of ['index.html', 'stats.html', 'about.html', '404.html', 'robots.txt', 'manifest.webmanifest']) copy(path.join(ROOT, f), path.join(SITE, f));
copy(path.join(ROOT, 'assets'), path.join(SITE, 'assets'));
copy(CONFIG.dirs.static, path.join(SITE, 'data', 'static'));
copy(CONFIG.dirs.out, path.join(SITE, 'data', 'live'));
copy(path.join(CONFIG.dirs.store, 'risk'), path.join(SITE, 'data', 'risk'));
copy(path.join(CONFIG.dirs.store, 'stats'), path.join(SITE, 'data', 'stats'));
fs.writeFileSync(path.join(SITE, '.nojekyll'), '');

// Service worker: stamp a build id so each deployment refreshes the app-shell cache.
const swSrc = path.join(ROOT, 'sw.js');
if (fs.existsSync(swSrc)) {
  const buildId = new Date().toISOString().replace(/\D/g, '').slice(0, 12);
  fs.writeFileSync(path.join(SITE, 'sw.js'), fs.readFileSync(swSrc, 'utf8').replaceAll('__BUILD__', buildId));
}

// Packed copies of the large hexagon layers (originals stay: build-live reuses them between runs).
const packJobs = [
  ...['3days', '7days', '30days'].map((p) => [path.join(SITE, 'data', 'live', `flood_${p}.geojson`), 1e4]),
  [path.join(SITE, 'data', 'risk', 'freq_hex.geojson'), 1e5],
];
for (const [src, scale] of packJobs) {
  if (!fs.existsSync(src)) continue;
  const packed = packGeo(JSON.parse(fs.readFileSync(src, 'utf8')), scale);
  if (!packed) continue;
  const dest = src.replace(/\.geojson$/, '.pack.json');
  fs.writeFileSync(dest, JSON.stringify(packed));
  console.log(`[site] packed ${path.basename(src)}: ${(fs.statSync(src).size / 1024).toFixed(0)} KB → ${(fs.statSync(dest).size / 1024).toFixed(0)} KB`);
}

let files = 0;
let bytes = 0;
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else {
      files++;
      bytes += fs.statSync(p).size;
    }
  }
})(SITE);
console.log(`[site] _site ready: ${files} files, ${(bytes / 1048576).toFixed(1)} MB`);
