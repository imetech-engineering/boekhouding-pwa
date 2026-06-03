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
    },
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

  function showToast(msg, isError) {
    const t = $("#toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.toggle("hidden", false);
    t.classList.toggle("error", !!isError);
    clearTimeout(showToast._tid);
    showToast._tid = setTimeout(() => t.classList.add("hidden"), 5000);
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
      state.entries = entries;
      state.intel = UrenExcel.buildIntel(entries);
      state.etag = meta.etag;
      state.meta = meta;
      setStatus(`Bijgewerkt ${new Date(meta.lastModified).toLocaleString("nl-NL")}`);
      renderInvoer();
      renderAnalyse();
      renderAccount();
    } catch (e) {
      setStatus(e.message || String(e), true);
      showToast(e.message || String(e), true);
      throw e;
    } finally {
      state.loading = false;
    }
  }

  async function saveAfterMutation(mutator) {
    const token = await ensureLoggedIn();
    const path = drivePath();
    try {
      await UrenGraphExcel.withSession(path, token, (sessionId) =>
        mutator(path, token, sessionId)
      );
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
    if (tab === "analyse") renderAnalyse();
  }

  async function onSave() {
    const fields = getFormFields();
    const err = UrenInvoer.validateForm(fields);
    if (err) {
      showToast(err, true);
      return;
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
      state.etag = null;
      renderAccount();
      setStatus("Uitgelogd");
    });
    $("#filter-period")?.addEventListener("change", (e) => {
      state.analyseFilters.periodMode = e.target.value;
      renderAnalyse();
    });
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
    bindEvents();
    UrenCombo.createCombo("field-og", comboOptionsOg, onComboChange);
    UrenCombo.createCombo("field-project", comboOptionsProj, onComboChange);
    UrenCombo.createCombo("field-locatie", comboOptionsLoc, onComboChange);
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
