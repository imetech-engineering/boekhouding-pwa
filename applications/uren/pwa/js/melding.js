/* Meldingen onderin (toast): wegvegen naar links, rechts of omlaag. Gedeeld door alle IMeTech-PWA's.
   Werkt op #toast; de app zelf blijft bepalen wanneer hij verschijnt en weer verdwijnt. */
(function () {
  function bind(el) {
    if (!el || el._veeg) return;
    el._veeg = true;
    let x0 = null, y0 = null, dx = 0, dy = 0, gesleept = false;
    const reset = () => { el.style.transform = ""; el.style.opacity = ""; el.style.transition = ""; };
    el.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button, a")) return;
      x0 = e.clientX; y0 = e.clientY; dx = dy = 0; gesleept = false;
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      el.style.transition = "none";
    });
    el.addEventListener("pointermove", (e) => {
      if (x0 === null) return;
      dx = e.clientX - x0; dy = Math.max(0, e.clientY - y0);
      if (Math.abs(dx) > 6 || dy > 6) gesleept = true;
      const zij = Math.abs(dx) >= dy;
      el.style.transform = zij ? `translateX(${dx}px)` : `translateY(${dy}px)`;
      el.style.opacity = String(Math.max(0.15, 1 - (zij ? Math.abs(dx) : dy * 1.6) / 240));
    });
    const einde = () => {
      if (x0 === null) return;
      x0 = null;
      el.style.transition = "transform .18s ease-out, opacity .18s ease-out";
      const zij = Math.abs(dx) >= dy;
      if ((zij && Math.abs(dx) > 70) || (!zij && dy > 36)) {
        el.style.transform = zij ? `translateX(${dx > 0 ? 130 : -130}%)` : "translateY(160%)";
        el.style.opacity = "0";
        setTimeout(() => { el.classList.add("hidden"); reset(); }, 190);
        try { navigator.vibrate?.(8); } catch (_) {}
      } else {
        el.style.transform = ""; el.style.opacity = "";
      }
      if (gesleept) {   // na slepen geen 'tik' uitvoeren (bijv. 'tik om te vernieuwen')
        const blok = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
        el.addEventListener("click", blok, { capture: true, once: true });
        setTimeout(() => el.removeEventListener("click", blok, { capture: true }), 60);
      }
    };
    el.addEventListener("pointerup", einde);
    el.addEventListener("pointercancel", einde);
    new MutationObserver(() => { if (!el.classList.contains("hidden")) reset(); }).observe(el, { attributes: true, attributeFilter: ["class"] });
  }
  window.MeldingVeeg = { bind };
  const start = () => bind(document.getElementById("toast"));
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
