// Berekent de route over de weg tussen alle stops van een reis (via OSRM)
// en slaat afstand, reistijd en geometrie per traject op in trip.json.
//
// Gebruik: npm run route -- <reis-slug>      (of zonder slug: alle reizen)

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TRIPS_DIR = fileURLToPath(new URL('../content/trips/', import.meta.url));
const OSRM = 'https://router.project-osrm.org/route/v1';

async function routeLeg(profile, a, b) {
  const url = `${OSRM}/${profile}/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=polyline`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OSRM ${res.status} voor ${a.name} → ${b.name}`);
  const json = await res.json();
  if (json.code !== 'Ok') throw new Error(`OSRM: ${json.code} voor ${a.name} → ${b.name}`);
  const r = json.routes[0];
  return {
    from: a.id,
    to: b.id,
    km: Math.round(r.distance / 100) / 10,
    minutes: Math.round(r.duration / 60),
    polyline: r.geometry,
  };
}

async function routeTrip(slug) {
  const file = join(TRIPS_DIR, slug, 'trip.json');
  const trip = JSON.parse(await readFile(file, 'utf8'));
  const profile = trip.profile || 'driving';
  const legs = [];
  for (let i = 0; i < trip.stops.length - 1; i++) {
    const leg = await routeLeg(profile, trip.stops[i], trip.stops[i + 1]);
    console.log(`  ${trip.stops[i].name} → ${trip.stops[i + 1].name}: ${leg.km} km, ${leg.minutes} min`);
    legs.push(leg);
  }
  trip.legs = legs;
  await writeFile(file, JSON.stringify(trip, null, 2) + '\n');
}

const slugs = process.argv[2] ? [process.argv[2]] : await readdir(TRIPS_DIR);
for (const slug of slugs) {
  console.log(`Route berekenen: ${slug}`);
  await routeTrip(slug);
}
