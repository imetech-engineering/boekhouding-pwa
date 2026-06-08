/**
 * Invoer form, suggesties and historie UI helpers.
 */
(function (global) {
  function sortByUsage(usageMap, names) {
    const list = names ? [...names] : Object.keys(usageMap || {});
    return list.sort((a, b) => {
      const sa = usageMap[a] || { uren: 0, count: 0, last: null };
      const sb = usageMap[b] || { uren: 0, count: 0, last: null };
      const la = sa.last ? sa.last.getTime() : 0;
      const lb = sb.last ? sb.last.getTime() : 0;
      if (sb.uren !== sa.uren) return sb.uren - sa.uren;
      if (sb.count !== sa.count) return sb.count - sa.count;
      if (lb !== la) return lb - la;
      return String(a).localeCompare(String(b));
    });
  }

  function rankSearchOption(opt, query) {
    const q = (query || "").trim().toLowerCase();
    if (!q) return 0;
    const o = String(opt).toLowerCase();
    if (o === q) return 0;
    if (o.startsWith(q)) return 1;
    if (o.includes(q)) return 2;
    return 3;
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

  function sortContextValues(bucket, key) {
    const map = bucket?.[key];
    if (!map) return [];
    return Object.keys(map).sort((a, b) => {
      const sa = map[a];
      const sb = map[b];
      const la = sa.last ? sa.last.getTime() : 0;
      const lb = sb.last ? sb.last.getTime() : 0;
      if (sb.uren !== sa.uren) return sb.uren - sa.uren;
      if (sb.count !== sa.count) return sb.count - sa.count;
      if (lb !== la) return lb - la;
      return a.localeCompare(b);
    });
  }

  function smartProjects(intel, og) {
    if (!intel) return [];
    og = (og || "").trim();
    if (og && intel.projects_by_og?.[og]) {
      return sortContextValues(intel.projects_by_og, og);
    }
    return sortByUsage(intel.proj_usage, intel.all_projects);
  }

  function smartLocaties(intel, og, project) {
    if (!intel) return [];
    og = (og || "").trim();
    project = (project || "").trim();
    const pairKey = `${og}\0${project}`;
    if (og && project && intel.locaties_by_og_proj?.[pairKey]) {
      return sortContextValues(intel.locaties_by_og_proj, pairKey);
    }
    if (og && intel.locaties_by_og?.[og]) {
      return sortContextValues(intel.locaties_by_og, og);
    }
    return sortByUsage(intel.loc_usage, intel.all_locaties);
  }

  function smartWerkzaamheden(intel, og, project, loc) {
    if (!intel) return [];
    og = (og || "").trim();
    project = (project || "").trim();
    loc = (loc || "").trim();
    const fullKey = `${og}\0${project}\0${loc}`;
    const projKey = `${og}\0${project}`;
    if (og && project && loc && intel.werk_by_context?.[fullKey]) {
      return sortContextValues(intel.werk_by_context, fullKey);
    }
    if (og && project && intel.werk_by_og_proj?.[projKey]) {
      return sortContextValues(intel.werk_by_og_proj, projKey);
    }
    if (og && intel.werk_by_og?.[og]) {
      return sortContextValues(intel.werk_by_og, og);
    }
    return sortByUsage(intel.werk_usage, intel.all_werk);
  }

  function validateForm(fields) {
    if (!fields.datumStr) return "Datum is verplicht.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.datumStr)) return "Datum formaat: JJJJ-MM-DD.";
    if (!fields.opdrachtgever?.trim()) return "Opdrachtgever is verplicht.";
    if (!fields.project?.trim()) return "Project is verplicht.";
    if (!fields.locatie?.trim()) return "Locatie is verplicht.";
    if (!fields.werkzaamheden?.trim()) return "Werkzaamheden zijn verplicht.";
    const u = Number(fields.uren);
    if (!Number.isFinite(u) || u <= 0) return "Uren moet een positief getal zijn.";
    return null;
  }

  function budgetWarning(estimates, fields, excludeRowIndex) {
    const proj = (fields.project || "").trim();
    const og = (fields.opdrachtgever || "").trim();
    const newHours = Number(fields.uren);
    if (!proj || !Number.isFinite(newHours) || newHours <= 0) return null;
    const est = (estimates || []).find(
      (e) =>
        e.project === proj &&
        (!og || !e.opdrachtgever || e.opdrachtgever === og) &&
        UrenEstimates.ACTIVE_STATUSES.has(e.status)
    );
    if (!est) return null;
    const delta = UrenEstimates.displayDelta(est);
    if (delta == null) return null;
    let oldHours = 0;
    if (excludeRowIndex != null) {
      // caller passes matching entry hours via fields._prevHours if editing
      oldHours = Number(fields._prevHours) || 0;
    }
    const after = delta - newHours + oldHours;
    if (after < 0) {
      return `Project "${proj}": na deze regel ${after.toFixed(1)} u over budget (inschatting overschreden). Toch opslaan?`;
    }
    return null;
  }

  function findSimilarEntries(entries, fields, hoursTolerance = 0.5) {
    const og = (fields.opdrachtgever || "").trim().toLowerCase();
    const proj = (fields.project || "").trim().toLowerCase();
    const datumStr = fields.datumStr;
    const uren = Number(fields.uren);
    if (!datumStr || !og || !proj) return [];
    return (entries || []).filter((e) => {
      if (e.datumStr !== datumStr) return false;
      if ((e.opdrachtgever || "").trim().toLowerCase() !== og) return false;
      if ((e.project || "").trim().toLowerCase() !== proj) return false;
      if (Number.isFinite(uren) && Math.abs((e.uren || 0) - uren) > hoursTolerance) return false;
      return true;
    });
  }

  function formatSimilarWarning(matches) {
    const n = matches.length;
    const sample = matches[0];
    const line = sample
      ? `${sample.datumStr} · ${sample.opdrachtgever} · ${sample.project} · ${sample.uren} u`
      : "";
    return `Er ${n === 1 ? "staat al" : `staan al ${n}`} een vergelijkbare regel${n > 1 ? "s" : ""} op deze dag (${line}${n > 1 ? ", …" : ""}). Toch opslaan?`;
  }

  global.UrenInvoer = {
    sortByUsage,
    sortContextValues,
    smartProjects,
    smartLocaties,
    smartWerkzaamheden,
    rankSearchOption,
    filterSuggestions,
    suggestTarief,
    formatHistoryLine,
    validateForm,
    findSimilarEntries,
    formatSimilarWarning,
    budgetWarning,
  };
})(window);
