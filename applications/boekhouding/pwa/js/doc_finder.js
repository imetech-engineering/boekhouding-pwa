/**
 * Het originele factuurbestand terugzoeken bij een al geboekte regel.
 * Kijkt in zowel "nog te verwerken" als "verwerkt" en matcht op
 * factuurnummer, datum en partij.
 */
(function (global) {
  const App = () => global.BoekApp;
  const M = () => global.BoekModel;

  /** Mapinhoud eenmalig ophalen en bewaren; scheelt een call per bewerking. */
  async function folderItems(kind, token) {
    const st = App().state;
    if (!st.docCache) st.docCache = {};
    if (st.docCache[kind]) return st.docCache[kind];
    const f = global.BOEK_CONFIG.graph.folders;
    const paths =
      kind === "inkoop"
        ? [f.inkoopVerwerkt, f.inkoopNieuw]
        : [f.verkoopVerwerkt, f.verkoopNieuw];
    const items = [];
    for (const p of paths) {
      try {
        const list = await global.BoekGraph.listFolder(p, token);
        for (const it of list) items.push({ ...it, _folder: p });
      } catch (_) {
        /* map kan ontbreken */
      }
    }
    st.docCache[kind] = items;
    return items;
  }

  function score(kind, item, row) {
    let s = 0;
    const fnr = (row.factuurnummer || "").trim().toLowerCase();
    if (kind === "inkoop") {
      const p = M().parseInkoopFilename(item.name);
      if (fnr && p.factuurnummer && p.factuurnummer.toLowerCase() === fnr) s += 5;
      if (row.datum && p.datumIso && M().dateToIso(row.datum) === p.datumIso) s += 3;
      if (p.bedrijf && M().partyNamesMatch(p.bedrijf, row.partij)) s += 2;
    } else {
      const p = M().parseVerkoopFilename(item.name);
      if (fnr && p.factuurnummer && p.factuurnummer.toLowerCase() === fnr) s += 5;
      if (p.bedrijf && M().partyNamesMatch(p.bedrijf, row.partij)) s += 2;
    }
    return s;
  }

  /**
   * Beste match, of null. Drempel 5: alleen het factuurnummer, of datum én
   * partij samen, is overtuigend genoeg — zo krijg je nooit een vreemde factuur
   * te zien bij een regel.
   */
  async function findFor(kind, row) {
    try {
      const token = await App().ensureLoggedIn();
      const items = await folderItems(kind, token);
      let best = null;
      let bestScore = 0;
      for (const it of items) {
        const s = score(kind, it, row);
        if (s > bestScore) {
          bestScore = s;
          best = it;
        }
      }
      return bestScore >= 5 ? best : null;
    } catch (_) {
      return null;
    }
  }

  global.BoekDocFinder = { findFor };
})(window);
