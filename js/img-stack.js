// ── Gambar soal/penjelasan ──────────────────────────────────────────────
// Setiap item di questionImages / explanationImages bisa berupa:
//   "images/xray.jpg"                 → satu gambar
//   { stack: "brain-lobes/sagittal" } → folder stack (daftar dibuat scripts/build-stacks.cjs)
//   ["a.jpg", "b.jpg", ...]           → stack dari daftar eksplisit
// Stack: scroll / geser untuk ganti gambar. Tiap item tampil berurutan (atas ke bawah).

function _stackList(item) {
  if (Array.isArray(item)) return item;
  if (item && typeof item === "object" && item.stack) {
    return (window.STACKS && window.STACKS[item.stack]) || [];
  }
  return [];
}

function _preload(srcs, from, count) {
  for (let k = Math.max(0, from); k < Math.min(srcs.length, from + count); k++) {
    const pre = new Image();
    pre.src = srcs[k];
  }
}

function renderImgs(items, cls, alt) {
  return (items || []).map((item) => {
    if (typeof item === "string") {
      return `<img class="${cls}" src="${escapeAttr(item)}" alt="${alt}">`;
    }
    const srcs = _stackList(item);
    if (!srcs.length) {
      return item && item.stack
        ? `<p class="noImg">(stack "${escapeHtml(item.stack)}" tidak ditemukan — jalankan scripts/build-stacks.cjs)</p>`
        : "";
    }
    if (srcs.length === 1) {
      return `<img class="${cls}" src="${escapeAttr(srcs[0])}" alt="${alt}">`;
    }
    _preload(srcs, 0, 3);
    return `<div class="imgStack" data-srcs="${encodeURIComponent(JSON.stringify(srcs))}" data-i="0">
      <img class="${cls}" src="${escapeAttr(srcs[0])}" alt="${alt}">
      <div class="stackBar">
        <span class="stackHint">🖱️ scroll / geser untuk ganti gambar</span>
        <span class="stackCount">1 / ${srcs.length}</span>
      </div>
    </div>`;
  }).join("");
}

function _stackSrcs(el) {
  return JSON.parse(decodeURIComponent(el.dataset.srcs));
}

// Pindah slice sebesar dir (+1/-1). Return false kalau sudah di ujung (scroll halaman lanjut).
function _stackStep(el, dir) {
  const srcs = _stackSrcs(el);
  const next = (+el.dataset.i || 0) + dir;
  if (next < 0 || next >= srcs.length) return false;
  el.dataset.i = String(next);
  el.querySelector("img").src = srcs[next];
  el.querySelector(".stackCount").textContent = `${next + 1} / ${srcs.length}`;
  _preload(srcs, next + 1, 2);   // siapkan slice berikutnya supaya tidak kedip
  _preload(srcs, next - 2, 2);
  return true;
}

// Mouse wheel / trackpad
let _lastWheel = 0;
document.addEventListener("wheel", (e) => {
  const el = e.target.closest && e.target.closest(".imgStack");
  if (!el || !e.deltaY) return;
  const dir = e.deltaY > 0 ? 1 : -1;
  const srcs = _stackSrcs(el);
  const next = (+el.dataset.i || 0) + dir;
  if (next < 0 || next >= srcs.length) return; // di ujung: biarkan halaman ikut scroll
  e.preventDefault();
  const now = Date.now();
  if (now - _lastWheel < 120) return;          // trackpad kirim banyak event; batasi
  _lastWheel = now;
  _stackStep(el, dir);
}, { passive: false });

// Geser jari (HP / tablet)
let _touchEl = null, _touchY = 0;
document.addEventListener("touchstart", (e) => {
  _touchEl = e.target.closest && e.target.closest(".imgStack");
  _touchY = e.touches[0].clientY;
}, { passive: true });
document.addEventListener("touchmove", (e) => {
  if (!_touchEl) return;
  const y = e.touches[0].clientY;
  const dy = _touchY - y;
  if (Math.abs(dy) < 25) return;               // satu slice tiap ~25px geser
  const dir = dy > 0 ? 1 : -1;
  if (_stackStep(_touchEl, dir)) {
    e.preventDefault();
    _touchY = y;
  }
}, { passive: false });
