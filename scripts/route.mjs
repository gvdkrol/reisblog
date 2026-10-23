// Berekent de route over de weg tussen alle stops van een reis opnieuw (via OSRM)
// en slaat afstand, reistijd en geometrie per traject op in trip.json.
// De editor doet dit automatisch bij opslaan; dit script is voor handmatig gebruik.
//
// Gebruik: npm run route -- <reis-slug>      (of zonder slug: alle reizen)

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeLegs } from './routing.mjs';

const TRIPS_DIR = fileURLToPath(new URL('../content/trips/', import.meta.url));

async function routeTrip(slug) {
  const file = join(TRIPS_DIR, slug, 'trip.json');
  const trip = JSON.parse(await readFile(file, 'utf8'));
  const { legs, warnings } = await routeLegs(trip, { force: true });
  for (const leg of legs) {
    const info = leg.flight ? `vlucht, ${leg.km} km (ongewijzigd)` : leg.polyline ? `${leg.km} km, ${leg.minutes} min` : 'geen route';
    console.log(`  ${leg.from} → ${leg.to}: ${info}`);
  }
  warnings.forEach((w) => console.warn(`  ⚠ ${w}`));
  trip.legs = legs;
  await writeFile(file, JSON.stringify(trip, null, 2) + '\n');
}

const slugs = process.argv[2] ? [process.argv[2]] : await readdir(TRIPS_DIR);
for (const slug of slugs) {
  console.log(`Route berekenen: ${slug}`);
  await routeTrip(slug);
}
