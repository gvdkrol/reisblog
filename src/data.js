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
  });

  // Via-punten zijn alleen stipjes op de route: geen nummer, niet aanklikbaar, en
  // vorige/volgende en "x km vanaf …" slaan ze over.
  const visible = stops.filter((s) => s.type !== 'via');
  const legByPair = new Map(legs.map((l) => [`${l.from}>${l.to}`, l]));
  visible.forEach((stop, n) => {
    stop.number = n + 1;
    stop.prevStop = visible[n - 1] || null;
    stop.nextStop = visible[n + 1] || null;
    stop.legIn = null;
    if (!stop.prevStop) return;
    const chain = stops.slice(stop.prevStop.index, stop.index + 1);
    const parts = chain.slice(1).map((s, j) => legByPair.get(`${chain[j].id}>${s.id}`));
    if (!parts.every((p) => p?.polyline)) return;
    stop.legIn = {
      polyline: true,
      km: parts.reduce((sum, p) => sum + p.km, 0),
      minutes: parts.every((p) => Number.isFinite(p.minutes)) ? parts.reduce((sum, p) => sum + p.minutes, 0) : undefined,
    };
  });

  return {
    ...trip,
    stops,
    legs,
    startDate,
    endDate,
    visibleStops: visible,
    stopCount: visible.length,
    coverSrc: trip.cover || stops.find((s) => s.photos?.length)?.photos[0].src || '',
    totalKm: legs.reduce((sum, l) => sum + (l.km || 0), 0),
    totalMinutes: legs.reduce((sum, l) => sum + (l.minutes || 0), 0),
  };
}
