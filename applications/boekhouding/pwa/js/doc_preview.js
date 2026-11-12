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
  let fotoTekst = null;   // herkende tekst van de huidige foto: { b, h, tekst, regels: [{ tekst, woorden: [{ t, x0, y0, x1, y1 }] }] }
  let fotoBezig = null;   // lopende herkenning (één per foto)
  let laatsteTik = null;  // { r, w, t }: nog eens tikken op hetzelfde woord kopieert de hele regel

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
    fotoTekst = null;
    fotoBezig = null;
    $("#dv-naam").textContent = naam;
    $("#dv-text").value = "";
    $("#dv-text-panel").classList.add("hidden");
    $("#btn-dv-text").innerHTML = `${global.BoekIc.tekst}Tekst`;
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
      if (img.getAttribute("src") !== (imgUrl || "")) img.src = imgUrl || "";
      img.classList.remove("hidden");
      // Tekst op de foto zelf aantikbaar maken: herkenning start vanzelf, het beeld blijft gewoon bruikbaar.
      const mijn = renderToken;
      leesFoto().then(() => { if (mijn === renderToken) tekenFotoLaag(); }).catch(() => {});
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

  /**
   * Leest de foto één keer uit, met per woord de plek in het beeld. De foto gaat via een canvas naar de herkenning,
   * zodat de posities kloppen met wat je ziet (ook bij foto's die de telefoon gedraaid opslaat).
   */
  function leesFoto() {
    if (pdfDoc || !imgUrl) return Promise.resolve(null);
    if (fotoTekst) return Promise.resolve(fotoTekst);
    if (fotoBezig) return fotoBezig;
    const url = imgUrl;
    status("Tekst zoeken in de foto…");
    const taak = (async () => {
      try {
        const img = $("#dv-img");
        if (!img.complete || !img.naturalWidth) {
          await new Promise((ok, fout) => { img.addEventListener("load", ok, { once: true }); img.addEventListener("error", fout, { once: true }); });
        }
        const f = Math.min(1, 2200 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.naturalWidth * f));
        c.height = Math.max(1, Math.round(img.naturalHeight * f));
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        const data = await global.BoekOcr.lees(c);
        if (url !== imgUrl) return null;   // venster ondertussen gesloten of een andere foto geopend
        const regels = (data.lines || [])
          .map((l) => ({
            tekst: String(l.text || "").trim(),
            woorden: (l.words || [])
              .filter((w) => String(w.text || "").trim() && w.bbox)
              .map((w) => ({ t: String(w.text).trim(), x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 })),
          }))
          .filter((r) => r.woorden.length);
        fotoTekst = { b: c.width, h: c.height, tekst: String(data.text || ""), regels };
        status(regels.length ? "Tik op tekst in de foto om die te kopiëren. Nog eens tikken pakt de hele regel." : "Geen tekst gevonden in de foto.");
        return fotoTekst;
      } catch (e) {
        if (url === imgUrl) status("Tekst lezen mislukt. Probeer het opnieuw met verbinding.");
        return null;
      } finally {
        if (fotoBezig === taak) fotoBezig = null;
      }
    })();
    fotoBezig = taak;
    return taak;
  }

  /** Legt de herkende woorden als aantikbare, selecteerbare laag precies over de foto. */
  function tekenFotoLaag() {
    const laag = $("#dv-text-layer");
    laag.innerHTML = "";
    if (pdfDoc || !fotoTekst || !fotoTekst.regels.length) return;
    const img = $("#dv-img");
    const schaal = (img.clientWidth || 1) / fotoTekst.b;
    laag.style.width = "100%";
    laag.style.height = "100%";
    const frag = document.createDocumentFragment();
    fotoTekst.regels.forEach((regel, r) => {
      regel.woorden.forEach((w, i) => {
        const span = document.createElement("span");
        span.className = "dv-woord";
        span.dataset.r = r;
        span.dataset.w = i;
        span.textContent = w.t + " ";
        span.style.left = `${(w.x0 / fotoTekst.b) * 100}%`;
        span.style.top = `${(w.y0 / fotoTekst.h) * 100}%`;
        span.style.width = `${((w.x1 - w.x0) / fotoTekst.b) * 100}%`;
        span.style.height = `${((w.y1 - w.y0) / fotoTekst.h) * 100}%`;
        span.style.fontSize = `${Math.max(6, (w.y1 - w.y0) * schaal * 0.9)}px`;
        frag.appendChild(span);
      });
    });
    laag.appendChild(frag);
  }

  /** Tik op een woord in de foto: kopiëren. Nog eens tikken op hetzelfde woord: de hele regel. */
  async function tikOpWoord(ev) {
    const span = ev.target.closest?.(".dv-woord");
    if (!span || !fotoTekst) return;
    if (String(global.getSelection?.() || "").trim()) return;   // je bent zelf aan het selecteren
    const r = Number(span.dataset.r), w = Number(span.dataset.w);
    const regel = fotoTekst.regels[r];
    if (!regel) return;
    const nogEens = laatsteTik && laatsteTik.r === r && laatsteTik.w === w && Date.now() - laatsteTik.t < 4000;
    const tekst = nogEens ? regel.tekst : regel.woorden[w].t;
    laatsteTik = nogEens ? null : { r, w, t: Date.now() };
    document.querySelectorAll("#dv-text-layer .gekozen").forEach((el) => el.classList.remove("gekozen"));
    (nogEens ? document.querySelectorAll(`#dv-text-layer .dv-woord[data-r="${r}"]`) : [span]).forEach((el) => el.classList.add("gekozen"));
    try {
      await navigator.clipboard.writeText(tekst);
      App()?.showToast(`Gekopieerd: ${tekst.length > 60 ? tekst.slice(0, 57) + "…" : tekst}`);
    } catch (_) {
      App()?.showToast("Kopiëren mag hier niet automatisch. Houd de tekst ingedrukt om te selecteren.", true);
    }
  }

  /** Tekst van de huidige pagina: uit de PDF, of via OCR bij een foto. */
  async function huidigeTekst() {
    if (pdfDoc) return global.BoekPdf.pageText(pdfDoc, pageNum);
    if (!imgUrl) return "";
    const f = await leesFoto();
    return f ? f.tekst : "";
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
    $("#btn-dv-text").innerHTML = tekstZichtbaar ? `${global.BoekIc.beeld}Alleen beeld` : `${global.BoekIc.tekst}Tekst`;
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
    fotoTekst = null;
    fotoBezig = null;
    laatsteTik = null;
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
    $("#dv-text-layer").addEventListener("click", tikOpWoord);
    global.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && !$("#doc-preview-modal").classList.contains("hidden")) sluit();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
  global.BoekDocPreview = { open, sluit };
})(window);
