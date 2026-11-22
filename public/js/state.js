/*
 * EyeCash · public/js/state.js
 *
 * The in-memory state `S` (accounts, transactions, holdings, goals…),
 * the empty and demo states, and recurring transactions. `S` is the single source
 * of truth on the device; it is encrypted before it ever leaves it (see sync.js).
 */
/* ---------- state & storage ---------- */
let OFFLINE = false;
let S = null,
  sync = 'ok',
  AI = false,
  AIPDF = false,
  VER = 0,
  lastSaved = null;
/** State of a brand-new user: one current account, no data. */
function emptyState() {
  return {
    v: 1,
    demo: false,
    updated: Date.now(),
    accounts: [{ id: 'a1', name: 'Conto corrente', type: 'Conto', balance0: 0 }],
    tx: [],
    recurring: [],
    holdings: [],
    goals: [],
    budgets: {},
    rules: {},
    templates: {},
    privacy: { ...PRIV_DEF },
    aiLog: [],
    assets: [],
    debts: [],
    zainetto: [],
    trades: [],
    trMap: {}
  };
}
/** Realistic, fully fictional sample data used by "Load sample data" and in screenshots. */
function demoState() {
  let seed = 11;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const pick = a => a[Math.floor(rnd() * a.length)];
  const st = {
    v: 1,
    demo: true,
    updated: Date.now(),
    accounts: [
      { id: 'a1', name: 'Conto corrente', type: 'Conto', balance0: 4100 },
      { id: 'a2', name: 'Carta di credito', type: 'Carta', balance0: 0 },
      { id: 'a3', name: 'Conto deposito', type: 'Risparmio', balance0: 8000 },
      { id: 'a4', name: 'Contanti', type: 'Contanti', balance0: 120 }
    ],
    tx: [],
    recurring: [],
    holdings: [
      {
        id: uid(),
        name: 'ETF MSCI World',
        ticker: 'SWDA',
        type: 'ETF',
        qty: 120,
        avg: 82.5,
        price: 104.3,
        ter: 0.2
      },
      {
        id: uid(),
        name: 'ETF S&P 500',
        ticker: 'CSPX',
        type: 'ETF',
        qty: 10,
        avg: 480,
        price: 612,
        ter: 0.07
      },
      {
        id: uid(),
        name: 'BTP 2030',
        ticker: 'BTP30',
        type: 'Obbligazioni',
        qty: 50,
        avg: 98.2,
        price: 101.1,
        taxClass: 'stato',
        divYield: 3.2
      },
      { id: uid(), name: 'Azioni Enel', ticker: 'ENEL', type: 'Azioni', qty: 300, avg: 6.4, price: 7.9 },
      { id: uid(), name: 'Bitcoin', ticker: 'BTC', type: 'Crypto', qty: 0.06, avg: 52000, price: 81000 }
    ],
    goals: [
      { id: uid(), name: 'Fondo emergenza', target: 10000, saved: 8400, deadline: '2027-06-30' },
      { id: uid(), name: 'Viaggio in Giappone', target: 5000, saved: 2100, deadline: '2027-04-15' },
      { id: uid(), name: 'Nuovo laptop', target: 2000, saved: 1820, deadline: '2026-12-20' }
    ],
    budgets: { Spesa: 420, Ristoranti: 200, Shopping: 150, Svago: 120, Trasporti: 160, Abbonamenti: 50 },
    target: { weights: { azioni: 70, obbligazioni: 20, crypto: 5, liquidita: 5 }, tol: 5, cash: 2000 },
    zainetto: [{ id: 'z1', year: 2023, amount: 640, bucket: 'diversi', note: 'Esempio' }],
    assets: [
      {
        id: 'as1',
        kind: 'auto',
        name: 'Volkswagen Golf',
        value: 16500,
        valueAt: Date.now() - 90 * 864e5,
        valueSrc: 'ai',
        deprec: 11,
        details: { marca: 'Volkswagen', modello: 'Golf', versione: '1.5 TSI', anno: '2020', km: '62000' },
        deadlines: {
          assicurazione: ds(new Date(Date.now() + 12 * 864e5)),
          bollo: ds(new Date(Date.now() + 80 * 864e5)),
          revisione: ds(new Date(Date.now() + 200 * 864e5))
        },
        est: {
          low: 15200,
          mid: 16500,
          high: 17800,
          confidence: 'media',
          basis: 'Dati di esempio.',
          sources: [],
          comparables: [],
          at: Date.now() - 90 * 864e5
        }
      },
      {
        id: 'as2',
        kind: 'casa',
        name: 'Casa',
        value: 285000,
        valueAt: Date.now() - 30 * 864e5,
        valueSrc: 'manuale',
        details: { comune: 'Milano', zona: 'Città Studi', mq: '85' },
        deadlines: {}
      }
    ],
    debts: [
      {
        id: 'db1',
        name: 'Mutuo casa',
        kind: 'mutuo',
        principal: 200000,
        rate: 3.1,
        months: 300,
        start: '2021-03-15',
        assetId: 'as2'
      }
    ]
  };
  const now = new Date();
  for (let m = 5; m >= 0; m--) {
    const Y = now.getFullYear(),
      M = now.getMonth() - m;
    const base = new Date(Y, M, 1);
    const y = base.getFullYear(),
      mo = base.getMonth();
    const last = m === 0 ? now.getDate() : new Date(y, mo + 1, 0).getDate();
    const d = day => ds(new Date(y, mo, Math.min(day, last)));
    const add = (day, amount, cat, acc, note) => {
      if (day <= last) st.tx.push({ id: uid(), date: d(day), amount: r2(amount), cat, accountId: acc, note });
    };
    add(27, 2450, 'Stipendio', 'a1', 'Stipendio');
    if (rnd() > 0.45) add(14, 300 + Math.round(rnd() * 600), 'Freelance', 'a1', 'Fattura cliente');
    for (let day = 2 + Math.floor(rnd() * 3); day <= 28; day += 7)
      add(day, -(48 + rnd() * 55), 'Spesa', 'a1', pick(['Esselunga', 'Conad', 'Lidl', 'Coop']));
    for (let i = 0; i < 4; i++)
      add(
        1 + Math.floor(rnd() * 28),
        -(14 + rnd() * 45),
        'Ristoranti',
        pick(['a1', 'a2']),
        pick(['Pizzeria Da Gino', 'Sushi Zen', 'Bar Centrale', 'Trattoria', 'Deliveroo'])
      );
    for (let i = 0; i < 3; i++)
      add(
        1 + Math.floor(rnd() * 28),
        -(25 + rnd() * 40),
        'Trasporti',
        'a1',
        pick(['Eni Station', 'Trenitalia', 'Q8', 'Telepass'])
      );
    if (rnd() > 0.3)
      add(
        1 + Math.floor(rnd() * 28),
        -(30 + rnd() * 140),
        'Shopping',
        'a2',
        pick(['Amazon', 'Zalando', 'Decathlon', 'IKEA'])
      );
    if (rnd() > 0.5) add(1 + Math.floor(rnd() * 28), -(9 + rnd() * 30), 'Salute', 'a1', 'Farmacia');
    add(1 + Math.floor(rnd() * 28), -(12 + rnd() * 35), 'Svago', 'a2', pick(['Cinema', 'Concerto', 'Steam']));
  }
  const first = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const mk = (name, amount, cat, acc, day, freq = 'mensile') => ({
    id: uid(),
    name,
    amount,
    cat,
    accountId: acc,
    freq,
    type: 'out',
    auto: true,
    next: ds(new Date(first.getFullYear(), first.getMonth(), day))
  });
  st.recurring = [
    mk('Affitto', 750, 'Casa', 'a1', 1),
    mk('Enel luce e gas', 72, 'Utenze', 'a1', 12),
    mk('iliad', 9.99, 'Utenze', 'a2', 5),
    mk('Netflix', 13.99, 'Abbonamenti', 'a2', 8),
    mk('Spotify', 11.99, 'Abbonamenti', 'a2', 15),
    mk('Palestra', 39, 'Svago', 'a1', 3),
    {
      id: uid(),
      name: 'Assicurazione auto',
      amount: 520,
      cat: 'Trasporti',
      accountId: 'a1',
      freq: 'annuale',
      type: 'out',
      auto: true,
      next: ds(new Date(now.getFullYear(), now.getMonth() - 3, 20))
    }
  ];
  return st;
}
/** Posts every recurring item that is due, up to today. */
function processRecurring() {
  let n = 0;
  const t = today();
  for (const r of S.recurring) {
    if (!r.auto) continue;
    let g = 0;
    while (r.next <= t && g++ < 500) {
      postRecurring(r);
      n++;
    }
  }
  return n;
}
function postRecurring(r) {
  if (!r.anchor) r.anchor = pd(r.next).getDate();
  const id = 'r_' + r.id + '_' + r.next;
  if (!S.tx.some(t => t.id === id))
    S.tx.push({
      id,
      date: r.next,
      amount: r.type === 'in' ? Math.abs(r.amount) : -Math.abs(r.amount),
      cat: r.cat,
      accountId: r.accountId,
      note: r.name,
      recId: r.id
    });
  r.next = addPeriod(r.next, r.freq, r.freq === 'settimanale' ? null : r.anchor);
}
