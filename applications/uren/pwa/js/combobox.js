/**
 * Searchable combobox — input + ▼ Kies popup (like desktop uren_app).
 */
(function (global) {
  function createCombo(inputId, optionsFn, onSelect) {
    const input = document.getElementById(inputId);
    if (!input) return null;
    const wrap = document.createElement("div");
    wrap.className = "combo-wrap";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-secondary btn-combo";
    btn.textContent = "▼ Kies";
    wrap.appendChild(btn);

    let popup = null;

    function closePopup() {
      if (popup) {
        popup.remove();
        popup = null;
      }
    }

    function openPopup() {
      closePopup();
      const full = optionsFn() || [];
      popup = document.createElement("div");
      popup.className = "combo-popup";
      popup.innerHTML = `
        <input type="search" class="combo-search" placeholder="Zoeken…" autocomplete="off" />
        <ul class="combo-list"></ul>`;
      document.body.appendChild(popup);

      const rect = wrap.getBoundingClientRect();
      popup.style.top = `${rect.bottom + window.scrollY + 4}px`;
      popup.style.left = `${rect.left + window.scrollX}px`;
      popup.style.width = `${Math.max(rect.width, 280)}px`;

      const search = popup.querySelector(".combo-search");
      const list = popup.querySelector(".combo-list");
      search.value = input.value || "";

      function renderList(q) {
        const query = (q || "").trim().toLowerCase();
        let items = full;
        if (query) items = full.filter((o) => o.toLowerCase().includes(query));
        list.innerHTML = "";
        if (!items.length) {
          list.innerHTML = '<li class="combo-empty">Geen resultaten</li>';
          return;
        }
        for (const opt of items.slice(0, 40)) {
          const li = document.createElement("li");
          li.textContent = opt;
          li.tabIndex = 0;
          li.addEventListener("click", () => pick(opt));
          list.appendChild(li);
        }
      }

      function pick(val) {
        input.value = val;
        closePopup();
        input.dispatchEvent(new Event("change", { bubbles: true }));
        if (onSelect) onSelect(val);
      }

      search.addEventListener("input", () => renderList(search.value));
      search.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closePopup();
        if (e.key === "Enter") {
          const first = list.querySelector("li:not(.combo-empty)");
          if (first) pick(first.textContent);
        }
      });

      renderList(search.value);
      setTimeout(() => search.focus(), 50);

      setTimeout(() => {
        document.addEventListener(
          "click",
          function outside(ev) {
            if (!popup?.contains(ev.target) && !wrap.contains(ev.target)) {
              closePopup();
              document.removeEventListener("click", outside);
            }
          },
          { once: true }
        );
      }, 0);
    }

    btn.addEventListener("click", openPopup);
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" && !e.altKey) {
        e.preventDefault();
        openPopup();
      }
    });

    return { input, openPopup, closePopup };
  }

  global.UrenCombo = { createCombo };
})(window);
