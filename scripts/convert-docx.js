// scripts/convert-docx.js
// Konversi file .docx (soal + gambar) menjadi file data/questions.js
// Jalankan: node scripts/convert-docx.js path/ke/file.docx
//
// FORMAT YANG HARUS DIIKUTI DI DALAM DOCX:
//
// === BAGIAN 1 — Soal Normal ===
// (heading H2: "Bagian 1" atau di awal dokumen sebelum tabel)
//
//   1. Pertanyaan soal di sini...
//      [gambar soal taruh di sini, langsung di bawah teks soal]
//   A. Opsi A
//   B. Opsi B
//   C. Opsi C
//   D. Opsi D
//   E. Opsi E
//   Kunci: C
//   Penjelasan: Teks penjelasan...
//      [gambar penjelasan taruh di sini]
//
// === BAGIAN 2 — Soal Rusak ===
// (heading H2: "Bagian 2" atau mengandung "Gagal Diperbaiki")
// Berupa tabel dengan 3 kolom:
//   | No | Soal Asli (dari rekapan) | Gambar Penjelasan |
//
// Soal rusak di-output sebagai { isBroken: true } — di app ditampilkan
// sebagai kartu tap-to-reveal (tekan kartu → gambar penjelasan muncul).
//
// ID soal akan dibuat otomatis (Q1, Q2, ...) kecuali kamu menulis baris
// "ID: namaID" tepat sebelum nomor soal.

import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import mammoth from "mammoth";
import JSZip from "jszip";

// sharp dipakai buat crop/rotasi gambar "literal" (lihat bagian 0 di bawah).
// Di-load lazy (bukan static import) supaya kalau belum ke-install, error-nya
// jelas ("jalankan npm install") alih-alih stack trace mentah dari Node.
let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.error("Package 'sharp' belum terpasang (dipakai buat crop/rotasi gambar).");
  console.error("Jalankan dulu: npm install");
  process.exit(1);
}

const docxPath = process.argv[2];
if (!docxPath) {
  console.error("Pakai: node scripts/convert-docx.js path/ke/file.docx [kategori] [judul-paket]");
  process.exit(1);
}
// Kategori & judul paket bersifat opsional. Kalau kategori tidak diisi,
// konversi jalan seperti biasa (mode lama): tulis langsung ke data/questions.js
// + images/ di root project. Kalau kategori diisi, soal disimpan sebagai
// "paket" terpisah di data/packages/<id>/questions.js + images/packages/<id>/,
// dan didaftarkan ke data/manifest.js supaya muncul di pemilih kategori di app.
const kategoriArg = (process.argv[3] || "").trim();
const paketArg = (process.argv[4] || "").trim();
const usePackageMode = kategoriArg.length > 0;

function slugify(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "paket";
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const paketTitle = usePackageMode
  ? (paketArg || path.basename(docxPath, path.extname(docxPath)))
  : "";
const packageId = usePackageMode ? `${slugify(kategoriArg)}__${slugify(paketTitle)}` : "";

const imagesDir = usePackageMode
  ? path.join(projectRoot, "images", "packages", packageId)
  : path.join(projectRoot, "images");
const dataDir = usePackageMode
  ? path.join(projectRoot, "data", "packages", packageId)
  : path.join(projectRoot, "data");
const imagesUrlPrefix = usePackageMode ? `images/packages/${packageId}` : "images";
fs.mkdirSync(imagesDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

let imageCounter = 0;

// --- 0. Baca crop/rotasi/flip "literal" tiap gambar langsung dari XML docx ---
// Mammoth (dipakai buat ekstrak gambar) selalu mengembalikan gambar ASLI dari
// dalam docx — kalau di Word kamu crop atau rotasi gambarnya, mammoth abaikan
// itu semua dan tetap kasih file gambar utuh yang belum di-crop/rotasi.
// Supaya hasil convert PERSIS seperti yang kelihatan di Word, kita baca dulu
// XML mentah docx-nya (docx = file zip berisi XML) buat cari info crop
// (<a:srcRect>) dan rotasi (<a:xfrm rot="...">) tiap gambar, dalam urutan
// dokumen — lalu diterapkan manual pakai sharp sebelum gambar ditulis ke disk.
function extractDrawingTransforms(documentXml) {
  const transforms = [];
  const drawingRe = /<w:drawing>([\s\S]*?)<\/w:drawing>/g;
  let dm;
  while ((dm = drawingRe.exec(documentXml)) !== null) {
    const block = dm[1];

    // Gambar yang cuma di-link (bukan embed) tidak punya file lokal — lewati.
    const embedMatch = block.match(/<a:blip\b[^>]*\br:embed="([^"]+)"/);
    if (!embedMatch) continue;

    // Crop: <a:srcRect l=".." t=".." r=".." b=".."/> — satuan: perseribu persen
    // (100000 = 100%). Atribut yang tidak ada dianggap 0 (tidak di-crop dari sisi itu).
    let crop = { l: 0, t: 0, r: 0, b: 0 };
    const srcRectMatch = block.match(/<a:srcRect\b([^/]*)\/>/);
    if (srcRectMatch) {
      const attrs = srcRectMatch[1];
      const get = (name) => {
        const m = attrs.match(new RegExp(`\\b${name}="(-?\\d+)"`));
        return m ? Math.max(0, parseInt(m[1], 10) / 100000) : 0;
      };
      crop = { l: get("l"), t: get("t"), r: get("r"), b: get("b") };
    }
    const hasCrop = crop.l > 0 || crop.t > 0 || crop.r > 0 || crop.b > 0;

    // Rotasi + flip ada di <a:xfrm> (satuan rot: perenampuluh ribu derajat, searah jarum jam).
    let rotDeg = 0;
    let flipH = false;
    let flipV = false;
    const xfrmMatch = block.match(/<a:xfrm\b([^>]*)>/);
    if (xfrmMatch) {
      const attrs = xfrmMatch[1];
      const rotMatch = attrs.match(/\brot="(-?\d+)"/);
      if (rotMatch) rotDeg = parseInt(rotMatch[1], 10) / 60000;
      flipH = /\bflipH="1"/.test(attrs);
      flipV = /\bflipV="1"/.test(attrs);
    }

    transforms.push({ crop, hasCrop, rotDeg, flipH, flipV });
  }
  return transforms;
}

let drawingTransforms = [];
try {
  const docxBuffer = fs.readFileSync(docxPath);
  const zip = await JSZip.loadAsync(docxBuffer);
  const documentXmlFile = zip.file("word/document.xml");
  if (documentXmlFile) {
    const documentXml = await documentXmlFile.async("string");
    drawingTransforms = extractDrawingTransforms(documentXml);
  }
} catch (e) {
  console.log(
    `Catatan: gagal baca info crop/rotasi dari docx (${e.message}). ` +
    `Gambar akan diambil apa adanya (tanpa crop/rotasi).`
  );
}

// Terapkan crop (extract area) lalu flip lalu rotasi — urutan ini mengikuti
// bagaimana Word merender: crop dulu ke bagian yang dipakai, baru transformasi
// bingkai (flip/rotate) di atas hasil crop itu.
async function applyImageTransform(buffer, transform, filename) {
  if (!transform || (!transform.hasCrop && !transform.rotDeg && !transform.flipH && !transform.flipV)) {
    return buffer;
  }
  try {
    let img = sharp(buffer, { failOn: "none" });

    if (transform.hasCrop) {
      const meta = await img.metadata();
      const w = meta.width || 0;
      const h = meta.height || 0;
      if (w > 0 && h > 0) {
        const { l, t, r, b } = transform.crop;
        let left = Math.round(w * l);
        let top = Math.round(h * t);
        let width = Math.round(w * (1 - l - r));
        let height = Math.round(h * (1 - t - b));
        left = Math.min(Math.max(left, 0), w - 1);
        top = Math.min(Math.max(top, 0), h - 1);
        width = Math.min(Math.max(width, 1), w - left);
        height = Math.min(Math.max(height, 1), h - top);
        img = img.extract({ left, top, width, height });
      }
    }

    if (transform.flipH) img = img.flop(); // flip horizontal (cermin kiri-kanan)
    if (transform.flipV) img = img.flip();  // flip vertikal (cermin atas-bawah)

    if (transform.rotDeg) {
      img = img.rotate(transform.rotDeg, { background: { r: 255, g: 255, b: 255, alpha: 1 } });
    }

    return await img.toBuffer();
  } catch (e) {
    console.log(`Catatan: gagal terapkan crop/rotasi untuk ${filename}: ${e.message} (pakai gambar asli)`);
    return buffer;
  }
}

// --- 1. Convert docx -> HTML, ekstrak gambar ke /images ---
const result = await mammoth.convertToHtml(
  { path: docxPath },
  {
    convertImage: mammoth.images.imgElement(async (image) => {
      imageCounter += 1;
      const ext = (image.contentType || "image/png").split("/")[1] || "png";
      const filename = `img-${String(imageCounter).padStart(3, "0")}.${ext}`;
      const base64 = await image.read("base64");
      let buffer = Buffer.from(base64, "base64");

      // Urutan mammoth membaca gambar mengikuti urutan dokumen, sama seperti
      // urutan <w:drawing> yang kita scan di atas — jadi index-nya sejajar.
      const transform = drawingTransforms[imageCounter - 1];
      buffer = await applyImageTransform(buffer, transform, filename);

      fs.writeFileSync(path.join(imagesDir, filename), buffer);
      return { src: `${imagesUrlPrefix}/${filename}` };
    }),
  }
);

const html = result.value;
if (result.messages?.length) {
  console.log("Catatan dari mammoth:", result.messages.map((m) => m.message).join("; "));
}

// --- 2. Deteksi batas Bagian 1 vs Bagian 2 ---
// Bagian 2 ditandai dengan heading yang mengandung "Bagian 2" atau
// "Gagal Diperbaiki". Semua <table> di bawahnya dianggap tabel soal rusak.
// Jika tidak ada heading Bagian 2, seluruh dokumen diparsing sebagai Bagian 1.

const part2HeadingRegex = /bagian\s*2|gagal\s+diperbaiki/i;
const part3HeadingRegex = /bagian\s*3|soal\s+isian/i;

// Cari index awal Bagian 2 & Bagian 3 (heading h1/h2/h3 yang cocok)
function splitParts(html) {
  // Cari semua heading h1/h2/h3 untuk tanda batas
  const headingRe = /<(h[1-3])[^>]*>([\s\S]*?)<\/\1>/gi;
  let lastPart2HeadingEnd = -1;
  let lastPart3HeadingEnd = -1;
  let match;
  while ((match = headingRe.exec(html)) !== null) {
    const headingText = match[2].replace(/<[^>]+>/g, "").trim();
    if (part2HeadingRegex.test(headingText)) lastPart2HeadingEnd = match.index;
    if (part3HeadingRegex.test(headingText)) lastPart3HeadingEnd = match.index;
  }
  if (lastPart3HeadingEnd >= 0 && lastPart3HeadingEnd < lastPart2HeadingEnd) lastPart3HeadingEnd = -1; // urutan gak wajar, abaikan

  if (lastPart2HeadingEnd < 0) {
    // Tidak ada Bagian 2 — cek apakah ada <table>, tapi jangan lewati heading
    // Bagian 3 kalau sudah ketemu, atau tabel isian ikut kesedot jadi Bagian 2.
    const searchHtml = lastPart3HeadingEnd >= 0 ? html.slice(0, lastPart3HeadingEnd) : html;
    const tableIdx = searchHtml.indexOf("<table");
    if (tableIdx < 0) {
      return {
        part1Html: lastPart3HeadingEnd < 0 ? html : html.substring(0, lastPart3HeadingEnd),
        part2Html: "",
        part3Html: lastPart3HeadingEnd < 0 ? "" : html.substring(lastPart3HeadingEnd),
      };
    }
    // Ada tabel tapi tidak ada heading Bagian 2 — anggap semua sebelum tabel = Bagian 1
    return {
      part1Html: html.substring(0, tableIdx),
      part2Html: html.substring(tableIdx, lastPart3HeadingEnd < 0 ? undefined : lastPart3HeadingEnd),
      part3Html: lastPart3HeadingEnd < 0 ? "" : html.substring(lastPart3HeadingEnd),
    };
  }

  return {
    part1Html: html.substring(0, lastPart2HeadingEnd),
    part2Html: lastPart3HeadingEnd < 0 ? html.substring(lastPart2HeadingEnd) : html.substring(lastPart2HeadingEnd, lastPart3HeadingEnd),
    part3Html: lastPart3HeadingEnd < 0 ? "" : html.substring(lastPart3HeadingEnd),
  };
}

const { part1Html, part2Html, part3Html } = splitParts(html);

// --- 3. Helper: bersihkan teks dari tag HTML ---
function cleanText(fragment) {
  return fragment
    .replace(/<img[^>]*>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function extractImages(fragment) {
  return [...fragment.matchAll(/<img[^>]*src="([^"]+)"[^>]*>/g)].map((x) => x[1]);
}

// --- 4. Parse Bagian 1 — soal MCQ normal ---

// Fallback: kadang seluruh soal (pertanyaan + opsi a-e + Kunci Jawaban)
// ada dalam SATU paragraf tanpa line break (tidak ada <br>/<p> pemisah).
// Kalau begitu, opsi & kunci jawaban tidak akan pernah terdeteksi oleh
// parser baris-per-baris di bawah. Fungsi ini mendeteksi pola inline
// "... a. opsi b. opsi c. opsi d. opsi e. opsi Kunci Jawaban: X" di dalam
// satu baris teks dan memecahnya jadi { question, options, answer }.
function splitInlineQuestion(rawText) {
  let text = rawText;
  let answer = "";
  const ansMatch = text.match(/\bKunci(?:\s*Jawaban)?\s*:?\s*([A-Ea-e])\b\s*$/i);
  if (ansMatch) {
    answer = ansMatch[1].toUpperCase();
    text = text.slice(0, ansMatch.index).trim();
  }
  const optRe = /\s([A-Ea-e])[.)]\s+/g;
  const matches = [...text.matchAll(optRe)];
  // Butuh minimal 3 opsi terdeteksi dan harus mulai dari A/a supaya yakin
  // ini memang daftar opsi, bukan kebetulan (mis. singkatan "dr." di kalimat).
  if (matches.length < 3) return null;
  if (matches[0][1].toUpperCase() !== "A") return null;

  const first = matches[0];
  const questionText = text.slice(0, first.index).trim();
  const options = {};
  for (let i = 0; i < matches.length; i++) {
    const letter = matches[i][1].toUpperCase();
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    options[letter] = text.slice(start, end).trim();
  }
  return { question: questionText, options, answer };
}

function parsePart1(html) {
  // Pecah HTML jadi baris-baris token (teks/gambar)
  const blockRegex = /<(p|h1|h2|h3|ol|ul)[^>]*>([\s\S]*?)<\/\1>/g;
  const lines = [];
  let m;
  while ((m = blockRegex.exec(html)) !== null) {
    const tag = m[1];
    const inner = m[2];
    const isHeading = tag === "h1" || tag === "h2" || tag === "h3";

    if (tag === "ol" || tag === "ul") {
      const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/g;
      let lm;
      while ((lm = liRegex.exec(inner)) !== null) {
        const liInner = lm[1];
        const subParts = liInner.split(/<br\s*\/?>/i);
        subParts.forEach((part, idx) => {
          const imgs = extractImages(part);
          const text = cleanText(part);
          if (text || imgs.length) {
            lines.push({
              text,
              images: imgs,
              isHeading: false,
              isListItem: tag === "ol" && idx === 0,
            });
          }
        });
      }
      continue;
    }

    const subParts = inner.split(/<br\s*\/?>/i);
    subParts.forEach((part) => {
      const imgs = extractImages(part);
      const text = cleanText(part);
      if (text || imgs.length) {
        lines.push({ text, images: imgs, isHeading, isListItem: false });
      }
    });
  }

  // Parse baris jadi soal
  const questions = [];
  let current = null;
  let pendingId = null;
  let currentCategory = "";
  let mode = null; // 'question' | 'explanation' | 'options' | 'answer'

  const questionStart = /^(\d+)[.)]\s*(.*)$/;
  const idLine = /^ID\s*:\s*(.+)$/i;
  const optionLine = /^([A-Ea-e])[.)]\s*(.*)$/;
  // Terima "Kunci: X", "Jawaban: X", ATAU gabungan "Kunci Jawaban: X"
  const answerLine = /^(?:Kunci\s*Jawaban|Jawaban\s*Kunci|Kunci|Jawaban)\s*:?\s*([A-Ea-e])\b.*$/i;
  const explanationLine = /^Penjelasan\s*:?\s*(.*)$/i;
  const categoryLine = /^Kategori\s*:\s*(.+)$/i;

  function pushCurrent() {
    if (current) questions.push(current);
    current = null;
  }

  for (const line of lines) {
    const { text, images, isHeading, isListItem } = line;

    if (isHeading) {
      currentCategory = text;
      continue;
    }

    if (categoryLine.test(text)) {
      currentCategory = text.match(categoryLine)[1].trim();
      continue;
    }

    if (idLine.test(text)) {
      pendingId = text.match(idLine)[1].trim();
      continue;
    }

    if (isListItem) {
      pushCurrent();
      const autoId = pendingId || `Q${questions.length + 1}`;
      pendingId = null;
      const inline = splitInlineQuestion(text);
      current = {
        id: autoId,
        category: currentCategory,
        question: inline ? inline.question : text,
        questionImages: [...images],
        options: inline ? inline.options : {},
        answer: inline ? inline.answer : "",
        explanation: "",
        explanationImages: [],
        isBroken: false,
      };
      mode = inline ? "answer" : "question";
      continue;
    }

    const qStart = text.match(questionStart);
    if (qStart) {
      pushCurrent();
      const autoId = pendingId || `Q${questions.length + 1}`;
      pendingId = null;
      const rawQuestionText = qStart[2].trim();
      const inline = splitInlineQuestion(rawQuestionText);
      current = {
        id: autoId,
        category: currentCategory,
        question: inline ? inline.question : rawQuestionText,
        questionImages: [...images],
        options: inline ? inline.options : {},
        answer: inline ? inline.answer : "",
        explanation: "",
        explanationImages: [],
        isBroken: false,
      };
      mode = inline ? "answer" : "question";
      continue;
    }

    if (!current) continue;

    const optMatch = text.match(optionLine);
    if (optMatch) {
      current.options[optMatch[1].toUpperCase()] = optMatch[2].trim();
      current.questionImages.push(...images);
      mode = "options";
      continue;
    }

    const ansMatch = text.match(answerLine);
    if (ansMatch) {
      current.answer = ansMatch[1].toUpperCase();
      mode = "answer";
      continue;
    }

    const expMatch = text.match(explanationLine);
    if (expMatch) {
      current.explanation = expMatch[1].trim();
      current.explanationImages.push(...images);
      mode = "explanation";
      continue;
    }

    if (mode === "question") {
      current.question += (current.question ? " " : "") + text;
      current.questionImages.push(...images);
    } else if (mode === "explanation") {
      current.explanation += (current.explanation ? " " : "") + text;
      current.explanationImages.push(...images);
    } else if (mode === "options" && images.length) {
      current.questionImages.push(...images);
    }
  }
  pushCurrent();
  return questions;
}

// --- 5. Parse Bagian 2 — tabel soal rusak ---
// Kolom: 0=No, 1=Soal Asli, 2=Gambar Penjelasan
// Output: { id, question, explanationImages, isBroken: true }

function parsePart2(html, startingQNumber) {
  const brokenQuestions = [];
  const tableRegex = /<table[\s\S]*?<\/table>/gi;
  let tableMatch;

  while ((tableMatch = tableRegex.exec(html)) !== null) {
    const tableHtml = tableMatch[0];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    let isFirstRow = true;

    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
      const rowHtml = rowMatch[1];
      // Detect header row: contains <th> or "Soal Asli" / "No" keywords
      const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      const cells = [];
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
        cells.push(cellMatch[1]);
      }

      if (cells.length < 2) continue;

      // Skip header row (first row or row with "Soal Asli" / "Gambar")
      const firstCellText = cleanText(cells[0]);
      const secondCellText = cleanText(cells[1] || "");
      if (
        isFirstRow ||
        /soal\s+asli|gambar\s+penjelasan/i.test(secondCellText) ||
        /^no\.?$/i.test(firstCellText)
      ) {
        isFirstRow = false;
        // Still might be a data row if first cell is a number
        if (!/^\d+$/.test(firstCellText)) continue;
      }
      isFirstRow = false;

      // col 0: number (used as original question number reference)
      // col 1: broken question text
      // col 2: explanation image(s)
      const origNo = firstCellText;
      const questionText = secondCellText;
      const explanationImages = cells[2] ? extractImages(cells[2]) : [];
      // Also grab any images from question cell itself
      const questionImages = extractImages(cells[1] || "");

      if (!questionText) continue;

      const qNum = startingQNumber + brokenQuestions.length + 1;
      brokenQuestions.push({
        id: `QB${origNo || qNum}`,
        category: "Soal Rusak",
        question: questionText,
        questionImages,
        options: {},
        answer: "",
        explanation: "",
        explanationImages,
        isBroken: true,
      });
    }
  }

  return brokenQuestions;
}

// --- 5b. Parse Bagian 3 — tabel soal isian ---
// Kolom: 0=No, 1=Soal, 2=Jawaban
// Output: { id, question, answer, isIsian: true }

function parsePart3(html, startingQNumber) {
  const isianQuestions = [];
  const tableRegex = /<table[\s\S]*?<\/table>/gi;
  let tableMatch;

  while ((tableMatch = tableRegex.exec(html)) !== null) {
    const tableHtml = tableMatch[0];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    let isFirstRow = true;

    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
      const rowHtml = rowMatch[1];
      const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      const cells = [];
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
        cells.push(cellMatch[1]);
      }

      if (cells.length < 2) continue;

      const firstCellText = cleanText(cells[0]);
      if (isFirstRow || /^no\.?$/i.test(firstCellText)) {
        isFirstRow = false;
        if (!/^\d+$/.test(firstCellText)) continue; // header, bukan baris data
      }
      isFirstRow = false;

      // col 0: nomor asli, col 1: teks soal, col 2: kunci jawaban (teks bebas)
      const origNo = firstCellText;
      const questionText = cleanText(cells[1] || "");
      const answerText = cleanText(cells[2] || "");
      const questionImages = extractImages(cells[1] || "");

      if (!questionText) continue;

      const qNum = startingQNumber + isianQuestions.length + 1;
      isianQuestions.push({
        id: `QI${origNo || qNum}`,
        category: "Soal Isian",
        question: questionText,
        questionImages,
        options: {},
        answer: answerText,
        explanation: "",
        explanationImages: [],
        isBroken: false,
        isIsian: true,
      });
    }
  }

  return isianQuestions;
}

// --- 7. Gabungkan hasil kedua bagian ---
const part1Questions = parsePart1(part1Html);
const part2Questions = parsePart2(part2Html, part1Questions.length);
const part3Questions = parsePart3(part3Html, part1Questions.length + part2Questions.length);
const allQuestions = [...part1Questions, ...part2Questions, ...part3Questions];

// --- 8. Tulis hasil ke questions.js (mode lama: data/questions.js, mode paket: data/packages/<id>/questions.js) ---
const outPath = path.join(dataDir, "questions.js");
const fileContent = `// File ini DIBUAT OTOMATIS oleh scripts/convert-docx.js dari: ${path.basename(docxPath)}
// Jangan diedit manual kalau masih mau re-generate dari docx.
// Untuk soal manual tambahan, edit array di bawah ini langsung (boleh kok).
//
// Soal dengan isBroken: true = soal rusak dari Bagian 2 (tabel).
// Di app ditampilkan sebagai kartu tap-to-reveal — tekan kartu untuk melihat
// gambar penjelasan (explanationImages).
//
// Soal dengan isIsian: true = soal isian dari Bagian 3 (tabel).
// Di app ditampilkan sebagai kartu jawaban-singkat: textarea + tombol kirim,
// lalu mereveal kunci jawaban (field 'answer', berupa teks bebas).

export const questions = ${JSON.stringify(allQuestions, null, 2)};
`;
fs.writeFileSync(outPath, fileContent, "utf-8");

// --- 9. Mode paket: daftarkan/update entry di data/manifest.js ---
async function upsertManifest() {
  const manifestPath = path.join(projectRoot, "data", "manifest.js");
  let packages = [];
  if (fs.existsSync(manifestPath)) {
    try {
      const mod = await import(pathToFileURL(manifestPath).href + `?t=${Date.now()}`);
      packages = Array.isArray(mod.packages) ? mod.packages : [];
    } catch (e) {
      console.log("Catatan: gagal baca manifest lama, membuat manifest baru. (" + e.message + ")");
      packages = [];
    }
  }

  const entry = {
    id: packageId,
    category: kategoriArg,
    title: paketTitle,
    file: `./data/packages/${packageId}/questions.js`,
    count: allQuestions.length,
    convertedAt: new Date().toISOString(),
    source: path.basename(docxPath),
  };
  const idx = packages.findIndex((p) => p.id === packageId);
  if (idx >= 0) packages[idx] = entry;
  else packages.push(entry);

  packages.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));

  const manifestContent = `// File ini DIBUAT/DIKELOLA OTOMATIS oleh scripts/convert-docx.js.
// Berisi daftar semua "paket soal" (hasil konversi docx per kategori).
// Jangan diedit manual kecuali kamu tahu apa yang kamu lakukan — bisa
// dihapus/ditimpa lagi saat konversi berikutnya jalan untuk paket yang sama.

export const packages = ${JSON.stringify(packages, null, 2)};
`;
  fs.writeFileSync(manifestPath, manifestContent, "utf-8");
  return packages.length;
}

const part1Count = part1Questions.length;
const part2Count = part2Questions.length;
const part3Count = part3Questions.length;
console.log(`Selesai. ${allQuestions.length} soal berhasil diparse.`);
console.log(`  Bagian 1 (normal)  : ${part1Count} soal`);
console.log(`  Bagian 2 (rusak)   : ${part2Count} soal`);
console.log(`  Bagian 3 (isian)   : ${part3Count} soal`);
if (usePackageMode) {
  console.log(`  Kategori           : ${kategoriArg}`);
  console.log(`  Paket              : ${paketTitle} (id: ${packageId})`);
}
console.log(`-> ${outPath}`);
console.log(`-> ${imagesDir} (${imageCounter} gambar)`);
if (usePackageMode) {
  const totalPackages = await upsertManifest();
  console.log(`-> ${path.join(projectRoot, "data", "manifest.js")} (${totalPackages} paket terdaftar)`);
}
if (allQuestions.length === 0) {
  console.log("\nTIDAK ADA SOAL TERDETEKSI. Cek apakah format docx mengikuti README.md.");
}
