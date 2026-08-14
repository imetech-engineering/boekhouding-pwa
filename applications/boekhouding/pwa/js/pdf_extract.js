/**
 * PDF-preview (pdf.js) + factuurgegevens-extractie.
 * Extractie is een 1-op-1 poort van extract_invoice_data_from_pdf uit facturen_app.py.
 */
(function (global) {
  const OWN_ADDRESS_KEYWORDS = [
    "vierde broekdijk", "7122 jd", "7122jd", "aalten", "nl005275849b96", "imetech engineering",
  ];
  const OWN_VAT = "nl005275849b96";

  function pdfjs() {
    const lib = global.pdfjsLib;
    if (!lib) throw new Error("pdf.js kon niet laden. Controleer je internetverbinding.");
    if (!lib.GlobalWorkerOptions.workerSrc) {
      lib.GlobalWorkerOptions.workerSrc =
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
    }
    return lib;
  }

  async function loadPdf(arrayBuffer) {
    return pdfjs().getDocument({ data: arrayBuffer }).promise;
  }

  /** Render één pagina naar een canvas (schaal naar breedte). */
  async function renderPage(pdf, pageNum, canvas, targetWidth) {
    const page = await pdf.getPage(pageNum);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(3, (targetWidth || 600) / base.width) * (global.devicePixelRatio || 1);
    const viewport = page.getViewport({ scale });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = "100%";
    canvas.style.height = "auto";
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  }

  /** Tekst per pagina, regels gereconstrueerd op y-positie. */
  async function extractText(pdf) {
    let fullText = "";
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const linesMap = new Map();
      for (const item of content.items) {
        if (!item.str) continue;
        const y = Math.round(item.transform[5]);
        let key = null;
        for (const k of linesMap.keys()) {
          if (Math.abs(k - y) <= 2) { key = k; break; }
        }
        if (key == null) { key = y; linesMap.set(key, []); }
        linesMap.get(key).push({
          x: item.transform[4],
          w: item.width || 0,
          h: item.height || Math.abs(item.transform[3]) || 10,
          str: item.str,
        });
      }
      const ys = [...linesMap.keys()].sort((a, b) => b - a);
      for (const y of ys) {
        // Fragmenten aan elkaar plakken op basis van de werkelijke tussenruimte:
        // zonder gat aaneen (anders wordt "03-08-2026" tot "03 - 08 - 2026"),
        // groot gat → dubbele spatie zodat tabelkolommen te splitsen zijn.
        const parts = linesMap.get(y).sort((a, b) => a.x - b.x);
        let line = "";
        let prevEnd = null;
        for (const it of parts) {
          if (prevEnd != null) {
            const gap = it.x - prevEnd;
            const spaceW = (it.h || 10) * 0.22;
            if (gap >= spaceW * 4) line += "  ";
            else if (gap >= spaceW * 0.6) line += " ";
          }
          line += it.str;
          prevEnd = it.x + it.w;
        }
        fullText += line + "\n";
      }
      fullText += "\n";
    }
    return fullText;
  }

  /** PDF's die elk teken los plaatsen ("F a c t u u r") — alleen dán spaties weghalen. */
  function looksSpacedOut(t) {
    const tokens = t.split(/\s+/).filter(Boolean);
    if (tokens.length < 20) return false;
    const singles = tokens.filter((x) => x.length === 1).length;
    return singles / tokens.length > 0.4;
  }

  function collapseSpacedChars(t) {
    if (!looksSpacedOut(t)) return t;
    for (;;) {
      const next = t.replace(/(?<=[\w.])\s+(?=[\w.]\s)/g, "");
      if (next === t) break;
      t = next;
    }
    return t;
  }

  function parseAmountRaw(raw) {
    const r = raw.trim().replace(/[\s€$�]/g, "");
    let clean = r;
    if (r.includes(",") && r.includes(".")) {
      clean =
        r.lastIndexOf(",") > r.lastIndexOf(".")
          ? r.replace(/\./g, "").replace(",", ".")
          : r.replace(/,/g, "");
    } else if (r.includes(",")) {
      clean = r.replace(",", ".");
    }
    const f = parseFloat(clean);
    return Number.isFinite(f) ? f : null;
  }

  function countryToType(cc) {
    return global.BoekModel.countryToType(cc);
  }

  /** Poort van de Python-extractie: bedrijf, factuurnummer, datum, bedrag, btw%, type. */
  function extractInvoiceData(rawText) {
    const result = { bedrijf: "", factuurnummer: "", datum: "", bedrag: null, btw: null, type: "" };
    let fullText = rawText.replace(/�/g, "€");
    fullText = collapseSpacedChars(fullText);
    const fullTextNorm = fullText.replace(/[ \t]+/g, " ");
    const lines = fullTextNorm.split("\n").map((l) => l.trim()).filter(Boolean);
    // Zelfde regels, maar met de kolomafstand intact (voor tabel-layouts).
    const linesRaw = fullText.split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim());
    const lowerFull = fullTextNorm.toLowerCase();

    // Datums mogen spaties rond de scheidingstekens hebben, maar nooit over regels heen.
    const DATE_ONE = /(\d{1,2})[ \t]*[-/.][ \t]*(\d{1,2})[ \t]*[-/.][ \t]*(\d{4})/;
    const DATE_ALL = new RegExp(DATE_ONE.source, "g");
    const datesIn = (s) =>
      [...s.matchAll(DATE_ALL)].map((m) => ({ d: +m[1], mo: +m[2], y: +m[3] }));
    const splitCols = (s) => s.split(/\s{2,}/).map((x) => x.trim()).filter(Boolean);
    /** Eerste token dat op een nummer lijkt (geen datum, geen los cijfer). */
    const pickNumber = (cell) => {
      for (const tok of String(cell).split(/\s+/)) {
        const t = tok.replace(/^[\s:.,-]+|[\s:.,-]+$/g, "");
        if (t.length >= 3 && /\d/.test(t) && !DATE_ONE.test(t) && !/^\d{1,2}$/.test(t)) return t;
      }
      return null;
    };

    // Bedrijf
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lower = line.toLowerCase();
      if (lower.startsWith("aan:") || lower.includes("factuur aan") || lower.includes("leverancier") || lower.includes("klant:")) {
        if (line.includes(":")) {
          const part = line.split(":").slice(1).join(":").trim();
          if (part && part.length < 100) { result.bedrijf = part; break; }
        }
        if (i + 1 < lines.length && lines[i + 1].length < 100) { result.bedrijf = lines[i + 1]; break; }
      }
      if (lower.includes("verkocht door")) {
        const part = line.includes(":")
          ? line.split(":").slice(1).join(":").trim()
          : line.replace(/verkocht door/i, "").trim();
        if (part && part.length < 80) { result.bedrijf = part.slice(0, 80); break; }
      }
      if (!result.bedrijf && line.length > 2 && line.length < 80 && !/^[\d\s.,€$]+$/.test(line)) {
        if (!lower.includes("factuur") && !lower.includes("invoice") && !lower.includes("btw") && !lower.includes("totaal") && !lower.includes("address")) {
          if (/[a-z]/i.test(line)) { result.bedrijf = line; break; }
        }
      }
    }

    // Ons eigen briefhoofd/adres is nooit de tegenpartij.
    if (OWN_ADDRESS_KEYWORDS.some((kw) => result.bedrijf.toLowerCase().includes(kw))) {
      result.bedrijf = "";
    }

    // Factuurnummer: eerst het expliciete label (ook als de waarde in een
    // tabel op de regel eronder staat), pas daarna een losse "nr."-vermelding.
    const FNR_LABEL = /factuur\s*nummer|factuurnr|invoice\s*(no|nr|number|#)/i;
    const JUNK_NR = /(kvk|btw|iban|bic|rekening|telefoon|tel\.|vat\b|postcode)/i;
    for (let i = 0; i < linesRaw.length && !result.factuurnummer; i++) {
      const line = linesRaw[i];
      if (!FNR_LABEL.test(line)) continue;
      const tail = line.includes(":") ? line.split(":").slice(1).join(":") : line.replace(FNR_LABEL, "");
      const inline = (tail.match(/\b[A-Za-z0-9][A-Za-z0-9\-/]*\d[A-Za-z0-9\-/]*\b/) || [])[0];
      if (inline && !DATE_ONE.test(inline)) {
        result.factuurnummer = inline.slice(0, 50);
        break;
      }
      const cols = splitCols(line);
      const idx = cols.findIndex((c) => FNR_LABEL.test(c));
      for (let j = i + 1; j <= i + 2 && j < linesRaw.length; j++) {
        const vals = splitCols(linesRaw[j]);
        if (!vals.length) continue;
        const cell =
          cols.length > 1 && idx >= 0 && vals.length === cols.length ? vals[idx] : linesRaw[j];
        const cand = pickNumber(cell);
        if (cand) {
          result.factuurnummer = cand.slice(0, 50);
          break;
        }
      }
    }
    if (!result.factuurnummer) {
      for (const line of lines) {
        if (JUNK_NR.test(line)) continue;
        const m = line.match(/(?:nr\.?|nummer|invoice\s*#?)\s*:?\s*([A-Za-z0-9\-/]+)/i);
        if (m && /\d/.test(m[1])) {
          result.factuurnummer = m[1].replace(/^[\s:.-]+|[\s:.-]+$/g, "").slice(0, 50);
          break;
        }
      }
    }

    // Bedrag incl. btw
    const amountPattern = /[€$]\s*[\d\s.,]+|\d{1,3}(?:[.,\s]\d{3})*[.,]\d{2}|\d+[.,]\d{2}/g;
    const candidates = [];
    let am;
    while ((am = amountPattern.exec(fullTextNorm)) !== null) {
      const val = parseAmountRaw(am[0]);
      if (val != null && val >= 0.01 && val <= 9999999.99) {
        candidates.push({ pos: am.index, val });
      }
    }
    if (candidates.length) {
      const totaalKeywords = [
        "totaal incl", "totaal factuur", "totaalbedrag", "te betalen", "grand total",
        "amount due", "total sent", "totaal:", "total:", "totaal ", "total ",
      ];
      let totaalPos = -1;
      for (const k of totaalKeywords) {
        const p = lowerFull.indexOf(k);
        if (p > totaalPos) totaalPos = p;
      }
      const after = candidates.filter((c) => c.pos >= totaalPos);
      const chosen = after.length ? after[after.length - 1] : candidates[candidates.length - 1];
      result.bedrag = Math.round(chosen.val * 100) / 100;
    }

    // BTW %
    const btwFrom = (re) => {
      const m = lowerFull.match(re);
      return m ? (m[1] || m[2]) : null;
    };
    let btw = null;
    const mDirect = fullTextNorm.match(/\b(21|9|6|0)\s*%/);
    if (mDirect) btw = mDirect[1];
    if (btw == null) btw = btwFrom(/(?:btw|vat)\s*[:\s]*\d*\s*(\d{1,2})[,.]?\d*\s*%/);
    if (btw == null) btw = btwFrom(/(\d{1,2})[,.]?\d*\s*%\s*(?:btw|vat)|btw\s*(\d{1,2})\s*%/);
    if (btw == null) btw = btwFrom(/(?:btw|vat)\s*\(?\s*(\d{1,2})\s*%|(\d{1,2})\s*%\s*(?:btw|vat)/);
    if (btw == null && ["buiten eu", "geen btw", "btw-vrijgesteld", "niet van toepassing"].some((x) => lowerFull.includes(x))) {
      btw = "0";
    }
    if (btw != null) result.btw = parseInt(btw, 10);

    // Datum
    const setDatum = (d, mo, y) => {
      if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y >= 2000 && y <= 2100) {
        result.datum = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        return true;
      }
      return false;
    };
    // Datum bij het label "Factuurdatum": op dezelfde regel, of — bij een tabel —
    // op de waarderegel eronder. Daar staan meerdere datums (factuur-, vervaldatum),
    // dus kies de kolom die overeenkomt met de plek van het label in de kop.
    for (let i = 0; i < linesRaw.length && !result.datum; i++) {
      const lower = linesRaw[i].toLowerCase();
      if (!/factuur\s*datum|invoice date/.test(lower)) continue;
      const own = datesIn(linesRaw[i]);
      if (own.length && setDatum(own[0].d, own[0].mo, own[0].y)) break;
      const labels = lower.match(/[a-z]*datum|invoice date/g) || [];
      const col = Math.max(0, labels.findIndex((l) => /factuurdatum|invoice date/.test(l)));
      for (let j = i + 1; j <= i + 2 && j < linesRaw.length; j++) {
        const ds = datesIn(linesRaw[j]);
        if (!ds.length) continue;
        const pick = ds[Math.min(col, ds.length - 1)];
        if (setDatum(pick.d, pick.mo, pick.y)) break;
      }
    }
    if (!result.datum) {
      for (const dt of datesIn(fullTextNorm)) {
        if (setDatum(dt.d, dt.mo, dt.y)) break;
      }
    }
    if (!result.datum) {
      let m;
      const re = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/g;
      while ((m = re.exec(fullTextNorm)) !== null) {
        if (setDatum(+m[3], +m[2], +m[1])) break;
      }
    }
    if (!result.datum) {
      // Afgekorte maand, o.a. Mouser: "30-JUL-26"
      const mon3 = { jan: 1, feb: 2, mar: 3, mrt: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12 };
      const m = lowerFull.match(/\b(\d{1,2})[-\s]([a-z]{3})[a-z]*[-\s](\d{2,4})\b/);
      if (m && mon3[m[2]]) {
        const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
        setDatum(+m[1], mon3[m[2]], y);
      }
    }
    if (!result.datum) {
      const moEn = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
      const moNl = { januari: 1, februari: 2, maart: 3, april: 4, mei: 5, juni: 6, juli: 7, augustus: 8, september: 9, oktober: 10, november: 11, december: 12 };
      let m = lowerFull.match(/(january|february|march|april|may|june|july|august|september|october|november|december|januari|februari|maart|mei|juni|juli|augustus|oktober)\s+(\d{1,2}),?\s*(\d{4})/);
      if (m) {
        const mo = moEn[m[1]] || moNl[m[1]];
        if (mo) setDatum(+m[2], mo, +m[3]);
      }
      if (!result.datum) {
        m = lowerFull.match(/(\d{1,2})\s+(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\s+(\d{4})/);
        if (m) setDatum(+m[1], moNl[m[2]], +m[3]);
      }
    }

    // Type (NL/EU/BuitenEU) — eigen adres/BTW-nummer negeren
    const containsOwn = (s) => OWN_ADDRESS_KEYWORDS.some((kw) => s.includes(kw)) || s.includes(OWN_VAT);
    let m2;
    const reNlVat = /\bNL\s*[\dA-Z\s]{6,}\b/gi;
    while ((m2 = reNlVat.exec(fullTextNorm)) !== null) {
      const vat = m2[0].replace(/\s/g, "").toLowerCase();
      if (vat.length >= 9 && vat.startsWith("nl") && !vat.includes(OWN_VAT)) {
        result.type = "NL";
        break;
      }
    }
    if (!result.type && /\d{4}\s+[A-Z]{2}\s*\.?\s*NL\b/.test(fullTextNorm)) {
      for (const line of lines) {
        if (containsOwn(line.toLowerCase())) continue;
        if (/\d{4}\s+[A-Z]{2}\s*\.?\s*NL\b/.test(line)) { result.type = "NL"; break; }
      }
    }
    if (!result.type) {
      const reCcVat = /\b([A-Z]{2})\s*(?:vat|btw|nr|nummer|id)?\s*[\s#:]*\d/gi;
      while ((m2 = reCcVat.exec(fullTextNorm)) !== null) {
        const snippet = fullTextNorm.slice(Math.max(0, m2.index - 80), m2.index + 40).toLowerCase();
        if (containsOwn(snippet)) continue;
        const t = countryToType(m2[1].toUpperCase());
        if (t) { result.type = t; break; }
      }
    }
    if (!result.type) {
      const countryNames = {
        nederland: "NL", netherlands: "NL", duitsland: "EU", germany: "EU", deutschland: "EU",
        "belgië": "EU", belgie: "EU", belgium: "EU", frankrijk: "EU", france: "EU",
        ireland: "EU", ierland: "EU", "italië": "EU", italy: "EU", spanje: "EU", spain: "EU",
        luxembourg: "EU", luxemburg: "EU", "united states": "BuitenEU", usa: "BuitenEU",
        "united kingdom": "BuitenEU", uk: "BuitenEU", china: "BuitenEU",
        zwitserland: "BuitenEU", switzerland: "BuitenEU", oostenrijk: "EU", austria: "EU",
        polen: "EU", poland: "EU", portugal: "EU", zweden: "EU", sweden: "EU",
      };
      outer:
      for (const line of lines) {
        const lower = line.toLowerCase();
        if (containsOwn(lower)) continue;
        for (const [name, t] of Object.entries(countryNames)) {
          if (lower.includes(name)) { result.type = t; break outer; }
        }
      }
    }
    return result;
  }

  global.BoekPdf = { loadPdf, renderPage, extractText, extractInvoiceData };
})(window);
