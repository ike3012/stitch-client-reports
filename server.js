'use strict';

// Stitch client report site.
// Serves each client's monthly HTML reports at a private, unguessable link.
// Zero dependencies: Node built-ins only.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const REPORTS_DIR = path.join(__dirname, 'reports');
const LOCAL_CONFIG = path.join(__dirname, 'clients.local.json');
const MIN_TOKEN_LENGTH = 24;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('SESSION_SECRET not set: using a random one, so logins reset on every restart.');
}

// ---------- Client config ----------

function envKey(slug) {
  return 'CLIENT_' + slug.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`Could not read ${file}: ${err.message}`);
    return null;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function safeEqual(a, b) {
  return crypto.timingSafeEqual(sha256(a), sha256(b));
}

// Each folder in reports/ is a client. Token and password come from
// Railway variables (CLIENT_<SLUG>_TOKEN / _PASSWORD) or clients.local.json.
function loadClients() {
  const local = readJson(LOCAL_CONFIG) || {};
  const clients = [];
  let dirs = [];
  try {
    dirs = fs.readdirSync(REPORTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    console.warn('No reports/ folder found.');
  }
  for (const dir of dirs) {
    const slug = dir.name;
    const meta = readJson(path.join(REPORTS_DIR, slug, 'client.json')) || {};
    const fileCfg = local[slug] || {};
    const token = process.env[`${envKey(slug)}_TOKEN`] || fileCfg.token || '';
    const password = process.env[`${envKey(slug)}_PASSWORD`] || fileCfg.password || '';
    if (!token) {
      console.warn(`[${slug}] no token set (${envKey(slug)}_TOKEN): not served.`);
      continue;
    }
    if (token.length < MIN_TOKEN_LENGTH || !/^[A-Za-z0-9_-]+$/.test(token)) {
      console.warn(`[${slug}] token must be ${MIN_TOKEN_LENGTH}+ URL-safe characters: not served.`);
      continue;
    }
    clients.push({ slug, name: meta.name || slug, token, password });
    console.log(`[${slug}] serving${password ? ' (password protected)' : ''}`);
  }
  return clients;
}

const clients = loadClients();

// Check every client so lookup time doesn't reveal which tokens are close.
function findClient(token) {
  let match = null;
  for (const c of clients) {
    if (safeEqual(c.token, token)) match = c;
  }
  return match;
}

// Months are folders named YYYY-MM containing index.html, newest first.
function listMonths(client) {
  const dir = path.join(REPORTS_DIR, client.slug);
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && MONTH_RE.test(e.name))
    .filter((e) => fs.existsSync(path.join(dir, e.name, 'index.html')))
    .map((e) => e.name)
    .sort()
    .reverse();
}

function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-NZ', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// ---------- Auth ----------

function sessionValue(client) {
  return crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(`${client.slug}:${client.password}`)
    .digest('base64url');
}

function cookieName(client) {
  return `stitch_${client.slug.replace(/[^A-Za-z0-9]/g, '_')}`;
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function isAuthed(req, client) {
  if (!client.password) return true;
  const value = parseCookies(req)[cookieName(client)];
  return Boolean(value) && safeEqual(value, sessionValue(client));
}

const loginAttempts = new Map();

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? fwd.split(',')[0] : req.socket.remoteAddress || '').trim();
}

function tooManyAttempts(key) {
  const now = Date.now();
  const recent = (loginAttempts.get(key) || []).filter((t) => now - t < LOGIN_WINDOW_MS);
  loginAttempts.set(key, recent);
  return recent.length >= LOGIN_MAX_ATTEMPTS;
}

function recordAttempt(key) {
  loginAttempts.get(key).push(Date.now());
}

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > limit) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// ---------- Rendering ----------

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const NOINDEX_META = '<meta name="robots" content="noindex, nofollow, noarchive">';

function layout({ title, body, head = '' }) {
  return `<!doctype html>
<html lang="en-NZ">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${NOINDEX_META}
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/site.css">
${head}
</head>
<body>
${body}
</body>
</html>`;
}

function brandMark() {
  return '<span class="brand">Stitch<span class="brand-dot">.</span></span>';
}

function reportPage(client, months, month, base) {
  const options = months
    .map((m) => `<option value="${m}"${m === month ? ' selected' : ''}>${escapeHtml(monthLabel(m))}${m === months[0] ? ' (latest)' : ''}</option>`)
    .join('');
  return layout({
    title: `${client.name} | ${monthLabel(month)} report | Stitch`,
    body: `<header class="bar">
  ${brandMark()}
  <span class="client">${escapeHtml(client.name)}</span>
  <form class="switcher" method="get" action="${base}/go">
    <label for="month">Report</label>
    <select id="month" name="month">${options}</select>
    <noscript><button type="submit">View</button></noscript>
  </form>
</header>
<iframe class="report" src="${base}/${month}/report" title="${escapeHtml(client.name)} ${escapeHtml(monthLabel(month))} report" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads"></iframe>
<script src="/assets/switcher.js"></script>`,
  });
}

function loginPage(client, error) {
  return layout({
    title: `${client.name} | Stitch reports`,
    body: `<main class="login">
  <div class="login-card">
    ${brandMark()}
    <h1>${escapeHtml(client.name)} reports</h1>
    <p>Enter the password Stitch shared with you.</p>
    ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
    <form method="post">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
      <button type="submit">View reports</button>
    </form>
  </div>
</main>`,
  });
}

function messagePage(title, text) {
  return layout({
    title: `${title} | Stitch`,
    body: `<main class="login"><div class="login-card">${brandMark()}<h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p></div></main>`,
  });
}

// Make sure every report file carries the noindex tag, even if the author forgot it.
function withNoindex(html) {
  if (/<meta[^>]+name=["']robots["']/i.test(html)) return html;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}\n${NOINDEX_META}`);
  return NOINDEX_META + html;
}

// ---------- HTTP ----------

const BASE_HEADERS = {
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'private, no-store',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...BASE_HEADERS, 'Content-Type': 'text/html; charset=utf-8', ...headers });
  res.end(body);
}

function notFound(res) {
  send(res, 404, messagePage('Page not found', 'Check the link Stitch sent you, or get in touch with your Stitch contact.'));
}

const ASSETS = {
  'site.css': 'text/css; charset=utf-8',
  'switcher.js': 'text/javascript; charset=utf-8',
};

const SHELL_CSP =
  "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
  "script-src 'self'; frame-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'";

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);

  if (url.pathname === '/robots.txt') {
    return send(res, 200, 'User-agent: *\nDisallow: /\n', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  if (url.pathname === '/healthz') {
    return send(res, 200, 'ok', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  if (parts[0] === 'assets' && parts.length === 2 && ASSETS[parts[1]]) {
    const file = path.join(__dirname, 'public', parts[1]);
    return send(res, 200, fs.readFileSync(file), { 'Content-Type': ASSETS[parts[1]], 'Cache-Control': 'public, max-age=3600' });
  }

  // /r/<token>[/<month>[/report]] or /r/<token>/go?month=
  if (parts[0] !== 'r' || parts.length < 2 || parts.length > 4) return notFound(res);
  const client = findClient(parts[1]);
  if (!client) return notFound(res);
  const base = `/r/${client.token}`;
  const secure = req.headers['x-forwarded-proto'] === 'https';

  if (!isAuthed(req, client)) {
    if (req.method === 'POST' && parts.length === 2) {
      const key = `${clientIp(req)}:${client.slug}`;
      if (tooManyAttempts(key)) {
        return send(res, 429, loginPage(client, 'Too many attempts. Try again in 15 minutes.'), { 'Content-Security-Policy': SHELL_CSP });
      }
      recordAttempt(key);
      const body = await readBody(req);
      const password = new URLSearchParams(body).get('password') || '';
      if (safeEqual(password, client.password)) {
        const cookie = `${cookieName(client)}=${sessionValue(client)}; Path=${base}; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
        res.writeHead(303, { ...BASE_HEADERS, Location: `${base}/`, 'Set-Cookie': cookie });
        return res.end();
      }
      return send(res, 401, loginPage(client, 'That password is not right. Please try again.'), { 'Content-Security-Policy': SHELL_CSP });
    }
    if (parts.length === 2) return send(res, 401, loginPage(client), { 'Content-Security-Policy': SHELL_CSP });
    // Deep links bounce to the login page first.
    res.writeHead(303, { ...BASE_HEADERS, Location: `${base}/` });
    return res.end();
  }

  if (req.method !== 'GET' && req.method !== 'HEAD' && !(req.method === 'POST' && parts.length === 2)) {
    return send(res, 405, messagePage('Not allowed', 'That request is not supported.'), { Allow: 'GET, HEAD' });
  }

  const months = listMonths(client);
  if (months.length === 0) {
    return send(res, 200, messagePage(`${client.name} reports`, 'Your first monthly report is on its way.'), { 'Content-Security-Policy': SHELL_CSP });
  }

  // POST after login with an already-valid cookie: just show the reports.
  if (parts.length === 2) {
    return send(res, 200, reportPage(client, months, months[0], base), { 'Content-Security-Policy': SHELL_CSP });
  }

  if (parts[2] === 'go' && parts.length === 3) {
    const month = url.searchParams.get('month') || '';
    res.writeHead(303, { ...BASE_HEADERS, Location: months.includes(month) ? `${base}/${month}` : `${base}/` });
    return res.end();
  }

  const month = parts[2];
  if (!months.includes(month)) return notFound(res);

  if (parts.length === 3) {
    return send(res, 200, reportPage(client, months, month, base), { 'Content-Security-Policy': SHELL_CSP });
  }
  if (parts[3] === 'report') {
    const html = fs.readFileSync(path.join(REPORTS_DIR, client.slug, month, 'index.html'), 'utf8');
    // Only our own shell may frame the report.
    return send(res, 200, withNoindex(html), { 'Content-Security-Policy': "frame-ancestors 'self'" });
  }
  return notFound(res);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) send(res, 500, messagePage('Something went wrong', 'Please try again shortly.'));
    else res.end();
  });
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`Stitch reports listening on port ${PORT}`));
}

module.exports = { server };
