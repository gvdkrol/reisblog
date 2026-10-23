import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { decodePolyline } from './polyline.js';
import { isVia, onRoute } from './stops.js';

export { decodePolyline, isVia, onRoute };

export const STOP_TYPES = {
  camping: { label: 'Camping', icon: '🚐', color: '#2f6f73' },
  hotel: { label: 'Hotel', icon: '🏨', color: '#1d4ed8' },
  haven: { label: 'Haven / veerboot', icon: '⚓', color: '#0369a1' },
  bezienswaardigheid: { label: 'Bezienswaardigheid', icon: '📍', color: '#be123c' },
  eten: { label: 'Eten & drinken', icon: '🍽️', color: '#b7791f' },
  activiteit: { label: 'Activiteit', icon: '🥾', color: '#4b7a3a' },
  highlight: { label: 'Highlight', icon: '⭐', color: '#7a4bb0' },
  // Fietstocht: eigen spoor (stop.track) als gestippelde lijn, naast de autoroute.
  fietstocht: { label: 'Fietstocht', icon: '🚲', color: '#0e7490' },
  // Via: alleen een rood stipje op de route; niet aanklikbaar en zonder nummer.
  via: { label: 'Via (alleen punt op de route)', icon: '•', color: '#dc2626' },
};

// Oude typenamen die nog in bestaande bestanden kunnen staan.
const TYPE_ALIASES = { overnachting: 'camping' };


export function stopType(type) {
  return STOP_TYPES[TYPE_ALIASES[type] || type] || { label: 'Stop', icon: '•', color: '#555' };
}

// tiles: 'osm' (OpenStreetMap, veel detail) of 'gray' (lichtgrijs, zoals route-the-americas).
export function createMap(el, { tiles = 'osm', ...options } = {}) {
  const map = L.map(el, { zoomControl: false, ...options });
  L.control.zoom({ position: 'bottomleft' }).addTo(map);
  map.attributionControl.setPosition('bottomleft'); // rechtsonder valt hij onder het zijpaneel
  if (tiles === 'gray') {
    const esri = (layer) => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${layer}/MapServer/tile/{z}/{y}/{x}`;
    L.tileLayer(esri('World_Light_Gray_Base'), {
      maxZoom: 18,
      maxNativeZoom: 16,
      attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
    }).addTo(map);
    L.tileLayer(esri('World_Light_Gray_Reference'), { maxZoom: 18, maxNativeZoom: 16 }).addTo(map);
  } else {
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
  }
  return map;
}

// Lijnstijl van een traject: vlucht dun gestippeld, rechte lijn ("volg niet de weg")
// gestreept, route over de weg doorgetrokken, nog niet berekend grijs-achtig gestreept.
export function legStyle(leg, routed = !!leg?.polyline) {
  if (leg?.flight) return { weight: 2.5, dashArray: '1 9' };
  if (leg?.straight) return { weight: 4, dashArray: '10 8' };
  return { weight: 5, dashArray: routed ? null : '6 8' };
}

// Lijn(en) van een reis: de berekende route per traject, of een rechte lijn als die (nog) ontbreekt.
export function legLatLngs(trip) {
  const byId = Object.fromEntries(trip.stops.map((s) => [s.id, s]));
  const route = trip.stops.filter(onRoute); // fietstochten liggen naast de route
  const result = [];
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i];
    const b = route[i + 1];
    const leg = trip.legs.find((l) => l.from === a.id && l.to === b.id);
    const latlngs = leg?.polyline ? decodePolyline(leg.polyline) : [[a.lat, a.lng], [b.lat, b.lng]];
    result.push({ leg, from: byId[a.id], to: byId[b.id], latlngs, routed: !!leg?.polyline });
  }
  return result;
}

export { L };
