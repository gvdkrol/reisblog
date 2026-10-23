// Raster met de openbare Flickr-foto's uit het tijdvak van een reis (knop "Foto's op
// Flickr" op de reispagina). De lijst komt uit flickr.json (scripts/flickr-index.mjs);
// thumbnails en grote foto's worden rechtstreeks van Flickr getoond, niet gedownload.
import { formatRange, escapeHtml } from './format.js';

const PAGE_SIZE = 48;
const monthFmt = new Intl.DateTimeFormat('nl-NL', { month: 'long', year: 'numeric' });
const dateFmt = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });

// URL van een foto in een bepaalde maat: w = 400 px, z = 640 px, b = 1024 px.
export const flickrImg = (p, size) => `https://live.staticflickr.com/${p.server}/${p.id}_${p.secret}_${size}.jpg`;
const img = flickrImg;

// flickr.json (of null) → { user, from, to, photos: [{ id, server, secret, taken, title,
// url, link, caption }] }; url/link/caption zijn wat de lightbox nodig heeft.
export function toFlickrData(raw) {
  return {
    user: raw?.user,
    from: raw?.from,
    to: raw?.to,
    photos: (raw?.photos || []).map(([id, server, secret, taken, photoTitle]) => {
      const p = { id, server, secret, taken, title: photoTitle || '' };
      return {
        ...p,
        url: img(p, 'b'),
        link: `https://www.flickr.com/photos/${raw.user}/${id}/`,
        caption: [p.title, dateFmt.format(new Date(taken.slice(0, 10)))].filter(Boolean).join(' · '),
      };
    }),
  };
}

// Thumbnail (400/640 px) als <img>.
export function flickrThumbHtml(p, sizes) {
  return `<img src="${img(p, 'w')}" srcset="${img(p, 'w')} 400w, ${img(p, 'z')} 640w" sizes="${sizes}" alt="${escapeHtml(p.title)}" loading="lazy" />`;
}

// Foto die (inmiddels) niet openbaar is: slotje in plaats van een kapot plaatje.
export function lockBrokenThumbs(container, itemSelector) {
  container.querySelectorAll(`${itemSelector} img`).forEach((im) =>
    im.addEventListener('error', () => {
      im.closest(itemSelector).classList.add('locked');
      im.replaceWith(Object.assign(document.createElement('span'), { textContent: '🔒 geen toegang' }));
    })
  );
}

// title: naam van de reis; load(): Promise met toFlickrData(...);
// open(photos, index): grote weergave (de lightbox van de reispagina).
export function createFlickrGallery({ title, load, open }) {
  let data; // { user, from, to, photos: [{ id, server, secret, taken, title, url, link, caption }] }
  let page = 0;

  const el = document.createElement('div');
  el.className = 'flickr-overlay';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.hidden = true;
  el.innerHTML = `
    <div class="fg-window">
      <header class="fg-head">
        <div>
          <h2>Foto's op Flickr</h2>
          <div class="fg-sub"></div>
        </div>
        <button class="fg-close" aria-label="Sluiten">×</button>
      </header>
      <div class="fg-body"></div>
      <footer class="fg-foot"></footer>
    </div>`;
  document.body.append(el);
  const body = el.querySelector('.fg-body');
  const foot = el.querySelector('.fg-foot');
  const sub = el.querySelector('.fg-sub');

  const close = () => {
    el.hidden = true;
    document.body.classList.remove('fg-open');
  };
  el.querySelector('.fg-close').addEventListener('click', close);
  el.addEventListener('click', (e) => e.target === el && close());

  // Link naar het Flickr-archief van de maand waarin de reis begon; wie is ingelogd
  // en toegang heeft, ziet daar ook de afgeschermde foto's.
  const archiveUrl = () => {
    const [y, m] = (data?.from || '').split('-');
    const user = data?.user || 'gerhardvandekrol';
    return y ? `https://www.flickr.com/photos/${user}/archives/date-taken/${y}/${m}/` : `https://www.flickr.com/photos/${user}/`;
  };
  const accessHtml = (lead) => `
    <p>${lead} Mogelijk zijn ze alleen zichtbaar voor vrienden en familie: log in op Flickr of vraag Gerhard of Lesley om toegang.</p>
    <p><a href="${archiveUrl()}" target="_blank" rel="noopener">Open het Flickr-archief${data?.from ? ` van ${monthFmt.format(new Date(data.from))}` : ''} ↗</a></p>`;

  function render() {
    const photos = data.photos;
    sub.textContent = `${title} · ${formatRange(data.from, data.to)}${photos.length ? ` · ${photos.length} foto's` : ''}`;
    if (!photos.length) {
      body.innerHTML = `<div class="fg-message"><div class="fg-lock">🔒</div>${accessHtml('Er zijn geen openbare foto\'s van deze reis te zien.')}</div>`;
      foot.innerHTML = '';
      return;
    }
    const pages = Math.ceil(photos.length / PAGE_SIZE);
    page = Math.min(Math.max(page, 0), pages - 1);
    const start = page * PAGE_SIZE;
    const slice = photos.slice(start, start + PAGE_SIZE);
    body.innerHTML = `<div class="fg-grid">${slice
      .map(
        (p, i) => `
        <button class="fg-item" data-i="${start + i}" title="${escapeHtml(p.title)}">
          ${flickrThumbHtml(p, '(max-width: 600px) 50vw, 260px')}
        </button>`
      )
      .join('')}</div>`;
    body.scrollTop = 0;
    lockBrokenThumbs(body, '.fg-item');

    const first = slice[0].taken.slice(0, 10);
    const last = slice.at(-1).taken.slice(0, 10);
    foot.innerHTML = `
      ${pages > 1 ? `
        <div class="fg-pager">
          <button data-page="${page - 1}" ${page === 0 ? 'disabled' : ''}>‹ Vorige</button>
          <span>Pagina ${page + 1} van ${pages} · ${escapeHtml(formatRange(first, last))}</span>
          <button data-page="${page + 1}" ${page === pages - 1 ? 'disabled' : ''}>Volgende ›</button>
        </div>` : ''}
      <p class="fg-note">Je ziet hier de openbare foto's. Meer zien? Log in op Flickr of vraag Gerhard of Lesley om toegang. <a href="${archiveUrl()}" target="_blank" rel="noopener">Naar Flickr ↗</a></p>`;
  }

  body.addEventListener('click', (e) => {
    const item = e.target.closest('.fg-item');
    if (item && !item.classList.contains('locked')) open(data.photos, Number(item.dataset.i));
  });
  foot.addEventListener('click', (e) => {
    const button = e.target.closest('[data-page]');
    if (!button || button.disabled) return;
    page = Number(button.dataset.page);
    render();
  });

  async function show() {
    el.hidden = false;
    document.body.classList.add('fg-open');
    if (data) return render();
    body.innerHTML = '<div class="fg-message">Foto\'s laden…</div>';
    try {
      data = await load();
      render();
    } catch {
      data = null;
      body.innerHTML = `<div class="fg-message"><div class="fg-lock">🔒</div>${accessHtml('De foto\'s konden niet worden geladen.')}</div>`;
    }
  }

  return { open: show, close, isOpen: () => !el.hidden };
}
