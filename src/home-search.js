// Zoekveld op de homepage: doorzoekt de namen en teksten van alle stops en brengt je
// naar de juiste stop (dag) en het juiste blogbericht op de reispagina. De zoekindex
// (zoek.json) wordt pas opgehaald als het veld voor het eerst gebruikt wordt.
import { loadSearch } from './data.js';
import { fold, queryTerms, findRanges } from './search.js';
import { formatRange, escapeHtml } from './format.js';

const STEP = 40; // aantal resultaten per keer
const SNIPPET = 170; // lengte van het tekstfragment
const STORE = 'reisblog-zoek';

// trips: samenvattingen van de reizen; tripUrl(trip) → adres van de reispagina.
export function initSearch({ trips, tripUrl }) {
  const input = document.getElementById('search-input');
  const box = document.getElementById('search-results');
  const tripOf = new Map(trips.map((t) => [t.slug, t]));
  let index; // Promise met [{ trip, stopId, stop, date, item, title, text, fHead, fText }]
  let shown = STEP;
  let timer;

  const load = () =>
    (index ||= loadSearch().then((rows) =>
      rows
        .filter(([slug]) => tripOf.has(slug))
        .map(([slug, stopId, stop, date, item, title, text]) => ({
          trip: tripOf.get(slug), stopId, stop, date, item, title, text,
          fHead: fold(item ? title : stop), // een bericht vind je op zijn titel, de stop zelf op zijn naam
          fText: fold(text),
        }))
    ));

  function search(items, query) {
    const terms = queryTerms(query);
    const phrase = fold(query.trim().replace(/\s+/g, ' '));
    const hits = [];
    for (const it of items) {
      if (!terms.every((t) => it.fHead.includes(t) || it.fText.includes(t))) continue;
      const score = it.fHead.includes(phrase) ? 3 : terms.every((t) => it.fHead.includes(t)) ? 2 : it.fText.includes(phrase) ? 1 : 0;
      hits.push({ it, score });
    }
    // Eerst treffers in de titel, dan de exacte zin; daarbinnen de nieuwste reis eerst.
    hits.sort((a, b) => b.score - a.score || b.it.date.localeCompare(a.it.date));
    return { terms, phrase, hits };
  }

  const marked = (text, folded, terms) => {
    let html = '';
    let pos = 0;
    for (const [from, to] of findRanges(folded, terms)) {
      html += `${escapeHtml(text.slice(pos, from))}<mark>${escapeHtml(text.slice(from, to))}</mark>`;
      pos = to;
    }
    return html + escapeHtml(text.slice(pos));
  };

  // Fragment rond de eerste treffer in de tekst (bij voorkeur de exacte zin).
  function snippet(it, terms, phrase) {
    if (!it.text) return '';
    let at = it.fText.indexOf(phrase);
    if (at < 0) at = Math.min(...terms.map((t) => it.fText.indexOf(t)).filter((n) => n >= 0), Infinity);
    if (!Number.isFinite(at)) at = 0;
    let from = Math.max(0, at - 50);
    if (from) from = it.text.indexOf(' ', from) + 1 || from; // op een woordgrens beginnen
    const to = Math.min(it.text.length, from + SNIPPET);
    const part = it.text.slice(from, to);
    return `${from ? '… ' : ''}${marked(part, it.fText.slice(from, to), terms)}${to < it.text.length ? ' …' : ''}`;
  }

  async function run() {
    const query = input.value.trim();
    try { sessionStorage.setItem(STORE, query); } catch { /* geen opslag: zoeken werkt gewoon */ }
    if (query.length < 2) return close();
    box.hidden = false;
    if (!box.innerHTML) box.innerHTML = '<p class="sr-note">Verhalen laden…</p>';
    let items;
    try {
      items = await load();
    } catch {
      index = null;
      box.innerHTML = '<p class="sr-note">De zoekindex kon niet worden geladen.</p>';
      return;
    }
    if (input.value.trim() !== query) return; // intussen verder getypt
    const { terms, phrase, hits } = search(items, query);
    if (!hits.length) {
      box.innerHTML = `<p class="sr-note">Niets gevonden voor “${escapeHtml(query)}”.</p>`;
      return;
    }
    const list = hits.slice(0, shown);
    box.innerHTML = `
      <p class="sr-note">${hits.length} ${hits.length === 1 ? 'resultaat' : 'resultaten'}</p>
      ${list
        .map(({ it }) => {
          const head = it.item ? it.title : it.stop;
          const url = `${tripUrl(it.trip)}&zoek=${encodeURIComponent(query)}&item=${it.item}#stop-${encodeURIComponent(it.stopId)}`;
          const meta = [it.trip.title, it.item ? it.stop : '', it.date ? formatRange(it.date, it.date) : ''].filter(Boolean);
          const text = snippet(it, terms, phrase);
          return `
          <a class="sr-item" href="${escapeHtml(url)}">
            <b>${marked(head, fold(head), terms)}</b>
            <span class="sr-meta">${meta.map(escapeHtml).join(' · ')}</span>
            ${text ? `<span class="sr-text">${text}</span>` : ''}
          </a>`;
        })
        .join('')}
      ${hits.length > list.length ? `<button type="button" class="sr-more">Toon meer resultaten</button>` : ''}`;
  }

  function close() {
    box.hidden = true;
    box.innerHTML = '';
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    shown = STEP;
    timer = setTimeout(run, 150);
  });
  input.addEventListener('focus', () => {
    load().catch(() => (index = null)); // index alvast ophalen
    if (box.hidden) run();
  });
  box.addEventListener('click', (e) => {
    if (!e.target.closest('.sr-more')) return;
    shown += STEP;
    run();
  });
  // Buiten het zoekvak klikken of Escape sluit de lijst; pijltjes lopen door de resultaten.
  document.addEventListener('pointerdown', (e) => !e.target.closest('#search') && (box.hidden = true));
  document.getElementById('search').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      box.hidden = true;
      input.focus();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const links = [...box.querySelectorAll('.sr-item')];
    if (!links.length || box.hidden) return;
    e.preventDefault();
    const at = links.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown' ? at + 1 : at - 1;
    (links[next] || (next < 0 ? input : links.at(-1))).focus();
  });

  // Terug van een reispagina: de vorige zoekvraag staat er nog (resultaten bij focus).
  try { input.value = sessionStorage.getItem(STORE) || ''; } catch { /* geen opslag */ }
}
