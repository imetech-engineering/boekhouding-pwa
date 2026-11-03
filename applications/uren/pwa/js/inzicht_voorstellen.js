/**
 * Eenmalige voorstellen om het offerteregister (Ureninschattingen) compleet te maken.
 * Opgezocht in offertes, verkoopfacturen en Outlook (nov 2026) en door Ivo nagekeken.
 * In de Inzicht-tab kies je per voorstel of je het overneemt; wat al klopt wordt niet getoond.
 *
 * wijzig: bestaande rij (op projectnaam), alleen de genoemde velden.
 * nieuw:  rij toevoegen als er nog geen rij met deze projectnaam is.
 */
(function (global) {
  const B = "Bestaande klant";
  global.UrenInzichtVoorstellen = [
    // Offertenummers koppelen en reden van verlies
    { wijzig: "xxxx Custom PCB", velden: { offerte: "OF251003", reden: "Zelf doen" }, uitleg: "Luminote: besloot het zelf te doen" },
    { wijzig: "xxxx Vision pilot", velden: { status: "Geannuleerd", offerte: "OF251004, OF251102, OF251106, OF260101", reden: "Klant stopt" }, uitleg: "Daniëll van Enk: kan door privéomstandigheden niet verder (mail 13-02-2026); vier versies" },
    { wijzig: "xxxx Sturing DR SW 90", velden: { offerte: "OF260102", reden: "Concurrent" }, uitleg: "DR Reinigingstechniek: door iemand anders gedaan" },
    { wijzig: "xxxx Telefoonteller PoC", velden: { offerte: "OF260302", reden: "Klant stopt" }, uitleg: "Dominic Noest: intern afgewogen, niet doorgegaan" },
    { wijzig: "xxxx Spinder Design", velden: { offerte: "OF260304, OF260401", reden: "Prijs" }, uitleg: "Hoger dan verwacht, ook de afgeslankte versie niet (mail 07-04-2026)" },
    { wijzig: "xxxx Magic Box", velden: { offerte: "OF260601", reden: "Prijs" }, uitleg: "Vroeg serieprijzen, daarna geannuleerd" },
    { wijzig: "xxxx TDR-potten", velden: { status: "On hold", reden: "On hold (klant)", bron: B }, uitleg: "ESTEDE: on hold, nog afwachten" },
    { wijzig: "1004 Dräger implementatie", velden: { reden: "On hold (klant)", bron: B }, uitleg: "ESTEDE: on hold sinds okt 2025" },
    { wijzig: "xxxx LampCam Tester", velden: { reden: "On hold (klant)" }, uitleg: "Gearbox: geen reactie op herinnering" },
    { wijzig: "xxxx PC Auto-Start", velden: { reden: "On hold (klant)" }, uitleg: "Gearbox: geen reactie op herinnering" },
    { wijzig: "260807 Kobus Uitlijntechniek", velden: { reden: "On hold (klant)" }, uitleg: "Persoonlijke omstandigheden, staat even stil (mail 29-09-2026)" },
    // Gewonnen: offertenummer of prijsindicatie per mail erbij
    { wijzig: "1005 N-Emis", velden: { offerte: "OF251101", bron: B }, uitleg: "Zes meetopstellingen, gefactureerd met FA251202" },
    { wijzig: "5011 Escape Deventer", velden: { offerte: "OF260303" }, uitleg: "Offerte op regiebasis (SpelKo)" },
    { wijzig: "5010 Envidro", velden: { offerte: "mail" }, uitleg: "Ruwe inschatting per mail (28-01-2026), daarna gefactureerd" },
    { wijzig: "5018 Delhaize wijnrek", velden: { offerte: "OF260906, OF261001", bron: "Fiverr / platform" }, uitleg: "PoC-offerte opgevolgd door de volledige offerte; Matteo vond je via Fiverr" },
    // Bron waar die vaststaat
    { wijzig: "1002 Adresprint SCD30", velden: { bron: B }, uitleg: "ESTEDE" },
    { wijzig: "1003 CAD Plantsappers", velden: { bron: B }, uitleg: "ESTEDE" },
    { wijzig: "1099 Installatie N-Emis", velden: { bron: B }, uitleg: "ESTEDE" },
    { wijzig: "5008 Vlakkelichtkoepel inkoop", velden: { bron: B }, uitleg: "Heruvent" },
    { wijzig: "5008 Vlakkelichtkoepel RevB", velden: { bron: B }, uitleg: "Heruvent" },
    { wijzig: "5016 PRM-lift inkoop", velden: { bron: B }, uitleg: "Ronald Engineering" },
    { wijzig: "5007 uMotion inkoop", velden: { bron: B }, uitleg: "uMotion" },
    // Offertes die nog geen rij hadden
    {
      nieuw: { datumStr: "2025-09-24", opdrachtgever: "Studiopetek", project: "xxxx LED-driver Studiopetek", status: "Geannuleerd", offerte: "OF250902", reden: "Prijs", bron: B, opmerking: "Budget max € 80 (mail 24-09-2025)" },
      uitleg: "Te duur: rekende op platformtarieven",
    },
    {
      nieuw: { datumStr: "2025-09-29", opdrachtgever: "Dutchbeek", project: "xxxx PCB lichtsensor Dutchbeek", status: "Geannuleerd", offerte: "OF250903", reden: "Concurrent", bron: "Website (formulier)", opmerking: "Met iemand anders in zee (mail 30-09-2025)" },
      uitleg: "Kwam via het websiteformulier, koos een ander",
    },
    {
      nieuw: { datumStr: "2025-11-24", opdrachtgever: "Arclinq", project: "xxxx LINQ01 PCB Arclinq", status: "Geannuleerd", offerte: "OF251107", reden: "Geen reactie", opmerking: "" },
      uitleg: "Geen antwoord op de offerte gevonden",
    },
    {
      nieuw: { datumStr: "2026-09-09", opdrachtgever: "18650batteries.eu", project: "xxxx 18650 celtester", status: "On hold", offerte: "OF260901", reden: "On hold (klant)", opmerking: "Tom Wolvers, fase 1 teststation" },
      uitleg: "On hold, afwachten",
    },
    {
      nieuw: { datumStr: "2026-10-17", opdrachtgever: "Cueva Control", project: "5015 Cueva Control LUMO U2A", status: "Wachten op akkoord", offerte: "OF261004", bron: B, opmerking: "Herinnering 31-10-2026" },
      uitleg: "Fase 2 na de EMC-review",
    },
    {
      nieuw: { datumStr: "2026-10-12", opdrachtgever: "Bloppo", project: "5017 Bloppo fase 2", status: "Wachten op akkoord", offerte: "mail", bron: B, opmerking: "Indicatie per mail: € 6.000 tot € 9.000 plus € 400 tot € 700 materiaal (12-10-2026)" },
      uitleg: "Alleen prijsindicatie per mail",
    },
    {
      nieuw: { datumStr: "2026-10-24", opdrachtgever: "BearInMind", project: "5014 BearInMind productieversie", status: "Wachten op akkoord", offerte: "mail", bron: B, opmerking: "Kosteninschatting productieversie per mail; kostprijs viel hoger uit dan verwacht" },
      uitleg: "Alleen kosteninschatting per mail",
    },
  ];
})(typeof window !== "undefined" ? window : globalThis);
