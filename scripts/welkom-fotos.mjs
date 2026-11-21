// Foto's voor de welkomspagina: haalt de liggende foto's uit het Flickr-album
// "Rondjewereld" op, verkleint ze naar welkom/foto/<id>.jpg en schrijft welkom/album.js
// (titel, plek, land, datum en bestandsnaam per foto). De build gebruikt alleen deze
// lokale bestanden, dus de welkomspagina hangt niet van Flickr af.
//
//   npm run welkom:fotos             nieuwe foto's ophalen (bestaande worden overgeslagen)
//   npm run welkom:fotos -- --opnieuw   alles opnieuw downloaden
//
// Vraagt FLICKR_API_KEY in .env.local (zoals npm run flickr).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const ROOT = join(import.meta.dirname, '..');
const ALBUM = '72157639967082983';
const DIR = join(ROOT, 'welkom', 'foto');
const MAX_PX = 1600;
const opnieuw = process.argv.includes('--opnieuw');

const env = existsSync(join(ROOT, '.env.local')) ? readFileSync(join(ROOT, '.env.local'), 'utf8') : '';
const key = (env.match(/^FLICKR_API_KEY=(.*)$/m)?.[1] || process.env.FLICKR_API_KEY || '').trim().replace(/^["']|["']$/g, '');
if (!key) throw new Error('FLICKR_API_KEY ontbreekt (zet hem in .env.local)');

// Flickr hapert soms (ECONNRESET): een paar keer opnieuw proberen.
async function get(url, as = 'json') {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return as === 'json' ? res.json() : Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (i >= 6) throw err;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

const params = new URLSearchParams({
  method: 'flickr.photosets.getPhotos', api_key: key, format: 'json', nojsoncallback: '1',
  photoset_id: ALBUM, per_page: '500', extras: 'date_taken,url_l,url_h,o_dims',
});
const json = await get('https://api.flickr.com/services/rest/?' + params);
if (json.stat !== 'ok') throw new Error(`Flickr: ${json.message}`);

const photos = json.photoset.photo
  .filter((p) => Number(p.width_l) >= Number(p.height_l)) // alleen liggende foto's
  .map((p) => {
    const title = p.title.trim().replace(/\s*-\s*\d+$/, ''); // volgnummer eraf ("Nordkapp - 4")
    const m = title.match(/^(.*?)(?:,\s*| - )(.*)$/); // "Land, plek" of "Land - plek"
    return { id: p.id, title, land: (m ? m[1] : title).trim(), plek: (m ? m[2] : '').trim(), datum: (p.datetaken || '').slice(0, 10), url: p.url_h || p.url_l };
  })
  .sort((a, b) => a.datum.localeCompare(b.datum));

if (opnieuw) rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
for (const p of photos) {
  const file = join(DIR, `${p.id}.jpg`);
  if (existsSync(file)) continue;
  const buf = await get(p.url, 'buffer');
  await sharp(buf).rotate().resize({ width: MAX_PX, height: MAX_PX, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 76, mozjpeg: true }).toFile(file);
  console.log(`${p.id}  ${p.title}`);
}
// foto's die niet meer in het album staan opruimen
const ids = new Set(photos.map((p) => `${p.id}.jpg`));
for (const f of readdirSync(DIR)) if (!ids.has(f)) rmSync(join(DIR, f));

const rows = photos.map(({ url, ...p }) => ({ ...p, foto: `${p.id}.jpg` }));
writeFileSync(
  join(ROOT, 'welkom', 'album.js'),
  `// Foto's voor de welkomspagina, uit het Flickr-album "Rondjewereld" (${ALBUM}).\n// Gemaakt met npm run welkom:fotos; de bestanden staan in welkom/foto/.\nwindow.ALBUM = ${JSON.stringify(rows).replace(/\},\{/g, '},\n{')};\n`,
);
console.log(`${rows.length} foto's in welkom/album.js`);
