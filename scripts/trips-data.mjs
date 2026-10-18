// Vite-plugin die de inhoud van content/ aanbiedt als modules.
//
// `virtual:home` (content/home/home.json):
//   export const home   = { eyebrow, title, subtitle, linksTitle, links: [...] }
//   export const images = { 'images/x.webp': '<url van het gebundelde bestand>' }
//
// `virtual:trips` (licht: alleen wat de homepage nodig heeft):
//   export const summaries = [ { slug, title, summary, draft, startDate, endDate, coverSrc,
//                                stopCount, totalKm }, ... ]
//   export const photos  = { '<slug>/photos/x.webp': '<url van de omslagfoto>' }
//   export const loaders = { '<slug>': () => import('virtual:trip/<slug>') }
//   export function loadRoutes() → Promise<{ '<slug>': { route, points } }>
//     route  = sterk vereenvoudigde route als "encoded polyline" voor de overzichtskaart
//     points = [[lat, lng], ...] van de zichtbare stops
//
// `virtual:trip/<slug>` (één reis, alleen geladen door de reispagina):
//   export const photos = { 'photos/x.webp': '<url van het gebundelde bestand>' }
//   export function loadTrip() → Promise<inhoud van trip.json>
//
// Bij `npm run build` staan de reis en de routes voor de overzichtskaart in aparte
// JSON-bestanden (met vereenvoudigde route-geometrie) die pas worden opgehaald als ze
// nodig zijn; zo blijft elke JS-chunk klein. Tijdens `npm run dev` zit alles inline.
//
// Bij `npm run build` worden concept-reizen en concept-stops (draft: true) met hun
// foto's weggelaten, zodat ze niet op de gepubliceerde site terechtkomen. De
// trajecten rond een weggelaten stop worden samengevoegd, zodat de route doorloopt.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_HOME } from './editor-api.mjs';
import { legKey } from './routing.mjs';
import { decodePolyline, encodePolyline } from '../src/polyline.js';
import { isVia, onRoute } from '../src/stops.js';

const ID = 'virtual:trips';
const RESOLVED_ID = '\0virtual:trips';
const TRIP_PREFIX = 'virtual:trip/';
const RESOLVED_TRIP_PREFIX = '\0virtual:trip/';
const HOME_ID = 'virtual:home';
const RESOLVED_HOME_ID = '\0virtual:home';

// Toleranties (in graden) voor het vereenvoudigen van routes: ±3 m op de reispagina
// (niet te zien), ±1 km op de overzichtskaart met alle reizen (daar is 1 pixel al
// gauw enkele kilometers).
const TRIP_TOLERANCE = 3e-5;
const OVERVIEW_TOLERANCE = 1e-2;

export function tripsData({ root }) {
  const contentDir = join(root, 'content');
  const tripsDir = join(contentDir, 'trips');
  const homeDir = join(contentDir, 'home');
  const normalize = (p) => p.replaceAll('\\', '/');
  let isBuild = false;

  return {
    name: 'reisblog-trips-data',
    configResolved(config) {
      isBuild = config.command === 'build';
    },
    resolveId(id) {
      if (id === ID) return RESOLVED_ID;
      if (id === HOME_ID) return RESOLVED_HOME_ID;
      if (id.startsWith(TRIP_PREFIX)) return `\0${id}`;
    },
    load(id) {
      if (id === RESOLVED_HOME_ID) return loadHome();
      if (id === RESOLVED_ID) return loadSummaries(this);
      if (id.startsWith(RESOLVED_TRIP_PREFIX)) return loadTrip(this, id.slice(RESOLVED_TRIP_PREFIX.length));
    },
    // Wijzigingen in content/ niet live doorgeven: anders herlaadt Vite ook de editor
    // (bij elke foto-upload) en gaan niet-opgeslagen wijzigingen verloren. De modules
    // worden wel ververst, zodat een herladen pagina de nieuwe inhoud toont.
    handleHotUpdate({ file, server }) {
      if (!normalize(file).startsWith(normalize(contentDir))) return;
      invalidate(server);
      return [];
    },
    // Nieuwe of verwijderde bestanden (bijv. een geïmporteerde reis) komen niet altijd
    // via handleHotUpdate binnen; daarom ook rechtstreeks op de watcher letten.
    configureServer(server) {
      const onFile = (file) => {
        if (normalize(file).startsWith(normalize(contentDir))) invalidate(server);
      };
      server.watcher.on('add', onFile);
      server.watcher.on('unlink', onFile);
      server.watcher.on('addDir', onFile);
      server.watcher.on('unlinkDir', onFile);
    },
  };

  // Eén reis zoals hij op de site komt; bij build null voor een concept-reis.
  function readTrip(slug) {
    const file = join(tripsDir, slug, 'trip.json');
    if (!existsSync(file)) return null;
    const trip = JSON.parse(readFileSync(file, 'utf8'));
    if (isBuild && trip.draft) return null;
    return isBuild ? withoutDraftStops(trip) : trip;
  }

  // Voegt import-regels en "sleutel: url"-items toe voor foto's die echt bestaan.
  function addPhotos(out, slug, srcs, keyOf) {
    for (const src of new Set(srcs)) {
      if (!src || !existsSync(join(tripsDir, slug, src))) continue;
      const name = `photo${out.imports.length}`;
      out.imports.push(`import ${name} from ${JSON.stringify(`/content/trips/${slug}/${src}?url`)};`);
      out.entries.push(`${JSON.stringify(keyOf(src))}: ${name}`);
    }
  }

  // Code voor `export async function <fn>()` die `data` oplevert: bij build als apart
  // JSON-bestand dat pas bij aanroep wordt opgehaald, tijdens dev gewoon inline.
  function jsonLoader(ctx, fn, name, data) {
    if (!isBuild) return `export async function ${fn}() { return ${JSON.stringify(data)}; }`;
    const ref = ctx.emitFile({ type: 'asset', name, source: JSON.stringify(data) });
    return `export async function ${fn}() {
  const res = await fetch(import.meta.ROLLUP_FILE_URL_${ref});
  if (!res.ok) throw new Error(${JSON.stringify(`${name} kon niet worden geladen`)} + ' (' + res.status + ')');
  return res.json();
}`;
  }

  function loadSummaries(ctx) {
    const trips = readdirSync(tripsDir).map(readTrip).filter(Boolean);
    const summaries = trips.map(summarize);
    const routes = Object.fromEntries(trips.map((trip) => [trip.slug, overviewRoute(trip)]));
    const out = { imports: [], entries: [] };
    for (const s of summaries) addPhotos(out, s.slug, [s.coverSrc], (src) => `${s.slug}/${src}`);
    const loaders = summaries.map((s) => `${JSON.stringify(s.slug)}: () => import(${JSON.stringify(TRIP_PREFIX + s.slug)})`);
    return `${out.imports.join('\n')}
export const summaries = ${JSON.stringify(summaries)};
export const photos = { ${out.entries.join(', ')} };
export const loaders = { ${loaders.join(', ')} };
${jsonLoader(ctx, 'loadRoutes', 'overzicht.json', routes)}`;
  }

  function loadTrip(ctx, slug) {
    const trip = readTrip(slug);
    if (!trip) return 'export const photos = {};\nexport async function loadTrip() { return null; }';
    // De omslagfoto zit al in `virtual:trips`; niet nog eens importeren, anders maakt de
    // bundler voor elke gedeelde foto een eigen mini-chunk.
    const cover = coverOf(trip);
    const srcs = trip.stops.flatMap((s) => (s.photos || []).map((p) => p.src)).filter((src) => src !== cover);
    const out = { imports: [], entries: [] };
    addPhotos(out, slug, srcs, (src) => src);

    const data = isBuild
      ? {
          ...trip,
          stops: trip.stops.map((s) => (s.track ? { ...s, track: simplifyEncoded(s.track, TRIP_TOLERANCE) } : s)),
          legs: (trip.legs || []).map((l) => (l.polyline ? { ...l, polyline: simplifyEncoded(l.polyline, TRIP_TOLERANCE) } : l)),
        }
      : trip;
    return `${out.imports.join('\n')}
export const photos = { ${out.entries.join(', ')} };
${jsonLoader(ctx, 'loadTrip', `${slug}.json`, data)}`;
  }

  // Samenvatting voor de homepage: kaartje en kerncijfers.
  function summarize(trip) {
    const stops = trip.stops || [];
    const legs = trip.legs || [];
    return {
      slug: trip.slug,
      title: trip.title,
      summary: trip.summary,
      ...(trip.draft ? { draft: true } : {}),
      startDate: stops[0]?.date,
      endDate: stops[stops.length - 1]?.date,
      coverSrc: coverOf(trip),
      stopCount: stops.filter((s) => !isVia(s)).length,
      totalKm: legs.reduce((sum, l) => sum + (l.km || 0), 0),
    };
  }

  // Grove route en stops van een reis voor de overzichtskaart.
  function overviewRoute(trip) {
    const round = (n) => Math.round(n * 1e3) / 1e3;
    return {
      route: encodePolyline(simplify(routePoints(trip.stops, trip.legs || []), OVERVIEW_TOLERANCE)),
      points: trip.stops.filter((s) => !isVia(s)).map((s) => [round(s.lat), round(s.lng)]),
    };
  }

  function coverOf(trip) {
    return trip.cover || trip.stops.find((s) => s.photos?.length)?.photos[0].src || '';
  }

  // Alle trajecten achter elkaar, met een rechte lijn waar een berekende route ontbreekt.
  function routePoints(stops, legs) {
    const byPair = new Map(legs.map((l) => [`${l.from}>${l.to}`, l]));
    const route = stops.filter(onRoute);
    const points = route.length ? [[route[0].lat, route[0].lng]] : [];
    for (let i = 0; i < route.length - 1; i++) {
      const a = route[i];
      const b = route[i + 1];
      const leg = byPair.get(`${a.id}>${b.id}`);
      points.push(...(leg?.polyline ? decodePolyline(leg.polyline).slice(1) : [[b.lat, b.lng]]));
    }
    return points;
  }

  function withoutDraftStops(trip) {
    if (!trip.stops.some((s) => s.draft)) return trip;
    const legs = new Map((trip.legs || []).map((l) => [`${l.from}>${l.to}`, l]));
    const route = trip.stops.filter(onRoute);
    const keptRoute = route.filter((s) => !s.draft);
    const merged = [];
    for (let k = 0; k < keptRoute.length - 1; k++) {
      const a = keptRoute[k];
      const b = keptRoute[k + 1];
      const chain = route.slice(route.indexOf(a), route.indexOf(b) + 1);
      const parts = chain.slice(1).map((s, j) => legs.get(`${chain[j].id}>${s.id}`));
      if (!parts.every((p) => p?.polyline)) continue; // viewer tekent dan een rechte lijn
      const points = parts.flatMap((p, j) => (j ? decodePolyline(p.polyline).slice(1) : decodePolyline(p.polyline)));
      const minutes = parts.every((p) => Number.isFinite(p.minutes)) ? parts.reduce((sum, p) => sum + p.minutes, 0) : undefined;
      merged.push({
        from: a.id,
        to: b.id,
        key: legKey(a, b),
        km: Math.round(parts.reduce((sum, p) => sum + p.km, 0) * 10) / 10,
        ...(minutes !== undefined ? { minutes } : {}),
        polyline: encodePolyline(points),
      });
    }
    return { ...trip, stops: trip.stops.filter((s) => !s.draft), legs: merged };
  }

  function invalidate(server) {
    for (const mod of server.moduleGraph.idToModuleMap.values()) {
      if (mod.id === RESOLVED_ID || mod.id === RESOLVED_HOME_ID || mod.id?.startsWith(RESOLVED_TRIP_PREFIX)) {
        server.moduleGraph.invalidateModule(mod);
      }
    }
  }

  function loadHome() {
    const file = join(homeDir, 'home.json');
    const home = { ...DEFAULT_HOME, ...(existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}) };
    const imports = [];
    const entries = [];
    for (const src of new Set(home.links.map((l) => l.image))) {
      if (!src || !existsSync(join(homeDir, src))) continue;
      const name = `image${imports.length}`;
      imports.push(`import ${name} from ${JSON.stringify(`/content/home/${src}?url`)};`);
      entries.push(`${JSON.stringify(src)}: ${name}`);
    }
    return `${imports.join('\n')}
export const home = ${JSON.stringify(home)};
export const images = { ${entries.join(', ')} };`;
  }
}

const simplifyEncoded = (str, tolerance) => encodePolyline(simplify(decodePolyline(str), tolerance));

// Douglas-Peucker: laat punten weg die minder dan `tolerance` (graden) van de lijn afwijken.
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const max = tolerance * tolerance;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ay, ax] = points[a];
    const [by, bx] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    let worst = -1;
    let worstDist = max;
    for (let i = a + 1; i < b; i++) {
      const [py, px] = points[i];
      const u = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
      const ex = ax + u * dx - px;
      const ey = ay + u * dy - py;
      const dist = ex * ex + ey * ey;
      if (dist > worstDist) {
        worstDist = dist;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}
