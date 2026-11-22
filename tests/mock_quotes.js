const http = require('http');
let qmock,
  qLog = [];
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
        if ((m = u.pathname.match(/^\/v8\/finance\/chart\/(.+)$/))) {
          const sym = decodeURIComponent(m[1]);
          const c = CHART[sym];
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
      .listen(8098, '127.0.0.1', res);
  });
}

startQuoteMock().then(() => console.log('qmock ok'));
