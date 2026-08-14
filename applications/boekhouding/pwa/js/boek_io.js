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

  // === Bankboek ===

  /**
   * Nieuwe bankregel: eerste lege slot binnen Tabel1, saldo als formule.
   * fields: {datumIso, omschrijving, in, uit, opmerking}
   */
  async function addBankRow(token, fields, snapshot) {
    const path = drivePath();
    return W().withSession(path, token, async (sid) => {
      // Verse leesronde binnen de sessie (bescherming tegen verouderde snapshot)
      const bank = await W().readTableRange(path, token, M().TABLE_BANK, sid);
      const rows = M().parseBankRows(bank.values, bank.headerRow);
      const targetRow = M().firstEmptyBankSlot(rows);
      const prev = M().lastFilledBankRowBefore(rows, targetRow);
      const sheet = M().SHEET_BANK;
      if (bank.endRow && targetRow > bank.endRow) {
        // Tabel vol → rij toevoegen via tabel-API (formule direct mee)
        await W().addTableRow(path, token, sid, M().TABLE_BANK, [
          fields.datumIso,
          fields.omschrijving || "",
          fields.in != null ? fields.in : null,
          fields.uit != null ? fields.uit : null,
          M().saldoFormula(prev ? prev.excelRow : null),
          !!fields.ingeboekt,
          fields.opmerking || "",
        ]);
        return { excelRow: (bank.endRow || 5) + 1 };
      }
      await W().patchValues(path, token, sid, sheet, `A${targetRow}:G${targetRow}`, [
        [
          fields.datumIso,
          fields.omschrijving || "",
          fields.in != null ? fields.in : "",
          fields.uit != null ? fields.uit : "",
          null, // saldo → formule hieronder
          !!fields.ingeboekt,
          fields.opmerking || "",
        ],
      ]);
      await W().patchFormulas(path, token, sid, sheet, `E${targetRow}`, [
        [M().saldoFormula(prev ? prev.excelRow : null)],
      ]);
      return { excelRow: targetRow };
    });
  }

  /**
   * Bestaande bankregel bijwerken.
   * fields: {omschrijving?, opmerking?, in?, uit?, updateAmounts:boolean}
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
      if (fields.updateAmounts) {
        await W().patchValues(path, token, sid, sheet, `C${excelRow}:D${excelRow}`, [
          [fields.in != null ? fields.in : "", fields.uit != null ? fields.uit : ""],
        ]);
        // Saldo naar zelf-herstellende formule (ook als het een hard getal was)
        const bank = await W().readTableRange(path, token, M().TABLE_BANK, sid);
        const rows = M().parseBankRows(bank.values, bank.headerRow);
        const prev = M().lastFilledBankRowBefore(rows, excelRow);
        await W().patchFormulas(path, token, sid, sheet, `E${excelRow}`, [
          [M().saldoFormula(prev ? prev.excelRow : null)],
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
   * Bankregel leegmaken. De saldo-formule van de eerstvolgende gevulde regel
   * verwijst naar deze rij, dus die wordt opnieuw gekoppeld aan de regel ervóór —
   * anders staat er na het verwijderen #WAARDE! in de saldokolom.
   */
  async function deleteBankRow(token, excelRow) {
    const path = drivePath();
    return W().withSession(path, token, async (sid) => {
      const sheet = M().SHEET_BANK;
      const bank = await W().readTableRange(path, token, M().TABLE_BANK, sid);
      const rows = M().parseBankRows(bank.values, bank.headerRow);
      const prev = M().lastFilledBankRowBefore(rows, excelRow);
      const next = rows.find((r) => r.excelRow > excelRow && !r.isEmpty);
      await W().patchValues(path, token, sid, sheet, `A${excelRow}:G${excelRow}`, [
        ["", "", "", "", "", false, ""],
      ]);
      if (next) {
        await W().patchFormulas(path, token, sid, sheet, `E${next.excelRow}`, [
          [M().saldoFormula(prev ? prev.excelRow : null)],
        ]);
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
  async function addInkoopRow(token, fields) {
    const path = drivePath();
    return W().withSession(path, token, async (sid) => {
      const boek = await W().readTableRange(path, token, M().TABLE_INKOOP, sid);
      const rows = M().parseInkoopRows(boek.values, boek.headerRow);
      const targetRow = M().firstEmptyBoekSlot(rows);
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
  async function addVerkoopRow(token, fields) {
    const path = drivePath();
    return W().withSession(path, token, async (sid) => {
      const boek = await W().readTableRange(path, token, M().TABLE_VERKOOP, sid);
      const rows = M().parseVerkoopRows(boek.values, boek.headerRow);
      const targetRow = M().firstEmptyBoekSlot(rows);
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
      return { excelRow: targetRow };
    });
  }

  global.BoekIo = {
    drivePath,
    loadAll,
    addBankRow,
    updateBankRow,
    deleteBankRow,
    setBankIngeboekt,
    addInkoopRow,
    updateInkoopRow,
    deleteInkoopRow,
    addVerkoopRow,
    updateVerkoopRow,
    deleteVerkoopRow,
  };
})(window);
