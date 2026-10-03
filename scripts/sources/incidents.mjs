// Incident & Risk points from News and DDPM (ปภ.) announcements.
// Rule-based, automated, no AI required, no manual approval required.
// Fetches news and disaster announcements, matches them to Kamphaeng Phet gazetteer locations,
// and outputs a GeoJSON layer with severity, links, and details.
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../lib/config.mjs';
import { fetchJson, round } from '../lib/util.mjs';

const POSITIVE_KEYWORDS = [
  'น้ำท่วม', 'น้ำป่า', 'น้ำหลาก', 'น้ำล้นตลิ่ง', 'จมบาดาล', 'อุทกภัย',
  'ล้นสปิลเวย์', 'ท่วมขัง', 'เอ่อล้น', 'ระบายน้ำ', 'เตือนภัย', 'ดินถล่ม',
  'อพยพ', 'ติดค้าง', 'ตัดขาด', 'ทะลักท่วม',
];

const EXCLUDE_PATTERNS = [
  /เปิดให้เที่ยว/i,
  /เปิดฤดูท่องเที่ยว/i,
  /แห่เที่ยว/i,
  /ชวนเที่ยว/i,
  /จุดเช็กอิน/i,
];

function isFloodRelated(text) {
  for (const ex of EXCLUDE_PATTERNS) {
    if (ex.test(text)) return false;
  }
  return POSITIVE_KEYWORDS.some((kw) => text.includes(kw));
}

function calculateSeverity(text) {
  const criticalWords = ['จมบาดาล', 'วิกฤต', 'น้ำป่า', 'อพยพ', 'เสียหายหนัก', 'ติดค้าง', 'ตัดขาด', 'ทะลักท่วม', 'ถล่ม'];
  const warnWords = ['น้ำล้นตลิ่ง', 'น้ำท่วม', 'ท่วมขัง', 'เอ่อล้น', 'เตือนภัย', 'ล้นสปิลเวย์'];
  if (criticalWords.some((w) => text.includes(w))) return 3;
  if (warnWords.some((w) => text.includes(w))) return 2;
  return 1;
}

/**
 * Fetch news from Google News RSS.
 */
async function fetchRss(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=th&gl=TH&ceid=TH:th`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Google News HTTP ${res.status}`);
  const text = await res.text();
  return [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const title = (m[1].match(/<title>([\s\S]*?)<\/title>/)?.[1] || '').replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').replace(/&quot;/g, '"');
    const link = m[1].match(/<link>([\s\S]*?)<\/link>/)?.[1] || '';
    const pubDate = m[1].match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || '';
    const source = (m[1].match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] || '').replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1');
    const desc = (m[1].match(/<description>([\s\S]*?)<\/description>/)?.[1] || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').trim();
    return { title, link, pubDate, source, desc };
  });
}

/**
 * Fetch and extract incident points for Kamphaeng Phet.
 */
export async function fetchIncidents() {
  const gazetteerPath = path.join(CONFIG.dirs.static, 'gazetteer.json');
  if (!fs.existsSync(gazetteerPath)) {
    throw new Error('data/static/gazetteer.json missing');
  }
  const gazetteer = JSON.parse(fs.readFileSync(gazetteerPath, 'utf8')).entries || [];

  // Sort gazetteer: tambons first, then longer names first to avoid partial matches
  const sortedGazetteer = [...gazetteer].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'tambon' ? -1 : 1;
    return b.name.length - a.name.length;
  });

  // Query Google News for flood news and DDPM announcements
  const [newsItems, ddpmItems] = await Promise.all([
    fetchRss('"กำแพงเพชร" (น้ำท่วม OR น้ำป่า OR น้ำล้นตลิ่ง OR น้ำหลาก OR จมบาดาล OR อุทกภัย)'),
    fetchRss('"กำแพงเพชร" ("ปภ." OR "กรมป้องกันและบรรเทาสาธารณภัย") (น้ำท่วม OR น้ำป่า OR น้ำหลาก OR เตือนภัย OR อุทกภัย)'),
  ]);

  const rawArticles = [...newsItems, ...ddpmItems];

  // Deduplicate by URL and title
  const seenUrls = new Set();
  const articles = [];
  for (const a of rawArticles) {
    if (!a.title || seenUrls.has(a.link) || seenUrls.has(a.title)) continue;
    seenUrls.add(a.link);
    seenUrls.add(a.title);
    articles.push(a);
  }

  // Filter relevant and recent (past 14 days)
  const now = Date.now();
  const maxAgeMs = 14 * 86400e3;

  const clusters = new Map(); // key -> incident cluster

  for (const art of articles) {
    const fullText = `${art.title} ${art.desc}`;
    if (!isFloodRelated(fullText)) continue;

    const time = art.pubDate ? new Date(art.pubDate).getTime() : now;
    if (now - time > maxAgeMs) continue; // Skip old news

    // Match with gazetteer
    let match = null;
    for (const loc of sortedGazetteer) {
      const pattern = loc.type === 'tambon'
        ? new RegExp(`(ต\\.|ตำบล|บ้าน)?\\s*${loc.name}`, 'i')
        : new RegExp(`(อ\\.|อำเภอ)?\\s*${loc.name}`, 'i');
      if (pattern.test(fullText)) {
        match = loc;
        break;
      }
    }

    // If no specific tambon/amphoe matched, default to เมืองกำแพงเพชร if mentioned
    if (!match && /กำแพงเพชร/i.test(fullText)) {
      match = sortedGazetteer.find((g) => g.type === 'amphoe' && g.name === 'เมืองกำแพงเพชร');
    }

    if (!match) continue;

    const clusterKey = `${match.type}:${match.amphoe}:${match.name}`;
    const sev = calculateSeverity(fullText);

    if (!clusters.has(clusterKey)) {
      clusters.set(clusterKey, {
        id: `inc:${match.type === 'tambon' ? match.name : match.amphoe}`,
        locName: match.type === 'tambon' ? `ต.${match.name} (อ.${match.amphoe})` : `อ.${match.name}`,
        amphoe: match.amphoe,
        tambon: match.type === 'tambon' ? match.name : null,
        type: match.type,
        lat: match.lat,
        lon: match.lon,
        maxSev: sev,
        latestTime: time,
        articles: [],
      });
    }

    const c = clusters.get(clusterKey);
    if (sev > c.maxSev) c.maxSev = sev;
    if (time > c.latestTime) c.latestTime = time;
    c.articles.push({
      title: art.title,
      source: art.source || 'รายงานข่าว',
      url: art.link,
      pubDate: art.pubDate,
      time: new Date(time).toISOString(),
      isDdpm: art.title.includes('ปภ.') || art.desc.includes('ปภ.'),
    });
  }

  // Convert clusters to GeoJSON Point features
  const features = [...clusters.values()]
    .map((c) => {
      // Sort articles newest first
      c.articles.sort((a, b) => new Date(b.time) - new Date(a.time));
      const top = c.articles[0];
      return {
        type: 'Feature',
        id: c.id,
        geometry: {
          type: 'Point',
          coordinates: [c.lon, c.lat],
        },
        properties: {
          id: c.id,
          title: top.title,
          locName: c.locName,
          amphoe: c.amphoe,
          tambon: c.tambon,
          source: top.source,
          url: top.url,
          sev: c.maxSev,
          count: c.articles.length,
          hasDdpm: c.articles.some((a) => a.isDdpm),
          time: new Date(c.latestTime).toISOString(),
          articles: c.articles.slice(0, 5),
        },
      };
    })
    .sort((a, b) => b.properties.sev - a.properties.sev || new Date(b.properties.time) - new Date(a.properties.time));

  return {
    type: 'FeatureCollection',
    generatedAt: new Date().toISOString(),
    source: 'ข่าวและประกาศ ปภ. (Google News RSS)',
    features,
  };
}
