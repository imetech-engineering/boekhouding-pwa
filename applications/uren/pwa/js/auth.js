/**
 * MSAL browser auth (OAuth 2.0 PKCE) for Microsoft Graph.
 */
(function (global) {
  const STORAGE_ACCOUNT = "uren_msal_account";

  function getConfig() {
    const c = global.UREN_CONFIG;
    if (!c?.azure?.clientId || c.azure.clientId.startsWith("YOUR_")) {
      throw new Error(
        "config.js ontbreekt of is niet ingevuld. Kopieer config.example.js naar config.js."
      );
    }
    if (
      c.azure.authority?.includes("TENANT_ID") ||
      c.azure.tenantId === "TENANT_ID"
    ) {
      throw new Error(
        "Vul tenantId in config.js in (Azure Portal → Entra ID → Overview → Tenant ID)."
      );
    }
    return c;
  }

  let msalInstance = null;

  function createMsal() {
    if (typeof msal === "undefined" || !msal.PublicClientApplication) {
      throw new Error(
        "MSAL kon niet laden. Ververs de pagina (Ctrl+F5) of controleer je internetverbinding."
      );
    }
    const cfg = getConfig();
    return new msal.PublicClientApplication({
      auth: {
        clientId: cfg.azure.clientId,
        authority: cfg.azure.authority,
        redirectUri: cfg.azure.redirectUri,
      },
      cache: {
        cacheLocation: "sessionStorage",
        storeAuthStateInCookie: false,
      },
    });
  }

  async function getMsal() {
    if (!msalInstance) {
      msalInstance = createMsal();
      await msalInstance.initialize();
      const resp = await msalInstance.handleRedirectPromise();
      if (resp?.account) {
        sessionStorage.setItem(STORAGE_ACCOUNT, JSON.stringify(resp.account));
      }
    }
    return msalInstance;
  }

  function activeAccount() {
    const accounts = msalInstance?.getAllAccounts() || [];
    if (accounts.length) return accounts[0];
    try {
      const raw = sessionStorage.getItem(STORAGE_ACCOUNT);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async function login() {
    const instance = await getMsal();
    const scopes = getConfig().graph.scopes;
    try {
      const result = await instance.loginPopup({ scopes, prompt: "select_account" });
      if (result?.account) {
        sessionStorage.setItem(STORAGE_ACCOUNT, JSON.stringify(result.account));
      }
      return result;
    } catch (e) {
      if (e?.errorCode === "user_cancelled") throw e;
      await instance.loginRedirect({ scopes });
      return null;
    }
  }

  async function logout() {
    const instance = await getMsal();
    const account = activeAccount();
    sessionStorage.removeItem(STORAGE_ACCOUNT);
    if (account) {
      await instance.logoutPopup({ account });
    }
  }

  async function acquireToken() {
    const instance = await getMsal();
    const scopes = getConfig().graph.scopes;
    let account = activeAccount();
    if (!account) {
      const all = instance.getAllAccounts();
      account = all[0] || null;
    }
    if (!account) {
      throw new Error("Niet ingelogd. Log in via Instellingen.");
    }
    try {
      const silent = await instance.acquireTokenSilent({ scopes, account });
      return silent.accessToken;
    } catch (e) {
      const interactive = await instance.acquireTokenPopup({ scopes, account });
      return interactive.accessToken;
    }
  }

  function getAccountLabel() {
    const acc = activeAccount();
    return acc?.username || acc?.name || null;
  }

  function isLoggedIn() {
    return !!activeAccount() || (msalInstance?.getAllAccounts()?.length > 0);
  }

  global.UrenAuth = {
    getConfig,
    getMsal,
    login,
    logout,
    acquireToken,
    getAccountLabel,
    isLoggedIn,
    activeAccount,
  };
})(window);
