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
  const BANK = { DATUM: 0, OMS: 1, IN: 2, UIT: 3, SALDO: 4, INGEBOEKT: 5, OPM: 6, REK: 7, KOP: 8 };
  const REKENINGEN = ["Rabo", "Knab"];
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
        rekening: cellText(v[BANK.REK]),
        koppelingRaw: cellText(v[BANK.KOP]),
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

  /**
   * Zelf-herstellende saldo-formule per rekening (kolom H): telt alle In min Uit
   * van dezelfde rekening tot en met deze rij op. Volgorde-onafhankelijk, en
   * verwijderen van een rij kan zonder andere formules te herkoppelen.
   */
  function saldoFormula(excelRow) {
    const n = excelRow;
    return (
      `=IF(AND(ISBLANK($C${n}),ISBLANK($D${n})),"",` +
      `ROUND(SUMIF($H$6:$H${n},$H${n},$C$6:$C${n})-SUMIF($H$6:$H${n},$H${n},$D$6:$D${n}),2))`
    );
  }

  /** Actueel saldo per rekening, plus rijen die nog een rekening missen. */
  function saldiPerRekening(bankRows) {
    const saldi = { Rabo: 0, Knab: 0 };
    let zonder = 0;
    for (const r of bankRows) {
      if (r.isEmpty) continue;
      const net = (r.in || 0) - (r.uit || 0);
      if (saldi[r.rekening] !== undefined) {
        saldi[r.rekening] = Math.round((saldi[r.rekening] + net) * 100) / 100;
      } else if ((r.in != null || r.uit != null) && !/priv[eéè]\s*betaald/i.test(r.opmerking)) {
        // 'Privé betaald'-regels horen bewust bij geen enkele rekening
        zonder++;
      }
    }
    return { ...saldi, zonderRekening: zonder };
  }

  /**
   * Privé-opnames en -stortingen van een jaar.
   *
   * Alleen échte overboekingen van/naar privé tellen mee in de hoofdcijfers:
   * "Privé opname", opstartbudget (heen en retour) en "… vanuit privé".
   * Regels die alleen het wóórd privé bevatten (zoals "30% telefoon-privégebruik")
   * zijn aankopen, geen opnames — die komen apart terug in `overig`, met het
   * privé-deel uit de opmerking als daar een €-bedrag in staat.
   */
  const PRIVE_WOORD = /priv[eéè]/i;
  const PRIVE_TRANSFER = [
    /^priv[eéè]\s*opname/i, // omschrijving
    /opstartbudget/i, // omschrijving (heen én retour)
    /vanuit\s+priv[eéè]/i, // storting, in omschrijving of opmerking
    /overgemaakt\s+(naar|vanuit)\s+priv[eéè]?rekening/i, // opmerking
  ];

  function isPriveTransfer(r) {
    return PRIVE_TRANSFER.some((re) => re.test(r.omschrijving) || re.test(r.opmerking));
  }

  function priveOverzicht(bankRows, jaar) {
    let opgenomen = 0;
    let gestort = 0;
    let regels = 0;
    const overig = [];
    for (const r of bankRows) {
      if (r.isEmpty || !r.datum || r.datum.getUTCFullYear() !== jaar) continue;
      if (!r.rekening) continue; // 'privé betaald'-regels raken geen rekening
      if (isPriveTransfer(r)) {
        opgenomen += r.uit || 0;
        gestort += r.in || 0;
        regels++;
      } else if (PRIVE_WOORD.test(`${r.omschrijving} ${r.opmerking}`)) {
        // Privé-deel uit de opmerking (bijv. "€247,67 niet ingeboekt"), anders het hele bedrag
        const m = r.opmerking.match(/€\s*([\d.,]+)/);
        const deel = m ? parseUserAmount(m[1]) : null;
        overig.push({
          excelRow: r.excelRow,
          datumStr: r.datumStr,
          omschrijving: r.omschrijving,
          bedrag: deel != null ? deel : (r.uit || r.in || 0),
        });
      }
    }
    return {
      opgenomen: Math.round(opgenomen * 100) / 100,
      gestort: Math.round(gestort * 100) / 100,
      netto: Math.round((opgenomen - gestort) * 100) / 100,
      regels,
      overig,
      overigTotaal: Math.round(overig.reduce((s, o) => s + o.bedrag, 0) * 100) / 100,
    };
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

  // === Koppeling bankregel ↔ factuur (kolom I in het Bankboek) ===
  // Notatie: factuurnummer als dat uniek is, anders "fnr (I155)" of "(V60)".

  function fnrTelling(inkoopRows, verkoopRows) {
    const telling = new Map();
    for (const r of [...inkoopRows, ...verkoopRows]) {
      if (r.isEmpty || !r.factuurnummer) continue;
      const k = r.factuurnummer.toLowerCase();
      telling.set(k, (telling.get(k) || 0) + 1);
    }
    return telling;
  }

  /** Schrijfwaarde voor één koppeling. */
  function koppelWaarde(boekLetter, factuurRow, inkoopRows, verkoopRows) {
    const fnr = (factuurRow.factuurnummer || "").trim();
    if (fnr && (fnrTelling(inkoopRows, verkoopRows).get(fnr.toLowerCase()) || 0) <= 1) {
      return fnr;
    }
    return `${fnr ? fnr + " " : ""}(${boekLetter}${factuurRow.excelRow})`;
  }

  /** Celtekst → gekoppelde facturen: [{boek:'inkoop'|'verkoop', row, token}]. */
  function parseKoppelingen(raw, inkoopRows, verkoopRows) {
    const uit = [];
    for (const tokenRaw of String(raw || "").split(",")) {
      const token = tokenRaw.trim();
      if (!token) continue;
      const m = token.match(/\(([IV])(\d+)\)$/i);
      if (m) {
        const boek = m[1].toUpperCase() === "I" ? "inkoop" : "verkoop";
        const rows = boek === "inkoop" ? inkoopRows : verkoopRows;
        const row = rows.find((r) => r.excelRow === +m[2]) || null;
        uit.push({ boek, row, token });
        continue;
      }
      const laag = token.toLowerCase();
      const inI = inkoopRows.filter((r) => !r.isEmpty && r.factuurnummer.toLowerCase() === laag);
      const inV = verkoopRows.filter((r) => !r.isEmpty && r.factuurnummer.toLowerCase() === laag);
      if (inI.length + inV.length === 1) {
        uit.push(
          inI.length
            ? { boek: "inkoop", row: inI[0], token }
            : { boek: "verkoop", row: inV[0], token }
        );
      } else {
        uit.push({ boek: null, row: null, token }); // onbekend of niet uniek
      }
    }
    return uit;
  }

  /** Omgekeerde index: "inkoop|155" → [bankRow, …]. */
  function koppelingIndex(bankRows, inkoopRows, verkoopRows) {
    const index = new Map();
    for (const b of bankRows) {
      if (b.isEmpty || !b.koppelingRaw) continue;
      for (const k of parseKoppelingen(b.koppelingRaw, inkoopRows, verkoopRows)) {
        if (!k.row) continue;
        const sleutel = `${k.boek}|${k.row.excelRow}`;
        if (!index.has(sleutel)) index.set(sleutel, []);
        index.get(sleutel).push(b);
      }
    }
    return index;
  }

  /** Facturen waar nog geen bankregel aan hangt (jouw controle-/jaaropgaaflijst). */
  function facturenZonderBank(inkoopRows, verkoopRows, index) {
    const nu = new Date();
    const uit = [];
    for (const boek of ["inkoop", "verkoop"]) {
      const rows = boek === "inkoop" ? inkoopRows : verkoopRows;
      for (const r of rows) {
        if (r.isEmpty || !r.datum || r.bedrag == null) continue;
        if (r.datum > nu) continue; // afschrijvingsregels in de toekomst
        if (r.categorie === "Reiskosten" || r.categorie === "Afschrijving") continue;
        if (index.has(`${boek}|${r.excelRow}`)) continue;
        uit.push({ ...r, boek });
      }
    }
    // Factuur + creditnota die elkaar opheffen (zelfde boek/partij, ±bedrag)
    // hebben per definitie geen bankregel — die vallen tegen elkaar weg.
    const perKey = new Map();
    for (const r of uit) {
      const key = `${r.boek}|${(r.partij || "").toLowerCase()}|${Math.abs(r.bedrag).toFixed(2)}`;
      if (!perKey.has(key)) perKey.set(key, []);
      perKey.get(key).push(r);
    }
    const weg = new Set();
    for (const groep of perKey.values()) {
      const plus = groep.filter((r) => r.bedrag > 0);
      const min = groep.filter((r) => r.bedrag < 0);
      for (let i = 0; i < Math.min(plus.length, min.length); i++) {
        weg.add(plus[i]);
        weg.add(min[i]);
      }
    }
    const rest = uit.filter((r) => !weg.has(r));
    rest.sort((a, b) => b.datum - a.datum);
    return rest;
  }

  /** Ingeboekte bankregels zonder gekoppelde factuur — de "bijzondere gevallen". */
  function bankZonderKoppeling(bankRows) {
    return bankRows
      .filter((r) => !r.isEmpty && r.ingeboekt && !r.koppelingRaw && (r.in != null || r.uit != null))
      .slice()
      .reverse();
  }

  /**
   * Kandidaat-facturen om handmatig aan een bankregel te koppelen.
   * Richting: bank-uit → inkoop, bank-in → verkoop. Al gekoppelde facturen doen niet mee.
   * Zonder zoekterm: datum binnen ±dagen en bedrag ≤ bankbedrag (deelbetalingen kunnen samen
   * één afschrijving dekken). Met zoekterm: alle facturen op partij/factuurnummer/omschrijving.
   */
  function koppelKandidaten(bankRow, inkoopRows, verkoopRows, index, dagen = MATCH_DAYS, zoek = "") {
    const isIn = bankRow.in != null;
    const bedrag = isIn ? bankRow.in : bankRow.uit;
    const q = String(zoek || "").trim().toLowerCase();
    const uit = [];
    // teken +1 = hoofdrichting; teken −1 = tegenrichting (verrekening: bij een
    // uitbetaling worden ingehouden fees als inkoopfactuur afgetrokken — netto klopt dan).
    const voegToe = (rows, boekNaam, teken, maxBedrag) => {
      const boekKey = boekNaam.toLowerCase();
      for (const f of rows) {
        if (f.isEmpty || f.bedrag == null || !f.datum) continue;
        if (index && index.has(`${boekKey}|${f.excelRow}`)) continue;
        if (q) {
          const hay = `${f.partij} ${f.factuurnummer} ${f.omschrijving}`.toLowerCase();
          if (!hay.includes(q)) continue;
        } else {
          if (!bankRow.datum || daysBetween(f.datum, bankRow.datum) > dagen) continue;
          if (teken > 0 && maxBedrag != null && f.bedrag > maxBedrag + 0.005) continue;
        }
        uit.push({ ...f, boek: boekNaam, teken });
      }
    };
    const hoofd = isIn ? [verkoopRows, "Verkoop"] : [inkoopRows, "Inkoop"];
    const tegen = isIn ? [inkoopRows, "Inkoop"] : [verkoopRows, "Verkoop"];
    voegToe(tegen[0], tegen[1], -1, null);
    // Hoofdrichting mag groter zijn dan het bankbedrag zolang verrekeningen
    // het verschil kunnen dekken (uitbetaling = omzet − fees).
    const tegenSom = uit.reduce((s, f) => s + f.bedrag, 0);
    voegToe(hoofd[0], hoofd[1], 1, bedrag != null ? bedrag + tegenSom : null);
    uit.sort((a, b) => {
      if (a.teken !== b.teken) return b.teken - a.teken; // hoofdrichting eerst
      const da = bankRow.datum ? Math.abs(a.datum - bankRow.datum) : 0;
      const db = bankRow.datum ? Math.abs(b.datum - bankRow.datum) : 0;
      return da - db;
    });
    return uit;
  }

  /**
   * Kleinste combinatie facturen (max 4) die samen precies het doelbedrag dekt, of null.
   * Eerst alleen hoofdrichting; lukt dat niet, dan ook met verrekeningen
   * (tegenrichting telt negatief — bijv. uitbetaling = omzet − fees).
   */
  function vindCombinatie(kandidaten, doelBedrag) {
    if (doelBedrag == null || !kandidaten.length) return null;
    const doel = Math.round(doelBedrag * 100);
    const zoekIn = (set) => {
      const n = Math.min(set.length, 25);
      const cents = set.slice(0, n).map((f) => Math.round(f.bedrag * 100) * (f.teken || 1));
      for (let size = 1; size <= 4; size++) {
        const pick = [];
        const zoekSub = (start, rest) => {
          if (pick.length === size) return rest === 0;
          for (let i = start; i < n; i++) {
            pick.push(i);
            if (zoekSub(i + 1, rest - cents[i])) return true;
            pick.pop();
          }
          return false;
        };
        if (zoekSub(0, doel)) return pick.map((i) => set[i]);
      }
      return null;
    };
    const positief = kandidaten.filter((f) => (f.teken || 1) > 0);
    return zoekIn(positief) || (positief.length < kandidaten.length ? zoekIn(kandidaten) : null);
  }

  /**
   * Kandidaat-bankregels om een losse factuur aan te koppelen (vanuit de controle-lijst).
   * Richting: verkoop → bank-in, inkoop → bank-uit. Exact bedrag + dichtstbijzijnde datum eerst;
   * bankregels waar deze factuur al aan hangt vallen af. Met zoekterm: filter op omschrijving.
   */
  function bankKandidatenVoorFactuur(factuur, bankRows, zoek = "") {
    const isVerkoop = String(factuur.boek || "").toLowerCase() === "verkoop";
    const q = String(zoek || "").trim().toLowerCase();
    const uit = [];
    for (const r of bankRows) {
      if (r.isEmpty || (r.in == null && r.uit == null)) continue;
      const kant = isVerkoop ? r.in : r.uit;
      // Met zoekterm ook de tegenrichting tonen: een fee-factuur (inkoop) hoort
      // bij de uitbetalings-bankregel (in) waar hij op ingehouden is.
      if (kant == null && !q) continue;
      if (q && !`${r.omschrijving} ${r.opmerking}`.toLowerCase().includes(q)) continue;
      const exact = kant != null && factuur.bedrag != null && Math.abs(kant - factuur.bedrag) < 0.005;
      if (!q && !exact) continue; // zonder zoekterm alleen exacte bedragen
      uit.push({ ...r, exact });
    }
    uit.sort((a, b) => {
      if (a.exact !== b.exact) return a.exact ? -1 : 1;
      const da = factuur.datum && a.datum ? Math.abs(a.datum - factuur.datum) : Infinity;
      const db = factuur.datum && b.datum ? Math.abs(b.datum - factuur.datum) : Infinity;
      return da - db;
    });
    return uit;
  }

  // === Bank-matching (bedrag exact, datum ±dagen, richting) ===
  // Bankregels/facturen die al gekoppeld zijn doen niet meer mee — dat voorkomt
  // dubbel afvinken van dezelfde factuur.
  function bankMatchesForInvoice(bankRows, bedrag, datumIso, isVerkoop, dagen = MATCH_DAYS) {
    const datum = isoToDate(datumIso);
    if (bedrag == null || !datum) return [];
    return bankRows.filter((r) => {
      if (r.isEmpty || r.ingeboekt || r.koppelingRaw) return false;
      if (!r.datum || daysBetween(r.datum, datum) > dagen) return false;
      const kant = isVerkoop ? r.in : r.uit;
      return kant != null && Math.abs(kant - bedrag) < 0.005;
    });
  }

  function invoiceMatchesForBankRow(facturen, bankRow, index, dagen = MATCH_DAYS) {
    if (!bankRow.datum) return [];
    return facturen.filter((f) => {
      if (!f.datum || f.bedrag == null) return false;
      if (index && index.has(`${f.boek?.toLowerCase() === "verkoop" ? "verkoop" : "inkoop"}|${f.excelRow}`)) return false;
      if (daysBetween(f.datum, bankRow.datum) > dagen) return false;
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
    const base = `${yymmdd} ${clean(bedrijf)} ${clean(factuurnummer)}`.replace(/\s+/g, " ").trim();
    return base + (ext || "");
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

  /** Ontleed een geboekte reisomschrijving terug naar naam, km en bestemming. */
  function parseReisOmschrijving(oms) {
    const m = String(oms || "").match(
      /^Transportkosten\s+(.+?)\s*\(2x\s*([\d.,]+)\s*km\s*-\s*[^-]+-\s*(.+?)\s*-\s*[^-]+\)$/i
    );
    if (!m) return null;
    const km = parseUserAmount(m[2]);
    if (!km) return null;
    return { naam: m[1].trim(), km, bestemming: m[3].trim() };
  }

  /** Haal eerdere reisbestemmingen uit de inkoop-historie (Transportkosten-patroon). */
  function reisFavorietenUitHistorie(inkoopHistory) {
    const seen = new Map();
    for (const h of inkoopHistory) {
      const parsed = parseReisOmschrijving(h.omschrijving);
      if (!parsed) continue;
      const naam = parsed.naam.replace(/\b(kennismaking|werkdag)\b/gi, "").replace(/\s+/g, " ").trim();
      const km = parsed.km;
      const bestemming = parsed.bestemming;
      const key = naam.toLowerCase();
      if (!seen.has(key) && km) {
        seen.set(key, { naam, km, bestemming, project: h.project || "", count: 1 });
      } else if (seen.has(key)) {
        seen.get(key).count += 1;
      }
    }
    return [...seen.values()].sort((a, b) => b.count - a.count);
  }

  // === Reis-voorstellen uit de urenregistratie ===

  /** Urenregels: alleen datum, opdrachtgever en locatie zijn hier interessant. */
  function parseUrenRows(values, headerRow) {
    const rows = [];
    for (let i = 1; i < values.length; i++) {
      const v = values[i];
      const datum = serialToDate(v[0]);
      if (!datum) continue;
      rows.push({
        excelRow: headerRow + i,
        datum,
        datumStr: formatDateNl(datum),
        opdrachtgever: cellText(v[3]),
        project: cellText(v[4]),
        locatie: cellText(v[6]),
      });
    }
    return rows;
  }

  /**
   * Dagen waarop je volgens de uren ergens anders dan thuis werkte, zonder
   * geboekte rit. Bekende bestemmingen krijgen km mee; onbekende locaties
   * worden ook voorgesteld (fav = null) zodat je ze in één keer kunt inrichten.
   * `afgewezen` bevat keys ("datumIso|naam") die de gebruiker heeft weggedrukt.
   */
  function reisVoorstellen(urenRows, inkoopHistory, bestemmingen, thuisPlaats, afgewezen = [], maxDagen = 60) {
    const thuis = normalizeParty(thuisPlaats || "Aalten");
    const afgSet = new Set(afgewezen);
    const nu = new Date();
    const cutoff = new Date(nu.getTime() - maxDagen * 86400000);

    // Al geboekte ritten per dag: datumIso -> [naam...]
    const geboekt = new Map();
    for (const h of inkoopHistory) {
      const p = parseReisOmschrijving(h.omschrijving);
      if (!p || !h.datum) continue;
      const key = dateToIso(h.datum);
      if (!geboekt.has(key)) geboekt.set(key, []);
      geboekt.get(key).push(p.naam);
    }

    const perKey = new Map();
    for (const u of urenRows) {
      if (u.datum < cutoff || u.datum > nu) continue;
      const loc = normalizeParty(u.locatie);
      if (!loc || loc === thuis || loc.includes(thuis)) continue;
      const best = bestemmingen.find(
        (b) => partyNamesMatch(b.naam, u.locatie) || partyNamesMatch(b.naam, u.opdrachtgever)
      );
      const naam = best ? best.naam : u.locatie;
      const iso = dateToIso(u.datum);
      const key = `${iso}|${naam.toLowerCase()}`;
      if (afgSet.has(key)) continue;
      const ritten = geboekt.get(iso) || [];
      if (ritten.some((r) => partyNamesMatch(r, naam))) continue;
      if (!perKey.has(key)) {
        perKey.set(key, {
          key,
          datumIso: iso,
          datumStr: u.datumStr,
          fav: best || null,
          locatie: u.locatie,
          urenRijen: [],
        });
      }
      perKey.get(key).urenRijen.push(u.excelRow);
    }
    const voorstellen = [...perKey.values()];
    voorstellen.sort((a, b) => (a.datumIso < b.datumIso ? 1 : -1));
    return voorstellen.slice(0, 12);
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

  // === Overzichten ===

  function inJaar(r, jaar) {
    return !r.isEmpty && r.datum && r.datum.getUTCFullYear() === jaar;
  }

  /** Alle jaren waarin iets geboekt is, nieuwste eerst. */
  function beschikbareJaren(inkoopRows, verkoopRows) {
    const set = new Set();
    for (const r of [...inkoopRows, ...verkoopRows]) {
      if (!r.isEmpty && r.datum) set.add(r.datum.getUTCFullYear());
    }
    if (!set.size) set.add(new Date().getFullYear());
    return [...set].sort((a, b) => b - a);
  }

  /** Omzet, kosten en resultaat per maand (netto, dus exclusief BTW). */
  function maandCijfers(inkoopRows, verkoopRows, jaar) {
    const maanden = Array.from({ length: 12 }, () => ({ omzet: 0, kosten: 0 }));
    for (const r of verkoopRows) {
      if (inJaar(r, jaar)) maanden[r.datum.getUTCMonth()].omzet += r.netto || 0;
    }
    for (const r of inkoopRows) {
      if (inJaar(r, jaar)) maanden[r.datum.getUTCMonth()].kosten += r.netto || 0;
    }
    const omzet = maanden.reduce((s, m) => s + m.omzet, 0);
    const kosten = maanden.reduce((s, m) => s + m.kosten, 0);
    return { maanden, omzet, kosten, resultaat: omzet - kosten };
  }

  /**
   * BTW per kwartaal in aangifte-termen.
   * Verlegde BTW (EU) staat zowel bij het verschuldigde als bij de voorbelasting,
   * precies zoals de toelichting in het werkboek beschrijft — per saldo nul.
   */
  function btwAangifte(inkoopRows, verkoopRows, jaar) {
    const q = Array.from({ length: 4 }, () => ({
      omzetBelast: 0,
      btwOmzet: 0,
      omzetNul: 0,
      verlegdBedrag: 0,
      btwVerlegd: 0,
      voorbelasting: 0,
    }));
    for (const r of verkoopRows) {
      if (!inJaar(r, jaar)) continue;
      const s = q[Math.floor(r.datum.getUTCMonth() / 3)];
      if ((r.btw || 0) > 0) {
        s.omzetBelast += r.netto || 0;
        s.btwOmzet += r.btwBedrag || 0;
      } else {
        s.omzetNul += r.netto || 0;
      }
    }
    for (const r of inkoopRows) {
      if (!inJaar(r, jaar)) continue;
      const s = q[Math.floor(r.datum.getUTCMonth() / 3)];
      s.voorbelasting += r.btwBedrag || 0;
      if (r.verlegd) {
        s.verlegdBedrag += r.bedrag || 0;
        s.btwVerlegd += r.btwTeBetalen || 0;
      }
    }
    return q.map((s, i) => ({
      q: `Q${i + 1}`,
      ...s,
      verschuldigd: s.btwOmzet + s.btwVerlegd,
      terugTeVragen: s.voorbelasting + s.btwVerlegd,
      saldo: s.btwOmzet - s.voorbelasting,
    }));
  }

  /** Top-N groepering, bijvoorbeeld omzet per klant of kosten per categorie. */
  function topGroepen(rows, jaar, keyFn, valFn, n = 8) {
    const map = new Map();
    for (const r of rows) {
      if (!inJaar(r, jaar)) continue;
      const k = (keyFn(r) || "").trim();
      if (!k) continue;
      map.set(k, (map.get(k) || 0) + (valFn(r) || 0));
    }
    return [...map.entries()]
      .map(([naam, bedrag]) => ({ naam, bedrag }))
      .filter((x) => Math.abs(x.bedrag) >= 0.01)
      .sort((a, b) => b.bedrag - a.bedrag)
      .slice(0, n);
  }

  /** Kilometers en kosten uit de geboekte reisregels van een jaar. */
  function reisTotaal(inkoopRows, jaar) {
    let km = 0;
    let bedrag = 0;
    let ritten = 0;
    for (const r of inkoopRows) {
      if (!inJaar(r, jaar)) continue;
      const p = parseReisOmschrijving(r.omschrijving);
      if (!p) continue;
      km += p.km * 2; // heen en terug
      bedrag += r.bedrag || 0;
      ritten++;
    }
    return { km, bedrag, ritten };
  }

  global.BoekModel = {
    SHEET_BANK, SHEET_VERKOOP, SHEET_INKOOP,
    TABLE_BANK, TABLE_VERKOOP, TABLE_INKOOP,
    BANK, INK, VRK, MATCH_DAYS, REKENINGEN,
    serialToDate, dateToIso, isoToDate, formatDateNl, todayIso, daysBetween, isoToYymmdd,
    parseCellAmount, parseUserAmount, fmtEur, fmtAmountInput, cellText, cellBool,
    parseBankRows, parseInkoopRows, parseVerkoopRows,
    firstEmptyBankSlot, lastFilledBankRowBefore, saldoFormula, saldiPerRekening,
    priveOverzicht, firstEmptyBoekSlot,
    normalizeParty, partyNamesMatch, buildIntel, partyDefaults, findDuplicate,
    bankMatchesForInvoice, invoiceMatchesForBankRow,
    koppelWaarde, parseKoppelingen, koppelingIndex, facturenZonderBank, bankZonderKoppeling,
    koppelKandidaten, vindCombinatie, bankKandidatenVoorFactuur,
    normalizeLand, countryToType,
    parseVerkoopFilename, parseInkoopFilename, buildInkoopFilename,
    formatKm, buildReisOmschrijving, reisBedrag, reisFavorietenUitHistorie, parseReisOmschrijving,
    parseUrenRows, reisVoorstellen,
    kwartaalOverzicht,
    beschikbareJaren, maandCijfers, btwAangifte, topGroepen, reisTotaal,
  };
})(window);
