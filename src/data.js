// Reizen uit content/trips/*/trip.json, aangeleverd door scripts/trips-data.mjs.
// Vite bundelt alles bij het bouwen, dus de gepubliceerde site is volledig statisch.
// Concepten (draft: true) zitten alleen lokaal in de lijst, niet in de build.
import { trips as rawTrips, photos } from 'virtual:trips';
import { home, images as homeImages } from 'virtual:home';

export { home };

// URL van een afbeelding uit content/home ("images/x.webp").
export function homeAsset(path) {
  return homeImages[path] || '';
}

export const trips = rawTrips
  .map(enrich)
  .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));

export function getTrip(slug) {
  return trips.find((t) => t.slug === slug);
}

// Zet een pad uit trip.json ("photos/x.webp") om naar de URL van het gebundelde bestand.
export function asset(trip, path) {
  return photos[`${trip.slug}/${path}`] || path;
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
    stop.legIn = legs.find((l) => l.to === stop.id && l.polyline) || null;
  });

  return {
    ...trip,
    stops,
    legs,
    startDate,
    endDate,
    coverSrc: trip.cover || stops.find((s) => s.photos?.length)?.photos[0].src || '',
    totalKm: legs.reduce((sum, l) => sum + (l.km || 0), 0),
    totalMinutes: legs.reduce((sum, l) => sum + (l.minutes || 0), 0),
  };
}
