/**
 * Inzichten op de Analyse-tab: declarabiliteit, effectief uurtarief, waar de
 * onbetaalde uren heen gaan, ranglijsten en het jaarbeeld (maandverloop +
 * prognose). Alleen rekenwerk — het tekenen gebeurt in app.js.
 *
 * Declarabel = een regel met een tarief boven nul. Regels met tarief 0 zijn
 * acquisitie, administratie, garantie en dergelijke: wel gewerkt, niet betaald.
 */
(function (global) {
  const DECLARABEL = (r) => (r.tarief || 0) > 0;

  const rond = (x, n = 2) => {
    const f = 10 ** n;
    return Math.round(x * f) / f;
  };

  function dagSleutel(d) {
    const dt = d instanceof Date ? d : new Date(d);
    return `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;
  }

  /**
   * Kerncijfers over een set regels: uren, omzet, declarabiliteit en de twee
   * tarieven die er echt toe doen — het gemiddelde over de betaalde uren, en
   * wat je per gewerkt uur overhoudt als je de onbetaalde uren meetelt.
   */
  function kerncijfers(rows) {
    let uren = 0;
    let urenBetaald = 0;
    let omzet = 0;
    const dagen = new Set();
    for (const r of rows) {
      const u = r.uren || 0;
      uren += u;
      omzet += r.bedrag || 0;
      if (DECLARABEL(r)) urenBetaald += u;
      if (r.datum) dagen.add(dagSleutel(r.datum));
    }
    const urenOnbetaald = rond(uren - urenBetaald);
    return {
      uren: rond(uren),
      urenBetaald: rond(urenBetaald),
      urenOnbetaald,
      omzet: rond(omzet),
      dagen: dagen.size,
      regels: rows.length,
      declarabel: uren > 0 ? rond((urenBetaald / uren) * 100, 1) : null,
      gemTarief: urenBetaald > 0 ? rond(omzet / urenBetaald) : null,
      effectiefTarief: uren > 0 ? rond(omzet / uren) : null,
      urenPerDag: dagen.size ? rond(uren / dagen.size) : null,
    };
  }

  /** Onbetaalde uren gebundeld op werkzaamheden (of een ander veld), grootste eerst. */
  function onbetaaldPer(rows, veld = "werkzaamheden", topN = 6) {
    const per = new Map();
    let totaal = 0;
    for (const r of rows) {
      if (DECLARABEL(r)) continue;
      const naam = (r[veld] || "").trim() || "(leeg)";
      per.set(naam, (per.get(naam) || 0) + (r.uren || 0));
      totaal += r.uren || 0;
    }
    const lijst = [...per.entries()]
      .map(([naam, uren]) => ({ naam, uren: rond(uren) }))
      .sort((a, b) => b.uren - a.uren);
    return { totaal: rond(totaal), top: lijst.slice(0, topN), aantal: lijst.length };
  }

  /**
   * Ranglijst per opdrachtgever of project: uren, omzet, declarabiliteit en het
   * effectieve tarief. Zo zie je welke klant onbetaalde tijd kost.
   */
  function ranglijst(rows, veld = "opdrachtgever", topN = 8) {
    const per = new Map();
    for (const r of rows) {
      const naam = (r[veld] || "").trim() || "(geen)";
      const s = per.get(naam) || { naam, uren: 0, urenBetaald: 0, omzet: 0 };
      s.uren += r.uren || 0;
      s.omzet += r.bedrag || 0;
      if (DECLARABEL(r)) s.urenBetaald += r.uren || 0;
      per.set(naam, s);
    }
    const totaalUren = [...per.values()].reduce((s, x) => s + x.uren, 0);
    return [...per.values()]
      .map((s) => ({
        naam: s.naam,
        uren: rond(s.uren),
        omzet: rond(s.omzet),
        declarabel: s.uren > 0 ? rond((s.urenBetaald / s.uren) * 100, 0) : null,
        effectiefTarief: s.uren > 0 ? rond(s.omzet / s.uren) : null,
        aandeel: totaalUren > 0 ? rond((s.uren / totaalUren) * 100, 1) : 0,
      }))
      .sort((a, b) => b.uren - a.uren)
      .slice(0, topN);
  }

  /** Uren en omzet per maand van één jaar. */
  function maandCijfers(rows, jaar) {
    const maanden = Array.from({ length: 12 }, () => ({ uren: 0, omzet: 0, dagen: new Set() }));
    for (const r of rows) {
      const d = r.datum instanceof Date ? r.datum : new Date(r.datum);
      if (!d || d.getFullYear() !== jaar) continue;
      const m = maanden[d.getMonth()];
      m.uren += r.uren || 0;
      m.omzet += r.bedrag || 0;
      if (r.datum) m.dagen.add(dagSleutel(r.datum));
    }
    return maanden.map((m) => ({
      uren: rond(m.uren),
      omzet: rond(m.omzet),
      dagen: m.dagen.size,
    }));
  }

  /**
   * Jaarprognose: uren en omzet tot nu toe doorgetrokken naar een heel jaar,
   * plus waar het urencriterium (1225 uur) op uitkomt. Een afgesloten jaar
   * geeft gewoon het werkelijke cijfer terug.
   */
  function jaarPrognose(rows, jaar, doelUren = 1225, nu = new Date()) {
    const maanden = maandCijfers(rows, jaar);
    const uren = rond(maanden.reduce((s, m) => s + m.uren, 0));
    const omzet = rond(maanden.reduce((s, m) => s + m.omzet, 0));
    const huidig = nu.getFullYear();
    let deel = 1;
    if (jaar === huidig) {
      const start = new Date(jaar, 0, 1).getTime();
      const eind = new Date(jaar + 1, 0, 1).getTime();
      const nuMs = new Date(nu.getFullYear(), nu.getMonth(), nu.getDate()).getTime();
      deel = Math.min(1, Math.max(1 / 365, (nuMs - start) / (eind - start)));
    } else if (jaar > huidig) {
      deel = 0;
    }
    const factor = deel > 0 ? 1 / deel : 0;
    const urenJaar = rond(uren * factor);
    return {
      isPrognose: jaar >= huidig,
      deel,
      urenTotNu: uren,
      omzetTotNu: omzet,
      uren: urenJaar,
      omzet: rond(omzet * factor),
      doelUren,
      haaltCriterium: urenJaar >= doelUren,
      urenTekort: rond(Math.max(0, doelUren - urenJaar)),
    };
  }

  global.UrenInzichten = {
    kerncijfers,
    onbetaaldPer,
    ranglijst,
    maandCijfers,
    jaarPrognose,
    isDeclarabel: DECLARABEL,
  };
})(window);
