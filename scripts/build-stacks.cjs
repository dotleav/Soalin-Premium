// Scan images/stacks/<nama>/ (termasuk subfolder) dan tulis data/stacks.js.
// Pakai: node scripts/build-stacks.cjs
// Contoh: images/stacks/brain-lobes/sagittal/*.jpg  →  key "brain-lobes/sagittal"
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const STACK_DIR = path.join(ROOT, "images", "stacks");
const OUT = path.join(ROOT, "data", "stacks.js");
const EXT = /\.(jpe?g|png|webp|gif)$/i;

if (!fs.existsSync(STACK_DIR)) {
  console.error("Folder images/stacks belum ada. Buat dulu, lalu taruh folder gambar di dalamnya.");
  process.exit(1);
}

const stacks = {};
function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const imgs = entries
    .filter((e) => e.isFile() && EXT.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (imgs.length && dir !== STACK_DIR) {
    const key = path.relative(STACK_DIR, dir).split(path.sep).join("/");
    stacks[key] = imgs.map((n) => `images/stacks/${key}/${n}`);
  }
  for (const e of entries) if (e.isDirectory()) walk(path.join(dir, e.name));
}
walk(STACK_DIR);

fs.writeFileSync(
  OUT,
  "// Dibuat otomatis oleh scripts/build-stacks.cjs — jangan diedit manual.\n" +
    "window.STACKS = " + JSON.stringify(stacks, null, 2) + ";\n"
);

console.log(`Stack ditemukan: ${Object.keys(stacks).length}`);
for (const [k, v] of Object.entries(stacks)) console.log(`  ${k} (${v.length} gambar)`);
