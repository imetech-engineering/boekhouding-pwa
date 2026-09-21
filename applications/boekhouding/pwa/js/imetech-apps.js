/* Koppeling tussen de IMeTech-apps (assistent, uren, boekhouding, projectdoc). Gedeeld bestand, in alle vier gelijk.
   - IMeTechApps.url(app, params): link naar een andere app, bijv. url("projectdoc", { project: "5008", tekst: "..." }).
   - App-wisselaar: tik op het logo rechtsboven voor een menu met de vier apps.
   - Deeplinks: ?tab=<tab> opent dat tabblad; ?zet=<veld-id>:<waarde> vult een veld in (bijv. een zoekveld of datum).
     App-specifieke parameters (zoals project) leest de app zelf via IMeTechApps.params(). */
(function () {
  const BASIS = "https://imetech-engineering.github.io/";
  const APPS = [
    { id: "assistent", naam: "Assistent", pad: "assistant-pwa/", ic: '<path d="M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6z"/><path d="M10 20a2 2 0 0 0 4 0"/>' },
    { id: "uren", naam: "Uren", pad: "uren-pwa/", ic: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' },
    { id: "boekhouding", naam: "Boekhouding", pad: "boekhouding-pwa/", ic: '<path d="M3 21h18M4 10h16M6 10v8M10 10v8M14 10v8M18 10v8M12 3l9 5H3z"/>' },
    { id: "projectdoc", naam: "Projectdoc", pad: "projectdoc-pwa/", ic: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M9 14h6M9 17h4"/>' },
  ];
  const lokaal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const huidig = () => (APPS.find((a) => location.pathname.includes("/" + a.pad)) || {}).id;

  function url(app, params = {}) {
    const a = APPS.find((x) => x.id === app);
    if (!a) return "#";
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.append(k, String(v));
    return BASIS + a.pad + (q.toString() ? "?" + q : "");
  }

  function params() { return new URLSearchParams(location.search); }

  /* Na het afhandelen de parameters uit de adresbalk halen, zodat verversen ze niet opnieuw toepast. */
  function wisParams() {
    try { history.replaceState(null, "", location.pathname + location.hash); } catch (_) {}
  }

  function pasDeeplinkToe() {
    const p = params();
    if (!p.toString()) return;
    const tab = p.get("tab");
    if (tab) document.querySelector(`[data-tab="${CSS.escape(tab)}"]`)?.click();
    for (const z of p.getAll("zet")) {
      const i = z.indexOf(":");
      if (i < 1) continue;
      const el = document.getElementById(z.slice(0, i));
      if (!el) continue;
      el.value = z.slice(i + 1);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (!window.IMeTechApps.houdParams) wisParams();
  }

  /* ---------- app-wisselaar ---------- */
  function sluit() { document.getElementById("app-wissel")?.remove(); }
  function open(logo) {
    if (document.getElementById("app-wissel")) return sluit();
    const nu = huidig();
    const m = document.createElement("div");
    m.id = "app-wissel";
    m.setAttribute("role", "menu");
    m.innerHTML = APPS.map((a) => `<a role="menuitem" href="${url(a.id)}" class="${a.id === nu ? "nu" : ""}">
        <svg viewBox="0 0 24 24" aria-hidden="true">${a.ic}</svg><span>${a.naam}</span>${a.id === nu ? "<small>hier</small>" : ""}</a>`).join("");
    document.body.appendChild(m);
    const r = logo.getBoundingClientRect();
    m.style.top = Math.round(r.bottom + 8) + "px";
    m.querySelectorAll("a.nu").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); sluit(); }));
    setTimeout(() => document.addEventListener("click", function weg(e) { if (!m.contains(e.target)) { sluit(); document.removeEventListener("click", weg, true); } }, true));
  }
  function bindWisselaar() {
    const logo = document.getElementById("header-logo");
    if (!logo || logo._wissel) return;
    logo._wissel = true;
    logo.style.cursor = "pointer";
    logo.setAttribute("role", "button");
    logo.setAttribute("tabindex", "0");
    logo.setAttribute("aria-label", "Wissel van app");
    logo.addEventListener("click", (e) => { e.stopPropagation(); open(logo); });
    logo.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(logo); } });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") sluit(); });
  }

  window.IMeTechApps = { url, params, wisParams, apps: APPS, houdParams: false, lokaal };
  const start = () => { bindWisselaar(); setTimeout(pasDeeplinkToe, 500); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
