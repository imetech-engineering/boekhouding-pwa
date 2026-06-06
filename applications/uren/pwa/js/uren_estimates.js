/**
 * Ureninschattingen: parsing, filters, status summary.
 */
(function (global) {
  const SHEET_ESTIMATES = "Ureninschattingen";
  const TABLE_ESTIMATES = "Tabel132";
  const ESTIMATE_START_ROW = 6;

  const COL = {
    DATUM: 0,
    WEEK: 1,
    OG: 2,
    PROJECT: 3,
    PLANNED: 4,
    ACTUAL: 5,
    UURSTATUS: 6,
    EINDSTATUS: 7,
    STATUS_MENU: 8,
    STATUS: 9,
    OPMERKING: 10,
  };

  const PROJECT_STATUSES = [
    "Wachten op akkoord",
    "In opdracht",
    "Afgerond",
    "On hold",
    "Geannuleerd",
  ];

  const DEFAULT_STATUS = "Wachten op akkoord";
  const ACTIVE_STATUSES = new Set(["In opdracht", "On hold", "Wachten op akkoord"]);

  const PROJECT_NR_RE = /^((?:10|20|30|40|50|60|70)\d{2})(?:\s+|-+)?(.*)$/;

  function parseGraphDate(v) {
    if (v == null || v === "") return null;
    if (typeof v === "number") {
      const epoch = new Date(Date.UTC(1899, 11, 30));
      return new Date(epoch.getTime() + v * 86400000);
    }
    if (typeof v === "string") {
      const d = new Date(v.slice(0, 10) + "T12:00:00");
      return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  function floatOrNull(v) {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function parseEstimateRow(values, excelRow) {
    if (!values || values.length < 4) return null;
    const project = String(values[COL.PROJECT] || "").trim();
    if (!project) return null;
    const dt = parseGraphDate(values[COL.DATUM]);
    const planned = floatOrNull(values[COL.PLANNED]) ?? 0;
    const actual = floatOrNull(values[COL.ACTUAL]) ?? 0;
    const status = String(values[COL.STATUS] || "").trim() || DEFAULT_STATUS;
    return {
      datum: dt,
      datumStr: dt ? UrenExcel.formatDateIso(dt) : "",
      opdrachtgever: String(values[COL.OG] || "").trim(),
      project,
      ureninschatting: planned,
      gemaakte_uren: actual,
      uurstatus: floatOrNull(values[COL.UURSTATUS]),
      uur_eindstatus: floatOrNull(values[COL.EINDSTATUS]),
      status,
      opmerking: String(values[COL.OPMERKING] || "").trim(),
      row_index: excelRow,
    };
  }

  function projectSortKey(project) {
    const m = PROJECT_NR_RE.exec(project || "");
    if (m) return [0, m[1], (m[2] || "").toLowerCase()];
    return [1, "", (project || "").toLowerCase()];
  }

  function sortEstimates(rows) {
    return [...rows].sort((a, b) => {
      const ka = projectSortKey(a.project);
      const kb = projectSortKey(b.project);
      for (let i = 0; i < 3; i++) {
        if (ka[i] < kb[i]) return -1;
        if (ka[i] > kb[i]) return 1;
      }
      return 0;
    });
  }

  function filterEstimates(rows, filters) {
    const statuses = filters?.statuses || [];
    const q = (filters?.search || "").trim().toLowerCase();
    return rows.filter((r) => {
      if (statuses.length && !statuses.includes(r.status)) return false;
      if (!q) return true;
      const hay = `${r.project} ${r.opdrachtgever} ${r.opmerking}`.toLowerCase();
      return hay.includes(q);
    });
  }

  function buildStatusSummary(rows) {
    const counts = {};
    for (const s of PROJECT_STATUSES) counts[s] = 0;
    let activePlanned = 0;
    let activeActual = 0;
    let activeRemaining = 0;
    const overBudget = [];
    for (const r of rows) {
      const st = r.status || DEFAULT_STATUS;
      counts[st] = (counts[st] || 0) + 1;
      if (!ACTIVE_STATUSES.has(st)) continue;
      const planned = Number(r.ureninschatting) || 0;
      const actual = Number(r.gemaakte_uren) || 0;
      activePlanned += planned;
      activeActual += actual;
      let delta = r.uurstatus;
      if (delta == null && st === "In opdracht") delta = planned - actual;
      if (delta != null) {
        activeRemaining += Number(delta);
        if (Number(delta) < 0) overBudget.push(r);
      }
    }
    return {
      counts,
      activePlanned: Math.round(activePlanned * 10) / 10,
      activeActual: Math.round(activeActual * 10) / 10,
      activeRemaining: Math.round(activeRemaining * 10) / 10,
      overBudget,
    };
  }

  function displayDelta(row) {
    if (row.status === "In opdracht" && row.uurstatus != null) return row.uurstatus;
    if (row.status === "Afgerond" && row.uur_eindstatus != null) return row.uur_eindstatus;
    if (row.status === "In opdracht") {
      return (Number(row.ureninschatting) || 0) - (Number(row.gemaakte_uren) || 0);
    }
    return null;
  }

  function statusClass(status) {
    const map = {
      "In opdracht": "status-actief",
      "Wachten op akkoord": "status-wacht",
      Afgerond: "status-afgerond",
      "On hold": "status-hold",
      Geannuleerd: "status-geannuleerd",
    };
    return map[status] || "status-default";
  }

  global.UrenEstimates = {
    SHEET_ESTIMATES,
    TABLE_ESTIMATES,
    ESTIMATE_START_ROW,
    COL,
    PROJECT_STATUSES,
    DEFAULT_STATUS,
    parseEstimateRow,
    sortEstimates,
    filterEstimates,
    buildStatusSummary,
    displayDelta,
    statusClass,
  };
})(window);
