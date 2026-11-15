// Haalt notities uit Notion op, zodat de editor de tekst van een pagina in het
// verhaal van een stop kan zetten. Gebruikt de Notion-API met een eigen
// integratie-token uit reisblog/.env.local (niet in git):
//
//   NOTION_TOKEN=ntn_…
//
// De integratie moet in Notion toegang hebben tot de database "Notes" (••• →
// Connections). Getoond worden de notities met Area = "Rondjewereld.nl"; een andere
// database of Area kan met NOTION_NOTES_DB en NOTION_AREA (id's uit de Notion-URL).

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const API = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';
const NOTES_DB = '54154066fdd94ee2b95b43d5ef11e994'; // database "Notes"
const AREA = '41939104b0348085aaacf61a2cd01b92'; // pagina "Rondjewereld.nl" in "Areas"
const ID = /^[0-9a-f]{32}$/;

const fail = (status, message) => Object.assign(new Error(message), { status });
const cleanId = (id) => String(id || '').replace(/-/g, '').toLowerCase();

function config(root) {
  const file = join(root, '.env.local');
  const env = {};
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  const get = (name) => env[name] || process.env[name];
  const token = get('NOTION_TOKEN');
  if (!token) throw fail(400, 'Geen Notion-token: zet NOTION_TOKEN=… in reisblog/.env.local');
  return { token, db: cleanId(get('NOTION_NOTES_DB') || NOTES_DB), area: cleanId(get('NOTION_AREA') || AREA) };
}

async function call(token, path, body) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': VERSION, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    throw fail(502, `Geen verbinding met Notion (${err.cause?.code || err.message})`);
  }
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) throw fail(502, 'Notion weigert het token: controleer NOTION_TOKEN in .env.local');
  if (res.status === 404) throw fail(502, 'Notion kan de database of pagina niet vinden: geef de integratie toegang via ••• → Connections');
  if (!res.ok) throw fail(502, `Notion: ${json.message || res.status}`);
  return json;
}

const plain = (rich) => (rich || []).map((r) => r.plain_text).join('');

// Notities in de Area, nieuwste eerst: [{ id, title, date, edited }]
export async function notionPages(root) {
  const { token, db, area } = config(root);
  const pages = [];
  for (let cursor; ; ) {
    const json = await call(token, `/databases/${db}/query`, {
      filter: { property: 'Area', relation: { contains: area } },
      sorts: [{ timestamp: 'created_time', direction: 'descending' }],
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    for (const p of json.results) {
      const props = p.properties || {};
      if (p.archived || p.in_trash || props.Archive?.checkbox) continue;
      const title = Object.values(props).find((v) => v.type === 'title');
      pages.push({
        id: cleanId(p.id),
        title: plain(title?.title).trim() || 'Naamloos',
        date: (props.Date?.date?.start || p.created_time || '').slice(0, 10),
        edited: p.last_edited_time || '',
      });
    }
    if (!json.has_more) break;
    cursor = json.next_cursor;
  }
  return pages;
}

// Opgemaakte tekst naar de notatie van het verhaal: **vet** en *schuin*.
function richText(rich) {
  return (rich || [])
    .map((r) => {
      const a = r.annotations || {};
      const mark = a.bold ? '**' : a.italic ? '*' : '';
      if (!mark) return r.plain_text;
      // de sterretjes strak om de woorden: spaties en regeleinden blijven erbuiten
      return r.plain_text.replace(/^(\s*)([\s\S]*?)(\s*)$/, (_, pre, mid, post) => (mid ? `${pre}${mark}${mid}${mark}${post}` : pre + post));
    })
    .join('');
}

async function blocksOf(token, id) {
  const blocks = [];
  for (let cursor; ; ) {
    const json = await call(token, `/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
    blocks.push(...json.results);
    if (!json.has_more) break;
    cursor = json.next_cursor;
  }
  return blocks;
}

const LIST = { bulleted_list_item: '- ', numbered_list_item: '', to_do: '- ' };

// Blokken naar alinea's; lijstregels blijven bij elkaar in één alinea.
async function paragraphs(token, id, depth = 0) {
  const out = [];
  let number = 0;
  let inList = false;
  for (const b of await blocksOf(token, id)) {
    const data = b[b.type] || {};
    const text = richText(data.rich_text).trim();
    const isList = b.type in LIST;
    number = b.type === 'numbered_list_item' ? number + 1 : 0;

    if (isList && text) {
      const line = `${b.type === 'numbered_list_item' ? `${number}. ` : LIST[b.type]}${text}`;
      if (inList) out[out.length - 1] += `\n${line}`;
      else out.push(line);
    } else if (/^heading_[123]$/.test(b.type) && text) {
      out.push(`**${text.replace(/\*\*/g, '')}**`);
    } else if (text) {
      out.push(text);
    }
    inList = isList && !!text;

    // geneste blokken (inspringing, uitklapper, kolommen), geen subpagina's of databases
    if (b.has_children && depth < 4 && b.type !== 'child_page' && b.type !== 'child_database') {
      const inner = await paragraphs(token, b.id, depth + 1);
      if (inner.length && inList) out[out.length - 1] += `\n${inner.join('\n')}`;
      else out.push(...inner);
    }
  }
  return out;
}

// Tekst van één pagina: { id, title, text }
export async function notionPageText(root, pageId) {
  const { token } = config(root);
  const id = cleanId(pageId);
  if (!ID.test(id)) throw fail(400, 'Ongeldige Notion-pagina');
  const page = await call(token, `/pages/${id}`);
  const title = Object.values(page.properties || {}).find((v) => v.type === 'title');
  return { id, title: plain(title?.title).trim(), text: (await paragraphs(token, id)).join('\n\n') };
}
