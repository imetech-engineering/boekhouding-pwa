/**
 * Bankboek-tab: openstaande regels, nieuwe regel, bewerken/matchen/ingeboekt markeren.
 */
(function (global) {
  const App = () => global.BoekApp;
  const M = () => global.BoekModel;
  const $ = (s) => document.querySelector(s);

  let modalRow = null; // geselecteerde bankregel in de modal

  function recenteFacturen() {
    const st = App().state;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 60);
    const all = [
      ...st.inkoopRows.filter((r) => !r.isEmpty).map((r) => ({ ...r, boek: "Inkoop" })),
      ...st.verkoopRows.filter((r) => !r.isEmpty).map((r) => ({ ...r, boek: "Verkoop" })),
    ];
    return all.filter((f) => f.datum && f.datum.getTime() >= cutoff.getTime());
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

  function rowLine(r, { showMatch = false } = {}) {
    const li = document.createElement("li");
    li.className = "boek-item";
    const bedragHtml =
      r.in != null
        ? `<span class="bi-amount in">+ ${M().fmtEur(r.in)}</span>`
        : `<span class="bi-amount uit">− ${M().fmtEur(r.uit)}</span>`;
    let matchHtml = "";
    if (showMatch) {
      const matches = M().invoiceMatchesForBankRow(recenteFacturen(), r);
      if (matches.length) {
        matchHtml = `<span class="bi-match">⚡ ${matches.length} factuur-match</span>`;
      }
    }
    li.innerHTML = `
      <div class="bi-head">
        <span class="bi-title">${escapeHtml(r.omschrijving || "(geen omschrijving)")}</span>
        ${bedragHtml}
      </div>
      <div class="bi-sub">
        <span>${r.datumStr}${r.ingeboekt ? " · ✓ ingeboekt" : ""}</span>
        ${matchHtml || `<span>saldo ${M().fmtEur(r.saldo)}</span>`}
      </div>
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
    const open = filled.filter((r) => !r.ingeboekt);
    const last = filled[filled.length - 1];
    $("#bank-saldo").textContent = last ? M().fmtEur(last.saldo) : "—";
    $("#bank-open-count").textContent = String(open.length);

    const openList = $("#bank-open-list");
    openList.innerHTML = "";
    for (const r of open.slice().reverse().slice(0, 50)) {
      openList.appendChild(rowLine(r, { showMatch: true }));
    }
    if (!open.length) {
      openList.innerHTML = '<li class="sub">Alles is ingeboekt 🎉</li>';
    }

    const recentList = $("#bank-recent-list");
    recentList.innerHTML = "";
    for (const r of filled.slice(-8).reverse()) {
      recentList.appendChild(rowLine(r));
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
    const matches = M()
      .invoiceMatchesForBankRow(recenteFacturen(), {
        datum: M().isoToDate(f.datumIso),
        in: f.in,
        uit: f.uit,
      });
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
    if (!f.datumIso) return App().showToast("Vul een datum in.", true);
    if (!f.omschrijving) return App().showToast("Vul een omschrijving in.", true);
    if (f.in == null && f.uit == null) {
      return App().showToast("Vul In en/of Uit in.", true);
    }
    const matches = M().invoiceMatchesForBankRow(recenteFacturen(), {
      datum: M().isoToDate(f.datumIso),
      in: f.in,
      uit: f.uit,
    });
    if (matches.length) {
      const m0 = matches[0];
      f.ingeboekt = await App().showConfirm(
        `Er is een matchende factuur (${m0.boek}: ${m0.partij}, ${M().fmtEur(m0.bedrag)}). Deze bankregel direct als ingeboekt markeren?`,
        "Ja, ingeboekt",
        "Nee"
      );
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
    $("#btn-bank-m-ingeboekt").textContent = r.ingeboekt
      ? "Markeer als NIET ingeboekt"
      : "Markeer ingeboekt";

    const matches = M().invoiceMatchesForBankRow(recenteFacturen(), r);
    const wrap = $("#bank-m-matches-wrap");
    const list = $("#bank-m-matches");
    list.innerHTML = "";
    wrap.classList.toggle("hidden", !matches.length);
    for (const f of matches.slice(0, 6)) {
      const li = document.createElement("li");
      li.className = "boek-item";
      li.innerHTML = `
        <div class="bi-head">
          <span class="bi-title">${escapeHtml(f.boek)}: ${escapeHtml(f.partij)}</span>
          <span class="bi-amount">${M().fmtEur(f.bedrag)}</span>
        </div>
        <div class="bi-sub"><span>${escapeHtml(f.omschrijving).slice(0, 60)}</span><span>${f.datumStr}</span></div>`;
      list.appendChild(li);
    }
    $("#bank-modal").classList.remove("hidden");
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
    $("#btn-bank-m-save").addEventListener("click", modalSave);
    $("#btn-bank-m-ingeboekt").addEventListener("click", modalToggleIngeboekt);
    $("#btn-bank-m-naar-inkoop").addEventListener("click", () => modalNaarBoek(false));
    $("#btn-bank-m-naar-verkoop").addEventListener("click", () => modalNaarBoek(true));
    $("#btn-bank-m-delete").addEventListener("click", () => {
      if (modalRow) deleteRow(modalRow);
    });
  }

  App().registerTab("bank", { init, render });
  global.BoekUiBank = { render };
})(window);
