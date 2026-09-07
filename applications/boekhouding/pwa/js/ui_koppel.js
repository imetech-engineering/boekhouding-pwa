/**
 * Koppelpopup — één scherm voor beide richtingen.
 *
 * Overal in de app open je hem met hetzelfde ketting-icoon 🔗: op een bankregel
 * (kies de facturen die erbij horen) en op een factuur (kies de bankregels
 * waarmee die betaald is). Het scherm ziet er beide keren hetzelfde uit:
 * status bovenaan, wat er al aan hangt met een ✕ erachter, dan zoeken en
 * aanvinken, met een sombalk die zegt of het klopt.
 *
 * Het blijft na koppelen en ontkoppelen open en tekent zichzelf opnieuw
 * (registerLiveView), zodat je het resultaat meteen ziet.
 */
(function (global) {
  const App = () => global.BoekApp;
  const M = () => global.BoekModel;
  const $ = (s) => document.querySelector(s);

  let doel = null; // { soort: "bank" | "factuur", excelRow, boek? }
  let uitgeklapt = false; // al rond, maar toch nog iets bijkoppelen
  const keuze = new Map(); // sleutel → aangevinkt item

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function isOpen() {
    return !$("#koppel-modal").classList.contains("hidden");
  }

  function isBank() {
    return doel && doel.soort === "bank";
  }

  /** Staat er al een "-" bij deze bankregel (rest bewust zonder factuur)? */
  function restBewust(item) {
    return String(item.koppelingRaw || "")
      .split(",")
      .some((t) => t.trim() === "-");
  }

  function bedragTekst(b) {
    return b.in != null ? `+ ${M().fmtEur(b.in)}` : `− ${M().fmtEur(b.uit)}`;
  }

  /** Verse regel uit de state; na een mutatie is een snapshot verouderd. */
  function huidig() {
    if (!doel) return null;
    const st = App().state;
    if (isBank()) {
      return st.bankRows.find((r) => !r.isEmpty && r.excelRow === doel.excelRow) || null;
    }
    const rows = doel.boek === "verkoop" ? st.verkoopRows : st.inkoopRows;
    const r = rows.find((x) => x.excelRow === doel.excelRow);
    return r ? { ...r, boek: doel.boek } : null;
  }

  // === Openen en sluiten ===

  function openBankregel(r) {
    if (!r || r.excelRow == null) return;
    doel = { soort: "bank", excelRow: r.excelRow };
    start();
  }

  function openFactuur(f) {
    if (!f || f.excelRow == null) return;
    doel = {
      soort: "factuur",
      excelRow: f.excelRow,
      boek: String(f.boek || "").toLowerCase() === "verkoop" ? "verkoop" : "inkoop",
    };
    start();
  }

  function start() {
    uitgeklapt = false;
    keuze.clear();
    $("#koppel-zoek").value = "";
    voorselecteren();
    render();
    $("#koppel-modal").classList.remove("hidden");
  }

  function sluit() {
    $("#koppel-modal").classList.add("hidden");
    doel = null;
    keuze.clear();
  }

  /** Wat er duidelijk bij hoort alvast aanvinken — vaak is één tik dan genoeg. */
  function voorselecteren() {
    const item = huidig();
    if (!item) return;
    const rest = openstaand(item);
    if (rest < 0.01) return;
    const kand = kandidaten(item, rest, "");
    if (isBank()) {
      if (item.koppelingRaw) return; // al iets gekoppeld: niets voorstellen
      const combi = M().vindCombinatie(kand, rest);
      if (combi) for (const f of combi) keuze.set(sleutelVan(f), f);
      return;
    }
    const exact = kand.filter((b) => b.exact);
    if (exact.length === 1) keuze.set(sleutelVan(exact[0]), exact[0]);
  }

  // === Rekenen ===

  function bankBedrag(r) {
    return r.in != null ? r.in : r.uit;
  }

  /** Bedrag dat al door bestaande koppelingen van deze bankregel gedekt is. */
  function gekoppeldBedrag(r) {
    if (!r.koppelingRaw) return 0;
    const st = App().state;
    const hoofd = r.in != null ? "verkoop" : "inkoop";
    return M()
      .parseKoppelingen(r.koppelingRaw, st.inkoopRows, st.verkoopRows)
      .reduce((s, k) => {
        if (!k.row) return s;
        const bedrag = k.groepBedrag != null ? k.groepBedrag : k.row.bedrag || 0;
        return s + (k.boek === hoofd ? 1 : -1) * bedrag;
      }, 0);
  }

  /** Wat er op dit item nog te koppelen valt (altijd positief bij een factuur). */
  function openstaand(item) {
    if (isBank()) {
      return Math.round(((bankBedrag(item) || 0) - gekoppeldBedrag(item)) * 100) / 100;
    }
    const st = M().factuurStatus(item, App().dekkingIndex());
    return st.kind === "ok" ? 0 : st.open;
  }

  function factuurTeken(f) {
    return (f.bedrag || 0) < 0 ? -1 : 1;
  }

  /** Bijdrage van een bankregel aan een factuur; een creditnota draait de kant om. */
  function bankKant(f, b) {
    const wilIn = M().factuurRichting(f.boek, f.bedrag || 0) > 0;
    return ((wilIn ? b.in : b.uit) || 0) - ((wilIn ? b.uit : b.in) || 0);
  }

  function gekoppeldeBankregels(f) {
    return App().koppelIndex().get(`${f.boek}|${f.excelRow}`) || [];
  }

  function kandidaten(item, doelBedrag, zoek) {
    const st = App().state;
    if (isBank()) {
      return M().koppelKandidaten(
        item, st.inkoopRows, st.verkoopRows, App().dekkingIndex(), st.matchDagen, zoek
      );
    }
    return M().bankKandidatenVoorFactuur(
      { ...item, bedrag: doelBedrag * factuurTeken(item) },
      st.bankRows,
      zoek,
      new Set(gekoppeldeBankregels(item).map((b) => b.excelRow))
    );
  }

  function sleutelVan(k) {
    return isBank() ? `${k.boek}|${k.excelRow}` : String(k.excelRow);
  }

  /** Bijdrage van een aangevinkte kandidaat aan het doelbedrag. */
  function bijdrage(item, k) {
    if (isBank()) return (k.teken || 1) * (k.rest != null ? k.rest : k.bedrag);
    return bankKant(item, k);
  }

  // === Tekenen ===

  function render() {
    if (!doel) return;
    const item = huidig();
    if (!item) return sluit();
    const bank = isBank();
    const rest = openstaand(item);

    if (bank) {
      $("#koppel-modal-title").textContent = `Bankregel ${item.datumStr}`;
      $("#koppel-modal-info").textContent =
        `${item.omschrijving || "(geen omschrijving)"} · ${bedragTekst(item)}` +
        (item.rekening ? ` · ${item.rekening}` : "");
    } else {
      $("#koppel-modal-title").textContent =
        `${item.partij}${item.factuurnummer ? " · " + item.factuurnummer : ""}`;
      $("#koppel-modal-info").textContent =
        `${item.boek === "verkoop" ? "Verkoopfactuur" : "Inkoopfactuur"} · ` +
        `${M().fmtEur(Math.abs(item.bedrag || 0))} · ${item.datumStr}`;
    }

    zetStatus(item);
    renderGekoppeld(item);

    const zoekEl = $("#koppel-zoek");
    const zoek = zoekEl.value;
    // Al rond en niets geselecteerd: kandidaten pas op verzoek.
    const dicht = rest < 0.01 && !keuze.size && !zoek.trim() && !uitgeklapt;
    $("#koppel-meer-wrap").classList.toggle("hidden", !dicht);
    zoekEl.classList.toggle("hidden", dicht);
    $("#koppel-lijst").classList.toggle("hidden", dicht);
    $("#btn-koppel-doe").classList.toggle("hidden", dicht);
    // "Geen factuur nodig" hoort bij een bankregel. Hangt er al een factuur aan
    // en blijft er geld over (typisch een privé-deel), dan zet dezelfde knop
    // alleen die rest bewust zonder factuur.
    const geenKnop = $("#btn-koppel-geen");
    const alGeen = restBewust(item);
    const heeftFactuur = bank && (item.koppelingRaw || "").split(",").some((t) => t.trim() && t.trim() !== "-");
    geenKnop.classList.toggle("hidden", !bank || alGeen);
    geenKnop.textContent = heeftFactuur
      ? `Rest (${M().fmtEur(Math.abs(rest))}) hoeft geen factuur`
      : "Geen factuur nodig";
    zoekEl.placeholder = bank
      ? "🔍 Zoek op naam of factuurnummer…"
      : "🔍 Zoek in bankregels…";
    if (dicht) {
      $("#koppel-lijst").innerHTML = "";
      $("#koppel-som").classList.add("hidden");
      return;
    }

    const doelBedrag = rest >= 0.01 ? rest : Math.abs(bank ? bankBedrag(item) : item.bedrag) || 0;
    renderKandidaten(item, doelBedrag, zoek);
    renderSom(item, doelBedrag);
  }

  function zetStatus(item) {
    const el = $("#koppel-status");
    if (isBank()) {
      const st = App().state;
      const s = M().bankKoppelStatus(
        item, st.inkoopRows, st.verkoopRows, App().dekkingIndex(), App().koppelIndex()
      );
      el.className = `bank-m-status status-${s.kind}`;
      el.textContent = `${M().koppelStatusIcoon(s.kind)} ${M().koppelStatusTekst(s)}`;
      return;
    }
    const s = M().factuurStatus(item, App().dekkingIndex());
    const credit = factuurTeken(item) < 0;
    const rond = credit
      ? item.boek === "verkoop" ? "terugbetaald" : "teruggekregen"
      : item.boek === "verkoop" ? "ontvangen" : "betaald";
    el.className = `bank-m-status status-${s.kind}`;
    el.textContent =
      s.kind === "ok"
        ? `✓ volledig ${rond}`
        : s.kind === "deels"
          ? `◐ nog ${M().fmtEur(s.open)} van ${M().fmtEur(Math.abs(item.bedrag || 0))} open`
          : s.kind === "teveel"
            ? `⚠ ${M().fmtEur(s.open)} téveel gekoppeld`
            : "○ nog geen bankregel gekoppeld";
  }

  /** Wat er al aan hangt, met een knop om te openen en een om los te maken. */
  function renderGekoppeld(item) {
    const el = $("#koppel-gekoppeld");
    el.innerHTML = "";
    const rijen = [];
    if (isBank()) {
      const st = App().state;
      for (const k of M().parseKoppelingen(item.koppelingRaw, st.inkoopRows, st.verkoopRows)) {
        if (k.token === "-") {
          rijen.push({ titel: "geen factuur nodig (bewust)", sub: "", bedrag: "", k });
          continue;
        }
        if (!k.row) {
          rijen.push({ titel: escapeHtml(k.token), sub: "hoort bij geen enkele factuur", bedrag: "", k });
          continue;
        }
        const bedrag = k.groepBedrag != null ? k.groepBedrag : k.row.bedrag;
        rijen.push({
          titel: `${escapeHtml(k.row.partij)}${k.row.factuurnummer ? " · " + escapeHtml(k.row.factuurnummer) : ""}`,
          sub: `${k.boek === "verkoop" ? "Verkoop" : "Inkoop"} · ${k.row.datumStr}` +
            (k.ambigu ? ` · ${k.ambigu} regels met dit nummer` : ""),
          bedrag: M().fmtEur(bedrag),
          k,
          naar: () => openFactuur({ ...k.row, boek: k.boek }),
        });
      }
    } else {
      for (const b of gekoppeldeBankregels(item)) {
        rijen.push({
          titel: escapeHtml(b.omschrijving || "(geen omschrijving)"),
          sub: `${b.datumStr}${b.rekening ? " · " + escapeHtml(b.rekening) : ""}` +
            (b.ingeboekt ? " · ✓ ingeboekt" : ""),
          bedrag: bedragTekst(b),
          bank: b,
          naar: () => openBankregel(b),
        });
      }
    }
    if (!rijen.length) return;

    const kop = document.createElement("p");
    kop.className = "sub";
    kop.innerHTML = `<strong>Al gekoppeld (${rijen.length})</strong>`;
    el.appendChild(kop);
    const ul = document.createElement("ul");
    ul.className = "boek-list";
    for (const r of rijen) {
      const li = document.createElement("li");
      li.className = "boek-item";
      li.innerHTML = `
        <div class="bi-head">
          <span class="bi-title bi-koppel">🔗 ${r.titel}</span>
          <span class="bi-amount">${r.bedrag}</span>
        </div>
        <div class="bi-sub"><span>${r.sub}</span><span></span></div>
        <span class="row-actions">
          ${r.naar ? '<button type="button" class="btn-icon" data-act="naar" aria-label="Openen" title="Openen">↗</button>' : ""}
          <button type="button" class="btn-icon btn-icon-danger" data-act="los" aria-label="Ontkoppelen" title="Ontkoppelen">✕</button>
        </span>`;
      li.querySelector('[data-act="naar"]')?.addEventListener("click", (ev) => {
        ev.stopPropagation();
        r.naar();
      });
      li.querySelector('[data-act="los"]').addEventListener("click", (ev) => {
        ev.stopPropagation();
        ontkoppel(item, r);
      });
      ul.appendChild(li);
    }
    el.appendChild(ul);
  }

  function renderKandidaten(item, doelBedrag, zoek) {
    const lijst = $("#koppel-lijst");
    lijst.innerHTML = "";
    const bank = isBank();
    for (const k of kandidaten(item, doelBedrag, zoek).slice(0, zoek ? 15 : 8)) {
      const sleutel = sleutelVan(k);
      const sel = keuze.has(sleutel);
      const li = document.createElement("li");
      li.className = "boek-item koppel-kandidaat" + (sel ? " selected" : "");
      let titel;
      let sub;
      let bedrag;
      if (bank) {
        const tegen = (k.teken || 1) < 0;
        titel = `${escapeHtml(k.partij)}${k.factuurnummer ? " · " + escapeHtml(k.factuurnummer) : ""}`;
        const deels = k.deels
          ? ` · deels betaald, nog ${M().fmtEur(k.rest)} van ${M().fmtEur(k.bedrag)}`
          : "";
        const termijn = !tegen && k.past === false ? " · termijn" : "";
        sub = `${escapeHtml(k.boek)}${tegen ? " (verrekend)" : ""}${termijn}${deels} · ${escapeHtml((k.omschrijving || "").slice(0, 34))}`;
        bedrag = `<span class="bi-amount${tegen ? " uit" : ""}">${tegen ? "− " : ""}${M().fmtEur(k.rest != null ? k.rest : k.bedrag)}</span>`;
      } else {
        titel = escapeHtml(k.omschrijving || "(geen omschrijving)");
        sub = `${k.datumStr}${k.rekening ? " · " + escapeHtml(k.rekening) : ""}`;
        bedrag = `<span class="bi-amount">${bedragTekst(k)}</span>`;
      }
      li.innerHTML = `
        <div class="bi-head">
          <span class="bi-title"><span class="koppel-check">${sel ? "☑" : "☐"}</span> ${titel}</span>
          ${bedrag}
        </div>
        <div class="bi-sub"><span>${sub}</span><span class="koppel-exact">${k.exact && !bank ? "✓ bedrag klopt" : ""}</span></div>`;
      li.addEventListener("click", () => {
        if (keuze.has(sleutel)) keuze.delete(sleutel);
        else keuze.set(sleutel, k);
        App().haptic(10);
        render();
      });
      lijst.appendChild(li);
    }
    if (!lijst.children.length) {
      lijst.innerHTML = `<li class="sub">${
        zoek
          ? "Niets gevonden — probeer een ander woord of bedrag."
          : bank
            ? `Geen facturen binnen ±${App().state.matchDagen} dagen — zoek hierboven op naam of factuurnummer.`
            : "Geen passende bankregel gevonden. Zoek hierboven op omschrijving."
      }</li>`;
    }
  }

  function renderSom(item, doelBedrag) {
    const somEl = $("#koppel-som");
    const knop = $("#btn-koppel-doe");
    somEl.classList.toggle("hidden", !keuze.size);
    if (keuze.size) {
      const som = [...keuze.values()].reduce((s, k) => s + bijdrage(item, k), 0);
      // Bij een bankregel is een grotere factuur een termijn; bij een factuur
      // zijn juist kleinere bankregels dat.
      const oordeel = M().selectieOordeel(som, doelBedrag, isBank() ? "meer" : "minder");
      if (isBank() && oordeel.kind === "af" && restBewust(item)) oordeel.kind = "deel";
      const staart =
        oordeel.kind === "ok"
          ? "✓ dekt precies"
          : oordeel.kind === "deel"
            ? `· termijn, daarna nog ${M().fmtEur(oordeel.verschil)} open`
            : isBank()
              ? `⚠ er blijft ${M().fmtEur(oordeel.verschil)} van deze bankregel over`
              : `⚠ ${M().fmtEur(oordeel.verschil)} meer dan er nog openstaat`;
      somEl.textContent = `${keuze.size} geselecteerd · ${M().fmtEur(som)} van ${M().fmtEur(doelBedrag)} ${staart}`;
      somEl.classList.toggle("som-ok", oordeel.kind === "ok");
      somEl.classList.toggle("som-deel", oordeel.kind === "deel");
      somEl.classList.toggle("som-af", oordeel.kind === "af");
    }
    knop.disabled = !keuze.size;
    knop.textContent =
      keuze.size > 1
        ? `Koppel ${keuze.size} ${isBank() ? "facturen" : "bankregels"}`
        : "Koppel";
  }

  // === Acties ===

  /** Eén koppeling weghalen; de andere koppelingen van die bankregel blijven. */
  async function ontkoppel(item, rij) {
    const st = App().state;
    const bankRegel = isBank() ? item : rij.bank;
    const naam = isBank()
      ? rij.k.row
        ? rij.k.row.partij
        : rij.k.token
      : `bankregel ${rij.bank.datumStr}`;
    const ok = await App().showConfirm(`Koppeling met ${naam} weghalen?`, "Ontkoppelen", "Annuleren");
    if (!ok) return;
    const behouden = M()
      .parseKoppelingen(bankRegel.koppelingRaw, st.inkoopRows, st.verkoopRows)
      .filter((k) =>
        isBank()
          ? k.token !== rij.k.token
          : !(k.boek === item.boek && k.row && k.row.excelRow === item.excelRow)
      )
      .map((k) => k.token)
      .join(", ");
    uitgeklapt = false;
    await App().persistMutation(
      { kind: "bank_ontkoppel", excelRow: bankRegel.excelRow, waarde: behouden },
      { successMsg: "Ontkoppeld" }
    );
  }

  async function koppel() {
    const item = huidig();
    if (!item || !keuze.size) return;
    const st = App().state;
    const sel = [...keuze.values()];
    const som = sel.reduce((s, k) => s + bijdrage(item, k), 0);
    const rest = openstaand(item);
    const doelBedrag = rest >= 0.01 ? rest : Math.abs(isBank() ? bankBedrag(item) : item.bedrag) || 0;
    const oordeel = M().selectieOordeel(som, doelBedrag, isBank() ? "meer" : "minder");
    if (oordeel.kind === "af" && isBank() && restBewust(item)) oordeel.kind = "deel";
    if (oordeel.kind === "af") {
      const vraag = isBank()
        ? `Er blijft ${M().fmtEur(oordeel.verschil)} van deze bankregel over: de selectie dekt ${M().fmtEur(som)} van ${M().fmtEur(doelBedrag)}.\nIs die rest privé of een kleine bon, zet hem daarna met "Rest hoeft geen factuur" apart. Toch koppelen?`
        : `De bankregels zijn samen ${M().fmtEur(oordeel.verschil)} meer dan er nog openstaat (${M().fmtEur(som)} tegen ${M().fmtEur(doelBedrag)}). Toch koppelen?`;
      const ok = await App().showConfirm(vraag, "Toch koppelen", "Annuleren");
      if (!ok) return;
    }
    let items;
    if (isBank()) {
      const waarde = sel
        .map((f) =>
          M().koppelWaarde(f.boek.toLowerCase() === "verkoop" ? "V" : "I", f, st.inkoopRows, st.verkoopRows)
        )
        .join(", ");
      items = [{ excelRow: item.excelRow, waarde, ingeboekt: true }];
    } else {
      const waarde = M().koppelWaarde(
        item.boek === "verkoop" ? "V" : "I", item, st.inkoopRows, st.verkoopRows
      );
      items = sel.map((b) => ({ excelRow: b.excelRow, waarde, ingeboekt: true }));
    }
    keuze.clear();
    uitgeklapt = false;
    $("#koppel-zoek").value = "";
    await App().persistMutation(
      { kind: "bank_koppel", items },
      { successMsg: sel.length > 1 ? `${sel.length} koppelingen gemaakt ✓` : "Gekoppeld ✓" }
    );
  }

  /** Bewust geen factuur bij deze bankregel (bankkosten, privé, overboeking). */
  /**
   * Bewust geen factuur. Zonder gekoppelde factuur geldt dat voor de hele
   * bankregel (bankkosten, privé-opname); hangt er al een factuur aan, dan
   * alleen voor wat er overblijft — het privé-deel van een gedeelde aankoop.
   */
  async function geenFactuur() {
    const item = huidig();
    if (!item || !isBank()) return;
    const heeftFactuur = (item.koppelingRaw || "")
      .split(",")
      .some((t) => t.trim() && t.trim() !== "-");
    await App().persistMutation(
      { kind: "bank_koppel", items: [{ excelRow: item.excelRow, waarde: "-", ingeboekt: true }] },
      {
        successMsg: heeftFactuur
          ? "Rest gemarkeerd: hoeft geen factuur"
          : "Gemarkeerd: geen factuur nodig",
      }
    );
  }

  function init() {
    $("#btn-koppel-sluit").addEventListener("click", sluit);
    $("#btn-koppel-doe").addEventListener("click", koppel);
    $("#btn-koppel-geen").addEventListener("click", geenFactuur);
    $("#koppel-zoek").addEventListener("input", render);
    $("#btn-koppel-meer").addEventListener("click", () => {
      uitgeklapt = true;
      render();
    });
    $("#koppel-modal .modal-backdrop").addEventListener("click", sluit);
    // Meelopen met elke datawijziging zolang het scherm openstaat.
    App().registerLiveView(() => {
      if (isOpen()) render();
    });
  }

  global.BoekKoppel = { init, openBankregel, openFactuur, sluit, isOpen };
})(window);
