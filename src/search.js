// Zoeken in alle verhalen: gedeelde hulpfuncties voor de zoekindex (scripts/trips-data.mjs),
// het zoekveld op de homepage (src/home-search.js) en het uitlichten op de reispagina.

// Kop van een blogbericht binnen een stoptekst: "**titel** · datum".
const POST_HEAD = /^\*\*([^*\n]+)\*\*\s*·\s*(.*)$/;

// Stoptekst → [{ title, text }]: eerst de eigen notities boven het eerste bericht
// (title ''), daarna elk blogbericht. De plek in de lijst is het "item" in de zoeklink.
// Alinea's met een Flickr-link doen niet mee: die toont het zijpaneel ook niet.
export function splitPosts(text) {
  const posts = [{ title: '', lines: [] }];
  const shown = String(text || '')
    .split(/\n{2,}/)
    .filter((para) => !/flickr\.com/i.test(para))
    .join('\n\n');
  for (const line of shown.split('\n')) {
    const head = POST_HEAD.exec(line.trim());
    if (head) posts.push({ title: [head[1].trim(), head[2].trim()].filter(Boolean).join(' · '), lines: [] });
    else posts.at(-1).lines.push(line);
  }
  return posts.map((p) => ({ title: p.title, text: plainText(p.lines.join('\n')) }));
}

// Markdown/HTML → platte tekst op één regel.
function plainText(md) {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#+\s*/gm, '')
    .replace(/\*+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Kleine letters zonder accenten, even lang als het origineel (posities blijven kloppen).
export function fold(s) {
  s = String(s ?? '');
  if (!/[^\x00-\x7f]/.test(s)) return s.toLowerCase();
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    out += c.charCodeAt(0) < 128 ? c.toLowerCase() : c.normalize('NFD')[0].toLowerCase()[0] || c;
  }
  return out;
}

// Zoekvraag → losse woorden (gevouwen); alle woorden moeten voorkomen.
export function queryTerms(query) {
  return [...new Set(fold(query).split(/\s+/).filter(Boolean))];
}

// Plekken [van, tot) van de woorden in een gevouwen tekst, gesorteerd en samengevoegd.
export function findRanges(folded, terms) {
  const ranges = [];
  for (const term of terms) {
    for (let at = folded.indexOf(term); at >= 0; at = folded.indexOf(term, at + term.length)) ranges.push([at, at + term.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    const last = merged.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}

// Zet <mark class="hit"> om de zoekwoorden in alle tekst binnen `root`.
export function highlightIn(root, terms) {
  if (!root || !terms.length) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const text = node.nodeValue;
    const ranges = findRanges(fold(text), terms);
    if (!ranges.length) continue;
    const frag = document.createDocumentFragment();
    let pos = 0;
    for (const [from, to] of ranges) {
      frag.append(text.slice(pos, from));
      const mark = document.createElement('mark');
      mark.className = 'hit';
      mark.textContent = text.slice(from, to);
      frag.append(mark);
      pos = to;
    }
    frag.append(text.slice(pos));
    node.replaceWith(frag);
  }
}

// De koppen van de blogberichten in een weergegeven verhaal (<p><strong>titel</strong> · datum</p>),
// in dezelfde volgorde als splitPosts: bericht n is postHeadings(story)[n - 1].
export function postHeadings(story) {
  return [...(story?.children || [])].filter(
    (el) => el.tagName === 'P' && el.firstChild?.nodeName === 'STRONG' && /^\s*·/.test(el.firstChild.nextSibling?.textContent || '')
  );
}
