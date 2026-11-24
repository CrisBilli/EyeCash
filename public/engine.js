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

  /* ================= CAN I AFFORD IT? =================
     Simulates a purchase against the user's real numbers. Pure calculation: the view
     writes the sentences. Thresholds are the usual rules of thumb of banks and advisors.
     in: {
       kind: 'mortgage' | 'car' | 'purchase'
       price                  price of the house, car or purchase (€)
       downPayment            own money put in now (€); with payCash the whole price
       extraCosts             one-off costs on top of the price (€): notary, taxes, registration…
       ratePct, months        loan rate (yearly %) and length; ignored when paying cash
       payCash                car / purchase paid entirely now, no loan
       runningCosts           new monthly costs (car: insurance, fuel, maintenance) (€)
       rentNow                current monthly rent that the purchase replaces (mortgage) (€)
       monthlyIncome, monthlySpending   averages of the last complete months
       cash                   money available on accounts
       investments            investments that could be sold (used only if useInvestments)
       useInvestments         allow selling investments for the down payment
       existingPayments       monthly payments of loans already running (€)
       emergencyMonths        months of spending to keep aside (default 6)
       dtiLimit               maximum loan payments / income (default 0.33)
       maxLtv                 maximum loan / price for a mortgage (default 0.8)
     }
     out: numbers, checks [{ k, status: 'good'|'warn'|'crit', value }], verdict, maxPrice,
          monthsToAfford (0 = now, Infinity = not with the current savings), projection. */
  function loanPayment(principal, ratePct, months) {
    if (!(principal > 0) || !(months > 0)) return 0;
    const r = (ratePct || 0) / 1200;
    return r ? (principal * r) / (1 - Math.pow(1 + r, -months)) : principal / months;
  }
  function loanPrincipal(payment, ratePct, months) {
    if (!(payment > 0) || !(months > 0)) return 0;
    const r = (ratePct || 0) / 1200;
    return r ? (payment * (1 - Math.pow(1 + r, -months))) / r : payment * months;
  }
  function affordability(inp) {
    const income = Math.max(0, +inp.monthlyIncome || 0);
    const spending = Math.max(0, +inp.monthlySpending || 0);
    const price = Math.max(0, +inp.price || 0);
    const extra = Math.max(0, +inp.extraCosts || 0);
    const months = Math.max(0, Math.round(+inp.months || 0));
    const dtiLimit = inp.dtiLimit > 0 ? inp.dtiLimit : AFFORD_DTI;
    const maxLtv = inp.maxLtv > 0 ? inp.maxLtv : 0.8;
    const emergencyMonths = inp.emergencyMonths > 0 ? inp.emergencyMonths : 6;
    const cashNow = Math.max(0, +inp.cash || 0);
    const available = cashNow + (inp.useInvestments ? Math.max(0, +inp.investments || 0) : 0);
    const existing = Math.max(0, +inp.existingPayments || 0);
    const loanKind = inp.kind === 'mortgage' || !inp.payCash;
    const down = loanKind ? Math.min(price, Math.max(0, +inp.downPayment || 0)) : price;
    const loan = loanKind ? price - down : 0;
    const payment = loanKind ? loanPayment(loan, inp.ratePct, months) : 0;
    const totalInterest = loanKind ? Math.max(0, payment * months - loan) : 0;
    const upfront = down + extra;
    const rentSaved = inp.kind === 'mortgage' ? Math.max(0, +inp.rentNow || 0) : 0;
    const running = Math.max(0, +inp.runningCosts || 0);
    // monthly spending after the purchase: + new payment + running costs − rent no longer paid
    const spendingAfter = Math.max(0, spending + payment + running - rentSaved);
    const savingBefore = income - spending;
    const savingAfter = income - spendingAfter;
    const reserveAfter = emergencyMonths * spendingAfter;
    const cashAfter = available - upfront;
    const emergencyAfter = spendingAfter ? Math.max(0, cashAfter) / spendingAfter : Infinity;
    const dtiBefore = income ? existing / income : 0;
    const dtiAfter = income ? (existing + payment) / income : payment ? Infinity : 0;
    const ltv = price ? loan / price : 0;
    const level = (v, good, warn, higherIsBetter) =>
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

    const checks = [];
    checks.push({ k: 'upfront', status: cashAfter >= 0 ? 'good' : 'crit', value: upfront });
    checks.push({
      k: 'emergency',
      status: level(emergencyAfter, emergencyMonths, 3, true),
      value: emergencyAfter
    });
    if (payment) checks.push({ k: 'dti', status: level(dtiAfter, dtiLimit, 0.4, false), value: dtiAfter });
    checks.push({
      k: 'saving',
      status: savingAfter >= 0.1 * income && savingAfter > 0 ? 'good' : savingAfter >= 0 ? 'warn' : 'crit',
      value: savingAfter
    });
    if (inp.kind === 'mortgage')
      checks.push({ k: 'ltv', status: ltv <= maxLtv ? 'good' : ltv <= 0.95 ? 'warn' : 'crit', value: ltv });
    const verdict = checks.some(c => c.status === 'crit')
      ? 'no'
      : checks.some(c => c.status === 'warn')
        ? 'careful'
        : 'yes';

    // the highest price that passes the rules, with the same down payment, rate and length
    const reserveFor = p => {
      const pay = loanKind ? loanPayment(Math.max(0, p - down), inp.ratePct, months) : 0;
      return emergencyMonths * Math.max(0, spending + pay + running - rentSaved);
    };
    let maxPrice;
    if (loanKind) {
      const maxPayment = Math.max(0, dtiLimit * income - existing);
      const byIncome = down + loanPrincipal(maxPayment, inp.ratePct, months);
      const byLtv = inp.kind === 'mortgage' ? down / (1 - maxLtv) : Infinity;
      maxPrice = Math.min(byIncome, byLtv);
    } else {
      // paying cash: what is left after keeping the emergency fund and the extra costs
      maxPrice = Math.max(0, available - extra - reserveFor(0));
    }
    maxPrice = Math.max(0, Math.floor(maxPrice / 100) * 100);

    // months of saving (at today's pace) to have the money needed now and keep the emergency fund
    const need = upfront + reserveFor(price) - available;
    const monthsToAfford = need <= 0 ? 0 : savingBefore > 0 ? Math.ceil(need / savingBefore) : Infinity;

    // cash on the accounts over the next 36 months, without and with the purchase
    // (if investments may be sold, they cover the part of the upfront money that cash does not)
    const fromInvestments = inp.useInvestments
      ? Math.min(Math.max(0, +inp.investments || 0), Math.max(0, upfront - cashNow))
      : 0;
    const cashStart = cashNow - (upfront - fromInvestments);
    const projection = [];
    for (let m = 0; m <= 36; m++)
      projection.push({ m, before: cashNow + savingBefore * m, after: cashStart + savingAfter * m });

    return {
      loan,
      payment,
      months: loanKind ? months : 0,
      totalInterest,
      upfront,
      cashAfter,
      emergencyAfter,
      reserveAfter,
      savingBefore,
      savingAfter,
      spendingAfter,
      dtiBefore,
      dtiAfter,
      ltv,
      checks,
      verdict,
      maxPrice,
      monthsToAfford,
      projection
    };
  }

  /* ---------- "can I afford it?" questions in plain words ----------
     The AI (or the local parser below) turns a sentence into these parameters only:
     it never sees income, spending or balances, which the device adds afterwards. */
  const AFFORD_LIMITS = [
    ['price', 0, 1e8],
    ['loanAmount', 0, 1e8],
    ['downPayment', 0, 1e8],
    ['extraCosts', 0, 1e7],
    ['ratePct', 0, 30],
    ['years', 0, 40],
    ['runningCosts', 0, 1e5]
  ];
  /** Keeps only known parameters, within sensible ranges. */
  function sanitizeAfford(o) {
    if (!o || typeof o !== 'object') return null;
    const out = { kind: ['mortgage', 'car', 'purchase'].includes(o.kind) ? o.kind : 'purchase' };
    for (const [k, min, max] of AFFORD_LIMITS) {
      if (o[k] === null || o[k] === undefined || o[k] === '') continue;
      const n = +o[k];
      if (isFinite(n)) out[k] = Math.min(max, Math.max(min, n));
    }
    if (typeof o.payCash === 'boolean') out.payCash = o.payCash;
    if (typeof o.useInvestments === 'boolean') out.useInvestments = o.useInvestments;
    if (o.label) out.label = String(o.label).replace(/[<>]/g, '').slice(0, 60);
    return out;
  }
  /** Reads a number written the Italian or the English way: 250.000 · 250,000 · 3,5 · 3.5 · 25k · 200 mila. */
  function parseAmount(raw, unit) {
    let s = String(raw).replace(/\s/g, '');
    const dot = s.lastIndexOf('.'),
      comma = s.lastIndexOf(',');
    if (dot >= 0 && comma >= 0)
      s = dot > comma ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}([.,]\d{3})+$/.test(s) && unit !== '%') s = s.replace(/[.,]/g, '');
    else s = s.replace(',', '.');
    let n = parseFloat(s);
    if (!isFinite(n)) return null;
    if (/^(k|mila|thousand)$/.test(unit || '')) n *= 1000;
    if (/^(mln|milioni|million)$/.test(unit || '')) n *= 1e6;
    return n;
  }
  /** Understands the common ways of asking, in Italian and English, without any AI. */
  function parseAffordText(text) {
    const t = ' ' + String(text || '').toLowerCase() + ' ';
    const kind =
      /mutuo|casa|appartamento|immobile|bilocale|trilocale|mortgage|house|home|flat|apartment/.test(t)
        ? 'mortgage'
        : /\bauto\b|macchina|\bmoto\b|\bcar\b|motorbike|vehicle|scooter/.test(t)
          ? 'car'
          : 'purchase';
    const out = { kind };
    const money = [];
    const re =
      /(\d[\d.,]*)\s*(k\b|mila\b|mln\b|milioni\b|million\b|thousand\b|%|anni\b|anno\b|years?\b|mesi\b|months?\b)?/g;
    let m;
    while ((m = re.exec(t))) {
      const unit = m[2] || '';
      const n = parseAmount(m[1], unit);
      if (n == null) continue;
      const before = t.slice(Math.max(0, m.index - 28), m.index);
      const after = t.slice(m.index + m[0].length, m.index + m[0].length + 22);
      if (unit === '%') out.ratePct = n;
      else if (/^(anni|anno|years?)$/.test(unit)) out.years = n;
      else if (/^(mesi|months?)$/.test(unit)) out.years = n / 12;
      else if (
        /anticipo|down ?payment|deposit|acconto/.test(before) ||
        /^\s*(€|euro|eur)?\s*(di |as |of )?(anticipo|down ?payment|deposit|acconto)/.test(after)
      )
        out.downPayment = n;
      else if (
        /(costi|spese|costs|running).{0,15}(mese|month)|al mese|a month|per month|\/mese|\/month/.test(
          before + ' ' + after
        ) &&
        kind === 'car'
      )
        out.runningCosts = n;
      // "in 20", "a 25": a bare small number after these words is the length in years
      else if (
        !unit &&
        n > 0 &&
        n <= 40 &&
        /\b(in|per|a|over|for)\s*$/.test(before) &&
        !/^\s*(€|euro|eur)/.test(after)
      )
        out.years = n;
      // "mutuo da 200k", "loan of 20000": the amount borrowed, not the price
      else if (
        /(mutuo|finanziamento|prestito|leasing|mortgage|loan)\s*(da|di|of|for)?\s*(€|euro)?\s*$/.test(before)
      )
        out.loanAmount = n;
      else money.push(n);
    }
    if (money.length) out.price = Math.max(...money);
    if (/contanti|in un'unica soluzione|tutto subito|cash|outright|in full/.test(t)) out.payCash = true;
    if (
      /\ba rate\b|rateizz|finanzia|prestito|\bloan\b|financ|installment|leasing/.test(t) ||
      out.ratePct != null ||
      out.years != null
    )
      out.payCash = false;
    if (/vend\w* (gli |i miei )?investimenti|sell\w* (my )?investments|using (my )?investments/.test(t))
      out.useInvestments = true;
    return sanitizeAfford(out);
  }

  /* ---------- the advisor: any question, without sending a single number ----------
     The AI turns a question into an "advice recipe": the future events to simulate
     (amounts and dates taken from the sentence) and the rules to check, written with
     the variables below. The device computes the variables on the real data, runs a
     month-by-month cash simulation, checks the rules and fills in the answer. */

  /** Variables the recipe can use: name → [type, meaning]. Types: eur, pct, months, month, num. */
  const ADV_VARS = {
    income: ['eur', 'entrate medie al mese (ultimi 12 mesi)'],
    spending: ['eur', 'spese medie al mese (ultimi 12 mesi)'],
    saving: ['eur', 'risparmio medio al mese (entrate − spese)'],
    investing: ['eur', 'investimenti periodici al mese (es. PAC): escono dai conti ma non sono spese'],
    cash_growth: ['eur', 'di quanto cresce la liquidità al mese (risparmio − investimenti periodici)'],
    saving_rate: ['pct', 'tasso di risparmio'],
    cash: ['eur', 'liquidità oggi sui conti'],
    investments: ['eur', 'valore degli investimenti oggi'],
    invested_gain: ['eur', 'guadagno latente sugli investimenti'],
    liquid: ['eur', 'liquidità + investimenti'],
    net_worth: ['eur', 'patrimonio netto (liquidità + investimenti + beni − debiti)'],
    assets: ['eur', 'valore dei beni (casa, auto…)'],
    debt_residual: ['eur', 'debiti residui (mutui, prestiti)'],
    debt_payments: ['eur', 'rate mensili in corso'],
    card_debt: ['eur', 'carte di credito ancora da addebitare'],
    fixed_costs: ['eur', 'costi fissi ricorrenti al mese'],
    dti: ['pct', 'rate in corso sul reddito'],
    emergency_months_setting: ['months', 'mesi di fondo emergenza consigliati'],
    emergency_target: ['eur', 'fondo emergenza consigliato (mesi × spese)'],
    emergency_months: ['months', 'mesi di spese coperti dalla liquidità di oggi'],
    goals_missing: ['eur', 'quanto manca agli obiettivi di risparmio'],
    events_total: ['eur', 'totale delle spese future della domanda'],
    horizon: ['months', 'mesi simulati'],
    cash_min: ['eur', 'liquidità minima nel periodo, con gli eventi'],
    cash_min_month: ['month', 'mese della liquidità minima'],
    cash_end: ['eur', 'liquidità alla fine del periodo, con gli eventi'],
    first_negative_month: ['month', 'primo mese in rosso (null se mai)'],
    below_emergency_months: ['months', 'mesi con liquidità sotto il fondo emergenza'],
    target_amount: ['eur', 'importo della spesa su cui si chiede il parere'],
    target_month: ['month', 'mese previsto per quella spesa'],
    target_payment: ['eur', 'rata o costo mensile di quella spesa (0 se pagata subito)'],
    cash_before_target: ['eur', 'liquidità nel mese della spesa, senza farla'],
    cash_after_target: ['eur', 'liquidità nel mese della spesa, dopo averla fatta'],
    dti_after: ['pct', 'rate sul reddito dopo la spesa'],
    saving_after: ['eur', 'risparmio mensile dopo la spesa'],
    best_month: ['month', 'primo mese in cui la spesa non porta mai sotto il fondo emergenza (null se mai)'],
    months_to_afford: ['months', 'mesi da oggi a best_month (null se mai)']
  };
  const ADV_FUNCS = { min: Math.min, max: Math.max, abs: Math.abs, round: Math.round };
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  /** Tokenises and parses a small expression language: numbers, variables, + − × ÷, comparisons, and/or/not, min/max/abs/round, cat("Categoria"). */
  function parseExpr(src) {
    const s = String(src || '');
    if (s.length > 240) throw new Error('espressione troppo lunga');
    const toks = [];
    const re = /\s*(\d+(?:\.\d+)?|[a-z_][a-z0-9_]*|"[^"]{0,40}"|<=|>=|==|!=|&&|\|\||[-+*/()<>,!])/giy;
    let m,
      at = 0;
    while (at < s.length) {
      re.lastIndex = at;
      if (!(m = re.exec(s))) {
        if (/^\s*$/.test(s.slice(at))) break;
        throw new Error('simbolo non valido');
      }
      toks.push(m[1]);
      at = re.lastIndex;
    }
    let i = 0;
    const peek = () => toks[i],
      eat = t => {
        if (toks[i] !== t) throw new Error('atteso ' + t);
        i++;
      };
    const WORD = { and: '&&', or: '||', not: '!' };
    const norm = t => (t && WORD[t.toLowerCase()]) || t;
    function primary() {
      const t = toks[i++];
      if (t === undefined) throw new Error('espressione incompleta');
      if (/^\d/.test(t)) return { n: +t };
      if (t === '(') {
        const e = or();
        eat(')');
        return e;
      }
      if (t === '-') return { op: 'neg', a: primary() };
      if (norm(t) === '!') return { op: '!', a: unary() };
      if (/^"/.test(t)) return { s: t.slice(1, -1) };
      const id = t.toLowerCase();
      if (id === 'null') return { n: null };
      if (peek() === '(') {
        i++;
        const args = [];
        if (peek() !== ')')
          do args.push(or());
          while (peek() === ',' && ++i);
        eat(')');
        if (!hasOwn(ADV_FUNCS, id) && id !== 'cat' && id !== 'known')
          throw new Error('funzione sconosciuta: ' + id);
        return { f: id, args };
      }
      if (!hasOwn(ADV_VARS, id)) throw new Error('variabile sconosciuta: ' + id);
      return { v: id };
    }
    function unary() {
      return primary();
    }
    const bin = (next, ops) =>
      function () {
        let a = next();
        while (ops.includes(norm(peek()))) {
          const op = norm(toks[i++]);
          a = { op, a, b: next() };
        }
        return a;
      };
    const mul = bin(unary, ['*', '/']);
    const add = bin(mul, ['+', '-']);
    const cmp = bin(add, ['<', '<=', '>', '>=', '==', '!=']);
    const and = bin(cmp, ['&&']);
    const or = bin(and, ['||']);
    const tree = or();
    if (i < toks.length) throw new Error('testo in più: ' + toks[i]);
    return tree;
  }
  /** Evaluates a parsed expression; null (unknown) propagates through arithmetic, and comparisons with null are false. */
  function evalExpr(e, V, cats) {
    if ('n' in e) return e.n;
    if ('s' in e) return e.s;
    if (e.v) return hasOwn(V, e.v) && V[e.v] !== undefined ? V[e.v] : null;
    if (e.f) {
      const a = e.args.map(x => evalExpr(x, V, cats));
      if (e.f === 'cat') return (cats && hasOwn(cats, String(a[0])) && +cats[String(a[0])]) || 0;
      if (e.f === 'known') return a[0] !== null && a[0] !== undefined && isFinite(a[0]);
      if (a.some(x => x === null || typeof x !== 'number')) return null;
      return ADV_FUNCS[e.f](...a);
    }
    const a = evalExpr(e.a, V, cats);
    if (e.op === 'neg') return a === null ? null : -a;
    if (e.op === '!') return !a;
    if (e.op === '&&') return !!a && !!evalExpr(e.b, V, cats);
    if (e.op === '||') return !!a || !!evalExpr(e.b, V, cats);
    const b = evalExpr(e.b, V, cats);
    if (a === null || b === null)
      return ['+', '-', '*', '/'].includes(e.op) ? null : e.op === '!=' ? a !== b : false;
    switch (e.op) {
      case '+':
        return a + b;
      case '-':
        return a - b;
      case '*':
        return a * b;
      case '/':
        return b ? a / b : null;
      case '<':
        return a < b;
      case '<=':
        return a <= b;
      case '>':
        return a > b;
      case '>=':
        return a >= b;
      case '==':
        return a === b;
      case '!=':
        return a !== b;
    }
    return null;
  }
  const advText = (x, max) =>
    String(x || '')
      .replace(/[<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max);
  const advNum = (x, min, max, def) => {
    const n = +x;
    return x === null || x === undefined || x === '' || !isFinite(n) ? def : Math.min(max, Math.max(min, n));
  };
  /** Keeps only a valid recipe: known variables, parseable rules, events within sensible ranges. */
  function sanitizeAdvice(o) {
    if (!o || typeof o !== 'object') return null;
    const out = { title: advText(o.title, 80), clarify: advText(o.clarify, 300) };
    out.events = (Array.isArray(o.events) ? o.events : []).slice(0, 8).map(e => {
      const ev = {
        label: advText(e && e.label, 40) || 'Spesa',
        amount: Math.round(advNum(e && e.amount, -1e7, 1e8, 0)),
        month: Math.round(advNum(e && e.month, 0, 60, 0)),
        type: e && e.type === 'monthly' ? 'monthly' : 'once'
      };
      if (ev.type === 'monthly') ev.months = Math.round(advNum(e.months, 1, 360, 12));
      const f = e && e.financed;
      if (f && typeof f === 'object' && ev.type === 'once' && ev.amount > 0)
        ev.financed = {
          months: Math.round(advNum(f.months, 1, 360, 12)),
          ratePct: advNum(f.ratePct, 0, 30, 0),
          down: Math.round(advNum(f.down, 0, ev.amount, 0))
        };
      return ev;
    });
    const t = Math.round(advNum(o.target, -1, out.events.length - 1, -1));
    out.target = out.events.length ? (t >= 0 ? t : out.events.length - 1) : -1;
    if (o.target === null || o.target === -1) out.target = out.events.length ? out.target : -1;
    out.checks = [];
    for (const c of (Array.isArray(o.checks) ? o.checks : []).slice(0, 8)) {
      if (!c || typeof c !== 'object') continue;
      try {
        parseExpr(c.expr);
      } catch (e) {
        continue;
      }
      out.checks.push({
        expr: String(c.expr).replace(/\s+/g, ' ').trim().slice(0, 240),
        ok: advText(c.ok, 220),
        ko: advText(c.ko, 220),
        soft: !!c.soft
      });
    }
    const A = o.answer && typeof o.answer === 'object' ? o.answer : {};
    out.answer = { yes: advText(A.yes, 200), careful: advText(A.careful, 200), no: advText(A.no, 200) };
    out.show = (Array.isArray(o.show) ? o.show : [])
      .map(v => String(v || '').toLowerCase())
      .filter(v => hasOwn(ADV_VARS, v))
      .slice(0, 6);
    out.emergencyMonths = Math.round(advNum(o.emergencyMonths, 0, 24, 0)) || null;
    if (!out.events.length && !out.checks.length && !out.clarify) return null;
    return out;
  }

  /** Cash month by month (m = 0 is this month) with the given events applied. */
  function advPath(base, events, H) {
    const path = [];
    for (let m = 0; m <= H; m++) {
      let out = 0;
      for (const e of events) {
        if (e.type === 'monthly') {
          if (m >= e.month) out += e.amount * Math.min(m - e.month + 1, e.months);
        } else if (e.financed) {
          const f = e.financed,
            pay = loanPayment(e.amount - f.down, f.ratePct, f.months);
          if (m >= e.month) out += f.down + pay * Math.min(m - e.month, f.months);
        } else if (m >= e.month) out += e.amount;
      }
      path.push(base.cash + base.saving * m - out);
    }
    return path;
  }
  const evMonthly = e =>
    e.type === 'monthly'
      ? e.amount
      : e.financed
        ? loanPayment(e.amount - e.financed.down, e.financed.ratePct, e.financed.months)
        : 0;

  /** Computes every variable, the cash path and the rules of a recipe on the real numbers. */
  function runAdvice(recipe, base) {
    const R = recipe;
    const income = Math.max(0, +base.income || 0),
      spending = Math.max(0, +base.spending || 0);
    const emMonths = R.emergencyMonths || base.emergencyMonths || 6;
    // regular investments (e.g. a monthly ETF plan) leave the accounts without being spending:
    // the cash simulation grows by saving minus investing
    const investing = Math.max(0, +base.investing || 0);
    const b = { cash: +base.cash || 0, saving: income - spending - investing };
    const ev = R.events || [];
    const lastEv = ev.reduce(
      (m, e) => Math.max(m, e.month + (e.type === 'monthly' ? Math.min(e.months, 24) : 0)),
      0
    );
    const H = Math.min(60, Math.max(12, lastEv + 12));
    const path = advPath(b, ev, H);
    const em = emMonths * spending;
    const V = {
      income,
      spending,
      saving: income - spending,
      saving_rate: income ? (income - spending) / income : 0,
      investing,
      cash_growth: b.saving,
      cash: b.cash,
      investments: +base.investments || 0,
      invested_gain: (+base.investments || 0) - (+base.invCost || 0),
      liquid: b.cash + (+base.investments || 0),
      net_worth:
        b.cash +
        (+base.investments || 0) +
        (+base.assets || 0) -
        (+base.debtResidual || 0) -
        (+base.cardDebt || 0),
      assets: +base.assets || 0,
      debt_residual: +base.debtResidual || 0,
      debt_payments: +base.debtPayments || 0,
      card_debt: +base.cardDebt || 0,
      fixed_costs: +base.fixedCosts || 0,
      dti: income ? (+base.debtPayments || 0) / income : 0,
      emergency_months_setting: emMonths,
      emergency_target: em,
      emergency_months: spending ? b.cash / spending : null,
      goals_missing: +base.goalsMissing || 0,
      events_total: ev.reduce((s, e) => s + (e.type === 'monthly' ? e.amount * e.months : e.amount), 0),
      horizon: H
    };
    let mn = 0;
    path.forEach((v, m) => (v < path[mn] ? (mn = m) : 0));
    V.cash_min = path[mn];
    V.cash_min_month = mn;
    V.cash_end = path[H];
    const neg = path.findIndex(v => v < 0);
    V.first_negative_month = neg < 0 ? null : neg;
    V.below_emergency_months = path.filter(v => v < em).length;
    const T = R.target >= 0 ? ev[R.target] : null;
    if (T) {
      const others = ev.filter(e => e !== T);
      const without = advPath(b, others, H);
      V.target_amount = T.amount;
      V.target_month = T.month;
      V.target_payment = evMonthly(T);
      V.cash_before_target = without[T.month];
      V.cash_after_target = path[T.month];
      V.dti_after = income ? (V.debt_payments + V.target_payment) / income : null;
      V.saving_after = income - spending - V.target_payment;
      V.best_month = null;
      // look up to 5 years ahead, even when the chart shows fewer months
      const HB = 60;
      for (let s = T.month; s <= HB; s++) {
        const p = advPath(b, [...others, { ...T, month: s }], Math.max(HB, s + 12));
        if (p.slice(s).every(v => v >= em)) {
          V.best_month = s;
          break;
        }
      }
      V.months_to_afford = V.best_month;
    }
    const cats = base.cats || {};
    let checks = R.checks || [];
    if (!checks.length && ev.length)
      checks = [
        {
          expr: 'cash_min >= 0',
          ko: 'La liquidità andrebbe in rosso a {first_negative_month}.',
          ok: 'La liquidità non va mai in rosso.'
        },
        {
          expr: 'cash_min >= emergency_target',
          soft: true,
          ko: 'A {cash_min_month} scenderesti a {cash_min}, sotto il fondo emergenza di {emergency_target}.',
          ok: 'Resti sempre sopra il fondo emergenza di {emergency_target}.'
        }
      ];
    const res = checks.map(c => {
      let ok = null;
      try {
        ok = !!evalExpr(parseExpr(c.expr), V, cats);
      } catch (e) {
        ok = null;
      }
      return { ...c, ok, text: ok === null ? '' : ok ? c.ok : c.ko };
    });
    const valid = res.filter(c => c.ok !== null);
    const verdict = !valid.length
      ? null
      : valid.some(c => !c.ok && !c.soft)
        ? 'no'
        : valid.some(c => !c.ok)
          ? 'careful'
          : 'yes';
    return { vars: V, path, checks: res, verdict, cats };
  }
  /** Fills {variable} and {cat:Name} placeholders with formatted values. */
  function renderAdvice(text, V, fmt, cats) {
    return String(text || '').replace(/\{(cat:)?([^{}]{1,40})\}/g, (all, c, k) => {
      if (c) return fmt('eur', (cats && hasOwn(cats, k) && +cats[k]) || 0);
      const key = k.toLowerCase().trim();
      if (!hasOwn(ADV_VARS, key)) return all;
      return fmt(ADV_VARS[key][0], V[key]);
    });
  }

  /* ---------- chat advisor: the tools the model can call ----------
     Run on the device by public/js/chat.js; the server only forwards them to a LOCAL model. */
  const obj = (props, required = []) => ({ type: 'object', properties: props, required });
  const tool = (name, description, parameters) => ({
    type: 'function',
    function: { name, description, parameters }
  });
  const EVENT = {
    type: 'object',
    properties: {
      label: { type: 'string' },
      amount: { type: 'number', description: 'euro; positive = expense, negative = income' },
      month: { type: 'integer', description: 'months from now, 0 = this month' },
      type: { type: 'string', enum: ['once', 'monthly'] },
      months: { type: 'integer', description: 'for monthly: how many months' },
      financed: obj({ months: { type: 'integer' }, ratePct: { type: 'number' }, down: { type: 'number' } })
    },
    required: ['label', 'amount', 'month']
  };
  const CHAT_TOOLS = [
    tool(
      'get_overview',
      'Overall picture: average monthly income, spending and saving (last 12 complete months), cash, investments, net worth, debts, loan payments, fixed costs, emergency fund.',
      obj({})
    ),
    tool(
      'spending_by_category',
      'Spending per category over a period, with the monthly average. Use months (last N complete months) or from/to (YYYY-MM).',
      obj({ months: { type: 'integer' }, from: { type: 'string' }, to: { type: 'string' } })
    ),
    tool(
      'monthly_trend',
      'Income, spending and saving month by month.',
      obj({ months: { type: 'integer', description: 'default 12' } })
    ),
    tool(
      'search_transactions',
      'Find transactions by text (description), category, dates (YYYY-MM-DD), amount range or kind. Returns count, total and up to 50 items.',
      obj({
        text: { type: 'string' },
        category: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
        min_amount: { type: 'number' },
        max_amount: { type: 'number' },
        kind: { type: 'string', enum: ['expense', 'income'] },
        limit: { type: 'integer' }
      })
    ),
    tool(
      'list_recurring',
      'Recurring income and costs (subscriptions, rent, salary…) with their monthly amount.',
      obj({})
    ),
    tool(
      'list_goals',
      'Savings goals: target, saved so far, deadline and how much per month is needed.',
      obj({})
    ),
    tool(
      'get_portfolio',
      'Investments: total value, cost, gain, every position with weight, and the target allocation if set.',
      obj({})
    ),
    tool(
      'assets_and_debts',
      'Assets (home, car…) with their value and debts (mortgages, loans) with residual, monthly payment and end date.',
      obj({})
    ),
    tool(
      'simulate_cashflow',
      'Simulates cash month by month on the real numbers with future events (purchases, loans, bonuses). Cash grows by saving minus regular investments. Returns the lowest cash, the first month in the red, months below the emergency fund and, for the target event, the earliest safe month.',
      obj(
        {
          events: { type: 'array', items: EVENT },
          target_index: { type: 'integer' },
          emergency_months: { type: 'number' }
        },
        ['events']
      )
    ),
    tool(
      'loan_payment',
      'Monthly payment and total interest of a loan.',
      obj({ amount: { type: 'number' }, rate_pct: { type: 'number' }, months: { type: 'integer' } }, [
        'amount',
        'rate_pct',
        'months'
      ])
    )
  ];

  /** The advisor chat's instructions; shared by the server and the benchmark (bench/run.js). */
  function chatSystemPrompt({ lang, today, categories }) {
    const en = lang === 'en';
    return `${en ? 'You are' : 'Sei'} ${en ? "the user's personal financial advisor inside EyeCash" : "il consulente finanziario personale dell'utente dentro EyeCash"}. Oggi è ${today}.
Hai degli strumenti che leggono i dati reali dell'utente (movimenti, conti, investimenti, beni, debiti, obiettivi, ricorrenti) e fanno calcoli. Valuta in euro.
Regole:
- Usa gli strumenti per ogni numero: non inventare mai importi, saldi o date. Per acquisti futuri, rate o "posso permettermi" usa simulate_cashflow; per le rate loan_payment.
- Se la domanda non è chiara su un dettaglio essenziale, fai una sola domanda di chiarimento; altrimenti fai ipotesi ragionevoli e dichiarale.
- Scrivi gli importi arrotondati e leggibili (es. 1.250 €, non 1250.37).
- Rispondi in modo diretto: prima la conclusione (es. "Sì, ma aspetta marzo"), poi i motivi con i numeri, in un breve elenco. Niente lunghi preamboli.
- Sii prudente: fondo emergenza (di solito 6 mesi di spese), rate sotto un terzo del reddito, diversificazione. Su tasse e norme specifiche invita a verificare con un professionista.
- Categorie di spesa: ${categories.join(', ')}.
Rispondi in ${en ? 'inglese' : 'italiano'}.`;
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
    affordability,
    sanitizeAfford,
    parseAffordText,
    ADV_VARS,
    parseExpr,
    evalExpr,
    sanitizeAdvice,
    runAdvice,
    renderAdvice,
    CHAT_TOOLS,
    chatSystemPrompt,
    loanPayment,
    loanPrincipal,
    MEASURES,
    GROUPS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.POC_ENGINE = API;
})(typeof window !== 'undefined' ? window : globalThis);
