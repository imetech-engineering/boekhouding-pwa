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
    if (mode === "custom_week") {
      const y = filters.customWeekYear || t.getFullYear();
      const w = filters.customWeek || 1;
      const start = isoWeekStart(y, w);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return { start, end };
    }
    return { start: null, end: null };
  }

  function isoWeekStart(year, week) {
    const jan4 = new Date(year, 0, 4);
    const day = jan4.getDay() || 7;
    const week1Mon = new Date(jan4);
    week1Mon.setDate(jan4.getDate() - day + 1);
    const start = new Date(week1Mon);
    start.setDate(week1Mon.getDate() + (week - 1) * 7);
    return dateOnly(start);
  }

  function chartYearFromRows(rows, fallback) {
    let maxY = fallback || new Date().getFullYear();
    for (const r of rows) {
      const d = dateOnly(r.datum);
      if (d.getFullYear() > maxY) maxY = d.getFullYear();
    }
    return maxY;
  }

  function isoWeekNumber(d) {
    const date = dateOnly(d);
    const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7);
    return { year: tmp.getUTCFullYear(), week };
  }

  function rowsForChartYear(rows, year) {
    return rows.filter((r) => dateOnly(r.datum).getFullYear() === year);
  }

  function aggregateHoursPerIsoWeek(rows, year) {
    const buckets = {};
    for (const r of rows) {
      const { year: isoYear, week } = isoWeekNumber(r.datum);
      if (isoYear !== year) continue;
      buckets[week] = (buckets[week] || 0) + r.uren;
    }
    const out = [];
    for (let w = 1; w <= 53; w++) {
      out.push({ week: w, uren: Math.round((buckets[w] || 0) * 100) / 100 });
    }
    return out;
  }

  function aggregateHoursPerMonth(rows, year) {
    const buckets = {};
    for (let m = 1; m <= 12; m++) buckets[m] = 0;
    for (const r of rows) {
      const d = dateOnly(r.datum);
      if (d.getFullYear() !== year) continue;
      buckets[d.getMonth() + 1] += r.uren;
    }
    return Object.keys(buckets).map((m) => ({
      month: Number(m),
      uren: Math.round(buckets[m] * 100) / 100,
    }));
  }

  function aggregateHoursPerOg(rows, topN = 12) {
    const buckets = {};
    for (const r of rows) {
      const og = (r.opdrachtgever || "").trim() || "(geen)";
      buckets[og] = (buckets[og] || 0) + r.uren;
    }
    return Object.entries(buckets)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, topN)
      .map(([og, uren]) => ({ og, uren: Math.round(uren * 100) / 100 }));
  }

  function aggregateRevenuePerOg(rows, topN = 10) {
    const buckets = {};
    for (const r of rows) {
      const og = (r.opdrachtgever || "").trim() || "(geen)";
      buckets[og] = (buckets[og] || 0) + (r.bedrag || 0);
    }
    return Object.entries(buckets)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, topN)
      .map(([og, bedrag]) => ({ og, bedrag: Math.round(bedrag * 100) / 100 }));
  }

  function aggregateRevenuePerMonth(rows, year) {
    const buckets = {};
    for (let m = 1; m <= 12; m++) buckets[m] = 0;
    for (const r of rows) {
      const d = dateOnly(r.datum);
      if (d.getFullYear() !== year) continue;
      buckets[d.getMonth() + 1] += r.bedrag || 0;
    }
    return Object.keys(buckets).map((m) => ({
      month: Number(m),
      bedrag: Math.round(buckets[m] * 100) / 100,
    }));
  }

  function aggregateHoursPerLocatie(rows, topN = 12) {
    const buckets = {};
    for (const r of rows) {
      const loc = (r.locatie || "").trim() || "(geen locatie)";
      buckets[loc] = (buckets[loc] || 0) + r.uren;
    }
    return Object.entries(buckets)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, topN)
      .map(([loc, uren]) => ({ loc, uren: Math.round(uren * 100) / 100 }));
  }

  function aggregateCumulativeForYear(rows, year) {
    const dailyU = {};
    const dailyE = {};
    for (const r of rows) {
      const d = dateOnly(r.datum);
      if (d.getFullYear() !== year) continue;
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      dailyU[k] = (dailyU[k] || 0) + r.uren;
      dailyE[k] = (dailyE[k] || 0) + (r.bedrag || 0);
    }
    const keys = Object.keys(dailyU)
      .concat(Object.keys(dailyE))
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort();
    let totalU = 0;
    let totalE = 0;
    return keys.map((k) => {
      totalU += dailyU[k] || 0;
      totalE += dailyE[k] || 0;
      return {
        label: k,
        uren: Math.round(totalU * 100) / 100,
        bedrag: Math.round(totalE * 100) / 100,
      };
    });
  }

  function aggregateCumulativeHours(rows) {
    const daily = {};
    for (const r of rows) {
      const d = dateOnly(r.datum);
      const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      daily[k] = (daily[k] || 0) + r.uren;
    }
    const keys = Object.keys(daily).sort();
    let total = 0;
    return keys.map((k) => {
      total += daily[k];
      const parts = k.split("-").map(Number);
      const label = `${parts[0]}-${String(parts[1] + 1).padStart(2, "0")}-${String(parts[2]).padStart(2, "0")}`;
      return { label, uren: Math.round(total * 100) / 100 };
    });
  }

  /** OG/project/tarief/keyword filters — no analyse period (week/month) limit. */
  function filterRowsForCharts(rows, filters) {
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
      if (kw && !(r.werkzaamheden || "").toLowerCase().includes(kw)) return false;
      return true;
    });
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

  function countUniqueDays(rows) {
    const days = new Set();
    for (const r of rows) {
      const d = dateOnly(r.datum);
      days.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
    }
    return days.size;
  }

  function aggregateLocations(rows) {
    const stats = {};
    for (const r of rows) {
      const loc = (r.locatie || "").trim() || "(geen locatie)";
      if (!stats[loc]) stats[loc] = { days: new Set(), uren: 0, bedrag: 0 };
      const d = dateOnly(r.datum);
      stats[loc].days.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
      stats[loc].uren += r.uren;
      stats[loc].bedrag += r.bedrag;
    }
    return Object.keys(stats)
      .sort((a, b) => a.localeCompare(b))
      .map((loc) => ({
        loc,
        days: stats[loc].days.size,
        uren: stats[loc].uren,
        bedrag: stats[loc].bedrag,
      }));
  }

  global.UrenAnalyse = {
    filterRows,
    filterRowsForCharts,
    sortFilterValues,
    summarize,
    groupRows,
    periodBounds,
    countUniqueDays,
    aggregateLocations,
    isoWeekStart,
    isoWeekNumber,
    chartYearFromRows,
    rowsForChartYear,
    aggregateHoursPerIsoWeek,
    aggregateHoursPerMonth,
    aggregateHoursPerOg,
    aggregateRevenuePerOg,
    aggregateRevenuePerMonth,
    aggregateHoursPerLocatie,
    aggregateCumulativeForYear,
    aggregateCumulativeHours,
  };
})(window);
