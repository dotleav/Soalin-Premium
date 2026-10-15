// Potong bagian atas (legenda warna) dari semua gambar di images/stacks-raw/,
// tulis hasilnya ke images/stacks/ dengan struktur folder yang sama, lalu jalankan build-stacks.
// Pakai:  node scripts/crop-stacks.cjs            (potong 30% dari atas)
//         node scripts/crop-stacks.cjs 0.25       (potong 25% dari atas)
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.join(__dirname, "..");
const RAW = path.join(ROOT, "images", "stacks-raw");
const OUT = path.join(ROOT, "images", "stacks");
const CROP_TOP = Number(process.argv[2] || 0.30); // fraksi tinggi gambar yang dipotong dari atas
const EXT = /\.(jpe?g|png|webp|gif)$/i;

if (!fs.existsSync(RAW)) {
  console.error("Folder images/stacks-raw belum ada. Taruh folder hasil scraper di sana.");
  process.exit(1);
}

async function run() {
  let count = 0;
  async function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const src = path.join(dir, e.name);
      if (e.isDirectory()) { await walk(src); continue; }
      if (!EXT.test(e.name)) continue;
      const rel = path.relative(RAW, src);
      const dst = path.join(OUT, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      const meta = await sharp(src).metadata();
      const top = Math.round(meta.height * CROP_TOP);
      await sharp(src)
        .extract({ left: 0, top, width: meta.width, height: meta.height - top })
        .toFile(dst);
      count++;
    }
  }
  await walk(RAW);
  console.log(`Dipotong ${count} gambar (${Math.round(CROP_TOP * 100)}% dari atas) -> images/stacks/`);
  require("./build-stacks.cjs");
}

run().catch((err) => { console.error(err); process.exit(1); });
