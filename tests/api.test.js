'use strict';
/*
 * EyeCash – test automatici del server (nessuna dipendenza).
 * Usage:  node --test tests/*.test.js
 * Avvia un server temporaneo su una cartella dati usa-e-getta e un finto servizio AI locale.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 18000 + Math.floor(Math.random() * 1000);
const AIPORT = PORT + 1;
const QPORT = PORT + 2;
let qmock,
  qLog = [];
const B = `http://127.0.0.1:${PORT}`;
let DATA,
  srv,
  ai,
  aiLog = [];

/* ---------- finte fonti di quotazione (Yahoo, Stooq, Kraken, CoinGecko, BCE) ---------- */
const NOW = () => Math.floor(Date.now() / 1000);
const CHART = {
  'SWDA.MI': { currency: 'EUR', price: 104.32, name: 'iShares Core MSCI World', ex: 'Milan' },
  'VUSA.L': { currency: 'GBp', price: 8500, name: 'Vanguard S&P 500', ex: 'LSE' },
  'SWDA.L': { currency: 'GBp', price: 8710, name: 'iShares Core MSCI World', ex: 'LSE' },
  AAPL: { currency: 'USD', price: 200, name: 'Apple', ex: 'NasdaqGS' },
  BADX: { currency: 'USD', price: 100, name: 'Bad', ex: 'NYSE' },
  'OLD.MI': { currency: 'EUR', price: 10, name: 'Sospeso', ex: 'Milan', age: 30 * 86400 },
  'EUNL.DE': { currency: 'EUR', price: 104.1, name: 'iShares Core MSCI World', ex: 'XETRA' },
  'WEIRD.X': { currency: 'XYZ', price: 5, name: 'Valuta strana', ex: 'X' }
};
const STOOQ = { 'aapl.us': 200.6, 'badx.us': 120, 'eunl.de': 104.0 };
function startQuoteMock() {
  return new Promise(res => {
    qmock = http
      .createServer((q, r) => {
        const u = new URL(q.url, 'http://x');
        qLog.push(u.pathname + u.search);
        const send = (code, body, type = 'application/json') => {
          r.writeHead(code, { 'content-type': type });
          r.end(typeof body === 'string' ? body : JSON.stringify(body));
        };
        let m;
        if ((m = u.pathname.match(/^\/api\/etfs\/([A-Z0-9]{12})\/performance-chart$/))) {
          if (m[1] !== 'IE00BP3QZB59') return send(404, { error: 'not found' });
          const s = [];
          for (let d = Date.UTC(2025, 0, 1); d <= Date.UTC(2025, 2, 31); d += 864e5)
            s.push({
              date: new Date(d).toISOString().slice(0, 10),
              value: {
                raw: 50 + new Date(d).getUTCMonth() * 10 + new Date(d).getUTCDate() / 100,
                localized: ''
              }
            });
          return send(200, { series: s, latestQuote: { raw: 70 } });
        }
        if (u.pathname === '/cookie') {
          r.writeHead(404, { 'set-cookie': 'A3=abc; Path=/; HttpOnly' });
          return r.end('');
        }
        if (u.pathname === '/v1/test/getcrumb')
          return (q.headers.cookie || '').includes('A3=abc')
            ? send(200, 'crumbXYZ', 'text/plain')
            : send(401, 'no', 'text/plain');
        if ((m = u.pathname.match(/^\/api\/etfs\/([A-Z0-9]{12})\/quote$/))) {
          const pz = { IE00BP3QZB59: 70.38, IE00B4L5Y983: 100.4 }[m[1]];
          return pz
            ? send(200, {
                latestQuote: { raw: pz, localized: String(pz) },
                latestQuoteDate: new Date().toISOString().slice(0, 10),
                quoteTradingVenue: 'XETRA'
              })
            : send(404, { error: 'not found' });
        }
        if ((m = u.pathname.match(/^\/v8\/finance\/chart\/(.+)$/))) {
          const sym = decodeURIComponent(m[1]);
          if (sym === 'BLOCKED.MI') return send(429, 'Too Many Requests', 'text/plain');
          if (u.searchParams.get('interval') === '1mo' && sym === 'AAPL') {
            const ts = [Date.UTC(2025, 9, 1), Date.UTC(2025, 10, 1), Date.UTC(2025, 11, 1)].map(
              x => x / 1000
            );
            return send(200, {
              chart: {
                result: [
                  {
                    meta: { currency: 'USD' },
                    timestamp: ts,
                    indicators: {
                      quote: [{ close: [200, 210, 0] }],
                      adjclose: [{ adjclose: [198, 208, null] }]
                    }
                  }
                ]
              }
            });
          }
          if (
            sym === 'NEEDCRUMB.MI' &&
            !(u.searchParams.get('crumb') === 'crumbXYZ' && (q.headers.cookie || '').includes('A3=abc'))
          )
            return send(429, 'Too Many Requests', 'text/plain');
          const c =
            sym === 'NEEDCRUMB.MI'
              ? { currency: 'EUR', ex: 'Milan', price: 12.5, name: 'Crumb ETF' }
              : CHART[sym];
          if (!c)
            return send(404, {
              chart: {
                result: null,
                error: { code: 'Not Found', description: 'No data found, symbol may be delisted' }
              }
            });
          const t = NOW() - (c.age || 60);
          return send(200, {
            chart: {
              result: [
                {
                  meta: {
                    currency: c.currency,
                    symbol: sym,
                    exchangeName: c.ex,
                    fullExchangeName: c.ex,
                    regularMarketPrice: c.price,
                    regularMarketTime: t,
                    longName: c.name
                  },
                  timestamp: [t],
                  indicators: { quote: [{ close: [c.price] }] }
                }
              ],
              error: null
            }
          });
        }
        if (u.pathname === '/v1/finance/search') {
          const qq = u.searchParams.get('q');
          if (qq === 'IE00B4L5Y983')
            return send(200, {
              quotes: [
                {
                  symbol: 'SWDA.L',
                  longname: 'iShares Core MSCI World',
                  exchDisp: 'London',
                  quoteType: 'ETF',
                  typeDisp: 'ETF'
                },
                {
                  symbol: 'SWDA.MI',
                  longname: 'iShares Core MSCI World',
                  exchDisp: 'Milan',
                  quoteType: 'ETF',
                  typeDisp: 'ETF'
                },
                {
                  symbol: 'EUNL.DE',
                  longname: 'iShares Core MSCI World',
                  exchDisp: 'XETRA',
                  quoteType: 'ETF',
                  typeDisp: 'ETF'
                },
                { symbol: 'NEWS1', quoteType: 'NEWS' }
              ]
            });
          return send(200, { quotes: [] });
        }
        if (u.pathname === '/q/l/') {
          const s = u.searchParams.get('s');
          const p = STOOQ[s];
          return send(
            200,
            p
              ? `Symbol,Date,Time,Open,High,Low,Close,Volume\n${s.toUpperCase()},${new Date().toISOString().slice(0, 10)},17:35:00,1,1,1,${p},100\n`
              : `Symbol,Date,Time,Open,High,Low,Close,Volume\n${s.toUpperCase()},N/D,N/D,N/D,N/D,N/D,N/D,N/D\n`,
            'text/csv'
          );
        }
        if (u.pathname === '/0/public/Ticker') {
          const pair = u.searchParams.get('pair');
          if (pair === 'XBTEUR')
            return send(200, {
              error: [],
              result: {
                XXBTZEUR: { a: ['66267.9', '1', '1'], b: ['66267.8', '1', '1'], c: ['66267.9', '0.1'] }
              }
            });
          if (pair === 'ETHEUR')
            return send(200, { error: [], result: { XETHZEUR: { c: ['1865.14', '1'] } } });
          return send(200, { error: ['EQuery:Unknown asset pair'] });
        }
        if (u.pathname === '/api/v3/simple/price') {
          const id = u.searchParams.get('ids');
          if (id === 'bitcoin') return send(200, { bitcoin: { eur: 66300, last_updated_at: NOW() } });
          if (id === 'ethereum') return send(200, { ethereum: { eur: 2100, last_updated_at: NOW() } }); // discorde
          return send(200, {});
        }
        if (u.pathname === '/ecb.xml')
          return send(
            200,
            `<?xml version="1.0"?><gesmes:Envelope><Cube><Cube time='2026-11-09'><Cube currency='USD' rate='1.1193'/><Cube currency='GBP' rate='0.83430'/><Cube currency='CHF' rate='0.9164'/></Cube></Cube></gesmes:Envelope>`,
            'text/xml'
          );
        send(404, {});
      })
      .listen(QPORT, '127.0.0.1', res);
  });
}
/* ---------- finto servizio AI compatibile OpenAI ---------- */
function startMockAI() {
  return new Promise(res => {
    ai = http
      .createServer((q, r) => {
        let b = '';
        q.on('data', d => (b += d));
        q.on('end', () => {
          const j = JSON.parse(b);
          const u = j.messages[j.messages.length - 1].content;
          aiLog.push(u);
          let out = '{}';
          if (/Trasforma questa frase/.test(u))
            out =
              'Ecco: {"type":"uscita","amount":"23.5","description":"Pizzeria","date":"2026-11-09","category":"Ristoranti","account_hint":"carta"}';
          else if (/Traduci la domanda/.test(u))
            out = /«[^»]*meteo[^»]*»/.test(u)
              ? '{"queries":[],"clarify":"Rispondo solo su movimenti e investimenti."}'
              : 'Certo: {"title":"Ristoranti","queries":[{"id":"a","source":"movimenti","measure":"totale","type":"uscite","categories":["Ristoranti","Hack"],"accounts":["conto_1","conto_99"],"text":"<x>pizza","from":"2026-01-01","to":"bad","group":"esercente","limit":500},{"id":"b","measure":"media_mensile","group":"titolo"}],"answer":"Hai speso {a} <script>","chart":{"query":"b","kind":"3d"},"importi":[1,2,3]}';
          else if (/parametri di un acquisto/.test(u))
            out =
              'Ecco: {"kind":"mortgage","label":"Casa <b>a Torino","price":"260000","downPayment":40000,"extraCosts":null,"ratePct":95,"years":25,"payCash":null,"income":3000}';
          else if (/Categorizza/.test(u))
            out = '[{"i":0,"cat":"Shopping"},{"i":1,"cat":"NonEsiste"},{"i":"x","cat":"Spesa"}]';
          else if (/Stima il valore|Stima /.test(u) && /valore_min/.test(u))
            out =
              'Ragionamento...\n{"valore_min": 15000, "valore_centrale": 16500, "valore_max": 18000, "affidabilita": "alta", "deprezzamento_annuo_pct": 11, "motivazione": "Annunci simili", "confronti": [{"descrizione": "Golf 2020 60.000 km", "prezzo": 16900}, {"descrizione": "", "prezzo": 1}]}';
          else if (/prime righe/.test(u))
            out =
              '{"bank_name":"X","header_row":0,"date_col":0,"date_format":"DMY","desc_cols":[2,99],"amount_col":3,"decimal":",","expenses_positive":false}';
          r.writeHead(200, { 'content-type': 'application/json' });
          r.end(JSON.stringify({ choices: [{ message: { content: out } }] }));
        });
      })
      .listen(AIPORT, '127.0.0.1', res);
  });
}
function startServer(extraEnv = {}) {
  return new Promise((res, rej) => {
    srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      env: {
        ...process.env,
        PORT: String(PORT),
        HOST: '127.0.0.1',
        DATA_DIR: DATA,
        NODE_NO_WARNINGS: '1',
        AI_PROVIDER: 'openai',
        OPENAI_BASE_URL: `http://127.0.0.1:${AIPORT}/v1`,
        AI_MODEL: 'mock',
        YAHOO_URLS: `http://127.0.0.1:1,http://127.0.0.1:${QPORT}`,
        JUSTETF_URL: `http://127.0.0.1:${QPORT}`,
        YAHOO_COOKIE_URL: `http://127.0.0.1:${QPORT}/cookie`,
        YAHOO_BLOCK_MS: '40',
        STOOQ_URL: `http://127.0.0.1:${QPORT}`,
        KRAKEN_URL: `http://127.0.0.1:${QPORT}`,
        COINGECKO_URL: `http://127.0.0.1:${QPORT}`,
        ECB_URL: `http://127.0.0.1:${QPORT}/ecb.xml`,
        ...extraEnv
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    srv.stdout.on('data', d => {
      out += d;
      if (/in ascolto/.test(out)) res();
    });
    srv.stderr.on('data', d => {
      out += d;
    });
    srv.on('exit', c => rej(new Error('server uscito ' + c + '\n' + out)));
    setTimeout(() => rej(new Error('timeout avvio\n' + out)), 8000);
  });
}

/* ---------- client HTTP minimale con cookie ---------- */
function req(method, p, { body, headers = {}, cookie, raw } = {}) {
  return new Promise((res, rej) => {
    const data = raw !== undefined ? raw : body !== undefined ? Buffer.from(JSON.stringify(body)) : null;
    const h = { 'x-pointofcash': '1', ...headers };
    if (data && !h['content-type']) h['content-type'] = 'application/json';
    if (cookie) h.cookie = cookie;
    const r = http.request(B + p, { method, headers: h }, s => {
      const ch = [];
      s.on('data', c => ch.push(c));
      s.on('end', () => {
        const txt = Buffer.concat(ch).toString();
        let json = null;
        try {
          json = JSON.parse(txt);
        } catch {}
        const sc = s.headers['set-cookie'];
        res({ status: s.statusCode, json, txt, headers: s.headers, cookie: sc ? sc[0].split(';')[0] : null });
      });
    });
    r.on('error', rej);
    if (data) r.write(data);
    r.end();
  });
}
const authKey = pw => crypto.createHash('sha256').update(pw).digest('hex');
let COOKIE;

/* ---------- xlsx minimale generato in memoria ---------- */
function crc32(buf) {
  let c,
    crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(files) {
  const locals = [],
    centrals = [];
  let off = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content),
      comp = zlib.deflateRawSync(data),
      nb = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc32(data), 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc32(data), 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nb.length, 28);
    ch.writeUInt32LE(off, 42);
    locals.push(lh, nb, comp);
    centrals.push(ch, nb);
    off += 30 + nb.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0);
  e.writeUInt16LE(centrals.length / 2, 8);
  e.writeUInt16LE(centrals.length / 2, 10);
  e.writeUInt32LE(cd.length, 12);
  e.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, e]);
}
function xlsx(rows) {
  const ss = [];
  const si = s => {
    let i = ss.indexOf(s);
    if (i < 0) {
      ss.push(s);
      i = ss.length - 1;
    }
    return i;
  };
  const col = i => String.fromCharCode(65 + i);
  const sheet = rows
    .map(
      (r, ri) =>
        `<row r="${ri + 1}">` +
        r
          .map((v, ci) => {
            const ref = col(ci) + (ri + 1);
            if (v && typeof v === 'object' && v.date) return `<c r="${ref}" s="1"><v>${v.date}</v></c>`;
            if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
            return `<c r="${ref}" t="s"><v>${si(String(v))}</v></c>`;
          })
          .join('') +
        '</row>'
    )
    .join('');
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return zip({
    '[Content_Types].xml': '<Types/>',
    'xl/workbook.xml': '<workbook><sheets><sheet name="S" sheetId="1"/></sheets></workbook>',
    'xl/styles.xml':
      '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>',
    'xl/sharedStrings.xml': `<sst>${ss.map(s => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`,
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${sheet}</sheetData></worksheet>`
  });
}

/* ================= TEST ================= */
test.before(async () => {
  DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-test-'));
  await startMockAI();
  await startQuoteMock();
  await startServer();
});
test.after(() => {
  try {
    srv.kill();
  } catch {}
  try {
    ai.close();
  } catch {}
  try {
    qmock.close();
  } catch {}
  fs.rmSync(DATA, { recursive: true, force: true });
});

test('status iniziale: nessuna password, salt KDF presente', async () => {
  const r = await req('GET', '/api/status');
  assert.equal(r.status, 200);
  assert.equal(r.json.setup, false);
  assert.equal(r.json.authed, false);
  assert.equal(r.json.kdf_iter, 600000);
  assert.ok(Buffer.from(r.json.kdf_salt, 'base64').length === 16);
});
test('header di sicurezza sulla pagina', async () => {
  const r = await req('GET', '/');
  assert.equal(r.status, 200);
  assert.match(r.headers['content-security-policy'], /script-src 'self'/);
  assert.equal(r.headers['x-frame-options'], 'DENY');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.doesNotMatch(r.txt, /https?:\/\/(?!www\.w3\.org)/, 'nessuna risorsa esterna nella pagina');
});
test('path traversal bloccato', async () => {
  for (const p of ['/../server.js', '/%2e%2e/server.js', '/..%2fserver.js', '/public/../../etc/passwd']) {
    const r = await req('GET', p);
    assert.notEqual(r.status, 200, p);
    assert.doesNotMatch(r.txt, /DatabaseSync|root:/);
  }
});
test('API protette senza login', async () => {
  for (const [m, p] of [
    ['GET', '/api/state'],
    ['PUT', '/api/state'],
    ['GET', '/api/inbox'],
    ['POST', '/api/mcp-token'],
    ['POST', '/api/ai/parse-entry'],
    ['POST', '/api/spreadsheet']
  ]) {
    const r = await req(m, p, { body: {} });
    assert.equal(r.status, 401, m + ' ' + p);
  }
});
test('CSRF: senza header custom o da altro sito → 403', async () => {
  let r = await req('POST', '/api/login', {
    body: { authKey: 'a'.repeat(64) },
    headers: { 'x-pointofcash': '' }
  });
  assert.equal(r.status, 403);
  r = await req('POST', '/api/login', {
    body: { authKey: 'a'.repeat(64) },
    headers: { 'sec-fetch-site': 'cross-site' }
  });
  assert.equal(r.status, 403);
});
test('setup password: formato validato, una sola volta', async () => {
  let r = await req('POST', '/api/setup', { body: { authKey: 'non-hex' } });
  assert.equal(r.status, 400);
  r = await req('POST', '/api/setup', { body: { authKey: authKey('pw'), remember: true } });
  assert.equal(r.status, 200);
  assert.ok(r.cookie);
  COOKIE = r.cookie;
  assert.match(r.headers['set-cookie'][0], /HttpOnly/);
  assert.match(r.headers['set-cookie'][0], /SameSite=Strict/);
  r = await req('POST', '/api/setup', { body: { authKey: authKey('altra') } });
  assert.equal(r.status, 409);
});
test("login: password errata 401, giusta 200, nessun leak dell'hash", async () => {
  let r = await req('POST', '/api/login', { body: { authKey: authKey('sbagliata') } });
  assert.equal(r.status, 401);
  r = await req('POST', '/api/login', { body: { authKey: authKey('pw') } });
  assert.equal(r.status, 200);
  assert.ok(r.cookie);
  const st = await req('GET', '/api/status', { cookie: r.cookie });
  assert.equal(st.json.authed, true);
  assert.ok(!('auth_hash' in st.json));
});
test('stato cifrato: versioni, conflitto 409, validazione', async () => {
  let r = await req('GET', '/api/state', { cookie: COOKIE });
  assert.equal(r.json.ver, 0);
  assert.equal(r.json.blob, null);
  r = await req('PUT', '/api/state', { cookie: COOKIE, body: { blob: 'testo in chiaro', ver: 0 } });
  assert.equal(r.status, 400);
  const blob = JSON.stringify({ v: 1, iv: 'AAAA', ct: 'BBBB' });
  r = await req('PUT', '/api/state', { cookie: COOKIE, body: { blob, ver: 0 } });
  assert.equal(r.status, 200);
  assert.equal(r.json.ver, 1);
  r = await req('PUT', '/api/state', { cookie: COOKIE, body: { blob, ver: 0 } });
  assert.equal(r.status, 409);
  assert.equal(r.json.ver, 1);
  r = await req('PUT', '/api/state', { cookie: COOKIE, body: { blob, ver: 1 } });
  assert.equal(r.json.ver, 2);
  const f = fs.readdirSync(path.join(DATA, 'backups'));
  assert.equal(f.length, 1);
  assert.match(f[0], /^pointofcash-\d{4}-\d{2}-\d{2}\.json$/);
  const bk = JSON.parse(fs.readFileSync(path.join(DATA, 'backups', f[0])));
  assert.equal(bk.blob, blob);
  assert.ok(bk.kdf_salt);
});
test('scritture concorrenti: nessuna versione persa o duplicata', async () => {
  const cur = (await req('GET', '/api/state', { cookie: COOKIE })).json.ver;
  const blob = JSON.stringify({ v: 1, iv: 'x', ct: 'y' });
  const rs = await Promise.all(
    Array.from({ length: 20 }, () => req('PUT', '/api/state', { cookie: COOKIE, body: { blob, ver: cur } }))
  );
  assert.equal(rs.filter(r => r.status === 200).length, 1, 'una sola vince');
  assert.equal(rs.filter(r => r.status === 409).length, 19);
});
test('body troppo grande / JSON rotto non fanno cadere il server', async () => {
  let r = await req('POST', '/api/ai/parse-entry', { cookie: COOKIE, raw: Buffer.from('{rotto') });
  assert.equal(r.status, 400);
  r = await req('POST', '/api/ai/parse-entry', { cookie: COOKIE, raw: Buffer.alloc(10000, 97) });
  assert.equal(r.status, 413);
  r = await req('GET', '/api/status');
  assert.equal(r.status, 200);
});
test('Excel .xlsx: date, numeri, stringhe, celle vuote', async () => {
  const buf = xlsx([
    ['Lista movimenti'],
    [],
    ['Data', 'Valuta', 'Descrizione', 'Importo'],
    [{ date: 46328 }, { date: 46328 }, 'POS ESSELUNGA & C.', -54.3],
    [{ date: 46329 }, '', 'Stipendio <ottobre>', 2450]
  ]);
  const r = await req('POST', '/api/spreadsheet', {
    cookie: COOKIE,
    raw: buf,
    headers: { 'content-type': 'application/octet-stream' }
  });
  assert.equal(r.status, 200);
  const rows = r.json.sheets[0];
  assert.deepEqual(rows[2], ['Data', 'Valuta', 'Descrizione', 'Importo']);
  assert.equal(rows[3][0], '2026-11-02');
  assert.equal(rows[3][2], 'POS ESSELUNGA & C.');
  assert.equal(rows[3][3], '-54.3');
  assert.equal(rows[4][1], '');
  assert.equal(rows[4][2], 'Stipendio <ottobre>');
});
test('.xls in formato HTML (molte banche italiane)', async () => {
  const html =
    '<html><table><tr><th>Data</th><th>Descrizione</th><th>Importo</th></tr><tr><td>02/11/2026</td><td>Bar&nbsp;Centrale<br>Milano</td><td>-3,50</td></tr></table></html>';
  const r = await req('POST', '/api/spreadsheet', {
    cookie: COOKIE,
    raw: Buffer.from(html, 'latin1'),
    headers: { 'content-type': 'application/octet-stream' }
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.sheets[0][1], ['02/11/2026', 'Bar Centrale Milano', '-3,50']);
});
test('.xls binario vecchio formato (BIFF8): testo, numeri, date, più fogli, stringhe lunghe', async () => {
  const r = await req('POST', '/api/spreadsheet', {
    cookie: COOKIE,
    raw: fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.xls')),
    headers: { 'content-type': 'application/octet-stream' }
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.typed, true);
  assert.equal(r.json.sheets.length, 2);
  const m = r.json.sheets[0];
  assert.equal(m.length, 901);
  assert.deepEqual(m[0], ['Data', 'Descrizione', 'Importo', 'Nota']);
  assert.deepEqual(m[1].slice(0, 3), ['2025-01-01', 'Esercente di prova numero 0 città àèìòù €', '1000']);
  assert.deepEqual(m[900].slice(0, 3), [
    '2025-10-27',
    'Esercente di prova numero 899 città àèìòù €',
    '-334.13'
  ]);
  const pf = r.json.sheets[1].find(x => x[1] === 'IE00B4L5Y983');
  assert.equal(pf[0], 'ETF Finto Mondo UCITS (Acc)');
  assert.equal(pf[6], '10');
  assert.equal(pf[7], '80.12345');
});
test('file non validi: .xls binario vecchio, zip rotto, testo', async () => {
  let r = await req('POST', '/api/spreadsheet', {
    cookie: COOKIE,
    raw: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]),
    headers: { 'content-type': 'application/octet-stream' }
  });
  assert.equal(r.status, 415);
  assert.match(r.json.error, /\.xls/);
  r = await req('POST', '/api/spreadsheet', {
    cookie: COOKIE,
    raw: Buffer.concat([Buffer.from('PK\x03\x04'), crypto.randomBytes(500)]),
    headers: { 'content-type': 'application/octet-stream' }
  });
  assert.equal(r.status, 400);
  r = await req('POST', '/api/spreadsheet', {
    cookie: COOKIE,
    raw: Buffer.from('ciao'),
    headers: { 'content-type': 'application/octet-stream' }
  });
  assert.equal(r.status, 415);
});
test('AI parse-entry: solo la frase, IBAN/carta mascherati, output ripulito', async () => {
  aiLog = [];
  const r = await req('POST', '/api/ai/parse-entry', {
    cookie: COOKIE,
    body: {
      text: 'bonifico IT60X0542811101000000123456 carta 4111 1111 1111 1111 23,50',
      extra: 'saldo 99999'
    }
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, {
    type: 'uscita',
    amount: 23.5,
    description: 'Pizzeria',
    date: '2026-11-09',
    category: 'Ristoranti',
    account_hint: 'carta'
  });
  assert.equal(aiLog.length, 1);
  assert.doesNotMatch(aiLog[0], /IT60X0542811101000000123456|4111 1111|99999/);
});
test('AI categorize: categorie non valide scartate, max 150 voci', async () => {
  aiLog = [];
  const items = Array.from({ length: 400 }, (_, i) => ['Negozio ' + i, -10]);
  const r = await req('POST', '/api/ai/categorize', { cookie: COOKIE, body: { items } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.result, [{ i: 0, cat: 'Shopping' }]);
  assert.match(aiLog[0], /149\. Negozio 149/);
  assert.doesNotMatch(aiLog[0], /150\. Negozio/);
});
test('AI detect-format: max 12 righe, colonne fuori range scartate', async () => {
  aiLog = [];
  const rows = Array.from({ length: 50 }, (_, i) => ['01/01/2026', 'x', 'riga' + i, '1']);
  const r = await req('POST', '/api/ai/detect-format', { cookie: COOKIE, body: { rows } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.desc_cols, [2]);
  assert.match(aiLog[0], /riga11/);
  assert.doesNotMatch(aiLog[0], /riga12/);
});
test('nessun endpoint AI generico (niente canale "libero")', async () => {
  const r = await req('POST', '/api/ai', {
    cookie: COOKIE,
    body: { system: 'x', messages: [{ role: 'user', content: 'saldo?' }] }
  });
  assert.equal(r.status, 404);
});
test('PDF senza consenso esplicito → rifiutato', async () => {
  const r = await req('POST', '/api/import-pdf', {
    cookie: COOKIE,
    raw: Buffer.from('%PDF-1.4'),
    headers: { 'content-type': 'application/pdf' }
  });
  assert.notEqual(r.status, 200);
});

/* ---------- QUOTAZIONI ---------- */
const quotes = async items => (await req('POST', '/api/quotes', { cookie: COOKIE, body: { items } })).json;
const byId = (r, id) => r.results.find(x => x.id === id);
test('quotazioni: richiedono login', async () => {
  assert.equal(
    (await req('POST', '/api/quotes', { body: { items: [{ id: 'a', symbol: 'SWDA.MI' }] } })).status,
    401
  );
});
test('quotazioni: ETF in EUR a Milano, prima fonte giù → usa la seconda URL', async () => {
  const r = await quotes([{ id: 'a', symbol: 'SWDA.MI', type: 'ETF' }]);
  const q = byId(r, 'a');
  assert.equal(q.ok, true);
  assert.equal(q.priceEur, 104.32);
  assert.equal(q.currency, 'EUR');
  assert.equal(q.source, 'Yahoo Finance');
  assert.equal(q.check, 'one');
  assert.equal(q.stale, false);
  assert.equal(r.fxDate, '2026-11-09');
});
test('quotazioni: USD convertito con cambio BCE e verificato su Stooq', async () => {
  const q = byId(await quotes([{ id: 'b', symbol: 'AAPL', type: 'Azioni' }]), 'b');
  assert.equal(q.priceEur, Math.round((200 / 1.1193) * 10000) / 10000);
  assert.equal(q.check, 'two');
  assert.equal(q.check2.source, 'Stooq');
});
test('quotazioni: pence inglesi (GBp) divisi per 100 e convertiti', async () => {
  const q = byId(await quotes([{ id: 'c', symbol: 'VUSA.L', type: 'ETF' }]), 'c');
  assert.equal(q.priceEur, Math.round((85 / 0.8343) * 10000) / 10000);
});
test('quotazioni: fonti discordanti → segnalato, non nascosto', async () => {
  const q = byId(await quotes([{ id: 'd', symbol: 'BADX', type: 'Azioni' }]), 'd');
  assert.equal(q.ok, true);
  assert.equal(q.check, 'mismatch');
});
test('quotazioni: Xetra EUR concordante con Stooq', async () => {
  const q = byId(await quotes([{ id: 'e', symbol: 'EUNL.DE', type: 'ETF' }]), 'e');
  assert.equal(q.check, 'two');
  assert.equal(q.priceEur, 104.1);
});
test('quotazioni: prezzo vecchio di 30 giorni → stale', async () => {
  const q = byId(await quotes([{ id: 'f', symbol: 'OLD.MI', type: 'ETF' }]), 'f');
  assert.equal(q.stale, true);
});
test('quotazioni: simbolo inesistente e valuta sconosciuta → errore chiaro, nessun prezzo', async () => {
  const r = await quotes([
    { id: 'g', symbol: 'NONESISTE', type: 'ETF' },
    { id: 'h', symbol: 'WEIRD.X', type: 'ETF' }
  ]);
  assert.equal(byId(r, 'g').ok, false);
  assert.match(byId(r, 'g').error, /./);
  assert.equal(byId(r, 'g').priceEur, undefined);
  assert.equal(byId(r, 'h').ok, false);
  assert.match(byId(r, 'h').error, /Valuta non supportata/);
});
test('quotazioni: crypto Kraken + CoinGecko concordi; ETH discorde segnalato', async () => {
  const r = await quotes([
    { id: 'i', symbol: 'BTC', type: 'Crypto' },
    { id: 'j', symbol: 'eth', type: 'Crypto' },
    { id: 'k', symbol: 'FAKECOIN', type: 'Crypto' }
  ]);
  assert.equal(byId(r, 'i').priceEur, 66267.9);
  assert.equal(byId(r, 'i').check, 'two');
  assert.equal(byId(r, 'i').source, 'Kraken');
  assert.equal(byId(r, 'j').check, 'mismatch');
  assert.equal(byId(r, 'k').ok, false);
});
test('quotazioni: Yahoo risponde 429 senza sessione → cookie + crumb e il prezzo arriva', async () => {
  const r = await req('POST', '/api/quotes', {
    cookie: COOKIE,
    body: { items: [{ id: 'n', symbol: 'NEEDCRUMB.MI', type: 'ETF' }] }
  });
  const q = r.json.results[0];
  assert.equal(q.ok, true, JSON.stringify(q));
  assert.equal(q.priceEur, 12.5);
  assert.equal(q.source, 'Yahoo Finance');
});
test('quotazioni: Yahoo bloccato (429) → ETF con ISIN preso da justETF, con avviso', async () => {
  let r = await req('POST', '/api/quotes', {
    cookie: COOKIE,
    body: { items: [{ id: 'b', symbol: 'BLOCKED.MI', type: 'ETF', isin: 'IE00BP3QZB59' }] }
  });
  let q = r.json.results[0];
  assert.equal(q.ok, true, JSON.stringify(q));
  assert.equal(q.priceEur, 70.38);
  assert.equal(q.source, 'justETF');
  assert.match(q.warn, /Yahoo/);
  assert.equal(q.check, 'one');
  await new Promise(z => setTimeout(z, 80));
  r = await req('POST', '/api/quotes', {
    cookie: COOKIE,
    body: { items: [{ id: 'b2', symbol: 'BLOCKED.MI', type: 'Azioni' }] }
  });
  q = r.json.results[0];
  assert.equal(q.ok, false);
  assert.match(q.error, /troppe richieste/);
  await new Promise(z => setTimeout(z, 80));
});
test('prezzi storici: ETF da justETF (ultimo prezzo del mese, in €), azioni da Yahoo convertite, errori isolati', async () => {
  const r = await req('POST', '/api/quotes/history', {
    cookie: COOKIE,
    body: {
      items: [
        { id: 'e', isin: 'IE00BP3QZB59', type: 'ETF', symbol: 'IWVL.MI' },
        { id: 's', symbol: 'AAPL', type: 'Azioni' },
        { id: 'x', isin: 'IE0000000000', type: 'ETF', symbol: '' }
      ]
    }
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const R = Object.fromEntries(r.json.results.map(x => [x.id, x]));
  assert.equal(R.e.ok, true);
  assert.equal(R.e.source, 'justETF');
  assert.deepEqual(Object.keys(R.e.months), ['2025-01', '2025-02', '2025-03']);
  assert.equal(R.e.months['2025-02'], 60.28);
  assert.equal(R.e.approx, false);
  assert.equal(R.s.ok, true);
  assert.equal(R.s.source, 'Yahoo Finance');
  assert.equal(R.s.approx, true);
  assert.deepEqual(Object.keys(R.s.months), ['2025-10', '2025-11']);
  assert.ok(R.s.months['2025-10'] > 100 && R.s.months['2025-10'] < 198);
  assert.equal(R.x.ok, false);
  const e = await req('POST', '/api/quotes/history', { cookie: COOKIE, body: { items: [] } });
  assert.equal(e.status, 400);
  const n = await req('POST', '/api/quotes/history', {
    body: { items: [{ id: 'e', isin: 'IE00BP3QZB59', type: 'ETF' }] }
  });
  assert.equal(n.status, 401);
});
test("chiedi ai tuoi dati: all'AI va solo la domanda, la ricetta torna ripulita", async () => {
  aiLog.length = 0;
  const r = await req('POST', '/api/ai/ask', {
    cookie: COOKIE,
    body: {
      question: 'quanto ho speso in pizzerie? IBAN IT60X0542811101000000123456',
      accounts: [
        { alias: 'conto_1', type: 'Conto', name: 'Mio conto segreto' },
        { alias: 'conto_2!!', type: 'Bitcoin' }
      ]
    }
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const s = r.json;
  const sent = aiLog.join('\n');
  assert.ok(sent.includes('quanto ho speso in pizzerie'));
  assert.ok(!sent.includes('IT60X0542811101000000123456'));
  assert.ok(!sent.includes('Mio conto segreto'));
  assert.ok(/conto_1 \(Conto\), conto_2 \(Conto\)/.test(sent));
  assert.equal(s.queries.length, 2);
  const a = s.queries[0];
  assert.deepEqual(a.categories, ['Ristoranti']);
  assert.deepEqual(a.accounts, ['conto_1']);
  assert.equal(a.text, 'xpizza');
  assert.equal(a.to, null);
  assert.equal(a.limit, 24);
  assert.equal(a.group, 'esercente');
  assert.equal(s.queries[1].group, 'nessuno');
  assert.equal(s.chart.kind, 'barre');
  assert.ok(!/[<>]/.test(s.answer));
  assert.equal(s.importi, undefined);
  const c = await req('POST', '/api/ai/ask', { cookie: COOKIE, body: { question: 'che meteo fa domani?' } });
  assert.equal(c.status, 200);
  assert.equal(c.json.queries.length, 0);
  assert.match(c.json.clarify, /movimenti/);
  assert.equal((await req('POST', '/api/ai/ask', { cookie: COOKIE, body: { question: '  ' } })).status, 400);
  assert.equal((await req('POST', '/api/ai/ask', { body: { question: 'x' } })).status, 401);
});
test('AI "posso permettermelo?": solo la frase esce, parametri ripuliti', async () => {
  aiLog = [];
  const r = await req('POST', '/api/ai/afford', {
    cookie: COOKIE,
    body: { question: 'posso comprare casa da 260 mila? IBAN IT60X0542811101000000123456', lang: 'it' }
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const sent = aiLog.join('\n');
  assert.ok(sent.includes('posso comprare casa da 260 mila'));
  assert.ok(!sent.includes('IT60X0542811101000000123456'));
  assert.equal(r.json.kind, 'mortgage');
  assert.equal(r.json.price, 260000);
  assert.equal(r.json.ratePct, 30, 'tasso fuori scala riportato nei limiti');
  assert.equal(r.json.label, 'Casa ba Torino');
  assert.ok(!('income' in r.json) && !('extraCosts' in r.json) && !('payCash' in r.json));
  assert.equal(
    (await req('POST', '/api/ai/afford', { cookie: COOKIE, body: { question: ' ' } })).status,
    400
  );
  assert.equal((await req('POST', '/api/ai/afford', { body: { question: 'x' } })).status, 401);
});
test('service worker servito come script, senza cache', async () => {
  const r = await req('GET', '/sw.js');
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /javascript/);
  assert.match(r.headers['cache-control'], /no-cache/);
  assert.ok(r.txt.includes("startsWith('/api/')"), 'le API non passano dalla cache');
});
test('quotazioni: ETF a Milano verificato con justETF come seconda fonte', async () => {
  const r = await req('POST', '/api/quotes', {
    cookie: COOKIE,
    body: { items: [{ id: 's', symbol: 'SWDA.MI', type: 'ETF', isin: 'IE00B4L5Y983' }] }
  });
  const q = r.json.results[0];
  assert.equal(q.ok, true);
  assert.equal(q.source, 'Yahoo Finance');
  assert.equal(q.check2.source, 'justETF');
  assert.ok(['two', 'mismatch'].includes(q.check), q.check);
});
test('quotazioni: escono solo i simboli (+ esche), mai quantità o id', async () => {
  qLog = [];
  await req('POST', '/api/quotes', {
    cookie: COOKIE,
    body: { items: [{ id: 'segreto-123', symbol: 'SWDA.MI', type: 'ETF', qty: 999, value: 123456 }] }
  });
  await new Promise(r => setTimeout(r, 300));
  const all = qLog.join('\n');
  assert.doesNotMatch(all, /segreto|999|123456/);
  const charts = qLog
    .filter(x => x.startsWith('/v8/finance/chart/'))
    .map(x => decodeURIComponent(x.split('/')[4].split('?')[0]));
  assert.ok(charts.length >= 1);
});
test('quotazioni: ricerca per ISIN → listini con valuta e prezzo, EUR/Milano per primi', async () => {
  const r = await req('POST', '/api/quotes/search', { cookie: COOKIE, body: { q: 'IE00B4L5Y983' } });
  assert.equal(r.status, 200);
  const syms = r.json.results.map(x => x.symbol);
  assert.equal(syms[0], 'SWDA.MI');
  assert.ok(syms.includes('SWDA.L'));
  assert.ok(!syms.includes('NEWS1'));
  const l = r.json.results.find(x => x.symbol === 'SWDA.L');
  assert.equal(l.currency, 'GBp');
  assert.ok(l.priceEur > 0);
});
test('quotazioni: input non valido / troppe richieste', async () => {
  assert.equal((await req('POST', '/api/quotes', { cookie: COOKIE, body: { items: [] } })).status, 400);
  const rs = [];
  for (let i = 0; i < 35; i++)
    rs.push(
      (
        await req('POST', '/api/quotes', {
          cookie: COOKIE,
          body: { items: [{ id: 'z', symbol: 'SWDA.MI' }] }
        })
      ).status
    );
  assert.ok(rs.includes(429));
});

/* ---------- STIMA BENI ---------- */
test('stima auto (senza web): campi filtrati, affidabilità max "media", deprezzamento', async () => {
  aiLog = [];
  const r = await req('POST', '/api/ai/estimate-asset', {
    cookie: COOKIE,
    body: {
      kind: 'auto',
      fields: {
        marca: 'Volkswagen',
        modello: 'Golf',
        anno: '2020',
        km: '62000',
        saldo_conto: '99999',
        proprietario: 'Mario Rossi',
        targa: 'AB123CD'
      }
    }
  });
  assert.equal(r.status, 200, r.txt);
  assert.deepEqual([r.json.low, r.json.mid, r.json.high], [15000, 16500, 18000]);
  assert.equal(r.json.confidence, 'media');
  assert.equal(r.json.deprec, 11);
  assert.equal(r.json.web, false);
  assert.equal(r.json.comparables.length, 1);
  assert.doesNotMatch(aiLog[0], /99999|Mario|AB123CD/);
  assert.deepEqual(Object.keys(r.json.sent).sort(), ['anno', 'km', 'marca', 'modello']);
});
test('stima casa: numero civico rimosso, campi obbligatori', async () => {
  aiLog = [];
  let r = await req('POST', '/api/ai/estimate-asset', {
    cookie: COOKIE,
    body: { kind: 'casa', fields: { comune: 'Milano' } }
  });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /mq/);
  r = await req('POST', '/api/ai/estimate-asset', {
    cookie: COOKIE,
    body: { kind: 'casa', fields: { comune: 'Milano', zona: 'Via Roma 12', mq: '85' } }
  });
  assert.equal(r.status, 200);
  assert.doesNotMatch(aiLog[0], /12/);
  assert.equal(r.json.sent.zona, 'Via Roma');
  r = await req('POST', '/api/ai/estimate-asset', { cookie: COOKIE, body: { kind: 'yacht', fields: {} } });
  assert.equal(r.status, 400);
});
test('stima con ricerca web Anthropic: pause_turn gestito, fonti restituite', async () => {
  const APORT = PORT + 5;
  const calls = [];
  const am = http
    .createServer((q, r) => {
      let b = '';
      q.on('data', d => (b += d));
      q.on('end', () => {
        const j = JSON.parse(b);
        calls.push(j);
        r.writeHead(200, { 'content-type': 'application/json' });
        if (calls.length === 1)
          return r.end(
            JSON.stringify({
              stop_reason: 'pause_turn',
              content: [
                {
                  type: 'server_tool_use',
                  id: 's1',
                  name: 'web_search',
                  input: { query: 'golf 2020 usata prezzo' }
                },
                {
                  type: 'web_search_tool_result',
                  tool_use_id: 's1',
                  content: [
                    {
                      type: 'web_search_result',
                      url: 'https://www.autoscout24.it/x',
                      title: 'Golf 2020 annunci',
                      encrypted_content: 'zzz',
                      page_age: 'Nov 2026'
                    }
                  ]
                }
              ]
            })
          );
        r.end(
          JSON.stringify({
            stop_reason: 'end_turn',
            content: [
              {
                type: 'text',
                text: 'Secondo gli annunci la media è 16.800 €.',
                citations: [
                  {
                    type: 'web_search_result_location',
                    url: 'https://www.automobile.it/y',
                    title: 'Automobile.it',
                    cited_text: '...'
                  }
                ]
              },
              {
                type: 'text',
                text: '{"valore_min": 15500, "valore_centrale": 16800, "valore_max": 17900, "affidabilita": "alta", "deprezzamento_annuo_pct": 10, "motivazione": "8 annunci comparabili", "confronti": []}'
              }
            ]
          })
        );
      });
    })
    .listen(APORT, '127.0.0.1');
  const APP = PORT + 6;
  const D2 = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-a-'));
  const p2 = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: {
      ...process.env,
      PORT: String(APP),
      HOST: '127.0.0.1',
      DATA_DIR: D2,
      NODE_NO_WARNINGS: '1',
      AI_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: 'test',
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${APORT}`,
      OPENAI_BASE_URL: '',
      OPENAI_API_KEY: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise(r => p2.stdout.on('data', d => /in ascolto/.test(d) && r()));
  const call = (m, pth, body, cookie) =>
    new Promise(res => {
      const d = body ? Buffer.from(JSON.stringify(body)) : null;
      const rq = http.request(
        `http://127.0.0.1:${APP}${pth}`,
        {
          method: m,
          headers: { 'x-pointofcash': '1', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }
        },
        s => {
          let t = '';
          s.on('data', c => (t += c));
          s.on('end', () =>
            res({
              status: s.statusCode,
              json: JSON.parse(t || '{}'),
              cookie: (s.headers['set-cookie'] || [''])[0].split(';')[0]
            })
          );
        }
      );
      if (d) rq.write(d);
      rq.end();
    });
  try {
    const st = await call('GET', '/api/status');
    assert.equal(st.json.ai_web, true);
    const s1 = await call('POST', '/api/setup', { authKey: authKey('x') });
    const r = await call(
      'POST',
      '/api/ai/estimate-asset',
      { kind: 'auto', fields: { marca: 'VW', modello: 'Golf', anno: '2020' } },
      s1.cookie
    );
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.mid, 16800);
    assert.equal(r.json.confidence, 'alta');
    assert.equal(r.json.web, true);
    assert.equal(r.json.searches, 1);
    assert.deepEqual(r.json.sources.map(x => x.url).sort(), [
      'https://www.automobile.it/y',
      'https://www.autoscout24.it/x'
    ]);
    assert.equal(calls.length, 2, 'ripresa dopo pause_turn');
    assert.equal(calls[0].tools[0].type, 'web_search_20250305');
    assert.ok(calls[0].tools[0].allowed_domains.includes('autoscout24.it'));
    assert.equal(calls[1].messages[1].role, 'assistant');
    assert.equal(calls[1].messages[1].content[1].content[0].encrypted_content, 'zzz');
  } finally {
    p2.kill();
    am.close();
    fs.rmSync(D2, { recursive: true, force: true });
  }
});

/* ---------- MCP ---------- */
let TOKEN;
const mcp = (body, tok = TOKEN) =>
  req('POST', '/mcp', { body, headers: { authorization: 'Bearer ' + tok, 'x-pointofcash': '' } });
test('MCP: senza token / token sbagliato → 401', async () => {
  let r = await mcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'nulla');
  assert.equal(r.status, 401);
  const t = await req('POST', '/api/mcp-token', { cookie: COOKIE });
  TOKEN = t.json.token;
  assert.match(TOKEN, /^poc_/);
  r = await mcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, TOKEN + 'x');
  assert.equal(r.status, 401);
});
test('MCP: solo strumenti di scrittura, nessun dato in risposta', async () => {
  const r = await mcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.deepEqual(r.json.result.tools.map(t => t.name).sort(), ['aggiungi_movimento', 'elenca_categorie']);
  const init = await mcp({
    jsonrpc: '2.0',
    id: 0,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18' }
  });
  assert.equal(init.json.result.serverInfo.name, 'eyecash');
  const notif = await mcp({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(notif.status, 202);
});
test("MCP: senza chiave pubblica dell'app → errore chiaro, nessun salvataggio", async () => {
  const r = await mcp({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'aggiungi_movimento', arguments: { importo: 5, descrizione: 'x' } }
  });
  assert.equal(r.json.result.isError, true);
  assert.match(r.json.result.content[0].text, /Apri EyeCash/);
});
let PRIV;
test("MCP: movimento salvato CIFRATO e decifrabile solo con la chiave dell'app", async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  PRIV = privateKey;
  const jwk = publicKey.export({ format: 'jwk' });
  assert.equal((await req('PUT', '/api/inbox-key', { cookie: COOKIE, body: { jwk } })).status, 200);
  const r = await mcp({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'aggiungi_movimento',
      arguments: { importo: 12.345, descrizione: 'Benzina Q8 IT60X0542811101000000123456', conto: 'carta' }
    }
  });
  assert.match(r.json.result.content[0].text, /12,35 €/);
  const ib = await req('GET', '/api/inbox', { cookie: COOKIE });
  assert.equal(ib.json.items.length, 1);
  const enc = ib.json.items[0].enc;
  assert.doesNotMatch(enc, /Benzina/);
  const o = JSON.parse(enc);
  const key = crypto.privateDecrypt(
    { key: PRIV, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(o.ek, 'base64')
  );
  const ct = Buffer.from(o.ct, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(o.iv, 'base64'));
  d.setAuthTag(ct.subarray(ct.length - 16));
  const x = JSON.parse(Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]).toString());
  assert.equal(x.amount, 12.35);
  assert.equal(x.desc, 'Benzina Q8 [IBAN]');
  assert.equal(x.type, 'uscita');
  assert.match(x.date, /^\d{4}-\d{2}-\d{2}$/);
  await req('POST', '/api/inbox/ack', { cookie: COOKIE, body: { ids: [ib.json.items[0].id] } });
  assert.equal((await req('GET', '/api/inbox', { cookie: COOKIE })).json.items.length, 0);
});
test('MCP: input non validi rifiutati', async () => {
  for (const args of [
    { importo: -5, descrizione: 'x' },
    { importo: 'abc', descrizione: 'x' },
    { importo: 5, descrizione: '' },
    { importo: 1e9, descrizione: 'x' }
  ]) {
    const r = await mcp({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'aggiungi_movimento', arguments: args }
    });
    assert.equal(r.json.result.isError, true, JSON.stringify(args));
  }
  const r = await mcp({ jsonrpc: '2.0', id: 5, method: 'resources/list' });
  assert.equal(r.json.error.code, -32601);
});
test('MCP: data predefinita = oggi nel fuso orario italiano', async () => {
  await mcp({
    jsonrpc: '2.0',
    id: 6,
    method: 'tools/call',
    params: { name: 'aggiungi_movimento', arguments: { importo: 1, descrizione: 'tz' } }
  });
  const ib = await req('GET', '/api/inbox', { cookie: COOKIE });
  const o = JSON.parse(ib.json.items.at(-1).enc);
  const key = crypto.privateDecrypt(
    { key: PRIV, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(o.ek, 'base64')
  );
  const ct = Buffer.from(o.ct, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(o.iv, 'base64'));
  d.setAuthTag(ct.subarray(ct.length - 16));
  const x = JSON.parse(Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]).toString());
  const rome = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(new Date());
  assert.equal(x.date, rome);
});
test('MCP: token revocato smette di funzionare', async () => {
  await req('DELETE', '/api/mcp-token', { cookie: COOKIE });
  const r = await mcp({ jsonrpc: '2.0', id: 7, method: 'tools/list' });
  assert.equal(r.status, 401);
});
test('logout invalida la sessione', async () => {
  const l = await req('POST', '/api/login', { body: { authKey: authKey('pw') } });
  assert.equal((await req('GET', '/api/state', { cookie: l.cookie })).status, 200);
  await req('POST', '/api/logout', { cookie: l.cookie });
  assert.equal((await req('GET', '/api/state', { cookie: l.cookie })).status, 401);
});
test('blocco tentativi: dopo 10 errori → 429 anche con password giusta', async () => {
  for (let i = 0; i < 10; i++) await req('POST', '/api/login', { body: { authKey: authKey('no' + i) } });
  const r = await req('POST', '/api/login', { body: { authKey: authKey('pw') } });
  assert.equal(r.status, 429);
});
test('stress: 300 richieste parallele, il server resta su', async () => {
  const t0 = Date.now();
  const rs = await Promise.all(
    Array.from({ length: 300 }, (_, i) => req('GET', i % 2 ? '/api/status' : '/js/main.js'))
  );
  assert.ok(rs.every(r => r.status === 200));
  assert.ok(Date.now() - t0 < 15000);
});
test('restore da backup tramite CLI', async () => {
  const f = fs.readdirSync(path.join(DATA, 'backups'))[0];
  srv.kill();
  await new Promise(r => setTimeout(r, 300));
  const { execFileSync } = require('node:child_process');
  const out = execFileSync(
    process.execPath,
    [path.join(ROOT, 'server.js'), 'restore', path.join(DATA, 'backups', f)],
    { env: { ...process.env, DATA_DIR: DATA, NODE_NO_WARNINGS: '1' } }
  ).toString();
  assert.match(out, /ripristinato/);
  await startServer();
  const st = await req('GET', '/api/status');
  assert.equal(st.json.setup, true);
});
