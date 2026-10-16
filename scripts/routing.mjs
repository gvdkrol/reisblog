// Route over de weg tussen stops, via de publieke OSRM-server.
// Elk traject krijgt een `key` met de coördinaten van begin en eind, zodat
// ongewijzigde trajecten bij opnieuw opslaan niet opnieuw berekend hoeven te worden.

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

// Geeft { legs, warnings }. Een traject dat niet berekend kan worden, wordt
// zonder geometrie opgeslagen (de viewer tekent dan een gestippelde rechte lijn).
export async function routeLegs(trip, { force = false } = {}) {
  const profile = trip.profile || 'driving';
  const cache = new Map((trip.legs || []).filter((l) => l.key && l.polyline).map((l) => [l.key, l]));
  const legs = [];
  const warnings = [];

  for (let i = 0; i < trip.stops.length - 1; i++) {
    const a = trip.stops[i];
    const b = trip.stops[i + 1];
    const cached = !force && cache.get(legKey(a, b));
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
