// Vite-plugin die alleen tijdens `npm run dev` een kleine API aanbiedt voor de editor
// (/admin). Alles wordt als bestanden in content/trips/ opgeslagen; de gepubliceerde
// site bevat deze API niet.
//
//   GET  /api/trips                  lijst van reizen
//   POST /api/trips                  nieuwe reis  { title }
//   GET  /api/trips/:slug            één reis
//   DELETE /api/trips/:slug          reis met alle stops en foto's verwijderen
//   PUT  /api/trips/:slug            reis opslaan (+ route berekenen, ongebruikte foto's opruimen)
//   POST /api/trips/:slug/photos?name=x.webp   foto uploaden (body = afbeelding)
//   GET  /api/home                   homepage (titel, intro, links)
//   PUT  /api/home                   homepage opslaan (+ ongebruikte afbeeldingen opruimen)
//   POST /api/home/images?name=x.webp          afbeelding voor een link uploaden
//   GET  /api/wordpress?date=YYYY-MM-DD&days=5  berichten van rondjewereld.nl rond een datum
//   GET  /api/flickr?date=YYYY-MM-DD              openbare Flickr-foto's genomen op die dag
//   GET  /api/flickr?from=…&to=…&page=n           idem voor een periode, per pagina van 100
//   POST /api/trips/:slug/photos?name=x.jpg&from=<flickr-url>  Flickr-foto downloaden naar de reis

import { readFile, writeFile, readdir, mkdir, unlink, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { routeLegs } from './routing.mjs';
import { postsAround } from './wordpress.mjs';
import { photosTakenOn, photosTakenBetween, downloadFlickrPhoto } from './flickr.mjs';
import { slugify } from '../src/slugify.js';

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const PHOTO = /^[a-z0-9][a-z0-9._-]*\.(webp|jpe?g|png|svg)$/i;
const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

export const DEFAULT_HOME = { eyebrow: '', title: 'Reisblog', subtitle: 'Onze reizen, stop voor stop.', linksTitle: 'Meer van ons', links: [] };

export function editorApi({ root }) {
  const tripsDir = join(root, 'content', 'trips');
  const homeDir = join(root, 'content', 'home');
  const homeFile = join(homeDir, 'home.json');
  const tripFile = (slug) => join(tripsDir, slug, 'trip.json');

  async function listTrips() {
    const slugs = (await readdir(tripsDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    const trips = await Promise.all(
      slugs.filter((s) => existsSync(tripFile(s))).map(async (slug) => {
        const t = await readTrip(slug);
        return { slug, title: t.title, draft: !!t.draft, stops: t.stops.length, start: t.stops[0]?.date || '' };
      })
    );
    return trips.sort((a, b) => b.start.localeCompare(a.start) || a.title.localeCompare(b.title));
  }

  async function readTrip(slug) {
    if (!existsSync(tripFile(slug))) throw httpError(404, `Reis "${slug}" bestaat niet`);
    return JSON.parse(await readFile(tripFile(slug), 'utf8'));
  }

  async function createTrip(title) {
    const base = slugify(title) || 'reis';
    let slug = base;
    for (let n = 2; existsSync(join(tripsDir, slug)); n++) slug = `${base}-${n}`;
    const trip = { title: String(title).trim(), slug, summary: '', cover: '', draft: true, profile: 'driving', stops: [], legs: [] };
    await mkdir(join(tripsDir, slug, 'photos'), { recursive: true });
    await writeFile(tripFile(slug), JSON.stringify(trip, null, 2) + '\n');
    return trip;
  }

  async function saveTrip(slug, input) {
    await readTrip(slug); // bestaat de reis?
    const trip = {
      title: String(input.title || '').trim() || 'Naamloze reis',
      slug,
      summary: String(input.summary || ''),
      cover: String(input.cover || ''),
      draft: !!input.draft,
      profile: input.profile || 'driving',
      stops: (input.stops || []).map((s) => ({
        id: String(s.id),
        name: String(s.name || ''),
        lat: Number(s.lat),
        lng: Number(s.lng),
        date: String(s.date || ''),
        type: String(s.type || 'bezienswaardigheid'),
        ...(s.draft ? { draft: true } : {}), // concept-stop: niet publiceren
        ...(typeof s.track === 'string' && s.track ? { track: s.track } : {}), // eigen spoor (fietstocht)
        ...(Number.isFinite(s.km) ? { km: s.km } : {}),
        text: String(s.text || ''),
        photos: (s.photos || []).map((p) => ({
          src: String(p.src),
          caption: String(p.caption || ''),
          ...(/^https?:\/\//i.test(p.link || '') ? { link: String(p.link) } : {}), // bron, bijv. de foto op Flickr
        })),
        // Gekoppelde blogberichten op rondjewereld.nl (link onder het verhaal).
        articles: (s.articles || [])
          .filter((a) => /^https?:\/\//i.test(a.url || ''))
          .map((a) => ({ title: String(a.title || ''), url: String(a.url), date: String(a.date || '') })),
      })),
      legs: Array.isArray(input.legs) ? input.legs : [],
    };
    if (trip.stops.some((s) => !Number.isFinite(s.lat) || !Number.isFinite(s.lng))) throw httpError(400, 'Stop zonder geldige locatie');

    const { legs, warnings } = await routeLegs(trip);
    trip.legs = legs;
    await removeUnusedPhotos(slug, trip);
    await writeFile(tripFile(slug), JSON.stringify(trip, null, 2) + '\n');
    return { trip, warnings };
  }

  // Foto's die nergens meer naar verwezen worden (verwijderd in de editor) opruimen.
  async function removeUnusedPhotos(slug, trip) {
    const dir = join(tripsDir, slug, 'photos');
    if (!existsSync(dir)) return;
    const used = new Set([trip.cover, ...trip.stops.flatMap((s) => s.photos.map((p) => p.src))]);
    for (const file of await readdir(dir)) {
      if (!used.has(`photos/${file}`)) await unlink(join(dir, file));
    }
  }

  async function savePhoto(slug, name, body) {
    await readTrip(slug);
    if (!PHOTO.test(name || '')) throw httpError(400, 'Ongeldige bestandsnaam');
    const dir = join(tripsDir, slug, 'photos');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), body);
    return { src: `photos/${name}` };
  }

  async function readHome() {
    if (!existsSync(homeFile)) return { ...DEFAULT_HOME };
    return { ...DEFAULT_HOME, ...JSON.parse(await readFile(homeFile, 'utf8')) };
  }

  async function saveHome(input) {
    const home = {
      eyebrow: String(input.eyebrow || ''),
      title: String(input.title || '').trim() || DEFAULT_HOME.title,
      subtitle: String(input.subtitle || ''),
      linksTitle: String(input.linksTitle || ''),
      links: (input.links || []).map((l) => ({
        title: String(l.title || ''),
        url: String(l.url || '').trim(),
        description: String(l.description || ''),
        image: String(l.image || ''),
      })),
    };
    const badUrl = home.links.find((l) => l.url && !/^https?:\/\//i.test(l.url));
    if (badUrl) throw httpError(400, `Link "${badUrl.title || badUrl.url}" moet met http:// of https:// beginnen`);

    await mkdir(join(homeDir, 'images'), { recursive: true });
    const used = new Set(home.links.map((l) => l.image));
    for (const file of await readdir(join(homeDir, 'images'))) {
      if (!used.has(`images/${file}`)) await unlink(join(homeDir, 'images', file));
    }
    await writeFile(homeFile, JSON.stringify(home, null, 2) + '\n');
    return home;
  }

  async function saveHomeImage(name, body) {
    if (!PHOTO.test(name || '')) throw httpError(400, 'Ongeldige bestandsnaam');
    await mkdir(join(homeDir, 'images'), { recursive: true });
    await writeFile(join(homeDir, 'images', name), body);
    return { src: `images/${name}` };
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const [, resource, slug, sub] = url.pathname.split('/').filter(Boolean);
    if (resource === 'flickr' && req.method === 'GET') {
      const q = url.searchParams;
      if (q.get('from')) return send(res, 200, await photosTakenBetween(root, q.get('from'), q.get('to'), { page: Number(q.get('page')) || 1 }));
      return send(res, 200, await photosTakenOn(root, url.searchParams.get('date')));
    }
    if (resource === 'wordpress' && req.method === 'GET') {
      const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 5, 0), 30);
      return send(res, 200, await postsAround(url.searchParams.get('date'), days));
    }
    if (resource === 'home') {
      if (!slug && req.method === 'GET') return send(res, 200, await readHome());
      if (!slug && req.method === 'PUT') return send(res, 200, await saveHome(JSON.parse(await readBody(req))));
      if (slug === 'images' && req.method === 'POST') {
        return send(res, 201, await saveHomeImage(url.searchParams.get('name'), await readBody(req, MAX_PHOTO_BYTES, true)));
      }
      throw httpError(405, 'Niet ondersteund');
    }
    if (resource !== 'trips') throw httpError(404, 'Onbekend endpoint');
    if (slug && !SLUG.test(slug)) throw httpError(400, 'Ongeldige reis');

    if (!slug && req.method === 'GET') return send(res, 200, await listTrips());
    if (!slug && req.method === 'POST') {
      const { title } = JSON.parse(await readBody(req));
      if (!title?.trim()) throw httpError(400, 'Titel ontbreekt');
      return send(res, 201, await createTrip(title));
    }
    if (slug && !sub && req.method === 'GET') return send(res, 200, await readTrip(slug));
    if (slug && !sub && req.method === 'DELETE') {
      await readTrip(slug); // bestaat de reis?
      await rm(join(tripsDir, slug), { recursive: true, force: true });
      return send(res, 200, { deleted: slug });
    }
    if (slug && !sub && req.method === 'PUT') return send(res, 200, await saveTrip(slug, JSON.parse(await readBody(req))));
    if (slug && sub === 'photos' && url.searchParams.get('from') && req.method === 'POST') {
      // foto van Flickr ophalen en bij de reis opslaan
      return send(res, 201, await savePhoto(slug, url.searchParams.get('name'), await downloadFlickrPhoto(url.searchParams.get('from'))));
    }
    if (slug && sub === 'photos' && req.method === 'POST') {
      return send(res, 201, await savePhoto(slug, url.searchParams.get('name'), await readBody(req, MAX_PHOTO_BYTES, true)));
    }
    throw httpError(405, 'Niet ondersteund');
  }

  return {
    name: 'reisblog-editor-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url === '/admin' || req.url === '/admin/') {
          res.writeHead(302, { Location: '/admin.html' });
          return res.end();
        }
        if (!req.url.startsWith('/api/')) return next();
        try {
          await handle(req, res);
        } catch (err) {
          send(res, err.status || 500, { error: err.message });
        }
      });
    },
  };
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req, limit = 5 * 1024 * 1024, raw = false) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(httpError(413, 'Bestand te groot'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      resolve(raw ? buf : buf.toString('utf8'));
    });
    req.on('error', reject);
  });
}
