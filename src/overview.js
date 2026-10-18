import './style.css';
import { trips, asset, home, homeAsset, loadRoutes } from './data.js';
import { createMap, decodePolyline, L } from './map.js';
import { formatRange, formatKm, escapeHtml } from './format.js';

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

// ---------- Reizen ----------
document.getElementById('trip-count').textContent = trips.length ? 'klik op een reis voor de kaart en de verhalen' : '';
document.getElementById('trips').innerHTML = trips
  .map(
    (trip) => `
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
    </a>`
  )
  .join('');

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
const map = createMap('overview-map', { tiles: 'gray', scrollWheelZoom: false });
const bounds = L.latLngBounds([]);
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

if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30] });
else map.setView([50, 5], 5);
