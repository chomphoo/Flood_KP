// Daily archive (runs once a day just after midnight ICT; safe to re-run).
// Writes one file per day to the persistent store (`data` branch) and rebuilds compact stats for the website.
//   store/history/YYYY/YYYY-MM-DD.json   – daily summary per station + rain + satellite flood
//   store/stats/daily.json               – compact all-days table used by stats.html
//   store/stats/stations.json            – station metadata (bank / ground level) for charts
// Usage: node scripts/archive-daily.mjs [--backfill 365] [--force]
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from './lib/config.mjs';
import { readJson, writeJson, ictDate, addDays, mapLimit } from './lib/util.mjs';
import { fetchStationSeries, summariseDay } from './sources/thaiwater.mjs';

const args = process.argv.slice(2);
const backfill = Math.max(1, +(args[args.indexOf('--backfill') + 1] || 0) || 1);
const force = args.includes('--force');
const HIST = path.join(CONFIG.dirs.store, 'history');
const STATS = path.join(CONFIG.dirs.store, 'stats');
const dayFile = (d) => path.join(HIST, d.slice(0, 4), `${d}.json`);

const live = readJson(path.join(CONFIG.dirs.out, 'stations.json'));
if (!live?.stations?.length) {
  console.error('out/live/stations.json missing – run build-live first');
  process.exit(1);
}
const floodSummary = readJson(path.join(CONFIG.dirs.out, 'flood_summary.json'));

const yesterday = addDays(ictDate(), -1);
const days = [];
for (let i = backfill - 1; i >= 0; i--) {
  const d = addDays(yesterday, -i);
  if (force || !fs.existsSync(dayFile(d))) days.push(d);
}
if (!days.length) console.log('[archive] nothing to do – all days already archived');

if (days.length) {
  // One series request per station covering the whole range (chunked by 60 days).
  const perStationDay = {}; // code → day → summary
  await mapLimit(live.stations, 3, async (st) => {
    const byDay = {};
    for (let start = days[0]; start <= days[days.length - 1]; start = addDays(start, 60)) {
      const end = [addDays(start, 59), days[days.length - 1]].sort()[0];
      try {
        for (const p of await fetchStationSeries(st.id, start, end)) (byDay[p.t.slice(0, 10)] ??= []).push(p);
      } catch (e) {
        console.warn(`[archive] ${st.code} ${start}..${end}: ${e.message}`);
      }
    }
    perStationDay[st.code] = Object.fromEntries(Object.entries(byDay).map(([d, pts]) => [d, summariseDay(pts, st)]));
  });

  for (const d of days) {
    const isYesterday = d === yesterday;
    const record = {
      date: d,
      archivedAt: new Date().toISOString(),
      stations: Object.fromEntries(live.stations.map((s) => [s.code, perStationDay[s.code]?.[d] || null])),
      // Rain and satellite data are snapshots, only meaningful for the day that just ended.
      rain: isYesterday
        ? Object.fromEntries(live.rain.filter((r) => r.rain24h != null).map((r) => [r.code, r.rain24h]))
        : null,
      flood: isYesterday && floodSummary?.periods?.['3days']
        ? {
            sceneDate: floodSummary.periods['3days'].sceneDate,
            rai: floodSummary.periods['3days'].totals.rai,
            byAmphoe: Object.fromEntries(floodSummary.periods['3days'].byAmphoe.map((a) => [a.amphoe, a.rai])),
          }
        : null,
    };
    writeJson(dayFile(d), record);
  }
  console.log(`[archive] wrote ${days.length} day(s): ${days[0]} … ${days[days.length - 1]}`);
}

// ---- Rebuild compact stats from every archived day ----
const all = [];
if (fs.existsSync(HIST)) {
  for (const y of fs.readdirSync(HIST).sort()) {
    for (const f of fs.readdirSync(path.join(HIST, y)).sort()) {
      const r = readJson(path.join(HIST, y, f));
      if (r) all.push(r);
    }
  }
}
const codes = live.stations.map((s) => s.code);
writeJson(path.join(STATS, 'daily.json'), {
  generatedAt: new Date().toISOString(),
  columns: ['min', 'max', 'maxLevel', 'overBankHours'],
  codes,
  days: all.map((r) => {
    const rainVals = r.rain ? Object.values(r.rain) : [];
    return {
      d: r.date,
      s: codes.map((c) => {
        const s = r.stations?.[c];
        return s ? [s.min, s.max, s.maxLevel, s.overBankHours] : null;
      }),
      rainMax: rainVals.length ? Math.max(...rainVals) : null,
      floodRai: r.flood?.rai ?? null,
    };
  }),
});
writeJson(path.join(STATS, 'stations.json'), {
  stations: live.stations.map(({ code, name, river, amphoe, tambon, bank, ground, lat, lon }) => ({ code, name, river, amphoe, tambon, bank, ground, lat, lon })),
});
console.log(`[archive] stats rebuilt from ${all.length} day(s)`);
