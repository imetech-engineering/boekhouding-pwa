/**
 * Searchable combobox — datalist on input + ▼ button opens full popup.
 */
(function (global) {
  let activePopup = null;
  let activeBackdrop = null;

  function closeActivePopup() {
    if (activePopup) {
      activePopup.remove();
      activePopup = null;
    }
    if (activeBackdrop) {
      activeBackdrop.remove();
      activeBackdrop = null;
    }
  }

  function createCombo(inputId, datalistId, optionsFn, onSelect) {
    const input = document.getElementById(inputId);
    if (!input) return null;

    if (datalistId) {
      input.setAttribute("list", datalistId);
    }

    const wrap = document.createElement("div");
    wrap.className = "combo-wrap";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-secondary btn-combo";
    btn.setAttribute("aria-label", "Lijst openen");
    btn.innerHTML = "&#9660;";
    wrap.appendChild(btn);

    function openPopup() {
      closeActivePopup();
      const full = optionsFn() || [];

      const backdrop = document.createElement("div");
      backdrop.className = "combo-backdrop";
      backdrop.addEventListener("click", closeActivePopup);
      document.body.appendChild(backdrop);
      activeBackdrop = backdrop;

      const popup = document.createElement("div");
      popup.className = "combo-popup";
      popup.innerHTML = `
        <div class="combo-popup-head">
          <span class="combo-popup-title">Kiezen</span>
          <button type="button" class="combo-close" aria-label="Sluiten">&times;</button>
        </div>
        <input type="search" class="combo-search" placeholder="Zoeken…" autocomplete="off" />
        <ul class="combo-list"></ul>`;
      document.body.appendChild(popup);
      activePopup = popup;

      popup.querySelector(".combo-close").addEventListener("click", closeActivePopup);

      const rect = wrap.getBoundingClientRect();
      const maxW = Math.min(Math.max(rect.width, 280), window.innerWidth - 24);
      popup.style.width = `${maxW}px`;
      popup.style.left = `${Math.min(rect.left, window.innerWidth - maxW - 12)}px`;
      popup.style.top = `${Math.min(rect.bottom + 4, window.innerHeight * 0.35)}px`;

      const search = popup.querySelector(".combo-search");
      const list = popup.querySelector(".combo-list");
      search.value = input.value || "";

      function pick(val) {
        input.value = val;
        closeActivePopup();
        input.dispatchEvent(new Event("change", { bubbles: true }));
        if (onSelect) onSelect(val);
      }

      function renderList(q) {
        const query = (q || "").trim().toLowerCase();
        let items = full;
        if (query) items = full.filter((o) => o.toLowerCase().includes(query));
        list.innerHTML = "";
        if (!items.length) {
          list.innerHTML = '<li class="combo-empty">Geen resultaten</li>';
          return;
        }
        for (const opt of items.slice(0, 60)) {
          const li = document.createElement("li");
          li.textContent = opt;
          li.addEventListener("click", () => pick(opt));
          list.appendChild(li);
        }
      }

      search.addEventListener("input", () => renderList(search.value));
      search.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          closeActivePopup();
        }
        if (e.key === "Enter") {
          const first = list.querySelector("li:not(.combo-empty)");
          if (first) pick(first.textContent);
        }
      });

      renderList(search.value);
      setTimeout(() => search.focus(), 50);
    }

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPopup();
    });

    return { input, openPopup, closePopup: closeActivePopup };
  }

  global.UrenCombo = { createCombo, closeActivePopup };
})(window);
