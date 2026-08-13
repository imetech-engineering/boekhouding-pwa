/**
 * Overzicht-tab: kwartaaldashboard, status, account, install, instellingen, sync.
 */
(function (global) {
  const App = () => global.BoekApp;
  const M = () => global.BoekModel;
  const $ = (s) => document.querySelector(s);

  let jaar = new Date().getFullYear();
  let thuisKeuze = null;

  function renderKwartalen() {
    $("#ovz-year").value = String(jaar);
    const body = $("#ovz-kwartaal-body");
    body.innerHTML = "";
    const st = App().state;
    const data = M().kwartaalOverzicht(st.inkoopRows, st.verkoopRows, jaar);
    let totOmzet = 0;
    let totKosten = 0;
    let totBtw = 0;
    for (const s of data) {
      totOmzet += s.omzet;
      totKosten += s.kosten;
      totBtw += s.btwSaldo;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${s.q}</td>
        <td class="num">${M().fmtEur(s.omzet)}</td>
        <td class="num">${M().fmtEur(s.kosten)}</td>
        <td class="num ${s.resultaat >= 0 ? "pos" : "neg"}">${M().fmtEur(s.resultaat)}</td>
        <td class="num ${s.btwSaldo >= 0 ? "" : "pos"}">${M().fmtEur(s.btwSaldo)}</td>`;
      body.appendChild(tr);
    }
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${jaar}</strong></td>
      <td class="num"><strong>${M().fmtEur(totOmzet)}</strong></td>
      <td class="num"><strong>${M().fmtEur(totKosten)}</strong></td>
      <td class="num ${totOmzet - totKosten >= 0 ? "pos" : "neg"}"><strong>${M().fmtEur(totOmzet - totKosten)}</strong></td>
      <td class="num"><strong>${M().fmtEur(totBtw)}</strong></td>`;
    body.appendChild(tr);
  }

  function renderStatus() {
    const st = App().state;
    const open = st.bankRows.filter((r) => !r.isEmpty && !r.ingeboekt).length;
    $("#ovz-bank-open").textContent = st.loaded ? String(open) : "—";
    $("#ovz-files-open").textContent = String(st.files.inkoop.length + st.files.verkoop.length);
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
    renderKwartalen();
    renderStatus();
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
    $("#btn-ovz-year-prev").addEventListener("click", () => {
      jaar -= 1;
      renderKwartalen();
    });
    $("#btn-ovz-year-next").addEventListener("click", () => {
      jaar += 1;
      renderKwartalen();
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
