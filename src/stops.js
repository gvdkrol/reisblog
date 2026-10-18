// Regels voor soorten stops. Zonder afhankelijkheden, zodat de site, de editor en de
// Node-scripts (routes, build, import) dezelfde regels gebruiken.
//
// - via:        alleen een punt op de route (geen nummer, niet aanklikbaar)
// - fietstocht: hangt naast de route met een eigen spoor (stop.track); de autoroute
//               loopt van de stop ervoor rechtstreeks naar de stop erna

export const isVia = (stop) => stop?.type === 'via';
export const onRoute = (stop) => stop?.type !== 'fietstocht';

// Traject naar `stop` vanaf de vorige echte stop op de route (via-punten en
// fietstochten tellen niet als vertrekpunt). Geeft { from, leg } of null.
// leg = { km, minutes? } opgeteld over de tussenliggende trajecten, of null als er
// een traject zonder route tussen zit.
export function legInto(stops, legs, stop) {
  if (!onRoute(stop) || isVia(stop)) return null;
  const route = stops.filter(onRoute);
  const i = route.indexOf(stop);
  let j = i - 1;
  while (j >= 0 && isVia(route[j])) j--;
  if (j < 0 && i > 0) j = 0; // eerste stop: afstand vanaf het vertrekpunt (bijv. thuis als via-punt)
  if (j < 0) return null;

  const byPair = new Map(legs.map((l) => [`${l.from}>${l.to}`, l]));
  const parts = [];
  for (let k = j; k < i; k++) parts.push(byPair.get(`${route[k].id}>${route[k + 1].id}`));
  if (!parts.every((p) => p?.polyline)) return { from: route[j], leg: null };
  return {
    from: route[j],
    leg: {
      polyline: true,
      km: parts.reduce((sum, p) => sum + p.km, 0),
      flight: parts.some((p) => p.flight),
      minutes: parts.every((p) => Number.isFinite(p.minutes)) ? parts.reduce((sum, p) => sum + p.minutes, 0) : undefined,
    },
  };
}
