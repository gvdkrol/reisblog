import './style.css';
import { marked } from 'marked';
import { getTrip, asset } from './data.js';
import { createMap, legLatLngs, stopType, L } from './map.js';
import { formatDate, formatRange, formatKm, formatDuration, escapeHtml } from './format.js';

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
    <span class="stat">${trip.stops.length} stops</span>
    ${trip.totalKm ? `<span class="stat">${formatKm(trip.totalKm)}</span>` : ''}
    ${trip.totalMinutes ? `<span class="stat">${formatDuration(trip.totalMinutes)} rijden</span>` : ''}
  </div>
  ${trip.stops.length ? `<button class="start" id="start">Start bij ${escapeHtml(trip.stops[0].name)} →</button>` : ''}
`;
$('start')?.addEventListener('click', () => openStop(0));

// ---------- Kaart ----------
const map = createMap('map');
const legLayers = legLatLngs(trip).map(({ leg, to, latlngs, routed }) => {
  const line = L.polyline(latlngs, {
    color: '#c2553a',
    weight: 5,
    opacity: 0.85,
    dashArray: routed ? null : '6 8',
  }).addTo(map);
  if (leg) line.bindTooltip(`${formatKm(leg.km)} · ${formatDuration(leg.minutes)}`, { sticky: true, className: 'leg-tip' });
  return { line, to };
});

const markers = trip.stops.map((stop, i) => {
  const t = stopType(stop.type);
  const icon = L.divIcon({
    className: 'stop-marker',
    html: `<div class="stop-pin" style="--c:${t.color}">${t.icon}<span class="num">${i + 1}</span></div>`,
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

// ---------- Paneel ----------
let current = -1;

function openStop(i, { animate = true } = {}) {
  const stop = trip.stops[i];
  if (!stop) return;
  current = i;
  renderPanel(stop);

  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  document.body.classList.add('panel-open');
  history.replaceState(null, '', `#stop-${stop.id}`);

  markers.forEach((m, j) => m.getElement()?.classList.toggle('active', j === i));
  legLayers.forEach(({ line, to }) => line.setStyle({ weight: to.id === stop.id ? 8 : 5, opacity: to.id === stop.id ? 1 : 0.7 }));

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
  const t = stopType(stop.type);
  const photos = stop.photos || [];
  const prevStop = trip.stops[stop.index - 1];
  const leg = stop.legIn;

  $('panel-content').innerHTML = `
    ${photos.length ? `<img class="panel-hero" id="hero" src="${asset(trip, photos[0].src)}" alt="${escapeHtml(photos[0].caption)}" />` : ''}
    ${photos.length > 1 ? `<div class="panel-thumbs">${photos.map((p, j) => `<img data-i="${j}" class="${j === 0 ? 'current' : ''}" src="${asset(trip, p.src)}" alt="${escapeHtml(p.caption)}" loading="lazy" />`).join('')}</div>` : ''}
    ${photos[0]?.caption ? `<div class="caption" id="hero-caption">${escapeHtml(photos[0].caption)}</div>` : ''}
    <div class="panel-body">
      <div class="meta">
        ${stop.day ? `<span>Dag ${stop.day}</span><span>·</span>` : ''}
        ${stop.date ? `<span>${formatDate(stop.date)}</span>` : ''}
        <span class="type-chip" style="--c:${t.color}">${t.icon} ${t.label}</span>
      </div>
      <h2>${escapeHtml(stop.name)}</h2>
      ${leg && prevStop ? `<div class="leg-info">🚐 ${formatKm(leg.km)} · ${formatDuration(leg.minutes)} vanaf ${escapeHtml(prevStop.name)}</div>` : ''}
      <div class="story">${marked.parse(stop.text || '')}</div>
    </div>
  `;
  $('panel-content').scrollTop = 0;

  let photoIndex = 0;
  $('hero')?.addEventListener('click', () => openLightbox(photos, photoIndex));
  $('panel-content').querySelectorAll('.panel-thumbs img').forEach((img) =>
    img.addEventListener('click', () => {
      photoIndex = Number(img.dataset.i);
      $('hero').src = img.src;
      $('hero-caption').textContent = photos[photoIndex].caption || '';
      $('panel-content').querySelectorAll('.panel-thumbs img').forEach((x) => x.classList.toggle('current', x === img));
    })
  );

  const next = trip.stops[stop.index + 1];
  $('prev').disabled = !prevStop;
  $('next').disabled = !next;
  $('prev').textContent = prevStop ? `← ${prevStop.name}` : '←';
  $('next').textContent = next ? `${next.name} →` : '→';
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
const fromHash = trip.stops.findIndex((s) => `#stop-${s.id}` === location.hash);
if (fromHash >= 0) openStop(fromHash, { animate: false });
