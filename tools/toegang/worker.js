// Toegang aanvragen voor rondjewereld.nl (de site zelf staat achter Cloudflare Access).
// /aanvragen          openbaar (Access-bypass): formulier → mail naar de beheerder met knop "Goedkeuren"
// /beheer/goedkeuren  achter Access, alleen OWNER: bevestigen → e-mailadres in de Access-policy "Toegestaan"
// Andere paden komen hier niet langs (zie routes in wrangler.toml); die gaan gewoon naar GitHub Pages.
import { EmailMessage } from "cloudflare:email";

const SITE = "https://rondjewereld.nl";
const FROM = "toegang@rondjewereld.fyi";
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.hostname !== "rondjewereld.nl") return Response.redirect(SITE + url.pathname + url.search, 301);
    try {
      if (url.pathname === "/aanvragen" || url.pathname === "/aanvragen/") {
        if (req.method === "POST") return await submit(req, env);
        return page("Toegang aanvragen", formHTML());
      }
      if (url.pathname === "/beheer/goedkeuren") return await approve(req, env, url);
    } catch (e) {
      return page("Er ging iets mis", `<p>${esc(e.message || e)}</p><p><a href="${esc(req.url)}">Probeer opnieuw</a></p>`, 500);
    }
    return page("Niet gevonden", `<p><a href="${SITE}/">Naar rondjewereld.nl</a></p>`, 404);
  }
};

/* ---------- aanvraag ---------- */
async function submit(req, env) {
  const f = await req.formData();
  const naam = String(f.get("naam") || "").trim().slice(0, 100);
  const email = String(f.get("email") || "").trim().toLowerCase().slice(0, 200);
  const reden = String(f.get("reden") || "").trim().slice(0, 1000);
  // lokveld: echte bezoekers zien het niet; bots vullen het in en krijgen gewoon "verstuurd"
  if (f.get("website")) return page("Aanvraag verstuurd", sentHTML());
  if (!naam || !EMAIL_RE.test(email)) return page("Toegang aanvragen", formHTML("Vul je naam en een geldig e-mailadres in.", { naam, email, reden }), 400);
  const ip = req.headers.get("cf-connecting-ip") || "?";
  const { success } = await env.LIMIT.limit({ key: ip });
  if (!success) return page("Even geduld", `<p>Te veel aanvragen in korte tijd. Probeer het over een minuut opnieuw.</p>`, 429);

  const link = `${SITE}/beheer/goedkeuren?` + new URLSearchParams({ email, naam });
  const html = `<div style="font:15px/1.5 system-ui,sans-serif;color:#1d2627">
<p><b>${esc(naam)}</b> vraagt toegang tot rondjewereld.nl.</p>
<table style="border-collapse:collapse;font-size:14px">
<tr><td style="padding:2px 12px 2px 0;color:#565d5e">E-mail</td><td>${esc(email)}</td></tr>
${reden ? `<tr><td style="padding:2px 12px 2px 0;color:#565d5e;vertical-align:top">Reden</td><td>${esc(reden).replace(/\n/g, "<br>")}</td></tr>` : ""}
<tr><td style="padding:2px 12px 2px 0;color:#565d5e">Land</td><td>${esc(req.cf?.country || "?")}</td></tr>
</table>
<p style="margin:20px 0"><a href="${esc(link)}" style="background:#002528;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Goedkeuren</a></p>
<p style="font-size:12px;color:#565d5e">De knop opent een bevestigingspagina (achter je Access-login). Niet goedkeuren? Dan hoef je niets te doen.</p></div>`;
  await env.MAIL.send(new EmailMessage(FROM, env.OWNER, mime({
    from: `rondjewereld.nl <${FROM}>`, to: env.OWNER, replyTo: email,
    subject: `Toegangsaanvraag rondjewereld.nl: ${naam}`, html
  })));
  return page("Aanvraag verstuurd", sentHTML());
}

/* ---------- goedkeuren ---------- */
async function approve(req, env, url) {
  // Access zet dit kopveld na inloggen; extra controle dat alleen de beheerder hier komt
  const who = (req.headers.get("cf-access-authenticated-user-email") || "").toLowerCase();
  if (who !== env.OWNER.toLowerCase()) return page("Geen toegang", "<p>Alleen de beheerder kan aanvragen goedkeuren.</p>", 403);
  let email, naam;
  if (req.method === "POST") {
    // alleen vanaf de eigen bevestigingspagina
    if (req.headers.get("origin") !== SITE) return page("Geweigerd", "<p>Ongeldige herkomst.</p>", 403);
    const f = await req.formData();
    email = String(f.get("email") || "").trim().toLowerCase(); naam = String(f.get("naam") || "");
  } else {
    email = (url.searchParams.get("email") || "").trim().toLowerCase(); naam = url.searchParams.get("naam") || "";
  }
  if (!EMAIL_RE.test(email)) return page("Ongeldig adres", "<p>Deze link bevat geen geldig e-mailadres.</p>", 400);

  const pol = await getPolicy(env);
  const has = pol.include.some(r => r.email?.email?.toLowerCase() === email);
  // opstelvenster van Gmail, in het account van de beheerder (authuser)
  const invite = "https://mail.google.com/mail/?" + new URLSearchParams({
    authuser: env.OWNER, view: "cm", fs: "1", to: email,
    su: "Toegang tot rondjewereld.nl",
    body: `Hoi ${naam || ""},\n\nJe hebt nu toegang tot rondjewereld.nl: ${SITE}/reizen/\nLog in met dit e-mailadres (${email}); je krijgt dan een code per mail.\n\nGroet,\nGerhard`
  }).toString().replace(/\+/g, "%20");
  const done = `<p><a class="btn" href="${esc(invite)}" target="_blank" rel="noopener">Mail ${esc(naam || email)} dat het gelukt is</a></p>`;

  if (req.method !== "POST") {
    if (has) return page("Al toegestaan", `<p><b>${esc(email)}</b> staat al in de policy “${esc(pol.name)}”.</p>${done}`);
    return page("Toegang goedkeuren", `<p>Wil je <b>${esc(naam || email)}</b> (${esc(email)}) toegang geven tot rondjewereld.nl?</p>
<form method="post"><input type="hidden" name="email" value="${esc(email)}"><input type="hidden" name="naam" value="${esc(naam)}">
<button class="btn" type="submit">Ja, geef toegang</button></form>
<p class="muted">Het adres komt in de Access-policy “${esc(pol.name)}”.</p>`);
  }
  if (!has) {
    pol.include.push({ email: { email } });
    await cf(env, `/access/policies/${pol.id}`, {
      method: "PUT",
      body: JSON.stringify({ name: pol.name, decision: pol.decision, include: pol.include, exclude: pol.exclude || [], require: pol.require || [],
        ...(pol.session_duration ? { session_duration: pol.session_duration } : {}) })
    });
  }
  return page("Toegang gegeven", `<p><b>${esc(email)}</b> kan nu inloggen op rondjewereld.nl.</p>${done}`);
}
async function getPolicy(env) {
  const list = await cf(env, "/access/policies?per_page=100");
  const p = list.find(x => x.name === env.POLICY_NAME);
  if (!p) throw new Error(`Access-policy “${env.POLICY_NAME}” niet gevonden.`);
  return cf(env, `/access/policies/${p.id}`);
}
async function cf(env, path, init = {}) {
  if (!env.CF_API_TOKEN) throw new Error("CF_API_TOKEN ontbreekt (wrangler secret put CF_API_TOKEN).");
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}${path}`, {
    ...init, headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, "Content-Type": "application/json" }
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.success) throw new Error(`Cloudflare-API ${r.status}: ${(j.errors || []).map(e => e.message).join("; ") || "onbekende fout"}`);
  return j.result;
}

/* ---------- mail ---------- */
const b64 = s => { const b = new TextEncoder().encode(s); let t = ""; for (const x of b) t += String.fromCharCode(x); return btoa(t); };
const hdr = s => `=?UTF-8?B?${b64(s)}?=`;
function mime({ from, to, replyTo, subject, html }) {
  return [
    `From: ${from}`, `To: ${to}`, `Reply-To: ${replyTo}`, `Subject: ${hdr(subject)}`,
    `Message-ID: <${crypto.randomUUID()}@rondjewereld.fyi>`, `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0", "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "",
    b64(html).replace(/.{76}/g, "$&\r\n")
  ].join("\r\n");
}

/* ---------- pagina's ---------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LEAD = `Op rondjewereld.nl staan onze reizen: kaarten, routes, foto's en verhalen van onderweg. De site is alleen toegankelijk voor familie en vrienden. Vraag hier toegang aan; je hoort het per mail als het is goedgekeurd.`;
function formHTML(err = "", v = {}) {
  return `${err ? `<p class="err">${esc(err)}</p>` : ""}
<form method="post" action="/aanvragen">
  <label><span>Naam</span><input name="naam" required maxlength="100" autocomplete="name" value="${esc(v.naam)}"></label>
  <label><span>E-mailadres</span><input name="email" type="email" required maxlength="200" autocomplete="email" value="${esc(v.email)}"></label>
  <label><span>Waarom wil je toegang? <i>(optioneel)</i></span><textarea name="reden" rows="3" maxlength="1000">${esc(v.reden)}</textarea></label>
  <label class="hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
  <button class="btn" type="submit"><b>B2</b><span>Ticket aanvragen</span><em>→</em></button>
</form>
<p class="muted">Je gegevens worden alleen gebruikt om je aanvraag te beoordelen.</p>`;
}
const sentHTML = () => `<p>Bedankt! Je aanvraag is verstuurd.</p>
<p>Na goedkeuring krijg je een mail. Daarna ga je naar <a href="${SITE}/reizen/">rondjewereld.nl/reizen</a> en log je in met je e-mailadres; de code krijg je per mail.</p>
<p><a class="btn" href="${SITE}/"><b>←</b><span>Terug naar de vertrekhal</span></a></p>`;

// Klapletters zoals op het vertrekbord van de welkomspagina (statisch).
const flap = (text) => `<div class="flap" aria-hidden="true">${[...text.toUpperCase()].map(c => `<b>${c === " " ? "&nbsp;" : esc(c)}</b>`).join("")}</div>`;
// Wat er op het bordje boven de kop staat, per pagina.
const FLAPS = { "Toegang aanvragen": "Balie open", "Aanvraag verstuurd": "Verstuurd", "Even geduld": "Even wachten", "Toegang goedkeuren": "Goedkeuren", "Toegang gegeven": "Ingecheckt", "Al toegestaan": "Ingecheckt", "Niet gevonden": "Gate onbekend" };

// Opmaak in de stijl van de welkomspagina (het vertrekbord): donker, geel, Barlow Condensed.
function page(title, body, status = 200) {
  const lead = title === "Toegang aanvragen" ? `<p class="lead">${LEAD}</p>` : "";
  return new Response(`<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · rondjewereld.nl</title>
<link rel="icon" type="image/png" href="${SITE}/welkom/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800&family=Chivo+Mono:wght@500;700&display=swap" rel="stylesheet">
<style>
:root{--sign:#ffcc00;--sign-ink:#121212;--tile:#1d1f21;--paper:#f4f1ea;--ink:#1b1b1b;--grey:#8a8576;--warn:#b42318;--cond:"Barlow Condensed","Arial Narrow",sans-serif;--mono:"Chivo Mono",ui-monospace,monospace;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:#08090a;color:#fff;font:500 17px/1.4 var(--cond);padding:clamp(14px,3vw,28px) clamp(14px,3vw,44px)}
a{color:inherit}
.signs{display:flex;gap:8px;flex-wrap:wrap}
.sign{display:inline-flex;align-items:center;gap:10px;background:var(--sign);color:var(--sign-ink);padding:6px 14px 6px 8px;font:700 1.05rem var(--cond);text-transform:uppercase;letter-spacing:.02em;text-decoration:none}
.sign i{display:grid;place-items:center;width:28px;height:28px;background:var(--sign-ink);color:var(--sign);font-style:normal}
.sign.dark{background:#232527;color:#fff}.sign.dark i{background:#fff;color:#232527}
.stage{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:clamp(24px,5vw,80px);align-items:start;max-width:1180px;margin:clamp(28px,7vh,80px) auto 0}
.flap{display:inline-flex;gap:2px;margin-bottom:18px}
.flap b{position:relative;display:inline-grid;place-items:center;width:.82em;height:1.25em;background:var(--tile);color:#f2efe6;font:700 clamp(15px,1.5vw,20px) var(--mono);border-radius:2px}
.flap b::after{content:"";position:absolute;left:0;right:0;top:50%;height:1px;background:rgba(0,0,0,.75)}
h1{margin:0;font:800 clamp(2.6rem,5.5vw,4.6rem)/.9 var(--cond);text-transform:uppercase;letter-spacing:-.01em}
h1 em{font-style:normal;color:var(--sign)}
.lead{font:500 clamp(1.1rem,1.5vw,1.3rem)/1.35 var(--cond);color:rgba(255,255,255,.8);max-width:38ch;margin:18px 0 0}
.home{display:inline-block;margin-top:26px;font:700 1rem var(--cond);letter-spacing:.12em;text-transform:uppercase;color:var(--sign);text-decoration:none}
.home:hover{text-decoration:underline}
/* de ticketkaart */
.ticket{background:var(--paper);color:var(--ink);border-radius:10px;overflow:hidden;box-shadow:0 30px 70px -20px rgba(0,0,0,.9)}
.ticket-main{padding:22px 26px 20px}
.ticket h2{margin:0 0 14px;font:800 1rem var(--cond);letter-spacing:.16em;text-transform:uppercase;color:var(--grey)}
.ticket p{margin:0 0 12px;font-size:1.1rem}
.ticket a{color:var(--ink)}
form{display:flex;flex-direction:column;gap:16px;margin:4px 0 14px}
label{display:flex;flex-direction:column;gap:4px}
label span{font:700 .78rem var(--cond);letter-spacing:.16em;text-transform:uppercase;color:var(--grey)}
label i{font-style:normal;letter-spacing:.04em;text-transform:none}
input,textarea{font:600 1.25rem var(--cond);color:var(--ink);background:transparent;border:0;border-bottom:2px solid #c9c3b4;border-radius:0;padding:4px 0 6px}
textarea{resize:vertical;font-weight:500;font-size:1.1rem}
input:focus,textarea:focus{outline:none;border-bottom-color:var(--sign-ink)}
.btn{display:inline-grid;grid-template-columns:auto 1fr auto;align-items:center;gap:14px;align-self:flex-start;min-width:260px;background:var(--sign);color:var(--sign-ink);border:0;padding:10px 16px;font:700 1.25rem var(--cond);text-transform:uppercase;text-decoration:none;cursor:pointer;transition:transform .15s}
.btn:hover{transform:translateX(4px)}
.btn b{font:800 1.9rem/1 var(--cond)}.btn em{font-style:normal;font-size:1.5rem}
.btn:not(:has(b)){display:inline-block;min-width:0}
.muted{color:var(--grey);font-size:.95rem!important;margin:0!important}
.err{color:var(--warn);font-weight:700}
.hp{position:absolute;left:-9999px}
.stub{position:relative;display:flex;align-items:center;justify-content:space-between;gap:16px;border-top:2px dashed #c9c3b4;padding:14px 26px}
.stub::before,.stub::after{content:"";position:absolute;top:-11px;width:20px;height:20px;border-radius:50%;background:#08090a}
.stub::before{left:-10px}.stub::after{right:-10px}
.stub small{font:700 .72rem var(--cond);letter-spacing:.14em;text-transform:uppercase;color:var(--grey)}
.stub strong{font:800 1.5rem var(--cond)}
.barcode{flex:1;height:38px;background:repeating-linear-gradient(90deg,#1b1b1b 0 2px,transparent 2px 4px,#1b1b1b 4px 5px,transparent 5px 8px,#1b1b1b 8px 11px,transparent 11px 12px)}
@media (max-width:820px){.stage{grid-template-columns:1fr}}
</style></head><body>
<nav class="signs" aria-label="Snel naar"><a class="sign dark" href="${SITE}/"><i>←</i>Vertrekhal</a><a class="sign" href="${SITE}/reizen/"><i>✈</i>Vertrek · Reizen</a></nav>
<main class="stage">
  <div>${flap(FLAPS[title] || "Balie")}<h1>${esc(title)}</h1>${lead}<a class="home" href="${SITE}/">← rondjewereld.nl</a></div>
  <section class="ticket"><div class="ticket-main"><h2>Ticketbalie · rondjewereld.nl</h2>${body}</div>
  <div class="stub" aria-hidden="true"><div><small>Passagier</small><br><strong>Jij</strong></div><div class="barcode"></div><div><small>Gate</small><br><strong>A1</strong></div></div></section>
</main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}
