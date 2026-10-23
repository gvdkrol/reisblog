// Reizen uit content/trips/*/trip.json, aangeleverd door scripts/trips-data.mjs.
// Vite bundelt alles bij het bouwen, dus de gepubliceerde site is volledig statisch.
// Concepten (draft: true) zitten alleen lokaal in de lijst, niet in de build.
// `trips` bevat alleen samenvattingen (voor de homepage); de volledige reis komt
// pas binnen met loadTrip(slug), de routes voor de overzichtskaart met loadRoutes().
import { summaries, photos as coverPhotos, loaders, loadRoutes } from 'virtual:trips';
import { home, images as homeImages } from 'virtual:home';
import { legInto } from './stops.js';

export { home, loadRoutes };

// URL van een afbeelding uit content/home ("images/x.webp").
export function homeAsset(path) {
  return homeImages[path] || '';
}

export const trips = [...summaries].sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));

// Foto-URL's per reis, aangevuld zodra een reis geladen is.
const photos = { ...coverPhotos };

// Volledige reis (stops, trajecten, teksten); null als de reis niet bestaat.
export async function loadTrip(slug) {
  const load = Object.hasOwn(loaders, slug) ? loaders[slug] : null;
  if (!load) return null;
  const mod = await load();
  const trip = await mod.loadTrip();
  if (!trip) return null;
  for (const [path, url] of Object.entries(mod.photos)) photos[`${slug}/${path}`] = url;
  return enrich(trip);
}

// Openbare Flickr-foto's uit het tijdvak van de reis: { user, from, to, photos: [[id,
// server, secret, genomen, titel], …] }, of null als de lijst nog niet gemaakt is.
export async function loadFlickr(slug) {
  const load = Object.hasOwn(loaders, slug) ? loaders[slug] : null;
  return load ? (await load()).loadFlickr() : null;
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
  // Fietstochten liggen naast de route: de afstand "vanaf …" loopt van de vorige
  // stop op de route, niet vanaf de fietstocht.
  const visible = stops.filter((s) => s.type !== 'via');
  visible.forEach((stop, n) => {
    stop.number = n + 1;
    stop.prevStop = visible[n - 1] || null;
    stop.nextStop = visible[n + 1] || null;
    const into = legInto(stops, legs, stop);
    stop.legIn = into?.leg || null;
    stop.prevRouteStop = into?.from || null;
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
