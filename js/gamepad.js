// Gamepad (Gamepad API bawaan browser, tanpa library). Colok controller, tekan satu tombol, jalan.
//   Stik kiri/kanan = scroll | LT/RT = scroll satu layar | D-pad atas/bawah = pindah fokus
//   A = klik | B = tutup pemilih paket | LB/RB = ganti Latihan/Tentamen | Start = lanjut/mulai
//   Select = ganti paket | Y = acak | X = reset | tombol header lain cuma lewat mouse/sentuh
(function () {
  const DEAD = 0.25, SPEED = 18, REPEAT = 220;
  const SEL = "#app button:not(:disabled):not(.locked), #app textarea:not(:disabled)";
  const last = {}, t0 = {};
  let idx = 0, running = false, used = false;

  const items = () => [...document.querySelectorAll(SEL)].filter((e) => e.offsetParent && !e.closest(".headerZone"));
  const clear = () => document.querySelectorAll(".padFocus").forEach((e) => e.classList.remove("padFocus"));
  const click = (sel) => document.querySelector(sel)?.click();

  function focusAt(i, scroll = true) {
    const l = items();
    if (!l.length) return;
    idx = Math.max(0, Math.min(i, l.length - 1));
    clear();
    used = true;
    l[idx].classList.add("padFocus");
    l[idx].focus({ preventScroll: true });
    if (scroll) l[idx].scrollIntoView({ block: "center", behavior: "smooth" });
  }

  // true sekali per tekan; kalau repeat, terus true selama ditahan
  function hit(pad, i, now, repeat) {
    const down = !!pad.buttons[i]?.pressed;
    const fire = down && (!last[i] || (repeat && now - t0[i] > REPEAT));
    if (fire) t0[i] = now;
    last[i] = down;
    return fire;
  }

  function loop(now) {
    const pad = [...navigator.getGamepads()].find(Boolean);
    if (!pad) { running = false; return; }

    // render() ganti seluruh #app → fokus hilang; pasang lagi di indeks yang sama
    if (used && !document.querySelector(".padFocus")) focusAt(idx, false);

    const y = [pad.axes[1], pad.axes[3]].find((v) => Math.abs(v) > DEAD) || 0;
    if (y) scrollBy(0, y * SPEED);
    if (hit(pad, 6, now, true)) scrollBy({ top: -innerHeight * 0.8, behavior: "smooth" });
    if (hit(pad, 7, now, true)) scrollBy({ top: innerHeight * 0.8, behavior: "smooth" });

    const up = hit(pad, 12, now, true), down = hit(pad, 13, now, true), a = hit(pad, 0, now, false);
    if (up || down || a) {
      if (!document.querySelector(".padFocus")) {
        // pertama kali: fokus ke item pertama yang kelihatan di layar
        focusAt(Math.max(0, items().findIndex((e) => e.getBoundingClientRect().top > 60)));
      } else if (up) focusAt(idx - 1);
      else if (down) focusAt(idx + 1);
      else document.querySelector(".padFocus").click();
    }
    if (hit(pad, 1, now, false)) click("#pickerCloseBtn");
    if (hit(pad, 4, now, false) || hit(pad, 5, now, false)) click(".pillBtn[data-mode]:not(.active)");
    if (hit(pad, 8, now, false)) click("#pkgSwitchBtn");
    if (hit(pad, 3, now, false)) click("#shuffleBtn");
    if (hit(pad, 2, now, false)) click("#resetBtn");
    if (hit(pad, 9, now, false)) click("#nextTentamenBtn, #startTentamenBtn, #loadMoreBtn, #restartTentamenBtn");

    requestAnimationFrame(loop);
  }

  addEventListener("gamepadconnected", () => {
    if (!running) { running = true; requestAnimationFrame(loop); }
  });
  addEventListener("pointerdown", () => { used = false; clear(); });
})();
