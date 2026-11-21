// Openbare welkomspagina (welkom/index.html) naast de reisblog, die bij build in
// dist/reizen/ komt en daar achter Cloudflare Access staat. Alles wat de welkomspagina
// gebruikt moet dus buiten /reizen/ staan:
//   dist/index.html   de welkomspagina, met {{…}} ingevuld
//   dist/welkom/      album.js + foto/ (de foto's van de pagina, zie scripts/welkom-fotos.mjs),
//                     verkleinde kopieën van andere gebruikte afbeeldingen en het favicon
//   dist/trip.html    doorverwijzing van oude links (trip.html?reis=…) naar reizen/trip.html
// Tijdens dev serveert Vite welkom/index.html zelf op /welkom/; deze plugin vult dan
// alleen de {{…}} in.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import sharp from 'sharp';
import { continentDays } from '../src/continents.js';

const MAX_PX = 1600;

export function welkom({ root }) {
  const template = join(root, 'welkom', 'index.html');
  const tripsDir = join(root, 'content', 'trips');
  let isBuild = false;
  let outDir = '';

  return {
    name: 'reisblog-welkom',
    configResolved(config) {
      isBuild = config.command === 'build';
      outDir = dirname(resolve(config.root, config.build.outDir)); // dist/reizen → dist
    },
    // Oude bestanden in dist/ (van vóór de verhuizing naar dist/reizen/) opruimen.
    buildStart() {
      if (isBuild && basename(outDir) === 'dist') rmSync(outDir, { recursive: true, force: true });
    },
    transformIndexHtml(html, ctx) {
      if (!ctx.filename.replaceAll('\\', '/').includes('/welkom/')) return html; // ook de ontwerpen
      // Lokaal staat de reisblog op / en niet op /reizen/.
      return fill(html, stats()).replaceAll('href="./reizen/"', 'href="/"');
    },
    async closeBundle() {
      if (!isBuild) return;
      const assets = join(outDir, 'welkom');
      mkdirSync(assets, { recursive: true });
      let html = fill(readFileSync(template, 'utf8'), stats()).replace(/<!--[\s\S]*?-->\s*/g, '');

      // Foto's uit ../content/… en het favicon uit ../src/… kopiëren naar dist/welkom/.
      const refs = [...new Set(html.match(/\.\.\/(?:content|src)\/[^'")\s]+/g) || [])];
      for (const ref of refs) {
        const src = resolve(root, 'welkom', ref);
        if (!existsSync(src)) throw new Error(`welkom/index.html: ${ref} bestaat niet`);
        const name = basename(src);
        const out = join(assets, name);
        if (/\.(jpe?g|webp)$/i.test(name)) {
          const jpg = out.replace(/\.\w+$/, '.jpg');
          await sharp(src).rotate().resize({ width: MAX_PX, height: MAX_PX, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toFile(jpg);
          html = html.replaceAll(ref, `./welkom/${basename(jpg)}`);
        } else {
          writeFileSync(out, readFileSync(src));
          html = html.replaceAll(ref, `./welkom/${name}`);
        }
      }
      // Foto's van de welkomspagina (npm run welkom:fotos) en hun lijst: zo meekopiëren.
      // De pagina staat straks in dist/ i.p.v. in welkom/, dus de paden krijgen welkom/ ervoor.
      cpSync(join(root, 'welkom', 'foto'), join(assets, 'foto'), { recursive: true });
      cpSync(join(root, 'welkom', 'album.js'), join(assets, 'album.js'));
      html = html.replaceAll('"./album.js"', '"./welkom/album.js"').replaceAll("'./foto/'", "'./welkom/foto/'");

      writeFileSync(join(outDir, 'index.html'), html);
      writeFileSync(join(outDir, 'trip.html'), REDIRECT);
    },
  };

  // Kerncijfers van de gepubliceerde reizen (zonder concepten).
  function stats() {
    const trips = readdirSync(tripsDir)
      .map((slug) => join(tripsDir, slug, 'trip.json'))
      .filter(existsSync)
      .map((file) => JSON.parse(readFileSync(file, 'utf8')))
      .filter((trip) => !trip.draft);
    const years = trips.flatMap((t) => (t.stops || []).map((s) => Number((s.date || '').slice(0, 4))).filter(Boolean));
    const continents = new Set(trips.flatMap((t) => Object.keys(continentDays((t.stops || []).filter((s) => !s.draft)))));
    const eersteJaar = Math.min(...years);
    const laatsteJaar = Math.max(...years);
    const kilometers = Math.round(trips.reduce((sum, t) => sum + (t.legs || []).reduce((s, l) => s + (l.km || 0), 0), 0));
    return { reizen: trips.length, continenten: continents.size, eersteJaar, laatsteJaar, jaren: laatsteJaar - eersteJaar, kilometers };
  }
}

function fill(html, values) {
  return html.replace(/\{\{(\w+)\}\}/g, (all, key) => (key in values ? String(values[key]) : all));
}

const REDIRECT = `<!doctype html>
<html lang="nl">
  <head>
    <meta charset="UTF-8" />
    <title>rondjewereld.nl</title>
    <script>location.replace('reizen/trip.html' + location.search + location.hash);</script>
    <meta http-equiv="refresh" content="0; url=reizen/trip.html" />
  </head>
  <body><p><a href="reizen/trip.html">Naar de reis</a></p></body>
</html>
`;
