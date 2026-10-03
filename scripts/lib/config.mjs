// Shared configuration + environment loading for all build scripts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Load KEY=VALUE pairs from .env (local dev only; on GitHub Actions secrets come from process.env). */
export function loadEnv(file = path.join(ROOT, '.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

export const CONFIG = {
  provinceCode: '62',
  provinceName: 'กำแพงเพชร',
  /** Where the previous deployment lives, used to reuse data between runs (no commits needed). */
  prevBaseUrl: process.env.PREV_BASE_URL || 'https://chomphoo.github.io/Flood_KP/data/live/',
  dirs: {
    out: path.join(ROOT, 'out', 'live'), // generated every run
    store: process.env.STORE_DIR || path.join(ROOT, 'store'), // checkout of the `data` branch (persistent)
    site: path.join(ROOT, '_site'),
    static: path.join(ROOT, 'data', 'static'),
  },
  /** Minimum minutes between fetches per source (protects upstream APIs; reuse previous data otherwise). */
  minIntervalMin: {
    thaiwater: 0,
    gistda: 180,
    glofas: 360,
  },
  /**
   * GloFAS forecast points on the Ping river. `lat/lon` = gauge (for display);
   * `cell` = GloFAS 0.05° grid cell on the main stem (nearest cells are tributaries with ~3 m³/s,
   * the main stem carries ~420 m³/s on average). Found with a 7×7 grid search around each gauge.
   */
  glofasPoints: [
    { id: 'P.7A', name: 'แม่น้ำปิง ตัวเมืองกำแพงเพชร', lat: 16.478, lon: 99.518, cell: [16.475, 99.475] },
    { id: 'P.15', name: 'แม่น้ำปิง อ.คลองขลุง', lat: 16.214, lon: 99.722, cell: [16.225, 99.675] },
    { id: 'P.16', name: 'แม่น้ำปิง อ.ขาณุวรลักษบุรี', lat: 16.065, lon: 99.86, cell: [16.075, 99.825] },
  ],
  amphoe: {
    '6201': 'เมืองกำแพงเพชร',
    '6202': 'ไทรงาม',
    '6203': 'คลองลาน',
    '6204': 'ขาณุวรลักษบุรี',
    '6205': 'คลองขลุง',
    '6206': 'พรานกระต่าย',
    '6207': 'ลานกระบือ',
    '6208': 'ทรายทองวัฒนา',
    '6209': 'ปางศิลาทอง',
    '6210': 'บึงสามัคคี',
    '6211': 'โกสัมพีนคร',
  },
};

export const SECRETS = {
  gistdaKey: process.env.GISTDA_KEY || process.env.GISTDA_API_KEY || '',
};
