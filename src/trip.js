import './style.css';
import './vertrek.css';
import { loadTrip, loadFlickr, asset } from './data.js';
import { createMap, legLatLngs, legStyle, stopType, isVia, decodePolyline, L } from './map.js';
import { formatRange, formatKm, formatLeg, escapeHtml } from './format.js';
import { stopPanelHtml, bindPanelPhotos, captionHtml } from './panel.js';
import { queryTerms, highlightIn, postHeadings } from './search.js';
import { createFlickrGallery, toFlickrData, flickrThumbHtml, lockBrokenThumbs } from './flickr-gallery.js';

const params = new URLSearchParams(location.search);
const embed = params.has('embed');
const trip = await loadTrip(params.get('reis'));
if (embed) document.body.classList.add('embed');

const $ = (id) => document.getElementById(id);
const panel = $('panel');
const isMobile = () => matchMedia('(max-width: 767px)').matches;

if (!trip) {
  document.body.classList.remove('trip-page');
  document.body.innerHTML = `<div class="not-found"><h1>Reis niet gevonden</h1><p><a href="./">Terug naar het overzicht</a></p></div>`;
  throw new Error('Reis niet gevonden');
}

document.title = `${trip.title} · rondjewereld.nl`;

// ---------- Linksboven: dezelfde reiskaart als op de homepage, met de knoppen eronder ----------
const side = $('trip-info');
side.innerHTML = `
  <div class="trip-card">
    <a class="back" href="./${embed ? '?embed=1' : ''}">← Alle reizen</a>
    ${trip.coverSrc ? `<img src="${asset(trip, trip.coverSrc)}" alt="" />` : '<div class="no-cover">🗺️</div>'}
    <div class="body">
      <h1>${escapeHtml(trip.title)}${trip.draft ? ' <span class="draft">concept</span>' : ''}</h1>
      <div class="dates">${formatRange(trip.startDate, trip.endDate)}</div>
      ${trip.summary ? `<p class="summary">${escapeHtml(trip.summary)}</p>` : ''}
      <div class="stats">
        <span class="stat">${trip.stopCount} stops</span>
        ${trip.totalKm ? `<span class="stat">${formatKm(trip.totalKm)}</span>` : ''}
      </div>
    </div>
  </div>
  <div class="side-actions">
    ${trip.visibleStops.length ? `<button class="start" id="start">Start bij ${escapeHtml(trip.visibleStops[0].name)} →</button>` : ''}
    <button class="flickr-btn" id="flickr-btn">Foto's van de reis</button>
  </div>
  <nav class="panel-nav side-nav">
    <button class="prev" id="side-prev"></button>
    <button class="next" id="side-next"></button>
  </nav>
`;
$('start')?.addEventListener('click', () => openStop(0));
// Flickr-lijst van de reis: één keer laden, gedeeld door het raster en het stoppaneel.
let flickrData;
const flickr = () => (flickrData ||= loadFlickr(trip.slug).then(toFlickrData));
const flickrGallery = createFlickrGallery({
  title: trip.title,
  load: flickr,
  open: (photos, index) => openLightbox(photos, index),
});
$('flickr-btn').addEventListener('click', () => flickrGallery.open());

// ---------- Kaart ----------
const map = createMap('map');
const legLayers = legLatLngs(trip).map(({ leg, to, latlngs, routed }) => {
  const style = legStyle(leg, routed);
  const line = L.polyline(latlngs, { color: '#a95558', opacity: 0.85, lineCap: 'round', ...style }).addTo(map);
  if (leg?.polyline) line.bindTooltip(formatLeg(leg), { sticky: true, className: 'leg-tip' });
  return { line, to, base: style.weight };
});

// Fietstochten: eigen spoor als gestippelde lijn.
const tracks = new Map();
trip.stops
  .filter((s) => s.track)
  .forEach((stop) => {
    const color = stopType(stop.type).color;
    const line = L.polyline(decodePolyline(stop.track), { color, weight: 4, opacity: 0.85, dashArray: '2 8', lineCap: 'round' })
      .bindTooltip(`${escapeHtml(stop.name)}${Number.isFinite(stop.km) ? ` · ${formatKm(stop.km)}` : ''}`, { sticky: true, className: 'leg-tip' })
      .addTo(map);
    tracks.set(stop.id, line);
  });

// Via-punten: klein rood stipje op de route, alleen met de naam bij hover.
trip.stops.filter(isVia).forEach((stop) =>
  L.circleMarker([stop.lat, stop.lng], { radius: 4, color: '#fff', weight: 1.5, fillColor: '#dc2626', fillOpacity: 1 })
    .bindTooltip(escapeHtml(stop.name), { direction: 'top', className: 'leg-tip' })
    .addTo(map)
);

const stops = trip.visibleStops;
const markers = stops.map((stop, i) => {
  const t = stopType(stop.type);
  const icon = L.divIcon({
    className: `stop-marker${stop.draft ? ' draft' : ''}`,
    html: `<div class="stop-pin" style="--c:${t.color}">${t.icon}<span class="num">${stop.number}</span></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
  return L.marker([stop.lat, stop.lng], { icon, title: stop.name, riseOnHover: true })
    .addTo(map)
    .on('click', () => openStop(i));
});

const allBounds = L.latLngBounds(trip.stops.map((s) => [s.lat, s.lng]));
legLayers.forEach(({ line }) => allBounds.extend(line.getBounds()));
tracks.forEach((line) => allBounds.extend(line.getBounds()));
// Op een breed scherm de reis naast de kaart linksboven passen, niet eronder.
const fitAll = () =>
  map.fitBounds(allBounds, { paddingTopLeft: [isMobile() ? 60 : side.offsetWidth + 48, 60], paddingBottomRight: [60, 60] });
if (allBounds.isValid()) fitAll();
else map.setView([50, 5], 5);

// ---------- Paneel ----------
let current = -1;

function openStop(i, { animate = true } = {}) {
  const stop = stops[i];
  if (!stop) return;
  current = i;
  renderPanel(stop);

  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  document.body.classList.add('panel-open');
  history.replaceState(null, '', `#stop-${stop.id}`);

  markers.forEach((m, j) => m.getElement()?.classList.toggle('active', j === i));
  // Trajecten vanaf de vorige stop op de route (eventueel via via-punten) uitlichten.
  const from = stop.prevRouteStop ? stop.prevRouteStop.index : stop.index;
  tracks.forEach((line, id) => line.setStyle({ weight: id === stop.id ? 7 : 4, opacity: id === stop.id ? 1 : 0.85 }));
  legLayers.forEach(({ line, to, base }) => {
    const active = to.index > from && to.index <= stop.index;
    line.setStyle({ weight: active ? base + 3 : base, opacity: active ? 1 : 0.7 });
  });

  focusOn(stop, animate);
}

function closePanel() {
  current = -1;
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('panel-open');
  history.replaceState(null, '', location.pathname + location.search);
  markers.forEach((m) => m.getElement()?.classList.remove('active'));
  legLayers.forEach(({ line, base }) => line.setStyle({ weight: base, opacity: 0.85 }));
  tracks.forEach((line) => line.setStyle({ weight: 4, opacity: 0.85 }));
}

// Stop centreren in het zichtbare deel van de kaart (boven het paneel, of tussen de
// kaart linksboven en het paneel rechts).
function focusOn(stop, animate = true) {
  const zoom = Math.max(map.getZoom(), 9);
  const point = map.project([stop.lat, stop.lng], zoom);
  const size = map.getSize();
  const offset = isMobile() ? L.point(0, (size.y * 0.72) / 2) : L.point(Math.max(panel.offsetWidth - side.offsetWidth, 0) / 2, 0);
  const center = map.unproject(point.add(offset), zoom);
  if (animate) map.flyTo(center, zoom, { duration: 0.8 });
  else map.setView(center, zoom, { animate: false });
}

function renderPanel(stop) {
  const photos = stop.photos || [];
  const { prevStop, nextStop: next, prevRouteStop } = stop;
  const content = $('panel-content');

  content.innerHTML = stopPanelHtml(stop, {
    photoUrl: (src) => asset(trip, src),
    day: stop.day,
    leg: stop.legIn,
    prevStop: prevRouteStop,
  });
  content.scrollTop = 0;
  bindPanelPhotos(content, photos, { onOpen: (index) => openLightbox(photos, index) });
  // Vanuit het zoeken: zoekwoorden uitlichten en (alleen bij de gevonden stop) naar het bericht scrollen.
  const hit = searchHit?.stop === stop ? hitTarget(content) : null;
  highlightIn(content.querySelector('.panel-body'), searchTerms);
  scrollToHit(content, hit);
  renderDayFlickr(stop, content)
    .catch(() => {}) // zonder Flickr-lijst gewoon geen raster
    .then(() => stops[current] === stop && scrollToHit(content, hit)); // het fotoraster schuift de tekst op

  // Dezelfde knoppen onder in het paneel en links onder de reiskaart.
  for (const id of ['prev', 'side-prev']) {
    $(id).disabled = !prevStop;
    $(id).innerHTML = `<small>← Vorige stop</small><b>${prevStop ? escapeHtml(prevStop.name) : '–'}</b>`;
  }
  for (const id of ['next', 'side-next']) {
    $(id).disabled = !next;
    $(id).innerHTML = `<small>Volgende stop →</small><b>${next ? escapeHtml(next.name) : 'Einde van de reis'}</b>`;
  }
}

// ---------- Zoekresultaat (trip.html?reis=…&zoek=<woorden>&item=<n>#stop-<id>) ----------
const searchTerms = queryTerms(params.get('zoek') || '');
let searchHit = null; // { stop, item }: de stop en het blogbericht waar het zoeken naartoe wees

// Kop van het gevonden bericht (item 0 = de notities boven het eerste bericht: geen kop).
function hitTarget(content) {
  const heading = postHeadings(content.querySelector('.story'))[searchHit.item - 1] || null;
  return { heading };
}
// Scrolt naar de eerste treffer in het gevonden bericht; zonder treffer naar de kop ervan.
function scrollToHit(content, hit) {
  if (!hit) return;
  const marks = [...content.querySelectorAll('.story mark.hit')];
  const { heading } = hit;
  const inPost = heading
    ? marks.find((m) => heading.contains(m) || heading.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING)
    : marks[0];
  const target = inPost || heading;
  if (!target) return; // alleen de naam van de stop gevonden: bovenaan blijven
  const top = target.getBoundingClientRect().top - content.getBoundingClientRect().top;
  content.scrollTop += top - content.clientHeight / 3;
}

// Flickr-foto's van de dag van de stop, als raster boven het verhaal. Foto's die al bij
// de stop staan (overgenomen van Flickr) worden overgeslagen. Niets gedownload: de
// thumbnails en de vergroting komen rechtstreeks van Flickr.
const DAY_SHOWN = 9;
async function renderDayFlickr(stop, content) {
  if (!stop.date) return;
  const { photos } = await flickr();
  if (stops[current] !== stop) return; // intussen een andere stop geopend
  const own = new Set((stop.photos || []).map((p) => /flickr\.com\/photos\/[^/]+\/(\d+)/.exec(p.link || '')?.[1]).filter(Boolean));
  const day = photos.filter((p) => p.taken.startsWith(stop.date) && !own.has(p.id));
  if (!day.length) return;
  const section = document.createElement('section');
  section.className = 'day-flickr';
  const render = (all) => {
    const shown = all ? day : day.slice(0, DAY_SHOWN);
    section.innerHTML = `
      <h4>Foto's van deze dag <small>${day.length}</small></h4>
      <div class="df-grid">${shown
        .map((p, i) => `<button class="df-item" data-i="${i}" title="${escapeHtml(p.title)}">${flickrThumbHtml(p, '(max-width: 767px) 33vw, 260px')}</button>`)
        .join('')}</div>
      ${shown.length < day.length ? `<button class="df-more">Toon alle ${day.length} foto's</button>` : ''}`;
    lockBrokenThumbs(section, '.df-item');
  };
  render(false);
  section.addEventListener('click', (e) => {
    if (e.target.closest('.df-more')) return render(true);
    const item = e.target.closest('.df-item');
    if (item && !item.classList.contains('locked')) openLightbox(day, Number(item.dataset.i));
  });
  content.querySelector('.day-flickr-slot')?.replaceWith(section);
}

for (const id of ['prev', 'side-prev']) $(id).addEventListener('click', () => openStop(current - 1));
for (const id of ['next', 'side-next']) $(id).addEventListener('click', () => openStop(current + 1));
$('panel-close').addEventListener('click', () => {
  closePanel();
  fitAll();
});

// ---------- Lightbox ----------
const lb = $('lightbox');
let lbPhotos = [];
let lbIndex = 0;

function openLightbox(photos, index) {
  lbPhotos = photos;
  showLightbox(index);
  lb.classList.add('open');
}
function showLightbox(index) {
  lbIndex = (index + lbPhotos.length) % lbPhotos.length;
  const p = lbPhotos[lbIndex];
  lb.querySelector('img').src = p.url || asset(trip, p.src); // url: foto rechtstreeks van Flickr
  lb.querySelector('.lb-caption').innerHTML = captionHtml(p);
  lb.querySelector('.lb-prev').hidden = lb.querySelector('.lb-next').hidden = lbPhotos.length < 2;
}
const closeLightbox = () => lb.classList.remove('open');
lb.querySelector('.lb-close').addEventListener('click', closeLightbox);
lb.querySelector('.lb-prev').addEventListener('click', () => showLightbox(lbIndex - 1));
lb.querySelector('.lb-next').addEventListener('click', () => showLightbox(lbIndex + 1));
lb.addEventListener('click', (e) => e.target === lb && closeLightbox());

// ---------- Toetsenbord ----------
document.addEventListener('keydown', (e) => {
  if (lb.classList.contains('open')) {
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') showLightbox(lbIndex - 1);
    if (e.key === 'ArrowRight') showLightbox(lbIndex + 1);
    return;
  }
  if (flickrGallery.isOpen()) {
    if (e.key === 'Escape') flickrGallery.close();
    return;
  }
  if (current < 0) return;
  if (e.key === 'Escape') { closePanel(); fitAll(); }
  if (e.key === 'ArrowLeft') openStop(current - 1);
  if (e.key === 'ArrowRight') openStop(current + 1);
});

// ---------- Deeplink #stop-<id> ----------
const fromHash = stops.findIndex((s) => `#stop-${s.id}` === location.hash);
if (fromHash >= 0) {
  if (searchTerms.length) searchHit = { stop: stops[fromHash], item: Number(params.get('item')) || 0 };
  openStop(fromHash, { animate: false });
}
