// Compact encoding for polygon GeoJSON (flood/risk hexagons) to cut page weight.
// Format v1:
//   { v:1, scale, keys:[...], dict:{key:[strings]}, f:[[props...], [x0,y0,dx1,dy1,...]] }
//   - string props become indexes into dict[key]; other props are kept as-is
//   - geometry = outer ring of a Polygon, closing vertex dropped, ints at `scale`, delta-coded
// The browser decoder lives in assets/js/common.js (unpackGeo) – keep both in sync.

export function packGeo(gj, scale = 1e5) {
  const feats = gj.features || [];
  const keys = [...new Set(feats.flatMap((f) => Object.keys(f.properties || {})))];
  const dict = {};
  const dictIdx = {};
  for (const k of keys) {
    if (feats.some((f) => typeof f.properties?.[k] === 'string')) {
      dict[k] = [];
      dictIdx[k] = new Map();
    }
  }
  const f = [];
  for (const ft of feats) {
    if (ft.geometry?.type !== 'Polygon') return null; // only simple polygons are supported
    const props = keys.map((k) => {
      const v = ft.properties?.[k];
      if (!dict[k] || v == null) return v ?? null;
      if (!dictIdx[k].has(v)) {
        dictIdx[k].set(v, dict[k].length);
        dict[k].push(v);
      }
      return dictIdx[k].get(v);
    });
    const ring = ft.geometry.coordinates[0];
    const n = ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring.length - 1 : ring.length;
    const g = [];
    let px = 0;
    let py = 0;
    for (let i = 0; i < n; i++) {
      const x = Math.round(ring[i][0] * scale);
      const y = Math.round(ring[i][1] * scale);
      g.push(x - px, y - py);
      px = x;
      py = y;
    }
    f.push([props, g]);
  }
  const { features: _f, ...rest } = gj;
  return { v: 1, scale, meta: rest, keys, dict, f };
}

/** Node-side decoder (used by tests to verify round-trips). */
export function unpackGeo(p) {
  return {
    ...(p.meta || {}),
    type: 'FeatureCollection',
    features: p.f.map(([props, g]) => {
      const properties = {};
      p.keys.forEach((k, i) => {
        const v = props[i];
        properties[k] = p.dict[k] && v != null ? p.dict[k][v] : v;
      });
      const ring = [];
      let x = 0;
      let y = 0;
      for (let i = 0; i < g.length; i += 2) {
        x += g[i];
        y += g[i + 1];
        ring.push([x / p.scale, y / p.scale]);
      }
      if (ring.length) ring.push(ring[0]);
      return { type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [ring] } };
    }),
  };
}
