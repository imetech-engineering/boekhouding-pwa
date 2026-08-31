/**
 * Voorbeeldvenster voor een document: PDF of foto groot in beeld, met bladeren,
 * zoomen en — het belangrijkste — tekst die je kunt selecteren en kopiëren.
 * Bij een PDF komt die tekst uit het bestand zelf, bij een foto uit OCR.
 *
 * Gebruik: BoekDocPreview.open({ naam, pdf }) of ({ naam, file }) of ({ naam, imgUrl }).
 */
(function (global) {
  const App = () => global.BoekApp;
  const $ = (s) => document.querySelector(s);

  let pdfDoc = null;
  let pageNum = 1;
  let zoom = 1;
  let naam = "";
  let imgUrl = null;
  let eigenUrl = null; // zelf gemaakte object-URL: bij sluiten weer vrijgeven
  let tekstZichtbaar = false;
  let ocrGedaan = false;
  let renderToken = 0;

  function status(msg) {
    const el = $("#dv-status");
    el.textContent = msg || "";
    el.classList.toggle("hidden", !msg);
  }

  function isPdfBestand(file) {
    return (
      (file.type || "").includes("pdf") || /\.pdf$/i.test(file.name || "")
    );
  }

  /**
   * @param {{naam?:string, pdf?:object, file?:File|Blob, imgUrl?:string, canvas?:HTMLCanvasElement, pageNum?:number}} opts
   */
  async function open(opts) {
    sluitStil();
    naam = opts.naam || opts.file?.name || "";
    pageNum = opts.pageNum || 1;
    zoom = 1;
    tekstZichtbaar = false;
    ocrGedaan = false;
    $("#dv-naam").textContent = naam;
    $("#dv-text").value = "";
    $("#dv-text-panel").classList.add("hidden");
    $("#btn-dv-text").textContent = "🔤 Tekst";
    $("#doc-preview-modal").classList.remove("hidden");
    status("");

    try {
      if (opts.pdf) {
        pdfDoc = opts.pdf;
      } else if (opts.file && isPdfBestand(opts.file)) {
        status("PDF laden…");
        pdfDoc = await global.BoekPdf.loadPdf(await opts.file.arrayBuffer());
        status("");
      } else if (opts.canvas) {
        imgUrl = opts.canvas.toDataURL("image/jpeg", 0.9);
      } else if (opts.file) {
        eigenUrl = URL.createObjectURL(opts.file);
        imgUrl = eigenUrl;
      } else if (opts.imgUrl) {
        imgUrl = opts.imgUrl;
      }
      await teken();
    } catch (e) {
      App()?.showToast(`Voorbeeld openen mislukt: ${e.message || e}`, true);
      sluit();
    }
  }

  function stageBreedte() {
    const body = $("#dv-body");
    return Math.max(240, (body.clientWidth || 320) * zoom);
  }

  async function teken() {
    const stage = $("#dv-stage");
    const img = $("#dv-img");
    const canvas = $("#dv-canvas");
    const laag = $("#dv-text-layer");
    stage.style.width = `${Math.round(zoom * 100)}%`;

    if (pdfDoc) {
      img.classList.add("hidden");
      canvas.classList.remove("hidden");
      const mijn = ++renderToken;
      await global.BoekPdf.renderPage(pdfDoc, pageNum, canvas, stageBreedte());
      if (mijn !== renderToken) return; // ondertussen doorgebladerd
      try {
        await global.BoekPdf.renderTextLayer(
          pdfDoc, pageNum, laag, canvas.getBoundingClientRect().width
        );
      } catch (_) {
        laag.innerHTML = ""; // zonder tekstlaag blijft het beeld gewoon staan
      }
    } else {
      canvas.classList.add("hidden");
      laag.innerHTML = "";
      img.src = imgUrl || "";
      img.classList.remove("hidden");
    }
    tekenNav();
    if (tekstZichtbaar) await vulTekstPaneel();
  }

  function tekenNav() {
    const multi = !!pdfDoc && pdfDoc.numPages > 1;
    $("#btn-dv-prev").classList.toggle("hidden", !multi);
    $("#btn-dv-next").classList.toggle("hidden", !multi);
    const label = $("#dv-page-label");
    label.classList.toggle("hidden", !multi);
    if (multi) label.textContent = `${pageNum}/${pdfDoc.numPages}`;
  }

  async function blader(delta) {
    if (!pdfDoc) return;
    const next = pageNum + delta;
    if (next < 1 || next > pdfDoc.numPages) return;
    pageNum = next;
    ocrGedaan = false;
    await teken();
  }

  async function zetZoom(factor) {
    const nieuw = Math.min(4, Math.max(1, Math.round(zoom * factor * 10) / 10));
    if (nieuw === zoom) return;
    zoom = nieuw;
    await teken();
  }

  /** Tekst van de huidige pagina: uit de PDF, of via OCR bij een foto. */
  async function huidigeTekst() {
    if (pdfDoc) return global.BoekPdf.pageText(pdfDoc, pageNum);
    if (!imgUrl) return "";
    status("🔍 Tekst lezen uit de foto…");
    try {
      const tekst = await global.BoekOcr.tekstUit($("#dv-img"));
      status(tekst.trim() ? "" : "Geen tekst gevonden in de foto.");
      return tekst;
    } catch (e) {
      status("Tekst lezen mislukt — probeer het opnieuw met verbinding.");
      return "";
    }
  }

  async function vulTekstPaneel() {
    const veld = $("#dv-text");
    if (!pdfDoc && ocrGedaan && veld.value) return; // OCR niet nog eens draaien
    veld.value = (await huidigeTekst()).replace(/\n{3,}/g, "\n\n").trim();
    if (!pdfDoc) ocrGedaan = true;
  }

  async function toggleTekst() {
    tekstZichtbaar = !tekstZichtbaar;
    const paneel = $("#dv-text-panel");
    paneel.classList.toggle("hidden", !tekstZichtbaar);
    $("#btn-dv-text").textContent = tekstZichtbaar ? "🖼️ Alleen beeld" : "🔤 Tekst";
    if (tekstZichtbaar) {
      await vulTekstPaneel();
      paneel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  async function kopieer() {
    // Wat je zelf geselecteerd hebt gaat voor; anders de hele pagina.
    const selectie = String(global.getSelection?.() || "").trim();
    let tekst = selectie;
    if (!tekst) {
      await vulTekstPaneel();
      tekst = $("#dv-text").value.trim();
    }
    if (!tekst) {
      App()?.showToast("Geen tekst gevonden om te kopiëren.", true);
      return;
    }
    try {
      await navigator.clipboard.writeText(tekst);
      App()?.showToast(selectie ? "Selectie gekopieerd" : "Tekst van deze pagina gekopieerd");
    } catch (_) {
      // Zonder klembordrechten: tekst tonen en selecteren, dan kan het handmatig.
      if (!tekstZichtbaar) await toggleTekst();
      const veld = $("#dv-text");
      veld.focus();
      veld.select();
      App()?.showToast("Kopiëren mag hier niet automatisch — gebruik lang indrukken.", true);
    }
  }

  function sluitStil() {
    pdfDoc = null;
    imgUrl = null;
    if (eigenUrl) {
      URL.revokeObjectURL(eigenUrl);
      eigenUrl = null;
    }
    renderToken++;
    $("#dv-text-layer").innerHTML = "";
  }

  function sluit() {
    sluitStil();
    $("#doc-preview-modal").classList.add("hidden");
    status("");
  }

  function init() {
    if (!$("#doc-preview-modal")) return;
    $("#btn-dv-close").addEventListener("click", sluit);
    $("#doc-preview-modal .modal-backdrop").addEventListener("click", sluit);
    $("#btn-dv-prev").addEventListener("click", () => blader(-1));
    $("#btn-dv-next").addEventListener("click", () => blader(1));
    $("#btn-dv-zoom-out").addEventListener("click", () => zetZoom(1 / 1.4));
    $("#btn-dv-zoom-in").addEventListener("click", () => zetZoom(1.4));
    $("#btn-dv-text").addEventListener("click", toggleTekst);
    $("#btn-dv-copy").addEventListener("click", kopieer);
    global.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && !$("#doc-preview-modal").classList.contains("hidden")) sluit();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
  global.BoekDocPreview = { open, sluit };
})(window);
