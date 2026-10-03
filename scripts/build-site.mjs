// Assemble the static site into _site/ for GitHub Pages:
//   site files (index.html, stats.html, assets/)  +  data/static  +  out/live  +  store/risk + store/stats
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, CONFIG } from './lib/config.mjs';

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
