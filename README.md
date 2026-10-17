# Reisblog

Statische reisblog-site: een overzicht van reizen, en per reis een kaart met de route over de weg. Klik op een stop om rechts het verhaal en de foto's te lezen.

## Lokaal draaien

```bash
npm install
npm run dev
```

Open http://localhost:5173 voor de site en http://localhost:5173/admin voor de editor.

## Een reis schrijven (editor)

1. `npm run dev` en open http://localhost:5173/admin
2. **＋ Nieuwe reis** maakt een reis aan als *concept*; die verschijnt niet op de gepubliceerde site.
3. Voeg stops toe via het zoekveld of door op de kaart te klikken. Sleep markers om ze te verplaatsen en ⠿ om de volgorde te wijzigen.
4. Klik een stop open voor naam, datum, type, verhaal (Markdown) en foto's. Foto's worden in de browser verkleind tot max. 1600px (WebP). ★ maakt een foto de omslag van de reis.
   Met **📰 Tekst van rondjewereld.nl** haal je blogberichten op die tot 5 dagen voor of na de datum van de stop zijn geplaatst. Vink er een of meer aan en kies *Tekst toevoegen*, *Verhaal vervangen* of *Alleen link*. De gekozen berichten komen als link "Lees meer op rondjewereld.nl" onder het verhaal.
5. **Opslaan** (of Ctrl+S) schrijft `trip.json`, berekent de route voor gewijzigde trajecten en verwijdert foto's die niet meer gebruikt worden.
6. Klaar? Zet het vinkje *Concept* uit, sla op en publiceer:

```bash
git add -A
git commit -m "Nieuwe reis"
git push
```

GitHub Actions bouwt en publiceert de site daarna automatisch.

In de tab **Homepage** van de editor pas je het bovenschrift, de titel (het laatste woord wordt oranje), de introductie en de link-blokken aan, elk met een eigen afbeelding. Dit staat in `content/home/`.

Let op: de repository is publiek, dus ook concepten die je pusht zijn op GitHub te zien (alleen niet op de site). iPhone-foto's in HEIC-formaat werken niet; exporteer ze eerst als JPG.

## Inhoud

Elke reis staat in `content/trips/<slug>/`:

- `trip.json`: titel, samenvatting, omslagfoto, stops en de berekende trajecten (`legs`)
- `photos/`: foto's, waarnaar `trip.json` verwijst als `photos/<bestand>`

Stop-types: `overnachting`, `bezienswaardigheid`, `eten`, `activiteit`, `highlight` (zie `src/map.js`).

De editor berekent routes bij het opslaan. Handmatig alles opnieuw berekenen (via OSRM):

```bash
npm run route -- <slug>
```

Zonder slug worden alle reizen berekend. Zonder route vallen trajecten terug op een gestippelde rechte lijn.

## Links

- Overzicht: `index.html`
- Reis: `trip.html?reis=<slug>`
- Direct naar een stop: `trip.html?reis=<slug>#stop-<id>`
- Embedden zonder "Alle reizen"-link: voeg `&embed=1` toe

## Bouwen

```bash
npm run build
```

Het resultaat staat in `dist/` en is volledig statisch (geschikt voor GitHub Pages).
