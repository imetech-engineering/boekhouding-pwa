/**
 * Het originele factuurbestand terugzoeken bij een al geboekte regel.
 * Kijkt in zowel "nog te verwerken" als "verwerkt" en matcht op
 * factuurnummer, datum en partij. Vindt de app niets overtuigends, dan kun
 * je het bestand zelf uit dezelfde mappen kiezen (kies()).
 */
(function (global) {
  const App = () => global.BoekApp;
  const M = () => global.BoekModel;

  /** Mapinhoud eenmalig ophalen en bewaren; scheelt een call per bewerking. */
  async function folderItems(kind, token) {
    const st = App().state;
    if (!st.docCache) st.docCache = {};
    if (st.docCache[kind]) return st.docCache[kind];
    const f = global.BOEK_CONFIG.graph.folders;
    const paths =
      kind === "inkoop"
        ? [f.inkoopVerwerkt, f.inkoopNieuw]
        : [f.verkoopVerwerkt, f.verkoopNieuw];
    const items = [];
    for (const p of paths) {
      try {
        const list = await global.BoekGraph.listFolder(p, token);
        for (const it of list) items.push({ ...it, _folder: p });
      } catch (_) {
        /* map kan ontbreken */
      }
    }
    st.docCache[kind] = items;
    return items;
  }

  function score(kind, item, row) {
    let s = 0;
    const fnr = (row.factuurnummer || "").trim().toLowerCase();
    if (kind === "inkoop") {
      const p = M().parseInkoopFilename(item.name);
      if (fnr && p.factuurnummer && p.factuurnummer.toLowerCase() === fnr) s += 5;
      if (row.datum && p.datumIso && M().dateToIso(row.datum) === p.datumIso) s += 3;
      if (p.bedrijf && M().partyNamesMatch(p.bedrijf, row.partij)) s += 2;
    } else {
      const p = M().parseVerkoopFilename(item.name);
      if (fnr && p.factuurnummer && p.factuurnummer.toLowerCase() === fnr) s += 5;
      if (p.bedrijf && M().partyNamesMatch(p.bedrijf, row.partij)) s += 2;
    }
    return s;
  }

  /**
   * Beste match, of null. Drempel 5: alleen het factuurnummer, of datum én
   * partij samen, is overtuigend genoeg — zo krijg je nooit een vreemde factuur
   * te zien bij een regel.
   */
  async function findFor(kind, row) {
    try {
      const token = await App().ensureLoggedIn();
      const items = await folderItems(kind, token);
      let best = null;
      let bestScore = 0;
      for (const it of items) {
        const s = score(kind, it, row);
        if (s > bestScore) {
          bestScore = s;
          best = it;
        }
      }
      return bestScore >= 5 ? best : null;
    } catch (_) {
      return null;
    }
  }

  // === Zelf een bestand kiezen ===
  const $ = (sel) => document.querySelector(sel);
  let kiesLijst = [];
  let kiesKlaar = null;

  function escapeHtml(t) {
    const d = document.createElement("div");
    d.textContent = t == null ? "" : String(t);
    return d.innerHTML;
  }

  function renderKiesLijst() {
    const q = $("#doc-pick-search").value.trim().toLowerCase();
    const list = $("#doc-pick-list");
    list.innerHTML = "";
    let getoond = 0;
    for (const item of kiesLijst) {
      if (q && !item.name.toLowerCase().includes(q)) continue;
      const li = document.createElement("li");
      li.className = "file-item";
      const icon = item.folder ? "📁" : /\.pdf$/i.test(item.name) ? "📄" : "🖼️";
      li.innerHTML = `<span class="fi-icon">${icon}</span><span class="fi-name">${escapeHtml(item.name)}</span>`;
      li.addEventListener("click", () => sluitKies(item));
      list.appendChild(li);
      if (++getoond >= 60) break;
    }
    $("#doc-pick-empty").classList.toggle("hidden", getoond > 0);
  }

  function sluitKies(item) {
    $("#doc-pick-modal").classList.add("hidden");
    const klaar = kiesKlaar;
    kiesKlaar = null;
    kiesLijst = [];
    klaar?.(item || null);
  }

  /**
   * Toont alle facturen uit beide mappen, de meest waarschijnlijke bovenaan,
   * en geeft het gekozen bestand terug (of null bij annuleren).
   */
  async function kies(kind, row) {
    const modal = $("#doc-pick-modal");
    if (!modal) return null;
    $("#doc-pick-search").value = "";
    $("#doc-pick-list").innerHTML = "";
    $("#doc-pick-empty").classList.add("hidden");
    $("#doc-pick-busy").classList.remove("hidden");
    modal.classList.remove("hidden");
    try {
      const token = await App().ensureLoggedIn();
      // Verse lijst: je zoekt hier juist omdat de automaat het niet vond.
      if (App().state.docCache) delete App().state.docCache[kind];
      const items = await folderItems(kind, token);
      kiesLijst = [...items].sort((a, b) => score(kind, b, row || {}) - score(kind, a, row || {}));
    } catch (e) {
      App().showToast(`Bestanden ophalen mislukt: ${e.message || e}`, true);
      kiesLijst = [];
    }
    $("#doc-pick-busy").classList.add("hidden");
    renderKiesLijst();
    return new Promise((resolve) => {
      kiesKlaar = resolve;
    });
  }

  function init() {
    if (!$("#doc-pick-modal")) return;
    $("#doc-pick-search").addEventListener("input", renderKiesLijst);
    $("#btn-doc-pick-cancel").addEventListener("click", () => sluitKies(null));
    $("#doc-pick-modal .modal-backdrop").addEventListener("click", () => sluitKies(null));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  global.BoekDocFinder = { findFor, kies };
})(window);
