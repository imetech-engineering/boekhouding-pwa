/**
 * Context-aware werkzaamheden picker (port of desktop open_werkzaamheden_popup).
 */
(function (global) {
  let active = null;

  function closePicker() {
    if (active?.backdrop) active.backdrop.remove();
    if (active?.popup) active.popup.remove();
    active = null;
  }

  function smartWerk(intel, og, project, loc) {
    if (!intel) return [];
    og = (og || "").trim();
    project = (project || "").trim();
    loc = (loc || "").trim();
    const key = `${og}\0${project}\0${loc}`;
    if (og && project && loc && intel.werk_by_context?.[key]) {
      return UrenInvoer.sortContextValues(intel.werk_by_context, key);
    }
    return intel.all_werk || [];
  }

  function rankOption(opt, query) {
    const q = (query || "").trim().toLowerCase();
    if (!q) return 0;
    const o = opt.toLowerCase();
    if (o === q) return 0;
    if (o.startsWith(q)) return 1;
    if (o.includes(q)) return 2;
    return 3;
  }

  function openWerkPicker(inputEl, intel, getContext, onPick) {
    if (!inputEl) return;
    const ctx = getContext ? getContext() : {};
    const opts = smartWerk(intel, ctx.og, ctx.project, ctx.loc);
    if (!opts.length) return;

    closePicker();
    const backdrop = document.createElement("div");
    backdrop.className = "combo-backdrop";
    backdrop.addEventListener("click", closePicker);
    document.body.appendChild(backdrop);

    const popup = document.createElement("div");
    popup.className = "combo-popup werk-popup";
    popup.innerHTML = `
      <div class="combo-popup-head">
        <span class="combo-popup-title">Werkzaamheden</span>
        <button type="button" class="combo-close" aria-label="Sluiten">&times;</button>
      </div>
      <input type="search" class="combo-search" placeholder="Zoeken…" autocomplete="off" />
      <ul class="combo-list"></ul>`;
    document.body.appendChild(popup);
    active = { backdrop, popup };

    popup.querySelector(".combo-close").addEventListener("click", closePicker);
    const search = popup.querySelector(".combo-search");
    const list = popup.querySelector(".combo-list");
    search.value = inputEl.value || "";

    const rect = inputEl.getBoundingClientRect();
    const maxW = Math.min(Math.max(rect.width, 300), window.innerWidth - 24);
    popup.style.width = `${maxW}px`;
    popup.style.left = `${Math.min(rect.left, window.innerWidth - maxW - 12)}px`;
    popup.style.top = `${Math.min(rect.bottom + 4, window.innerHeight * 0.25)}px`;

    function pick(val) {
      inputEl.value = val;
      closePicker();
      inputEl.dispatchEvent(new Event("change", { bubbles: true }));
      if (onPick) onPick(val);
    }

    function renderList(q) {
      const query = (q || "").trim().toLowerCase();
      let items = opts;
      if (query) items = opts.filter((o) => o.toLowerCase().includes(query));
      items = [...items].sort((a, b) => rankOption(a, query) - rankOption(b, query));
      list.innerHTML = "";
      if (!items.length) {
        list.innerHTML = '<li class="combo-empty">Geen resultaten</li>';
        return;
      }
      for (const opt of items.slice(0, 40)) {
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
        closePicker();
      }
      if (e.key === "Enter") {
        const first = list.querySelector("li:not(.combo-empty)");
        if (first) pick(first.textContent);
      }
    });

    renderList(search.value);
    setTimeout(() => search.focus(), 50);
  }

  global.UrenWerkPicker = { openWerkPicker, closePicker, smartWerk };
})(window);
