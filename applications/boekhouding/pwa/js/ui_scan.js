/**
 * Bon of factuur fotograferen en als afbeelding in de OneDrive-map
 * "Facturen inkoop nog te verwerken" zetten.
 *
 * Foto: camera in de pagina met live kader (js/scan/scancam.js) → aanpasscherm met
 * het automatisch bijgesneden en verbeterde resultaat (js/scan/scanedit.js: hoeken,
 * zijkanten, draaien, zwart-wit/grijs, schuifje, spikkels weg, inzoomen) → pagina's +
 * gegevens → opslaan. De scanner-modules zijn overgenomen uit MuzIVOtheek en worden
 * pas geladen bij de eerste foto.
 */
(function (global) {
  const App = () => global.BoekApp;
  const M = () => global.BoekModel;
  const S = () => global.BoekScanner;
  const $ = (s) => document.querySelector(s);

  /**
   * pages bevat twee soorten items:
   *   { kind:"scan", out: canvas, original: Blob, settings }  — gefotografeerd
   *     (original + settings: om later opnieuw aan te passen)
   *   { kind:"file", file: File, naam, ext, thumb, url, pdf, tekst } — bestaand bestand
   * Bij een bestand is thumb het voorbeeldplaatje (eerste PDF-pagina of de foto
   * zelf) en tekst de uitgelezen PDF-tekst, waar de herkenning op werkt.
   */
  let pages = [];
  let busy = false;
  let lastShot = null; // {url}: laatste scan, als voorbeeldje in de camera

  // Scanner-modules (ES-modules) pas laden als ze nodig zijn.
  const scanEdit = () => import("./scan/scanedit.js");
  const scanCam = () => import("./scan/scancam.js");

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  // === Foto kiezen ===

  function sluitKeuze() {
    $("#scan-choice-modal").classList.add("hidden");
  }

  function pickPhoto(useCamera) {
    sluitKeuze();
    if (useCamera && navigator.mediaDevices?.getUserMedia) return startCamera();
    const input = useCamera ? $("#scan-input-camera") : $("#scan-input-gallery");
    input.value = "";
    input.click();
  }

  /**
   * Camera in de pagina: live kader om de bon, na elke foto het aanpasscherm.
   * Klaar = pagina erbij, camera blijft open voor de volgende. Camera dicht = naar
   * de gegevens (als er pagina's zijn).
   */
  async function startCamera() {
    let cam;
    let edit;
    try {
      [cam, edit] = await Promise.all([scanCam(), scanEdit()]);
    } catch (e) {
      App().showToast("Camera laden mislukt — probeer het opnieuw.", true);
      return;
    }
    edit.preloadScanner();
    await cam.openCamera(
      async (blob, hint) => {
        const file = new File([blob], "camera.jpg", { type: blob.type || "image/jpeg" });
        const res = await edit.editScan(file, null, reviewOpties({ hint }));
        if (res && !res.retake && !res.remove) await voegScanToe(res);
      },
      {
        counter: () => {
          const n = pages.filter(bruikbaar).length;
          return n ? `${n} ${n === 1 ? "pagina" : "pagina's"}` : "";
        },
        thumb: () => lastShot,
        onThumb: () => {
          const i = pages.findIndex((p) => p.kind === "scan" && p.url === lastShot?.url);
          if (i >= 0) return editPage(i);
        },
      }
    );
    if (pages.some(bruikbaar)) showSaveStep();
  }

  const reviewOpties = (extra = {}) => ({
    review: true,
    title: `Pagina ${pages.filter(bruikbaar).length + 1}`,
    allowCurve: false,
    ...extra,
  });

  /** Resultaat van het aanpasscherm als pagina bewaren (canvas voor voorbeeld, OCR, opslaan). */
  async function voegScanToe(res, index = -1) {
    const bmp = await createImageBitmap(res.blob);
    const out = document.createElement("canvas");
    out.width = bmp.width;
    out.height = bmp.height;
    out.getContext("2d").drawImage(bmp, 0, 0);
    if (bmp.close) bmp.close();
    const page = { kind: "scan", out, original: res.original, settings: res.settings, url: URL.createObjectURL(res.blob) };
    const wasLast = index >= 0 && pages[index]?.url === lastShot?.url;
    if (index >= 0) {
      vergeetPagina(pages[index]);
      pages[index] = page;
    } else pages.push(page);
    if (index < 0 || wasLast) lastShot = { url: page.url };
    return page;
  }

  /** Foto's uit de galerij (of de camera-app) door het aanpasscherm halen. */
  async function scanBestanden(files) {
    let edit;
    try {
      edit = await scanEdit();
    } catch (e) {
      App().showToast("Scanner laden mislukt — probeer het opnieuw.", true);
      return;
    }
    for (const file of files) {
      const res = await edit.editScan(file, null, reviewOpties({ retake: false }));
      if (res && !res.remove && !res.retake) await voegScanToe(res);
    }
    if (pages.some(bruikbaar)) showSaveStep();
  }

  /** Gescande pagina later aanpassen (tik op ✎). */
  async function editPage(i) {
    const page = pages[i];
    if (!page || page.kind !== "scan") return;
    if (!page.original) return App().showToast("Deze pagina kan niet meer aangepast worden — maak een nieuwe foto.", true);
    const edit = await scanEdit();
    const res = await edit.editScan(page.original, page.settings, { title: `Pagina ${i + 1}`, allowCurve: false, retake: false });
    if (!res) return;
    if (res.remove) {
      if (lastShot?.url === page.url) lastShot = null;
      vergeetPagina(page);
      pages.splice(i, 1);
    } else await voegScanToe(res, i);
    if (!$("#scan-step-save").classList.contains("hidden")) {
      if (!pages.length) closeModal();
      else {
        renderPages();
        updateFilenamePreview();
      }
    }
  }

  function pickFile() {
    sluitKeuze();
    const input = $("#scan-input-file");
    input.value = "";
    input.click();
  }

  async function onPhotoChosen(ev) {
    const file = ev.target.files?.[0];
    if (!file) return;
    try {
      await scanBestanden([file]);
    } catch (e) {
      App().showToast(e.message || String(e), true);
    }
  }

  /** Bestaand bestand toevoegen: gaat ongewijzigd mee, geen bijsnijden. */
  async function onFilesChosen(ev) {
    const gekozen = [...(ev.target.files || [])];
    if (!gekozen.length) return;
    setBusy(true, gekozen.length > 1 ? "Bestanden toevoegen…" : "Bestand toevoegen…");
    try {
      let gevuld = 0;
      for (const file of gekozen) gevuld += herkenUitPagina(await voegBestandToe(file));
      showSaveStep();
      if (gevuld) meldHerkenning(gevuld);
    } catch (e) {
      App().showToast(e.message || String(e), true);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Zet een gekozen bestand in de lijst en maakt er meteen een voorbeeld bij:
   * de eerste PDF-pagina of de foto zelf. Bij een PDF halen we de tekst er
   * alvast uit — daar draait de herkenning op en die kun je later ook lezen,
   * selecteren en kopiëren in het grote voorbeeld.
   */
  async function voegBestandToe(file) {
    const isPdf = /\.pdf$/i.test(file.name) || (file.type || "").includes("pdf");
    const ext = (file.name.match(/\.[^.]+$/) || [isPdf ? ".pdf" : ".jpg"])[0].toLowerCase();
    const page = { kind: "file", file, naam: file.name, ext };
    pages.push(page);
    try {
      if (isPdf) {
        page.pdf = await global.BoekPdf.loadPdf(await file.arrayBuffer());
        page.thumb = await pdfMiniatuur(page.pdf);
        page.tekst = await global.BoekPdf.extractText(page.pdf);
      } else {
        page.url = URL.createObjectURL(file);
        page.thumb = page.url;
      }
    } catch (_) {
      /* zonder voorbeeld of tekst gaat het bestand gewoon mee */
    }
    return page;
  }

  async function pdfMiniatuur(pdf) {
    const canvas = document.createElement("canvas");
    await global.BoekPdf.renderPage(pdf, 1, canvas, 264);
    return canvas.toDataURL("image/jpeg", 0.7);
  }

  /** Vult alleen nog lege velden; geeft terug hoeveel er ingevuld zijn. */
  function vulVelden(ex) {
    let n = 0;
    // De datum staat standaard op vandaag: die mag de herkenning overschrijven,
    // een datum die er al bewust staat niet.
    if (ex.datum && $("#scan-datum").value === M().todayIso()) {
      $("#scan-datum").value = ex.datum;
      n++;
    }
    if (ex.bedrijf && !$("#scan-leverancier").value) {
      $("#scan-leverancier").value = ex.bedrijf;
      n++;
    }
    if (ex.factuurnummer && !$("#scan-fnr").value) {
      $("#scan-fnr").value = ex.factuurnummer;
      n++;
    }
    if (n) updateFilenamePreview();
    return n;
  }

  /**
   * Gegevens uit een toegevoegd bestand halen — zelfde volgorde als bij het
   * inboeken: eerst de bestandsnaam (yymmdd bedrijf factuurnummer), daarna de
   * tekst uit de PDF. Foto's gaan via OCR in ocrVulVelden.
   */
  function herkenUitPagina(page) {
    let gevuld = 0;
    const uitNaam = M().parseInkoopFilename(page.naam || "");
    gevuld += vulVelden({
      datum: uitNaam.datumIso,
      bedrijf: uitNaam.bedrijf,
      factuurnummer: uitNaam.factuurnummer,
    });
    if (page.tekst) gevuld += vulVelden(global.BoekPdf.extractInvoiceData(page.tekst));
    return gevuld;
  }

  function meldHerkenning(gevuld, bron = "het bestand") {
    const status = $("#scan-ocr-status");
    status.classList.toggle("hidden", !gevuld);
    status.textContent = gevuld
      ? `${gevuld} gegeven${gevuld === 1 ? "" : "s"} uit ${bron} gehaald — controleer even.`
      : "";
  }

  function setBusy(on, msg) {
    busy = on;
    const el = $("#scan-busy");
    el.classList.toggle("hidden", !on);
    if (msg) el.textContent = msg;
  }

  // === OCR: tekst uit de bon of foto lezen en velden vullen ===
  let ocrBezig = false;

  /** Waar OCR iets aan heeft: een gescande pagina of een toegevoegde foto. */
  function ocrBron() {
    const scan = pages.find((p) => p.kind === "scan" && p.out);
    if (scan) return scan.out;
    const foto = pages.find((p) => p.kind === "file" && p.ext !== ".pdf" && p.file);
    return foto ? foto.file : null;
  }

  /** Leest de eerste foto en vult lege velden. Stil bij fouten. */
  async function ocrVulVelden() {
    if (ocrBezig) return;
    const bron = ocrBron();
    if (!bron) return;
    if ($("#scan-leverancier").value && $("#scan-fnr").value) return;
    ocrBezig = true;
    const status = $("#scan-ocr-status");
    status.classList.remove("hidden");
    status.textContent = "Bon lezen…";
    try {
      const tekst = await global.BoekOcr.tekstUit(bron);
      meldHerkenning(vulVelden(global.BoekPdf.extractInvoiceData(tekst)), "de foto");
    } catch (_) {
      status.classList.add("hidden");
    } finally {
      ocrBezig = false;
    }
  }

  // === Stap 2: pagina's + gegevens ===

  function showSaveStep() {
    $("#scan-step-save").classList.remove("hidden");
    $("#scan-modal").classList.remove("hidden");
    renderPages();
    updateFilenamePreview();
    ocrVulVelden();
  }

  const bruikbaar = (p) => (p.kind === "file" ? true : !!p.out);

  /**
   * Pagina groot in beeld: bladeren, zoomen en tekst selecteren/kopiëren.
   * Bij een PDF komt de tekst uit het bestand, bij een foto uit OCR.
   */
  function toonGroot(page) {
    const nr = pages.indexOf(page) + 1;
    if (page.kind !== "file") return global.BoekDocPreview.open({ naam: `Pagina ${nr}`, canvas: page.out });
    if (page.pdf) return global.BoekDocPreview.open({ naam: page.naam, pdf: page.pdf });
    return global.BoekDocPreview.open(
      page.url ? { naam: page.naam, imgUrl: page.url } : { naam: page.naam, file: page.file }
    );
  }

  /** Object-URL van een voorbeeld vrijgeven zodra de pagina weg is. */
  function vergeetPagina(page) {
    if (page?.url) {
      URL.revokeObjectURL(page.url);
      page.url = null;
      page.thumb = null;
    }
  }

  function renderPages() {
    const wrap = $("#scan-pages");
    wrap.innerHTML = "";
    pages.forEach((page, i) => {
      if (!bruikbaar(page)) return;
      const item = document.createElement("div");
      item.className = "scan-page";

      if (page.kind === "file" && !page.thumb) {
        // Geen voorbeeld te maken (bijv. een beveiligde PDF) → naam met icoon.
        const doc = document.createElement("div");
        doc.className = "scan-page-doc";
        const isPdf = page.ext === ".pdf";
        doc.innerHTML = `<span class="scan-doc-icon">${global.BoekIc.groot(isPdf ? "pdf" : "beeld")}</span>
          <span class="scan-doc-naam">${escapeHtml(page.naam)}</span>`;
        item.appendChild(doc);
      } else {
        const img = document.createElement("img");
        if (page.kind === "file") img.className = "scan-thumb-doc";
        img.alt = page.kind === "file" ? page.naam : `Pagina ${i + 1}`;
        img.src = page.kind === "file" ? page.thumb : page.out.toDataURL("image/jpeg", 0.5);
        // Tik op het voorbeeld → groot bekijken (en tekst selecteren/kopiëren).
        img.addEventListener("click", () => toonGroot(page));
        item.appendChild(img);
      }

      if (page.kind === "file") {
        const naamStrook = document.createElement("span");
        naamStrook.className = "scan-page-naam";
        naamStrook.textContent = page.naam;
        naamStrook.title = page.naam;
        item.appendChild(naamStrook);
      }

      const label = document.createElement("span");
      label.className = "scan-page-nr";
      label.textContent = `${i + 1}`;
      item.appendChild(label);

      const tools = document.createElement("div");
      tools.className = "scan-page-tools";
      tools.innerHTML =
        '<button type="button" class="btn-icon" data-a="zoom" aria-label="Groot bekijken" title="Groot bekijken">' + global.BoekIc.zoek + '</button>' +
        (page.kind === "scan"
          ? '<button type="button" class="btn-icon" data-a="crop" aria-label="Aanpassen" title="Aanpassen (hoeken, filter)">✎</button>' +
            '<button type="button" class="btn-icon" data-a="rot" aria-label="Draaien" title="Draaien">⟳</button>'
          : "") +
        '<button type="button" class="btn-icon btn-icon-danger" data-a="del" aria-label="Verwijderen" title="Verwijderen">✕</button>';
      tools.querySelector('[data-a="zoom"]').addEventListener("click", () => toonGroot(page));
      tools.querySelector('[data-a="crop"]')?.addEventListener("click", () => editPage(i));
      tools.querySelector('[data-a="rot"]')?.addEventListener("click", () => {
        page.out = S().rotate90(page.out);
        // Ook in de instellingen, zodat opnieuw aanpassen de draaiing houdt.
        if (page.settings) page.settings = { ...page.settings, rot: ((page.settings.rot || 0) + 90) % 360 };
        renderPages();
      });
      tools.querySelector('[data-a="del"]').addEventListener("click", () => {
        vergeetPagina(page);
        pages.splice(i, 1);
        if (!pages.length) closeModal();
        else {
          renderPages();
          updateFilenamePreview();
        }
      });
      item.appendChild(tools);
      wrap.appendChild(item);
    });
  }

  function scanFields() {
    const datumIso = $("#scan-datum").value || M().todayIso();
    const leverancier = $("#scan-leverancier").value.trim() || "Onbekend";
    const fnr = $("#scan-fnr").value.trim();
    return { datumIso, leverancier, fnr };
  }

  function updateFilenamePreview() {
    const { datumIso, leverancier, fnr } = scanFields();
    const base = M().buildInkoopFilename(datumIso, leverancier, fnr, "");
    const bruikbare = pages.filter(bruikbaar);
    if (!bruikbare.length) {
      $("#scan-filename").textContent = "";
      return;
    }
    $("#scan-filename").textContent =
      bruikbare.length > 1
        ? `Wordt map "${base}" met ${bruikbare.length} bestanden`
        : `Wordt bestand "${base}${bruikbare[0].kind === "file" ? bruikbare[0].ext : ".jpg"}"`;
  }

  async function save() {
    const usable = pages.filter(bruikbaar);
    if (!usable.length) return App().showToast("Nog niets om op te slaan.", true);
    if (!global.BoekOfflineQueue.isOnline()) {
      return App().showToast("Geen verbinding — nog niet opgeslagen. Probeer het zo opnieuw.", true);
    }
    const { datumIso, leverancier, fnr } = scanFields();
    const base = M().buildInkoopFilename(datumIso, leverancier, fnr, "");
    const folder = global.BOEK_CONFIG.graph.folders.inkoopNieuw;

    setBusy(true, "Opslaan in OneDrive…");
    try {
      const token = await App().ensureLoggedIn();
      const delen = [];
      for (const p of usable) {
        if (p.kind === "file") delen.push({ blob: p.file, ext: p.ext });
        else delen.push({ blob: await S().toJpeg(p.out, 0.85), ext: ".jpg" });
      }

      if (delen.length === 1) {
        await global.BoekGraph.uploadFile(`${folder}/${base}${delen[0].ext}`, delen[0].blob, token);
      } else {
        // Meerdere bestanden → map met dezelfde naam, zoals de desktop-app die verwacht.
        const made = await global.BoekGraph.createFolder(folder, base, token);
        const folderName = made?.name || base;
        for (let i = 0; i < delen.length; i++) {
          await global.BoekGraph.uploadFile(
            `${folder}/${folderName}/${base} ${i + 1}${delen[i].ext}`,
            delen[i].blob,
            token
          );
        }
      }
      App().showToast(
        delen.length === 1
          ? "Opgeslagen bij nog te verwerken"
          : `${delen.length} bestanden opgeslagen`
      );
      closeModal();
      App().refreshQuiet();
    } catch (e) {
      // Modal blijft open zodat het werk niet verloren gaat.
      App().showToast(e.message || String(e), true);
    } finally {
      setBusy(false);
    }
  }

  function closeModal() {
    pages.forEach(vergeetPagina);
    pages = [];
    lastShot = null;
    // Schoon beginnen, anders houdt de vorige leverancier de herkenning tegen.
    $("#scan-datum").value = M().todayIso();
    $("#scan-leverancier").value = "";
    $("#scan-fnr").value = "";
    $("#scan-filename").textContent = "";
    $("#scan-ocr-status").classList.add("hidden");
    $("#scan-modal").classList.add("hidden");
    $("#scan-step-save").classList.add("hidden");
  }

  async function confirmClose() {
    if (!pages.length) return closeModal();
    const ok = await App().showConfirm(
      "Scan weggooien? De foto's worden niet opgeslagen.",
      "Weggooien",
      "Terug"
    );
    if (ok) closeModal();
  }

  /** Vanuit Android gedeelde bestanden (share target) ophalen en verwerken. */
  async function laadGedeeld() {
    try {
      const cache = await caches.open("share-inbox");
      const keys = await cache.keys();
      if (!keys.length) return;
      const files = [];
      for (const req of keys) {
        const res = await cache.match(req);
        if (!res) continue;
        const blob = await res.blob();
        const naam = decodeURIComponent(res.headers.get("X-File-Name") || "gedeeld");
        files.push(new File([blob], naam, { type: blob.type }));
        await cache.delete(req);
      }
      if (!files.length) return;
      App().switchTab("inkoop");
      const eerste = files[0];
      if (files.length === 1 && eerste.type.startsWith("image/")) {
        // Eén foto → gewoon door de scanner (bijsnijden + verbeteren)
        await scanBestanden([eerste]);
      } else {
        // Meerdere bestanden of een PDF → ongewijzigd toevoegen, mét voorbeeld
        setBusy(true, "Gedeelde bestanden verwerken…");
        try {
          let gevuld = 0;
          for (const f of files) gevuld += herkenUitPagina(await voegBestandToe(f));
          showSaveStep();
          if (gevuld) meldHerkenning(gevuld);
        } finally {
          setBusy(false);
        }
      }
    } catch (_) {
      /* geen gedeelde bestanden */
    }
  }

  function init() {
    $("#scan-datum").value = M().todayIso();
    App().bindDateSteppers("scan-datum", "btn-scan-date-prev", "btn-scan-date-next");
    if (new URLSearchParams(location.search).has("shared")) {
      setTimeout(laadGedeeld, 300);
    }
    global.BoekCombo.createCombo(
      "scan-leverancier",
      null,
      () => App().state.intel.inkoop.partijen,
      updateFilenamePreview,
      { title: "Leverancier" }
    );
    $("#btn-scan-toggle").addEventListener("click", () => {
      $("#scan-choice-modal").classList.remove("hidden");
    });
    $("#btn-scan-camera").addEventListener("click", () => pickPhoto(true));
    $("#btn-scan-gallery").addEventListener("click", () => pickPhoto(false));
    $("#btn-scan-file").addEventListener("click", pickFile);
    $("#btn-scan-page-file").addEventListener("click", pickFile);
    $("#scan-input-camera").addEventListener("change", onPhotoChosen);
    $("#scan-input-gallery").addEventListener("change", onPhotoChosen);
    $("#scan-input-file").addEventListener("change", onFilesChosen);
    $("#btn-scan-page-add").addEventListener("click", () => pickPhoto(true));
    $("#btn-scan-save").addEventListener("click", save);
    $("#btn-scan-cancel").addEventListener("click", confirmClose);
    for (const id of ["scan-datum", "scan-leverancier", "scan-fnr"]) {
      document.getElementById(id).addEventListener("input", updateFilenamePreview);
      document.getElementById(id).addEventListener("change", updateFilenamePreview);
    }
  }

  App().registerTab("scan", { init });
  global.BoekUiScan = { open: () => pickPhoto(true) };
})(window);
