// Maakt per reis een lijst van de openbare Flickr-foto's die in het tijdvak van de reis
// genomen zijn (content/trips/<slug>/flickr.json). De site toont die als raster via de
// knop "Foto's op Flickr"; de foto's zelf worden niet gedownload maar komen rechtstreeks
// van Flickr. Zo hoeft de API-sleutel (alleen in .env.local) niet op de site te staan.
//
// Gebruik: npm run flickr -- [reis-slug]      (zonder slug: alle reizen)

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { photosTakenBetween } from './flickr.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TRIPS_DIR = join(ROOT, 'content', 'trips');
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Foto-URL's van Flickr hebben de vorm …/<server>/<id>_<secret>_<maat>.jpg; met server
// en secret kan de site zelf elke maat t/m 1024 px (b) samenstellen.
const parts = (url) => /\/(\d+)\/(\d+)_([0-9a-f]+)(?:_[a-z])?\.jpg/.exec(url || '');

async function indexTrip(slug) {
  const file = join(TRIPS_DIR, slug, 'trip.json');
  if (!existsSync(file)) return;
  const trip = JSON.parse(await readFile(file, 'utf8'));
  const dates = trip.stops.map((s) => s.date).filter((d) => DATE.test(d || '')).sort();
  if (!dates.length) return console.log(`${slug}: geen datums, overgeslagen`);
  const from = dates[0];
  const to = dates.at(-1);

  const photos = [];
  let user = 'gerhardvandekrol';
  for (let page = 1; ; page++) {
    const res = await photosTakenBetween(ROOT, from, to, { page, perPage: 500 });
    for (const p of res.photos) {
      const m = parts(p.url) || parts(p.thumb);
      if (m) photos.push([m[2], m[1], m[3], p.taken, p.title]);
      user = /flickr\.com\/photos\/([^/]+)\//.exec(p.page)?.[1] || user;
    }
    if (page >= res.pages) break;
  }
  // [id, server, secret, genomen, titel] per foto, compact gehouden
  await writeFile(join(TRIPS_DIR, slug, 'flickr.json'), JSON.stringify({ user, from, to, photos }) + '\n');
  console.log(`${slug}: ${photos.length} foto's (${from} t/m ${to})`);
}

const slugs = process.argv[2] ? [process.argv[2]] : await readdir(TRIPS_DIR);
for (const slug of slugs) await indexTrip(slug);
