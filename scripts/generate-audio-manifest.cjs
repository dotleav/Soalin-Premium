// Scan audio/benar dan audio/salah, lalu tulis audio/manifest.js.
// Jalankan: node scripts/generate-audio-manifest.js  (atau npm run audio-manifest)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const AUDIO_DIR = path.join(ROOT, 'audio');
const OUT_FILE = path.join(AUDIO_DIR, 'manifest.js');
const EXT = /\.(mp3|wav|ogg|m4a|aac|webm)$/i;
const FOLDERS = ['benar', 'salah'];

const manifest = {};
for (const folder of FOLDERS) {
  const dir = path.join(AUDIO_DIR, folder);
  manifest[folder] = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => EXT.test(f)).sort((a, b) => a.localeCompare(b))
    : [];
}

const out =
`// File ini di-GENERATE OTOMATIS oleh scripts/generate-audio-manifest.js
// JANGAN diedit manual — tiap kali nambah/hapus/rename file di
// audio/benar/ atau audio/salah/, jalankan ulang: npm run audio-manifest
// (di GitHub, workflow .github/workflows/audio-manifest.yml menjalankannya otomatis saat push)

window.AUDIO_MANIFEST = ${JSON.stringify(manifest, null, 2)};
`;

fs.writeFileSync(OUT_FILE, out);
console.log(`manifest.js ditulis: ${FOLDERS.map((f) => `${f}=${manifest[f].length}`).join(', ')}`);
