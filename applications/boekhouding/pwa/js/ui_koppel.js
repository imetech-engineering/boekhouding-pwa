/**
 * Koppelcentrum — één plek waar facturen en bankregels aan elkaar geknoopt en
 * losgemaakt worden. Bereikbaar vanuit het bankboek (bankregel → facturen),
 * vanuit inkoop/verkoop (factuur → bankregels) en vanuit het overzicht.
 *
 * De modal blijft na koppelen/ontkoppelen open en tekent zichzelf opnieuw
 * (registerLiveView), zodat je direct ziet wat er gebeurd is — geen verversen.
 */
(function (global) {
  const App = () => global.BoekApp;
  const M = () => global.BoekModel;
  const $ = (s) => document.querySelector(s);

  let doel = null; // { boek: "inkoop"|"verkoop", excelRow }
  const keuze = new Map(); // excelRow → bankregel (aangevinkte kandidaten)
  let klaarUitgeklapt = false; // volledig gedekt, maar toch nog een bankregel erbij

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function isOpen() {
    return !$("#koppel-modal").classList.contains("hidden");
  }

  /** Verse factuurregel uit de state (na een mutatie is de snapshot verouderd). */
  function huidigeFactuur() {
    if (!doel) return null;
    const rows = doel.boek === "verkoop" ? App().state.verkoopRows : App().state.inkoopRows;
    const r = rows.find((x) => x.excelRow === doel.excelRow);
    return r ? { ...r, boek: doel.boek } : null;
  }

  function dekkingsKaart() {
    const st = App().state;
    return M().factuurDekking(st.bankRows, st.inkoopRows, st.verkoopRows);
  }

  /**
   * Bijdrage van een bankregel aan deze factuur: hoofdrichting positief,
   * terugboeking negatief. Een creditnota draait de kant van de bank om —
   * een negatieve inkoopfactuur krijg je terug (bijschrijving).
   */
  function bankKant(f, b) {
    const wilIn = M().factuurRichting(f.boek, f.bedrag || 0) > 0;
    const plus = wilIn ? b.in : b.uit;
    const min = wilIn ? b.uit : b.in;
    return (plus || 0) - (min || 0);
  }

  /** -1 bij een creditnota: "nog te koppelen" telt dan de andere kant op. */
  function factuurTeken(f) {
    return (f.bedrag || 0) < 0 ? -1 : 1;
  }

  function bedragTekst(b) {
    return b.in != null ? `+ ${M().fmtEur(b.in)}` : `− ${M().fmtEur(b.uit)}`;
  }

  /** Nog te koppelen, altijd positief (ook bij een creditnota). */
  function restBedrag(factuur) {
    const st = M().factuurStatus(factuur, dekkingsKaart());
    return st.kind === "ok" ? 0 : st.open;
  }

  // === Openen / sluiten ===

  function openFactuur(f) {
    if (!f || f.excelRow == null) return;
    doel = {
      boek: String(f.boek || "").toLowerCase() === "verkoop" ? "verkoop" : "inkoop",
      excelRow: f.excelRow,
    };
    keuze.clear();
    klaarUitgeklapt = false;
    $("#koppel-zoek").value = "";
    // Eén exact passende bankregel meteen aanvinken — dan is één tik genoeg.
    const factuur = huidigeFactuur();
    if (factuur) {
      const rest = restBedrag(factuur);
      if (rest >= 0.01) {
        const kand = M().bankKandidatenVoorFactuur(
          { ...factuur, bedrag: rest * factuurTeken(factuur) },
          App().state.bankRows,
          "",
          alGekoppeldeRijen(factuur)
        );
        const exact = kand.filter((b) => b.exact);
        if (exact.length === 1) keuze.set(exact[0].excelRow, exact[0]);
      }
    }
    render();
    $("#koppel-modal").classList.remove("hidden");
  }

  function sluit() {
    $("#koppel-modal").classList.add("hidden");
    doel = null;
    keuze.clear();
  }

  // === Tekenen ===

  function render() {
    if (!doel) return;
    const f = huidigeFactuur();
    if (!f) return sluit();
    const st = App().state;
    const status = M().factuurStatus(f, dekkingsKaart());
    const rest = Math.max(0, status.rest);

    $("#koppel-modal-title").textContent =
      `${f.partij}${f.factuurnummer ? " · " + f.factuurnummer : ""}`;
    const credit = factuurTeken(f) < 0;
    const heel = M().fmtEur(Math.abs(f.bedrag || 0));
    const werkwoord = credit
      ? f.boek === "verkoop" ? "terugbetaald" : "teruggekregen"
      : f.boek === "verkoop" ? "ontvangen" : "betaald";
    const info = $("#koppel-modal-info");
    if (status.kind === "ok") {
      info.textContent = `${heel} · ${f.datumStr} — volledig gekoppeld ✓`;
      info.className = "sub koppel-info ok";
    } else if (status.kind === "deels") {
      info.textContent = `${heel} · ${f.datumStr} — nog ${M().fmtEur(rest)} te koppelen. Tik de bankregel(s) aan:`;
      info.className = "sub koppel-info waarschuwing";
    } else if (status.kind === "teveel") {
      info.textContent = `${heel} · ${f.datumStr} — er hangt ${M().fmtEur(status.open)} téveel aan bankregels ⚠`;
      info.className = "sub koppel-info waarschuwing";
    } else {
      info.textContent =
        `Met welke bankregel(s) is deze ${credit ? "creditnota van " : ""}${heel} ${werkwoord}? ` +
        "Meerdere kan (termijnen, verzamelbetaling):";
      info.className = "sub koppel-info";
    }

    renderGekoppeld(f);

    const zoekEl = $("#koppel-zoek");
    const lijst = $("#koppel-lijst");
    const somEl = $("#koppel-som");
    const knop = $("#btn-koppel-doe");
    // Volledig gedekt: kandidaten pas tonen als je expliciet meer wilt koppelen.
    const dicht = rest < 0.01 && !keuze.size && !zoekEl.value.trim() && !klaarUitgeklapt;
    $("#koppel-meer-wrap").classList.toggle("hidden", !dicht);
    zoekEl.classList.toggle("hidden", dicht);
    lijst.classList.toggle("hidden", dicht);
    knop.classList.toggle("hidden", dicht);
    somEl.classList.toggle("hidden", dicht || !keuze.size);
    if (dicht) {
      lijst.innerHTML = "";
      return;
    }

    const doelBedrag = rest >= 0.01 ? rest : f.bedrag;
    const zoek = zoekEl.value;
    const kandidaten = M().bankKandidatenVoorFactuur(
      { ...f, bedrag: doelBedrag * factuurTeken(f) },
      st.bankRows,
      zoek,
      alGekoppeldeRijen(f)
    );
    lijst.innerHTML = "";
    for (const b of kandidaten.slice(0, zoek ? 15 : 8)) {
      const sel = keuze.has(b.excelRow);
      const li = document.createElement("li");
      li.className = "boek-item koppel-kandidaat" + (sel ? " selected" : "");
      li.innerHTML = `
        <div class="bi-head">
          <span class="bi-title"><span class="koppel-check">${sel ? "☑" : "☐"}</span> ${escapeHtml(b.omschrijving || "(geen omschrijving)")}</span>
          <span class="bi-amount">${bedragTekst(b)}</span>
        </div>
        <div class="bi-sub"><span>${b.datumStr}${b.rekening ? " · " + escapeHtml(b.rekening) : ""}</span><span class="koppel-exact">${b.exact ? "✓ bedrag klopt" : ""}</span></div>`;
      li.addEventListener("click", () => {
        if (keuze.has(b.excelRow)) keuze.delete(b.excelRow);
        else keuze.set(b.excelRow, b);
        App().haptic(10);
        render();
      });
      lijst.appendChild(li);
    }
    if (!lijst.children.length) {
      lijst.innerHTML = `<li class="sub">${
        zoek
          ? "Niets gevonden — probeer een ander woord of bedrag."
          : "Geen passende bankregel gevonden — waarschijnlijk is de betaling nog niet binnen. Zoek hierboven op omschrijving."
      }</li>`;
    }

    const som = [...keuze.values()].reduce((s, b) => s + bankKant(f, b), 0);
    if (keuze.size) {
      // Minder dan het openstaande bedrag: termijn, prima. Meer: er komt geld
      // bij dat niet bij deze factuur hoort.
      const oordeel = M().selectieOordeel(som, doelBedrag, "minder");
      const staart =
        oordeel.kind === "ok"
          ? "✓ dekt precies"
          : oordeel.kind === "deel"
            ? `· termijn, daarna nog ${M().fmtEur(oordeel.verschil)} open`
            : `⚠ ${M().fmtEur(oordeel.verschil)} meer dan er nog openstaat`;
      somEl.textContent = `${keuze.size} geselecteerd · ${M().fmtEur(som)} van ${M().fmtEur(doelBedrag)} ${staart}`;
      somEl.classList.toggle("som-ok", oordeel.kind === "ok");
      somEl.classList.toggle("som-deel", oordeel.kind === "deel");
      somEl.classList.toggle("som-af", oordeel.kind === "af");
    }
    knop.disabled = !keuze.size;
    knop.textContent = keuze.size > 1 ? `Koppel ${keuze.size} bankregels` : "Koppel";
  }

  /** Blok "Al gekoppeld aan": bankregels van deze factuur, elk met ✕. */
  function renderGekoppeld(f) {
    const el = $("#koppel-gekoppeld");
    el.innerHTML = "";
    const regels = gekoppeldeBankregels(f);
    if (!regels.length) return;
    const h = document.createElement("p");
    h.className = "sub";
    h.innerHTML = `<strong>Al gekoppeld aan ${regels.length} bankregel${regels.length === 1 ? "" : "s"}:</strong>`;
    el.appendChild(h);
    el.appendChild(bankregelLijst(f, regels));
  }

  /** Bankregels die al aan deze factuur hangen — die zijn geen kandidaat meer. */
  function alGekoppeldeRijen(f) {
    return new Set(gekoppeldeBankregels(f).map((b) => b.excelRow));
  }

  function gekoppeldeBankregels(f) {
    const st = App().state;
    const index = M().koppelingIndex(st.bankRows, st.inkoopRows, st.verkoopRows);
    return index.get(`${f.boek}|${f.excelRow}`) || [];
  }

  /** Lijstje bankregels met ontkoppel-knop; ook gebruikt in het factuurformulier. */
  function bankregelLijst(f, regels) {
    const ul = document.createElement("ul");
    ul.className = "boek-list";
    for (const b of regels) {
      const li = document.createElement("li");
      li.className = "boek-item";
      li.innerHTML = `
        <div class="bi-head">
          <span class="bi-title bi-koppel">🔗 ${escapeHtml(b.omschrijving || "(geen omschrijving)")}</span>
          <span class="bi-amount">${bedragTekst(b)}</span>
        </div>
        <div class="bi-sub"><span>${b.datumStr}${b.rekening ? " · " + escapeHtml(b.rekening) : ""}</span><span>${b.ingeboekt ? "✓ ingeboekt" : ""}</span></div>
        <span class="row-actions">
          <button type="button" class="btn-icon" data-act="open" aria-label="Bankregel openen" title="Bankregel openen">↗</button>
          <button type="button" class="btn-icon btn-icon-danger" data-act="los" aria-label="Ontkoppelen" title="Ontkoppelen">✕</button>
        </span>`;
      li.querySelector('[data-act="open"]').addEventListener("click", (ev) => {
        ev.stopPropagation();
        sluit();
        App().switchTab("bank");
        global.BoekUiBank?.openByExcelRow(b.excelRow);
      });
      li.querySelector('[data-act="los"]').addEventListener("click", (ev) => {
        ev.stopPropagation();
        ontkoppel(f, b);
      });
      ul.appendChild(li);
    }
    return ul;
  }

  /** Alleen déze factuur van de bankregel halen; andere koppelingen blijven staan. */
  async function ontkoppel(f, b) {
    const st = App().state;
    const ok = await App().showConfirm(
      `Factuur losmaken van bankregel ${b.datumStr} (${M().fmtEur(b.in != null ? b.in : b.uit)})?`,
      "Ontkoppelen",
      "Annuleren"
    );
    if (!ok) return;
    const rest = M()
      .parseKoppelingen(b.koppelingRaw, st.inkoopRows, st.verkoopRows)
      .filter((k) => !(k.boek === f.boek && k.row && k.row.excelRow === f.excelRow))
      .map((k) => k.token)
      .join(", ");
    await App().persistMutation(
      { kind: "bank_ontkoppel", excelRow: b.excelRow, waarde: rest },
      { successMsg: "Ontkoppeld" }
    );
  }

  async function koppel() {
    const f = huidigeFactuur();
    if (!f || !keuze.size) return;
    const st = App().state;
    const sel = [...keuze.values()];
    const som = sel.reduce((s, b) => s + bankKant(f, b), 0);
    const doelBedrag = restBedrag(f) || Math.abs(f.bedrag || 0);
    // Termijnen (samen minder dan het openstaande bedrag) zijn normaal en
    // hoeven geen bevestiging; alleen te véél vraagt om een check.
    const oordeel = M().selectieOordeel(som, doelBedrag, "minder");
    if (oordeel.kind === "af") {
      const ok = await App().showConfirm(
        `De bankregels zijn samen ${M().fmtEur(oordeel.verschil)} meer dan er nog openstaat (${M().fmtEur(som)} tegen ${M().fmtEur(doelBedrag)}). Toch koppelen?`,
        "Toch koppelen",
        "Annuleren"
      );
      if (!ok) return;
    }
    const waarde = M().koppelWaarde(f.boek === "verkoop" ? "V" : "I", f, st.inkoopRows, st.verkoopRows);
    keuze.clear();
    klaarUitgeklapt = false;
    await App().persistMutation(
      {
        kind: "bank_koppel",
        items: sel.map((b) => ({ excelRow: b.excelRow, waarde, ingeboekt: true })),
      },
      { successMsg: sel.length > 1 ? `Gekoppeld aan ${sel.length} bankregels ✓` : "Gekoppeld ✓" }
    );
  }

  // === Inline blok in het inkoop-/verkoopformulier ===

  /**
   * Tekent "Bankregels" onder een factuur die bewerkt wordt: wat eraan hangt,
   * of het bedrag klopt, en een knop om te koppelen. factuur mag null zijn
   * (nieuwe regel) — dan blijft het blok leeg en verborgen.
   */
  function renderBankBlok(el, factuur) {
    if (!el) return;
    el.innerHTML = "";
    el.classList.toggle("hidden", !factuur || factuur.excelRow == null);
    if (!factuur || factuur.excelRow == null) return;
    const f = {
      ...factuur,
      boek: String(factuur.boek || "").toLowerCase() === "verkoop" ? "verkoop" : "inkoop",
    };
    const status = M().factuurStatus(f, dekkingsKaart());
    const regels = gekoppeldeBankregels(f);

    const kop = document.createElement("div");
    kop.className = "koppel-blok-kop";
    const credit = factuurTeken(f) < 0;
    const rond = credit
      ? f.boek === "verkoop" ? "terugbetaald" : "teruggekregen"
      : f.boek === "verkoop" ? "ontvangen" : "betaald";
    const tekst =
      status.kind === "ok"
        ? `✓ volledig ${rond} (${M().fmtEur(Math.abs(status.gedekt))})`
        : status.kind === "deels"
          ? `◐ nog ${M().fmtEur(status.open)} van ${M().fmtEur(Math.abs(f.bedrag || 0))} open`
          : status.kind === "teveel"
            ? `⚠ ${M().fmtEur(status.open)} téveel gekoppeld`
            : "○ nog geen bankregel gekoppeld";
    kop.innerHTML =
      `<span class="koppel-blok-titel">Bankregels</span>` +
      `<span class="koppel-blok-status status-${status.kind}">${tekst}</span>`;
    el.appendChild(kop);

    if (regels.length) el.appendChild(bankregelLijst(f, regels));

    const knop = document.createElement("button");
    knop.type = "button";
    knop.className = "btn-secondary btn-inline";
    knop.textContent = regels.length ? "＋ Nog een bankregel koppelen" : "🔗 Bankregel koppelen";
    knop.addEventListener("click", () => openFactuur(f));
    el.appendChild(knop);
  }

  function init() {
    $("#btn-koppel-sluit").addEventListener("click", sluit);
    $("#btn-koppel-doe").addEventListener("click", koppel);
    $("#koppel-zoek").addEventListener("input", render);
    $("#btn-koppel-meer").addEventListener("click", () => {
      klaarUitgeklapt = true;
      render();
    });
    // Meelopen met elke datawijziging zolang de modal openstaat.
    App().registerLiveView(() => {
      if (isOpen()) render();
    });
  }

  global.BoekKoppel = { init, openFactuur, sluit, renderBankBlok, isOpen };
})(window);
