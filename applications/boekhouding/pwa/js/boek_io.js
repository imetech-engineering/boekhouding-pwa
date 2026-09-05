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
  async function addBankRow(token, fields, hint) {
    const path = drivePath();
    return W().withSession(path, token, async (sid) => {
      const sheet = M().SHEET_BANK;
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
  async function updateBankRow(token, excelRow, fields) {
    const path = drivePath();
    return W().withSession(path, token, async (sid) => {
      const sheet = M().SHEET_BANK;
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
  async function setBankIngeboekt(token, excelRows, value = true) {
    const path = drivePath();
    return W().withSession(path, token, async (sid) => {
      for (const row of excelRows) {
        await W().patchValues(path, token, sid, M().SHEET_BANK, `F${row}`, [[!!value]]);
      }
    });
  }

  /**
   * Bankregel leegmaken. De saldo-formules zijn per rekening opgeteld en
   * verwijzen niet naar elkaar, dus andere rijen hebben hier geen last van.
   */
  async function deleteBankRow(token, excelRow) {
    const path = drivePath();
    return W().withSession(path, token, async (sid) => {
      await W().patchValues(path, token, sid, M().SHEET_BANK, `A${excelRow}:I${excelRow}`, [
        ["", "", "", "", null, false, "", "", ""],
      ]);
    });
  }

  /**
   * Factuurkoppeling schrijven op bankregels (kolom I), plus ingeboekt-vinkje.
   * Bestaande koppelingen blijven staan; de nieuwe komt er met een komma achter.
   */
  async function koppelBank(token, items) {
    const path = drivePath();
    return W().withSession(path, token, async (sid) => {
      const bank = await W().readTableRange(path, token, M().TABLE_BANK, sid);
      const rows = M().parseBankRows(bank.values, bank.headerRow);
      for (const item of items) {
        const huidig = rows.find((r) => r.excelRow === item.excelRow)?.koppelingRaw || "";
        const al = huidig
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .includes(item.waarde.trim().toLowerCase());
        const nieuw = al ? huidig : huidig ? `${huidig}, ${item.waarde}` : item.waarde;
        await W().patchValues(path, token, sid, M().SHEET_BANK, `I${item.excelRow}`, [[nieuw]]);
        if (item.ingeboekt) {
          await W().patchValues(path, token, sid, M().SHEET_BANK, `F${item.excelRow}`, [[true]]);
        }
      }
    });
  }

  /** Koppeling van een bankregel weghalen. */
  /** Kolom I van een bankregel exact zetten; lege waarde = volledig ontkoppelen. */
  async function ontkoppelBank(token, excelRow, waarde = "") {
    const path = drivePath();
    return W().withSession(path, token, (sid) =>
      W().patchValues(path, token, sid, M().SHEET_BANK, `I${excelRow}`, [[waarde || ""]])
    );
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

  async function writeInkoopRow(path, token, sid, excelRow, fields) {
    const sheet = M().SHEET_INKOOP;
    await W().patchValues(path, token, sid, sheet, `A${excelRow}`, [[fields.datumIso]]);
    await W().patchValues(path, token, sid, sheet, `D${excelRow}:V${excelRow}`, [
      inkoopRowValues(fields),
    ]);
  }

  /** Bestaande inkooprij overschrijven (bewerken). */
  async function updateInkoopRow(token, excelRow, fields) {
    const path = drivePath();
    return W().withSession(path, token, (sid) =>
      writeInkoopRow(path, token, sid, excelRow, fields)
    );
  }

  /** Rij leegmaken i.p.v. verwijderen — zo blijven formules en rij-indexen intact. */
  async function deleteInkoopRow(token, excelRow) {
    const path = drivePath();
    return W().withSession(path, token, async (sid) => {
      const sheet = M().SHEET_INKOOP;
      await W().patchValues(path, token, sid, sheet, `A${excelRow}`, [[""]]);
      await W().patchValues(path, token, sid, sheet, `D${excelRow}:L${excelRow}`, [
        ["", "", "", "", "", "", "", "", ""],
      ]);
      await W().patchValues(path, token, sid, sheet, `R${excelRow}:V${excelRow}`, [
        ["", "", "", "", ""],
      ]);
    });
  }

  /**
   * fields: {datumIso, leverancier, omschrijving, factuurnummer, bedrag, btw, verlegd,
   *          categorie, afschrijving, opmerking, land, project, bedragOrig, valuta, wisselkoers}
   */
  async function addInkoopRow(token, fields, hintRows) {
    const path = drivePath();
    return W().withSession(path, token, async (sid) => {
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

  async function writeVerkoopRow(path, token, sid, excelRow, fields) {
    const sheet = M().SHEET_VERKOOP;
    await W().patchValues(path, token, sid, sheet, `A${excelRow}`, [[fields.datumIso]]);
    await W().patchValues(path, token, sid, sheet, `D${excelRow}:Q${excelRow}`, [
      verkoopRowValues(fields),
    ]);
  }

  async function updateVerkoopRow(token, excelRow, fields) {
    const path = drivePath();
    return W().withSession(path, token, (sid) =>
      writeVerkoopRow(path, token, sid, excelRow, fields)
    );
  }

  async function deleteVerkoopRow(token, excelRow) {
    const path = drivePath();
    return W().withSession(path, token, async (sid) => {
      const sheet = M().SHEET_VERKOOP;
      await W().patchValues(path, token, sid, sheet, `A${excelRow}`, [[""]]);
      await W().patchValues(path, token, sid, sheet, `D${excelRow}:L${excelRow}`, [
        ["", "", "", "", "", "", "", "", ""],
      ]);
      await W().patchValues(path, token, sid, sheet, `P${excelRow}:Q${excelRow}`, [["", ""]]);
    });
  }

  /**
   * fields: {datumIso, klant, omschrijving, factuurnummer, bedrag, land, btw,
   *          categorie, opmerking, bedragOrig, valuta, wisselkoers}
   */
  async function addVerkoopRow(token, fields, hintRows) {
    const path = drivePath();
    return W().withSession(path, token, async (sid) => {
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
    addInkoopRow,
    updateInkoopRow,
    deleteInkoopRow,
    addVerkoopRow,
    updateVerkoopRow,
    deleteVerkoopRow,
    updateUrenLocatie,
  };
})(window);
