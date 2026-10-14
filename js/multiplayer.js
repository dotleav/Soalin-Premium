// ── Multiplayer: kuis bersama (Firebase Realtime Database + Anonymous Auth) ──
// Mode mengikuti tingkat kesulitan tentamen: bekicot = manual reveal (tanpa timer),
// mode lain = timer per soal, jawaban dibuka otomatis saat waktu habis.
// Hasil tidak disimpan; room dihapus host lewat "Tutup room".

let mpScreen = null;      // null | "join" | "name" | "room"
let mpBusy = false;
let mpError = "";
let mpUid = null;
let mpAuthPromise = null;
let mpRoomCode = "";
let mpPendingCode = "";
let mpIsHost = false;
let mpDiff = "bekicot";   // tingkat kesulitan yang dipilih host saat buat room
let mpShuffle = false;   // host: acak urutan soal saat buat room
let mpServerOffset = 0;   // selisih jam server vs perangkat (ms)
let mpRoom = { meta: null, state: null, questions: [], players: {}, reveal: {}, answers: {} };
let mpLocalQs = [];       // host saja: soal lengkap dengan kunci
let mpMyAnswers = {};     // pemain: index soal -> huruf (disimpan per room)
let mpListeners = [];     // [ref, cb] untuk dilepas saat keluar room
let mpHostTimer = null;   // host: timer auto reveal / auto next
let mpTickHandle = null;  // render ulang tiap 500ms untuk hitung mundur
const MP_NAME_KEY = "soalin-mp-name";
const MP_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function mpDb() { return firebase.database(); }
function mpArr(v) { return Array.isArray(v) ? v : Object.values(v || {}); }
function mpAnswersKey() { return `soalin-mp-answers-${mpRoomCode}`; }
function mpNow() { return Date.now() + mpServerOffset; }
function mpTimerSec() { return mpRoom.meta?.timerSeconds || 0; }

// Sisa waktu soal aktif (ms). null = mode tanpa timer.
function mpRemaining() {
  const st = mpRoom.state;
  const timer = mpTimerSec();
  if (!st || !timer || st.phase !== "playing") return null;
  return Math.max(0, (st.startedAt || mpNow()) + timer * 1000 - mpNow());
}

function mpInit() {
  if (mpAuthPromise) return mpAuthPromise;
  mpAuthPromise = new Promise((resolve, reject) => {
    if (typeof firebase === "undefined" || typeof FIREBASE_CONFIG === "undefined" || FIREBASE_CONFIG.apiKey === "GANTI") {
      reject(new Error("Firebase belum dikonfigurasi (isi js/firebase-config.js)"));
      return;
    }
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    firebase.database().ref(".info/serverTimeOffset").on("value", (s) => { mpServerOffset = s.val() || 0; });
    firebase.auth().onAuthStateChanged((user) => {
      if (user) { mpUid = user.uid; resolve(user.uid); }
    });
    firebase.auth().signInAnonymously().catch(reject);
  });
  return mpAuthPromise;
}

function mpGenCode() {
  let s = "";
  for (let i = 0; i < 4; i++) s += MP_CODE_CHARS[Math.floor(Math.random() * MP_CODE_CHARS.length)];
  return s;
}

// ── Host: buat room dari paket yang sedang aktif ─────────────────────────
async function mpCreateRoom() {
  await mpInit();
  if (!activePackage || activePackage.custom) throw new Error("Pilih paket soal biasa dulu (kuis custom belum didukung multiplayer)");
  const qs = allQuestions.filter((q) => !q.isBroken && !q.isIsian);
  if (!qs.length) throw new Error("Paket ini tidak punya soal pilihan ganda");
  const cfg = DIFFICULTY_CONFIG[mpDiff] || DIFFICULTY_CONFIG.bekicot;

  let code = mpGenCode();
  for (let t = 0; t < 10; t++) {
    const exists = (await mpDb().ref(`rooms/${code}/meta`).get()).exists();
    if (!exists) break;
    code = mpGenCode();
  }

  // Urutan soal: index asli, diacak kalau fitur acak aktif.
  const order = qs.map((_, i) => i);
  if (mpShuffle) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
  }
  const ordered = order.map((i) => qs[i]);

  // Hanya teks, opsi, dan gambar soal yang dikirim. Kunci & penjelasan tidak ikut.
  const publicQs = {};
  ordered.forEach((q, i) => {
    publicQs[i] = {
      question: q.question || "",
      options: q.options || {},
      questionImages: (q.questionImages || []).filter((s) => typeof s === "string"),
    };
  });

  await mpDb().ref().update({
    [`rooms/${code}/meta`]: {
      hostUid: mpUid,
      packageId: activePackage.id,
      title: activePackage.title,
      count: qs.length,
      difficulty: mpDiff,
      timerSeconds: cfg.timerSeconds,
      shuffled: mpShuffle,
      order,
      createdAt: firebase.database.ServerValue.TIMESTAMP,
    },
    [`rooms/${code}/state`]: { phase: "lobby", currentIdx: 0, revealed: false },
    [`rooms/${code}/questions`]: publicQs,
  });

  mpLocalQs = ordered;
  await mpEnterRoom(code, true);
}

// ── Cek kode: host langsung masuk, pemain lanjut isi username ────────────
async function mpVerifyCode(code) {
  await mpInit();
  const snap = await mpDb().ref(`rooms/${code}/meta`).get();
  if (!snap.exists()) throw new Error("Kode room tidak ditemukan");
  const meta = snap.val();

  if (meta.hostUid === mpUid) {
    const qs = allQuestions.filter((q) => !q.isBroken && !q.isIsian);
    if (activePackage?.id !== meta.packageId || qs.length !== meta.count) {
      throw new Error(`Buka paket "${meta.title}" dulu untuk masuk sebagai host`);
    }
    const order = mpArr(meta.order);
    mpLocalQs = order.length ? order.map((i) => qs[i]) : qs;
    await mpEnterRoom(code, true);
    return;
  }

  mpPendingCode = code;
  mpScreen = "name";
}

async function mpJoinWithName(rawName) {
  await mpInit();
  const name = (rawName || "").trim().slice(0, 20);
  if (!name) throw new Error("Isi username dulu");
  try { localStorage.setItem(MP_NAME_KEY, name); } catch { /* noop */ }
  const code = mpPendingCode;
  await mpDb().ref(`rooms/${code}/players/${mpUid}`).set({
    name,
    joinedAt: firebase.database.ServerValue.TIMESTAMP,
  });
  mpPendingCode = "";
  await mpEnterRoom(code, false);
}

async function mpEnterRoom(code, asHost) {
  mpRoomCode = code;
  mpIsHost = asHost;
  try { mpMyAnswers = JSON.parse(localStorage.getItem(mpAnswersKey()) || "{}"); } catch { mpMyAnswers = {}; }
  mpAttachListeners();
  mpTickHandle = setInterval(() => {
    if (mpScreen === "room" && mpRemaining() !== null) render();
  }, 500);
  mpScreen = "room";
  mpBusy = false;
  render();
}

// ── Listener realtime ─────────────────────────────────────────────────────
function mpOn(path, apply) {
  const ref = mpDb().ref(`rooms/${mpRoomCode}/${path}`);
  const cb = (snap) => { apply(snap.val()); if (mpScreen === "room") render(); };
  ref.on("value", cb, (err) => { mpError = `Koneksi room gagal: ${err.message}`; render(); });
  mpListeners.push([ref, cb]);
}

function mpAttachListeners() {
  mpDetachListeners();
  mpOn("meta", (v) => {
    if (v === null && mpScreen === "room") {
      mpLeave();
      mpError = "Room sudah ditutup host";
      render();
    } else {
      mpRoom.meta = v;
      if (mpIsHost) mpHostSchedule();
    }
  });
  mpOn("state", (v) => {
    mpRoom.state = v || { phase: "lobby", currentIdx: 0 };
    if (mpIsHost) mpHostSchedule();
  });
  mpOn("questions", (v) => { mpRoom.questions = mpArr(v); });
  mpOn("players", (v) => { mpRoom.players = v || {}; });
  mpOn("reveal", (v) => { mpRoom.reveal = v || {}; });
  if (mpIsHost) mpOn("answers", (v) => { mpRoom.answers = v || {}; });
}

function mpDetachListeners() {
  mpListeners.forEach(([ref, cb]) => ref.off("value", cb));
  mpListeners = [];
  clearTimeout(mpHostTimer);
  mpHostTimer = null;
  clearInterval(mpTickHandle);
  mpTickHandle = null;
}

function mpLeave() {
  const wasPlayer = mpRoomCode && !mpIsHost && mpUid;
  if (wasPlayer) {
    mpDb().ref(`rooms/${mpRoomCode}/players/${mpUid}`).remove().catch(() => {});
  }
  mpDetachListeners();
  mpRoomCode = "";
  mpIsHost = false;
  mpRoom = { meta: null, state: null, questions: [], players: {}, reveal: {}, answers: {} };
  mpLocalQs = [];
  mpMyAnswers = {};
  mpScreen = null;
  mpError = "";
  mpBusy = false;
  pickerOpen = true;
}

// ── Aksi pemain ───────────────────────────────────────────────────────────
function mpAnswer(letter) {
  const i = mpRoom.state.currentIdx;
  if (mpIsHost || mpRoom.reveal?.[i] || mpMyAnswers[i] !== undefined) return;
  if (mpRemaining() === 0) return; // waktu habis
  mpMyAnswers[i] = letter;
  try { localStorage.setItem(mpAnswersKey(), JSON.stringify(mpMyAnswers)); } catch { /* noop */ }
  mpDb().ref(`rooms/${mpRoomCode}/answers/${i}/${mpUid}`).set(letter).catch((err) => {
    delete mpMyAnswers[i];
    try { localStorage.setItem(mpAnswersKey(), JSON.stringify(mpMyAnswers)); } catch { /* noop */ }
    mpError = `Jawaban gagal dikirim: ${err.message}`;
    render();
  });
  render();
}

function mpMyScore() {
  let s = 0;
  Object.keys(mpRoom.reveal || {}).forEach((i) => {
    const r = mpRoom.reveal[i];
    if (r && mpMyAnswers[i] === r.answer) s++;
  });
  return s;
}

// ── Aksi host ─────────────────────────────────────────────────────────────
function mpHostStart() {
  return mpDb().ref(`rooms/${mpRoomCode}/state`).update({
    phase: "playing", currentIdx: 0, revealed: false, startedAt: mpNow(),
  });
}

// fromIdx: hanya buka jawaban kalau soal yang sedang tampil masih soal ini
async function mpHostReveal(fromIdx) {
  const st = mpRoom.state;
  const i = st.currentIdx;
  if (fromIdx !== undefined && fromIdx !== i) return;
  if (st.revealed) return;
  const q = mpLocalQs[i];
  await mpDb().ref().update({
    [`rooms/${mpRoomCode}/reveal/${i}`]: {
      answer: q.answer || "",
      explanation: q.explanation || "",
      explanationImages: (q.explanationImages || []).filter((s) => typeof s === "string"),
    },
    [`rooms/${mpRoomCode}/state/revealed`]: true,
  });
}

// Transaction supaya tidak loncat dua soal kalau auto-next dan tombol manual bersamaan
function mpHostNext(fromIdx) {
  const count = mpRoom.meta.count;
  return mpDb().ref(`rooms/${mpRoomCode}/state`).transaction((st) => {
    if (!st || st.phase !== "playing") return;
    if (fromIdx !== undefined && st.currentIdx !== fromIdx) return;
    if (st.currentIdx + 1 >= count) return { ...st, phase: "ended", revealed: true };
    return { ...st, currentIdx: st.currentIdx + 1, revealed: false, startedAt: mpNow() };
  });
}

// Mode timer: host otomatis buka jawaban saat waktu habis, lalu lanjut 2 detik kemudian
function mpHostSchedule() {
  clearTimeout(mpHostTimer);
  mpHostTimer = null;
  const st = mpRoom.state;
  const timer = mpTimerSec();
  if (!mpIsHost || !st || !timer || st.phase !== "playing") return;
  const i = st.currentIdx;
  if (!st.revealed) {
    const wait = (st.startedAt || mpNow()) + timer * 1000 - mpNow();
    mpHostTimer = setTimeout(() => mpHostReveal(i).catch(console.error), Math.max(0, wait));
  } else {
    mpHostTimer = setTimeout(() => mpHostNext(i).catch(console.error), 2000);
  }
}

function mpHostClose() {
  return mpDb().ref(`rooms/${mpRoomCode}`).remove();
}

function mpLeaderboard() {
  const scores = {};
  Object.keys(mpRoom.players || {}).forEach((uid) => { scores[uid] = 0; });
  Object.keys(mpRoom.answers || {}).forEach((i) => {
    const key = mpLocalQs[i]?.answer;
    if (!mpRoom.reveal?.[i]) return;
    Object.entries(mpRoom.answers[i] || {}).forEach(([uid, letter]) => {
      scores[uid] = (scores[uid] || 0) + (letter === key ? 1 : 0);
    });
  });
  return Object.entries(scores)
    .map(([uid, score]) => ({ name: mpRoom.players?.[uid]?.name || "(tanpa nama)", score }))
    .sort((a, b) => b.score - a.score);
}

// ── Dispatcher aksi UI ────────────────────────────────────────────────────
async function mpAct(act, el) {
  mpError = "";
  try {
    switch (act) {
      case "back":
        mpScreen = null;
        pickerOpen = true;
        break;
      case "toggleshuffle":
        mpShuffle = !mpShuffle;
        break;
      case "pickdiff":
        mpDiff = el.dataset.diff;
        break;
      case "create":
        mpBusy = true; render();
        await mpCreateRoom();
        break;
      case "verify": {
        const code = (document.getElementById("mpCodeInput")?.value || "").trim().toUpperCase();
        if (!/^[A-Z0-9]{4}$/.test(code)) throw new Error("Kode room harus 4 karakter");
        mpBusy = true; render();
        await mpVerifyCode(code);
        break;
      }
      case "enter": {
        // Baca input DULU, sebelum render() membangun ulang layar.
        const name = document.getElementById("mpNameInput")?.value || "";
        mpBusy = true; render();
        await mpJoinWithName(name);
        break;
      }
      case "start": await mpHostStart(); break;
      case "reveal": await mpHostReveal(); break;
      case "next": await mpHostNext(mpRoom.state.currentIdx); break;
      case "close":
        if (confirm("Tutup room? Semua pemain akan keluar.")) await mpHostClose();
        break;
      case "leave": mpLeave(); render(); return;
      case "answer": mpAnswer(el.dataset.letter); return;
    }
  } catch (e) {
    mpError = e?.message || String(e);
  }
  mpBusy = false;
  render();
}
