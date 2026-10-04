import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packGeo, unpackGeo } from '../lib/pack.mjs';

test('packGeo round-trips hexagon polygons and string props', () => {
  const ring = [[99.1234, 16.5678], [99.1244, 16.5688], [99.1254, 16.5678], [99.1254, 16.5658], [99.1244, 16.5648], [99.1234, 16.5658], [99.1234, 16.5678]];
  const gj = {
    type: 'FeatureCollection', label: 'x',
    features: [
      { type: 'Feature', properties: { h3: 'abc', rai: 12.5, frac: 0.3, tb: 'ในเมือง', ap: 'เมือง', yrs: [11, 21] }, geometry: { type: 'Polygon', coordinates: [ring] } },
      { type: 'Feature', properties: { h3: 'abd', rai: 1, frac: 0.1, tb: 'ในเมือง', ap: 'เมือง', yrs: [] }, geometry: { type: 'Polygon', coordinates: [ring] } },
    ],
  };
  const p = packGeo(gj, 1e4);
  assert.equal(p.dict.tb.length, 1);
  const back = unpackGeo(p);
  assert.equal(back.label, 'x');
  assert.deepEqual(back.features[0].properties, gj.features[0].properties);
  assert.deepEqual(back.features[1].geometry.coordinates[0], ring);
  assert.ok(JSON.stringify(p).length < JSON.stringify(gj).length);
});
