/**
 * Copy to config.js and fill in your Azure app registration values.
 * config.js may be committed (SPA client IDs are not secrets) — required for GitHub Pages.
 */
window.UREN_CONFIG = {
  azure: {
    clientId: "YOUR_AZURE_APPLICATION_CLIENT_ID",
    /** tenantId 'common' — personal + work/school Microsoft accounts */
    authority: "https://login.microsoftonline.com/common",
    /**
     * Default: current page URL (works for localhost and GitHub Pages).
     * GitHub Pages (project site) — register in Azure e.g. imetech-engineering/uren-pwa:
     *   https://imetech-engineering.github.io/uren-pwa/
     *   https://imetech-engineering.github.io/uren-pwa/index.html
     * Local dev: http://localhost:8080/
     * Override only if you need a fixed URI:
     * redirectUri: "https://imetech-engineering.github.io/uren-pwa/",
     */
    redirectUri: window.location.origin + window.location.pathname,
  },
  graph: {
    scopes: ["User.Read", "Files.ReadWrite"],
    /**
     * Path relative to your OneDrive root (same file as desktop EXCEL_PATH).
     * Primary (without sync folder prefix):
     * "02 Boekhouding/04 Urenadministratie/urenadministratie_2025.xlsx"
     * If Graph returns 404, try with prefix:
     * "OneDrive - IMeTech Engineering/02 Boekhouding/04 Urenadministratie/urenadministratie_2025.xlsx"
     */
    drivePath:
      "02 Boekhouding/04 Urenadministratie/urenadministratie_2025.xlsx",
  },
};
