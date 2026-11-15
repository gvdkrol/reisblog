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
  const invite = `mailto:${encodeURIComponent(email)}?` + new URLSearchParams({
    subject: "Toegang tot rondjewereld.nl",
    body: `Hoi ${naam || ""},\n\nJe hebt nu toegang tot rondjewereld.nl: ${SITE}\nLog in met dit e-mailadres (${email}); je krijgt dan een code per mail.\n\nGroet,\nGerhard`
  }).toString().replace(/\+/g, "%20");
  const done = `<p><a class="btn" href="${esc(invite)}">Mail ${esc(naam || email)} dat het gelukt is</a></p>`;

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
function formHTML(err = "", v = {}) {
  return `<p>Op rondjewereld.nl staan onze reizen: kaarten, routes, foto's en verhalen van onderweg. De site is alleen toegankelijk voor familie en vrienden. Vraag hieronder toegang aan; je hoort het per mail als het is goedgekeurd.</p>
${err ? `<p class="err">${esc(err)}</p>` : ""}
<form method="post" action="/aanvragen">
  <label>Naam<input name="naam" required maxlength="100" autocomplete="name" value="${esc(v.naam)}"></label>
  <label>E-mailadres<input name="email" type="email" required maxlength="200" autocomplete="email" value="${esc(v.email)}"></label>
  <label>Waarom wil je toegang? <span class="muted">(optioneel)</span><textarea name="reden" rows="3" maxlength="1000">${esc(v.reden)}</textarea></label>
  <label class="hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
  <button class="btn" type="submit">Verstuur aanvraag</button>
</form>
<p class="muted">Je gegevens worden alleen gebruikt om je aanvraag te beoordelen.</p>`;
}
const sentHTML = () => `<p>Bedankt! Je aanvraag is verstuurd. Na goedkeuring krijg je een mail; daarna log je op <a href="${SITE}">rondjewereld.nl</a> in met je e-mailadres.</p>`;
function page(title, body, status = 200) {
  return new Response(`<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · rondjewereld.nl</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=PT+Serif:wght@700&family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#f3f1ee;--surface:#fff;--ink:#1d2627;--muted:#565d5e;--line:#e2dedb;--accent:#002528;--on-accent:#fff;--link:#7e5f6a;--warn:#b42318;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#101617;--surface:#182022;--ink:#e6eaea;--muted:#9aa3a4;--line:#2a3436;--accent:#8fc1bd;--on-accent:#0b1213;--link:#d3b3bf;--warn:#ff7b6e;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#101617;--surface:#182022;--ink:#e6eaea;--muted:#9aa3a4;--line:#2a3436;--accent:#8fc1bd;--on-accent:#0b1213;--link:#d3b3bf;--warn:#ff7b6e;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 "Source Sans 3",system-ui,sans-serif;padding:32px 16px}
main{max-width:500px;margin:0 auto;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:22px 24px}
h1{font:700 22px/1.25 "PT Serif",Georgia,serif;margin:0 0 6px}
.logo{font-weight:700;font-size:14px;color:var(--muted);margin-bottom:14px;text-decoration:none;display:inline-block}
a{color:var(--link)}form{display:flex;flex-direction:column;gap:12px;margin:14px 0}
label{display:flex;flex-direction:column;gap:4px;font-size:14px;font-weight:600}
input,textarea{font:inherit;font-weight:400;color:inherit;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px 10px}
input:focus,textarea:focus{outline:2px solid var(--accent);outline-offset:1px}
.btn{display:inline-block;align-self:flex-start;background:var(--accent);color:var(--on-accent);border:0;border-radius:8px;padding:9px 16px;font:600 16px "Source Sans 3",system-ui,sans-serif;cursor:pointer;text-decoration:none}
.muted{color:var(--muted);font-size:13.5px;font-weight:400}.err{color:var(--warn);font-weight:600}
.hp{position:absolute;left:-9999px}
</style></head><body><main><span class="logo">rondjewereld.nl</span><h1>${esc(title)}</h1>${body}</main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}
