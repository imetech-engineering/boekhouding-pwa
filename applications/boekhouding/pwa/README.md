# IMeTech Boekhouding PWA (Android / OneDrive)

Standalone Progressive Web App: leest en schrijft **Boekhouding_IMeTech.xlsx** direct via **Microsoft Graph** (geen PC-backend). Zelfde architectuur als de [uren-PWA](https://github.com/imetech-engineering/uren-pwa).

## Functies

- **Bankboek** — regels toevoegen/bewerken, saldo als zelf-herstellende formule, ingeboekt markeren, automatische matching met facturen (zelfde bedrag, datum ±14 dagen).
- **Inkoop & verkoop** — facturen uit de OneDrive-mappen "nog te verwerken", PDF-preview + automatische extractie (bedrijf/bedrag/datum/BTW/land), suggesties uit de Excel-historie per leverancier/klant, duplicaatcontrole, bankregels afvinken, na inboeken bestand verplaatsen naar "verwerkt". Regels zijn te bewerken en te verwijderen (potlood/prullenbak of swipe).
- **Bestand toevoegen** — plus-knop → Bestand: PDF's en foto's krijgen meteen een voorbeeld (eerste pagina als miniatuur, tik erop voor groot). Datum, leverancier en factuurnummer worden automatisch herkend — eerst uit de bestandsnaam (`yymmdd bedrijf factuurnummer`), dan uit de PDF-tekst, en bij een foto via OCR. In het grote voorbeeld kun je bladeren, zoomen, tekst **selecteren en kopiëren** (uit de PDF zelf, of uit een foto via OCR). Dezelfde knop "Groot + tekst" zit ook bij het voorbeeld in inkoop en verkoop, waar de PDF-tekst nu ook direct in het voorbeeld te selecteren is.
- **Bon fotograferen** — plus-knop bij inkoop opent de camera van de telefoon. De app zoekt zelf de rand van de bon, je kunt de vier hoeken bijslepen (met loep), trekt het beeld recht en zet het als JPEG in "nog te verwerken". Meerdere pagina's worden een map met dezelfde naam. Daarna boek je hem via de gewone weg in.
- **Reiskosten** — vaste bestemmingen, adres zoeken (Photon), automatische km via route (OSRM), boekt als inkoopregel (€/km instelbaar, standaard € 0,23).
- **Overzicht** — kwartaaldashboard (omzet/kosten/resultaat/BTW-saldo), instellingen.
- Offline queue (IndexedDB), donkere modus, installeerbaar op het startscherm.

## Wat de app in Excel schrijft

Alleen waardekolommen — formulekolommen (Periode, Jaar, BTW-berekeningen) en de
categorie-keuzelijstkolommen (Q inkoop / O verkoop) blijven onaangeroerd. Nieuwe
bankregels krijgen het saldo als formule (`=E<vorige>+In−Uit`), zodat correcties
automatisch doorwerken.

## Setup

1. **Azure**: zelfde app-registratie als de uren-PWA (`9e9bd8db-…`). Voeg één SPA
   redirect URI toe: `https://imetech-engineering.github.io/boekhouding-pwa/`
   (Azure Portal → App registrations → IMeTech Uren PWA → Authentication →
   Single-page application → Add URI). Scopes (`Files.ReadWrite`, `User.Read`) staan al goed.
2. **GitHub Pages**: repo [imetech-engineering/boekhouding-pwa](https://github.com/imetech-engineering/boekhouding-pwa),
   Settings → Pages → Source: **GitHub Actions**. De workflow
   `.github/workflows/deploy-boekhouding-pwa.yml` publiceert `applications/boekhouding/pwa/` naar de site-root.
3. **Pushen**: de monorepo heeft twee remotes; push naar beide:

   ```powershell
   git push origin main        # uren-pwa (bestaand)
   git push boekhouding main   # boekhouding-pwa
   ```

## Lokaal testen

```bash
cd applications/boekhouding/pwa
python -m http.server 8080
```

Open `http://localhost:8080/` (die redirect URI staat al in Azure voor de uren-PWA;
zelfde registratie, dus login werkt direct).

## Diensten van derden

- **Photon** (photon.komoot.io) — adres-autocomplete, gratis, geen key.
- **OSRM demo** (router.project-osrm.org) — route-km, gratis, geen uptime-garantie;
  km-veld blijft altijd handmatig aanpasbaar.
- **CDN**: MSAL (login) en pdf.js (PDF-preview/extractie) via jsDelivr.

De documentscanner draait volledig lokaal in de browser (`js/scanner.js`): Otsu-drempel,
grootste aaneengesloten vlak, convexe omhulling en de grootste vierhoek daarbinnen,
gevolgd door een homografie met bilineaire bemonstering. Geen externe bibliotheek,
geen upload naar derden.

Instellingen (km-tarief, thuisadres, vaste bestemmingen) staan in
`02 Boekhouding/boekhouding_pwa_settings.json` in OneDrive en syncen dus mee tussen apparaten.
