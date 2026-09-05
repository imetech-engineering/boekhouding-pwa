/**
 * Service worker — network-first voor same-origin (updates komen direct door),
 * cache als offline-fallback. Verbetering t.o.v. uren-PWA (cache-first + handmatige bump).
 */
const CACHE = "imtech-boekhouding-pwa-v37";
const ASSETS = [
  "./",
  "./index.html",
  "./css/app.css",
  "./manifest.webmanifest",
  "./config.js",
  "./branding/logo-zwart.png",
  "./branding/logo-wit.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./js/auth.js",
  "./js/graph.js",
  "./js/workbook.js",
  "./js/boek_model.js",
  "./js/boek_io.js",
  "./js/pdf_extract.js",
  "./js/doc_finder.js",
  "./js/ocr.js",
  "./js/doc_preview.js",
  "./js/preview_pane.js",
  "./js/scanner.js",
  "./js/reiskosten.js",
  "./js/combobox.js",
  "./js/data_cache.js",
  "./js/offline_queue.js",
  "./js/install.js",
  "./js/ui_bank.js",
  "./js/ui_inkoop.js",
  "./js/ui_scan.js",
  "./js/ui_verkoop.js",
  "./js/ui_reis.js",
  "./js/ui_overzicht.js",
  "./js/app.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE && !BEWAAR_CACHES.includes(k))
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});


// Cache voor bibliotheken van de CDN (MSAL, pdf.js, tesseract). Die staan op een
// vaste versie in de URL, dus cache-first is veilig: een nieuwe versie is een
// andere URL. Deze cache overleeft een versiebump van de app.
const CDN_CACHE = "imtech-boekhouding-cdn-v1";
const CDN_HOSTS = ["cdn.jsdelivr.net", "cdnjs.cloudflare.com"];
const BEWAAR_CACHES = [CDN_CACHE, "share-inbox"];

/**
 * Same-origin: direct uit de cache (de app start meteen) en op de achtergrond
 * bijwerken, zodat de volgende start de nieuwe versie heeft.
 */
async function uitCacheEnBijwerken(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  const netwerk = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  if (cached) return cached;
  const res = await netwerk;
  return res || new Response("Offline en niet in de cache", { status: 503 });
}

/** CDN-bibliotheek: uit de cache, anders ophalen en bewaren. */
async function cdnUitCache(request) {
  const cache = await caches.open(CDN_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    // Met cors krijgen we een bruikbare (niet-ondoorzichtige) response terug.
    const res = await fetch(new Request(request.url, { mode: "cors", credentials: "omit" }));
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (_) {
    return fetch(request);
  }
}

// === Wachtrij wegwerken zodra er weer verbinding is (Background Sync) ===
// De service worker heeft zelf geen inlog-token, dus hij port de app: staat die
// ergens open, dan werkt die de wachtrij af. Is er niets open, dan een seintje
// (alleen als je meldingen al hebt toegestaan).
self.addEventListener("sync", (event) => {
  if (event.tag !== "imtech-queue-sync") return;
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (clients.length) {
        for (const c of clients) c.postMessage({ type: "flush-queue" });
        return;
      }
      if (self.registration.showNotification && Notification?.permission === "granted") {
        await self.registration.showNotification("Wijzigingen klaarzetten", {
          body: "Er staan wijzigingen in de wachtrij. Open de app om ze op te slaan.",
          icon: "./icons/icon-192.png",
          tag: "imtech-queue-sync",
        });
      }
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow("./"));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Share target: gedeelde bestanden parkeren en doorsturen naar de app
  if (event.request.method === "POST" && url.pathname.endsWith("/share-target")) {
    event.respondWith(
      (async () => {
        try {
          const formData = await event.request.formData();
          const files = formData.getAll("media").filter((f) => f && f.size);
          const cache = await caches.open("share-inbox");
          await Promise.all(
            files.map((f, i) =>
              cache.put(
                `/share-inbox/${Date.now()}-${i}`,
                new Response(f, {
                  headers: {
                    "Content-Type": f.type || "application/octet-stream",
                    "X-File-Name": encodeURIComponent(f.name || `gedeeld-${i}`),
                  },
                })
              )
            )
          );
        } catch (_) {
          /* dan opent de app gewoon leeg */
        }
        return Response.redirect("./index.html?shared=1", 303);
      })()
    );
    return;
  }

  if (event.request.method !== "GET") return;
  if (url.origin === self.location.origin) {
    event.respondWith(uitCacheEnBijwerken(event.request));
    return;
  }
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cdnUitCache(event.request));
  }
});
