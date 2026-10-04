import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyArticle, makeLocationMatcher, buildIncidents, isRoadReport } from '../sources/incidents.mjs';
import { buildConditions } from '../lib/feed.mjs';
import { pickNotifiable, buildNtfyMessage } from '../lib/notify.mjs';

const GAZ = [
  { type: 'amphoe', name: 'เมืองกำแพงเพชร', amphoe: 'เมืองกำแพงเพชร', lon: 99.52, lat: 16.48 },
  { type: 'amphoe', name: 'คลองลาน', amphoe: 'คลองลาน', lon: 99.3, lat: 16.2 },
  { type: 'tambon', name: 'คลองลานพัฒนา', amphoe: 'คลองลาน', lon: 99.31, lat: 16.21 },
  { type: 'tambon', name: 'ในเมือง', amphoe: 'เมืองกำแพงเพชร', lon: 99.53, lat: 16.47 },
  { type: 'tambon', name: 'โป่งน้ำร้อน', amphoe: 'คลองลาน', lon: 99.2, lat: 16.1 },
];

test('classifyArticle: recovery caps severity, older news decays', () => {
  assert.deepEqual(classifyArticle('น้ำป่าทะลักท่วมหมู่บ้าน อพยพด่วน'), { sev: 3, recovering: false });
  assert.deepEqual(classifyArticle('น้ำลดแล้ว ชาวบ้านกวาดโคลน หลังน้ำป่า'), { sev: 1, recovering: true });
  assert.equal(classifyArticle('น้ำป่าทะลัก', 4).sev, 2);
  assert.equal(classifyArticle('น้ำป่าทะลัก', 8).sev, 1);
  assert.equal(classifyArticle('น้ำท่วมขัง', 10).sev, 1);
});

test('makeLocationMatcher: tambon beats amphoe, อ.เมือง handling', () => {
  const m = makeLocationMatcher(GAZ);
  assert.equal(m('น้ำท่วม ต.คลองลานพัฒนา อ.คลองลาน').name, 'คลองลานพัฒนา');
  assert.equal(m('น้ำป่าไหลหลาก อ.คลองลาน').name, 'คลองลาน');
  assert.equal(m('น้ำท่วมถนนใน อ.เมือง จ.กำแพงเพชร').name, 'เมืองกำแพงเพชร');
  assert.equal(m('น้ำท่วม อ.เมือง จ.ตาก'), null);
  assert.equal(m('น้ำท่วมหนักในเมืองหลายจุด'), null, 'bare "ในเมือง" is a common phrase, not the tambon');
  assert.equal(m('น้ำท่วม ต.ในเมือง').name, 'ในเมือง');
});

test('buildIncidents: unmatched → provinceNews, recovering phase, roads', () => {
  const now = Date.parse('2026-10-04T12:00:00Z');
  const t = (h) => new Date(now - h * 3600e3).toUTCString();
  const res = buildIncidents([
    { title: 'กำแพงเพชร น้ำท่วมหลายพื้นที่ - ข่าวA', source: 'ข่าวA', link: 'a', pubDate: t(2) },
    { title: 'น้ำป่าทะลัก ต.โป่งน้ำร้อน อพยพ', source: 'ข่าวB', link: 'b', pubDate: t(30) },
    { title: 'น้ำลดแล้ว ต.โป่งน้ำร้อน ชาวบ้านกวาดโคลน หลังน้ำท่วม', source: 'ข่าวC', link: 'c', pubDate: t(3) },
    { title: 'น้ำท่วมถนน ทางหลวง 1 อ.คลองลาน รถเล็กผ่านไม่ได้', source: 'ข่าวD', link: 'd', pubDate: t(5) },
    { title: 'น้ำท่วมเก่ามาก อ.คลองลาน', source: 'ข่าวE', link: 'e', pubDate: t(24 * 20) },
  ], GAZ, now);
  assert.equal(res.provinceNews.length, 1);
  assert.equal(res.provinceNews[0].title, 'กำแพงเพชร น้ำท่วมหลายพื้นที่', 'source suffix stripped');
  const pong = res.features.find((f) => f.properties.tambon === 'โป่งน้ำร้อน');
  assert.equal(pong.properties.phase, 'recovering');
  assert.equal(pong.properties.sev, 1);
  assert.equal(pong.id, 'inc:คลองลาน:โป่งน้ำร้อน');
  assert.equal(res.roads.length, 1);
  assert.match(res.roads[0].locName, /คลองลาน/);
  assert.ok(!res.features.some((f) => f.properties.articles.some((a) => a.url === 'e')), 'older than 14 days dropped');
});

test('isRoadReport needs a road word and a closure word', () => {
  assert.ok(isRoadReport('น้ำท่วมถนนสาย 1 ปิดการจราจร'));
  assert.ok(!isRoadReport('น้ำท่วมนาข้าว'));
});

test('buildConditions: province news has no coordinates; TMD uses rolling 24h', () => {
  const conds = buildConditions({
    incidents: { features: [], provinceNews: [{ title: 'ข่าว', source: 'X', sev: 3, time: '2026-10-04T00:00:00Z' }] },
    tmd: { maxRainNext24h: { amphoe: 'คลองลาน', rain: 95, peakTime: '2026-10-04T15:00:00+07:00' } },
  });
  const pn = conds.find((c) => c.id === 'news:province');
  assert.equal(pn.lat, undefined);
  assert.equal(pn.sev, 2);
  const t = conds.find((c) => c.id === 'tmd:heavyrain');
  assert.equal(t.sev, 2);
  assert.match(t.detail, /24 ชม\. ข้างหน้า/);
});

test('notify: only new/up with sev >= 2, merged into one message', () => {
  const ev = [
    { change: 'new', sev: 3, title: 'น้ำล้นตลิ่ง — A' },
    { change: 'up', sev: 2, title: 'ระดับน้ำมาก — B' },
    { change: 'new', sev: 1, title: 'x' },
    { change: 'resolved', sev: 0, title: 'y' },
    { change: 'down', sev: 2, title: 'z' },
  ];
  const picked = pickNotifiable(ev);
  assert.equal(picked.length, 2);
  const msg = buildNtfyMessage(picked, { topic: 't', siteUrl: 'u' });
  assert.equal(msg.priority, 4);
  assert.match(msg.message, /น้ำล้นตลิ่ง/);
  assert.equal(buildNtfyMessage([], { topic: 't' }), null);
});
