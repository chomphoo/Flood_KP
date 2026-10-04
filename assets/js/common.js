// Shared helpers for all pages (ES module, no build step).

export const DATA = './data/';

/** Fetch JSON from the site with revalidation (GitHub Pages caches ~10 min). */
export async function getJson(path, { optional = false } = {}) {
  try {
    const res = await fetch(DATA + path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${res.status} ${path}`);
    if (res.headers.get('x-sw-cache')) offlineState.usedCache = true;
    return await res.json();
  } catch (err) {
    if (optional) return null;
    throw err;
  }
}
/** Set by getJson when the service worker answered from its offline cache. */
export const offlineState = { usedCache: false };

/** Decode the compact hexagon format written by scripts/lib/pack.mjs (keep in sync). */
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

/** Load `x.geojson` via its smaller `x.pack.json` copy when available. */
export async function getGeo(path, { optional = false } = {}) {
  const packed = await getJson(path.replace(/\.geojson$/, '.pack.json'), { optional: true });
  if (packed?.v === 1) return unpackGeo(packed);
  return getJson(path, { optional });
}

/** Load a classic script once (used to lazy-load Chart.js). */
const scriptCache = {};
export function loadScript(src) {
  return (scriptCache[src] ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => {
      delete scriptCache[src];
      reject(new Error(`load failed: ${src}`));
    };
    document.head.append(s);
  }));
}

/** Water-level trend from the 24 h change (m). */
export function trendArrow(change) {
  if (change == null || Number.isNaN(+change)) return { sym: '', cls: 'flat', label: 'ไม่มีข้อมูลแนวโน้ม' };
  if (change >= 0.5) return { sym: '⇈', cls: 'up2', label: `ขึ้นเร็ว ${signed(change)} ม./24 ชม.` };
  if (change >= 0.05) return { sym: '↑', cls: 'up', label: `ขึ้น ${signed(change)} ม./24 ชม.` };
  if (change <= -0.05) return { sym: '↓', cls: 'down', label: `ลง ${signed(change)} ม./24 ชม.` };
  return { sym: '→', cls: 'flat', label: 'ทรงตัว' };
}
export const trendHtml = (change) => {
  const t = trendArrow(change);
  return t.sym ? `<span class="trend trend-${t.cls}" title="${esc(t.label)}" aria-label="${esc(t.label)}">${t.sym}</span>` : '';
};

// ---------- geometry ----------
/** Great-circle distance in km. */
export function distKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Point-in-(Multi)Polygon for GeoJSON geometry, holes respected. */
export function pointInGeom(lon, lat, geom) {
  if (!geom) return false;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  return polys.some((rings) => inRing(lon, lat, rings[0]) && !rings.slice(1).some((h) => inRing(lon, lat, h)));
}

// ---------- formatting (Thai locale, Buddhist calendar) ----------
const nf0 = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
export const fmt = (v, d = 0) => (v == null || Number.isNaN(+v) ? '–' : (d === 0 ? nf0 : d === 1 ? nf1 : nf2).format(+v));
export const signed = (v, d = 2) => (v == null ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${fmt(Math.abs(v), d)}`);

const dtf = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
const df = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'Asia/Bangkok' });
const tf = new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
export const fmtDateTime = (iso) => (iso ? `${dtf.format(new Date(iso))} น.` : '–');
export const fmtDate = (iso) => (iso ? df.format(new Date(iso.length === 10 ? `${iso}T12:00:00+07:00` : iso)) : '–');
export const fmtTime = (iso) => (iso ? `${tf.format(new Date(iso))} น.` : '–');
export const beYear = (y) => +y + 543;

const rtf = new Intl.RelativeTimeFormat('th-TH', { numeric: 'auto' });
export function ago(iso) {
  if (!iso) return '–';
  const s = (new Date(iso) - Date.now()) / 1000;
  const a = Math.abs(s);
  if (a < 60) return 'เมื่อสักครู่';
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  return rtf.format(Math.round(s / 86400), 'day');
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- domain ----------
export const LEVEL = {
  1: { label: 'น้ำน้อยวิกฤต', color: '#c2410c' },
  2: { label: 'น้ำน้อย', color: '#eab308' },
  3: { label: 'ปกติ', color: '#22c55e' },
  4: { label: 'น้ำมาก', color: '#f97316' },
  5: { label: 'ล้นตลิ่ง', color: '#ef4444' },
};
export const SEV = {
  0: { label: 'ข้อมูล', color: '#38bdf8' },
  1: { label: 'เฝ้าระวัง', color: '#facc15' },
  2: { label: 'เตือนภัย', color: '#fb923c' },
  3: { label: 'อันตราย', color: '#f43f5e' },
};
export function rainColor(mm) {
  if (mm == null) return '#475569';
  if (mm > 90) return '#f43f5e';
  if (mm > 35) return '#fb923c';
  if (mm > 10) return '#38bdf8';
  if (mm > 0) return '#7dd3fc';
  return '#475569';
}
export function rainLabel(mm) {
  if (mm == null) return 'ไม่มีข้อมูล';
  if (mm > 90) return 'ฝนหนักมาก';
  if (mm > 35) return 'ฝนหนัก';
  if (mm > 10) return 'ฝนปานกลาง';
  if (mm > 0) return 'ฝนเล็กน้อย';
  return 'ไม่มีฝน';
}
/** Flood-frequency ramp (number of flood years, 1–14). */
export const FREQ_COLORS = ['#fde68a', '#fcd34d', '#fbbf24', '#fb923c', '#f97316', '#ef4444', '#dc2626', '#be123c', '#9d174d'];
export function freqColor(n, max = 14) {
  if (!n) return 'transparent';
  const i = Math.min(FREQ_COLORS.length - 1, Math.floor(((n - 1) / Math.max(1, max - 1)) * (FREQ_COLORS.length - 1) * 1.6));
  return FREQ_COLORS[i];
}

export const ICONS = {
  water: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/></svg>',
  rain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2"/><path d="M16 14v6"/><path d="M8 14v6"/><path d="M12 16v6"/></svg>',
  flood: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/></svg>',
  forecast: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>',
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  incident: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  locate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>',
  road: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22 8 2M20 22 16 2M12 4v3M12 11v3M12 18v3"/></svg>',
};

/** Light-dismiss fallback for <dialog closedby="any"> (Safari has no `closedby` yet). */
export function enableLightDismiss(dialog) {
  if ('closedBy' in HTMLDialogElement.prototype) return;
  dialog.addEventListener('click', (e) => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    const inside = r.top <= e.clientY && e.clientY <= r.bottom && r.left <= e.clientX && e.clientX <= r.right;
    if (!inside) dialog.close();
  });
}

/** Shared Chart.js defaults for the dark theme. */
export function chartDefaults(Chart) {
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.color = '#94a3b8';
  Chart.defaults.borderColor = 'rgba(148,163,184,0.12)';
  Chart.defaults.plugins.legend.labels.boxWidth = 12;
  Chart.defaults.plugins.tooltip.backgroundColor = '#0d1424';
  Chart.defaults.plugins.tooltip.borderColor = 'rgba(148,163,184,0.28)';
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.maintainAspectRatio = false;
}
