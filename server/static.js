'use strict';
/*
 * EyeCash · server/static.js
 *
 * Serves the web app files from public/.
 */
const fs = require('node:fs');
const path = require('node:path');
const { PUB } = require('./config');

/* ---------- static ---------- */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};
function serveStatic(req, res, p) {
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUB, p));
  if (!file.startsWith(PUB + path.sep)) {
    res.writeHead(404);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Non trovato');
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': /\.(png|svg|woff)$/.test(file) ? 'max-age=86400' : 'no-cache'
    });
    res.end(data);
  });
}

module.exports = { serveStatic };
