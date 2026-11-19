// De oude app is gestopt: opgeslagen kopieen van de oude schermen opruimen, zodat niemand er nog per ongeluk in boekt.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(() => {});
if (window.caches) caches.keys().then(namen => namen.forEach(n => caches.delete(n))).catch(() => {});
