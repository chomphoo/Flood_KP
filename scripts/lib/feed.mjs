// Situation feed: turns observations into human-readable "conditions" (Thai) and a change timeline.
import { RISE_FAST_M_24H, rainClass } from './levels.mjs';
import { round } from './util.mjs';

export const SEVERITY = {
  0: { label: 'ข้อมูล', key: 'info' },
  1: { label: 'เฝ้าระวัง', key: 'watch' },
  2: { label: 'เตือนภัย', key: 'warn' },
  3: { label: 'อันตราย', key: 'danger' },
};

const fmt = (n, d = 0) => (n == null ? '-' : Number(n).toLocaleString('th-TH', { maximumFractionDigits: d, minimumFractionDigits: d }));
const where = (s) => [s.tambon && `ต.${s.tambon}`, s.amphoe && `อ.${s.amphoe}`].filter(Boolean).join(' ');

/** Build the list of current conditions from normalised source data. */
export function buildConditions({ stations = [], rain = [], flood = null, glofas = [] }, nowIso = new Date().toISOString()) {
  const out = [];
  for (const s of stations) {
    const base = { cat: 'water', source: 'สสน. (ThaiWater)', time: s.time || nowIso, lat: s.lat, lon: s.lon, amphoe: s.amphoe, ref: s.code };
    if (s.level === 5) {
      out.push({ ...base, id: `wl:${s.code}`, sev: 3, title: `น้ำล้นตลิ่ง — ${s.name}`, detail: `สูงกว่าตลิ่ง ${fmt(Math.abs(s.toBank ?? 0), 2)} ม. (${fmt(s.pct)}% ของความจุลำน้ำ) · ${s.river || ''} ${where(s)}`.trim() });
    } else if (s.level === 4) {
      out.push({ ...base, id: `wl:${s.code}`, sev: 2, title: `ระดับน้ำมาก — ${s.name}`, detail: `ต่ำกว่าตลิ่ง ${fmt(s.toBank, 2)} ม. (${fmt(s.pct)}% ของความจุลำน้ำ) · ${s.river || ''} ${where(s)}`.trim() });
    }
    if (s.change24h != null && s.change24h >= RISE_FAST_M_24H) {
      out.push({ ...base, id: `rise:${s.code}`, sev: s.level >= 4 ? 2 : 1, title: `ระดับน้ำขึ้นเร็ว — ${s.name}`, detail: `+${fmt(s.change24h, 2)} ม. ใน 24 ชม. · ${where(s)}` });
    }
  }
  for (const r of rain) {
    const c = rainClass(r.rain24h);
    if (!c || c.key < 3) continue;
    out.push({
      id: `rain:${r.code}`, cat: 'rain', sev: c.key === 4 ? 2 : 1, source: `${r.agency || 'สสน.'} (ThaiWater)`, time: r.time || nowIso,
      lat: r.lat, lon: r.lon, amphoe: r.amphoe, ref: r.code,
      title: `${c.label} — ${r.name}`, detail: `ฝนสะสม 24 ชม. ${fmt(r.rain24h, 1)} มม. · ${where(r)}`,
    });
  }
  const p3 = flood?.['3days'];
  if (p3) {
    for (const a of p3.byAmphoe || []) {
      if (!a.rai || a.rai < 1) continue;
      out.push({
        id: `flood:${a.amphoe}`, cat: 'flood', sev: a.rai >= 5000 ? 2 : 1, source: 'GISTDA (ดาวเทียม)', time: p3.sceneDate ? `${p3.sceneDate}T12:00:00+07:00` : nowIso,
        amphoe: a.amphoe, ref: a.amphoe,
        title: `พบพื้นที่น้ำท่วม — อ.${a.amphoe}`,
        detail: `${fmt(a.rai)} ไร่ ใน ${a.tambons} ตำบล${a.population ? ` · ประชากรในพื้นที่ประมาณ ${fmt(a.population)} คน` : ''} (ภาพดาวเทียม 3 วันล่าสุด)`,
      });
    }
  }
  for (const g of glofas) {
    if (!g.alert || !g.peak7) continue;
    out.push({
      id: `glofas:${g.id}`, cat: 'forecast', sev: g.alert, source: 'Copernicus GloFAS', time: nowIso, lat: g.lat, lon: g.lon, ref: g.id,
      title: `คาดการณ์น้ำแม่น้ำปิงสูงกว่าปกติ — ${g.name}`,
      detail: `ปริมาณน้ำสูงสุดใน 7 วัน ~${fmt(g.peak7.q)} ลบ.ม./วินาที (${g.peak7.t}) เกินระดับคาบการเกิด ${g.alert === 2 ? '5' : '2'} ปี`,
    });
  }
  return out.sort((a, b) => b.sev - a.sev || String(b.time).localeCompare(String(a.time)));
}

/** Compare previous and current conditions → timeline events (new, escalated, eased, resolved). */
export function diffConditions(prev = [], curr = [], nowIso = new Date().toISOString()) {
  const before = new Map(prev.map((c) => [c.id, c]));
  const after = new Map(curr.map((c) => [c.id, c]));
  const events = [];
  for (const c of curr) {
    const p = before.get(c.id);
    if (!p) events.push({ ...c, change: 'new', at: nowIso });
    else if (c.sev > p.sev) events.push({ ...c, change: 'up', at: nowIso });
    else if (c.sev < p.sev) events.push({ ...c, change: 'down', at: nowIso });
  }
  for (const p of prev) {
    if (!after.has(p.id)) events.push({ ...p, sev: 0, change: 'resolved', at: nowIso, title: `สถานการณ์คลี่คลาย — ${p.title.split(' — ')[1] || p.title}`, detail: `ไม่พบเงื่อนไข "${p.title.split(' — ')[0]}" แล้ว` });
  }
  return events;
}

export function mergeTimeline(prevTimeline = [], events = [], max = 200) {
  return [...events, ...prevTimeline].slice(0, max);
}

export const summariseRain = (rain) => {
  const vals = rain.filter((r) => r.rain24h != null);
  const max = vals.reduce((m, r) => (r.rain24h > (m?.rain24h ?? -1) ? r : m), null);
  return { stations: vals.length, max: max ? { name: max.name, amphoe: max.amphoe, mm: max.rain24h } : null, avg: vals.length ? round(vals.reduce((s, r) => s + r.rain24h, 0) / vals.length, 1) : null };
};
