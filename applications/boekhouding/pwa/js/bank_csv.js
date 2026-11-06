/**
 * Bankafschrift inlezen: CSV (Rabobank, Knab, ING-achtig) of CAMT.053 (XML,
 * de standaard "boekhoudexport" van Rabo en Knab). Pure functies, geen I/O.
 * CSV-kolommen worden herkend aan hun kopnaam, zodat een andere volgorde of
 * een extra kolom niets uitmaakt. CAMT.053 heeft vaste velden plus begin- en
 * eindsaldo, waarmee het bestand zichzelf controleert.
 */
(function (global) {
  const M = () => global.BoekModel;

  /** CSV-tekst → rijen (scheidingsteken , of ; automatisch; aanhalingstekens ondersteund). */
  function parseCsv(tekst) {
    const t = String(tekst || "").replace(/^﻿/, "");
    const eersteRegels = t.split(/\r?\n/).slice(0, 5).join("\n");
    const sep = (eersteRegels.match(/;/g) || []).length > (eersteRegels.match(/,/g) || []).length ? ";" : ",";
    const rijen = [];
    let rij = [];
    let veld = "";
    let inQuote = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (inQuote) {
        if (c === '"') {
          if (t[i + 1] === '"') {
            veld += '"';
            i++;
          } else inQuote = false;
        } else veld += c;
      } else if (c === '"') inQuote = true;
      else if (c === sep) {
        rij.push(veld);
        veld = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && t[i + 1] === "\n") i++;
        rij.push(veld);
        if (rij.some((v) => v.trim() !== "")) rijen.push(rij);
        rij = [];
        veld = "";
      } else veld += c;
    }
    rij.push(veld);
    if (rij.some((v) => v.trim() !== "")) rijen.push(rij);
    return rijen.map((r) => r.map((v) => v.trim()));
  }

  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  // Kopnamen per betekenis, genormaliseerd (zonder spaties/tekens).
  const KOPPEN = {
    iban: ["ibanbban", "rekeningnummer", "rekening", "iban", "eigenrekening"],
    datum: ["datum", "transactiedatum", "boekdatum", "boekingsdatum", "date"],
    bedrag: ["bedrag", "bedrageur", "amount", "transactiebedrag"],
    afbij: ["creditdebet", "afbij", "debetcredit", "dc"],
    tegenpartij: ["naamtegenpartij", "tegenrekeninghouder", "naamomschrijving", "naam", "tegenpartij"],
    tegenrekening: ["tegenrekeningibanbban", "tegenrekeningnummer", "tegenrekening"],
    omschrijving: ["omschrijving1", "omschrijving", "mededelingen", "omschrijving2", "omschrijving3", "description"],
    volgnr: ["volgnr", "referentie", "transactiereferentie"],
  };

  /** Vindt de koprij en welke kolom wat is. */
  function herkenKoppen(rijen) {
    for (let i = 0; i < Math.min(rijen.length, 10); i++) {
      const kop = rijen[i].map(norm);
      const vind = (namen) => {
        for (const n of namen) {
          const j = kop.indexOf(n);
          if (j >= 0) return j;
        }
        return -1;
      };
      const k = {
        iban: vind(KOPPEN.iban),
        datum: vind(KOPPEN.datum),
        bedrag: vind(KOPPEN.bedrag),
        afbij: vind(KOPPEN.afbij),
        tegenpartij: vind(KOPPEN.tegenpartij),
        tegenrekening: vind(KOPPEN.tegenrekening),
        volgnr: vind(KOPPEN.volgnr),
        omschrijvingen: KOPPEN.omschrijving.map((n) => kop.indexOf(n)).filter((j) => j >= 0),
      };
      if (k.datum >= 0 && k.bedrag >= 0) return { rij: i, ...k };
    }
    return null;
  }

  /** "2026-10-26", "26-10-2026", "20261026", "26/10/2026" → ISO. */
  function datumIso(s) {
    const t = String(s || "").trim();
    let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    return "";
  }

  /** "+1.234,56", "-12,50", "12.50", "1,234.56" → getal (met teken). */
  function bedragGetal(s) {
    let t = String(s || "").trim().replace(/[€\s]/g, "").replace(/[−–—]/g, "-");
    if (!t) return null;
    const neg = /^-/.test(t) || /-$/.test(t);
    t = t.replace(/^[+-]|[+-]$/g, "");
    if (t.includes(",") && t.includes(".")) {
      t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
    } else if (t.includes(",")) t = t.replace(",", ".");
    const f = parseFloat(t);
    if (!Number.isFinite(f)) return null;
    return Math.round((neg ? -f : f) * 100) / 100;
  }

  const ibanNorm = (s) => String(s || "").replace(/\s/g, "").toUpperCase();

  /** CSV-tekst → transacties [{datumIso, bedrag (+ = bij), tegenpartij, omschrijving, iban}]. */
  function leesTransacties(tekst) {
    const rijen = parseCsv(tekst);
    const k = herkenKoppen(rijen);
    if (!k) throw new Error("Geen datum- en bedragkolom gevonden. Is dit een CSV-export van de bank?");
    const uit = [];
    for (const r of rijen.slice(k.rij + 1)) {
      const datum = datumIso(r[k.datum]);
      let bedrag = bedragGetal(r[k.bedrag]);
      if (!datum || bedrag == null) continue;
      if (k.afbij >= 0) {
        const ab = String(r[k.afbij] || "").trim().toLowerCase();
        if (ab === "d" || ab === "af" || ab === "debet" || ab === "debit") bedrag = -Math.abs(bedrag);
        else if (ab === "c" || ab === "bij" || ab === "credit") bedrag = Math.abs(bedrag);
      }
      const oms = k.omschrijvingen
        .map((j) => r[j])
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      uit.push({
        datumIso: datum,
        bedrag,
        tegenpartij: (k.tegenpartij >= 0 ? r[k.tegenpartij] : "") || "",
        tegenrekening: k.tegenrekening >= 0 ? ibanNorm(r[k.tegenrekening]) : "",
        omschrijving: oms,
        iban: k.iban >= 0 ? ibanNorm(r[k.iban]) : "",
        volgnr: k.volgnr >= 0 ? r[k.volgnr] : "",
      });
    }
    return uit;
  }

  // === CAMT.053 (XML) ===
  // Namespace-onafhankelijk (camt.053.001.02 t/m .08): alleen op localName.
  const kids = (el, naam) => (el ? Array.from(el.childNodes || []).filter((n) => n.nodeType === 1 && (!naam || n.localName === naam)) : []);
  const kind = (el, naam) => kids(el, naam)[0] || null;
  const pad = (el, p) => p.split("/").reduce((e, n) => (e ? kind(e, n) : null), el);
  const tekstVan = (el) => (el ? String(el.textContent || "").replace(/\s+/g, " ").trim() : "");
  const alles = (el, naam, uit = []) => {
    for (const k of kids(el)) {
      if (k.localName === naam) uit.push(k);
      alles(k, naam, uit);
    }
    return uit;
  };

  function isCamt(tekst) {
    const t = String(tekst || "").replace(/^\uFEFF/, "").trimStart().slice(0, 600);
    return t.startsWith("<") && /camt\.05[23]|BkToCstmrStmt/i.test(t);
  }

  /** Bedrag uit <Amt> met <CdtDbtInd> ernaast: + = bij (CRDT), - = af (DBIT). */
  function camtBedrag(el) {
    const f = parseFloat(tekstVan(kind(el, "Amt")));
    if (!Number.isFinite(f)) return null;
    const teken = tekstVan(kind(el, "CdtDbtInd")) === "DBIT" ? -1 : 1;
    return Math.round(teken * f * 100) / 100;
  }

  const camtDatum = (el) => datumIso(tekstVan(kind(el, "Dt")) || tekstVan(kind(el, "DtTm")).slice(0, 10));

  /**
   * CAMT.053-tekst → {transacties, afschriften}. Eén transactie per boeking
   * (<Ntry>, alleen status BOOK), met het bedrag zoals de bank het boekte.
   * Per afschrift: IBAN, periode, begin- en eindsaldo en of die kloppen.
   */
  function leesCamt(tekst) {
    if (typeof DOMParser === "undefined") throw new Error("XML lezen wordt hier niet ondersteund.");
    const doc = new DOMParser().parseFromString(String(tekst).replace(/^\uFEFF/, ""), "application/xml");
    if (!doc || doc.getElementsByTagName("parsererror").length) throw new Error("Dit XML-bestand is beschadigd of geen CAMT.053.");
    const stmts = alles(doc.documentElement ? { childNodes: [doc.documentElement] } : doc, "Stmt");
    if (!stmts.length) throw new Error("Geen afschrift (Stmt) gevonden. Is dit een CAMT.053-bestand?");
    const transacties = [];
    const afschriften = [];
    for (const st of stmts) {
      const iban = ibanNorm(tekstVan(pad(st, "Acct/Id/IBAN")));
      const saldo = {};
      for (const b of kids(st, "Bal")) {
        const tp = tekstVan(pad(b, "Tp/CdOrPrtry/Cd"));
        if (tp === "OPBD" || tp === "CLBD") saldo[tp] = { bedrag: camtBedrag(b), datumIso: camtDatum(kind(b, "Dt")) };
      }
      let netto = 0;
      let aantal = 0;
      for (const n of kids(st, "Ntry")) {
        const sts = tekstVan(kind(n, "Sts")) || tekstVan(pad(n, "Sts/Cd"));
        if (sts && sts !== "BOOK") continue; // nog niet geboekt (PDNG) of informatief
        const bedrag = camtBedrag(n);
        const datum = camtDatum(kind(n, "BookgDt")) || camtDatum(kind(n, "ValDt"));
        if (bedrag == null || !datum) continue;
        const txs = alles(n, "TxDtls");
        const een = txs.length === 1 ? txs[0] : null;
        // Tegenpartij: bij een bijschrijving de betaler, bij een afschrijving de ontvanger.
        const rol = bedrag >= 0 ? "Dbtr" : "Cdtr";
        const rp = een ? kind(een, "RltdPties") : null;
        const naamVan = (r) => tekstVan(pad(rp, `${r}/Nm`)) || tekstVan(pad(rp, `${r}/Pty/Nm`));
        const tegenpartij = rp ? naamVan(rol) || naamVan(rol === "Dbtr" ? "UltmtDbtr" : "UltmtCdtr") : "";
        const tegenrekening = rp ? ibanNorm(tekstVan(pad(rp, `${rol}Acct/Id/IBAN`))) : "";
        const ri = een ? kind(een, "RmtInf") : null;
        const delen = ri ? kids(ri, "Ustrd").map(tekstVan) : [];
        if (ri) for (const ref of alles(ri, "Ref")) delen.push(tekstVan(ref));
        let omschrijving = delen.filter(Boolean).join(" ").trim();
        if (!omschrijving) omschrijving = tekstVan(kind(n, "AddtlNtryInf")) || (een ? tekstVan(kind(een, "AddtlTxInf")) : "");
        if (txs.length > 1 && !tegenpartij) omschrijving = `${omschrijving || "Verzamelboeking"} (${txs.length} posten)`.trim();
        transacties.push({
          datumIso: datum,
          bedrag,
          tegenpartij,
          tegenrekening,
          omschrijving: omschrijving.replace(/\s+/g, " ").trim(),
          iban,
          volgnr: tekstVan(kind(n, "AcctSvcrRef")) || tekstVan(kind(n, "NtryRef")),
        });
        netto = Math.round((netto + bedrag) * 100) / 100;
        aantal++;
      }
      const ft = pad(st, "FrToDt");
      const van = datumIso(tekstVan(kind(ft, "FrDtTm")).slice(0, 10)) || saldo.OPBD?.datumIso || "";
      const tot = datumIso(tekstVan(kind(ft, "ToDtTm")).slice(0, 10)) || saldo.CLBD?.datumIso || "";
      const begin = saldo.OPBD?.bedrag;
      const eind = saldo.CLBD?.bedrag;
      const klopt = begin != null && eind != null ? Math.round((begin + netto) * 100) === Math.round(eind * 100) : null;
      afschriften.push({ iban, van, tot, begin: begin ?? null, eind: eind ?? null, netto, aantal, klopt });
    }
    return { transacties, afschriften };
  }

  /** Elk bankbestand → {transacties, afschriften} (afschriften alleen bij CAMT). */
  function leesBestand(tekst) {
    if (isCamt(tekst)) return leesCamt(tekst);
    return { transacties: leesTransacties(tekst), afschriften: [] };
  }

  /**
   * Saldo van een lopende rekening in het bankboek t/m een datum, plus de
   * regels die je nu gaat toevoegen. Om naast het eindsaldo van de bank te leggen.
   */
  function bankboekSaldoTot(bankRows, rekening, totIso, extra = []) {
    let cent = 0;
    for (const r of bankRows || []) {
      if (r.isEmpty || r.rekening !== rekening || !r.datum) continue;
      if (M().dateToIso(r.datum) > totIso) continue;
      cent += Math.round(((r.in || 0) - (r.uit || 0)) * 100);
    }
    for (const t of extra) if (t.datumIso <= totIso) cent += Math.round(t.bedrag * 100);
    return cent / 100;
  }

  /**
   * Rekening in het bankboek bij een IBAN: alleen wat bekend is (eerder gekozen
   * of vooraf ingesteld). Een onbekend Rabo- of Knab-nummer kan ook een
   * spaarrekening zijn, dus dan kies je hem zelf in het voorbeeld.
   */
  function rekeningVoorIban(iban, bekend = {}) {
    return bekend[ibanNorm(iban)] || "";
  }

  /** Suggestie voor een onbekend IBAN (alleen als voorstel in de keuzelijst). */
  function bankVanIban(iban) {
    const i = ibanNorm(iban);
    if (/^NL\d\dRABO/.test(i)) return "Rabo";
    if (/^NL\d\dKNAB/.test(i)) return "Knab";
    return "";
  }

  /**
   * Welke transacties staan er al in het bankboek? Zelfde rekening en bedrag,
   * eerst op precies dezelfde datum, anders tot 3 dagen ernaast (een met de
   * hand ingevoerde datum wijkt soms een dag af). Elke bankregel telt maar
   * één keer, zodat twee echt gelijke betalingen allebei goed gaan.
   * Geeft per transactie {status: "nieuw"|"dubbel"|"misschien"|"afgesloten", match}.
   */
  function vergelijk(transacties, bankRows, rekeningVan, afgeslotenTot) {
    const vrij = (bankRows || []).filter((r) => !r.isEmpty && r.datum);
    const gebruikt = new Set();
    const cent = (v) => Math.round((v || 0) * 100);
    const zoek = (t, rek, maxDagen) => {
      const d = M().isoToDate(t.datumIso);
      let beste = null;
      for (const r of vrij) {
        if (gebruikt.has(r.excelRow) || r.rekening !== rek) continue;
        if (cent((r.in || 0) - (r.uit || 0)) !== cent(t.bedrag)) continue;
        const dagen = Math.abs((r.datum - d) / 86400000);
        if (dagen > maxDagen) continue;
        if (!beste || dagen < beste.dagen) beste = { r, dagen };
      }
      return beste;
    };
    const uit = transacties.map((t) => ({ t, rekening: rekeningVan(t), status: "nieuw", match: null }));
    // Eerst alle exacte treffers, dan pas de bijna-treffers.
    for (const x of uit) {
      const b = x.rekening ? zoek(x.t, x.rekening, 0) : null;
      if (b) {
        gebruikt.add(b.r.excelRow);
        x.status = "dubbel";
        x.match = b.r;
      }
    }
    for (const x of uit) {
      if (x.status !== "nieuw") continue;
      const b = x.rekening ? zoek(x.t, x.rekening, 3) : null;
      if (b) {
        gebruikt.add(b.r.excelRow);
        x.status = "misschien";
        x.match = b.r;
      } else if (afgeslotenTot && x.t.datumIso <= afgeslotenTot) {
        x.status = "afgesloten";
      }
    }
    return uit;
  }

  /** Transactie → velden voor een nieuwe bankregel (bank_add). */
  function naarBankregel(t, rekening) {
    const naam = (t.tegenpartij || t.omschrijving || "Onbekend").replace(/\s+/g, " ").trim().slice(0, 60);
    return {
      datumIso: t.datumIso,
      omschrijving: naam,
      in: t.bedrag > 0 ? t.bedrag : null,
      uit: t.bedrag < 0 ? -t.bedrag : null,
      opmerking: (t.omschrijving || "").slice(0, 120),
      rekening,
      ingeboekt: false,
      koppeling: "",
    };
  }

  /**
   * Standaard aangevinkt? Nieuw, met rekening. Op een spaarrekening alleen rente
   * en kosten: overboekingen van/naar lopend staan al aan de lopende kant.
   */
  function standaardAan(x) {
    if (x.status !== "nieuw" || !x.rekening) return false;
    if (/spaar/i.test(x.rekening)) return /rente|kosten/i.test(`${x.t.omschrijving} ${x.t.tegenpartij}`);
    return true;
  }

  global.BoekBankCsv = { parseCsv, herkenKoppen, datumIso, bedragGetal, leesTransacties, isCamt, leesCamt, leesBestand, bankboekSaldoTot, rekeningVoorIban, bankVanIban, standaardAan, vergelijk, naarBankregel };
})(window);
