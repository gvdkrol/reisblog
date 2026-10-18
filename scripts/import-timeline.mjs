// Importeert een reis uit een Google Timeline-export (Timeline.json met
// semanticSegments) als nieuwe reis in content/trips/<slug>/ (als concept).
//
// - Overnachting: de plek waar we om 03:00 's nachts waren (een bezoek, of anders
//   een lange stilstand op één plek). Opeenvolgende nachten op (bijna) dezelfde plek
//   worden één stop: een camping, of een hotel als er in de reis gevlogen is
//   (overschrijven met --stay-type camping|hotel).
// - Vluchten: trajecten met een vlucht krijgen `flight: true` (✈️ op de site).
// - Fietstocht: aaneengesloten fietsritten op één dag (pauzes < 90 min) van samen
//   minstens --min-cycle km (standaard 10). Wordt een stop van het type
//   'fietstocht' op het verste punt, met het gefietste spoor.
// - Route: het GPS-spoor van de auto tussen de overnachtingen (fiets- en
//   wandelstukken eruit), met afstand en rijtijd uit de autoritten.
// - Thuis (vertrek en terugkomst) als via-punt.
// - Plaatsnamen via OpenStreetMap Nominatim (1 verzoek per seconde).
//
// Gebruik:
//   npm run import:timeline -- "<Timeline.json>" --start 2022-08-21 --end 2022-09-09 --title "Frankrijk 2022" [--stay-type hotel]

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify } from '../src/slugify.js';
import { encodePolyline } from '../src/polyline.js';
import { legKey } from './routing.mjs';

const TRIPS_DIR = fileURLToPath(new URL('../content/trips/', import.meta.url));
const HOUR = 3600000;

// ---------- Argumenten ----------
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const source = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const start = option('start');
const end = option('end');
const title = option('title');
const minCycle = Number(option('min-cycle', 10));
if (!source || !existsSync(source) || !/^\d{4}-\d{2}-\d{2}$/.test(start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(end || '') || !title) {
  console.error('Gebruik: import-timeline.mjs "<Timeline.json>" --start JJJJ-MM-DD --end JJJJ-MM-DD --title "Titel" [--slug x] [--min-cycle 10]');
  process.exit(1);
}
const slug = option('slug') || slugify(title);
const target = join(TRIPS_DIR, slug);
if (existsSync(target)) {
  console.error(`De reis "${slug}" bestaat al; kies een andere --slug.`);
  process.exit(1);
}

// ---------- Hulpfuncties ----------
const round = (n) => Math.round(n * 1e5) / 1e5;
const parsePoint = (s) => {
  const m = /(-?[\d.]+)°,\s*(-?[\d.]+)°/.exec(s || '');
  return m ? [Number(m[1]), Number(m[2])] : null;
};
const offsetOf = (iso) => /([+-]\d{2}:\d{2}|Z)$/.exec(iso)?.[1] || 'Z';
const localDate = (iso) => iso.slice(0, 10); // tijden in de export zijn al lokaal, met offset
function km([lat1, lng1], [lat2, lng2]) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}
const pathKm = (pts) => pts.slice(1).reduce((sum, p, i) => sum + km(pts[i], p), 0);
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 24 * HOUR).toISOString().slice(0, 10);

let lastGeocode = 0;
async function placeName([lat, lng]) {
  const wait = lastGeocode + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastGeocode = Date.now();
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=nl,en&lat=${lat}&lon=${lng}`, {
      headers: { 'User-Agent': 'reisblog-import/1.0 (lokaal script)' },
    });
    const j = await res.json();
    const a = j.address || {};
    return a.village || a.town || a.city || a.municipality || a.hamlet || j.name || null;
  } catch {
    return null;
  }
}

// ---------- Export inlezen (alleen de reisperiode, met een dag marge) ----------
console.log('Timeline inlezen…');
const data = JSON.parse(readFileSync(source, 'utf8'));
const from = addDays(start, -1);
const until = addDays(end, 1);
const segments = data.semanticSegments.filter((s) => s.startTime && localDate(s.startTime) >= from && localDate(s.startTime) <= until);

const visits = [];
const acts = [];
const track = [];
for (const s of segments) {
  const t0 = Date.parse(s.startTime);
  const t1 = Date.parse(s.endTime);
  if (s.visit) {
    const ll = parsePoint(s.visit.topCandidate?.placeLocation?.latLng);
    if (ll) visits.push({ t0, t1, ll, offset: offsetOf(s.startTime), type: s.visit.topCandidate?.semanticType });
  } else if (s.activity) {
    const a = s.activity;
    acts.push({
      t0,
      t1,
      date: localDate(s.startTime),
      type: a.topCandidate?.type || 'UNKNOWN',
      km: (a.distanceMeters || 0) / 1000,
      from: parsePoint(a.start?.latLng),
      offset: offsetOf(s.startTime),
    });
  } else if (s.timelinePath) {
    for (const p of s.timelinePath) {
      const ll = parsePoint(p.point);
      if (ll) track.push({ t: Date.parse(p.time), ll });
    }
  }
}
visits.sort((a, b) => a.t0 - b.t0);
acts.sort((a, b) => a.t0 - b.t0);
track.sort((a, b) => a.t - b.t);
const inTrip = (date) => date >= start && date <= end;

// ---------- Overnachtingen ----------
// Lange stilstand (activiteit van > 4 uur zonder afstand) telt als verblijf: in oudere
// exports staan sommige nachten niet als bezoek maar zo vastgelegd.
const stationary = acts
  .filter((a) => a.from && a.km < 1 && a.t1 - a.t0 > 4 * HOUR && !/FLYING|VEHICLE/.test(a.type))
  .map((a) => ({ t0: a.t0, t1: a.t1, ll: a.from, offset: a.offset }));
const places = [...visits, ...stationary].sort((a, b) => a.t0 - b.t0);

function visitAt(night) {
  let best = null;
  for (const v of places) {
    const t3 = Date.parse(`${addDays(night, 1)}T03:00:00${v.offset}`);
    if (v.t0 <= t3 && t3 <= v.t1) return v;
    const gap = Math.min(Math.abs(v.t0 - t3), Math.abs(v.t1 - t3));
    if (gap < 6 * HOUR && (!best || gap < best.gap)) best = { v, gap };
  }
  return best?.v || null;
}
const stays = [];
for (let night = start; night < end; night = addDays(night, 1)) {
  const v = visitAt(night);
  if (!v) continue;
  const last = stays.at(-1);
  if (last && km(last.ll, v.ll) < 1 && addDays(last.nights.at(-1), 1) === night) {
    last.nights.push(night);
    last.leave = Math.max(last.leave, v.t1);
  } else {
    stays.push({ ll: v.ll, nights: [night], arrive: v.t0, leave: v.t1 });
  }
}

// ---------- Fietstochten ----------
const tours = [];
for (const a of acts.filter((x) => x.type === 'CYCLING' && inTrip(x.date))) {
  const last = tours.at(-1);
  if (last && last.date === a.date && a.t0 - last.t1 < 90 * 60000) {
    last.t1 = a.t1;
    last.km += a.km;
  } else tours.push({ date: a.date, t0: a.t0, t1: a.t1, km: a.km });
}
const rides = tours.filter((t) => t.km >= minCycle);
for (const t of rides) {
  t.points = track.filter((p) => p.t >= t.t0 && p.t <= t.t1).map((p) => p.ll);
  const origin = t.points[0];
  t.far = origin ? t.points.reduce((f, p) => (km(origin, p) > km(origin, f) ? p : f), origin) : null;
}

// ---------- Thuis ----------
const homeVisit =
  visits.find((v) => /HOME/.test(v.type || '') && localDate(new Date(v.t1 + 2 * HOUR).toISOString()) >= addDays(start, -1)) ||
  visits.find((v) => v.t1 <= stays[0]?.arrive);

// ---------- Stops opbouwen ----------
const usedIds = new Set();
const makeId = (name) => {
  const base = slugify(name) || 'stop';
  let id = base;
  for (let n = 2; usedIds.has(id); n++) id = `${base}-${n}`;
  usedIds.add(id);
  return id;
};
const fmtTime = (t, offset) => new Date(t + (offset === 'Z' ? 0 : (offset[0] === '-' ? -1 : 1) * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4))) * 60000)).toISOString().slice(11, 16);
const plural = (n, one, more) => `${n} ${n === 1 ? one : more}`;
// "21–22 augustus" of "31 augustus – 2 september"
function dayRange(a, b) {
  const month = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('nl-NL', { month: 'long', timeZone: 'UTC' });
  const day = (d) => Number(d.slice(8));
  return month(a) === month(b) ? `${day(a)}–${day(b)} ${month(b)}` : `${day(a)} ${month(a)} – ${day(b)} ${month(b)}`;
}

const flights = acts.filter((a) => a.type === 'FLYING');
const stayType = option('stay-type') || (flights.some((f) => inTrip(f.date) || inTrip(localDate(new Date(f.t1).toISOString()))) ? 'hotel' : 'camping');
console.log(`${stays.length} overnachtingsplekken (${stayType}), ${rides.length} fietstochten; plaatsnamen opzoeken…`);
const events = [];
for (const s of stays) {
  const name = (await placeName(s.ll)) || (stayType === 'hotel' ? 'Hotel' : 'Camping');
  const last = s.nights.at(-1);
  events.push({
    t: s.arrive,
    stay: s,
    stop: {
      name,
      lat: round(s.ll[0]),
      lng: round(s.ll[1]),
      date: s.nights[0],
      type: stayType,
      text: `${plural(s.nights.length, 'nacht', 'nachten')}, ${dayRange(s.nights[0], addDays(last, 1))}.`,
      photos: [],
      articles: [],
    },
  });
}
const offset = visits[0]?.offset || 'Z';
for (const t of rides) {
  if (!t.far) continue;
  const origin = t.points[0];
  const farName = await placeName(t.far);
  const startName = await placeName(origin);
  const name = farName && farName !== startName ? `Fietstocht naar ${farName}` : `Fietstocht rond ${startName || farName || 'de camping'}`;
  events.push({
    t: t.t0,
    stop: {
      name,
      lat: round(t.far[0]),
      lng: round(t.far[1]),
      date: t.date,
      type: 'fietstocht',
      km: Math.round(t.km * 10) / 10,
      track: encodePolyline(t.points),
      text: `Fietstocht van ${String(Math.round(t.km * 10) / 10).replace('.', ',')} km, van ${fmtTime(t.t0, offset)} tot ${fmtTime(t.t1, offset)}${startName ? `, vanaf ${startName}` : ''}.`,
      photos: [],
      articles: [],
    },
  });
}
events.sort((a, b) => a.t - b.t);

if (homeVisit) {
  const homeName = (await placeName(homeVisit.ll)) || 'Thuis';
  const home = (date) => ({ name: homeName, lat: round(homeVisit.ll[0]), lng: round(homeVisit.ll[1]), date, type: 'via', text: '', photos: [], articles: [] });
  events.unshift({ t: -Infinity, stop: home(start), home: 'out' });
  events.push({ t: Infinity, stop: home(end), home: 'in' });
}
const stops = events.map((e) => {
  e.stop.id = makeId(e.stop.name);
  return e.stop;
});

// ---------- Trajecten (auto) tussen de stops op de route ----------
const notDriving = acts.filter((a) => ['CYCLING', 'WALKING', 'RUNNING', 'HIKING'].includes(a.type));
const isDrivingPoint = (p) => !notDriving.some((a) => p.t >= a.t0 - 60000 && p.t <= a.t1 + 60000);
const driveActs = acts.filter((a) => /VEHICLE|BUS|TRAIN|TRAM|SUBWAY|MOTORCYCLING|FERRY/.test(a.type));

const routeEvents = events.filter((e) => e.stop.type !== 'fietstocht');
const legs = [];
for (let i = 0; i < routeEvents.length - 1; i++) {
  const a = routeEvents[i];
  const b = routeEvents[i + 1];
  const t0 = a.home === 'out' ? Date.parse(`${start}T00:00:00${offset}`) : a.stay.leave - 2 * HOUR;
  const t1 = b.home === 'in' ? Date.parse(`${addDays(end, 1)}T00:00:00${offset}`) : b.stay.arrive + HOUR;
  const between = track.filter((p) => p.t > t0 && p.t < t1 && isDrivingPoint(p)).map((p) => p.ll);
  const path = [[a.stop.lat, a.stop.lng], ...between, [b.stop.lat, b.stop.lng]];
  const drives = driveActs.filter((d) => d.t0 >= t0 && d.t1 <= t1);
  const flown = flights.filter((f) => f.t0 >= t0 && f.t1 <= t1);
  const driveKm = drives.reduce((s, d) => s + d.km, 0);
  const minutes = Math.round(drives.reduce((s, d) => s + (d.t1 - d.t0), 0) / 60000);
  // Met een vlucht: afstand langs het spoor (de vlucht is een rechte lijn), geen rijtijd.
  const legKm = flown.length ? Math.max(pathKm(path), driveKm + flown.reduce((s, f) => s + f.km, 0)) : driveKm || pathKm(path);
  legs.push({
    from: a.stop.id,
    to: b.stop.id,
    key: legKey(a.stop, b.stop),
    km: Math.round(legKm * 10) / 10,
    ...(flown.length ? { flight: true } : minutes ? { minutes } : {}),
    polyline: encodePolyline(path),
    source: 'google-timeline',
  });
}

// ---------- Opslaan ----------
const fmt = (d) => new Date(d).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long' });
const trip = {
  title,
  slug,
  summary: `Van ${fmt(start)} tot ${fmt(end)} ${end.slice(0, 4)}.`,
  cover: '',
  draft: true,
  profile: 'driving',
  stops,
  legs,
};
mkdirSync(join(target, 'photos'), { recursive: true });
writeFileSync(join(target, 'trip.json'), JSON.stringify(trip, null, 2) + '\n');

const totalKm = legs.reduce((s, l) => s + l.km, 0);
const bikeKm = rides.reduce((s, t) => s + t.km, 0);
console.log(`Reis "${title}" aangemaakt in content/trips/${slug}/ (concept)`);
console.log(`  ${stays.length} ${stayType === 'hotel' ? 'hotels' : 'campings'}, ${rides.length} fietstochten (${Math.round(bikeKm)} km), ${legs.length} trajecten, ${Math.round(totalKm)} km rijden`);
for (const s of stops) console.log(`  ${s.date}  ${s.type.padEnd(10)} ${s.name}${s.km ? ` (${s.km} km)` : ''}`);
