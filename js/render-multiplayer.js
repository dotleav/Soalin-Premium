// ── Render: layar Multiplayer (join kode → username → room) ───────────────
function mpErrorHtml() {
  return mpError ? `<div class="mpError">${escapeHtml(mpError)}</div>` : "";
}

function mpModeLabel(meta) {
  const c = DIFFICULTY_CONFIG[meta.difficulty] || DIFFICULTY_CONFIG.bekicot;
  const base = meta.timerSeconds
    ? `${c.label} · ${meta.timerSeconds} dtk/soal (otomatis)`
    : `${c.label} · buka jawaban manual`;
  return meta.shuffled ? `${base} · soal diacak` : base;
}

function renderMultiplayerScreen() {
  if (mpScreen === "join") return renderMpJoin();
  if (mpScreen === "name") return renderMpName();
  return renderMpRoom();
}

function renderMpJoin() {
  const chips = Object.keys(DIFFICULTY_CONFIG).map((k) => {
    const c = DIFFICULTY_CONFIG[k];
    const on = mpDiff === k;
    return `<button class="mpChip${on ? " on" : ""}" data-mp-act="pickdiff" data-diff="${k}" style="${on ? `border-color:${c.color}` : ""}">${escapeHtml(c.label)} · ${c.timerSeconds ? c.timerSeconds + " dtk" : "manual"}</button>`;
  }).join("");
  return `
    <main class="wrap">
      <div class="mpCard">
        <button class="mpLinkBtn" data-mp-act="back">\u2190 Kembali</button>
        <h1 class="mpTitle">\uD83C\uDFAE Multiplayer</h1>
        <p class="mpSub">Masukkan kode room dari host.</p>
        <input id="mpCodeInput" class="mpInput mono" maxlength="4" placeholder="KODE" autocomplete="off" autocapitalize="characters" value="${escapeAttr(mpPendingCode)}">
        ${mpErrorHtml()}
        <button class="mpPrimary" data-mp-act="verify" ${mpBusy ? "disabled" : ""}>${mpBusy ? "Mengecek\u2026" : "Lanjut"}</button>
        <div class="mpDivider"></div>
        <p class="mpSub">Kamu host? Pilih tingkat kesulitan:</p>
        <div class="mpPlayers">${chips}</div>
        <div class="mpPlayers">
          <button class="mpChip${mpShuffle ? " on" : ""}" data-mp-act="toggleshuffle">\uD83D\uDD00 Acak urutan soal: ${mpShuffle ? "ya" : "tidak"}</button>
        </div>
        <button class="mpSecondary" data-mp-act="create" ${mpBusy ? "disabled" : ""}>Buat room baru</button>
      </div>
    </main>`;
}

function renderMpName() {
  let saved = "";
  try { saved = localStorage.getItem(MP_NAME_KEY) || ""; } catch { /* noop */ }
  return `
    <main class="wrap">
      <div class="mpCard">
        <button class="mpLinkBtn" data-mp-act="back">\u2190 Kembali</button>
        <h1 class="mpTitle">Masuk room <span class="mono">${escapeHtml(mpPendingCode)}</span></h1>
        <p class="mpSub">Pilih username yang akan dilihat host dan pemain lain.</p>
        <input id="mpNameInput" class="mpInput" maxlength="20" placeholder="Username kamu" autocomplete="off" value="${escapeAttr(saved)}">
        ${mpErrorHtml()}
        <button class="mpPrimary" data-mp-act="enter" ${mpBusy ? "disabled" : ""}>${mpBusy ? "Masuk\u2026" : "Masuk"}</button>
      </div>
    </main>`;
}

function renderMpRoom() {
  if (!mpRoom.meta) {
    return `
      <main class="wrap">
        <div class="mpCard">
          <p class="mpSub">Memuat room\u2026</p>
          ${mpErrorHtml()}
          <button class="mpLinkBtn" data-mp-act="leave">Keluar</button>
        </div>
      </main>`;
  }

  const phase = mpRoom.state?.phase || "lobby";
  const myName = mpIsHost ? "\uD83D\uDC51 Host" : escapeHtml(mpRoom.players?.[mpUid]?.name || "");
  const header = `
    <div class="mpTop">
      <div>
        <div class="mpSub">Kode room</div>
        <div class="mpCode mono">${mpRoomCode}</div>
      </div>
      <div class="mpSub">${myName}</div>
    </div>`;

  let body = "";
  if (phase === "lobby") body = renderMpLobby();
  else if (phase === "ended") body = renderMpEnded();
  else body = renderMpPlaying();

  const footer = mpIsHost
    ? `<button class="mpDanger" data-mp-act="close">Tutup room</button>`
    : `<button class="mpLinkBtn" data-mp-act="leave">Keluar room</button>`;

  return `
    <main class="wrap">
      <div class="mpCard">
        ${header}
        ${mpErrorHtml()}
        ${body}
        <div class="mpFooter">${footer}</div>
      </div>
    </main>`;
}

function renderMpLobby() {
  const names = Object.values(mpRoom.players || {}).map((p) => p.name);
  const chips = names.map((n) => `<span class="mpChip">${escapeHtml(n)}</span>`).join("");
  return `
    <p class="mpSub">${escapeHtml(mpRoom.meta.title)} \u00B7 ${mpRoom.meta.count} soal</p>
    <p class="mpSub">${escapeHtml(mpModeLabel(mpRoom.meta))}</p>
    <div class="sectionLabel">Pemain (${names.length})</div>
    <div class="mpPlayers">${chips || `<span class="mpSub">Belum ada pemain</span>`}</div>
    ${mpIsHost
      ? `<button class="mpPrimary" data-mp-act="start">\u25B6 Mulai kuis</button>`
      : `<p class="mpSub">Menunggu host memulai\u2026</p>`}`;
}

function renderMpPlaying() {
  const st = mpRoom.state;
  const i = st.currentIdx;
  const q = mpRoom.questions[i];
  if (!q) return `<p class="mpSub">Memuat soal\u2026</p>`;

  const total = mpRoom.meta.count;
  const rev = mpRoom.reveal?.[i];
  const my = mpMyAnswers[i];
  const picks = (mpRoom.answers && mpRoom.answers[i]) || {};
  const pickCount = {};
  Object.values(picks).forEach((l) => { pickCount[l] = (pickCount[l] || 0) + 1; });
  const playerCount = Object.keys(mpRoom.players || {}).length;
  const answeredCount = Object.keys(picks).length;
  const letters = Object.keys(q.options || {}).sort();

  const rem = mpRemaining();
  const timed = rem !== null;
  const timedOut = timed && rem === 0;
  const timerHtml = timed ? `
    <div class="mpTimer mono">${Math.ceil(rem / 1000)} dtk</div>
    <div class="mpTimerTrack"><div class="mpTimerFill" style="width:${(rem / (mpTimerSec() * 1000)) * 100}%"></div></div>` : "";

  const options = letters.map((l) => {
    const cls = ["option", "mpOpt"];
    if (rev) {
      if (l === rev.answer) cls.push("correct");
      else if (l === my) cls.push("wrong");
    }
    if (!mpIsHost && my === l) cls.push("selected");
    const disabled = mpIsHost || rev || my !== undefined || timedOut;
    const pct = playerCount ? Math.round(((pickCount[l] || 0) / playerCount) * 100) : 0;
    return `
      <button class="${cls.join(" ")}" data-mp-act="answer" data-letter="${l}" ${disabled ? "disabled" : ""}>
        ${mpIsHost ? `<span class="mpBar" style="width:${pct}%"></span>` : ""}
        <span class="letter">${l}</span>
        <span class="optText">${escapeHtml(q.options[l])}</span>
        ${mpIsHost ? `<span class="mpCount mono">${pickCount[l] || 0}</span>` : ""}
      </button>`;
  }).join("");

  const qImgs = renderImgs(q.questionImages || [], "qImg", "gambar soal");
  const eImgs = renderImgs(rev?.explanationImages || [], "exImg", "gambar penjelasan");

  let feedback = "";
  if (!mpIsHost) {
    if (rev) {
      if (my === undefined) feedback = `<div class="mpFeedback">Kamu belum menjawab.</div>`;
      else if (my === rev.answer) feedback = `<div class="mpFeedback ok">\u2705 Benar!</div>`;
      else feedback = `<div class="mpFeedback bad">\u274C Salah. Jawaban yang benar: <b>${escapeHtml(rev.answer)}</b></div>`;
    } else if (my !== undefined) {
      feedback = `<div class="mpFeedback">Jawabanmu terkirim. Menunggu jawaban dibuka\u2026</div>`;
    } else if (timedOut) {
      feedback = `<div class="mpFeedback">Waktu habis. Menunggu jawaban dibuka\u2026</div>`;
    }
  }
  const explain = rev?.explanation ? `<div class="mpExplain">${escapeHtml(rev.explanation)}</div>` : "";

  let hostControls = "";
  if (mpIsHost) {
    const names = Object.entries(picks)
      .map(([uid, l]) => `${escapeHtml(mpRoom.players?.[uid]?.name || "?")} \u2192 ${l}`)
      .join(" \u00B7 ");
    hostControls = `
      <div class="mpHostInfo mono">${answeredCount}/${playerCount} sudah menjawab</div>
      ${names ? `<div class="mpSub mpPicks">${names}</div>` : ""}
      ${timed ? `<div class="mpSub">Otomatis: jawaban dibuka saat waktu habis.</div>` : ""}
      ${rev
        ? `<button class="mpPrimary" data-mp-act="next">${i + 1 < total ? "Soal berikutnya \u2192" : "Selesai \u00B7 lihat skor"}</button>`
        : `<button class="mpPrimary" data-mp-act="reveal">\uD83D\uDC41 Tampilkan jawaban</button>`}`;
  }

  return `
    <div class="mpProgress mono">Soal ${i + 1} / ${total}</div>
    ${timerHtml}
    <div class="mpQuestion">${escapeHtml(q.question)}</div>
    ${qImgs}
    <div class="options">${options}</div>
    ${feedback}
    ${eImgs}
    ${explain}
    ${hostControls}`;
}

function renderMpEnded() {
  if (mpIsHost) {
    const board = mpLeaderboard();
    const rows = board.map((b, k) => `
      <div class="mpRow"><span>${k + 1}. ${escapeHtml(b.name)}</span><span class="mono">${b.score}/${mpRoom.meta.count}</span></div>`).join("");
    return `<div class="sectionLabel">Papan skor</div>${rows || `<p class="mpSub">Belum ada pemain.</p>`}`;
  }
  return `
    <div class="sectionLabel">Selesai!</div>
    <p class="mpBig mono">${mpMyScore()}/${mpRoom.meta.count}</p>
    <p class="mpSub">Tunggu host menutup room.</p>`;
}

function attachMultiplayerHandlers() {
  app.querySelectorAll("[data-mp-act]").forEach((el) => {
    el.addEventListener("click", () => mpAct(el.dataset.mpAct, el));
  });
  const codeInput = document.getElementById("mpCodeInput");
  if (codeInput) codeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") mpAct("verify"); });
  const nameInput = document.getElementById("mpNameInput");
  if (nameInput) nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") mpAct("enter"); });
}
