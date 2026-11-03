/**
 * MSAL browser auth (OAuth 2.0 PKCE) voor Microsoft Graph.
 * Tokens/account in localStorage zodat de PWA ingelogd blijft na herstart.
 */
(function (global) {
  function getConfig() {
    const c = global.BOEK_CONFIG;
    if (!c?.azure?.clientId || c.azure.clientId.startsWith("YOUR_")) {
      throw new Error(
        "config.js ontbreekt of is niet ingevuld. Kopieer config.example.js naar config.js."
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
        cacheLocation: "localStorage",
        storeAuthStateInCookie: true,
      },
    });
  }

  function pickAccount(instance) {
    return instance.getActiveAccount() || instance.getAllAccounts()[0] || null;
  }

  function ensureActiveAccount(instance) {
    const acc = pickAccount(instance);
    if (acc && !instance.getActiveAccount()) {
      instance.setActiveAccount(acc);
    }
    return acc;
  }

  async function getMsal() {
    if (!msalInstance) {
      msalInstance = createMsal();
      await msalInstance.initialize();
      const resp = await msalInstance.handleRedirectPromise();
      if (resp?.account) {
        msalInstance.setActiveAccount(resp.account);
      } else {
        ensureActiveAccount(msalInstance);
      }
    }
    return msalInstance;
  }

  function activeAccount() {
    if (!msalInstance) return null;
    return pickAccount(msalInstance);
  }

  async function login() {
    const instance = await getMsal();
    const scopes = getConfig().graph.scopes;
    try {
      const result = await instance.loginPopup({ scopes, prompt: "select_account" });
      if (result?.account) {
        instance.setActiveAccount(result.account);
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
    if (account) {
      await instance.logoutPopup({ account });
    }
    instance.setActiveAccount(null);
  }

  /**
   * Inlogfout als eigen soort, zodat de app een wijziging dan bewaart in de
   * wachtrij in plaats van hem weg te gooien (bijv. verlopen sessie na een dag
   * offline, of een geblokkeerde popup tijdens het wegwerken op de achtergrond).
   */
  function authFout(message, cause) {
    const e = new Error(message);
    e.name = "AuthError";
    e.cause = cause;
    return e;
  }

  async function acquireToken() {
    const instance = await getMsal();
    const scopes = getConfig().graph.scopes;
    const account = ensureActiveAccount(instance);
    if (!account) {
      throw authFout("Niet ingelogd. Log in via Overzicht → Microsoft-account.");
    }
    try {
      const silent = await instance.acquireTokenSilent({ scopes, account });
      return silent.accessToken;
    } catch (e) {
      // Zonder netwerk is het geen inlogprobleem: dan gewoon offline wachten.
      if (typeof navigator !== "undefined" && navigator.onLine === false) throw e;
      try {
        const interactive = await instance.acquireTokenPopup({ scopes, account });
        return interactive.accessToken;
      } catch (e2) {
        throw authFout(
          `Opnieuw inloggen nodig (${e2?.errorCode || e2?.message || "inloggen mislukt"}).`,
          e2
        );
      }
    }
  }

  function getAccountLabel() {
    const acc = activeAccount();
    return acc?.username || acc?.name || null;
  }

  function isLoggedIn() {
    if (!msalInstance) return false;
    return msalInstance.getAllAccounts().length > 0;
  }

  global.BoekAuth = {
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
