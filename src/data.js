// Laadt alle reizen uit content/trips/*/trip.json en de bijbehorende foto's.
// Vite bundelt alles bij het bouwen, dus de gepubliceerde site is volledig statisch.

const tripModules = import.meta.glob('/content/trips/*/trip.json', { eager: true, import: 'default' });
const photoModules = import.meta.glob('/content/trips/*/photos/*', { eager: true, query: '?url', import: 'default' });

export const trips = Object.values(tripModules)
  .map(enrich)
  .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));

export function getTrip(slug) {
  return trips.find((t) => t.slug === slug);
}

// Zet een pad uit trip.json ("photos/x.webp") om naar de URL van het gebundelde bestand.
export function asset(trip, path) {
  return photoModules[`/content/trips/${trip.slug}/${path}`] || path;
}

function enrich(trip) {
  const stops = trip.stops || [];
  const legs = trip.legs || [];
  const startDate = stops[0]?.date;
  const endDate = stops[stops.length - 1]?.date;
  const start = startDate ? Date.parse(startDate) : null;

  stops.forEach((stop, i) => {
    stop.index = i;
    stop.day = start && stop.date ? Math.round((Date.parse(stop.date) - start) / 86400000) + 1 : null;
    stop.legIn = legs.find((l) => l.to === stop.id) || null;
  });

  return {
    ...trip,
    stops,
    legs,
    startDate,
    endDate,
    totalKm: legs.reduce((sum, l) => sum + (l.km || 0), 0),
    totalMinutes: legs.reduce((sum, l) => sum + (l.minutes || 0), 0),
  };
}
