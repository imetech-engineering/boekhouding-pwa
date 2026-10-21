/**
 * Hulpjes voor gescande pagina's: draaien en opslaan als JPEG.
 * Bijsnijden, rechttrekken en verbeteren gebeurt in js/scan/ (OpenCV, overgenomen
 * uit MuzIVOtheek).
 */
(function (global) {
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

  global.BoekScanner = { rotate90, toJpeg };
})(window);
