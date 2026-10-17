// Inhoud van het zijpaneel voor één stop. Gedeeld door de reispagina en het
// voorbeeld in de editor, zodat die er precies hetzelfde uitzien.
import { marked } from 'marked';
import { stopType } from './map.js';
import { formatDate, formatLeg, escapeHtml } from './format.js';

// photoUrl(src) → URL van een foto; day = dagnummer; leg/prevStop = traject vanaf de vorige stop.
export function stopPanelHtml(stop, { photoUrl, day, leg, prevStop }) {
  const t = stopType(stop.type);
  const photos = stop.photos || [];
  const articles = stop.articles || [];

  return `
    ${photos.length ? `<img class="panel-hero" src="${photoUrl(photos[0].src)}" alt="${escapeHtml(photos[0].caption)}" />` : ''}
    ${photos.length > 1 ? `<div class="panel-thumbs">${photos.map((p, j) => `<img data-i="${j}" class="${j === 0 ? 'current' : ''}" src="${photoUrl(p.src)}" alt="${escapeHtml(p.caption)}" loading="lazy" />`).join('')}</div>` : ''}
    ${photos.length ? `<div class="caption">${escapeHtml(photos[0].caption || '')}</div>` : ''}
    <div class="panel-body">
      <div class="meta">
        ${day ? `<span>Dag ${day}</span><span>·</span>` : ''}
        ${stop.date ? `<span>${formatDate(stop.date)}</span>` : ''}
        <span class="type-chip" style="--c:${t.color}">${t.icon} ${t.label}</span>
        ${stop.draft ? '<span class="draft-chip">concept · niet gepubliceerd</span>' : ''}
      </div>
      <h2>${escapeHtml(stop.name)}</h2>
      ${leg?.polyline && prevStop ? `<div class="leg-info">🛣️ ${formatLeg(leg)} vanaf ${escapeHtml(prevStop.name)}</div>` : ''}
      <div class="story">${marked.parse(stop.text || '')}</div>
      ${articles.length ? `
        <div class="articles">
          <h4>Lees meer op rondjewereld.nl</h4>
          ${articles
            .map(
              (a) => `<a class="article-link" href="${escapeHtml(a.url)}" target="_blank" rel="noopener">
                <span>${escapeHtml(a.title)}</span>
                <small>${a.date ? formatDate(a.date) : 'rondjewereld.nl'} ↗</small>
              </a>`
            )
            .join('')}
        </div>` : ''}
    </div>
  `;
}

// Thumbnails wisselen de hoofdfoto; een klik op de hoofdfoto roept onOpen(index) aan.
export function bindPanelPhotos(container, photos, { onOpen } = {}) {
  const hero = container.querySelector('.panel-hero');
  const caption = container.querySelector('.caption');
  let index = 0;
  if (hero && onOpen) hero.addEventListener('click', () => onOpen(index));
  container.querySelectorAll('.panel-thumbs img').forEach((img) =>
    img.addEventListener('click', () => {
      index = Number(img.dataset.i);
      hero.src = img.src;
      if (caption) caption.textContent = photos[index].caption || '';
      container.querySelectorAll('.panel-thumbs img').forEach((x) => x.classList.toggle('current', x === img));
    })
  );
}
