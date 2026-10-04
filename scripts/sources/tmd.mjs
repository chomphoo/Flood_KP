// TMD NWP API (พยากรณ์อากาศและฝนเชิงตัวเลข – กรมอุตุนิยมวิทยา) – requires TMD_TOKEN
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG, SECRETS, ROOT } from '../lib/config.mjs';
import { fetchJson, mapLimit, round } from '../lib/util.mjs';
import { representativePoint } from '../lib/geo.mjs';

const BASE = 'https://data.tmd.go.th/nwpapi/v1/forecast/location';

// Official code table: https://data.tmd.go.th/nwpapi/doc/apidoc/location/forecast_daily.html
export const TMD_COND = {
  1: 'ท้องฟ้าแจ่มใส',
  2: 'มีเมฆบางส่วน',
  3: 'เมฆเป็นส่วนมาก',
  4: 'มีเมฆมาก',
  5: 'ฝนตกเล็กน้อย',
  6: 'ฝนปานกลาง',
  7: 'ฝนตกหนัก',
  8: 'ฝนฟ้าคะนอง',
  9: 'อากาศหนาวจัด',
  10: 'อากาศหนาว',
  11: 'อากาศเย็น',
  12: 'อากาศร้อนจัด',
};

export function tmdCondLabel(code) {
  return TMD_COND[code] || '–';
}

/**
 * Fetch 7-day daily forecast for all 11 districts of Kamphaeng Phet
 * and 48-hour hourly forecast for the province centre.
 */
export async function fetchTmdForecast() {
  if (!SECRETS.tmdToken) throw new Error('TMD_TOKEN is not set');

  const headers = {
    accept: 'application/json',
    Authorization: `Bearer ${SECRETS.tmdToken}`,
  };

  const amphoeGeoPath = path.join(CONFIG.dirs.static, 'amphoe.geojson');
  let amphoeFeatures = [];
  if (fs.existsSync(amphoeGeoPath)) {
    const geo = JSON.parse(fs.readFileSync(amphoeGeoPath, 'utf8'));
    amphoeFeatures = geo.features || [];
  }

  // 1. Fetch 7-day daily forecast per district (concurrency 3)
  const byAmphoe = {};
  const next24ByAmphoe = {};
  let provinceDaily = null;

  await mapLimit(amphoeFeatures, 3, async (f) => {
    const name = f.properties.name;
    const pt = representativePoint(f.geometry);
    if (!pt) return;
    const url = `${BASE}/daily/at?lat=${pt[1].toFixed(4)}&lon=${pt[0].toFixed(4)}&fields=tc_max,tc_min,rh,cond,rain&duration=7`;
    try {
      const res = await fetchJson(url, { headers, timeoutMs: 30000, retries: 2 });
      const raw = res?.WeatherForecasts?.[0]?.forecasts || [];
      const list = raw.map((d) => ({
        date: d.time.slice(0, 10),
        time: d.time,
        rain: round(d.data.rain, 1),
        tcMax: round(d.data.tc_max, 1),
        tcMin: round(d.data.tc_min, 1),
        rh: round(d.data.rh, 0),
        cond: d.data.cond,
        condText: tmdCondLabel(d.data.cond),
      }));
      byAmphoe[name] = list;
      if (name === 'เมืองกำแพงเพชร') provinceDaily = list;
    } catch (err) {
      console.warn(`[tmd] failed daily forecast for ${name}: ${err.message}`);
    }
    // Rolling next-24h rainfall from the hourly model (starts at the current hour).
    try {
      const url = `${BASE}/hourly/at?lat=${pt[1].toFixed(4)}&lon=${pt[0].toFixed(4)}&fields=rain,cond&duration=24`;
      const res = await fetchJson(url, { headers, timeoutMs: 30000, retries: 2 });
      const raw = res?.WeatherForecasts?.[0]?.forecasts || [];
      if (raw.length) {
        const total = raw.reduce((s, d) => s + (d.data.rain || 0), 0);
        const peak = raw.reduce((m, d) => ((d.data.rain || 0) > (m?.data.rain || 0) ? d : m), null);
        next24ByAmphoe[name] = {
          rain: round(total, 1),
          from: raw[0].time,
          to: raw[raw.length - 1].time,
          peakTime: peak?.data.rain > 0 ? peak.time : null,
          peakRain: peak ? round(peak.data.rain, 1) : 0,
        };
      }
    } catch (err) {
      console.warn(`[tmd] failed hourly forecast for ${name}: ${err.message}`);
    }
  });

  // 2. Fetch 48-hour hourly forecast for province centre (เมืองกำแพงเพชร: 16.4713, 99.5266)
  let hourly = [];
  try {
    const url = `${BASE}/hourly/at?lat=16.4713&lon=99.5266&fields=tc,rh,cond,rain&duration=48`;
    const res = await fetchJson(url, { headers, timeoutMs: 30000, retries: 2 });
    const raw = res?.WeatherForecasts?.[0]?.forecasts || [];
    hourly = raw.map((d) => ({
      time: d.time,
      rain: round(d.data.rain, 1),
      tc: round(d.data.tc, 1),
      rh: round(d.data.rh, 0),
      cond: d.data.cond,
      condText: tmdCondLabel(d.data.cond),
    }));
  } catch (err) {
    console.warn(`[tmd] failed hourly forecast: ${err.message}`);
  }

  // Summary metrics
  let maxRainNext24h = null;
  let maxRainNext7d = null;

  for (const [ap, n] of Object.entries(next24ByAmphoe)) {
    if (maxRainNext24h == null || n.rain > maxRainNext24h.rain) maxRainNext24h = { amphoe: ap, ...n };
  }
  for (const [ap, list] of Object.entries(byAmphoe)) {
    for (const d of list) {
      if (maxRainNext7d == null || d.rain > maxRainNext7d.rain) {
        maxRainNext7d = { amphoe: ap, rain: d.rain, date: d.date, condText: d.condText };
      }
    }
  }

  const generatedAt = new Date().toISOString();
  return {
    generatedAt,
    source: 'กรมอุตุนิยมวิทยา (TMD NWP)',
    province: {
      name: CONFIG.provinceName,
      daily: provinceDaily || Object.values(byAmphoe)[0] || [],
    },
    hourly,
    byAmphoe,
    next24ByAmphoe,
    maxRainNext24h,
    maxRainNext7d,
  };
}
