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
        : "https://imetech-engineering.github.io/uren-pwa/",
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
