/**
 * Reiskosten-tab: vaste bestemmingen, adres zoeken (Photon), auto-km (OSRM), inboeken.
 */
(function (global) {
  const App = () => global.BoekApp;
  const M = () => global.BoekModel;
  const $ = (s) => document.querySelector(s);

  let gekozenAdres = null; // {label, plaats, lat, lon}
  let kmAuto = false;
  let editRow = null; // Excel-rij die bewerkt wordt (null = nieuwe rit)

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function settings() {
    return App().state.settings;
  }

  function alleFavorieten() {
    const opgeslagen = (settings().favorieten || []).map((f) => ({ ...f, bron: "vast" }));
    const historie = M()
      .reisFavorietenUitHistorie(App().state.intel.inkoop.history)
      .filter((h) => !opgeslagen.some((f) => M().partyNamesMatch(f.naam, h.naam)))
      .map((f) => ({ ...f, bron: "historie" }));
    return [...opgeslagen, ...historie];
  }

  /** Ster aan of uit zetten voor een bestemming. */
  async function toggleFavoriet(f) {
    const huidige = settings().favorieten || [];
    const isFav = huidige.some((x) => x.naam === f.naam);
    const favs = huidige.filter((x) => x.naam !== f.naam);
    if (!isFav) {
      favs.unshift({
        naam: f.naam,
        bestemming: f.bestemming,
        km: f.km,
        project: f.project || "",
        lat: f.lat ?? null,
        lon: f.lon ?? null,
      });
    }
    App().haptic(15);
    await App().saveSettings({ favorieten: favs });
    renderBestemmingen();
  }

  /** Compacte regel: ster, naam, afstand — alles op één rij. */
  function bestemmingRij(f, isFav) {
    const li = document.createElement("li");
    li.className = "reis-row";
    li.innerHTML = `
      <button type="button" class="reis-star${isFav ? " is-fav" : ""}"
        aria-label="${isFav ? "Favoriet uitzetten" : "Favoriet maken"}"
        title="${isFav ? "Favoriet uitzetten" : "Favoriet maken"}">${isFav ? "★" : "☆"}</button>
      <span class="reis-name">${escapeHtml(f.naam)}
        <span class="reis-sub">· ${escapeHtml(f.bestemming)}</span>
      </span>
      <span class="reis-km">${M().formatKm(f.km)} km</span>`;
    li.addEventListener("click", (e) => {
      if (e.target.closest(".reis-star")) return;
      vulFavoriet(f);
    });
    li.querySelector(".reis-star").addEventListener("click", () => toggleFavoriet(f));
    return li;
  }

  function renderBestemmingen() {
    const favList = $("#reis-fav-list");
    const allList = $("#reis-all-list");
    const alle = alleFavorieten();
    const favs = alle.filter((f) => f.bron === "vast");
    const overig = alle.filter((f) => f.bron !== "vast");

    favList.innerHTML = "";
    if (!favs.length) {
      favList.innerHTML =
        '<li class="sub">Nog geen favorieten — open "Alle" en tik op ☆ bij een bestemming.</li>';
    } else {
      favs.forEach((f) => favList.appendChild(bestemmingRij(f, true)));
    }

    const q = ($("#reis-all-search")?.value || "").trim().toLowerCase();
    allList.innerHTML = "";
    const zichtbaar = overig.filter(
      (f) => !q || `${f.naam} ${f.bestemming}`.toLowerCase().includes(q)
    );
    if (!zichtbaar.length) {
      allList.innerHTML = `<li class="sub">${
        overig.length ? "Geen bestemming gevonden." : "Nog geen eerdere ritten."
      }</li>`;
    } else {
      zichtbaar.slice(0, 40).forEach((f) => allList.appendChild(bestemmingRij(f, false)));
    }
    $("#btn-reis-toggle-all").textContent = allOpen() ? "Alle ▴" : `Alle (${overig.length}) ▾`;
  }

  function allOpen() {
    return !$("#reis-all-wrap").classList.contains("hidden");
  }

  function vulFavoriet(f) {
    $("#reis-naam").value = f.naam;
    $("#reis-bestemming").value = f.bestemming;
    $("#reis-km").value = M().formatKm(f.km);
    $("#reis-project").value = f.project || "";
    gekozenAdres = f.lat != null ? { label: f.bestemming, lat: f.lat, lon: f.lon } : null;
    kmAuto = false;
    $("#reis-km-status").textContent = f.bron === "vast" ? "uit favoriet" : "uit historie";
    updatePreview();
    App().haptic(15);
    // Direct naar het ingevulde formulier — scheelt handmatig scrollen.
    $("#reis-form-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // === Adres zoeken ===
  const doSearch = global.BoekReis.debounce(async () => {
    const q = $("#reis-adres").value.trim();
    const list = $("#reis-adres-results");
    if (q.length < 3) {
      list.classList.add("hidden");
      return;
    }
    try {
      const results = await global.BoekReis.searchAddress(q);
      if (results === null) return; // vervangen door nieuwere zoekopdracht
      list.innerHTML = "";
      list.classList.toggle("hidden", !results.length);
      for (const r of results) {
        const li = document.createElement("li");
        li.textContent = r.label;
        li.addEventListener("click", () => kiesAdres(r));
        list.appendChild(li);
      }
    } catch (e) {
      $("#reis-km-status").textContent = "Adreszoeken niet bereikbaar";
    }
  }, 350);

  async function kiesAdres(r) {
    gekozenAdres = r;
    $("#reis-adres-results").classList.add("hidden");
    $("#reis-adres").value = r.label;
    if (!$("#reis-bestemming").value) {
      const naam = $("#reis-naam").value.trim();
      $("#reis-bestemming").value = naam && r.plaats ? `${naam} ${r.plaats}` : r.label;
    }
    await berekenKm();
    updatePreview();
  }

  async function berekenKm() {
    const thuis = settings().thuisAdres;
    const status = $("#reis-km-status");
    if (!gekozenAdres) return;
    if (!thuis || thuis.lat == null) {
      status.textContent = "Stel je thuisadres in bij Overzicht → Reiskosten-instellingen";
      return;
    }
    status.textContent = "Route berekenen…";
    try {
      const km = await global.BoekReis.routeKm(thuis.lat, thuis.lon, gekozenAdres.lat, gekozenAdres.lon);
      $("#reis-km").value = M().formatKm(km);
      kmAuto = true;
      status.textContent = `✓ auto via route (${M().formatKm(km)} km enkele reis)`;
    } catch (e) {
      kmAuto = false;
      status.textContent = "Route niet beschikbaar — vul km handmatig in";
    }
    updatePreview();
  }

  function huidigeKm() {
    return M().parseUserAmount($("#reis-km").value);
  }

  function updatePreview() {
    const naam = $("#reis-naam").value.trim();
    const bestemming = $("#reis-bestemming").value.trim();
    const km = huidigeKm();
    const tarief = settings().kmTarief || 0.23;
    const omsEl = $("#reis-preview-oms");
    const bedragEl = $("#reis-preview-bedrag");
    if (!naam || !bestemming || km == null) {
      omsEl.textContent = "—";
      bedragEl.textContent = "—";
      return;
    }
    const thuisPlaats = settings().thuisAdres?.plaats || "Aalten";
    omsEl.textContent = M().buildReisOmschrijving({ naam, km, bestemming, thuisPlaats });
    bedragEl.textContent = `${M().fmtEur(M().reisBedrag(km, tarief))}  (2 × ${M().formatKm(km)} km × € ${String(tarief).replace(".", ",")})`;
  }

  function clearForm() {
    $("#reis-naam").value = "";
    $("#reis-adres").value = "";
    $("#reis-bestemming").value = "";
    $("#reis-km").value = "";
    $("#reis-project").value = "";
    $("#reis-fav-save").checked = false;
    $("#reis-adres-results").classList.add("hidden");
    $("#reis-km-status").textContent = "—";
    gekozenAdres = null;
    kmAuto = false;
    setEditRow(null);
    updatePreview();
  }

  function huidigeFields() {
    const naam = $("#reis-naam").value.trim();
    const bestemming = $("#reis-bestemming").value.trim();
    const km = huidigeKm();
    const tarief = settings().kmTarief || 0.23;
    const thuisPlaats = settings().thuisAdres?.plaats || "Aalten";
    return {
      datumIso: $("#reis-datum").value,
      leverancier: "Ivo Mengerink",
      omschrijving: M().buildReisOmschrijving({ naam, km, bestemming, thuisPlaats }),
      factuurnummer: "",
      bedrag: M().reisBedrag(km, tarief),
      btw: 0,
      verlegd: false,
      afschrijving: false,
      categorie: "Reiskosten",
      project: $("#reis-project").value.trim(),
      opmerking: "Buiten scope BTW",
      land: "NL",
    };
  }

  async function boek() {
    const naam = $("#reis-naam").value.trim();
    const bestemming = $("#reis-bestemming").value.trim();
    const km = huidigeKm();
    const datumIso = $("#reis-datum").value;
    if (!naam) return App().showToast("Vul een naam/doel in.", true);
    if (!bestemming) return App().showToast("Vul een bestemming in.", true);
    if (km == null || km <= 0) return App().showToast("Vul een geldig aantal km in.", true);
    if (!datumIso) return App().showToast("Vul een datum in.", true);

    const fields = huidigeFields();

    if (editRow) {
      const row = editRow;
      setEditRow(null);
      await App().persistMutation(
        { kind: "inkoop_update", excelRow: row, fields },
        { successMsg: "Rit bijgewerkt" }
      );
      return;
    }

    // De velden blijven staan voor de volgende dag, dus een dubbele boeking
    // op dezelfde datum is makkelijk gemaakt — daarom expliciet bevestigen.
    const dubbel = App().state.intel.inkoop.history.find(
      (h) => h.omschrijving === fields.omschrijving && h.datum && M().dateToIso(h.datum) === datumIso
    );
    if (dubbel) {
      const doorgaan = await App().showConfirm(
        `Deze rit staat al op ${dubbel.datumStr}. Nog een keer boeken?`,
        "Toch boeken",
        "Annuleren"
      );
      if (!doorgaan) return;
    }

    if ($("#reis-fav-save").checked) {
      const favs = (settings().favorieten || []).filter((x) => x.naam !== naam);
      favs.unshift({
        naam,
        bestemming,
        km,
        project: fields.project,
        lat: gekozenAdres?.lat ?? null,
        lon: gekozenAdres?.lon ?? null,
      });
      App().saveSettings({ favorieten: favs });
      $("#reis-fav-save").checked = false;
    }

    // Bewust niet wissen: zelfde rit op een andere dag boeken kost nu alleen
    // een tik op de datum-stepper en nog een keer "Reiskosten inboeken".
    await App().persistMutation(
      { kind: "inkoop_add", fields },
      { successMsg: `Reiskosten geboekt: ${M().fmtEur(fields.bedrag)}` }
    );
  }

  /** Bewerkmodus aan/uit. */
  function setEditRow(row) {
    editRow = row;
    $("#reis-form-title").textContent = row ? `Rit bewerken (rij ${row})` : "Rit inboeken";
    $("#btn-reis-boek").textContent = row ? "Rit bijwerken" : "Reiskosten inboeken";
    $("#btn-reis-cancel-edit").classList.toggle("hidden", !row);
  }

  function startEdit(h) {
    const parsed = M().parseReisOmschrijving(h.omschrijving);
    if (!parsed) {
      App().showToast("Deze regel heeft geen standaard reisomschrijving — bewerk hem op de Inkoop-tab.", true);
      return;
    }
    $("#reis-datum").value = h.datum ? M().dateToIso(h.datum) : M().todayIso();
    $("#reis-naam").value = parsed.naam;
    $("#reis-bestemming").value = parsed.bestemming;
    $("#reis-km").value = M().formatKm(parsed.km);
    $("#reis-project").value = h.project || "";
    $("#reis-adres").value = "";
    $("#reis-adres-results").classList.add("hidden");
    gekozenAdres = null;
    kmAuto = false;
    $("#reis-km-status").textContent = "uit bestaande rit";
    setEditRow(h.excelRow);
    updatePreview();
    App().haptic(15);
    $("#reis-form-card").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function deleteRit(h) {
    const ok = await App().showConfirm(
      `Rit verwijderen?\n${h.datumStr} · ${M().fmtEur(h.bedrag)}\n${h.omschrijving}`,
      "Verwijderen",
      "Annuleren"
    );
    if (!ok) return;
    if (editRow === h.excelRow) setEditRow(null);
    await App().persistMutation(
      { kind: "inkoop_delete", excelRow: h.excelRow },
      { successMsg: "Rit verwijderd" }
    );
  }

  function renderHistorie() {
    const list = $("#reis-hist-list");
    list.innerHTML = "";
    let shown = 0;
    for (const h of App().state.intel.inkoop.history) {
      if (h.categorie !== "Reiskosten" && !/^Transportkosten/i.test(h.omschrijving)) continue;
      const li = document.createElement("li");
      li.className = "boek-item" + (editRow === h.excelRow ? " selected" : "");
      li.innerHTML = `
        <div class="bi-head">
          <span class="bi-title">${escapeHtml(h.omschrijving)}</span>
          <span class="bi-amount uit">${M().fmtEur(h.bedrag)}</span>
        </div>
        <div class="bi-sub"><span>${h.project ? escapeHtml(h.project) : ""}</span><span>${h.datumStr}</span></div>
        ${App().rowActionsHtml()}`;
      li.querySelector('[data-act="edit"]').addEventListener("click", () => startEdit(h));
      li.querySelector('[data-act="del"]').addEventListener("click", () => deleteRit(h));
      App().bindSwipe(li, { onEdit: () => startEdit(h), onDelete: () => deleteRit(h) });
      list.appendChild(li);
      if (++shown >= 10) break;
    }
    if (!shown) list.innerHTML = '<li class="sub">Nog geen reiskosten geboekt.</li>';
  }

  // === Voorstellen: gewerkt volgens de uren, maar geen rit geboekt ===
  let urenGeladen = false;

  async function laadVoorstellen() {
    const cfg = global.BOEK_CONFIG.graph;
    if (urenGeladen || !cfg.urenPath || !App().state.loaded) return;
    urenGeladen = true;
    try {
      const token = await App().ensureLoggedIn();
      const uren = await global.BoekWorkbook.readTableRange(cfg.urenPath, token, cfg.urenTable);
      App().state.urenRows = M().parseUrenRows(uren.values, uren.headerRow);
      renderVoorstellen();
    } catch (_) {
      urenGeladen = false; // volgende keer opnieuw proberen
    }
  }

  function renderVoorstellen() {
    const card = $("#reis-voorstel-card");
    const list = $("#reis-voorstel-list");
    const urenRows = App().state.urenRows || [];
    if (!urenRows.length) {
      card.classList.add("hidden");
      return;
    }
    const voorstellen = M().reisVoorstellen(
      urenRows,
      App().state.intel.inkoop.history,
      alleFavorieten(),
      settings().thuisAdres?.plaats || "Aalten"
    );
    card.classList.toggle("hidden", !voorstellen.length);
    list.innerHTML = "";
    for (const v of voorstellen) {
      const li = document.createElement("li");
      li.className = "reis-row";
      li.innerHTML = `
        <span class="reis-name">${v.datumStr}
          <span class="reis-sub">· ${escapeHtml(v.fav.naam)} (${M().formatKm(v.fav.km)} km)</span>
        </span>
        <button type="button" class="btn-icon voorstel-boek">Boek</button>`;
      li.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        vulFavoriet(v.fav);
        $("#reis-datum").value = v.datumIso;
        updatePreview();
      });
      li.querySelector(".voorstel-boek").addEventListener("click", async () => {
        vulFavoriet(v.fav);
        $("#reis-datum").value = v.datumIso;
        updatePreview();
        await boek();
        renderVoorstellen();
      });
      list.appendChild(li);
    }
  }

  function render() {
    renderBestemmingen();
    renderHistorie();
    renderVoorstellen();
    updatePreview();
  }

  function init() {
    $("#reis-datum").value = M().todayIso();
    App().bindDateSteppers("reis-datum", "btn-reis-date-prev", "btn-reis-date-next");
    $("#reis-adres").addEventListener("input", doSearch);
    global.BoekCombo.createCombo("reis-project", null, () => App().state.intel.inkoop.projecten, null, {
      title: "Project",
    });
    for (const id of ["reis-naam", "reis-bestemming", "reis-km"]) {
      document.getElementById(id).addEventListener("input", updatePreview);
    }
    $("#reis-km").addEventListener("input", () => {
      kmAuto = false;
      $("#reis-km-status").textContent = "handmatig";
    });
    $("#btn-reis-boek").addEventListener("click", boek);
    $("#btn-reis-clear").addEventListener("click", clearForm);
    $("#btn-reis-cancel-edit").addEventListener("click", clearForm);
    $("#btn-reis-toggle-all").addEventListener("click", () => {
      $("#reis-all-wrap").classList.toggle("hidden");
      renderBestemmingen();
    });
    $("#reis-all-search").addEventListener("input", renderBestemmingen);
  }

  App().registerTab("reis", { init, render, onShow: laadVoorstellen });
  global.BoekUiReis = { render };
})(window);
