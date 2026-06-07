/**
 * PWA shell: sync state, routing, bottom nav, OneDrive read/write with etag.
 */
(function () {
  const state = {
    tab: "invoer",
    entries: [],
    intel: null,
    etag: null,
    meta: null,
    loading: false,
    quietRefresh: false,
    syncStatus: "Nog niet geladen",
    editRow: null,
    selectedHistoryRow: null,
    weekTarget: 0,
    lastOg: "",
    lastProj: "",
    lastLoc: "",
    analyseFilters: {
      periodMode: "month",
      keyword: "",
      selectedOgs: [],
      selectedProjs: [],
      selectedTarieven: [],
      tariefNonZero: false,
      groupMode: "none",
      customYear: new Date().getFullYear(),
      customMonth: new Date().getMonth() + 1,
      customWeekYear: new Date().getFullYear(),
      customWeek: 1,
    },
    chartFilters: {
      year: new Date().getFullYear(),
      chartMode: "week_year",
      cumulativeEuro: false,
    },
    chartInstance: null,
    darkMode: false,
    estimates: [],
    estimateFilters: { statuses: [], search: "" },
    estimateEditRow: null,
  };

  const $ = (sel) => document.querySelector(sel);

  function setStatus(msg, isError) {
    state.syncStatus = msg;
    const el = $("#sync-status");
    if (el) {
      el.textContent = msg;
      el.classList.toggle("error", !!isError);
    }
  }

  function haptic(pattern) {
    if (navigator.vibrate) {
      try {
        navigator.vibrate(pattern);
      } catch (_) {}
    }
  }

  function showToast(msg, isError) {
    const t = $("#toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.toggle("hidden", false);
    t.classList.toggle("error", !!isError);
    haptic(isError ? [40, 60, 40] : 30);
    clearTimeout(showToast._tid);
    showToast._tid = setTimeout(() => t.classList.add("hidden"), 5000);
  }

  function applyDarkMode(on) {
    state.darkMode = !!on;
    document.documentElement.dataset.theme = on ? "dark" : "";
    const meta = $("#meta-theme-color");
    if (meta) meta.content = on ? "#121210" : "#2563EB";
    const cb = $("#toggle-dark-mode");
    if (cb) cb.checked = on;
    try {
      localStorage.setItem("imtech-uren-dark", on ? "1" : "0");
    } catch (_) {}
    if (state.chartInstance) renderGrafiekenChart(state.entries);
  }

  function loadDarkPreference() {
    try {
      applyDarkMode(localStorage.getItem("imtech-uren-dark") === "1");
    } catch (_) {}
  }

  function loadWeekTarget() {
    try {
      const v = Number(localStorage.getItem("imtech-uren-week-target"));
      state.weekTarget = Number.isFinite(v) && v >= 0 ? v : 0;
    } catch (_) {
      state.weekTarget = 0;
    }
    const inp = $("#week-target-input");
    if (inp) inp.value = state.weekTarget ? String(state.weekTarget) : "";
  }

  function saveWeekTarget(val) {
    const n = Math.max(0, Number(val) || 0);
    state.weekTarget = n;
    try {
      localStorage.setItem("imtech-uren-week-target", String(n));
    } catch (_) {}
    updateInvoerStats();
  }

  function fieldsToEntry(fields, rowIndex) {
    const d = new Date(fields.datumStr + "T12:00:00");
    return {
      datum: d,
      datumStr: fields.datumStr,
      opdrachtgever: (fields.opdrachtgever || "").trim(),
      project: (fields.project || "").trim(),
      werkzaamheden: (fields.werkzaamheden || "").trim(),
      locatie: (fields.locatie || "").trim(),
      uren: Number(fields.uren) || 0,
      tarief: Number(fields.tarief) || 0,
      row_index: rowIndex,
    };
  }

  function renderAll(initialForm = false) {
    renderInvoer(initialForm);
    renderProjecten();
    renderAnalyse();
    renderGrafieken();
  }

  function optimisticAdd(fields) {
    const tempRow = -Date.now();
    const entry = fieldsToEntry(fields, tempRow);
    const snapshot = { entries: [...state.entries] };
    state.entries = [...state.entries, entry];
    state.intel = UrenExcel.buildIntel(state.entries);
    return () => {
      state.entries = snapshot.entries;
      state.intel = UrenExcel.buildIntel(state.entries);
    };
  }

  function optimisticUpdate(rowIndex, fields) {
    const idx = state.entries.findIndex((e) => e.row_index === rowIndex);
    if (idx < 0) return null;
    const snapshot = { entries: [...state.entries], idx, prev: { ...state.entries[idx] } };
    const next = [...state.entries];
    next[idx] = fieldsToEntry(fields, rowIndex);
    state.entries = next;
    state.intel = UrenExcel.buildIntel(state.entries);
    return () => {
      const rollback = [...state.entries];
      rollback[snapshot.idx] = snapshot.prev;
      state.entries = rollback;
      state.intel = UrenExcel.buildIntel(state.entries);
    };
  }

  function optimisticDelete(rowIndex) {
    const idx = state.entries.findIndex((e) => e.row_index === rowIndex);
    if (idx < 0) return null;
    const snapshot = { entries: [...state.entries], removed: state.entries[idx] };
    state.entries = state.entries.filter((e) => e.row_index !== rowIndex);
    state.intel = UrenExcel.buildIntel(state.entries);
    return () => {
      state.entries = snapshot.entries;
      state.intel = UrenExcel.buildIntel(state.entries);
    };
  }

  async function updateQueueBadge() {
    const el = $("#queue-status");
    if (!el) return;
    try {
      const n = await UrenOfflineQueue.count();
      if (n > 0) {
        el.textContent = `${n} wijziging${n > 1 ? "en" : ""} wachten op sync`;
        el.classList.remove("hidden");
      } else {
        el.classList.add("hidden");
      }
    } catch (_) {
      el.classList.add("hidden");
    }
  }

  function showConflictModal(message) {
    const modal = $("#conflict-modal");
    const msg = $("#conflict-message");
    if (!modal) return;
    if (msg) {
      msg.textContent =
        (message || "") +
        " Het bestand is op een ander apparaat gewijzigd. Ververs om de nieuwste versie te laden en probeer opnieuw.";
    }
    modal.classList.remove("hidden");
  }

  function closeConflictModal() {
    $("#conflict-modal")?.classList.add("hidden");
  }

  function isNetworkError(e) {
    if (!UrenOfflineQueue.isOnline()) return true;
    const m = (e?.message || "").toLowerCase();
    return (
      e?.name === "TypeError" ||
      m.includes("failed to fetch") ||
      m.includes("network") ||
      m.includes("load failed")
    );
  }

  async function executeMutation(descriptor) {
    const token = await ensureLoggedIn();
    const path = drivePath();
    const { kind, fields, rowIndex } = descriptor;
    if (kind === "hours_add") {
      await UrenGraphExcel.withSession(path, token, (sid) =>
        UrenGraphExcel.addEntry(path, token, sid, fields)
      );
    } else if (kind === "hours_update") {
      await UrenGraphExcel.withSession(path, token, (sid) =>
        UrenGraphExcel.updateEntry(path, token, sid, rowIndex, fields)
      );
    } else if (kind === "hours_delete") {
      await UrenGraphExcel.withSession(path, token, (sid) =>
        UrenGraphExcel.deleteEntry(path, token, sid, rowIndex)
      );
    } else if (kind === "estimate_add") {
      await UrenGraphEstimates.withSession(path, token, (sid) =>
        UrenGraphEstimates.addEstimate(path, token, sid, fields)
      );
    } else if (kind === "estimate_update") {
      await UrenGraphEstimates.withSession(path, token, (sid) =>
        UrenGraphEstimates.updateEstimate(path, token, sid, rowIndex, fields)
      );
    } else if (kind === "estimate_delete") {
      await UrenGraphEstimates.withSession(path, token, (sid) =>
        UrenGraphEstimates.deleteEstimate(path, token, sid, rowIndex)
      );
    }
  }

  async function flushOfflineQueue() {
    if (!UrenOfflineQueue.isOnline() || !UrenAuth.isLoggedIn()) return;
    const items = await UrenOfflineQueue.getAll();
    if (!items.length) return;
    setStatus(`Sync ${items.length} wachtende wijziging(en)…`);
    for (const item of items) {
      try {
        await executeMutation(item);
        await UrenOfflineQueue.remove(item.id);
      } catch (e) {
        if (e.name === "GraphConflictError") {
          showConflictModal(e.message);
          break;
        }
        if (isNetworkError(e)) break;
        await UrenOfflineQueue.remove(item.id);
        showToast(e.message || String(e), true);
      }
    }
    await updateQueueBadge();
    await refreshFromCloudQuiet();
  }

  async function refreshFromCloudQuiet() {
    if (state.loading || state.quietRefresh) return;
    state.quietRefresh = true;
    try {
      const token = await ensureLoggedIn();
      const path = drivePath();
      const meta = await UrenGraph.getDriveItemMeta(path, token);
      const entries = await UrenGraphExcel.readAllEntries(path, token);
      const estimates = await UrenGraphEstimates.readAllEstimates(path, token);
      state.entries = entries;
      state.estimates = estimates;
      state.intel = UrenExcel.buildIntel(entries);
      state.etag = meta.etag;
      state.meta = meta;
      setStatus(`Bijgewerkt ${new Date(meta.lastModified).toLocaleString("nl-NL")}`);
      renderAll(false);
      renderAccount();
    } catch (_) {
    } finally {
      state.quietRefresh = false;
    }
  }

  async function persistMutation(descriptor, optimisticRollback) {
    let rollback = null;
    if (optimisticRollback) {
      rollback = optimisticRollback();
      renderAll();
      showToast("Opgeslagen…");
    }

    if (!UrenOfflineQueue.isOnline()) {
      await UrenOfflineQueue.add(descriptor);
      await updateQueueBadge();
      showToast("Offline — wijziging in wachtrij");
      return;
    }

    try {
      await executeMutation(descriptor);
      const token = await ensureLoggedIn();
      const meta = await UrenGraph.getDriveItemMeta(drivePath(), token);
      state.etag = meta.etag;
      state.meta = meta;
      setStatus(`Bijgewerkt ${new Date(meta.lastModified).toLocaleString("nl-NL")}`);
      refreshFromCloudQuiet();
      showToast("Opgeslagen in OneDrive");
    } catch (e) {
      if (e.name === "GraphConflictError") {
        if (rollback) rollback();
        renderAll();
        showConflictModal(e.message);
        throw e;
      }
      if (isNetworkError(e)) {
        await UrenOfflineQueue.add(descriptor);
        await updateQueueBadge();
        showToast("Geen verbinding — wijziging in wachtrij");
        return;
      }
      if (rollback) {
        rollback();
        renderAll();
      }
      if (e.name === "GraphLockError") {
        showToast(e.message, true);
      } else {
        showToast(e.message || String(e), true);
      }
      throw e;
    }
  }

  function updatePeriodCustomVisibility() {
    const mode = state.analyseFilters.periodMode;
    $("#filter-custom-week")?.classList.toggle("hidden", mode !== "custom_week");
    $("#filter-custom-month")?.classList.toggle("hidden", mode !== "custom_month");
  }

  function updateGrafiekControlsVisibility() {
    const mode = state.chartFilters.chartMode;
    $("#grafiek-euro-row")?.classList.toggle("hidden", mode !== "cumulative");
  }

  const MONTH_LABELS = ["Jan", "Feb", "Mrt", "Apr", "Mei", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dec"];
  const PIE_COLORS = ["#2563eb", "#16a34a", "#dc2626", "#ca8a04", "#9333ea", "#0891b2", "#ea580c", "#64748b"];

  function renderGrafiekenChart(allEntries) {
    const cf = state.chartFilters;
    const canvas = $("#grafiek-chart");
    if (!canvas || typeof Chart === "undefined") return;
    const base = UrenAnalyse.filterRowsForCharts(allEntries, state.analyseFilters);
    const year = cf.year || UrenAnalyse.chartYearFromRows(base);
    const yearRows = UrenAnalyse.rowsForChartYear(base, year);
    let labels = [];
    let data = [];
    let data2 = [];
    let chartType = "bar";
    let title = "";
    const mode = cf.chartMode;

    if (mode === "week_year") {
      const weeks = UrenAnalyse.aggregateHoursPerIsoWeek(yearRows, year);
      labels = weeks.map((w) => `W${w.week}`);
      data = weeks.map((w) => w.uren);
      title = `Uren per ISO-week ${year}`;
    } else if (mode === "month_year") {
      const months = UrenAnalyse.aggregateHoursPerMonth(yearRows, year);
      labels = months.map((m) => MONTH_LABELS[m.month - 1]);
      data = months.map((m) => m.uren);
      title = `Uren per maand ${year}`;
    } else if (mode === "og_bar" || mode === "og_pie") {
      const ogs = UrenAnalyse.aggregateHoursPerOg(yearRows, 10);
      labels = ogs.map((o) => o.og);
      data = ogs.map((o) => o.uren);
      title = `Uren per opdrachtgever ${year}`;
      chartType = mode === "og_pie" ? "pie" : "bar";
    } else if (mode === "revenue_og_bar" || mode === "revenue_og_pie") {
      const ogs = UrenAnalyse.aggregateRevenuePerOg(yearRows, 10);
      labels = ogs.map((o) => o.og);
      data = ogs.map((o) => o.bedrag);
      title = `Omzet (€) per opdrachtgever ${year}`;
      chartType = mode === "revenue_og_pie" ? "pie" : "bar";
    } else if (mode === "revenue_month") {
      const months = UrenAnalyse.aggregateRevenuePerMonth(yearRows, year);
      labels = months.map((m) => MONTH_LABELS[m.month - 1]);
      data = months.map((m) => m.bedrag);
      title = `Omzet (€) per maand ${year}`;
    } else if (mode === "locatie") {
      const locs = UrenAnalyse.aggregateHoursPerLocatie(yearRows, 12);
      labels = locs.map((l) => l.loc);
      data = locs.map((l) => l.uren);
      title = `Uren per locatie ${year}`;
    } else if (mode === "cumulative") {
      const cum = UrenAnalyse.aggregateCumulativeForYear(yearRows, year);
      labels = cum.map((c) => c.label.slice(5));
      data = cum.map((c) => c.uren);
      if (cf.cumulativeEuro) data2 = cum.map((c) => c.bedrag);
      chartType = "line";
      title = cf.cumulativeEuro
        ? `Cumulatief uren en omzet ${year}`
        : `Cumulatief uren ${year}`;
    }

    const grid = getComputedStyle(document.documentElement).getPropertyValue("--chart-grid").trim();
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    const text = getComputedStyle(document.documentElement).getPropertyValue("--text-secondary").trim();
    const datasets =
      chartType === "line" && data2.length
        ? [
            {
              label: "Uren",
              data,
              backgroundColor: "transparent",
              borderColor: accent,
              borderWidth: 2,
              fill: false,
              tension: 0.2,
              yAxisID: "y",
            },
            {
              label: "Omzet €",
              data: data2,
              backgroundColor: "transparent",
              borderColor: "#16a34a",
              borderWidth: 2,
              fill: false,
              tension: 0.2,
              yAxisID: "y1",
            },
          ]
        : [
            {
              label: title,
              data,
              backgroundColor: chartType === "pie" ? PIE_COLORS : accent,
              borderColor: chartType === "pie" ? "#ffffff" : accent,
              borderWidth: chartType === "pie" ? 1 : 0,
            },
          ];

    if (state.chartInstance) state.chartInstance.destroy();
    const options = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: chartType === "pie" || data2.length > 0, labels: { color: text } }, title: { display: !!title, text: title, color: text } },
    };
    if (chartType !== "pie") {
      options.scales = {
        x: { ticks: { color: text, maxRotation: 45 }, grid: { color: grid } },
        y: { ticks: { color: text }, grid: { color: grid }, position: "left" },
      };
      if (data2.length) {
        options.scales.y1 = {
          ticks: { color: text },
          grid: { drawOnChartArea: false },
          position: "right",
        };
      }
    }
    state.chartInstance = new Chart(canvas, { type: chartType, data: { labels, datasets }, options });
  }

  function renderGrafieken() {
    updateGrafiekControlsVisibility();
    const summary = $("#grafiek-summary");
    if (!state.entries.length) {
      if (summary) summary.textContent = "Geen data — ververs uit OneDrive.";
      if (state.chartInstance) {
        state.chartInstance.destroy();
        state.chartInstance = null;
      }
      return;
    }
    const base = UrenAnalyse.filterRowsForCharts(state.entries, state.analyseFilters);
    const year = state.chartFilters.year || UrenAnalyse.chartYearFromRows(base);
    const yearRows = UrenAnalyse.rowsForChartYear(base, year);
    const sum = UrenAnalyse.summarize(yearRows);
    if (summary) {
      summary.textContent = `${year}: ${sum.totU.toFixed(1)} u · €${sum.totE.toFixed(2)} · ${sum.count} regels`;
    }
    renderGrafiekenChart(state.entries);
  }

  async function ensureLoggedIn() {
    if (!UrenAuth.isLoggedIn()) {
      throw new Error("Log eerst in met je Microsoft-account (Instellingen).");
    }
    return UrenAuth.acquireToken();
  }

  function drivePath() {
    return UrenAuth.getConfig().graph.drivePath;
  }

  async function refreshFromCloud() {
    state.loading = true;
    setStatus("Laden uit OneDrive…");
    try {
      await flushOfflineQueue();
      const token = await ensureLoggedIn();
      const path = drivePath();
      const meta = await UrenGraph.getDriveItemMeta(path, token);
      const entries = await UrenGraphExcel.readAllEntries(path, token);
      const estimates = await UrenGraphEstimates.readAllEstimates(path, token);
      state.entries = entries;
      state.estimates = estimates;
      state.intel = UrenExcel.buildIntel(entries);
      state.etag = meta.etag;
      state.meta = meta;
      setStatus(`Bijgewerkt ${new Date(meta.lastModified).toLocaleString("nl-NL")}`);
      renderAll(true);
      renderAccount();
      await updateQueueBadge();
    } catch (e) {
      setStatus(e.message || String(e), true);
      showToast(e.message || String(e), true);
      throw e;
    } finally {
      state.loading = false;
    }
  }

  function getEstimateFormFields() {
    return {
      datumStr: $("#est-datum")?.value,
      opdrachtgever: $("#est-og")?.value,
      project: $("#est-project")?.value,
      ureninschatting: $("#est-planned")?.value,
      status: $("#est-status")?.value,
      opmerking: $("#est-opmerking")?.value,
    };
  }

  function fillEstimateStatusSelect() {
    const sel = $("#est-status");
    if (!sel) return;
    sel.innerHTML = "";
    for (const s of UrenEstimates.PROJECT_STATUSES) {
      const o = document.createElement("option");
      o.value = s;
      o.textContent = s;
      sel.appendChild(o);
    }
  }

  function openProjectModal(entry) {
    fillEstimateStatusSelect();
    state.estimateEditRow = entry?.row_index ?? null;
    $("#project-modal-title").textContent = entry ? "Project bewerken" : "Project toevoegen";
    $("#est-datum").value = entry?.datumStr || UrenExcel.formatDateIso(new Date());
    $("#est-og").value = entry?.opdrachtgever || "";
    $("#est-project").value = entry?.project || "";
    $("#est-planned").value = entry?.ureninschatting ?? "";
    $("#est-status").value = entry?.status || UrenEstimates.DEFAULT_STATUS;
    $("#est-opmerking").value = entry?.opmerking || "";
    const actual = entry?.gemaakte_uren;
    const delta = entry ? UrenEstimates.displayDelta(entry) : null;
    $("#est-actual").textContent = entry ? `${Number(actual || 0).toFixed(1)} u` : "—";
    $("#est-delta").textContent =
      delta != null ? `${Number(delta).toFixed(1)} u` : entry ? "—" : "—";
    $("#btn-est-delete")?.classList.toggle("hidden", !entry);
    const dl = $("#dl-og-est");
    if (dl && state.intel) {
      dl.innerHTML = "";
      for (const n of comboOptionsOg()) {
        const o = document.createElement("option");
        o.value = n;
        dl.appendChild(o);
      }
    }
    $("#project-modal")?.classList.remove("hidden");
  }

  function closeProjectModal() {
    state.estimateEditRow = null;
    $("#project-modal")?.classList.add("hidden");
  }

  async function onEstimateSave() {
    const fields = getEstimateFormFields();
    if (!fields.project?.trim()) {
      showToast("Project is verplicht.", true);
      return;
    }
    if (!fields.datumStr) {
      showToast("Datum is verplicht.", true);
      return;
    }
    try {
      if (state.estimateEditRow) {
        await persistMutation({
          kind: "estimate_update",
          fields,
          rowIndex: state.estimateEditRow,
        });
      } else {
        await persistMutation({ kind: "estimate_add", fields, rowIndex: null });
      }
      closeProjectModal();
      await refreshFromCloudQuiet();
    } catch (_) {}
  }

  async function onEstimateDelete() {
    if (!state.estimateEditRow) return;
    if (!confirm("Projectrij verwijderen uit Excel?")) return;
    try {
      await persistMutation({
        kind: "estimate_delete",
        fields: null,
        rowIndex: state.estimateEditRow,
      });
      closeProjectModal();
      await refreshFromCloudQuiet();
    } catch (_) {}
  }

  function renderProjecten() {
    const summaryEl = $("#projecten-summary");
    const listEl = $("#projecten-list");
    if (!summaryEl || !listEl) return;
    if (!state.estimates?.length) {
      summaryEl.textContent = "Geen projecten — ververs uit OneDrive.";
      listEl.innerHTML = "";
      $("#projecten-status-cards").innerHTML = "";
      return;
    }
    const summary = UrenEstimates.buildStatusSummary(state.estimates);
    const activeLine =
      summary.activePlanned > 0 || summary.activeActual > 0
        ? `Actief: ${summary.activeActual} / ${summary.activePlanned} u (resterend ${summary.activeRemaining} u)`
        : "";
    const overLine = summary.overBudget.length
      ? ` | ${summary.overBudget.length} over budget`
      : "";
    summaryEl.textContent = `${state.estimates.length} projecten${activeLine ? " · " + activeLine : ""}${overLine}`;

    const cardsEl = $("#projecten-status-cards");
    if (cardsEl) {
      cardsEl.innerHTML = "";
      for (const st of UrenEstimates.PROJECT_STATUSES) {
        const count = summary.counts[st] || 0;
        if (!count) continue;
        const card = document.createElement("button");
        card.type = "button";
        card.className =
          "status-card" +
          (state.estimateFilters.statuses.includes(st) ? " active" : "");
        card.innerHTML = `<div class="sc-count">${count}</div><div class="sc-label">${st}</div>`;
        card.addEventListener("click", () => {
          const f = state.estimateFilters;
          const i = f.statuses.indexOf(st);
          if (i >= 0) f.statuses.splice(i, 1);
          else f.statuses.push(st);
          renderProjecten();
        });
        cardsEl.appendChild(card);
      }
    }

    const chipsEl = $("#chips-project-status");
    if (chipsEl) {
      chipsEl.innerHTML = "";
      const mk = (label, val) => {
        const b = document.createElement("button");
        b.type = "button";
        const active =
          val == null
            ? state.estimateFilters.statuses.length === 0
            : state.estimateFilters.statuses.includes(val);
        b.className = "chip" + (active ? " active" : "");
        b.textContent = label;
        b.addEventListener("click", () => {
          if (val == null) state.estimateFilters.statuses = [];
          else {
            const i = state.estimateFilters.statuses.indexOf(val);
            if (i >= 0) state.estimateFilters.statuses.splice(i, 1);
            else state.estimateFilters.statuses.push(val);
          }
          renderProjecten();
        });
        chipsEl.appendChild(b);
      };
      mk("Alles", null);
      for (const st of UrenEstimates.PROJECT_STATUSES) mk(st, st);
    }

    const filtered = UrenEstimates.filterEstimates(
      UrenEstimates.sortEstimates(state.estimates, state.entries),
      state.estimateFilters
    );
    listEl.innerHTML = "";
    for (const row of filtered) {
      const li = document.createElement("li");
      li.className = "project-card";
      const planned = Number(row.ureninschatting) || 0;
      const actual = Number(row.gemaakte_uren) || 0;
      const delta = UrenEstimates.displayDelta(row);
      const pct = planned > 0 ? Math.min(100, (actual / planned) * 100) : 0;
      const over = delta != null && delta < 0;
      const deltaHtml =
        delta != null
          ? `<span class="${over ? "delta-negative" : ""}">${delta > 0 ? "+" : ""}${Number(delta).toFixed(1)} u</span>`
          : "";
      li.innerHTML = `<div class="project-card-head">
          <span class="project-card-title">${row.project}</span>
          <span class="status-badge ${UrenEstimates.statusClass(row.status)}">${row.status}</span>
        </div>
        <div class="project-card-og">${row.opdrachtgever || "—"}</div>
        <div class="project-progress"><div class="project-progress-bar${over ? " over" : ""}" style="width:${pct}%"></div></div>
        <div class="project-stats">
          <span>${actual.toFixed(1)} / ${planned.toFixed(1)} u</span>
          ${deltaHtml}
        </div>`;
      li.addEventListener("click", () => openProjectModal(row));
      listEl.appendChild(li);
    }
  }

  function getFormFields() {
    return {
      datumStr: $("#field-datum")?.value,
      opdrachtgever: $("#field-og")?.value,
      project: $("#field-project")?.value,
      werkzaamheden: $("#field-werk")?.value,
      locatie: $("#field-locatie")?.value,
      uren: $("#field-uren")?.value,
      tarief: $("#field-tarief")?.value,
    };
  }

  function fillForm(entry) {
    $("#field-datum").value = entry?.datumStr || UrenExcel.formatDateIso(new Date());
    $("#field-og").value = entry?.opdrachtgever || "";
    $("#field-project").value = entry?.project || "";
    $("#field-werk").value = entry?.werkzaamheden || "";
    $("#field-locatie").value = entry?.locatie || "";
    $("#field-uren").value = entry?.uren ?? "";
    $("#field-tarief").value = entry?.tarief ?? "";
    onComboChange();
    updateInvoerStats();
  }

  function resetFormAfterSave() {
    const og = ($("#field-og")?.value || "").trim() || state.lastOg;
    const proj = ($("#field-project")?.value || "").trim() || state.lastProj;
    const loc = ($("#field-locatie")?.value || "").trim() || state.lastLoc;
    state.lastOg = og;
    state.lastProj = proj;
    state.lastLoc = loc;
    $("#field-datum").value = UrenExcel.formatDateIso(new Date());
    $("#field-og").value = og;
    $("#field-project").value = proj;
    $("#field-locatie").value = loc;
    $("#field-werk").value = "";
    $("#field-uren").value = "1";
    onComboChange();
    updateInvoerStats();
    $("#field-werk")?.focus();
  }

  function onComboChange() {
    renderDatalists();
    const t = UrenInvoer.suggestTarief(
      state.intel,
      $("#field-og")?.value,
      $("#field-project")?.value
    );
    if (t !== "") $("#field-tarief").value = t;
    const og = ($("#field-og")?.value || "").trim();
    const proj = ($("#field-project")?.value || "").trim();
    const combo = state.intel?.last_combo?.[`${og}\0${proj}`];
    if (combo) {
      if (!$("#field-locatie")?.value && combo.locatie) $("#field-locatie").value = combo.locatie;
      if (!$("#field-werk")?.value && combo.werkzaamheden) $("#field-werk").value = combo.werkzaamheden;
    }
  }

  function comboOptionsOg() {
    if (!state.intel) return [];
    return UrenInvoer.sortByUsage(state.intel.og_usage, state.intel.all_opdrachtgevers);
  }

  function comboOptionsProj() {
    if (!state.intel) return [];
    return UrenInvoer.smartProjects(state.intel, $("#field-og")?.value);
  }

  function comboOptionsLoc() {
    if (!state.intel) return [];
    return UrenInvoer.smartLocaties(
      state.intel,
      $("#field-og")?.value,
      $("#field-project")?.value
    );
  }

  function renderDatalists() {
    if (!state.intel) return;
    const fill = (id, items) => {
      const dl = document.getElementById(id);
      if (!dl) return;
      dl.innerHTML = "";
      for (const n of items) {
        const o = document.createElement("option");
        o.value = n;
        dl.appendChild(o);
      }
    };
    fill("dl-og", comboOptionsOg());
    fill("dl-project", comboOptionsProj());
    fill("dl-locatie", comboOptionsLoc());
  }

  function adjustHours(delta) {
    const el = $("#field-uren");
    if (!el) return;
    let v = parseFloat(el.value);
    if (!Number.isFinite(v)) v = 0;
    v = Math.max(0, Math.round((v + delta) * 2) / 2);
    el.value = v === 0 ? "" : String(v);
  }

  function applyHistoryToForm(entry, focusWerk = false) {
    if (!entry) return;
    state.editRow = null;
    $("#btn-save").textContent = "Opslaan";
    const today = UrenExcel.formatDateIso(new Date());
    $("#field-datum").value = today;
    $("#field-og").value = entry.opdrachtgever || "";
    $("#field-project").value = entry.project || "";
    $("#field-locatie").value = entry.locatie || "";
    $("#field-werk").value = entry.werkzaamheden || "";
    $("#field-uren").value = entry.uren ?? "";
    $("#field-tarief").value = entry.tarief ?? "";
    onComboChange();
    switchTab("invoer");
    showToast("Regel overgenomen — datum blijft vandaag");
    if (focusWerk) $("#field-werk")?.focus();
    else $("#field-uren")?.focus();
  }

  function isoWeekInfo(d) {
    const date = d instanceof Date ? d : new Date(d);
    const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7);
    return { year: tmp.getUTCFullYear(), week };
  }

  function updateInvoerStats() {
    const dayEl = $("#invoer-day-stats");
    const weekEl = $("#invoer-week-stats");
    if (!dayEl || !weekEl) return;
    const datumStr = $("#field-datum")?.value;
    if (!datumStr || !state.entries?.length) {
      dayEl.textContent = "—";
      weekEl.textContent = "—";
      return;
    }
    const sel = new Date(datumStr + "T12:00:00");
    const { year: weekYear, week: weekNo } = isoWeekInfo(sel);
    let dayH = 0;
    let weekH = 0;
    for (const e of state.entries) {
      const ed = e.datum instanceof Date ? e.datum : new Date(e.datum);
      if (UrenExcel.formatDateIso(ed) === datumStr) dayH += e.uren;
      const iw = isoWeekInfo(ed);
      if (iw.year === weekYear && iw.week === weekNo) weekH += e.uren;
    }
    dayEl.textContent = `${dayH.toFixed(1)} u`;
    weekEl.textContent = `${weekH.toFixed(1)} u (week ${weekNo})`;

    const targetWrap = $("#week-target-wrap");
    const targetLabel = $("#week-target-label");
    const targetFill = $("#week-target-fill");
    const target = state.weekTarget;
    if (targetWrap && target > 0) {
      targetWrap.classList.remove("hidden");
      const pct = Math.min(100, (weekH / target) * 100);
      if (targetLabel) {
        targetLabel.textContent = `${weekH.toFixed(1)} / ${target} u`;
      }
      if (targetFill) {
        targetFill.style.width = `${pct}%`;
        targetFill.classList.toggle("over", weekH > target);
      }
    } else if (targetWrap) {
      targetWrap.classList.add("hidden");
    }
  }

  function renderHistory() {
    const list = $("#history-list");
    if (!list || !state.intel) return;
    list.innerHTML = "";
    const q = ($("#history-search")?.value || "").toLowerCase();
    let items = state.intel.history;
    if (q) {
      items = items.filter((e) =>
        UrenInvoer.formatHistoryLine(e).toLowerCase().includes(q)
      );
    }
    const totalMatched = items.length;
    items = items.slice(0, 80);
    if (state.selectedHistoryRow != null && !items.some((e) => e.row_index === state.selectedHistoryRow)) {
      state.selectedHistoryRow = null;
    }
    for (const e of items) {
      const li = document.createElement("li");
      li.className = "history-item";
      if (e.row_index === state.selectedHistoryRow) li.classList.add("selected");
      li.dataset.row = String(e.row_index);
      li.innerHTML = `<span class="history-text">${UrenInvoer.formatHistoryLine(e)}</span>
        <span class="history-actions">
          <button type="button" data-act="apply" data-row="${e.row_index}">Overnemen</button>
          <button type="button" data-act="edit" data-row="${e.row_index}">Bewerk</button>
          <button type="button" data-act="del" data-row="${e.row_index}">Verwijder</button>
        </span>`;
      bindHistorySwipe(li, e);
      li.addEventListener("dblclick", (ev) => {
        if (ev.target.closest("button")) return;
        applyHistoryToForm(e, true);
      });
      li.addEventListener("click", (ev) => {
        if (ev.target.closest("button")) return;
        const now = Date.now();
        if (
          renderHistory._lastTap?.row === e.row_index &&
          now - renderHistory._lastTap.t < 450
        ) {
          applyHistoryToForm(e, true);
          renderHistory._lastTap = null;
          return;
        }
        renderHistory._lastTap = { row: e.row_index, t: now };
        state.selectedHistoryRow = e.row_index;
        renderHistory();
      });
      list.appendChild(li);
    }
    list.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const row = Number(btn.dataset.row);
        const entry = state.entries.find((x) => x.row_index === row);
        if (btn.dataset.act === "apply" && entry) {
          applyHistoryToForm(entry, true);
        } else if (btn.dataset.act === "edit" && entry) {
          state.editRow = row;
          state.selectedHistoryRow = row;
          fillForm(entry);
          $("#btn-save").textContent = "Bijwerken";
          switchTab("invoer");
        } else if (btn.dataset.act === "del") {
          if (!confirm("Regel verwijderen uit Excel?")) return;
          try {
            await persistMutation(
              { kind: "hours_delete", fields: null, rowIndex: row },
              () => optimisticDelete(row)
            );
            resetFormAfterSave();
          } catch (_) {}
        }
      });
    });
  }

  function bindHistorySwipe(li, entry) {
    let startX = 0;
    let startY = 0;
    let tracking = false;
    const threshold = 72;

    li.addEventListener(
      "touchstart",
      (ev) => {
        if (ev.target.closest("button")) return;
        const t = ev.touches[0];
        startX = t.clientX;
        startY = t.clientY;
        tracking = true;
      },
      { passive: true }
    );

    li.addEventListener(
      "touchmove",
      (ev) => {
        if (!tracking) return;
        const t = ev.touches[0];
        const dx = t.clientX - startX;
        const dy = t.clientY - startY;
        if (Math.abs(dy) > Math.abs(dx)) {
          tracking = false;
          li.style.transform = "";
          li.classList.remove("swiping");
          return;
        }
        if (Math.abs(dx) > 8) {
          li.classList.add("swiping");
          li.style.transform = `translateX(${dx}px)`;
        }
      },
      { passive: true }
    );

    li.addEventListener("touchend", async (ev) => {
      if (!tracking) return;
      tracking = false;
      const t = ev.changedTouches[0];
      const dx = t.clientX - startX;
      li.style.transform = "";
      li.classList.remove("swiping");
      if (dx > threshold) {
        applyHistoryToForm(entry, true);
      } else if (dx < -threshold) {
        if (!confirm("Regel verwijderen uit Excel?")) return;
        try {
          await persistMutation(
            { kind: "hours_delete", fields: null, rowIndex: entry.row_index },
            () => optimisticDelete(entry.row_index)
          );
          resetFormAfterSave();
        } catch (_) {}
      }
    });
  }

  function renderInvoer(initialForm = false) {
    renderDatalists();
    renderHistory();
    updateInvoerStats();
    if (initialForm && !state.editRow) {
      fillForm(null);
      const og = $("#field-og")?.value;
      const pr = $("#field-project")?.value;
      if (state.intel && og && pr) {
        const t = UrenInvoer.suggestTarief(state.intel, og, pr);
        if (t !== "" && !$("#field-tarief").value) $("#field-tarief").value = t;
      }
    }
  }

  function renderChipRow(containerId, values, selected, onToggle) {
    const el = $(containerId);
    if (!el) return;
    el.innerHTML = "";
    const mk = (label, val) => {
      const b = document.createElement("button");
      b.type = "button";
      const active =
        val == null ? selected.length === 0 : selected.includes(val);
      b.className = "chip" + (active ? " active" : "");
      b.textContent = label;
      b.addEventListener("click", () => {
        onToggle(val);
        renderAnalyse();
      });
      el.appendChild(b);
    };
    mk("Alles", null);
    for (const v of values) mk(String(v), fieldKey(v));
  }

  function fieldKey(v) {
    return typeof v === "number" ? v : v;
  }

  function pruneProjectSelection() {
    const f = state.analyseFilters;
    if (!f.selectedOgs.length) return;
    const valid = new Set(
      state.entries
        .filter((r) => r.project && f.selectedOgs.includes(r.opdrachtgever))
        .map((r) => r.project)
    );
    f.selectedProjs = f.selectedProjs.filter((p) => valid.has(p));
  }

  function projectChipSource() {
    const f = state.analyseFilters;
    const rows = state.entries.filter(
      (r) =>
        r.project &&
        (f.selectedOgs.length === 0 || f.selectedOgs.includes(r.opdrachtgever))
    );
    return UrenAnalyse.sortFilterValues(rows, "project");
  }

  function tariefChipSource() {
    return UrenAnalyse.sortFilterValues(state.entries, "tarief").map((v) =>
      typeof v === "number" ? v : Number(v)
    );
  }

  function renderAnalyse() {
    if (!state.entries.length) {
      $("#analyse-summary").textContent = "Geen data — ververs uit OneDrive.";
      $("#analyse-list").innerHTML = "";
      $("#analyse-loc-list").innerHTML = "";
      return;
    }
    const f = state.analyseFilters;
    const ogs = UrenAnalyse.sortFilterValues(state.entries, "opdrachtgever");
    renderChipRow("#chips-og", ogs, f.selectedOgs, (val) => {
      if (val == null) f.selectedOgs = [];
      else {
        const i = f.selectedOgs.indexOf(val);
        if (i >= 0) f.selectedOgs.splice(i, 1);
        else f.selectedOgs.push(val);
      }
      pruneProjectSelection();
      renderAnalyse();
    });
    renderChipRow("#chips-proj", projectChipSource(), f.selectedProjs, (val) => {
      if (val == null) f.selectedProjs = [];
      else {
        const i = f.selectedProjs.indexOf(val);
        if (i >= 0) f.selectedProjs.splice(i, 1);
        else f.selectedProjs.push(val);
      }
    });
    const chipTr = $("#chips-tarief");
    if (chipTr) {
      chipTr.innerHTML = "";
      const mkTr = (label, onClick, active) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "chip" + (active ? " active" : "");
        b.textContent = label;
        b.addEventListener("click", () => {
          onClick();
          const nz = $("#filter-tarief-nonzero");
          if (nz) nz.checked = f.tariefNonZero;
          renderAnalyse();
        });
        chipTr.appendChild(b);
      };
      mkTr(
        "Alles",
        () => {
          f.selectedTarieven = [];
          f.tariefNonZero = false;
        },
        !f.selectedTarieven.length && !f.tariefNonZero
      );
      mkTr(
        "Alles behalve 0",
        () => {
          f.selectedTarieven = [];
          f.tariefNonZero = !f.tariefNonZero;
        },
        f.tariefNonZero
      );
      for (const t of tariefChipSource()) {
        const active = f.selectedTarieven.includes(t);
        mkTr(
          `€${t}`,
          () => {
            f.tariefNonZero = false;
            const i = f.selectedTarieven.indexOf(t);
            if (i >= 0) f.selectedTarieven.splice(i, 1);
            else f.selectedTarieven.push(t);
          },
          active
        );
      }
    }
    const filtered = UrenAnalyse.filterRows(state.entries, f);
    const sum = UrenAnalyse.summarize(filtered);
    const uniqueDays = UrenAnalyse.countUniqueDays(filtered);
    $("#analyse-summary").textContent =
      `Totaal uren: ${sum.totU.toFixed(2)} | Totaal € (excl. BTW): ${sum.totE.toFixed(2)} | Dagen: ${uniqueDays} | Regels: ${sum.count}`;
    const grouped = UrenAnalyse.groupRows(filtered, f.groupMode);
    const list = $("#analyse-list");
    list.innerHTML = "";
    for (const item of grouped) {
      const li = document.createElement("li");
      li.className = "analyse-row";
      if (item.werk != null) {
        li.innerHTML = `<div class="ar-main">${item.label} — ${item.sub}</div>
          <div class="ar-sub">${item.detail}</div>
          <div class="ar-num">${item.uren.toFixed(2)} u · €${item.bedrag.toFixed(2)}</div>
          <div class="ar-werk">${item.werk || ""}</div>`;
      } else {
        li.innerHTML = `<div class="ar-main">${item.label}</div>
          <div class="ar-num">${item.uren.toFixed(2)} u · €${item.bedrag.toFixed(2)} (${item.count} regels)</div>`;
      }
      list.appendChild(li);
    }

    const locBody = $("#analyse-loc-list");
    if (locBody) {
      locBody.innerHTML = "";
      for (const row of UrenAnalyse.aggregateLocations(filtered)) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${row.loc}</td><td class="num">${row.days}</td><td class="num">${row.uren.toFixed(2)}</td><td class="num">${row.bedrag.toFixed(2)}</td>`;
        locBody.appendChild(tr);
      }
    }
    updatePeriodCustomVisibility();
    renderGrafieken();
  }

  function renderAccount() {
    const acc = UrenAuth.getAccountLabel();
    $("#account-label").textContent = acc || "Niet ingelogd";
    const link = $("#onedrive-link");
    if (link && state.meta?.webUrl) {
      link.href = state.meta.webUrl;
      link.classList.remove("hidden");
    }
  }

  function switchTab(tab) {
    state.tab = tab;
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
    document.querySelectorAll(".bottom-nav button").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === tab);
    });
    const panel = document.getElementById(`panel-${tab}`);
    if (panel) panel.classList.remove("hidden");
    const sticky = $("#invoer-sticky-bar");
    const mainEl = document.querySelector("main");
    if (sticky) sticky.classList.toggle("hidden", tab !== "invoer");
    if (mainEl) mainEl.classList.toggle("has-sticky-save", tab === "invoer");
    if (tab === "projecten") renderProjecten();
    if (tab === "analyse") renderAnalyse();
    if (tab === "grafieken") renderGrafieken();
  }

  async function onSave() {
    const fields = getFormFields();
    const err = UrenInvoer.validateForm(fields);
    if (err) {
      showToast(err, true);
      return;
    }
    if (!state.editRow) {
      const similar = UrenInvoer.findSimilarEntries(state.entries, fields);
      if (similar.length && !confirm(UrenInvoer.formatSimilarWarning(similar))) return;
    }
    const prevEntry = state.editRow
      ? state.entries.find((x) => x.row_index === state.editRow)
      : null;
    const budgetFields = { ...fields, _prevHours: prevEntry?.uren };
    const budgetMsg = UrenInvoer.budgetWarning(state.estimates, budgetFields, state.editRow);
    if (budgetMsg && !confirm(budgetMsg)) return;

    try {
      if (state.editRow) {
        const row = state.editRow;
        await persistMutation(
          { kind: "hours_update", fields, rowIndex: row },
          () => optimisticUpdate(row, fields)
        );
        state.editRow = null;
        $("#btn-save").textContent = "Opslaan";
      } else {
        await persistMutation(
          { kind: "hours_add", fields, rowIndex: null },
          () => optimisticAdd(fields)
        );
      }
      resetFormAfterSave();
    } catch (_) {}
  }

  function bindPullToRefresh() {
    const mainEl = document.querySelector("main");
    const indicator = $("#pull-indicator");
    if (!mainEl) return;
    let startY = 0;
    let pulling = false;

    mainEl.addEventListener(
      "touchstart",
      (ev) => {
        if (mainEl.scrollTop > 0 || state.loading) return;
        startY = ev.touches[0].clientY;
        pulling = true;
      },
      { passive: true }
    );

    mainEl.addEventListener(
      "touchmove",
      (ev) => {
        if (!pulling || mainEl.scrollTop > 0) return;
        const dy = ev.touches[0].clientY - startY;
        if (dy > 50) indicator?.classList.remove("hidden");
        else indicator?.classList.add("hidden");
      },
      { passive: true }
    );

    mainEl.addEventListener("touchend", async (ev) => {
      if (!pulling) return;
      pulling = false;
      const dy = ev.changedTouches[0].clientY - startY;
      indicator?.classList.add("hidden");
      if (dy > 80 && mainEl.scrollTop <= 0) {
        haptic(15);
        try {
          await refreshFromCloud();
        } catch (_) {}
      }
    });
  }

  function adjustDate(deltaDays) {
    const el = $("#field-datum");
    if (!el?.value) return;
    const d = new Date(el.value + "T12:00:00");
    d.setDate(d.getDate() + deltaDays);
    el.value = UrenExcel.formatDateIso(d);
    updateInvoerStats();
  }

  function adjustYearInput(inputId, delta) {
    const el = document.getElementById(inputId);
    if (!el) return null;
    const min = Number(el.min) || 2018;
    const max = Number(el.max) || 2035;
    let y = Number(el.value) || new Date().getFullYear();
    y = Math.min(max, Math.max(min, y + delta));
    el.value = String(y);
    return y;
  }

  function bindYearSteppers() {
    document.querySelectorAll(".btn-year-prev, .btn-year-next").forEach((btn) => {
      btn.addEventListener("click", () => {
        const inputId = btn.dataset.yearInput;
        if (!inputId) return;
        const y = adjustYearInput(inputId, btn.classList.contains("btn-year-prev") ? -1 : 1);
        if (y == null) return;
        haptic(20);
        if (inputId === "grafiek-year") {
          state.chartFilters.year = y;
          renderGrafieken();
        } else if (inputId === "filter-week-year") {
          state.analyseFilters.customWeekYear = y;
          renderAnalyse();
        } else if (inputId === "filter-month-year") {
          state.analyseFilters.customYear = y;
          renderAnalyse();
        }
      });
    });
  }

  function bindEvents() {
    document.querySelectorAll(".bottom-nav button").forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });
    $("#btn-save")?.addEventListener("click", onSave);
    $("#btn-clear")?.addEventListener("click", () => {
      state.editRow = null;
      state.selectedHistoryRow = null;
      $("#btn-save").textContent = "Opslaan";
      fillForm(null);
    });
    $("#btn-date-prev")?.addEventListener("click", () => adjustDate(-1));
    $("#btn-date-next")?.addEventListener("click", () => adjustDate(1));
    $("#field-datum")?.addEventListener("change", updateInvoerStats);
    $("#btn-refresh")?.addEventListener("click", () => refreshFromCloud().catch(() => {}));
    $("#btn-project-add")?.addEventListener("click", () => openProjectModal(null));
    $("#btn-est-save")?.addEventListener("click", () => onEstimateSave());
    $("#btn-est-cancel")?.addEventListener("click", closeProjectModal);
    $("#btn-est-delete")?.addEventListener("click", () => onEstimateDelete());
    $("#projecten-search")?.addEventListener("input", (e) => {
      state.estimateFilters.search = e.target.value;
      renderProjecten();
    });
    document.querySelectorAll("[data-close-modal]").forEach((el) => {
      el.addEventListener("click", closeProjectModal);
    });
    $("#btn-uren-min")?.addEventListener("click", () => adjustHours(-0.5));
    $("#btn-uren-plus")?.addEventListener("click", () => adjustHours(0.5));
    $("#field-uren")?.addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        adjustHours(0.5);
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        adjustHours(-0.5);
      }
    });
    $("#history-search")?.addEventListener("input", renderHistory);
    $("#field-og")?.addEventListener("input", renderDatalists);
    $("#field-project")?.addEventListener("input", renderDatalists);
    $("#field-og")?.addEventListener("change", onComboChange);
    $("#field-project")?.addEventListener("change", onComboChange);
    $("#field-locatie")?.addEventListener("change", onComboChange);
    $("#btn-login")?.addEventListener("click", async () => {
      try {
        await UrenAuth.login();
        renderAccount();
        await refreshFromCloud();
      } catch (e) {
        if (e?.errorCode !== "user_cancelled") showToast(e.message, true);
      }
    });
    $("#btn-logout")?.addEventListener("click", async () => {
      await UrenAuth.logout();
      state.entries = [];
      state.estimates = [];
      state.etag = null;
      renderAccount();
      renderProjecten();
      setStatus("Uitgelogd");
    });
    const now = new Date();
    const iso = isoWeekInfo(now);
    const wy = $("#filter-week-year");
    const wn = $("#filter-week-num");
    const my = $("#filter-month-year");
    const mn = $("#filter-month-num");
    if (wy) wy.value = iso.year;
    if (wn) wn.value = iso.week;
    if (my) my.value = now.getFullYear();
    if (mn) mn.value = now.getMonth() + 1;
    state.analyseFilters.customWeekYear = iso.year;
    state.analyseFilters.customWeek = iso.week;
    state.analyseFilters.customYear = now.getFullYear();
    state.analyseFilters.customMonth = now.getMonth() + 1;
    state.chartFilters.year = now.getFullYear();
    const gy = $("#grafiek-year");
    if (gy) gy.value = now.getFullYear();

    $("#filter-period")?.addEventListener("change", (e) => {
      state.analyseFilters.periodMode = e.target.value;
      updatePeriodCustomVisibility();
      renderAnalyse();
    });
    const syncCustom = () => {
      state.analyseFilters.customWeekYear = Number($("#filter-week-year")?.value) || iso.year;
      state.analyseFilters.customWeek = Number($("#filter-week-num")?.value) || 1;
      state.analyseFilters.customYear = Number($("#filter-month-year")?.value) || now.getFullYear();
      state.analyseFilters.customMonth = Number($("#filter-month-num")?.value) || 1;
      renderAnalyse();
    };
    ["#filter-week-year", "#filter-week-num", "#filter-month-year", "#filter-month-num"].forEach(
      (sel) => $(sel)?.addEventListener("change", syncCustom)
    );
    $("#filter-tarief-nonzero")?.addEventListener("change", (e) => {
      state.analyseFilters.tariefNonZero = e.target.checked;
      if (e.target.checked) state.analyseFilters.selectedTarieven = [];
      renderAnalyse();
    });
    $("#grafiek-type")?.addEventListener("change", (e) => {
      state.chartFilters.chartMode = e.target.value;
      updateGrafiekControlsVisibility();
      renderGrafieken();
    });
    bindYearSteppers();
    $("#grafiek-cumulative-euro")?.addEventListener("change", (e) => {
      state.chartFilters.cumulativeEuro = e.target.checked;
      renderGrafieken();
    });
    $("#toggle-dark-mode")?.addEventListener("change", (e) => applyDarkMode(e.target.checked));
    $("#filter-keyword")?.addEventListener("input", (e) => {
      state.analyseFilters.keyword = e.target.value;
      renderAnalyse();
    });
    $("#filter-group")?.addEventListener("change", (e) => {
      state.analyseFilters.groupMode = e.target.value;
      renderAnalyse();
    });
    $("#week-target-input")?.addEventListener("change", (e) => saveWeekTarget(e.target.value));
    $("#btn-werk-pick")?.addEventListener("click", () => {
      const el = $("#field-werk");
      UrenWerkPicker.openWerkPicker(
        el,
        state.intel,
        () => ({
          og: $("#field-og")?.value,
          project: $("#field-project")?.value,
          loc: $("#field-locatie")?.value,
        }),
        null
      );
    });
    $("#field-werk")?.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        $("#btn-werk-pick")?.click();
      }
    });
    $("#btn-conflict-refresh")?.addEventListener("click", async () => {
      closeConflictModal();
      try {
        await refreshFromCloud();
      } catch (_) {}
    });
    $("#btn-conflict-dismiss")?.addEventListener("click", closeConflictModal);
    document.querySelectorAll("[data-close-conflict]").forEach((el) => {
      el.addEventListener("click", closeConflictModal);
    });
    window.addEventListener("online", () => {
      flushOfflineQueue().catch(() => {});
    });
    bindPullToRefresh();
    setInterval(() => {
      if (UrenAuth.isLoggedIn() && UrenOfflineQueue.isOnline() && !state.loading) {
        flushOfflineQueue().catch(() => {});
      }
    }, 120000);
  }

  async function init() {
    loadDarkPreference();
    loadWeekTarget();
    bindEvents();
    UrenCombo.createCombo("field-og", "dl-og", comboOptionsOg, onComboChange);
    UrenCombo.createCombo("field-project", "dl-project", comboOptionsProj, onComboChange);
    UrenCombo.createCombo("field-locatie", "dl-locatie", comboOptionsLoc, onComboChange);
    UrenInstall.init(switchTab);
    switchTab("invoer");
    try {
      await UrenAuth.getMsal();
      renderAccount();
      await updateQueueBadge();
      if (UrenAuth.isLoggedIn()) await refreshFromCloud();
    } catch (e) {
      setStatus(e.message, true);
    }
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
