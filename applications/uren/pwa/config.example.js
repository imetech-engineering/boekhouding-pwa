/**
 * Copy to config.js and fill in your Azure app registration values.
 * config.js may be committed (SPA client IDs are not secrets) — required for GitHub Pages.
 */
window.UREN_CONFIG = {
  azure: {
    clientId: "YOUR_AZURE_APPLICATION_CLIENT_ID",
    /**
     * Single tenant (org accounts only). From Azure Portal → Entra ID → Overview → Tenant ID.
     */
    tenantId: "TENANT_ID",
    authority: "https://login.microsoftonline.com/TENANT_ID",
    redirectUri:
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1"
        ? `${window.location.origin}/`
        : "https://imetech-engineering.github.io/uren-pwa/",
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
