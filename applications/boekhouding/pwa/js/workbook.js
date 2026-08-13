/**
 * Generieke Graph Workbook (Excel API) laag: sessies, ranges, tabellen.
 * Eén implementatie voor alle sheets (verbetering t.o.v. gedupliceerde uren-modules).
 * Met retry op 429/throttling (Retry-After).
 */
(function (global) {
  function workbookUrl(drivePath, suffix) {
    if (typeof suffix === "string" && suffix.startsWith("http")) return suffix;
    return `${global.BoekGraph.itemUrl(drivePath)}:/workbook${suffix}`;
  }

  async function excelFetch(drivePath, token, suffix, options = {}, sessionId) {
    const url = workbookUrl(drivePath, suffix);
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };
    if (sessionId) headers["workbook-session-id"] = sessionId;

    let attempt = 0;
    for (;;) {
      const res = await fetch(url, { ...options, headers });
      if (res.status === 429 || res.status === 503) {
        attempt += 1;
        if (attempt > 4) {
          throw new Error(`Excel API overbelast (${res.status}). Probeer het zo opnieuw.`);
        }
        const retryAfter = parseFloat(res.headers.get("Retry-After")) || attempt * 2;
        await new Promise((r) => setTimeout(r, Math.min(retryAfter, 15) * 1000));
        continue;
      }
      if (!res.ok) {
        const text = await res.text();
        if (res.status === 423 || res.status === 409) {
          throw new global.BoekGraph.GraphLockError(
            "Bestand is vergrendeld (Excel open op PC?). Sluit Excel en probeer opnieuw."
          );
        }
        throw new Error(`Excel API mislukt (${res.status}): ${text}`);
      }
      if (res.status === 204) return null;
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) return res.json();
      return res;
    }
  }

  /** Workbook-sessie met persistChanges; altijd netjes sluiten. */
  async function withSession(drivePath, token, fn) {
    const created = await excelFetch(drivePath, token, "/createSession", {
      method: "POST",
      body: JSON.stringify({ persistChanges: true }),
    });
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
      } catch (_) {
        /* sessie verloopt vanzelf */
      }
    }
  }

  function encodeSheet(name) {
    return name.replace(/'/g, "''");
  }

  function wsPath(sheet, suffix) {
    return `/worksheets('${encodeURIComponent(encodeSheet(sheet))}')${suffix}`;
  }

  /** Lees de volledige tabel-range (header + data): address + values in één call. */
  async function readTableRange(drivePath, token, tableName, sessionId) {
    const data = await excelFetch(
      drivePath,
      token,
      `/tables('${encodeURIComponent(tableName)}')/range?$select=address,values`,
      {},
      sessionId
    );
    const m = (data.address || "").match(/(?:'[^']+'!)?\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)/i);
    return {
      values: data.values || [],
      startCol: m ? m[1] : "A",
      headerRow: m ? parseInt(m[2], 10) : 5,
      endCol: m ? m[3] : null,
      endRow: m ? parseInt(m[4], 10) : null,
    };
  }

  /** PATCH values op een range; null-cellen blijven onaangeroerd. */
  async function patchValues(drivePath, token, sessionId, sheet, address, values) {
    return excelFetch(
      drivePath,
      token,
      wsPath(sheet, `/range(address='${address}')`),
      { method: "PATCH", body: JSON.stringify({ values }) },
      sessionId
    );
  }

  /** PATCH formules op een range. */
  async function patchFormulas(drivePath, token, sessionId, sheet, address, formulas) {
    return excelFetch(
      drivePath,
      token,
      wsPath(sheet, `/range(address='${address}')`),
      { method: "PATCH", body: JSON.stringify({ formulas }) },
      sessionId
    );
  }

  /** Rij toevoegen aan een tabel (alleen als er geen leeg slot meer is). */
  async function addTableRow(drivePath, token, sessionId, tableName, values) {
    return excelFetch(
      drivePath,
      token,
      `/tables('${encodeURIComponent(tableName)}')/rows/add`,
      { method: "POST", body: JSON.stringify({ values: [values] }) },
      sessionId
    );
  }

  global.BoekWorkbook = {
    excelFetch,
    withSession,
    wsPath,
    readTableRange,
    patchValues,
    patchFormulas,
    addTableRow,
  };
})(window);
