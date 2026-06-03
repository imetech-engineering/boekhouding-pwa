/**
 * Shared Excel constants and invoer-intelligentie (buildIntel).
 * Read/write happens via UrenGraphExcel (Microsoft Graph Workbook API).
 */
(function (global) {
  const SHEET_NAME = "Urenadministratie";
  const TABLE_NAME = "Tabel13";
  const START_ROW = 6;

  function formatDateIso(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function bumpContextList(bucket, key, value, uren, dt) {
    if (!key || !value) return;
    if (!bucket[key]) bucket[key] = {};
    const s = bucket[key][value] || { count: 0, uren: 0, last: null };
    s.count += 1;
    s.uren += uren;
    if (!s.last || dt > s.last) s.last = dt;
    bucket[key][value] = s;
  }

  function buildIntel(entries) {
    const intel = {
      history: [...entries].reverse(),
      og_usage: {},
      proj_usage: {},
      loc_usage: {},
      projects_by_og: {},
      locaties_by_og: {},
      locaties_by_og_proj: {},
      werk_by_context: {},
      last_combo: {},
      all_opdrachtgevers: [],
      all_projects: [],
      all_locaties: [],
      all_werk: [],
      tarieven_pair: {},
    };
    const bump = (map, key, uren, dt) => {
      if (!key) return;
      if (!map[key]) map[key] = { count: 0, uren: 0, last: null };
      map[key].count += 1;
      map[key].uren += uren;
      if (!map[key].last || dt > map[key].last) map[key].last = dt;
    };
    const uniq = (arr, val) => {
      if (val && !arr.includes(val)) arr.push(val);
    };
    for (const e of entries) {
      const dt = e.datum;
      const og = e.opdrachtgever;
      const proj = e.project;
      const loc = e.locatie;
      const wz = e.werkzaamheden;
      bump(intel.og_usage, og, e.uren, dt);
      bump(intel.proj_usage, proj, e.uren, dt);
      bump(intel.loc_usage, loc, e.uren, dt);
      uniq(intel.all_opdrachtgevers, og);
      uniq(intel.all_projects, proj);
      uniq(intel.all_locaties, loc);
      if (og) {
        bumpContextList(intel.projects_by_og, og, proj, e.uren, dt);
        bumpContextList(intel.locaties_by_og, og, loc, e.uren, dt);
      }
      if (og && proj) {
        bumpContextList(intel.locaties_by_og_proj, `${og}\0${proj}`, loc, e.uren, dt);
        intel.last_combo[`${og}\0${proj}`] = e;
        intel.tarieven_pair[`${og}\0${proj}`] = e.tarief;
      }
      if (og && proj && loc && wz) {
        bumpContextList(intel.werk_by_context, `${og}\0${proj}\0${loc}`, wz, e.uren, dt);
      }
      if (wz && !intel.all_werk.includes(wz)) intel.all_werk.push(wz);
    }
    return intel;
  }

  global.UrenExcel = {
    SHEET_NAME,
    TABLE_NAME,
    START_ROW,
    buildIntel,
    formatDateIso,
  };
})(window);
