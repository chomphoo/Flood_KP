# ติดตามน้ำท่วม จังหวัดกำแพงเพชร

เว็บแผนที่ติดตามสถานการณ์น้ำท่วม จ.กำแพงเพชร ใช้งานฟรีทั้งหมด ข้อมูลอัปเดตอัตโนมัติทุก 30 นาทีด้วย GitHub Actions และเผยแพร่บน GitHub Pages

🌐 **https://chomphoo.github.io/Flood_KP/**

## สิ่งที่แสดง

- **สถานการณ์ภาพรวมจังหวัด** (ปกติ / เฝ้าระวัง / น้ำท่วมบางพื้นที่ / วิกฤต) พร้อมเหตุผล
- **ระดับน้ำ** สถานีโทรมาตร 11 สถานี และ **ฝน 24 ชม.** 51 สถานี (สสน.) พร้อมกราฟ 7 วัน
- **พื้นที่น้ำท่วมจากดาวเทียม** 3 / 7 / 30 วันล่าสุด (GISTDA)
- **พื้นที่น้ำท่วมซ้ำซาก** พ.ศ. 2554–2567 (GISTDA)
- **คาดการณ์ปริมาณน้ำแม่น้ำปิง** 30 วัน (Copernicus GloFAS ผ่าน Open-Meteo)
- **เรดาร์ฝน** (RainViewer)
- **ความเคลื่อนไหว** ระบบเทียบข้อมูลแต่ละรอบ แล้วบันทึกว่ามีอะไรเกิดขึ้นใหม่ รุนแรงขึ้น หรือคลี่คลาย
- **หน้าสถิติ** พื้นที่ท่วมรายปี ตำบลเสี่ยง ระดับน้ำย้อนหลัง (ระบบบันทึกเพิ่มให้ทุกวัน)

## โครงสร้าง

```
main branch                         data branch (ข้อมูลสะสม)
├─ index.html, stats.html,          ├─ history/YYYY/YYYY-MM-DD.json   สรุปรายวัน
│  about.html, assets/              ├─ stats/daily.json, stations.json
├─ data/static/  ขอบเขตอำเภอ (OSM)  └─ risk/freq_hex.geojson, freq_summary.json,
├─ scripts/                              glofas_climate.json
│  ├─ build-live.mjs     ดึงข้อมูลทุก 30 นาที → out/live/
│  ├─ archive-daily.mjs  บันทึกรายวัน → store/history, store/stats
│  ├─ build-risk.mjs     พื้นที่เสี่ยง (รายเดือน) → store/risk
│  ├─ build-site.mjs     รวมไฟล์ → _site/ (สำหรับ Pages)
│  ├─ sources/           ThaiWater, GISTDA, GloFAS
│  ├─ lib/               เกณฑ์ สถานการณ์ ฟีด เรขาคณิต
│  └─ test/              unit tests (node:test)
└─ .github/workflows/update.yml
```

GitHub Pages เป็นเว็บแบบ static (บันทึกข้อมูลเองไม่ได้) จึงให้ GitHub Actions ทำหน้าที่ "หลังบ้าน": ดึงข้อมูล → คำนวณ → เขียนไฟล์ JSON → commit ข้อมูลสะสมลง branch `data` → deploy เว็บ

แหล่งข้อมูลแต่ละแหล่งทำงานแยกกัน ถ้าแหล่งใดล่ม ระบบจะใช้ข้อมูลชุดล่าสุดที่เผยแพร่ไว้ และแสดงสถานะในหน้าเว็บ

## รันบนเครื่อง

ต้องใช้ Node.js 20 ขึ้นไป

```bash
npm ci
# สร้างไฟล์ .env (ไม่ถูก commit)
#   GISTDA_KEY=xxxxxxxx
npm run live          # ดึงข้อมูลล่าสุด → out/live/
npm run risk          # พื้นที่เสี่ยง + GloFAS climatology → store/risk/ (ครั้งแรก)
npm run archive       # สรุปเมื่อวาน (เพิ่ม -- --backfill 365 เพื่อย้อนหลัง 1 ปี)
npm run site          # รวมเป็น _site/
npm run serve         # เปิด http://localhost:8080
npm test
```

## Secrets ที่ต้องตั้งใน GitHub

| ชื่อ | ใช้กับ | สมัคร |
|---|---|---|
| `GISTDA_KEY` | ภาพดาวเทียมน้ำท่วม, พื้นที่น้ำท่วมซ้ำซาก | https://disaster.gistda.or.th/services/open-api |

ตั้งที่ *Settings → Secrets and variables → Actions* แหล่งอื่น (ThaiWater, GloFAS, RainViewer) ไม่ต้องใช้ key

สั่งรันเองได้ที่แท็บ *Actions → อัปเดตข้อมูลน้ำท่วม → Run workflow* (ช่อง tasks: `force` ดึงทุกแหล่งทันที, `risk` คำนวณพื้นที่เสี่ยงใหม่, `archive` บันทึกรายวัน)

## แหล่งข้อมูลและสัญญาอนุญาต

สสน. (ThaiWater) · GISTDA · Copernicus GloFAS / Open-Meteo (CC BY 4.0) · RainViewer · © OpenStreetMap contributors (ODbL) · Esri

> เว็บนี้ไม่ใช่ประกาศทางราชการ เหตุฉุกเฉินโทร 1784 (ปภ.) / 1669
