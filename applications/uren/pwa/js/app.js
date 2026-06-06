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
    syncStatus: "Nog niet geladen",
    editRow: null,
    selectedHistoryRow: null,
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
      renderInvoer();
      renderProjecten();
      renderAnalyse();
      renderGrafieken();
      renderAccount();
    } catch (e) {
      setStatus(e.message || String(e), true);
      showToast(e.message || String(e), true);
      throw e;
    } finally {
      state.loading = false;
    }
  }

  async function saveAfterMutation(mutator, sessionFn = UrenGraphExcel.withSession) {
    const token = await ensureLoggedIn();
    const path = drivePath();
    try {
      await sessionFn(path, token, (sessionId) => mutator(path, token, sessionId));
      const meta = await UrenGraph.getDriveItemMeta(path, token);
      state.etag = meta.etag;
      state.meta = meta;
      await refreshFromCloud();
      showToast("Opgeslagen in OneDrive");
    } catch (e) {
      if (e.name === "GraphConflictError") {
        showToast(
          "Bestand gewijzigd elders. Tik op Ververs en probeer opnieuw.",
          true
        );
      } else if (e.name === "GraphLockError") {
        showToast(e.message, true);
      } else {
        showToast(e.message || String(e), true);
      }
      throw e;
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
        await saveAfterMutation(
          (path, token, sid) =>
            UrenGraphEstimates.updateEstimate(path, token, sid, state.estimateEditRow, fields),
          UrenGraphEstimates.withSession
        );
      } else {
        await saveAfterMutation(
          (path, token, sid) => UrenGraphEstimates.addEstimate(path, token, sid, fields),
          UrenGraphEstimates.withSession
        );
      }
      closeProjectModal();
    } catch (_) {}
  }

  async function onEstimateDelete() {
    if (!state.estimateEditRow) return;
    if (!confirm("Projectrij verwijderen uit Excel?")) return;
    try {
      await saveAfterMutation(
        (path, token, sid) =>
          UrenGraphEstimates.deleteEstimate(path, token, sid, state.estimateEditRow),
        UrenGraphEstimates.withSession
      );
      closeProjectModal();
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
      UrenEstimates.sortEstimates(state.estimates),
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
    if (!$("#field-datum").value) $("#field-datum").value = today;
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
            await saveAfterMutation((path, token, sid) =>
              UrenGraphExcel.deleteEntry(path, token, sid, row)
            );
          } catch (_) {}
        }
      });
    });
  }

  function renderInvoer() {
    renderDatalists();
    renderHistory();
    updateInvoerStats();
    if (!state.editRow) {
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
    try {
      if (state.editRow) {
        await saveAfterMutation((path, token, sid) =>
          UrenGraphExcel.updateEntry(path, token, sid, state.editRow, fields)
        );
        state.editRow = null;
        $("#btn-save").textContent = "Opslaan";
      } else {
        await saveAfterMutation((path, token, sid) =>
          UrenGraphExcel.addEntry(path, token, sid, fields)
        );
      }
      fillForm(null);
    } catch (_) {}
  }

  function adjustDate(deltaDays) {
    const el = $("#field-datum");
    if (!el?.value) return;
    const d = new Date(el.value + "T12:00:00");
    d.setDate(d.getDate() + deltaDays);
    el.value = UrenExcel.formatDateIso(d);
    updateInvoerStats();
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
    $("#grafiek-year")?.addEventListener("change", (e) => {
      state.chartFilters.year = Number(e.target.value) || now.getFullYear();
      renderGrafieken();
    });
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
  }

  async function init() {
    loadDarkPreference();
    bindEvents();
    UrenCombo.createCombo("field-og", "dl-og", comboOptionsOg, onComboChange);
    UrenCombo.createCombo("field-project", "dl-project", comboOptionsProj, onComboChange);
    UrenCombo.createCombo("field-locatie", "dl-locatie", comboOptionsLoc, onComboChange);
    UrenInstall.init(switchTab);
    switchTab("invoer");
    try {
      await UrenAuth.getMsal();
      renderAccount();
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
