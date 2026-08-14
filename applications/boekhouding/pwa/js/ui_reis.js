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

  async function maakFavoriet(f) {
    const favs = (settings().favorieten || []).filter((x) => x.naam !== f.naam);
    favs.unshift({
      naam: f.naam,
      bestemming: f.bestemming,
      km: f.km,
      project: f.project || "",
      lat: f.lat ?? null,
      lon: f.lon ?? null,
    });
    await App().saveSettings({ favorieten: favs });
    renderFavorieten();
    App().showToast(`★ "${f.naam}" opgeslagen als favoriet`);
  }

  function renderFavorieten() {
    const list = $("#reis-fav-list");
    list.innerHTML = "";
    const favs = alleFavorieten();
    if (!favs.length) {
      list.innerHTML = '<li class="sub">Nog geen bestemmingen — boek hieronder je eerste rit.</li>';
      return;
    }
    for (const f of favs.slice(0, 15)) {
      const isFav = f.bron === "vast";
      const li = document.createElement("li");
      li.className = "boek-item";
      li.innerHTML = `
        <div class="bi-head">
          <span class="bi-title">${isFav ? "★ " : ""}${escapeHtml(f.naam)}</span>
          <span class="bi-amount">${M().formatKm(f.km)} km</span>
        </div>
        <div class="bi-sub">
          <span>${escapeHtml(f.bestemming)}${f.project ? " · " + escapeHtml(f.project) : ""}</span>
          <span>${isFav ? "favoriet" : "uit historie"}</span>
        </div>
        <div class="bi-actions">
          ${isFav
            ? '<button type="button" class="bi-x" aria-label="Favoriet verwijderen" title="Favoriet verwijderen">✕</button>'
            : '<button type="button" class="bi-star" aria-label="Maak favoriet" title="Maak favoriet">☆ favoriet maken</button>'}
        </div>`;
      li.addEventListener("click", (e) => {
        if (e.target.closest(".bi-x") || e.target.closest(".bi-star")) return;
        vulFavoriet(f);
      });
      li.querySelector(".bi-star")?.addEventListener("click", () => maakFavoriet(f));
      li.querySelector(".bi-x")?.addEventListener("click", async () => {
        const ok = await App().showConfirm(`Favoriet "${f.naam}" verwijderen?`, "Verwijderen", "Annuleren");
        if (ok) {
          await App().saveSettings({
            favorieten: (settings().favorieten || []).filter((x) => x.naam !== f.naam),
          });
          renderFavorieten();
        }
      });
      list.appendChild(li);
    }
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

  function render() {
    renderFavorieten();
    renderHistorie();
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
  }

  App().registerTab("reis", { init, render });
  global.BoekUiReis = { render };
})(window);
