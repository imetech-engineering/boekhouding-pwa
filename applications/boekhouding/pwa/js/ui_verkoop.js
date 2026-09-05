/**
 * Verkoop-tab: facturen uit OneDrive, PDF-preview + extractie, inboeken, verplaatsen.
 */
(function (global) {
  const App = () => global.BoekApp;
  const M = () => global.BoekModel;
  const $ = (s) => document.querySelector(s);

  let selectedFile = null;
  let pane = null; // gedeelde voorbeeldkaart (js/preview_pane.js)
  let bankMatchRows = [];
  let prefillBankRows = [];
  let editRow = null; // Excel-rij die bewerkt wordt (null = nieuwe regel)

  const intel = () => App().state.intel.verkoop;

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function renderFiles() {
    const st = App().state;
    const list = $("#verkoop-files-list");
    const items = st.files.verkoop;
    $("#verkoop-files-count").textContent = items.length ? `(${items.length})` : "";
    $("#verkoop-files-empty").classList.toggle("hidden", items.length > 0);
    list.innerHTML = "";
    for (const item of items) {
      const li = document.createElement("li");
      li.className = "file-item" + (selectedFile?.id === item.id ? " selected" : "");
      const icon = item.folder ? "📁" : item.name.toLowerCase().endsWith(".pdf") ? "📄" : "🖼️";
      li.innerHTML = `<span class="fi-icon">${icon}</span><span class="fi-name">${escapeHtml(item.name)}</span>`;
      li.addEventListener("click", () => selectFile(item));
      list.appendChild(li);
    }
  }

  async function selectFile(item) {
    selectedFile = item;
    renderFiles();
    $("#btn-verkoop-boek-move").classList.remove("hidden");

    // Vers formulier voor deze factuur, dan vullen: bestandsnaam → PDF → Excel-historie.
    clearFormFields();
    setEditRow(null);

    // FAxxxx_(NL|EU|buitenEU)_Bedrijf.pdf — nummer, klant en land uit de naam
    const parsed = M().parseVerkoopFilename(item.name);
    if (parsed.factuurnummer) $("#verkoop-fnr").value = parsed.factuurnummer;
    if (parsed.bedrijf) $("#verkoop-klant").value = parsed.bedrijf;
    if (parsed.type) $("#verkoop-land").value = parsed.type;

    try {
      const doc = await pane.toon(item, global.BOEK_CONFIG.graph.folders.verkoopNieuw);
      if (doc) {
        const text = await global.BoekPdf.extractText(doc);
        const ex = global.BoekPdf.extractInvoiceData(text);
        // Datum en bedrag staan bij verkoop in de factuur zelf
        if (ex.datum) $("#verkoop-datum").value = ex.datum;
        if (ex.bedrag != null) $("#verkoop-bedrag").value = M().fmtAmountInput(ex.bedrag);
        if (ex.btw != null) $("#verkoop-btw").value = String(ex.btw);
      }
    } catch (e) {
      App().showToast(`Voorbeeld laden mislukt: ${e.message || e}`, true);
    }
    applyPartyDefaults();
    updateBankCheck();
  }

  function deselectFile() {
    selectedFile = null;
    pane.verberg();
    $("#btn-verkoop-boek-move").classList.add("hidden");
    renderFiles();
  }

  function applyPartyDefaults() {
    const partij = $("#verkoop-klant").value.trim();
    if (!partij) return;
    const d = M().partyDefaults(intel(), partij);
    if (d.btw != null) $("#verkoop-btw").value = String(d.btw).replace(/\.0$/, "");
    if (d.land) $("#verkoop-land").value = M().normalizeLand(d.land);
    if (!$("#verkoop-categorie").value && d.categorie) $("#verkoop-categorie").value = d.categorie;
    if (!$("#verkoop-valuta").value && d.valuta) {
      $("#verkoop-valuta").value = d.valuta;
      $("#verkoop-valuta-wrap").classList.remove("hidden");
    }
    if (!$("#verkoop-koers").value && d.wisselkoers) $("#verkoop-koers").value = d.wisselkoers;
  }

  // === Vreemde valuta: het derde veld volgt uit de andere twee ===
  const VALUTA_VELDEN = { orig: "verkoop-bedrag-orig", koers: "verkoop-koers", eur: "verkoop-bedrag" };

  function valutaWaarden() {
    const lees = (id) => M().parseUserAmount(document.getElementById(id).value);
    return {
      orig: lees(VALUTA_VELDEN.orig),
      // De koers heeft meer dan twee decimalen, dus die niet afronden.
      koers: M().parseUserNumber(document.getElementById(VALUTA_VELDEN.koers).value),
      eur: lees(VALUTA_VELDEN.eur),
    };
  }

  function valutaOmrekenen(bron) {
    if ($("#verkoop-valuta-wrap").classList.contains("hidden")) return;
    const patch = M().valutaAanvullen(bron, valutaWaarden());
    for (const [veld, waarde] of Object.entries(patch)) {
      document.getElementById(VALUTA_VELDEN[veld]).value =
        veld === "koers" ? M().fmtKoers(waarde) : M().fmtAmountInput(waarde);
    }
    if (patch.eur !== undefined) updateBankCheck();
    updateValutaInfo();
  }

  function updateValutaInfo() {
    const munt = $("#verkoop-valuta").value.trim().toUpperCase() || "eenheid";
    $("#verkoop-koers-label").textContent = `Wisselkoers (€ per 1 ${munt})`;
    const { orig, koers, eur } = valutaWaarden();
    $("#verkoop-valuta-info").textContent =
      orig != null && koers != null && eur != null
        ? `${M().fmtAmountInput(orig)} ${munt} × ${M().fmtKoers(koers)} = ${M().fmtEur(eur)}`
        : "Vul er twee in, dan rekent de app de derde uit.";
  }

  function updateBankCheck() {
    const bedrag = M().parseUserAmount($("#verkoop-bedrag").value);
    const datumIso = $("#verkoop-datum").value;
    bankMatchRows = [];
    let matches = [];
    if (bedrag != null && datumIso) {
      matches = M().bankMatchesForInvoice(
        App().state.bankRows, bedrag, datumIso, true, App().state.matchDagen
      );
      bankMatchRows = matches.map((r) => r.excelRow);
    }
    for (const r of prefillBankRows) {
      if (!bankMatchRows.includes(r)) bankMatchRows.push(r);
    }
    const row = $("#verkoop-bank-check-row");
    row.classList.toggle("hidden", bankMatchRows.length === 0);
    if (bankMatchRows.length) {
      const eerste = matches[0];
      $("#verkoop-bank-check-label").textContent =
        `Bankregel(s) afvinken (${bankMatchRows.length}×` +
        (eerste ? `, o.a. ${eerste.datumStr} ${M().fmtEur(eerste.in ?? eerste.uit)}` : "") + ")";
    }
  }

  function readFields() {
    return {
      datumIso: $("#verkoop-datum").value,
      klant: $("#verkoop-klant").value.trim(),
      omschrijving: $("#verkoop-omschrijving").value.trim(),
      factuurnummer: $("#verkoop-fnr").value.trim(),
      bedrag: M().parseUserAmount($("#verkoop-bedrag").value),
      btw: $("#verkoop-btw").value.trim() === "" ? null : M().parseUserAmount($("#verkoop-btw").value.replace("%", "")),
      land: $("#verkoop-land").value,
      categorie: $("#verkoop-categorie").value.trim(),
      opmerking: $("#verkoop-opmerking").value.trim(),
      bedragOrig: M().parseUserAmount($("#verkoop-bedrag-orig").value),
      valuta: $("#verkoop-valuta").value.trim(),
      wisselkoers: $("#verkoop-koers").value.trim(),
    };
  }

  /** Alleen de velden leegmaken (gebruikt bij het selecteren van een nieuwe factuur). */
  function clearFormFields() {
    for (const id of [
      "verkoop-klant", "verkoop-omschrijving", "verkoop-fnr", "verkoop-bedrag",
      "verkoop-btw", "verkoop-categorie", "verkoop-opmerking",
      "verkoop-bedrag-orig", "verkoop-valuta", "verkoop-koers",
    ]) {
      document.getElementById(id).value = "";
    }
    $("#verkoop-datum").value = M().todayIso();
    $("#verkoop-land").value = "";
    $("#verkoop-bank-check").checked = false;
    $("#verkoop-valuta-wrap").classList.add("hidden");
    updateValutaInfo();
    prefillBankRows = [];
  }

  function clearForm() {
    clearFormFields();
    setEditRow(null);
    updateBankCheck();
  }

  /** Bewerkmodus aan/uit: knoptekst en titel volgen de stand. */
  function setEditRow(row) {
    editRow = row;
    $("#verkoop-form-title").textContent = row ? `Regel bewerken (rij ${row})` : "Factuur inboeken";
    $("#btn-verkoop-boek").textContent = row ? "Bijwerken" : "Inboeken";
    $("#btn-verkoop-boek-move").classList.toggle("hidden", !!row || !selectedFile);
    $("#btn-verkoop-cancel-edit").classList.toggle("hidden", !row);
    // Bewerken verlaten zonder gekozen bestand → voorbeeld weg.
    if (!row && !selectedFile) pane.verberg();
  }

  function startEdit(h) {
    clearFormFields();
    // Bewerken staat los van een factuur uit de te-verwerken-lijst.
    selectedFile = null;
    renderFiles();
    $("#verkoop-datum").value = h.datum ? M().dateToIso(h.datum) : M().todayIso();
    $("#verkoop-klant").value = h.partij || "";
    $("#verkoop-omschrijving").value = h.omschrijving || "";
    $("#verkoop-fnr").value = h.factuurnummer || "";
    $("#verkoop-bedrag").value = h.bedrag != null ? M().fmtAmountInput(h.bedrag) : "";
    $("#verkoop-btw").value = h.btw != null ? String(h.btw).replace(/\.0$/, "") : "";
    $("#verkoop-land").value = M().normalizeLand(h.land);
    $("#verkoop-categorie").value = h.categorie || "";
    $("#verkoop-opmerking").value = h.opmerking || "";
    if (h.valuta || h.wisselkoers || h.bedragOrig != null) {
      $("#verkoop-valuta-wrap").classList.remove("hidden");
      $("#verkoop-valuta").value = h.valuta || "";
      $("#verkoop-koers").value = h.wisselkoers || "";
      $("#verkoop-bedrag-orig").value = h.bedragOrig != null ? M().fmtAmountInput(h.bedragOrig) : "";
    }
    setEditRow(h.excelRow);
    updateBankCheck();
    App().haptic(15);
    $("#verkoop-form-title").scrollIntoView({ behavior: "smooth", block: "start" });
    toonBijbehorendeFactuur(h);
  }

  /** Bijbehorend bestand opzoeken en meteen tonen, net als bij het inboeken. */
  async function toonBijbehorendeFactuur(h) {
    pane.verberg();
    pane.melding("🔎 Bijbehorende factuur zoeken…");
    const gevonden = await global.BoekDocFinder.findFor("verkoop", h);
    // Ondertussen kan er al een andere regel gekozen zijn.
    if (editRow !== h.excelRow) return;
    if (!gevonden) {
      pane.melding("Geen bestand gevonden bij deze regel — zoek hem op in de lijst hierboven.");
      return;
    }
    try {
      await pane.toon(gevonden);
    } catch (e) {
      App().showToast(`Factuur laden mislukt: ${e.message || e}`, true);
      pane.melding(`Factuur laden mislukt: ${e.message || e}`);
    }
  }

  async function deleteRow(h) {
    const ok = await App().showConfirm(
      `Regel verwijderen?\n${h.datumStr} · ${h.partij} · ${M().fmtEur(h.bedrag)}`,
      "Verwijderen",
      "Annuleren"
    );
    if (!ok) return;
    if (editRow === h.excelRow) clearForm();
    await App().persistMutation(
      { kind: "verkoop_delete", excelRow: h.excelRow },
      { successMsg: "Regel verwijderd" }
    );
  }

  async function boek(move) {
    const f = readFields();
    if (!f.klant) return App().showToast("Vul de klant in.", true);
    if (f.bedrag == null) return App().showToast("Vul een geldig bedrag incl. BTW in.", true);
    if (!f.datumIso) return App().showToast("Vul een geldige factuurdatum in.", true);

    if (editRow) {
      const row = editRow;
      clearForm();
      await App().persistMutation(
        { kind: "verkoop_update", excelRow: row, fields: f },
        { successMsg: "Regel bijgewerkt" }
      );
      return;
    }

    const dup = M().findDuplicate(intel(), {
      partij: f.klant,
      datumIso: f.datumIso,
      bedrag: f.bedrag,
      factuurnummer: f.factuurnummer,
    });
    if (dup) {
      const doorgaan = await App().showConfirm(
        `Mogelijk dubbel: ${dup.partij} · ${dup.datumStr} · ${M().fmtEur(dup.bedrag)} (${dup.factuurnummer || "geen nr"}). Toch inboeken?`,
        "Toch inboeken",
        "Annuleren"
      );
      if (!doorgaan) return;
    }

    const afvinken = $("#verkoop-bank-check").checked ? [...bankMatchRows] : [];
    const fileToMove = move && selectedFile ? selectedFile : null;
    clearForm();
    if (fileToMove) deselectFile();

    const ok = await App().persistMutation(
      { kind: "verkoop_add", fields: f, bankRows: afvinken },
      { successMsg: move ? "Ingeboekt + factuur verplaatst" : "Ingeboekt in verkoopboek" }
    );
    if (!ok) return;
    if (fileToMove) {
      await App().persistMutation({
        kind: "file_move",
        itemId: fileToMove.id,
        destFolder: global.BOEK_CONFIG.graph.folders.verkoopVerwerkt,
      });
      App().refreshQuiet();
    }
  }

  let kopIndex = new Map();

  function renderHistory() {
    const st = App().state;
    kopIndex = App().koppelIndex();
    const list = $("#verkoop-hist-list");
    const q = $("#verkoop-hist-search").value.trim().toLowerCase();
    list.innerHTML = "";
    let shown = 0;
    for (const h of intel().history) {
      if (q && !`${h.partij} ${h.omschrijving} ${h.categorie} ${h.factuurnummer || ""}`.toLowerCase().includes(q)) continue;
      const gekoppeld = kopIndex.has(`verkoop|${h.excelRow}`);
      const li = document.createElement("li");
      li.className = "boek-item" + (editRow === h.excelRow ? " selected" : "");
      li.innerHTML = `
        <div class="bi-head">
          <span class="bi-title">${escapeHtml(h.partij)}</span>
          <span class="bi-amount in">${gekoppeld ? "🔗 " : ""}${M().fmtEur(h.bedrag)}</span>
        </div>
        <div class="bi-sub"><span>${escapeHtml(h.omschrijving).slice(0, 70)}</span><span>${h.factuurnummer || ""} · ${h.datumStr}</span></div>
        ${App().rowActionsHtml()}`;
      li.addEventListener("click", (ev) => {
        if (ev.target.closest("button")) return;
        applyHistory(h);
      });
      if (gekoppeld) {
        // Tik op 🔗 → koppelingen van deze factuur bekijken/ontkoppelen/aanvullen
        li.querySelector(".bi-amount").addEventListener("click", (ev) => {
          ev.stopPropagation();
          global.BoekUiOverzicht?.openFactuurKoppel({ ...h, boek: "verkoop" });
        });
      }
      li.querySelector('[data-act="edit"]').addEventListener("click", () => startEdit(h));
      li.querySelector('[data-act="del"]').addEventListener("click", () => deleteRow(h));
      App().bindSwipe(li, { onEdit: () => startEdit(h), onDelete: () => deleteRow(h) });
      list.appendChild(li);
      if (++shown >= 20) break;
    }
  }

  function applyHistory(h) {
    const force = !selectedFile;
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el && val != null && val !== "" && (force || !el.value)) el.value = String(val);
    };
    set("verkoop-klant", h.partij);
    set("verkoop-omschrijving", h.omschrijving);
    set("verkoop-categorie", h.categorie);
    set("verkoop-btw", h.btw != null ? String(h.btw).replace(/\.0$/, "") : "");
    set("verkoop-opmerking", h.opmerking);
    if (force || !$("#verkoop-land").value) $("#verkoop-land").value = M().normalizeLand(h.land);
    if (force && h.bedrag != null) $("#verkoop-bedrag").value = M().fmtAmountInput(h.bedrag);
    App().haptic(15);
    updateBankCheck();
  }

  function render() {
    renderFiles();
    renderHistory();
    updateBankCheck();
  }

  function prefill(p) {
    clearForm();
    if (p.datumIso) $("#verkoop-datum").value = p.datumIso;
    if (p.omschrijving) $("#verkoop-omschrijving").value = p.omschrijving;
    if (p.bedrag != null) $("#verkoop-bedrag").value = M().fmtAmountInput(p.bedrag);
    prefillBankRows = p.bankRows || [];
    updateBankCheck();
    if (prefillBankRows.length) $("#verkoop-bank-check").checked = true;
  }

  function init() {
    pane = global.BoekPreviewPane.create(
      "verkoop",
      () => global.BOEK_CONFIG.graph.folders.verkoopNieuw
    );
    $("#verkoop-datum").value = M().todayIso();
    App().bindDateSteppers("verkoop-datum", "btn-verkoop-date-prev", "btn-verkoop-date-next");
    global.BoekCombo.createCombo("verkoop-klant", null, () => intel().partijen, applyPartyDefaults, {
      title: "Klant",
    });
    global.BoekCombo.createCombo(
      "verkoop-categorie",
      null,
      () => {
        const st = App().state;
        const set = new Set([...st.verkoopKeuzes, ...intel().categorieen]);
        return [...set];
      },
      null,
      { title: "Categorie" }
    );
    $("#verkoop-klant").addEventListener("change", applyPartyDefaults);
    $("#btn-verkoop-valuta-toggle").addEventListener("click", () => {
      $("#verkoop-valuta-wrap").classList.toggle("hidden");
      updateValutaInfo();
    });
    $("#verkoop-bedrag-orig").addEventListener("input", () => valutaOmrekenen("orig"));
    $("#verkoop-koers").addEventListener("input", () => valutaOmrekenen("koers"));
    $("#verkoop-bedrag").addEventListener("input", () => valutaOmrekenen("eur"));
    $("#verkoop-valuta").addEventListener("input", updateValutaInfo);
    $("#btn-verkoop-boek").addEventListener("click", () => boek(false));
    $("#btn-verkoop-boek-move").addEventListener("click", () => boek(true));
    $("#btn-verkoop-clear").addEventListener("click", () => {
      clearForm();
      deselectFile();
    });
    $("#btn-verkoop-cancel-edit").addEventListener("click", clearForm);
    for (const id of ["verkoop-bedrag", "verkoop-datum"]) {
      document.getElementById(id).addEventListener("input", updateBankCheck);
      document.getElementById(id).addEventListener("change", updateBankCheck);
    }
    $("#verkoop-hist-search").addEventListener("input", renderHistory);
  }

  App().registerTab("verkoop", { init, render });
  global.BoekUiVerkoop = { prefill, render };
})(window);
