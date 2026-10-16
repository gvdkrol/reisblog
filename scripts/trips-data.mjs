// Vite-plugin die de inhoud van content/ aanbiedt als modules.
//
// `virtual:home` (content/home/home.json):
//   export const home   = { eyebrow, title, subtitle, linksTitle, links: [...] }
//   export const images = { 'images/x.webp': '<url van het gebundelde bestand>' }
//
// `virtual:trips`:
//   export const trips  = [ ...inhoud van content/trips/*/trip.json ]
//   export const photos = { '<slug>/photos/x.webp': '<url van het gebundelde bestand>' }
// Bij `npm run build` worden concepten (draft: true) en hun foto's weggelaten,
// zodat ze niet op de gepubliceerde site terechtkomen.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_HOME } from './editor-api.mjs';

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
        .filter((trip) => !(isBuild && trip.draft));

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
      for (const id of [RESOLVED_ID, RESOLVED_HOME_ID]) {
        const mod = server.moduleGraph.getModuleById(id);
        if (mod) server.moduleGraph.invalidateModule(mod);
      }
      return [];
    },
  };

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
