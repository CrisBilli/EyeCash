'use strict';
/*
 * EyeCash · home server entry point
 *
 * Zero external dependencies: only built-in Node.js 22+ modules.
 * Data arrives already encrypted by the browser (AES-GCM with a key derived from
 * the user's password): the server stores ciphertext only and never knows the
 * password or the key. See docs/ARCHITECTURE.md.
 *
 *   node server.js                 start the server
 *   node server.js reset --yes     wipe password and data
 *   node server.js restore <file>  restore an encrypted backup
 *   node server.js quote <symbol>  test the price sources
 */
const http = require('node:http');
const { AI_MODEL, AI_ON, AI_PROVIDER, APP_TZ, HOST, PORT, VERSION } = require('./server/config');
const { cli } = require('./server/cli');
const { json, secHeaders } = require('./server/http');
const { mcp } = require('./server/mcp');
const { ecbRates, isIsin, quoteOne, searchListings } = require('./server/quotes');
const { serveStatic } = require('./server/static');
const { api } = require('./server/api');

const server = http.createServer(async (req, res) => {
  secHeaders(res);
  let p;
  try {
    p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400);
    return res.end();
  }
  try {
    if (p.startsWith('/api/')) return await api(req, res, p);
    if (p === '/mcp') return await mcp(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      return res.end();
    }
    return serveStatic(req, res, p);
  } catch (e) {
    if (!res.headersSent)
      json(
        res,
        e.code === 413 ? 413 : e.code === 400 ? 400 : 500,
        { error: e.code ? e.message : 'Errore interno' },
        e.code === 413 ? { Connection: 'close' } : {}
      );
    if (!e.code) console.error(e);
  }
});
server.requestTimeout = 120000;
server.headersTimeout = 20000;
if (cli === 'quote' || cli === 'search') {
  (async () => {
    const arg = process.argv[3];
    const type = process.argv[4] || '';
    if (!arg) {
      console.log(
        'Uso: node server.js quote SWDA.MI   |   node server.js quote BTC Crypto   |   node server.js search IE00B4L5Y983'
      );
      process.exit(1);
    }
    try {
      if (cli === 'search') {
        const r = await searchListings(arg);
        if (!r.length) console.log('Nessun risultato');
        for (const x of r)
          console.log(
            `${x.symbol.padEnd(12)} ${String(x.exchange).padEnd(22)} ${String(x.currency).padEnd(4)} ${String(x.priceNative).padEnd(12)} = ${x.priceEur} EUR   ${x.name}`
          );
      } else {
        const { rates, date } = await ecbRates();
        const r = await quoteOne(
          {
            symbol: arg,
            type: isIsin(type.toUpperCase()) ? 'ETF' : type,
            isin: isIsin(type.toUpperCase()) ? type : ''
          },
          rates
        );
        console.log(
          JSON.stringify(
            {
              ...r,
              ora: r.time ? new Date(r.time).toLocaleString('it-IT', { timeZone: APP_TZ }) : null,
              cambi_bce_del: date
            },
            null,
            2
          )
        );
      }
      process.exit(0);
    } catch (e) {
      console.error('Errore:', e.message);
      process.exit(1);
    }
  })();
} else
  server.listen(PORT, HOST, () =>
    console.log(
      `EyeCash ${VERSION} in ascolto su http://${HOST}:${PORT}  ·  AI: ${AI_ON ? AI_PROVIDER + ' (' + AI_MODEL + ')' : 'disattivata'}`
    )
  );
