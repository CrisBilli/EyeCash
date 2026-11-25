'use strict';
/* Test del motore di calcolo: node --test tests/engine.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../public/engine.js');
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} atteso ${b}, ottenuto ${a}`);
const base = {
  age: 40,
  endAge: 90,
  mode: 'age',
  retireAge: 60,
  spending: 20000,
  saving: 0,
  start: 500000,
  basis: 500000,
  weights: { azioni: 100 },
  ret: { azioni: { mu: 5, sd: 16 } },
  infl: { mu: 2, sd: 1 },
  swr: 4,
  taxRate: 26,
  runs: 1500,
  seed: 7
};

test('deterministico: accumulo = calcolo esatto a mano', () => {
  const p = {
    ...base,
    mode: 'age',
    retireAge: 99,
    endAge: 50,
    start: 100000,
    basis: 100000,
    saving: 1000,
    ret: { azioni: { mu: 5, sd: 0 } },
    infl: { mu: 2, sd: 0 },
    runs: 3
  };
  const r = E.simulate(p);
  let pf = 100000,
    price = 1;
  for (let y = 0; y < 10; y++) {
    pf += 12000 * price;
    pf *= 1.05;
    price *= 1.02;
  }
  near(r.bands.p50[10], pf / price, 0.01, 'valore reale a 50 anni');
  assert.equal(r.success, 1);
});
test('deterministico: esaurimento esatto (spesa 20k, rendimento e inflazione 0)', () => {
  const r = E.simulate({
    ...base,
    age: 60,
    endAge: 90,
    retireAge: 60,
    start: 100000,
    basis: 100000,
    ret: { azioni: { mu: 0, sd: 0 } },
    infl: { mu: 0, sd: 0 },
    runs: 2
  });
  assert.equal(r.success, 0);
  assert.equal(r.ruinAgeMedian, 64); // 100k / 20k → anni 60..63 pagati, a 64 non basta
});
test('tasse sui prelievi: con plusvalenze il capitale dura meno', () => {
  const p = {
    ...base,
    age: 60,
    endAge: 95,
    retireAge: 60,
    start: 400000,
    ret: { azioni: { mu: 3, sd: 0 } },
    infl: { mu: 2, sd: 0 },
    runs: 2
  };
  const noGain = E.simulate({ ...p, basis: 400000 }),
    bigGain = E.simulate({ ...p, basis: 100000 });
  assert.ok(bigGain.bands.p50[20] < noGain.bands.p50[20]);
});
test('numero FIRE = spesa netta / tasso di prelievo', () => {
  assert.equal(E.simulate({ ...base, runs: 10, spending: 30000, swr: 3.5 }).fireNumber, 30000 / 0.035);
  assert.equal(
    E.simulate({ ...base, runs: 10, spending: 30000, swr: 4, sideIncome: { amount: 6000, untilAge: 65 } })
      .fireNumber,
    24000 / 0.04
  );
});
test('riproducibile con lo stesso seme, diverso con altro seme', () => {
  const a = E.simulate(base),
    b = E.simulate(base),
    c = E.simulate({ ...base, seed: 99 });
  assert.equal(a.success, b.success);
  assert.deepEqual(a.bands.p50, b.bands.p50);
  assert.notDeepEqual(a.bands.p50, c.bands.p50);
});
test('più spesa → meno probabilità di successo (monotonia)', () => {
  const s = [15000, 25000, 35000, 50000].map(sp => E.simulate({ ...base, spending: sp }).success);
  for (let i = 1; i < s.length; i++) assert.ok(s[i] <= s[i - 1], s.join(' '));
  assert.ok(s[0] > 0.6 && s[3] < 0.3 && s[0] - s[3] > 0.4, s.join(' '));
});
test('rendimento medio simulato ≈ ipotesi (6% ± 0,6)', () => {
  const r = E.simulate({
    ...base,
    age: 30,
    endAge: 31,
    retireAge: 99,
    start: 100000,
    ret: { azioni: { mu: 6, sd: 16 } },
    infl: { mu: 0, sd: 0 },
    runs: 20000
  });
  // media della crescita nominale in un anno
  let s = 0;
  const R = E.rng(1); // ricalcolo indipendente non serve: uso le bande
  near(r.bands.p50[1] / 100000 - 1, 0.06, 0.03, 'mediana');
});
test('code grasse: crolli oltre −2σ più frequenti che con la normale', () => {
  const p = {
    ...base,
    age: 30,
    endAge: 31,
    retireAge: 99,
    start: 100000,
    ret: { azioni: { mu: 0, sd: 20 } },
    infl: { mu: 0, sd: 0 },
    runs: 40000
  };
  const r = E.simulate(p);
  // percentile 1% con t(5) scalata è più estremo di −2,33σ della normale
  const res = [];
  const R = E.rng(3);
  const tail = r.bands.p10[1] / 100000 - 1;
  assert.ok(tail < -0.2 && tail > -0.35, 'p10 ' + tail);
});
test('scenari di stress peggiorano il successo', () => {
  const p = { ...base, start: 600000, spending: 24000, runs: 1200 };
  const n = E.simulate(p).success,
    c = E.simulate({ ...p, shock: 'crash' }).success,
    l = E.simulate({ ...p, shock: 'lostdecade' }).success,
    st = E.simulate({ ...p, shock: 'stagflation' }).success;
  assert.ok(c < n && l < n && st < n, [n, c, l, st].join(' '));
});
test('modalità "appena raggiungo il numero FIRE": età FIRE e versamenti', () => {
  const r = E.simulate({
    ...base,
    mode: 'fire',
    age: 30,
    endAge: 90,
    start: 50000,
    saving: 2000,
    spending: 24000,
    swr: 4,
    maxWorkAge: 70
  });
  assert.ok(r.fireAge && r.fireAge.p50 > 35 && r.fireAge.p50 < 60, JSON.stringify(r.fireAge));
  assert.ok(r.fireAge.p10 <= r.fireAge.p50 && r.fireAge.p50 <= r.fireAge.p90);
});
test('età FIRE conta solo chi raggiunge davvero il numero (non chi smette per limite di età)', () => {
  const r = E.simulate({
    ...base,
    mode: 'fire',
    age: 30,
    endAge: 90,
    start: 10000,
    saving: 100,
    spending: 60000,
    swr: 3.5,
    maxWorkAge: 65,
    runs: 500
  });
  assert.ok(r.reached < 0.05, 'raggiunto ' + r.reached);
});
test('spesa sostenibile a età di ritiro fissa cresce con il capitale', () => {
  const p = { ...base, runs: 400 };
  const a = E.safeSpending({ ...p, start: 300000 }),
    b = E.safeSpending({ ...p, start: 600000 });
  assert.ok(b > a * 1.6 && a > 3000, a + ' ' + b);
});
test('pensione e spesa flessibile aumentano il successo', () => {
  const p = { ...base, start: 500000, spending: 30000 };
  const a = E.simulate(p).success,
    b = E.simulate({ ...p, pension: { amount: 15000, fromAge: 67 } }).success,
    c = E.simulate({ ...p, flex: { on: true, drop: 20, cut: 15 } }).success;
  assert.ok(b > a && c > a, [a, b, c].join(' '));
});
test('spesa sostenibile al 90%: successo ≈ 90%', () => {
  const p = { ...base, runs: 600 };
  const s = E.safeSpending(p, 0.9);
  const r = E.simulate({ ...p, spending: s, runs: 600 });
  assert.ok(r.success >= 0.88, r.success + ' @ ' + s);
  assert.ok(E.simulate({ ...p, spending: s * 1.15, runs: 600 }).success < 0.9);
});
test('Coast FIRE e rendimento atteso', () => {
  near(E.coastNumber(1000000, 20, 4), 1000000 / Math.pow(1.04, 20), 0.01);
  near(E.expectedReturn({ azioni: 80, obbligazioni: 20 }, {}), 0.8 * 7 + 0.2 * 3, 1e-9);
});
test('Cholesky della matrice completa delle 6 classi', () => {
  const L = E.cholesky(E.CK.map(a => E.CK.map(b => E.corr(a, b))));
  for (let i = 0; i < 6; i++)
    for (let j = 0; j < 6; j++) {
      let s = 0;
      for (let k = 0; k < 6; k++) s += L[i][k] * L[j][k];
      near(s, E.corr(E.CK[i], E.CK[j]), 0.05);
    }
});

/* ---------- tasse italiane ---------- */
const Z = [
  { year: 2024, amount: 600, bucket: 'diversi' },
  { year: 2021, amount: 5000, bucket: 'diversi' },
  { year: 2025, amount: 500, bucket: 'crypto' }
];
test('ETF: plusvalenza tassata al 26% anche con zainetto pieno', () => {
  const t = E.taxOnSales(
    [{ taxClass: 'etf', gain: 1000 }],
    [{ year: 2025, amount: 1000, bucket: 'diversi' }],
    2026
  );
  assert.equal(t.tax, 260);
  assert.equal(t.zainettoUsed, 0);
});
test('Azioni: zainetto valido usato, quello scaduto no', () => {
  const t = E.taxOnSales([{ taxClass: 'azioni', gain: 1000 }], Z, 2026);
  assert.equal(t.zainettoUsed, 600);
  assert.equal(t.tax, 104); // (1000-600) × 26%
  assert.equal(E.zainettoExpiry(2021), 2025);
});
test('Titoli di Stato: 12,5% e compensazione al 48,08%', () => {
  assert.equal(E.taxOnSales([{ taxClass: 'stato', gain: 1000 }], [], 2026).tax, 125);
  const t = E.taxOnSales(
    [{ taxClass: 'stato', gain: 1000 }],
    [{ year: 2025, amount: 1000, bucket: 'diversi' }],
    2026
  );
  assert.equal(t.tax, 0);
  assert.equal(t.zainettoUsed, 480.8);
});
test('Crypto: 33% e solo minusvalenze crypto', () => {
  assert.equal(
    E.taxOnSales([{ taxClass: 'crypto', gain: 1000 }], [{ year: 2025, amount: 900, bucket: 'diversi' }], 2026)
      .tax,
    330
  );
  assert.equal(E.taxOnSales([{ taxClass: 'crypto', gain: 1000 }], Z, 2026).tax, 165);
  assert.equal(E.taxOnSales([{ taxClass: 'emt', gain: 1000 }], [], 2026).tax, 260);
});
test('Stesso anno: perdita ETF compensa guadagno su azioni, non su ETF', () => {
  assert.equal(
    E.taxOnSales(
      [
        { taxClass: 'etf', gain: -500 },
        { taxClass: 'azioni', gain: 800 }
      ],
      [],
      2026
    ).tax,
    78
  );
  const t = E.taxOnSales(
    [
      { taxClass: 'etf', gain: -500 },
      { taxClass: 'etf', gain: 800 }
    ],
    [],
    2026
  );
  assert.equal(t.tax, 208);
  assert.equal(t.zainettoGenerated.diversi, 500);
});

/* ---------- ribilanciamento ---------- */
const H = [
  { id: 'a', cls: 'azioni', value: 8000, cost: 6000, taxClass: 'etf' },
  { id: 'b', cls: 'obbligazioni', value: 2000, cost: 2100, taxClass: 'etf' }
];
test('scostamenti e stato fuori soglia', () => {
  const d = E.drift(H, { azioni: 60, obbligazioni: 40 }, 0, 5);
  const az = d.find(x => x.k === 'azioni');
  assert.equal(az.cur, 80);
  assert.equal(az.diff, 20);
  assert.equal(az.out, true);
  assert.equal(az.gapEur, -2000);
});
test('solo versamenti: tutto sulla classe sottopesata', () => {
  assert.deepEqual(E.contributionPlan(H, { azioni: 60, obbligazioni: 40 }, 0, 1000), { obbligazioni: 1000 });
  const p = E.contributionPlan(
    [
      { cls: 'azioni', value: 6000 },
      { cls: 'obbligazioni', value: 4000 }
    ],
    { azioni: 60, obbligazioni: 40 },
    0,
    1000
  );
  near(p.azioni, 600, 0.01);
  near(p.obbligazioni, 400, 0.01);
});
test('mesi per rientrare in soglia con i versamenti = 3', () => {
  assert.equal(E.monthsToRebalance(H, { azioni: 60, obbligazioni: 40 }, 0, 1000, 5), 3);
  assert.equal(E.monthsToRebalance(H, { azioni: 60, obbligazioni: 40 }, 0, 0, 5), null);
});
test('ribilanciamento completo: vende 2000 di azioni (plus 500 → 130 € di tasse) e compra obbligazioni', () => {
  const r = E.fullRebalance(H, { azioni: 60, obbligazioni: 40 }, 0, [], 2026);
  assert.equal(r.sells.length, 1);
  assert.equal(r.sells[0].amount, 2000);
  assert.equal(r.sells[0].gain, 500);
  assert.equal(r.tax, 130);
  assert.deepEqual(r.buys, [{ cls: 'obbligazioni', id: 'b', amount: 2000 }]);
});
test('ribilanciamento: vende prima le posizioni in perdita', () => {
  const hs = [
    { id: 'gain', cls: 'azioni', value: 5000, cost: 2000, taxClass: 'azioni' },
    { id: 'loss', cls: 'azioni', value: 5000, cost: 6000, taxClass: 'azioni' },
    { id: 'o', cls: 'obbligazioni', value: 0, cost: 0 }
  ];
  const r = E.fullRebalance(hs, { azioni: 70, obbligazioni: 30 }, 0, [], 2026);
  assert.equal(r.sells[0].id, 'loss');
  assert.equal(r.tax, 0);
  assert.equal(r.buys[0].id, null); // nessuna posizione obbligazionaria esistente → strumento da scegliere
});
test('costo delle commissioni in 20 anni', () => {
  assert.equal(E.feeDrag(100000, 0, 20), 0);
  near(E.feeDrag(100000, 1, 20), 100000 * (Math.pow(1.05, 20) - Math.pow(1.04, 20)), 1);
});
/* ---- allocazione per singolo titolo ---- */
const AH = [
  { id: 'a', cls: 'azioni', taxClass: 'etf', value: 6000, cost: 4000 },
  { id: 'b', cls: 'azioni', taxClass: 'etf', value: 3000, cost: 3500 },
  { id: 'c', cls: 'obbligazioni', taxClass: 'etf', value: 1000, cost: 1000 }
];
test('per titolo: scostamenti rispetto ai pesi obiettivo', () => {
  const d = E.assetDrift(AH, { a: 50, b: 30, c: 20 }, 5);
  near(d[0].cur, 60, 1e-9);
  near(d[0].tgt, 50, 1e-9);
  assert.equal(d[0].out, true);
  near(d[0].gapEur, -1000, 1e-6);
  assert.equal(d[1].out, false);
  near(d[2].gapEur, 1000, 1e-6);
  near(
    d.reduce((s, x) => s + x.gapEur, 0),
    0,
    1e-6
  );
});
test('per titolo: un titolo senza peso obiettivo va venduto tutto', () => {
  const r = E.assetRebalance(AH, { a: 60, b: 40 }, [], 2026);
  assert.deepEqual(
    r.sells.map(s => [s.id, s.amount]),
    [['c', 1000]]
  );
  near(
    r.buys.reduce((s, b) => s + b.amount, 0),
    1000,
    0.01
  );
});
test('per titolo: i nuovi versamenti vanno solo ai titoli sotto peso e sommano al versamento', () => {
  const p = E.assetContribution(AH, { a: 50, b: 30, c: 20 }, 1000);
  assert.equal(p.a, undefined);
  near(
    Object.values(p).reduce((s, v) => s + v, 0),
    1000,
    0.02
  );
  assert.ok(p.c > p.b);
  const eq = E.assetContribution(
    [
      { id: 'x', value: 500, cost: 500 },
      { id: 'y', value: 500, cost: 500 }
    ],
    { x: 50, y: 50 },
    200
  );
  assert.deepEqual(eq, { x: 100, y: 100 });
});
test('per titolo: mesi per rientrare e ribilanciamento completo con tasse', () => {
  assert.equal(E.assetMonths(AH, { a: 60, b: 30, c: 10 }, 500, 5), 0);
  const m = E.assetMonths(AH, { a: 50, b: 30, c: 20 }, 500, 5);
  assert.ok(m >= 1 && m <= 12, String(m));
  assert.equal(E.assetMonths(AH, { a: 50, b: 30, c: 20 }, 0, 5), null);
  const r = E.assetRebalance(AH, { a: 50, b: 30, c: 20 }, [], 2026);
  assert.deepEqual(
    r.sells.map(s => [s.id, s.amount]),
    [['a', 1000]]
  );
  near(r.sells[0].gain, (2000 * 1000) / 6000, 0.01);
  near(r.tax, r.sells[0].gain * 0.26, 0.02);
  assert.deepEqual(r.buys, [{ id: 'c', cls: 'obbligazioni', amount: 1000 }]);
});
/* ---- storico investimenti ---- */
const TR = [
  { date: '2025-01-10', side: 'buy', qty: 10, amount: 1000, key: 'A' },
  { date: '2025-06-10', side: 'buy', qty: 10, amount: 1200, key: 'A' },
  { date: '2025-09-01', side: 'sell', qty: 5, amount: 700, key: 'A' },
  { date: '2025-02-01', side: 'buy', qty: 4, amount: 400, key: 'B' },
  { date: '2025-03-01', side: 'sell', qty: 4, amount: 380, key: 'B' }
];
test('storico: costo medio ponderato, vendite e posizioni chiuse', () => {
  const b = E.tradeBook(TR);
  near(b.pos.A.qty, 15, 1e-9);
  near(b.pos.A.avg, 110, 1e-9);
  near(b.pos.A.cost, 1650, 1e-9);
  near(b.pos.A.realized, 700 - 550, 1e-9);
  assert.equal(b.pos.B.closed, true);
  near(b.pos.B.realized, -20, 1e-9);
  assert.equal(b.realized.length, 2);
});
test('storico: vendita di più quote di quelle possedute non va sotto zero', () => {
  const b = E.tradeBook([
    { date: '2025-01-01', side: 'buy', qty: 2, amount: 200, key: 'X' },
    { date: '2025-02-01', side: 'sell', qty: 5, amount: 600, key: 'X' }
  ]);
  assert.equal(b.pos.X.qty, 0);
  assert.equal(b.pos.X.closed, true);
  near(b.realized[0].gain, 240 - 200, 1e-9);
});
test('XIRR: 10% in un anno esatto, nessuna soluzione se i flussi hanno un solo segno', () => {
  near(
    E.xirr([
      { date: '2025-01-01', amount: -1000 },
      { date: '2026-01-01', amount: 1100 }
    ]),
    0.1,
    0.002
  );
  near(
    E.xirr([
      { date: '2025-01-01', amount: -1000 },
      { date: '2025-07-02', amount: -1000 },
      { date: '2026-01-01', amount: 2100 }
    ]),
    0.066,
    0.01
  );
  assert.equal(E.xirr([{ date: '2025-01-01', amount: -1000 }]), null);
  assert.equal(
    E.xirr([
      { date: '2025-01-01', amount: -1000 },
      { date: '2025-06-01', amount: -5 }
    ]),
    null
  );
});
test('serie mensile: versato netto e valore con prezzi storici o costo', () => {
  const s = E.historySeries(
    TR,
    { A: { '2025-01': 101, '2025-06': 120, '2025-09': 130 } },
    { A: 140 },
    '2025-10-15'
  );
  assert.equal(s[0].m, '2025-01');
  assert.equal(s[s.length - 1].m, '2025-10');
  near(s[0].value, 1010, 0.01);
  near(s[0].invested, 1000, 0.01);
  const feb = s[1];
  near(feb.value, 10 * 101 + 400, 0.01);
  assert.equal(feb.approx, true); // B senza prezzi: al costo
  near(s[s.length - 1].value, 15 * 140, 0.01);
  near(s[s.length - 1].invested, 1000 + 1200 + 400 - 380 - 700, 0.01);
});
test('abbinamento nomi della banca: quantità e costo prima delle parole', () => {
  const m = E.matchTradeNames(
    [
      { name: 'ISH MSCI WRL USD-AC', qty: 105, cost: 4748 },
      { name: 'ISHS WLD MOM USD-AC', qty: 79, cost: 6247 },
      { name: 'VAN LIFE 80%', qty: 0, cost: 0 }
    ],
    [
      { id: 'v', name: 'iShares Edge MSCI World Value Factor', qty: 105, avg: 45.19 },
      { id: 'm', name: 'iShares Edge MSCI World Momentum Factor', qty: 79, avg: 79.04 }
    ]
  );
  assert.deepEqual(m, { 'ISH MSCI WRL USD-AC': 'v', 'ISHS WLD MOM USD-AC': 'm' });
});
/* ---- chiedi ai tuoi dati ---- */
const CTX = {
  today: '2026-03-15',
  neutral: ['Giroconti', 'Investimenti'],
  accAlias: { conto_1: 'c1', conto_2: 'c2' },
  accName: { c1: 'Conto', c2: 'Carta' },
  tx: [
    { date: '2025-12-03', amount: -50, cat: 'Ristoranti', note: 'Pizzeria Da Gino', accountId: 'c1' },
    { date: '2026-01-05', amount: -30, cat: 'Ristoranti', note: 'Pizzeria Da Gino', accountId: 'c2' },
    { date: '2026-01-20', amount: -100, cat: 'Spesa', note: 'Esselunga', accountId: 'c1' },
    { date: '2026-02-11', amount: -20, cat: 'Spesa', note: 'Esselunga', accountId: 'c1' },
    { date: '2026-02-27', amount: 2000, cat: 'Stipendio', note: 'Acme', accountId: 'c1' },
    { date: '2026-02-28', amount: -500, cat: 'Giroconti', note: 'a me', accountId: 'c1' },
    { date: '2026-03-02', amount: -10, cat: 'Spesa', note: 'Esselunga', accountId: 'c1' }
  ],
  holdings: [
    { name: 'ETF A', cls: 'azioni', clsLabel: 'Azioni', pfName: 'Principale', value: 1000, cost: 800 },
    {
      name: 'ETF B',
      cls: 'obbligazioni',
      clsLabel: 'Obbligazioni',
      pfName: 'Principale',
      value: 500,
      cost: 520
    }
  ]
};
const ALLOWED = {
  categories: ['Ristoranti', 'Spesa', 'Stipendio', 'Giroconti'],
  accounts: ['conto_1', 'conto_2']
};
test('ricetta: tutto ciò che non è previsto viene scartato', () => {
  const s = E.sanitizeSpec(
    {
      queries: [
        {
          id: 'a',
          measure: 'DROP TABLE',
          type: 'uscite',
          categories: ['Ristoranti', 'Inventata'],
          accounts: ['conto_9'],
          text: '<img src=x onerror=1>',
          group: 'titolo',
          limit: 999
        },
        { id: 'a' },
        7
      ],
      answer: '<b>{a}</b>',
      chart: { query: 'z' }
    },
    ALLOWED
  );
  assert.equal(s.queries.length, 1);
  const q = s.queries[0];
  assert.equal(q.measure, 'totale');
  assert.deepEqual(q.categories, ['Ristoranti']);
  assert.deepEqual(q.accounts, []);
  assert.ok(!/[<>=]/.test(q.text));
  assert.equal(q.group, 'nessuno');
  assert.equal(q.limit, 24);
  assert.equal(s.answer, 'b{a}/b');
  assert.equal(s.chart, null);
  assert.equal(E.sanitizeSpec({ queries: [] }, ALLOWED), null);
  assert.equal(E.sanitizeSpec('x', ALLOWED), null);
});
test('esecuzione locale: totali, neutre escluse, filtri, gruppi, media mensile', () => {
  const Q = o => E.sanitizeSpec({ queries: [{ id: 'a', ...o }] }, ALLOWED).queries[0];
  assert.equal(E.runQuery(Q({ type: 'uscite' }), CTX).value, 210); // giroconto escluso
  assert.equal(E.runQuery(Q({ type: 'uscite', categories: ['Giroconti'] }), CTX).value, 500); // ma incluso se chiesto
  assert.equal(
    E.runQuery(Q({ type: 'uscite', categories: ['Ristoranti'], from: '2026-01-01', to: '2026-12-31' }), CTX)
      .value,
    30
  );
  assert.equal(E.runQuery(Q({ type: 'uscite', text: 'esselunga' }), CTX).value, 130);
  assert.equal(E.runQuery(Q({ type: 'uscite', accounts: ['conto_2'] }), CTX).value, 30);
  const g = E.runQuery(Q({ type: 'uscite', group: 'categoria' }), CTX);
  assert.equal(g.top.label, 'Spesa');
  assert.equal(g.top.value, 130);
  const mm = E.runQuery(
    Q({ type: 'uscite', measure: 'media_mensile', from: '2025-12-01', to: '2026-03-15' }),
    CTX
  ); // dic-feb chiusi = 3 mesi
  assert.equal(mm.months, 3);
  near(mm.value, 210 / 3, 1e-9);
  const mesi = E.runQuery(Q({ type: 'uscite', group: 'mese', from: '2025-11-01', to: '2026-03-15' }), CTX);
  assert.deepEqual(
    mesi.rows.map(r => r.value),
    [50, 130, 20, 10]
  ); // da dicembre (primo dato), mesi vuoti = 0
  assert.equal(E.runQuery(Q({ type: 'saldo', from: '2026-02-01', to: '2026-02-28' }), CTX).value, 1980);
  assert.equal(E.runQuery(Q({ measure: 'conteggio', type: 'uscite', categories: ['Spesa'] }), CTX).value, 3);
  const inv = E.runQuery(
    E.sanitizeSpec(
      { queries: [{ id: 'a', source: 'investimenti', measure: 'guadagno', group: 'classe' }] },
      ALLOWED
    ).queries[0],
    CTX
  );
  assert.deepEqual(
    inv.rows.map(r => [r.label, r.value]),
    [
      ['Azioni', 200],
      ['Obbligazioni', -20]
    ]
  );
});
test('risposta composta dai segnaposto, senza inventare numeri', () => {
  const R = {
    a: { value: 120, top: { label: 'Spesa', value: 100 }, n: 3, isCount: false },
    b: { value: 100, isCount: false }
  };
  const f = {
    eur: v => v.toFixed(2) + ' €',
    signed: v => (v >= 0 ? '+' : '-') + Math.abs(v).toFixed(2),
    pct: v => v.toFixed(1) + '%',
    signedPct: v => (v >= 0 ? '+' : '-') + Math.abs(v).toFixed(1) + '%',
    n: v => String(v)
  };
  assert.equal(
    E.renderAnswer(
      '{a} vs {b} ({change:a:b}, {diff:a-b}, {pct:b/a}); top {a.top} {a.top_value} su {a.n}; {z} {foo}',
      R,
      f
    ),
    '120.00 € vs 100.00 € (+20.0%, +20.00, 83.3%); top Spesa 100.00 € su 3; — —'
  );
});

/* ---------- financial health indicators ---------- */
test('health: indicatori base calcolati correttamente', () => {
  const H = E.healthIndicators({
    months: Array(12).fill({ inc: 2500, out: 2000 }),
    cash: 9000,
    cardDebt: 0,
    investments: 20000,
    invCost: 16000,
    assets: 0,
    debts: 10000,
    fixedMonthly: 1000,
    debtPayments: 300,
    terCost: 40,
    topWeight: 0.5
  });
  const get = k => H.find(x => x.k === k);
  near(get('saving').value, 0.2, 1e-9);
  assert.equal(get('saving').status, 'good');
  near(get('emergency').value, 4.5, 1e-9);
  assert.equal(get('emergency').status, 'good');
  near(get('fixed').value, 0.4, 1e-9);
  near(get('dti').value, 0.12, 1e-9);
  near(get('afford').value, 0.33 * 2500 - 300, 1e-9);
  near(get('volatility').value, 0, 1e-9);
  near(get('leverage').value, 10000 / 29000, 1e-9);
  near(get('gain').value, 0.25, 1e-9);
  near(get('ter').value, 0.002, 1e-9);
  assert.equal(get('ter').status, 'good');
});
test('health: segnali di attenzione e casi limite', () => {
  const H = E.healthIndicators({
    months: [
      { inc: 2000, out: 2100 },
      { inc: 2000, out: 900 }
    ],
    cash: 500,
    investments: 0,
    debts: 0,
    debtPayments: 900
  });
  const get = k => H.find(x => x.k === k);
  assert.equal(get('emergency').status, 'crit');
  assert.equal(get('dti').status, 'crit');
  assert.equal(get('afford').value, 0);
  assert.ok(get('volatility').value > 0.3);
  assert.equal(get('ter'), undefined); // no investments, no fund costs
  assert.deepEqual(E.healthIndicators({ months: [], cash: 0 }), []);
});

/* ---------- can I afford it? ---------- */
const AFF = {
  kind: 'mortgage',
  price: 250000,
  downPayment: 50000,
  extraCosts: 10000,
  ratePct: 3,
  months: 300,
  rentNow: 750,
  monthlyIncome: 3000,
  monthlySpending: 2000,
  cash: 70000,
  existingPayments: 0
};
test('afford: rata del mutuo con ammortamento alla francese', () => {
  near(E.loanPayment(200000, 3, 300), 948.42, 0.01);
  near(E.loanPrincipal(E.loanPayment(150000, 4, 240), 4, 240), 150000, 0.01);
  near(E.loanPayment(12000, 0, 48), 250, 1e-9); // tasso zero
});
test('afford: mutuo sostenibile ma con fondo di emergenza sotto i 6 mesi → con attenzione', () => {
  const r = E.affordability(AFF);
  near(r.loan, 200000, 1e-9);
  near(r.upfront, 60000, 1e-9);
  near(r.cashAfter, 10000, 1e-9);
  near(r.spendingAfter, 2000 + r.payment - 750, 1e-6); // la rata sostituisce l'affitto
  near(r.dtiAfter, r.payment / 3000, 1e-9);
  near(r.ltv, 0.8, 1e-9);
  const st = Object.fromEntries(r.checks.map(c => [c.k, c.status]));
  assert.deepEqual(st, { upfront: 'good', emergency: 'warn', dti: 'good', saving: 'good', ltv: 'good' });
  assert.equal(r.verdict, 'careful');
  assert.equal(r.maxPrice, 250000); // limitato dall'anticipo al 20%
  assert.ok(r.monthsToAfford > 0 && r.monthsToAfford < 20);
  assert.equal(r.projection.length, 37);
  near(r.projection[0].after, 10000, 1e-9);
});
test('afford: senza abbastanza liquidità → non ancora, e quando', () => {
  const r = E.affordability({ ...AFF, cash: 30000 });
  assert.equal(r.checks.find(c => c.k === 'upfront').status, 'crit');
  assert.equal(r.verdict, 'no');
  const need = r.upfront + 6 * r.spendingAfter - 30000;
  assert.equal(r.monthsToAfford, Math.ceil(need / 1000));
  // vendendo gli investimenti l'anticipo si copre
  const r2 = E.affordability({ ...AFF, cash: 30000, investments: 60000, useInvestments: true });
  assert.equal(r2.checks.find(c => c.k === 'upfront').status, 'good');
  near(r2.projection[0].after, 0, 1e-9); // la liquidità usata tutta, il resto dagli investimenti
});
test('afford: rata troppo alta rispetto al reddito → non ancora', () => {
  const r = E.affordability({ ...AFF, monthlyIncome: 2200, monthlySpending: 1600, cash: 200000 });
  assert.equal(r.checks.find(c => c.k === 'dti').status, 'crit');
  assert.equal(r.verdict, 'no');
  assert.ok(r.maxPrice < 250000);
});
test('afford: auto pagata in contanti, con costi di gestione', () => {
  const r = E.affordability({
    kind: 'car',
    payCash: true,
    price: 20000,
    runningCosts: 200,
    monthlyIncome: 2500,
    monthlySpending: 1800,
    cash: 40000
  });
  assert.equal(r.payment, 0);
  near(r.cashAfter, 20000, 1e-9);
  near(r.savingAfter, 500, 1e-9);
  assert.equal(
    r.checks.find(c => c.k === 'dti'),
    undefined
  );
  assert.equal(r.verdict, 'yes');
  near(r.maxPrice, Math.floor((40000 - 6 * 2000) / 100) * 100, 1e-9);
});
test("afford: risparmio negativo dopo l'acquisto → non ancora, mai raggiungibile se non risparmi", () => {
  const r = E.affordability({
    kind: 'car',
    payCash: false,
    price: 30000,
    downPayment: 0,
    ratePct: 7,
    months: 60,
    monthlyIncome: 1800,
    monthlySpending: 1700,
    cash: 2000
  });
  assert.equal(r.checks.find(c => c.k === 'saving').status, 'crit');
  assert.equal(r.verdict, 'no');
  const r2 = E.affordability({ ...AFF, monthlyIncome: 2000, monthlySpending: 2100, cash: 1000 });
  assert.equal(r2.monthsToAfford, Infinity);
});
test('posso permettermelo: frasi capite senza AI (italiano e inglese)', () => {
  assert.deepEqual(
    E.parseAffordText('Posso permettermi una casa da 250.000 € con 50.000 di anticipo al 3,2% in 25 anni?'),
    {
      kind: 'mortgage',
      price: 250000,
      downPayment: 50000,
      ratePct: 3.2,
      years: 25,
      payCash: false
    }
  );
  assert.deepEqual(E.parseAffordText('posso comprare un auto da 25k a rate in 5 anni?'), {
    kind: 'car',
    price: 25000,
    years: 5,
    payCash: false
  });
  const en = E.parseAffordText('Can I afford a €200,000 mortgage over 30 years at 3.5%?');
  assert.equal(en.kind, 'mortgage');
  assert.equal(en.price, 200000);
  assert.equal(en.ratePct, 3.5);
  const cash = E.parseAffordText('car for 18000 cash, running costs 150 a month');
  assert.equal(cash.payCash, true);
  assert.equal(cash.runningCosts, 150);
  assert.equal(cash.price, 18000);
  assert.equal(E.parseAffordText('viaggio in Giappone da 5000 euro').kind, 'purchase');
  assert.equal(E.parseAffordText('casa 300 mila vendendo gli investimenti').useInvestments, true);
  assert.equal(E.parseAffordText('cosa mi conviene fare?').price, undefined);
});
test("posso permettermelo: parametri dall'AI ripuliti", () => {
  const s = E.sanitizeAfford({
    kind: 'yacht',
    price: '1e12',
    ratePct: -4,
    years: 'x',
    label: '<img>casa',
    income: 5000
  });
  assert.equal(s.kind, 'purchase');
  assert.equal(s.price, 1e8);
  assert.equal(s.ratePct, 0);
  assert.equal(s.years, undefined);
  assert.equal(s.label, 'imgcasa');
  assert.equal(s.income, undefined);
  assert.equal(E.sanitizeAfford(null), null);
});
test('posso permettermelo: importo del mutuo e durata senza "anni"', () => {
  assert.deepEqual(E.parseAffordText('Posso fare un mutuo da 200k in 20 anni?'), {
    kind: 'mortgage',
    loanAmount: 200000,
    years: 20,
    payCash: false
  });
  assert.equal(E.parseAffordText('Mi posso permettere un mutuo da 200k in 20').years, 20);
  const both = E.parseAffordText('casa da 300.000 con mutuo da 240.000 in 25 anni');
  assert.equal(both.price, 300000);
  assert.equal(both.loanAmount, 240000);
  assert.equal(E.parseAffordText('auto a 20.000 euro').price, 20000);
  assert.deepEqual(E.parseAffordText('che mutuo posso permettermi?'), { kind: 'mortgage' });
});
/* ---------- consulente ---------- */
const PC = {
  title: 'PC',
  events: [
    { label: 'Spesa', amount: 15000, month: 1 },
    { label: 'PC', amount: 3000, month: 1 }
  ],
  target: 1,
  checks: [
    {
      expr: 'cash_after_target >= emergency_target',
      soft: true,
      ok: 'ok',
      ko: 'scendi a {cash_after_target}'
    },
    { expr: 'cash_min >= 0', ok: 'mai in rosso', ko: 'in rosso a {first_negative_month}' }
  ],
  answer: { yes: 'Sì', careful: 'Sì, da {best_month}', no: 'No' },
  show: ['best_month', 'cash_min', 'constructor']
};
const BASE = { income: 2600, spending: 1700, cash: 18000, investments: 30000, emergencyMonths: 6 };
test('consulente: simulazione mese per mese, regole e mese migliore', () => {
  const r = E.sanitizeAdvice(PC);
  assert.deepEqual(r.show, ['best_month', 'cash_min']);
  const x = E.runAdvice(r, BASE);
  assert.equal(x.vars.cash_after_target, 18000 + 900 - 18000);
  assert.equal(x.vars.emergency_target, 10200);
  assert.equal(x.verdict, 'careful');
  // month 12: 18000 + 12·900 − 18000 = 10800 ≥ 10200, month 11: 9900 < 10200
  assert.equal(x.vars.best_month, 12);
  const fmt = (t, v) => (v === null ? '—' : t + ':' + Math.round(v));
  assert.equal(E.renderAdvice(r.answer.careful, x.vars, fmt), 'Sì, da month:12');
  assert.equal(
    E.renderAdvice('{cat:Ristoranti} {nonesiste}', x.vars, fmt, { Ristoranti: 210 }),
    'eur:210 {nonesiste}'
  );
  const poor = E.runAdvice(r, { ...BASE, cash: 5000 });
  assert.equal(poor.verdict, 'no');
  assert.equal(poor.vars.first_negative_month, 1);
});
test('consulente: rate, spese mensili ed entrate future', () => {
  const r = E.sanitizeAdvice({
    events: [
      { label: 'Auto', amount: 20000, month: 2, financed: { months: 48, ratePct: 6, down: 4000 } },
      { label: 'Palestra', amount: 50, month: 0, type: 'monthly', months: 12 },
      { label: 'Bonus', amount: -2000, month: 3 }
    ],
    target: 0,
    checks: [{ expr: 'dti_after <= 0.33', ok: 'ok', ko: 'troppe rate' }]
  });
  const x = E.runAdvice(r, BASE);
  near(x.vars.target_payment, E.loanPayment(16000, 6, 48), 0.01);
  near(x.vars.cash_after_target, 18000 + 2 * 900 - 4000 - 3 * 50, 0.01);
  near(x.path[3], 18000 + 3 * 900 - 4000 - E.loanPayment(16000, 6, 48) - 4 * 50 + 2000, 0.01);
  assert.equal(x.verdict, 'yes');
});
test('consulente: espressioni sicure', () => {
  for (const bad of [
    'constructor',
    '__proto__ > 1',
    'toString()',
    'process.exit()',
    'cash >= 1 or',
    'cash; 1'
  ])
    assert.throws(() => E.parseExpr(bad), bad);
  const V = { cash: 100, dti: null };
  assert.equal(E.evalExpr(E.parseExpr('cash >= 50 and not (cash > 200)'), V), true);
  assert.equal(E.evalExpr(E.parseExpr('dti < 0.3'), V), false, 'confronto con null è falso');
  assert.equal(E.evalExpr(E.parseExpr('known(dti)'), V), false);
  assert.equal(E.evalExpr(E.parseExpr('max(cash, 2) * 2 - -1'), V), 201);
  assert.equal(E.evalExpr(E.parseExpr('cat("Spesa") > 300'), V, { Spesa: 400 }), true);
  const s = E.sanitizeAdvice({
    events: [{ amount: 1e12, month: 99 }],
    checks: [{ expr: 'hack()', ok: 'x' }]
  });
  assert.equal(s.events[0].amount, 1e8);
  assert.equal(s.events[0].month, 60);
  assert.equal(s.checks.length, 0, 'regola non valida scartata');
  assert.equal(E.sanitizeAdvice({ events: [], checks: [] }), null);
});
test('consulente: gli investimenti periodici escono dalla liquidità ma non sono spese', () => {
  const r = E.sanitizeAdvice({ events: [{ label: 'PC', amount: 3000, month: 1 }], target: 0 });
  const x = E.runAdvice(r, { ...BASE, investing: 300 });
  assert.equal(x.vars.saving, 900, 'risparmio = entrate − spese');
  assert.equal(x.vars.cash_growth, 600, 'la liquidità cresce di risparmio − PAC');
  assert.equal(x.path[2], 18000 + 2 * 600 - 3000);
  // con 2.000 di partenza: 2.000 − 3.000 + 600·m ≥ 10.200 solo da m = 19, oltre i 13 mesi del grafico
  const late = E.runAdvice(r, { ...BASE, cash: 2000, investing: 300 });
  assert.ok(late.vars.best_month > late.vars.horizon, 'il mese migliore si cerca fino a 5 anni');
});
