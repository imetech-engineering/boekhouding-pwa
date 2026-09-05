/**
 * Laatst ingelezen gegevens lokaal bewaren (IndexedDB), zodat de app meteen
 * met je cijfers opent — ook zonder verbinding. De cloud blijft de waarheid:
 * na het tonen ververst de app op de achtergrond en overschrijft de cache.
 */
(function (global) {
  const DB_NAME = "imtech-uren-cache";
  const STORE = "snapshot";
  const DB_VERSION = 1;

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
    });
  }

  /** Snapshot bewaren; stilletjes overslaan als opslag niet kan (privémodus). */
  async function bewaar(sleutel, waarde) {
    try {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put({ ...waarde, bewaardOp: Date.now() }, sleutel);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch (_) {
      /* geen cache is niet erg, de app werkt gewoon door */
    }
  }

  async function lees(sleutel) {
    try {
      const db = await openDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(sleutel);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch (_) {
      return null;
    }
  }

  async function wis(sleutel) {
    try {
      const db = await openDb();
      await new Promise((resolve) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(sleutel);
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });
    } catch (_) {}
  }

  global.UrenCache = { bewaar, lees, wis };
})(window);
