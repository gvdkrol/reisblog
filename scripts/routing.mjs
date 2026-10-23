// Route over de weg tussen stops, via de publieke OSRM-server.
// Elk traject krijgt een `key` met de coördinaten van begin en eind, zodat
// ongewijzigde trajecten bij opnieuw opslaan niet opnieuw berekend hoeven te worden.

import { onRoute } from '../src/stops.js';
import { encodePolyline } from '../src/polyline.js';

const OSRM = 'https://router.project-osrm.org/route/v1';

export const legKey = (a, b) => `${a.lat},${a.lng};${b.lat},${b.lng}`;

export async function routeLeg(profile, a, b) {
  const url = `${OSRM}/${profile}/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=polyline`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OSRM ${res.status} voor ${a.name} → ${b.name}`);
  const json = await res.json();
  if (json.code !== 'Ok') throw new Error(`geen route gevonden van ${a.name} naar ${b.name}`);
  const r = json.routes[0];
  return {
    from: a.id,
    to: b.id,
    key: legKey(a, b),
    km: Math.round(r.distance / 100) / 10,
    minutes: Math.round(r.duration / 60),
    polyline: r.geometry,
  };
}

// Traject in een rechte lijn, voor een stop met `straight: true` ("volg niet de weg"),
// bijv. een boottocht of een stuk door het terrein. Afstand hemelsbreed, zonder reistijd.
export function straightLeg(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return {
    from: a.id,
    to: b.id,
    key: legKey(a, b),
    km: Math.round(12742 * Math.asin(Math.sqrt(h)) * 10) / 10,
    straight: true,
    polyline: encodePolyline([[a.lat, a.lng], [b.lat, b.lng]]),
  };
}

// Geeft { legs, warnings }. Een traject dat niet berekend kan worden, wordt
// zonder geometrie opgeslagen (de viewer tekent dan een gestippelde rechte lijn).
// Vluchttrajecten (flight: true) blijven altijd staan, ook met `force`, zolang
// begin en eind niet verplaatst zijn; die gaan niet over de weg. Naar een stop met
// `straight: true` loopt altijd een rechte lijn.
export async function routeLegs(trip, { force = false } = {}) {
  const profile = trip.profile || 'driving';
  const cache = new Map((trip.legs || []).filter((l) => l.key && (l.polyline || l.flight)).map((l) => [l.key, l]));
  const legs = [];
  const warnings = [];

  const route = trip.stops.filter(onRoute); // fietstochten liggen naast de route
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i];
    const b = route[i + 1];
    const hit = cache.get(legKey(a, b));
    if (b.straight && !hit?.flight) {
      legs.push(straightLeg(a, b));
      continue;
    }
    const cached = hit && !hit.straight && (!force || hit.flight) ? hit : null;
    if (cached) {
      legs.push({ ...cached, from: a.id, to: b.id });
      continue;
    }
    try {
      legs.push(await routeLeg(profile, a, b));
    } catch (err) {
      warnings.push(err.message);
      legs.push({ from: a.id, to: b.id, key: legKey(a, b) });
    }
  }
  return { legs, warnings };
}
