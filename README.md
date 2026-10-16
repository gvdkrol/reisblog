# Reisblog

Statische reisblog-site: een overzicht van reizen, en per reis een kaart met de route over de weg. Klik op een stop om rechts het verhaal en de foto's te lezen.

## Lokaal draaien

```bash
npm install
npm run dev
```

Open http://localhost:5173.

## Inhoud

Elke reis staat in `content/trips/<slug>/`:

- `trip.json`: titel, samenvatting, omslagfoto, stops en de berekende trajecten (`legs`)
- `photos/`: foto's, waarnaar `trip.json` verwijst als `photos/<bestand>`

Stop-types: `overnachting`, `bezienswaardigheid`, `eten`, `activiteit`, `highlight` (zie `src/map.js`).

Route opnieuw berekenen na het wijzigen van stops (via OSRM):

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
