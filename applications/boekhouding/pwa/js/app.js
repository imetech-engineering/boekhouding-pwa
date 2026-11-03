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
    bankRows: [],
    bankEndRow: null,
    workbookEtag: null,
    inkoopRows: [],
    verkoopRows: [],
    inkoopKeuzes: [],
    verkoopKeuzes: [],
    intel: { inkoop: { history: [], partijen: [], categorieen: [], projecten: [] },
             verkoop: { history: [], partijen: [], categorieen: [], projecten: [] } },
    files: { inkoop: [], verkoop: [] },
    settings: { kmTarief: 0.25, thuisAdres: null, favorieten: [], afgeslotenTot: "2026-09-30", ibAfgeslotenJaar: 2025 },
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
  function showToast(msg, isError = false, onClick = null) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle("error", !!isError);
    el.classList.toggle("toast-klikbaar", !!onClick);
    el.classList.remove("hidden");
    el.onclick = onClick
      ? () => {
          el.classList.add("hidden");
          el.onclick = null;
          onClick();
        }
      : null;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), onClick ? 10000 : isError ? 6000 : 4000);
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
    if (vuileTabs.has(tab)) tekenTab(tab);
    tabs[tab]?.onShow?.();
    global.BoekCombo?.closeActivePopup();
  }

  // === Auth / token ===
  async function ensureLoggedIn() {
    return global.BoekAuth.acquireToken();
  }

  /** Inloggen verlopen of popup geblokkeerd: de wijziging moet blijven wachten. */
  function isAuthError(e) {
    return e?.name === "AuthError";
  }

  function meldInloggenNodig() {
    setStatus("Opnieuw inloggen nodig — wijzigingen wachten veilig in de wachtrij.", true);
    showToast("Opnieuw inloggen nodig. Je wijzigingen wachten in de wachtrij (Overzicht → Microsoft-account).", true);
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
  /**
   * Bestandenlijsten van "nog te verwerken". Een lijst die niet te lezen was
   * komt terug als null: dan blijft de vorige lijst staan, in plaats van dat
   * alles uit beeld verdwijnt (en verplaatsingen ten onrechte als gelukt tellen).
   */
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
      global.BoekGraph.listFolder(f.inkoopNieuw, token).catch(() => null),
      global.BoekGraph.listFolder(f.verkoopNieuw, token).catch(() => null),
    ]);
    return { inkoop: ink ? keep(ink) : null, verkoop: vrk ? keep(vrk) : null };
  }

  // === Sync-motor ===
  //
  // Waarom zo: het werkboek is traag (Graph + Excel-sessie, seconden per
  // wijziging) en een leesronde direct na het schrijven geeft soms nog de oude
  // stand terug. Daarom:
  //  1. Elke wijziging staat meteen lokaal in beeld (applyLocal).
  //  2. Schrijven gebeurt in één rij, nooit twee Excel-sessies tegelijk.
  //  3. Elke wijziging blijft in het journaal tot een verse leesronde laat zien
  //     dat hij echt in OneDrive staat. Tot die tijd wordt hij na elke
  //     leesronde opnieuw toegepast, zodat er niets terugspringt.
  //  4. Pas als de rij leeg is, wordt er (één keer) opnieuw gelezen.

  const journaal = []; // { id, d, status: wacht|schrijft|klaar|offline, klaarOp, res, queueId }
  let journaalTeller = 0;
  let schrijfKetting = Promise.resolve();
  let inDeRij = 0; // schrijfacties die wachten of bezig zijn
  let offlineAantal = 0; // items in de offline-wachtrij (IndexedDB)
  const BEVESTIG_TIMEOUT = 90000; // daarna geldt gewoon wat OneDrive zegt

  /** Schrijfactie achter de vorige zetten; de rij loopt altijd door. */
  function inRij(job) {
    inDeRij++;
    toonSchrijfStatus();
    const p = schrijfKetting.then(() => job());
    schrijfKetting = p
      .then(() => {}, () => {})
      .then(() => {
        inDeRij--;
        toonSchrijfStatus();
        if (!inDeRij) planSync();
      });
    return p;
  }

  function toonSchrijfStatus() {
    if (inDeRij > 1) setStatus(`Opslaan in OneDrive… (nog ${inDeRij})`);
    else if (inDeRij === 1) setStatus("Opslaan in OneDrive…");
  }

  function uitJournaal(e) {
    const i = journaal.indexOf(e);
    if (i >= 0) journaal.splice(i, 1);
  }

  // --- Leesronde plannen: pas als er niets meer geschreven wordt ---
  let syncTimer = null;
  let syncWachters = [];

  /** Leesronde inplannen; de promise is klaar na die leesronde. */
  function planSync(ms = 600) {
    return new Promise((resolve) => {
      syncWachters.push(resolve);
      clearTimeout(syncTimer);
      syncTimer = setTimeout(voerSyncUit, ms);
    });
  }

  async function voerSyncUit() {
    syncTimer = null;
    // Nog aan het schrijven: zodra de rij leeg is, wordt er opnieuw gepland.
    if (inDeRij) return;
    const wachters = syncWachters;
    syncWachters = [];
    try {
      await refreshFromCloud(true);
    } finally {
      wachters.forEach((r) => r());
    }
  }

  // --- Lezen ---
  let laadPromise = null;
  let nogEenRonde = false;

  function refreshFromCloud(quiet = false) {
    if (laadPromise) {
      nogEenRonde = true;
      return laadPromise;
    }
    // Opruimen via .finally op de promise zelf: een finally binnen de async
    // functie kan al lopen vóór de toewijzing hieronder (bij direct klaar).
    const p = (async () => {
      let stil = quiet;
      do {
        nogEenRonde = false;
        await laadRonde(stil);
        stil = true;
      } while (nogEenRonde && !inDeRij);
    })();
    const klaar = p.finally(() => {
      if (laadPromise === klaar) laadPromise = null;
    });
    laadPromise = klaar;
    return klaar;
  }

  async function laadRonde(quiet) {
    state.loading = true;
    if (!quiet) setStatus("Laden uit OneDrive…");
    const start = Date.now();
    try {
      const token = await ensureLoggedIn();
      // Kleine bestand-info eerst: is het werkboek onveranderd en hebben we de
      // regels al, dan slaan we het inlezen van de drie tabellen over. Staan er
      // nog wijzigingen op bevestiging te wachten, dan lezen we altijd.
      const meta = await global.BoekGraph.getDriveItemMeta(global.BoekIo.drivePath(), token);
      const kenmerk = meta?.cTag || meta?.eTag || null;
      const onveranderd =
        kenmerk && kenmerk === state.workbookEtag && state.loaded && !wachtOpWerkboek();
      const [data, files] = await Promise.all([
        onveranderd ? Promise.resolve(null) : global.BoekIo.loadAll(token),
        loadFileLists(token),
        state.settingsLoaded ? Promise.resolve() : loadSettingsRemote(token),
      ]);
      if (data) {
        state.workbookEtag = kenmerk;
        state.bankRows = data.bankRows;
        state.bankEndRow = data.bankEndRow || null;
        state.inkoopRows = data.inkoopRows;
        state.verkoopRows = data.verkoopRows;
        state.inkoopKeuzes = data.inkoopCategorieKeuzes;
        state.verkoopKeuzes = data.verkoopCategorieKeuzes;
        state.loaded = true;
      }
      const lijstVers = { inkoop: !!files.inkoop, verkoop: !!files.verkoop };
      if (files.inkoop) state.files.inkoop = files.inkoop;
      if (files.verkoop) state.files.verkoop = files.verkoop;

      // Wat nog niet (zichtbaar) in OneDrive staat er weer overheen leggen.
      const open = await herspeelJournaal(start, !!data, lijstVers);
      state.intel = M().buildIntel(state.inkoopRows, state.verkoopRows);
      if (open.werkboek) state.workbookEtag = null; // volgende ronde zeker opnieuw lezen
      if (data) bewaarSnapshot();

      state.webUrl = meta?.webUrl || null;
      const t = meta?.lastModifiedDateTime
        ? new Date(meta.lastModifiedDateTime).toLocaleString("nl-NL", {
            day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
          })
        : "";
      if (inDeRij) toonSchrijfStatus();
      else if (open.aantal) setStatus(`Bijwerken… (${open.aantal} wijziging${open.aantal === 1 ? "" : "en"} nog niet zichtbaar in OneDrive)`);
      else setStatus(`Gesynchroniseerd${t ? " · werkboek gewijzigd " + t : ""}${onveranderd ? " (ongewijzigd)" : ""}`);
      renderAll();
      // Nog niet bevestigd: zo nog eens kijken, steeds iets later.
      if (open.aantal) {
        herhaalPogingen++;
        planSync(Math.min(2000 * herhaalPogingen, 10000));
      } else {
        herhaalPogingen = 0;
      }
      if (!inDeRij) await flushOfflineQueue();
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
  let herhaalPogingen = 0;

  /** Staan er wijzigingen in het werkboek die nog niet in een leesronde gezien zijn? */
  function wachtOpWerkboek() {
    return journaal.some((e) => e.status === "klaar" && !isBestand(e.d));
  }

  /**
   * Na een leesronde: per journaal-item kijken of de verse data hem al bevat.
   * Bevestigd → uit het journaal. Anders (nog bezig, of OneDrive loopt achter)
   * → opnieuw toepassen op de verse data.
   */
  async function herspeelJournaal(start, versWerkboek, lijstVers) {
    const nu = Date.now();
    const weg = new Set();

    // Laatste item per doel (bankregel, factuurregel, bestand): een eerdere
    // wijziging op hetzelfde doel kan niet los bevestigd worden, want de
    // latere heeft hem misschien alweer veranderd.
    const laatstePerDoel = new Map();
    journaal.forEach((e, i) => doelen(e).forEach((k) => laatstePerDoel.set(k, i)));

    journaal.forEach((e, i) => {
      if (e.status !== "klaar" || e.klaarOp > start) return; // nog niet te controleren
      const bestand = isBestand(e.d);
      const kanControleren = bestand
        ? lijstVers.inkoop && lijstVers.verkoop
        : versWerkboek;
      const ingehaald = doelen(e).some((k) => laatstePerDoel.get(k) > i);
      if (kanControleren && !ingehaald && isVerwerkt(e)) {
        weg.add(e);
        return;
      }
      if (nu - e.klaarOp > BEVESTIG_TIMEOUT) {
        console.warn("Wijziging na 90 s nog niet zichtbaar in OneDrive; OneDrive is leidend.", e.d);
        weg.add(e);
      }
    });
    // Is een latere wijziging op hetzelfde doel bevestigd, dan zijn de eerdere
    // (al geschreven) wijzigingen daarop ook verwerkt.
    for (const w of [...weg]) {
      const wDoelen = new Set(doelen(w));
      for (const e of journaal) {
        if (e === w) break;
        if (e.status === "klaar" && e.klaarOp <= start && doelen(e).some((k) => wDoelen.has(k))) {
          weg.add(e);
        }
      }
    }
    for (const e of weg) uitJournaal(e);

    // Offline-wijzigingen uit een eerdere sessie (alleen nog in IndexedDB).
    let wachtrij = [];
    try {
      wachtrij = await global.BoekOfflineQueue.getAll();
    } catch (_) {}
    const bekend = new Set(journaal.map((e) => e.queueId).filter((x) => x != null));
    for (const item of wachtrij) if (!bekend.has(item.id)) applyLocal(item);
    wachtrijCache = wachtrij;

    for (const e of journaal) pasToe(e);

    const open = journaal.filter((e) => e.status === "klaar");
    return { aantal: open.length, werkboek: open.some((e) => !isBestand(e.d)) };
  }

  function pasToe(e) {
    applyLocal(e.d);
    if (e.res) applyNaSchrijven(e);
  }

  // --- Wat raakt een wijziging, en staat hij al in de verse data? ---

  function isBestand(d) {
    return d.kind === "file_move" || d.kind === "file_archive" || d.kind === "file_rename";
  }

  /** Terugzetten in "nog te verwerken" (ongedaan maken van archiveren). */
  function isTerugzetten(d) {
    const f = global.BOEK_CONFIG.graph.folders;
    return d.kind === "file_move" && (d.destFolder === f.inkoopNieuw || d.destFolder === f.verkoopNieuw);
  }

  function doelen(e) {
    const d = e.d;
    const uit = [];
    switch (d.kind) {
      case "bank_koppel":
        for (const it of d.items || []) uit.push(`bank:${it.excelRow}`);
        break;
      case "bank_ingeboekt":
        for (const r of d.rows || []) uit.push(`bank:${r}`);
        break;
      case "bank_ontkoppel":
      case "bank_update":
      case "bank_delete":
        uit.push(`bank:${d.excelRow}`);
        break;
      case "bank_add":
        if (e.res?.excelRow) uit.push(`bank:${e.res.excelRow}`);
        break;
      case "inkoop_add":
      case "verkoop_add":
        if (e.res?.excelRow) uit.push(`${d.kind.split("_")[0]}:${e.res.excelRow}`);
        if (e.res?.koppelWaarde) for (const r of d.bankRows || []) uit.push(`bank:${r}`);
        break;
      case "inkoop_update":
      case "inkoop_delete":
        uit.push(`inkoop:${d.excelRow}`);
        break;
      case "verkoop_update":
      case "verkoop_delete":
        uit.push(`verkoop:${d.excelRow}`);
        break;
      default:
        if (isBestand(d)) uit.push(`file:${d.itemId}`);
    }
    return uit;
  }

  const tekst = (v) => String(v ?? "").trim();
  const zelfdeTekst = (a, b) => tekst(a) === tekst(b);
  const zelfdeBedrag = (a, b) =>
    a == null || a === "" ? b == null : b != null && Math.abs(Number(a) - b) < 0.005;

  function factuurRegel(boek, excelRow) {
    const rows = boek === "inkoop" ? state.inkoopRows : state.verkoopRows;
    return rows.find((r) => r.excelRow === excelRow) || null;
  }

  function inLijst(itemId) {
    return [...state.files.inkoop, ...state.files.verkoop].find((f) => f.id === itemId) || null;
  }

  /** Bevat de verse data deze (geschreven) wijziging al? */
  function isVerwerkt(e) {
    const { d, res } = e;
    switch (d.kind) {
      case "bank_koppel":
        return (d.items || []).every((it) => {
          const r = findBank(it.excelRow);
          return r && M().bevatKoppeling(r.koppelingRaw, it.waarde) && (!it.ingeboekt || r.ingeboekt);
        });
      case "bank_ontkoppel": {
        const r = findBank(d.excelRow);
        const norm = (s) => String(s || "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).join(",");
        return !!r && norm(r.koppelingRaw) === norm(d.waarde);
      }
      case "bank_ingeboekt":
        return (d.rows || []).every((row) => findBank(row)?.ingeboekt === (d.value !== false));
      case "bank_update": {
        const r = findBank(d.excelRow);
        const f = d.fields || {};
        if (!r) return false;
        if (f.omschrijving != null && !zelfdeTekst(r.omschrijving, f.omschrijving)) return false;
        if (f.opmerking != null && !zelfdeTekst(r.opmerking, f.opmerking)) return false;
        if (f.rekening != null && !zelfdeTekst(r.rekening, f.rekening)) return false;
        if (f.updateAmounts && !(zelfdeBedrag(f.in, r.in) && zelfdeBedrag(f.uit, r.uit))) return false;
        return true;
      }
      case "bank_delete": {
        const r = findBank(d.excelRow);
        return !r || r.isEmptySlot;
      }
      case "bank_add": {
        if (!res?.excelRow) return true; // tabel uitgebreid: niet na te gaan
        const r = findBank(res.excelRow);
        const f = d.fields || {};
        return !!r && !r.isEmptySlot && zelfdeTekst(r.omschrijving, f.omschrijving) &&
          zelfdeBedrag(f.in, r.in) && zelfdeBedrag(f.uit, r.uit);
      }
      case "inkoop_add":
      case "verkoop_add": {
        if (!res?.excelRow) return true;
        const boek = d.kind.split("_")[0];
        const r = factuurRegel(boek, res.excelRow);
        const f = d.fields || {};
        const partij = boek === "inkoop" ? f.leverancier : f.klant;
        // Excel maakt van "00123" soms 123: bedrag mag het factuurnummer vervangen.
        if (!r || r.isEmpty || !zelfdeTekst(r.partij, partij)) return false;
        if (!zelfdeTekst(r.factuurnummer, f.factuurnummer) && !zelfdeBedrag(f.bedrag, r.bedrag)) return false;
        if (!res.koppelWaarde) return true;
        return (d.bankRows || []).every((row) => M().bevatKoppeling(findBank(row)?.koppelingRaw, res.koppelWaarde));
      }
      case "inkoop_update":
      case "verkoop_update": {
        const boek = d.kind.split("_")[0];
        const r = factuurRegel(boek, d.excelRow);
        const f = d.fields || {};
        const partij = boek === "inkoop" ? f.leverancier : f.klant;
        return !!r && (partij == null || zelfdeTekst(r.partij, partij)) &&
          (f.factuurnummer == null || zelfdeTekst(r.factuurnummer, f.factuurnummer)) &&
          (f.bedrag == null || zelfdeBedrag(f.bedrag, r.bedrag));
      }
      case "inkoop_delete":
      case "verkoop_delete": {
        const r = factuurRegel(d.kind.split("_")[0], d.excelRow);
        return !r || r.isEmpty;
      }
      case "file_move":
      case "file_archive":
        return isTerugzetten(d) ? !!inLijst(d.itemId) : !inLijst(d.itemId);
      case "file_rename": {
        const f = inLijst(d.itemId);
        return !f || f.name === d.newName;
      }
      default:
        return true;
    }
  }

  /** Laatste stand lokaal bewaren, zodat de app volgende keer meteen gevuld is. */
  function bewaarSnapshot() {
    global.BoekCache?.bewaar("data", {
      bankRows: state.bankRows,
      bankEndRow: state.bankEndRow,
      inkoopRows: state.inkoopRows,
      verkoopRows: state.verkoopRows,
      inkoopKeuzes: state.inkoopKeuzes,
      verkoopKeuzes: state.verkoopKeuzes,
      etag: state.workbookEtag,
    });
  }

  /** Bij het starten: eerst de bewaarde stand tonen, daarna pas de cloud. */
  async function toonSnapshot() {
    if (state.loaded) return false;
    const snap = await global.BoekCache?.lees("data");
    if (!snap?.bankRows) return false;
    state.bankRows = snap.bankRows;
    state.bankEndRow = snap.bankEndRow || null;
    state.inkoopRows = snap.inkoopRows || [];
    state.verkoopRows = snap.verkoopRows || [];
    state.inkoopKeuzes = snap.inkoopKeuzes || [];
    state.verkoopKeuzes = snap.verkoopKeuzes || [];
    state.workbookEtag = snap.etag || null;
    state.intel = M().buildIntel(state.inkoopRows, state.verkoopRows);
    state.loaded = true;
    setStatus(`Laatst bekend ${new Date(snap.bewaardOp).toLocaleString("nl-NL")} — bijwerken…`);
    renderAll();
    return true;
  }

  /**
   * Stille leesronde aanvragen. Wordt er nog geschreven, dan volgt hij vanzelf
   * zodra de rij leeg is; de promise is klaar na die leesronde.
   */
  function refreshQuiet() {
    return planSync(0);
  }

  // === Gedeelde indexen (koppelingen en dekking per factuur) ===
  // Deze twee lopen over álle bank- en factuurregels. Ze werden op acht plekken
  // per teken-ronde opnieuw opgebouwd; nu één keer per ronde en daarna gedeeld.
  let indexRonde = 0;
  let indexCache = { ronde: -1, kop: new Map(), dek: new Map() };

  function nieuweIndexRonde() {
    indexRonde++;
  }

  function indexen() {
    if (indexCache.ronde !== indexRonde) {
      indexCache = {
        ronde: indexRonde,
        kop: M().koppelingIndex(state.bankRows, state.inkoopRows, state.verkoopRows),
        dek: M().factuurDekking(state.bankRows, state.inkoopRows, state.verkoopRows),
      };
    }
    return indexCache;
  }

  const koppelIndex = () => indexen().kop;
  const dekkingIndex = () => indexen().dek;

  // Alleen de zichtbare tab tekenen; de rest krijgt een vlaggetje en wordt
  // getekend zodra je hem opent.
  const vuileTabs = new Set();

  function tekenTab(name) {
    try {
      tabs[name]?.render?.();
      vuileTabs.delete(name);
    } catch (e) {
      console.error(`render ${name}:`, e);
    }
  }

  // Open modals/panelen die met dezelfde data meelopen; zie registerLiveView.
  // Ze staan buiten de tabs, dus lui tekenen geldt niet voor hen.
  const liveViews = new Set();

  function registerLiveView(fn) {
    liveViews.add(fn);
  }

  function renderAll() {
    nieuweIndexRonde();
    for (const name of Object.keys(tabs)) vuileTabs.add(name);
    tekenTab(state.tab);
    for (const fn of liveViews) {
      try {
        fn();
      } catch (e) {
        console.error("live view:", e);
      }
    }
  }

  // === Direct zichtbaar: mutatie eerst lokaal toepassen ===
  // applyLocal moet idempotent zijn: na elke leesronde worden nog niet
  // bevestigde wijzigingen opnieuw toegepast op de verse data.

  function findBank(excelRow) {
    return state.bankRows.find((r) => r.excelRow === excelRow) || null;
  }

  function applyLocal(d) {
    try {
      switch (d.kind) {
        case "bank_koppel":
          for (const it of d.items || []) {
            const r = findBank(it.excelRow);
            if (!r) continue;
            r.koppelingRaw = M().voegKoppelingToe(r.koppelingRaw, it.waarde);
            if (it.ingeboekt) r.ingeboekt = true;
          }
          break;
        case "bank_ontkoppel": {
          const r = findBank(d.excelRow);
          if (r) r.koppelingRaw = d.waarde || "";
          break;
        }
        case "bank_ingeboekt":
          for (const row of d.rows || []) {
            const r = findBank(row);
            if (r) r.ingeboekt = d.value !== false;
          }
          break;
        case "bank_update": {
          const r = findBank(d.excelRow);
          if (!r) break;
          const f = d.fields || {};
          if (f.omschrijving != null) r.omschrijving = f.omschrijving;
          if (f.opmerking != null) r.opmerking = f.opmerking;
          if (f.rekening != null) r.rekening = f.rekening;
          if (f.updateAmounts) {
            r.in = f.in;
            r.uit = f.uit;
          }
          break;
        }
        case "bank_delete": {
          const r = findBank(d.excelRow);
          if (!r) break;
          Object.assign(r, {
            datum: null, datumStr: "", omschrijving: "", in: null, uit: null, saldo: null,
            ingeboekt: false, opmerking: "", koppelingRaw: "", isEmpty: true, isEmptySlot: true,
          });
          break;
        }
        case "inkoop_update":
        case "verkoop_update": {
          const boek = d.kind === "inkoop_update" ? state.inkoopRows : state.verkoopRows;
          const r = boek.find((x) => x.excelRow === d.excelRow);
          const f = d.fields || {};
          if (!r) break;
          const datum = M().isoToDate(f.datumIso);
          Object.assign(r, {
            datum: datum || r.datum,
            datumStr: M().formatDateNl(datum || r.datum),
            partij: (d.kind === "inkoop_update" ? f.leverancier : f.klant) ?? r.partij,
            omschrijving: f.omschrijving ?? r.omschrijving,
            factuurnummer: f.factuurnummer ?? r.factuurnummer,
            bedrag: f.bedrag != null ? f.bedrag : r.bedrag,
            btw: f.btw != null ? f.btw : r.btw,
            categorie: f.categorie ?? r.categorie,
            project: f.project ?? r.project,
            opmerking: f.opmerking ?? r.opmerking,
            land: f.land ?? r.land,
          });
          break;
        }
        case "inkoop_delete":
        case "verkoop_delete": {
          const boek = d.kind === "inkoop_delete" ? state.inkoopRows : state.verkoopRows;
          const r = boek.find((x) => x.excelRow === d.excelRow);
          if (r) Object.assign(r, { isEmpty: true, partij: "", bedrag: null, datum: null, datumStr: "" });
          for (const o of d.ontkoppel || []) {
            const b = findBank(o.excelRow);
            if (!b) continue;
            // Alleen de tokens die weg moesten; wat er sindsdien bij kwam blijft.
            const delen = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
            const blijft = new Set(delen(o.waarde).map((t) => t.toLowerCase()));
            const weg = new Set(delen(o.oud).map((t) => t.toLowerCase()).filter((t) => !blijft.has(t)));
            b.koppelingRaw = delen(b.koppelingRaw).filter((t) => !weg.has(t.toLowerCase())).join(", ");
          }
          break;
        }
        case "file_move":
        case "file_archive":
          // Meteen uit "nog te verwerken", zodat hij niet nog eens gekozen kan
          // worden. Terugzetten kan pas getoond worden als OneDrive hem weer
          // in de map laat zien.
          if (isTerugzetten(d)) break;
          state.files.inkoop = state.files.inkoop.filter((f) => f.id !== d.itemId);
          state.files.verkoop = state.files.verkoop.filter((f) => f.id !== d.itemId);
          break;
        case "file_rename":
          for (const k of ["inkoop", "verkoop"]) {
            state.files[k] = state.files[k].map((f) => (f.id === d.itemId ? { ...f, name: d.newName } : f));
          }
          break;
        case "bank_add":
        case "inkoop_add":
        case "verkoop_add":
          // De rij is pas bekend na het schrijven: zie applyNaSchrijven.
          break;
        default:
          return false;
      }
    } catch (e) {
      console.error("applyLocal", e);
      return false;
    }
    return true;
  }

  /** Nieuwe bankregel op zijn rij zetten zodra bekend is welke rij het werd. */
  function plaatsBankRij(excelRow, f) {
    let r = findBank(excelRow);
    if (!r) {
      r = { excelRow, saldo: null };
      state.bankRows.push(r);
      state.bankRows.sort((a, b) => a.excelRow - b.excelRow);
    }
    const datum = M().isoToDate(f.datumIso);
    Object.assign(r, {
      datum,
      datumStr: M().formatDateNl(datum),
      omschrijving: f.omschrijving || "",
      in: f.in != null ? f.in : null,
      uit: f.uit != null ? f.uit : null,
      ingeboekt: !!f.ingeboekt,
      opmerking: f.opmerking || "",
      rekening: f.rekening || "",
      koppelingRaw: M().voegKoppelingToe(r.isEmptySlot === false ? r.koppelingRaw : "", f.koppeling || ""),
      isEmpty: false,
      isEmptySlot: false,
    });
  }

  /** Nieuwe inkoop- of verkoopregel lokaal invullen (berekende kolommen bij benadering). */
  function plaatsFactuurRij(boek, excelRow, f) {
    const rows = boek === "inkoop" ? state.inkoopRows : state.verkoopRows;
    let r = rows.find((x) => x.excelRow === excelRow);
    if (!r) {
      r = { excelRow };
      rows.push(r);
      rows.sort((a, b) => a.excelRow - b.excelRow);
    }
    const datum = M().isoToDate(f.datumIso);
    const btwBedrag = f.verlegd ? 0 : M().btwBedragVanPercentage(f.bedrag, f.btw);
    Object.assign(r, {
      datum,
      datumStr: M().formatDateNl(datum),
      partij: (boek === "inkoop" ? f.leverancier : f.klant) || "",
      omschrijving: f.omschrijving || "",
      factuurnummer: f.factuurnummer || "",
      bedrag: f.bedrag != null ? f.bedrag : null,
      bedragOrig: f.bedragOrig != null ? f.bedragOrig : null,
      valuta: f.valuta || "",
      wisselkoers: f.wisselkoers || "",
      btw: f.btw != null ? f.btw : null,
      btwBedrag,
      netto: f.bedrag != null ? Math.round((f.bedrag - (btwBedrag || 0)) * 100) / 100 : null,
      categorie: f.categorie || "",
      opmerking: f.opmerking || "",
      land: M().normalizeLand(f.land) || "",
      isEmpty: false,
    });
    if (boek === "inkoop") {
      Object.assign(r, {
        verlegd: !!f.verlegd,
        afschrijving: !!f.afschrijving,
        project: f.project || "",
      });
    }
  }

  /** Effect dat pas na het schrijven bekend is (de rij waar een nieuwe regel landde). */
  function applyNaSchrijven(e) {
    const { d, res } = e;
    if (!res) return;
    try {
      if (d.kind === "bank_add" && res.excelRow) plaatsBankRij(res.excelRow, d.fields || {});
      if ((d.kind === "inkoop_add" || d.kind === "verkoop_add") && res.excelRow) {
        const boek = d.kind.split("_")[0];
        plaatsFactuurRij(boek, res.excelRow, d.fields || {});
        for (const x of res.extraRijen || []) plaatsFactuurRij(boek, x.excelRow, x.fields);
        if (res.koppelWaarde) {
          for (const row of d.bankRows || []) {
            const r = findBank(row);
            if (!r) continue;
            r.koppelingRaw = M().voegKoppelingToe(r.koppelingRaw, res.koppelWaarde);
            r.ingeboekt = true;
          }
        }
      }
    } catch (err) {
      console.error("applyNaSchrijven", err);
    }
  }

  /**
   * Na inboeken de afgevinkte bankregels aan de nieuwe factuurregel koppelen.
   * De nieuwe regel staat dan al lokaal in de lijst, zodat koppelWaarde een
   * dubbel factuurnummer herkent (en dan "(I12)" erbij zet).
   */
  async function koppelNaInboeken(token, d, res, boekLetter) {
    const rows = d.bankRows || [];
    if (!rows.length || !res?.excelRow) return null;
    const waarde = global.BoekModel.koppelWaarde(
      boekLetter,
      { excelRow: res.excelRow, factuurnummer: d.fields.factuurnummer || "" },
      state.inkoopRows,
      state.verkoopRows
    );
    await global.BoekIo.koppelBank(
      token,
      rows.map((r) => ({ excelRow: r, waarde, ingeboekt: true })),
      d.verwacht
    );
    return waarde;
  }

  function meldAlGeboekt(d) {
    const f = d.fields || {};
    const wie = f.leverancier || f.klant || f.omschrijving || "";
    showToast(`Stond al in het werkboek (eerdere poging kwam toch aan): ${wie} niet nog eens geboekt.`);
  }

  // === Voorbereiden: wat verwacht deze wijziging aan te treffen? ===
  let uidTeller = 0;
  let wachtrijCache = []; // offline-wachtrij zoals bij de laatste leesronde gezien
  function nieuweUid() {
    try {
      if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    } catch (_) {}
    return `${Date.now().toString(36)}-${(++uidTeller).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Legt vast wat de wijziging verwacht aan te treffen, vóórdat hij lokaal
   * wordt toegepast. Gaat mee in de offline-wachtrij, zodat ook een wijziging
   * die uren later wordt verstuurd nooit op een verkeerde rij terechtkomt.
   *  - verwacht: per geraakte rij de identiteit (datum + bedrag (+ nummer))
   *  - telVooraf: hoeveel gelijke regels er al waren (bij nieuwe regels)
   *  - ontkoppel: koppelingen in het bankboek die met een factuur mee weg moeten
   *  - naUid: alleen uitvoeren als die eerdere wijziging gelukt is
   */
  function bereidVoor(d, alleenAls) {
    if (!d.uid) d.uid = nieuweUid();
    if (alleenAls?.uid && !d.naUid) d.naUid = alleenAls.uid;
    if (isBestand(d) || d.verwacht) return;
    const rijenVan = (soort) =>
      soort === "bank" ? state.bankRows : soort === "inkoop" ? state.inkoopRows : state.verkoopRows;
    const verwacht = {};
    const zet = (soort, excelRow) => {
      if (excelRow == null) return;
      const r = rijenVan(soort).find((x) => x.excelRow === excelRow);
      if (r && !r.isEmpty) verwacht[`${soort}|${excelRow}`] = M().rijIdentiteit(soort, r);
    };
    switch (d.kind) {
      case "bank_update":
      case "bank_delete":
      case "bank_ontkoppel":
        zet("bank", d.excelRow);
        break;
      case "bank_ingeboekt":
        (d.rows || []).forEach((r) => zet("bank", r));
        break;
      case "bank_koppel":
        (d.items || []).forEach((it) => zet("bank", it.excelRow));
        break;
      case "inkoop_update":
      case "inkoop_delete":
        zet("inkoop", d.excelRow);
        break;
      case "verkoop_update":
      case "verkoop_delete":
        zet("verkoop", d.excelRow);
        break;
      case "inkoop_add":
      case "verkoop_add":
        (d.bankRows || []).forEach((r) => zet("bank", r));
        break;
      default:
        break;
    }
    // Bij een bewerking is ook de stand ná de bewerking goed: dan was een
    // eerdere poging al gelukt en verandert opnieuw schrijven niets.
    const soortVan = { bank_update: "bank", inkoop_update: "inkoop", verkoop_update: "verkoop" }[d.kind];
    const sleutel = soortVan && `${soortVan}|${d.excelRow}`;
    if (sleutel && verwacht[sleutel] != null) {
      const f = d.fields || {};
      const oud = rijenVan(soortVan).find((x) => x.excelRow === d.excelRow);
      const na =
        soortVan === "bank"
          ? f.updateAmounts
            ? M().rijIdentiteit("bank", { ...oud, in: f.in, uit: f.uit })
            : verwacht[sleutel]
          : // Precies wat writeInkoopRow/writeVerkoopRow wegschrijven.
            M().rijIdentiteit(soortVan, {
              isEmpty: false,
              datum: M().isoToDate(f.datumIso),
              bedrag: f.bedrag ?? null,
              factuurnummer: f.factuurnummer || "",
            });
      if (na !== verwacht[sleutel]) verwacht[sleutel] = [verwacht[sleutel], na];
    }
    d.verwacht = verwacht;
    if (d.kind === "bank_add" || d.kind === "inkoop_add" || d.kind === "verkoop_add") {
      const soort = d.kind.split("_")[0];
      const sleutel = M().regelSleutel(soort, d.fields || {});
      // Gelijke regels die nog geschreven moeten worden, tellen ook mee.
      const bekend = new Set(journaal.map((e) => e.queueId).filter((x) => x != null));
      const wachtend =
        journaal.filter(
          (e) => e.d.kind === d.kind && e.status !== "klaar" && M().regelSleutel(soort, e.d.fields || {}) === sleutel
        ).length +
        // Uit een eerdere sessie, nog alleen in de offline-wachtrij.
        wachtrijCache.filter(
          (it) => !bekend.has(it.id) && it.kind === d.kind && M().regelSleutel(soort, it.fields || {}) === sleutel
        ).length;
      d.telVooraf = M().telRegelSleutel(soort, rijenVan(soort), sleutel) + wachtend;
    }
    if (d.kind === "inkoop_delete" || d.kind === "verkoop_delete") {
      d.ontkoppel = M().koppelingenZonderFactuur(
        state.bankRows, state.inkoopRows, state.verkoopRows, d.kind.split("_")[0], d.excelRow
      );
    }
  }

  // === Mutaties uitvoeren (altijd via de schrijfrij) ===
  /**
   * herhaling: deze wijziging is al eens geprobeerd (offline-wachtrij, of een
   * netwerkfout halverwege). Nieuwe regels worden dan eerst opgezocht in het
   * werkboek, zodat een eerdere poging die wél aankwam niet dubbel wordt geboekt.
   */
  async function executeMutation(d, { herhaling = false } = {}) {
    const token = await ensureLoggedIn();
    const IO = global.BoekIo;
    const nieuw = { herhaling, telVooraf: d.telVooraf };
    switch (d.kind) {
      case "bank_add":
        // Hint: de rijen die de app al heeft, zodat de tabel niet opnieuw
        // gelezen hoeft te worden (alleen de gekozen rij wordt gecontroleerd).
        return IO.addBankRow(token, d.fields, { rows: state.bankRows, endRow: state.bankEndRow }, nieuw);
      case "bank_update":
        return IO.updateBankRow(token, d.excelRow, d.fields, d.verwacht);
      case "bank_delete":
        return IO.deleteBankRow(token, d.excelRow, d.verwacht);
      case "bank_ingeboekt":
        return IO.setBankIngeboekt(token, d.rows, d.value !== false, d.verwacht);
      case "bank_koppel":
        return IO.koppelBank(token, d.items, d.verwacht);
      case "bank_ontkoppel":
        return IO.ontkoppelBank(token, d.excelRow, d.waarde || "", d.verwacht);
      case "inkoop_add": {
        // Eerst de af te vinken bankregels controleren: klopt er één niet, dan
        // ook de factuur niet boeken (anders een factuur zonder koppeling).
        await IO.controleerBankRijen(token, d.bankRows, d.verwacht);
        const res = (await IO.addInkoopRow(token, d.fields, state.inkoopRows, nieuw)) || {};
        if (res.excelRow) plaatsFactuurRij("inkoop", res.excelRow, d.fields);
        res.koppelWaarde = await koppelNaInboeken(token, d, res, "I");
        // Afschrijving aangevinkt → jaarregels automatisch mee-inboeken.
        // Stond de aankoop er al (eerdere poging), dan ook per jaarregel kijken.
        res.extraRijen = [];
        if (d.fields.afschrijving && d.fields.afschrijvingJaren) {
          const regels = global.BoekModel.afschrijvingsRegels(d.fields, d.fields.afschrijvingJaren);
          const regelOpties = res.alBestaand ? { herhaling: true, telVooraf: 0 } : {};
          for (const regel of regels) {
            const r2 = await IO.addInkoopRow(token, regel, state.inkoopRows, regelOpties);
            if (r2?.excelRow) {
              plaatsFactuurRij("inkoop", r2.excelRow, regel);
              res.extraRijen.push({ excelRow: r2.excelRow, fields: regel });
            }
          }
        }
        if (res.alBestaand) meldAlGeboekt(d);
        return res;
      }
      case "inkoop_update":
        return IO.updateInkoopRow(token, d.excelRow, d.fields, d.verwacht);
      case "inkoop_delete":
        await IO.deleteInkoopRow(token, d.excelRow, d.verwacht);
        return IO.ruimKoppelingenOp(token, d.ontkoppel);
      case "verkoop_add": {
        await IO.controleerBankRijen(token, d.bankRows, d.verwacht);
        const res = (await IO.addVerkoopRow(token, d.fields, state.verkoopRows, nieuw)) || {};
        if (res.excelRow) plaatsFactuurRij("verkoop", res.excelRow, d.fields);
        res.koppelWaarde = await koppelNaInboeken(token, d, res, "V");
        if (res.alBestaand) meldAlGeboekt(d);
        return res;
      }
      case "verkoop_update":
        return IO.updateVerkoopRow(token, d.excelRow, d.fields, d.verwacht);
      case "verkoop_delete":
        await IO.deleteVerkoopRow(token, d.excelRow, d.verwacht);
        return IO.ruimKoppelingenOp(token, d.ontkoppel);
      case "file_move":
        return global.BoekGraph.moveItem(d.itemId, d.destFolder, token, d.newName);
      case "file_rename":
        return global.BoekGraph.renameItem(d.itemId, d.newName, token);
      case "file_archive":
        // Nooit echt verwijderen: naar de map archief naast "nog te verwerken".
        await global.BoekGraph.ensureFolder(d.destFolder, token);
        return global.BoekGraph.moveItem(d.itemId, d.destFolder, token);
      default:
        throw new Error(`Onbekende mutatie: ${d.kind}`);
    }
  }

  /** Alleen bewaren wat later nodig is (Graph-antwoorden horen niet in het journaal). */
  function bewaarResultaat(d, res) {
    if (!res || isBestand(d)) return null;
    return {
      excelRow: res.excelRow ?? null,
      koppelWaarde: res.koppelWaarde || null,
      extraRijen: res.extraRijen || [],
    };
  }

  async function zetOffline(e) {
    e.queueId = await global.BoekOfflineQueue.add(e.d);
    e.status = "offline";
    await updateQueueBadge();
    showToast("Offline — wijziging wordt gesynchroniseerd zodra er verbinding is.");
    meldSyncAan();
    planFlush();
  }

  /** Mislukt: lokale stand niet meer vertrouwen, de volgende leesronde leest alles opnieuw. */
  function herstelNaFout(e) {
    uitJournaal(e);
    state.workbookEtag = null;
  }

  /**
   * Voert een mutatie uit; retourneert true als het gelukt is (of offline
   * klaarstaat). De wijziging staat meteen in beeld; het schrijven gebeurt
   * in de rij, één tegelijk.
   *
   * alleenAls: promise van een eerdere persistMutation; is die mislukt, dan
   * wordt deze overgeslagen (bijv. bestand pas verplaatsen als het inboeken lukte).
   */
  // === Periodeslot: na de btw-aangifte ligt een kwartaal vast ===

  /** Datum (ISO) van een bestaande rij, of "". */
  function rijDatumIso(soort, excelRow) {
    const rows = soort === "bank" ? state.bankRows : soort === "inkoop" ? state.inkoopRows : state.verkoopRows;
    const r = rows.find((x) => x.excelRow === excelRow);
    return r?.datum ? M().dateToIso(r.datum) : "";
  }

  /**
   * Raakt deze wijziging een afgesloten periode? Dan de melding, anders null.
   * Koppelen en afvinken mogen altijd: die veranderen geen omzet, kosten of btw.
   */
  function periodeSlotMelding(d) {
    const tot = state.settings.afgeslotenTot;
    if (!tot) return null;
    const dicht = (iso) => !!iso && iso <= tot;
    const soort = d.kind.split("_")[0];
    const actie = d.kind.split("_")[1];
    let raakt = false;
    if (soort === "inkoop" || soort === "verkoop") {
      if (actie === "add") raakt = dicht(d.fields?.datumIso);
      else if (actie === "update") raakt = dicht(d.fields?.datumIso) || dicht(rijDatumIso(soort, d.excelRow));
      else if (actie === "delete") raakt = dicht(rijDatumIso(soort, d.excelRow));
    } else if (soort === "bank") {
      if (actie === "add") raakt = dicht(d.fields?.datumIso);
      else if (actie === "delete") raakt = dicht(rijDatumIso("bank", d.excelRow));
      else if (actie === "update" && d.fields?.updateAmounts) raakt = dicht(rijDatumIso("bank", d.excelRow));
    }
    if (!raakt) return null;
    return (
      `Deze regel valt in een afgesloten periode (t/m ${M().formatDateNl(M().isoToDate(tot))}): ` +
      `de btw-aangifte daarvan is al gedaan. Wijzig je hem toch, dan moet het verschil in een ` +
      `suppletie of in de volgende aangifte. Toch doorgaan?`
    );
  }

  /**
   * Voor de formulieren: vraag het periodeslot vóórdat het formulier leeg gaat.
   * true = mag door (descriptor krijgt slotAkkoord), false = geannuleerd.
   */
  async function bevestigPeriodeSlot(descriptor) {
    const melding = periodeSlotMelding(descriptor);
    if (!melding) return true;
    const ok = await showConfirm(melding, "Toch doorgaan", "Annuleren");
    if (ok) descriptor.slotAkkoord = true;
    return ok;
  }

  function persistMutation(descriptor, opties = {}) {
    const melding = descriptor.slotAkkoord ? null : periodeSlotMelding(descriptor);
    if (!melding) return persistMutationNu(descriptor, opties);
    if (!descriptor.uid) descriptor.uid = nieuweUid();
    const p = (async () => {
      const ok = await showConfirm(melding, "Toch doorgaan", "Annuleren");
      if (!ok) {
        showToast("Niets gewijzigd: deze periode is afgesloten.");
        return false;
      }
      descriptor.slotAkkoord = true;
      return persistMutationNu(descriptor, opties);
    })();
    p.uid = descriptor.uid;
    return p;
  }

  function persistMutationNu(descriptor, { successMsg, alleenAls } = {}) {
    bereidVoor(descriptor, alleenAls);
    const e = { id: ++journaalTeller, d: descriptor, status: "wacht", klaarOp: 0, res: null };
    journaal.push(e);
    if (applyLocal(descriptor)) {
      state.intel = M().buildIntel(state.inkoopRows, state.verkoopRows);
      renderAll();
    }
    // Eerst (buiten de schrijfrij) wachten op de wijziging waar deze van afhangt.
    // Binnen de rij wachten kan vastlopen: die andere wijziging kan zelf nog
    // op een vraag wachten (periodeslot) en pas daarna achteraan aansluiten.
    const vooraf = alleenAls ? alleenAls.catch(() => false) : Promise.resolve(true);
    const p = vooraf.then((ok) => {
      if (!ok) {
        herstelNaFout(e);
        renderAll();
        return false;
      }
      return inRij(() => schrijfNu(e, descriptor, successMsg));
    });
    // Zodat een volgende wijziging kan zeggen: "alleen als deze gelukt is".
    p.uid = descriptor.uid;
    return p;
  }

  async function schrijfNu(e, descriptor, successMsg) {
    {
      // Staat er al iets offline klaar, dan hier ook achteraan aansluiten,
      // anders loopt de volgorde in het werkboek door elkaar.
      if (!global.BoekOfflineQueue.isOnline() || offlineAantal > 0) {
        await zetOffline(e);
        return true;
      }
      e.status = "schrijft";
      let res;
      try {
        res = await executeMutation(descriptor);
      } catch (err) {
        if (isNetworkError(err)) {
          await zetOffline(e);
          return true;
        }
        if (isAuthError(err)) {
          // Niet weggooien: bewaren tot er weer ingelogd is.
          await zetOffline(e);
          meldInloggenNodig();
          return true;
        }
        herstelNaFout(e);
        if (err?.name === "GraphLockError") {
          showToast(err.message, true);
          setStatus("Werkboek vergrendeld", true);
        } else {
          showToast(err.message || String(err), true);
          setStatus("Opslaan mislukt", true);
        }
        renderAll();
        return false;
      }
      e.status = "klaar";
      e.klaarOp = Date.now();
      e.res = bewaarResultaat(descriptor, res);
      applyNaSchrijven(e);
      state.intel = M().buildIntel(state.inkoopRows, state.verkoopRows);
      renderAll();
      if (successMsg) showToast(successMsg);
      return true;
    }
  }

  // === Offline-wachtrij wegwerken (ook via de schrijfrij) ===
  let flushPromise = null;
  let flushTimer = null;

  function planFlush(ms = 15000) {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      if (global.BoekOfflineQueue.isOnline()) flushOfflineQueue().catch(() => {});
    }, ms);
  }

  function flushOfflineQueue() {
    if (flushPromise) return flushPromise;
    const p = (async () => {
      if (!global.BoekOfflineQueue.isOnline()) return;
      {
        let gestopt = false;
        // Wijzigingen die mislukten: wat daarvan afhangt (bestand verplaatsen
        // na inboeken) gaat dan ook niet door.
        const mislukt = new Set();
        // Opnieuw ophalen tot hij leeg is: tijdens het wegwerken kunnen er
        // nieuwe wijzigingen achteraan zijn aangesloten.
        for (let ronde = 0; ronde < 5 && !gestopt; ronde++) {
          const items = await global.BoekOfflineQueue.getAll();
          if (!items.length) break;
          for (const item of items) {
            const uitkomst = await inRij(async () => {
              if (item.naUid && mislukt.has(item.naUid)) {
                await global.BoekOfflineQueue.remove(item.id);
                if (item.uid) mislukt.add(item.uid);
                showToast("Bestand niet verplaatst: de boeking ervoor is mislukt. Het blijft in \"nog te verwerken\".", true);
                return { ok: false };
              }
              try {
                // herhaling: nieuwe regels eerst opzoeken, nooit dubbel boeken.
                const res = await executeMutation(item, { herhaling: true });
                await global.BoekOfflineQueue.remove(item.id);
                return { ok: true, res };
              } catch (err) {
                if (err?.name === "GraphLockError" || isNetworkError(err)) return { stop: true };
                if (isAuthError(err)) {
                  meldInloggenNodig();
                  return { stop: true, inloggen: true };
                }
                await global.BoekOfflineQueue.remove(item.id);
                if (item.uid) mislukt.add(item.uid);
                showToast(`Wachtrij-item mislukt: ${err.message || err}`, true);
                return { ok: false };
              }
            });
            let e = journaal.find((x) => x.queueId === item.id);
            if (uitkomst.stop) {
              gestopt = true;
              // Bij inloggen niet steeds opnieuw een popup proberen: dat
              // gebeurt bij de volgende leesronde of na het inloggen.
              if (!uitkomst.inloggen) planFlush(30000);
              break;
            }
            if (uitkomst.ok) {
              if (!e) {
                e = { id: ++journaalTeller, d: item, queueId: item.id };
                journaal.push(e);
              }
              e.status = "klaar";
              e.klaarOp = Date.now();
              e.res = bewaarResultaat(item, uitkomst.res);
              applyNaSchrijven(e);
            } else {
              if (e) uitJournaal(e);
              state.workbookEtag = null;
            }
            await updateQueueBadge();
          }
        }
        await updateQueueBadge();
        if (offlineAantal > 0 && !gestopt) planFlush(2000);
      }
    })();
    // Zie refreshFromCloud: opruimen via de promise, niet binnen de functie.
    const klaar = p.finally(() => {
      if (flushPromise === klaar) flushPromise = null;
    });
    flushPromise = klaar;
    return flushPromise;
  }

  async function updateQueueBadge() {
    try {
      offlineAantal = await global.BoekOfflineQueue.count();
    } catch (_) {
      offlineAantal = 0;
    }
    const el = $("#queue-status");
    if (!el) return;
    const n = offlineAantal;
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

  const ICON_LINK =
    '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/>' +
    '<path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>';

  /**
   * Actieknoppen voor een lijstitem: potlood + prullenbak, en met {link:true}
   * ook een ketting-knop (bankregels koppelen).
   */
  function rowActionsHtml(opts = {}) {
    return (
      '<span class="row-actions">' +
      (opts.link
        ? `<button type="button" class="btn-icon btn-icon-link" data-act="link" aria-label="Bankregels koppelen" title="Bankregels koppelen">${ICON_LINK}</button>`
        : "") +
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

    try {
      global.BoekKoppel?.init();
    } catch (e) {
      console.error("init koppel:", e);
    }
    for (const name of Object.keys(tabs)) {
      try {
        tabs[name].init?.();
      } catch (e) {
        console.error(`init ${name}:`, e);
      }
    }

    await toonSnapshot();
    global.BoekInstall.init(switchTab);
    bindPullToRefresh();

    window.addEventListener("online", () => {
      flushOfflineQueue().then(() => refreshQuiet());
    });
    // Terug in beeld (van een andere app teruggeschakeld): meteen bijwerken.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") flushOfflineQueue().catch(() => {});
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

    bindServiceWorker();
  }

  /**
   * De service worker start de app uit de cache en haalt updates op de
   * achtergrond op. Zodra een nieuwe versie het overneemt, kun je hem met één
   * tik gebruiken (in plaats van bij elke start op het netwerk te wachten).
   */
  function bindServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    const eersteInstallatie = !navigator.serviceWorker.controller;
    let gemeld = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (eersteInstallatie || gemeld) return; // eerste keer is gewoon installeren
      gemeld = true;
      showToast("Nieuwe versie klaar, tik om te vernieuwen", false, () => (window.IMeTechHerlaad || (() => location.reload()))());
    });
    // De service worker vraagt de wachtrij weg te werken zodra er weer
    // verbinding is (Background Sync); het opslaan zelf gebeurt hier, want de
    // service worker heeft geen inlog-token.
    navigator.serviceWorker.addEventListener("message", (ev) => {
      if (ev.data?.type === "flush-queue") flushOfflineQueue().catch(() => {});
    });
  }

  /** Bij de browser aanmelden dat er nog iets te synchroniseren valt. */
  async function meldSyncAan() {
    try {
      const reg = await navigator.serviceWorker?.ready;
      await reg?.sync?.register("imtech-queue-sync");
    } catch (_) {
      /* geen Background Sync: de app werkt de wachtrij bij openen weg */
    }
  }

  global.BoekApp = {
    state,
    koppelIndex,
    dekkingIndex,
    nieuweIndexRonde,
    $,
    registerTab,
    registerLiveView,
    showToast,
    setStatus,
    haptic,
    showConfirm,
    switchTab,
    ensureLoggedIn,
    refreshFromCloud,
    refreshQuiet,
    persistMutation,
    bevestigPeriodeSlot,
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
    ICON_LINK,
  };
  global.BoekBoot = boot;
})(window);
