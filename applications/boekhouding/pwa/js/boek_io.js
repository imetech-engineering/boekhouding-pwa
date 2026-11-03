/**
 * Hoog-niveau Excel-I/O voor Boekhouding_IMeTech.xlsx via Graph Workbook API.
 * Schrijft nooit in formulekolommen (B, C, M..P) en nooit in de keuzelijst-kolommen (Q/O).
 */
(function (global) {
  const M = () => global.BoekModel;
  const W = () => global.BoekWorkbook;

  function drivePath() {
    return global.BOEK_CONFIG.graph.workbookPath;
  }

  // === Rijcontrole: alleen schrijven als er nog staat wat we verwachten ===

  /** Rij staat niet meer waar de app hem verwacht (gesorteerd, ingevoegd, ander apparaat). */
  class RijVerschovenError extends Error {
    constructor(message) {
      super(message);
      this.name = "RijVerschovenError";
    }
  }

  const BOEKNAAM = { bank: "bankboek", inkoop: "inkoopboek", verkoop: "verkoopboek" };
  const LAATSTE_KOLOM = { bank: "I", inkoop: "V", verkoop: "Q" };

  function sheetVan(soort) {
    return soort === "bank" ? M().SHEET_BANK : soort === "inkoop" ? M().SHEET_INKOOP : M().SHEET_VERKOOP;
  }

  function tabelVan(soort) {
    return soort === "bank" ? M().TABLE_BANK : soort === "inkoop" ? M().TABLE_INKOOP : M().TABLE_VERKOOP;
  }

  function parseVan(soort, values, headerRow) {
    if (soort === "bank") return M().parseBankRows(values, headerRow);
    if (soort === "inkoop") return M().parseInkoopRows(values, headerRow);
    return M().parseVerkoopRows(values, headerRow);
  }

  function verschovenMelding(soort, excelRow) {
    return (
      `Regel ${excelRow} in het ${BOEKNAAM[soort]} is in het werkboek veranderd ` +
      `(gesorteerd, rij ingevoegd of op een ander apparaat aangepast). ` +
      `Er is niets geschreven. De lijst wordt opnieuw ingelezen; probeer het daarna nog eens.`
    );
  }

  /**
   * Gooit RijVerschovenError als de rij in het werkboek niet meer de regel is
   * die de app verwacht. Zonder verwachting (oude wachtrij-items) gebeurt er niets.
   */
  async function controleerRij(path, token, sid, soort, excelRow, verwacht, { leegIsKlaar = false } = {}) {
    const v = verwacht?.[`${soort}|${excelRow}`];
    if (v == null) return "onbekend";
    const vals = await W().readValues(
      path, token, sid, sheetVan(soort), `A${excelRow}:${LAATSTE_KOLOM[soort]}${excelRow}`
    );
    const nu = M().rijIdentiteit(soort, M().parseEnkeleRij(soort, vals[0], excelRow));
    // Verwijderen dat al gelukt is (eerdere poging, antwoord kwam niet aan): klaar.
    if (leegIsKlaar && nu === "leeg") return "leeg";
    if (!klopt(v, nu)) throw new RijVerschovenError(verschovenMelding(soort, excelRow));
    return "ok";
  }

  /** Bankregels controleren zonder te schrijven (vóór inboeken + koppelen). */
  async function controleerBankRijen(token, excelRows, verwacht) {
    const rijen = (excelRows || []).filter((r) => verwacht?.[`bank|${r}`] != null);
    if (!rijen.length) return;
    const path = drivePath();
    return W().withSession(path, token, async (sid) => {
      for (const r of rijen) await controleerRij(path, token, sid, "bank", r, verwacht);
    });
  }

  /** Zelfde controle, maar op rijen die in deze sessie al gelezen zijn. */
  function controleerGelezen(soort, rows, excelRow, verwacht) {
    const v = verwacht?.[`${soort}|${excelRow}`];
    if (v == null) return;
    const nu = M().rijIdentiteit(soort, rows.find((r) => r.excelRow === excelRow));
    if (!klopt(v, nu)) throw new RijVerschovenError(verschovenMelding(soort, excelRow));
  }

  /**
   * Een verwachting is één identiteit, of een lijst: [vóór, na] bij een
   * bewerking, zodat het opnieuw versturen van een bewerking die al gelukt
   * was gewoon doorgaat.
   */
  function klopt(verwacht, nu) {
    return Array.isArray(verwacht) ? verwacht.includes(nu) : verwacht === nu;
  }

  /**
   * Bij het opnieuw afspelen van een nieuwe regel (na een netwerkfout of uit de
   * offline-wachtrij): staat hij er al? Dan is een eerdere poging gelukt en
   * mag hij er niet nog eens bij. telVooraf = hoeveel gelijke regels er al
   * waren toen de wijziging gemaakt werd (twee echt gelijke regels kan dus).
   * Geeft het rijnummer van de al geboekte regel terug, of null.
   */
  async function alGeboekt(path, token, sid, soort, fields, telVooraf) {
    const t = await W().readTableRange(path, token, tabelVan(soort), sid);
    const rows = parseVan(soort, t.values, t.headerRow);
    const sleutel = M().regelSleutel(soort, fields);
    const treffers = rows.filter((r) => !r.isEmpty && M().regelSleutel(soort, r) === sleutel);
    return treffers.length > (telVooraf || 0) ? treffers[treffers.length - 1].excelRow : null;
  }

  /** Lees alle drie de boeken in één keer (zonder sessie; values = berekende waarden). */
  async function loadAll(token) {
    const path = drivePath();
    const [bank, inkoop, verkoop] = await Promise.all([
      W().readTableRange(path, token, M().TABLE_BANK),
      W().readTableRange(path, token, M().TABLE_INKOOP),
      W().readTableRange(path, token, M().TABLE_VERKOOP),
    ]);
    return {
      bankHeaderRow: bank.headerRow,
      inkoopHeaderRow: inkoop.headerRow,
      verkoopHeaderRow: verkoop.headerRow,
      bankEndRow: bank.endRow,
      bankRows: M().parseBankRows(bank.values, bank.headerRow),
      inkoopRows: M().parseInkoopRows(inkoop.values, inkoop.headerRow),
      verkoopRows: M().parseVerkoopRows(verkoop.values, verkoop.headerRow),
      // Keuzelijsten uit de werkboek-kolommen Q (inkoop) en O (verkoop), rijen boven de data
      inkoopCategorieKeuzes: extractKeuzes(inkoop.values, M().INK.CAT_KEUZES),
      verkoopCategorieKeuzes: extractKeuzes(verkoop.values, M().VRK.CAT_KEUZES),
    };
  }

  function extractKeuzes(values, colIdx) {
    const out = [];
    for (let i = 1; i < values.length; i++) {
      const v = global.BoekModel.cellText(values[i][colIdx]);
      if (v && !out.includes(v)) out.push(v);
      if (out.length >= 30) break;
    }
    return out;
  }

  /**
   * Eerste vrije rij uit de regels die de app al in het geheugen heeft, met een
   * controle van alleen díe ene rij. Scheelt bij elke boeking het opnieuw lezen
   * van de hele tabel; klopt het niet, dan geeft dit null terug en leest de
   * aanroeper alsnog de tabel opnieuw in.
   */
  async function vrijeRijUitGeheugen(path, token, sid, sheet, hintRows, kiesSlot, laatsteKolom) {
    if (!hintRows?.length) return null;
    let rij = null;
    try {
      rij = kiesSlot(hintRows);
    } catch (_) {
      return null;
    }
    if (rij == null) return null;
    try {
      const vals = await W().readValues(path, token, sid, sheet, `A${rij}:${laatsteKolom}${rij}`);
      const cellen = vals[0] || [];
      const leeg = cellen.every((v) => v == null || String(v).trim() === "");
      return leeg ? rij : null;
    } catch (_) {
      return null; // bij twijfel de veilige route
    }
  }

  /** Rij in het geheugen als bezet markeren, zodat een volgende boeking doorschuift. */
  function markeerBezet(hintRows, excelRow) {
    const rij = hintRows?.find((r) => r.excelRow === excelRow);
    if (rij) {
      rij.isEmpty = false;
      rij.isEmptySlot = false;
    }
  }

  // === Bankboek ===

  /**
   * Nieuwe bankregel: eerste lege slot binnen Tabel1, saldo als formule per rekening.
   * fields: {datumIso, omschrijving, in, uit, opmerking, rekening, ingeboekt}
   */
  async function addBankRow(token, fields, hint, opties = {}) {
    const path = drivePath();
    return W().withSession(path, token, async (sid) => {
      const sheet = M().SHEET_BANK;
      if (opties.herhaling) {
        const al = await alGeboekt(path, token, sid, "bank", fields, opties.telVooraf);
        if (al != null) return { excelRow: al, alBestaand: true };
      }
      // Eerst de rijen die de app al heeft: alleen de gekozen rij controleren.
      // Zit hij binnen de tabel en is hij leeg, dan hoeft de tabel niet opnieuw.
      let targetRow = await vrijeRijUitGeheugen(
        path, token, sid, sheet, hint?.rows,
        (rows) => {
          const r = M().firstEmptyBankSlot(rows);
          return hint?.endRow && r > hint.endRow ? null : r;
        },
        "D"
      );
      if (targetRow != null) {
        await schrijfBankRegel(path, token, sid, sheet, targetRow, fields);
        markeerBezet(hint?.rows, targetRow);
        return { excelRow: targetRow };
      }
      // Verse leesronde binnen de sessie (bescherming tegen verouderde snapshot)
      const bank = await W().readTableRange(path, token, M().TABLE_BANK, sid);
      const rows = M().parseBankRows(bank.values, bank.headerRow);
      targetRow = M().firstEmptyBankSlot(rows);
      if (bank.endRow && targetRow > bank.endRow) {
        // Tabel vol → rij toevoegen via tabel-API (formule als '='-string gaat mee)
        await W().addTableRow(path, token, sid, M().TABLE_BANK, [
          fields.datumIso,
          fields.omschrijving || "",
          fields.in != null ? fields.in : null,
          fields.uit != null ? fields.uit : null,
          M().saldoFormula((bank.endRow || 5) + 1),
          !!fields.ingeboekt,
          fields.opmerking || "",
          fields.rekening || "",
          fields.koppeling || "",
        ]);
        return { excelRow: (bank.endRow || 5) + 1 };
      }
      await schrijfBankRegel(path, token, sid, sheet, targetRow, fields);
      return { excelRow: targetRow };
    });
  }

  /** Waardekolommen A..I van één bankregel; het saldo blijft een formule. */
  async function schrijfBankRegel(path, token, sid, sheet, excelRow, fields) {
    await W().patchValues(path, token, sid, sheet, `A${excelRow}:I${excelRow}`, [
      [
        fields.datumIso,
        fields.omschrijving || "",
        fields.in != null ? fields.in : "",
        fields.uit != null ? fields.uit : "",
        null, // saldo → formule hieronder
        !!fields.ingeboekt,
        fields.opmerking || "",
        fields.rekening || "",
        fields.koppeling || "",
      ],
    ]);
    await W().patchFormulas(path, token, sid, sheet, `E${excelRow}`, [
      [M().saldoFormula(excelRow)],
    ]);
  }

  /**
   * Bestaande bankregel bijwerken.
   * fields: {omschrijving?, opmerking?, rekening?, in?, uit?, updateAmounts:boolean}
   */
  async function updateBankRow(token, excelRow, fields, verwacht) {
    const path = drivePath();
    return W().withSession(path, token, async (sid) => {
      const sheet = M().SHEET_BANK;
      await controleerRij(path, token, sid, "bank", excelRow, verwacht);
      if (fields.omschrijving != null) {
        await W().patchValues(path, token, sid, sheet, `B${excelRow}`, [[fields.omschrijving]]);
      }
      if (fields.opmerking != null) {
        await W().patchValues(path, token, sid, sheet, `G${excelRow}`, [[fields.opmerking]]);
      }
      if (fields.rekening != null) {
        await W().patchValues(path, token, sid, sheet, `H${excelRow}`, [[fields.rekening]]);
      }
      if (fields.updateAmounts) {
        await W().patchValues(path, token, sid, sheet, `C${excelRow}:D${excelRow}`, [
          [fields.in != null ? fields.in : "", fields.uit != null ? fields.uit : ""],
        ]);
        // Saldo naar zelf-herstellende formule (ook als het nog een hard getal was)
        await W().patchFormulas(path, token, sid, sheet, `E${excelRow}`, [
          [M().saldoFormula(excelRow)],
        ]);
      }
    });
  }

  /** Bankregels als (niet) ingeboekt markeren. */
  async function setBankIngeboekt(token, excelRows, value = true, verwacht) {
    const path = drivePath();
    return W().withSession(path, token, async (sid) => {
      for (const row of excelRows) await controleerRij(path, token, sid, "bank", row, verwacht);
      for (const row of excelRows) {
        await W().patchValues(path, token, sid, M().SHEET_BANK, `F${row}`, [[!!value]]);
      }
    });
  }

  /**
   * Bankregel leegmaken. De saldo-formules zijn per rekening opgeteld en
   * verwijzen niet naar elkaar, dus andere rijen hebben hier geen last van.
   */
  async function deleteBankRow(token, excelRow, verwacht) {
    const path = drivePath();
    return W().withSession(path, token, async (sid) => {
      if ((await controleerRij(path, token, sid, "bank", excelRow, verwacht, { leegIsKlaar: true })) === "leeg") return;
      await W().patchValues(path, token, sid, M().SHEET_BANK, `A${excelRow}:I${excelRow}`, [
        ["", "", "", "", null, false, "", "", ""],
      ]);
    });
  }

  /**
   * Factuurkoppeling schrijven op bankregels (kolom I), plus ingeboekt-vinkje.
   * Bestaande koppelingen blijven staan; de nieuwe komt er met een komma achter.
   */
  async function koppelBank(token, items, verwacht) {
    const path = drivePath();
    return W().withSession(path, token, async (sid) => {
      const bank = await W().readTableRange(path, token, M().TABLE_BANK, sid);
      const rows = M().parseBankRows(bank.values, bank.headerRow);
      // Eerst alles controleren, dan pas schrijven: nooit een halve koppeling.
      for (const item of items) controleerGelezen("bank", rows, item.excelRow, verwacht);
      for (const item of items) {
        const huidig = rows.find((r) => r.excelRow === item.excelRow)?.koppelingRaw || "";
        // Per token samenvoegen: staat alles er al, dan niets schrijven.
        if (!M().bevatKoppeling(huidig, item.waarde)) {
          const nieuw = M().voegKoppelingToe(huidig, item.waarde);
          await W().patchValues(path, token, sid, M().SHEET_BANK, `I${item.excelRow}`, [[nieuw]]);
        }
        if (item.ingeboekt) {
          await W().patchValues(path, token, sid, M().SHEET_BANK, `F${item.excelRow}`, [[true]]);
        }
      }
    });
  }

  /** Koppeling van een bankregel weghalen. */
  /** Kolom I van een bankregel exact zetten; lege waarde = volledig ontkoppelen. */
  async function ontkoppelBank(token, excelRow, waarde = "", verwacht) {
    const path = drivePath();
    return W().withSession(path, token, async (sid) => {
      await controleerRij(path, token, sid, "bank", excelRow, verwacht);
      return W().patchValues(path, token, sid, M().SHEET_BANK, `I${excelRow}`, [[waarde || ""]]);
    });
  }

  /**
   * Koppelingen naar een verwijderde factuur uit kolom I halen. items:
   * [{excelRow, waarde, oud}] uit BoekModel.koppelingenZonderFactuur. Alleen de
   * tokens die toen weg moesten, gaan eruit; wat er sindsdien bij kwam blijft.
   */
  async function ruimKoppelingenOp(token, items) {
    if (!items?.length) return;
    const path = drivePath();
    const delen = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
    return W().withSession(path, token, async (sid) => {
      const bank = await W().readTableRange(path, token, M().TABLE_BANK, sid);
      const rows = M().parseBankRows(bank.values, bank.headerRow);
      for (const item of items) {
        const blijft = new Set(delen(item.waarde).map((t) => t.toLowerCase()));
        const weg = new Set(delen(item.oud).map((t) => t.toLowerCase()).filter((t) => !blijft.has(t)));
        if (!weg.size) continue;
        const huidig = rows.find((r) => r.excelRow === item.excelRow)?.koppelingRaw || "";
        const nieuw = delen(huidig).filter((t) => !weg.has(t.toLowerCase())).join(", ");
        if (nieuw !== huidig) {
          await W().patchValues(path, token, sid, M().SHEET_BANK, `I${item.excelRow}`, [[nieuw]]);
        }
      }
    });
  }

  // === Inkoopboek ===

  /** Waardekolommen D..V van één inkooprij; M..P (formules) en Q (keuzelijst) blijven ongemoeid. */
  function inkoopRowValues(fields) {
    const land = M().normalizeLand(fields.land);
    return [
      fields.leverancier || "",
      fields.omschrijving || "",
      fields.factuurnummer || "",
      fields.bedrag != null ? fields.bedrag : "",
      fields.bedragOrig != null ? fields.bedragOrig : "",
      fields.valuta || "",
      fields.wisselkoers || "",
      fields.btw != null ? fields.btw : "",
      !!fields.verlegd,
      null, null, null, null, // M, N, O, P (formules)
      null, // Q (keuzelijst)
      fields.categorie || "",
      !!fields.afschrijving,
      fields.opmerking || "",
      land || "",
      fields.project || "",
    ];
  }

  /**
   * Eén PATCH over A..V (B en C zijn formules: null = onaangeroerd). Zo kan een
   * netwerkfout nooit een half geschreven rij achterlaten.
   */
  async function writeInkoopRow(path, token, sid, excelRow, fields) {
    await W().patchValues(path, token, sid, M().SHEET_INKOOP, `A${excelRow}:V${excelRow}`, [
      [fields.datumIso, null, null, ...inkoopRowValues(fields)],
    ]);
  }

  /** Bestaande inkooprij overschrijven (bewerken). */
  async function updateInkoopRow(token, excelRow, fields, verwacht) {
    const path = drivePath();
    return W().withSession(path, token, async (sid) => {
      await controleerRij(path, token, sid, "inkoop", excelRow, verwacht);
      return writeInkoopRow(path, token, sid, excelRow, fields);
    });
  }

  /** Rij leegmaken i.p.v. verwijderen — zo blijven formules en rij-indexen intact. */
  async function deleteInkoopRow(token, excelRow, verwacht) {
    const path = drivePath();
    return W().withSession(path, token, async (sid) => {
      const sheet = M().SHEET_INKOOP;
      if ((await controleerRij(path, token, sid, "inkoop", excelRow, verwacht, { leegIsKlaar: true })) === "leeg") return;
      // Eén PATCH: A leeg, B/C formules, D..L leeg, M..Q formules/keuzelijst, R..V leeg.
      const leeg = (n) => Array(n).fill("");
      await W().patchValues(path, token, sid, sheet, `A${excelRow}:V${excelRow}`, [
        ["", null, null, ...leeg(9), null, null, null, null, null, ...leeg(5)],
      ]);
    });
  }

  /**
   * fields: {datumIso, leverancier, omschrijving, factuurnummer, bedrag, btw, verlegd,
   *          categorie, afschrijving, opmerking, land, project, bedragOrig, valuta, wisselkoers}
   */
  async function addInkoopRow(token, fields, hintRows, opties = {}) {
    const path = drivePath();
    return W().withSession(path, token, async (sid) => {
      if (opties.herhaling) {
        const al = await alGeboekt(path, token, sid, "inkoop", fields, opties.telVooraf);
        if (al != null) return { excelRow: al, alBestaand: true };
      }
      let targetRow = await vrijeRijUitGeheugen(
        path, token, sid, M().SHEET_INKOOP, hintRows, M().firstEmptyBoekSlot, "G"
      );
      if (targetRow == null) {
        const boek = await W().readTableRange(path, token, M().TABLE_INKOOP, sid);
        const rows = M().parseInkoopRows(boek.values, boek.headerRow);
        targetRow = M().firstEmptyBoekSlot(rows);
      }
      const land = M().normalizeLand(fields.land);
      if (targetRow == null) {
        // Tabel vol → rij toevoegen; nulls laten formulekolommen door de tabel invullen
        await W().addTableRow(path, token, sid, M().TABLE_INKOOP, [
          fields.datumIso, null, null,
          fields.leverancier || "", fields.omschrijving || "", fields.factuurnummer || "",
          fields.bedrag != null ? fields.bedrag : null,
          fields.bedragOrig != null ? fields.bedragOrig : null,
          fields.valuta || null, fields.wisselkoers || null,
          fields.btw != null ? fields.btw : null, !!fields.verlegd,
          null, null, null, null,
          null, // Q keuzelijst nooit beschrijven (fix)
          fields.categorie || null, !!fields.afschrijving, fields.opmerking || "",
          land || null, fields.project || null,
        ]);
        return { excelRow: null };
      }
      await writeInkoopRow(path, token, sid, targetRow, fields);
      markeerBezet(hintRows, targetRow);
      return { excelRow: targetRow };
    });
  }

  // === Verkoopboek ===

  /** Waardekolommen D..Q van één verkooprij; M/N (formules) en O (keuzelijst) blijven ongemoeid. */
  function verkoopRowValues(fields) {
    const land = M().normalizeLand(fields.land);
    return [
      fields.klant || "",
      fields.omschrijving || "",
      fields.factuurnummer || "",
      fields.bedrag != null ? fields.bedrag : "",
      land || "",
      fields.bedragOrig != null ? fields.bedragOrig : "",
      fields.valuta || "",
      fields.wisselkoers || "",
      fields.btw != null ? fields.btw : "",
      null, null, // M, N (formules)
      null, // O (keuzelijst)
      fields.categorie || "",
      fields.opmerking || "",
    ];
  }

  /** Eén PATCH over A..Q (B en C zijn formules: null = onaangeroerd). */
  async function writeVerkoopRow(path, token, sid, excelRow, fields) {
    await W().patchValues(path, token, sid, M().SHEET_VERKOOP, `A${excelRow}:Q${excelRow}`, [
      [fields.datumIso, null, null, ...verkoopRowValues(fields)],
    ]);
  }

  async function updateVerkoopRow(token, excelRow, fields, verwacht) {
    const path = drivePath();
    return W().withSession(path, token, async (sid) => {
      await controleerRij(path, token, sid, "verkoop", excelRow, verwacht);
      return writeVerkoopRow(path, token, sid, excelRow, fields);
    });
  }

  async function deleteVerkoopRow(token, excelRow, verwacht) {
    const path = drivePath();
    return W().withSession(path, token, async (sid) => {
      const sheet = M().SHEET_VERKOOP;
      if ((await controleerRij(path, token, sid, "verkoop", excelRow, verwacht, { leegIsKlaar: true })) === "leeg") return;
      // Eén PATCH: A leeg, B/C formules, D..L leeg, M/N formules, O keuzelijst, P/Q leeg.
      const leeg = (n) => Array(n).fill("");
      await W().patchValues(path, token, sid, sheet, `A${excelRow}:Q${excelRow}`, [
        ["", null, null, ...leeg(9), null, null, null, "", ""],
      ]);
    });
  }

  /**
   * fields: {datumIso, klant, omschrijving, factuurnummer, bedrag, land, btw,
   *          categorie, opmerking, bedragOrig, valuta, wisselkoers}
   */
  async function addVerkoopRow(token, fields, hintRows, opties = {}) {
    const path = drivePath();
    return W().withSession(path, token, async (sid) => {
      if (opties.herhaling) {
        const al = await alGeboekt(path, token, sid, "verkoop", fields, opties.telVooraf);
        if (al != null) return { excelRow: al, alBestaand: true };
      }
      let targetRow = await vrijeRijUitGeheugen(
        path, token, sid, M().SHEET_VERKOOP, hintRows, M().firstEmptyBoekSlot, "G"
      );
      if (targetRow == null) {
        const boek = await W().readTableRange(path, token, M().TABLE_VERKOOP, sid);
        const rows = M().parseVerkoopRows(boek.values, boek.headerRow);
        targetRow = M().firstEmptyBoekSlot(rows);
      }
      const land = M().normalizeLand(fields.land);
      if (targetRow == null) {
        await W().addTableRow(path, token, sid, M().TABLE_VERKOOP, [
          fields.datumIso, null, null,
          fields.klant || "", fields.omschrijving || "", fields.factuurnummer || "",
          fields.bedrag != null ? fields.bedrag : null,
          land || null,
          fields.bedragOrig != null ? fields.bedragOrig : null,
          fields.valuta || null, fields.wisselkoers || null,
          fields.btw != null ? fields.btw : null,
          null, null,
          null, // O keuzelijst nooit beschrijven (fix)
          fields.categorie || null, fields.opmerking || "",
        ]);
        return { excelRow: null };
      }
      await writeVerkoopRow(path, token, sid, targetRow, fields);
      markeerBezet(hintRows, targetRow);
      return { excelRow: targetRow };
    });
  }

  // === Jaaroverzicht (Jaaroverzichten_IMeTech_correct.xlsx) ===
  // Kolom per jaar (rij 4: 2025, 2026, …), rijen herkend aan het label in kolom A.
  // De app schrijft alleen de rekenposten; uren en aftrekposten blijven met de hand.
  // Een jaar waarvan de IB-aangifte gedaan is (t/m ibAfgeslotenJaar) blijft ongemoeid.

  const JO_SHEET = "Jaaroverzichten";
  const JO_MAAND_SHEET = "Maandoverzicht";
  const JO_MAAND_TABEL = "Tabel1";
  const MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];

  /** Label (kolom A) → sleutel in de jaarcijfers. */
  const JO_RIJEN = [
    ["omzet (leveringen & diensten nl)", (c) => c.omzet.NL],
    ["omzet (leveringen & diensten eu)", (c) => c.omzet.EU],
    ["omzet (leveringen & diensten buiten eu)", (c) => c.omzet.BuitenEU],
    ["inkoopkosten / uitbesteed werk", (c) => c.kosten.inkoop],
    ["auto- en transportkosten", (c) => c.kosten.auto],
    ["huisvestingskosten", (c) => c.kosten.huisvesting],
    ["marketing & sales", (c) => c.kosten.marketing],
    ["kantoorkosten / software / tools", (c) => c.kosten.kantoor],
    ["afschrijvingen", (c) => c.kosten.afschrijvingen],
    // Zonder eigen rij "Afschrijvingen" tellen ze mee bij de overige kosten.
    ["overige bedrijfskosten", (c, heeftAfschr) => c.kosten.overig + (heeftAfschr ? 0 : c.kosten.afschrijvingen)],
    ["materiële vaste activa", (c) => c.balans.vasteActiva],
    ["vorderingen", (c) => c.balans.vorderingen],
    ["liquide middelen", (c) => c.balans.liquide],
    ["eigen vermogen", (c) => c.balans.eigenVermogen],
    ["schuld omzetbelasting", (c) => c.balans.btwSchuld],
    ["overige kortlopende schulden", (c) => c.balans.crediteuren],
    ["privéonttrekkingen in geld", (c) => c.prive.onttrekkingen],
    ["privéstortingen", (c) => c.prive.stortingen],
  ];

  const kolomLetter = (i) => String.fromCharCode(65 + i); // 0 → A (tot Z is genoeg)
  const labelVan = (v) => String(v ?? "").trim().toLowerCase();

  /** Formule van de vorige kolom naar deze kolom: B35 → C35 (niet in functienamen). */
  function verschuifFormule(formule, van, naar) {
    return String(formule).replace(new RegExp(`(^|[^A-Za-z_$])\\$?${van}(\\$?\\d+)`, "g"), `$1${naar}$2`);
  }

  async function leesJoBlad(path, token, sid) {
    const W_ = W();
    const vals = await W_.readValues(path, token, sid, JO_SHEET, "A1:H80");
    const data = await W_.excelFetch(
      path, token, W_.wsPath(JO_SHEET, `/range(address='A1:H80')?$select=formulas`), {}, sid
    );
    const formules = data?.formulas || [];
    const kopRij = vals.findIndex((r) => r.some((v) => /^20\d\d$/.test(String(v))));
    if (kopRij < 0) throw new Error("Jaaroverzicht: geen rij met jaartallen gevonden.");
    const rijVan = new Map();
    vals.forEach((r, i) => {
      const l = labelVan(r[0]);
      if (l && !rijVan.has(l)) rijVan.set(l, i);
    });
    return { vals, formules, kopRij, rijVan };
  }

  /** Waarden van het vorige jaar (openingsbalans) en wat er in het doeljaar al staat. */
  async function leesJaaroverzicht(token, jaar) {
    const path = global.BOEK_CONFIG.graph.jaaroverzichtPath;
    return W().withSession(path, token, async (sid) => {
      const b = await leesJoBlad(path, token, sid);
      const kol = b.vals[b.kopRij].findIndex((v) => String(v) === String(jaar));
      const vkol = b.vals[b.kopRij].findIndex((v) => String(v) === String(jaar - 1));
      const waarde = (label, k) => {
        const i = b.rijVan.get(label);
        if (i == null || k < 0) return null;
        const v = b.vals[i][k];
        return typeof v === "number" ? v : null;
      };
      return {
        kolom: kol,
        vorig: {
          vasteActiva: waarde("materiële vaste activa", vkol) ?? 0,
          eigenVermogen: waarde("eigen vermogen", vkol) ?? 0,
          gevonden: vkol >= 0,
        },
      };
    });
  }

  /**
   * Kolom van een jaar invullen met de berekende cijfers, plus het maandoverzicht.
   * Geeft terug wat er geschreven is (aantal cellen) voor de melding.
   */
  async function schrijfJaaroverzicht(token, jaar, cijfers, { peildatum } = {}) {
    const path = global.BOEK_CONFIG.graph.jaaroverzichtPath;
    const W_ = W();
    return W_.withSession(path, token, async (sid) => {
      const b = await leesJoBlad(path, token, sid);
      const kol = b.vals[b.kopRij].findIndex((v) => String(v) === String(jaar));
      const vkol = b.vals[b.kopRij].findIndex((v) => String(v) === String(jaar - 1));
      if (kol < 0) throw new Error(`Jaaroverzicht: geen kolom voor ${jaar}.`);
      const K = kolomLetter(kol);
      const V = vkol >= 0 ? kolomLetter(vkol) : null;
      const heeftAfschr = b.rijVan.has("afschrijvingen");
      let cellen = 0;
      for (const [label, fn] of JO_RIJEN) {
        const i = b.rijVan.get(label);
        if (i == null) continue;
        const v = Math.round((fn(cijfers, heeftAfschr) || 0) * 100) / 100;
        await W_.patchValues(path, token, sid, JO_SHEET, `${K}${i + 1}`, [[v]]);
        cellen++;
      }
      // Rekenregels (totalen, controle): de formule van de vorige kolom overnemen
      // als de cel nog leeg is. De vermogensvergelijking krijgt het begin-EV erbij.
      if (V) {
        const rEv = b.rijVan.get("eigen vermogen");
        const rEvB = b.rijVan.get("eigen vermogen (uit sectie b)");
        const rOntt = b.rijVan.get("privéonttrekkingen in geld");
        const rStort = b.rijVan.get("privéstortingen");
        const rVv = b.rijVan.get("vermogenrekening (ev-saldo)");
        const rW = b.rijVan.get("fiscale winst (w&v-saldo)");
        const rC = b.rijVan.get("controle ev / w&v");
        for (let i = 0; i < b.formules.length; i++) {
          const f = b.formules[i]?.[vkol];
          if (typeof f !== "string" || !f.startsWith("=")) continue;
          const huidig = b.formules[i]?.[kol];
          let nieuw = verschuifFormule(f, V, K);
          if (i === rVv && rEvB != null && rEv != null && rOntt != null && rStort != null) {
            // EV eind − EV begin + onttrekkingen − stortingen = fiscale winst
            nieuw = `=${K}${rEvB + 1}-${V}${rEv + 1}+${K}${rOntt + 1}-${K}${rStort + 1}`;
          } else if (i === rC && rVv != null && rW != null) {
            // Totalen staan op hele euro's: een paar euro verschil is afronding.
            const a = `${K}${rVv + 1}`, w = `${K}${rW + 1}`;
            nieuw = `=IF(ABS(${a}-${w})<10,"✓ Klopt","⚠ Verschil: "&ROUND(${a}-${w},0))`;
          } else if (typeof huidig === "string" && huidig.startsWith("=")) {
            continue; // er staat al een formule
          } else if (huidig !== "" && huidig != null) {
            continue; // met de hand ingevuld: laten staan
          }
          await W_.patchFormulas(path, token, sid, JO_SHEET, `${K}${i + 1}`, [[nieuw]]);
          cellen++;
        }
      }
      // Kenmerk boven de kolom: waar komen de cijfers vandaan.
      const stand = peildatum ? `t/m ${global.BoekModel.formatDateNl(peildatum)}` : "per 31-12";
      if (b.kopRij >= 1) {
        await W_.patchValues(path, token, sid, JO_SHEET, `${K}${b.kopRij}`, [[`Boekhouding-app ${stand}`]]);
      }

      // Maandoverzicht: Omzet NL/EU/BuitenEU en Totaal Kosten per maand.
      const t = await W_.readTableRange(path, token, JO_MAAND_TABEL, sid);
      const kop = (t.values[0] || []).map(labelVan);
      const ci = (naam) => kop.indexOf(naam);
      const cM = ci("maand"), cJ = ci("jaar"), cNL = ci("omzet nl"), cEU = ci("omzet eu"), cBU = ci("omzet buiteneu"), cK = ci("totaal kosten");
      if ([cM, cJ, cNL, cEU, cBU, cK].every((x) => x >= 0)) {
        const totMaand = peildatum ? peildatum.getUTCMonth() : 11;
        for (let i = 1; i < t.values.length; i++) {
          const rij = t.values[i];
          if (String(rij[cJ]) !== String(jaar)) continue;
          const m = MAANDEN.indexOf(labelVan(rij[cM]));
          if (m < 0 || m > totMaand) continue;
          const c = cijfers.maanden[m];
          const excelRij = t.headerRow + i;
          const zet = async (col, v) => {
            await W_.patchValues(path, token, sid, JO_MAAND_SHEET, `${kolomLetter(col)}${excelRij}`, [[v || ""]]);
            cellen++;
          };
          await zet(cNL, c.NL);
          await zet(cEU, c.EU);
          await zet(cBU, c.BuitenEU);
          await zet(cK, c.kosten);
        }
      }
      return { cellen, kolom: K };
    });
  }

  /** Locatie (kolom G) van urenregels corrigeren in het urenwerkboek. */
  async function updateUrenLocatie(token, excelRows, locatie) {
    const cfg = global.BOEK_CONFIG.graph;
    return W().withSession(cfg.urenPath, token, async (sid) => {
      for (const row of excelRows) {
        await W().patchValues(cfg.urenPath, token, sid, cfg.urenSheet, `G${row}`, [[locatie]]);
      }
    });
  }

  global.BoekIo = {
    drivePath,
    loadAll,
    addBankRow,
    updateBankRow,
    deleteBankRow,
    setBankIngeboekt,
    koppelBank,
    ontkoppelBank,
    ruimKoppelingenOp,
    controleerBankRijen,
    RijVerschovenError,
    addInkoopRow,
    updateInkoopRow,
    deleteInkoopRow,
    addVerkoopRow,
    updateVerkoopRow,
    deleteVerkoopRow,
    updateUrenLocatie,
    leesJaaroverzicht,
    schrijfJaaroverzicht,
    verschuifFormule,
  };
})(window);
