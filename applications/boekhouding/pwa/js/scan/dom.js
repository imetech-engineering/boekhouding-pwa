// Kleine hulpjes voor de scanner-modules in deze map (docscan, scancam, scanedit),
// die uit MuzIVOtheek overgenomen zijn: elementen maken, melding, iconen, foto openen.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// Melding via de app (staat boven de scanner, zie css: body.cam-open #toast).
export function toast(msg) {
  if (window.BoekApp) window.BoekApp.showToast(msg);
}

// Huisstijlkleur (groen), voor wat op canvas getekend wordt.
export function accent() {
  return getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#0e8a5b";
}

// Lijn-iconen (24x24, stroke).
const P = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  camera: '<path d="M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/>',
  expand: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  turnL: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  turnR: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
};

export function icon(name, cls = "ic") {
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ""}</svg>`;
}

// Afmetingen en EXIF-draaiing uit de JPEG-kop lezen, zonder de foto te decoderen.
async function jpegInfo(file) {
  try {
    const v = new DataView(await file.slice(0, 512 * 1024).arrayBuffer());
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
    let off = 2;
    let orient = 1;
    while (off + 9 < v.byteLength) {
      if (v.getUint8(off) !== 0xff) {
        off++;
        continue;
      }
      const m = v.getUint8(off + 1);
      if (m === 0xff || m === 0x01 || (m >= 0xd0 && m <= 0xd8)) {
        off += m === 0xff ? 1 : 2;
        continue;
      }
      const len = v.getUint16(off + 2);
      if (m === 0xe1) orient = exifOrientation(v, off + 4, off + 2 + len) || orient;
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        let h = v.getUint16(off + 5);
        let w = v.getUint16(off + 7);
        if (orient >= 5) [w, h] = [h, w];
        return { w, h, orient };
      }
      off += 2 + len;
    }
  } catch (e) {}
  return null;
}

function exifOrientation(v, start, end) {
  if (start + 14 > end || v.getUint32(start) !== 0x45786966) return 0; // "Exif"
  const t = start + 6;
  const le = v.getUint16(t) === 0x4949;
  const u16 = (o) => v.getUint16(o, le);
  const u32 = (o) => v.getUint32(o, le);
  const ifd = t + u32(t + 4);
  if (ifd + 2 > end) return 0;
  const n = u16(ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > end) break;
    if (u16(e) === 0x0112) return u16(e + 8);
  }
  return 0;
}

// Foto openen, grote camerafoto's (12 tot 200 MP) meteen verkleind decoderen.
// Een volle 50 MP-foto kost honderden MB geheugen; daar loopt een telefoon op vast.
export async function decodeImage(file, maxSide = 2600) {
  const info = await jpegInfo(file);
  if (info && Math.max(info.w, info.h) > maxSide) {
    const opt = info.w >= info.h ? { resizeWidth: maxSide } : { resizeHeight: maxSide };
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image", resizeQuality: "high", ...opt });
    } catch (e) {}
  }
  return createImageBitmap(file, { imageOrientation: "from-image" });
}
