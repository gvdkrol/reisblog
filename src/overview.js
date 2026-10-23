import './style.css';
import { trips, asset, home, homeAsset, loadRoutes } from './data.js';
import { createMap, decodePolyline, L } from './map.js';
import { formatRange, formatKm, escapeHtml } from './format.js';
import { CONTINENTS, continentOf } from './continents.js';

const embed = new URLSearchParams(location.search).has('embed');
const tripUrl = (trip) => `trip.html?reis=${encodeURIComponent(trip.slug)}${embed ? '&embed=1' : ''}`;
const num = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 });

// ---------- Kop ----------
const years = [...new Set(trips.flatMap((t) => [t.startDate, t.endDate]).filter(Boolean).map((d) => d.slice(0, 4)))].sort();
const yearLabel = years.length > 1 ? `${years[0]}–${years.at(-1)}` : years[0] || '';
const words = home.title.trim().split(/\s+/);
const lastWord = words.pop();

document.title = home.title;
document.getElementById('site-header').innerHTML = `
  ${home.eyebrow || yearLabel ? `<div class="eyebrow">${escapeHtml([home.eyebrow, yearLabel].filter(Boolean).join(' · '))}</div>` : ''}
  <h1>${words.length ? `${escapeHtml(words.join(' '))} ` : ''}<em>${escapeHtml(lastWord)}</em></h1>
  ${home.subtitle ? `<p class="lede">${escapeHtml(home.subtitle)}</p>` : ''}
`;

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

// ---------- Tabs: Home en de reizen per decennium ----------
const decadeOf = (trip) => Math.floor(Number((trip.startDate || '').slice(0, 4)) / 10) * 10;
const decadeLabel = (decade) => `${String(decade % 100).padStart(2, '0')}'s`;
const found = trips.map(decadeOf).filter(Boolean);
const decades = [];
for (let d = Math.max(2020, ...found); d >= Math.min(1990, ...found); d -= 10) decades.push(d);
let map, bounds; // overzichtskaart (onderaan opgebouwd)
const tripsIn = (decade) =>
  trips.filter((t) => decadeOf(t) === decade).sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));

const tabs = [{ id: 'home', label: 'Home' }, ...decades.map((d) => ({ id: `${d % 100}s`.padStart(3, '0'), label: decadeLabel(d), decade: d }))];
const tabsEl = document.getElementById('tabs');
tabsEl.innerHTML = tabs
  .map((tab) => {
    const count = tab.decade ? tripsIn(tab.decade).length : trips.length;
    return `<a role="tab" href="#${tab.id}" data-tab="${tab.id}">${escapeHtml(tab.label)}<span class="count">${count} ${count === 1 ? 'reis' : 'reizen'}</span></a>`;
  })
  .join('');

function showTab(id) {
  const tab = tabs.find((t) => t.id === id) || tabs[0];
  tabsEl.querySelectorAll('[role="tab"]').forEach((el) => el.setAttribute('aria-selected', String(el.dataset.tab === tab.id)));
  document.getElementById('panel-home').hidden = !!tab.decade;
  document.getElementById('panel-decade').hidden = !tab.decade;
  if (tab.decade) {
    const list = tripsIn(tab.decade);
    document.getElementById('decade-title').textContent = `Reizen ${tab.decade}–${tab.decade + 9}`;
    document.getElementById('trip-count').textContent = list.length
      ? `${list.length} ${list.length === 1 ? 'reis' : 'reizen'} · klik op een reis voor de kaart en de verhalen`
      : '';
    document.getElementById('trips').innerHTML = list.length ? list.map(cardHtml).join('') : '<p class="empty">Nog geen reizen uit deze jaren.</p>';
  } else if (map) fitMap(); // kaart was mogelijk verborgen
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
  resizeTimer = setTimeout(() => map && !document.getElementById('panel-home').hidden && fitMap(), 150);
});
window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));

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
const colors = ['#c2410c', '#0f766e', '#7c3aed', '#b45309', '#15803d'];
showTab(location.hash.slice(1));
map = createMap('overview-map', { tiles: 'gray', scrollWheelZoom: false, zoomSnap: 0.1 }); // fijne zoomstappen: kaart sluit precies aan
bounds = L.latLngBounds([]);
// Grove routes uit een apart bestand, zodat de kaartjes hierboven daar niet op wachten.
const routes = await loadRoutes();

trips.forEach((trip, i) => {
  const color = colors[i % colors.length];
  const group = L.featureGroup().addTo(map);
  const { route, points } = routes[trip.slug] || { route: '', points: [] };

  if (route) L.polyline(decodePolyline(route), { color, weight: 4, opacity: 0.9 }).addTo(group);
  points.forEach((latlng) =>
    L.circleMarker(latlng, { radius: 5, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 }).addTo(group)
  );

  group.bindTooltip(escapeHtml(trip.title), { sticky: true }).on('click', () => (location.href = tripUrl(trip)));
  if (group.getLayers().length) bounds.extend(group.getBounds());
});

fitMap();

// ---------- Continentknoppen: inzoomen op de bezochte plekken per continent ----------
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
  const id = button.dataset.continent;
  if (id) map.flyToBounds(continentBounds[id], { padding: [40, 40], maxZoom: 7, duration: 0.8 });
  else map.flyToBounds(bounds, { padding: [30, 30], duration: 0.8 });
});
