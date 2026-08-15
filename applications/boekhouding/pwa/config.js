/**
 * Azure + OneDrive config voor IMeTech Boekhouding PWA.
 * SPA client IDs zijn publiek — veilig om te committen voor GitHub Pages deploy.
 * Zelfde app-registratie als de uren-PWA; alleen extra SPA redirect URI nodig in Azure.
 */
window.BOEK_CONFIG = {
  azure: {
    clientId: "9e9bd8db-fc64-46e2-ac72-bf786fff11a6",
    tenantId: "50f49575-354b-41c2-b187-df1a6c2e92d3",
    authority: "https://login.microsoftonline.com/50f49575-354b-41c2-b187-df1a6c2e92d3",
    /**
     * Vaste redirect URI — moet exact overeenkomen met Azure SPA-registratie.
     * Geïnstalleerde PWA opent vaak /index.html; daarom niet dynamisch via pathname.
     */
    redirectUri:
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1"
        ? `${window.location.origin}/`
        : "https://imetech-engineering.github.io/boekhouding-pwa/",
  },
  graph: {
    scopes: ["User.Read", "Files.ReadWrite"],
    /** Paden relatief t.o.v. OneDrive-root (Graph /me/drive/root:/…). */
    workbookPath: "02 Boekhouding/Boekhouding_IMeTech.xlsx",
    /** Urenwerkboek — voor reiskosten-voorstellen op basis van waar je gewerkt hebt. */
    urenPath: "02 Boekhouding/04 Urenadministratie/urenadministratie_2025.xlsx",
    urenTable: "Tabel13",
    settingsPath: "02 Boekhouding/boekhouding_pwa_settings.json",
    folders: {
      verkoopNieuw: "02 Boekhouding/01 Verkoop facturen/Facturen verkoop nog te verwerken",
      verkoopVerwerkt: "02 Boekhouding/01 Verkoop facturen/Facturen verkoop verwerkt",
      inkoopNieuw: "02 Boekhouding/02 Inkoop facturen/Facturen inkoop nog te verwerken",
      inkoopVerwerkt: "02 Boekhouding/02 Inkoop facturen/Facturen inkoop verwerkt",
    },
  },
  /** Reiskosten: geocoding/route-diensten (gratis, geen API-key). */
  reis: {
    photonUrl: "https://photon.komoot.io/api/",
    osrmUrl: "https://router.project-osrm.org/route/v1/driving/",
    /** Bias voor adres-zoeken rond Aalten. */
    biasLat: 51.925,
    biasLon: 6.581,
  },
};
