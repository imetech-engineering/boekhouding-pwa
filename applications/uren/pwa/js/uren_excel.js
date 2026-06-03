/**
 * Client-side Excel engine (SheetJS) — mirrors applications/uren/uren_excel_service.py.
 */
(function (global) {
  const SHEET_NAME = "Urenadministratie";
  const TABLE_NAME = "Tabel13";
  const START_ROW = 6;
  const COL_DATUM = 1;
  const COL_WEEK = 2;
  const COL_JAAR = 3;
  const COL_OPDRACHTGEVER = 4;
  const COL_PROJECT = 5;
  const COL_WERKZAAMHEDEN = 6;
  const COL_LOCATIE = 7;
  const COL_UREN = 8;
  const COL_TARIEF = 9;
  const NUM_COLS = COL_TARIEF;
  const WEEK_FORMULA =
    '=IF(ISBLANK(Tabel13[[#This Row],[Datum]]),"",' +
    '_xlfn.ISOWEEKNUM(Tabel13[[#This Row],[Datum]]))';
  const JAAR_FORMULA = "=YEAR(Tabel13[[#This Row],[Datum]])";

  function colLetter(n) {
    let s = "";
    let num = n;
    while (num > 0) {
      num--;
      s = String.fromCharCode(65 + (num % 26)) + s;
      num = Math.floor(num / 26);
    }
    return s;
  }

  function cellAddr(row, col) {
    return colLetter(col) + row;
  }

  function parseExcelDate(v) {
    if (v == null || v === "") return null;
    if (v instanceof Date) return v;
    if (typeof v === "number") {
      const epoch = new Date(Date.UTC(1899, 11, 30));
      return new Date(epoch.getTime() + v * 86400000);
    }
    const s = String(v).slice(0, 10);
    const d = new Date(s + "T12:00:00");
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function floatOrNone(x) {
    if (x == null || x === "") return null;
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }

  function cellIsTotaal(datumValue) {
    return (
      typeof datumValue === "string" &&
      datumValue.trim().toLowerCase() === "totaal"
    );
  }

  function rowIsEmptySlot(datumValue) {
    if (cellIsTotaal(datumValue)) return false;
    if (datumValue == null) return true;
    return typeof datumValue === "string" && !datumValue.trim();
  }

  function isDataRow(values) {
    if (!values || values.length < NUM_COLS) return false;
    const d = values[COL_DATUM - 1];
    if (d == null) return false;
    if (typeof d === "string" && d.trim().toLowerCase() === "totaal") return false;
    return true;
  }

  function readRowValues(ws, rowIndex) {
    const out = [];
    for (let c = 1; c <= NUM_COLS; c++) {
      const addr = cellAddr(rowIndex, c);
      const cell = ws[addr];
      out.push(cell ? (cell.v != null ? cell.v : cell.w) : null);
    }
    return out;
  }

  function sheetMaxRow(ws) {
    const ref = ws["!ref"];
    if (!ref) return START_ROW;
    const range = XLSX.utils.decode_range(ref);
    return range.e.r + 1;
  }

  function tableBounds(ws) {
    const maxR = sheetMaxRow(ws);
    let startRow = START_ROW;
    let endRow = maxR;
    for (let r = maxR; r >= START_ROW; r--) {
      const vals = readRowValues(ws, r);
      if (vals.some((v) => v != null && v !== "")) {
        endRow = r;
        break;
      }
    }
    const dEnd = ws[cellAddr(endRow, COL_DATUM)];
    const totaalAtEnd =
      dEnd &&
      cellIsTotaal(dEnd.v != null ? dEnd.v : dEnd.w);
    return {
      startCol: 1,
      startRow,
      endCol: NUM_COLS,
      endRow,
      totaalAtEnd,
      ref: `${colLetter(1)}${startRow}:${colLetter(NUM_COLS)}${endRow}`,
    };
  }

  function findAddRow(ws) {
    const b = tableBounds(ws);
    const searchEnd = b.totaalAtEnd ? b.endRow - 1 : b.endRow;
    for (let r = b.startRow; r <= searchEnd; r++) {
      const d = ws[cellAddr(r, COL_DATUM)];
      const dv = d ? (d.v != null ? d.v : d.w) : null;
      if (rowIsEmptySlot(dv)) {
        return { insertRow: r, needInsert: false, bounds: b };
      }
    }
    const insertRow = b.totaalAtEnd ? b.endRow : b.endRow + 1;
    return { insertRow, needInsert: true, bounds: b };
  }

  function setCell(ws, row, col, value, formula) {
    const addr = cellAddr(row, col);
    if (formula) {
      ws[addr] = { f: formula };
    } else if (value instanceof Date) {
      const serial =
        (value.getTime() - Date.UTC(1899, 11, 30)) / 86400000;
      ws[addr] = { t: "n", v: serial, z: "yyyy-mm-dd" };
    } else {
      ws[addr] = { t: typeof value === "number" ? "n" : "s", v: value };
    }
  }

  function shiftRowsDown(ws, fromRow, bounds) {
    const maxR = sheetMaxRow(ws);
    for (let r = maxR; r >= fromRow; r--) {
      for (let c = 1; c <= NUM_COLS; c++) {
        const src = cellAddr(r, c);
        const dst = cellAddr(r + 1, c);
        if (ws[src]) ws[dst] = { ...ws[src] };
        else delete ws[dst];
      }
    }
    for (let c = 1; c <= NUM_COLS; c++) {
      delete ws[cellAddr(fromRow, c)];
    }
    bounds.endRow += 1;
    bounds.ref = `${colLetter(bounds.startCol)}${bounds.startRow}:${colLetter(bounds.endCol)}${bounds.endRow}`;
    ws["!ref"] = expandRef(ws["!ref"], bounds.endRow, NUM_COLS);
  }

  function expandRef(ref, endRow, endCol) {
    if (!ref) return `A1:${colLetter(endCol)}${endRow}`;
    const range = XLSX.utils.decode_range(ref);
    if (endRow - 1 > range.e.r) range.e.r = endRow - 1;
    if (endCol - 1 > range.e.c) range.e.c = endCol - 1;
    return XLSX.utils.encode_range(range);
  }

  function deleteRow(ws, rowIndex, bounds) {
    const maxR = sheetMaxRow(ws);
    for (let r = rowIndex; r < maxR; r++) {
      for (let c = 1; c <= NUM_COLS; c++) {
        const src = cellAddr(r + 1, c);
        const dst = cellAddr(r, c);
        if (ws[src]) ws[dst] = { ...ws[src] };
        else delete ws[dst];
      }
    }
    for (let c = 1; c <= NUM_COLS; c++) {
      delete ws[cellAddr(maxR, c)];
    }
    bounds.endRow -= 1;
    bounds.ref = `${colLetter(bounds.startCol)}${bounds.startRow}:${colLetter(bounds.endCol)}${bounds.endRow}`;
    ws["!ref"] = expandRef(ws["!ref"], bounds.endRow, NUM_COLS);
  }

  function rowToEntry(values, rowIndex) {
    const dt = parseExcelDate(values[COL_DATUM - 1]);
    if (!dt) return null;
    const uren = floatOrNone(values[COL_UREN - 1]) || 0;
    const tarief = floatOrNone(values[COL_TARIEF - 1]) || 0;
    const entry = {
      datum: dt,
      datumStr: formatDateIso(dt),
      week: values[COL_WEEK - 1],
      jaar: values[COL_JAAR - 1] || dt.getFullYear(),
      opdrachtgever: String(values[COL_OPDRACHTGEVER - 1] || "").trim(),
      project: String(values[COL_PROJECT - 1] || "").trim(),
      werkzaamheden: String(values[COL_WERKZAAMHEDEN - 1] || "").trim(),
      locatie: String(values[COL_LOCATIE - 1] || "").trim(),
      uren,
      tarief,
      bedrag: uren * tarief,
    };
    if (rowIndex != null) entry.row_index = rowIndex;
    return entry;
  }

  function formatDateIso(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function readAllEntries(bytes) {
    const wb = XLSX.read(bytes, { type: "array", cellDates: true });
    const ws = wb.Sheets[SHEET_NAME];
    if (!ws) throw new Error(`Tabblad ${SHEET_NAME} niet gevonden.`);
    const entries = [];
    const maxR = sheetMaxRow(ws);
    for (let r = START_ROW; r <= maxR; r++) {
      const values = readRowValues(ws, r);
      if (!isDataRow(values)) continue;
      const entry = rowToEntry(values, r);
      if (entry) entries.push(entry);
    }
    return { wb, ws, entries };
  }

  function writeWorkbookBytes(wb) {
    return XLSX.write(wb, { bookType: "xlsx", type: "array" });
  }

  function addEntry(wb, ws, fields) {
    const { insertRow, needInsert, bounds } = findAddRow(ws);
    if (needInsert) {
      shiftRowsDown(ws, insertRow, bounds);
    }
    const datum = new Date(fields.datumStr + "T12:00:00");
    setCell(ws, insertRow, COL_DATUM, datum);
    if (needInsert) {
      setCell(ws, insertRow, COL_WEEK, null, WEEK_FORMULA);
      setCell(ws, insertRow, COL_JAAR, null, JAAR_FORMULA);
    }
    setCell(ws, insertRow, COL_OPDRACHTGEVER, fields.opdrachtgever || "");
    setCell(ws, insertRow, COL_PROJECT, fields.project || "");
    setCell(ws, insertRow, COL_WERKZAAMHEDEN, fields.werkzaamheden || "");
    setCell(ws, insertRow, COL_LOCATIE, fields.locatie || "");
    setCell(ws, insertRow, COL_UREN, Number(fields.uren) || 0);
    setCell(ws, insertRow, COL_TARIEF, Number(fields.tarief) || 0);
    return writeWorkbookBytes(wb);
  }

  function updateEntry(wb, ws, rowIndex, fields) {
    const b = tableBounds(ws);
    if (rowIndex < b.startRow || rowIndex > b.endRow) {
      throw new Error("Regel niet meer gevonden in Excel (ververs lijsten).");
    }
    const datum = new Date(fields.datumStr + "T12:00:00");
    setCell(ws, rowIndex, COL_DATUM, datum);
    setCell(ws, rowIndex, COL_OPDRACHTGEVER, fields.opdrachtgever || "");
    setCell(ws, rowIndex, COL_PROJECT, fields.project || "");
    setCell(ws, rowIndex, COL_WERKZAAMHEDEN, fields.werkzaamheden || "");
    setCell(ws, rowIndex, COL_LOCATIE, fields.locatie || "");
    setCell(ws, rowIndex, COL_UREN, Number(fields.uren) || 0);
    setCell(ws, rowIndex, COL_TARIEF, Number(fields.tarief) || 0);
    return writeWorkbookBytes(wb);
  }

  function deleteEntry(wb, ws, rowIndex) {
    const b = tableBounds(ws);
    if (rowIndex < b.startRow || rowIndex > b.endRow) {
      throw new Error("Regel niet meer gevonden in Excel (ververs lijsten).");
    }
    deleteRow(ws, rowIndex, b);
    return writeWorkbookBytes(wb);
  }

  function buildIntel(entries) {
    const intel = {
      history: [...entries].reverse(),
      og_usage: {},
      proj_usage: {},
      loc_usage: {},
      projects_by_og: {},
      locaties_by_og: {},
      all_opdrachtgevers: [],
      all_projects: [],
      all_locaties: [],
      tarieven_pair: {},
    };
    const bump = (map, key, uren, dt) => {
      if (!key) return;
      if (!map[key]) map[key] = { count: 0, uren: 0, last: null };
      map[key].count += 1;
      map[key].uren += uren;
      if (!map[key].last || dt > map[key].last) map[key].last = dt;
    };
    const uniq = (arr, val) => {
      if (val && !arr.includes(val)) arr.push(val);
    };
    for (const e of entries) {
      const dt = e.datum;
      bump(intel.og_usage, e.opdrachtgever, e.uren, dt);
      bump(intel.proj_usage, e.project, e.uren, dt);
      bump(intel.loc_usage, e.locatie, e.uren, dt);
      uniq(intel.all_opdrachtgevers, e.opdrachtgever);
      uniq(intel.all_projects, e.project);
      uniq(intel.all_locaties, e.locatie);
      if (e.opdrachtgever && e.project) {
        intel.tarieven_pair[`${e.opdrachtgever}\0${e.project}`] = e.tarief;
      }
    }
    return intel;
  }

  global.UrenExcel = {
    SHEET_NAME,
    TABLE_NAME,
    START_ROW,
    WEEK_FORMULA,
    JAAR_FORMULA,
    readAllEntries,
    addEntry,
    updateEntry,
    deleteEntry,
    buildIntel,
    formatDateIso,
  };
})(window);
