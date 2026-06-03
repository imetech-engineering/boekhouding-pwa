/**
 * Azure + OneDrive config for IMeTech Uren PWA.
 * SPA client IDs are public — safe to commit for GitHub Pages deploy.
 */
window.UREN_CONFIG = {
  azure: {
    clientId: "9e9bd8db-fc64-46e2-ac72-bf786fff11a6",
    /**
     * Single tenant (IMeTech only). Fill TENANT_ID from Azure Portal →
     * Microsoft Entra ID → Overview → Tenant ID (Directory ID).
     */
    tenantId: "TENANT_ID",
    authority: "https://login.microsoftonline.com/TENANT_ID",
    /**
     * Must match exactly a SPA redirect URI registered in Azure.
     * Dynamic: works on GitHub Pages and localhost without editing.
     * Production site: https://imetech-engineering.github.io/uren-pwa/
     */
    redirectUri: window.location.origin + window.location.pathname,
  },
  graph: {
    scopes: ["User.Read", "Files.ReadWrite"],
    /**
     * Path relative to OneDrive root (Graph /me/drive/root:/…).
     * Primary (without sync folder prefix):
     */
    drivePath:
      "02 Boekhouding/04 Urenadministratie/urenadministratie_2025.xlsx",
    /**
     * If Graph returns 404, try with OneDrive sync prefix instead:
     * "OneDrive - IMeTech Engineering/02 Boekhouding/04 Urenadministratie/urenadministratie_2025.xlsx"
     */
  },
};
