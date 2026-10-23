# CLAUDE.md

Aanwijzingen voor Claude bij het werken aan deze repo. Gebruik en bediening staan in [README.md](README.md); dit bestand bevat de afspraken en de werkwijze die daar niet in staan.

## Afspraken met Gerhard

- Communiceer in het Nederlands.
- **Commit en push alleen als Gerhard "commit en push" zegt.** Bouw eerst (`npx vite build`) en commit nooit een `.env`-bestand of `Reisblog.cmd - Shortcut.lnk`.
- Nieuwe of geïmporteerde reizen altijd met `draft: true`; Gerhard zet het concept zelf uit.
- Geheimen staan alleen in `.env.local` (gitignored), bijv. `FLICKR_API_KEY` en `FLICKR_USER=gerhardvandekrol`. Nooit tonen, nooit committen; laat Gerhard sleutels zelf invullen.
- Geen Strava-koppeling (bewust verwijderd: alleen met betaald abonnement).
- De reizen uit 2011–2013 uit Google Timeline hoeven niet; reizen uit die jaren worden wel gemaakt vanuit de blog (zie hieronder).
- WordPress (rondjewereld.nl) alleen lezen, tenzij Gerhard expliciet om een wijziging vraagt.
- Commit-identiteit staat in de repo-config (Gerhard van de Krol, gmail).

## Architectuur in het kort

- Vite + vanilla JS + Leaflet; GitHub Pages via Actions bij push naar `main` (relatieve base `./`).
- `scripts/trips-data.mjs`: virtuele modules `virtual:trips` (samenvattingen, per-reis loaders, routes) en `virtual:home`. Concepten (reizen én stops) vallen eruit bij het bouwen; trajecten rond concept-stops worden samengevoegd.
- `scripts/editor-api.mjs`: alleen in dev (`/api/...`) voor de editor: reizen, foto's, homepage, WordPress-teksten, Flickr.
- `scripts/routing.mjs`: OSRM-routes per traject, gecachet op `key` = `"lat,lng;lat,lng"`. Trajecten met `flight: true` blijven altijd staan, ook bij `npm run route` (dat rekent verder alles opnieuw).
- `src/panel.js` is gedeeld door site en editor-voorbeeld; `src/stops.js` bepaalt via-punten en fietstochten (die liggen naast de route met een eigen `track`).
- Stop-types: `camping`, `hotel`, `haven`, `bezienswaardigheid`, `eten`, `activiteit`, `highlight`, `fietstocht`, `via` (`overnachting` is een alias van `camping`).
- `tools/launcher/`: bedieningsapp op http://localhost:5170 (start/stop dev, commit en push).

## Een reis maken van de blog + Google My Maps

Gerhard vraagt vaak: *"maak een reis van rondjewereld.nl categorie X en deze kaart(en) …"*. Werkwijze die goed werkt (een tijdelijk build-script per reis dat de helpers uit `scripts/` en `src/` importeert):

1. **Posts**: categorie-id via `https://public-api.wordpress.com/wp/v2/sites/rondjewereld.nl/categories?search=…` (de WordPress-MCP kan geen categorieën opvragen), dan `…/posts?categories=<id>&per_page=100&order=asc` (pagina 2 bij meer dan 100). HTML strippen en `{flickr …}`/`{mosmap …}`-codes verwijderen.
2. **Kaart**: KML via `https://www.google.com/maps/d/kml?mid=<mid>&forcekml=1`. Alleen punten gebruiken, geen routelijnen of de A/B/C-punten van routebeschrijvingen. Iconen: `icon-81` hotel, `icon-31` camping, `icon-67`/`icon-177` bezienswaardigheid.
3. **Stops**: één overnachting per verblijf (kaartpunt), met de teksten van alle dagen daar (`**titel** · datum` + tekst) en `articles`-links naar de posts. Bezienswaardigheden uit de tekst als eigen stops op hun datum, met de zinnen die erover gaan; controleer daarna of de gekozen zin echt over die plek gaat.
4. **Datums controleren**: postdatums zijn soms publicatiedatums of een dag verschoven; check met weekdagen in de tekst ("het is zondag" e.d.).
5. **Vluchten**: zet ze vooraf in `legs` als `{ from, to, key, km, flight: true, polyline }` (rechte lijn via `encodePolyline`), zodat `routeLegs` ze niet over de weg berekent. Veerboten routeert OSRM zelf. Een stop op het water (boottocht) eerst naar de steiger verplaatsen, anders maakt OSRM een enorme omweg.
6. **Foto's**: Flickr-foto's via `largeUrlOf` + `downloadFlickrPhoto` (`scripts/flickr.mjs`, max. 1000 px) met `link` naar de Flickr-pagina. Oude Blogger-afbeeldingen bestaan in groot formaat als `/s1600/`. Andere afbeeldingen verkleinen met `shrinkPhoto`.
7. **Controle**: zoek trajecten zonder route of verdacht lang, bekijk de reis op `http://localhost:5173/trip.html?reis=<slug>` en meld onzekere plaatsingen aan Gerhard.

Andere importers: `npm run import:polarsteps -- "<map>" --title "…"` en `npm run import:timeline -- "<Timeline.json>" --start … --end … --title "…"`.

## Externe diensten

- Geocoding: Nominatim met User-Agent `reisblog-import/1.0 (lokaal script)` en max. 1 verzoek per seconde.
- Routes: publieke OSRM-server (`router.project-osrm.org`).
- Flickr kan haperen (ECONNRESET); de helpers proberen het een paar keer opnieuw.
