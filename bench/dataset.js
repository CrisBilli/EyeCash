/*
 * EyeCash · bench/dataset.js
 *
 * A made-up person with two years of realistic finances, generated with a fixed seed so
 * that every run (and every expected answer) is identical. No real data is involved.
 *
 * Built-in situations the advisor should notice:
 *   - clothing ("Shopping") in the current month far above its average;
 *   - Netflix price raised in July 2026;
 *   - emergency fund below 6 months of spending;
 *   - portfolio with more equities than the target allocation;
 *   - a car loan in progress; two savings goals, one behind schedule;
 *   - restaurants trending up this year.
 */
'use strict';
const EN = require('../public/engine.js');

const TODAY = '2026-11-20'; // fixed "today": complete months are up to October 2026
const FIRST = '2024-11'; // first month of data

/** Small seeded PRNG (mulberry32), so the data never changes between runs. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function build() {
  const R = prng(20261120);
  const rnd = (lo, hi) => lo + (hi - lo) * R();
  const pick = a => a[Math.floor(R() * a.length)];
  const cents = x => Math.round(x * 100) / 100;
  const tx = [];
  let n = 0;
  const add = (date, amount, cat, note, accountId = 'conto') =>
    date <= TODAY && tx.push({ id: 't' + ++n, date, amount: cents(amount), cat, note, accountId });
  const day = (ym, d) => ym + '-' + String(Math.min(d, 28)).padStart(2, '0');

  const months = [];
  for (let k = FIRST; k <= TODAY.slice(0, 7); k = EN.ymAdd(k, 1)) months.push(k);

  for (const k of months) {
    const m = +k.slice(5, 7);
    const y2026 = k >= '2026-01';
    // income
    add(day(k, 27), 2600, 'Stipendio', 'Stipendio ACME Srl');
    if (m === 12) add(day(k, 18), 2600, 'Stipendio', 'Tredicesima ACME Srl');
    if (k === '2026-06') add(day(k, 27), 1200, 'Altre entrate', 'Premio di produzione');
    if (k === '2025-06') add(day(k, 27), 900, 'Altre entrate', 'Premio di produzione');
    // fixed costs
    add(day(k, 1), -750, 'Casa', 'Affitto appartamento');
    add(day(k, 5), -293.49, 'Rate e finanziamenti', 'Rata prestito auto');
    add(day(k, 10), -rnd(55, 75), 'Utenze', 'Bolletta luce');
    add(day(k, 12), -(m >= 11 || m <= 3 ? rnd(110, 150) : rnd(30, 50)), 'Utenze', 'Bolletta gas');
    add(day(k, 15), -29.9, 'Utenze', 'Internet casa');
    add(day(k, 3), -(k >= '2026-07' ? 15.99 : 13.99), 'Abbonamenti', 'Netflix', 'carta');
    add(day(k, 8), -11.99, 'Abbonamenti', 'Spotify', 'carta');
    add(day(k, 2), -45, 'Abbonamenti', 'Palestra FitClub');
    add(day(k, 4), -39, 'Trasporti', 'Abbonamento ATM');
    // groceries
    const nSpesa = 8 + Math.floor(rnd(0, 3));
    for (let i = 0; i < nSpesa; i++)
      add(
        day(k, 1 + Math.floor(rnd(0, 28))),
        -rnd(28, 70),
        'Spesa',
        pick(['Esselunga', 'Coop', 'Lidl', 'Carrefour']),
        'carta'
      );
    // restaurants: more often in 2026
    const nRist = (y2026 ? 5 : 3) + Math.floor(rnd(0, 3));
    for (let i = 0; i < nRist; i++)
      add(
        day(k, 1 + Math.floor(rnd(0, 28))),
        -rnd(22, 60),
        'Ristoranti',
        pick(['Pizzeria Da Gino', 'Sushi Zen', 'Trattoria Rossi', 'Bar Centrale']),
        'carta'
      );
    // fuel and transport
    for (let i = 0; i < 2; i++)
      add(day(k, 6 + i * 12), -rnd(40, 60), 'Trasporti', pick(['Eni Station', 'Q8']), 'carta');
    // clothing: normal, but a spike in the current (partial) month
    if (k === '2026-11') {
      add('2026-11-09', -189, 'Shopping', 'Zalando', 'carta');
      add('2026-11-14', -129.9, 'Shopping', 'Zara', 'carta');
      add('2026-11-16', -84.5, 'Shopping', 'Decathlon', 'carta');
    } else if (R() < 0.7)
      add(
        day(k, 1 + Math.floor(rnd(0, 28))),
        -rnd(35, 120),
        'Shopping',
        pick(['Zara', 'Decathlon', 'Zalando', 'OVS']),
        'carta'
      );
    // health, fun
    if (R() < 0.6) add(day(k, 1 + Math.floor(rnd(0, 28))), -rnd(12, 45), 'Salute', 'Farmacia');
    if (R() < 0.8)
      add(
        day(k, 1 + Math.floor(rnd(0, 28))),
        -rnd(15, 60),
        'Svago',
        pick(['Cinema Odeon', 'Libreria Feltrinelli', 'Concerto']),
        'carta'
      );
    // seasonal
    if (m === 12) add(day(k, 20), -rnd(250, 350), 'Shopping', 'Regali di Natale', 'carta');
    if (k === '2025-08') add('2025-08-05', -1180, 'Viaggi', 'Volo e hotel Grecia', 'carta');
    if (k === '2026-08') add('2026-08-03', -1490, 'Viaggi', 'Volo e hotel Portogallo', 'carta');
    if (k === '2026-03') add('2026-03-18', -420, 'Casa', 'Idraulico caldaia');
    if (m === 6) add(day(k, 30), -rnd(15, 25), 'Tasse e commissioni', 'Imposta di bollo conto deposito');
    // monthly investment and saving
    add(day(k, 28), -300, 'Investimenti', 'Acquisto ETF (PAC)');
    // monthly saving into the deposit account
    add(day(k, 28), -200, 'Giroconti', 'Giroconto a conto deposito');
    add(day(k, 28), 200, 'Giroconti', 'Giroconto da conto corrente', 'deposito');
  }
  // the credit card is settled on the 15th of the next month from the current account
  for (const k of months) {
    const spent = -tx
      .filter(t => t.accountId === 'carta' && t.cat !== 'Giroconti' && t.date.startsWith(k))
      .reduce((s, t) => s + t.amount, 0);
    const when = EN.ymAdd(k, 1) + '-15';
    add(when, -spent, 'Giroconti', 'Addebito estratto conto carta');
    add(when, spent, 'Giroconti', 'Saldo estratto conto carta', 'carta');
  }
  const T = tx.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));

  const accounts = [
    { id: 'conto', name: 'Conto corrente', kind: 'conto', opening: 2500 },
    { id: 'deposito', name: 'Conto deposito', kind: 'conto', opening: 4000 },
    { id: 'carta', name: 'Carta di credito', kind: 'carta', opening: 0 }
  ];
  const recurring = [
    { name: 'Stipendio ACME Srl', type: 'in', amount: 2600, freq: 'mensile', cat: 'Stipendio' },
    { name: 'Affitto appartamento', type: 'out', amount: 750, freq: 'mensile', cat: 'Casa' },
    { name: 'Rata prestito auto', type: 'out', amount: 293.49, freq: 'mensile', cat: 'Rate e finanziamenti' },
    { name: 'Internet casa', type: 'out', amount: 29.9, freq: 'mensile', cat: 'Utenze' },
    { name: 'Netflix', type: 'out', amount: 15.99, freq: 'mensile', cat: 'Abbonamenti' },
    { name: 'Spotify', type: 'out', amount: 11.99, freq: 'mensile', cat: 'Abbonamenti' },
    { name: 'Palestra FitClub', type: 'out', amount: 45, freq: 'mensile', cat: 'Abbonamenti' },
    { name: 'Abbonamento ATM', type: 'out', amount: 39, freq: 'mensile', cat: 'Trasporti' },
    { name: 'Assicurazione auto', type: 'out', amount: 540, freq: 'annuale', cat: 'Trasporti' },
    { name: 'PAC ETF', type: 'out', amount: 300, freq: 'mensile', cat: 'Investimenti' }
  ];
  const holdings = [
    {
      name: 'Vanguard FTSE All-World (VWCE)',
      ticker: 'VWCE',
      isin: 'IE00BK5BQT80',
      cls: 'azioni',
      ter: 0.22,
      qty: 95,
      price: 138.4,
      avg: 112.6
    },
    {
      name: 'iShares Core MSCI EM IMI (EIMI)',
      ticker: 'EIMI',
      isin: 'IE00BKM4GZ66',
      cls: 'azioni',
      ter: 0.18,
      qty: 120,
      price: 34.9,
      avg: 31.2
    },
    {
      name: 'Xtrackers Eurozone Government Bond (XGLE)',
      ticker: 'XGLE',
      isin: 'LU0290355717',
      cls: 'obbligazioni',
      ter: 0.09,
      qty: 16,
      price: 214.5,
      avg: 221.3
    },
    {
      name: 'iShares Physical Gold (SGLN)',
      ticker: 'SGLN',
      isin: 'IE00B4ND3602',
      cls: 'oro',
      ter: 0.12,
      qty: 18,
      price: 58.2,
      avg: 41.5
    }
  ];
  const target = { azioni: 70, obbligazioni: 25, oro: 5 };
  const assets = [{ name: 'Auto (Fiat Panda)', kind: 'auto', value: 9500 }];
  const debts = [
    { name: 'Prestito auto', kind: 'prestito', principal: 15000, rate: 6.5, months: 60, start: '2024-03-05' }
  ];
  const goals = [
    { name: 'Fondo emergenza', target: 12000, saved: 7000, deadline: '2027-06-30' },
    { name: 'Viaggio in Giappone', target: 4000, saved: 900, deadline: '2027-04-30' }
  ];
  return { today: TODAY, first: FIRST, tx: T, accounts, recurring, holdings, target, assets, debts, goals };
}

module.exports = { build, TODAY };
