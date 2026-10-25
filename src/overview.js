import './style.css';
import { trips, asset, home, homeAsset, loadRoutes } from './data.js';
import { createMap, decodePolyline, L } from './map.js';
import { formatRange, formatKm, escapeHtml } from './format.js';
import { CONTINENTS, continentOf } from './continents.js';

const embed = new URLSearchParams(location.search).has('embed');
if (embed) document.body.classList.add('embed');
const tripUrl = (trip) => `trip.html?reis=${encodeURIComponent(trip.slug)}${embed ? '&embed=1' : ''}`;
const num = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 });

// ---------- Kop ----------
const years = [...new Set(trips.flatMap((t) => [t.startDate, t.endDate]).filter(Boolean).map((d) => d.slice(0, 4)))].sort();
const yearLabel = years.length > 1 ? `${years[0]}–${years.at(-1)}` : years[0] || '';

document.title = home.eyebrow || home.title;
document.getElementById('site-header').innerHTML = home.eyebrow || yearLabel
  ? `<div class="eyebrow">${escapeHtml([home.eyebrow, yearLabel].filter(Boolean).join(' · '))}</div>`
  : '';

// ---------- Kerncijfers ----------
const totalStops = trips.reduce((n, t) => n + t.stopCount, 0);
const totalKm = trips.reduce((n, t) => n + t.totalKm, 0);
const totalDays = trips.reduce((n, t) => {
  if (!t.startDate || !t.endDate) return n;
  return n + Math.round((Date.parse(t.endDate) - Date.parse(t.startDate)) / 86400000) + 1;
}, 0);
document.getElementById('kpis').innerHTML = [
  [trips.length, trips.length === 1 ? 'Reis' : 'Reizen'],
  [totalStops, 'Stops'],
  [num.format(totalKm), 'Kilometer'],
  [totalDays, 'Dagen onderweg'],
]
  .map(([value, label]) => `<div class="kpi"><b>${value}</b><span>${label}</span></div>`)
  .join('');

// ---------- Filters: periode (decennium) en continent ----------
const decadeOf = (trip) => Math.floor(Number((trip.startDate || '').slice(0, 4)) / 10) * 10;
const found = trips.map(decadeOf).filter(Boolean);
const decades = [];
for (let d = Math.max(...found); d >= Math.min(...found); d -= 10) decades.push(d);
const filter = { decade: 0, continent: '' };
const matches = (trip) =>
  (!filter.decade || decadeOf(trip) === filter.decade) && (!filter.continent || trip.continentDays?.[filter.continent]);
const newestFirst = [...trips].sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
const plural = (n) => `${n} ${n === 1 ? 'reis' : 'reizen'}`;

const decadesEl = document.getElementById('decades');
decadesEl.innerHTML = [
  `<button type="button" data-decade="" aria-pressed="true">Alle jaren<span>${plural(trips.length)}</span></button>`,
  ...decades.map((d) => {
    const count = trips.filter((t) => decadeOf(t) === d).length;
    return `<button type="button" data-decade="${d}" aria-pressed="false">${d}–${d + 9}<span>${plural(count)}</span></button>`;
  }),
].join('');
decadesEl.addEventListener('click', (e) => {
  const button = e.target.closest('button');
  if (!button) return;
  decadesEl.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
  filter.decade = Number(button.dataset.decade) || 0;
  applyFilter();
});

let map, bounds; // overzichtskaart (onderaan opgebouwd)
const tripLayers = []; // per reis: { trip, group, points }

// Reiskaarten, routes op de kaart en kaartuitsnede volgen het filter.
function applyFilter() {
  const list = newestFirst.filter(matches);
  document.getElementById('trip-count').textContent = list.length ? `${plural(list.length)} · klik op een reis voor de kaart en de verhalen` : '';
  document.getElementById('trips').innerHTML = list.length ? list.map(cardHtml).join('') : '<p class="empty">Geen reizen met dit filter.</p>';
  if (!map) return;

  const view = L.latLngBounds([]);
  tripLayers.forEach(({ trip, group, points }) => {
    const show = matches(trip);
    if (show !== map.hasLayer(group)) show ? group.addTo(map) : group.remove();
    if (!show) return;
    points
      .filter(([lat, lng]) => !filter.continent || continentOf(lat, lng) === filter.continent)
      .forEach((p) => view.extend(p));
  });
  if (!filter.decade && !filter.continent) map.flyToBounds(bounds, { padding: [MAP_PAD, MAP_PAD], duration: 0.8 });
  else if (view.isValid()) map.flyToBounds(view, { padding: [40, 40], maxZoom: 7, duration: 0.8 });
}

// Hoogte van de kaart volgt uit de bestemmingen: de breedte van de kaart bepaalt de
// schaal, en bij die schaal is de afstand tussen de meest noordelijke en de meest
// zuidelijke bestemming (plus marge) de hoogte. Begrensd tussen 280 px en 80% van het scherm.
const MAP_PAD = 30;
function fitMap() {
  const el = map.getContainer();
  if (bounds.isValid() && el.offsetWidth) {
    const sw = map.project(bounds.getSouthWest(), 0);
    const ne = map.project(bounds.getNorthEast(), 0);
    const scale = (el.offsetWidth - 2 * MAP_PAD) / Math.max(ne.x - sw.x, 1e-6);
    const height = (sw.y - ne.y) * scale + 2 * MAP_PAD;
    el.style.height = `${Math.round(Math.min(Math.max(height, 280), innerHeight * 0.8))}px`;
  }
  map.invalidateSize();
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [MAP_PAD, MAP_PAD] });
  else map.setView([50, 5], 5);
}
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => map && fitMap(), 150);
});

// ---------- Reizen ----------
function cardHtml(trip) {
  return `
    <a class="trip-card" href="${tripUrl(trip)}">
      ${trip.coverSrc ? `<img src="${asset(trip, trip.coverSrc)}" alt="" loading="lazy" />` : '<div class="no-cover">🗺️</div>'}
      <div class="body">
        <h3>${escapeHtml(trip.title)}${trip.draft ? ' <span class="draft">concept</span>' : ''}</h3>
        <div class="dates">${formatRange(trip.startDate, trip.endDate)}</div>
        <p class="summary">${escapeHtml(trip.summary)}</p>
        <div class="stats">
          <span class="stat">${trip.stopCount} stops</span>
          ${trip.totalKm ? `<span class="stat">${formatKm(trip.totalKm)}</span>` : ''}
        </div>
      </div>
    </a>`;
}

function popupHtml(trip) {
  return `
    <div class="trip-pop">
      ${trip.coverSrc ? `<img src="${asset(trip, trip.coverSrc)}" alt="" />` : ''}
      <div class="body">
        <h3>${escapeHtml(trip.title)}</h3>
        <div class="dates">${formatRange(trip.startDate, trip.endDate)}</div>
        ${trip.summary ? `<p class="summary">${escapeHtml(trip.summary)}</p>` : ''}
        <div class="stats">
          <span class="stat">${trip.stopCount} stops</span>
          ${trip.totalKm ? `<span class="stat">${formatKm(trip.totalKm)}</span>` : ''}
        </div>
        <a class="open" href="${tripUrl(trip)}">Reis bekijken →</a>
      </div>
    </div>`;
}

// ---------- Links ----------
const links = home.links
  .map((link) => {
    try {
      return { ...link, host: new URL(link.url).hostname.replace(/^www\./, '') };
    } catch {
      return null;
    }
  })
  .filter(Boolean);

if (links.length) {
  const section = document.getElementById('links');
  section.hidden = false;
  section.innerHTML = `
    <div class="section-title"><h2>${escapeHtml(home.linksTitle || 'Links')}</h2></div>
    <div class="link-grid">
      ${links
        .map((link) => {
          const image = homeAsset(link.image);
          const title = link.title || link.host;
          return `
          <a class="link-card" href="${escapeHtml(link.url)}" target="_blank" rel="noopener">
            ${image ? `<img src="${image}" alt="" loading="lazy" />` : `<div class="link-ph">${escapeHtml(title[0].toUpperCase())}</div>`}
            <div class="body">
              <h3>${escapeHtml(title)}</h3>
              ${link.description ? `<p>${escapeHtml(link.description)}</p>` : ''}
              <span class="host">${escapeHtml(link.host)} ↗</span>
            </div>
          </a>`;
        })
        .join('')}
    </div>`;
}

document.getElementById('site-footer').textContent = [home.eyebrow, yearLabel].filter(Boolean).join(' · ');

// ---------- Overzichtskaart met alle routes ----------
// Kleur per reis: tint telkens een 'gulden hoek' verder, zodat opeenvolgende (vaak naburige) reizen duidelijk verschillen.
const colorOf = (i) => `hsl(${Math.round((i * 137.5) % 360)}, ${i % 2 ? 85 : 70}%, ${[38, 48, 30][i % 3]}%)`;
applyFilter();
map = createMap('overview-map', { tiles: 'gray', scrollWheelZoom: false, zoomSnap: 0.1 }); // fijne zoomstappen: kaart sluit precies aan
bounds = L.latLngBounds([]);
// Grove routes uit een apart bestand, zodat de kaartjes hierboven daar niet op wachten.
const routes = await loadRoutes();

// Pop-up met de reis bij hoveren (op een touchscreen: bij tikken), met een knop naar de reis.
const canHover = matchMedia('(hover: hover)').matches;
const popup = L.popup({ className: 'trip-popup', maxWidth: 280, minWidth: 260, autoPan: !canHover, closeButton: !canHover, offset: [0, -6] });
let popupTrip = null, popupOff = null, hideTimer;
function showTripPopup(trip, latlng, highlight) {
  clearTimeout(hideTimer);
  if (popupTrip === trip && map.hasLayer(popup)) return;
  popupOff?.(false);
  popupTrip = trip;
  popupOff = highlight;
  popup.setLatLng(latlng).setContent(popupHtml(trip)).openOn(map);
}
function hideTripPopupSoon() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => map.closePopup(popup), 250);
}
popup.once('add', () => {
  // Muis van de route naar de pop-up: open laten, zodat de knop bereikbaar is.
  popup.getElement().addEventListener('mouseenter', () => clearTimeout(hideTimer));
  popup.getElement().addEventListener('mouseleave', hideTripPopupSoon);
});
popup.on('remove', () => {
  popupOff?.(false);
  popupTrip = popupOff = null;
});

trips.forEach((trip, i) => {
  const color = colorOf(i);
  const group = L.featureGroup().addTo(map);
  const { route, points } = routes[trip.slug] || { route: '', points: [] };

  const line = route ? L.polyline(decodePolyline(route), { color, weight: 4, opacity: 0.9 }).addTo(group) : null;
  points.forEach((latlng) =>
    L.circleMarker(latlng, { radius: 5, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 }).addTo(group)
  );

  const highlight = (on) => line?.setStyle(on ? { weight: 7, opacity: 1 } : { weight: 4, opacity: 0.9 });
  group
    .on('mouseover', (e) => {
      group.bringToFront();
      highlight(true);
      if (canHover) showTripPopup(trip, e.latlng, highlight);
    })
    .on('mouseout', () => (canHover ? hideTripPopupSoon() : highlight(false)))
    .on('click', (e) => (canHover ? (location.href = tripUrl(trip)) : showTripPopup(trip, e.latlng, highlight)));
  if (group.getLayers().length) bounds.extend(group.getBounds());
  tripLayers.push({ trip, group, points });
});

fitMap();

// ---------- Continentknoppen ----------
const continentDays = {};
trips.forEach((t) => Object.entries(t.continentDays || {}).forEach(([c, n]) => (continentDays[c] = (continentDays[c] || 0) + n)));
const continentBounds = {};
Object.values(routes).forEach(({ points }) =>
  points.forEach(([lat, lng]) => (continentBounds[continentOf(lat, lng)] ||= L.latLngBounds([])).extend([lat, lng]))
);
const visited = CONTINENTS.filter((c) => continentDays[c.id] && continentBounds[c.id]?.isValid());
const continentsEl = document.getElementById('continents');
continentsEl.innerHTML = [
  `<button type="button" data-continent="" aria-pressed="true">Hele wereld</button>`,
  ...visited.map(
    (c) => `<button type="button" data-continent="${c.id}" aria-pressed="false">${escapeHtml(c.label)}<span>${num.format(continentDays[c.id])} ${continentDays[c.id] === 1 ? 'dag' : 'dagen'}</span></button>`
  ),
].join('');
continentsEl.addEventListener('click', (e) => {
  const button = e.target.closest('button');
  if (!button) return;
  continentsEl.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
  filter.continent = button.dataset.continent;
  applyFilter();
});
