/* IMeTech UI-basis (gedeeld): eigen dialoog i.p.v. confirm()/prompt(), melding met "Ongedaan maken", schermovergangen,
   update-melding en iconen. Bron: assistant-repo gedeeld/ui/. Niet per app aanpassen: wijzig daar en draai gedeeld/sync.sh. */
(function () {
  "use strict";
  var rustig = function () { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (_) { return false; } };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };

  /* Iconen: IMeTechUI.ic("vink") geeft een inline SVG die de tekstkleur en -grootte volgt. */
  var PADEN = {
    vink: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    kruis: '<path d="M6 6l12 12M18 6L6 18"/>',
    let_op: '<path d="M12 4l9 16H3z"/><path d="M12 10v4.5"/><path d="M12 17.5v.01"/>',
    pen: '<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>',
    ster: '<path d="M12 4l2.5 5.1 5.5.8-4 3.9.9 5.6L12 16.8 7.1 19.4l.9-5.6-4-3.9 5.5-.8z"/>',
    ster_vol: '<path fill="currentColor" d="M12 4l2.5 5.1 5.5.8-4 3.9.9 5.6L12 16.8 7.1 19.4l.9-5.6-4-3.9 5.5-.8z"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    vak: '<rect x="4.5" y="4.5" width="15" height="15" rx="3"/>',
    vak_aan: '<rect x="4.5" y="4.5" width="15" height="15" rx="3"/><path d="M8 12.5l3 3 5-6"/>',
    prullenbak: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 12h10l1-12"/><path d="M9 7V4h6v3"/>',
    hart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><path d="M12 8v.01"/>'
  };
  function ic(naam, extra) {
    return '<svg class="ui-ic' + (extra ? " " + extra : "") + '" viewBox="0 0 24 24" aria-hidden="true">' + (PADEN[naam] || "") + "</svg>";
  }

  /* Dialoog. Geeft een Promise: bevestig -> true/false, vraag -> tekst of null. */
  function blad(o) {
    return new Promise(function (klaar) {
      var vorige = document.activeElement;
      var doek = document.createElement("div");
      doek.className = "ui-doek";
      doek.innerHTML = '<div class="ui-blad" role="dialog" aria-modal="true" tabindex="-1">' +
        (o.titel ? '<div class="ui-titel" role="heading" aria-level="2">' + esc(o.titel) + "</div>" : "") + (o.tekst ? '<div class="ui-tekst">' + esc(o.tekst) + "</div>" : "") +
        (o.invoer ? '<input type="' + (o.type || "text") + '" autocomplete="off" enterkeyhint="done">' : "") +
        '<div class="ui-knoppen"><button type="button" class="ui-nee">' + esc(o.annuleer || "Annuleren") + '</button>' +
        '<button type="button" class="ui-ok' + (o.gevaar ? " ui-gevaar" : "") + '">' + esc(o.ok || "OK") + "</button></div></div>";
      var veld = doek.querySelector("input");
      if (veld) { veld.value = o.waarde || ""; veld.placeholder = o.placeholder || ""; }
      var dicht = false;
      function sluit(uit) {
        if (dicht) return; dicht = true;
        document.removeEventListener("keydown", toets, true);
        doek.classList.add("ui-sluit");
        setTimeout(function () { doek.remove(); try { vorige && vorige.focus && vorige.focus({ preventScroll: true }); } catch (_) {} }, rustig() ? 0 : 150);
        klaar(uit);
      }
      function ja() { sluit(o.invoer ? veld.value : true); }
      function nee() { sluit(o.invoer ? null : false); }
      function toets(e) {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); nee(); }
        else if (e.key === "Enter" && (!o.gevaar || o.invoer) && !(e.target.closest && e.target.closest(".ui-nee"))) { e.preventDefault(); e.stopPropagation(); ja(); }
      }
      doek.addEventListener("click", function (e) { if (e.target === doek) nee(); });
      doek.querySelector(".ui-ok").addEventListener("click", ja);
      doek.querySelector(".ui-nee").addEventListener("click", nee);
      document.addEventListener("keydown", toets, true);
      document.body.appendChild(doek);
      setTimeout(function () { try { (veld || doek.querySelector(".ui-blad")).focus(); if (veld) veld.select(); } catch (_) {} }, 30);
    });
  }
  function opties(a, b) { return typeof a === "string" ? Object.assign({ titel: a }, b || {}) : (a || {}); }
  function bevestig(a, b) { return blad(opties(a, b)); }
  function vraag(a, b) { return blad(Object.assign(opties(a, b), { invoer: true })); }

  /* Melding met knop, standaard "Ongedaan maken". Eén tegelijk. */
  var meldEl = null, meldT = 0;
  function melding(tekst, knop, actie, ms) {
    if (meldEl) meldEl.remove();
    clearTimeout(meldT);
    var el = meldEl = document.createElement("div");
    el.className = "ui-melding"; el.setAttribute("role", "status");
    el.innerHTML = "<span>" + esc(tekst) + "</span>" + (actie ? '<button type="button">' + esc(knop || "Ongedaan maken") + "</button>" : "");
    if (actie) el.querySelector("button").addEventListener("click", function () { el.remove(); try { actie(); } catch (_) {} });
    document.body.appendChild(el);
    meldT = setTimeout(function () { el.classList.add("ui-weg"); setTimeout(function () { el.remove(); }, 150); }, ms || (actie ? 6000 : 3000));
    try { navigator.vibrate && navigator.vibrate(15); } catch (_) {}
  }
  function ongedaan(tekst, actie, ms) { melding(tekst, "Ongedaan maken", actie, ms); }

  /* Schermovergang: na een tik op de navigatie vervaagt het scherm rustig in, ook als de inhoud even later pas binnenkomt. */
  function animeer(houderSel, navSel) {
    var houder = document.querySelector(houderSel);
    if (!houder) return;
    var tot = 0;
    function speel() {
      if (rustig()) return;
      houder.classList.remove("ui-in"); void houder.offsetWidth; houder.classList.add("ui-in");
    }
    houder.addEventListener("animationend", function (e) { if (e.target === houder) houder.classList.remove("ui-in"); });
    document.addEventListener("click", function (e) {
      if (!e.target.closest || !e.target.closest(navSel)) return;
      tot = performance.now() + 1500;
      requestAnimationFrame(function () { requestAnimationFrame(speel); });
    }, true);
    try {
      new MutationObserver(function () { if (performance.now() < tot) { tot = 0; speel(); } }).observe(houder, { childList: true });
    } catch (_) {}
  }

  /* Update-melding voor apps die er zelf geen hebben: zodra een nieuwe service worker het overneemt. */
  function meldUpdates() {
    if (!("serviceWorker" in navigator)) return;
    var had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (had) melding("Nieuwe versie klaar", "Vernieuwen", function () { location.reload(); }, 20000);
      had = true;
    });
  }

  function skelet(regels) {
    var uit = '<span class="ui-skelet kop"></span>';
    for (var i = 0; i < (regels || 3); i++) uit += '<span class="ui-skelet' + (i % 3 === 2 ? " kort" : "") + '"></span>';
    return '<div aria-busy="true" aria-label="Laden">' + uit + "</div>";
  }

  /* Losse tekens (vinkje, waarschuwing, kruisje, ster, potlood) in de tekst van de app automatisch als eigen SVG-icoon tonen.
     Werkt op alles wat de app nu en later op het scherm zet; invoervelden, keuzelijsten en bewerkbare tekst blijven ongemoeid. */
  var TEKENS = { "\u2713": "vink", "\u2714": "vink", "\u2705": "vink", "\u26A0": "let_op", "\u2715": "kruis", "\u2716": "kruis", "\u270E": "pen",
    "\u2605": "ster_vol", "\u2606": "ster", "\u2611": "vak_aan", "\u2610": "vak", "\uD83D\uDD17": "link" };
  var TEKEN_RE = /(\u2713|\u2714|\u2705|\u26A0\uFE0F?|\u2715|\u2716|\u270E|\u2605|\u2606|\u2611|\u2610|\uD83D\uDD17)/;
  var TEKEN_SPLIT = new RegExp(TEKEN_RE.source, "g");
  var SLA_OVER = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, OPTION: 1, SELECT: 1, TITLE: 1, svg: 1, SVG: 1 };
  function tekstNaarIconen(n) {
    var ouder = n.parentNode;
    if (!ouder || SLA_OVER[ouder.nodeName] || ouder.isContentEditable || (ouder.closest && ouder.closest("svg, .ui-geen-iconen"))) return;
    var delen = n.nodeValue.split(TEKEN_SPLIT);
    if (delen.length < 2) return;
    var frag = document.createDocumentFragment(), mal = document.createElement("template");
    delen.forEach(function (deel) {
      var naam = TEKENS[deel.replace("\uFE0F", "")];
      if (naam) { mal.innerHTML = ic(naam); frag.appendChild(mal.content.firstChild); }
      else if (deel) frag.appendChild(document.createTextNode(deel));
    });
    ouder.replaceChild(frag, n);
  }
  function iconenIn(knoop) {
    if (knoop.nodeType === 3) { if (TEKEN_RE.test(knoop.nodeValue)) tekstNaarIconen(knoop); return; }
    if (knoop.nodeType !== 1 || SLA_OVER[knoop.nodeName] || !TEKEN_RE.test(knoop.textContent)) return;
    var loper = document.createTreeWalker(knoop, NodeFilter.SHOW_TEXT, null), lijst = [], n;
    while ((n = loper.nextNode())) if (TEKEN_RE.test(n.nodeValue)) lijst.push(n);
    lijst.forEach(tekstNaarIconen);
  }
  function iconen() {
    if (!document.body) return;
    iconenIn(document.body);
    try {
      new MutationObserver(function (ms) {
        for (var i = 0; i < ms.length; i++) {
          if (ms[i].type === "characterData") iconenIn(ms[i].target);
          else for (var j = 0; j < ms[i].addedNodes.length; j++) iconenIn(ms[i].addedNodes[j]);
        }
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    } catch (_) {}
  }

  /* Zelf starten vanuit de script-tag: <script src="js/imetech-ui.js" data-houder="main" data-nav=".bottom-nav" data-updates="1"> */
  var tag = document.currentScript, inst = tag ? tag.dataset : {};
  function start() {
    if (inst.houder && inst.nav) animeer(inst.houder, inst.nav);
    if (inst.updates) meldUpdates();
    if (inst.iconen) iconen();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();

  window.IMeTechUI = { bevestig: bevestig, vraag: vraag, melding: melding, ongedaan: ongedaan, animeer: animeer, meldUpdates: meldUpdates,
    skelet: skelet, ic: ic, iconen: iconen, versie: "1.2" };
})();
