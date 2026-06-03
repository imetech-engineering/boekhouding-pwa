/**
 * PWA install prompt — beforeinstallprompt on Android/Chrome, manual hint elsewhere.
 */
(function (global) {
  let deferredPrompt = null;
  const DISMISS_KEY = "uren_pwa_install_dismissed";

  function isStandalone() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true
    );
  }

  function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }

  function showBanner() {
    const el = document.getElementById("install-banner");
    if (!el || isStandalone()) return;
    if (sessionStorage.getItem(DISMISS_KEY) === "1") return;
    el.classList.remove("hidden");
  }

  function hideBanner() {
    document.getElementById("install-banner")?.classList.add("hidden");
  }

  function showManualHint() {
    const manual = document.getElementById("install-manual");
    if (manual && !isStandalone()) manual.classList.remove("hidden");
  }

  async function promptInstall() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      hideBanner();
      if (outcome === "accepted") sessionStorage.setItem(DISMISS_KEY, "1");
      return outcome;
    }
    showManualHint();
    switchTab?.("instellingen");
    return "manual";
  }

  let switchTab = null;

  function init(onSwitchTab) {
    switchTab = onSwitchTab;
    if (isStandalone()) return;

    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredPrompt = e;
      showBanner();
    });

    window.addEventListener("appinstalled", () => {
      deferredPrompt = null;
      hideBanner();
      sessionStorage.setItem(DISMISS_KEY, "1");
    });

    document.getElementById("btn-install")?.addEventListener("click", () => {
      promptInstall();
    });
    document.getElementById("btn-install-dismiss")?.addEventListener("click", () => {
      sessionStorage.setItem(DISMISS_KEY, "1");
      hideBanner();
    });
    document.getElementById("btn-install-settings")?.addEventListener("click", () => {
      promptInstall();
    });

    // Op sommige Android-browsers komt beforeinstallprompt niet; toon hint na login.
    setTimeout(() => {
      if (!deferredPrompt && !isStandalone()) showManualHint();
    }, 2500);
  }

  global.UrenInstall = {
    init,
    promptInstall,
    isStandalone,
    isIos,
    canPrompt: () => !!deferredPrompt,
  };
})(window);
