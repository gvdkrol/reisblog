// Bedieningsapp voor het reisblog: dev-omgeving starten/stoppen, links naar de site en
// de editor, en wijzigingen committen en pushen. Draait alleen lokaal op 127.0.0.1.
//
// Starten: dubbelklik op Reisblog.cmd (of `npm run launcher`) en open http://localhost:5170

import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = 5170;
const DEV_PORT = 5173;
const DEV_URL = `http://localhost:${DEV_PORT}`;
const LIVE_URL = 'https://gvdkrol.github.io/reisblog/';
const REPO_URL = 'https://github.com/gvdkrol/reisblog';
const GH = ['C:\\Program Files\\GitHub CLI\\gh.exe', 'gh'].find((p) => p === 'gh' || existsSync(p));
const PAGE = readFileSync(new URL('./launcher.html', import.meta.url), 'utf8');

// ---------- logboek ----------
const log = [];
function addLog(line) {
  for (const l of String(line).split(/\r?\n/)) {
    if (!l.trim()) continue;
    log.push(`${new Date().toLocaleTimeString('nl-NL')}  ${l.replace(/\x1b\[[0-9;]*m/g, '')}`);
  }
  if (log.length > 400) log.splice(0, log.length - 400);
}

// ---------- hulpfuncties ----------
function run(cmd, args, { timeout = 120000 } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: ROOT, timeout, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err?.code ?? 0, out: `${stdout || ''}${stderr || ''}`.trim() });
    });
  });
}

function runShell(command, { timeout = 300000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd: ROOT, shell: true, windowsHide: true });
    let out = '';
    const onData = (d) => {
      out += d;
      addLog(d);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => child.kill(), timeout);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, out });
    });
  });
}

async function devRunning() {
  try {
    const res = await fetch(`${DEV_URL}/`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

// PID's die op de dev-poort luisteren (ook als de server buiten deze app is gestart)
async function pidsOnPort(port) {
  const { out } = await run('netstat', ['-ano', '-p', 'tcp']);
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    const m = line.trim().split(/\s+/);
    if (m[1]?.endsWith(`:${port}`) && /LISTEN/i.test(m[3] || '')) pids.add(m[4]);
  }
  return [...pids].filter((p) => p && p !== '0');
}

// ---------- dev-server ----------
let devProcess = null;

async function startDev() {
  if (await devRunning()) return { ok: true, message: 'De dev-omgeving draaide al.' };
  addLog('Dev-omgeving starten…');
  devProcess = spawn(`npm run dev -- --port ${DEV_PORT} --strictPort`, { cwd: ROOT, shell: true, windowsHide: true });
  devProcess.stdout.on('data', addLog);
  devProcess.stderr.on('data', addLog);
  devProcess.on('close', (code) => {
    addLog(`Dev-omgeving gestopt (code ${code}).`);
    devProcess = null;
  });
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await devRunning()) {
      refreshFlickr();
      return { ok: true, message: 'Dev-omgeving gestart; Flickr-lijsten worden op de achtergrond ververst.' };
    }
  }
  return { ok: false, message: 'De dev-omgeving start niet; kijk in het logboek.' };
}

// Flickr-lijsten per reis (flickr.json, voor de knop "Foto's op Flickr") verversen.
// Op de achtergrond, zodat de dev-omgeving meteen bruikbaar is; de dev-server pikt de
// nieuwe bestanden zelf op. Mislukt dit (geen sleutel of verbinding), dan blijven de
// oude lijsten staan.
let flickrRunning = false;
async function refreshFlickr() {
  if (flickrRunning) return;
  flickrRunning = true;
  addLog('Flickr-lijsten verversen (npm run flickr)…');
  const result = await runShell('npm run flickr', { timeout: 600000 });
  addLog(result.ok ? 'Flickr-lijsten bijgewerkt.' : 'Flickr-lijsten verversen mislukt; de oude lijsten blijven staan.');
  flickrRunning = false;
}

async function stopDev() {
  const pids = new Set(await pidsOnPort(DEV_PORT));
  if (devProcess?.pid) pids.add(String(devProcess.pid));
  if (!pids.size) return { ok: true, message: 'De dev-omgeving draaide niet.' };
  for (const pid of pids) await run('taskkill', ['/PID', pid, '/T', '/F']);
  devProcess = null;
  addLog('Dev-omgeving gestopt.');
  return { ok: true, message: 'Dev-omgeving gestopt.' };
}

// ---------- git ----------
async function gitStatus() {
  const [status, last, ahead] = await Promise.all([
    run('git', ['status', '--porcelain=v1', '--untracked-files=all']),
    run('git', ['log', '-1', '--date=format:%d-%m-%Y %H:%M', '--format=%h|%s|%cd']),
    run('git', ['rev-list', '--count', '@{u}..HEAD']),
  ]);
  const files = status.out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => ({ state: l.slice(0, 2).trim(), path: l.slice(3).replace(/^"|"$/g, '') }));

  // samenvatten per reis
  const groups = new Map();
  for (const f of files) {
    const m = /^content\/trips\/([^/]+)\//.exec(f.path);
    const key = m ? `Reis: ${m[1]}` : f.path.startsWith('content/home/') ? 'Homepage' : 'Code en overige bestanden';
    const g = groups.get(key) || { name: key, photos: 0, files: 0, deleted: 0 };
    if (f.state.includes('D')) g.deleted++;
    else if (/\/photos\//.test(f.path)) g.photos++;
    else g.files++;
    groups.set(key, g);
  }
  const [hash, subject, when] = last.out.split('|');
  return {
    changes: files.length,
    groups: [...groups.values()],
    last: { hash, subject, when },
    unpushed: Number(ahead.out) || 0,
  };
}

async function commitAndPush(message) {
  const msg = String(message || '').trim();
  if (!msg) return { ok: false, message: 'Vul eerst een omschrijving in.' };
  addLog('— Commit en push —');

  addLog('Controleren of de site goed bouwt…');
  const build = await runShell('npm run build');
  if (!build.ok) return { ok: false, message: 'De build is mislukt; er is niets gecommit. Kijk in het logboek.' };

  const status = await gitStatus();
  if (status.changes) {
    await run('git', ['add', '-A']);
    const staged = await run('git', ['diff', '--cached', '--name-only']);
    if (/(^|\/)\.env/m.test(staged.out)) {
      await run('git', ['reset']);
      return { ok: false, message: 'Er stond een .env-bestand klaar om te committen; afgebroken (geheime sleutel).' };
    }
    const commit = await run('git', ['commit', '-m', msg]);
    addLog(commit.out);
    if (!commit.ok) return { ok: false, message: 'Committen mislukt; kijk in het logboek.' };
  } else if (!status.unpushed) {
    return { ok: true, message: 'Er was niets te committen of te pushen.' };
  }

  addLog('Pushen naar GitHub…');
  const push = await run('git', ['push'], { timeout: 600000 });
  addLog(push.out);
  if (!push.ok) return { ok: false, message: 'Pushen mislukt; kijk in het logboek.' };
  return { ok: true, message: 'Gecommit en gepusht. GitHub publiceert de site nu (± 1 minuut).' };
}

async function deployStatus() {
  const r = await run(GH, ['run', 'list', '--limit', '1', '--json', 'status,conclusion,displayTitle,createdAt,url']);
  if (!r.ok) return null;
  try {
    return JSON.parse(r.out)[0] || null;
  } catch {
    return null;
  }
}

// ---------- server ----------
let busy = false;
const send = (res, status, data, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
};
const readJson = (req) =>
  new Promise((resolve) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        resolve({});
      }
    });
  });

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/') return send(res, 200, PAGE, 'text/html; charset=utf-8');
    if (req.method === 'GET' && url.pathname === '/api/status') {
      const [dev, git] = await Promise.all([devRunning(), gitStatus()]);
      return send(res, 200, { dev, busy, git, links: { dev: `${DEV_URL}/`, editor: `${DEV_URL}/admin.html`, live: LIVE_URL, repo: REPO_URL } });
    }
    if (req.method === 'GET' && url.pathname === '/api/deploy') return send(res, 200, await deployStatus());
    if (req.method === 'GET' && url.pathname === '/api/log') return send(res, 200, log.slice(-200));

    if (req.method === 'POST') {
      // Alleen verzoeken vanaf de eigen pagina (een andere site kan deze header niet meesturen).
      if (req.headers['x-reisblog'] !== '1') return send(res, 403, { ok: false, message: 'Niet toegestaan' });
      if (busy) return send(res, 409, { ok: false, message: 'Er loopt al een actie; even geduld.' });
      busy = true;
      try {
        if (url.pathname === '/api/dev/start') return send(res, 200, await startDev());
        if (url.pathname === '/api/dev/stop') return send(res, 200, await stopDev());
        if (url.pathname === '/api/publish') return send(res, 200, await commitAndPush((await readJson(req)).message));
      } finally {
        busy = false;
      }
    }
    send(res, 404, { ok: false, message: 'Onbekend' });
  } catch (err) {
    send(res, 500, { ok: false, message: err.message });
  }
});

const openBrowser = () => spawn('cmd', ['/c', 'start', '', `http://localhost:${PORT}`], { windowsHide: true, detached: true });

server.on('error', (err) => {
  // Draait de app al (bijv. tweede keer dubbelklikken)? Dan alleen de pagina openen.
  if (err.code === 'EADDRINUSE') {
    if (process.argv.includes('--open')) openBrowser();
    console.log(`De bedieningsapp draait al op http://localhost:${PORT}`);
    setTimeout(() => process.exit(0), 500);
  } else throw err;
});

server.listen(PORT, '127.0.0.1', () => {
  addLog(`Bedieningsapp draait op http://localhost:${PORT}`);
  console.log(`Reisblog-bediening: http://localhost:${PORT}  (sluit dit venster om te stoppen)`);
  if (process.argv.includes('--open')) openBrowser();
});

// Bij afsluiten ook een door deze app gestarte dev-server stoppen.
const shutdown = () => {
  if (devProcess?.pid) spawn('taskkill', ['/PID', String(devProcess.pid), '/T', '/F'], { windowsHide: true });
  setTimeout(() => process.exit(0), 300);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
