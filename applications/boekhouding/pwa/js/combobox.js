/**
 * Searchable combobox — datalist + ▼ popup (zelfde component als uren-PWA).
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

  function rankSearchOption(option, query) {
    const s = String(option).toLowerCase();
    if (s === query) return 0;
    if (s.startsWith(query)) return 1;
    return 2;
  }

  function createCombo(inputId, datalistId, optionsFn, onSelect, config) {
    const input = document.getElementById(inputId);
    if (!input) return null;

    const cfg = {
      title: "Kiezen",
      allowNew: true,
      multiline: false,
      ...(config || {}),
    };

    if (datalistId) {
      input.setAttribute("list", datalistId);
    } else {
      input.removeAttribute("list");
    }

    const wrap = document.createElement("div");
    wrap.className = "combo-wrap" + (cfg.multiline ? " combo-wrap-multiline" : "");
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
          <span class="combo-popup-title">${cfg.title}</span>
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
        const raw = (q || "").trim();
        const query = raw.toLowerCase();
        let items = full;
        if (query) {
          items = full
            .filter((o) => String(o).toLowerCase().includes(query))
            .sort((a, b) => {
              const ra = rankSearchOption(a, query);
              const rb = rankSearchOption(b, query);
              if (ra !== rb) return ra - rb;
              return full.indexOf(a) - full.indexOf(b);
            });
        }
        list.innerHTML = "";
        const exact = raw && full.some((o) => String(o).toLowerCase() === query);
        if (cfg.allowNew && raw && !exact) {
          const liNew = document.createElement("li");
          liNew.className = "combo-new";
          liNew.textContent = `Nieuw: ${raw}`;
          liNew.addEventListener("click", () => pick(raw));
          list.appendChild(liNew);
        }
        if (!items.length && !raw) {
          list.innerHTML = '<li class="combo-empty">Typ om nieuw toe te voegen</li>';
          return;
        }
        if (!items.length && raw && cfg.allowNew) {
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
          const raw = search.value.trim();
          const firstNew = list.querySelector("li.combo-new");
          if (firstNew && raw) {
            pick(raw);
            return;
          }
          const first = list.querySelector("li:not(.combo-empty)");
          if (first) pick(first.textContent.replace(/^Nieuw:\s*/, "") || first.textContent);
          else if (raw && cfg.allowNew) pick(raw);
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

    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" && !e.altKey && !e.ctrlKey) {
        e.preventDefault();
        openPopup();
      }
    });

    return { input, openPopup, closePopup: closeActivePopup };
  }

  global.BoekCombo = { createCombo, closeActivePopup, rankSearchOption };
})(window);
