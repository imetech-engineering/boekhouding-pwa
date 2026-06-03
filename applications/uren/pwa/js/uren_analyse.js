/**
 * Analyse filters and grouping (port of uren_app _filter_rows / _apply_analyse_filters).
 */
(function (global) {
  function dateOnly(d) {
    if (d instanceof Date) return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return d;
  }

  function periodBounds(filters) {
    const today = new Date();
    const t = dateOnly(today);
    const mode = filters.periodMode || "alles";
    if (mode === "alles") return { start: null, end: null };
    if (mode === "week") {
      const day = t.getDay();
      const diff = day === 0 ? 6 : day - 1;
      const start = new Date(t);
      start.setDate(t.getDate() - diff);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return { start, end };
    }
    if (mode === "month") {
      const start = new Date(t.getFullYear(), t.getMonth(), 1);
      const end = new Date(t.getFullYear(), t.getMonth() + 1, 0);
      return { start, end };
    }
    if (mode === "year") {
      return {
        start: new Date(t.getFullYear(), 0, 1),
        end: new Date(t.getFullYear(), 11, 31),
      };
    }
    if (mode === "custom_month") {
      const y = filters.customYear || t.getFullYear();
      const m = (filters.customMonth || t.getMonth() + 1) - 1;
      const start = new Date(y, m, 1);
      const end = new Date(y, m + 1, 0);
      return { start, end };
    }
    return { start: null, end: null };
  }

  function filterRows(rows, filters) {
    const { start, end } = periodBounds(filters);
    const kw = (filters.keyword || "").trim().toLowerCase();
    const ogs = filters.selectedOgs || [];
    const projs = filters.selectedProjs || [];
    const tarieven = filters.selectedTarieven || [];
    const tariefNonZero = filters.tariefNonZero;

    return rows.filter((r) => {
      if (ogs.length && !ogs.includes(r.opdrachtgever)) return false;
      if (projs.length && !projs.includes(r.project)) return false;
      const tr = Math.round((r.tarief || 0) * 10000) / 10000;
      if (tariefNonZero && tr === 0) return false;
      if (tarieven.length && !tarieven.includes(tr)) return false;
      const d = dateOnly(r.datum);
      if (start && (d < start || d > end)) return false;
      if (kw && !(r.werkzaamheden || "").toLowerCase().includes(kw)) return false;
      return true;
    });
  }

  function aggregateUsage(rows, field) {
    const stats = {};
    for (const r of rows) {
      let val =
        field === "tarief"
          ? Math.round((r.tarief || 0) * 10000) / 10000
          : (r[field] || "").trim();
      if (field !== "tarief" && !val) continue;
      if (!stats[val]) stats[val] = { uren: 0, count: 0, last: null };
      stats[val].uren += r.uren;
      stats[val].count += 1;
      if (!stats[val].last || r.datum > stats[val].last) stats[val].last = r.datum;
    }
    return stats;
  }

  function sortFilterValues(rows, field) {
    const stats = aggregateUsage(rows, field);
    return Object.keys(stats).sort((a, b) => {
      const sa = stats[a];
      const sb = stats[b];
      const la = sa.last ? sa.last.getTime() : 0;
      const lb = sb.last ? sb.last.getTime() : 0;
      if (sb.uren !== sa.uren) return sb.uren - sa.uren;
      if (sb.count !== sa.count) return sb.count - sa.count;
      if (lb !== la) return lb - la;
      return String(a).localeCompare(String(b));
    });
  }

  function summarize(rows) {
    let totU = 0;
    let totE = 0;
    for (const r of rows) {
      totU += r.uren;
      totE += r.bedrag;
    }
    return { totU, totE, count: rows.length };
  }

  function groupRows(rows, groupMode) {
    if (!groupMode || groupMode === "none") {
      return rows
        .slice()
        .sort((a, b) => a.datum - b.datum)
        .map((r) => ({
          label: r.datumStr,
          sub: r.opdrachtgever,
          detail: `${r.project} · ${r.locatie}`,
          uren: r.uren,
          tarief: r.tarief,
          bedrag: r.bedrag,
          werk: r.werkzaamheden,
        }));
    }
    const groups = new Map();
    for (const r of rows) {
      let key;
      let label;
      if (groupMode === "opdrachtgever") {
        key = r.opdrachtgever || "(geen)";
        label = key;
      } else if (groupMode === "project") {
        key = `${r.project || "(geen)"}|${r.tarief}`;
        label = `${r.project || "(geen)"} · €${r.tarief}/u`;
      } else if (groupMode === "week") {
        const d = dateOnly(r.datum);
        const jan4 = new Date(d.getFullYear(), 0, 4);
        const day = jan4.getDay() || 7;
        const week1 = new Date(jan4);
        week1.setDate(jan4.getDate() - day + 1);
        const wk = Math.ceil(((d - week1) / 86400000 + 1) / 7);
        key = `${d.getFullYear()}-W${wk}`;
        label = key;
      } else {
        key = `${r.datum.getFullYear()}-${r.datum.getMonth() + 1}`;
        label = key;
      }
      if (!groups.has(key)) {
        groups.set(key, { label, uren: 0, bedrag: 0, count: 0 });
      }
      const g = groups.get(key);
      g.uren += r.uren;
      g.bedrag += r.bedrag;
      g.count += 1;
    }
    return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  global.UrenAnalyse = {
    filterRows,
    sortFilterValues,
    summarize,
    groupRows,
    periodBounds,
  };
})(window);
