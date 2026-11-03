/**
 * Inzicht-tab: offertes als "kansen", conversie, inschatting vs. werkelijk en het
 * gerealiseerde tarief. Alleen rekenwerk; het tekenen gebeurt in app.js.
 *
 * Bronnen (niets nieuws, alles bestaat al):
 *   - Ureninschattingen (Excel): één rij per kans. Kolom Offerte = offertenummer(s)
 *     of "mail" (prijsindicatie per mail). Status bepaalt de uitkomst. Kolommen
 *     Bron en Reden zet de app zelf achter de tabel.
 *   - Offertes van de projectdoc-bridge (zelfde cache als de vaste prijs): datum,
 *     klant en totaalbedrag per offertenummer.
 *   - Het gerealiseerde tarief komt uit UrenVastePrijs.tarieven (zelfde map als de
 *     Analyse-tab), zodat er maar één manier van rekenen is.
 */
(function (global) {
  const NR = /\b((?:OF|PR)\d{6})\b/gi;
  const DOEL_TARIEF = 80; // uurtarief waarmee Ivo offreert
  const STIL_NA_DAGEN = 90; // open kans zonder uitkomst: telt als "stil"
  const OPVOLGEN_NA_DAGEN = 14;
  const MIN_GROEP = 4; // pas iets zeggen over een groep vanaf zoveel beslisten

  const UITKOMST = {
    "Afgerond": "gewonnen",
    "In opdracht": "gewonnen",
    "Regie": "gewonnen",
    "Geannuleerd": "verloren",
    "On hold": "open",
    "Wachten op akkoord": "open",
  };

  const BRONNEN = ["Website (formulier)", "Fiverr / platform", "LinkedIn", "Netwerk / doorverwijzing", "Bestaande klant", "Onbekend"];
  const REDENEN = ["Prijs", "Concurrent", "Zelf doen", "Klant stopt", "Geen reactie", "On hold (klant)", "Anders"];

  const rond = (x, n = 0) => {
    const f = 10 ** n;
    return Math.round(x * f) / f;
  };

  function nummers(tekst) {
    const uit = [];
    for (const m of String(tekst || "").matchAll(NR)) {
      const n = m[1].toUpperCase();
      if (!uit.includes(n)) uit.push(n);
    }
    return uit;
  }

  const viaMail = (tekst) => /\bmail\b/i.test(String(tekst || ""));

  function dagenSinds(iso, nu) {
    if (!iso) return null;
    const d = new Date(String(iso).slice(0, 10) + "T12:00:00");
    if (Number.isNaN(d.getTime())) return null;
    return Math.max(0, Math.floor((nu.getTime() - d.getTime()) / 86400000));
  }

  /**
   * Alle kansen uit Ureninschattingen (rijen met een offertenummer of "mail"), plus de
   * offertes uit projectdoc die nog in geen enkele rij staan.
   * → { kansen: [...], los: [offerte, ...] }
   */
  function kansen(estimates, geld, nu = new Date()) {
    const perNr = new Map();
    for (const o of geld?.offertes || []) perNr.set(String(o.nummer || "").toUpperCase(), o);
    const gebruikt = new Set();
    const uit = [];
    for (const e of estimates || []) {
      const nrs = nummers(e.offerte);
      const mail = viaMail(e.offerte);
      if (!nrs.length && !mail) continue; // geen offerte: regie of intern, geen kans
      nrs.forEach((n) => gebruikt.add(n));
      // Bij meerdere versies telt de nieuwste.
      const bekend = nrs.map((n) => perNr.get(n)).filter(Boolean);
      bekend.sort((a, b) => String(a.datum || "").localeCompare(String(b.datum || "")));
      const laatste = bekend[bekend.length - 1] || null;
      const bedrag = Number(laatste?.totaalExcl) > 0 ? Number(laatste.totaalExcl) : Number(e.offerteUren) > 0 ? Number(e.offerteUren) : null;
      const datum = laatste?.datum || e.datumStr || "";
      const uitkomst = UITKOMST[e.status] || "open";
      const dagen = dagenSinds(datum, nu);
      uit.push({
        project: e.project,
        // In de urenadministratie staat soms "IMeTech" als opdrachtgever; dan is de klant uit de offerte duidelijker.
        opdrachtgever: (!e.opdrachtgever || /^imetech$/i.test(e.opdrachtgever)) && laatste?.klant ? laatste.klant : e.opdrachtgever || "",
        nummers: nrs,
        laatsteNummer: laatste?.nummer || nrs[nrs.length - 1] || null,
        viaMail: mail && !nrs.length,
        datum,
        bedrag,
        status: e.status,
        uitkomst,
        stil: uitkomst === "open" && dagen != null && dagen >= STIL_NA_DAGEN,
        opvolgen: uitkomst === "open" && e.status === "Wachten op akkoord" && dagen != null && dagen >= OPVOLGEN_NA_DAGEN,
        dagen,
        reden: e.reden || "",
        bron: e.bron || "",
        geschat: Number(e.ureninschatting) || 0,
        gemaakt: Number(e.gemaakte_uren) || 0,
        est: e,
      });
    }
    const los = (geld?.offertes || [])
      .filter((o) => /^OF/i.test(o.nummer || "") && !gebruikt.has(String(o.nummer).toUpperCase()))
      .filter((o) => o.status !== "vervangen") // oudere versie van een offerte die wel in je register staat
      .sort((a, b) => String(b.datum || "").localeCompare(String(a.datum || "")));
    return { kansen: uit, los };
  }

  function telling(lijst) {
    const gewonnen = lijst.filter((k) => k.uitkomst === "gewonnen");
    const verloren = lijst.filter((k) => k.uitkomst === "verloren");
    const som = (l) => rond(l.reduce((s, k) => s + (k.bedrag || 0), 0));
    const beslist = gewonnen.length + verloren.length;
    const wG = som(gewonnen);
    const wV = som(verloren);
    return {
      n: lijst.length,
      gewonnen: gewonnen.length,
      verloren: verloren.length,
      open: lijst.filter((k) => k.uitkomst === "open").length,
      beslist,
      pct: beslist ? rond((gewonnen.length / beslist) * 100) : null,
      waardeGewonnen: wG,
      waardeVerloren: wV,
      pctWaarde: wG + wV > 0 ? rond((wG / (wG + wV)) * 100) : null,
    };
  }

  /** Kerncijfers. "Stil" = open en ouder dan 90 dagen; die tellen apart, niet als verloren. */
  function samenvatting(lijst) {
    const t = telling(lijst);
    const open = lijst.filter((k) => k.uitkomst === "open");
    const stil = open.filter((k) => k.stil).length;
    return {
      ...t,
      stil,
      // Strenger: stille kansen tellen als verloren.
      pctInclStil: t.beslist + stil ? rond((t.gewonnen / (t.beslist + stil)) * 100) : null,
      waardeOpen: rond(open.filter((k) => !k.stil).reduce((s, k) => s + (k.bedrag || 0), 0)),
      zonderBron: lijst.filter((k) => !k.bron).length,
      verlorenZonderReden: lijst.filter((k) => k.uitkomst === "verloren" && !k.reden).length,
    };
  }

  function bedragKlasse(b) {
    if (!(b > 0)) return "Onbekend bedrag";
    if (b < 1000) return "Onder € 1.000";
    if (b < 2500) return "€ 1.000 tot € 2.500";
    if (b < 4000) return "€ 2.500 tot € 4.000";
    return "€ 4.000 en meer";
  }
  const KLASSE_VOLGORDE = ["Onder € 1.000", "€ 1.000 tot € 2.500", "€ 2.500 tot € 4.000", "€ 4.000 en meer", "Onbekend bedrag"];

  function halfjaar(iso) {
    const m = /^(\d{4})-(\d{2})/.exec(iso || "");
    return m ? `${m[1]} H${+m[2] <= 6 ? 1 : 2}` : "Onbekend";
  }

  /** Conversie per groep, alleen over beslist (gewonnen + verloren). */
  function perGroep(lijst, sleutel, volgorde = null) {
    const groepen = new Map();
    for (const k of lijst) {
      if (k.uitkomst === "open") continue;
      const g = sleutel(k) || "Niet ingevuld";
      (groepen.get(g) || groepen.set(g, []).get(g)).push(k);
    }
    const rijen = [...groepen.entries()].map(([groep, l]) => ({ groep, ...telling(l), genoeg: l.length >= MIN_GROEP }));
    if (volgorde) rijen.sort((a, b) => volgorde.indexOf(a.groep) - volgorde.indexOf(b.groep));
    else rijen.sort((a, b) => b.beslist - a.beslist || a.groep.localeCompare(b.groep));
    return rijen;
  }

  const groepen = {
    bron: (l) => perGroep(l, (k) => k.bron, [...BRONNEN, "Niet ingevuld"]),
    bedrag: (l) => perGroep(l, (k) => bedragKlasse(k.bedrag), KLASSE_VOLGORDE),
    periode: (l) => perGroep(l, (k) => halfjaar(k.datum)).sort((a, b) => a.groep.localeCompare(b.groep)),
  };

  /** Waarom verloren: aantal en waarde per reden. */
  function redenen(lijst) {
    const per = new Map();
    for (const k of lijst) {
      if (k.uitkomst !== "verloren") continue;
      const r = k.reden || "Niet ingevuld";
      const s = per.get(r) || { reden: r, n: 0, waarde: 0, kansen: [] };
      s.n += 1;
      s.waarde += k.bedrag || 0;
      s.kansen.push(k);
      per.set(r, s);
    }
    return [...per.values()].sort((a, b) => b.n - a.n).map((s) => ({ ...s, waarde: rond(s.waarde) }));
  }

  /** Open kansen, langst wachtend eerst. */
  function openKansen(lijst) {
    return lijst.filter((k) => k.uitkomst === "open").sort((a, b) => (b.dagen ?? 0) - (a.dagen ?? 0));
  }

  /**
   * Inschatting vs. werkelijk over afgeronde projecten met een inschatting.
   * factor = gemaakt ÷ geschat (1,2 = 20% uitgelopen).
   */
  function inschatting(estimates) {
    const rijen = (estimates || [])
      .filter((e) => e.status === "Afgerond" && Number(e.ureninschatting) > 0 && Number(e.gemaakte_uren) > 0)
      .map((e) => {
        const geschat = Number(e.ureninschatting);
        const gemaakt = Number(e.gemaakte_uren);
        return { project: e.project, geschat, gemaakt, factor: gemaakt / geschat, afwijking: rond(((gemaakt - geschat) / geschat) * 100) };
      })
      .sort((a, b) => b.afwijking - a.afwijking);
    if (!rijen.length) return { rijen, n: 0 };
    const geschat = rijen.reduce((s, r) => s + r.geschat, 0);
    const gemaakt = rijen.reduce((s, r) => s + r.gemaakt, 0);
    const factoren = rijen.map((r) => r.factor).sort((a, b) => a - b);
    const mediaan = factoren.length % 2 ? factoren[(factoren.length - 1) / 2] : (factoren[factoren.length / 2 - 1] + factoren[factoren.length / 2]) / 2;
    const grootte = (g) => (g < 20 ? "Klein (onder 20 u)" : g < 50 ? "Middel (20 tot 50 u)" : "Groot (50 u en meer)");
    const perGrootte = ["Klein (onder 20 u)", "Middel (20 tot 50 u)", "Groot (50 u en meer)"]
      .map((naam) => {
        const l = rijen.filter((r) => grootte(r.geschat) === naam);
        if (!l.length) return null;
        const gs = l.reduce((s, r) => s + r.geschat, 0);
        const gm = l.reduce((s, r) => s + r.gemaakt, 0);
        return { naam, n: l.length, afwijking: rond(((gm - gs) / gs) * 100) };
      })
      .filter(Boolean);
    return {
      rijen,
      n: rijen.length,
      geschat: rond(geschat, 1),
      gemaakt: rond(gemaakt, 1),
      totaalAfwijking: rond(((gemaakt - geschat) / geschat) * 100),
      mediaanAfwijking: rond((mediaan - 1) * 100),
      uitgelopen: rijen.filter((r) => r.afwijking > 10).length,
      meeGevallen: rijen.filter((r) => r.afwijking < -10).length,
      perGrootte,
    };
  }

  /**
   * Gerealiseerd tarief van afgeronde vaste-prijsprojecten, uit de vaste-prijsmap
   * (UrenVastePrijs.tarieven) die ook de Analyse-tab gebruikt.
   *   geoffreerd   = urendeel offerte ÷ ingeschatte uren (wat je bedoelde te verdienen)
   *   gerealiseerd = urendeel offerte ÷ gemaakte uren (wat je echt verdiende)
   * Misgelopen = uitgelopen uren × geoffreerd tarief; dat los je op met beter inschatten.
   * Onder doel = geoffreerd onder je normale uurtarief; dat is een prijskeuze.
   */
  function tarieven(vpMap, doel = DOEL_TARIEF) {
    const rijen = [];
    for (const v of vpMap?.values?.() || []) {
      if (v.est?.status !== "Afgerond" || !(v.gemaakt > 0)) continue;
      const geoffreerd = v.geschat > 0 ? rond(v.bedrag / v.geschat, 2) : null;
      rijen.push({
        project: v.est.project,
        tarief: v.tarief,
        geoffreerd,
        bedrag: v.bedrag,
        gemaakt: v.gemaakt,
        geschat: v.geschat,
        onderDoel: geoffreerd != null && geoffreerd < doel - 0.5,
        misgelopen: geoffreerd != null ? Math.max(0, (v.gemaakt - v.geschat) * geoffreerd) : 0,
      });
    }
    rijen.sort((a, b) => a.tarief - b.tarief);
    const bedrag = rijen.reduce((s, r) => s + r.bedrag, 0);
    const uren = rijen.reduce((s, r) => s + r.gemaakt, 0);
    const metSchatting = rijen.filter((r) => r.geschat > 0);
    const geschat = metSchatting.reduce((s, r) => s + r.geschat, 0);
    return {
      rijen,
      doel,
      gemiddeld: uren > 0 ? rond(bedrag / uren) : null,
      geoffreerd: geschat > 0 ? rond(metSchatting.reduce((s, r) => s + r.bedrag, 0) / geschat) : null,
      onderDoel: rijen.filter((r) => r.onderDoel).length,
      misgelopen: rond(rijen.reduce((s, r) => s + r.misgelopen, 0)),
    };
  }

  /**
   * Wat valt op: korte, eerlijke zinnen uit de cijfers. Alleen groepen met genoeg
   * beslisten, en altijd met het aantal erbij.
   */
  function watValtOp(lijst, insch, tar) {
    const uit = [];
    const s = samenvatting(lijst);
    if (s.beslist) {
      uit.push({ soort: "info", tekst: `${s.gewonnen} van ${s.beslist} beslist gewonnen (${s.pct}%), op waarde ${s.pctWaarde ?? "—"}%.` });
    }
    const vergelijk = (rijen, wat) => {
      const ok = rijen.filter((r) => r.genoeg && r.groep !== "Niet ingevuld" && r.groep !== "Onbekend bedrag");
      if (ok.length < 2) return;
      const best = ok.reduce((a, b) => (b.pct > a.pct ? b : a));
      const slechtst = ok.reduce((a, b) => (b.pct < a.pct ? b : a));
      if (best.pct - slechtst.pct >= 20) {
        uit.push({ soort: "do", tekst: `${wat} ${best.groep}: ${best.pct}% gewonnen (${best.gewonnen} van ${best.beslist}).` });
        uit.push({ soort: "dont", tekst: `${wat} ${slechtst.groep}: ${slechtst.pct}% gewonnen (${slechtst.gewonnen} van ${slechtst.beslist}).` });
      }
    };
    vergelijk(groepen.bedrag(lijst), "Offertes");
    vergelijk(groepen.bron(lijst), "Via");
    const red = redenen(lijst).filter((r) => r.reden !== "Niet ingevuld");
    if (red.length) uit.push({ soort: "dont", tekst: `Meest verloren op: ${red[0].reden.toLowerCase()} (${red[0].n}x, samen € ${red[0].waarde.toLocaleString("nl-NL")}).` });
    const stil = lijst.filter((k) => k.stil);
    if (stil.length) uit.push({ soort: "actie", tekst: `${stil.length} ${stil.length === 1 ? "kans staat" : "kansen staan"} langer dan ${STIL_NA_DAGEN} dagen open: afsluiten of nog één keer bellen. Tel je ze als verloren, dan is je conversie ${s.pctInclStil}%.` });
    const opv = lijst.filter((k) => k.opvolgen && !k.stil);
    if (opv.length) uit.push({ soort: "actie", tekst: `${opv.length} offerte${opv.length === 1 ? "" : "s"} wacht${opv.length === 1 ? "" : "en"} langer dan ${OPVOLGEN_NA_DAGEN} dagen op akkoord.` });
    if (insch?.n >= MIN_GROEP) {
      const m = insch.mediaanAfwijking;
      if (m > 5) uit.push({ soort: "dont", tekst: `Je loopt meestal uit: mediaan ${m}% meer uren dan ingeschat (${insch.n} projecten).` });
      else if (m < -5) uit.push({ soort: "do", tekst: `Je schat meestal ruim in: mediaan ${-m}% minder uren dan ingeschat (${insch.n} projecten).` });
      const groot = insch.perGrootte.filter((g) => g.n >= 3).sort((a, b) => b.afwijking - a.afwijking)[0];
      if (groot && groot.afwijking > 15) uit.push({ soort: "dont", tekst: `${groot.naam}: samen ${groot.afwijking}% uitgelopen (${groot.n} projecten). Reken daar een opslag in.` });
    }
    if (tar?.rijen?.length >= MIN_GROEP) {
      if (tar.geoffreerd != null && tar.geoffreerd < tar.doel) {
        uit.push({ soort: "dont", tekst: `Je offreert vaste prijzen gemiddeld op € ${tar.geoffreerd}/u en haalt € ${tar.gemiddeld}/u (doel € ${tar.doel}); ${tar.onderDoel} van ${tar.rijen.length} offertes zaten al onder je doel.` });
      }
      if (tar.misgelopen > 0) {
        uit.push({ soort: "dont", tekst: `Uitlopen op vaste prijzen kostte je ca. € ${tar.misgelopen.toLocaleString("nl-NL")} (uitgelopen uren × geoffreerd tarief).` });
      }
    }
    if (s.zonderBron) uit.push({ soort: "actie", tekst: `${s.zonderBron} kans${s.zonderBron === 1 ? "" : "en"} zonder bron: vul die in, dan zie je waar je goede klanten vandaan komen.` });
    return uit;
  }

  global.UrenOffertes = {
    BRONNEN,
    REDENEN,
    DOEL_TARIEF,
    STIL_NA_DAGEN,
    UITKOMST,
    nummers,
    kansen,
    samenvatting,
    groepen,
    redenen,
    openKansen,
    inschatting,
    tarieven,
    watValtOp,
    bedragKlasse,
  };
})(typeof window !== "undefined" ? window : globalThis);
