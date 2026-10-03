// Risk baseline (runs monthly + on demand). Writes to the persistent store (`data` branch):
//   store/risk/freq_hex.geojson      – hexagons coloured by number of flood years 2011–2024 (GISTDA)
//   store/risk/freq_summary.json     – per-tambon stats + province totals per year
//   store/risk/glofas_climate.json   – GloFAS return levels for forecast alerts
import path from 'node:path';
import { CONFIG, SECRETS } from './lib/config.mjs';
import { writeJson } from './lib/util.mjs';
import { fetchAllFeatures, createFrequencyAccumulator } from './sources/gistda.mjs';
import { fetchGlofasClimate } from './sources/glofas.mjs';

const RISK = path.join(CONFIG.dirs.store, 'risk');
const only = process.argv[2]; // optional: "freq" | "glofas"
let failures = 0;

if (!only || only === 'freq') {
  if (!SECRETS.gistdaKey) {
    console.warn('[risk] GISTDA_KEY missing – skipping flood frequency');
  } else {
    try {
      const acc = createFrequencyAccumulator();
      let pages = 0;
      const { total } = await fetchAllFeatures('flood-freq', {
        concurrency: 4,
        onFeatures: (fs) => {
          acc.add(fs);
          if (++pages % 10 === 0) console.log(`[risk] flood-freq pages: ${pages}`);
        },
      });
      const r = acc.result();
      writeJson(path.join(RISK, 'freq_hex.geojson'), { ...r.hexes, attribution: 'GISTDA', generatedAt: new Date().toISOString() });
      writeJson(path.join(RISK, 'freq_summary.json'), {
        generatedAt: new Date().toISOString(),
        source: 'GISTDA – พื้นที่น้ำท่วมซ้ำซาก',
        featureCount: total,
        years: r.years,
        provinceByYear: r.provinceByYear,
        tambons: r.tambons,
      });
      console.log(`[risk] flood-freq: ${total} polygons → ${r.hexes.features.length} hexes, ${r.tambons.length} tambons`);
    } catch (e) {
      failures++;
      console.error('[risk] flood-freq FAILED:', e.message);
    }
  }
}

if (!only || only === 'glofas') {
  try {
    writeJson(path.join(RISK, 'glofas_climate.json'), await fetchGlofasClimate(), { pretty: true });
  } catch (e) {
    failures++;
    console.error('[risk] glofas climate FAILED:', e.message);
  }
}

if (failures) process.exitCode = 1;
