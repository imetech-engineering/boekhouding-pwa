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

/* Schermhoogte vastzetten. Na "Nieuwe versie, vernieuwen" (een herlaad binnen de
   geïnstalleerde app) rekent Android 100dvh soms te hoog uit, waardoor de balk
   onderin buiten beeld valt tot je de app herstart. We meten de echte hoogte en
   geven die aan de pagina als --app-h; het scrollen van het document zelf zetten
   we terug naar boven. */
(function () {
  try { history.scrollRestoration = "manual"; } catch (_) {}
  const root = document.documentElement;
  function meet() {
    const vv = window.visualViewport;
    const h = Math.round(Math.min(window.innerHeight || 0, vv ? vv.height + vv.offsetTop : Infinity) || window.innerHeight);
    if (h > 200) root.style.setProperty("--app-h", h + "px");
    if (window.scrollY || root.scrollTop) window.scrollTo(0, 0);
  }
  meet();
  ["resize", "orientationchange", "pageshow", "load"].forEach((ev) => window.addEventListener(ev, meet));
  if (window.visualViewport) window.visualViewport.addEventListener("resize", meet);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) meet(); });
  [100, 400, 1200, 3000].forEach((t) => setTimeout(meet, t));
  // Vernieuwen als navigatie in plaats van reload: dan neemt de browser geen
  // oude scroll- en zoomstand mee.
  window.IMeTechHerlaad = () => {
    try { location.replace(location.href.split("#")[0]); } catch (_) { location.reload(); }
  };
})();
