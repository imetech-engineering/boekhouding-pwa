/**
 * Copy to config.js and fill in your Azure app registration values.
 * Do not commit config.js (add to .gitignore if the repo is public).
 */
window.UREN_CONFIG = {
  azure: {
    clientId: "YOUR_AZURE_APPLICATION_CLIENT_ID",
    /** Must match exactly the redirect URI in Azure (SPA platform). */
    authority: "https://login.microsoftonline.com/common",
    /**
     * Default: current page URL (works for localhost and GitHub Pages).
     * GitHub Pages (project site): register in Azure e.g.
     *   https://<GITHUB_GEBRUIKERSNAAM>.github.io/<REPO_NAAM>/
     *   https://<GITHUB_GEBRUIKERSNAAM>.github.io/<REPO_NAAM>/index.html
     * Override only if you need a fixed URI:
     * redirectUri: "https://<GITHUB_GEBRUIKERSNAAM>.github.io/<REPO_NAAM>/",
     */
    redirectUri: window.location.origin + window.location.pathname,
  },
  graph: {
    scopes: ["User.Read", "Files.ReadWrite"],
    /**
     * Path relative to your OneDrive root (same file as desktop EXCEL_PATH).
     * If Graph returns 404, try without the "OneDrive - …" prefix, e.g. only:
     * "02 Boekhouding/04 Urenadministratie/urenadministratie_2025.xlsx"
     */
    drivePath:
      "OneDrive - IMeTech Engineering/02 Boekhouding/04 Urenadministratie/urenadministratie_2025.xlsx",
  },
};