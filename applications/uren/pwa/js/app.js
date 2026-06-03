/**
 * PWA shell: sync state, routing, bottom nav, OneDrive read/write with etag.
 */
(function () {
  const state = {
    tab: "invoer",
    entries: [],
    intel: null,
    wb: null,
    ws: null,
    etag: null,
    meta: null,
    loading: false,
    syncStatus: "Nog niet geladen",
    editRow: null,
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

  async function refreshFromCloud() {
    state.loading = true;
    setStatus("Laden uit OneDrive…");
    try {
      const token = await ensureLoggedIn();
      const path = UrenAuth.getConfig().graph.drivePath;
      const { bytes, etag, meta } = await UrenGraph.downloadWorkbook(path, token);
      const { wb, ws, entries } = UrenExcel.readAllEntries(bytes);
      state.wb = wb;
      state.ws = ws;
      state.entries = entries;
      state.intel = UrenExcel.buildIntel(entries);
      state.etag = etag;
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

  async function persistWorkbook(bytes) {
    const token = await ensureLoggedIn();
    const path = UrenAuth.getConfig().graph.drivePath;
    const meta = await UrenGraph.uploadWorkbook(path, token, bytes, state.etag);
    state.etag = meta.etag;
    state.meta = meta;
    setStatus(`Opgeslagen ${new Date(meta.lastModified).toLocaleString("nl-NL")}`);
  }

  async function saveAfterMutation(mutator) {
    if (!state.wb || !state.ws) {
      await refreshFromCloud();
    }
    try {
      const bytes = mutator(state.wb, state.ws);
      await persistWorkbook(bytes);
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
  }

  function renderDatalists() {
    if (!state.intel) return;
    const ogDl = $("#dl-og");
    const prDl = $("#dl-project");
    const locDl = $("#dl-locatie");
    if (!ogDl) return;
    const fill = (dl, items) => {
      dl.innerHTML = "";
      for (const n of items) {
        const o = document.createElement("option");
        o.value = n;
        dl.appendChild(o);
      }
    };
    fill(
      ogDl,
      UrenInvoer.sortByUsage(state.intel.og_usage, state.intel.all_opdrachtgevers)
    );
    fill(
      prDl,
      UrenInvoer.sortByUsage(state.intel.proj_usage, state.intel.all_projects)
    );
    fill(
      locDl,
      UrenInvoer.sortByUsage(state.intel.loc_usage, state.intel.all_locaties)
    );
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
    items = items.slice(0, 80);
    for (const e of items) {
      const li = document.createElement("li");
      li.className = "history-item";
      li.innerHTML = `<span class="history-text">${UrenInvoer.formatHistoryLine(e)}</span>
        <span class="history-actions">
          <button type="button" data-act="edit" data-row="${e.row_index}">Bewerk</button>
          <button type="button" data-act="del" data-row="${e.row_index}">Verwijder</button>
        </span>`;
      list.appendChild(li);
    }
    list.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const row = Number(btn.dataset.row);
        const entry = state.entries.find((x) => x.row_index === row);
        if (btn.dataset.act === "edit" && entry) {
          state.editRow = row;
          fillForm(entry);
          $("#btn-save").textContent = "Bijwerken";
        } else if (btn.dataset.act === "del") {
          if (!confirm("Regel verwijderen uit Excel?")) return;
          try {
            await saveAfterMutation((wb, ws) => UrenExcel.deleteEntry(wb, ws, row));
          } catch (_) {}
        }
      });
    });
  }

  function renderInvoer() {
    renderDatalists();
    renderHistory();
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

  function renderAnalyse() {
    if (!state.entries.length) {
      $("#analyse-summary").textContent = "Geen data — ververs uit OneDrive.";
      $("#analyse-list").innerHTML = "";
      return;
    }
    const f = state.analyseFilters;
    const ogs = UrenAnalyse.sortFilterValues(state.entries, "opdrachtgever");
    const projs = UrenAnalyse.sortFilterValues(state.entries, "project");
    renderChipRow("#chips-og", ogs, f.selectedOgs, (val) => {
      if (val == null) f.selectedOgs = [];
      else {
        const i = f.selectedOgs.indexOf(val);
        if (i >= 0) f.selectedOgs.splice(i, 1);
        else f.selectedOgs.push(val);
      }
    });
    renderChipRow("#chips-proj", projs, f.selectedProjs, (val) => {
      if (val == null) f.selectedProjs = [];
      else {
        const i = f.selectedProjs.indexOf(val);
        if (i >= 0) f.selectedProjs.splice(i, 1);
        else f.selectedProjs.push(val);
      }
    });
    const filtered = UrenAnalyse.filterRows(state.entries, f);
    const sum = UrenAnalyse.summarize(filtered);
    $("#analyse-summary").textContent = `${sum.count} regels · ${sum.totU.toFixed(2)} u · €${sum.totE.toFixed(2)}`;
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
        await saveAfterMutation((wb, ws) =>
          UrenExcel.updateEntry(wb, ws, state.editRow, fields)
        );
        state.editRow = null;
        $("#btn-save").textContent = "Opslaan";
      } else {
        await saveAfterMutation((wb, ws) => UrenExcel.addEntry(wb, ws, fields));
      }
      fillForm(null);
    } catch (_) {}
  }

  function bindEvents() {
    document.querySelectorAll(".bottom-nav button").forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });
    $("#btn-save")?.addEventListener("click", onSave);
    $("#btn-clear")?.addEventListener("click", () => {
      state.editRow = null;
      $("#btn-save").textContent = "Opslaan";
      fillForm(null);
    });
    $("#btn-refresh")?.addEventListener("click", () => refreshFromCloud().catch(() => {}));
    $("#history-search")?.addEventListener("input", renderHistory);
    $("#field-og")?.addEventListener("change", () => {
      const t = UrenInvoer.suggestTarief(
        state.intel,
        $("#field-og").value,
        $("#field-project").value
      );
      if (t !== "") $("#field-tarief").value = t;
    });
    $("#field-project")?.addEventListener("change", () => {
      const t = UrenInvoer.suggestTarief(
        state.intel,
        $("#field-og").value,
        $("#field-project").value
      );
      if (t !== "") $("#field-tarief").value = t;
    });
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
