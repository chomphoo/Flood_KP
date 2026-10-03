// Tiny static server for local preview of _site/ (no dependencies).  Usage: npm run serve  → http://localhost:8080
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from './lib/config.mjs';

const PORT = +process.env.PORT || 8080;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.geojson': 'application/geo+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};

http
  .createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.join(CONFIG.dirs.site, url);
    if (!file.startsWith(CONFIG.dirs.site)) return res.writeHead(403).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('404');
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, () => console.log(`Preview: http://localhost:${PORT}/`));
