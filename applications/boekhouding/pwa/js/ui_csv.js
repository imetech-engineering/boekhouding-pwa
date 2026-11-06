/**
 * Bank-tab: bankafschrift (CSV of CAMT.053 van Rabo of Knab) inlezen. Toont eerst wat er
 * nieuw is; regels die al in het bankboek staan of in een afgesloten periode
 * vallen, staan standaard uit. Daarna gaat alles via de gewone schrijfrij,
 * en kun je de nieuwe regels koppelen zoals altijd.
 */
(function (global) {
  const App = () => global.BoekApp;
  const M = () => global.BoekModel;
  const C = () => global.BoekBankCsv;
  const $ = (sel) => document.querySelector(sel);

  // Bekende eigen rekeningen (IBAN → rekening in het bankboek).
  const STANDAARD_IBANS = { NL78RABO0133719553: "Rabo", NL78KNAB0800445023: "Knab" };
  const KEUZES = ["Rabo", "Knab", "Rabo spaar", "Knab spaar"];

  let regels = []; // [{t, rekening, status, match, aan}]
  let afschriften = []; // alleen bij CAMT.053: [{iban, van, tot, begin, eind, netto, klopt}]

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function bekendeIbans() {
    return { ...STANDAARD_IBANS, ...(App().state.settings.rekeningIbans || {}) };
  }

  /** Eerst als UTF-8 lezen; lukt dat niet (oude export), dan Windows-1252. */
  async function leesTekst(file) {
    const buf = await file.arrayBuffer();
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(buf);
    } catch (_) {
      return new TextDecoder("windows-1252").decode(buf);
    }
  }

  async function kiesBestand(file) {
    if (!file) return;
    const st = App().state;
    if (!st.loaded) return App().showToast("Eerst verversen, dan importeren.", true);
    let transacties;
    try {
      ({ transacties, afschriften } = C().leesBestand(await leesTekst(file)));
    } catch (e) {
      return App().showToast(e.message || String(e), true);
    }
    if (!transacties.length) return App().showToast("Geen transacties gevonden in dit bestand.", true);
    const ibans = bekendeIbans();
    const rekVan = (t) => C().rekeningVoorIban(t.iban, ibans) || "";
    regels = C()
      .vergelijk(transacties, st.bankRows, rekVan, st.settings.afgeslotenTot)
      .map((x) => ({ ...x, aan: C().standaardAan(x) }));
    render();
    $("#csv-modal").classList.remove("hidden");
  }

  function herbereken() {
    // Na het kiezen van een rekening opnieuw vergelijken (dubbel hangt van de rekening af).
    const st = App().state;
    const keuze = {};
    for (const r of regels) keuze[r.t.iban] = r.rekening;
    const vorige = regels;
    const uit = C().vergelijk(vorige.map((r) => r.t), st.bankRows, (t) => keuze[t.iban] || "", st.settings.afgeslotenTot);
    // Zelf (uit)gevinkte regels laten zoals ze waren, als hun rekening niet veranderde.
    regels = uit.map((x, i) =>
      vorige[i].gewijzigd && vorige[i].rekening === x.rekening
        ? { ...x, aan: vorige[i].aan, gewijzigd: true }
        : { ...x, aan: C().standaardAan(x) }
    );
  }

  function render() {
    const tel = (s) => regels.filter((r) => r.status === s).length;
    const eur = (v) => M().fmtEur(v);
    $("#csv-samenvatting").textContent =
      `${regels.length} transacties: ${tel("nieuw")} nieuw, ${tel("dubbel")} staan er al in, ` +
      `${tel("misschien")} lijken er al in te staan (datum wijkt af), ${tel("afgesloten")} in een afgesloten periode. ` +
      `Alleen aangevinkte regels worden toegevoegd.`;
    // Rekening per IBAN in het bestand
    const ibans = [...new Set(regels.map((r) => r.t.iban))];
    $("#csv-rekeningen").innerHTML = ibans
      .map((iban) => {
        const huidig = regels.find((r) => r.t.iban === iban)?.rekening || "";
        const voorstel = huidig ? "" : C().bankVanIban(iban);
        const opties = ['<option value="">Kies rekening…</option>']
          .concat(KEUZES.map((k) => `<option value="${k}"${k === huidig ? " selected" : ""}>${k}</option>`))
          .join("");
        const hint = voorstel ? ` (${voorstel}: lopend of spaar?)` : "";
        return `<label class="csv-rek"><span>${escapeHtml(iban || "Rekening onbekend")}${hint}</span><select data-iban="${escapeHtml(iban)}">${opties}</select></label>`;
      })
      .join("");
    const LABEL = { nieuw: "nieuw", dubbel: "staat er al in", misschien: "lijkt er al in te staan", afgesloten: "afgesloten periode" };
    $("#csv-lijst").innerHTML = regels
      .map((r, i) => {
        const t = r.t;
        const match = r.match ? ` · ${r.match.datumStr} ${escapeHtml(r.match.omschrijving)}` : "";
        return (
          `<label class="csv-rij${r.aan ? "" : " csv-uit"}">` +
          `<input type="checkbox" data-i="${i}"${r.aan ? " checked" : ""}${r.rekening ? "" : " disabled"} />` +
          `<span><span class="csv-naam">${escapeHtml(t.tegenpartij || t.omschrijving || "—")}</span><br>` +
          `<span class="csv-sub">${M().formatDateNl(M().isoToDate(t.datumIso))} · ${escapeHtml(r.rekening || "geen rekening")} · ${LABEL[r.status]}${match}</span></span>` +
          `<span class="num ${t.bedrag >= 0 ? "pos" : ""}">${eur(t.bedrag)}</span>` +
          `</label>`
        );
      })
      .join("");
    const n = regels.filter((r) => r.aan).length;
    renderSaldo();
    $("#btn-csv-import").textContent = n ? `${n} regel${n === 1 ? "" : "s"} importeren` : "Niets aangevinkt";
    $("#btn-csv-import").disabled = !n;
  }

  /**
   * CAMT.053 heeft begin- en eindsaldo. Twee controles per afschrift:
   * klopt het bestand zelf (begin + mutaties = eind), en komt het bankboek
   * van die rekening na deze import op hetzelfde eindsaldo uit.
   */
  function renderSaldo() {
    const el = $("#csv-saldo");
    if (!afschriften.length) {
      el.classList.add("hidden");
      el.innerHTML = "";
      return;
    }
    const st = App().state;
    const eur = (v) => M().fmtEur(v);
    const dt = (iso) => (iso ? M().formatDateNl(M().isoToDate(iso)) : "?");
    el.innerHTML = afschriften
      .map((a) => {
        const rek = regels.find((r) => r.t.iban === a.iban)?.rekening || "";
        const kop = `<strong>${escapeHtml(rek || a.iban || "Rekening")}</strong> ${dt(a.van)} t/m ${dt(a.tot)}`;
        if (a.klopt === false) {
          return `<div class="fout">${kop}: bestand klopt niet (begin ${eur(a.begin)} + mutaties ${eur(a.netto)} ≠ eind ${eur(a.eind)}). Download het opnieuw.</div>`;
        }
        if (a.eind == null) return `<div>${kop}: geen eindsaldo in het bestand.</div>`;
        // Spaarrekeningen staan maar deels in het bankboek (alleen rente), daar valt niets te vergelijken.
        if (!rek || /spaar/i.test(rek)) return `<div>${kop}: eindsaldo bank ${eur(a.eind)}.</div>`;
        const extra = regels.filter((r) => r.aan && r.rekening === rek).map((r) => r.t);
        const boek = C().bankboekSaldoTot(st.bankRows, rek, a.tot, extra);
        const verschil = Math.round((a.eind - boek) * 100) / 100;
        return verschil === 0
          ? `<div class="ok">${kop}: bankboek na import ${eur(boek)}, gelijk aan de bank ✓</div>`
          : `<div class="fout">${kop}: bank ${eur(a.eind)}, bankboek na import ${eur(boek)} (verschil ${eur(verschil)}).</div>`;
      })
      .join("");
    el.classList.remove("hidden");
  }

  /**
   * Staat er een factuurnummer in de omschrijving van de bank, met hetzelfde
   * bedrag in de goede richting? Dan meteen koppelen (zoals met de hand).
   */
  function zoekFactuur(t) {
    const st = App().state;
    const tekst = String(t.omschrijving || "").toLowerCase().replace(/[\s\-_/.]/g, "");
    if (!tekst) return null;
    const cent = (v) => Math.round((v || 0) * 100);
    const kandidaten = [];
    for (const [boek, rows, teken] of [["verkoop", st.verkoopRows, 1], ["inkoop", st.inkoopRows, -1]]) {
      for (const r of rows) {
        if (r.isEmpty || !r.factuurnummer) continue;
        const fnr = r.factuurnummer.toLowerCase().replace(/[\s\-_/.]/g, "");
        if (fnr.length < 5 || !tekst.includes(fnr)) continue;
        if (cent(r.bedrag) * teken !== cent(t.bedrag)) continue;
        kandidaten.push({ boek, r });
      }
    }
    if (kandidaten.length !== 1) return null;
    const k = kandidaten[0];
    return M().koppelWaarde(k.boek === "inkoop" ? "I" : "V", k.r, st.inkoopRows, st.verkoopRows);
  }

  async function importeer() {
    const st = App().state;
    const gekozen = regels.filter((r) => r.aan && r.rekening);
    if (!gekozen.length) return;
    // Eén keer vragen voor regels in een afgesloten periode, niet per regel.
    const dicht = gekozen.filter((r) => st.settings.afgeslotenTot && r.t.datumIso <= st.settings.afgeslotenTot);
    let slotAkkoord = false;
    if (dicht.length) {
      slotAkkoord = await App().showConfirm(
        `${dicht.length} regel(s) vallen in een afgesloten periode (t/m ${M().formatDateNl(M().isoToDate(st.settings.afgeslotenTot))}). Toch toevoegen?`,
        "Toch toevoegen",
        "Annuleren"
      );
      if (!slotAkkoord) return;
    }
    // Gekozen rekeningen per IBAN onthouden voor de volgende keer.
    const ibans = { ...(st.settings.rekeningIbans || {}) };
    let nieuweIban = false;
    for (const r of gekozen) {
      if (r.t.iban && ibans[r.t.iban] !== r.rekening && STANDAARD_IBANS[r.t.iban] !== r.rekening) {
        ibans[r.t.iban] = r.rekening;
        nieuweIban = true;
      }
    }
    if (nieuweIban) App().saveSettings({ rekeningIbans: ibans });
    $("#csv-modal").classList.add("hidden");
    // Oudste eerst, zodat het bankboek op volgorde blijft.
    gekozen.sort((a, b) => a.t.datumIso.localeCompare(b.t.datumIso));
    let gelukt = 0;
    for (const r of gekozen) {
      const fields = C().naarBankregel(r.t, r.rekening);
      const koppeling = zoekFactuur(r.t);
      if (koppeling) {
        fields.koppeling = koppeling;
        fields.ingeboekt = true;
      }
      const ok = await App().persistMutation({ kind: "bank_add", fields, slotAkkoord: slotAkkoord || undefined });
      if (ok) gelukt++;
    }
    App().showToast(`${gelukt} bankregel${gelukt === 1 ? "" : "s"} geïmporteerd. Koppel ze via Open.`);
  }

  function init() {
    $("#btn-bank-csv")?.addEventListener("click", () => $("#bank-csv-file").click());
    $("#bank-csv-file")?.addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      await kiesBestand(f);
    });
    $("#csv-lijst")?.addEventListener("change", (e) => {
      const i = e.target.dataset?.i;
      if (i == null) return;
      regels[+i].aan = e.target.checked;
      regels[+i].gewijzigd = true;
      render();
    });
    $("#csv-rekeningen")?.addEventListener("change", (e) => {
      const iban = e.target.dataset?.iban;
      if (iban == null) return;
      for (const r of regels) if (r.t.iban === iban) r.rekening = e.target.value;
      herbereken();
      render();
    });
    $("#btn-csv-import")?.addEventListener("click", importeer);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
  global.BoekCsvImport = { kiesBestand };
})(window);
