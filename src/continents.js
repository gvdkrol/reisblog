// Grove indeling van een punt in een continent, voor de continentknoppen op de
// homepage. Zonder afhankelijkheden, zodat de site en de Node-scripts (build) dezelfde
// regels gebruiken. Werelddelen volgens de gangbare indeling: Midden-Amerika en het
// Caribisch gebied horen bij Noord-Amerika, Hawaï en Alaska ook.

export const CONTINENTS = [
  { id: 'europa', label: 'Europa' },
  { id: 'noord-amerika', label: 'Noord-Amerika' },
  { id: 'zuid-amerika', label: 'Zuid-Amerika' },
  { id: 'afrika', label: 'Afrika' },
  { id: 'azie', label: 'Azië' },
  { id: 'oceanie', label: 'Oceanië' },
];

export function continentOf(lat, lng) {
  if (lng < -25) {
    if (lat > 30 && lng > -32) return 'europa'; // Azoren
    if (lat < 0 && lng < -120) return 'oceanie'; // Stille Oceaan (bijv. Fiji ten oosten van 180°)
    if (lng < -140) return 'noord-amerika'; // Hawaï, Alaska
    if ((lat < 13 && lng > -77.3) || (lat < 2 && lng > -92)) return 'zuid-amerika'; // vanaf de grens Panama–Colombia; Galápagos
    return 'noord-amerika';
  }
  if (lat >= 36 && (lng < 40 || (lat > 45 && lng < 60))) {
    return lat < 42 && lng > 26 ? 'azie' : 'europa'; // Turkije telt als Azië
  }
  if (lng < 52 && lat < 37.5 && !(lng >= 34.5 && lat >= 12)) return 'afrika'; // zonder het Arabisch schiereiland
  if ((lat < -10 && lng >= 110) || (lat < 0 && lng > 130) || lng >= 165) return 'oceanie';
  return 'azie';
}

// Dagen per continent voor één reis: elke dag van begin tot eind telt bij het continent
// van de laatste stop tot en met die dag (daar sliep je). Geeft { continent: dagen }.
export function continentDays(stops) {
  const dated = stops.filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.date || '')).sort((a, b) => a.date.localeCompare(b.date));
  if (!dated.length) return {};
  const days = {};
  const end = Date.parse(dated.at(-1).date);
  let i = 0;
  for (let t = Date.parse(dated[0].date); t <= end; t += 86400000) {
    const day = new Date(t).toISOString().slice(0, 10);
    while (i + 1 < dated.length && dated[i + 1].date <= day) i++;
    const c = continentOf(dated[i].lat, dated[i].lng);
    days[c] = (days[c] || 0) + 1;
  }
  return days;
}
