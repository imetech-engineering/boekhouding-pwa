/**
 * Verkoop-tab: facturen uit OneDrive, PDF-preview + extractie, inboeken, verplaatsen.
 */
(function (global) {
  const App = () => global.BoekApp;
  const M = () => global.BoekModel;
  const $ = (s) => document.querySelector(s);

  let selectedFile = null;
  let pdfDoc = null;
  let pdfPageNum = 1;
  let bankMatchRows = [];
  let prefillBankRows = [];

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
    pdfDoc = null;
    pdfPageNum = 1;
    renderFiles();
    $("#verkoop-preview-card").classList.remove("hidden");
    $("#verkoop-preview-name").textContent = item.name;
    $("#btn-verkoop-boek-move").classList.remove("hidden");
    $("#verkoop-img-preview").classList.add("hidden");
    $("#verkoop-pdf-canvas").classList.remove("hidden");
    hidePdfNav();

    // Vers formulier voor deze factuur, dan vullen: bestandsnaam → PDF → Excel-historie.
    clearFormFields();

    // FAxxxx_(NL|EU|buitenEU)_Bedrijf.pdf — nummer, klant en land uit de naam
    const parsed = M().parseVerkoopFilename(item.name);
    if (parsed.factuurnummer) $("#verkoop-fnr").value = parsed.factuurnummer;
    if (parsed.bedrijf) $("#verkoop-klant").value = parsed.bedrijf;
    if (parsed.type) $("#verkoop-land").value = parsed.type;

    try {
      const token = await App().ensureLoggedIn();
      const lower = item.name.toLowerCase();
      if (lower.endsWith(".pdf")) {
        const bytes = await global.BoekGraph.downloadBytes(item.id, token);
        pdfDoc = await global.BoekPdf.loadPdf(bytes);
        await renderPdfPage();
        const text = await global.BoekPdf.extractText(pdfDoc);
        const ex = global.BoekPdf.extractInvoiceData(text);
        // Datum en bedrag staan bij verkoop in de factuur zelf
        if (ex.datum) $("#verkoop-datum").value = ex.datum;
        if (ex.bedrag != null) $("#verkoop-bedrag").value = M().fmtAmountInput(ex.bedrag);
        if (ex.btw != null) $("#verkoop-btw").value = String(ex.btw);
      } else if (!item.folder) {
        const url = await global.BoekGraph.downloadObjectUrl(item.id, token);
        const img = $("#verkoop-img-preview");
        img.src = url;
        img.classList.remove("hidden");
        $("#verkoop-pdf-canvas").classList.add("hidden");
      }
    } catch (e) {
      App().showToast(`Voorbeeld laden mislukt: ${e.message || e}`, true);
    }
    applyPartyDefaults();
    updateBankCheck();
  }

  function deselectFile() {
    selectedFile = null;
    pdfDoc = null;
    $("#verkoop-preview-card").classList.add("hidden");
    $("#btn-verkoop-boek-move").classList.add("hidden");
    renderFiles();
  }

  async function renderPdfPage() {
    if (!pdfDoc) return;
    const canvas = $("#verkoop-pdf-canvas");
    await global.BoekPdf.renderPage(pdfDoc, pdfPageNum, canvas, canvas.parentElement.clientWidth || 600);
    const multi = pdfDoc.numPages > 1;
    $("#btn-verkoop-page-prev").classList.toggle("hidden", !multi);
    $("#btn-verkoop-page-next").classList.toggle("hidden", !multi);
    const label = $("#verkoop-page-label");
    label.classList.toggle("hidden", !multi);
    label.textContent = `${pdfPageNum}/${pdfDoc.numPages}`;
  }

  function hidePdfNav() {
    $("#btn-verkoop-page-prev").classList.add("hidden");
    $("#btn-verkoop-page-next").classList.add("hidden");
    $("#verkoop-page-label").classList.add("hidden");
  }

  function applyPartyDefaults() {
    const partij = $("#verkoop-klant").value.trim();
    if (!partij) return;
    const d = M().partyDefaults(intel(), partij);
    if (!$("#verkoop-btw").value && d.btw != null) $("#verkoop-btw").value = String(d.btw).replace(/\.0$/, "");
    if (!$("#verkoop-land").value && d.land) $("#verkoop-land").value = M().normalizeLand(d.land);
    if (!$("#verkoop-categorie").value && d.categorie) $("#verkoop-categorie").value = d.categorie;
    if (!$("#verkoop-valuta").value && d.valuta) {
      $("#verkoop-valuta").value = d.valuta;
      $("#verkoop-valuta-wrap").classList.remove("hidden");
    }
    if (!$("#verkoop-koers").value && d.wisselkoers) $("#verkoop-koers").value = d.wisselkoers;
  }

  function updateBankCheck() {
    const bedrag = M().parseUserAmount($("#verkoop-bedrag").value);
    const datumIso = $("#verkoop-datum").value;
    bankMatchRows = [];
    let matches = [];
    if (bedrag != null && datumIso) {
      matches = M().bankMatchesForInvoice(App().state.bankRows, bedrag, datumIso, true);
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
    prefillBankRows = [];
  }

  function clearForm() {
    clearFormFields();
    updateBankCheck();
  }

  async function boek(move) {
    const f = readFields();
    if (!f.klant) return App().showToast("Vul de klant in.", true);
    if (f.bedrag == null) return App().showToast("Vul een geldig bedrag incl. BTW in.", true);
    if (!f.datumIso) return App().showToast("Vul een geldige factuurdatum in.", true);

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
      { kind: "verkoop_add", fields: f },
      { successMsg: move ? "Ingeboekt + factuur verplaatst" : "Ingeboekt in verkoopboek" }
    );
    if (!ok) return;
    if (afvinken.length) {
      await App().persistMutation({ kind: "bank_ingeboekt", rows: afvinken, value: true });
    }
    if (fileToMove) {
      await App().persistMutation({
        kind: "file_move",
        itemId: fileToMove.id,
        destFolder: global.BOEK_CONFIG.graph.folders.verkoopVerwerkt,
      });
      App().refreshQuiet();
    }
  }

  function renderHistory() {
    const list = $("#verkoop-hist-list");
    const q = $("#verkoop-hist-search").value.trim().toLowerCase();
    list.innerHTML = "";
    let shown = 0;
    for (const h of intel().history) {
      if (q && !`${h.partij} ${h.omschrijving} ${h.categorie}`.toLowerCase().includes(q)) continue;
      const li = document.createElement("li");
      li.className = "boek-item";
      li.innerHTML = `
        <div class="bi-head">
          <span class="bi-title">${escapeHtml(h.partij)}</span>
          <span class="bi-amount in">${M().fmtEur(h.bedrag)}</span>
        </div>
        <div class="bi-sub"><span>${escapeHtml(h.omschrijving).slice(0, 70)}</span><span>${h.factuurnummer || ""} · ${h.datumStr}</span></div>`;
      li.addEventListener("click", () => applyHistory(h));
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
    $("#verkoop-datum").value = M().todayIso();
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
    });
    $("#btn-verkoop-boek").addEventListener("click", () => boek(false));
    $("#btn-verkoop-boek-move").addEventListener("click", () => boek(true));
    $("#btn-verkoop-clear").addEventListener("click", () => {
      clearForm();
      deselectFile();
    });
    $("#btn-verkoop-deselect").addEventListener("click", deselectFile);
    $("#btn-verkoop-page-prev").addEventListener("click", () => {
      if (pdfDoc && pdfPageNum > 1) {
        pdfPageNum--;
        renderPdfPage();
      }
    });
    $("#btn-verkoop-page-next").addEventListener("click", () => {
      if (pdfDoc && pdfPageNum < pdfDoc.numPages) {
        pdfPageNum++;
        renderPdfPage();
      }
    });
    for (const id of ["verkoop-bedrag", "verkoop-datum"]) {
      document.getElementById(id).addEventListener("input", updateBankCheck);
      document.getElementById(id).addEventListener("change", updateBankCheck);
    }
    $("#verkoop-hist-search").addEventListener("input", renderHistory);
  }

  App().registerTab("verkoop", { init, render });
  global.BoekUiVerkoop = { prefill, render };
})(window);
