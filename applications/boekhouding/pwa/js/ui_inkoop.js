/**
 * Inkoop-tab: facturen uit OneDrive, PDF-preview + extractie, inboeken, verplaatsen.
 */
(function (global) {
  const App = () => global.BoekApp;
  const M = () => global.BoekModel;
  const $ = (s) => document.querySelector(s);

  let selectedFile = null;
  let filenameParsed = null;
  let pdfDoc = null;
  let pdfPageNum = 1;
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
    pdfDoc = null;
    pdfPageNum = 1;
    renderFiles();
    $("#inkoop-preview-card").classList.remove("hidden");
    $("#inkoop-preview-name").textContent = item.name;
    $("#btn-inkoop-boek-move").classList.remove("hidden");
    $("#inkoop-img-preview").classList.add("hidden");
    $("#inkoop-pdf-canvas").classList.remove("hidden");
    hidePdfNav();

    // Vers formulier voor deze factuur, dan vullen: bestandsnaam → PDF → Excel-historie.
    clearFormFields();
    setEditRow(null);

    // 1. Bestandsnaam parsen (yymmdd bedrijf factuurnummer) — datum uit de naam is leidend
    filenameParsed = M().parseInkoopFilename(item.name);
    if (filenameParsed.datumIso) $("#inkoop-datum").value = filenameParsed.datumIso;
    if (filenameParsed.bedrijf) $("#inkoop-leverancier").value = filenameParsed.bedrijf;
    if (filenameParsed.factuurnummer) $("#inkoop-fnr").value = filenameParsed.factuurnummer;

    // 2. Bestand ophalen: map → eerste bestand erin; afbeelding → tonen; PDF → preview + extractie
    try {
      const token = await App().ensureLoggedIn();
      let fileItem = item;
      if (item.folder) {
        const children = await global.BoekGraph.listFolder(
          `${global.BOEK_CONFIG.graph.folders.inkoopNieuw}/${item.name}`,
          token
        );
        fileItem = children.find((c) => c.file) || null;
        if (!fileItem) return;
      }
      const lower = fileItem.name.toLowerCase();
      if (lower.endsWith(".pdf")) {
        const bytes = await global.BoekGraph.downloadBytes(fileItem.id, token);
        pdfDoc = await global.BoekPdf.loadPdf(bytes);
        await renderPdfPage();
        const text = await global.BoekPdf.extractText(pdfDoc);
        applyExtraction(global.BoekPdf.extractInvoiceData(text));
      } else {
        const url = await global.BoekGraph.downloadObjectUrl(fileItem.id, token);
        const img = $("#inkoop-img-preview");
        img.src = url;
        img.classList.remove("hidden");
        $("#inkoop-pdf-canvas").classList.add("hidden");
      }
    } catch (e) {
      App().showToast(`Voorbeeld laden mislukt: ${e.message || e}`, true);
    }
    applyPartyDefaults();
    updateBankCheck();
    updateRenameButton();
  }

  function deselectFile() {
    selectedFile = null;
    filenameParsed = null;
    pdfDoc = null;
    $("#inkoop-preview-card").classList.add("hidden");
    $("#btn-inkoop-boek-move").classList.add("hidden");
    $("#btn-inkoop-rename").classList.add("hidden");
    renderFiles();
  }

  async function renderPdfPage() {
    if (!pdfDoc) return;
    const canvas = $("#inkoop-pdf-canvas");
    await global.BoekPdf.renderPage(pdfDoc, pdfPageNum, canvas, canvas.parentElement.clientWidth || 600);
    const multi = pdfDoc.numPages > 1;
    $("#btn-inkoop-page-prev").classList.toggle("hidden", !multi);
    $("#btn-inkoop-page-next").classList.toggle("hidden", !multi);
    const label = $("#inkoop-page-label");
    label.classList.toggle("hidden", !multi);
    label.textContent = `${pdfPageNum}/${pdfDoc.numPages}`;
  }

  function hidePdfNav() {
    $("#btn-inkoop-page-prev").classList.add("hidden");
    $("#btn-inkoop-page-next").classList.add("hidden");
    $("#inkoop-page-label").classList.add("hidden");
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
    if (d.btw != null) $("#inkoop-btw").value = String(d.btw).replace(/\.0$/, "");
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

  // === Bankregel-koppeling ===
  function updateBankCheck() {
    const bedrag = M().parseUserAmount($("#inkoop-bedrag").value);
    const datumIso = $("#inkoop-datum").value;
    bankMatchRows = [];
    let matches = [];
    if (bedrag != null && datumIso) {
      matches = M().bankMatchesForInvoice(App().state.bankRows, bedrag, datumIso, false);
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
      btw: $("#inkoop-btw").value.trim() === "" ? null : M().parseUserAmount($("#inkoop-btw").value.replace("%", "")),
      verlegd: $("#inkoop-verlegd").checked,
      afschrijving: $("#inkoop-afschrijving").checked,
      categorie: $("#inkoop-categorie").value.trim(),
      project: $("#inkoop-project").value.trim(),
      opmerking: $("#inkoop-opmerking").value.trim(),
      land: $("#inkoop-land").value,
      bedragOrig: M().parseUserAmount($("#inkoop-bedrag-orig").value),
      valuta: $("#inkoop-valuta").value.trim(),
      wisselkoers: $("#inkoop-koers").value.trim(),
    };
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
    $("#inkoop-bank-check").checked = false;
    $("#inkoop-valuta-wrap").classList.add("hidden");
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
    $("#inkoop-form-title").textContent = row ? `Regel bewerken (rij ${row})` : "Factuur inboeken";
    $("#btn-inkoop-boek").textContent = row ? "Bijwerken" : "Inboeken";
    $("#btn-inkoop-boek-move").classList.toggle("hidden", !!row || !selectedFile);
    $("#btn-inkoop-cancel-edit").classList.toggle("hidden", !row);
  }

  function startEdit(h) {
    clearFormFields();
    $("#inkoop-datum").value = h.datum ? M().dateToIso(h.datum) : M().todayIso();
    $("#inkoop-leverancier").value = h.partij || "";
    $("#inkoop-omschrijving").value = h.omschrijving || "";
    $("#inkoop-fnr").value = h.factuurnummer || "";
    $("#inkoop-bedrag").value = h.bedrag != null ? M().fmtAmountInput(h.bedrag) : "";
    $("#inkoop-btw").value = h.btw != null ? String(h.btw).replace(/\.0$/, "") : "";
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

    const ok = await App().persistMutation(
      { kind: "inkoop_add", fields: f },
      { successMsg: move ? "Ingeboekt + factuur verplaatst" : "Ingeboekt in inkoopboek" }
    );
    if (!ok) return;
    if (afvinken.length) {
      await App().persistMutation({ kind: "bank_ingeboekt", rows: afvinken, value: true });
    }
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
  function renderHistory() {
    const list = $("#inkoop-hist-list");
    const q = $("#inkoop-hist-search").value.trim().toLowerCase();
    list.innerHTML = "";
    let shown = 0;
    for (const h of intel().history) {
      if (q && !`${h.partij} ${h.omschrijving} ${h.categorie} ${h.project}`.toLowerCase().includes(q)) continue;
      const li = document.createElement("li");
      li.className = "boek-item" + (editRow === h.excelRow ? " selected" : "");
      li.innerHTML = `
        <div class="bi-head">
          <span class="bi-title">${escapeHtml(h.partij)}</span>
          <span class="bi-amount uit">${M().fmtEur(h.bedrag)}</span>
        </div>
        <div class="bi-sub"><span>${escapeHtml(h.omschrijving).slice(0, 70)}</span><span>${h.datumStr}</span></div>
        ${App().rowActionsHtml()}`;
      li.addEventListener("click", (ev) => {
        if (ev.target.closest("button")) return;
        applyHistory(h);
      });
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
    $("#inkoop-datum").value = M().todayIso();
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
    });
    $("#btn-inkoop-boek").addEventListener("click", () => boek(false));
    $("#btn-inkoop-boek-move").addEventListener("click", () => boek(true));
    $("#btn-inkoop-rename").addEventListener("click", renameFile);
    $("#btn-inkoop-clear").addEventListener("click", () => {
      clearForm();
      deselectFile();
    });
    $("#btn-inkoop-deselect").addEventListener("click", deselectFile);
    $("#btn-inkoop-cancel-edit").addEventListener("click", clearForm);
    $("#btn-inkoop-page-prev").addEventListener("click", () => {
      if (pdfDoc && pdfPageNum > 1) {
        pdfPageNum--;
        renderPdfPage();
      }
    });
    $("#btn-inkoop-page-next").addEventListener("click", () => {
      if (pdfDoc && pdfPageNum < pdfDoc.numPages) {
        pdfPageNum++;
        renderPdfPage();
      }
    });
    for (const id of ["inkoop-bedrag", "inkoop-datum"]) {
      document.getElementById(id).addEventListener("input", updateBankCheck);
      document.getElementById(id).addEventListener("change", updateBankCheck);
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
