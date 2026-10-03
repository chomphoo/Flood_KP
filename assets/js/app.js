// Flood KP – main map page
import {
  getJson, fmt, signed, fmtDateTime, fmtDate, fmtTime, ago, esc, beYear,
  LEVEL, SEV, rainColor, rainLabel, freqColor, ICONS, enableLightDismiss, chartDefaults,
} from './common.js';

const REFRESH_MS = 5 * 60 * 1000;
const state = {
  status: null, stations: [], rain: [], feed: null, meta: null, floodSummary: null, glofas: [],
  incidents: null, tmd: null,
  series: null, freq: null, amphoe: '', districtBounds: {}, generatedAt: null,
};
const $ = (id) => document.getElementById(id);

// =============== Map setup ===============
const map = L.map('map', { zoomControl: false, minZoom: 7, maxZoom: 18, attributionControl: true }).setView([16.2, 99.6], 9);
L.control.zoom({ position: 'bottomright' }).addTo(map);
map.attributionControl.setPrefix(false);

// CARTO raster tiles now require an API key, so the dark theme uses Esri's keyless Dark Gray Canvas.
const ESRI_CANVAS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';
const BASES = {
  dark: L.layerGroup([
    L.tileLayer(`${ESRI_CANVAS}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, { maxNativeZoom: 16, maxZoom: 19, attribution: 'แผนที่ © Esri, HERE, Garmin, © OpenStreetMap contributors' }),
    L.tileLayer(`${ESRI_CANVAS}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, { maxNativeZoom: 16, maxZoom: 19, opacity: 0.8 }),
  ]),
  osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }),
  sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'ภาพ © Esri, Maxar, Earthstar Geographics' }),
};
let base = BASES.dark.addTo(map);

for (const [name, z] of [['mask', 350], ['risk', 370], ['flood', 380], ['districts', 400], ['radar', 420], ['rain', 590]]) {
  map.createPane(name).style.zIndex = z;
}
map.getPane('mask').style.pointerEvents = 'none';
map.getPane('radar').style.pointerEvents = 'none';
const floodRenderer = L.canvas({ pane: 'flood', padding: 0.3 });
const riskRenderer = L.canvas({ pane: 'risk', padding: 0.3 });

const layers = {
  districts: L.layerGroup().addTo(map),
  incidents: L.layerGroup().addTo(map),
  stations: L.layerGroup().addTo(map),
  rain: L.layerGroup().addTo(map),
  tmd: L.layerGroup().addTo(map),
  flood: L.layerGroup().addTo(map),
  risk: L.layerGroup(),
  radar: L.layerGroup(),
};

map.on('zoomend', () => map.getContainer().classList.toggle('hide-labels', map.getZoom() < 9));

// =============== Static layers ===============
async function loadStatic() {
  const [amphoe, province] = await Promise.all([getJson('static/amphoe.geojson'), getJson('static/province.geojson', { optional: true })]);
  if (province?.features?.length) {
    const world = [[-90, -180], [-90, 180], [90, 180], [90, -180]];
    const holes = province.features[0].geometry.coordinates.map((poly) => poly[0].map(([x, y]) => [y, x]));
    L.polygon([world, ...holes], { pane: 'mask', stroke: false, fillColor: '#020617', fillOpacity: 0.5, interactive: false }).addTo(map);
    const outline = L.geoJSON(province, { pane: 'districts', interactive: false, style: { color: '#2dd4bf', weight: 2.2, opacity: 0.85, fill: false } }).addTo(layers.districts);
    map.fitBounds(outline.getBounds(), { padding: [20, 20] });
  }
  const sel = $('amphoe-filter');
  L.geoJSON(amphoe, {
    pane: 'districts',
    style: { color: '#94a3b8', weight: 1, opacity: 0.55, dashArray: '4 4', fillOpacity: 0, fillColor: '#2dd4bf' },
    onEachFeature: (f, layer) => {
      const name = f.properties.name;
      state.districtBounds[name] = layer.getBounds();
      layer.bindTooltip(name, { permanent: true, direction: 'center', className: 'district-label', interactive: false });
      layer.on('mouseover', () => layer.setStyle({ fillOpacity: 0.06, opacity: 0.9 }));
      layer.on('mouseout', () => layer.setStyle({ fillOpacity: 0, opacity: 0.55 }));
      layer.on('click', () => setAmphoe(name, true));
    },
  }).addTo(layers.districts);
  for (const f of [...amphoe.features].sort((a, b) => a.properties.name.localeCompare(b.properties.name, 'th'))) {
    sel.add(new Option(`อ.${f.properties.name}`, f.properties.name));
  }
  sel.addEventListener('change', () => setAmphoe(sel.value, true));
}

function setAmphoe(name, zoom) {
  state.amphoe = name;
  $('amphoe-filter').value = name;
  renderLists();
  renderTmdForecast();
  if (zoom && name && state.districtBounds[name]) map.flyToBounds(state.districtBounds[name], { padding: [30, 30], duration: 0.8 });
}

// =============== Live data ===============
async function loadLive() {
  const [status, stations, feed, meta, floodSummary, glofas, incidents, tmd] = await Promise.all([
    getJson('live/status.json'),
    getJson('live/stations.json'),
    getJson('live/feed.json'),
    getJson('live/meta.json', { optional: true }),
    getJson('live/flood_summary.json', { optional: true }),
    getJson('live/glofas.json', { optional: true }),
    getJson('live/incidents.geojson', { optional: true }),
    getJson('live/tmd_forecast.json', { optional: true }),
  ]);
  Object.assign(state, {
    status, feed, meta, floodSummary, incidents, tmd,
    stations: stations.stations || [], rain: stations.rain || [], glofas: glofas?.points || [],
    generatedAt: status.generatedAt, series: null,
  });
  renderAll();
  await drawFlood();
}

function renderAll() {
  renderHeader();
  renderStatus();
  renderKpis();
  renderLists();
  renderTmdForecast();
  renderSources();
  drawIncidents();
  drawStations();
  drawRain();
  drawTmd();
  renderLegend();
}

function renderHeader() {
  $('updated-text').textContent = `${fmtTime(state.generatedAt)} (${ago(state.generatedAt)})`;
  $('updated-pill').title = `ระบบอัปเดตล่าสุด ${fmtDateTime(state.generatedAt)}`;
  const stale = Date.now() - new Date(state.generatedAt) > 90 * 60 * 1000;
  $('live-dot').classList.toggle('stale', stale);
}

function renderStatus() {
  const s = state.status.status;
  $('status-hero').dataset.level = s.level;
  $('status-label').textContent = s.label;
  $('status-desc').textContent = s.desc;
  $('status-reasons').innerHTML = (s.reasons || []).slice(0, 5).map((r) => `<li data-level="${r.level}">${esc(r.text)}</li>`).join('');
}

function renderKpis() {
  const k = state.status.kpi;
  const lc = k.levelCounts || {};
  const p7 = state.glofas.find((g) => g.id === 'P.7A') || state.glofas[0];
  const maxAlert = Math.max(0, ...state.glofas.map((g) => g.alert || 0));
  const rainMax = k.rain?.max;
  const rainSev = rainMax?.mm > 90 ? 2 : rainMax?.mm > 35 ? 1 : 0;
  const floodSev = k.floodRai3d >= 50000 ? 3 : k.floodRai3d >= 1000 ? 2 : k.floodRai3d > 0 ? 1 : 0;
  const cards = [
    { sev: lc[5] ? 3 : lc[4] ? 2 : 0, icon: ICONS.water, label: 'สถานีน้ำล้นตลิ่ง', value: fmt(lc[5] || 0), unit: `/ ${k.stations}`, sub: `น้ำมาก ${fmt(lc[4] || 0)} · ปกติ ${fmt(lc[3] || 0)} สถานี` },
    { sev: rainSev, icon: ICONS.rain, label: 'ฝนสูงสุด 24 ชม.', value: fmt(rainMax?.mm, 1), unit: 'มม.', sub: rainMax ? `${rainMax.name} อ.${rainMax.amphoe}` : 'ไม่มีข้อมูล' },
    { sev: floodSev, icon: ICONS.flood, label: 'พื้นที่น้ำท่วม (ดาวเทียม)', value: k.floodRai3d != null ? fmt(k.floodRai3d) : '–', unit: 'ไร่', sub: k.floodSceneDate ? `${fmt(k.floodTambons3d)} ตำบล · ภาพ ${fmtDate(k.floodSceneDate)}` : 'ยังไม่มีข้อมูลดาวเทียม' },
    { sev: maxAlert, icon: ICONS.forecast, label: 'คาดการณ์แม่น้ำปิง 7 วัน', value: p7?.peak7 ? fmt(p7.peak7.q) : '–', unit: 'ลบ.ม./วิ', sub: p7?.climate ? `${maxAlert ? 'สูงกว่าปกติ' : 'ปกติ'} · คาบ 2 ปี ${fmt(p7.climate.rp2)}` : 'GloFAS' },
  ];
  $('kpis').innerHTML = cards.map((c) => `
    <div class="kpi" data-sev="${c.sev}">
      <span class="kpi-label">${esc(c.label)}</span>
      <span class="kpi-value">${c.value}<small>${esc(c.unit)}</small></span>
      <span class="kpi-sub" title="${esc(c.sub)}">${esc(c.sub)}</span>
    </div>`).join('');
}

// ---------- Lists ----------
const CHANGE = { new: 'ใหม่', up: 'รุนแรงขึ้น', down: 'ลดระดับ', resolved: 'คลี่คลาย' };
const byAmphoe = (x) => !state.amphoe || x.amphoe === state.amphoe;

function feedItem(c, { timeline = false } = {}) {
  const icon = c.change === 'resolved' ? ICONS.ok : ICONS[c.cat] || ICONS.water;
  const sev = SEV[c.sev] || SEV[0];
  const when = timeline ? c.at : c.time;
  return `
    <li class="feed-item" data-sev="${c.sev}" data-change="${c.change || ''}" data-id="${esc(c.id)}" tabindex="0" role="button">
      <span class="feed-icon" aria-hidden="true">${icon}</span>
      <div>
        <div class="feed-title">${esc(c.title)}</div>
        <div class="feed-detail">${esc(c.detail)}</div>
        <div class="feed-meta">
          <span class="badge" style="--c:${c.change === 'resolved' ? 'var(--ok)' : sev.color}">${timeline && c.change ? CHANGE[c.change] : sev.label}</span>
          <span>${esc(c.source)}</span>
          <span title="${esc(fmtDateTime(when))}">${ago(when)}</span>
        </div>
      </div>
    </li>`;
}

function renderLists() {
  const conds = (state.feed?.conditions || []).filter(byAmphoe);
  const tl = (state.feed?.timeline || []).filter(byAmphoe).slice(0, 60);
  $('count-now').textContent = conds.length;
  $('feed-now').innerHTML = conds.length
    ? conds.map((c) => feedItem(c)).join('')
    : `<li class="empty">${state.amphoe ? `ไม่พบสถานการณ์ที่ต้องเฝ้าระวังใน อ.${esc(state.amphoe)}` : 'ไม่พบสถานการณ์ที่ต้องเฝ้าระวัง'}</li>`;
  $('feed-timeline').innerHTML = tl.length ? tl.map((c) => feedItem(c, { timeline: true })).join('') : '<li class="empty">ยังไม่มีความเคลื่อนไหว</li>';

  const sts = state.stations.filter(byAmphoe).sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
  $('station-list').innerHTML = sts.length
    ? sts.map((s) => `
      <button class="station-row" data-lv="${s.level}" data-code="${esc(s.code)}">
        <span class="st-name">${esc(s.name)} <span class="muted" style="font-weight:400">(${esc(s.code)})</span></span>
        <span class="st-pct">${fmt(s.pct)}%</span>
        <span class="st-sub">${esc(LEVEL[s.level]?.label || '-')} · ${s.toBank != null ? (s.toBank >= 0 ? `ต่ำกว่าตลิ่ง ${fmt(s.toBank, 2)} ม.` : `สูงกว่าตลิ่ง ${fmt(-s.toBank, 2)} ม.`) : ''} · อ.${esc(s.amphoe)}</span>
        <span class="st-bar" aria-hidden="true"><i style="width:${Math.max(2, Math.min(100, ((s.pct ?? 0) / 130) * 100))}%"></i></span>
      </button>`).join('')
    : '<div class="empty">ไม่มีสถานีวัดระดับน้ำในอำเภอนี้</div>';
}

function onFeedActivate(e) {
  const li = e.target.closest('.feed-item');
  if (!li) return;
  const id = li.dataset.id;
  const c = [...(state.feed?.conditions || []), ...(state.feed?.timeline || [])].find((x) => x.id === id);
  if (!c) return;
  if (c.cat === 'incident') {
    setLayer('incidents', true);
    const m = incidentMarkers.get(c.id || c.ref);
    if (m) {
      map.flyTo(m.getLatLng(), 13, { duration: 0.8 });
      setTimeout(() => m.openPopup(), 850);
    } else if (c.lat && c.lon) {
      map.flyTo([c.lat, c.lon], 13, { duration: 0.8 });
    }
    return;
  }
  if (c.cat === 'water' && c.ref) return openStation(c.ref, true);
  if (c.cat === 'flood' && state.districtBounds[c.amphoe]) {
    setLayer('flood', true);
    return map.flyToBounds(state.districtBounds[c.amphoe], { padding: [30, 30], duration: 0.8 });
  }
  if (c.cat === 'forecast' && c.ref) return openStation(c.ref, true);
  if (c.lat && c.lon) map.flyTo([c.lat, c.lon], 12, { duration: 0.8 });
}
for (const id of ['feed-now', 'feed-timeline']) {
  $(id).addEventListener('click', onFeedActivate);
  $(id).addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onFeedActivate(e)));
}
$('station-list').addEventListener('click', (e) => {
  const b = e.target.closest('.station-row');
  if (b) openStation(b.dataset.code, true);
});

// Tabs
const TABS = ['now', 'timeline', 'stations'];
for (const t of TABS) {
  $(`tab-${t}`).addEventListener('click', () => {
    for (const o of TABS) {
      $(`tab-${o}`).setAttribute('aria-selected', String(o === t));
      $(`pane-${o}`).hidden = o !== t;
    }
  });
}

function renderSources() {
  const NAMES = {
    thaiwater: 'ระดับน้ำ / ฝน — สสน. (ThaiWater)',
    gistda: 'ภาพดาวเทียมน้ำท่วม — GISTDA',
    glofas: 'คาดการณ์น้ำแม่น้ำปิง — Copernicus GloFAS',
    tmd: 'พยากรณ์อากาศและฝน — กรมอุตุนิยมวิทยา (TMD)',
    incidents: 'จุดเสี่ยงจากข่าวและประกาศ ปภ. (อัตโนมัติ)',
  };
  const src = state.meta?.sources || {};
  $('sources').innerHTML = Object.entries(NAMES).map(([k, label]) => {
    const s = src[k] || {};
    const st = s.disabled ? 'disabled' : s.ok === false ? (s.stale ? 'stale' : 'error') : s.reused ? 'ok' : s.ok ? 'ok' : 'error';
    const when = s.disabled ? (s.note || 'ปิดใช้งาน') : s.fetchedAt ? `ดึงข้อมูล ${ago(s.fetchedAt)}` : 'ไม่มีข้อมูล';
    return `<div class="source-row" data-state="${st}" title="${esc(s.error || '')}"><span class="dot"></span><span>${esc(label)}</span><span class="when">${esc(when)}</span></div>`;
  }).join('');
}

// =============== Incidents layer (Auto risk from news & DDPM) ===============
function incidentIcon(sev) {
  return L.divIcon({
    className: '',
    html: `<div class="inc-marker" data-sev="${sev}"><span class="pulse"></span><span class="core">!</span></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

const incidentMarkers = new Map();
function drawIncidents() {
  layers.incidents.clearLayers();
  incidentMarkers.clear();
  const features = state.incidents?.features || [];
  for (const f of features) {
    const p = f.properties;
    const [lon, lat] = f.geometry.coordinates;
    const sev = SEV[p.sev] || SEV[1];
    const m = L.marker([lat, lon], {
      icon: incidentIcon(p.sev),
      zIndexOffset: 1200 + (p.sev || 0) * 100,
      keyboard: true,
      title: p.locName,
    });

    const subArticles = (p.articles || []).slice(1, 4).map((a) =>
      `<div><a href="${esc(a.url)}" target="_blank" rel="noopener">• ${esc(a.title)}</a> <span class="muted">(${esc(a.source)})</span></div>`
    ).join('');

    const html = `
      <div class="inc-popup">
        <div class="inc-popup-header">
          <span class="inc-popup-loc">${esc(p.locName)}</span>
          <span class="badge" style="--c:${sev.color}">${sev.label}</span>
          ${p.hasDdpm ? '<span class="badge" style="--c:#f97316">ประกาศ ปภ.</span>' : ''}
        </div>
        <div class="inc-popup-title">${esc(p.title)}</div>
        <div class="inc-popup-source">
          <span>สำนักข่าว: <b>${esc(p.source)}</b>${p.count > 1 ? ` (+${p.count - 1} ข่าว)` : ''}</span>
          <span title="${esc(fmtDateTime(p.time))}">${ago(p.time)}</span>
        </div>
        ${p.url ? `<a class="inc-popup-link" href="${esc(p.url)}" target="_blank" rel="noopener">อ่านข่าวต้นฉบับ <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>` : ''}
        ${subArticles ? `<div class="inc-popup-subnews"><b>ข่าวที่เกี่ยวข้อง:</b>${subArticles}</div>` : ''}
      </div>
    `;
    m.bindPopup(html, { maxWidth: 320 });
    m.addTo(layers.incidents);
    incidentMarkers.set(p.id, m);
  }
}

// =============== TMD Forecast (Weather & Rain) ===============
function tmdWeatherIcon(cond) {
  if (cond === 1) return '☀️';
  if (cond === 2 || cond === 3) return '⛅';
  if (cond === 4) return '☁️';
  if (cond === 5) return '🌦️';
  if (cond === 6) return '🌧️';
  if (cond === 7 || cond === 9) return '⛈️';
  if (cond === 8) return '🌩️';
  return '🌤️';
}

function renderTmdForecast() {
  const card = $('tmd-card');
  if (!card) return;
  const tmd = state.tmd;
  if (!tmd) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  const ap = state.amphoe || 'เมืองกำแพงเพชร';
  const daily = tmd.byAmphoe?.[ap] || tmd.province?.daily || [];
  $('tmd-badge').textContent = state.amphoe ? `อ.${state.amphoe}` : 'อ.เมือง (ตัวแทนจังหวัด)';

  const DOW = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
  $('tmd-forecast-grid').innerHTML = daily.map((d, i) => {
    const dateObj = new Date(d.date + 'T12:00:00+07:00');
    const dow = i === 0 ? 'วันนี้' : i === 1 ? 'พรุ่งนี้' : DOW[dateObj.getDay()];
    const rainClass = d.rain > 35 ? 'heavy' : d.rain > 10 ? 'mod' : d.rain > 0 ? 'light' : 'zero';
    return `
      <div class="tmd-day" title="${esc(d.date)}: ${esc(d.condText)} ฝน ${fmt(d.rain, 1)} มม. สูงสุด ${fmt(d.tcMax, 0)}°C ต่ำสุด ${fmt(d.tcMin, 0)}°C">
        <span class="tmd-date">${dow}</span>
        <span class="tmd-icon" aria-hidden="true">${tmdWeatherIcon(d.cond)}</span>
        <span class="tmd-rain ${rainClass}">${d.rain > 0 ? `${fmt(d.rain, 0)}<small>มม.</small>` : '0'}</span>
        <span class="tmd-temp">${fmt(d.tcMax, 0)}°/${fmt(d.tcMin, 0)}°</span>
      </div>
    `;
  }).join('');
}

function drawTmd() {
  layers.tmd.clearLayers();
  if (!state.tmd?.byAmphoe) return;
  for (const [ap, list] of Object.entries(state.tmd.byAmphoe)) {
    const bounds = state.districtBounds[ap];
    if (!bounds) continue;
    const center = bounds.getCenter();
    const d0 = list[0];
    if (!d0) continue;
    const borderCol = d0.rain > 35 ? '#f43f5e' : d0.rain > 10 ? '#fb923c' : d0.rain > 0 ? '#38bdf8' : '#64748b';
    const icon = L.divIcon({
      className: '',
      html: `<div style="background:rgba(10,16,30,0.88);border:1.5px solid ${borderCol};border-radius:12px;padding:2px 8px;font-size:11px;font-weight:600;color:#fff;display:inline-flex;align-items:center;gap:4px;box-shadow:0 3px 10px rgba(0,0,0,0.6);white-space:nowrap;backdrop-filter:blur(6px);transform:translate(-50%,-50%);cursor:pointer;">${tmdWeatherIcon(d0.cond)} <span>${d0.rain > 0 ? `${fmt(d0.rain, 0)} มม.` : 'ไร้ฝน'}</span></div>`,
      iconSize: [0, 0],
    });
    const m = L.marker(center, { icon, interactive: true, zIndexOffset: 300 });
    m.bindTooltip(`<b>อ.${esc(ap)}</b><br>TMD พยากรณ์ฝน 24 ชม.: <b>${fmt(d0.rain, 1)} มม.</b> (${esc(d0.condText)})<br>อุณหภูมิ: ${fmt(d0.tcMin, 0)}–${fmt(d0.tcMax, 0)} °C`, { direction: 'top' });
    m.on('click', () => setAmphoe(ap, true));
    m.addTo(layers.tmd);
  }
}

// =============== Map layers ===============
function stationIcon(s) {
  return L.divIcon({ className: '', html: `<div class="st-marker" data-lv="${s.level}"><span class="core"></span></div>`, iconSize: [20, 20], iconAnchor: [10, 10] });
}

function drawStations() {
  layers.stations.clearLayers();
  for (const s of state.stations) {
    const m = L.marker([s.lat, s.lon], { icon: stationIcon(s), zIndexOffset: (s.level || 0) * 100, keyboard: true, title: s.name });
    m.bindTooltip(`<b>${esc(s.name)}</b> (${esc(s.code)})<br>${esc(LEVEL[s.level]?.label || '-')} · ${fmt(s.pct)}% ของความจุลำน้ำ`, { direction: 'top', offset: [0, -10] });
    m.on('click', () => openStation(s.code));
    m.addTo(layers.stations);
  }
}

function drawRain() {
  layers.rain.clearLayers();
  for (const r of state.rain) {
    const mm = r.rain24h ?? 0;
    const radius = mm > 0 ? Math.min(16, 4 + Math.sqrt(mm) * 1.3) : 3;
    L.circleMarker([r.lat, r.lon], {
      pane: 'rain', radius, fillColor: rainColor(r.rain24h), fillOpacity: mm > 0 ? 0.85 : 0.45, color: '#0b1220', weight: 1,
    })
      .bindTooltip(`<b>${esc(r.name)}</b><br>ฝน 24 ชม. ${fmt(r.rain24h, 1)} มม. (${rainLabel(r.rain24h)})<br><span class="muted">${esc(r.agency)} · ${fmtTime(r.time)}</span>`, { direction: 'top' })
      .addTo(layers.rain);
  }
}

const floodCache = {};
async function drawFlood() {
  layers.flood.clearLayers();
  const period = $('flood-period').value;
  if (!state.floodSummary?.periods?.[period]) return renderLegend();
  floodCache[`${period}@${state.generatedAt}`] ??= await getJson(`live/flood_${period}.geojson`, { optional: true });
  const gj = floodCache[`${period}@${state.generatedAt}`];
  if (!gj) return;
  L.geoJSON(gj, {
    renderer: floodRenderer,
    style: (f) => ({ stroke: true, color: '#7dd3fc', weight: 0.4, opacity: 0.5, fillColor: '#38bdf8', fillOpacity: 0.22 + 0.6 * (f.properties.frac || 0) }),
    onEachFeature: (f, layer) => {
      const p = f.properties;
      layer.bindPopup(`<b>พื้นที่น้ำท่วม</b><br>ต.${esc(p.tb)} อ.${esc(p.ap)}<br>ประมาณ <b>${fmt(p.rai, 1)}</b> ไร่ (${fmt((p.frac || 0) * 100)}% ของช่องหกเหลี่ยม ~0.7 ตร.กม.)<br><span class="muted">GISTDA · ${esc(state.floodSummary.periods[period].label)} · ภาพล่าสุด ${fmtDate(state.floodSummary.periods[period].sceneDate)}</span>`);
    },
  }).addTo(layers.flood);
  renderLegend();
}
$('flood-period').addEventListener('change', drawFlood);

async function drawRisk() {
  if (layers.risk.getLayers().length) return;
  state.freq ??= await getJson('risk/freq_hex.geojson', { optional: true });
  if (!state.freq) return;
  L.geoJSON(state.freq, {
    renderer: riskRenderer,
    style: (f) => ({ stroke: false, fillColor: freqColor(f.properties.n), fillOpacity: 0.62 }),
    onEachFeature: (f, layer) => {
      const p = f.properties;
      const yrs = (p.yrs || []).map((y) => beYear(2000 + y)).join(', ');
      layer.bindPopup(`<b>พื้นที่น้ำท่วมซ้ำซาก</b><br>ต.${esc(p.tb)} อ.${esc(p.ap)}<br>เคยท่วม <b>${p.n}</b> ปี จาก 14 ปี (2554–2567)<br>ปี พ.ศ.: ${esc(yrs)}<br><span class="muted">GISTDA · พื้นที่ที่เคยท่วม ~${fmt(p.rai, 1)} ไร่ในช่องนี้</span>`);
    },
  }).addTo(layers.risk);
}

// ---------- Radar (RainViewer) ----------
const radar = { frames: [], host: '', idx: 0, tiles: {}, timer: null };
async function initRadar() {
  if (radar.frames.length) return;
  try {
    const j = await (await fetch('https://api.rainviewer.com/public/weather-maps.json')).json();
    radar.host = j.host;
    radar.frames = [...(j.radar?.past || []), ...(j.radar?.nowcast || [])];
    radar.nowcastFrom = j.radar?.past?.length ?? radar.frames.length;
    const r = $('radar-range');
    r.max = radar.frames.length - 1;
    r.value = radar.idx = radar.nowcastFrom - 1;
  } catch {
    radar.frames = [];
  }
}
function radarLayer(i) {
  const f = radar.frames[i];
  return (radar.tiles[f.path] ??= L.tileLayer(`${radar.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`, {
    pane: 'radar', opacity: 0.75, maxNativeZoom: 7, maxZoom: 18, attribution: 'เรดาร์ © <a href="https://www.rainviewer.com/">RainViewer</a>',
  }));
}
function showRadarFrame(i) {
  if (!radar.frames.length) return;
  radar.idx = i;
  layers.radar.clearLayers();
  radarLayer(i).addTo(layers.radar);
  if (radar.frames[i + 1]) radarLayer(i + 1); // pre-create next frame
  const f = radar.frames[i];
  $('radar-time').textContent = `${fmtTime(new Date(f.time * 1000).toISOString())}${i >= radar.nowcastFrom ? ' (คาดการณ์)' : ''}`;
  $('radar-range').value = i;
}
$('radar-range').addEventListener('input', (e) => showRadarFrame(+e.target.value));
$('radar-play').addEventListener('click', () => {
  if (radar.timer) {
    clearInterval(radar.timer);
    radar.timer = null;
    return;
  }
  radar.timer = setInterval(() => showRadarFrame((radar.idx + 1) % radar.frames.length), 800);
});

// ---------- Layer toggles ----------
const CHIP = { incidents: 'chip-incident', flood: 'chip-flood', risk: 'chip-risk', radar: 'chip-radar' };
async function setLayer(name, on) {
  const group = layers[name];
  if (!group) return;
  if (on) {
    if (name === 'risk') await drawRisk();
    if (name === 'radar') {
      await initRadar();
      showRadarFrame(radar.idx);
    }
    group.addTo(map);
  } else {
    map.removeLayer(group);
    if (name === 'radar' && radar.timer) {
      clearInterval(radar.timer);
      radar.timer = null;
    }
  }
  const cb = $(`lyr-${name}`);
  if (cb) cb.checked = on;
  if (CHIP[name]) $(CHIP[name]).setAttribute('aria-pressed', String(on));
  if (name === 'radar') $('radar-bar').hidden = !on || !radar.frames.length;
  renderLegend();
}
for (const name of ['incidents', 'stations', 'rain', 'tmd', 'flood', 'risk', 'radar', 'districts']) {
  $(`lyr-${name}`)?.addEventListener('change', (e) => setLayer(name, e.target.checked));
}
for (const [name, id] of Object.entries(CHIP)) {
  $(id)?.addEventListener('click', () => setLayer(name, $(id).getAttribute('aria-pressed') !== 'true'));
}
document.querySelectorAll('input[name="base"]').forEach((r) =>
  r.addEventListener('change', () => {
    map.removeLayer(base);
    base = BASES[r.value].addTo(map);
  })
);
$('layer-btn').addEventListener('click', () => {
  const p = $('layer-panel');
  p.hidden = !p.hidden;
  $('layer-btn').setAttribute('aria-expanded', String(!p.hidden));
});

let legendCollapsed = localStorage.getItem('flood_kp_legend_collapsed') !== null
  ? localStorage.getItem('flood_kp_legend_collapsed') === '1'
  : (window.innerWidth <= 900);

function renderLegend() {
  const parts = [];
  if (map.hasLayer(layers.incidents) && (state.incidents?.features?.length || 0) > 0) {
    parts.push(`<div><h4>จุดเสี่ยงจากข่าว/ปภ. (${state.incidents.features.length} จุด)</h4><div class="legend-row"><span class="legend-item"><i style="background:var(--sev-3)"></i>อันตราย</span><span class="legend-item"><i style="background:var(--sev-2)"></i>เตือนภัย</span><span class="legend-item"><i style="background:var(--sev-1)"></i>เฝ้าระวัง</span></div></div>`);
  }
  if (map.hasLayer(layers.stations)) {
    parts.push(`<div><h4>ระดับน้ำ (% ความจุลำน้ำ)</h4><div class="legend-row">${[5, 4, 3, 2, 1].map((l) => `<span class="legend-item"><i style="background:${LEVEL[l].color}"></i>${LEVEL[l].label}</span>`).join('')}</div></div>`);
  }
  if (map.hasLayer(layers.rain)) {
    parts.push(`<div><h4>ฝน 24 ชม. (มม.)</h4><div class="legend-row">${[[0.1, '0.1–10'], [20, '10–35'], [50, '35–90'], [100, '> 90']].map(([v, t]) => `<span class="legend-item"><i style="background:${rainColor(v)}"></i>${t}</span>`).join('')}</div></div>`);
  }
  if (map.hasLayer(layers.flood) && state.floodSummary) {
    const p = state.floodSummary.periods?.[$('flood-period').value];
    parts.push(`<div><h4>พื้นที่น้ำท่วมจากดาวเทียม${p ? ` · ${fmt(p.totals.rai)} ไร่` : ''}</h4><div class="legend-ramp" style="background:linear-gradient(90deg,rgba(56,189,248,.25),rgba(56,189,248,.85))"></div><div class="legend-ramp-labels"><span>ท่วมบางส่วน</span><span>ท่วมเกือบทั้งช่อง</span></div></div>`);
  }
  if (map.hasLayer(layers.risk)) {
    parts.push(`<div><h4>จำนวนปีที่เคยท่วม (พ.ศ. 2554–2567)</h4><div class="legend-ramp" style="background:linear-gradient(90deg,${[1, 3, 5, 7, 9].map((n) => freqColor(n)).join(',')})"></div><div class="legend-ramp-labels"><span>1 ปี</span><span>5 ปี</span><span>9+ ปี</span></div></div>`);
  }
  if (map.hasLayer(layers.radar)) {
    parts.push(`<div><h4>เรดาร์ฝน</h4><div class="legend-ramp" style="background:linear-gradient(90deg,#88ddee,#0099cc,#ffee00,#ff8c00,#ff0000,#c800c8)"></div><div class="legend-ramp-labels"><span>เบา</span><span>หนักมาก</span></div></div>`);
  }

  const el = $('legend');
  if (!parts.length) {
    el.innerHTML = '';
    return;
  }

  el.classList.toggle('is-collapsed', legendCollapsed);
  el.innerHTML = `
    <div class="legend-header" id="legend-header" role="button" tabindex="0" title="${legendCollapsed ? 'แตะเพื่อเปิดคำอธิบายสัญลักษณ์' : 'แตะเพื่อซ่อนคำอธิบายสัญลักษณ์'}">
      <span class="legend-title">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
        คำอธิบายสัญลักษณ์
      </span>
      <button class="legend-toggle-btn" id="legend-toggle-btn" aria-expanded="${!legendCollapsed}" aria-label="${legendCollapsed ? 'เปิดคำอธิบายสัญลักษณ์' : 'ซ่อนคำอธิบายสัญลักษณ์'}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
    </div>
    <div class="legend-body">
      ${parts.join('')}
    </div>
  `;

  const toggle = (e) => {
    e.stopPropagation();
    legendCollapsed = !legendCollapsed;
    localStorage.setItem('flood_kp_legend_collapsed', legendCollapsed ? '1' : '0');
    el.classList.toggle('is-collapsed', legendCollapsed);
    $('legend-toggle-btn')?.setAttribute('aria-expanded', String(!legendCollapsed));
    $('legend-header')?.setAttribute('title', legendCollapsed ? 'แตะเพื่อเปิดคำอธิบายสัญลักษณ์' : 'แตะเพื่อซ่อนคำอธิบายสัญลักษณ์');
  };

  const header = $('legend-header');
  header?.addEventListener('click', toggle);
  header?.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggle(e)));
}

// =============== Station dialog ===============
const dialog = $('station-dialog');
enableLightDismiss(dialog);
$('sd-close').innerHTML = ICONS.close;
$('sd-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => history.replaceState(null, '', location.pathname + location.search));
let charts = [];

async function openStation(code, fly = false) {
  const s = state.stations.find((x) => x.code === code);
  const g = state.glofas.find((x) => x.id === code);
  if (!s && !g) return;
  if (fly && s) map.flyTo([s.lat, s.lon], Math.max(map.getZoom(), 11), { duration: 0.8 });
  history.replaceState(null, '', `#station=${encodeURIComponent(code)}`);

  $('sd-title').textContent = s ? `${s.name} (${s.code})` : g.name;
  $('sd-sub').textContent = s ? `${s.river || ''} ต.${s.tambon} อ.${s.amphoe} · ${s.agency} · ข้อมูล ${fmtDateTime(s.time)}` : 'จุดคาดการณ์ GloFAS';
  $('sd-facts').innerHTML = s
    ? [
        ['สถานการณ์', `<span style="color:${LEVEL[s.level]?.color}">${LEVEL[s.level]?.label || '-'}</span>`],
        ['ระดับน้ำ (ม.รทก.)', fmt(s.wl, 2)],
        ['ระดับตลิ่ง (ม.รทก.)', fmt(s.bank, 2)],
        [s.toBank >= 0 ? 'ต่ำกว่าตลิ่ง (ม.)' : 'สูงกว่าตลิ่ง (ม.)', fmt(Math.abs(s.toBank ?? 0), 2)],
        ['ความจุลำน้ำ', `${fmt(s.pct)}%`],
        ['เปลี่ยนแปลง 24 ชม.', `${signed(s.change24h)} ม.`],
        ['ปริมาณน้ำไหลผ่าน', s.discharge != null ? `${fmt(s.discharge, 1)} ลบ.ม./วิ` : '–'],
      ].map(([k, v]) => `<div class="fact"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('')
    : '';

  if (!dialog.open) dialog.showModal();
  charts.forEach((c) => c.destroy());
  charts = [];

  if (s) {
    state.series ??= await getJson('live/series.json', { optional: true });
    const rows = state.series?.data?.[s.code] || [];
    const t0 = new Date(state.series?.t0).getTime();
    const labels = rows.map((r) => new Date(t0 + r[0] * 3600e3));
    const fmtLbl = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
    charts.push(new Chart($('sd-chart'), {
      type: 'line',
      data: {
        labels: labels.map((d) => fmtLbl.format(d)),
        datasets: [
          { label: 'ระดับน้ำ', data: rows.map((r) => r[1]), borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.15)', fill: 'start', pointRadius: 0, borderWidth: 2, tension: 0.25 },
          { label: 'ระดับตลิ่ง', data: rows.map(() => s.bank), borderColor: '#f43f5e', borderDash: [6, 4], pointRadius: 0, borderWidth: 1.5 },
        ],
      },
      options: { interaction: { mode: 'index', intersect: false }, scales: { x: { ticks: { maxTicksLimit: 7, maxRotation: 0 } }, y: { ticks: { callback: (v) => fmt(v, 1) } } } },
    }));
  }

  const gBox = $('sd-glofas');
  gBox.hidden = !g;
  if (g) {
    const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
    const lbl = g.series.map((p) => fmtDate(p.t));
    const ds = [
      { label: 'ช่วงคาดการณ์ (ต่ำสุด–สูงสุด)', data: g.series.map((p) => p.max), borderWidth: 0, pointRadius: 0, backgroundColor: 'rgba(129,140,248,0.18)', fill: '+1' },
      { label: '_min', data: g.series.map((p) => p.min), borderWidth: 0, pointRadius: 0, fill: false },
      {
        label: 'ปริมาณน้ำ', data: g.series.map((p) => p.q), borderColor: '#818cf8', pointRadius: 0, borderWidth: 2, tension: 0.25,
        segment: { borderDash: (ctx) => (g.series[ctx.p1DataIndex]?.t > today ? [5, 4] : undefined) },
      },
    ];
    if (g.climate) {
      ds.push({ label: `คาบ 2 ปี (${fmt(g.climate.rp2)})`, data: g.series.map(() => g.climate.rp2), borderColor: '#facc15', borderDash: [3, 3], pointRadius: 0, borderWidth: 1.2 });
      ds.push({ label: `คาบ 5 ปี (${fmt(g.climate.rp5)})`, data: g.series.map(() => g.climate.rp5), borderColor: '#f43f5e', borderDash: [3, 3], pointRadius: 0, borderWidth: 1.2 });
    }
    charts.push(new Chart($('sd-glofas-chart'), {
      type: 'line',
      data: { labels: lbl, datasets: ds },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { filter: (i) => !i.text.startsWith('_') } } },
        scales: { x: { ticks: { maxTicksLimit: 8, maxRotation: 0 } } },
      },
    }));
  }
}

// =============== Boot ===============
async function refresh() {
  try {
    const st = await getJson('live/status.json');
    if (st.generatedAt !== state.generatedAt) await loadLive();
    else renderHeader();
  } catch (e) {
    console.warn('refresh failed', e);
  }
}

(async function boot() {
  chartDefaults(Chart);
  try {
    await loadStatic();
    await loadLive();
  } catch (e) {
    console.error(e);
    $('status-label').textContent = 'โหลดข้อมูลไม่สำเร็จ';
    $('status-desc').textContent = 'กรุณาลองใหม่อีกครั้งในภายหลัง';
    return;
  }
  const m = location.hash.match(/station=([^&]+)/);
  if (m) openStation(decodeURIComponent(m[1]), true);
  setInterval(refresh, REFRESH_MS);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refresh());
})();
