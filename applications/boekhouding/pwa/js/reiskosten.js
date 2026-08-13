/**
 * Reiskosten: adres-autocomplete (Photon/Komoot, gratis) + route-km (OSRM demo).
 * Beide zonder API-key; km blijft altijd handmatig aanpasbaar als vangnet.
 */
(function (global) {
  function cfg() {
    return global.BOEK_CONFIG.reis;
  }

  let searchAbort = null;

  /** Adres-suggesties: [{label, plaats, lat, lon}] */
  async function searchAddress(query) {
    if (!query || query.trim().length < 3) return [];
    if (searchAbort) searchAbort.abort();
    searchAbort = new AbortController();
    const c = cfg();
    const url =
      `${c.photonUrl}?q=${encodeURIComponent(query)}&limit=6&lang=default` +
      `&lat=${c.biasLat}&lon=${c.biasLon}`;
    let data;
    try {
      const res = await fetch(url, { signal: searchAbort.signal });
      if (!res.ok) throw new Error(`Adreszoeken mislukt (${res.status})`);
      data = await res.json();
    } catch (e) {
      if (e.name === "AbortError") return null; // vervangen door nieuwere zoekopdracht
      throw e;
    }
    return (data.features || []).map((f) => {
      const p = f.properties || {};
      const parts = [];
      if (p.name) parts.push(p.name);
      const straat = [p.street, p.housenumber].filter(Boolean).join(" ");
      if (straat && straat !== p.name) parts.push(straat);
      if (p.city && p.city !== p.name) parts.push(p.city);
      else if (p.town) parts.push(p.town);
      if (p.country && p.countrycode !== "NL") parts.push(p.country);
      return {
        label: parts.join(", "),
        plaats: p.city || p.town || p.village || "",
        lat: f.geometry?.coordinates?.[1],
        lon: f.geometry?.coordinates?.[0],
      };
    }).filter((r) => r.lat != null && r.lon != null);
  }

  /** Enkele-reis-afstand in km (1 decimaal) via OSRM. */
  async function routeKm(fromLat, fromLon, toLat, toLon) {
    const url =
      `${cfg().osrmUrl}${fromLon},${fromLat};${toLon},${toLat}` +
      `?overview=false&alternatives=false&steps=false`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Routeberekening mislukt (${res.status})`);
    const data = await res.json();
    const meters = data.routes?.[0]?.distance;
    if (!Number.isFinite(meters)) throw new Error("Geen route gevonden.");
    return Math.round(meters / 100) / 10;
  }

  function debounce(fn, ms) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  global.BoekReis = { searchAddress, routeKm, debounce };
})(window);
