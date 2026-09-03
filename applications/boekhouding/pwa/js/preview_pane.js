/**
 * Voorbeeldvenster van inkoop en verkoop.
 *
 * Toont één bestand óf een hele map: je bladert door alle bestanden in de map
 * én door de pagina's van een PDF. PDF's krijgen een selecteerbare tekstlaag
 * over het beeld; foto's (jpg/png/heic) worden als afbeelding getoond. Elk
 * bestand wordt pas opgehaald als je het bekijkt.
 */
(function (global) {
  const App = () => global.BoekApp;
  const $ = (s) => document.querySelector(s);

  const isPdfNaam = (naam) => /\.pdf$/i.test(naam || "");

  const MIME_PER_EXT = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".pdf": "application/pdf",
  };

  /** Terugval als OneDrive geen mediatype meegeeft: afleiden uit de extensie. */
  function mimeVanNaam(naam) {
    const ext = (String(naam || "").match(/\.[^.]+$/) || [""])[0].toLowerCase();
    return MIME_PER_EXT[ext] || "";
  }

  /**
   * @param {string} prefix   "inkoop" of "verkoop" (de id's in de HTML)
   * @param {() => string} standaardMap  map waarin losse mappen staan
   */
  function create(prefix, standaardMap) {
    const el = (naam) => $(`#${prefix}-${naam}`);
    let docs = [];      // { id, naam, isPdf, mime, pdf, numPages, url }
    let docIndex = 0;
    let pageNum = 1;
    let mapNaam = "";
    let beurt = 0;      // alleen de laatste aanvraag mag nog tekenen

    function toonKaart() {
      el("preview-card").classList.remove("hidden");
      el("preview-status").classList.add("hidden");
      el("preview-wrap").classList.remove("hidden");
    }

    /** Kaart met alleen een melding: er is (nog) niets in beeld. */
    function melding(tekst) {
      docs = [];
      beurt++;
      el("preview-card").classList.remove("hidden");
      el("preview-name").textContent = "";
      el("preview-wrap").classList.add("hidden");
      el("page-row").classList.add("hidden");
      const st = el("preview-status");
      st.textContent = tekst;
      st.classList.remove("hidden");
    }

    function verberg() {
      docs = [];
      beurt++;
      el("preview-card").classList.add("hidden");
    }

    /** Bestandsinhoud ophalen zodra dit bestand in beeld komt. */
    async function laadDoc(d) {
      if (!d || d.pdf || d.url) return d;
      const token = await App().ensureLoggedIn();
      if (d.isPdf) {
        const bytes = await global.BoekGraph.downloadBytes(d.id, token);
        d.pdf = await global.BoekPdf.loadPdf(bytes);
        d.numPages = d.pdf.numPages;
      } else {
        // Mime meegeven: een blob zonder type toont de browser niet als afbeelding.
        d.url = await global.BoekGraph.downloadObjectUrl(d.id, token, d.mime);
        d.numPages = 1;
      }
      return d;
    }

    async function tekenHuidige() {
      const mijn = beurt;
      const d = docs[docIndex];
      if (!d) return;
      toonKaart();
      el("preview-name").textContent = mapNaam ? `${mapNaam} · ${d.naam}` : d.naam;
      try {
        await laadDoc(d);
      } catch (e) {
        melding(`Bestand laden mislukt: ${e.message || e}`);
        return;
      }
      if (mijn !== beurt) return; // ondertussen iets anders gekozen

      const canvas = el("pdf-canvas");
      const img = el("img-preview");
      if (d.isPdf) {
        img.classList.add("hidden");
        canvas.classList.remove("hidden");
        pageNum = Math.min(Math.max(1, pageNum), d.numPages);
        await global.BoekPdf.renderPage(d.pdf, pageNum, canvas, canvas.parentElement.clientWidth || 600);
        if (mijn !== beurt) return;
        try {
          await global.BoekPdf.renderTextLayer(
            d.pdf, pageNum, el("text-layer"), canvas.getBoundingClientRect().width
          );
        } catch (_) {
          el("text-layer").innerHTML = ""; // zonder tekstlaag blijft het beeld staan
        }
      } else {
        canvas.classList.add("hidden");
        el("text-layer").innerHTML = "";
        img.onerror = () => melding(`"${d.naam}" kan niet als afbeelding getoond worden.`);
        img.src = d.url;
        img.classList.remove("hidden");
      }
      tekenNav();
    }

    function tekenNav() {
      const d = docs[docIndex];
      const meerBestanden = docs.length > 1;
      const meerPaginas = (d?.numPages || 1) > 1;
      el("page-row").classList.toggle("hidden", !meerBestanden && !meerPaginas);
      $(`#btn-${prefix}-page-prev`).classList.toggle("hidden", !meerBestanden && !meerPaginas);
      $(`#btn-${prefix}-page-next`).classList.toggle("hidden", !meerBestanden && !meerPaginas);
      const label = el("page-label");
      label.classList.toggle("hidden", !meerBestanden && !meerPaginas);
      label.textContent =
        (meerBestanden ? `${docIndex + 1}/${docs.length}` : "") +
        (meerBestanden && meerPaginas ? " · " : "") +
        (meerPaginas ? `p${pageNum}/${d.numPages}` : "");
    }

    /** Vooruit/achteruit door de pagina's van dit bestand en daarna door de map. */
    async function blader(richting) {
      const d = docs[docIndex];
      if (!d) return;
      if (richting > 0) {
        if (d.isPdf && pageNum < (d.numPages || 1)) pageNum++;
        else if (docIndex < docs.length - 1) {
          docIndex++;
          pageNum = 1;
        } else return;
      } else if (pageNum > 1) {
        pageNum--;
      } else if (docIndex > 0) {
        docIndex--;
        // Terug naar de laatste pagina van het vorige bestand (als dat er is).
        try {
          await laadDoc(docs[docIndex]);
        } catch (_) {}
        pageNum = docs[docIndex].numPages || 1;
      } else return;
      await tekenHuidige();
    }

    /**
     * Zet een bestand of map in beeld. Geeft het eerste PDF-document terug,
     * zodat de aanroeper er factuurgegevens uit kan halen (of null).
     */
    async function toon(item, parentFolder) {
      const mijn = ++beurt;
      docs = [];
      docIndex = 0;
      pageNum = 1;
      mapNaam = "";
      el("text-layer").innerHTML = "";
      el("img-preview").classList.add("hidden");
      toonKaart();
      el("preview-name").textContent = item.name;
      el("page-row").classList.add("hidden");

      const token = await App().ensureLoggedIn();
      let bestanden = [item];
      if (item.folder) {
        mapNaam = item.name;
        const parent = parentFolder || item._folder || standaardMap();
        const kinderen = await global.BoekGraph.listFolder(`${parent}/${item.name}`, token);
        bestanden = kinderen
          .filter((c) => c.file)
          .sort((a, b) => a.name.localeCompare(b.name, "nl"));
        if (!bestanden.length) {
          melding(`De map "${item.name}" is leeg.`);
          return null;
        }
      }
      if (mijn !== beurt) return null;
      docs = bestanden.map((f) => ({
        id: f.id,
        naam: f.name,
        isPdf: isPdfNaam(f.name),
        mime: f.file?.mimeType || mimeVanNaam(f.name),
        numPages: 1,
      }));
      await tekenHuidige();
      if (mijn !== beurt) return null;

      // Gegevens uitlezen mag uit elke PDF in de map, niet alleen de eerste.
      const pdfDoc = docs.find((d) => d.isPdf);
      if (!pdfDoc) return null;
      try {
        await laadDoc(pdfDoc);
      } catch (_) {
        return null;
      }
      return mijn === beurt ? pdfDoc.pdf : null;
    }

    /** Nog eens tekenen, bijvoorbeeld als het venster van breedte verandert. */
    function herteken() {
      if (docs.length) tekenHuidige();
    }

    $(`#btn-${prefix}-page-prev`).addEventListener("click", () => blader(-1));
    $(`#btn-${prefix}-page-next`).addEventListener("click", () => blader(1));
    // Bij draaien van de telefoon opnieuw op maat tekenen, anders schuift de
    // tekstlaag los van het beeld.
    let hertekenTimer = null;
    global.addEventListener("resize", () => {
      if (!docs.length) return;
      clearTimeout(hertekenTimer);
      hertekenTimer = setTimeout(herteken, 250);
    });

    return { toon, verberg, melding, herteken, isLeeg: () => docs.length === 0 };
  }

  global.BoekPreviewPane = { create };
})(window);
