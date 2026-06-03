/**
 * Microsoft Graph OneDrive file download/upload with etag optimistic locking.
 */
(function (global) {
  const GRAPH = "https://graph.microsoft.com/v1.0";

  function encodeDrivePath(path) {
    return path
      .split("/")
      .filter(Boolean)
      .map((seg) => encodeURIComponent(seg))
      .join("/");
  }

  function itemUrl(path) {
    const encoded = encodeDrivePath(path);
    return `${GRAPH}/me/drive/root:/${encoded}`;
  }

  class GraphConflictError extends Error {
    constructor(message) {
      super(message);
      this.name = "GraphConflictError";
    }
  }

  class GraphLockError extends Error {
    constructor(message) {
      super(message);
      this.name = "GraphLockError";
    }
  }

  async function graphFetch(path, token, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    });
    return res;
  }

  async function getDriveItemMeta(drivePath, token) {
    const res = await graphFetch(`${itemUrl(drivePath)}`, token);
    if (res.status === 404) {
      throw new Error(
        `Bestand niet gevonden op OneDrive:\n${drivePath}\n\nPas drivePath in config.js aan.`
      );
    }
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Graph metadata mislukt (${res.status}): ${t}`);
    }
    const json = await res.json();
    return {
      id: json.id,
      etag: json.eTag || json["@odata.etag"],
      name: json.name,
      webUrl: json.webUrl,
      lastModified: json.lastModifiedDateTime,
    };
  }

  async function downloadWorkbook(drivePath, token) {
    const meta = await getDriveItemMeta(drivePath, token);
    const res = await graphFetch(`${itemUrl(drivePath)}:/content`, token);
    if (!res.ok) {
      const t = await res.text();
      if (res.status === 423 || res.status === 409) {
        throw new GraphLockError(
          "Bestand is vergrendeld (Excel open op PC?). Sluit Excel en probeer opnieuw."
        );
      }
      throw new Error(`Download mislukt (${res.status}): ${t}`);
    }
    const buffer = await res.arrayBuffer();
    return { bytes: buffer, etag: meta.etag, meta };
  }

  async function uploadWorkbook(drivePath, token, bytes, etag) {
    if (!etag) {
      throw new Error("Geen etag — eerst verversen uit OneDrive.");
    }
    const res = await graphFetch(`${itemUrl(drivePath)}:/content`, token, {
      method: "PUT",
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "If-Match": etag,
      },
      body: bytes,
    });
    if (res.status === 412 || res.status === 409) {
      throw new GraphConflictError(
        "Bestand gewijzigd op OneDrive of PC. Ververs en probeer opnieuw."
      );
    }
    if (res.status === 423) {
      throw new GraphLockError(
        "Upload geweigerd — bestand in gebruik. Sluit Excel op de PC."
      );
    }
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Upload mislukt (${res.status}): ${t}`);
    }
    const meta = await getDriveItemMeta(drivePath, token);
    return meta;
  }

  global.UrenGraph = {
    GraphConflictError,
    GraphLockError,
    getDriveItemMeta,
    downloadWorkbook,
    uploadWorkbook,
    itemUrl,
  };
})(window);
