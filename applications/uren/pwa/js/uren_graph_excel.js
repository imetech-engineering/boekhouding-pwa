/**
 * Excel I/O via Microsoft Graph Workbook API — preserves formatting, tables and formulas.
 */
(function (global) {
  const SHEET = UrenExcel.SHEET_NAME;
  const TABLE = UrenExcel.TABLE_NAME;
  const START_ROW = UrenExcel.START_ROW;
  const COL = { DATUM: 0, WEEK: 1, JAAR: 2, OG: 3, PROJ: 4, WERK: 5, LOC: 6, UREN: 7, TARIEF: 8 };

  function encodeSheet(name) {
    return name.replace(/'/g, "''");
  }

  function wsPath(suffix) {
    return `/worksheets('${encodeSheet(SHEET)}')${suffix}`;
  }

  function workbookUrl(drivePath, suffix) {
    if (suffix.startsWith("http")) return suffix;
    return `${UrenGraph.itemUrl(drivePath)}:/workbook${suffix}`;
  }

  async function excelFetch(drivePath, token, suffix, options = {}, sessionId) {
    const url = workbookUrl(drivePath, suffix);
    const headers = { ...(options.headers || {}) };
    if (sessionId) headers["workbook-session-id"] = sessionId;
    if (options.body && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    const res = await fetch(url, {
      ...options,
      headers: { ...headers, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const t = await res.text();
      if (res.status === 423 || res.status === 409) {
        throw new UrenGraph.GraphLockError(
          "Bestand is vergrendeld (Excel open op PC?). Sluit Excel en probeer opnieuw."
        );
      }
      throw new Error(`Excel API mislukt (${res.status}): ${t}`);
    }
    if (res.status === 204) return null;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) return res.json();
    return res;
  }

  async function withSession(drivePath, token, fn) {
    const created = await excelFetch(
      drivePath,
      token,
      "/createSession",
      { method: "POST", body: JSON.stringify({ persistChanges: true }) }
    );
    const sessionId = created.id;
    try {
      return await fn(sessionId);
    } finally {
      try {
        await excelFetch(
          drivePath,
          token,
          "/closeSession",
          { method: "POST", body: JSON.stringify({}) },
          sessionId
        );
      } catch (_) {}
    }
  }

  async function fetchAllTableRows(drivePath, token, sessionId) {
    const rows = [];
    let path = `/tables('${encodeSheet(TABLE)}')/rows`;
    while (path) {
      const data = await excelFetch(drivePath, token, path, {}, sessionId);
      for (const r of data.value || []) {
        const vals = r.values?.[0];
        if (vals) rows.push({ index: r.index, values: vals });
      }
      const next = data["@odata.nextLink"];
      path = next || null;
    }
    rows.sort((a, b) => a.index - b.index);
    return rows;
  }

  async function readUsedRangeValues(drivePath, token, sessionId) {
    const data = await excelFetch(
      drivePath,
      token,
      wsPath("/usedRange(valuesOnly=true)"),
      {},
      sessionId
    );
    const address = data.address || data.text || "";
    const match = address.match(/:I(\d+)/i);
    const endRow = match ? parseInt(match[1], 10) : START_ROW + 500;
    if (endRow < START_ROW) return [];
    const range = wsPath(`/range(address='A${START_ROW}:I${endRow}')`);
    const block = await excelFetch(drivePath, token, range, {}, sessionId);
    return block.values || [];
  }

  function parseGraphDate(v) {
    if (v == null || v === "") return null;
    if (typeof v === "number") {
      const epoch = new Date(Date.UTC(1899, 11, 30));
      return new Date(epoch.getTime() + v * 86400000);
    }
    if (typeof v === "string") {
      if (v.trim().toLowerCase() === "totaal") return null;
      const d = new Date(v.slice(0, 10) + "T12:00:00");
      return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  function cellIsTotaal(v) {
    return typeof v === "string" && v.trim().toLowerCase() === "totaal";
  }

  function rowIsEmptySlot(datumVal) {
    if (cellIsTotaal(datumVal)) return false;
    if (datumVal == null || datumVal === "") return true;
    return typeof datumVal === "string" && !String(datumVal).trim();
  }

  function rowToEntry(values, excelRow) {
    if (!values || values.length < 9) return null;
    const dt = parseGraphDate(values[COL.DATUM]);
    if (!dt) return null;
    const uren = Number(values[COL.UREN]) || 0;
    const tarief = Number(values[COL.TARIEF]) || 0;
    return {
      datum: dt,
      datumStr: UrenExcel.formatDateIso(dt),
      week: values[COL.WEEK],
      jaar: values[COL.JAAR] || dt.getFullYear(),
      opdrachtgever: String(values[COL.OG] || "").trim(),
      project: String(values[COL.PROJ] || "").trim(),
      werkzaamheden: String(values[COL.WERK] || "").trim(),
      locatie: String(values[COL.LOC] || "").trim(),
      uren,
      tarief,
      bedrag: uren * tarief,
      row_index: excelRow,
    };
  }

  async function readAllEntries(drivePath, token) {
    let tableRows = [];
    try {
      tableRows = await fetchAllTableRows(drivePath, token);
    } catch (_) {
      tableRows = [];
    }

    const entries = [];
    if (tableRows.length) {
      for (const tr of tableRows) {
        const excelRow = START_ROW + tr.index;
        const entry = rowToEntry(tr.values, excelRow);
        if (entry) entries.push(entry);
      }
      return entries;
    }

    const values = await readUsedRangeValues(drivePath, token);
    for (let i = 0; i < values.length; i++) {
      const entry = rowToEntry(values[i], START_ROW + i);
      if (entry) entries.push(entry);
    }
    return entries;
  }

  function findAddRow(tableRows, flatValues) {
    if (tableRows?.length) {
      let lastIdx = tableRows.length - 1;
      while (lastIdx >= 0) {
        const v = tableRows[lastIdx].values;
        if (v && v.some((c) => c != null && c !== "")) break;
        lastIdx--;
      }
      const totaalAtEnd =
        lastIdx >= 0 && cellIsTotaal(tableRows[lastIdx].values?.[COL.DATUM]);
      const searchEnd = totaalAtEnd ? lastIdx - 1 : lastIdx;
      for (let i = 0; i <= searchEnd; i++) {
        const d = tableRows[i].values?.[COL.DATUM];
        if (rowIsEmptySlot(d)) {
          return { excelRow: START_ROW + tableRows[i].index, needInsert: false };
        }
      }
      const insertIndex = totaalAtEnd
        ? tableRows[lastIdx].index
        : tableRows[lastIdx].index + 1;
      return { excelRow: START_ROW + insertIndex, needInsert: true };
    }

    const values = flatValues || [];
    let endIdx = values.length - 1;
    while (endIdx >= 0) {
      const row = values[endIdx];
      if (row && row.some((c) => c != null && c !== "")) break;
      endIdx--;
    }
    const totaalAtEnd = endIdx >= 0 && cellIsTotaal(values[endIdx]?.[COL.DATUM]);
    const searchEnd = totaalAtEnd ? endIdx - 1 : endIdx;
    for (let i = 0; i <= searchEnd; i++) {
      if (rowIsEmptySlot(values[i]?.[COL.DATUM])) {
        return { excelRow: START_ROW + i, needInsert: false };
      }
    }
    const insertIdx = totaalAtEnd ? endIdx : endIdx + 1;
    return { excelRow: START_ROW + insertIdx, needInsert: true };
  }

  function fieldsToDataRow(fields) {
    return [
      fields.opdrachtgever || "",
      fields.project || "",
      fields.werkzaamheden || "",
      fields.locatie || "",
      Number(fields.uren) || 0,
      Number(fields.tarief) || 0,
    ];
  }

  async function patchRange(drivePath, token, sessionId, address, values) {
    await excelFetch(
      drivePath,
      token,
      wsPath(`/range(address='${address}')`),
      { method: "PATCH", body: JSON.stringify({ values }) },
      sessionId
    );
  }

  async function addEntry(drivePath, token, sessionId, fields) {
    const tableRows = await fetchAllTableRows(drivePath, token, sessionId);
    const { excelRow, needInsert } = findAddRow(tableRows, null);

    if (needInsert) {
      await excelFetch(
        drivePath,
        token,
        `/tables('${encodeSheet(TABLE)}')/rows/add`,
        {
          method: "POST",
          body: JSON.stringify({
            values: [
              [
                fields.datumStr,
                null,
                null,
                fields.opdrachtgever || "",
                fields.project || "",
                fields.werkzaamheden || "",
                fields.locatie || "",
                Number(fields.uren) || 0,
                Number(fields.tarief) || 0,
              ],
            ],
          }),
        },
        sessionId
      );
    } else {
      await patchRange(drivePath, token, sessionId, `A${excelRow}`, [[fields.datumStr]]);
      await patchRange(
        drivePath,
        token,
        sessionId,
        `D${excelRow}:I${excelRow}`,
        [fieldsToDataRow(fields)]
      );
    }
  }

  async function updateEntry(drivePath, token, sessionId, rowIndex, fields) {
    if (rowIndex < START_ROW) {
      throw new Error("Regel niet meer gevonden in Excel (ververs lijsten).");
    }
    await patchRange(drivePath, token, sessionId, `A${rowIndex}`, [[fields.datumStr]]);
    await patchRange(
      drivePath,
      token,
      sessionId,
      `D${rowIndex}:I${rowIndex}`,
      [fieldsToDataRow(fields)]
    );
  }

  async function deleteEntry(drivePath, token, sessionId, rowIndex) {
    const tableIndex = rowIndex - START_ROW;
    if (tableIndex < 0) {
      throw new Error("Regel niet meer gevonden in Excel (ververs lijsten).");
    }
    await excelFetch(
      drivePath,
      token,
      `/tables('${encodeSheet(TABLE)}')/rows/${tableIndex}`,
      { method: "DELETE" },
      sessionId
    );
  }

  global.UrenGraphExcel = {
    readAllEntries,
    addEntry,
    updateEntry,
    deleteEntry,
    withSession,
  };
})(window);
