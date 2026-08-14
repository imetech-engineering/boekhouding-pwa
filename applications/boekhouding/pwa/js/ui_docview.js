/**
 * Het originele factuurbestand terugvinden bij een geboekte regel en tonen.
 * Zoekt in zowel "nog te verwerken" als "verwerkt", op factuurnummer, datum en partij.
 */
(function (global) {
  const App = () => global.BoekApp;
  const M = () => global.BoekModel;
  const $ = (s) => document.querySelector(s);

  let files = []; // bestanden van het huidige document (map = meerdere pagina's)
  let fileIndex = 0;
  let pdfDoc = null;
  let pageNum = 1;

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
   * Beste match voor een geboekte regel, of null.
   * Drempel 5: alleen het factuurnummer, of datum én partij samen, is overtuigend genoeg.
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

  async function open(item) {
    const token = await App().ensureLoggedIn();
    files = [item];
    if (item.folder) {
      const kinderen = await global.BoekGraph.listFolder(`${item._folder}/${item.name}`, token);
      files = kinderen.filter((c) => c.file);
      if (!files.length) return App().showToast("Deze map bevat geen bestanden.", true);
    }
    fileIndex = 0;
    $("#doc-modal").classList.remove("hidden");
    await showFile();
  }

  async function showFile() {
    const item = files[fileIndex];
    $("#doc-title").textContent = item.name;
    $("#doc-file-nav").classList.toggle("hidden", files.length < 2);
    $("#doc-file-label").textContent = `Bestand ${fileIndex + 1}/${files.length}`;
    const canvas = $("#doc-canvas");
    const img = $("#doc-img");
    pdfDoc = null;
    pageNum = 1;
    $("#doc-status").textContent = "Laden…";
    $("#doc-status").classList.remove("hidden");
    try {
      const token = await App().ensureLoggedIn();
      if (item.name.toLowerCase().endsWith(".pdf")) {
        img.classList.add("hidden");
        canvas.classList.remove("hidden");
        const bytes = await global.BoekGraph.downloadBytes(item.id, token);
        pdfDoc = await global.BoekPdf.loadPdf(bytes);
        await renderPage();
      } else {
        canvas.classList.add("hidden");
        img.classList.remove("hidden");
        img.src = await global.BoekGraph.downloadObjectUrl(item.id, token);
        $("#doc-page-nav").classList.add("hidden");
      }
      $("#doc-status").classList.add("hidden");
    } catch (e) {
      $("#doc-status").textContent = e.message || String(e);
    }
  }

  async function renderPage() {
    if (!pdfDoc) return;
    const canvas = $("#doc-canvas");
    await global.BoekPdf.renderPage(pdfDoc, pageNum, canvas, canvas.parentElement.clientWidth || 600);
    const multi = pdfDoc.numPages > 1;
    $("#doc-page-nav").classList.toggle("hidden", !multi);
    $("#doc-page-label").textContent = `${pageNum}/${pdfDoc.numPages}`;
  }

  function close() {
    $("#doc-modal").classList.add("hidden");
    pdfDoc = null;
    files = [];
  }

  function init() {
    $("#btn-doc-close").addEventListener("click", close);
    $("#btn-doc-page-prev").addEventListener("click", () => {
      if (pdfDoc && pageNum > 1) {
        pageNum--;
        renderPage();
      }
    });
    $("#btn-doc-page-next").addEventListener("click", () => {
      if (pdfDoc && pageNum < pdfDoc.numPages) {
        pageNum++;
        renderPage();
      }
    });
    $("#btn-doc-file-prev").addEventListener("click", () => {
      if (fileIndex > 0) {
        fileIndex--;
        showFile();
      }
    });
    $("#btn-doc-file-next").addEventListener("click", () => {
      if (fileIndex < files.length - 1) {
        fileIndex++;
        showFile();
      }
    });
  }

  App().registerTab("docview", { init });
  global.BoekDocView = { findFor, open };
})(window);
