/**
 * Tekstherkenning op foto's (tesseract.js, lokaal in de browser).
 * Gedeeld door het scanscherm (velden vullen) en het voorbeeldvenster
 * (tekst selecteren/kopiëren uit een foto).
 */
(function (global) {
  let laden = null;

  function laadTesseract() {
    if (global.Tesseract) return Promise.resolve(global.Tesseract);
    // Eén keer laden, ook als er tegelijk twee dingen om OCR vragen.
    if (!laden) {
      laden = new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
        s.onload = res;
        s.onerror = rej;
        document.head.appendChild(s);
      })
        .then(() => global.Tesseract)
        .catch((e) => {
          laden = null;
          throw e;
        });
    }
    return laden;
  }

  /** Leest een canvas/afbeelding uit en geeft de gevonden tekst terug. */
  async function tekstUit(bron, taal = "nld") {
    const T = await laadTesseract();
    const { data } = await T.recognize(bron, taal);
    return data?.text || "";
  }

  global.BoekOcr = { laadTesseract, tekstUit };
})(window);
