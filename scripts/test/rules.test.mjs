// Unit tests for the rule-based logic (thresholds, province status, situation feed, GloFAS climatology).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { levelFromPercent, rainClass, provinceStatus, FLOOD_RAI } from '../lib/levels.mjs';
import { buildConditions, diffConditions, mergeTimeline, summariseRain } from '../lib/feed.mjs';
import { glofasAlert, climateFromDaily } from '../sources/glofas.mjs';

describe('levelFromPercent (ThaiWater criteria)', () => {
  test('boundaries', () => {
    assert.equal(levelFromPercent(null), null);
    assert.equal(levelFromPercent(5), 1);
    assert.equal(levelFromPercent(10), 1);
    assert.equal(levelFromPercent(10.1), 2);
    assert.equal(levelFromPercent(30), 2);
    assert.equal(levelFromPercent(50), 3);
    assert.equal(levelFromPercent(70), 3);
    assert.equal(levelFromPercent(70.1), 4);
    assert.equal(levelFromPercent(100), 4);
    assert.equal(levelFromPercent(100.1), 5);
  });
});

describe('rainClass (TMD criteria)', () => {
  test('boundaries', () => {
    assert.equal(rainClass(null), null);
    assert.equal(rainClass(0).key, 0);
    assert.equal(rainClass(0.2).key, 1);
    assert.equal(rainClass(10).key, 1);
    assert.equal(rainClass(10.1).key, 2);
    assert.equal(rainClass(35.1).key, 3);
    assert.equal(rainClass(90).key, 3);
    assert.equal(rainClass(90.1).key, 4);
  });
});

describe('provinceStatus', () => {
  const st = (level, extra = {}) => ({ name: `S${Math.random()}`, level, change24h: 0, ...extra });

  test('normal when nothing triggers', () => {
    const s = provinceStatus({ stations: [st(3), st(2)], rain: [{ name: 'r', rain24h: 5 }] });
    assert.equal(s.level, 0);
    assert.deepEqual(s.reasons, []);
  });
  test('one over-bank station → flood (2)', () => {
    assert.equal(provinceStatus({ stations: [st(5), st(3)] }).level, 2);
  });
  test('three over-bank stations → critical (3)', () => {
    assert.equal(provinceStatus({ stations: [st(5), st(5), st(5)] }).level, 3);
  });
  test('satellite flood area thresholds', () => {
    assert.equal(provinceStatus({ floodRai3d: 10 }).level, 1);
    assert.equal(provinceStatus({ floodRai3d: FLOOD_RAI.flood }).level, 2);
    assert.equal(provinceStatus({ floodRai3d: FLOOD_RAI.critical }).level, 3);
  });
  test('watch signals: high water, fast rise, heavy rain, GloFAS, incidents, TMD', () => {
    assert.equal(provinceStatus({ stations: [st(4)] }).level, 1);
    assert.equal(provinceStatus({ stations: [st(3, { change24h: 0.5 })] }).level, 1);
    assert.equal(provinceStatus({ rain: [{ name: 'r', rain24h: 95 }] }).level, 1);
    assert.equal(provinceStatus({ glofas: [{ name: 'P.7A', alert: 1 }] }).level, 1);
    assert.equal(provinceStatus({ incidents: [{ properties: { sev: 3 } }] }).level, 1);
    assert.equal(provinceStatus({ tmd: { maxRainNext24h: { rain: 95, amphoe: 'คลองลาน' } } }).level, 1);
  });
  test('reasons are sorted most severe first', () => {
    const s = provinceStatus({ stations: [st(4), st(5)], floodRai3d: 60000 });
    assert.equal(s.level, 3);
    const levels = s.reasons.map((r) => r.level);
    assert.deepEqual(levels, [...levels].sort((a, b) => b - a));
  });
});

describe('buildConditions', () => {
  const now = '2026-10-03T12:00:00.000Z';
  const conds = buildConditions({
    stations: [
      { code: 'A', name: 'สถานี A', level: 5, toBank: -0.4, pct: 105, time: now, amphoe: 'เมือง' },
      { code: 'B', name: 'สถานี B', level: 3, change24h: 0.8, time: now },
      { code: 'C', name: 'สถานี C', level: 3, change24h: 0.1, time: now },
    ],
    rain: [
      { code: 'R1', name: 'ฝน 1', rain24h: 95 },
      { code: 'R2', name: 'ฝน 2', rain24h: 40 },
      { code: 'R3', name: 'ฝน 3', rain24h: 20 },
    ],
    flood: { '3days': { sceneDate: '2026-10-02', byAmphoe: [{ amphoe: 'คลองขลุง', rai: 6000, tambons: 3 }, { amphoe: 'ไทรงาม', rai: 0 }] } },
    glofas: [{ id: 'P.7A', name: 'P.7A', alert: 1, peak7: { q: 1100, t: '2026-10-05' } }, { id: 'P.15', alert: 0 }],
    incidents: [
      { properties: { id: 'inc:test', sev: 2, locName: 'ต.นครชุม', amphoe: 'เมืองกำแพงเพชร', title: 'น้ำเอ่อล้น', source: 'ข่าว', hasDdpm: false, time: now } },
    ],
    tmd: {
      maxRainNext24h: { rain: 45, amphoe: 'คลองลาน', condText: 'ฝนฟ้าคะนอง' },
    },
  }, now);
  const ids = conds.map((c) => c.id);

  test('creates one condition per triggered rule', () => {
    assert.deepEqual(new Set(ids), new Set(['wl:A', 'rise:B', 'rain:R1', 'rain:R2', 'flood:คลองขลุง', 'glofas:P.7A', 'inc:test', 'tmd:heavyrain']));
  });
  test('severity mapping', () => {
    const sev = Object.fromEntries(conds.map((c) => [c.id, c.sev]));
    assert.equal(sev['wl:A'], 3);
    assert.equal(sev['rise:B'], 1);
    assert.equal(sev['rain:R1'], 2);
    assert.equal(sev['rain:R2'], 1);
    assert.equal(sev['flood:คลองขลุง'], 2);
    assert.equal(sev['inc:test'], 2);
    assert.equal(sev['tmd:heavyrain'], 1);
  });
  test('sorted by severity', () => {
    const sevs = conds.map((c) => c.sev);
    assert.deepEqual(sevs, [...sevs].sort((a, b) => b - a));
  });
});

describe('diffConditions / mergeTimeline', () => {
  const now = '2026-10-03T12:00:00.000Z';
  const prev = [
    { id: 'a', sev: 1, title: 'ระดับน้ำมาก — A' },
    { id: 'b', sev: 2, title: 'ฝนหนักมาก — B' },
    { id: 'c', sev: 1, title: 'ระดับน้ำขึ้นเร็ว — C' },
  ];
  const curr = [
    { id: 'a', sev: 3, title: 'น้ำล้นตลิ่ง — A' },
    { id: 'b', sev: 1, title: 'ฝนหนัก — B' },
    { id: 'd', sev: 1, title: 'ใหม่ — D' },
  ];
  const events = diffConditions(prev, curr, now);
  const byId = Object.fromEntries(events.map((e) => [e.id, e]));

  test('detects new / up / down / resolved', () => {
    assert.equal(byId.a.change, 'up');
    assert.equal(byId.b.change, 'down');
    assert.equal(byId.d.change, 'new');
    assert.equal(byId.c.change, 'resolved');
    assert.equal(byId.c.sev, 0);
    assert.match(byId.c.title, /คลี่คลาย — C/);
  });
  test('unchanged conditions produce no event', () => {
    assert.equal(diffConditions(curr, curr, now).length, 0);
  });
  test('timeline keeps newest first and caps length', () => {
    const t = mergeTimeline([{ id: 'old' }], [{ id: 'n1' }, { id: 'n2' }], 2);
    assert.deepEqual(t.map((e) => e.id), ['n1', 'n2']);
  });
});

describe('summariseRain', () => {
  test('max and average ignore missing values', () => {
    const s = summariseRain([{ name: 'a', rain24h: 10 }, { name: 'b', rain24h: 30 }, { name: 'c', rain24h: null }]);
    assert.equal(s.stations, 2);
    assert.equal(s.max.name, 'b');
    assert.equal(s.avg, 20);
  });
});

describe('GloFAS', () => {
  test('alert levels from return periods', () => {
    const c = { rp2: 1000, rp5: 1500 };
    assert.equal(glofasAlert(null, c), 0);
    assert.equal(glofasAlert(999, c), 0);
    assert.equal(glofasAlert(1000, c), 1);
    assert.equal(glofasAlert(1500, c), 2);
    assert.equal(glofasAlert(2000, null), 0);
  });
  test('climatology from annual maxima', () => {
    const times = ['2001-01-01', '2001-08-01', '2002-09-01', '2003-10-01', '2003-10-02'];
    const values = [50, 100, 200, 300, null];
    const c = climateFromDaily(times, values);
    assert.equal(c.years, 3);
    assert.equal(c.rp2, 200);
    assert.equal(c.rp5, 300);
    assert.deepEqual(c.record, { q: 300, date: '2003-10-01' });
  });
});
