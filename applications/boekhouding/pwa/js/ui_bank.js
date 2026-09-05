/**
 * Bankboek-tab: openstaande regels, nieuwe regel, bewerken/matchen/ingeboekt markeren.
 */
(function (global) {
  const App = () => global.BoekApp;
  const M = () => global.BoekModel;
  const $ = (s) => document.querySelector(s);

  let modalRow = null; // geselecteerde bankregel in de modal
  let gematchteRijen = []; // openstaande regels waarvoor een factuur gevonden is
  let filter = "Alles"; // Alles | Rabo | Knab

  const REK_KEY = "boek_laatste_rekening";

  function nieuweRekening() {
    try {
      const v = localStorage.getItem(REK_KEY);
      if (v === "Rabo" || v === "Knab") return v;
    } catch (_) {}
    return "Knab";
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

  function matchesVoorBankRow(r, facturen) {
    return M().invoiceMatchesForBankRow(facturen, r, kopIndex, App().state.matchDagen);
  }

  /** Korte weergave van een koppeling: partij + factuurnummer + bedrag + datum. */
  function koppelLabel(k) {
    if (k.token === "-") return "geen factuur (bewust)";
    if (k.row) {
      const nr = k.row.factuurnummer ? ` · ${escapeHtml(k.row.factuurnummer)}` : "";
      return `${escapeHtml(k.row.partij)}${nr} · ${M().fmtEur(k.row.bedrag)} · ${k.row.datumStr}`;
    }
    return `${escapeHtml(k.token)} (niet gevonden)`;
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

  /** facturen wordt door render() eenmalig meegegeven; scheelt werk per regel. */
  function rowLine(r, { showMatch = false, facturen = null } = {}) {
    const li = document.createElement("li");
    li.className = "boek-item";
    const bedragHtml =
      r.in != null
        ? `<span class="bi-amount in">+ ${M().fmtEur(r.in)}</span>`
        : `<span class="bi-amount uit">− ${M().fmtEur(r.uit)}</span>`;

    // Koppeling of match meteen uitschrijven, zodat je zonder tikken ziet wat erbij hoort.
    let matchHtml = "";
    if (r.koppelingRaw) {
      const ks = M().parseKoppelingen(r.koppelingRaw, App().state.inkoopRows, App().state.verkoopRows);
      const eerste = ks[0];
      const extra = ks.length > 1 ? ` +${ks.length - 1}` : "";
      matchHtml = `<div class="bi-match-line bi-koppel">🔗 ${eerste ? koppelLabel(eerste) : ""}${extra}</div>`;
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
      ${App().rowActionsHtml()}`;
    li.addEventListener("click", (ev) => {
      if (ev.target.closest("button")) return;
      openModal(r);
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
    if (modalRow?.excelRow === r.excelRow) closeModal();
    await App().persistMutation(
      { kind: "bank_delete", excelRow: r.excelRow },
      { successMsg: "Bankregel verwijderd" }
    );
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function render() {
    const st = App().state;
    const filled = st.bankRows.filter((r) => !r.isEmpty);
    const zichtbaar = (r) => filter === "Alles" || r.rekening === filter;
    const open = filled.filter((r) => !r.ingeboekt);

    const saldi = M().saldiPerRekening(st.bankRows);
    $("#bank-saldo-rabo").textContent = st.loaded ? M().fmtEur(saldi.Rabo) : "—";
    $("#bank-saldo-knab").textContent = st.loaded ? M().fmtEur(saldi.Knab) : "—";
    $("#bank-open-count").textContent = String(open.length);
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
    const openList = $("#bank-open-list");
    openList.innerHTML = "";
    gematchteRijen = [];
    for (const r of open.filter(zichtbaar).slice().reverse().slice(0, 50)) {
      const li = rowLine(r, { showMatch: true, facturen });
      if (li.classList.contains("has-match")) gematchteRijen.push(r);
      openList.appendChild(li);
    }
    if (!openList.children.length) {
      openList.innerHTML = '<li class="sub">Alles is ingeboekt 🎉</li>';
    }
    const knop = $("#btn-bank-match-all");
    knop.classList.toggle("hidden", gematchteRijen.length === 0);
    if (gematchteRijen.length) {
      knop.textContent =
        gematchteRijen.length === 1
          ? "✓ 1 regel met factuur ingeboekt markeren"
          : `✓ Alle ${gematchteRijen.length} regels met factuur ingeboekt markeren`;
    }

    // Zoekveld doorzoekt álle bankregels (omschrijving, opmerking, koppeling, bedrag);
    // zonder zoekterm: de laatste 8.
    const recentList = $("#bank-recent-list");
    recentList.innerHTML = "";
    const zoekterm = ($("#bank-zoek")?.value || "").trim().toLowerCase();
    let tonen;
    if (zoekterm) {
      tonen = filled
        .filter(zichtbaar)
        .filter((r) =>
          `${r.omschrijving} ${r.opmerking} ${r.koppelingRaw} ${r.datumStr} ${r.in ?? ""} ${r.uit ?? ""}`
            .toLowerCase()
            .replace(/\./g, ",")
            .includes(zoekterm.replace(/\./g, ","))
        )
        .slice(-20)
        .reverse();
    } else {
      tonen = filled.filter(zichtbaar).slice(-8).reverse();
    }
    for (const r of tonen) {
      recentList.appendChild(rowLine(r));
    }
    if (zoekterm && !tonen.length) {
      recentList.innerHTML = '<li class="sub">Niets gevonden.</li>';
    }
    updateNewRowMatchHint();
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

  // === Modal ===
  function openModal(r) {
    modalRow = r;
    $("#bank-modal-title").textContent = `Bankregel ${r.datumStr}`;
    $("#bank-modal-info").textContent = `Saldo na deze regel: ${M().fmtEur(r.saldo)}${
      r.ingeboekt ? " · al ingeboekt" : ""
    }`;
    $("#bank-m-omschrijving").value = r.omschrijving;
    $("#bank-m-in").value = r.in != null ? M().fmtAmountInput(r.in) : "";
    $("#bank-m-uit").value = r.uit != null ? M().fmtAmountInput(r.uit) : "";
    $("#bank-m-opmerking").value = r.opmerking;
    setSwitch("bank-m-rek-switch", r.rekening);
    $("#btn-bank-m-ingeboekt").textContent = r.ingeboekt
      ? "Markeer als NIET ingeboekt"
      : "Markeer ingeboekt";

    // Bestaande koppeling
    bouwKopIndex();
    const kopWrap = $("#bank-m-koppeling-wrap");
    const kopList = $("#bank-m-koppeling");
    kopList.innerHTML = "";
    const koppelingen = r.koppelingRaw
      ? M().parseKoppelingen(r.koppelingRaw, App().state.inkoopRows, App().state.verkoopRows)
      : [];
    kopWrap.classList.toggle("hidden", !koppelingen.length);
    for (const k of koppelingen) {
      const li = document.createElement("li");
      li.className = "boek-item";
      li.innerHTML = `
        <div class="bi-head">
          <span class="bi-title bi-koppel">🔗 ${koppelLabel(k)}</span>
        </div>
        <span class="row-actions">
          <button type="button" class="btn-icon btn-icon-danger" aria-label="Ontkoppelen" title="Ontkoppelen">✕</button>
        </span>`;
      li.querySelector("button").addEventListener("click", async () => {
        const ok = await App().showConfirm("Koppeling weghalen?", "Ontkoppelen", "Annuleren");
        if (!ok) return;
        closeModal();
        await App().persistMutation(
          { kind: "bank_ontkoppel", excelRow: r.excelRow },
          { successMsg: "Ontkoppeld" }
        );
      });
      kopList.appendChild(li);
    }

    // Koppel-sectie: multi-select met som — één afschrijving kan meerdere
    // facturen dekken (bijv. Amazon). Zoekveld doorzoekt álle ongekoppelde facturen.
    koppelSelectie = new Map();
    koppelUitgeklapt = false;
    $("#bank-m-koppel-zoek").value = "";
    $("#btn-bank-m-geen").classList.toggle("hidden", !!koppelingen.length);
    renderKoppelSectie();
    $("#bank-modal").classList.remove("hidden");
  }

  let koppelSelectie = new Map(); // "Boek|excelRow" → factuur
  let koppelUitgeklapt = false; // al gekoppeld → sectie ingeklapt achter "+ nog een factuur"

  function bankBedrag(r) {
    return r.in != null ? r.in : r.uit;
  }

  /**
   * Bedrag dat al gedekt is door bestaande koppelingen van deze regel.
   * Tegenrichting telt negatief: een fee-factuur (inkoop) op een uitbetaling
   * (bank-in) verlaagt het gedekte bedrag — netto klopt het dan precies.
   */
  function gekoppeldBedrag(r) {
    if (!r.koppelingRaw) return 0;
    const st = App().state;
    const hoofd = r.in != null ? "verkoop" : "inkoop";
    return M()
      .parseKoppelingen(r.koppelingRaw, st.inkoopRows, st.verkoopRows)
      .reduce((s, k) => s + (k.row ? (k.boek === hoofd ? 1 : -1) * k.row.bedrag : 0), 0);
  }

  function renderKoppelSectie() {
    const r = modalRow;
    if (!r) return;
    const st = App().state;
    const wrap = $("#bank-m-matches-wrap");
    const list = $("#bank-m-matches");
    const bedrag = bankBedrag(r);
    if (bedrag == null) {
      wrap.classList.add("hidden");
      return;
    }
    // Al gekoppeld → sectie inklappen; via "+ nog een factuur" alsnog uitklappen
    // (één bankregel kan meerdere facturen dekken).
    const uitleg = $("#bank-m-koppel-uitleg");
    const zoekEl = $("#bank-m-koppel-zoek");
    if (r.koppelingRaw && !koppelUitgeklapt) {
      wrap.classList.remove("hidden");
      uitleg.classList.add("hidden");
      zoekEl.classList.add("hidden");
      $("#bank-m-som").classList.add("hidden");
      $("#btn-bank-m-koppel").classList.add("hidden");
      list.innerHTML = '<li class="sub koppel-meer">＋ Nog een factuur koppelen…</li>';
      list.querySelector(".koppel-meer").addEventListener("click", () => {
        koppelUitgeklapt = true;
        renderKoppelSectie();
      });
      return;
    }
    uitleg.classList.remove("hidden");
    zoekEl.classList.remove("hidden");
    $("#btn-bank-m-koppel").classList.remove("hidden");
    const zoek = zoekEl.value;
    const kandidaten = M().koppelKandidaten(r, st.inkoopRows, st.verkoopRows, dekkingMap, st.matchDagen, zoek);
    const rest = Math.round((bedrag - gekoppeldBedrag(r)) * 100) / 100;
    // Suggestie vooraf aanvinken: kleinste combinatie die het bedrag precies dekt.
    if (!zoek && !koppelSelectie.size && !r.koppelingRaw) {
      const combi = M().vindCombinatie(kandidaten, rest);
      if (combi) for (const f of combi) koppelSelectie.set(`${f.boek}|${f.excelRow}`, f);
    }
    wrap.classList.remove("hidden");
    list.innerHTML = "";
    for (const f of kandidaten.slice(0, zoek ? 12 : 8)) {
      const key = `${f.boek}|${f.excelRow}`;
      const sel = koppelSelectie.has(key);
      const tegen = (f.teken || 1) < 0;
      const li = document.createElement("li");
      li.className = "boek-item koppel-kandidaat" + (sel ? " selected" : "");
      const nr = f.factuurnummer ? ` · ${escapeHtml(f.factuurnummer)}` : "";
      const deels = f.deels ? ` · deels betaald, nog ${M().fmtEur(f.rest)} van ${M().fmtEur(f.bedrag)}` : "";
      li.innerHTML = `
        <div class="bi-head">
          <span class="bi-title"><span class="koppel-check">${sel ? "☑" : "☐"}</span> ${escapeHtml(f.partij)}${nr}</span>
          <span class="bi-amount${tegen ? " uit" : ""}">${tegen ? "− " : ""}${M().fmtEur(f.rest != null ? f.rest : f.bedrag)}</span>
        </div>
        <div class="bi-sub"><span>${escapeHtml(f.boek)}${tegen ? " (verrekend)" : ""}${deels} · ${escapeHtml((f.omschrijving || "").slice(0, 40))}</span><span>${f.datumStr}</span></div>`;
      li.addEventListener("click", () => {
        if (koppelSelectie.has(key)) koppelSelectie.delete(key);
        else koppelSelectie.set(key, f);
        App().haptic(10);
        renderKoppelSectie();
      });
      list.appendChild(li);
    }
    if (!list.children.length) {
      list.innerHTML = `<li class="sub">${
        zoek
          ? "Niets gevonden."
          : `Geen kandidaten binnen ±${st.matchDagen} dagen — zoek hierboven op naam of factuurnummer.`
      }</li>`;
    }
    const som = [...koppelSelectie.values()].reduce(
      (s, f) => s + (f.teken || 1) * (f.rest != null ? f.rest : f.bedrag),
      0
    );
    const somEl = $("#bank-m-som");
    const knop = $("#btn-bank-m-koppel");
    somEl.classList.toggle("hidden", !koppelSelectie.size);
    if (koppelSelectie.size) {
      const klopt = Math.abs(som - rest) < 0.005;
      somEl.textContent = `${koppelSelectie.size} geselecteerd · ${M().fmtEur(som)} van ${M().fmtEur(rest)} ${klopt ? "✓ dekt precies" : "⚠ wijkt af"}`;
      somEl.classList.toggle("som-ok", klopt);
      somEl.classList.toggle("som-af", !klopt);
    }
    knop.disabled = !koppelSelectie.size;
    knop.textContent =
      koppelSelectie.size > 1 ? `Koppel ${koppelSelectie.size} facturen` : "Koppel";
  }

  async function modalKoppel() {
    if (!modalRow || !koppelSelectie.size) return;
    const r = modalRow;
    const st = App().state;
    const sel = [...koppelSelectie.values()];
    const som = sel.reduce((s, f) => s + (f.teken || 1) * (f.rest != null ? f.rest : f.bedrag), 0);
    const rest = Math.round(((bankBedrag(r) || 0) - gekoppeldBedrag(r)) * 100) / 100;
    if (Math.abs(som - rest) >= 0.005) {
      const ok = await App().showConfirm(
        `Som van de selectie (${M().fmtEur(som)}) wijkt af van het bankbedrag (${M().fmtEur(rest)}). Toch koppelen?`,
        "Toch koppelen",
        "Annuleren"
      );
      if (!ok) return;
    }
    const waarde = sel
      .map((f) =>
        M().koppelWaarde(f.boek.toLowerCase() === "verkoop" ? "V" : "I", f, st.inkoopRows, st.verkoopRows)
      )
      .join(", ");
    closeModal();
    await App().persistMutation(
      { kind: "bank_koppel", items: [{ excelRow: r.excelRow, waarde, ingeboekt: true }] },
      { successMsg: sel.length > 1 ? `${sel.length} facturen gekoppeld` : `Gekoppeld aan ${sel[0].partij}` }
    );
  }

  /** Bewust géén factuur bij deze regel (bankkosten, privé, overboeking): "-" in kolom I. */
  async function modalGeenFactuur() {
    if (!modalRow) return;
    const r = modalRow;
    closeModal();
    await App().persistMutation(
      { kind: "bank_koppel", items: [{ excelRow: r.excelRow, waarde: "-", ingeboekt: true }] },
      { successMsg: "Gemarkeerd: geen factuur nodig" }
    );
  }

  /** Open de modal voor een specifieke Excel-rij (vanuit Overzicht → Koppelingscontrole). */
  function openByExcelRow(excelRow) {
    const r = App().state.bankRows.find((x) => !x.isEmpty && x.excelRow === excelRow);
    if (r) openModal(r);
  }

  function closeModal() {
    $("#bank-modal").classList.add("hidden");
    modalRow = null;
  }

  async function modalSave() {
    if (!modalRow) return;
    const inVal = M().parseUserAmount($("#bank-m-in").value);
    const uitVal = M().parseUserAmount($("#bank-m-uit").value);
    if (inVal == null && uitVal == null) {
      return App().showToast("Vul In en/of Uit in.", true);
    }
    const fields = {
      omschrijving: $("#bank-m-omschrijving").value.trim(),
      opmerking: $("#bank-m-opmerking").value.trim(),
      rekening: getSwitch("bank-m-rek-switch") || null,
      updateAmounts: inVal !== modalRow.in || uitVal !== modalRow.uit,
      in: inVal,
      uit: uitVal,
    };
    const row = modalRow.excelRow;
    closeModal();
    await App().persistMutation(
      { kind: "bank_update", excelRow: row, fields },
      { successMsg: "Bankregel bijgewerkt" }
    );
  }

  async function modalToggleIngeboekt() {
    if (!modalRow) return;
    const row = modalRow.excelRow;
    const newValue = !modalRow.ingeboekt;
    closeModal();
    await App().persistMutation(
      { kind: "bank_ingeboekt", rows: [row], value: newValue },
      { successMsg: newValue ? "Gemarkeerd als ingeboekt" : "Markering verwijderd" }
    );
  }

  function modalNaarBoek(isVerkoop) {
    if (!modalRow) return;
    const r = modalRow;
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

  function init() {
    $("#bank-datum").value = M().todayIso();
    setSwitch("bank-rek-switch", nieuweRekening());
    bindSwitch("bank-rek-switch");
    bindSwitch("bank-m-rek-switch");
    document.querySelectorAll("#bank-filter .chip:not(.chip-dagen)").forEach((c) => {
      c.addEventListener("click", () => {
        filter = c.dataset.f;
        document.querySelectorAll("#bank-filter .chip:not(.chip-dagen)").forEach((x) =>
          x.classList.toggle("active", x === c)
        );
        render();
      });
    });
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
    $("#bank-zoek").addEventListener("input", render);
    $("#btn-bank-m-save").addEventListener("click", modalSave);
    $("#btn-bank-m-koppel").addEventListener("click", modalKoppel);
    $("#btn-bank-m-geen").addEventListener("click", modalGeenFactuur);
    $("#bank-m-koppel-zoek").addEventListener("input", renderKoppelSectie);
    $("#btn-bank-m-ingeboekt").addEventListener("click", modalToggleIngeboekt);
    $("#btn-bank-m-naar-inkoop").addEventListener("click", () => modalNaarBoek(false));
    $("#btn-bank-m-naar-verkoop").addEventListener("click", () => modalNaarBoek(true));
    $("#btn-bank-m-delete").addEventListener("click", () => {
      if (modalRow) deleteRow(modalRow);
    });
  }

  App().registerTab("bank", { init, render });
  global.BoekUiBank = { render, openByExcelRow };
})(window);
