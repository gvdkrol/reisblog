import './style.css';
import { trips, asset } from './data.js';
import { createMap, legLatLngs, L } from './map.js';
import { formatRange, formatKm, escapeHtml } from './format.js';

const embed = new URLSearchParams(location.search).has('embed');
const tripUrl = (trip) => `trip.html?reis=${encodeURIComponent(trip.slug)}${embed ? '&embed=1' : ''}`;

// Kaarten met reizen
document.getElementById('trips').innerHTML = trips
  .map(
    (trip) => `
    <a class="trip-card" href="${tripUrl(trip)}">
      <img src="${asset(trip, trip.cover)}" alt="" loading="lazy" />
      <div class="body">
        <h2>${escapeHtml(trip.title)}</h2>
        <div class="dates">${formatRange(trip.startDate, trip.endDate)}</div>
        <p class="summary">${escapeHtml(trip.summary)}</p>
        <div class="stats">
          <span class="stat">${trip.stops.length} stops</span>
          ${trip.totalKm ? `<span class="stat">${formatKm(trip.totalKm)}</span>` : ''}
        </div>
      </div>
    </a>`
  )
  .join('');

// Overzichtskaart met alle routes
const colors = ['#c2553a', '#2f6f73', '#7a4bb0', '#b7791f', '#4b7a3a'];
const map = createMap('overview-map', { scrollWheelZoom: false });
const bounds = L.latLngBounds([]);

trips.forEach((trip, i) => {
  const color = colors[i % colors.length];
  const go = () => (location.href = tripUrl(trip));
  const group = L.featureGroup().addTo(map);

  legLatLngs(trip).forEach(({ latlngs }) => L.polyline(latlngs, { color, weight: 4, opacity: 0.85 }).addTo(group));
  trip.stops.forEach((s) =>
    L.circleMarker([s.lat, s.lng], { radius: 5, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 }).addTo(group)
  );

  group.bindTooltip(escapeHtml(trip.title), { sticky: true }).on('click', go);
  bounds.extend(group.getBounds());
});

if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30] });
else map.setView([50, 5], 5);
