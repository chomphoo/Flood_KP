// Thresholds, labels and the province-wide status rules (shared by build scripts and unit tests).

/** ThaiWater water-situation levels (percent of channel capacity). */
export const LEVELS = {
  1: { label: 'น้ำน้อยวิกฤต', range: '≤ 10%' },
  2: { label: 'น้ำน้อย', range: '10–30%' },
  3: { label: 'ปกติ', range: '30–70%' },
  4: { label: 'น้ำมาก', range: '70–100%' },
  5: { label: 'ล้นตลิ่ง', range: '> 100%' },
};

export function levelFromPercent(pct) {
  if (pct == null || Number.isNaN(+pct)) return null;
  if (pct > 100) return 5;
  if (pct > 70) return 4;
  if (pct > 30) return 3;
  if (pct > 10) return 2;
  return 1;
}

/** TMD 24-hour rainfall criteria. */
export function rainClass(mm) {
  if (mm == null) return null;
  if (mm > 90) return { key: 4, label: 'ฝนหนักมาก' };
  if (mm > 35) return { key: 3, label: 'ฝนหนัก' };
  if (mm > 10) return { key: 2, label: 'ฝนปานกลาง' };
  if (mm > 0) return { key: 1, label: 'ฝนเล็กน้อย' };
  return { key: 0, label: 'ไม่มีฝน' };
}

export const RISE_FAST_M_24H = 0.5; // ระดับน้ำขึ้นเร็ว ≥ 0.5 ม. ใน 24 ชม.

export const STATUS = [
  { level: 0, key: 'normal', label: 'ปกติ', desc: 'ไม่พบสัญญาณน้ำท่วม' },
  { level: 1, key: 'watch', label: 'เฝ้าระวัง', desc: 'มีสัญญาณที่ต้องติดตามใกล้ชิด' },
  { level: 2, key: 'flood', label: 'น้ำท่วมบางพื้นที่', desc: 'พบน้ำล้นตลิ่งหรือพื้นที่น้ำท่วม' },
  { level: 3, key: 'critical', label: 'วิกฤต', desc: 'น้ำท่วมเป็นวงกว้าง' },
];

export const FLOOD_RAI = { flood: 1000, critical: 50000 };

/**
 * Province-wide status from the latest observations. Returns the highest level any rule triggers,
 * with every triggered reason (Thai) so the UI can explain *why*.
 */
export function provinceStatus({ stations = [], rain = [], floodRai3d = 0, glofas = [], incidents = [], tmd = null }) {
  const reasons = [];
  let level = 0;
  const raise = (l, text) => {
    reasons.push({ level: l, text });
    if (l > level) level = l;
  };
  const over = stations.filter((s) => s.level === 5);
  const high = stations.filter((s) => s.level === 4);
  const rising = stations.filter((s) => s.change24h != null && s.change24h >= RISE_FAST_M_24H);
  const maxRain = rain.reduce((m, r) => (r.rain24h != null && r.rain24h > (m?.rain24h ?? -1) ? r : m), null);

  if (over.length >= 3) raise(3, `น้ำล้นตลิ่ง ${over.length} สถานี`);
  else if (over.length) raise(2, `น้ำล้นตลิ่ง ${over.length} สถานี (${over.map((s) => s.name).join(', ')})`);
  if (floodRai3d >= FLOOD_RAI.critical) raise(3, `ภาพดาวเทียมพบพื้นที่น้ำท่วม ${fmtInt(floodRai3d)} ไร่`);
  else if (floodRai3d >= FLOOD_RAI.flood) raise(2, `ภาพดาวเทียมพบพื้นที่น้ำท่วม ${fmtInt(floodRai3d)} ไร่`);
  else if (floodRai3d > 0) raise(1, `ภาพดาวเทียมพบพื้นที่น้ำท่วม ${fmtInt(floodRai3d)} ไร่`);
  if (high.length) raise(1, `ระดับน้ำมาก ${high.length} สถานี`);
  if (rising.length) raise(1, `ระดับน้ำขึ้นเร็ว ${rising.length} สถานี`);
  if (maxRain && maxRain.rain24h > 90) raise(1, `ฝนหนักมาก ${maxRain.rain24h} มม. ที่ ${maxRain.name}`);
  for (const g of glofas) {
    if (g.alert >= 1) raise(1, `คาดการณ์น้ำในแม่น้ำปิง (${g.name}) สูงกว่าปกติ`);
  }
  const incList = Array.isArray(incidents) ? incidents : (incidents?.features || []);
  if (incList.length) {
    const sev3 = incList.filter((i) => (i.properties?.sev ?? i.sev) >= 3);
    if (sev3.length) raise(1, `มีรายงานสถานการณ์น้ำท่วม ${sev3.length} จุดจากข่าวและ ปภ.`);
  }
  if (tmd?.maxRainNext24h && tmd.maxRainNext24h.rain > 90) {
    raise(1, `กรมอุตุฯ พยากรณ์ฝนตกหนักมาก ~${fmtInt(tmd.maxRainNext24h.rain)} มม. (อ.${tmd.maxRainNext24h.amphoe})`);
  }
  return { ...STATUS[level], reasons: reasons.sort((a, b) => b.level - a.level) };
}

export const fmtInt = (n) => Math.round(n).toLocaleString('th-TH');
