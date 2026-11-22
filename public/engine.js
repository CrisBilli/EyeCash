/* EyeCash – calculation engine (FIRE Monte Carlo, rebalancing, Italian taxes,
 * investment history, "Ask your data").
 * Pure functions, no network access: everything runs on the device.
 * Browser: window.POC_ENGINE · Node: require('./engine.js')              */
(function (root) {
  'use strict';
  /* ---------- asset classes and default assumptions (nominal yearly returns in EUR) ---------- */
  const CLASSES = [
    { k: 'azioni', label: 'Azioni', mu: 7, sd: 16 },
    { k: 'obbligazioni', label: 'Obbligazioni', mu: 3, sd: 6 },
    { k: 'liquidita', label: 'Liquidità e monetario', mu: 2, sd: 1 },
    { k: 'oro', label: 'Oro e materie prime', mu: 4, sd: 15 },
    { k: 'immobiliare', label: 'Immobiliare (REIT)', mu: 5, sd: 18 },
    { k: 'crypto', label: 'Crypto', mu: 8, sd: 65 }
  ];
  const CK = CLASSES.map(c => c.k);
  // conservative (symmetric) correlations
  const CORR_PAIRS = {
    'azioni|obbligazioni': 0.1,
    'azioni|oro': 0.05,
    'azioni|immobiliare': 0.7,
    'azioni|crypto': 0.35,
    'obbligazioni|liquidita': 0.2,
    'obbligazioni|oro': 0.2,
    'obbligazioni|immobiliare': 0.2,
    'oro|crypto': 0.1,
    'oro|immobiliare': 0.1,
    'immobiliare|crypto': 0.25
  };
  const corr = (a, b) => (a === b ? 1 : (CORR_PAIRS[a + '|' + b] ?? CORR_PAIRS[b + '|' + a] ?? 0));

  /* ---------- Italian taxation (checked November 2026) ---------- */
  const TAX = {
    etf: { label: 'ETF/fondi armonizzati', rate: 26, gainBucket: null, lossBucket: 'diversi' }, // gains classed as capital income: no loss carry-forward
    azioni: {
      label: 'Azioni, ETC, obbligazioni societarie',
      rate: 26,
      gainBucket: 'diversi',
      lossBucket: 'diversi'
    },
    stato: {
      label: 'Titoli di Stato e white list',
      rate: 12.5,
      gainBucket: 'diversi',
      lossBucket: 'diversi',
      offsetShare: 0.4808
    },
    crypto: { label: 'Cripto-attività', rate: 33, gainBucket: 'crypto', lossBucket: 'crypto' },
    emt: {
      label: 'Token di moneta elettronica in euro',
      rate: 26,
      gainBucket: 'crypto',
      lossBucket: 'crypto'
    },
    esente: { label: 'Non tassato (es. fondo pensione)', rate: 0, gainBucket: null, lossBucket: null }
  };
  const BOLLO = 0.002;
  const zainettoExpiry = year => year + 4; // usable until 31 December of the fourth following year

  /* ---------- reproducible random numbers ---------- */
  function rng(seed) {
    let a = seed >>> 0 || 1;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function normal(R) {
    let u = 0,
      v = 0;
    while (u === 0) u = R();
    while (v === 0) v = R();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function chiSq(R, df) {
    let s = 0;
    for (let i = 0; i < df; i++) {
      const z = normal(R);
      s += z * z;
    }
    return s;
  }
  function cholesky(M) {
    const n = M.length;
    for (let eps = 0; eps < 0.5; eps += 0.02) {
      const L = Array.from({ length: n }, () => Array(n).fill(0));
      let ok = true;
      for (let i = 0; i < n && ok; i++)
        for (let j = 0; j <= i; j++) {
          let s = M[i][j] + (i === j ? eps : 0);
          for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
          if (i === j) {
            if (s <= 0) {
              ok = false;
              break;
            }
            L[i][i] = Math.sqrt(s);
          } else L[i][j] = s / L[j][j];
        }
      if (ok) return L;
    }
    throw new Error('matrice di correlazione non valida');
  }
  const quantile = (sorted, q) => {
    if (!sorted.length) return NaN;
    const p = (sorted.length - 1) * q,
      lo = Math.floor(p),
      hi = Math.ceil(p);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (p - lo);
  };

  /* ---------- Monte Carlo simulation ----------
   p: { age, endAge, mode:'fire'|'age', retireAge, maxWorkAge, spending (€/year, today), saving (€/month, today), savingGrowth (%/year real),
        start (€), basis (€ invested), weights {class:%}, ret {class:{mu,sd}}, infl {mu,sd}, swr (%), taxRate (average % on gains),
        ter (%), bollo (bool, Italian stamp duty), pension {amount, fromAge}, sideIncome {amount, untilAge}, events [{age, amount}], flex {on, drop, cut},
        shock: null|'crash'|'stagflation'|'lostdecade', runs, seed, df } */
  function simulate(p) {
    const runs = p.runs || 2000,
      df = p.df || 5,
      R = rng(p.seed || 12345);
    const keys = CK.filter(k => (p.weights[k] || 0) > 0);
    if (!keys.length) throw new Error('Allocazione vuota');
    const wsum = keys.reduce((s, k) => s + p.weights[k], 0);
    const w = keys.map(k => p.weights[k] / wsum);
    const mu = keys.map(k => (p.ret[k] ? p.ret[k].mu : CLASSES.find(c => c.k === k).mu) / 100);
    const sd = keys.map(k => (p.ret[k] ? p.ret[k].sd : CLASSES.find(c => c.k === k).sd) / 100);
    const L = cholesky(keys.map(a => keys.map(b => corr(a, b))));
    const tScale = Math.sqrt((df - 2) / df);
    const years = Math.max(1, Math.round(p.endAge - p.age));
    const fireNumber = Math.max(0, p.spending - ((p.sideIncome && p.sideIncome.amount) || 0)) / (p.swr / 100);
    const paths = [];
    const fireAges = [];
    let success = 0,
      reachedCount = 0;
    const ruinAges = [];
    const inflMu = (p.infl ? p.infl.mu : 2) / 100,
      inflSd = (p.infl ? p.infl.sd : 1) / 100;
    const ter = (p.ter || 0) / 100,
      tax = (p.taxRate == null ? 26 : p.taxRate) / 100;
    for (let r = 0; r < runs; r++) {
      let pf = p.start,
        basis = Math.min(p.basis == null ? p.start : p.basis, p.start),
        price = 1,
        inflPrev = inflMu,
        retired = false,
        fireAge = null,
        byNumber = false,
        pfAtRetireReal = 0,
        ruined = false,
        ruinAge = null;
      const series = new Float64Array(years + 1);
      series[0] = pf;
      for (let y = 0; y < years; y++) {
        const age = p.age + y;
        const real = pf / price;
        if (!retired) {
          if (p.mode === 'age' ? age >= p.retireAge : real >= fireNumber || age >= (p.maxWorkAge || 70)) {
            retired = true;
            fireAge = age;
            pfAtRetireReal = real;
            byNumber = p.mode !== 'age' && real >= fireNumber;
          }
        }
        // flows in today's euros
        let cf = 0;
        if (!retired) cf += (p.saving || 0) * 12 * Math.pow(1 + (p.savingGrowth || 0) / 100, y);
        else {
          let spend = p.spending;
          if (p.flex && p.flex.on && real < pfAtRetireReal * (1 - (p.flex.drop || 20) / 100))
            spend *= 1 - (p.flex.cut || 10) / 100;
          cf -= spend;
          if (p.sideIncome && p.sideIncome.amount && age < (p.sideIncome.untilAge || 0))
            cf += p.sideIncome.amount;
        }
        if (p.pension && p.pension.amount && age >= p.pension.fromAge) cf += p.pension.amount;
        for (const e of p.events || []) if (Math.round(e.age) === age) cf += e.amount;
        const nominal = cf * price;
        if (nominal >= 0) {
          pf += nominal;
          basis += nominal;
        } else if (!ruined) {
          const need = -nominal;
          const g = pf > 0 ? Math.max(0, (pf - basis) / pf) : 0;
          const gross = need / Math.max(0.05, 1 - tax * g);
          if (gross >= pf) {
            ruined = true;
            ruinAge = age;
            pf = 0;
            basis = 0;
          } else {
            basis -= (basis * gross) / pf;
            pf -= gross;
          }
        }
        if (!ruined && pf > 0) {
          if (p.bollo) pf -= pf * BOLLO;
          pf -= pf * ter;
          // correlated returns with fat tails (Student's t), yearly rebalancing to target
          const z = keys.map(() => normal(R));
          const s = Math.sqrt(df / chiSq(R, df));
          let growth = 0;
          for (let i = 0; i < keys.length; i++) {
            let e = 0;
            for (let j = 0; j <= i; j++) e += L[i][j] * z[j];
            let ret = mu[i] + sd[i] * e * s * tScale;
            const yr = fireAge != null ? age - fireAge : -1;
            if (p.shock === 'crash' && yr === 0)
              ret =
                {
                  azioni: -0.4,
                  immobiliare: -0.35,
                  crypto: -0.7,
                  oro: 0.05,
                  obbligazioni: 0.02,
                  liquidita: 0.01
                }[keys[i]] ?? ret;
            if (
              p.shock === 'lostdecade' &&
              yr >= 0 &&
              yr < 10 &&
              (keys[i] === 'azioni' || keys[i] === 'immobiliare')
            )
              ret = 0;
            if (p.shock === 'stagflation' && yr >= 0 && yr < 10)
              ret = Math.min(ret, keys[i] === 'oro' ? 0.07 : keys[i] === 'liquidita' ? 0.04 : 0.02);
            growth += w[i] * Math.max(-0.95, ret);
          }
          pf *= 1 + growth;
        }
        let infl = inflMu + 0.6 * (inflPrev - inflMu) + inflSd * 0.8 * normal(R);
        if (p.shock === 'stagflation' && fireAge != null && age - fireAge >= 0 && age - fireAge < 10)
          infl = 0.07;
        inflPrev = infl;
        price *= 1 + Math.max(-0.05, infl);
        series[y + 1] = ruined ? 0 : pf / price;
      }
      if (!ruined) success++;
      else ruinAges.push(ruinAge);
      if (fireAge != null && (p.mode === 'age' || byNumber)) {
        reachedCount++;
        fireAges.push(fireAge);
      }
      paths.push(series);
    }
    // percentiles by age (today's euros)
    const bands = { p10: [], p25: [], p50: [], p75: [], p90: [] };
    for (let y = 0; y <= years; y++) {
      const col = paths.map(s => s[y]).sort((a, b) => a - b);
      bands.p10.push(quantile(col, 0.1));
      bands.p25.push(quantile(col, 0.25));
      bands.p50.push(quantile(col, 0.5));
      bands.p75.push(quantile(col, 0.75));
      bands.p90.push(quantile(col, 0.9));
    }
    fireAges.sort((a, b) => a - b);
    ruinAges.sort((a, b) => a - b);
    return {
      runs,
      success: success / runs,
      fireNumber,
      reached: reachedCount / runs,
      fireAge: fireAges.length
        ? { p10: quantile(fireAges, 0.1), p50: quantile(fireAges, 0.5), p90: quantile(fireAges, 0.9) }
        : null,
      ruinAgeMedian: ruinAges.length ? quantile(ruinAges, 0.5) : null,
      final: { p10: bands.p10[years], p50: bands.p50[years], p90: bands.p90[years] },
      ages: Array.from({ length: years + 1 }, (_, i) => p.age + i),
      bands
    };
  }
  /* maximum yearly spending with success probability ≥ target (binary search) */
  function safeSpending(p, target = 0.9) {
    let lo = 0,
      hi = Math.max(p.spending * 3, 10000);
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      const r = simulate({ ...p, spending: mid, runs: Math.min(p.runs || 600, 600) });
      if (r.success >= target) lo = mid;
      else hi = mid;
    }
    return Math.floor(lo / 100) * 100;
  }
  /* Coast FIRE: capital that is enough today, with no more contributions, to reach the FIRE number at the target age */
  function coastNumber(fireNumber, years, realReturnPct) {
    return fireNumber / Math.pow(1 + realReturnPct / 100, Math.max(0, years));
  }
  function expectedReturn(weights, ret) {
    let s = 0,
      t = 0;
    for (const c of CLASSES) {
      const wt = weights[c.k] || 0;
      if (wt) {
        s += wt * (ret[c.k] || c).mu;
        t += wt;
      }
    }
    return t ? s / t : 0;
  }

  /* ---------- taxes on a sale, with Italian loss carry-forward ("zainetto") ----------
    sales: [{taxClass, gain (€, may be negative)}] · zainetto: [{year, amount, bucket}] · year: current year   */
  function taxOnSales(sales, zainetto, year) {
    const z = (zainetto || [])
      .filter(e => zainettoExpiry(e.year) >= year && e.amount > 0)
      .map(e => ({ ...e }))
      .sort((a, b) => a.year - b.year);
    let tax = 0,
      used = 0;
    const generated = { diversi: 0, crypto: 0 };
    const lines = [];
    // first, losses of the year offset gains of the same type
    const pool = { diversi: 0, crypto: 0 };
    for (const s of sales) {
      const t = TAX[s.taxClass] || TAX.azioni;
      if (s.gain < 0 && t.lossBucket) pool[t.lossBucket] += -s.gain;
    }
    for (const s of sales) {
      const t = TAX[s.taxClass] || TAX.azioni;
      if (!(s.gain > 0)) continue;
      let taxable = s.gain;
      if (t.gainBucket) {
        const share = t.offsetShare || 1;
        let offsettable = taxable * share;
        const fromPool = Math.min(pool[t.gainBucket], offsettable);
        pool[t.gainBucket] -= fromPool;
        offsettable -= fromPool;
        let fromZ = 0;
        for (const e of z) {
          if (e.bucket !== t.gainBucket || offsettable <= 0) continue;
          const u = Math.min(e.amount, offsettable);
          e.amount -= u;
          offsettable -= u;
          fromZ += u;
        }
        used += fromZ;
        taxable = Math.max(0, taxable - (fromPool + fromZ) / share);
      }
      const tx = (taxable * t.rate) / 100;
      tax += tx;
      lines.push({ taxClass: s.taxClass, gain: s.gain, taxable, tax: tx });
    }
    generated.diversi = pool.diversi;
    generated.crypto = pool.crypto;
    return {
      tax: Math.round(tax * 100) / 100,
      zainettoUsed: Math.round(used * 100) / 100,
      zainettoGenerated: generated,
      lines,
      zainettoLeft: z
    };
  }

  /* ---------- rebalancing ----------
     holdings: [{id, cls, value, cost, taxClass}] · target {class:%} · cash: cash to take into account (class "liquidita") */
  function allocation(holdings, cash) {
    const by = {};
    let tot = 0;
    for (const h of holdings) {
      const v = Math.max(0, h.value || 0);
      by[h.cls] = (by[h.cls] || 0) + v;
      tot += v;
    }
    if (cash > 0) {
      by.liquidita = (by.liquidita || 0) + cash;
      tot += cash;
    }
    return { by, tot };
  }
  function drift(holdings, target, cash, tol = 5) {
    const { by, tot } = allocation(holdings, cash);
    const ts = Object.values(target).reduce((s, v) => s + (+v || 0), 0) || 100;
    return CK.filter(k => (target[k] || 0) > 0 || (by[k] || 0) > 0).map(k => {
      const cur = tot ? ((by[k] || 0) / tot) * 100 : 0,
        tgt = ((target[k] || 0) / ts) * 100;
      return {
        k,
        value: by[k] || 0,
        cur,
        tgt,
        diff: cur - tgt,
        out: Math.abs(cur - tgt) > tol,
        gapEur: (tgt / 100) * tot - (by[k] || 0)
      };
    });
  }
  /* new contributions only: fill the most underweight class first */
  function contributionPlan(holdings, target, cash, amount) {
    const { by, tot } = allocation(holdings, cash);
    const ts = Object.values(target).reduce((s, v) => s + (+v || 0), 0) || 100;
    const newTot = tot + amount;
    const need = {};
    let needSum = 0;
    for (const k of CK) {
      const want = ((target[k] || 0) / ts) * newTot;
      const n = Math.max(0, want - (by[k] || 0));
      if (n > 0) {
        need[k] = n;
        needSum += n;
      }
    }
    const plan = {};
    if (needSum <= 0) {
      for (const k of CK) if (target[k]) plan[k] = (amount * target[k]) / ts;
    } else for (const k in need) plan[k] = (amount * need[k]) / needSum;
    for (const k in plan) plan[k] = Math.round(plan[k] * 100) / 100;
    return plan;
  }
  function monthsToRebalance(holdings, target, cash, monthly, tol = 5, max = 240) {
    if (!(monthly > 0)) return null;
    let hs = holdings.map(h => ({ ...h }));
    let c = cash;
    for (let m = 0; m <= max; m++) {
      if (!drift(hs, target, c, tol).some(d => d.out)) return m;
      const plan = contributionPlan(hs, target, c, monthly);
      for (const k in plan) {
        if (k === 'liquidita') {
          c += plan[k];
          continue;
        }
        const h = hs.find(x => x.cls === k);
        if (h) h.value += plan[k];
        else hs.push({ cls: k, value: plan[k], cost: plan[k] });
      }
    }
    return null;
  }
  /* full rebalancing with tax-efficient sales (positions at a loss first, then those with the smallest % gain) */
  function fullRebalance(holdings, target, cash, zainetto, year) {
    const d = drift(holdings, target, cash, 0);
    const sells = [],
      buys = [];
    for (const row of d) {
      if (row.gapEur < -1) {
        // overweight: sell
        let toSell = -row.gapEur;
        if (row.k === 'liquidita') {
          sells.push({ cls: 'liquidita', id: null, amount: Math.min(toSell, cash), gain: 0 });
          continue;
        }
        const hs = holdings
          .filter(h => h.cls === row.k && h.value > 0)
          .sort((a, b) => (a.value - a.cost) / a.value - (b.value - b.cost) / b.value);
        for (const h of hs) {
          if (toSell <= 0.5) break;
          const amt = Math.min(h.value, toSell);
          const gain = ((h.value - h.cost) * amt) / h.value;
          sells.push({
            cls: row.k,
            id: h.id,
            amount: Math.round(amt * 100) / 100,
            gain: Math.round(gain * 100) / 100,
            taxClass: h.taxClass
          });
          toSell -= amt;
        }
      } else if (row.gapEur > 1) {
        // underweight: buy, spread over the existing positions of the class
        const hs = holdings.filter(h => h.cls === row.k && h.value > 0);
        const tv = hs.reduce((s, h) => s + h.value, 0);
        if (!hs.length || row.k === 'liquidita')
          buys.push({ cls: row.k, id: null, amount: Math.round(row.gapEur * 100) / 100 });
        else
          for (const h of hs)
            buys.push({
              cls: row.k,
              id: h.id,
              amount: Math.round(((row.gapEur * h.value) / tv) * 100) / 100
            });
      }
    }
    const t = taxOnSales(
      sells.filter(s => s.id).map(s => ({ taxClass: s.taxClass, gain: s.gain })),
      zainetto,
      year
    );
    return { sells, buys, tax: t.tax, zainettoUsed: t.zainettoUsed, zainettoGenerated: t.zainettoGenerated };
  }
  /* ---------- per-holding allocation: target = { holdingId: % } ---------- */
  function assetDrift(holdings, target, tol = 5) {
    const tot = holdings.reduce((s, h) => s + h.value, 0),
      ts = holdings.reduce((s, h) => s + (+target[h.id] || 0), 0) || 100;
    return holdings.map(h => {
      const cur = tot ? (h.value / tot) * 100 : 0,
        tgt = ((+target[h.id] || 0) / ts) * 100;
      return {
        id: h.id,
        value: h.value,
        cur,
        tgt,
        diff: cur - tgt,
        out: Math.abs(cur - tgt) > tol,
        gapEur: (tgt / 100) * tot - h.value
      };
    });
  }
  /* new contributions: most underweight holdings first, selling nothing */
  function assetContribution(holdings, target, amount) {
    const tot = holdings.reduce((s, h) => s + h.value, 0),
      ts = holdings.reduce((s, h) => s + (+target[h.id] || 0), 0) || 100;
    const newTot = tot + amount,
      need = {},
      plan = {};
    let needSum = 0;
    for (const h of holdings) {
      const n = Math.max(0, ((+target[h.id] || 0) / ts) * newTot - h.value);
      if (n > 0) {
        need[h.id] = n;
        needSum += n;
      }
    }
    if (needSum <= 0) {
      for (const h of holdings) if (+target[h.id] > 0) plan[h.id] = (amount * target[h.id]) / ts;
    } else for (const k in need) plan[k] = (amount * need[k]) / needSum;
    for (const k in plan) plan[k] = Math.round(plan[k] * 100) / 100;
    return plan;
  }
  function assetMonths(holdings, target, monthly, tol = 5, max = 240) {
    if (!(monthly > 0)) return null;
    const hs = holdings.map(h => ({ ...h }));
    for (let m = 0; m <= max; m++) {
      if (!assetDrift(hs, target, tol).some(d => d.out)) return m;
      const plan = assetContribution(hs, target, monthly);
      for (const k in plan) {
        const h = hs.find(x => x.id === k);
        if (h) h.value += plan[k];
      }
    }
    return null;
  }
  function assetRebalance(holdings, target, zainetto, year) {
    const sells = [],
      buys = [];
    for (const d of assetDrift(holdings, target, 0)) {
      const h = holdings.find(x => x.id === d.id);
      if (d.gapEur < -1) {
        const amt = Math.min(h.value, -d.gapEur);
        sells.push({
          id: h.id,
          cls: h.cls,
          taxClass: h.taxClass,
          amount: Math.round(amt * 100) / 100,
          gain: Math.round((((h.value - h.cost) * amt) / h.value) * 100) / 100
        });
      } else if (d.gapEur > 1) buys.push({ id: h.id, cls: h.cls, amount: Math.round(d.gapEur * 100) / 100 });
    }
    const t = taxOnSales(
      sells.map(s => ({ taxClass: s.taxClass, gain: s.gain })),
      zainetto,
      year
    );
    return { sells, buys, tax: t.tax, zainettoUsed: t.zainettoUsed, zainettoGenerated: t.zainettoGenerated };
  }
  function feeDrag(value, terPct, years = 20, grossPct = 5) {
    const a = value * Math.pow(1 + grossPct / 100, years),
      b = value * Math.pow(1 + (grossPct - terPct) / 100, years);
    return Math.round(a - b);
  }

  /* ================= INVESTMENT HISTORY =================
    trades: [{id, date:'YYYY-MM-DD', side:'buy'|'sell', qty, amount (€ paid or received, fees included), key}]
    Weighted average cost (Italian tax rule): sales do not change the average cost. */
  function tradeBook(trades) {
    const pos = {},
      realized = [];
    const T = [...trades]
      .filter(t => t.qty > 0 && t.amount >= 0)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.side === 'buy' ? -1 : 1));
    for (const t of T) {
      const p = (pos[t.key] = pos[t.key] || {
        key: t.key,
        qty: 0,
        cost: 0,
        bought: 0,
        sold: 0,
        buys: 0,
        sells: 0,
        first: t.date,
        last: t.date,
        realized: 0
      });
      p.last = t.date;
      if (t.side === 'buy') {
        p.qty += t.qty;
        p.cost += t.amount;
        p.bought += t.amount;
        p.buys++;
      } else {
        const q = Math.min(t.qty, p.qty),
          avg = p.qty > 0 ? p.cost / p.qty : 0,
          basis = avg * q;
        const proceeds = t.qty > 0 ? (t.amount * q) / t.qty : 0,
          gain = proceeds - basis;
        p.qty -= q;
        p.cost -= basis;
        p.sold += t.amount;
        p.sells++;
        p.realized += gain;
        if (p.qty < 1e-9) {
          p.qty = 0;
          p.cost = 0;
        }
        realized.push({ key: t.key, date: t.date, qty: q, proceeds, basis, gain });
      }
    }
    for (const k in pos) {
      const p = pos[k];
      p.avg = p.qty > 0 ? p.cost / p.qty : 0;
      p.closed = p.qty === 0;
    }
    return { pos, realized };
  }
  /* money-weighted annual return (XIRR). flows: [{date, amount}] with outflows negative */
  function xirr(flows) {
    const F = flows
      .filter(f => f.amount && f.date)
      .map(f => ({ t: Date.parse(f.date + 'T12:00:00Z'), a: f.amount }))
      .sort((a, b) => a.t - b.t);
    if (F.length < 2 || !F.some(f => f.a > 0) || !F.some(f => f.a < 0)) return null;
    const t0 = F[0].t,
      Y = 365.25 * 864e5;
    const npv = r => F.reduce((s, f) => s + f.a / Math.pow(1 + r, (f.t - t0) / Y), 0);
    let lo = -0.9999,
      hi = 10,
      flo = npv(lo),
      fhi = npv(hi);
    if (flo * fhi > 0) return null;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2,
        fm = npv(mid);
      if (Math.abs(fm) < 1e-7) return mid;
      if (flo * fm < 0) {
        hi = mid;
      } else {
        lo = mid;
        flo = fm;
      }
    }
    return (lo + hi) / 2;
  }
  const ymAdd = (k, n) => {
    let y = +k.slice(0, 4),
      m = +k.slice(5, 7) - 1 + n;
    y += Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    return y + '-' + String(m + 1).padStart(2, '0');
  };
  function monthsBetween(a, b) {
    const out = [];
    for (let k = a; k <= b && out.length < 600; k = ymAdd(k, 1)) out.push(k);
    return out;
  }
  /* monthly series (month end): net invested capital and market value.
    prices: { key: { 'YYYY-MM': price € } } – a missing month uses the last known price, then the average cost. now: {key: current price} for the current month */
  function historySeries(trades, prices, nowPrices, today) {
    const T = [...trades].filter(t => t.qty > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!T.length) return [];
    const months = monthsBetween(T[0].date.slice(0, 7), today.slice(0, 7));
    const qty = {},
      cost = {},
      last = {};
    let invested = 0,
      i = 0;
    return months.map(mk => {
      for (; i < T.length && T[i].date.slice(0, 7) <= mk; i++) {
        const t = T[i],
          k = t.key;
        qty[k] = qty[k] || 0;
        cost[k] = cost[k] || 0;
        if (t.side === 'buy') {
          qty[k] += t.qty;
          cost[k] += t.amount;
          invested += t.amount;
        } else {
          const q = Math.min(t.qty, qty[k]),
            avg = qty[k] ? cost[k] / qty[k] : 0;
          qty[k] -= q;
          cost[k] -= avg * q;
          invested -= t.amount;
        }
      }
      let value = 0,
        a = false;
      for (const k in qty) {
        if (qty[k] <= 1e-9) continue;
        let p =
          mk === today.slice(0, 7) && nowPrices && nowPrices[k] > 0
            ? nowPrices[k]
            : prices && prices[k] && prices[k][mk];
        if (p > 0) last[k] = p;
        else if (last[k] > 0) p = last[k];
        else {
          p = cost[k] / qty[k];
          a = true;
        }
        value += qty[k] * p;
      }
      return {
        m: mk,
        invested: Math.round(invested * 100) / 100,
        value: Math.round(value * 100) / 100,
        approx: a
      };
    });
  }
  /* match the bank's abbreviated names to holdings: equal quantity, then cost, then shared words */
  const NORM = {
    ishs: 'ishares',
    ish: 'ishares',
    wld: 'world',
    wrl: 'world',
    wrld: 'world',
    mom: 'momentum',
    gov: 'govt',
    govt: 'govt',
    eur: 'euro',
    em: 'emerging',
    xtr: 'xtrackers',
    xtr2: 'xtrackers',
    van: 'vanguard',
    ssga: 'spdr',
    sp: 's&p',
    '1cc': '',
    ac: 'acc',
    dist: 'dist',
    or: 'overnight',
    sw: 'swap'
  };
  const toks = s =>
    new Set(
      String(s || '')
        .toLowerCase()
        .replace(/[^a-z0-9& ]+/g, ' ')
        .split(/\s+/)
        .map(w => (NORM[w] !== undefined ? NORM[w] : w))
        .filter(
          w =>
            w && w.length > 1 && !['ucits', 'etf', 'usd', 'the', 'acc', 'msci', 'index', 'fund'].includes(w)
        )
    );
  function matchTradeNames(groups, holdings) {
    // groups: [{name, qty (net), cost}] · holdings: [{id, name, qty, avg}]
    const pairs = [];
    for (const g of groups)
      for (const h of holdings) {
        let s = 0;
        const hc = h.qty * h.avg;
        if (g.qty > 0 && Math.abs(g.qty - h.qty) < 1e-6) s += 100;
        else if (g.qty > 0 && Math.abs(g.qty / 100 - h.qty) < 1e-6) s += 90; // bonds: the bank reports the nominal value
        if (g.qty > 0 && hc > 0 && Math.abs(g.cost - hc) / hc < 0.03) s += 50;
        const a = toks(g.name),
          b = toks(h.name);
        let c = 0;
        for (const w of a) if (b.has(w)) c++;
        s += c * 10;
        if (s >= 20) pairs.push({ g: g.name, h: h.id, s });
      }
    pairs.sort((x, y) => y.s - x.s);
    const out = {},
      usedH = new Set();
    for (const p of pairs)
      if (!(p.g in out) && !usedH.has(p.h)) {
        out[p.g] = p.h;
        usedH.add(p.h);
      }
    return out;
  }

  /* ================= ASK YOUR DATA =================
    The AI never sees the data: it only produces this "recipe", which is executed here. */
  const MEASURES = ['totale', 'media_mensile', 'conteggio', 'media', 'massimo', 'minimo'];
  const GROUPS = [
    'nessuno',
    'mese',
    'anno',
    'categoria',
    'giorno_settimana',
    'esercente',
    'conto',
    'titolo',
    'classe',
    'portafoglio'
  ];
  const WD = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
  const MES = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
  function sanitizeSpec(o, allowed) {
    // allowed: {categories:[], accounts:[]} – anything not listed is dropped
    if (!o || typeof o !== 'object') return null;
    const d = s => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : null);
    const qs = (Array.isArray(o.queries) ? o.queries : [])
      .slice(0, 4)
      .map((q, i) => {
        if (!q || typeof q !== 'object') return null;
        const id = /^[a-z]$/.test(q.id) ? q.id : 'abcd'[i];
        const source = q.source === 'investimenti' ? 'investimenti' : 'movimenti';
        const measure =
          source === 'investimenti'
            ? ['valore', 'costo', 'guadagno', 'conteggio'].includes(q.measure)
              ? q.measure
              : 'valore'
            : MEASURES.includes(q.measure)
              ? q.measure
              : 'totale';
        const type = ['uscite', 'entrate', 'tutti', 'saldo'].includes(q.type) ? q.type : 'uscite';
        let group = GROUPS.includes(q.group) ? q.group : 'nessuno';
        if (source === 'investimenti' && !['nessuno', 'titolo', 'classe', 'portafoglio'].includes(group))
          group = 'nessuno';
        if (source === 'movimenti' && ['titolo', 'classe', 'portafoglio'].includes(group)) group = 'nessuno';
        const categories = (Array.isArray(q.categories) ? q.categories : [])
          .filter(c => allowed.categories.includes(c))
          .slice(0, 25);
        const accounts = (Array.isArray(q.accounts) ? q.accounts : [])
          .filter(c => allowed.accounts.includes(c))
          .slice(0, 10);
        const text = String(q.text || '')
          .replace(/[^\p{L}\p{N} &'.-]/gu, '')
          .trim()
          .slice(0, 40);
        return {
          id,
          source,
          measure,
          type,
          group,
          categories,
          accounts,
          text,
          from: d(q.from),
          to: d(q.to),
          limit: Math.max(1, Math.min(24, +q.limit || 10)),
          order: q.order === 'asc' ? 'asc' : 'desc'
        };
      })
      .filter(Boolean);
    const ids = new Set();
    const queries = qs.filter(q => !ids.has(q.id) && ids.add(q.id));
    const answer = String(o.answer || '')
      .replace(/[<>]/g, '')
      .slice(0, 600);
    const ch =
      o.chart && typeof o.chart === 'object' && ids.has(o.chart.query)
        ? {
            query: o.chart.query,
            kind: ['barre', 'linea', 'torta'].includes(o.chart.kind) ? o.chart.kind : 'barre'
          }
        : null;
    const clarify = o.clarify ? String(o.clarify).replace(/[<>]/g, '').slice(0, 300) : '';
    const title = String(o.title || '')
      .replace(/[<>]/g, '')
      .slice(0, 80);
    if (!queries.length && !clarify) return null;
    return { title, queries, answer, chart: ch, clarify };
  }
  /* ctx: {tx:[{date,amount,cat,note,accountId}], neutral:[cat], accAlias:{alias:id}, accName:{id:name}, holdings:[{name,cls,pf,value,cost}], today} */
  function runQuery(q, ctx) {
    if (q.source === 'investimenti') {
      const rows = {};
      let n = 0;
      for (const h of ctx.holdings || []) {
        const v =
          q.measure === 'costo'
            ? h.cost
            : q.measure === 'guadagno'
              ? h.value - h.cost
              : q.measure === 'conteggio'
                ? 1
                : h.value;
        const lab =
          q.group === 'titolo'
            ? h.name
            : q.group === 'classe'
              ? h.clsLabel || h.cls || 'Altro'
              : q.group === 'portafoglio'
                ? h.pfName || 'Principale'
                : 'Totale';
        rows[lab] = (rows[lab] || 0) + v;
        n++;
      }
      return finish(q, rows, n, null, q.measure === 'conteggio');
    }
    const neutral = new Set(ctx.neutral || []),
      cats = new Set(q.categories),
      accs = new Set(q.accounts.map(a => ctx.accAlias[a]).filter(Boolean));
    const txt = q.text.toLowerCase();
    const dates = (ctx.tx || []).map(t => t.date).sort();
    const lastClosed = ymAdd(ctx.today.slice(0, 7), -1);
    const from = q.from || dates[0] || ctx.today,
      to = q.to || ctx.today;
    const rows = {},
      cnt = {};
    let n = 0;
    const vals = [];
    for (const t of ctx.tx || []) {
      if (t.date < from || t.date > to) continue;
      if (cats.size ? !cats.has(t.cat) : neutral.has(t.cat)) continue;
      if (accs.size && !accs.has(t.accountId)) continue;
      if (
        txt &&
        !String(t.note || '')
          .toLowerCase()
          .includes(txt)
      )
        continue;
      let v;
      if (q.type === 'uscite') {
        if (t.amount >= 0) continue;
        v = -t.amount;
      } else if (q.type === 'entrate') {
        if (t.amount <= 0) continue;
        v = t.amount;
      } else if (q.type === 'saldo') v = t.amount;
      else v = Math.abs(t.amount);
      const d = new Date(t.date + 'T12:00:00Z');
      const lab =
        q.group === 'mese'
          ? t.date.slice(0, 7)
          : q.group === 'anno'
            ? t.date.slice(0, 4)
            : q.group === 'categoria'
              ? t.cat
              : q.group === 'giorno_settimana'
                ? WD[(d.getUTCDay() + 6) % 7]
                : q.group === 'esercente'
                  ? String(t.note || t.cat)
                      .split(' · ')[0]
                      .trim() || t.cat
                  : q.group === 'conto'
                    ? ctx.accName[t.accountId] || 'Conto'
                    : 'Totale';
      n++;
      vals.push(v);
      if (q.measure === 'massimo') rows[lab] = Math.max(rows[lab] ?? -Infinity, v);
      else if (q.measure === 'minimo') rows[lab] = Math.min(rows[lab] ?? Infinity, v);
      else {
        rows[lab] = (rows[lab] || 0) + (q.measure === 'conteggio' ? 1 : v);
        cnt[lab] = (cnt[lab] || 0) + 1;
      }
    }
    if (q.group === 'mese' && !['massimo', 'minimo'].includes(q.measure)) {
      // months without transactions count as 0, so trends are honest
      let a0 = from.slice(0, 7),
        b0 = (to < ctx.today ? to : ctx.today).slice(0, 7);
      if (dates[0] && a0 < dates[0].slice(0, 7)) a0 = dates[0].slice(0, 7);
      for (const k of monthsBetween(a0, b0))
        if (!(k in rows)) {
          rows[k] = 0;
          cnt[k] = cnt[k] || 1;
        }
    }
    // monthly average: divide by the months of the period (excluding the current month when the period ends today)
    let months = 1;
    if (q.measure === 'media_mensile') {
      let a = from.slice(0, 7),
        b = to.slice(0, 7);
      if (b >= ctx.today.slice(0, 7) && a <= lastClosed) b = lastClosed;
      if (dates[0] && a < dates[0].slice(0, 7)) a = dates[0].slice(0, 7);
      months = Math.max(1, monthsBetween(a, b).length);
      for (const k in rows) rows[k] /= months;
    }
    if (q.measure === 'media') for (const k in rows) rows[k] /= cnt[k];
    return finish(q, rows, n, months, q.measure === 'conteggio');
  }
  function finish(q, rows, n, months, isCount) {
    let list = Object.entries(rows).map(([label, value]) => ({ label, value }));
    const chrono = ['mese', 'anno'].includes(q.group),
      wd = q.group === 'giorno_settimana';
    if (chrono) list.sort((a, b) => (a.label < b.label ? -1 : 1));
    else if (wd) list.sort((a, b) => WD.indexOf(a.label) - WD.indexOf(b.label));
    else list.sort((a, b) => (q.order === 'asc' ? a.value - b.value : b.value - a.value));
    const all = list.length;
    if (!chrono && !wd) list = list.slice(0, q.limit);
    const agg = ['massimo', 'minimo'].includes(q.measure)
      ? list.length
        ? q.measure === 'massimo'
          ? Math.max(...list.map(r => r.value))
          : Math.min(...list.map(r => r.value))
        : 0
      : q.measure === 'media'
        ? list.length
          ? list.reduce((s, r) => s + r.value, 0) / list.length
          : 0
        : Object.values(rows).reduce((s, v) => s + v, 0);
    const top =
      [...list].sort((a, b) => (q.order === 'asc' ? a.value - b.value : b.value - a.value))[0] || null;
    if (chrono)
      for (const r of list)
        if (q.group === 'mese') r.label = MES[+r.label.slice(5) - 1] + ' ' + r.label.slice(2, 4);
    return {
      id: q.id,
      value: q.group === 'nessuno' ? (list[0] ? list[0].value : 0) : agg,
      rows: q.group === 'nessuno' ? [] : list,
      top,
      n,
      months,
      groups: all,
      isCount
    };
  }
  /* builds the answer from the text template: {a} {a.top} {a.top_value} {a.n} {diff:a-b} {pct:a/b} {change:a:b} */
  function renderAnswer(tpl, R, fmt) {
    const val = id => (R[id] ? R[id].value : null);
    return String(tpl || '').replace(/\{([^{}]{1,20})\}/g, (m, k) => {
      let x;
      if ((x = k.match(/^diff:([a-d])-([a-d])$/))) {
        const a = val(x[1]),
          b = val(x[2]);
        return a == null || b == null ? '—' : fmt.signed(a - b);
      }
      if ((x = k.match(/^pct:([a-d])\/([a-d])$/))) {
        const a = val(x[1]),
          b = val(x[2]);
        return a == null || !b ? '—' : fmt.pct((a / b) * 100);
      }
      if ((x = k.match(/^change:([a-d]):([a-d])$/))) {
        const a = val(x[1]),
          b = val(x[2]);
        return a == null || !b ? '—' : fmt.signedPct(((a - b) / Math.abs(b)) * 100);
      }
      if ((x = k.match(/^([a-d])\.(top|top_value|n|groups|months)$/))) {
        const r = R[x[1]];
        if (!r) return '—';
        if (x[2] === 'top') return r.top ? r.top.label : '—';
        if (x[2] === 'top_value')
          return r.top ? (r.isCount ? fmt.n(r.top.value) : fmt.eur(r.top.value)) : '—';
        return fmt.n(r[x[2]] || 0);
      }
      if ((x = k.match(/^([a-d])$/))) {
        const r = R[x[1]];
        return r ? (r.isCount ? fmt.n(r.value) : fmt.eur(r.value)) : '—';
      }
      return '—';
    });
  }

  /* ================= FINANCIAL HEALTH (report for the user or an advisor) =================
     Common rules of thumb used by financial planners. They are indicative only.
     in: {
       months: [{inc, out}]      complete months used as reference (e.g. the last 12)
       cash                      money on current/savings accounts and cash
       cardDebt                  credit card spending not yet debited
       investments, invCost      market value and cost of investments
       assets                    other assets (home, car…)
       debts                     outstanding loans
       fixedMonthly              recurring monthly expenses (rent, utilities, subscriptions…)
       debtPayments              monthly loan payments
       terCost                   yearly fund costs in € (TER)
       topWeight                 share of the largest holding in the portfolio (0–1)
       xirr                      annual return of the investments, if known (0.05 = 5%)
       netStart, netEnd          net worth at the start and end of the reference period
     }
     out: [{ k, label, value, unit: 'pct'|'months'|'eur'|'eurm', status: 'good'|'warn'|'crit'|'info', target, note }] */
  const AFFORD_DTI = 0.33; // banks usually keep loan payments under about a third of net income
  function healthIndicators(inp) {
    const m = (inp.months || []).filter(x => x && (x.inc > 0 || x.out > 0));
    const n = m.length;
    const avgInc = n ? m.reduce((s, x) => s + x.inc, 0) / n : 0;
    const avgOut = n ? m.reduce((s, x) => s + x.out, 0) / n : 0;
    const totalAssets = Math.max(0, inp.cash) + (inp.investments || 0) + (inp.assets || 0);
    const debts = (inp.debts || 0) + (inp.cardDebt || 0);
    const level = (v, good, warn, higherIsBetter = true) =>
      higherIsBetter
        ? v >= good
          ? 'good'
          : v >= warn
            ? 'warn'
            : 'crit'
        : v <= good
          ? 'good'
          : v <= warn
            ? 'warn'
            : 'crit';
    const out = [];
    const add = (k, label, value, unit, status, target, note) =>
      out.push({ k, label, value, unit, status, target, note });
    if (n) {
      const rate = avgInc ? (avgInc - avgOut) / avgInc : 0;
      add(
        'saving',
        'Tasso di risparmio',
        rate,
        'pct',
        level(rate, 0.2, 0.1),
        'consigliato almeno 20%',
        `in media ${Math.round(avgInc - avgOut)} € al mese su ${Math.round(avgInc)} € di entrate`
      );
      const em = avgOut ? Math.max(0, inp.cash) / avgOut : 0;
      add(
        'emergency',
        'Fondo di emergenza',
        em,
        'months',
        level(em, 3, 1),
        'consigliati 3–6 mesi di spese',
        'mesi di spese coperti dalla liquidità'
      );
      const fixed = avgInc ? (inp.fixedMonthly || 0) / avgInc : 0;
      add(
        'fixed',
        'Spese fisse sul reddito',
        fixed,
        'pct',
        level(fixed, 0.5, 0.7, false),
        'consigliato sotto il 50%',
        'affitto, utenze, abbonamenti e altre spese ricorrenti'
      );
      const dti = avgInc ? (inp.debtPayments || 0) / avgInc : 0;
      add(
        'dti',
        'Rata su reddito',
        dti,
        'pct',
        inp.debtPayments ? level(dti, 0.3, 0.4, false) : 'good',
        'le banche chiedono di solito meno del 33%',
        inp.debtPayments ? 'rate mensili di mutui e prestiti' : 'nessuna rata in corso'
      );
      const afford = Math.max(0, AFFORD_DTI * avgInc - (inp.debtPayments || 0));
      add(
        'afford',
        'Rata aggiuntiva sostenibile',
        afford,
        'eurm',
        'info',
        'con il 33% del reddito netto in rate',
        'quanto potresti destinare a un nuovo mutuo o finanziamento'
      );
      const mean = avgOut,
        sd = Math.sqrt(m.reduce((s, x) => s + (x.out - mean) ** 2, 0) / n);
      const cv = mean ? sd / mean : 0;
      add(
        'volatility',
        'Variabilità delle spese',
        cv,
        'pct',
        level(cv, 0.15, 0.3, false),
        'sotto il 15% le spese sono regolari',
        'quanto cambiano le uscite da un mese all’altro'
      );
    }
    if (totalAssets > 0) {
      const lev = debts / totalAssets;
      add(
        'leverage',
        'Debiti sul patrimonio',
        lev,
        'pct',
        debts ? level(lev, 0.4, 0.6, false) : 'good',
        'consigliato sotto il 40%',
        debts ? 'debiti residui rispetto a tutto ciò che possiedi' : 'nessun debito'
      );
      add(
        'liquidity',
        'Liquidità sul totale',
        Math.max(0, inp.cash) / totalAssets,
        'pct',
        'info',
        '',
        'conti e contanti rispetto a tutte le attività'
      );
      add(
        'invested',
        'Investito sul totale',
        (inp.investments || 0) / totalAssets,
        'pct',
        'info',
        '',
        'quanto del patrimonio lavora sui mercati'
      );
    }
    if (inp.investments > 0) {
      if (inp.xirr != null && isFinite(inp.xirr))
        add(
          'xirr',
          'Rendimento annuo investimenti',
          inp.xirr,
          'pct',
          inp.xirr >= 0 ? 'good' : 'warn',
          '',
          'tiene conto di quando hai versato (XIRR)'
        );
      else if (inp.invCost > 0)
        add(
          'gain',
          'Guadagno latente',
          (inp.investments - inp.invCost) / inp.invCost,
          'pct',
          inp.investments >= inp.invCost ? 'good' : 'warn',
          '',
          'valore attuale rispetto al prezzo di carico'
        );
      const ter = (inp.terCost || 0) / inp.investments;
      add(
        'ter',
        'Costi annui dei fondi',
        ter,
        'pct',
        level(ter, 0.003, 0.008, false),
        'sotto lo 0,3% è un buon livello',
        `circa ${Math.round(inp.terCost || 0)} € all’anno`
      );
      if (inp.topWeight > 0)
        add(
          'concentration',
          'Peso del primo titolo',
          inp.topWeight,
          'pct',
          'info',
          '',
          'un ETF globale è già diversificato; un’azione singola no'
        );
    }
    if (inp.netStart != null && inp.netEnd != null)
      add(
        'networth',
        'Variazione del patrimonio netto',
        inp.netEnd - inp.netStart,
        'eur',
        inp.netEnd >= inp.netStart ? 'good' : 'warn',
        '',
        'differenza tra inizio e fine del periodo'
      );
    return out;
  }

  const API = {
    CLASSES,
    CK,
    TAX,
    BOLLO,
    corr,
    rng,
    cholesky,
    quantile,
    simulate,
    safeSpending,
    coastNumber,
    expectedReturn,
    taxOnSales,
    zainettoExpiry,
    allocation,
    drift,
    contributionPlan,
    monthsToRebalance,
    fullRebalance,
    assetDrift,
    assetContribution,
    assetMonths,
    assetRebalance,
    feeDrag,
    tradeBook,
    xirr,
    historySeries,
    matchTradeNames,
    monthsBetween,
    ymAdd,
    sanitizeSpec,
    runQuery,
    renderAnswer,
    healthIndicators,
    MEASURES,
    GROUPS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.POC_ENGINE = API;
})(typeof window !== 'undefined' ? window : globalThis);
