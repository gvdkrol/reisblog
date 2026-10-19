// Haalt openbare Flickr-foto's op die op een bepaalde dag genomen zijn, zodat de
// editor ze bij een stop kan zetten. Gebruikt de Flickr-API met een eigen sleutel
// uit reisblog/.env.local (niet in git):
//
//   FLICKR_API_KEY=jouw-sleutel
//   FLICKR_USER=gerhardvandekrol          (gebruikersnaam uit de Flickr-URL)

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

// Formaat van foto's die van Flickr worden overgenomen: klein genoeg voor de repo,
// groot genoeg voor het zijpaneel.
export const FLICKR_MAX_PX = 1000;
export const FLICKR_QUALITY = 75;

const API = 'https://api.flickr.com/services/rest/';

function config(root) {
  const file = join(root, '.env.local');
  const env = {};
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  const key = env.FLICKR_API_KEY || process.env.FLICKR_API_KEY;
  const user = env.FLICKR_USER || process.env.FLICKR_USER || 'gerhardvandekrol';
  if (!key) {
    throw Object.assign(new Error('Geen Flickr API-sleutel: zet FLICKR_API_KEY=… in reisblog/.env.local'), { status: 400 });
  }
  return { key, user };
}

async function call(key, method, params) {
  const url = `${API}?${new URLSearchParams({ method, api_key: key, format: 'json', nojsoncallback: '1', ...params })}`;
  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(url);
      break;
    } catch (err) {
      // verbindingen met Flickr haperen soms; een paar keer opnieuw proberen
      if (attempt === 5) throw Object.assign(new Error(`Geen verbinding met Flickr (${err.cause?.code || err.message})`), { status: 502 });
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  if (!res.ok) throw Object.assign(new Error(`Flickr gaf een fout (${res.status})`), { status: 502 });
  const json = await res.json();
  if (json.stat !== 'ok') throw Object.assign(new Error(`Flickr: ${json.message || 'onbekende fout'}`), { status: 502 });
  return json;
}

const nsidCache = new Map();
async function nsidOf(key, user) {
  if (/^\d+@N\d+$/.test(user)) return user;
  if (!nsidCache.has(user)) {
    const json = await call(key, 'flickr.urls.lookupUser', { url: `https://www.flickr.com/photos/${user}/` });
    nsidCache.set(user, json.user.id);
  }
  return nsidCache.get(user);
}

// Foto's genomen op `date` (JJJJ-MM-DD), oudste eerst.
export async function photosTakenOn(root, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw Object.assign(new Error('Geef de stop eerst een geldige datum'), { status: 400 });
  const { key, user } = config(root);
  const nsid = await nsidOf(key, user);
  const json = await call(key, 'flickr.photos.search', {
    user_id: nsid,
    min_taken_date: `${date} 00:00:00`,
    max_taken_date: `${date} 23:59:59`,
    extras: 'date_taken,geo,url_q,url_n,url_z,url_c,url_l,url_h',
    sort: 'date-taken-asc',
    per_page: '250',
  });
  return json.photos.photo.map((p) => ({
    id: p.id,
    title: p.title || '',
    taken: p.datetaken,
    thumb: p.url_n || p.url_q || p.url_z,
    // iets groter dan nodig ophalen; bij het downloaden wordt verkleind naar FLICKR_MAX_PX
    url: p.url_l || p.url_c || p.url_h || p.url_z,
    page: `https://www.flickr.com/photos/${p.pathalias || user}/${p.id}/`,
    lat: Number(p.latitude) || null,
    lng: Number(p.longitude) || null,
  }));
}

// URL van de 'Large'-versie (1024 px) van een foto, bijv. om een eerder gedownloade
// foto opnieuw op te halen.
export async function largeUrlOf(root, id) {
  const { key } = config(root);
  const json = await call(key, 'flickr.photos.getSizes', { photo_id: String(id) });
  const sizes = json.sizes.size;
  const pick = sizes.find((s) => s.label === 'Large') || sizes.find((s) => s.label === 'Medium 800') || sizes.at(-1);
  return pick.source;
}

// Verkleinen tot max. FLICKR_MAX_PX (langste zijde) en opnieuw comprimeren als JPEG.
export function shrinkPhoto(buffer) {
  return sharp(buffer)
    .rotate() // EXIF-oriëntatie toepassen
    .resize({ width: FLICKR_MAX_PX, height: FLICKR_MAX_PX, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: FLICKR_QUALITY, mozjpeg: true })
    .toBuffer();
}

// Foto downloaden (alleen van Flickr), verkleinen en de bytes teruggeven.
export async function downloadFlickrPhoto(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    host = '';
  }
  if (!/(^|\.)staticflickr\.com$/.test(host)) throw Object.assign(new Error('Alleen foto\'s van Flickr'), { status: 400 });
  // Een paar keer proberen: verbindingen met Flickr haperen soms.
  let lastError;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'reisblog-editor/1.0' } });
      if (!res.ok) throw new Error(`status ${res.status}`);
      return await shrinkPhoto(Buffer.from(await res.arrayBuffer()));
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw Object.assign(new Error(`Downloaden van Flickr mislukt (${lastError?.cause?.code || lastError?.message})`), { status: 502 });
}
