// Importeert een reis uit een Polarsteps-export (map met trip.json, locations.json
// en per stap een map met foto's) als nieuwe reis in content/trips/<slug>/.
//
// - Stappen met dezelfde plaats op dezelfde dag worden samengevoegd tot één stop.
// - De route per traject komt uit het GPS-spoor (locations.json); daarvan is wel de
//   afstand bekend, maar geen rijtijd.
// - De laatste stop van elke dag wordt een camping.
// - De reis wordt als concept aangemaakt. De exportmap zelf wordt alleen gelezen.
//
// Gebruik: npm run import:polarsteps -- "<exportmap>" --title "Duitsland 2026" [--slug duitsland-2026]

import { readFileSync, readdirSync, existsSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify } from '../src/slugify.js';
import { legKey } from './routing.mjs';
import { encodePolyline } from '../src/polyline.js';

const TRIPS_DIR = fileURLToPath(new URL('../content/trips/', import.meta.url));
const TIMEZONE = 'Europe/Amsterdam';

// ---------- Argumenten ----------
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const source = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!source || !existsSync(join(source, 'trip.json'))) {
  console.error('Geef de Polarsteps-reismap op (met trip.json erin).');
  process.exit(1);
}

const ps = JSON.parse(readFileSync(join(source, 'trip.json'), 'utf8'));
const track = existsSync(join(source, 'locations.json'))
  ? JSON.parse(readFileSync(join(source, 'locations.json'), 'utf8')).locations.sort((a, b) => a.time - b.time)
  : [];
const title = option('title') || ps.name;
const slug = option('slug') || slugify(title);
const target = join(TRIPS_DIR, slug);
if (existsSync(target)) {
  console.error(`De reis "${slug}" bestaat al; kies een andere --slug.`);
  process.exit(1);
}

// ---------- Hulpfuncties ----------
const round = (n) => Math.round(n * 1e5) / 1e5;
const localDate = (seconds) => new Date(seconds * 1000).toLocaleDateString('sv-SE', { timeZone: TIMEZONE });

function haversineKm([lat1, lng1], [lat2, lng2]) {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

function photoFiles(step) {
  const dir = readdirSync(source).find((f) => f.endsWith(`_${step.id}`));
  const photos = dir && join(source, dir, 'photos');
  return photos && existsSync(photos) ? readdirSync(photos).sort().map((f) => join(photos, f)) : [];
}

// ---------- Stappen groeperen ----------
const steps = ps.all_steps.filter((s) => !s.is_deleted).sort((a, b) => a.start_time - b.start_time);
const groups = [];
for (const step of steps) {
  const key = `${step.location?.name || step.display_name}|${localDate(step.start_time)}`;
  const last = groups.at(-1);
  if (last?.key === key) last.steps.push(step);
  else groups.push({ key, steps: [step] });
}

// ---------- Stops ----------
mkdirSync(join(target, 'photos'), { recursive: true });
const usedIds = new Set();
let photoCount = 0;

const stops = groups.map((group, i) => {
  const first = group.steps[0];
  const names = [...new Set(group.steps.map((s) => s.display_name))];
  const name = names.length > 1 ? first.location.name : names[0];
  const date = localDate(first.start_time);
  const nextDate = groups[i + 1] && localDate(groups[i + 1].steps[0].start_time);

  let id = slugify(name) || 'stop';
  for (let n = 2; usedIds.has(id); n++) id = `${slugify(name) || 'stop'}-${n}`;
  usedIds.add(id);

  const text = group.steps
    .filter((s) => s.description?.trim())
    .map((s) => (names.length > 1 ? `**${s.display_name}**: ${s.description.trim()}` : s.description.trim()))
    .join('\n\n');

  const photos = group.steps.flatMap(photoFiles).map((file, n) => {
    const name = `${id}-${n + 1}.jpg`;
    copyFileSync(file, join(target, 'photos', name));
    photoCount++;
    return { src: `photos/${name}`, caption: '' };
  });

  return {
    id,
    name,
    lat: round(first.location.lat),
    lng: round(first.location.lon),
    date,
    type: date !== nextDate ? 'camping' : 'bezienswaardigheid',
    text,
    photos,
    articles: [],
    // alleen nodig om het GPS-spoor te knippen
    _from: first.start_time,
    _to: group.steps.at(-1).start_time,
  };
});

// ---------- Trajecten uit het GPS-spoor ----------
const legs = [];
for (let i = 0; i < stops.length - 1; i++) {
  const a = stops[i];
  const b = stops[i + 1];
  const between = track.filter((p) => p.time > a._to && p.time < b._from).map((p) => [p.lat, p.lon]);
  const path = [[a.lat, a.lng], ...between, [b.lat, b.lng]];
  const km = path.slice(1).reduce((sum, p, j) => sum + haversineKm(path[j], p), 0);
  legs.push({ from: a.id, to: b.id, key: legKey(a, b), km: Math.round(km * 10) / 10, polyline: encodePolyline(path), source: 'polarsteps' });
}
for (const s of stops) {
  delete s._from;
  delete s._to;
}

// ---------- Opslaan ----------
const start = stops[0]?.date;
const end = stops.at(-1)?.date;
const fmt = (d) => new Date(d).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long' });
const trip = {
  title,
  slug,
  summary: ps.summary || (start ? `Van ${fmt(start)} tot ${fmt(end)} ${end.slice(0, 4)}.` : ''),
  cover: stops.find((s) => s.photos.length)?.photos[0].src || '',
  draft: true,
  profile: 'driving',
  stops,
  legs,
};
writeFileSync(join(target, 'trip.json'), JSON.stringify(trip, null, 2) + '\n');

const totalKm = legs.reduce((sum, l) => sum + l.km, 0);
console.log(`Reis "${title}" aangemaakt in content/trips/${slug}/ (concept)`);
console.log(`  ${steps.length} stappen → ${stops.length} stops, ${photoCount} foto's, ${legs.length} trajecten, ${Math.round(totalKm)} km volgens het GPS-spoor`);
