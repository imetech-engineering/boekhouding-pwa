/**
 * Invoer form, suggesties and historie UI helpers.
 */
(function (global) {
  function sortByUsage(usageMap, names) {
    const list = names ? [...names] : Object.keys(usageMap || {});
    return list.sort((a, b) => {
      const sa = usageMap[a] || { uren: 0, count: 0 };
      const sb = usageMap[b] || { uren: 0, count: 0 };
      if (sb.uren !== sa.uren) return sb.uren - sa.uren;
      return sb.count - sa.count;
    });
  }

  function filterSuggestions(list, query, limit = 12) {
    const q = (query || "").trim().toLowerCase();
    let out = list;
    if (q) {
      out = list.filter((n) => n.toLowerCase().includes(q));
    }
    return out.slice(0, limit);
  }

  function suggestTarief(intel, og, project) {
    if (og && project) {
      const k = `${og}\0${project}`;
      if (intel.tarieven_pair[k] != null) return intel.tarieven_pair[k];
    }
    return "";
  }

  function formatHistoryLine(entry) {
    const wz = (entry.werkzaamheden || "").slice(0, 36);
    return `${entry.datumStr} | ${entry.opdrachtgever} | ${entry.project} | ${entry.locatie} | ${wz} | ${entry.uren} u × €${entry.tarief}`;
  }

  function validateForm(fields) {
    if (!fields.datumStr) return "Datum is verplicht.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.datumStr)) return "Datum formaat: JJJJ-MM-DD.";
    if (!fields.opdrachtgever?.trim()) return "Opdrachtgever is verplicht.";
    const u = Number(fields.uren);
    if (!Number.isFinite(u) || u <= 0) return "Uren moet een positief getal zijn.";
    return null;
  }

  global.UrenInvoer = {
    sortByUsage,
    filterSuggestions,
    suggestTarief,
    formatHistoryLine,
    validateForm,
  };
})(window);
