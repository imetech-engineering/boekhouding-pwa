/**
 * Microsoft Graph driveItem-laag: paden, mappen, bestanden, settings-JSON.
 */
(function (global) {
  const GRAPH = "https://graph.microsoft.com/v1.0";

  class GraphLockError extends Error {
    constructor(message) {
      super(message);
      this.name = "GraphLockError";
    }
  }

  class GraphConflictError extends Error {
    constructor(message) {
      super(message);
      this.name = "GraphConflictError";
    }
  }

  function encodeDrivePath(path) {
    return path
      .split("/")
      .filter(Boolean)
      .map((seg) => encodeURIComponent(seg))
      .join("/");
  }

  function itemUrl(path) {
    return `${GRAPH}/me/drive/root:/${encodeDrivePath(path)}`;
  }

  async function graphFetch(url, token, options = {}) {
    const headers = {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    };
    if (options.body && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 423) {
        throw new GraphLockError(
          "Bestand is vergrendeld (Excel open op PC?). Sluit Excel en probeer opnieuw."
        );
      }
      const err = new Error(`Graph API mislukt (${res.status}): ${text}`);
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return null;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) return res.json();
    return res;
  }

  async function getDriveItemMeta(path, token) {
    // cTag verandert alleen als de inhoud wijzigt — daarmee slaan we het
    // opnieuw inlezen over als er niets veranderd is.
    return graphFetch(
      `${itemUrl(path)}?$select=id,name,lastModifiedDateTime,webUrl,size,eTag,cTag`,
      token
    );
  }

  /** Lijst bestanden + directe submappen in een OneDrive-map. */
  async function listFolder(path, token) {
    const items = [];
    let url = `${itemUrl(path)}:/children?$select=id,name,folder,file,size,lastModifiedDateTime,parentReference&$top=200&$orderby=name`;
    while (url) {
      const data = await graphFetch(url, token);
      items.push(...(data.value || []));
      url = data["@odata.nextLink"] || null;
    }
    return items;
  }

  /**
   * Bestandsinhoud direct via het /content-endpoint (volgt de redirect naar de
   * pre-auth download-URL). Betrouwbaarder dan @microsoft.graph.downloadUrl via
   * $select — die annotation ontbreekt vaak bij OneDrive Business.
   */
  async function downloadBytes(itemId, token) {
    const res = await fetch(`${GRAPH}/me/drive/items/${itemId}/content`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Download mislukt (${res.status})`);
    return res.arrayBuffer();
  }

  /** Object-URL voor een afbeelding-preview (aanroeper hoeft niets vrij te geven; laatste blijft leven). */
  async function downloadObjectUrl(itemId, token, mime) {
    const bytes = await downloadBytes(itemId, token);
    return URL.createObjectURL(new Blob([bytes], mime ? { type: mime } : undefined));
  }

  /** Verplaats (en optioneel hernoem) een item naar een andere map. */
  async function moveItem(itemId, destFolderPath, token, newName) {
    const destMeta = await getDriveItemMeta(destFolderPath, token);
    const body = { parentReference: { id: destMeta.id } };
    if (newName) body.name = newName;
    return graphFetch(`${GRAPH}/me/drive/items/${itemId}`, token, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  const SIMPLE_UPLOAD_MAX = 4 * 1024 * 1024;
  const UPLOAD_CHUNK = 5 * 1024 * 1024; // veelvoud van 320 KiB, zoals Graph vereist

  /** Groot bestand in blokken uploaden via een uploadsessie. */
  async function uploadLarge(path, blob, token) {
    const res = await fetch(`${itemUrl(path)}:/createUploadSession`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "rename" } }),
    });
    if (!res.ok) throw new Error(`Uploadsessie mislukt (${res.status}): ${await res.text()}`);
    const { uploadUrl } = await res.json();
    let start = 0;
    let laatste = null;
    while (start < blob.size) {
      const end = Math.min(start + UPLOAD_CHUNK, blob.size);
      const r = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Range": `bytes ${start}-${end - 1}/${blob.size}` },
        body: blob.slice(start, end),
      });
      if (!r.ok) throw new Error(`Uploaden mislukt (${r.status})`);
      if (r.status === 200 || r.status === 201) laatste = await r.json();
      start = end;
    }
    return laatste;
  }

  /** Bestand uploaden; OneDrive hernoemt zelf bij een naamconflict. */
  async function uploadFile(path, blob, token) {
    if (blob.size > SIMPLE_UPLOAD_MAX) return uploadLarge(path, blob, token);
    const res = await fetch(`${itemUrl(path)}:/content?@microsoft.graph.conflictBehavior=rename`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": blob.type || "application/octet-stream",
      },
      body: blob,
    });
    if (!res.ok) {
      throw new Error(`Uploaden mislukt (${res.status}): ${await res.text()}`);
    }
    return res.json();
  }

  async function createFolder(parentPath, name, token) {
    return graphFetch(`${itemUrl(parentPath)}:/children`, token, {
      method: "POST",
      body: JSON.stringify({
        name,
        folder: {},
        "@microsoft.graph.conflictBehavior": "rename",
      }),
    });
  }

  async function renameItem(itemId, newName, token) {
    return graphFetch(`${GRAPH}/me/drive/items/${itemId}`, token, {
      method: "PATCH",
      body: JSON.stringify({ name: newName }),
    });
  }

  /** Settings-JSON in OneDrive (null als het bestand nog niet bestaat). */
  async function readJsonFile(path, token) {
    try {
      const res = await fetch(`${itemUrl(path)}:/content`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Lezen mislukt (${res.status})`);
      return await res.json();
    } catch (e) {
      if (e instanceof SyntaxError) return null;
      throw e;
    }
  }

  async function writeJsonFile(path, data, token) {
    const res = await fetch(`${itemUrl(path)}:/content`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data, null, 2),
    });
    if (!res.ok) throw new Error(`Opslaan instellingen mislukt (${res.status})`);
    return res.json();
  }

  global.BoekGraph = {
    GRAPH,
    itemUrl,
    graphFetch,
    getDriveItemMeta,
    listFolder,
    downloadBytes,
    downloadObjectUrl,
    moveItem,
    renameItem,
    uploadFile,
    createFolder,
    readJsonFile,
    writeJsonFile,
    GraphLockError,
    GraphConflictError,
  };
})(window);
