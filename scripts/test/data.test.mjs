// Unit tests for data processing (ThaiWater series, GISTDA aggregation, geometry helpers).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { changeOver, summariseDay, compactSeries } from '../sources/thaiwater.mjs';
import { aggregateFlood, aggregateFrequency, latestSceneDate } from '../sources/gistda.mjs';
import { assembleRings, simplifyRing, representativePoint, RAI_M2 } from '../lib/geo.mjs';

const iso = (h) => new Date(Date.UTC(2026, 9, 1, h)).toISOString();

describe('ThaiWater helpers', () => {
  test('changeOver uses the last reading at or before the window start', () => {
    const series = [0, 1, 2, 3, 4, 5, 6].map((h) => ({ t: iso(h), wl: 10 + h * 0.1 }));
    assert.equal(changeOver(series, 6), 0.6);
    assert.equal(changeOver(series, 2), 0.2);
    assert.equal(changeOver(series, 24), null); // not enough history
    assert.equal(changeOver([], 6), null);
  });

  test('summariseDay converts over-bank readings to hours regardless of interval', () => {
    const st = { bank: 4, ground: 0 };
    const s = summariseDay([{ wl: 1 }, { wl: 3 }, { wl: 5 }, { wl: null }], st);
    assert.equal(s.min, 1);
    assert.equal(s.max, 5);
    assert.equal(s.mean, 3);
    assert.equal(s.maxPct, 125);
    assert.equal(s.maxLevel, 5);
    assert.equal(s.overBankHours, 8); // 1 of 3 readings → 8 h
    assert.equal(s.n, 3);
    // 144 ten-minute readings, all over bank → 24 h (not 144)
    assert.equal(summariseDay(Array.from({ length: 144 }, () => ({ wl: 5 })), st).overBankHours, 24);
    assert.equal(summariseDay([], st), null);
  });

  test('compactSeries keeps one reading per hour', () => {
    const t0 = Date.UTC(2026, 9, 1, 0);
    const at = (min) => new Date(t0 + min * 60e3).toISOString();
    const out = compactSeries({
      HOURLY: [{ t: at(0), wl: 1 }, { t: at(60), wl: 2, q: 9 }],
      TENMIN: [{ t: at(0), wl: 5 }, { t: at(10), wl: 5.1 }, { t: at(60), wl: 6 }, { t: at(70), wl: 6.1 }],
    });
    assert.equal(out.t0, new Date(t0).toISOString());
    assert.deepEqual(out.data.HOURLY, [[0, 1], [1, 2, 9]]);
    assert.deepEqual(out.data.TENMIN.map((r) => r[0]), [0, 1]);
    assert.deepEqual(compactSeries({}), { t0: null, data: {} });
  });
});

// Small square polygon (~110 m) around a point in Kamphaeng Phet.
const square = (lon, lat, d = 0.001) => ({
  type: 'Polygon',
  coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]],
});

describe('GISTDA aggregation', () => {
  test('aggregateFlood sums area / people by district and tambon', () => {
    const features = [
      { properties: { f_area: 16000, population: 10, ap_tn: 'อ.คลองขลุง', tb_tn: 'ต.คลองขลุง', file_name: 'S1D_20261001_0607' }, geometry: square(99.70, 16.20) },
      { properties: { f_area: 8000, population: 5, ap_tn: 'อ.คลองขลุง', tb_tn: 'ต.วังยาง', file_name: 'S1D_20261002_0607, S1D_20260930_0607' }, geometry: square(99.75, 16.25) },
      { properties: { f_area: 1600, building: 2, ap_tn: 'อ.ไทรงาม', tb_tn: 'ต.ไทรงาม' }, geometry: square(99.48, 16.47) },
    ];
    const a = aggregateFlood(features);
    assert.equal(a.totals.rai, (16000 + 8000 + 1600) / RAI_M2);
    assert.equal(a.totals.population, 15);
    assert.equal(a.totals.building, 2);
    assert.deepEqual(a.byAmphoe.map((x) => [x.amphoe, x.rai, x.tambons]), [['คลองขลุง', 15, 2], ['ไทรงาม', 1, 1]]);
    assert.equal(a.byTambon[0].tambon, 'คลองขลุง');
    assert.equal(a.hexes.features.length, 3);
    for (const h of a.hexes.features) assert.ok(h.properties.frac > 0 && h.properties.frac <= 1);
    assert.equal(latestSceneDate(features), '2026-10-02');
  });

  test('aggregateFrequency counts flood years per tambon and province', () => {
    const features = [
      { properties: { area_rai: 100, y_2011: 1, y_2012: 0, y_2013: 1, ap_tn: 'อ.เมืองกำแพงเพชร', tb_tn: 'ต.เทพนคร', tb_idn: 620113 }, geometry: square(99.55, 16.45) },
      { properties: { area_rai: 50, y_2011: 1, y_2012: 1, y_2013: 0, ap_tn: 'อ.เมืองกำแพงเพชร', tb_tn: 'ต.เทพนคร', tb_idn: 620113 }, geometry: square(99.551, 16.451) },
      { properties: { area_rai: 10, y_2011: 0, y_2012: 0, y_2013: 1, ap_tn: 'อ.พรานกระต่าย', tb_tn: 'ต.เขาคีริส', tb_idn: 620606 }, geometry: square(99.60, 16.65) },
    ];
    const r = aggregateFrequency(features);
    assert.deepEqual(r.years, [2011, 2012, 2013]);
    assert.deepEqual(r.provinceByYear, { 2011: 150, 2012: 50, 2013: 110 });
    const t = r.tambons[0];
    assert.equal(t.tambon, 'เทพนคร');
    assert.equal(t.years, 3);
    assert.deepEqual(t.floodYears, [2011, 2012, 2013]);
    assert.equal(t.everRai, 150);
    assert.equal(t.maxRai, 150);
    assert.equal(r.tambons[1].years, 1);
    assert.equal(r.featureCount, 3);
    const maxN = Math.max(...r.hexes.features.map((h) => h.properties.n));
    assert.ok(maxN >= 2 && maxN <= 3);
  });
});

describe('geometry helpers', () => {
  test('assembleRings joins segments in any direction into a closed ring', () => {
    const rings = assembleRings([
      [[0, 0], [1, 0]],
      [[1, 1], [1, 0]], // reversed
      [[1, 1], [0, 1], [0, 0]],
    ]);
    assert.equal(rings.length, 1);
    const r = rings[0];
    assert.deepEqual(r[0], r[r.length - 1]);
    assert.equal(r.length, 5);
  });

  test('assembleRings closes open rings', () => {
    const rings = assembleRings([[[0, 0], [2, 0], [2, 2], [0, 2]]]);
    assert.deepEqual(rings[0][0], rings[0][rings[0].length - 1]);
  });

  test('simplifyRing drops near-collinear points but keeps the shape', () => {
    const ring = [[0, 0], [0.5, 0.00001], [1, 0], [1, 1], [0, 1], [0, 0]];
    const s = simplifyRing(ring, 0.001);
    assert.equal(s.length, 5);
    assert.deepEqual(s[0], s[s.length - 1]);
  });

  test('representativePoint picks the largest polygon', () => {
    const p = representativePoint({ type: 'MultiPolygon', coordinates: [square(0, 0, 1).coordinates, square(10, 10, 4).coordinates] });
    assert.deepEqual(p, [12, 12]);
  });
});
