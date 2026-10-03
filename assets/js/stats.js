// Flood KP – statistics page
import { getJson, fmt, fmtDate, beYear, esc, LEVEL, chartDefaults } from './common.js';

const $ = (id) => document.getElementById(id);
chartDefaults(window.Chart);

const [freq, daily, meta, flood] = await Promise.all([
  getJson('risk/freq_summary.json', { optional: true }),
  getJson('stats/daily.json', { optional: true }),
  getJson('stats/stations.json', { optional: true }),
  getJson('live/flood_summary.json', { optional: true }),
]);

const empty = (msg) => `<div class="empty">${esc(msg)}</div>`;
const kpi = (label, value, unit, sub, sev) =>
  `<div class="kpi"${sev ? ` data-sev="${sev}"` : ''}><span class="kpi-label">${esc(label)}</span>` +
  `<span class="kpi-value">${value}${unit ? `<small>${esc(unit)}</small>` : ''}</span><span class="kpi-sub">${esc(sub)}</span></div>`;

// =============== KPIs ===============
{
  const years = freq ? Object.entries(freq.provinceByYear).map(([y, rai]) => ({ y: +y, rai })) : [];
  const worst = years.reduce((a, b) => (b.rai > (a?.rai ?? -1) ? b : a), null);
  const floodYears = years.filter((y) => y.rai > 0).length;
  const repeat = freq ? freq.tambons.filter((t) => t.years >= 5).length : null;
  const now = flood?.periods?.['3days'];
  $('stat-kpis').innerHTML = [
    kpi('ปีที่ท่วมหนักที่สุด', worst ? `พ.ศ. ${beYear(worst.y)}` : '–', '', worst ? `${fmt(worst.rai)} ไร่` : 'ไม่มีข้อมูล', worst ? 3 : 0),
    kpi('ปีที่มีน้ำท่วม', years.length ? fmt(floodYears) : '–', `/ ${years.length} ปี`, 'จากภาพดาวเทียม 2554–2567', floodYears ? 2 : 0),
    kpi('ตำบลท่วมซ้ำ ≥ 5 ปี', repeat == null ? '–' : fmt(repeat), 'ตำบล', 'จุดที่ควรเฝ้าระวังเป็นพิเศษ', repeat ? 2 : 0),
    kpi('น้ำท่วมตอนนี้', now ? fmt(now.totals.rai) : '–', 'ไร่', now ? `ภาพวันที่ ${fmtDate(now.sceneDate)}` : 'ไม่มีข้อมูล', now?.totals.rai > 1000 ? 3 : now?.totals.rai ? 1 : 0),
  ].join('');
}

// =============== Flood area by year ===============
if (freq) {
  const ys = freq.years;
  new Chart($('chart-years'), {
    type: 'bar',
    data: {
      labels: ys.map(beYear),
      datasets: [{
        label: 'พื้นที่น้ำท่วม (ไร่)',
        data: ys.map((y) => freq.provinceByYear[y] ?? 0),
        backgroundColor: ys.map((y) => ((freq.provinceByYear[y] ?? 0) > 200000 ? '#f43f5e' : '#fb923c')),
        borderRadius: 6,
      }],
    },
    options: {
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${fmt(c.raw)} ไร่` } } },
      scales: { y: { ticks: { callback: (v) => fmt(v) } }, x: { grid: { display: false } } },
    },
  });
} else {
  $('chart-years').parentElement.outerHTML = empty('ยังไม่มีข้อมูลสถิติรายปี');
}

// =============== Current flood by district ===============
{
  const now = flood?.periods?.['3days'];
  if (now?.byAmphoe?.length) {
    $('current-scene').textContent = `GISTDA · ภาพวันที่ ${fmtDate(now.sceneDate)}`;
    const max = Math.max(...now.byAmphoe.map((a) => a.rai));
    $('current-table').innerHTML = `<table class="data"><thead><tr><th>อำเภอ</th><th class="n">ไร่</th><th class="n">ตำบล</th><th class="n">ประชากรในพื้นที่</th><th style="width:30%"></th></tr></thead><tbody>${
      now.byAmphoe.map((a) => `<tr><td>${esc(a.amphoe)}</td><td class="n">${fmt(a.rai)}</td><td class="n">${fmt(a.tambons)}</td><td class="n">${fmt(a.population)}</td>` +
        `<td><div class="bar-cell"><i style="width:${((a.rai / max) * 100).toFixed(1)}%"></i></div></td></tr>`).join('')
    }</tbody><tfoot><tr><td>รวม</td><td class="n">${fmt(now.totals.rai)}</td><td></td><td class="n">${fmt(now.totals.population)}</td><td></td></tr></tfoot></table>`;
  } else {
    $('current-table').innerHTML = empty('ภาพดาวเทียมล่าสุดไม่พบพื้นที่น้ำท่วมในจังหวัด');
  }
}

// =============== Station summary + daily chart ===============
const stations = meta?.stations || [];
if (daily?.days?.length && stations.length) {
  const col = Object.fromEntries(daily.columns.map((c, i) => [c, i]));
  const days = daily.days;
  $('station-range').textContent = `${fmtDate(days[0].d)} – ${fmtDate(days[days.length - 1].d)}`;

  const rows = stations.map((st) => {
    const i = daily.codes.indexOf(st.code);
    let high = 0, over = 0, hours = 0, peak = null, n = 0;
    for (const day of days) {
      const s = day.s[i];
      if (!s) continue;
      n++;
      if (s[col.maxLevel] >= 4) high++;
      if (s[col.maxLevel] >= 5) over++;
      hours += s[col.overBankHours] || 0;
      if (s[col.max] != null && (!peak || s[col.max] > peak.v)) peak = { v: s[col.max], d: day.d };
    }
    return { st, high, over, hours, peak, n };
  }).sort((a, b) => b.over - a.over || b.high - a.high);

  $('station-table').innerHTML = `<table class="data"><thead><tr><th>สถานี</th><th class="n">วันน้ำมาก</th><th class="n">วันล้นตลิ่ง</th><th class="n">ชม.ล้นตลิ่ง</th><th class="n">สูงสุด (ม.)</th></tr></thead><tbody>${
    rows.map((r) => `<tr><td><b>${esc(r.st.code)}</b> <span class="muted">${esc(r.st.name)}</span></td>` +
      `<td class="n">${fmt(r.high)}</td><td class="n" style="color:${r.over ? LEVEL[5].color : 'inherit'}">${fmt(r.over)}</td>` +
      `<td class="n">${fmt(r.hours)}</td><td class="n" title="${r.peak ? fmtDate(r.peak.d) : ''}">${r.peak ? fmt(r.peak.v, 2) : '–'}</td></tr>`).join('')
  }</tbody></table><p class="disclaimer" style="margin:8px 0 0">วันน้ำมาก = ระดับน้ำสูงสุดของวันเกิน 70% ของความจุลำน้ำ · วันล้นตลิ่ง = เกินระดับตลิ่ง · บางสถานีอาจขาดข้อมูลบางวัน</p>`;

  const sel = $('station-select');
  for (const r of rows) sel.add(new Option(`${r.st.code} – ${r.st.name}${r.st.river ? ` (${r.st.river})` : ''}`, r.st.code));
  const initial = new URLSearchParams(location.hash.slice(1)).get('station');
  if (initial && stations.some((s) => s.code === initial)) sel.value = initial;

  let chart;
  const draw = () => {
    const st = stations.find((s) => s.code === sel.value);
    const i = daily.codes.indexOf(st.code);
    const labels = days.map((d) => fmtDate(d.d));
    const maxes = days.map((d) => d.s[i]?.[col.max] ?? null);
    const mins = days.map((d) => d.s[i]?.[col.min] ?? null);
    const datasets = [
      { label: 'สูงสุดของวัน', data: maxes, borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.18)', fill: '+1', pointRadius: 0, borderWidth: 1.6, spanGaps: true },
      { label: 'ต่ำสุดของวัน', data: mins, borderColor: 'rgba(56,189,248,0.35)', pointRadius: 0, borderWidth: 1, spanGaps: true },
    ];
    if (st.bank != null) datasets.push({ label: `ตลิ่ง ${fmt(st.bank, 2)} ม.`, data: days.map(() => st.bank), borderColor: LEVEL[5].color, borderDash: [6, 4], pointRadius: 0, borderWidth: 1.4 });
    chart?.destroy();
    chart = new Chart($('chart-daily'), {
      type: 'line',
      data: { labels, datasets },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.raw == null ? '–' : fmt(c.raw, 2)} ม.` } } },
        scales: { x: { ticks: { maxTicksLimit: 12, maxRotation: 0 }, grid: { display: false } }, y: { ticks: { callback: (v) => fmt(v, 1) } } },
      },
    });
    history.replaceState(null, '', `#station=${encodeURIComponent(st.code)}`);
  };
  sel.addEventListener('change', draw);
  draw();
} else {
  $('station-table').innerHTML = empty('ยังไม่มีข้อมูลย้อนหลัง');
  $('chart-daily').parentElement.outerHTML = empty('ยังไม่มีข้อมูลย้อนหลัง');
  $('station-select').hidden = true;
}

// =============== Repeat-flood tambons ===============
if (freq?.tambons?.length) {
  const filter = $('tambon-filter');
  for (const a of [...new Set(freq.tambons.map((t) => t.amphoe))].sort((a, b) => a.localeCompare(b, 'th'))) filter.add(new Option(`อ.${a}`, a));
  const render = () => {
    const list = freq.tambons.filter((t) => !filter.value || t.amphoe === filter.value).slice(0, filter.value ? 100 : 20);
    $('tambon-table').innerHTML = `<table class="data"><thead><tr><th>#</th><th>ตำบล</th><th>อำเภอ</th><th class="n">จำนวนปี</th><th class="n">ท่วมสูงสุด (ไร่)</th><th>พ.ศ. ${beYear(freq.years[0])}–${beYear(freq.years[freq.years.length - 1])}</th></tr></thead><tbody>${
      list.map((t, i) => `<tr><td class="muted">${i + 1}</td><td><b>${esc(t.tambon)}</b></td><td>${esc(t.amphoe)}</td><td class="n">${fmt(t.years)}</td><td class="n">${fmt(t.maxRai)}</td>` +
        `<td><span class="heat">${freq.years.map((y) => {
          const rai = t.byYear[y] || 0;
          return `<i class="${rai > 0 ? 'on' : ''}${rai > 1000 ? ' big' : ''}" title="พ.ศ. ${beYear(y)}: ${fmt(rai)} ไร่"></i>`;
        }).join('')}</span></td></tr>`).join('')
    }</tbody></table>`;
  };
  filter.addEventListener('change', render);
  render();
} else {
  $('tambon-table').innerHTML = empty('ยังไม่มีข้อมูลพื้นที่เสี่ยง');
  $('tambon-filter').hidden = true;
}
