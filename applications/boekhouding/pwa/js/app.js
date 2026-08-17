/**
 * App-shell: state, tabs, sync, offline-queue, instellingen, boot.
 * Tab-UI's registreren zich via BoekApp.registerTab (ui_bank.js, ui_inkoop.js, …).
 */
(function (global) {
  const $ = (sel) => document.querySelector(sel);
  const M = () => global.BoekModel;

  const state = {
    tab: "bank",
    loaded: false,
    loading: false,
    quietRefresh: false,
    bankRows: [],
    inkoopRows: [],
    verkoopRows: [],
    inkoopKeuzes: [],
    verkoopKeuzes: [],
    intel: { inkoop: { history: [], partijen: [], categorieen: [], projecten: [] },
             verkoop: { history: [], partijen: [], categorieen: [], projecten: [] } },
    files: { inkoop: [], verkoop: [] },
    settings: { kmTarief: 0.23, thuisAdres: null, favorieten: [] },
    settingsLoaded: false,
    webUrl: null,
    matchDagen: (() => {
      try {
        return parseInt(localStorage.getItem("boek_match_dagen"), 10) === 28 ? 28 : 14;
      } catch (_) {
        return 14;
      }
    })(),
  };

  function setMatchDagen(dagen) {
    state.matchDagen = dagen === 28 ? 28 : 14;
    try {
      localStorage.setItem("boek_match_dagen", String(state.matchDagen));
    } catch (_) {}
  }

  const tabs = {};

  function registerTab(name, module) {
    tabs[name] = module;
  }

  // === UI helpers ===
  let toastTimer = null;
  function showToast(msg, isError = false) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle("error", !!isError);
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), isError ? 6000 : 4000);
    haptic(isError ? [40, 60, 40] : 15);
  }

  function setStatus(msg, isError = false) {
    const el = $("#sync-status");
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle("error", !!isError);
  }

  function haptic(pattern) {
    try {
      navigator.vibrate?.(pattern);
    } catch (_) {}
  }

  function showConfirm(message, yesLabel = "Ja", noLabel = "Nee") {
    return new Promise((resolve) => {
      const modal = $("#confirm-modal");
      $("#confirm-message").textContent = message;
      const yes = $("#btn-confirm-yes");
      const no = $("#btn-confirm-no");
      yes.textContent = yesLabel;
      no.textContent = noLabel;
      modal.classList.remove("hidden");
      const done = (result) => {
        modal.classList.add("hidden");
        yes.onclick = no.onclick = null;
        resolve(result);
      };
      yes.onclick = () => done(true);
      no.onclick = () => done(false);
    });
  }

  function switchTab(tab) {
    state.tab = tab;
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
    document.querySelectorAll(".bottom-nav button").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === tab);
    });
    document.getElementById(`panel-${tab}`)?.classList.remove("hidden");
    tabs[tab]?.onShow?.();
    global.BoekCombo?.closeActivePopup();
  }

  // === Auth / token ===
  async function ensureLoggedIn() {
    return global.BoekAuth.acquireToken();
  }

  function isNetworkError(e) {
    if (!global.BoekOfflineQueue.isOnline()) return true;
    const m = (e?.message || "").toLowerCase();
    return (
      e?.name === "TypeError" ||
      m.includes("failed to fetch") ||
      m.includes("network") ||
      m.includes("load failed")
    );
  }

  // === Instellingen (OneDrive JSON + localStorage-cache) ===
  const SETTINGS_CACHE_KEY = "boek_settings_cache";

  function loadSettingsCache() {
    try {
      const raw = localStorage.getItem(SETTINGS_CACHE_KEY);
      if (raw) Object.assign(state.settings, JSON.parse(raw));
    } catch (_) {}
  }

  function cacheSettings() {
    try {
      localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(state.settings));
    } catch (_) {}
  }

  async function loadSettingsRemote(token) {
    try {
      const data = await global.BoekGraph.readJsonFile(global.BOEK_CONFIG.graph.settingsPath, token);
      if (data && typeof data === "object") {
        Object.assign(state.settings, data);
        cacheSettings();
      }
      state.settingsLoaded = true;
    } catch (_) {
      /* instellingen zijn niet kritisch */
    }
  }

  async function saveSettings(patch) {
    Object.assign(state.settings, patch || {});
    cacheSettings();
    tabs[state.tab]?.render?.();
    try {
      const token = await ensureLoggedIn();
      await global.BoekGraph.writeJsonFile(
        global.BOEK_CONFIG.graph.settingsPath,
        state.settings,
        token
      );
    } catch (e) {
      if (!isNetworkError(e)) showToast("Instellingen niet opgeslagen: " + (e.message || e), true);
    }
  }

  // === Data laden ===
  async function loadFileLists(token) {
    const f = global.BOEK_CONFIG.graph.folders;
    const alw = [".pdf", ".jpg", ".jpeg", ".png"];
    const keep = (items) =>
      items.filter(
        (it) =>
          it.folder ||
          alw.some((ext) => (it.name || "").toLowerCase().endsWith(ext))
      );
    const [ink, vrk] = await Promise.all([
      global.BoekGraph.listFolder(f.inkoopNieuw, token).catch(() => []),
      global.BoekGraph.listFolder(f.verkoopNieuw, token).catch(() => []),
    ]);
    state.files.inkoop = keep(ink);
    state.files.verkoop = keep(vrk);
  }

  async function refreshFromCloud(quiet = false) {
    if (state.loading) return;
    state.loading = true;
    if (!quiet) setStatus("Laden uit OneDrive…");
    try {
      const token = await ensureLoggedIn();
      const [data] = await Promise.all([
        global.BoekIo.loadAll(token),
        loadFileLists(token),
        state.settingsLoaded ? Promise.resolve() : loadSettingsRemote(token),
      ]);
      state.bankRows = data.bankRows;
      state.inkoopRows = data.inkoopRows;
      state.verkoopRows = data.verkoopRows;
      state.inkoopKeuzes = data.inkoopCategorieKeuzes;
      state.verkoopKeuzes = data.verkoopCategorieKeuzes;
      state.intel = M().buildIntel(state.inkoopRows, state.verkoopRows);
      state.loaded = true;
      try {
        const meta = await global.BoekGraph.getDriveItemMeta(global.BoekIo.drivePath(), token);
        state.webUrl = meta?.webUrl || null;
        const t = meta?.lastModifiedDateTime
          ? new Date(meta.lastModifiedDateTime).toLocaleString("nl-NL", {
              day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
            })
          : "";
        setStatus(`Gesynchroniseerd${t ? " · werkboek gewijzigd " + t : ""}`);
      } catch (_) {
        setStatus("Gesynchroniseerd");
      }
      renderAll();
      await flushOfflineQueue();
    } catch (e) {
      if (e?.message?.includes("Niet ingelogd")) {
        setStatus("Niet ingelogd — ga naar Overzicht om in te loggen.", true);
        switchTab("overzicht");
      } else {
        setStatus(e.message || String(e), true);
      }
    } finally {
      state.loading = false;
    }
  }

  async function refreshQuiet() {
    while (state.quietRefresh) {
      await new Promise((r) => setTimeout(r, 40));
    }
    state.quietRefresh = true;
    try {
      await refreshFromCloud(true);
    } finally {
      state.quietRefresh = false;
    }
  }

  function renderAll() {
    for (const name of Object.keys(tabs)) {
      try {
        tabs[name].render?.();
      } catch (e) {
        console.error(`render ${name}:`, e);
      }
    }
  }

  /** Na inboeken de afgevinkte bankregels aan de nieuwe factuurregel koppelen. */
  async function koppelNaInboeken(token, d, res, boekLetter) {
    const rows = d.bankRows || [];
    if (!rows.length || !res?.excelRow) return;
    const waarde = global.BoekModel.koppelWaarde(
      boekLetter,
      { excelRow: res.excelRow, factuurnummer: d.fields.factuurnummer || "" },
      state.inkoopRows,
      state.verkoopRows
    );
    await global.BoekIo.koppelBank(
      token,
      rows.map((r) => ({ excelRow: r, waarde, ingeboekt: true }))
    );
  }

  // === Mutaties (online direct, anders offline queue) ===
  async function executeMutation(d) {
    const token = await ensureLoggedIn();
    switch (d.kind) {
      case "bank_add":
        return global.BoekIo.addBankRow(token, d.fields);
      case "bank_update":
        return global.BoekIo.updateBankRow(token, d.excelRow, d.fields);
      case "bank_delete":
        return global.BoekIo.deleteBankRow(token, d.excelRow);
      case "bank_ingeboekt":
        return global.BoekIo.setBankIngeboekt(token, d.rows, d.value !== false);
      case "bank_koppel":
        return global.BoekIo.koppelBank(token, d.items);
      case "bank_ontkoppel":
        return global.BoekIo.ontkoppelBank(token, d.excelRow, d.waarde || "");
      case "inkoop_add": {
        const res = await global.BoekIo.addInkoopRow(token, d.fields);
        await koppelNaInboeken(token, d, res, "I");
        // Afschrijving aangevinkt → jaarregels automatisch mee-inboeken.
        if (d.fields.afschrijving && d.fields.afschrijvingJaren) {
          const regels = global.BoekModel.afschrijvingsRegels(d.fields, d.fields.afschrijvingJaren);
          for (const regel of regels) {
            await global.BoekIo.addInkoopRow(token, regel);
          }
        }
        return res;
      }
      case "inkoop_update":
        return global.BoekIo.updateInkoopRow(token, d.excelRow, d.fields);
      case "inkoop_delete":
        return global.BoekIo.deleteInkoopRow(token, d.excelRow);
      case "verkoop_add": {
        const res = await global.BoekIo.addVerkoopRow(token, d.fields);
        await koppelNaInboeken(token, d, res, "V");
        return res;
      }
      case "verkoop_update":
        return global.BoekIo.updateVerkoopRow(token, d.excelRow, d.fields);
      case "verkoop_delete":
        return global.BoekIo.deleteVerkoopRow(token, d.excelRow);
      case "file_move":
        return global.BoekGraph.moveItem(d.itemId, d.destFolder, token, d.newName);
      case "file_rename":
        return global.BoekGraph.renameItem(d.itemId, d.newName, token);
      default:
        throw new Error(`Onbekende mutatie: ${d.kind}`);
    }
  }

  async function queueOffline(descriptor) {
    await global.BoekOfflineQueue.add(descriptor);
    await updateQueueBadge();
    showToast("Offline — wijziging wordt gesynchroniseerd zodra er verbinding is.");
  }

  /** Voert een mutatie uit; retourneert true als (direct) gelukt. */
  async function persistMutation(descriptor, { successMsg } = {}) {
    if (!global.BoekOfflineQueue.isOnline()) {
      await queueOffline(descriptor);
      return true;
    }
    setStatus("Opslaan in OneDrive…");
    try {
      await executeMutation(descriptor);
    } catch (e) {
      if (e?.name === "GraphLockError") {
        showToast(e.message, true);
        setStatus("Werkboek vergrendeld", true);
        return false;
      }
      if (isNetworkError(e)) {
        await queueOffline(descriptor);
        return true;
      }
      showToast(e.message || String(e), true);
      setStatus("Opslaan mislukt", true);
      return false;
    }
    if (successMsg) showToast(successMsg);
    refreshQuiet();
    return true;
  }

  async function flushOfflineQueue() {
    const items = await global.BoekOfflineQueue.getAll();
    if (!items.length) {
      await updateQueueBadge();
      return;
    }
    for (const item of items) {
      try {
        await executeMutation(item);
        await global.BoekOfflineQueue.remove(item.id);
      } catch (e) {
        if (e?.name === "GraphLockError" || isNetworkError(e)) break;
        await global.BoekOfflineQueue.remove(item.id);
        showToast(`Wachtrij-item mislukt: ${e.message || e}`, true);
      }
    }
    await updateQueueBadge();
  }

  async function updateQueueBadge() {
    const el = $("#queue-status");
    if (!el) return;
    const n = await global.BoekOfflineQueue.count();
    el.classList.toggle("hidden", n === 0);
    if (n > 0) el.textContent = `${n} wijziging${n === 1 ? "" : "en"} wacht op sync`;
  }

  // === Weergave ===
  function applyDarkMode(on) {
    document.documentElement.dataset.theme = on ? "dark" : "";
    const meta = $("#meta-theme-color");
    if (meta) meta.content = on ? "#121210" : "#0E8A5B";
    const logo = $("#header-logo");
    if (logo) logo.src = on ? "branding/logo-wit.png" : "branding/logo-zwart.png";
    try {
      localStorage.setItem("imtech-boek-dark", on ? "1" : "0");
    } catch (_) {}
  }

  // === Pull-to-refresh ===
  function bindPullToRefresh() {
    const mainEl = document.querySelector("main");
    const indicator = $("#pull-indicator");
    let startY = null;
    let pulling = false;
    mainEl.addEventListener(
      "touchstart",
      (e) => {
        if (mainEl.scrollTop === 0) {
          startY = e.touches[0].clientY;
          pulling = true;
        }
      },
      { passive: true }
    );
    mainEl.addEventListener(
      "touchmove",
      (e) => {
        if (!pulling || startY == null) return;
        const dy = e.touches[0].clientY - startY;
        indicator.classList.toggle("hidden", dy < 50);
      },
      { passive: true }
    );
    mainEl.addEventListener("touchend", (e) => {
      if (!pulling || startY == null) return;
      const dy = e.changedTouches[0].clientY - startY;
      indicator.classList.add("hidden");
      pulling = false;
      startY = null;
      if (dy > 80) {
        haptic(15);
        refreshFromCloud();
      }
    });
  }

  // === Iconen ===
  const ICON_PENCIL =
    '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  const ICON_TRASH =
    '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>' +
    '<path d="M10 11v6M14 11v6"/></svg>';

  /** Actieknoppen (potlood + prullenbak) voor een lijstitem. */
  function rowActionsHtml() {
    return (
      '<span class="row-actions">' +
      `<button type="button" class="btn-icon" data-act="edit" aria-label="Bewerken" title="Bewerken">${ICON_PENCIL}</button>` +
      `<button type="button" class="btn-icon btn-icon-danger" data-act="del" aria-label="Verwijderen" title="Verwijderen">${ICON_TRASH}</button>` +
      "</span>"
    );
  }

  /**
   * Swipe op een lijstitem: naar rechts = bewerken, naar links = verwijderen.
   * Verticaal scrollen wint altijd, zodat de lijst normaal blijft scrollen.
   */
  function bindSwipe(li, { onEdit, onDelete }) {
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

    li.addEventListener("touchend", (ev) => {
      if (!tracking) return;
      tracking = false;
      const dx = ev.changedTouches[0].clientX - startX;
      li.style.transform = "";
      li.classList.remove("swiping");
      if (dx > threshold) onEdit?.();
      else if (dx < -threshold) onDelete?.();
    });
  }

  // === Datum-steppers (generiek) ===
  function bindDateSteppers(inputId, prevId, nextId, onChange) {
    const input = document.getElementById(inputId);
    const shift = (days) => {
      const d = M().isoToDate(input.value) || M().isoToDate(M().todayIso());
      d.setUTCDate(d.getUTCDate() + days);
      input.value = M().dateToIso(d);
      input.dispatchEvent(new Event("change", { bubbles: true }));
      onChange?.();
      haptic(20);
    };
    document.getElementById(prevId)?.addEventListener("click", () => shift(-1));
    document.getElementById(nextId)?.addEventListener("click", () => shift(1));
  }

  // === Boot ===
  async function boot() {
    loadSettingsCache();
    let dark = false;
    try {
      dark = localStorage.getItem("imtech-boek-dark") === "1";
    } catch (_) {}
    if (dark) {
      const t = $("#toggle-dark-mode");
      if (t) t.checked = true;
    }
    applyDarkMode(dark);
    $("#toggle-dark-mode")?.addEventListener("change", (e) => applyDarkMode(e.target.checked));

    document.querySelectorAll(".bottom-nav button").forEach((b) => {
      b.addEventListener("click", () => switchTab(b.dataset.tab));
    });
    document.querySelectorAll("[data-close-modal]").forEach((el) => {
      el.addEventListener("click", () => el.closest(".modal")?.classList.add("hidden"));
    });

    for (const name of Object.keys(tabs)) {
      try {
        tabs[name].init?.();
      } catch (e) {
        console.error(`init ${name}:`, e);
      }
    }

    global.BoekInstall.init(switchTab);
    bindPullToRefresh();

    window.addEventListener("online", () => {
      flushOfflineQueue().then(() => refreshQuiet());
    });
    setInterval(() => {
      if (global.BoekOfflineQueue.isOnline()) flushOfflineQueue();
    }, 120000);
    await updateQueueBadge();

    try {
      await global.BoekAuth.getMsal();
    } catch (e) {
      setStatus(e.message || String(e), true);
    }
    if (global.BoekAuth.isLoggedIn()) {
      refreshFromCloud();
    } else {
      setStatus("Niet ingelogd — ga naar Overzicht om in te loggen.");
      switchTab("overzicht");
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    }
  }

  global.BoekApp = {
    state,
    $,
    registerTab,
    showToast,
    setStatus,
    haptic,
    showConfirm,
    switchTab,
    ensureLoggedIn,
    refreshFromCloud,
    refreshQuiet,
    persistMutation,
    executeMutation,
    saveSettings,
    applyDarkMode,
    bindDateSteppers,
    isNetworkError,
    rowActionsHtml,
    bindSwipe,
    setMatchDagen,
    ICON_PENCIL,
    ICON_TRASH,
  };
  global.BoekBoot = boot;
})(window);
