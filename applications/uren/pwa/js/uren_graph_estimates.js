/**
 * Excel I/O for Ureninschattingen via Microsoft Graph Workbook API.
 */
(function (global) {
  const SHEET = UrenEstimates.SHEET_ESTIMATES;
  const TABLE = UrenEstimates.TABLE_ESTIMATES;
  const START_ROW = UrenEstimates.ESTIMATE_START_ROW;
  const COL = UrenEstimates.COL;
  const DEFAULT_STATUS = UrenEstimates.DEFAULT_STATUS;

  let cachedLayout = null;

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

  function parseRangeTopRow(address) {
    if (!address) return null;
    const m = address.match(/(?:'[^']+'!)?\$?([A-Z]+)\$?(\d+)/i);
    return m ? parseInt(m[2], 10) : null;
  }

  async function getTableLayout(drivePath, token, sessionId) {
    if (cachedLayout) return cachedLayout;
    const rangeData = await excelFetch(
      drivePath,
      token,
      `/tables('${encodeSheet(TABLE)}')/range`,
      {},
      sessionId
    );
    const headerRow = parseRangeTopRow(rangeData.address) || START_ROW - 1;
    const dataStartRow = headerRow + 1;
    cachedLayout = { headerRow, dataStartRow };
    return cachedLayout;
  }

  function tableIndexToExcelRow(tableIndex, dataStartRow) {
    return dataStartRow + tableIndex;
  }

  async function withSession(drivePath, token, fn) {
    cachedLayout = null;
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
      cachedLayout = null;
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
    let seq = 0;
    while (path) {
      const data = await excelFetch(drivePath, token, path, {}, sessionId);
      for (const r of data.value || []) {
        const vals = r.values?.[0];
        if (!vals) continue;
        const idx = typeof r.index === "number" ? r.index : seq;
        rows.push({ index: idx, values: vals });
        seq = idx + 1;
      }
      const next = data["@odata.nextLink"];
      path = next || null;
    }
    rows.sort((a, b) => a.index - b.index);
    return rows;
  }

  async function readUsedRangeValues(drivePath, token, sessionId, dataStartRow) {
    const data = await excelFetch(
      drivePath,
      token,
      wsPath("/usedRange(valuesOnly=true)"),
      {},
      sessionId
    );
    const address = data.address || data.text || "";
    const match = address.match(/:K(\d+)/i);
    const endRow = match ? parseInt(match[1], 10) : dataStartRow + 200;
    if (endRow < dataStartRow) return [];
    const range = wsPath(`/range(address='A${dataStartRow}:K${endRow}')`);
    const block = await excelFetch(drivePath, token, range, {}, sessionId);
    return block.values || [];
  }

  function rowIsEmptySlot(values) {
    return !String(values?.[COL.PROJECT] || "").trim();
  }

  function findAddRow(tableRows, dataStartRow) {
    if (tableRows?.length) {
      let lastIdx = tableRows.length - 1;
      while (lastIdx >= 0) {
        const v = tableRows[lastIdx].values;
        if (v && v.some((c) => c != null && c !== "")) break;
        lastIdx--;
      }
      const searchEnd = lastIdx;
      for (let i = 0; i <= searchEnd; i++) {
        if (rowIsEmptySlot(tableRows[i].values)) {
          return {
            excelRow: tableIndexToExcelRow(tableRows[i].index, dataStartRow),
            needInsert: false,
            insertAtIndex: null,
          };
        }
      }
      const nextIndex = tableRows[lastIdx].index + 1;
      return {
        excelRow: tableIndexToExcelRow(nextIndex, dataStartRow),
        needInsert: true,
        insertAtIndex: null,
      };
    }
    return {
      excelRow: dataStartRow,
      needInsert: true,
      insertAtIndex: null,
    };
  }

  async function readAllEstimates(drivePath, token) {
    const layout = await getTableLayout(drivePath, token);
    const { dataStartRow } = layout;
    let tableRows = [];
    try {
      tableRows = await fetchAllTableRows(drivePath, token);
    } catch (_) {
      tableRows = [];
    }

    const estimates = [];
    if (tableRows.length) {
      for (const tr of tableRows) {
        const excelRow = tableIndexToExcelRow(tr.index, dataStartRow);
        const row = UrenEstimates.parseEstimateRow(tr.values, excelRow);
        if (row) estimates.push(row);
      }
      return estimates;
    }

    const values = await readUsedRangeValues(drivePath, token, null, dataStartRow);
    for (let i = 0; i < values.length; i++) {
      const row = UrenEstimates.parseEstimateRow(values[i], dataStartRow + i);
      if (row) estimates.push(row);
    }
    return estimates;
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

  function normalizeFields(fields) {
    const status = (fields.status || DEFAULT_STATUS).trim();
    return {
      datumStr: fields.datumStr,
      opdrachtgever: fields.opdrachtgever || "",
      project: fields.project || "",
      ureninschatting: Number(fields.ureninschatting) || 0,
      status: UrenEstimates.PROJECT_STATUSES.includes(status) ? status : DEFAULT_STATUS,
      opmerking: fields.opmerking || "",
    };
  }

  async function patchEditableCells(drivePath, token, sessionId, excelRow, fields) {
    const f = normalizeFields(fields);
    await patchRange(drivePath, token, sessionId, `A${excelRow}`, [[f.datumStr]]);
    await patchRange(drivePath, token, sessionId, `C${excelRow}`, [[f.opdrachtgever]]);
    await patchRange(drivePath, token, sessionId, `D${excelRow}`, [[f.project]]);
    await patchRange(drivePath, token, sessionId, `E${excelRow}`, [[f.ureninschatting]]);
    await patchRange(drivePath, token, sessionId, `J${excelRow}`, [[f.status]]);
    await patchRange(drivePath, token, sessionId, `K${excelRow}`, [[f.opmerking]]);
  }

  async function addEstimate(drivePath, token, sessionId, fields) {
    const f = normalizeFields(fields);
    if (!f.project.trim()) throw new Error("Project is verplicht.");
    const layout = await getTableLayout(drivePath, token, sessionId);
    const tableRows = await fetchAllTableRows(drivePath, token, sessionId);
    const { excelRow, needInsert, insertAtIndex } = findAddRow(
      tableRows,
      layout.dataStartRow
    );

    if (needInsert) {
      const payload = {
        values: [
          [
            f.datumStr,
            null,
            f.opdrachtgever,
            f.project,
            f.ureninschatting,
            null,
            null,
            null,
            null,
            f.status,
            f.opmerking,
          ],
        ],
      };
      if (insertAtIndex != null) payload.index = insertAtIndex;
      await excelFetch(
        drivePath,
        token,
        `/tables('${encodeSheet(TABLE)}')/rows/add`,
        { method: "POST", body: JSON.stringify(payload) },
        sessionId
      );
    } else {
      await patchEditableCells(drivePath, token, sessionId, excelRow, f);
    }
  }

  async function updateEstimate(drivePath, token, sessionId, rowIndex, fields) {
    const layout = await getTableLayout(drivePath, token, sessionId);
    if (rowIndex < layout.dataStartRow) {
      throw new Error("Projectrij niet meer gevonden (ververs lijst).");
    }
    await patchEditableCells(drivePath, token, sessionId, rowIndex, fields);
  }

  async function deleteEstimate(drivePath, token, sessionId, rowIndex) {
    const layout = await getTableLayout(drivePath, token, sessionId);
    if (rowIndex < layout.dataStartRow) {
      throw new Error("Projectrij niet meer gevonden (ververs lijst).");
    }
    await patchRange(drivePath, token, sessionId, `A${rowIndex}:K${rowIndex}`, [
      ["", "", "", "", "", "", "", "", "", "", ""],
    ]);
  }

  global.UrenGraphEstimates = {
    readAllEstimates,
    addEstimate,
    updateEstimate,
    deleteEstimate,
    withSession,
  };
})(window);
