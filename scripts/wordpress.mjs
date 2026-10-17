// Haalt berichten van rondjewereld.nl op via de publieke WordPress.com-API,
// zodat de editor de tekst van een blogbericht kan overnemen in een stop.

import TurndownService from 'turndown';

const API = 'https://public-api.wordpress.com/wp/v2/sites/rondjewereld.nl/posts';
const DAY = 86400000;

const turndown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', emDelimiter: '*' });
// Afbeeldingen, embeds en scripts niet overnemen: alleen de tekst.
// (addRule gaat vóór de ingebouwde regels; remove() alleen wint niet van de afbeeldingsregel.)
turndown.addRule('alleen-tekst', {
  filter: ['img', 'figure', 'iframe', 'script', 'style', 'noscript', 'video', 'audio'],
  replacement: () => '',
});

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

const plainText = (html) => decodeEntities(String(html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

function toMarkdown(html) {
  return turndown
    .turndown(String(html || ''))
    // Plugin-codes zoals {flickr photo=123} en WordPress-shortcodes zoals [gallery ids="1,2"]
    // (turndown schrijft die laatste als \[gallery …\]).
    .replace(/\{[a-z][\w-]*(\s[^{}]*)?\}/gi, '')
    .replace(/\\\[\/?(gallery|caption|embed|video|audio|playlist|flickr\w*)\b[^\]]*?\\\]/gi, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Berichten gepubliceerd tussen `date - days` en `date + days` (inclusief), oudste eerst.
export async function postsAround(date, days = 5) {
  const center = Date.parse(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || Number.isNaN(center)) {
    throw Object.assign(new Error('Geef de stop eerst een geldige datum'), { status: 400 });
  }
  const day = (offset) => new Date(center + offset * DAY).toISOString().slice(0, 10);
  const params = new URLSearchParams({
    after: `${day(-days)}T00:00:00`,
    before: `${day(days + 1)}T00:00:00`,
    per_page: '50',
    order: 'asc',
    orderby: 'date',
    _fields: 'id,date,link,title,excerpt,content',
  });

  const res = await fetch(`${API}?${params}`);
  if (!res.ok) throw Object.assign(new Error(`rondjewereld.nl gaf een fout (${res.status})`), { status: 502 });
  const posts = await res.json();

  return posts.map((p) => {
    const markdown = toMarkdown(p.content?.rendered);
    return {
      id: p.id,
      date: p.date.slice(0, 10),
      title: plainText(p.title?.rendered) || '(zonder titel)',
      url: p.link,
      excerpt: plainText(p.excerpt?.rendered).replace(/\s*\[…\]$/, '…').slice(0, 220),
      markdown,
      words: markdown.split(/\s+/).filter(Boolean).length,
    };
  });
}
