# IMeTech Uren PWA (Android / OneDrive)

Standalone Progressive Web App: leest en schrijft hetzelfde Excel-bestand als de desktop `uren_app`, direct via **Microsoft Graph** (geen PC-backend).

## Bestandsstructuur

```
pwa/
├── index.html
├── manifest.webmanifest
├── service-worker.js
├── config.example.js   → kopieer naar config.js
├── css/app.css
├── js/
│   ├── auth.js         MSAL login
│   ├── graph.js        Download/upload + etag
│   ├── uren_excel.js   SheetJS (zelfde regels als uren_excel_service.py)
│   ├── uren_analyse.js
│   ├── uren_invoer.js
│   └── app.js
└── README.md
```

## Azure AD — eenmalige setup (~15 min)

1. Ga naar [Azure Portal](https://portal.azure.com) → **Microsoft Entra ID** → **App registrations** → **New registration**.
2. Naam: `IMeTech Uren PWA`.
3. Supported account types: **Accounts in any organizational directory and personal Microsoft accounts** (of alleen persoonlijk, naar wens).
4. Redirect URI: platform **Single-page application (SPA)** — zie hieronder **HTTPS-URL bepalen** (GitHub Pages).
5. Na aanmaken: kopieer **Application (client) ID** naar `config.js` (in deze repo: `9e9bd8db-fc64-46e2-ac72-bf786fff11a6`).
6. **API permissions** → Add permission → Microsoft Graph → **Delegated**:
   - `Files.ReadWrite`
   - `User.Read`
7. Klik **Grant admin consent** alleen nodig als je organisatie dat vereist; voor persoonlijk M365-account meestal niet.
8. Onder **Authentication**: zorg dat **SPA** redirect URI’s kloppen; geen client secret nodig (PKCE).

**Scopes in code** (`config.js` → `graph.scopes`): `User.Read`, `Files.ReadWrite` — moeten overeenkomen met de delegated permissions hierboven.

### HTTPS-URL bepalen (GitHub Pages)

De PWA gebruikt in `config.js` standaard:

`redirectUri: window.location.origin + window.location.pathname`

In Azure moet **exact dezelfde URL** staan als waar de browser na inloggen naartoe gaat (inclusief `/` aan het eind).

**Formule (project-site, meest gebruikelijk):**

| Onderdeel | Waarde |
|-----------|--------|
| GitHub-gebruikersnaam | `imetech-engineering` |
| Repositorynaam | `uren-pwa` |
| **Site-URL** | `https://imetech-engineering.github.io/uren-pwa/` |
| **Azure SPA redirect (primair)** | `https://imetech-engineering.github.io/uren-pwa/` |
| **Azure SPA redirect (extra, aanbevolen)** | `https://imetech-engineering.github.io/uren-pwa/index.html` |
| Lokaal testen | `http://localhost:8080/` |

Repo: [imetech-engineering/uren-pwa](https://github.com/imetech-engineering/uren-pwa) → Pages: `https://imetech-engineering.github.io/uren-pwa/`

Controleer in Azure Portal → App registration → **Authentication** → **Single-page application** dat beide HTTPS-redirects **exact** staan (inclusief trailing `/` op de site-root).

**Niet** gebruiken: pad `.../applications/uren/pwa/` op GitHub Pages — de workflow publiceert alleen de inhoud van `applications/uren/pwa/` naar de **root** van de Pages-site, dus het pad is alleen `/<repo>/`.

### config.js

```bash
cp config.example.js config.js
```

Vul `clientId` en pas `redirectUri` aan (moet exact overeenkomen met Azure SPA-URI). Pas `drivePath` aan als Graph 404 geeft — vaak zonder het prefix `OneDrive - IMeTech Engineering/`:

```
02 Boekhouding/04 Urenadministratie/urenadministratie_2025.xlsx
```

In `index.html`: laad `config.js` i.p.v. `config.example.js`.

**Productie:** `config.js` wordt mee gedeployed (SPA client ID is geen geheim). Commit `applications/uren/pwa/config.js` naar de repo zodat GitHub Pages het bestand serveert.

## Deploy (GitHub Pages)

In deze workspace staat een workflow: `.github/workflows/deploy-uren-pwa.yml`. Die zet bij elke push naar `main`/`master` (alleen wijzigingen in de PWA) de map `applications/uren/pwa/` live op GitHub Pages — **zonder** het lange pad in de URL.

### Checklist: nieuwe GitHub-repo nodig?

| Situatie | Actie |
|----------|--------|
| Nog geen git in deze map | **Ja** — maak een GitHub-repo aan en koppel die (stappen hieronder). |
| Repo bestaat al op GitHub | **Nee** — push de workflow + PWA; zet Pages op **GitHub Actions**. |

### Stappen (eenmalig, zelf uitvoeren)

1. **GitHub-account** — inloggen op [github.com](https://github.com).
2. **Nieuwe repository** (aanbevolen naam: `uren-pwa` of je bestaande monorepo-naam):
   - Public of **Private** (private Pages: zie [GitHub Pages docs](https://docs.github.com/en/pages)).
   - Geen README verplicht als je lokaal al code hebt.
3. **Lokaal git initialiseren** (PowerShell, in de workspace-root `07 Automatisatie`):

   ```powershell
   cd "c:\Users\ivome\OneDrive - IMeTech Engineering\01 Administratie\07 Automatisatie"
   git init
   git add .github/workflows/deploy-uren-pwa.yml applications/uren/pwa
   git commit --trailer "Co-authored-by: Cursor <cursoragent@cursor.com>" -m "Add uren PWA and GitHub Pages deploy workflow"
   git branch -M main
   git remote add origin https://github.com/<GITHUB_GEBRUIKERSNAAM>/<REPO_NAAM>.git
   git push -u origin main
   ```

   Vervang `<GITHUB_GEBRUIKERSNAAM>` en `<REPO_NAAM>`. Voeg later meer mappen toe als je de hele workspace wilt versioneren.

4. **GitHub CLI (optioneel)** — `gh` staat op deze PC niet geïnstalleerd. Installeren: [GitHub CLI](https://cli.github.com/). Daarna kun je o.a. `gh auth login` en `gh repo create` gebruiken; het kan ook volledig via de website + `git push`.

5. **Pages inschakelen:**
   - Repo → **Settings** → **Pages**
   - **Build and deployment** → **Source:** **GitHub Actions** (niet “Deploy from a branch”).
   - Na de eerste geslaagde workflow-run staat de URL bovenaan (of onder Actions → workflow **Deploy uren PWA**).

6. **Azure** — onder App registration → **Authentication** → SPA: voeg de redirect URI’s uit de tabel hierboven toe (HTTPS, exact).

7. **Telefoon** — open de Pages-URL in Chrome; controleer dat `config.js` geladen wordt (als login faalt, controleer redirect URI).

8. **Handmatig opnieuw deployen:** Actions-tab → **Deploy uren PWA** → **Run workflow**.

Alternatief: [Azure Static Web Apps](https://azure.microsoft.com/products/web-apps/) — zelfde SPA redirect-regels.

## Installatie op Oppo (Find X9)

1. Deploy de PWA naar HTTPS.
2. Open **Chrome** → ga naar de PWA-URL (`https://<GITHUB_GEBRUIKERSNAAM>.github.io/<REPO_NAAM>/`).
3. Zorg dat `config.js` op de server staat (zie **config.js** hierboven).
4. Tab **Instellingen** → **Inloggen** → Microsoft-account (zelfde als OneDrive).
5. **Ververs uit OneDrive** — controleer sync-status bovenaan.
6. Chrome-menu (⋮) → **Toevoegen aan startscherm** / **Install app**.
7. Open vanaf startscherm: volledig scherm, bottom nav (Invoer | Analyse | Instellingen).

## Sync en conflicten

- Elke download slaat `@odata.etag` op; upload stuurt `If-Match`.
- Wijziging op PC/telefoon tussen download en upload → **412**: melding *Bestand gewijzigd — ververs en probeer opnieuw*.
- Excel open op PC kan lock geven → sluit werkboek kort of gebruik ververs.
- Schrijf niet tegelijk in desktop-app en telefoon.

## Desktop-app

`uren_app.py` importeert Excel-I/O uit `uren_excel_service.py` (zelfde kolommen, `Tabel13`, formules). OneDrive synct het bestand naar de PC.

## Lokaal testen

```bash
cd applications/uren/pwa
python -m http.server 8080
```

Open `http://localhost:8080/` — voeg `http://localhost:8080/` toe als SPA redirect in Azure.