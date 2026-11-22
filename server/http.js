'use strict';
/*
 * EyeCash · server/http.js
 *
 * HTTP helpers: security headers (strict CSP), JSON responses, body limits,
 * cookies, login sessions, CSRF protection and login rate limiting.
 */
const crypto = require('node:crypto');
const { SESSION_DAYS } = require('./config');
const { db } = require('./db');

/* ---------- helpers ---------- */
const now = () => Date.now();
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
function scryptHex(secret, salt) {
  return crypto.scryptSync(secret, salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex');
}

function secHeaders(res) {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow'); // never listed by search engines, even if exposed by mistake
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
}
function json(res, code, obj, extra = {}) {
  const rq = res.req;
  if (rq && !rq.complete) {
    extra = { Connection: 'close', ...extra };
    rq.resume();
  }
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extra
  });
  res.end(JSON.stringify(obj));
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    let over = false;
    req.on('data', c => {
      if (over) return;
      n += c.length;
      if (n > limit) {
        over = true;
        chunks.length = 0;
        reject(Object.assign(new Error('File o richiesta troppo grande'), { code: 413 }));
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!over) resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}
async function readJSON(req, limit = 1e6) {
  try {
    return JSON.parse((await readBody(req, limit)).toString('utf8'));
  } catch (e) {
    if (e.code === 413) throw e;
    throw Object.assign(new Error('JSON non valido'), { code: 400 });
  }
}
function cookies(req) {
  const o = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return o;
}
function isLocalHost(req) {
  const h = (req.headers.host || '').split(':')[0];
  return h === 'localhost' || h === '127.0.0.1';
}
function sessionCookie(req, token, remember) {
  const secure = isLocalHost(req) ? '' : '; Secure';
  return `sid=${token}; Path=/; HttpOnly; SameSite=Strict${secure}${remember ? '; Max-Age=' + SESSION_DAYS * 86400 : ''}`;
}
function authed(req) {
  const t = cookies(req).sid;
  if (!t) return false;
  const r = db.prepare('SELECT exp FROM sessions WHERE h=?').get(sha256(t));
  return !!(r && r.exp > now());
}
function newSession(req, res, remember) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions(h,exp) VALUES(?,?)').run(
    sha256(token),
    now() + (remember ? SESSION_DAYS : 1) * 864e5
  );
  res.setHeader('Set-Cookie', sessionCookie(req, token, remember));
}
setInterval(() => db.prepare('DELETE FROM sessions WHERE exp<?').run(now()), 36e5).unref();

/* protection against requests from other sites (CSRF): mandatory custom header + Sec-Fetch-Site */
function sameOrigin(req) {
  if (req.headers['x-pointofcash'] !== '1') return false;
  const sfs = req.headers['sec-fetch-site'];
  return !sfs || sfs === 'same-origin' || sfs === 'none';
}

/* login attempt limit */
const fails = [];
function tooManyFails() {
  const t = now() - 15 * 6e4;
  while (fails.length && fails[0] < t) fails.shift();
  return fails.length >= 10;
}

module.exports = {
  authed,
  cookies,
  fails,
  json,
  newSession,
  now,
  readBody,
  readJSON,
  sameOrigin,
  scryptHex,
  secHeaders,
  sha256,
  tooManyFails
};
