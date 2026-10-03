// Geometry helpers (no dependencies except h3-js for hexagon aggregation).
import { cellToBoundary, cellToParent, latLngToCell, getHexagonAreaAvg, cellArea, UNITS } from 'h3-js';

export const RAI_M2 = 1600; // 1 ไร่ = 1,600 ตร.ม.

export function roundCoords(ring, d = 5) {
  const f = 10 ** d;
  return ring.map(([x, y]) => [Math.round(x * f) / f, Math.round(y * f) / f]);
}

/** Douglas–Peucker simplification for a closed ring of [lon,lat]. */
export function simplifyRing(ring, tol) {
  if (ring.length <= 4 || !tol) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDist2(ring[i], ring[a], ring[b]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > tol2) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out = ring.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : ring;
}

function segDist2(p, a, b) {
  let [x, y] = a;
  let dx = b[0] - x;
  let dy = b[1] - y;
  if (dx || dy) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) [x, y] = b;
    else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
}

/** Join way segments (arrays of [lon,lat]) into closed rings. */
export function assembleRings(segments) {
  const key = (p) => p[0].toFixed(7) + ',' + p[1].toFixed(7);
  const pool = segments.map((s) => s.slice());
  const rings = [];
  while (pool.length) {
    let ring = pool.shift();
    let guard = 0;
    while (key(ring[0]) !== key(ring[ring.length - 1]) && guard++ < 10000) {
      const end = key(ring[ring.length - 1]);
      const idx = pool.findIndex((s) => key(s[0]) === end || key(s[s.length - 1]) === end);
      if (idx === -1) break; // open ring (incomplete data) – close it anyway
      const seg = pool.splice(idx, 1)[0];
      ring = ring.concat(key(seg[0]) === end ? seg.slice(1) : seg.reverse().slice(1));
    }
    if (key(ring[0]) !== key(ring[ring.length - 1])) ring.push(ring[0]);
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}

/** Representative point of a (Multi)Polygon geometry: bbox centre of its largest outer ring. */
export function representativePoint(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  let best = null;
  let bestSpan = -1;
  for (const poly of polys) {
    const ring = poly[0];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const span = (maxX - minX) * (maxY - minY);
    if (span > bestSpan) {
      bestSpan = span;
      best = [(minX + maxX) / 2, (minY + maxY) / 2];
    }
  }
  return best; // [lon, lat]
}

/** H3 cell for a feature: use provided res-9 address when present, otherwise its representative point. */
export function featureCell(feature, res) {
  const addr = feature.properties?.h3_address;
  if (addr) {
    try {
      return cellToParent(addr, res);
    } catch {
      /* fall through */
    }
  }
  const pt = representativePoint(feature.geometry);
  return pt ? latLngToCell(pt[1], pt[0], res) : null;
}

/** GeoJSON polygon feature for an H3 cell. */
export function hexFeature(cell, properties) {
  const ring = roundCoords(cellToBoundary(cell, true), 4);
  return { type: 'Feature', properties: { h3: cell, ...properties }, geometry: { type: 'Polygon', coordinates: [ring] } };
}

export const hexAreaM2 = (cell) => cellArea(cell, UNITS.m2);
export const avgHexAreaKm2 = (res) => getHexagonAreaAvg(res, UNITS.km2);
