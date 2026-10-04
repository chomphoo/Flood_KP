// Incident & risk points from news and DDPM (ปภ.) announcements.
// Rule-based, automated, no AI, no manual approval.
// News → keyword filter → gazetteer match (tambon > amphoe) → cluster by place → GeoJSON.
// Articles that only mention the province (no tambon/amphoe) are NOT pinned on the map;
// they are returned separately as `provinceNews` so they do not inflate อ.เมือง.
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../lib/config.mjs';

const POSITIVE_KEYWORDS = [
  'น้ำท่วม', 'น้ำป่า', 'น้ำหลาก', 'น้ำล้นตลิ่ง', 'จมบาดาล', 'อุทกภัย',
  'ล้นสปิลเวย์', 'ท่วมขัง', 'เอ่อล้น', 'เตือนภัย', 'ดินถล่ม',
  'อพยพ', 'ติดค้าง', 'ตัดขาด', 'ทะลักท่วม', 'ผู้ประสบภัย',
];
const EXCLUDE_PATTERNS = [/เปิดให้เที่ยว/, /เปิดฤดูท่องเที่ยว/, /แห่เที่ยว/, /ชวนเที่ยว/, /จุดเช็กอิน/];

const CRITICAL_WORDS = ['จมบาดาล', 'วิกฤต', 'น้ำป่า', 'อพยพ', 'เสียหายหนัก', 'ติดค้าง', 'ตัดขาด', 'ทะลักท่วม', 'ถล่ม', 'หนีขึ้นหลังคา'];
const WARN_WORDS = ['น้ำล้นตลิ่ง', 'น้ำท่วม', 'ท่วมขัง', 'เอ่อล้น', 'เตือนภัย', 'ล้นสปิลเวย์', 'น้ำหลาก'];
/** Wording that says the water is going down / clean-up has started. */
const RECOVERY_WORDS = ['น้ำลด', 'คลี่คลาย', 'ฟื้นฟู', 'กวาดโคลน', 'ล้างโคลน', 'ทำความสะอาด', 'ภาวะปกติ', 'เยียวยา', 'หลังน้ำ'];
const ROAD_WORDS = /(ถนน|ถ\.|ทางหลวง|ทล\.|สะพาน|เส้นทาง|คอสะพาน|ทางเข้าหมู่บ้าน)/;
const ROAD_CLOSED = /(ตัดขาด|ปิดการจราจร|ปิดถนน|ปิดเส้นทาง|รถเล็ก[^ ]{0,12}ผ่าน|ผ่านไม่ได้|สัญจรไม่ได้|ท่วมผิวจราจร|ท่วมถนน|ถนนขาด|สะพานขาด|ทรุด|ชำรุด|เลี่ยงเส้นทาง)/;

export function isFloodRelated(text) {
  if (EXCLUDE_PATTERNS.some((ex) => ex.test(text))) return false;
  return POSITIVE_KEYWORDS.some((kw) => text.includes(kw));
}

/**
 * Severity of one article (1–3) and whether it describes recovery.
 * Recovery wording caps severity at 1 so "น้ำลดแล้ว ชาวบ้านกวาดโคลน" is not shown as danger.
 * Older articles decay: >3 days −1, >7 days −2 (never below 1).
 */
export function classifyArticle(text, ageDays = 0) {
  const recovering = RECOVERY_WORDS.some((w) => text.includes(w));
  let sev = CRITICAL_WORDS.some((w) => text.includes(w)) ? 3 : WARN_WORDS.some((w) => text.includes(w)) ? 2 : 1;
  if (recovering) sev = 1;
  if (ageDays > 7) sev -= 2;
  else if (ageDays > 3) sev -= 1;
  return { sev: Math.max(1, sev), recovering };
}

export function isRoadReport(text) {
  return ROAD_WORDS.test(text) && ROAD_CLOSED.test(text);
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Tambon names that are also common words; they only match with a ต./ตำบล prefix. */
const AMBIGUOUS_TAMBON = new Set(['ในเมือง']);

/**
 * Build a matcher over the gazetteer. Tambons are tried first (more precise), longer names first.
 * "อ.เมือง" / "อำเภอเมือง" maps to เมืองกำแพงเพชร unless another province follows it.
 */
export function makeLocationMatcher(entries) {
  const sorted = [...entries].sort((a, b) => (a.type !== b.type ? (a.type === 'tambon' ? -1 : 1) : b.name.length - a.name.length));
  const rules = sorted.map((loc) => ({
    loc,
    re: loc.type === 'tambon'
      ? (AMBIGUOUS_TAMBON.has(loc.name)
        ? new RegExp(`(ต\\.|ตำบล)\\s*${escRe(loc.name)}`)
        : new RegExp(`(ต\\.|ตำบล)\\s*${escRe(loc.name)}|${escRe(loc.name)}`))
      : new RegExp(`(อ\\.|อำเภอ)\\s*${escRe(loc.name)}|${escRe(loc.name)}`),
  }));
  const muang = entries.find((g) => g.type === 'amphoe' && g.name === 'เมืองกำแพงเพชร');
  const muangShort = /(อ\.|อำเภอ)\s*เมือง(?!\s*(จ\.|จังหวัด)\s*(?!กำแพงเพชร))/;
  return (text) => {
    for (const r of rules) {
      // Bare tambon names that are also district names (e.g. "คลองลาน") are handled by order: tambon first is intended.
      if (r.re.test(text)) return r.loc;
    }
    if (muang && muangShort.test(text)) return muang;
    return null;
  };
}

/** Fetch news from Google News RSS (no key needed). */
async function fetchRss(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=th&gl=TH&ceid=TH:th`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Google News HTTP ${res.status}`);
  const text = await res.text();
  const clean = (s) => s.replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'");
  return [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const title = clean(m[1].match(/<title>([\s\S]*?)<\/title>/)?.[1] || '');
    const link = m[1].match(/<link>([\s\S]*?)<\/link>/)?.[1] || '';
    const pubDate = m[1].match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || '';
    const source = clean(m[1].match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] || '');
    const desc = clean(m[1].match(/<description>([\s\S]*?)<\/description>/)?.[1] || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').trim();
    return { title, link, pubDate, source, desc };
  });
}

/** Turn raw articles into clustered incidents (pure – unit-tested). */
export function buildIncidents(rawArticles, gazetteer, now = Date.now()) {
  const match = makeLocationMatcher(gazetteer);
  const maxAgeMs = 14 * 86400e3;
  const seen = new Set();
  const clusters = new Map();
  const provinceNews = [];
  const roads = [];

  for (const art of rawArticles) {
    if (!art.title || seen.has(art.link) || seen.has(art.title)) continue;
    seen.add(art.link);
    seen.add(art.title);
    // Google News appends " - source" to titles; drop it for matching and display.
    const title = art.source && art.title.endsWith(` - ${art.source}`) ? art.title.slice(0, -(art.source.length + 3)) : art.title;
    const fullText = `${title} ${art.desc || ''}`;
    if (!isFloodRelated(fullText)) continue;
    const time = art.pubDate ? new Date(art.pubDate).getTime() : now;
    if (Number.isNaN(time) || now - time > maxAgeMs) continue;

    const ageDays = (now - time) / 86400e3;
    const { sev, recovering } = classifyArticle(fullText, ageDays);
    const item = {
      title,
      source: art.source || 'รายงานข่าว',
      url: art.link,
      time: new Date(time).toISOString(),
      sev,
      recovering,
      isDdpm: /ปภ\.|ป้องกันและบรรเทาสาธารณภัย/.test(fullText),
    };
    const loc = match(fullText);
    if (isRoadReport(fullText) && !recovering && ageDays <= 7 && (loc || title.includes('กำแพงเพชร'))) {
      roads.push({ ...item, locName: loc ? (loc.type === 'tambon' ? `ต.${loc.name} อ.${loc.amphoe}` : `อ.${loc.name}`) : 'จ.กำแพงเพชร' });
    }
    if (!loc) {
      // Only keep province-level news whose headline is about Kamphaeng Phet (skip national round-ups).
      if (title.includes('กำแพงเพชร')) provinceNews.push(item);
      continue;
    }
    const key = `${loc.type}:${loc.amphoe}:${loc.name}`;
    if (!clusters.has(key)) {
      clusters.set(key, {
        id: `inc:${loc.type === 'tambon' ? `${loc.amphoe}:${loc.name}` : loc.name}`,
        locName: loc.type === 'tambon' ? `ต.${loc.name} (อ.${loc.amphoe})` : `อ.${loc.name}`,
        amphoe: loc.amphoe || loc.name,
        tambon: loc.type === 'tambon' ? loc.name : null,
        lat: loc.lat,
        lon: loc.lon,
        articles: [],
      });
    }
    clusters.get(key).articles.push(item);
  }

  const features = [...clusters.values()].map((c) => {
    c.articles.sort((a, b) => b.time.localeCompare(a.time));
    const top = c.articles[0];
    // The latest report decides whether the place is recovering; severity = max over non-superseded reports.
    const recovering = top.recovering;
    const sev = recovering ? 1 : Math.max(...c.articles.map((a) => a.sev));
    return {
      type: 'Feature',
      id: c.id,
      geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
      properties: {
        id: c.id,
        title: top.title,
        locName: c.locName,
        amphoe: c.amphoe,
        tambon: c.tambon,
        source: top.source,
        url: top.url,
        sev,
        phase: recovering ? 'recovering' : 'active',
        count: c.articles.length,
        hasDdpm: c.articles.some((a) => a.isDdpm),
        time: top.time,
        articles: c.articles.slice(0, 5).map(({ sev: _s, ...a }) => a),
      },
    };
  }).sort((a, b) => b.properties.sev - a.properties.sev || b.properties.time.localeCompare(a.properties.time));

  provinceNews.sort((a, b) => b.time.localeCompare(a.time));
  roads.sort((a, b) => b.time.localeCompare(a.time));
  return { features, provinceNews: provinceNews.slice(0, 8), roads: roads.slice(0, 10) };
}

export async function fetchIncidents() {
  const gazetteerPath = path.join(CONFIG.dirs.static, 'gazetteer.json');
  if (!fs.existsSync(gazetteerPath)) throw new Error('data/static/gazetteer.json missing');
  const gazetteer = JSON.parse(fs.readFileSync(gazetteerPath, 'utf8')).entries || [];

  const [newsItems, ddpmItems, roadItems] = await Promise.all([
    fetchRss('"กำแพงเพชร" (น้ำท่วม OR น้ำป่า OR น้ำล้นตลิ่ง OR น้ำหลาก OR จมบาดาล OR อุทกภัย)'),
    fetchRss('"กำแพงเพชร" ("ปภ." OR "กรมป้องกันและบรรเทาสาธารณภัย") (น้ำท่วม OR น้ำป่า OR น้ำหลาก OR เตือนภัย OR อุทกภัย)'),
    fetchRss('"กำแพงเพชร" (ถนน OR ทางหลวง OR สะพาน) (น้ำท่วม OR ตัดขาด OR ปิดการจราจร)').catch(() => []),
  ]);
  const { features, provinceNews, roads } = buildIncidents([...ddpmItems, ...newsItems, ...roadItems], gazetteer);
  return {
    type: 'FeatureCollection',
    generatedAt: new Date().toISOString(),
    source: 'ข่าวและประกาศ ปภ. (Google News RSS)',
    features,
    provinceNews,
    roads,
  };
}
