/**
 * Inkoop-tab: facturen uit OneDrive, PDF-preview + extractie, inboeken, verplaatsen.
 */
(function (global) {
  const App = () => global.BoekApp;
  const M = () => global.BoekModel;
  const $ = (s) => document.querySelector(s);

  let selectedFile = null;
  let filenameParsed = null;
  let pane = null; // gedeelde voorbeeldkaart (js/preview_pane.js)
  let bankMatchRows = [];
  let prefillBankRows = [];
  let editRow = null; // Excel-rij die bewerkt wordt (null = nieuwe regel)

  const intel = () => App().state.intel.inkoop;

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  // === Bestandenlijst ===
  function renderFiles() {
    const st = App().state;
    const list = $("#inkoop-files-list");
    const items = st.files.inkoop;
    $("#inkoop-files-count").textContent = items.length ? `(${items.length})` : "";
    $("#inkoop-files-empty").classList.toggle("hidden", items.length > 0);
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
    $("#btn-inkoop-boek-move").classList.remove("hidden");

    // Vers formulier voor deze factuur, dan vullen: bestandsnaam → PDF → Excel-historie.
    clearFormFields();
    setEditRow(null);

    // 1. Bestandsnaam parsen (yymmdd bedrijf factuurnummer) — datum uit de naam is leidend
    filenameParsed = M().parseInkoopFilename(item.name);
    if (filenameParsed.datumIso) $("#inkoop-datum").value = filenameParsed.datumIso;
    if (filenameParsed.bedrijf) $("#inkoop-leverancier").value = filenameParsed.bedrijf;
    if (filenameParsed.factuurnummer) $("#inkoop-fnr").value = filenameParsed.factuurnummer;

    // 2. Voorbeeld tonen en, bij een PDF, de gegevens eruit halen
    try {
      const doc = await pane.toon(item, global.BOEK_CONFIG.graph.folders.inkoopNieuw);
      if (doc) {
        const text = await global.BoekPdf.extractText(doc);
        applyExtraction(global.BoekPdf.extractInvoiceData(text));
      } else {
        // Geen PDF (bijv. een AliExpress-map met foto's) → de bon laten lezen.
        leesFotoTekst(item);
      }
    } catch (e) {
      App().showToast(`Voorbeeld laden mislukt: ${e.message || e}`, true);
    }
    applyPartyDefaults();
    updateBankCheck();
    updateRenameButton();
  }

  const OCR_VELDEN = [
    "inkoop-leverancier", "inkoop-fnr", "inkoop-datum", "inkoop-bedrag", "inkoop-btw",
  ];

  /**
   * Foto-bon laten lezen (OCR, lokaal in de browser) en de lege velden vullen —
   * zelfde herkenning als bij het fotograferen. Loopt op de achtergrond: het
   * duurt even en het voorbeeld staat al in beeld.
   */
  async function leesFotoTekst(item) {
    const img = pane.ocrBron();
    if (!img) return;
    if ($("#inkoop-leverancier").value && $("#inkoop-bedrag").value) return;
    const gevuldVoor = OCR_VELDEN.filter((id) => document.getElementById(id).value).length;
    pane.notitie("🔍 Bon lezen…");
    try {
      const tekst = await global.BoekOcr.tekstUit(img);
      if (selectedFile !== item) return; // ondertussen een andere factuur gekozen
      applyExtraction(global.BoekPdf.extractInvoiceData(tekst));
      applyPartyDefaults();
      updateRenameButton();
      const gevuld = OCR_VELDEN.filter((id) => document.getElementById(id).value).length - gevuldVoor;
      pane.notitie(
        gevuld
          ? `🔍 ${gevuld} gegeven${gevuld === 1 ? "" : "s"} uit de bon gelezen — controleer even.`
          : ""
      );
    } catch (_) {
      pane.notitie(""); // zonder verbinding of leesbare tekst: gewoon handmatig
    }
  }

  function deselectFile() {
    selectedFile = null;
    filenameParsed = null;
    pane.verberg();
    $("#btn-inkoop-boek-move").classList.add("hidden");
    $("#btn-inkoop-rename").classList.add("hidden");
    renderFiles();
  }

  function fillIfEmpty(id, value) {
    const el = document.getElementById(id);
    if (el && !el.value && value) el.value = value;
  }

  function applyExtraction(ex) {
    fillIfEmpty("inkoop-leverancier", ex.bedrijf);
    fillIfEmpty("inkoop-fnr", ex.factuurnummer);
    fillIfEmpty("inkoop-datum", ex.datum);
    if (!$("#inkoop-bedrag").value && ex.bedrag != null) {
      $("#inkoop-bedrag").value = M().fmtAmountInput(ex.bedrag);
    }
    if (!$("#inkoop-btw").value && ex.btw != null) $("#inkoop-btw").value = String(ex.btw);
    if (!$("#inkoop-land").value && ex.type) $("#inkoop-land").value = M().normalizeLand(ex.type);
    updateBankCheck();
  }

  /**
   * Excel-historie vult lege velden aan. Voor een bekende leverancier zijn
   * BTW%, land en BTW-verlegd leidend boven wat uit de PDF is geraden — zelfde
   * regel als de XLOOKUP-formules in het werkboek, en ze bepalen je aangifte.
   */
  function applyPartyDefaults() {
    const partij = $("#inkoop-leverancier").value.trim();
    if (!partij) return;
    const d = M().partyDefaults(intel(), partij);
    if (d.btw != null && !btwBedragAan()) $("#inkoop-btw").value = String(d.btw).replace(/\.0$/, "");
    if (d.land) $("#inkoop-land").value = M().normalizeLand(d.land);
    if (!$("#inkoop-categorie").value && d.categorie) $("#inkoop-categorie").value = d.categorie;
    if (!$("#inkoop-project").value && d.project) $("#inkoop-project").value = d.project;
    if (!$("#inkoop-omschrijving").value && d.omschrijving) $("#inkoop-omschrijving").value = d.omschrijving;
    if (d.verlegd !== undefined) $("#inkoop-verlegd").checked = d.verlegd === true;
    if (!$("#inkoop-valuta").value && d.valuta) {
      $("#inkoop-valuta").value = d.valuta;
      $("#inkoop-valuta-wrap").classList.remove("hidden");
    }
    if (!$("#inkoop-koers").value && d.wisselkoers) $("#inkoop-koers").value = d.wisselkoers;
  }

  // === BTW-bedrag in plaats van een percentage ===
  // Zeldzaam (invoerkosten van een koerier bijvoorbeeld), dus standaard dicht.
  // Het werkboek rekent met het percentage in kolom K, dus zetten we het bedrag
  // om naar het percentage dat er precies bij hoort.

  function btwBedragAan() {
    return !$("#inkoop-btw-bedrag-wrap").classList.contains("hidden");
  }

  let btwPercVoorBedrag = ""; // percentage van vóór het uitklappen, om terug te zetten

  function zetBtwBedragAan(aan, bedragInvullen = true) {
    if (aan && !btwBedragAan()) btwPercVoorBedrag = $("#inkoop-btw").value;
    $("#inkoop-btw-bedrag-wrap").classList.toggle("hidden", !aan);
    $("#btn-inkoop-btw-bedrag").textContent = aan
      ? "BTW-bedrag invullen ▴"
      : "BTW-bedrag invullen ▾";
    if (aan && bedragInvullen && !$("#inkoop-btw-bedrag").value) {
      // Wat er nu uit het percentage rolt als startpunt, zodat je ziet wat je aanpast.
      const nu = M().btwBedragVanPercentage(
        M().parseUserAmount($("#inkoop-bedrag").value),
        M().parseUserAmount($("#inkoop-btw").value.replace("%", ""))
      );
      if (nu != null) $("#inkoop-btw-bedrag").value = M().fmtAmountInput(nu);
    }
    if (!aan) {
      $("#inkoop-btw-bedrag").value = "";
      // Dichtklappen = toch met het percentage werken; dat van vóór terug.
      $("#inkoop-btw").value = btwPercVoorBedrag;
      btwPercVoorBedrag = "";
      $("#inkoop-btw-bedrag-info").textContent =
        "Voor facturen zonder vast percentage (invoerkosten, deels belast). Het percentage rekenen we er zelf bij.";
    }
    updateBtwBedrag();
  }

  /** Percentage volgt het ingevulde BTW-bedrag; het %-veld is dan alleen-lezen. */
  function updateBtwBedrag() {
    const veld = $("#inkoop-btw");
    const aan = btwBedragAan();
    const totaal = M().parseUserAmount($("#inkoop-bedrag").value);
    const bedrag = aan ? M().parseUserAmount($("#inkoop-btw-bedrag").value) : null;
    const perc = M().btwPercentageVanBedrag(totaal, bedrag);
    veld.readOnly = aan && bedrag != null && perc != null;
    veld.classList.toggle("veld-afgeleid", veld.readOnly);
    if (!aan || bedrag == null) return;
    const info = $("#inkoop-btw-bedrag-info");
    if (perc == null) {
      info.textContent = "Vul eerst het bedrag incl. BTW in.";
      return;
    }
    veld.value = String(Math.round(perc * 100) / 100).replace(".", ",");
    info.textContent =
      `= ${M().fmtEur(totaal - bedrag)} excl. + ${M().fmtEur(bedrag)} BTW ` +
      `(${String(Math.round(perc * 100) / 100).replace(".", ",")}%)`;
  }

  // === Vreemde valuta: het derde veld volgt uit de andere twee ===
  const VALUTA_VELDEN = { orig: "inkoop-bedrag-orig", koers: "inkoop-koers", eur: "inkoop-bedrag" };

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
    if ($("#inkoop-valuta-wrap").classList.contains("hidden")) return;
    const patch = M().valutaAanvullen(bron, valutaWaarden());
    for (const [veld, waarde] of Object.entries(patch)) {
      document.getElementById(VALUTA_VELDEN[veld]).value =
        veld === "koers" ? M().fmtKoers(waarde) : M().fmtAmountInput(waarde);
    }
    if (patch.eur !== undefined) {
      updateBankCheck();
      updateAfschrijfPreview();
      updateBtwBedrag();
    }
    updateValutaInfo();
  }

  function updateValutaInfo() {
    const munt = $("#inkoop-valuta").value.trim().toUpperCase() || "eenheid";
    $("#inkoop-koers-label").textContent = `Wisselkoers (€ per 1 ${munt})`;
    const { orig, koers, eur } = valutaWaarden();
    $("#inkoop-valuta-info").textContent =
      orig != null && koers != null && eur != null
        ? `${M().fmtAmountInput(orig)} ${munt} × ${M().fmtKoers(koers)} = ${M().fmtEur(eur)}`
        : "Vul er twee in, dan rekent de app de derde uit.";
  }

  // === Bankregel-koppeling ===
  function updateBankCheck() {
    const bedrag = M().parseUserAmount($("#inkoop-bedrag").value);
    const datumIso = $("#inkoop-datum").value;
    bankMatchRows = [];
    let matches = [];
    if (bedrag != null && datumIso) {
      matches = M().bankMatchesForInvoice(
        App().state.bankRows, bedrag, datumIso, false, App().state.matchDagen
      );
      bankMatchRows = matches.map((r) => r.excelRow);
    }
    for (const r of prefillBankRows) {
      if (!bankMatchRows.includes(r)) bankMatchRows.push(r);
    }
    const row = $("#inkoop-bank-check-row");
    row.classList.toggle("hidden", bankMatchRows.length === 0);
    if (bankMatchRows.length) {
      const eerste = matches[0];
      $("#inkoop-bank-check-label").textContent =
        `Bankregel(s) afvinken (${bankMatchRows.length}×` +
        (eerste ? `, o.a. ${eerste.datumStr} ${M().fmtEur(eerste.uit ?? eerste.in)}` : "") + ")";
    }
  }

  function updateRenameButton() {
    const btn = $("#btn-inkoop-rename");
    if (!selectedFile || !filenameParsed) {
      btn.classList.add("hidden");
      return;
    }
    const changed =
      ($("#inkoop-datum").value || "") !== (filenameParsed.datumIso || "") ||
      $("#inkoop-leverancier").value.trim() !== (filenameParsed.bedrijf || "") ||
      $("#inkoop-fnr").value.trim() !== (filenameParsed.factuurnummer || "");
    btn.classList.toggle("hidden", !changed);
  }

  // === Formulier ===
  function readFields() {
    return {
      datumIso: $("#inkoop-datum").value,
      leverancier: $("#inkoop-leverancier").value.trim(),
      omschrijving: $("#inkoop-omschrijving").value.trim(),
      factuurnummer: $("#inkoop-fnr").value.trim(),
      bedrag: M().parseUserAmount($("#inkoop-bedrag").value),
      btw: leesBtw(),
      verlegd: $("#inkoop-verlegd").checked,
      afschrijving: $("#inkoop-afschrijving").checked,
      afschrijvingJaren: Math.min(10, Math.max(2, parseInt($("#inkoop-afschrijf-jaren").value, 10) || 5)),
      categorie: $("#inkoop-categorie").value.trim(),
      project: $("#inkoop-project").value.trim(),
      opmerking: $("#inkoop-opmerking").value.trim(),
      land: $("#inkoop-land").value,
      bedragOrig: M().parseUserAmount($("#inkoop-bedrag-orig").value),
      valuta: $("#inkoop-valuta").value.trim(),
      wisselkoers: $("#inkoop-koers").value.trim(),
    };
  }

  /**
   * BTW-percentage voor het werkboek: bij een handmatig BTW-bedrag het exacte
   * percentage dat daarbij hoort, anders gewoon wat er in het %-veld staat.
   */
  function leesBtw() {
    if (btwBedragAan()) {
      const perc = M().btwPercentageVanBedrag(
        M().parseUserAmount($("#inkoop-bedrag").value),
        M().parseUserAmount($("#inkoop-btw-bedrag").value)
      );
      if (perc != null) return perc;
    }
    const ruw = $("#inkoop-btw").value.trim();
    return ruw === "" ? null : M().parseUserAmount(ruw.replace("%", ""));
  }

  /** Alleen de velden leegmaken (gebruikt bij het selecteren van een nieuwe factuur). */
  function clearFormFields() {
    for (const id of [
      "inkoop-leverancier", "inkoop-omschrijving", "inkoop-fnr", "inkoop-bedrag",
      "inkoop-btw", "inkoop-categorie", "inkoop-project", "inkoop-opmerking",
      "inkoop-bedrag-orig", "inkoop-valuta", "inkoop-koers",
    ]) {
      document.getElementById(id).value = "";
    }
    $("#inkoop-datum").value = M().todayIso();
    $("#inkoop-land").value = "";
    $("#inkoop-verlegd").checked = false;
    $("#inkoop-afschrijving").checked = false;
    $("#inkoop-afschrijf-jaren").value = "5";
    $("#inkoop-afschrijf-wrap").classList.add("hidden");
    $("#inkoop-bank-check").checked = false;
    $("#inkoop-valuta-wrap").classList.add("hidden");
    zetBtwBedragAan(false);
    updateValutaInfo();
    prefillBankRows = [];
  }

  function clearForm() {
    clearFormFields();
    setEditRow(null);
    updateBankCheck();
    updateRenameButton();
  }

  /** Bewerkmodus aan/uit: knoptekst en titel volgen de stand. */
  function setEditRow(row) {
    editRow = row;
    updateAfschrijfPreview();
    $("#inkoop-form-title").textContent = row ? `Regel bewerken (rij ${row})` : "Factuur inboeken";
    $("#btn-inkoop-boek").textContent = row ? "Bijwerken" : "Inboeken";
    $("#btn-inkoop-boek-move").classList.toggle("hidden", !!row || !selectedFile);
    $("#btn-inkoop-cancel-edit").classList.toggle("hidden", !row);
    // Bewerken verlaten zonder gekozen bestand → voorbeeld weg.
    if (!row && !selectedFile) pane.verberg();
  }

  function startEdit(h) {
    clearFormFields();
    // Bewerken staat los van een factuur uit de te-verwerken-lijst.
    selectedFile = null;
    filenameParsed = null;
    renderFiles();
    $("#inkoop-datum").value = h.datum ? M().dateToIso(h.datum) : M().todayIso();
    $("#inkoop-leverancier").value = h.partij || "";
    $("#inkoop-omschrijving").value = h.omschrijving || "";
    $("#inkoop-fnr").value = h.factuurnummer || "";
    $("#inkoop-bedrag").value = h.bedrag != null ? M().fmtAmountInput(h.bedrag) : "";
    $("#inkoop-btw").value = h.btw != null ? String(h.btw).replace(/\.0$/, "") : "";
    // Krom percentage = destijds een handmatig BTW-bedrag; zo weer te zien en te wijzigen.
    if (M().isHandmatigBtw(h.btw)) {
      const bedrag = h.btwBedrag != null ? h.btwBedrag : M().btwBedragVanPercentage(h.bedrag, h.btw);
      zetBtwBedragAan(true, false);
      if (bedrag != null) $("#inkoop-btw-bedrag").value = M().fmtAmountInput(bedrag);
      updateBtwBedrag();
    }
    $("#inkoop-land").value = M().normalizeLand(h.land);
    $("#inkoop-categorie").value = h.categorie || "";
    $("#inkoop-project").value = h.project || "";
    $("#inkoop-opmerking").value = h.opmerking || "";
    $("#inkoop-verlegd").checked = !!h.verlegd;
    $("#inkoop-afschrijving").checked = !!h.afschrijving;
    if (h.valuta || h.wisselkoers || h.bedragOrig != null) {
      $("#inkoop-valuta-wrap").classList.remove("hidden");
      $("#inkoop-valuta").value = h.valuta || "";
      $("#inkoop-koers").value = h.wisselkoers || "";
      $("#inkoop-bedrag-orig").value = h.bedragOrig != null ? M().fmtAmountInput(h.bedragOrig) : "";
    }
    setEditRow(h.excelRow);
    updateBankCheck();
    App().haptic(15);
    $("#inkoop-form-title").scrollIntoView({ behavior: "smooth", block: "start" });
    toonBijbehorendeFactuur(h);
  }

  /** Bijbehorend bestand opzoeken en meteen tonen, net als bij het inboeken. */
  async function toonBijbehorendeFactuur(h) {
    pane.verberg();
    pane.melding("🔎 Bijbehorende factuur zoeken…");
    const gevonden = await global.BoekDocFinder.findFor("inkoop", h);
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
      { kind: "inkoop_delete", excelRow: h.excelRow },
      { successMsg: "Regel verwijderd" }
    );
  }

  /**
   * Live schema onder het afschrijving-vinkje: hoeveel jaarregels er automatisch
   * bijgeboekt worden. Alleen bij nieuw inboeken — bij bewerken bestaan ze al.
   */
  function updateAfschrijfPreview() {
    const wrap = $("#inkoop-afschrijf-wrap");
    const aan = $("#inkoop-afschrijving").checked && !editRow;
    wrap.classList.toggle("hidden", !aan);
    if (!aan) return;
    const f = readFields();
    const p = $("#inkoop-afschrijf-preview");
    const regels = M().afschrijvingsRegels(f, f.afschrijvingJaren);
    if (!regels.length) {
      p.textContent = "Vul bedrag en datum in om het schema te zien.";
      return;
    }
    const eerste = regels[0];
    const laatste = regels[regels.length - 1];
    const afwijkend =
      laatste.bedrag !== eerste.bedrag ? `, laatste ${M().fmtEur(laatste.bedrag)}` : "";
    p.textContent = `✓ Boekt automatisch ${regels.length} jaarregels van ${M().fmtEur(eerste.bedrag)}${afwijkend} (31-12-${eerste.datumIso.slice(0, 4)} t/m 31-12-${laatste.datumIso.slice(0, 4)}), netto excl. BTW, tot boekwaarde €0.`;
  }

  async function boek(move) {
    const f = readFields();
    if (!f.leverancier) return App().showToast("Vul de leverancier in.", true);
    if (f.bedrag == null) return App().showToast("Vul een geldig bedrag incl. BTW in.", true);
    if (!f.datumIso) return App().showToast("Vul een geldige factuurdatum in.", true);

    if (editRow) {
      const row = editRow;
      clearForm();
      await App().persistMutation(
        { kind: "inkoop_update", excelRow: row, fields: f },
        { successMsg: "Regel bijgewerkt" }
      );
      return;
    }

    const dup = M().findDuplicate(intel(), {
      partij: f.leverancier,
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

    const afvinken = $("#inkoop-bank-check").checked ? [...bankMatchRows] : [];
    const fileToMove = move && selectedFile ? selectedFile : null;
    clearForm();
    if (fileToMove) deselectFile();

    const nJaar = f.afschrijving ? f.afschrijvingJaren : 0;
    const ok = await App().persistMutation(
      { kind: "inkoop_add", fields: f, bankRows: afvinken },
      {
        successMsg: nJaar
          ? `Ingeboekt + ${nJaar} afschrijvingsregels${move ? " + verplaatst" : ""}`
          : move
            ? "Ingeboekt + factuur verplaatst"
            : "Ingeboekt in inkoopboek",
      }
    );
    if (!ok) return;
    if (fileToMove) {
      await App().persistMutation({
        kind: "file_move",
        itemId: fileToMove.id,
        destFolder: global.BOEK_CONFIG.graph.folders.inkoopVerwerkt,
      });
      App().refreshQuiet();
    }
  }

  async function renameFile() {
    if (!selectedFile) return;
    const ext = selectedFile.folder ? "" : selectedFile.name.match(/\.[^.]+$/)?.[0] || "";
    const newName = M().buildInkoopFilename(
      $("#inkoop-datum").value,
      $("#inkoop-leverancier").value,
      $("#inkoop-fnr").value,
      ext
    );
    const ok = await App().showConfirm(`Hernoemen naar:\n${newName}?`, "Hernoemen", "Annuleren");
    if (!ok) return;
    const item = selectedFile;
    const done = await App().persistMutation(
      { kind: "file_rename", itemId: item.id, newName },
      { successMsg: "Bestand hernoemd" }
    );
    if (done) {
      filenameParsed = M().parseInkoopFilename(newName);
      $("#inkoop-preview-name").textContent = newName;
      selectedFile = { ...item, name: newName };
      updateRenameButton();
      App().refreshQuiet();
    }
  }

  // === Historie ===
  let kopIndex = new Map();

  function renderHistory() {
    const st = App().state;
    kopIndex = App().koppelIndex();
    const list = $("#inkoop-hist-list");
    const q = $("#inkoop-hist-search").value.trim().toLowerCase();
    list.innerHTML = "";
    let shown = 0;
    for (const h of intel().history) {
      if (q && !`${h.partij} ${h.omschrijving} ${h.categorie} ${h.project} ${h.factuurnummer || ""}`.toLowerCase().includes(q)) continue;
      const gekoppeld = kopIndex.has(`inkoop|${h.excelRow}`);
      const li = document.createElement("li");
      li.className = "boek-item" + (editRow === h.excelRow ? " selected" : "");
      const nr = h.factuurnummer ? `${escapeHtml(h.factuurnummer)} · ` : "";
      li.innerHTML = `
        <div class="bi-head">
          <span class="bi-title">${escapeHtml(h.partij)}</span>
          <span class="bi-amount uit">${gekoppeld ? "🔗 " : ""}${M().fmtEur(h.bedrag)}</span>
        </div>
        <div class="bi-sub"><span>${nr}${escapeHtml(h.omschrijving).slice(0, 60)}</span><span>${h.datumStr}</span></div>
        ${App().rowActionsHtml()}`;
      li.addEventListener("click", (ev) => {
        if (ev.target.closest("button")) return;
        applyHistory(h);
      });
      if (gekoppeld) {
        // Tik op 🔗 → koppelingen van deze factuur bekijken/ontkoppelen/aanvullen
        li.querySelector(".bi-amount").addEventListener("click", (ev) => {
          ev.stopPropagation();
          global.BoekUiOverzicht?.openFactuurKoppel({ ...h, boek: "inkoop" });
        });
      }
      li.querySelector('[data-act="edit"]').addEventListener("click", () => startEdit(h));
      li.querySelector('[data-act="del"]').addEventListener("click", () => deleteRow(h));
      App().bindSwipe(li, { onEdit: () => startEdit(h), onDelete: () => deleteRow(h) });
      list.appendChild(li);
      if (++shown >= 20) break;
    }
  }

  /** Historie-regel overnemen: bij geselecteerde factuur alleen lege velden, anders alles. */
  function applyHistory(h) {
    const force = !selectedFile;
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el && val != null && val !== "" && (force || !el.value)) el.value = String(val);
    };
    set("inkoop-leverancier", h.partij);
    set("inkoop-omschrijving", h.omschrijving);
    set("inkoop-categorie", h.categorie);
    set("inkoop-project", h.project);
    set("inkoop-btw", h.btw != null ? String(h.btw).replace(/\.0$/, "") : "");
    set("inkoop-opmerking", h.opmerking);
    if (force || !$("#inkoop-land").value) $("#inkoop-land").value = M().normalizeLand(h.land);
    if (force && h.bedrag != null) $("#inkoop-bedrag").value = M().fmtAmountInput(h.bedrag);
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
    if (p.datumIso) $("#inkoop-datum").value = p.datumIso;
    if (p.omschrijving) $("#inkoop-omschrijving").value = p.omschrijving;
    if (p.bedrag != null) $("#inkoop-bedrag").value = M().fmtAmountInput(p.bedrag);
    prefillBankRows = p.bankRows || [];
    updateBankCheck();
    if (prefillBankRows.length) $("#inkoop-bank-check").checked = true;
  }

  function init() {
    pane = global.BoekPreviewPane.create(
      "inkoop",
      () => global.BOEK_CONFIG.graph.folders.inkoopNieuw
    );
    $("#inkoop-datum").value = M().todayIso();
    App().bindDateSteppers("inkoop-datum", "btn-inkoop-date-prev", "btn-inkoop-date-next");
    global.BoekCombo.createCombo("inkoop-leverancier", null, () => intel().partijen, applyPartyDefaults, {
      title: "Leverancier",
    });
    global.BoekCombo.createCombo(
      "inkoop-categorie",
      null,
      () => {
        const st = App().state;
        const set = new Set([...st.inkoopKeuzes, ...intel().categorieen]);
        return [...set];
      },
      null,
      { title: "Categorie" }
    );
    global.BoekCombo.createCombo("inkoop-project", null, () => intel().projecten, null, {
      title: "Project",
    });
    $("#inkoop-leverancier").addEventListener("change", applyPartyDefaults);
    $("#btn-inkoop-valuta-toggle").addEventListener("click", () => {
      $("#inkoop-valuta-wrap").classList.toggle("hidden");
      updateValutaInfo();
    });
    $("#btn-inkoop-btw-bedrag").addEventListener("click", () => zetBtwBedragAan(!btwBedragAan()));
    $("#inkoop-btw-bedrag").addEventListener("input", updateBtwBedrag);
    $("#inkoop-bedrag-orig").addEventListener("input", () => valutaOmrekenen("orig"));
    $("#inkoop-koers").addEventListener("input", () => valutaOmrekenen("koers"));
    $("#inkoop-bedrag").addEventListener("input", () => valutaOmrekenen("eur"));
    $("#inkoop-valuta").addEventListener("input", updateValutaInfo);
    $("#btn-inkoop-boek").addEventListener("click", () => boek(false));
    $("#btn-inkoop-boek-move").addEventListener("click", () => boek(true));
    $("#btn-inkoop-rename").addEventListener("click", renameFile);
    $("#btn-inkoop-clear").addEventListener("click", () => {
      clearForm();
      deselectFile();
    });
    $("#btn-inkoop-cancel-edit").addEventListener("click", clearForm);
    $("#inkoop-bedrag").addEventListener("input", updateBtwBedrag);
    for (const id of ["inkoop-bedrag", "inkoop-datum"]) {
      document.getElementById(id).addEventListener("input", updateBankCheck);
      document.getElementById(id).addEventListener("change", updateBankCheck);
    }
    $("#inkoop-afschrijving").addEventListener("change", updateAfschrijfPreview);
    for (const id of ["inkoop-afschrijf-jaren", "inkoop-bedrag", "inkoop-btw", "inkoop-datum", "inkoop-omschrijving"]) {
      document.getElementById(id).addEventListener("input", updateAfschrijfPreview);
    }
    for (const id of ["inkoop-datum", "inkoop-leverancier", "inkoop-fnr"]) {
      document.getElementById(id).addEventListener("input", updateRenameButton);
      document.getElementById(id).addEventListener("change", updateRenameButton);
    }
    $("#inkoop-hist-search").addEventListener("input", renderHistory);
  }

  App().registerTab("inkoop", { init, render });
  global.BoekUiInkoop = { prefill, render };
})(window);
