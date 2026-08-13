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
        linesMap.get(key).push({ x: item.transform[4], str: item.str });
      }
      const ys = [...linesMap.keys()].sort((a, b) => b - a);
      for (const y of ys) {
        const parts = linesMap.get(y).sort((a, b) => a.x - b.x).map((i) => i.str);
        fullText += parts.join(" ") + "\n";
      }
      fullText += "\n";
    }
    return fullText;
  }

  function collapseSpacedChars(t) {
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
    const lowerFull = fullTextNorm.toLowerCase();

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

    // Factuurnummer
    outerFnr:
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lower = line.toLowerCase();
      if (lower.includes("factuurnummer") || lower.includes("factuurnr") || lower.includes("factuur nr") || lower.includes("invoice no") || (lower.includes("invoice") && lower.includes("number"))) {
        if (line.includes(":")) {
          const part = line.split(":").slice(1).join(":").trim();
          if (part) { result.factuurnummer = part.replace(/\s+/g, " ").slice(0, 50); break; }
        }
        const nums = line.match(/[A-Za-z0-9\-/]+/g) || [];
        for (const n of nums) {
          if (n.length >= 2 && /\d/.test(n)) {
            result.factuurnummer = n.replace(/^[\s:.-]+|[\s:.-]+$/g, "").slice(0, 50);
            break outerFnr;
          }
        }
        if (i + 1 < lines.length && /^[A-Za-z0-9\-/]+$/.test(lines[i + 1].trim())) {
          result.factuurnummer = lines[i + 1].trim().slice(0, 50);
          break;
        }
      }
      if (!result.factuurnummer) {
        const m = line.match(/(?:nr\.?|nummer|invoice\s*#?)\s*:?\s*([A-Za-z0-9\-/]+)/i);
        if (m) { result.factuurnummer = m[1].trim().slice(0, 50); break; }
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
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (lower.includes("factuurdatum") || lower.includes("factuur datum")) {
        const m = line.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
        if (m && setDatum(+m[1], +m[2], +m[3])) break;
      }
    }
    if (!result.datum) {
      let m;
      const re = /(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/g;
      while ((m = re.exec(fullTextNorm)) !== null) {
        if (setDatum(+m[1], +m[2], +m[3])) break;
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
