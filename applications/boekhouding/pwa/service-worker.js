/**
 * Service worker — network-first voor same-origin (updates komen direct door),
 * cache als offline-fallback. Verbetering t.o.v. uren-PWA (cache-first + handmatige bump).
 */
const CACHE = "imtech-boekhouding-pwa-v12";
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
  "./js/scanner.js",
  "./js/reiskosten.js",
  "./js/combobox.js",
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
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // Graph/CDN altijd netwerk
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }))
  );
});
