// Vite-plugin die de inhoud van content/ aanbiedt als modules.
//
// `virtual:home` (content/home/home.json):
//   export const home   = { eyebrow, title, subtitle, linksTitle, links: [...] }
//   export const images = { 'images/x.webp': '<url van het gebundelde bestand>' }
//
// `virtual:trips`:
//   export const trips  = [ ...inhoud van content/trips/*/trip.json ]
//   export const photos = { '<slug>/photos/x.webp': '<url van het gebundelde bestand>' }
// Bij `npm run build` worden concept-reizen en concept-stops (draft: true) met hun
// foto's weggelaten, zodat ze niet op de gepubliceerde site terechtkomen. De
// trajecten rond een weggelaten stop worden samengevoegd, zodat de route doorloopt.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_HOME } from './editor-api.mjs';
import { legKey } from './routing.mjs';
import { decodePolyline, encodePolyline } from '../src/polyline.js';
import { onRoute } from '../src/stops.js';

const ID = 'virtual:trips';
const RESOLVED_ID = '\0virtual:trips';
const HOME_ID = 'virtual:home';
const RESOLVED_HOME_ID = '\0virtual:home';

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
    },
    load(id) {
      if (id === RESOLVED_HOME_ID) return loadHome();
      if (id !== RESOLVED_ID) return;
      const trips = readdirSync(tripsDir)
        .filter((slug) => existsSync(join(tripsDir, slug, 'trip.json')))
        .map((slug) => JSON.parse(readFileSync(join(tripsDir, slug, 'trip.json'), 'utf8')))
        .filter((trip) => !(isBuild && trip.draft))
        .map((trip) => (isBuild ? withoutDraftStops(trip) : trip));

      const imports = [];
      const entries = [];
      for (const trip of trips) {
        const srcs = new Set([trip.cover, ...trip.stops.flatMap((s) => (s.photos || []).map((p) => p.src))]);
        for (const src of srcs) {
          if (!src || !existsSync(join(tripsDir, trip.slug, src))) continue;
          const name = `photo${imports.length}`;
          imports.push(`import ${name} from ${JSON.stringify(`/content/trips/${trip.slug}/${src}?url`)};`);
          entries.push(`${JSON.stringify(`${trip.slug}/${src}`)}: ${name}`);
        }
      }
      return `${imports.join('\n')}
export const trips = ${JSON.stringify(trips)};
export const photos = { ${entries.join(', ')} };`;
    },
    // Wijzigingen in content/ niet live doorgeven: anders herlaadt Vite ook de editor
    // (bij elke foto-upload) en gaan niet-opgeslagen wijzigingen verloren. De module
    // wordt wel ververst, zodat een herladen reispagina de nieuwe inhoud toont.
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
    for (const id of [RESOLVED_ID, RESOLVED_HOME_ID]) {
      const mod = server.moduleGraph.getModuleById(id);
      if (mod) server.moduleGraph.invalidateModule(mod);
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
