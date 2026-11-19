// De oude boekhouding-PWA is op 19-11-2026 vervangen door https://apps.imetech.nl/boekhouding/.
// Deze service worker ruimt de oude opgeslagen bestanden op en laat alles gewoon van het net komen.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const n of await caches.keys()) await caches.delete(n);
  await self.clients.claim();
  for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url).catch(() => {});
})()));
