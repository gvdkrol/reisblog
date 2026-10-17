import './style.css';
import { getTrip, asset } from './data.js';
import { createMap, legLatLngs, stopType, isVia, L } from './map.js';
import { formatRange, formatKm, formatDuration, formatLeg, escapeHtml } from './format.js';
import { stopPanelHtml, bindPanelPhotos } from './panel.js';

const params = new URLSearchParams(location.search);
const embed = params.has('embed');
const trip = getTrip(params.get('reis'));
if (embed) document.body.classList.add('embed');

const $ = (id) => document.getElementById(id);
const panel = $('panel');
const isMobile = () => matchMedia('(max-width: 767px)').matches;

if (!trip) {
  document.body.classList.remove('trip-page');
  document.body.innerHTML = `<div class="not-found"><h1>Reis niet gevonden</h1><p><a href="./">Terug naar het overzicht</a></p></div>`;
  throw new Error('Reis niet gevonden');
}

document.title = `${trip.title} · Reisblog`;

// ---------- Infokaart linksboven ----------
$('trip-info').innerHTML = `
  <a class="back" href="./${embed ? '?embed=1' : ''}">← Alle reizen</a>
  <h1>${escapeHtml(trip.title)}</h1>
  <div class="dates">${formatRange(trip.startDate, trip.endDate)}</div>
  <div class="stats">
    <span class="stat">${trip.stopCount} stops</span>
    ${trip.totalKm ? `<span class="stat">${formatKm(trip.totalKm)}</span>` : ''}
    ${trip.totalMinutes ? `<span class="stat">${formatDuration(trip.totalMinutes)} rijden</span>` : ''}
  </div>
  ${trip.visibleStops.length ? `<button class="start" id="start">Start bij ${escapeHtml(trip.visibleStops[0].name)} →</button>` : ''}
`;
$('start')?.addEventListener('click', () => openStop(0));

// ---------- Kaart ----------
const map = createMap('map');
const legLayers = legLatLngs(trip).map(({ leg, to, latlngs, routed }) => {
  const line = L.polyline(latlngs, {
    color: '#c2410c',
    weight: 5,
    opacity: 0.85,
    dashArray: routed ? null : '6 8',
  }).addTo(map);
  if (leg?.polyline) line.bindTooltip(formatLeg(leg), { sticky: true, className: 'leg-tip' });
  return { line, to };
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
const fitAll = () => map.fitBounds(allBounds, { padding: [60, 60] });
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
  // Trajecten vanaf de vorige stop (eventueel via via-punten) uitlichten.
  const from = stop.prevStop ? stop.prevStop.index : stop.index;
  legLayers.forEach(({ line, to }) => {
    const active = to.index > from && to.index <= stop.index;
    line.setStyle({ weight: active ? 8 : 5, opacity: active ? 1 : 0.7 });
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
  legLayers.forEach(({ line }) => line.setStyle({ weight: 5, opacity: 0.85 }));
}

// Stop centreren in het zichtbare deel van de kaart (naast of boven het paneel).
function focusOn(stop, animate = true) {
  const zoom = Math.max(map.getZoom(), 9);
  const point = map.project([stop.lat, stop.lng], zoom);
  const size = map.getSize();
  const offset = isMobile() ? L.point(0, (size.y * 0.72) / 2) : L.point(Math.min(panel.offsetWidth, size.x) / 2, 0);
  const center = map.unproject(point.add(offset), zoom);
  if (animate) map.flyTo(center, zoom, { duration: 0.8 });
  else map.setView(center, zoom, { animate: false });
}

function renderPanel(stop) {
  const photos = stop.photos || [];
  const { prevStop, nextStop: next } = stop;
  const content = $('panel-content');

  content.innerHTML = stopPanelHtml(stop, {
    photoUrl: (src) => asset(trip, src),
    day: stop.day,
    leg: stop.legIn,
    prevStop,
  });
  content.scrollTop = 0;
  bindPanelPhotos(content, photos, { onOpen: (index) => openLightbox(photos, index) });

  $('prev').disabled = !prevStop;
  $('next').disabled = !next;
  $('prev').innerHTML = `<small>← Vorige stop</small><b>${prevStop ? escapeHtml(prevStop.name) : '–'}</b>`;
  $('next').innerHTML = `<small>Volgende stop →</small><b>${next ? escapeHtml(next.name) : 'Einde van de reis'}</b>`;
}

$('prev').addEventListener('click', () => openStop(current - 1));
$('next').addEventListener('click', () => openStop(current + 1));
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
  lb.querySelector('img').src = asset(trip, p.src);
  lb.querySelector('.lb-caption').textContent = p.caption || '';
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
  if (current < 0) return;
  if (e.key === 'Escape') { closePanel(); fitAll(); }
  if (e.key === 'ArrowLeft') openStop(current - 1);
  if (e.key === 'ArrowRight') openStop(current + 1);
});

// ---------- Deeplink #stop-<id> ----------
const fromHash = stops.findIndex((s) => `#stop-${s.id}` === location.hash);
if (fromHash >= 0) openStop(fromHash, { animate: false });
