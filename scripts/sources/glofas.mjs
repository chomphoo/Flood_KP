// Copernicus GloFAS river-discharge forecast via Open-Meteo Flood API (free, no key, CC BY 4.0).
import { CONFIG } from '../lib/config.mjs';
import { fetchJson, round, mapLimit } from '../lib/util.mjs';

const API = 'https://flood-api.open-meteo.com/v1/flood';
const at = (pt) => `latitude=${(pt.cell || [pt.lat])[0]}&longitude=${(pt.cell || [0, pt.lon])[1]}`;

export async function fetchGlofas(climate = {}) {
  return mapLimit(CONFIG.glofasPoints, 2, async (pt) => {
    const url = `${API}?${at(pt)}&daily=river_discharge,river_discharge_min,river_discharge_max&past_days=14&forecast_days=30&timezone=Asia%2FBangkok`;
    const j = await fetchJson(url);
    const d = j.daily || {};
    const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
    const series = (d.time || []).map((t, i) => ({
      t,
      q: round(d.river_discharge?.[i], 1),
      min: round(d.river_discharge_min?.[i], 1),
      max: round(d.river_discharge_max?.[i], 1),
    }));
    const next7 = series.filter((p) => p.t >= today).slice(0, 7);
    const peak = next7.reduce((m, p) => (p.q != null && p.q > (m?.q ?? -1) ? p : m), null);
    const c = climate[pt.id] || null;
    return { ...pt, series, peak7: peak, climate: c, alert: glofasAlert(peak?.q, c) };
  });
}

/** 0 = normal, 1 = above 2-year return level, 2 = above 5-year return level. */
export function glofasAlert(q, climate) {
  if (q == null || !climate) return 0;
  if (climate.rp5 && q >= climate.rp5) return 2;
  if (climate.rp2 && q >= climate.rp2) return 1;
  return 0;
}

/**
 * Climatology from GloFAS reanalysis: annual maxima 1984–(last full year) → return levels.
 * rp2 = median of annual maxima, rp5 = 80th percentile (empirical, Weibull plotting position).
 */
export async function fetchGlofasClimate() {
  const endYear = new Date().getUTCFullYear() - 1;
  const out = {};
  for (const pt of CONFIG.glofasPoints) {
    const url = `${API}?${at(pt)}&daily=river_discharge&start_date=1984-01-01&end_date=${endYear}-12-31`;
    const j = await fetchJson(url, { timeoutMs: 120000 });
    out[pt.id] = climateFromDaily(j.daily.time, j.daily.river_discharge);
    console.log(`[glofas] climate ${pt.id}: rp2=${out[pt.id].rp2} rp5=${out[pt.id].rp5}`);
  }
  return out;
}

export function climateFromDaily(times, values) {
  const annual = new Map();
  times.forEach((t, i) => {
    const v = values[i];
    if (v == null) return;
    const y = t.slice(0, 4);
    const cur = annual.get(y);
    if (!cur || v > cur.q) annual.set(y, { q: v, t });
  });
  const maxima = [...annual.values()].map((a) => a.q).sort((a, b) => a - b);
  const quantile = (p) => {
    const pos = p * (maxima.length + 1) - 1;
    const lo = Math.max(0, Math.min(maxima.length - 1, Math.floor(pos)));
    const hi = Math.min(maxima.length - 1, lo + 1);
    return maxima[lo] + (maxima[hi] - maxima[lo]) * Math.max(0, Math.min(1, pos - lo));
  };
  const record = [...annual.values()].reduce((m, a) => (a.q > (m?.q ?? -1) ? a : m), null);
  return {
    years: maxima.length,
    rp2: round(quantile(0.5), 1),
    rp5: round(quantile(0.8), 1),
    record: record ? { q: round(record.q, 1), date: record.t } : null,
  };
}
