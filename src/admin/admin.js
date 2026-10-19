import '../style.css';
import './admin.css';
import { createMap, stopType, STOP_TYPES, decodePolyline, isVia, onRoute, L } from '../map.js';
import { legInto } from '../stops.js';
import { slugify } from '../slugify.js';
import { formatDate, formatKm, formatDuration, formatLeg, escapeHtml as esc } from '../format.js';
import { stopPanelHtml, bindPanelPhotos } from '../panel.js';

const $ = (id) => document.getElementById(id);
const round = (n) => Math.round(n * 1e5) / 1e5;
const today = () => new Date().toISOString().slice(0, 10);
const legKey = (a, b) => `${a.lat},${a.lng};${b.lat},${b.lng}`; // gelijk aan scripts/routing.mjs
const photoUrl = (src) => `/content/trips/${trip.slug}/${src}`;
const NOMINATIM = 'https://nominatim.openstreetmap.org';

let trip = null;
let selectedId = null;
let dirty = false;
let view = 'trips'; // 'trips' of 'home'
let home = null;

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, options);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}
const jsonBody = (method, data) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

function setStatus(message, kind = '') {
  const el = $('status');
  el.textContent = message;
  el.className = `status ${kind}`;
}

function setDirty(value = true) {
  dirty = value;
  $('save').disabled = !value;
  document.title = `${value ? '● ' : ''}Editor · Reisblog`;
  if (value) setStatus('Niet-opgeslagen wijzigingen');
  updateStats();
  if (view === 'trips') schedulePreview();
}

function updateStats() {
  if (view === 'home') return ($('stats').textContent = home ? `${home.links.length} link${home.links.length === 1 ? '' : 's'}` : '');
  if (!trip) return ($('stats').textContent = '');
  const legs = new Map(trip.legs.map((l) => [l.key, l]));
  let km = 0, minutes = 0, missing = 0;
  const route = trip.stops.filter(onRoute); // fietstochten liggen naast de route
  route.forEach((a, i) => {
    const b = route[i + 1];
    if (!b) return;
    const leg = legs.get(legKey(a, b));
    if (leg?.polyline) { km += leg.km; minutes += leg.minutes || 0; } else missing++;
  });
  const vias = trip.stops.filter(isVia).length;
  const drafts = trip.stops.filter((s) => s.draft).length;
  const parts = [`${trip.stops.length - vias} stops`];
  if (vias) parts.push(`${vias} via`);
  if (drafts) parts.push(`${drafts} concept`);
  if (km) parts.push(formatKm(km));
  if (minutes) parts.push(`${formatDuration(minutes)} rijden`);
  if (missing) parts.push(`${missing} traject${missing > 1 ? 'en' : ''} nog te berekenen`);
  $('stats').textContent = parts.join(' · ');
}

// ---------- Reizen laden ----------
async function loadTripList(selectSlug) {
  const trips = await api('/trips');
  $('trip-select').innerHTML = trips
    .map((t) => `<option value="${esc(t.slug)}">${esc(t.title)}${t.draft ? ' (concept)' : ''}</option>`)
    .join('');
  const wanted = selectSlug || new URLSearchParams(location.search).get('reis');
  const slug = trips.some((t) => t.slug === wanted) ? wanted : trips[0]?.slug;
  if (slug) await openTrip(slug, { force: true });
}

async function openTrip(slug, { force = false } = {}) {
  if (!force && dirty && !confirm('Je hebt niet-opgeslagen wijzigingen. Toch wisselen?')) {
    $('trip-select').value = trip.slug;
    return;
  }
  trip = await api(`/trips/${slug}`);
  trip.legs ||= [];
  selectedId = null;
  $('trip-select').value = slug;
  history.replaceState(null, '', `?reis=${slug}`);
  renderAll();
  setDirty(false);
  setStatus('');
  fitTrip();
}

function renderAll() {
  renderTripFields();
  renderStops();
  renderMap();
}

// ---------- Reisgegevens ----------
function renderTripFields() {
  $('f-title').value = trip.title || '';
  $('f-summary').value = trip.summary || '';
  $('f-draft').checked = !!trip.draft;
  $('cover').innerHTML = trip.cover
    ? `<img src="${photoUrl(trip.cover)}" alt="Omslagfoto" /><span class="cover-edit">Wijzigen</span>`
    : '<span class="hint">Klik om een omslagfoto te kiezen</span>';
  $('view-link').href = `/trip.html?reis=${encodeURIComponent(trip.slug)}`;
}

// ---------- Omslagfoto kiezen uit alle foto's van de reis ----------
function openCoverPicker() {
  const withPhotos = trip.stops.filter((s) => s.photos.length);
  $('cover-picker-body').innerHTML = withPhotos.length
    ? withPhotos
        .map(
          (s) => `<section>
            <h4>${esc(s.name)} <small>${s.date ? formatDate(s.date) : ''}</small></h4>
            <div class="cover-grid">${s.photos
              .map(
                (p) => `<button type="button" class="cover-option${p.src === trip.cover ? ' current' : ''}" data-src="${esc(p.src)}" title="${esc(p.caption || s.name)}">
                  <img src="${photoUrl(p.src)}" alt="" loading="lazy" />
                  ${p.src === trip.cover ? '<span>Huidige omslag</span>' : ''}
                </button>`
              )
              .join('')}</div>
          </section>`
        )
        .join('')
    : '<p class="empty">Deze reis heeft nog geen foto\'s. Voeg eerst foto\'s toe aan een stop.</p>';
  $('cover-picker').hidden = false;
  $('cover-picker-body').querySelector('.current')?.scrollIntoView({ block: 'center' });
}

const closeCoverPicker = () => ($('cover-picker').hidden = true);

$('cover').addEventListener('click', () => trip && openCoverPicker());
$('cover-picker-close').addEventListener('click', closeCoverPicker);
$('cover-picker').addEventListener('click', (e) => {
  if (e.target === $('cover-picker')) return closeCoverPicker();
  const option = e.target.closest('.cover-option');
  if (!option) return;
  trip.cover = option.dataset.src;
  closeCoverPicker();
  setDirty();
  renderTripFields();
  const open = trip.stops.find((s) => s.id === selectedId);
  if (open) rerenderStop(open); // ★ bij de foto's bijwerken
  setStatus('Omslagfoto gekozen. Vergeet niet op te slaan.');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('cover-picker').hidden) closeCoverPicker();
});

$('f-title').addEventListener('input', (e) => { trip.title = e.target.value; setDirty(); });
$('f-summary').addEventListener('input', (e) => { trip.summary = e.target.value; setDirty(); });
$('f-draft').addEventListener('change', (e) => { trip.draft = e.target.checked; setDirty(); });
$('trip-select').addEventListener('change', (e) => openTrip(e.target.value));

$('delete-trip').addEventListener('click', async () => {
  if (!trip) return;
  const photoCount = trip.stops.reduce((n, s) => n + s.photos.length, 0);
  const warning =
    `Reis "${trip.title}" verwijderen?\n\n` +
    `Dit verwijdert de reis met alle ${trip.stops.length} stops en ${photoCount} foto's van je computer ` +
    `(map content/trips/${trip.slug}).\n\n` +
    `Dit kan niet ongedaan worden gemaakt in de editor. Alleen als de reis al eerder gecommit is, kun je hem via git terughalen.`;
  if (!confirm(warning)) return;
  if (prompt(`Typ VERWIJDER om "${trip.title}" definitief te verwijderen:`)?.trim().toUpperCase() !== 'VERWIJDER') {
    setStatus('Verwijderen geannuleerd.');
    return;
  }
  try {
    const title = trip.title;
    await api(`/trips/${trip.slug}`, { method: 'DELETE' });
    trip = null;
    dirty = false;
    history.replaceState(null, '', location.pathname);
    await loadTripList();
    setStatus(`Reis "${title}" is verwijderd.`, 'ok');
  } catch (err) {
    setStatus(`Verwijderen mislukt: ${err.message}`, 'error');
  }
});

$('new-trip').addEventListener('click', async () => {
  if (dirty && !confirm('Je hebt niet-opgeslagen wijzigingen. Toch een nieuwe reis maken?')) return;
  const title = prompt('Titel van de nieuwe reis:');
  if (!title?.trim()) return;
  try {
    const created = await api('/trips', jsonBody('POST', { title }));
    await loadTripList(created.slug);
    setStatus('Nieuwe reis aangemaakt (als concept). Voeg nu stops toe.', 'ok');
  } catch (err) {
    setStatus(`Fout: ${err.message}`, 'error');
  }
});

// ---------- Stops: lijst ----------
const list = $('stops');

// Nummer zoals op de site: via-punten tellen niet mee.
const stopNumber = (s) => trip.stops.filter((x) => !isVia(x)).indexOf(s) + 1;

function headHtml(s, i) {
  const t = stopType(s.type);
  const badge = isVia(s) ? '<span class="badge via" title="Via-punt"></span>' : `<span class="badge" style="--c:${t.color}">${stopNumber(s)}</span>`;
  const flags = `${isVia(s) ? ' · via' : ''}${s.draft ? ' · <em class="draft-flag">concept</em>' : ''}`;
  const photos = s.photos.length === 1 ? '1 foto' : `${s.photos.length} foto's`;
  return `<div class="stop-head" data-action="toggle">
      <span class="handle" title="Sleep om de volgorde te wijzigen">⠿</span>
      ${badge}
      <span class="stop-title"><b>${esc(s.name) || 'Naamloos'}</b><small>${t.icon} ${s.date ? formatDate(s.date) : 'geen datum'} · ${photos}${flags}</small></span>
      <span class="chev">▾</span>
    </div>`;
}

function photoHtml(p, j) {
  return `<figure class="photo" data-p="${j}">
      <img src="${photoUrl(p.src)}" alt="" loading="lazy" />
      ${p.link ? `<a class="photo-source" href="${esc(p.link)}" target="_blank" rel="noopener" title="Bekijk op Flickr">Flickr ↗</a>` : ''}
      <input data-pfield="caption" value="${esc(p.caption)}" placeholder="Onderschrift" />
      <div class="pbtns">
        <button type="button" data-action="pleft" title="Naar voren">◀</button>
        <button type="button" data-action="pright" title="Naar achteren">▶</button>
        <button type="button" data-action="pcover" class="${p.src === trip.cover ? 'on' : ''}" title="Omslagfoto van de reis">★</button>
        <button type="button" data-action="pdel" title="Foto verwijderen">✕</button>
      </div>
    </figure>`;
}

function formHtml(s) {
  const types = Object.entries(STOP_TYPES)
    .map(([key, t]) => `<option value="${key}"${key === s.type ? ' selected' : ''}>${t.icon} ${t.label}</option>`)
    .join('');
  return `<div class="stop-form">
      <label>Naam<input data-field="name" value="${esc(s.name)}" /></label>
      <div class="row">
        <label>Datum<input type="date" data-field="date" value="${esc(s.date)}" /></label>
        <label>Type<select data-field="type">${types}</select></label>
      </div>
      <label class="check stop-draft"><input type="checkbox" data-field="draft" ${s.draft ? 'checked' : ''} /> Concept<span class="hint">deze stop wordt niet gepubliceerd; de route loopt er gewoon langs</span></label>
      ${isVia(s) ? `<p class="hint via-hint">Een via-punt is op de site alleen een klein rood stipje op de route (naam bij aanwijzen). Verhaal en foto's worden niet getoond.</p>` : `
      <label>Verhaal <span class="hint">**vet**, *schuin*, lege regel = nieuwe alinea</span>
        <textarea data-field="text" rows="7">${esc(s.text)}</textarea></label>
      <button type="button" class="link" data-action="preview">${previewOpen ? 'Voorbeeld verbergen' : 'Voorbeeld tonen'}</button>
      ${wpHtml(s)}
      <div class="photos">${s.photos.map(photoHtml).join('')}</div>
      <label class="dropzone">
        <input type="file" accept="image/*" multiple data-action="upload" hidden />
        📷 Foto's toevoegen
        <span class="hint">klik of sleep foto's hierheen · ze worden verkleind naar max. 1600px</span>
      </label>
      <div class="flickr-box">
        <div class="wp-head">
          <button type="button" class="btn small" data-action="flickrfind">📷 Foto's van Flickr</button>
          <span class="hint">foto's die genomen zijn op de datum van deze stop</span>
        </div>
        <div class="flickr-results" hidden></div>
      </div>`}
      <div class="stop-actions">
        <button type="button" class="btn small" data-action="zoom">Toon op kaart</button>
        <button type="button" class="btn small danger" data-action="delete">Stop verwijderen</button>
      </div>
    </div>`;
}

function stopHtml(s, i) {
  return `<li class="stop${s.id === selectedId ? ' open' : ''}" data-id="${esc(s.id)}">${headHtml(s, i)}${s.id === selectedId ? formHtml(s) : ''}</li>`;
}

function renderStops() {
  $('stops-empty').hidden = trip.stops.length > 0;
  list.innerHTML = trip.stops.map(stopHtml).join('');
  schedulePreview();
}

function rerenderStop(stop) {
  const li = list.querySelector(`.stop[data-id="${CSS.escape(stop.id)}"]`);
  if (li) li.outerHTML = stopHtml(stop, trip.stops.indexOf(stop));
}

function selectStop(id, { pan = true } = {}) {
  selectedId = id;
  renderStops();
  renderMap();
  const stop = trip.stops.find((s) => s.id === id);
  if (stop && pan) map.panTo([stop.lat, stop.lng]);
  list.querySelector(`.stop[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function uniqueStopId(name) {
  const base = slugify(name) || 'stop';
  let id = base;
  for (let n = 2; trip.stops.some((s) => s.id === id); n++) id = `${base}-${n}`;
  return id;
}

function addStop({ name, lat, lng }) {
  const last = trip.stops.at(-1);
  const stop = {
    id: uniqueStopId(name),
    name,
    lat: round(lat),
    lng: round(lng),
    date: last?.date || today(),
    type: 'bezienswaardigheid',
    text: '',
    photos: [],
    articles: [],
  };
  trip.stops.push(stop);
  setDirty();
  selectStop(stop.id);
  list.querySelector('.stop.open [data-field="text"]')?.focus();
}

// ---------- Foto's van Flickr ----------
const flickrResults = new Map(); // stop-id → opgehaalde foto's

async function findFlickr(li, stop) {
  const box = li.querySelector('.flickr-results');
  box.hidden = false;
  if (!stop.date) {
    box.innerHTML = '<p class="hint">Vul eerst een datum in.</p>';
    return;
  }
  box.innerHTML = `<p class="hint">Foto's van ${formatDate(stop.date)} ophalen…</p>`;
  try {
    const photos = await api(`/flickr?date=${stop.date}`);
    flickrResults.set(stop.id, photos);
    const have = new Set(trip.stops.flatMap((s) => s.photos.map((p) => p.link)).filter(Boolean));
    const close = '<button type="button" class="link" data-action="flickrclose">Sluiten</button>';
    if (!photos.length) {
      box.innerHTML = `<p class="hint">Geen openbare foto's op Flickr van ${formatDate(stop.date)}.</p>${close}`;
      return;
    }
    const fmtTime = (t) => (t || '').slice(11, 16);
    box.innerHTML = `
      <p class="hint">${photos.length} foto${photos.length === 1 ? '' : "'s"} van ${formatDate(stop.date)}. Vink aan wat je bij deze stop wilt zetten:</p>
      <div class="flickr-grid">${photos
        .map((p, k) => {
          const added = have.has(p.page);
          return `<label class="flickr-item${added ? ' added' : ''}" title="${esc(p.title)}">
            <input type="checkbox" data-k="${k}" ${added ? 'disabled' : ''} />
            <img src="${esc(p.thumb)}" alt="" loading="lazy" />
            <span>${esc(fmtTime(p.taken))}${p.title ? ` · ${esc(p.title)}` : ''}${added ? ' · al toegevoegd' : ''}</span>
          </label>`;
        })
        .join('')}</div>
      <div class="wp-actions">
        <button type="button" class="btn small primary" data-action="flickradd">Toevoegen aan stop</button>
        <button type="button" class="btn small" data-action="flickrall" data-on="1">Alles selecteren</button>
        ${close}
      </div>`;
  } catch (err) {
    box.innerHTML = `<p class="hint">Ophalen mislukt: ${esc(err.message)}</p>`;
  }
}

async function addFlickr(li, stop) {
  const photos = flickrResults.get(stop.id) || [];
  const chosen = [...li.querySelectorAll('.flickr-grid input:checked')].map((c) => photos[Number(c.dataset.k)]);
  if (!chosen.length) return setStatus('Vink eerst een of meer foto\'s aan.', 'error');
  const failed = [];
  for (const [n, p] of chosen.entries()) {
    setStatus(`Foto ${n + 1} van ${chosen.length} van Flickr ophalen…`);
    try {
      const name = `${stop.id}-flickr-${p.id}.jpg`;
      const { src } = await api(`/trips/${trip.slug}/photos?name=${encodeURIComponent(name)}&from=${encodeURIComponent(p.url)}`, { method: 'POST' });
      stop.photos.push({ src, caption: p.title || '', link: p.page });
      if (!trip.cover) trip.cover = src;
    } catch (err) {
      failed.push(`${p.title || p.id} (${err.message})`);
    }
  }
  setDirty();
  rerenderStop(stop);
  renderTripFields();
  if (failed.length) setStatus(`Niet gelukt: ${failed.join(', ')}`, 'error');
  else setStatus(`${chosen.length} foto${chosen.length === 1 ? '' : "'s"} van Flickr toegevoegd. Vergeet niet op te slaan.`);
}

// ---------- Tekst van rondjewereld.nl ----------
const wpResults = new Map(); // stop-id → opgehaalde berichten

function articlesHtml(s) {
  const articles = s.articles || [];
  if (!articles.length) return '';
  return `<ul class="wp-articles">${articles
    .map(
      (a, k) => `<li>
        <a href="${esc(a.url)}" target="_blank" rel="noopener">🔗 ${esc(a.title)}</a>
        <small>${a.date ? formatDate(a.date) : ''}</small>
        <button type="button" data-action="wpremove" data-a="${k}" title="Link verwijderen">✕</button>
      </li>`
    )
    .join('')}</ul>`;
}

function wpHtml(s) {
  return `<div class="wp-box">
      <div class="wp-head">
        <button type="button" class="btn small" data-action="wpfind">📰 Tekst van rondjewereld.nl</button>
        <span class="hint">berichten tot 5 dagen voor of na de datum</span>
      </div>
      <div class="wp-results" hidden></div>
      <div class="wp-linked">${articlesHtml(s)}</div>
    </div>`;
}

async function findArticles(li, stop) {
  const box = li.querySelector('.wp-results');
  box.hidden = false;
  if (!stop.date) {
    box.innerHTML = '<p class="hint">Vul eerst een datum in.</p>';
    return;
  }
  box.innerHTML = '<p class="hint">Berichten ophalen…</p>';
  try {
    const posts = await api(`/wordpress?date=${stop.date}&days=5`);
    wpResults.set(stop.id, posts);
    const linked = new Set((stop.articles || []).map((a) => a.url));
    const close = '<button type="button" class="link" data-action="wpclose">Sluiten</button>';
    if (!posts.length) {
      box.innerHTML = `<p class="hint">Geen berichten gevonden rond ${formatDate(stop.date)}.</p>${close}`;
      return;
    }
    box.innerHTML = `
      <p class="hint">${posts.length} bericht${posts.length === 1 ? '' : 'en'} rond ${formatDate(stop.date)}. Vink aan wat je wilt overnemen:</p>
      <ul class="wp-list">${posts
        .map(
          (p, k) => `<li class="${p.date === stop.date ? 'same-day' : ''}">
            <label>
              <input type="checkbox" data-k="${k}" ${p.date === stop.date && !linked.has(p.url) ? 'checked' : ''} />
              <span>
                <b>${esc(p.title)}</b>
                <small>${formatDate(p.date)} · ${p.words} woorden${linked.has(p.url) ? ' · al gekoppeld' : ''}</small>
                <em>${esc(p.excerpt)}</em>
              </span>
            </label>
            <a href="${esc(p.url)}" target="_blank" rel="noopener" title="Openen op rondjewereld.nl">↗</a>
          </li>`
        )
        .join('')}</ul>
      <div class="wp-actions">
        <button type="button" class="btn small primary" data-action="wpapply" data-mode="append">Tekst toevoegen</button>
        <button type="button" class="btn small" data-action="wpapply" data-mode="replace">Verhaal vervangen</button>
        <button type="button" class="btn small" data-action="wpapply" data-mode="link">Alleen link</button>
        ${close}
      </div>`;
  } catch (err) {
    box.innerHTML = `<p class="hint">Ophalen mislukt: ${esc(err.message)}</p>`;
  }
}

// mode: 'append' (tekst erbij), 'replace' (verhaal vervangen) of 'link' (alleen de link koppelen)
function applyArticles(li, stop, mode) {
  const posts = wpResults.get(stop.id) || [];
  const chosen = [...li.querySelectorAll('.wp-list input:checked')].map((input) => posts[Number(input.dataset.k)]);
  if (!chosen.length) return setStatus('Vink eerst een of meer berichten aan.', 'error');

  if (mode !== 'link') {
    const text = chosen.map((p) => (chosen.length > 1 ? `### ${p.title}\n\n${p.markdown}` : p.markdown)).join('\n\n');
    const current = (stop.text || '').trim();
    if (mode === 'replace' && current && !confirm('Het huidige verhaal vervangen door de tekst van rondjewereld.nl?')) return;
    stop.text = mode === 'replace' || !current ? text : `${current}\n\n${text}`;
  }
  stop.articles ||= [];
  for (const p of chosen) {
    if (!stop.articles.some((a) => a.url === p.url)) stop.articles.push({ title: p.title, url: p.url, date: p.date });
  }
  setDirty();
  rerenderStop(stop);
  const what = mode === 'link' ? 'gekoppeld' : 'overgenomen';
  setStatus(`${chosen.length} bericht${chosen.length === 1 ? '' : 'en'} ${what}. Vergeet niet op te slaan.`);
}

const stopOf = (el) => {
  const li = el.closest('.stop');
  return li ? { li, stop: trip.stops.find((s) => s.id === li.dataset.id) } : {};
};

// ---------- Voorbeeld (zelfde paneel als op de site, rechts over de kaart) ----------
let previewOpen = false;
let previewTimer = null;

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 120);
}

function renderPreview() {
  const panel = $('preview-panel');
  const stop = previewOpen && view === 'trips' && trip?.stops.find((s) => s.id === selectedId && !isVia(s));
  if (!stop) {
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    return;
  }
  const i = trip.stops.indexOf(stop);
  const first = trip.stops[0]?.date;
  const byId = Object.fromEntries(trip.stops.map((s) => [s.id, s]));
  const currentLegs = trip.legs.filter((l) => byId[l.from] && byId[l.to] && l.key === legKey(byId[l.from], byId[l.to]));
  const into = legInto(trip.stops, currentLegs, stop);
  const content = $('preview-content');
  const scroll = content.scrollTop;
  content.innerHTML = stopPanelHtml(stop, {
    photoUrl,
    day: first && stop.date ? Math.round((Date.parse(stop.date) - Date.parse(first)) / 86400000) + 1 : null,
    leg: into?.leg,
    prevStop: into?.from,
  });
  content.scrollTop = scroll; // tijdens het typen niet terugspringen
  bindPanelPhotos(content, stop.photos);
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
}

function setPreview(open) {
  previewOpen = open;
  list.querySelectorAll('[data-action="preview"]').forEach((b) => (b.textContent = open ? 'Voorbeeld verbergen' : 'Voorbeeld tonen'));
  renderPreview();
}

$('preview-close').addEventListener('click', () => setPreview(false));

list.addEventListener('input', (e) => {
  const { li, stop } = stopOf(e.target);
  if (!stop) return;
  const field = e.target.dataset.field;
  if (field) {
    if (e.target.type === 'checkbox') {
      if (e.target.checked) stop[field] = true;
      else delete stop[field];
    } else stop[field] = e.target.value;
    if (field === 'type') {
      renderStops(); // via-punten hebben een korter formulier en tellen niet mee in de nummering
      renderMap();
    } else if (field !== 'text') {
      li.querySelector('.stop-head').outerHTML = headHtml(stop, trip.stops.indexOf(stop));
      if (field === 'type') renderMap();
    }
    setDirty();
  } else if (e.target.dataset.pfield) {
    stop.photos[Number(e.target.closest('.photo').dataset.p)].caption = e.target.value;
    setDirty();
  }
});

list.addEventListener('change', (e) => {
  if (e.target.dataset.action !== 'upload') return;
  const { stop } = stopOf(e.target);
  uploadPhotos(stop, [...e.target.files]);
  e.target.value = '';
});

list.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'INPUT') return;
  const { li, stop } = stopOf(el);
  if (!stop) return;
  const j = el.closest('.photo') ? Number(el.closest('.photo').dataset.p) : -1;

  switch (el.dataset.action) {
    case 'toggle':
      if (selectedId === stop.id) {
        selectedId = null;
        renderStops();
        renderMap();
      } else selectStop(stop.id);
      break;
    case 'preview':
      setPreview(!previewOpen);
      break;
    case 'zoom':
      map.flyTo([stop.lat, stop.lng], 13);
      break;
    case 'wpfind':
      findArticles(li, stop);
      break;
    case 'flickrfind':
      findFlickr(li, stop);
      break;
    case 'flickradd':
      addFlickr(li, stop);
      break;
    case 'flickrall':
      li.querySelectorAll('.flickr-grid input:not(:disabled)').forEach((c) => (c.checked = el.dataset.on === '1'));
      el.dataset.on = el.dataset.on === '1' ? '0' : '1';
      el.textContent = el.dataset.on === '1' ? 'Alles selecteren' : 'Niets selecteren';
      break;
    case 'flickrclose':
      li.querySelector('.flickr-results').hidden = true;
      break;
    case 'wpapply':
      applyArticles(li, stop, el.dataset.mode);
      break;
    case 'wpclose':
      li.querySelector('.wp-results').hidden = true;
      break;
    case 'wpremove':
      stop.articles.splice(Number(el.dataset.a), 1);
      setDirty();
      li.querySelector('.wp-linked').innerHTML = articlesHtml(stop);
      break;
    case 'delete':
      if (!confirm(`Stop "${stop.name}" met ${stop.photos.length} foto('s) verwijderen?`)) return;
      if (stop.photos.some((p) => p.src === trip.cover)) trip.cover = '';
      trip.stops.splice(trip.stops.indexOf(stop), 1);
      selectedId = null;
      setDirty();
      renderAll();
      break;
    case 'pleft':
    case 'pright': {
      const k = j + (el.dataset.action === 'pleft' ? -1 : 1);
      if (k < 0 || k >= stop.photos.length) return;
      [stop.photos[j], stop.photos[k]] = [stop.photos[k], stop.photos[j]];
      setDirty();
      rerenderStop(stop);
      break;
    }
    case 'pcover':
      trip.cover = stop.photos[j].src;
      setDirty();
      rerenderStop(stop);
      renderTripFields();
      break;
    case 'pdel':
      if (trip.cover === stop.photos[j].src) trip.cover = '';
      stop.photos.splice(j, 1);
      setDirty();
      rerenderStop(stop);
      renderTripFields();
      break;
  }
});

// Volgorde wijzigen door te slepen aan ⠿; foto's slepen op het formulier uploadt ze.
let dragId = null;
const clearDropMarks = () => list.querySelectorAll('.drop-before, .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));

list.addEventListener('mousedown', (e) => {
  const li = e.target.closest('.stop');
  if (li) li.draggable = !!e.target.closest('.handle');
});
list.addEventListener('dragstart', (e) => {
  const li = e.target.closest('.stop');
  if (!li?.draggable) return;
  dragId = li.dataset.id;
  li.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragId);
});
list.addEventListener('dragover', (e) => {
  if (e.dataTransfer.types.includes('Files')) {
    const form = e.target.closest('.stop-form');
    if (form) {
      e.preventDefault();
      form.classList.add('dragover');
    }
    return;
  }
  if (!dragId) return;
  e.preventDefault();
  clearDropMarks();
  const li = e.target.closest('.stop');
  if (!li || li.dataset.id === dragId) return;
  const r = li.getBoundingClientRect();
  li.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
});
list.addEventListener('dragleave', (e) => e.target.closest?.('.stop-form')?.classList.remove('dragover'));
list.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer.files.length) {
    const { li, stop } = stopOf(e.target);
    li?.querySelector('.stop-form')?.classList.remove('dragover');
    if (stop) uploadPhotos(stop, [...e.dataTransfer.files]);
    return;
  }
  const target = list.querySelector('.drop-before, .drop-after');
  if (!dragId || !target) return;
  const [moved] = trip.stops.splice(trip.stops.findIndex((s) => s.id === dragId), 1);
  let to = trip.stops.findIndex((s) => s.id === target.dataset.id);
  if (target.classList.contains('drop-after')) to++;
  trip.stops.splice(to, 0, moved);
  setDirty();
});
list.addEventListener('dragend', () => {
  if (!dragId) return;
  dragId = null;
  renderStops();
  renderMap();
});
// Losgelaten bestanden buiten een stop niet door de browser laten openen.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

// ---------- Foto's ----------
async function resizeImage(file, max = 1600, quality = 0.82) {
  const bitmap = await createImageBitmap(file); // houdt rekening met EXIF-rotatie
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('converteren mislukt'))), 'image/webp', quality)
  );
}

async function uploadPhotos(stop, files) {
  const images = files.filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
  if (!images.length) return;
  const failed = [];
  for (const [n, file] of images.entries()) {
    setStatus(`Foto ${n + 1} van ${images.length} verwerken…`);
    try {
      const blob = await resizeImage(file);
      const name = `${stop.id}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}.webp`;
      const { src } = await api(`/trips/${trip.slug}/photos?name=${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/webp' },
        body: blob,
      });
      stop.photos.push({ src, caption: '' });
      if (!trip.cover) trip.cover = src;
    } catch (err) {
      failed.push(`${file.name} (${/heic|heif/i.test(file.name) ? 'HEIC wordt niet ondersteund, exporteer als JPG' : err.message})`);
    }
  }
  setDirty();
  rerenderStop(stop);
  renderTripFields();
  if (failed.length) setStatus(`Niet gelukt: ${failed.join(', ')}`, 'error');
  else setStatus(`${images.length} foto('s) toegevoegd. Vergeet niet op te slaan.`);
}

// ---------- Zoeken & plaatsnamen (OpenStreetMap Nominatim) ----------
async function searchPlaces(q) {
  const res = await fetch(`${NOMINATIM}/search?format=jsonv2&limit=6&accept-language=nl&q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error('Zoeken mislukt');
  return res.json();
}

async function reverseGeocode({ lat, lng }) {
  const res = await fetch(`${NOMINATIM}/reverse?format=jsonv2&zoom=14&accept-language=nl&lat=${lat}&lon=${lng}`);
  if (!res.ok) return null;
  const json = await res.json();
  const a = json.address || {};
  return a.village || a.town || a.city || a.municipality || a.hamlet || json.name || null;
}

$('search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('search').value.trim();
  const box = $('search-results');
  if (!q || !trip) return;
  box.hidden = false;
  box.innerHTML = '<li class="muted">Zoeken…</li>';
  try {
    const results = await searchPlaces(q);
    const label = (r) => r.name || r.display_name.split(',')[0];
    box.innerHTML = results.length
      ? results.map((r, i) => `<li><button type="button" data-i="${i}"><b>${esc(label(r))}</b><small>${esc(r.display_name)}</small></button></li>`).join('')
      : '<li class="muted">Niets gevonden</li>';
    box.onclick = (ev) => {
      const b = ev.target.closest('button[data-i]');
      if (!b) return;
      const r = results[b.dataset.i];
      box.hidden = true;
      $('search').value = '';
      addStop({ name: label(r), lat: Number(r.lat), lng: Number(r.lon) });
    };
  } catch (err) {
    box.innerHTML = `<li class="muted">${esc(err.message)}</li>`;
  }
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#search-results, #search-form')) $('search-results').hidden = true;
});

// ---------- Kaart ----------
const map = createMap('map');
map.setView([50, 5], 5);
const routeLayer = L.layerGroup().addTo(map);
const markerLayer = L.layerGroup().addTo(map);

function renderMap() {
  routeLayer.clearLayers();
  markerLayer.clearLayers();
  if (!trip) return;
  const legs = new Map(trip.legs.map((l) => [l.key, l]));

  const route = trip.stops.filter(onRoute); // fietstochten liggen naast de route
  route.forEach((a, i) => {
    const b = route[i + 1];
    if (!b) return;
    const leg = legs.get(legKey(a, b));
    if (leg?.polyline) {
      L.polyline(decodePolyline(leg.polyline), { color: '#c2410c', weight: leg.flight ? 2.5 : 5, opacity: 0.85, dashArray: leg.flight ? '1 9' : null, lineCap: 'round' })
        .bindTooltip(formatLeg(leg), { sticky: true })
        .addTo(routeLayer);
    } else {
      L.polyline([[a.lat, a.lng], [b.lat, b.lng]], { color: '#66727a', weight: 3, dashArray: '6 8' })
        .bindTooltip('Route wordt berekend bij opslaan', { sticky: true })
        .addTo(routeLayer);
    }
  });

  trip.stops
    .filter((stop) => stop.track)
    .forEach((stop) =>
      L.polyline(decodePolyline(stop.track), { color: stopType(stop.type).color, weight: 4, opacity: 0.85, dashArray: '2 8', lineCap: 'round' })
        .bindTooltip(`${esc(stop.name)}${Number.isFinite(stop.km) ? ` · ${formatKm(stop.km)}` : ''}`, { sticky: true })
        .addTo(routeLayer)
    );

  trip.stops.forEach((stop) => {
    const t = stopType(stop.type);
    const classes = `stop-marker${stop.id === selectedId ? ' active' : ''}${stop.draft ? ' draft' : ''}`;
    const icon = isVia(stop)
      ? L.divIcon({ className: `${classes} via-marker`, html: '<div class="via-dot"></div>', iconSize: [14, 14], iconAnchor: [7, 7] })
      : L.divIcon({
          className: classes,
          html: `<div class="stop-pin" style="--c:${t.color}">${t.icon}<span class="num">${stopNumber(stop)}</span></div>`,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        });
    const marker = L.marker([stop.lat, stop.lng], { draggable: true, title: stop.name, icon }).addTo(markerLayer);
    marker.on('click', () => selectStop(stop.id, { pan: false }));
    marker.on('dragend', () => {
      const ll = marker.getLatLng();
      stop.lat = round(ll.lat);
      stop.lng = round(ll.lng);
      setDirty();
      renderMap();
    });
  });
}

function fitTrip() {
  if (!trip.stops.length) return map.setView([50, 5], 5);
  map.fitBounds(L.latLngBounds(trip.stops.map((s) => [s.lat, s.lng])), { padding: [60, 60], maxZoom: 11 });
}

map.on('click', (e) => {
  if (!trip) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn small primary';
  btn.textContent = '＋ Stop hier toevoegen';
  const popup = L.popup().setLatLng(e.latlng).setContent(btn).openOn(map);
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Plaatsnaam opzoeken…';
    const name = await reverseGeocode(e.latlng).catch(() => null);
    map.closePopup(popup);
    addStop({ name: name || 'Nieuwe stop', lat: e.latlng.lat, lng: e.latlng.lng });
  });
});

// ---------- Opslaan ----------
async function save() {
  if (view === 'home') return saveHome();
  if (!trip || !dirty) return;
  $('save').disabled = true;
  setStatus('Opslaan en route berekenen…');
  try {
    const result = await api(`/trips/${trip.slug}`, jsonBody('PUT', trip));
    trip = result.trip;
    renderAll();
    setDirty(false);
    if (result.warnings.length) setStatus(`Opgeslagen, maar: ${result.warnings.join('; ')}`, 'error');
    else setStatus(`Opgeslagen om ${new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}`, 'ok');
    const option = $('trip-select').querySelector(`option[value="${CSS.escape(trip.slug)}"]`);
    if (option) option.textContent = `${trip.title}${trip.draft ? ' (concept)' : ''}`;
  } catch (err) {
    $('save').disabled = false;
    setStatus(`Opslaan mislukt: ${err.message}`, 'error');
  }
}

$('save').addEventListener('click', save);
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save();
  }
});
window.addEventListener('beforeunload', (e) => {
  if (dirty) e.preventDefault();
});

// ---------- Homepage ----------
const linkList = $('link-list');
const homeImageUrl = (src) => `/content/home/${src}`;

async function switchView(next) {
  if (next === view) return;
  if (dirty && !confirm('Je hebt niet-opgeslagen wijzigingen. Toch wisselen?')) return;
  const discarded = dirty;
  view = next;
  const isHome = view === 'home';
  $('tab-trips').classList.toggle('active', !isHome);
  $('tab-home').classList.toggle('active', isHome);
  $('trip-view').hidden = isHome;
  $('trip-picker').hidden = isHome;
  $('home-view').hidden = !isHome;
  $('map-area').hidden = isHome;
  renderPreview();
  $('home-preview').hidden = !isHome;
  $('view-link').hidden = isHome;
  if (isHome) return openHome();
  if (discarded && trip) await openTrip(trip.slug, { force: true });
  else {
    setDirty(false);
    setStatus('');
  }
  map.invalidateSize();
}

$('tab-trips').addEventListener('click', () => switchView('trips'));
$('tab-home').addEventListener('click', () => switchView('home'));

async function openHome() {
  home = await api('/home');
  renderHome();
  setDirty(false);
  setStatus('Rechts zie je de homepage zoals hij nu is opgeslagen.');
  $('home-preview').src = `/?t=${Date.now()}`;
}

function renderHome() {
  $('h-eyebrow').value = home.eyebrow || '';
  $('h-title').value = home.title || '';
  $('h-subtitle').value = home.subtitle || '';
  $('h-links-title').value = home.linksTitle || '';
  renderLinks();
}

function linkHtml(link, i) {
  return `<li class="link-item" data-i="${i}">
      <div class="link-image">
        ${link.image ? `<img src="${homeImageUrl(link.image)}" alt="" />` : '<span class="hint">Geen afbeelding</span>'}
        <label class="btn small">📷 ${link.image ? 'Wijzigen' : 'Afbeelding'}<input type="file" accept="image/*" data-action="limage" hidden /></label>
        ${link.image ? '<button type="button" class="link" data-action="limgdel">verwijderen</button>' : ''}
      </div>
      <div class="link-fields">
        <label>Titel<input data-lfield="title" value="${esc(link.title)}" /></label>
        <label>Adres (URL)<input type="url" data-lfield="url" value="${esc(link.url)}" placeholder="https://…" /></label>
        <label>Omschrijving<textarea data-lfield="description" rows="2">${esc(link.description)}</textarea></label>
        <div class="link-actions">
          <button type="button" class="btn small" data-action="lup" title="Omhoog">▲</button>
          <button type="button" class="btn small" data-action="ldown" title="Omlaag">▼</button>
          <button type="button" class="btn small danger" data-action="ldel">Verwijderen</button>
        </div>
      </div>
    </li>`;
}

function renderLinks() {
  $('links-empty').hidden = home.links.length > 0;
  linkList.innerHTML = home.links.map(linkHtml).join('');
}

for (const [id, field] of [['h-eyebrow', 'eyebrow'], ['h-title', 'title'], ['h-subtitle', 'subtitle'], ['h-links-title', 'linksTitle']]) {
  $(id).addEventListener('input', (e) => {
    home[field] = e.target.value;
    setDirty();
  });
}

$('add-link').addEventListener('click', () => {
  home.links.push({ title: '', url: '', description: '', image: '' });
  setDirty();
  renderLinks();
  linkList.lastElementChild?.querySelector('[data-lfield="title"]').focus();
});

const linkOf = (el) => home.links[Number(el.closest('.link-item')?.dataset.i)];

linkList.addEventListener('input', (e) => {
  const field = e.target.dataset.lfield;
  if (!field) return;
  linkOf(e.target)[field] = e.target.value;
  setDirty();
});

linkList.addEventListener('change', async (e) => {
  if (e.target.dataset.action !== 'limage' || !e.target.files.length) return;
  const link = linkOf(e.target);
  const file = e.target.files[0];
  setStatus('Afbeelding verwerken…');
  try {
    const blob = await resizeImage(file, 1200);
    const name = `link-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}.webp`;
    const { src } = await api(`/home/images?name=${name}`, { method: 'POST', headers: { 'Content-Type': 'image/webp' }, body: blob });
    link.image = src;
    setDirty();
    renderLinks();
    setStatus('Afbeelding toegevoegd. Vergeet niet op te slaan.');
  } catch (err) {
    setStatus(`Afbeelding niet gelukt: ${/heic|heif/i.test(file.name) ? 'HEIC wordt niet ondersteund, exporteer als JPG' : err.message}`, 'error');
  }
});

linkList.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'INPUT') return;
  const i = Number(el.closest('.link-item').dataset.i);
  const link = home.links[i];
  switch (el.dataset.action) {
    case 'lup':
    case 'ldown': {
      const k = i + (el.dataset.action === 'lup' ? -1 : 1);
      if (k < 0 || k >= home.links.length) return;
      [home.links[i], home.links[k]] = [home.links[k], home.links[i]];
      break;
    }
    case 'limgdel':
      link.image = '';
      break;
    case 'ldel':
      if (!confirm(`Link "${link.title || link.url || 'zonder titel'}" verwijderen?`)) return;
      home.links.splice(i, 1);
      break;
    default:
      return;
  }
  setDirty();
  renderLinks();
});

async function saveHome() {
  if (!home || !dirty) return;
  $('save').disabled = true;
  setStatus('Opslaan…');
  try {
    home = await api('/home', jsonBody('PUT', home));
    renderHome();
    setDirty(false);
    setStatus(`Opgeslagen om ${new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}`, 'ok');
    $('home-preview').src = `/?t=${Date.now()}`;
  } catch (err) {
    $('save').disabled = false;
    setStatus(`Opslaan mislukt: ${err.message}`, 'error');
  }
}

loadTripList().catch((err) => setStatus(`Laden mislukt: ${err.message}`, 'error'));

