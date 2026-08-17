/**
 * Overzicht-tab: kwartaaldashboard, status, account, install, instellingen, sync.
 */
(function (global) {
  const App = () => global.BoekApp;
  const M = () => global.BoekModel;
  const $ = (s) => document.querySelector(s);

  let jaar = new Date().getFullYear();
  let thuisKeuze = null;

  const MAANDEN = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function renderKerncijfers() {
    const st = App().state;
    const c = M().maandCijfers(st.inkoopRows, st.verkoopRows, jaar);
    $("#kpi-omzet").textContent = M().fmtEur(c.omzet);
    $("#kpi-kosten").textContent = M().fmtEur(c.kosten);
    const res = $("#kpi-resultaat");
    res.textContent = M().fmtEur(c.resultaat);
    res.classList.toggle("neg", c.resultaat < 0);

    // Maandstaafjes, geschaald op de hoogste waarde van dat jaar
    const max = Math.max(1, ...c.maanden.map((m) => Math.max(m.omzet, m.kosten)));
    const wrap = $("#ovz-maanden");
    wrap.innerHTML = "";
    c.maanden.forEach((m, i) => {
      const col = document.createElement("div");
      col.className = "ovz-month";
      col.title =
        `${MAANDEN[i]}: omzet ${M().fmtEur(m.omzet)}, kosten ${M().fmtEur(m.kosten)}`;
      col.innerHTML = `
        <span class="ovz-pair">
          <i class="b-omzet" style="height:${(m.omzet / max) * 100}%"></i>
          <i class="b-kosten" style="height:${(m.kosten / max) * 100}%"></i>
        </span>
        <span class="ovz-month-label">${MAANDEN[i]}</span>`;
      wrap.appendChild(col);
    });
  }

  function renderKwartalen() {
    $("#ovz-year").value = String(jaar);
    const body = $("#ovz-kwartaal-body");
    body.innerHTML = "";
    const st = App().state;
    const data = M().kwartaalOverzicht(st.inkoopRows, st.verkoopRows, jaar);
    let totOmzet = 0;
    let totKosten = 0;
    for (const s of data) {
      totOmzet += s.omzet;
      totKosten += s.kosten;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${s.q}</td>
        <td class="num">${M().fmtEur(s.omzet)}</td>
        <td class="num">${M().fmtEur(s.kosten)}</td>
        <td class="num ${s.resultaat >= 0 ? "pos" : "neg"}">${M().fmtEur(s.resultaat)}</td>`;
      body.appendChild(tr);
    }
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${jaar}</strong></td>
      <td class="num"><strong>${M().fmtEur(totOmzet)}</strong></td>
      <td class="num"><strong>${M().fmtEur(totKosten)}</strong></td>
      <td class="num ${totOmzet - totKosten >= 0 ? "pos" : "neg"}"><strong>${M().fmtEur(totOmzet - totKosten)}</strong></td>`;
    body.appendChild(tr);
  }

  function renderBtw() {
    const st = App().state;
    const data = M().btwAangifte(st.inkoopRows, st.verkoopRows, jaar);
    const body = $("#ovz-btw-body");
    body.innerHTML = "";
    let verlegd = 0;
    let omzetNul = 0;
    let totSaldo = 0;
    for (const s of data) {
      verlegd += s.verlegdBedrag;
      omzetNul += s.omzetNul;
      totSaldo += s.saldo;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${s.q}</td>
        <td class="num">${M().fmtEur(s.verschuldigd)}</td>
        <td class="num">${M().fmtEur(s.terugTeVragen)}</td>
        <td class="num ${s.saldo > 0 ? "neg" : "pos"}">${M().fmtEur(s.saldo)}</td>`;
      body.appendChild(tr);
    }
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><strong>${jaar}</strong></td><td class="num"></td><td class="num"></td>
      <td class="num ${totSaldo > 0 ? "neg" : "pos"}"><strong>${M().fmtEur(totSaldo)}</strong></td>`;
    body.appendChild(tr);
    $("#ovz-btw-detail").textContent =
      `Te betalen = BTW op omzet − voorbelasting. Verlegde EU-inkopen dit jaar: ` +
      `${M().fmtEur(verlegd)} (staat in 5a én 5b, dus per saldo nul). ` +
      `Omzet 0%/vrijgesteld: ${M().fmtEur(omzetNul)}.`;
  }

  function renderRank(elId, items, kleur) {
    const wrap = $(elId);
    wrap.innerHTML = "";
    if (!items.length) {
      wrap.innerHTML = '<p class="sub">Nog niets geboekt dit jaar.</p>';
      return;
    }
    const max = Math.max(...items.map((i) => Math.abs(i.bedrag)), 1);
    for (const it of items) {
      const row = document.createElement("div");
      row.className = "ovz-rank-row";
      row.innerHTML = `
        <span class="r-naam">${escapeHtml(it.naam)}</span>
        <span class="r-bar"><i class="${kleur}" style="width:${(Math.abs(it.bedrag) / max) * 100}%"></i></span>
        <span class="r-bedrag">${M().fmtEur(it.bedrag)}</span>`;
      wrap.appendChild(row);
    }
  }

  function renderRanglijsten() {
    const st = App().state;
    renderRank(
      "#ovz-klanten",
      M().topGroepen(st.verkoopRows, jaar, (r) => r.partij, (r) => r.netto),
      "b-omzet"
    );
    renderRank(
      "#ovz-categorieen",
      M().topGroepen(st.inkoopRows, jaar, (r) => r.categorie, (r) => r.netto),
      "b-kosten"
    );
    renderRank(
      "#ovz-projecten",
      M().topGroepen(st.inkoopRows, jaar, (r) => r.project, (r) => r.netto),
      "b-kosten"
    );
    renderRank(
      "#ovz-leveranciers",
      M().topGroepen(st.inkoopRows, jaar, (r) => r.partij, (r) => r.netto),
      "b-kosten"
    );

    const reis = M().reisTotaal(st.inkoopRows, jaar);
    $("#kpi-ritten").textContent = String(reis.ritten);
    $("#kpi-km").textContent = `${Math.round(reis.km).toLocaleString("nl-NL")} km`;
    $("#kpi-reis").textContent = M().fmtEur(reis.bedrag);

    const prive = M().priveOverzicht(st.bankRows, jaar);
    $("#kpi-prive-op").textContent = M().fmtEur(prive.opgenomen);
    $("#kpi-prive-in").textContent = M().fmtEur(prive.gestort);
    $("#kpi-prive-netto").textContent = M().fmtEur(prive.netto);
    const overigEl = $("#prive-overig");
    overigEl.innerHTML = "";
    if (prive.overig.length) {
      const kop = document.createElement("p");
      kop.className = "sub";
      kop.innerHTML = `<strong>Daarnaast ${M().fmtEur(prive.overigTotaal)} privé betaald van de zaak</strong> (geen opname, telt hierboven niet mee):`;
      overigEl.appendChild(kop);
      for (const o of prive.overig) {
        const p = document.createElement("p");
        p.className = "sub";
        p.textContent = `• ${o.datumStr} — ${o.omschrijving}: ${M().fmtEur(o.bedrag)}`;
        overigEl.appendChild(p);
      }
    }
  }

  function renderStatus() {
    const st = App().state;
    const open = st.bankRows.filter((r) => !r.isEmpty && !r.ingeboekt).length;
    $("#ovz-bank-open").textContent = st.loaded ? String(open) : "—";
    $("#ovz-files-open").textContent = String(st.files.inkoop.length + st.files.verkoop.length);
  }

  function renderKoppelcontrole() {
    const st = App().state;
    if (!st.loaded) return;
    const index = M().koppelingIndex(st.bankRows, st.inkoopRows, st.verkoopRows);
    const losFact = M().facturenZonderBank(st.inkoopRows, st.verkoopRows, index);
    const losBank = M().bankZonderKoppeling(st.bankRows);
    $("#kpi-fact-los").textContent = String(losFact.length);
    $("#kpi-bank-los").textContent = String(losBank.length);
    renderOnbetaald(losFact);
    renderKia();

    // Klikbare lijstjes: tik = koppelen; ingedrukt houden (bankregels) = meerdere
    // selecteren en in één keer "geen factuur nodig" markeren.
    const lijst = (elId, kop, items, regel, onTik, toonAlles, opts = {}) => {
      const el = $(elId);
      el.innerHTML = "";
      if (!items.length) return;
      const h = document.createElement("p");
      h.className = "sub";
      h.innerHTML = `<strong>${kop}</strong> <span class="sub">— ${opts.hint || "tik om te koppelen"}</span>`;
      el.appendChild(h);
      const max = toonAlles ? items.length : 8;
      for (const it of items.slice(0, max)) {
        const p = document.createElement("p");
        const sel = opts.geselecteerd?.(it) || false;
        p.className = "sub ovz-koppel-item" + (sel ? " selected" : "");
        p.textContent = (sel ? "☑ " : "") + regel(it);
        let timer = null;
        let langGedrukt = false;
        if (opts.onLang) {
          p.addEventListener("contextmenu", (ev) => ev.preventDefault());
          p.addEventListener("pointerdown", () => {
            langGedrukt = false;
            timer = setTimeout(() => {
              langGedrukt = true;
              App().haptic(20);
              opts.onLang(it);
            }, 450);
          });
          for (const evt of ["pointerup", "pointerleave", "pointercancel"]) {
            p.addEventListener(evt, () => clearTimeout(timer));
          }
        }
        p.addEventListener("click", () => {
          if (langGedrukt) return; // long-press was al afgehandeld
          onTik(it);
        });
        el.appendChild(p);
      }
      if (items.length > max) {
        const p = document.createElement("p");
        p.className = "sub ovz-koppel-item";
        p.textContent = `… en nog ${items.length - max} — toon alles`;
        p.addEventListener("click", () => {
          toonAllesSet.add(elId);
          renderKoppelcontrole();
        });
        el.appendChild(p);
      }
    };
    lijst(
      "#ovz-fact-los",
      "Facturen zonder bankregel:",
      losFact,
      (f) =>
        `• ${f.datumStr} · ${f.boek === "verkoop" ? "V" : "I"} · ${f.partij}${f.factuurnummer ? " · " + f.factuurnummer : ""} · ${M().fmtEur(f.bedrag)}`,
      (f) => openFactuurKoppel(f),
      toonAllesSet.has("#ovz-fact-los")
    );
    lijst(
      "#ovz-bank-los",
      "Ingeboekte bankregels zonder factuur:",
      losBank,
      (b) => `• ${b.datumStr} · ${b.omschrijving.slice(0, 38)} · ${M().fmtEur(b.in != null ? b.in : b.uit)}`,
      (b) => {
        if (bankSelectie.size) {
          toggleBankSelectie(b);
          return;
        }
        global.BoekUiBank?.openByExcelRow(b.excelRow);
      },
      toonAllesSet.has("#ovz-bank-los"),
      {
        hint: "tik = koppelen · ingedrukt houden = selecteren",
        onLang: (b) => toggleBankSelectie(b),
        geselecteerd: (b) => bankSelectie.has(b.excelRow),
      }
    );
    if (bankSelectie.size) {
      const bar = document.createElement("div");
      bar.className = "btn-row";
      bar.innerHTML = `
        <button type="button" class="btn-primary" id="btn-geen-batch">✓ ${bankSelectie.size} × geen factuur nodig</button>
        <button type="button" class="btn-secondary" id="btn-geen-annuleer">Annuleren</button>`;
      $("#ovz-bank-los").appendChild(bar);
      bar.querySelector("#btn-geen-batch").addEventListener("click", batchGeenFactuur);
      bar.querySelector("#btn-geen-annuleer").addEventListener("click", () => {
        bankSelectie.clear();
        renderKoppelcontrole();
      });
    }
  }

  const bankSelectie = new Set(); // excelRows in multi-select (long-press)

  function toggleBankSelectie(b) {
    if (bankSelectie.has(b.excelRow)) bankSelectie.delete(b.excelRow);
    else bankSelectie.add(b.excelRow);
    renderKoppelcontrole();
  }

  async function batchGeenFactuur() {
    const items = [...bankSelectie].map((row) => ({ excelRow: row, waarde: "-", ingeboekt: true }));
    bankSelectie.clear();
    await App().persistMutation(
      { kind: "bank_koppel", items },
      { successMsg: `${items.length} bankregel${items.length === 1 ? "" : "s"} gemarkeerd: geen factuur nodig` }
    );
  }

  const toonAllesSet = new Set();

  /**
   * Verkoopfacturen zonder (volledige) bankregel = nog niet (helemaal) betaald.
   * Deelbetalingen tellen mee met hun restbedrag; tik = koppelen (betaald melden).
   */
  function renderOnbetaald(losFact) {
    const st = App().state;
    const dekking = M().factuurDekking(st.bankRows, st.inkoopRows, st.verkoopRows);
    const onbetaald = losFact
      .filter((f) => f.boek === "verkoop" && f.bedrag > 0)
      .map((f) => ({ ...f, rest: f.bedrag, deels: false }));
    const nu = new Date();
    for (const r of st.verkoopRows) {
      if (r.isEmpty || !r.datum || r.bedrag == null || r.bedrag <= 0 || r.datum > nu) continue;
      const gedekt = dekking.get(`verkoop|${r.excelRow}`) || 0;
      const rest = Math.round((r.bedrag - gedekt) * 100) / 100;
      if (gedekt > 0.005 && rest >= 0.01) onbetaald.push({ ...r, boek: "verkoop", rest, deels: true });
    }
    const totaal = onbetaald.reduce((s, f) => s + f.rest, 0);
    $("#kpi-onbetaald").textContent = M().fmtEur(totaal);
    $("#kpi-onbetaald-n").textContent = String(onbetaald.length);
    const el = $("#ovz-onbetaald");
    el.innerHTML = "";
    for (const f of onbetaald.slice(0, 6)) {
      const dagen = Math.floor((Date.now() - f.datum.getTime()) / 86400000);
      const bedragTekst = f.deels
        ? `nog ${M().fmtEur(f.rest)} van ${M().fmtEur(f.bedrag)}`
        : M().fmtEur(f.bedrag);
      const p = document.createElement("p");
      p.className = "sub ovz-koppel-item";
      p.textContent = `• ${f.partij}${f.factuurnummer ? " · " + f.factuurnummer : ""} · ${bedragTekst} · ${dagen} dgn${dagen > 30 ? " ⚠" : ""}`;
      p.addEventListener("click", () => openFactuurKoppel({ ...f, bedrag: f.rest }));
      el.appendChild(p);
    }
    if (onbetaald.length > 6) {
      const p = document.createElement("p");
      p.className = "sub";
      p.textContent = `… en nog ${onbetaald.length - 6}`;
      el.appendChild(p);
    }
  }

  /** KIA-regel onder de kerncijfers: investeringen dit jaar t.o.v. de drempel. */
  function renderKia() {
    const st = App().state;
    const el = $("#ovz-kia");
    const kia = M().kiaTotaal(st.inkoopRows, jaar);
    el.classList.toggle("hidden", !kia.aantal);
    if (!kia.aantal) return;
    el.textContent =
      kia.som >= kia.drempel
        ? `Investeringen ${jaar}: ${M().fmtEur(kia.som)} (${kia.aantal}×) — boven de KIA-drempel, ±28% extra aftrek ✓`
        : `Investeringen ${jaar}: ${M().fmtEur(kia.som)} (${kia.aantal}×) — nog ${M().fmtEur(kia.drempel - kia.som)} tot de KIA-drempel (${M().fmtEur(kia.drempel)})`;
  }

  /** Jaarrapport: winst & verlies + mini-balans + BTW als printbare pagina (→ PDF). */
  function openJaarrapport() {
    const st = App().state;
    if (!st.loaded) return App().showToast("Eerst verversen.", true);
    const inJaar = (r) => !r.isEmpty && r.datum && r.datum.getUTCFullYear() === jaar;
    const omzet = st.verkoopRows.filter(inJaar).reduce((s, r) => s + (r.netto || 0), 0);
    // Investeringen zijn geen kosten: de jaarlast zit al in de afschrijvingsregels.
    const kostenRows = st.inkoopRows.filter((r) => inJaar(r) && !r.afschrijving);
    const kosten = kostenRows.reduce((s, r) => s + (r.netto || 0), 0);
    const kostenPerCat = M().topGroepen(kostenRows, jaar, (r) => r.categorie || "(geen categorie)", (r) => r.netto || 0, 99);
    const omzetPerKlant = M().topGroepen(st.verkoopRows, jaar, (r) => r.partij, (r) => r.netto || 0, 99);
    const btw = M().btwAangifte(st.inkoopRows, st.verkoopRows, jaar);
    const kia = M().kiaTotaal(st.inkoopRows, jaar);
    const activa = M().boekwaardeActiva(st.inkoopRows, jaar);
    const eind = new Date(Date.UTC(jaar, 11, 31, 23, 59));
    const saldi = M().saldiPerRekening(st.bankRows.filter((r) => !r.isEmpty && r.datum && r.datum <= eind));
    const prive = M().priveOverzicht(st.bankRows, jaar);
    const reis = M().reisTotaal(st.inkoopRows, jaar);
    const eur = (v) => M().fmtEur(v);
    const rij = (n, b, sterk) => `<tr${sterk ? ' class="sterk"' : ""}><td>${n}</td><td class="num">${eur(b)}</td></tr>`;
    const w = window.open("", "_blank");
    if (!w) return App().showToast("Pop-up geblokkeerd — sta pop-ups toe.", true);
    w.document.write(`<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>Jaarrapport ${jaar} — IMeTech</title>
<style>
  body { font: 13px/1.45 "Segoe UI", system-ui, sans-serif; color: #16233b; margin: 32px auto; max-width: 720px; }
  h1 { font-size: 21px; margin: 0 0 2px; } .sub { color: #5b6b85; margin: 0 0 18px; }
  h2 { font-size: 14px; margin: 20px 0 6px; border-bottom: 2px solid #16233b; padding-bottom: 3px; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: 3px 6px; border-bottom: 1px solid #e3e8f0; text-align: left; }
  .num { text-align: right; white-space: nowrap; } tr.sterk td { font-weight: 700; border-top: 2px solid #16233b; }
  .twee { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  @media print { body { margin: 0; } .noprint { display: none; } }
</style></head><body>
<h1>Jaarrapport ${jaar}</h1>
<p class="sub">IMeTech Engineering · netto bedragen excl. BTW · gegenereerd ${new Date().toLocaleDateString("nl-NL")}</p>
<button class="noprint" onclick="print()">Afdrukken / opslaan als PDF</button>
<h2>Winst &amp; verlies</h2>
<table>
${omzetPerKlant.map((x) => rij(`Omzet — ${x.naam}`, x.bedrag)).join("")}
${rij("Totaal omzet", omzet, true)}
${kostenPerCat.map((x) => rij(`Kosten — ${x.naam}`, x.bedrag)).join("")}
${rij("Totaal kosten", kosten, true)}
${rij("Resultaat", omzet - kosten, true)}
</table>
<div class="twee"><div>
<h2>Mini-balans per 31-12</h2>
<table>
${rij("Bedrijfsmiddelen (boekwaarde)", activa)}
${rij("Rabo", saldi.Rabo)}
${rij("Knab", saldi.Knab)}
${rij("Totaal", activa + saldi.Rabo + saldi.Knab, true)}
</table>
<h2>Privé</h2>
<table>
${rij("Opgenomen", prive.opgenomen)}
${rij("Gestort", prive.gestort)}
${rij("Netto opgenomen", prive.netto, true)}
</table>
</div><div>
<h2>BTW per kwartaal</h2>
<table><tr><th>Kw</th><th class="num">Verschuldigd</th><th class="num">Voorbelasting</th><th class="num">Saldo</th></tr>
${btw.map((s) => `<tr><td>${s.q}</td><td class="num">${eur(s.verschuldigd)}</td><td class="num">${eur(s.terugTeVragen)}</td><td class="num">${eur(s.saldo)}</td></tr>`).join("")}
</table>
<h2>Overig</h2>
<table>
${rij(`Investeringen (KIA${kia.som >= kia.drempel ? " ✓" : ""})`, kia.som)}
${rij(`Reiskosten (${reis.km.toFixed(0)} km)`, reis.bedrag)}
</table>
</div></div>
</body></html>`);
    w.document.close();
  }

  // === Factuur → bankregel koppelen (kiezer) ===
  let koppelFactuur = null;

  function openFactuurKoppel(f) {
    koppelFactuur = f;
    $("#koppel-modal-title").textContent = `Koppel: ${f.partij}`;
    $("#koppel-modal-info").textContent = `${f.boek === "verkoop" ? "Verkoop" : "Inkoop"} · ${
      f.factuurnummer ? f.factuurnummer + " · " : ""
    }${M().fmtEur(f.bedrag)} · ${f.datumStr} — kies de bankregel die erbij hoort:`;
    $("#koppel-zoek").value = "";
    renderKoppelLijst();
    $("#koppel-modal").classList.remove("hidden");
  }

  function renderKoppelLijst() {
    const f = koppelFactuur;
    if (!f) return;
    const st = App().state;
    const zoek = $("#koppel-zoek").value;
    const kandidaten = M().bankKandidatenVoorFactuur(f, st.bankRows, zoek);
    const list = $("#koppel-lijst");
    list.innerHTML = "";
    for (const b of kandidaten.slice(0, 10)) {
      const li = document.createElement("li");
      li.className = "boek-item koppel-kandidaat";
      const bedrag = b.in != null ? `+ ${M().fmtEur(b.in)}` : `− ${M().fmtEur(b.uit)}`;
      li.innerHTML = `
        <div class="bi-head">
          <span class="bi-title">${escapeHtml(b.omschrijving || "(geen omschrijving)")}</span>
          <span class="bi-amount">${bedrag}</span>
        </div>
        <div class="bi-sub"><span>${b.datumStr}${b.koppelingRaw ? " · al deels gekoppeld" : ""}${
        b.ingeboekt ? " · ✓ ingeboekt" : ""
      }</span><span>${b.exact ? "✓ zelfde bedrag" : ""}</span></div>`;
      li.addEventListener("click", async () => {
        const waarde = M().koppelWaarde(
          f.boek === "verkoop" ? "V" : "I",
          f,
          st.inkoopRows,
          st.verkoopRows
        );
        sluitFactuurKoppel();
        await App().persistMutation(
          { kind: "bank_koppel", items: [{ excelRow: b.excelRow, waarde, ingeboekt: true }] },
          { successMsg: `${f.partij} gekoppeld aan bankregel ${b.datumStr}` }
        );
      });
      list.appendChild(li);
    }
    if (!list.children.length) {
      list.innerHTML = `<li class="sub">${
        zoek
          ? "Niets gevonden."
          : `Geen bankregel met exact ${M().fmtEur(f.bedrag)} — zoek hierboven op omschrijving (bijv. bij een verzamelbetaling), of koppel vanuit de bankregel zelf.`
      }</li>`;
    }
  }

  function sluitFactuurKoppel() {
    $("#koppel-modal").classList.add("hidden");
    koppelFactuur = null;
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function renderAccount() {
    const label = global.BoekAuth.getAccountLabel();
    $("#account-label").textContent = label || "Niet ingelogd";
    const link = $("#onedrive-link");
    if (App().state.webUrl) {
      link.href = App().state.webUrl;
      link.classList.remove("hidden");
    }
  }

  function renderSettings() {
    const s = App().state.settings;
    const tariefEl = $("#set-km-tarief");
    if (document.activeElement !== tariefEl) {
      tariefEl.value = String(s.kmTarief ?? 0.23).replace(".", ",");
    }
    $("#set-thuis-label").textContent = s.thuisAdres?.label
      ? `✓ ${s.thuisAdres.label}`
      : "Nog niet ingesteld — nodig voor automatische km-berekening.";
  }

  function render() {
    $("#ovz-year").value = String(jaar);
    renderKerncijfers();
    renderKwartalen();
    renderBtw();
    renderRanglijsten();
    renderStatus();
    renderKoppelcontrole();
    renderAccount();
    renderSettings();
  }

  const zoekThuis = global.BoekReis.debounce(async () => {
    const q = $("#set-thuis-adres").value.trim();
    const list = $("#set-thuis-results");
    if (q.length < 3) {
      list.classList.add("hidden");
      return;
    }
    try {
      const results = await global.BoekReis.searchAddress(q);
      if (results === null) return;
      list.innerHTML = "";
      list.classList.toggle("hidden", !results.length);
      for (const r of results) {
        const li = document.createElement("li");
        li.textContent = r.label;
        li.addEventListener("click", async () => {
          thuisKeuze = r;
          list.classList.add("hidden");
          $("#set-thuis-adres").value = "";
          await App().saveSettings({
            thuisAdres: { label: r.label, plaats: r.plaats || "Aalten", lat: r.lat, lon: r.lon },
          });
          renderSettings();
          App().showToast("Thuisadres opgeslagen");
        });
        list.appendChild(li);
      }
    } catch (_) {
      /* stil */
    }
  }, 350);

  function init() {
    $("#btn-koppel-sluit").addEventListener("click", sluitFactuurKoppel);
    $("#koppel-zoek").addEventListener("input", renderKoppelLijst);
    $("#btn-jaarrapport").addEventListener("click", openJaarrapport);
    $("#btn-ovz-year-prev").addEventListener("click", () => {
      jaar -= 1;
      render();
    });
    $("#btn-ovz-year-next").addEventListener("click", () => {
      jaar += 1;
      render();
    });

    $("#btn-login").addEventListener("click", async () => {
      try {
        await global.BoekAuth.login();
        renderAccount();
        App().refreshFromCloud();
      } catch (e) {
        if (e?.errorCode !== "user_cancelled") {
          App().showToast(e.message || String(e), true);
        }
      }
    });
    $("#btn-logout").addEventListener("click", async () => {
      try {
        await global.BoekAuth.logout();
      } catch (_) {}
      renderAccount();
      App().setStatus("Uitgelogd.");
    });
    $("#btn-refresh").addEventListener("click", () => App().refreshFromCloud());

    $("#set-km-tarief").addEventListener("change", () => {
      const v = M().parseUserAmount($("#set-km-tarief").value);
      if (v != null && v > 0 && v < 5) {
        App().saveSettings({ kmTarief: v });
        App().showToast(`Km-tarief: € ${String(v).replace(".", ",")}/km`);
      } else {
        App().showToast("Ongeldig km-tarief", true);
        renderSettings();
      }
    });
    $("#set-thuis-adres").addEventListener("input", zoekThuis);
  }

  App().registerTab("overzicht", { init, render, onShow: render });
  global.BoekUiOverzicht = { render };
})(window);
