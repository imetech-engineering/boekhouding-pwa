/**
 * Domeinlogica boekhouding — pure functies, geen DOM en geen I/O.
 * Poort van de logica uit applications/facturen/facturen_app.py.
 */
(function (global) {
  // === Sheet/tabel-constanten (zelfde als desktop-app) ===
  const SHEET_BANK = "Bankboek";
  const SHEET_VERKOOP = "Verkoopboek totaal";
  const SHEET_INKOOP = "Inkoopboek totaal";
  const TABLE_BANK = "Tabel1";
  const TABLE_VERKOOP = "Tabel13";
  const TABLE_INKOOP = "Tabel134";
  const MATCH_DAYS = 14;

  // 0-based kolomindexen binnen de tabel-array (kolom A = 0)
  const BANK = { DATUM: 0, OMS: 1, IN: 2, UIT: 3, SALDO: 4, INGEBOEKT: 5, OPM: 6 };
  const INK = {
    DATUM: 0, PERIODE: 1, JAAR: 2, LEVERANCIER: 3, OMS: 4, FNR: 5, BEDRAG: 6,
    BEDRAG_ORIG: 7, VALUTA: 8, KOERS: 9, BTW: 10, VERLEGD: 11, VERLEGD_EUR: 12,
    BTW_TE_BETALEN: 13, BTW_BEDRAG: 14, NETTO: 15, CAT_KEUZES: 16, CATEGORIE: 17,
    AFSCHRIJVING: 18, OPM: 19, LAND: 20, PROJECT: 21,
  };
  const VRK = {
    DATUM: 0, PERIODE: 1, JAAR: 2, KLANT: 3, OMS: 4, FNR: 5, BEDRAG: 6, LAND: 7,
    BEDRAG_ORIG: 8, VALUTA: 9, KOERS: 10, BTW: 11, BTW_BEDRAG: 12, NETTO: 13,
    CAT_KEUZES: 14, CATEGORIE: 15, OPM: 16,
  };

  const EU_CODES = new Set(
    "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE".split(" ")
  );

  // === Datums ===
  const SERIAL_EPOCH = Date.UTC(1899, 11, 30);

  function serialToDate(v) {
    if (v == null || v === "") return null;
    if (typeof v === "number") {
      if (v < 20000 || v > 80000) return null; // geen plausibele datum-serial
      return new Date(SERIAL_EPOCH + v * 86400000);
    }
    if (typeof v === "string") {
      const s = v.trim();
      let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
      m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
      if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
      return null;
    }
    return null;
  }

  function dateToIso(d) {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
      d.getUTCDate()
    ).padStart(2, "0")}`;
  }

  function isoToDate(iso) {
    const m = (iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  }

  function formatDateNl(d) {
    if (!d) return "";
    return `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(
      2,
      "0"
    )}-${d.getUTCFullYear()}`;
  }

  function todayIso() {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(
      n.getDate()
    ).padStart(2, "0")}`;
  }

  function daysBetween(a, b) {
    return Math.abs((a.getTime() - b.getTime()) / 86400000);
  }

  function isoToYymmdd(iso) {
    const m = (iso || "").match(/^(\d{2})(\d{2})-(\d{2})-(\d{2})/);
    return m ? `${m[2]}${m[3]}${m[4]}` : "";
  }

  // === Bedragen ===
  function parseCellAmount(v) {
    if (v == null || v === "") return null;
    if (typeof v === "number") return Math.round(v * 100) / 100;
    if (typeof v === "string") {
      if (v.startsWith("=")) return null;
      const f = parseUserAmount(v);
      return f;
    }
    return null;
  }

  /** Gebruikersinvoer: komma of punt als decimaalteken. */
  function parseUserAmount(s) {
    if (s == null) return null;
    const t = String(s).trim().replace(/[€\s]/g, "");
    if (!t) return null;
    let clean = t;
    if (t.includes(",") && t.includes(".")) {
      clean =
        t.lastIndexOf(",") > t.lastIndexOf(".")
          ? t.replace(/\./g, "").replace(",", ".")
          : t.replace(/,/g, "");
    } else if (t.includes(",")) {
      clean = t.replace(",", ".");
    }
    const f = parseFloat(clean);
    return Number.isFinite(f) ? Math.round(f * 100) / 100 : null;
  }

  function fmtEur(v) {
    if (v == null || !Number.isFinite(v)) return "—";
    return (
      "€ " +
      v.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    );
  }

  function fmtAmountInput(v) {
    if (v == null || !Number.isFinite(v)) return "";
    return v.toFixed(2).replace(".", ",");
  }

  function cellText(v) {
    if (v == null) return "";
    const s = String(v).trim();
    return s.startsWith("=") ? "" : s;
  }

  function cellBool(v) {
    return v === true || v === "TRUE" || v === "WAAR" || v === 1;
  }

  // === Rij-parsers (input: values-array van de tabel-range, excelRow bekend) ===
  function parseBankRows(values, headerRow) {
    const rows = [];
    let running = 0;
    for (let i = 1; i < values.length; i++) {
      const v = values[i];
      const excelRow = headerRow + i;
      const datum = serialToDate(v[BANK.DATUM]);
      const oms = cellText(v[BANK.OMS]);
      const inBedrag = parseCellAmount(v[BANK.IN]);
      const uitBedrag = parseCellAmount(v[BANK.UIT]);
      const opm = cellText(v[BANK.OPM]);
      const isEmptySlot = !datum && !oms && inBedrag == null && uitBedrag == null;
      const isEmpty = isEmptySlot && !opm;
      let saldo = parseCellAmount(v[BANK.SALDO]);
      if (!isEmpty) {
        if (saldo == null) {
          saldo = Math.round((running + (inBedrag || 0) - (uitBedrag || 0)) * 100) / 100;
        }
        running = saldo;
      }
      rows.push({
        excelRow,
        datum,
        datumStr: formatDateNl(datum),
        omschrijving: oms,
        in: inBedrag,
        uit: uitBedrag,
        saldo: isEmpty ? null : saldo,
        ingeboekt: cellBool(v[BANK.INGEBOEKT]),
        opmerking: opm,
        isEmpty,
        isEmptySlot,
      });
    }
    return rows;
  }

  function parseInkoopRows(values, headerRow) {
    const rows = [];
    for (let i = 1; i < values.length; i++) {
      const v = values[i];
      const excelRow = headerRow + i;
      const datum = serialToDate(v[INK.DATUM]);
      const leverancier = cellText(v[INK.LEVERANCIER]);
      const bedrag = parseCellAmount(v[INK.BEDRAG]);
      rows.push({
        excelRow,
        datum,
        datumStr: formatDateNl(datum),
        partij: leverancier,
        omschrijving: cellText(v[INK.OMS]),
        factuurnummer: cellText(v[INK.FNR]),
        bedrag,
        bedragOrig: parseCellAmount(v[INK.BEDRAG_ORIG]),
        valuta: cellText(v[INK.VALUTA]),
        wisselkoers: cellText(v[INK.KOERS]),
        btw: typeof v[INK.BTW] === "number" ? v[INK.BTW] : parseCellAmount(v[INK.BTW]),
        verlegd: cellBool(v[INK.VERLEGD]),
        btwBedrag: parseCellAmount(v[INK.BTW_BEDRAG]),
        btwTeBetalen: parseCellAmount(v[INK.BTW_TE_BETALEN]),
        netto: parseCellAmount(v[INK.NETTO]),
        // Fix t.o.v. desktop: kolom R (Categorie) is leidend, niet Q (keuzelijst)
        categorie: cellText(v[INK.CATEGORIE]) || cellText(v[INK.CAT_KEUZES]),
        catKeuzesCell: cellText(v[INK.CAT_KEUZES]),
        afschrijving: cellBool(v[INK.AFSCHRIJVING]),
        opmerking: cellText(v[INK.OPM]),
        land: cellText(v[INK.LAND]),
        project: cellText(v[INK.PROJECT]),
        isEmpty: !datum && !leverancier,
      });
    }
    return rows;
  }

  function parseVerkoopRows(values, headerRow) {
    const rows = [];
    for (let i = 1; i < values.length; i++) {
      const v = values[i];
      const excelRow = headerRow + i;
      const datum = serialToDate(v[VRK.DATUM]);
      const klant = cellText(v[VRK.KLANT]);
      rows.push({
        excelRow,
        datum,
        datumStr: formatDateNl(datum),
        partij: klant,
        omschrijving: cellText(v[VRK.OMS]),
        factuurnummer: cellText(v[VRK.FNR]),
        bedrag: parseCellAmount(v[VRK.BEDRAG]),
        land: cellText(v[VRK.LAND]),
        bedragOrig: parseCellAmount(v[VRK.BEDRAG_ORIG]),
        valuta: cellText(v[VRK.VALUTA]),
        wisselkoers: cellText(v[VRK.KOERS]),
        btw: typeof v[VRK.BTW] === "number" ? v[VRK.BTW] : parseCellAmount(v[VRK.BTW]),
        btwBedrag: parseCellAmount(v[VRK.BTW_BEDRAG]),
        netto: parseCellAmount(v[VRK.NETTO]),
        categorie: cellText(v[VRK.CATEGORIE]) || cellText(v[VRK.CAT_KEUZES]),
        catKeuzesCell: cellText(v[VRK.CAT_KEUZES]),
        opmerking: cellText(v[VRK.OPM]),
        isEmpty: !datum && !klant,
      });
    }
    return rows;
  }

  // === Lege-rij-detectie ===
  /** Bankboek: eerste rij zonder datum/omschrijving/in/uit (desktop-regel). */
  function firstEmptyBankSlot(bankRows) {
    for (const r of bankRows) {
      if (r.isEmptySlot) return r.excelRow;
    }
    const last = bankRows.length ? bankRows[bankRows.length - 1].excelRow : 5;
    return last + 1; // buiten de tabel → rows/add-fallback
  }

  /** Laatste niet-lege bankrij vóór excelRow → saldo-basis en formule-referentie. */
  function lastFilledBankRowBefore(bankRows, excelRow) {
    let found = null;
    for (const r of bankRows) {
      if (r.excelRow >= excelRow) break;
      if (!r.isEmpty) found = r;
    }
    return found;
  }

  /** Saldo-formule zoals bestaande formule-rijen in het werkboek. */
  function saldoFormula(prevExcelRow) {
    const base = prevExcelRow ? `E${prevExcelRow}` : "0";
    return (
      `=IF(AND(ISBLANK(Tabel1[[#This Row],[In (€)]]),ISBLANK(Tabel1[[#This Row],[Uit (€)]])),"",` +
      `${base}+Tabel1[[#This Row],[In (€)]]-Tabel1[[#This Row],[Uit (€)]])`
    );
  }

  /** Inkoop/verkoop: eerste rij zonder datum én partij (desktop-regel). */
  function firstEmptyBoekSlot(rows) {
    for (const r of rows) {
      if (r.isEmpty) return r.excelRow;
    }
    return null; // tabel vol → rows/add
  }

  // === Partij-matching (fuzzy, zelfde regels als desktop) ===
  function normalizeParty(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function partyNamesMatch(a, b) {
    const na = normalizeParty(a);
    const nb = normalizeParty(b);
    if (!na || !nb) return false;
    if (na === nb || na.includes(nb) || nb.includes(na)) return true;
    const wa = na.split(" ");
    const wb = nb.split(" ");
    if (wa[0] === wb[0] && wa[0].length >= 3) return true;
    const la = wa[wa.length - 1];
    const lb = wb[wb.length - 1];
    if (la === lb && la.length >= 4) return true;
    return false;
  }

  // === Booking intelligence ===
  function freqSorted(counter) {
    return [...counter.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([k]) => k);
  }

  function buildIntel(inkoopRows, verkoopRows) {
    function build(rows, isVerkoop) {
      const history = rows.filter((r) => !r.isEmpty && (r.partij || r.omschrijving || r.bedrag != null));
      const newestFirst = [...history].reverse();
      const partijen = new Map();
      const categorieen = new Map();
      const projecten = new Map();
      for (const r of history) {
        if (r.partij) partijen.set(r.partij, (partijen.get(r.partij) || 0) + 1);
        if (r.categorie) categorieen.set(r.categorie, (categorieen.get(r.categorie) || 0) + 1);
        if (!isVerkoop && r.project) projecten.set(r.project, (projecten.get(r.project) || 0) + 1);
      }
      return {
        history: newestFirst,
        partijen: freqSorted(partijen),
        categorieen: freqSorted(categorieen),
        projecten: freqSorted(projecten),
      };
    }
    return { inkoop: build(inkoopRows, false), verkoop: build(verkoopRows, true) };
  }

  /** Per veld de nieuwste niet-lege waarde van een fuzzy-gematchte partij. */
  function partyDefaults(intelBoek, party) {
    const out = {};
    if (!party) return out;
    const fields = ["categorie", "land", "btw", "project", "valuta", "wisselkoers", "verlegd", "omschrijving"];
    for (const h of intelBoek.history) {
      if (!partyNamesMatch(h.partij, party)) continue;
      for (const f of fields) {
        if (out[f] !== undefined) continue;
        const v = h[f];
        if (v !== undefined && v !== null && v !== "") out[f] = v;
      }
      if (fields.every((f) => out[f] !== undefined)) break;
    }
    return out;
  }

  /** Duplicaatcontrole: zelfde partij + (factuurnr gelijk óf bedrag+datum gelijk). */
  function findDuplicate(intelBoek, { partij, datumIso, bedrag, factuurnummer }) {
    const datum = isoToDate(datumIso);
    const fnr = (factuurnummer || "").trim().toLowerCase();
    for (const h of intelBoek.history.slice(0, 120)) {
      if (partij && h.partij && h.partij.toLowerCase() !== partij.toLowerCase()) continue;
      if (datum && h.datum && daysBetween(datum, h.datum) > 0.5) continue;
      if (bedrag != null && h.bedrag != null && Math.abs(h.bedrag - bedrag) > 0.02) continue;
      const fnrMatch = fnr && h.factuurnummer && h.factuurnummer.toLowerCase() === fnr;
      const amountDateMatch = bedrag != null && h.bedrag != null && datum && h.datum;
      if (fnrMatch || amountDateMatch) return h;
    }
    return null;
  }

  // === Bank-matching (bedrag exact, datum ±14 dagen, richting) ===
  function bankMatchesForInvoice(bankRows, bedrag, datumIso, isVerkoop) {
    const datum = isoToDate(datumIso);
    if (bedrag == null || !datum) return [];
    return bankRows.filter((r) => {
      if (r.isEmpty || r.ingeboekt) return false;
      if (!r.datum || daysBetween(r.datum, datum) > MATCH_DAYS) return false;
      const kant = isVerkoop ? r.in : r.uit;
      return kant != null && Math.abs(kant - bedrag) < 0.005;
    });
  }

  function invoiceMatchesForBankRow(facturen, bankRow) {
    if (!bankRow.datum) return [];
    return facturen.filter((f) => {
      if (!f.datum || f.bedrag == null) return false;
      if (daysBetween(f.datum, bankRow.datum) > MATCH_DAYS) return false;
      return (
        (bankRow.in != null && Math.abs(f.bedrag - bankRow.in) < 0.005) ||
        (bankRow.uit != null && Math.abs(f.bedrag - bankRow.uit) < 0.005)
      );
    });
  }

  // === Land / type ===
  function normalizeLand(v) {
    const s = String(v || "").trim();
    if (!s) return "";
    if (s.toLowerCase() === "buiteneu") return "BuitenEU";
    if (s.toUpperCase() === "NL") return "NL";
    if (s.toUpperCase() === "EU") return "EU";
    return s;
  }

  function countryToType(cc) {
    if (!cc || cc.length !== 2) return "";
    const c = cc.toUpperCase();
    if (c === "NL") return "NL";
    return EU_CODES.has(c) ? "EU" : "BuitenEU";
  }

  // === Bestandsnamen (zelfde conventies als desktop) ===
  function parseVerkoopFilename(basename) {
    const name = basename.replace(/\.[^.]+$/, "");
    let m = name.match(/^(FA\d+)_(NL|EU|buitenEU)_(.+)$/i);
    if (m) return { factuurnummer: m[1], type: normalizeLand(m[2]), bedrijf: m[3].trim() };
    m = name.match(/^(FA\d+)_(.+)$/);
    if (m) return { factuurnummer: m[1], type: "", bedrijf: m[2].trim() };
    return { factuurnummer: "", type: "", bedrijf: "" };
  }

  function parseInkoopFilename(basename) {
    let name = basename.replace(/\.[^.]+$/, "").replace(/\s*\(n8n\)\s*$/i, "").trim();
    const m = name.match(/^(\d{6})\s+(.+)$/);
    if (!m) return { datumIso: "", bedrijf: "", factuurnummer: "" };
    const yymmdd = m[1];
    const rest = m[2].trim();
    const parts = rest.split(/\s+/);
    let bedrijf = rest;
    let factuurnummer = "";
    if (parts.length >= 2) {
      factuurnummer = parts[parts.length - 1];
      bedrijf = parts.slice(0, -1).join(" ");
    }
    const yy = +yymmdd.slice(0, 2);
    const mm = +yymmdd.slice(2, 4);
    const dd = +yymmdd.slice(4, 6);
    let datumIso = "";
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      datumIso = `${2000 + yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    }
    return { datumIso, bedrijf, factuurnummer };
  }

  function buildInkoopFilename(datumIso, bedrijf, factuurnummer, ext) {
    const clean = (s) => String(s || "").replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
    const yymmdd = isoToYymmdd(datumIso);
    return `${yymmdd} ${clean(bedrijf)} ${clean(factuurnummer)}`.trim() + (ext || "");
  }

  // === FA-nummer suggestie (FAyymmnn) ===
  function suggestNextFaNummer(verkoopRows, refIso) {
    const iso = refIso || todayIso();
    const yymm = iso.slice(2, 4) + iso.slice(5, 7);
    let maxN = 0;
    for (const r of verkoopRows) {
      const m = (r.factuurnummer || "").match(/^FA(\d{4})(\d{2})$/i);
      if (m && m[1] === yymm) maxN = Math.max(maxN, +m[2]);
    }
    return `FA${yymm}${String(maxN + 1).padStart(2, "0")}`;
  }

  // === Reiskosten ===
  function formatKm(km) {
    return km.toLocaleString("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  function buildReisOmschrijving({ naam, km, bestemming, thuisPlaats }) {
    const thuis = thuisPlaats || "Aalten";
    return `Transportkosten ${naam} (2x ${formatKm(km)}km - ${thuis} - ${bestemming} - ${thuis})`;
  }

  function reisBedrag(km, tarief) {
    return Math.round(2 * km * tarief * 100) / 100;
  }

  /** Haal eerdere reisbestemmingen uit de inkoop-historie (Transportkosten-patroon). */
  function reisFavorietenUitHistorie(inkoopHistory) {
    const seen = new Map();
    for (const h of inkoopHistory) {
      const m = (h.omschrijving || "").match(
        /^Transportkosten\s+(.+?)\s*\(2x\s*([\d.,]+)\s*km\s*-\s*[^-]+-\s*(.+?)\s*-\s*[^-]+\)$/i
      );
      if (!m) continue;
      const naam = m[1].replace(/\b(kennismaking|werkdag)\b/gi, "").replace(/\s+/g, " ").trim();
      const km = parseUserAmount(m[2]);
      const bestemming = m[3].trim();
      const key = naam.toLowerCase();
      if (!seen.has(key) && km) {
        seen.set(key, { naam, km, bestemming, project: h.project || "", count: 1 });
      } else if (seen.has(key)) {
        seen.get(key).count += 1;
      }
    }
    return [...seen.values()].sort((a, b) => b.count - a.count);
  }

  // === Dashboard: kwartaal-aggregatie ===
  function kwartaalOverzicht(inkoopRows, verkoopRows, jaar) {
    const out = [];
    for (let q = 1; q <= 4; q++) {
      out.push({ q: `Q${q}`, omzet: 0, kosten: 0, btwOntvangen: 0, btwBetaald: 0, btwVerlegd: 0 });
    }
    const add = (rows, isVerkoop) => {
      for (const r of rows) {
        if (r.isEmpty || !r.datum) continue;
        if (r.datum.getUTCFullYear() !== jaar) continue;
        const q = Math.floor(r.datum.getUTCMonth() / 3);
        const slot = out[q];
        if (isVerkoop) {
          slot.omzet += r.netto || 0;
          slot.btwOntvangen += r.btwBedrag || 0;
        } else {
          slot.kosten += r.netto || 0;
          slot.btwBetaald += r.btwBedrag || 0;
          slot.btwVerlegd += r.btwTeBetalen || 0;
        }
      }
    };
    add(verkoopRows, true);
    add(inkoopRows, false);
    for (const s of out) {
      // Verlegde BTW valt weg tegen zichzelf (aangifte 5a én 5b) — telt niet mee in het saldo.
      s.btwSaldo = s.btwOntvangen - s.btwBetaald;
      s.resultaat = s.omzet - s.kosten;
    }
    return out;
  }

  global.BoekModel = {
    SHEET_BANK, SHEET_VERKOOP, SHEET_INKOOP,
    TABLE_BANK, TABLE_VERKOOP, TABLE_INKOOP,
    BANK, INK, VRK, MATCH_DAYS,
    serialToDate, dateToIso, isoToDate, formatDateNl, todayIso, daysBetween, isoToYymmdd,
    parseCellAmount, parseUserAmount, fmtEur, fmtAmountInput, cellText, cellBool,
    parseBankRows, parseInkoopRows, parseVerkoopRows,
    firstEmptyBankSlot, lastFilledBankRowBefore, saldoFormula, firstEmptyBoekSlot,
    normalizeParty, partyNamesMatch, buildIntel, partyDefaults, findDuplicate,
    bankMatchesForInvoice, invoiceMatchesForBankRow,
    normalizeLand, countryToType,
    parseVerkoopFilename, parseInkoopFilename, buildInkoopFilename,
    suggestNextFaNummer,
    formatKm, buildReisOmschrijving, reisBedrag, reisFavorietenUitHistorie,
    kwartaalOverzicht,
  };
})(window);
