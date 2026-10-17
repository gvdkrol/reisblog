// Google/OSRM "encoded polyline" (precisie 5). Zonder afhankelijkheden, zodat zowel
// de site als de Node-scripts (import, build) het kunnen gebruiken.

// "encoded polyline" → [[lat, lng], ...]
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

// [[lat, lng], ...] → "encoded polyline"
export function encodePolyline(points) {
  let out = '';
  let prevLat = 0;
  let prevLng = 0;
  const encode = (value) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    let s = '';
    while (v >= 0x20) {
      s += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    return s + String.fromCharCode(v + 63);
  };
  for (const [lat, lng] of points) {
    const iLat = Math.round(lat * 1e5);
    const iLng = Math.round(lng * 1e5);
    out += encode(iLat - prevLat) + encode(iLng - prevLng);
    prevLat = iLat;
    prevLng = iLng;
  }
  return out;
}
