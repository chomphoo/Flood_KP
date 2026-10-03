// One-time setup: build district (amphoe) + province boundaries for Kamphaeng Phet from OpenStreetMap (ODbL).
// Output: data/static/amphoe.geojson, data/static/province.geojson  (committed to the repo)
// Usage: node scripts/setup/build-boundaries.mjs
import path from 'node:path';
import { CONFIG } from '../lib/config.mjs';
import { writeJson } from '../lib/util.mjs';
import { simplifyRing, roundCoords, assembleRings } from '../lib/geo.mjs';

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const QUERY = `[out:json][timeout:180];
relation["boundary"="administrative"]["admin_level"="4"]["name"="จังหวัดกำแพงเพชร"]->.prov;
.prov map_to_area->.p;
(relation["boundary"="administrative"]["admin_level"="6"](area.p); .prov;);
out geom;`;

async function overpass(query) {
  for (const url of MIRRORS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Flood_KP/1.0' },
        signal: AbortSignal.timeout(200000),
      });
      const text = await res.text();
      if (!res.ok || !text.startsWith('{')) throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
      console.log('overpass ok:', url);
      return JSON.parse(text);
    } catch (e) {
      console.warn('overpass failed:', url, e.message);
    }
  }
  throw new Error('All Overpass mirrors failed');
}

function relationToGeometry(rel, tolerance) {
  const outer = [];
  const inner = [];
  for (const m of rel.members || []) {
    if (m.type !== 'way' || !m.geometry) continue;
    const seg = m.geometry.map((g) => [g.lon, g.lat]);
    (m.role === 'inner' ? inner : outer).push(seg);
  }
  const outers = assembleRings(outer).map((r) => roundCoords(simplifyRing(r, tolerance), 5));
  const inners = assembleRings(inner).map((r) => roundCoords(simplifyRing(r, tolerance), 5));
  // Inner rings are rare for districts; attach all to the first outer polygon.
  const polys = outers.map((r, i) => (i === 0 ? [r, ...inners] : [r]));
  return { type: 'MultiPolygon', coordinates: polys };
}

const nameToCode = Object.fromEntries(Object.entries(CONFIG.amphoe).map(([c, n]) => [n, c]));

const data = await overpass(QUERY);
const districts = [];
let province = null;
for (const el of data.elements) {
  if (el.type !== 'relation') continue;
  const t = el.tags || {};
  if (t.admin_level === '4') {
    province = { type: 'Feature', properties: { name: CONFIG.provinceName }, geometry: relationToGeometry(el, 0.0008) };
    continue;
  }
  const name = (t['name:th'] || t.name || '').replace(/^(อำเภอ|กิ่งอำเภอ)\s*/, '').trim();
  const code = nameToCode[name];
  if (!code) {
    console.warn('skip unknown district:', t.name);
    continue;
  }
  districts.push({ type: 'Feature', properties: { code, name }, geometry: relationToGeometry(el, 0.0004) });
}
districts.sort((a, b) => a.properties.code.localeCompare(b.properties.code));

const attribution = '© OpenStreetMap contributors (ODbL)';
writeJson(path.join(CONFIG.dirs.static, 'amphoe.geojson'), { type: 'FeatureCollection', attribution, features: districts });
if (province) writeJson(path.join(CONFIG.dirs.static, 'province.geojson'), { type: 'FeatureCollection', attribution, features: [province] });
console.log(`districts: ${districts.length}/11, province: ${province ? 'yes' : 'no'}`);
if (districts.length !== 11) process.exitCode = 1;
