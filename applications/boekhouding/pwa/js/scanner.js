/**
 * Documentscanner: automatische randdetectie + perspectiefcorrectie.
 * Pure beeldbewerking op canvas, geen DOM-afhankelijkheden buiten canvas zelf.
 */
(function (global) {
  const DETECT_SIDE = 600; // werkresolutie voor de randdetectie
  const SOURCE_SIDE = 2400; // bronfoto wordt hierop teruggebracht (geheugen)
  const OUTPUT_SIDE = 1800; // langste zijde van het eindresultaat

  // === Laden ===

  function fileToImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Deze foto kon niet geladen worden."));
      };
      img.src = url;
    });
  }

  /** Bronfoto naar een canvas van beheersbare grootte (EXIF-rotatie past de browser al toe). */
  function toSourceCanvas(img) {
    const w0 = img.naturalWidth || img.width;
    const h0 = img.naturalHeight || img.height;
    const scale = Math.min(1, SOURCE_SIDE / Math.max(w0, h0));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w0 * scale));
    c.height = Math.max(1, Math.round(h0 * scale));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  // === Hulpfuncties beeldanalyse ===

  function boxBlur(gray, w, h, radius) {
    const tmp = new Float32Array(gray.length);
    const win = radius * 2 + 1;
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let x = -radius; x <= radius; x++) sum += gray[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = sum / win;
        const out = gray[y * w + Math.min(w - 1, Math.max(0, x - radius))];
        const inn = gray[y * w + Math.min(w - 1, Math.max(0, x + radius + 1))];
        sum += inn - out;
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        gray[y * w + x] = sum / win;
        const out = tmp[Math.min(h - 1, Math.max(0, y - radius)) * w + x];
        const inn = tmp[Math.min(h - 1, Math.max(0, y + radius + 1)) * w + x];
        sum += inn - out;
      }
    }
  }

  /** Otsu-drempel: scheidt licht papier van donkere ondergrond (of andersom). */
  function otsuThreshold(gray) {
    const hist = new Float64Array(256);
    for (let i = 0; i < gray.length; i++) hist[gray[i] | 0]++;
    const total = gray.length;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0;
    let wB = 0;
    let best = 0;
    let bestVar = -1;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > bestVar) {
        bestVar = between;
        best = t;
      }
    }
    return best;
  }

  /** Grootste aaneengesloten vlak; levert per rij de buitenste punten (genoeg voor de hull). */
  function largestComponent(mask, w, h) {
    const labels = new Int32Array(w * h).fill(-1);
    const stack = new Int32Array(w * h);
    let bestArea = 0;
    let bestLabel = -1;
    let label = 0;
    for (let start = 0; start < mask.length; start++) {
      if (!mask[start] || labels[start] >= 0) continue;
      let sp = 0;
      let area = 0;
      labels[start] = label;
      stack[sp++] = start;
      while (sp > 0) {
        const p = stack[--sp];
        area++;
        const x = p % w;
        const y = (p / w) | 0;
        if (x > 0 && mask[p - 1] && labels[p - 1] < 0) { labels[p - 1] = label; stack[sp++] = p - 1; }
        if (x < w - 1 && mask[p + 1] && labels[p + 1] < 0) { labels[p + 1] = label; stack[sp++] = p + 1; }
        if (y > 0 && mask[p - w] && labels[p - w] < 0) { labels[p - w] = label; stack[sp++] = p - w; }
        if (y < h - 1 && mask[p + w] && labels[p + w] < 0) { labels[p + w] = label; stack[sp++] = p + w; }
      }
      if (area > bestArea) { bestArea = area; bestLabel = label; }
      label++;
    }
    if (bestLabel < 0) return null;
    const points = [];
    for (let y = 0; y < h; y++) {
      let minX = -1;
      let maxX = -1;
      const row = y * w;
      for (let x = 0; x < w; x++) {
        if (labels[row + x] === bestLabel) {
          if (minX < 0) minX = x;
          maxX = x;
        }
      }
      if (minX >= 0) {
        points.push({ x: minX, y });
        if (maxX !== minX) points.push({ x: maxX, y });
      }
    }
    return { area: bestArea, points };
  }

  function cross(o, a, b) {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  }

  /** Convexe omhulling (monotone chain), tegen de klok in. */
  function convexHull(points) {
    const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
    if (pts.length < 3) return pts;
    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  function polyArea(quad) {
    let a = 0;
    for (let i = 0; i < quad.length; i++) {
      const p = quad[i];
      const q = quad[(i + 1) % quad.length];
      a += p.x * q.y - q.x * p.y;
    }
    return Math.abs(a) / 2;
  }

  /** Grootste vierhoek binnen de omhulling — dat is de rand van het document. */
  function largestQuad(hull) {
    if (hull.length < 4) return null;
    let pts = hull;
    if (pts.length > 56) {
      const step = pts.length / 56;
      pts = Array.from({ length: 56 }, (_, i) => hull[Math.floor(i * step)]);
    }
    const n = pts.length;
    let best = null;
    let bestArea = 0;
    for (let i = 0; i < n - 3; i++) {
      for (let j = i + 1; j < n - 2; j++) {
        for (let k = j + 1; k < n - 1; k++) {
          for (let l = k + 1; l < n; l++) {
            const area = polyArea([pts[i], pts[j], pts[k], pts[l]]);
            if (area > bestArea) {
              bestArea = area;
              best = [pts[i], pts[j], pts[k], pts[l]];
            }
          }
        }
      }
    }
    return best;
  }

  /** Volgorde linksboven, rechtsboven, rechtsonder, linksonder. */
  function orderCorners(quad) {
    const cx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4;
    const cy = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4;
    const sorted = [...quad].sort(
      (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)
    );
    let startIdx = 0;
    let bestSum = Infinity;
    sorted.forEach((p, i) => {
      const s = p.x + p.y;
      if (s < bestSum) {
        bestSum = s;
        startIdx = i;
      }
    });
    return [0, 1, 2, 3].map((i) => sorted[(startIdx + i) % 4]);
  }

  /**
   * Zoekt de vier hoeken van het document in een bron-canvas.
   * Geeft null terug als er niets duidelijks gevonden is (dan pakt de UI de hele foto).
   */
  function detectCorners(srcCanvas) {
    const scale = Math.min(1, DETECT_SIDE / Math.max(srcCanvas.width, srcCanvas.height));
    const w = Math.max(32, Math.round(srcCanvas.width * scale));
    const h = Math.max(32, Math.round(srcCanvas.height * scale));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(srcCanvas, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;

    const gray = new Float32Array(w * h);
    for (let i = 0, p = 0; p < gray.length; i += 4, p++) {
      gray[p] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    }
    boxBlur(gray, w, h, 2);
    const rounded = new Uint8ClampedArray(gray.length);
    for (let p = 0; p < gray.length; p++) rounded[p] = gray[p];
    const t = otsuThreshold(rounded);

    // Eerst papier lichter dan de ondergrond, anders andersom.
    for (const invert of [false, true]) {
      const mask = new Uint8Array(w * h);
      for (let p = 0; p < mask.length; p++) {
        mask[p] = (invert ? rounded[p] < t : rounded[p] >= t) ? 1 : 0;
      }
      const comp = largestComponent(mask, w, h);
      if (!comp) continue;
      const frac = comp.area / (w * h);
      if (frac < 0.12 || frac > 0.985) continue;
      const quad = largestQuad(convexHull(comp.points));
      if (!quad) continue;
      if (polyArea(quad) / (w * h) < 0.1) continue;
      return orderCorners(quad).map((p) => ({
        x: Math.min(srcCanvas.width, Math.max(0, p.x / scale)),
        y: Math.min(srcCanvas.height, Math.max(0, p.y / scale)),
      }));
    }
    return null;
  }

  /** Hoeken die de hele foto beslaan, met een kleine marge. */
  function fullFrameCorners(srcCanvas) {
    const mx = srcCanvas.width * 0.04;
    const my = srcCanvas.height * 0.04;
    return [
      { x: mx, y: my },
      { x: srcCanvas.width - mx, y: my },
      { x: srcCanvas.width - mx, y: srcCanvas.height - my },
      { x: mx, y: srcCanvas.height - my },
    ];
  }

  // === Perspectiefcorrectie ===

  /** Lost de 8 onbekenden op die `from` op `to` afbeelden (Gauss-eliminatie). */
  function homography(from, to) {
    const A = [];
    const b = [];
    for (let i = 0; i < 4; i++) {
      const { x, y } = from[i];
      const { x: u, y: v } = to[i];
      A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
      b.push(u);
      A.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
      b.push(v);
    }
    for (let col = 0; col < 8; col++) {
      let pivot = col;
      for (let r = col + 1; r < 8; r++) {
        if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
      }
      if (Math.abs(A[pivot][col]) < 1e-10) return null;
      [A[col], A[pivot]] = [A[pivot], A[col]];
      [b[col], b[pivot]] = [b[pivot], b[col]];
      const d = A[col][col];
      for (let c = col; c < 8; c++) A[col][c] /= d;
      b[col] /= d;
      for (let r = 0; r < 8; r++) {
        if (r === col) continue;
        const f = A[r][col];
        if (!f) continue;
        for (let c = col; c < 8; c++) A[r][c] -= f * A[col][c];
        b[r] -= f * b[col];
      }
    }
    return b; // [h0..h7], h8 = 1
  }

  /**
   * Trekt het gebied binnen `corners` recht naar een rechthoekig canvas.
   * Kleuren blijven ongewijzigd; alleen de vervorming wordt eruit gehaald.
   */
  function warp(srcCanvas, corners) {
    const [tl, tr, br, bl] = corners;
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    let W = Math.max(dist(tl, tr), dist(bl, br));
    let H = Math.max(dist(tl, bl), dist(tr, br));
    const scale = Math.min(1, OUTPUT_SIDE / Math.max(W, H));
    W = Math.max(16, Math.round(W * scale));
    H = Math.max(16, Math.round(H * scale));

    const dst = [
      { x: 0, y: 0 },
      { x: W, y: 0 },
      { x: W, y: H },
      { x: 0, y: H },
    ];
    const h = homography(dst, corners); // doel → bron, zodat we per doelpixel kunnen bemonsteren
    if (!h) return null;

    const sctx = srcCanvas.getContext("2d", { willReadFrequently: true });
    const src = sctx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
    const sw = src.width;
    const sh = src.height;
    const sd = src.data;

    const out = document.createElement("canvas");
    out.width = W;
    out.height = H;
    const odata = out.getContext("2d").createImageData(W, H);
    const od = odata.data;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const den = h[6] * x + h[7] * y + 1;
        const u = (h[0] * x + h[1] * y + h[2]) / den;
        const v = (h[3] * x + h[4] * y + h[5]) / den;
        const o = (y * W + x) * 4;
        if (u < 0 || v < 0 || u > sw - 1 || v > sh - 1) {
          od[o] = od[o + 1] = od[o + 2] = 255;
          od[o + 3] = 255;
          continue;
        }
        // bilineair bemonsteren
        const x0 = u | 0;
        const y0 = v | 0;
        const x1 = Math.min(sw - 1, x0 + 1);
        const y1 = Math.min(sh - 1, y0 + 1);
        const fx = u - x0;
        const fy = v - y0;
        const i00 = (y0 * sw + x0) * 4;
        const i10 = (y0 * sw + x1) * 4;
        const i01 = (y1 * sw + x0) * 4;
        const i11 = (y1 * sw + x1) * 4;
        for (let ch = 0; ch < 3; ch++) {
          const top = sd[i00 + ch] + (sd[i10 + ch] - sd[i00 + ch]) * fx;
          const bot = sd[i01 + ch] + (sd[i11 + ch] - sd[i01 + ch]) * fx;
          od[o + ch] = top + (bot - top) * fy;
        }
        od[o + 3] = 255;
      }
    }
    out.getContext("2d").putImageData(odata, 0, 0);
    return out;
  }

  /** Canvas een kwartslag draaien (voor een bon die zijwaarts gefotografeerd is). */
  function rotate90(canvas) {
    const out = document.createElement("canvas");
    out.width = canvas.height;
    out.height = canvas.width;
    const ctx = out.getContext("2d");
    ctx.translate(out.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(canvas, 0, 0);
    return out;
  }

  function toJpeg(canvas, quality = 0.85) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Foto omzetten mislukt."))),
        "image/jpeg",
        quality
      );
    });
  }

  global.BoekScanner = {
    fileToImage,
    toSourceCanvas,
    detectCorners,
    fullFrameCorners,
    warp,
    rotate90,
    toJpeg,
  };
})(window);
