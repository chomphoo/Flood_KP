// Flood KP – extra features for the map page:
// share, place search, "my location" risk summary, emergency info, notifications, PWA install/offline.
import {
  getJson, getGeo, fmt, fmtDateTime, fmtTime, ago, esc, beYear, LEVEL, SEV, ICONS,
  trendArrow, trendHtml, distKm, pointInGeom, rainLabel, offlineState,
} from './common.js';

const $ = (id) => document.getElementById(id);
const SITE_URL = new URL('./', location.href).href.replace(/#.*$/, '');
let ctx = null; // { map, state, layers, setAmphoe, openStation, setLayer, getFloodGeo }

export function initExtras(c) {
  ctx = c;
  initShare();
  initSearch();
  initLocate();
  initNotifications();
  initPwa();
  renderHotlines();
  loadEmergency();
}

/** Called after every live-data load. */
export function onLiveData() {
  renderRoads();
  updateOfflineBanner();
  checkLocalNotifications();
  const topic = ctx.state.status?.notify?.ntfyTopic;
  if (topic) {
    $('ntfy-topic').textContent = topic;
    $('ntfy-link').href = `https://ntfy.sh/${encodeURIComponent(topic)}`;
  }
}

// ---------- toast ----------
function toast(msg) {
  let el = $('toast');
  if (!el) {
    el = Object.assign(document.createElement('div'), { id: 'toast', className: 'toast', role: 'status' });
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2600);
}

// =============== B3: Share ===============
function shareText() {
  const s = ctx.state.status?.status;
  if (!s) return '';
  const reasons = (s.reasons || []).slice(0, 3).map((r) => `• ${r.text}`).join('\n');
  return `สถานการณ์น้ำ จ.กำแพงเพชร: ${s.label}\n${reasons ? `${reasons}\n` : ''}อัปเดต ${fmtDateTime(ctx.state.generatedAt)}`;
}

function initShare() {
  const btn = $('share-btn');
  btn.innerHTML = `${ICONS.share}<span>แชร์</span>`;
  const menu = Object.assign(document.createElement('div'), { className: 'share-menu', id: 'share-menu', hidden: true });
  menu.innerHTML = `
    <a class="btn btn-line" id="share-line" target="_blank" rel="noopener">แชร์ไปที่ LINE</a>
    <button class="btn" id="share-copy">คัดลอกข้อความ</button>`;
  btn.after(menu);
  btn.addEventListener('click', async () => {
    const text = shareText();
    if (!text) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'สถานการณ์น้ำ จ.กำแพงเพชร', text, url: SITE_URL });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    $('share-line').href = `https://line.me/R/share?text=${encodeURIComponent(`${text}\n${SITE_URL}`)}`;
    menu.hidden = !menu.hidden;
  });
  $('share-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(`${shareText()}\n${SITE_URL}`);
      toast('คัดลอกข้อความแล้ว');
    } catch {
      toast('คัดลอกไม่สำเร็จ');
    }
    menu.hidden = true;
  });
  $('share-line').addEventListener('click', () => { menu.hidden = true; });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) menu.hidden = true;
  });
}

// =============== B2: Search ===============
const norm = (s) => s.replace(/\s+/g, '').replace(/^(ต\.|ตำบล|อ\.|อำเภอ|บ้าน)/, '').toLowerCase();
let searchMarker = null;
let lastNominatim = 0;

function initSearch() {
  $('search-icon').innerHTML = ICONS.search;
  const input = $('place-search');
  const list = $('search-results');
  let items = [];
  let active = -1;

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    active = -1;
  };
  const show = (rows, note = '') => {
    items = rows;
    active = -1;
    list.innerHTML = rows.map((r, i) => `
      <li role="option" id="sr-${i}" data-i="${i}" aria-selected="false">
        <span class="sr-name">${esc(r.label)}</span><span class="sr-sub">${esc(r.sub || '')}</span>
      </li>`).join('') + (note ? `<li class="sr-note" role="presentation">${note}</li>` : '');
    list.hidden = !rows.length && !note;
    input.setAttribute('aria-expanded', String(!list.hidden));
  };
  const pick = (r) => {
    close();
    input.value = r.label;
    goTo(r);
  };

  input.addEventListener('input', () => {
    const q = norm(input.value);
    if (q.length < 2) return close();
    const gaz = ctx.state.gazetteer || [];
    const rows = gaz
      .filter((g) => norm(g.name).includes(q))
      .sort((a, b) => (norm(a.name).startsWith(q) ? 0 : 1) - (norm(b.name).startsWith(q) ? 0 : 1) || (a.type === 'amphoe' ? -1 : 1))
      .slice(0, 8)
      .map((g) => ({ label: g.type === 'tambon' ? `ต.${g.name}` : `อ.${g.name}`, sub: g.type === 'tambon' ? `อ.${g.amphoe}` : 'อำเภอ', lat: g.lat, lon: g.lon, type: g.type, amphoe: g.amphoe || g.name }));
    show(rows, 'กด Enter เพื่อค้นหาหมู่บ้าน/สถานที่จาก OpenStreetMap');
  });
  input.addEventListener('keydown', async (e) => {
    const opts = [...list.querySelectorAll('[role="option"]')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!opts.length) return;
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length;
      opts.forEach((o, i) => o.setAttribute('aria-selected', String(i === active)));
      input.setAttribute('aria-activedescendant', opts[active].id);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0 && items[active]) return pick(items[active]);
      await searchNominatim(input.value.trim(), show);
    } else if (e.key === 'Escape') {
      close();
    }
  });
  list.addEventListener('click', (e) => {
    const li = e.target.closest('[data-i]');
    if (li) pick(items[+li.dataset.i]);
  });
  document.addEventListener('click', (e) => {
    if (!$('search-box').contains(e.target)) close();
  });
}

async function searchNominatim(q, show) {
  if (q.length < 2) return;
  const wait = 1100 - (Date.now() - lastNominatim); // Nominatim policy: max 1 request / second
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatim = Date.now();
  show([], 'กำลังค้นหา…');
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&countrycodes=th&viewbox=98.9,16.9,100.2,15.6&bounded=1&limit=6&accept-language=th`;
    const rows = await (await fetch(url)).json();
    show(
      rows.map((r) => ({ label: r.name || r.display_name.split(',')[0], sub: r.display_name.split(',').slice(1, 4).join(',').trim(), lat: +r.lat, lon: +r.lon, type: 'osm' })),
      rows.length ? 'ผลค้นหาจาก © OpenStreetMap (Nominatim)' : 'ไม่พบสถานที่ใน จ.กำแพงเพชร',
    );
  } catch {
    show([], 'ค้นหาไม่สำเร็จ (ต้องใช้อินเทอร์เน็ต)');
  }
}

function goTo(r) {
  const { map } = ctx;
  if (r.type === 'amphoe') return ctx.setAmphoe(r.amphoe, true);
  map.flyTo([r.lat, r.lon], r.type === 'tambon' ? 13 : 15, { duration: 0.8 });
  searchMarker?.remove();
  searchMarker = L.marker([r.lat, r.lon], { icon: L.divIcon({ className: '', html: '<div class="pin-marker"></div>', iconSize: [22, 30], iconAnchor: [11, 28] }), zIndexOffset: 2000 })
    .addTo(map)
    .bindPopup(`<b>${esc(r.label)}</b><br><span class="muted">${esc(r.sub || '')}</span><br><button class="btn btn-sm" data-risk-here>ดูความเสี่ยงบริเวณนี้</button>`);
  setTimeout(() => searchMarker.openPopup(), 850);
  searchMarker.on('popupopen', (e) => {
    e.popup.getElement()?.querySelector('[data-risk-here]')?.addEventListener('click', () => showRiskSummary(r.lat, r.lon, null, r.label));
  });
}

// =============== B1: My location ===============
let userLayer = null;

function initLocate() {
  const btn = $('locate-btn');
  btn.innerHTML = ICONS.locate;
  btn.addEventListener('click', () => {
    if (!navigator.geolocation) return toast('อุปกรณ์นี้ไม่รองรับการระบุตำแหน่ง');
    btn.classList.add('busy');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        btn.classList.remove('busy');
        showRiskSummary(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, 'ตำแหน่งของคุณ');
      },
      (err) => {
        btn.classList.remove('busy');
        toast(err.code === 1 ? 'ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง – เปิดสิทธิ์ตำแหน่งในการตั้งค่าเบราว์เซอร์' : 'ระบุตำแหน่งไม่สำเร็จ ลองใหม่อีกครั้ง');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  });
}

/** Nearest item with a distance in km. */
function nearest(list, lat, lon, getLL) {
  let best = null;
  for (const it of list) {
    const ll = getLL(it);
    if (!ll) continue;
    const d = distKm(lat, lon, ll[0], ll[1]);
    if (!best || d < best.d) best = { it, d };
  }
  return best;
}
const km = (d) => (d < 1 ? `${fmt(d * 1000, 0)} ม.` : `${fmt(d, 1)} กม.`);
const hexCenter = (f) => {
  const r = f.geometry.coordinates[0];
  const n = r.length - 1 || 1;
  let x = 0;
  let y = 0;
  for (let i = 0; i < n; i++) {
    x += r[i][0];
    y += r[i][1];
  }
  return [y / n, x / n];
};

async function showRiskSummary(lat, lon, accuracy, title) {
  const { map, state } = ctx;
  userLayer?.remove();
  userLayer = L.layerGroup().addTo(map);
  if (accuracy) L.circle([lat, lon], { radius: Math.min(accuracy, 2000), color: '#38bdf8', weight: 1, fillOpacity: 0.08, interactive: false }).addTo(userLayer);
  const marker = L.marker([lat, lon], { icon: L.divIcon({ className: '', html: '<div class="me-marker"><span></span></div>', iconSize: [22, 22], iconAnchor: [11, 11] }), zIndexOffset: 2500 }).addTo(userLayer);
  map.flyTo([lat, lon], Math.max(map.getZoom(), 12), { duration: 0.8 });
  marker.bindPopup('<div class="risk-sum">กำลังวิเคราะห์ความเสี่ยงรอบตำแหน่งนี้…</div>', { maxWidth: 340, minWidth: 260 }).openPopup();

  const rows = [];
  // Amphoe + nearest tambon
  const ap = state.amphoeGeo?.features.find((f) => pointInGeom(lon, lat, f.geometry))?.properties.name || null;
  const tb = nearest((state.gazetteer || []).filter((g) => g.type === 'tambon'), lat, lon, (g) => [g.lat, g.lon]);
  const place = ap ? `อ.${ap}${tb ? ` · ใกล้ ต.${tb.it.name}` : ''}` : 'อยู่นอกเขต จ.กำแพงเพชร';
  let worst = 0;
  const add = (sev, label, html) => {
    worst = Math.max(worst, sev);
    rows.push(`<li data-sev="${sev}"><span class="rs-k">${label}</span><span class="rs-v">${html}</span></li>`);
  };

  // Satellite flood (currently selected period)
  const flood = ctx.getFloodGeo();
  if (flood?.features?.length) {
    const inside = flood.features.find((f) => pointInGeom(lon, lat, f.geometry));
    if (inside) add(3, 'ดาวเทียม', `<b>อยู่ในพื้นที่ที่พบน้ำท่วม</b> (~${fmt(inside.properties.rai, 1)} ไร่ในช่องนี้)`);
    else {
      const n = nearest(flood.features, lat, lon, hexCenter);
      if (n && n.d <= 3) add(2, 'ดาวเทียม', `พบน้ำท่วมห่างไป ~${km(n.d)} (ต.${esc(n.it.properties.tb)})`);
      else if (n && n.d <= 10) add(1, 'ดาวเทียม', `พื้นที่น้ำท่วมใกล้สุด ~${km(n.d)}`);
      else add(0, 'ดาวเทียม', 'ไม่พบน้ำท่วมภายใน 10 กม.');
    }
  } else {
    add(0, 'ดาวเทียม', 'ช่วงนี้ไม่พบพื้นที่น้ำท่วมจากภาพดาวเทียม');
  }

  // Historic frequency (lazy-load risk layer)
  state.freq ??= await getGeo('risk/freq_hex.geojson', { optional: true });
  if (state.freq?.features) {
    const hit = state.freq.features.find((f) => pointInGeom(lon, lat, f.geometry));
    const near = hit ? null : state.freq.features.filter((f) => distKm(lat, lon, ...hexCenter(f)) <= 1).sort((a, b) => b.properties.n - a.properties.n)[0];
    const f = hit || near;
    if (f) {
      const n = f.properties.n;
      const yrs = (f.properties.yrs || []).slice(-3).map((y) => beYear(2000 + y)).join(', ');
      add(n >= 5 ? 2 : 1, 'สถิติ 14 ปี', `${hit ? 'จุดนี้' : 'ในรัศมี 1 กม.'}เคยท่วม <b>${n} ปี</b>${yrs ? ` (ล่าสุด ${yrs})` : ''}`);
    } else add(0, 'สถิติ 14 ปี', 'ไม่เคยพบน้ำท่วมในรัศมี 1 กม. (2554–2567)');
  }

  // Nearest water-level station
  const st = nearest(state.stations, lat, lon, (s) => [s.lat, s.lon]);
  if (st) {
    const s = st.it;
    const t = trendArrow(s.change24h);
    add(s.level === 5 ? 3 : s.level === 4 ? 2 : 0, 'สถานีวัดน้ำใกล้สุด',
      `<a href="#" data-station="${esc(s.code)}">${esc(s.name)}</a> (${km(st.d)}) · <span style="color:${LEVEL[s.level]?.color}">${esc(LEVEL[s.level]?.label || '-')}</span> ${fmt(s.pct)}% ${trendHtml(s.change24h)}<span class="muted"> ${esc(t.label)}</span>`);
  }

  // Nearest news incident
  const inc = nearest(state.incidents?.features || [], lat, lon, (f) => [f.geometry.coordinates[1], f.geometry.coordinates[0]]);
  if (inc && inc.d <= 25) {
    const p = inc.it.properties;
    const rec = p.phase === 'recovering';
    add(rec ? 0 : Math.min(p.sev, inc.d <= 5 ? 3 : 2), 'ข่าว/ปภ.', `${rec ? 'กำลังคลี่คลาย' : esc(SEV[p.sev]?.label || '')} — ${esc(p.locName)} (${km(inc.d)}, ${ago(p.time)})`);
  } else add(0, 'ข่าว/ปภ.', 'ไม่มีรายงานในรัศมี 25 กม.');

  // TMD next 24 h
  const n24 = ap ? state.tmd?.next24ByAmphoe?.[ap] : null;
  if (n24) add(n24.rain > 90 ? 2 : n24.rain > 35 ? 1 : 0, 'ฝน 24 ชม. ข้างหน้า', `~${fmt(n24.rain, 1)} มม. (${rainLabel(n24.rain)})`);

  const verdict = ['ยังไม่พบความเสี่ยงเด่นชัด', 'ควรเฝ้าระวัง', 'มีความเสี่ยง – เตรียมพร้อม', 'เสี่ยงสูง – ติดตามประกาศใกล้ชิด'][worst];
  const html = `
    <div class="risk-sum">
      <div class="rs-head"><b>${esc(title)}</b><span class="badge" style="--c:${worst ? SEV[worst].color : 'var(--ok)'}">${verdict}</span></div>
      <div class="muted rs-place">${esc(place)}${accuracy ? ` · แม่นยำ ±${fmt(accuracy)} ม.` : ''}</div>
      <ul class="rs-list">${rows.join('')}</ul>
      <div class="muted rs-foot">ประเมินอัตโนมัติจากข้อมูลบนเว็บนี้ ไม่ใช่ประกาศทางราชการ · ฉุกเฉินโทร <a href="tel:1784">1784</a></div>
    </div>`;
  marker.setPopupContent(html);
  marker.openPopup();
  marker.getPopup().getElement()?.querySelectorAll('[data-station]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    ctx.openStation(a.dataset.station);
  }));
}

// =============== B5: Emergency info ===============
// Well-known national hotlines only. Provincial numbers/shelters come from data/static/emergency.json.
const HOTLINES = [
  ['1784', 'สายด่วนนิรภัย ปภ.', 'แจ้งเหตุสาธารณภัย/ขอความช่วยเหลือ'],
  ['1669', 'เจ็บป่วยฉุกเฉิน', 'สพฉ.'],
  ['191', 'เหตุด่วนเหตุร้าย', 'ตำรวจ'],
  ['199', 'ดับเพลิง / กู้ภัย', ''],
  ['1193', 'ตำรวจทางหลวง', ''],
  ['1586', 'กรมทางหลวง', 'สภาพเส้นทาง'],
  ['1146', 'กรมทางหลวงชนบท', 'สภาพเส้นทาง'],
  ['1460', 'กรมชลประทาน', 'สถานการณ์น้ำ'],
  ['1182', 'กรมอุตุนิยมวิทยา', 'พยากรณ์อากาศ'],
  ['1567', 'ศูนย์ดำรงธรรม', 'ร้องเรียน/ขอความช่วยเหลือ'],
];

function renderHotlines() {
  $('hotlines').innerHTML = HOTLINES.map(([n, name, sub], i) => `
    <a class="hotline${i < 2 ? ' primary' : ''}" href="tel:${n}" aria-label="โทร ${n} ${name}">
      <span class="hl-num">${ICONS.phone}${n}</span><span class="hl-name">${esc(name)}</span>${sub ? `<span class="hl-sub">${esc(sub)}</span>` : ''}
    </a>`).join('');
}

async function loadEmergency() {
  const em = await getJson('static/emergency.json', { optional: true });
  if (em?.contacts?.length) {
    $('em-contacts').innerHTML = `<h3>หน่วยงานในจังหวัด</h3><ul class="em-list">${em.contacts.map((c) => `
      <li><a href="tel:${esc(String(c.tel).replace(/[^\d+]/g, ''))}">${ICONS.phone}${esc(c.tel)}</a> <b>${esc(c.name)}</b>${c.note ? ` <span class="muted">${esc(c.note)}</span>` : ''}</li>`).join('')}</ul>`;
  }
  if (em?.shelters?.length) {
    $('em-shelters').innerHTML = `<h3>ศูนย์พักพิงชั่วคราว${em.updated ? ` <span class="muted">(ข้อมูล ${esc(em.updated)})</span>` : ''}</h3><ul class="em-list">${em.shelters.map((s, i) => `
      <li><b>${esc(s.name)}</b> <span class="muted">อ.${esc(s.amphoe || '-')}</span>${s.tel ? ` · <a href="tel:${esc(String(s.tel).replace(/[^\d+]/g, ''))}">${esc(s.tel)}</a>` : ''}${s.lat ? ` · <a href="#" data-shelter="${i}">ดูบนแผนที่</a>` : ''}</li>`).join('')}</ul>`;
    const group = L.layerGroup().addTo(ctx.map);
    const markers = em.shelters.map((s) => (s.lat && s.lon
      ? L.marker([s.lat, s.lon], { icon: L.divIcon({ className: '', html: '<div class="shelter-marker">⌂</div>', iconSize: [24, 24], iconAnchor: [12, 12] }), title: s.name })
        .bindPopup(`<b>ศูนย์พักพิง: ${esc(s.name)}</b><br>อ.${esc(s.amphoe || '-')}${s.tel ? `<br>โทร <a href="tel:${esc(s.tel)}">${esc(s.tel)}</a>` : ''}${s.note ? `<br>${esc(s.note)}` : ''}`)
        .addTo(group)
      : null));
    $('em-shelters').addEventListener('click', (e) => {
      const a = e.target.closest('[data-shelter]');
      if (!a) return;
      e.preventDefault();
      const m = markers[+a.dataset.shelter];
      if (m) {
        ctx.map.flyTo(m.getLatLng(), 14, { duration: 0.8 });
        setTimeout(() => m.openPopup(), 850);
      }
    });
  }
}

function renderRoads() {
  const roads = ctx.state.incidents?.roads || [];
  $('em-roads').innerHTML = `
    <h3>${ICONS.road}เส้นทางที่มีรายงานน้ำท่วม/ตัดขาด</h3>
    ${roads.length
      ? `<ul class="em-list roads">${roads.slice(0, 6).map((r) => `
          <li><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a>
          <span class="muted">${esc(r.locName)} · ${esc(r.source)} · ${ago(r.time)}</span></li>`).join('')}</ul>`
      : '<p class="muted">ไม่พบข่าวถนนถูกน้ำท่วม/ตัดขาดใน 7 วันที่ผ่านมา</p>'}
    <p class="muted em-note">รวบรวมอัตโนมัติจากข่าว อาจไม่ครบหรือไม่เป็นปัจจุบัน โปรดตรวจสอบกับ 1586 / 1146 ก่อนเดินทาง</p>`;
}

// =============== B8: Notifications (local, while the page is open) ===============
const NOTIFY_KEY = 'flood_kp_notify';
const SEEN_KEY = 'flood_kp_last_seen_at';

function initNotifications() {
  const btn = $('local-notify-btn');
  if (!('Notification' in window)) {
    btn.disabled = true;
    btn.textContent = 'ไม่รองรับ';
    $('local-notify-desc').textContent += ' — เบราว์เซอร์นี้ไม่รองรับ (บน iPhone ต้องติดตั้งเป็นแอปก่อน) แนะนำใช้แอป ntfy ด้านล่าง';
    return;
  }
  const sync = () => {
    const on = localStorage.getItem(NOTIFY_KEY) === '1' && Notification.permission === 'granted';
    btn.textContent = Notification.permission === 'denied' ? 'ถูกบล็อก' : on ? 'ปิดการแจ้งเตือน' : 'เปิดการแจ้งเตือน';
    btn.disabled = Notification.permission === 'denied';
    btn.classList.toggle('btn-primary', !on && !btn.disabled);
    btn.setAttribute('aria-pressed', String(on));
  };
  btn.addEventListener('click', async () => {
    if (localStorage.getItem(NOTIFY_KEY) === '1') {
      localStorage.setItem(NOTIFY_KEY, '0');
      toast('ปิดการแจ้งเตือนแล้ว');
      return sync();
    }
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      localStorage.setItem(NOTIFY_KEY, '1');
      localStorage.setItem(SEEN_KEY, ctx.state.generatedAt || new Date().toISOString());
      notify('เปิดการแจ้งเตือนแล้ว', 'จะแจ้งเมื่อมีสถานการณ์ระดับเตือนภัยขึ้นไปใหม่ ขณะที่เปิดเว็บนี้ไว้');
    } else if (perm === 'denied') {
      toast('การแจ้งเตือนถูกบล็อก – เปิดได้ในการตั้งค่าเว็บไซต์');
    }
    sync();
  });
  sync();
}

async function notify(title, body) {
  const opts = { body, icon: 'assets/icons/icon-192.png', badge: 'assets/icons/icon-192.png', lang: 'th', tag: 'floodkp' };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return reg.showNotification(title, opts);
  } catch { /* fall through */ }
  try {
    new Notification(title, opts); // eslint-disable-line no-new
  } catch { /* some mobile browsers only allow SW notifications */ }
}

function checkLocalNotifications() {
  if (!('Notification' in window) || Notification.permission !== 'granted' || localStorage.getItem(NOTIFY_KEY) !== '1') return;
  if (offlineState.usedCache) return;
  const seen = localStorage.getItem(SEEN_KEY) || '';
  const fresh = (ctx.state.feed?.timeline || []).filter((e) => e.at > seen && (e.change === 'new' || e.change === 'up') && e.sev >= 2);
  localStorage.setItem(SEEN_KEY, ctx.state.generatedAt);
  if (!fresh.length) return;
  const top = fresh.sort((a, b) => b.sev - a.sev).slice(0, 3);
  notify(`น้ำท่วมกำแพงเพชร: ${SEV[top[0].sev].label} ${fresh.length} รายการใหม่`, top.map((e) => `• ${e.title}`).join('\n'));
}

// =============== B4: PWA – service worker, install, offline ===============
const INSTALL_KEY = 'flood_kp_install_dismissed';

function initPwa() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW register failed', e));
  }
  window.addEventListener('online', updateOfflineBanner);
  window.addEventListener('offline', updateOfflineBanner);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const dismissed = Date.now() - (+localStorage.getItem(INSTALL_KEY) || 0) < 14 * 86400e3;
  const banner = $('install-banner');
  $('install-dismiss').addEventListener('click', () => {
    banner.hidden = true;
    localStorage.setItem(INSTALL_KEY, String(Date.now()));
  });
  if (standalone || dismissed) return;

  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    $('install-btn').hidden = false;
    banner.hidden = false;
  });
  $('install-btn').addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    banner.hidden = true;
    if (outcome === 'accepted') toast('ติดตั้งแล้ว เปิดได้จากหน้าจอหลัก');
  });
  window.addEventListener('appinstalled', () => { banner.hidden = true; });

  // iOS Safari has no install prompt – show instructions instead.
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
    $('install-text').innerHTML = 'ติดตั้งเป็นแอป: แตะปุ่ม <b>แชร์</b> ของ Safari แล้วเลือก <b>“เพิ่มไปยังหน้าจอโฮม”</b>';
    banner.hidden = false;
  }
}

function updateOfflineBanner() {
  const off = !navigator.onLine || offlineState.usedCache;
  $('offline-banner').hidden = !off;
  if (off && ctx.state.generatedAt) $('offline-time').textContent = `(ข้อมูลเมื่อ ${fmtTime(ctx.state.generatedAt)} · ${ago(ctx.state.generatedAt)})`;
}
