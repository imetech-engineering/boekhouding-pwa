/**
 * Terugknop van de telefoon, gelijk voor alle IMeTech-apps.
 *
 * Zonder dit sluit "terug" in een geïnstalleerde app meteen de hele app, ook
 * als je alleen een pop-up of een ander tabblad open had. Hier houden we een
 * stapel "lagen" bij (pop-up, detailscherm, ander tabblad). Zolang er één open
 * staat, zit er precies één extra stap in de geschiedenis; terug sluit dan de
 * bovenste laag in plaats van de app.
 *
 *   Terug.sluiter("modal", () => sluitModal());   // hoe een laag dicht gaat
 *   Terug.open("modal");  Terug.dicht("modal");    // melden wat er gebeurt
 *   Terug.sync(["tab", "detail"]);                 // of: zo hoort de stapel te zijn
 *   Terug.bewaak(element, "modal", sluitFn);       // volgt class "hidden" zelf
 */
(function (global) {
  "use strict";
  const lagen = [];
  const sluiters = {};
  let inHistorie = false;
  let negeer = false;

  function duw() {
    if (inHistorie) return;
    try {
      history.pushState({ imetechLaag: true }, "");
      inHistorie = true;
    } catch (_) {}
  }

  function open(id) {
    const i = lagen.indexOf(id);
    if (i >= 0) lagen.splice(i, 1);
    lagen.push(id);
    duw();
  }

  function dicht(id) {
    const i = lagen.indexOf(id);
    if (i < 0) return;
    lagen.splice(i, 1);
    if (lagen.length || !inHistorie) return;
    // Even wachten: vaak gaat er meteen een volgende laag open.
    setTimeout(() => {
      if (lagen.length || !inHistorie) return;
      inHistorie = false;
      negeer = true;
      history.back();
    }, 0);
  }

  function sync(ids) {
    const gewenst = ids.filter(Boolean);
    for (const id of [...lagen]) if (!gewenst.includes(id)) dicht(id);
    for (const id of gewenst) if (!lagen.includes(id)) open(id);
  }

  global.addEventListener("popstate", () => {
    if (negeer) {
      negeer = false;
      return;
    }
    if (!inHistorie) return;
    inHistorie = false;
    const boven = lagen.pop();
    if (boven && sluiters[boven]) {
      try {
        sluiters[boven]();
      } catch (e) {
        console.error(e);
      }
    }
    if (lagen.length) duw();
  });

  /** Volgt een element met class "hidden": zichtbaar = laag open. */
  function bewaak(el, id, sluit) {
    if (!el) return;
    sluiters[id] = sluit || (() => el.classList.add("hidden"));
    const kijk = () => (el.classList.contains("hidden") ? dicht(id) : open(id));
    new MutationObserver(kijk).observe(el, { attributes: true, attributeFilter: ["class"] });
    if (!el.classList.contains("hidden")) open(id);
  }

  const SLUIT_KNOPPEN = [
    "[data-close-modal]",
    "[data-close-conflict]",
    "[data-close]",
    'button[id$="-close"]',
    'button[id*="sluit"]',
    'button[id*="cancel"]',
    'button[id*="dismiss"]',
    'button[id$="-no"]',
    ".modal-backdrop",
  ];

  function sluitGeneriek(el) {
    for (const sel of SLUIT_KNOPPEN) {
      const knop = el.querySelector(sel);
      if (knop) {
        knop.click();
        if (el.classList.contains("hidden")) return;
      }
    }
    el.classList.add("hidden");
  }

  /**
   * Automatisch voor apps met .modal-pop-ups en een .bottom-nav: elke zichtbare
   * pop-up is een laag, en elk ander tabblad dan het eerste ook (terug = eerste tab).
   */
  function auto({ modals = ".modal", nav = ".bottom-nav", actief = "active" } = {}) {
    document.querySelectorAll(modals).forEach((el, i) => {
      if (!el.id) el.id = "laag-" + i;
      bewaak(el, "modal:" + el.id, () => sluitGeneriek(el));
    });
    const balk = document.querySelector(nav);
    if (!balk) return;
    const knoppen = [...balk.querySelectorAll("button[data-tab]")];
    if (!knoppen.length) return;
    sluiters.tab = () => knoppen[0].click();
    const kijk = () => {
      const huidig = knoppen.find((k) => k.classList.contains(actief));
      if (!huidig || huidig === knoppen[0]) dicht("tab");
      else if (!lagen.includes("tab")) {
        // Het tabblad hoort onder eventuele pop-ups in de stapel.
        lagen.unshift("tab");
        duw();
      }
    };
    const mo = new MutationObserver(kijk);
    knoppen.forEach((k) => mo.observe(k, { attributes: true, attributeFilter: ["class"] }));
    kijk();
  }

  global.Terug = {
    auto,
    open,
    dicht,
    sync,
    bewaak,
    sluiter: (id, fn) => {
      sluiters[id] = fn;
    },
    lagen: () => [...lagen],
  };

  // <script src="js/terug.js" data-auto> zet de automatische modus aan.
  const script = document.currentScript;
  if (script && script.hasAttribute("data-auto")) {
    if (document.readyState === "complete") auto();
    else global.addEventListener("load", () => auto());
  }
})(window);
