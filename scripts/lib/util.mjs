// Small I/O helpers: fetch with timeout/retry, JSON read/write, Thai-time helpers.
import fs from 'node:fs';
import path from 'node:path';

export async function fetchJson(url, { headers = {}, timeoutMs = 45000, retries = 2, method = 'GET', body } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        body,
        headers: { accept: 'application/json', 'user-agent': 'Flood_KP/1.0 (+https://github.com/chomphoo/Flood_KP)', ...headers },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${redact(url)}`);
      return await res.json();
    } catch (err) {
      lastErr = err.name === 'AbortError' ? new Error(`timeout ${timeoutMs}ms for ${redact(url)}`) : err;
      if (attempt < retries) await sleep(1500 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

const redact = (url) => String(url).replace(/(api_key|key|token)=[^&]+/gi, '$1=***');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(file, data, { pretty = false } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, pretty ? 1 : 0));
}

/** Run async tasks with limited concurrency, preserving order. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---- Time (Thailand, UTC+7, no DST) ----
const ICT_OFFSET_MS = 7 * 3600 * 1000;

/** "2026-10-03 20:00" (ICT) → ISO string with +07:00 */
export function ictToIso(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
  return m ? `${m[1]}T${m[2]}:00+07:00` : null;
}

/** Date → "YYYY-MM-DD" in ICT */
export function ictDate(d = new Date()) {
  return new Date(d.getTime() + ICT_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const round = (v, d = 2) => (v == null || Number.isNaN(+v) ? null : Math.round(+v * 10 ** d) / 10 ** d);
export const num = (v) => (v == null || v === '' || Number.isNaN(+v) ? null : +v);
