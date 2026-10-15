// ── Gambar soal/penjelasan ──────────────────────────────────────────────
// Setiap item di questionImages / explanationImages bisa berupa:
//   "images/xray.jpg"                 → satu gambar
//   { stack: "brain-lobes/sagittal" } → folder stack (daftar dibuat scripts/build-stacks.cjs)
//   ["a.jpg", "b.jpg", ...]           → stack dari daftar eksplisit
// Stack: geser slider di kanan gambar untuk ganti gambar (halaman tidak ikut ter-scroll).

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
      <div class="stackBody">
        <img class="${cls}" src="${escapeAttr(srcs[0])}" alt="${alt}">
        <input type="range" class="stackSlider" min="0" max="${srcs.length - 1}" value="0" step="1" aria-label="Ganti gambar">
      </div>
      <div class="stackBar">
        <span class="stackHint">↕ geser slider kanan untuk ganti gambar</span>
        <span class="stackCount">1 / ${srcs.length}</span>
      </div>
    </div>`;
  }).join("");
}

function _stackSrcs(el) {
  return JSON.parse(decodeURIComponent(el.dataset.srcs));
}

// Slider kanan -> ganti slice. touch-action:none di CSS supaya halaman tidak ikut scroll.
document.addEventListener("input", (e) => {
  const sl = e.target;
  if (!sl.classList || !sl.classList.contains("stackSlider")) return;
  const el = sl.closest(".imgStack");
  const srcs = _stackSrcs(el);
  const n = +sl.value;
  el.dataset.i = String(n);
  el.querySelector("img").src = srcs[n];
  el.querySelector(".stackCount").textContent = `${n + 1} / ${srcs.length}`;
  _preload(srcs, n + 1, 2);   // siapkan slice berikutnya supaya tidak kedip
  _preload(srcs, n - 2, 2);
});
