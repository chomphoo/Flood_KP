// ThaiWater (สสน. / HII) public API – no key required.
import { CONFIG } from '../lib/config.mjs';
import { fetchJson, ictToIso, mapLimit, num, round, ictDate, addDays } from '../lib/util.mjs';
import { levelFromPercent } from '../lib/levels.mjs';

const BASE = 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public';
const inProvince = (d) => d?.geocode?.province_code === CONFIG.provinceCode;

/** Normalise one ThaiWater water-level record. */
export function normaliseStation(d) {
  const s = d.station || {};
  const g = d.geocode || {};
  const wl = num(d.waterlevel_msl);
  const prev = num(d.waterlevel_msl_previous);
  const bank = num(s.min_bank);
  const ground = num(s.ground_level);
  let pct = num(d.storage_percent);
  if (pct == null && wl != null && bank != null && ground != null && bank > ground) pct = ((wl - ground) / (bank - ground)) * 100;
  return {
    id: s.id,
    code: s.tele_station_oldcode || String(s.id),
    name: s.tele_station_name?.th?.trim() || '',
    river: d.river_name || '',
    amphoe: g.amphoe_name?.th || '',
    tambon: g.tumbon_name?.th || '',
    lat: num(s.tele_station_lat),
    lon: num(s.tele_station_long),
    agency: d.agency?.agency_shortname?.th?.trim() || '',
    time: ictToIso(d.waterlevel_datetime),
    wl: round(wl, 2),
    wlPrev: round(prev, 2),
    bank: round(bank, 2),
    ground: round(ground, 2),
    toBank: wl != null && bank != null ? round(bank - wl, 2) : null, // + = below bank, − = over bank
    pct: round(pct, 1),
    level: num(d.situation_level) ?? levelFromPercent(pct),
    discharge: round(num(d.discharge), 1),
  };
}

export function normaliseRain(d) {
  const s = d.station || {};
  const g = d.geocode || {};
  return {
    id: s.id,
    code: s.tele_station_oldcode || String(s.id),
    name: s.tele_station_name?.th?.trim() || '',
    amphoe: g.amphoe_name?.th || '',
    tambon: g.tumbon_name?.th || '',
    lat: num(s.tele_station_lat),
    lon: num(s.tele_station_long),
    agency: d.agency?.agency_shortname?.th?.trim() || '',
    time: ictToIso(d.rainfall_datetime),
    rain24h: round(num(d.rain_24h), 1),
  };
}

/** Water-level series (hourly or 10-minute, depending on the station) between two ICT dates (inclusive). */
export async function fetchStationSeries(stationId, startYmd, endYmd) {
  const url = `${BASE}/waterlevel_graph?station_type=tele_waterlevel&station_id=${stationId}&start_date=${startYmd}&end_date=${endYmd}`;
  const j = await fetchJson(url, { timeoutMs: 60000 });
  return (j?.data?.graph_data || [])
    .filter((p) => p.value != null)
    .map((p) => ({ t: ictToIso(p.datetime), wl: round(p.value, 2), q: round(num(p.discharge), 1) }));
}

export async function fetchThaiWater({ historyDays = 7 } = {}) {
  const [wlRes, rainRes] = await Promise.all([fetchJson(`${BASE}/waterlevel_load`), fetchJson(`${BASE}/rain_24h`)]);
  const stations = (wlRes?.waterlevel_data?.data || []).filter(inProvince).map(normaliseStation).filter((s) => s.lat && s.lon);
  const rain = (rainRes?.data || []).filter(inProvince).map(normaliseRain).filter((r) => r.lat && r.lon);
  if (!stations.length) throw new Error('ThaiWater returned no stations for the province');

  // 7-day series per station (for charts + "rising fast" detection)
  const end = ictDate();
  const start = addDays(end, -historyDays);
  const series = {};
  await mapLimit(stations, 4, async (s) => {
    try {
      series[s.code] = await fetchStationSeries(s.id, start, end);
    } catch (e) {
      console.warn(`[thaiwater] series failed for ${s.code}: ${e.message}`);
      series[s.code] = [];
    }
  });
  for (const s of stations) {
    s.change24h = changeOver(series[s.code], 24);
    s.change6h = changeOver(series[s.code], 6);
  }
  return { stations, rain, series };
}

/** Water level change (m) over the last `hours` of a time-ordered series. */
export function changeOver(series, hours) {
  if (!series?.length) return null;
  const last = series[series.length - 1];
  const target = new Date(last.t).getTime() - hours * 3600e3;
  let ref = null;
  for (const p of series) {
    if (new Date(p.t).getTime() <= target) ref = p;
    else break;
  }
  return ref ? round(last.wl - ref.wl, 2) : null;
}

/** Daily stats for one station from that day's readings (~10-minute interval). `st` needs bank + ground (m MSL). */
export function summariseDay(points, st) {
  const vals = points.map((p) => p.wl).filter((v) => v != null);
  if (!vals.length) return null;
  const pct = (wl) => (st.bank != null && st.ground != null && st.bank > st.ground ? ((wl - st.ground) / (st.bank - st.ground)) * 100 : null);
  const max = Math.max(...vals);
  const q = points.map((p) => p.q).filter((v) => v != null);
  return {
    min: round(Math.min(...vals), 2),
    max: round(max, 2),
    mean: round(vals.reduce((a, b) => a + b, 0) / vals.length, 2),
    maxPct: round(pct(max), 1),
    maxLevel: levelFromPercent(pct(max)),
    // Readings are ~10-minutely (not hourly), so convert the share of readings above bank into hours.
    overBankHours: st.bank != null ? round((vals.filter((v) => v > st.bank).length / vals.length) * 24, 1) : null,
    qMax: q.length ? round(Math.max(...q), 1) : null,
    n: vals.length,
  };
}

/**
 * {code: [{t, wl, q}]} → {t0, data: {code: [[hoursSinceT0, wl, q?]]}} (≈4× smaller than ISO timestamps).
 * Some stations report every 10 minutes, others hourly: keep the latest reading in each hour.
 */
export function compactSeries(series) {
  const times = Object.values(series).flat().map((p) => new Date(p.t).getTime());
  if (!times.length) return { t0: null, data: {} };
  const t0 = Math.min(...times);
  const data = {};
  for (const [code, pts] of Object.entries(series)) {
    const byHour = new Map();
    for (const p of pts) {
      const h = Math.round((new Date(p.t).getTime() - t0) / 3600e3);
      const row = [h, p.wl];
      if (p.q != null) row.push(p.q);
      byHour.set(h, row);
    }
    data[code] = [...byHour.values()].sort((a, b) => a[0] - b[0]);
  }
  return { t0: new Date(t0).toISOString(), data };
}
