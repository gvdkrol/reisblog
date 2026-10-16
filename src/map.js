import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export const STOP_TYPES = {
  overnachting: { label: 'Overnachting', icon: '⛺', color: '#2f6f73' },
  bezienswaardigheid: { label: 'Bezienswaardigheid', icon: '📍', color: '#c2553a' },
  eten: { label: 'Eten & drinken', icon: '🍽️', color: '#b7791f' },
  activiteit: { label: 'Activiteit', icon: '🥾', color: '#4b7a3a' },
  highlight: { label: 'Highlight', icon: '⭐', color: '#7a4bb0' },
};

export function stopType(type) {
  return STOP_TYPES[type] || { label: 'Stop', icon: '•', color: '#555' };
}

export function createMap(el, options = {}) {
  const map = L.map(el, { zoomControl: false, ...options });
  L.control.zoom({ position: 'bottomleft' }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  return map;
}

// Lijn(en) van een reis: de berekende route per traject, of een rechte lijn als die (nog) ontbreekt.
export function legLatLngs(trip) {
  const byId = Object.fromEntries(trip.stops.map((s) => [s.id, s]));
  const result = [];
  for (let i = 0; i < trip.stops.length - 1; i++) {
    const a = trip.stops[i];
    const b = trip.stops[i + 1];
    const leg = trip.legs.find((l) => l.from === a.id && l.to === b.id);
    const latlngs = leg?.polyline ? decodePolyline(leg.polyline) : [[a.lat, a.lng], [b.lat, b.lng]];
    result.push({ leg, from: byId[a.id], to: byId[b.id], latlngs, routed: !!leg?.polyline });
  }
  return result;
}

// Google/OSRM "encoded polyline" (precisie 5) → [[lat, lng], ...]
export function decodePolyline(str) {
  const points = [];
  let index = 0, lat = 0, lng = 0;
  while (index < str.length) {
    for (const axis of [0, 1]) {
      let result = 0, shift = 0, b;
      do {
        b = str.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta; else lng += delta;
    }
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

export { L };
