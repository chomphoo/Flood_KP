// GISTDA Disaster API (ภาพถ่ายดาวเทียม) – requires GISTDA_KEY.
// Raw flood polygons are large (≈2.5 MB per 1,000 features) so we aggregate them into H3 hexagons
// (resolution 8 ≈ 0.74 km²) plus per-district / per-tambon summaries before publishing.
import { CONFIG, SECRETS } from '../lib/config.mjs';
import { fetchJson, mapLimit, round } from '../lib/util.mjs';
import { featureCell, hexFeature, hexAreaM2, RAI_M2 } from '../lib/geo.mjs';

const BASE = 'https://api-gateway.gistda.or.th/api/2.0/resources/features';
const PAGE = 1000;
export const HEX_RES = 8;

/**
 * Fetch every feature of a collection for the province.
 * With `onFeatures`, pages are streamed to the callback and NOT retained (for very large collections).
 */
export async function fetchAllFeatures(collection, { onFeatures, concurrency = 3 } = {}) {
  if (!SECRETS.gistdaKey) throw new Error('GISTDA_KEY is not set');
  const headers = { 'API-Key': SECRETS.gistdaKey };
  const url = (offset) => `${BASE}/${collection}?limit=${PAGE}&offset=${offset}&pv_idn=${CONFIG.provinceCode}`;
  const first = await fetchJson(url(0), { headers, timeoutMs: 90000 });
  const total = first.numberMatched ?? first.features.length;
  const offsets = [];
  for (let o = PAGE; o < total; o += PAGE) offsets.push(o);
  const features = [];
  const take = (fs) => (onFeatures ? onFeatures(fs) : features.push(...fs));
  take(first.features);
  let received = first.features.length;
  await mapLimit(offsets, concurrency, async (o) => {
    const j = await fetchJson(url(o), { headers, timeoutMs: 90000, retries: 3 });
    take(j.features);
    received += j.features.length;
  });
  if (received < total) throw new Error(`${collection}: received ${received}/${total} features`);
  return { features, total };
}

/** Latest satellite scene date found in GISTDA `file_name` (e.g. "S1D_20261002_0607, ..."). */
export function latestSceneDate(features) {
  let best = '';
  for (const f of features) {
    for (const m of String(f.properties?.file_name || '').matchAll(/_(20\d{6})_/g)) if (m[1] > best) best = m[1];
  }
  return best ? `${best.slice(0, 4)}-${best.slice(4, 6)}-${best.slice(6, 8)}` : null;
}

const strip = (s) => String(s || '').replace(/^(อ\.|ต\.|จ\.)/, '').trim();

/** Aggregate current-flood polygons into hexagons + area summaries. */
export function aggregateFlood(features) {
  const hex = new Map();
  const byAmphoe = new Map();
  const byTambon = new Map();
  const totals = { rai: 0, population: 0, building: 0, school: 0, hospital: 0 };

  for (const f of features) {
    const p = f.properties || {};
    const m2 = +p.f_area || +p._area || 0;
    const add = (o) => {
      o.rai += m2 / RAI_M2;
      o.population += +p.population || 0;
      o.building += +p.building || 0;
      o.school += +p.school || 0;
      o.hospital += +p.hospital || 0;
    };
    add(totals);
    const ap = strip(p.ap_tn);
    const tb = strip(p.tb_tn);
    if (!byAmphoe.has(ap)) byAmphoe.set(ap, { amphoe: ap, rai: 0, population: 0, building: 0, school: 0, hospital: 0, tambons: new Set() });
    const a = byAmphoe.get(ap);
    add(a);
    a.tambons.add(tb);
    const tk = `${ap}|${tb}`;
    if (!byTambon.has(tk)) byTambon.set(tk, { amphoe: ap, tambon: tb, rai: 0, population: 0, building: 0, school: 0, hospital: 0 });
    add(byTambon.get(tk));

    const cell = featureCell(f, HEX_RES);
    if (!cell) continue;
    if (!hex.has(cell)) hex.set(cell, { m2: 0, tb, ap });
    hex.get(cell).m2 += m2;
  }

  const hexes = [...hex].map(([cell, h]) =>
    hexFeature(cell, { rai: round(h.m2 / RAI_M2, 1), frac: round(Math.min(1, h.m2 / hexAreaM2(cell)), 3), tb: h.tb, ap: h.ap })
  );
  const fix = (o) => ({ ...o, rai: round(o.rai, 0), population: Math.round(o.population), tambons: o.tambons ? o.tambons.size : undefined });
  return {
    totals: fix(totals),
    byAmphoe: [...byAmphoe.values()].map(fix).sort((a, b) => b.rai - a.rai),
    byTambon: [...byTambon.values()].map(fix).sort((a, b) => b.rai - a.rai),
    hexes: { type: 'FeatureCollection', features: hexes },
  };
}

export const FLOOD_PERIODS = [
  { key: '3days', label: '3 วันล่าสุด' },
  { key: '7days', label: '7 วันล่าสุด' },
  { key: '30days', label: '30 วันล่าสุด' },
];

export async function fetchGistdaFlood() {
  const out = {};
  for (const p of FLOOD_PERIODS) {
    const { features, total } = await fetchAllFeatures(`flood/${p.key}`);
    const agg = aggregateFlood(features);
    out[p.key] = { label: p.label, featureCount: total, sceneDate: latestSceneDate(features), ...agg };
    console.log(`[gistda] ${p.key}: ${total} polygons → ${agg.hexes.features.length} hexes, ${agg.totals.rai} rai`);
  }
  return out;
}

// ---------- Historical flood frequency (2011–2024) ----------

/**
 * Aggregate GISTDA `flood-freq` polygons (attributes y_2011…y_2024 = flooded that year).
 * Produces: hexagons with number of flood years, per-tambon stats, province totals per year.
 */
export function aggregateFrequency(features) {
  const acc = createFrequencyAccumulator();
  acc.add(features);
  return acc.result();
}

export function createFrequencyAccumulator() {
  let yearKeys = null;
  let years = [];
  const hex = new Map();
  const tambon = new Map();
  let provinceByYear = {};
  let count = 0;

  function add(features) {
    if (!features.length) return;
    if (!yearKeys) {
      yearKeys = Object.keys(features[0].properties || {}).filter((k) => /^y_\d{4}$/.test(k)).sort();
      years = yearKeys.map((k) => +k.slice(2));
      provinceByYear = Object.fromEntries(years.map((y) => [y, 0]));
    }
    count += features.length;
    for (const f of features) {
      const p = f.properties || {};
      const rai = +p.area_rai || (+p.shape_area || 0) / RAI_M2;
      const flooded = yearKeys.filter((k) => +p[k] === 1).map((k) => +k.slice(2));
      for (const y of flooded) provinceByYear[y] += rai;

      const ap = strip(p.ap_tn);
      const tb = strip(p.tb_tn);
      const tk = `${ap}|${tb}`;
      if (!tambon.has(tk)) tambon.set(tk, { amphoe: ap, tambon: tb, code: p.tb_idn, everRai: 0, byYear: Object.fromEntries(years.map((y) => [y, 0])) });
      const t = tambon.get(tk);
      t.everRai += rai;
      for (const y of flooded) t.byYear[y] += rai;

      const cell = featureCell(f, HEX_RES);
      if (!cell) continue;
      if (!hex.has(cell)) hex.set(cell, { rai: 0, years: new Set(), tb, ap });
      const h = hex.get(cell);
      h.rai += rai;
      for (const y of flooded) h.years.add(y);
    }
  }

  function result() {
    const hexes = [...hex].map(([cell, h]) => {
      const ys = [...h.years].sort();
      return hexFeature(cell, { n: ys.length, yrs: ys.map((y) => y % 100), rai: round(h.rai, 1), tb: h.tb, ap: h.ap });
    });
    const tambons = [...tambon.values()]
      .map((t) => {
        const floodYears = years.filter((y) => t.byYear[y] > 0);
        return {
          amphoe: t.amphoe,
          tambon: t.tambon,
          code: t.code,
          years: floodYears.length,
          floodYears,
          everRai: round(t.everRai, 0),
          maxRai: round(Math.max(...years.map((y) => t.byYear[y])), 0),
          byYear: Object.fromEntries(years.map((y) => [y, round(t.byYear[y], 0)])),
        };
      })
      .sort((a, b) => b.years - a.years || b.everRai - a.everRai);

    return {
      featureCount: count,
      years,
      provinceByYear: Object.fromEntries(years.map((y) => [y, round(provinceByYear[y], 0)])),
      tambons,
      hexes: { type: 'FeatureCollection', features: hexes },
    };
  }

  return { add, result };
}
