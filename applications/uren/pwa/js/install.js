/**
 * PWA install prompt — beforeinstallprompt on Android/Chrome, manual hint elsewhere.
 */
(function (global) {
  let deferredPrompt = null;
  // localStorage (niet sessionStorage): keuze/installatie moet ook ná app-herstart blijven gelden.
  const DISMISS_KEY = "uren_pwa_install_dismissed";
  const INSTALLED_KEY = "uren_pwa_installed";

  function isStandalone() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true
    );
  }

  function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }

  function markInstalled() {
    try {
      localStorage.setItem(INSTALLED_KEY, "1");
    } catch (_) {}
  }

  function isInstalled() {
    if (isStandalone()) return true;
    try {
      return localStorage.getItem(INSTALLED_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function isDismissed() {
    try {
      return localStorage.getItem(DISMISS_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function setDismissed() {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch (_) {}
  }

  // Als de app al geïnstalleerd is (of ooit geopend in standalone), nooit meer aanbieden.
  async function detectInstalled() {
    if (isStandalone()) {
      markInstalled();
      return true;
    }
    if (navigator.getInstalledRelatedApps) {
      try {
        const apps = await navigator.getInstalledRelatedApps();
        if (apps && apps.length) {
          markInstalled();
          return true;
        }
      } catch (_) {}
    }
    return isInstalled();
  }

  function showBanner() {
    const el = document.getElementById("install-banner");
    if (!el || isInstalled()) return;
    if (isDismissed()) return;
    el.classList.remove("hidden");
  }

  function hideBanner() {
    document.getElementById("install-banner")?.classList.add("hidden");
  }

  function showManualHint() {
    const manual = document.getElementById("install-manual");
    if (manual && !isInstalled()) manual.classList.remove("hidden");
  }

  async function promptInstall() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      hideBanner();
      if (outcome === "accepted") markInstalled();
      return outcome;
    }
    showManualHint();
    switchTab?.("instellingen");
    return "manual";
  }

  let switchTab = null;

  function init(onSwitchTab) {
    switchTab = onSwitchTab;

    // Altijd installeer-detectie draaien, ook in standalone — dan onthouden we het blijvend.
    detectInstalled();
    if (isInstalled()) return;

    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredPrompt = e;
      showBanner();
    });

    window.addEventListener("appinstalled", () => {
      deferredPrompt = null;
      hideBanner();
      markInstalled();
    });

    document.getElementById("btn-install")?.addEventListener("click", () => {
      promptInstall();
    });
    document.getElementById("btn-install-dismiss")?.addEventListener("click", () => {
      setDismissed();
      hideBanner();
    });
    document.getElementById("btn-install-settings")?.addEventListener("click", () => {
      promptInstall();
    });

    // Op sommige Android-browsers komt beforeinstallprompt niet; toon hint na login.
    setTimeout(() => {
      if (!deferredPrompt && !isInstalled()) showManualHint();
    }, 2500);
  }

  global.UrenInstall = {
    init,
    promptInstall,
    isStandalone,
    isInstalled,
    isIos,
    canPrompt: () => !!deferredPrompt,
  };
})(window);
