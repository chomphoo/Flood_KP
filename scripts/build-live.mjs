// Main live pipeline (runs every 30 min on GitHub Actions):
// fetch all sources → normalise → status + feed → write out/live/*.json
// Each source is isolated: if it fails (or is not due yet) we reuse the previously published file,
// so one broken upstream API never takes the whole site down.
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG, SECRETS } from './lib/config.mjs';
import { readJson, writeJson, fetchJson } from './lib/util.mjs';
import { provinceStatus, LEVELS } from './lib/levels.mjs';
import { buildConditions, diffConditions, mergeTimeline, summariseRain } from './lib/feed.mjs';
import { fetchThaiWater, compactSeries } from './sources/thaiwater.mjs';
import { fetchGistdaFlood, FLOOD_PERIODS } from './sources/gistda.mjs';
import { fetchGlofas } from './sources/glofas.mjs';
import { fetchTmdForecast } from './sources/tmd.mjs';
import { fetchIncidents } from './sources/incidents.mjs';

const OUT = CONFIG.dirs.out;
const now = new Date();
const nowIso = now.toISOString();

/** Previously published file: local out/ first (dev), otherwise the live site (CI). */
async function prevFile(name) {
  const local = readJson(path.join(OUT, name));
  if (local) return local;
  try {
    return await fetchJson(CONFIG.prevBaseUrl + name, { timeoutMs: 20000, retries: 1 });
  } catch {
    return null;
  }
}

const prevMeta = (await prevFile('meta.json')) || { sources: {} };
const meta = { generatedAt: nowIso, sources: {} };


function isDue(name) {
  const last = prevMeta.sources?.[name]?.fetchedAt;
  const interval = CONFIG.minIntervalMin[name] ?? 0;
  return !last || process.env.FORCE_ALL === '1' || now - new Date(last) >= interval * 60e3;
}

/**
 * Run one source. `fetcher` returns { files: {name: data}, dataTime }.
 * On skip/failure, previously published files are copied forward and marked stale.
 */
async function runSource(name, { enabled = true, fetcher, files }) {
  const prev = prevMeta.sources?.[name] || {};
  if (!enabled) {
    meta.sources[name] = { ok: false, disabled: true, note: 'ยังไม่ได้ตั้งค่า API Key' };
    return null;
  }
  if (!isDue(name)) {
    const reused = await reuse(files);
    if (reused) {
      meta.sources[name] = { ...prev, reused: true };
      console.log(`[${name}] not due yet – reused previous data`);
      return reused;
    }
  }
  try {
    const t0 = Date.now();
    const res = await fetcher();
    for (const [f, data] of Object.entries(res.files)) writeJson(path.join(OUT, f), data);
    meta.sources[name] = { ok: true, fetchedAt: nowIso, dataTime: res.dataTime || nowIso, ms: Date.now() - t0 };
    return res.files;
  } catch (err) {
    console.error(`[${name}] FAILED: ${err.message}`);
    const reused = await reuse(files);
    meta.sources[name] = { ...prev, ok: false, stale: !!reused, error: err.message.slice(0, 200), failedAt: nowIso };
    return reused;
  }
}

async function reuse(files) {
  const got = {};
  for (const f of files) {
    const data = await prevFile(f);
    if (!data) return null;
    got[f] = data;
    writeJson(path.join(OUT, f), data);
  }
  return got;
}

fs.mkdirSync(OUT, { recursive: true });

// ---------- 1. ThaiWater ----------
const tw = await runSource('thaiwater', {
  files: ['stations.json', 'series.json'],
  fetcher: async () => {
    const { stations, rain, series } = await fetchThaiWater();
    const dataTime = stations.map((s) => s.time).filter(Boolean).sort().pop();
    return { dataTime, files: { 'stations.json': { updated: dataTime, levels: LEVELS, stations, rain }, 'series.json': compactSeries(series) } };
  },
});

// ---------- 2. GISTDA (satellite flood) ----------
const floodFiles = ['flood_summary.json', ...FLOOD_PERIODS.map((p) => `flood_${p.key}.geojson`)];
const gd = await runSource('gistda', {
  enabled: !!SECRETS.gistdaKey,
  files: floodFiles,
  fetcher: async () => {
    const flood = await fetchGistdaFlood();
    const files = {};
    const summary = { periods: {} };
    for (const [key, p] of Object.entries(flood)) {
      files[`flood_${key}.geojson`] = p.hexes;
      summary.periods[key] = { label: p.label, sceneDate: p.sceneDate, featureCount: p.featureCount, totals: p.totals, byAmphoe: p.byAmphoe, byTambon: p.byTambon.slice(0, 40) };
    }
    files['flood_summary.json'] = summary;
    return { files, dataTime: flood['3days']?.sceneDate };
  },
});

// ---------- 3. GloFAS forecast ----------
const climate = readJson(path.join(CONFIG.dirs.store, 'risk', 'glofas_climate.json'), {}) || {};
const gf = await runSource('glofas', {
  files: ['glofas.json'],
  fetcher: async () => ({ files: { 'glofas.json': { points: await fetchGlofas(climate) } } }),
});

// ---------- 4. TMD Weather & Rain Forecast ----------
const tmdRes = await runSource('tmd', {
  enabled: !!SECRETS.tmdToken,
  files: ['tmd_forecast.json'],
  fetcher: async () => {
    const forecast = await fetchTmdForecast();
    return { files: { 'tmd_forecast.json': forecast }, dataTime: forecast.updated };
  },
});
const tmd = tmdRes?.['tmd_forecast.json'] || null;

// ---------- 5. News & DDPM Incidents ----------
const incRes = await runSource('incidents', {
  files: ['incidents.geojson'],
  fetcher: async () => {
    const geo = await fetchIncidents();
    return { files: { 'incidents.geojson': geo }, dataTime: geo.generatedAt };
  },
});
const incidents = incRes?.['incidents.geojson'] || null;

// ---------- 6. Status + feed ----------
const stations = tw?.['stations.json']?.stations || [];
const rain = tw?.['stations.json']?.rain || [];
const floodSummary = gd?.['flood_summary.json']?.periods || null;
const glofas = gf?.['glofas.json']?.points || [];
const floodRai3d = floodSummary?.['3days']?.totals?.rai || 0;

const status = provinceStatus({ stations, rain, floodRai3d, glofas, incidents, tmd });
const conditions = buildConditions({ stations, rain, flood: floodSummary, glofas, incidents, tmd }, nowIso);
const prevFeed = await prevFile('feed.json');
const events = diffConditions(prevFeed?.conditions || [], conditions, nowIso);
const timeline = mergeTimeline(prevFeed?.timeline || [], events);

const levelCounts = Object.fromEntries([1, 2, 3, 4, 5].map((l) => [l, stations.filter((s) => s.level === l).length]));
writeJson(path.join(OUT, 'status.json'), {
  generatedAt: nowIso,
  status,
  kpi: {
    stations: stations.length,
    levelCounts,
    rain: summariseRain(rain),
    floodRai3d,
    floodTambons3d: floodSummary?.['3days']?.byAmphoe ? floodSummary['3days'].byAmphoe.reduce((n, a) => n + (a.tambons || 0), 0) : null,
    floodSceneDate: floodSummary?.['3days']?.sceneDate ?? null,
    glofasAlerts: glofas.filter((g) => g.alert > 0).length,
    incidentPoints: incidents?.features?.length || 0,
    tmdMaxRain24h: tmd?.maxRainNext24h || null,
  },
});
writeJson(path.join(OUT, 'feed.json'), { generatedAt: nowIso, conditions, timeline });
writeJson(path.join(OUT, 'meta.json'), meta, { pretty: true });

console.log(`status: ${status.label} | stations ${stations.length} | rain ${rain.length} | conditions ${conditions.length} | new events ${events.length}`);
const failed = Object.entries(meta.sources).filter(([, s]) => s.ok === false && !s.disabled && !s.stale);
if (!stations.length) {
  console.error('No station data at all – failing the run so the previous deployment stays online.');
  process.exit(1);
}
if (failed.length) console.warn('Sources without data:', failed.map(([n]) => n).join(', '));
