// Shared helpers for all pages (ES module, no build step).

export const DATA = './data/';

/** Fetch JSON from the site with revalidation (GitHub Pages caches ~10 min). */
export async function getJson(path, { optional = false } = {}) {
  try {
    const res = await fetch(DATA + path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${res.status} ${path}`);
    return await res.json();
  } catch (err) {
    if (optional) return null;
    throw err;
  }
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
