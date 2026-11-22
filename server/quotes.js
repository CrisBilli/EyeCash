'use strict';
/*
 * EyeCash · server/quotes.js
 *
 * Investment prices from public sources (Yahoo Finance, justETF, Stooq, Kraken,
 * CoinGecko) with ECB exchange rates and cross-checks. Only tickers/ISINs leave the
 * server, mixed with decoy symbols, never quantities or values.
 */

/* ---------- PRICES: several sources, ECB exchange rates, cross-checks ----------
 * Only instrument SYMBOLS leave (mixed with common instruments). Never quantities or values.
 * ETFs/stocks: Yahoo Finance (primary) + Stooq (check, where the same listing exists).
 * Crypto: Kraken (official public API) + CoinGecko (check).
 * Exchange rates: ECB (official reference rates).                           */
const QUOTES_ON = process.env.QUOTES_ENABLED !== 'false';
const Q_URL = {
  yahoo: (process.env.YAHOO_URLS || 'https://query1.finance.yahoo.com,https://query2.finance.yahoo.com')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
  stooq: process.env.STOOQ_URL || 'https://stooq.com',
  kraken: process.env.KRAKEN_URL || 'https://api.kraken.com',
  coingecko: process.env.COINGECKO_URL || 'https://api.coingecko.com',
  ecb: process.env.ECB_URL || 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'
};
const Q_UA =
  process.env.QUOTES_UA ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const JUSTETF_URL = process.env.JUSTETF_URL || 'https://www.justetf.com';
const YAHOO_COOKIE_URL = process.env.YAHOO_COOKIE_URL || 'https://fc.yahoo.com';
const DECOY_ISINS = [
  'IE00B4L5Y983',
  'IE00BK5BQT80',
  'IE00B5BMR087',
  'LU0908500753',
  'IE00B3RBWM25',
  'IE00BKM4GZ66'
];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DECOYS = [
  'VWCE.DE',
  'IWDA.AS',
  'CSPX.L',
  'SPY',
  'AAPL',
  'MSFT',
  'EUNL.DE',
  'VUSA.L',
  'ENI.MI',
  'ISP.MI',
  'QQQ',
  'XDWD.DE'
];
const CG_IDS = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  XRP: 'ripple',
  ADA: 'cardano',
  DOGE: 'dogecoin',
  DOT: 'polkadot',
  LTC: 'litecoin',
  LINK: 'chainlink',
  AVAX: 'avalanche-2',
  MATIC: 'matic-network',
  POL: 'polygon-ecosystem-token',
  USDT: 'tether',
  USDC: 'usd-coin',
  BNB: 'binancecoin',
  TRX: 'tron',
  ATOM: 'cosmos',
  XLM: 'stellar'
};
const TOL = { crypto: 0.03, other: 0.02 };
const qCache = new Map(); // chiave → {t, v}
async function qFetch(url, as = 'json') {
  const r = await fetch(url, {
    headers: { 'user-agent': Q_UA, accept: as === 'json' ? 'application/json,*/*' : 'text/csv,text/xml,*/*' },
    signal: AbortSignal.timeout(10000)
  });
  if (!r.ok) throw new Error(`${new URL(url).host} HTTP ${r.status}`);
  return as === 'json' ? r.json() : r.text();
}
async function cached(key, ms, fn) {
  const c = qCache.get(key);
  if (c && Date.now() - c.t < ms) return c.v;
  const v = await fn();
  qCache.set(key, { t: Date.now(), v });
  if (qCache.size > 500) qCache.delete(qCache.keys().next().value);
  return v;
}
/* ECB rates: EUR → currency */
async function ecbRates() {
  return cached('ecb', 6 * 36e5, async () => {
    const x = await qFetch(Q_URL.ecb, 'text');
    const rates = { EUR: 1 };
    for (const m of x.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) rates[m[1]] = +m[2];
    const date = (x.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/) || [])[1];
    if (!(rates.USD > 0)) throw new Error('Cambi BCE non disponibili');
    return { rates, date };
  });
}
function toEUR(price, cur, rates) {
  let c = cur || 'EUR',
    p = price;
  if (c === 'GBp' || c === 'GBX') {
    p /= 100;
    c = 'GBP';
  } // London Stock Exchange quotes in pence
  if (c === 'ZAc') {
    p /= 100;
    c = 'ZAR';
  }
  if (c === 'ILA') {
    p /= 100;
    c = 'ILS';
  }
  if (c === 'EUR') return p;
  if (!(rates[c] > 0)) throw new Error('Valuta non supportata: ' + cur);
  return p / rates[c];
}
const cleanSym = s =>
  String(s || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.\-=^]/g, '')
    .slice(0, 20);
/* --- Yahoo Finance: sometimes answers 401/429 without a session → cookie + "crumb", then back off if it insists --- */
let yAuth = null,
  yAuthAt = 0;
const yBlocked = {};
async function yahooAuth() {
  if (yAuth && Date.now() - yAuthAt < 30 * 6e4) return yAuth;
  const r = await fetch(YAHOO_COOKIE_URL, {
    headers: { 'user-agent': Q_UA, accept: 'text/html,*/*', 'accept-language': 'en-US,en;q=0.9' },
    redirect: 'manual',
    signal: AbortSignal.timeout(10000)
  });
  const ck = (r.headers.getSetCookie ? r.headers.getSetCookie() : [])
    .map(c => c.split(';')[0])
    .filter(Boolean)
    .join('; ');
  if (!ck) throw new Error('Yahoo: sessione non disponibile');
  const c = await fetch(`${Q_URL.yahoo[Q_URL.yahoo.length - 1]}/v1/test/getcrumb`, {
    headers: { 'user-agent': Q_UA, cookie: ck, accept: 'text/plain,*/*' },
    signal: AbortSignal.timeout(10000)
  });
  const crumb = (await c.text()).trim();
  if (!c.ok || !crumb || crumb.length > 40 || /[<{\s]/.test(crumb))
    throw new Error('Yahoo: sessione non disponibile');
  yAuth = { ck, crumb };
  yAuthAt = Date.now();
  return yAuth;
}
async function yFetch(url) {
  const host = new URL(url).host;
  if (Date.now() < (yBlocked[host] || 0))
    throw new Error('Yahoo Finance: troppe richieste, riprovo tra qualche minuto');
  const base = { 'user-agent': Q_UA, accept: 'application/json,*/*', 'accept-language': 'en-US,en;q=0.9' };
  let r = await fetch(url, { headers: base, signal: AbortSignal.timeout(10000) });
  if (r.status === 401 || r.status === 429) {
    try {
      const a = await yahooAuth();
      r = await fetch(url + (url.includes('?') ? '&' : '?') + 'crumb=' + encodeURIComponent(a.crumb), {
        headers: { ...base, cookie: a.ck },
        signal: AbortSignal.timeout(10000)
      });
      if (r.status === 401) yAuth = null;
    } catch (e) {
      /* keep the original response */
    }
  }
  if (r.status === 429) {
    yBlocked[host] =
      Date.now() + (process.env.YAHOO_BLOCK_MS != null ? +process.env.YAHOO_BLOCK_MS : 5 * 6e4);
    throw new Error('Yahoo Finance: troppe richieste (HTTP 429)');
  }
  if (!r.ok && r.status !== 404) throw new Error(`${host} HTTP ${r.status}`);
  return r.json();
}
/* --- justETF: ETF prices by ISIN (Xetra, in EUR). Second source and fallback when Yahoo does not answer --- */
const isIsin = s => /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(s || '');
async function justetf(isin) {
  return cached('j:' + isin, 10 * 6e4, async () => {
    const j = await qFetch(`${JUSTETF_URL}/api/etfs/${isin}/quote?locale=en&currency=EUR&isin=${isin}`);
    const p = j && j.latestQuote && +j.latestQuote.raw;
    if (!(p > 0)) throw new Error('justETF: prezzo assente');
    const d = Date.parse((j.latestQuoteDate || '') + 'T16:30:00Z');
    return {
      price: p,
      currency: 'EUR',
      time: Math.min(Date.now(), d || Date.now()),
      exchange: 'justETF · ' + (j.quoteTradingVenue || 'Xetra')
    };
  });
}
async function yahooChart(sym) {
  return cached('y:' + sym, 10 * 6e4, async () => {
    let last;
    for (const host of Q_URL.yahoo) {
      try {
        const j = await yFetch(`${host}/v8/finance/chart/${encodeURIComponent(sym)}?range=5d&interval=1d`);
        const r = j && j.chart && j.chart.result && j.chart.result[0];
        if (!r)
          throw new Error(
            (j && j.chart && j.chart.error && j.chart.error.description) || 'titolo non trovato'
          );
        const m = r.meta || {};
        const closes = (((r.indicators || {}).quote || [])[0] || {}).close || [];
        const lastClose = closes.filter(v => v > 0).pop();
        const price = m.regularMarketPrice > 0 ? m.regularMarketPrice : lastClose;
        if (!(price > 0)) throw new Error('prezzo assente');
        return {
          price,
          currency: m.currency,
          time: (m.regularMarketTime || 0) * 1000,
          exchange: m.fullExchangeName || m.exchangeName || '',
          name: m.longName || m.shortName || '',
          lastClose
        };
      } catch (e) {
        last = e;
      }
    }
    throw last;
  });
}
async function yahooSearch(q) {
  const host = Q_URL.yahoo[Q_URL.yahoo.length - 1];
  const j = await yFetch(
    `${host}/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=12&newsCount=0&listsCount=0`
  );
  return (j.quotes || [])
    .filter(x => x.symbol && ['ETF', 'EQUITY', 'MUTUALFUND', 'CRYPTOCURRENCY', 'INDEX'].includes(x.quoteType))
    .map(x => ({
      symbol: x.symbol,
      name: x.longname || x.shortname || x.symbol,
      exchange: x.exchDisp || x.exchange || '',
      kind: x.typeDisp || x.quoteType
    }));
}
/* --- Stooq (check for .DE and US listings) --- */
function stooqSym(sym) {
  if (/\.DE$/.test(sym)) return { s: sym.slice(0, -3).toLowerCase() + '.de', cur: 'EUR' };
  if (/^[A-Z]{1,5}$/.test(sym)) return { s: sym.toLowerCase() + '.us', cur: 'USD' };
  return null;
}
async function stooq(sym) {
  const m = stooqSym(sym);
  if (!m) return null;
  return cached('s:' + sym, 10 * 6e4, async () => {
    const csv = await qFetch(`${Q_URL.stooq}/q/l/?s=${m.s}&f=sd2t2ohlcv&h&e=csv`, 'text');
    const lines = csv.trim().split(/\r?\n/);
    if (lines.length < 2) throw new Error('stooq vuoto');
    const h = lines[0].toLowerCase().split(','),
      v = lines[1].split(',');
    const close = parseFloat(v[h.indexOf('close')]);
    const date = v[h.indexOf('date')],
      time = v[h.indexOf('time')] || '00:00:00';
    if (!(close > 0)) throw new Error('stooq: nessun prezzo');
    return { price: close, currency: m.cur, time: Date.parse(`${date}T${time}Z`) || Date.now() };
  });
}
/* --- Crypto --- */
async function kraken(sym) {
  return cached('k:' + sym, 2 * 6e4, async () => {
    const pair = (sym === 'BTC' ? 'XBT' : sym) + 'EUR';
    const j = await qFetch(`${Q_URL.kraken}/0/public/Ticker?pair=${pair}`);
    if (j.error && j.error.length) throw new Error('Kraken: ' + j.error[0]);
    const k = Object.keys(j.result || {})[0];
    const p = k && parseFloat(j.result[k].c[0]);
    if (!(p > 0)) throw new Error('Kraken: prezzo assente');
    return { price: p, currency: 'EUR', time: Date.now(), exchange: 'Kraken' };
  });
}
async function coingecko(sym) {
  const id = CG_IDS[sym];
  if (!id) return null;
  return cached('c:' + sym, 2 * 6e4, async () => {
    const j = await qFetch(
      `${Q_URL.coingecko}/api/v3/simple/price?ids=${id}&vs_currencies=eur&include_last_updated_at=true`
    );
    const p = j[id] && j[id].eur;
    if (!(p > 0)) throw new Error('CoinGecko: prezzo assente');
    return { price: p, currency: 'EUR', time: (j[id].last_updated_at || 0) * 1000 || Date.now() };
  });
}
/* --- decision for one instrument --- */
async function quoteOne(it, rates) {
  const sym = cleanSym(it.symbol);
  const isCrypto = it.type === 'Crypto';
  const out = { id: it.id, symbol: sym, ok: false };
  if (!sym) return { ...out, error: 'Simbolo mancante' };
  const isin = String(it.isin || '').toUpperCase();
  const useJ = !isCrypto && (it.type === 'ETF' || it.type === 'Fondi') && isIsin(isin);
  let [p, s, jx] = await Promise.all([
    (isCrypto ? kraken(sym) : yahooChart(sym)).then(
      v => v,
      e => ({ err: e.message })
    ),
    (isCrypto ? coingecko(sym) : stooq(sym)).then(
      v => v,
      e => ({ err: e.message })
    ),
    useJ
      ? justetf(isin).then(
          v => v,
          e => ({ err: e.message })
        )
      : null
  ]);
  const srcP = isCrypto ? 'Kraken' : 'Yahoo Finance';
  let srcS = isCrypto ? 'CoinGecko' : 'Stooq';
  const good = x => x && !x.err && x.price > 0;
  if (!good(s) && good(jx)) {
    s = jx;
    srcS = 'justETF';
  }
  if (!good(p) && !good(s))
    return { ...out, error: (p && p.err) || (s && s.err) || 'Nessuna fonte disponibile' };
  const main = good(p) ? p : s;
  const second = good(p) && good(s) ? s : null;
  let eur, eur2;
  try {
    eur = toEUR(main.price, main.currency, rates);
    if (second) eur2 = toEUR(second.price, second.currency, rates);
  } catch (e) {
    return { ...out, error: e.message };
  }
  const ageH = (Date.now() - (main.time || 0)) / 36e5;
  const stale = isCrypto ? ageH > 2 : ageH > 24 * 6; // more than 6 days old = probably suspended or wrong symbol
  let check = second ? 'two' : 'one';
  if (second && Math.abs(eur - eur2) / eur > (isCrypto ? TOL.crypto : TOL.other)) check = 'mismatch';
  return {
    ...out,
    ok: true,
    priceEur: Math.round(eur * 10000) / 10000,
    priceNative: main.price,
    currency: main.currency,
    time: main.time,
    exchange: main.exchange || '',
    name: main.name || '',
    source: good(p) ? srcP : srcS,
    check,
    check2: second ? { source: srcS, priceEur: Math.round(eur2 * 10000) / 10000 } : null,
    stale,
    warn: good(p) ? null : `${srcP} non disponibile: usato ${srcS}`
  };
}
/* --- monthly price history (last price of each month, in €). Only ISINs/symbols leave, plus cover instruments --- */
function monthlyLast(points) {
  // points: [[ms, price]]
  const out = {};
  for (const [t, v] of points)
    if (v > 0 && t > 0) {
      const d = new Date(t);
      const k = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
      out[k] = +(+v).toFixed(5);
    }
  return out;
}
async function justetfHistory(isin) {
  return cached('jh:' + isin, 12 * 36e5, async () => {
    const j = await qFetch(
      `${JUSTETF_URL}/api/etfs/${isin}/performance-chart?locale=en&currency=EUR&valuesType=MARKET_VALUE&reduceData=true&includeDividends=false`
    );
    const s = j && Array.isArray(j.series) ? j.series : [];
    const pts = s
      .map(x => [Date.parse((x.date || '') + 'T12:00:00Z'), x.value && +x.value.raw])
      .filter(x => x[0] && x[1] > 0);
    if (pts.length < 2) throw new Error('justETF: storico assente');
    return { months: monthlyLast(pts), source: 'justETF', approx: false };
  });
}
async function yahooHistory(sym, rates) {
  return cached('yh:' + sym, 12 * 36e5, async () => {
    let last;
    for (const host of Q_URL.yahoo) {
      try {
        const j = await yFetch(`${host}/v8/finance/chart/${encodeURIComponent(sym)}?range=10y&interval=1mo`);
        const r = j && j.chart && j.chart.result && j.chart.result[0];
        if (!r) throw new Error('titolo non trovato');
        const ts = r.timestamp || [],
          cl =
            (((r.indicators || {}).adjclose || [])[0] || {}).adjclose ||
            (((r.indicators || {}).quote || [])[0] || {}).close ||
            [];
        let cur = String((r.meta || {}).currency || 'EUR'),
          div = 1;
        if (cur === 'GBp' || cur === 'GBX') {
          cur = 'GBP';
          div = 100;
        }
        const fx = cur === 'EUR' ? 1 : rates[cur.toUpperCase()];
        if (!(fx > 0)) throw new Error('valuta non gestita');
        const pts = ts.map((t, i) => [t * 1000, cl[i] > 0 ? cl[i] / div / fx : 0]);
        if (pts.filter(p => p[1] > 0).length < 2) throw new Error('storico assente');
        return { months: monthlyLast(pts), source: 'Yahoo Finance', approx: cur !== 'EUR' }; // today's exchange rate: estimated values
      } catch (e) {
        last = e;
      }
    }
    throw last;
  });
}
async function historyBatch(items) {
  const { rates } = await ecbRates();
  const out = [];
  for (const it of items.slice(0, 40)) {
    const isin = String(it.isin || '').toUpperCase(),
      sym = cleanSym(it.symbol || '');
    const etf = (it.type === 'ETF' || it.type === 'Fondi') && isIsin(isin);
    let r = null,
      err = '';
    if (etf)
      r = await justetfHistory(isin).catch(e => {
        err = e.message;
        return null;
      });
    if (!r && sym)
      r = await yahooHistory(sym, rates).catch(e => {
        err = e.message;
        return null;
      });
    out.push(r ? { id: it.id, ok: true, ...r } : { id: it.id, ok: false, error: err || 'nessuna fonte' });
    await sleep(200);
  }
  (async () => {
    // decoys: the same requests for common instruments, results discarded
    for (const d of DECOY_ISINS.filter(d => !items.some(i => String(i.isin || '').toUpperCase() === d))
      .sort(() => Math.random() - 0.5)
      .slice(0, 2)) {
      await sleep(300);
      await justetfHistory(d).catch(() => null);
    }
    for (const d of DECOYS.filter(d => !items.some(i => cleanSym(i.symbol || '') === d))
      .sort(() => Math.random() - 0.5)
      .slice(0, 1)) {
      await sleep(300);
      await yahooHistory(d, rates).catch(() => null);
    }
  })();
  return { results: out };
}
async function quoteBatch(items) {
  const { rates, date } = await ecbRates();
  const real = items.slice(0, 60);
  const decoys = DECOYS.filter(d => !real.some(r => cleanSym(r.symbol) === d))
    .sort(() => Math.random() - 0.5)
    .slice(0, 3);
  const res = [];
  for (let i = 0; i < real.length; i += 3) {
    // in small groups: no bursts that trigger rate limits
    if (i) await sleep(250);
    res.push(...(await Promise.all(real.slice(i, i + 3).map(it => quoteOne(it, rates)))));
  }
  (async () => {
    // decoys: results discarded
    for (const d of decoys) {
      await sleep(300);
      await yahooChart(d).catch(() => null);
    }
    if (real.some(r => isIsin(String(r.isin || '').toUpperCase())))
      for (const d of DECOY_ISINS.filter(d => !real.some(r => String(r.isin || '').toUpperCase() === d))
        .sort(() => Math.random() - 0.5)
        .slice(0, 2)) {
        await sleep(300);
        await justetf(d).catch(() => null);
      }
  })();
  return { fxDate: date, results: res };
}
async function searchListings(q) {
  const clean = String(q || '')
    .trim()
    .slice(0, 40);
  if (!clean) return [];
  const { rates } = await ecbRates();
  const isCryptoSym = /^[A-Z]{2,6}$/i.test(clean) && CG_IDS[clean.toUpperCase()];
  const out = [];
  if (isCryptoSym) {
    const r = await quoteOne({ symbol: clean.toUpperCase(), type: 'Crypto' }, rates);
    if (r.ok)
      out.push({
        symbol: r.symbol,
        name: clean.toUpperCase() + ' (crypto)',
        exchange: 'Kraken',
        kind: 'Crypto',
        type: 'Crypto',
        currency: 'EUR',
        priceEur: r.priceEur,
        priceNative: r.priceNative,
        time: r.time
      });
  }
  let found = [];
  try {
    found = await yahooSearch(clean);
  } catch (e) {
    if (!out.length) throw e;
  }
  const detail = await Promise.all(
    found.slice(0, 8).map(async f => {
      try {
        const c = await yahooChart(f.symbol);
        return {
          ...f,
          type:
            f.kind === 'ETF'
              ? 'ETF'
              : /crypto/i.test(f.kind)
                ? 'Crypto'
                : /fund/i.test(f.kind)
                  ? 'Fondi'
                  : 'Azioni',
          currency: c.currency,
          priceNative: c.price,
          priceEur: Math.round(toEUR(c.price, c.currency, rates) * 10000) / 10000,
          time: c.time,
          exchange: c.exchange || f.exchange
        };
      } catch {
        return null;
      }
    })
  );
  out.push(...detail.filter(Boolean));
  const rank = x => (x.currency === 'EUR' ? 0 : 2) + (/milan|italian/i.test(x.exchange) ? -1 : 0);
  return out.sort((a, b) => rank(a) - rank(b));
}
const quoteCalls = [];

module.exports = {
  QUOTES_ON,
  ecbRates,
  historyBatch,
  isIsin,
  quoteBatch,
  quoteCalls,
  quoteOne,
  searchListings
};
