/**
 * Bankboek-tab: één doorzoekbare lijst met filters (open / controle / gekoppeld),
 * per regel of de gekoppelde factuurbedragen kloppen, en een detailscherm om te
 * koppelen, ontkoppelen en af te vinken zonder tussendoor te verversen.
 */
(function (global) {
  const App = () => global.BoekApp;
  const M = () => global.BoekModel;
  const $ = (s) => document.querySelector(s);

  let modalRowNr = null; // excelRow van de bankregel in de modal
  let gematchteRijen = []; // openstaande regels waarvoor precies één factuur gevonden is
  let filter = "Alles"; // Alles | Rabo | Knab
  let statusFilter = "open"; // open | controle | los | alles
  let toonAantal = 40;

  const REK_KEY = "boek_laatste_rekening";
  const STATUS_KEY = "boek_bank_status_filter";

  function nieuweRekening() {
    try {
      const v = localStorage.getItem(REK_KEY);
      if (v === "Rabo" || v === "Knab") return v;
    } catch (_) {}
    return "Knab";
  }

  function bewaardStatusFilter() {
    try {
      const v = localStorage.getItem(STATUS_KEY);
      if (["open", "controle", "los", "alles"].includes(v)) return v;
    } catch (_) {}
    return "open";
  }

  /** Segmented switch: zet de actieve rekening en geef de huidige keuze terug. */
  function setSwitch(containerId, rekening) {
    document.querySelectorAll(`#${containerId} .rek-opt`).forEach((b) => {
      const actief = b.dataset.rek === rekening;
      b.classList.toggle("active", actief);
      b.setAttribute("aria-checked", String(actief));
    });
  }

  function getSwitch(containerId) {
    return document.querySelector(`#${containerId} .rek-opt.active`)?.dataset.rek || "";
  }

  function bindSwitch(containerId, onChange) {
    document.querySelectorAll(`#${containerId} .rek-opt`).forEach((b) => {
      b.addEventListener("click", () => {
        setSwitch(containerId, b.dataset.rek);
        App().haptic(15);
        onChange?.(b.dataset.rek);
      });
    });
  }

  function rekDot(rekening) {
    if (rekening === "Rabo") return '<span class="rek-dot rek-dot-rabo" title="Rabobank"></span>';
    if (rekening === "Knab") return '<span class="rek-dot rek-dot-knab" title="Knab"></span>';
    return "";
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function recenteFacturen() {
    const st = App().state;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const all = [
      ...st.inkoopRows.filter((r) => !r.isEmpty).map((r) => ({ ...r, boek: "Inkoop" })),
      ...st.verkoopRows.filter((r) => !r.isEmpty).map((r) => ({ ...r, boek: "Verkoop" })),
    ];
    return all.filter((f) => f.datum && f.datum.getTime() >= cutoff.getTime());
  }

  /** Omgekeerde index (factuur → bankregels) + gedekt bedrag per factuur, per render. */
  let kopIndex = new Map();
  let dekkingMap = new Map();

  function bouwKopIndex() {
    const st = App().state;
    // Gedeeld met de andere tabs: één keer per teken-ronde opgebouwd.
    kopIndex = App().koppelIndex();
    dekkingMap = App().dekkingIndex();
    return kopIndex;
  }

  function statusVan(r) {
    const st = App().state;
    return M().bankKoppelStatus(r, st.inkoopRows, st.verkoopRows, dekkingMap, kopIndex);
  }

  function matchesVoorBankRow(r, facturen) {
    return M().invoiceMatchesForBankRow(facturen, r, kopIndex, App().state.matchDagen);
  }

  /** Korte weergave van een koppeling: partij + factuurnummer + bedrag + datum. */
  function koppelLabel(k) {
    if (k.token === "-") return "geen factuur (bewust)";
    if (k.row) {
      const nr = k.row.factuurnummer ? ` · ${escapeHtml(k.row.factuurnummer)}` : "";
      // Eén nummer over meerdere regels: toon het totaal van de hele groep.
      const bedrag = k.groepBedrag != null ? k.groepBedrag : k.row.bedrag;
      const dubbel = k.ambigu ? ` (${k.ambigu} regels met dit nummer)` : "";
      return `${escapeHtml(k.row.partij)}${nr} · ${M().fmtEur(bedrag)} · ${k.row.datumStr}${dubbel}`;
    }
    return escapeHtml(k.token); // de statusregel eronder legt uit wat eraan schort
  }

  function recenteOmschrijvingen() {
    const st = App().state;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 42);
    const set = new Set();
    for (const r of st.bankRows) {
      if (!r.isEmpty && r.datum && r.datum.getTime() >= cutoff.getTime() && r.omschrijving) {
        set.add(r.omschrijving);
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  /**
   * Eén regel in de lijst. Naast omschrijving en bedrag staat er altijd bij
   * wát eraan hangt en of het bedrag daarvan klopt — dat was voorheen alleen
   * in het detailscherm te zien.
   */
  function rowLine(r, { showMatch = false, facturen = null } = {}) {
    const li = document.createElement("li");
    li.className = "boek-item";
    const bedragHtml =
      r.in != null
        ? `<span class="bi-amount in">+ ${M().fmtEur(r.in)}</span>`
        : `<span class="bi-amount uit">− ${M().fmtEur(r.uit)}</span>`;

    const s = statusVan(r);
    let matchHtml = "";
    if (s.kind !== "geen") {
      const ks = s.koppelingen.filter((k) => k.token !== "-");
      const eerste = ks[0];
      const extra = ks.length > 1 ? ` +${ks.length - 1}` : "";
      li.classList.add(`koppel-${s.kind}`);
      matchHtml =
        s.kind === "geenNodig"
          ? `<div class="bi-status status-geenNodig">– geen factuur nodig (bewust)</div>`
          : `<div class="bi-match-line bi-koppel">🔗 ${eerste ? koppelLabel(eerste) : ""}${extra}</div>` +
            `<div class="bi-status status-${s.kind}">${M().koppelStatusIcoon(s.kind)} ${M().koppelStatusTekst(s)}</div>`;
    } else if (showMatch) {
      const matches = matchesVoorBankRow(r, facturen || recenteFacturen());
      if (matches.length) {
        const m = matches[0];
        const extra = matches.length > 1 ? ` +${matches.length - 1} meer` : "";
        const nr = m.factuurnummer ? ` · ${escapeHtml(m.factuurnummer)}` : "";
        li.classList.add("has-match");
        matchHtml = `<div class="bi-match-line">⚡ ${escapeHtml(m.boek)}: ${escapeHtml(m.partij)}${nr} · ${m.datumStr}${extra}</div>`;
      }
    }
    li.innerHTML = `
      <div class="bi-head">
        <span class="bi-title">${rekDot(r.rekening)}${escapeHtml(r.omschrijving || "(geen omschrijving)")}</span>
        ${bedragHtml}
      </div>
      <div class="bi-sub">
        <span>${r.datumStr}${r.ingeboekt ? " · ✓ ingeboekt" : ""}</span>
        <span>saldo ${M().fmtEur(r.saldo)}</span>
      </div>
      ${matchHtml}
      ${App().rowActionsHtml({ link: true })}`;
    li.addEventListener("click", (ev) => {
      if (ev.target.closest("button")) return;
      openModal(r);
    });
    li.querySelector('[data-act="link"]').addEventListener("click", (ev) => {
      ev.stopPropagation();
      global.BoekKoppel?.openBankregel(r);
    });
    li.querySelector('[data-act="edit"]').addEventListener("click", () => openModal(r));
    li.querySelector('[data-act="del"]').addEventListener("click", () => deleteRow(r));
    App().bindSwipe(li, { onEdit: () => openModal(r), onDelete: () => deleteRow(r) });
    return li;
  }

  /**
   * Alle regels met precies één gevonden factuur in één keer koppelen én
   * afvinken. De koppeling legt vast wélke factuur erbij hoort, zodat dezelfde
   * factuur nooit twee keer afgevinkt kan worden.
   */
  async function markeerAlleMatches() {
    if (!gematchteRijen.length) return;
    const facturen = recenteFacturen();
    const items = [];
    const regels = [];
    const geclaimd = new Set();
    for (const r of gematchteRijen) {
      const ms = matchesVoorBankRow(r, facturen).filter(
        (f) => !geclaimd.has(`${f.boek}|${f.excelRow}`)
      );
      if (ms.length !== 1) continue; // ambigu → handmatig via de regel zelf
      const f = ms[0];
      geclaimd.add(`${f.boek}|${f.excelRow}`);
      items.push({
        excelRow: r.excelRow,
        waarde: M().koppelWaarde(
          f.boek.toLowerCase() === "verkoop" ? "V" : "I",
          f,
          App().state.inkoopRows,
          App().state.verkoopRows
        ),
        ingeboekt: true,
      });
      regels.push(`• ${r.datumStr} ${r.omschrijving} → ${f.partij}`);
    }
    if (!items.length) {
      return App().showToast("Alleen regels met meerdere kandidaten — koppel die per regel.", true);
    }
    const rest = regels.length > 4 ? `\n… en nog ${regels.length - 4}` : "";
    const ok = await App().showConfirm(
      `${items.length} bankregel${items.length === 1 ? "" : "s"} koppelen en afvinken?\n${regels.slice(0, 4).join("\n")}${rest}`,
      "Koppelen",
      "Annuleren"
    );
    if (!ok) return;
    await App().persistMutation(
      { kind: "bank_koppel", items },
      { successMsg: `${items.length} bankregel${items.length === 1 ? "" : "s"} gekoppeld en afgevinkt` }
    );
  }

  async function deleteRow(r) {
    const bedrag = r.in != null ? `+ ${M().fmtEur(r.in)}` : `− ${M().fmtEur(r.uit)}`;
    const ok = await App().showConfirm(
      `Bankregel verwijderen?\n${r.datumStr} · ${r.omschrijving} · ${bedrag}`,
      "Verwijderen",
      "Annuleren"
    );
    if (!ok) return;
    if (modalRowNr === r.excelRow) closeModal();
    await App().persistMutation(
      { kind: "bank_delete", excelRow: r.excelRow },
      { successMsg: "Bankregel verwijderd" }
    );
  }

  // === Lijst ===

  /**
   * Voldoet een regel aan het gekozen statusfilter? De drie knoppen sluiten
   * elkaar uit: "Open" is nog te doen, "Zonder factuur" is al ingeboekt maar
   * bewust of noodgedwongen zonder factuur (de jaaropgaaf-gevallen), en
   * "Controle" zijn de koppelingen die niet kloppen.
   */
  function pastBijStatus(r) {
    if (statusFilter === "alles") return true;
    if (statusFilter === "open") return !r.ingeboekt;
    const s = statusVan(r);
    if (statusFilter === "controle") return M().KOPPEL_PROBLEEM.has(s.kind);
    if (statusFilter === "los") return r.ingeboekt && (s.kind === "geen" || s.kind === "geenNodig");
    return true;
  }

  function render() {
    const st = App().state;
    const filled = st.bankRows.filter((r) => !r.isEmpty);

    const saldi = M().saldiPerRekening(st.bankRows);
    $("#bank-saldo-rabo").textContent = st.loaded ? M().fmtEur(saldi.Rabo) : "—";
    $("#bank-saldo-knab").textContent = st.loaded ? M().fmtEur(saldi.Knab) : "—";
    $("#bank-open-count").textContent = String(filled.filter((r) => !r.ingeboekt).length);

    // BTW-reservering: wat er van het saldo eigenlijk opzij staat voor de aangifte.
    const potjeEl = $("#bank-btw-potje");
    if (potjeEl && st.loaded) {
      const nu = new Date();
      const kw = M().btwAangifte(st.inkoopRows, st.verkoopRows, nu.getFullYear());
      const s = kw[Math.floor(nu.getMonth() / 3)];
      potjeEl.classList.toggle("hidden", !(s && s.saldo > 0.005));
      if (s && s.saldo > 0.005) {
        potjeEl.textContent = `waarvan ± ${M().fmtEur(s.saldo)} BTW-reservering voor ${s.q}`;
      }
    }
    const zonder = $("#bank-zonder-rek");
    zonder.classList.toggle("hidden", !saldi.zonderRekening);
    if (saldi.zonderRekening) {
      zonder.textContent = `⚠ ${saldi.zonderRekening} regel${saldi.zonderRekening === 1 ? "" : "s"} zonder rekening — tik erop en kies Rabo of Knab.`;
    }

    bouwKopIndex();
    const facturen = recenteFacturen();

    // Tellers op de filterknoppen: meteen zien of er iets te controleren valt.
    const nOpen = filled.filter((r) => !r.ingeboekt).length;
    const nControle = filled.filter((r) => M().KOPPEL_PROBLEEM.has(statusVan(r).kind)).length;
    const nLos = filled.filter(
      (r) => r.ingeboekt && ["geen", "geenNodig"].includes(statusVan(r).kind)
    ).length;
    zetTeller("open", nOpen);
    zetTeller("controle", nControle);
    zetTeller("los", nLos);
    zetTeller("alles", filled.length);

    const zoekterm = ($("#bank-zoek")?.value || "").trim().toLowerCase();
    const zichtbaar = (r) => filter === "Alles" || r.rekening === filter;
    const zoekt = (r) =>
      !zoekterm ||
      `${r.omschrijving} ${r.opmerking} ${r.koppelingRaw} ${r.datumStr} ${r.in ?? ""} ${r.uit ?? ""}`
        .toLowerCase()
        .replace(/\./g, ",")
        .includes(zoekterm.replace(/\./g, ","));

    const selectie = filled.filter((r) => zichtbaar(r) && pastBijStatus(r) && zoekt(r)).reverse();

    const lijst = $("#bank-lijst");
    lijst.innerHTML = "";
    gematchteRijen = [];
    for (const r of selectie.slice(0, toonAantal)) {
      const li = rowLine(r, { showMatch: statusFilter !== "alles", facturen });
      if (li.classList.contains("has-match")) gematchteRijen.push(r);
      lijst.appendChild(li);
    }
    if (!lijst.children.length) {
      lijst.innerHTML = `<li class="sub">${
        zoekterm
          ? "Niets gevonden."
          : statusFilter === "open"
            ? "Alles is ingeboekt 🎉"
            : statusFilter === "controle"
              ? "Alle koppelingen kloppen ✓"
              : "Geen regels in deze selectie."
      }</li>`;
    }
    const meer = $("#btn-bank-meer");
    meer.classList.toggle("hidden", selectie.length <= toonAantal);
    meer.textContent = `Toon meer (${selectie.length - toonAantal} resterend)`;

    // "Alles afvinken" alleen zinvol in de openstaande lijst
    const knop = $("#btn-bank-match-all");
    knop.classList.toggle("hidden", gematchteRijen.length === 0 || statusFilter !== "open");
    if (gematchteRijen.length) {
      knop.textContent =
        gematchteRijen.length === 1
          ? "✓ 1 regel met factuur koppelen en afvinken"
          : `✓ Alle ${gematchteRijen.length} regels met factuur koppelen en afvinken`;
    }
    updateNewRowMatchHint();
    if (modalRowNr != null) renderModal(false);
  }

  function zetTeller(naam, n) {
    const el = document.querySelector(`#bank-status-filter .chip[data-s="${naam}"] .chip-n`);
    if (el) el.textContent = n ? String(n) : "";
  }

  // === Nieuwe bankregel ===
  function newRowFields() {
    return {
      datumIso: $("#bank-datum").value,
      omschrijving: $("#bank-omschrijving").value.trim(),
      in: M().parseUserAmount($("#bank-in").value),
      uit: M().parseUserAmount($("#bank-uit").value),
      opmerking: $("#bank-opmerking").value.trim(),
      rekening: getSwitch("bank-rek-switch"),
    };
  }

  function updateNewRowMatchHint() {
    const el = $("#bank-new-match");
    if (!el) return;
    const f = newRowFields();
    const bedrag = f.uit != null ? f.uit : f.in;
    if (bedrag == null || !f.datumIso) {
      el.classList.add("hidden");
      return;
    }
    const matches = matchesVoorBankRow(
      { datum: M().isoToDate(f.datumIso), in: f.in, uit: f.uit },
      recenteFacturen()
    );
    el.classList.toggle("hidden", !matches.length);
    if (matches.length) {
      const first = matches[0];
      el.textContent = `⚡ Match: ${first.boek} ${first.partij} — ${M().fmtEur(first.bedrag)} (${first.datumStr})`;
    }
  }

  function clearNewRow() {
    $("#bank-omschrijving").value = "";
    $("#bank-in").value = "";
    $("#bank-uit").value = "";
    $("#bank-opmerking").value = "";
    updateNewRowMatchHint();
  }

  async function saveNewRow() {
    const f = newRowFields();
    if (!f.rekening) return App().showToast("Kies een rekening (Rabo of Knab).", true);
    if (!f.datumIso) return App().showToast("Vul een datum in.", true);
    if (!f.omschrijving) return App().showToast("Vul een omschrijving in.", true);
    if (f.in == null && f.uit == null) {
      return App().showToast("Vul In en/of Uit in.", true);
    }
    try {
      localStorage.setItem(REK_KEY, f.rekening);
    } catch (_) {}
    const matches = matchesVoorBankRow(
      { datum: M().isoToDate(f.datumIso), in: f.in, uit: f.uit },
      recenteFacturen()
    );
    if (matches.length === 1) {
      const m0 = matches[0];
      const ja = await App().showConfirm(
        `Er is een matchende factuur (${m0.boek}: ${m0.partij}, ${M().fmtEur(m0.bedrag)}). Direct koppelen en als ingeboekt markeren?`,
        "Ja, koppel",
        "Nee"
      );
      if (ja) {
        f.ingeboekt = true;
        f.koppeling = M().koppelWaarde(
          m0.boek.toLowerCase() === "verkoop" ? "V" : "I",
          m0,
          App().state.inkoopRows,
          App().state.verkoopRows
        );
      }
    }
    const snapshot = { ...f };
    clearNewRow();
    const ok = await App().persistMutation(
      { kind: "bank_add", fields: f },
      { successMsg: "Bankregel opgeslagen" }
    );
    if (!ok) {
      // formulier herstellen zodat er niets kwijtraakt
      $("#bank-datum").value = snapshot.datumIso;
      $("#bank-omschrijving").value = snapshot.omschrijving;
      $("#bank-in").value = snapshot.in != null ? M().fmtAmountInput(snapshot.in) : "";
      $("#bank-uit").value = snapshot.uit != null ? M().fmtAmountInput(snapshot.uit) : "";
      $("#bank-opmerking").value = snapshot.opmerking;
    }
  }

  // === Detailscherm ===
  // Blijft na koppelen/afvinken open en tekent zichzelf opnieuw, zodat je het
  // resultaat direct ziet in plaats van de lijst opnieuw te moeten openen.

  function modalRow() {
    if (modalRowNr == null) return null;
    return App().state.bankRows.find((r) => !r.isEmpty && r.excelRow === modalRowNr) || null;
  }

  function openModal(r) {
    modalRowNr = r.excelRow;
    renderModal(true);
    $("#bank-modal").classList.remove("hidden");
  }

  /** velden=true → ook de invoervelden vullen (alleen bij openen). */
  function renderModal(velden) {
    const r = modalRow();
    if (!r) return closeModal();
    bouwKopIndex();
    const s = statusVan(r);

    $("#bank-modal-title").textContent = `Bankregel ${r.datumStr}`;
    const info = $("#bank-modal-info");
    const bedrag = r.in != null ? `+ ${M().fmtEur(r.in)}` : `− ${M().fmtEur(r.uit)}`;
    info.textContent =
      `${bedrag} · saldo ${M().fmtEur(r.saldo)}` +
      (r.ingeboekt ? " · ✓ ingeboekt" : " · nog niet ingeboekt");
    const statusEl = $("#bank-m-status");
    statusEl.className = `bank-m-status status-${s.kind}`;
    statusEl.textContent = `${M().koppelStatusIcoon(s.kind)} ${M().koppelStatusTekst(s)}`;

    if (velden) {
      $("#bank-m-omschrijving").value = r.omschrijving;
      $("#bank-m-in").value = r.in != null ? M().fmtAmountInput(r.in) : "";
      $("#bank-m-uit").value = r.uit != null ? M().fmtAmountInput(r.uit) : "";
      $("#bank-m-opmerking").value = r.opmerking;
      setSwitch("bank-m-rek-switch", r.rekening);
    }
    $("#btn-bank-m-ingeboekt").textContent = r.ingeboekt ? "↩ Niet ingeboekt" : "✓ Ingeboekt";

    // Koppelen zelf zit in de koppelpopup (ketting-icoon); hier alleen de
    // stand van zaken en een knop ernaartoe, zodat dit scherm over de
    // bankregel zelf gaat.
    const knopKoppel = $("#btn-bank-m-koppel");
    const n = (s.koppelingen || []).filter((k) => k.token !== "-").length;
    knopKoppel.textContent = n ? `🔗 Koppelingen (${n})` : "🔗 Koppelen";
  }

  /** Open de modal voor een specifieke Excel-rij (vanuit andere schermen). */
  function openByExcelRow(excelRow) {
    const r = App().state.bankRows.find((x) => !x.isEmpty && x.excelRow === excelRow);
    if (r) openModal(r);
  }

  /** Spring naar deze regel in de lijst (filter zo nodig verruimen). */
  function toonInLijst(excelRow) {
    const r = App().state.bankRows.find((x) => !x.isEmpty && x.excelRow === excelRow);
    if (!r) return;
    if (!pastBijStatus(r)) zetStatusFilter("alles");
    render();
  }

  function closeModal() {
    $("#bank-modal").classList.add("hidden");
    modalRowNr = null;
  }

  async function modalSave() {
    const r = modalRow();
    if (!r) return;
    const inVal = M().parseUserAmount($("#bank-m-in").value);
    const uitVal = M().parseUserAmount($("#bank-m-uit").value);
    if (inVal == null && uitVal == null) {
      return App().showToast("Vul In en/of Uit in.", true);
    }
    const fields = {
      omschrijving: $("#bank-m-omschrijving").value.trim(),
      opmerking: $("#bank-m-opmerking").value.trim(),
      rekening: getSwitch("bank-m-rek-switch") || null,
      updateAmounts: inVal !== r.in || uitVal !== r.uit,
      in: inVal,
      uit: uitVal,
    };
    const row = r.excelRow;
    closeModal();
    await App().persistMutation(
      { kind: "bank_update", excelRow: row, fields },
      { successMsg: "Bankregel bijgewerkt" }
    );
  }

  async function modalToggleIngeboekt() {
    const r = modalRow();
    if (!r) return;
    const newValue = !r.ingeboekt;
    await App().persistMutation(
      { kind: "bank_ingeboekt", rows: [r.excelRow], value: newValue },
      { successMsg: newValue ? "Gemarkeerd als ingeboekt" : "Markering verwijderd" }
    );
  }

  function modalNaarBoek(isVerkoop) {
    const r = modalRow();
    if (!r) return;
    closeModal();
    const prefill = {
      datumIso: r.datum ? M().dateToIso(r.datum) : M().todayIso(),
      omschrijving: r.omschrijving,
      bedrag: isVerkoop ? (r.in != null ? r.in : r.uit) : (r.uit != null ? r.uit : r.in),
      bankRows: [r.excelRow],
    };
    if (isVerkoop) {
      global.BoekUiVerkoop?.prefill(prefill);
      App().switchTab("verkoop");
    } else {
      global.BoekUiInkoop?.prefill(prefill);
      App().switchTab("inkoop");
    }
  }

  function zetStatusFilter(naam) {
    statusFilter = naam;
    toonAantal = 40;
    try {
      localStorage.setItem(STATUS_KEY, naam);
    } catch (_) {}
    document.querySelectorAll("#bank-status-filter .chip").forEach((c) =>
      c.classList.toggle("active", c.dataset.s === naam)
    );
  }

  function init() {
    $("#bank-datum").value = M().todayIso();
    setSwitch("bank-rek-switch", nieuweRekening());
    bindSwitch("bank-rek-switch");
    bindSwitch("bank-m-rek-switch");
    document.querySelectorAll("#bank-filter .chip:not(.chip-dagen)").forEach((c) => {
      c.addEventListener("click", () => {
        filter = c.dataset.f;
        toonAantal = 40;
        document.querySelectorAll("#bank-filter .chip:not(.chip-dagen)").forEach((x) =>
          x.classList.toggle("active", x === c)
        );
        render();
      });
    });
    document.querySelectorAll("#bank-status-filter .chip").forEach((c) => {
      c.addEventListener("click", () => {
        zetStatusFilter(c.dataset.s);
        App().haptic(10);
        render();
      });
    });
    zetStatusFilter(bewaardStatusFilter());
    const zetDagenChips = () => {
      document.querySelectorAll("#bank-filter .chip-dagen").forEach((c) =>
        c.classList.toggle("active", +c.dataset.dagen === App().state.matchDagen)
      );
    };
    document.querySelectorAll("#bank-filter .chip-dagen").forEach((c) => {
      c.addEventListener("click", () => {
        App().setMatchDagen(+c.dataset.dagen);
        zetDagenChips();
        render();
        global.BoekUiInkoop?.render();
        global.BoekUiVerkoop?.render();
      });
    });
    zetDagenChips();
    App().bindDateSteppers("bank-datum", "btn-bank-date-prev", "btn-bank-date-next", updateNewRowMatchHint);
    global.BoekCombo.createCombo(
      "bank-omschrijving",
      null,
      recenteOmschrijvingen,
      null,
      { title: "Recente omschrijvingen" }
    );
    $("#btn-bank-save").addEventListener("click", saveNewRow);
    $("#btn-bank-clear").addEventListener("click", clearNewRow);
    for (const id of ["bank-datum", "bank-in", "bank-uit"]) {
      document.getElementById(id).addEventListener("input", updateNewRowMatchHint);
      document.getElementById(id).addEventListener("change", updateNewRowMatchHint);
    }
    $("#btn-bank-match-all").addEventListener("click", markeerAlleMatches);
    $("#bank-zoek").addEventListener("input", () => {
      toonAantal = 40;
      render();
    });
    $("#btn-bank-meer").addEventListener("click", () => {
      toonAantal += 40;
      render();
    });
    $("#btn-bank-m-save").addEventListener("click", modalSave);
    $("#btn-bank-m-koppel").addEventListener("click", () => {
      const r = modalRow();
      closeModal();
      if (r) global.BoekKoppel?.openBankregel(r);
    });
    $("#btn-bank-m-ingeboekt").addEventListener("click", modalToggleIngeboekt);
    $("#btn-bank-m-naar-inkoop").addEventListener("click", () => modalNaarBoek(false));
    $("#btn-bank-m-naar-verkoop").addEventListener("click", () => modalNaarBoek(true));
    $("#btn-bank-m-delete").addEventListener("click", () => {
      const r = modalRow();
      if (r) deleteRow(r);
    });
    $("#btn-bank-m-sluit").addEventListener("click", closeModal);
    $("#bank-modal .modal-backdrop").addEventListener("click", closeModal);
  }

  App().registerTab("bank", { init, render });
  global.BoekUiBank = { render, openByExcelRow, toonInLijst };
})(window);
