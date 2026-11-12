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
        s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
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

  /** Zoals tekstUit, maar geeft alles terug: tekst plus per regel de woorden met hun plek in het beeld (bbox in pixels). */
  async function lees(bron, taal = "nld") {
    const T = await laadTesseract();
    const { data } = await T.recognize(bron, taal);
    return data || {};
  }

  global.BoekOcr = { laadTesseract, tekstUit, lees };
})(window);
