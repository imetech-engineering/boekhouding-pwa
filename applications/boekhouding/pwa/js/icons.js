/**
 * Lijn-iconen voor de hele app, zelfde stijl als de navigatie (stroke, currentColor).
 * Gebruik: BoekIc.koppel  (geeft een <svg>-string; alleen in innerHTML gebruiken).
 */
(function (global) {
  const svg = (d, cls = "ic ic-inline") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const P = {
    koppel: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    pdf: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M9 14h6M9 17h4"/>',
    beeld: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-9 9"/>',
    map: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
    tekst: '<path d="M5 6h14M12 6v13M9 19h6"/>',
    kopie: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    instellingen: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    bliksem: '<path d="M13 3 5 13h6l-1 8 8-10h-6z"/>',
    zoek: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
  };
  const BoekIc = {};
  for (const [k, d] of Object.entries(P)) BoekIc[k] = svg(d);
  /** Groot icoon (bijv. in de bestandenlijst of de keuzeknoppen). */
  BoekIc.groot = (k) => svg(P[k], "ic");
  global.BoekIc = BoekIc;
})(window);
