/*
 * EyeCash · bench/tools.js
 *
 * The advisor-chat tools (EN.CHAT_TOOLS), computed on the made-up dataset with the same
 * rules as the app: transfers and investments are neither income nor spending, averages
 * use the last 12 complete months, cash is the sum of the current and deposit accounts.
 */
'use strict';
const EN = require('../public/engine.js');

const NEUTRAL = ['Giroconti', 'Investimenti'];
const FREQM = { settimanale: 52 / 12, mensile: 1, trimestrale: 1 / 3, annuale: 1 / 12 };
const r2 = x => Math.round((+x || 0) * 100) / 100;

function make(D) {
  const ym = D.today.slice(0, 7);
  const monthTx = k => D.tx.filter(t => t.date.startsWith(k) && !NEUTRAL.includes(t.cat));
  const monthTot = k => {
    let inc = 0,
      out = 0;
    for (const t of monthTx(k)) t.amount > 0 ? (inc += t.amount) : (out -= t.amount);
    return { inc, out };
  };
  const catSpend = k => {
    const o = {};
    for (const t of monthTx(k)) if (t.amount < 0) o[t.cat] = (o[t.cat] || 0) - t.amount;
    return o;
  };
  /** The last n complete months, oldest first. */
  const lastMonths = n => {
    const out = [];
    for (let i = n; i >= 1; i--) out.push(EN.ymAdd(ym, -i));
    return out;
  };
  const balance = id =>
    (D.accounts.find(a => a.id === id).opening || 0) +
    D.tx.filter(t => t.accountId === id).reduce((s, t) => s + t.amount, 0);
  const cash = () => D.accounts.filter(a => a.kind === 'conto').reduce((s, a) => s + balance(a.id), 0);
  const cardDebt = () => -D.accounts.filter(a => a.kind === 'carta').reduce((s, a) => s + balance(a.id), 0);
  const invVal = () => D.holdings.reduce((s, h) => s + h.qty * h.price, 0);
  const invCost = () => D.holdings.reduce((s, h) => s + h.qty * h.avg, 0);
  const monthsPaid = d => {
    const s = d.start.slice(0, 7);
    let n = 0;
    for (let k = EN.ymAdd(s, 1); k <= ym && n < 1000; k = EN.ymAdd(k, 1))
      if (k < ym || D.today.slice(8) >= d.start.slice(8)) n++;
    return n;
  };
  const loanResidual = d => {
    const r = d.rate / 1200,
      P = EN.loanPayment(d.principal, d.rate, d.months),
      k = Math.min(d.months, monthsPaid(d));
    if (k >= d.months) return 0;
    return Math.max(
      0,
      r ? d.principal * Math.pow(1 + r, k) - (P * (Math.pow(1 + r, k) - 1)) / r : d.principal - P * k
    );
  };
  const loanEnd = d => EN.ymAdd(d.start.slice(0, 7), d.months);
  const debtPayments = () =>
    D.debts.reduce(
      (s, d) => (loanResidual(d) > 0 ? s + EN.loanPayment(d.principal, d.rate, d.months) : s),
      0
    );
  const fixedCosts = () =>
    D.recurring
      .filter(r => r.type !== 'in' && !NEUTRAL.includes(r.cat))
      .reduce((s, r) => s + r.amount * (FREQM[r.freq] || 1), 0);
  const goalsMissing = () => D.goals.reduce((s, g) => s + Math.max(0, g.target - g.saved), 0);

  /** The numbers every tool and the advisor engine start from. */
  function base() {
    const ms = lastMonths(12).filter(k => {
      const x = monthTot(k);
      return x.inc > 0 || x.out > 0;
    });
    const n = ms.length || 1;
    const cats = {};
    for (const k of ms) for (const [c, v] of Object.entries(catSpend(k))) cats[c] = (cats[c] || 0) + v / n;
    const investing =
      ms.reduce(
        (s, k) =>
          s -
          D.tx
            .filter(t => t.date.startsWith(k) && t.cat === 'Investimenti' && t.amount < 0)
            .reduce((a, t) => a + t.amount, 0),
        0
      ) / n;
    return {
      investing,
      months: ms.length,
      income: ms.reduce((s, k) => s + monthTot(k).inc, 0) / n,
      spending: ms.reduce((s, k) => s + monthTot(k).out, 0) / n,
      cash: cash(),
      investments: invVal(),
      invCost: invCost(),
      assets: D.assets.reduce((s, a) => s + a.value, 0),
      debtResidual: D.debts.reduce((s, d) => s + loanResidual(d), 0),
      debtPayments: debtPayments(),
      cardDebt: cardDebt(),
      fixedCosts: fixedCosts(),
      goalsMissing: goalsMissing(),
      emergencyMonths: 6,
      cats
    };
  }
  const rangeMonths = a => {
    if (a && (a.from || a.to)) {
      const from = /^\d{4}-\d{2}/.test(a.from || '') ? a.from.slice(0, 7) : null;
      const to = /^\d{4}-\d{2}/.test(a.to || '') ? a.to.slice(0, 7) : ym;
      const out = [];
      let k = from || EN.ymAdd(to, -11);
      for (let i = 0; i < 120 && k <= to; i++, k = EN.ymAdd(k, 1)) out.push(k);
      return out;
    }
    return lastMonths(Math.min(60, Math.max(1, Math.round(+(a && a.months) || 12))));
  };

  const RUN = {
    get_overview() {
      const b = base();
      return {
        today: D.today,
        months_of_data: b.months,
        avg_monthly_income: r2(b.income),
        avg_monthly_spending: r2(b.spending),
        avg_monthly_saving: r2(b.income - b.spending),
        regular_investing_monthly: r2(b.investing),
        cash_growth_monthly: r2(b.income - b.spending - b.investing),
        saving_rate_pct: b.income ? r2(((b.income - b.spending) / b.income) * 100) : null,
        cash: r2(b.cash),
        credit_cards_to_be_debited: r2(b.cardDebt),
        investments_value: r2(b.investments),
        investments_gain: r2(b.investments - b.invCost),
        assets_value: r2(b.assets),
        debts_residual: r2(b.debtResidual),
        loan_payments_monthly: r2(b.debtPayments),
        fixed_costs_monthly: r2(b.fixedCosts),
        net_worth: r2(b.cash + b.investments + b.assets - b.debtResidual - b.cardDebt),
        emergency_fund_months_covered: b.spending ? r2(b.cash / b.spending) : null,
        goals_missing: r2(b.goalsMissing)
      };
    },
    spending_by_category(a) {
      const ms = rangeMonths(a);
      const tot = {};
      let inc = 0;
      for (const k of ms) {
        for (const [c, v] of Object.entries(catSpend(k))) tot[c] = (tot[c] || 0) + v;
        inc += monthTot(k).inc;
      }
      const rows = Object.entries(tot)
        .sort((x, y) => y[1] - x[1])
        .map(([category, v]) => ({ category, total: r2(v), monthly_avg: r2(v / ms.length) }));
      return {
        period: ms[0] + ' → ' + ms[ms.length - 1],
        months: ms.length,
        total_spending: r2(rows.reduce((s, r) => s + r.total, 0)),
        total_income: r2(inc),
        categories: rows
      };
    },
    monthly_trend(a) {
      return rangeMonths(a).map(k => {
        const x = monthTot(k);
        return { month: k, income: r2(x.inc), spending: r2(x.out), saving: r2(x.inc - x.out) };
      });
    },
    search_transactions(a = {}) {
      const txt = String(a.text || '').toLowerCase(),
        cat = String(a.category || '').toLowerCase();
      const lim = Math.min(50, Math.max(1, Math.round(+a.limit || 25)));
      const hit = D.tx
        .filter(t => {
          if (t.cat === 'Giroconti') return false;
          if (txt && !t.note.toLowerCase().includes(txt)) return false;
          if (cat && t.cat.toLowerCase() !== cat) return false;
          if (a.from && t.date < a.from) return false;
          if (a.to && t.date > a.to) return false;
          if (a.kind === 'expense' && t.amount >= 0) return false;
          if (a.kind === 'income' && t.amount <= 0) return false;
          const v = Math.abs(t.amount);
          if (a.min_amount != null && v < +a.min_amount) return false;
          if (a.max_amount != null && v > +a.max_amount) return false;
          return true;
        })
        .sort((x, y) => (x.date < y.date ? 1 : -1));
      const acc = id => (D.accounts.find(x => x.id === id) || {}).name || '';
      return {
        count: hit.length,
        total: r2(hit.reduce((s, t) => s + t.amount, 0)),
        shown: Math.min(lim, hit.length),
        items: hit.slice(0, lim).map(t => ({
          date: t.date,
          description: t.note,
          amount: r2(t.amount),
          category: t.cat,
          account: acc(t.accountId)
        }))
      };
    },
    list_recurring() {
      return D.recurring.map(r => ({
        name: r.name,
        type: r.type === 'in' ? 'income' : 'cost',
        amount: r2(r.amount),
        frequency: r.freq,
        monthly: r2(r.amount * (FREQM[r.freq] || 1)),
        category: r.cat
      }));
    },
    list_goals() {
      return D.goals.map(g => {
        const left = Math.max(0, g.target - g.saved);
        const months = Math.max(
          1,
          (+g.deadline.slice(0, 4) - +D.today.slice(0, 4)) * 12 +
            (+g.deadline.slice(5, 7) - +D.today.slice(5, 7))
        );
        return {
          name: g.name,
          target: r2(g.target),
          saved: r2(g.saved),
          missing: r2(left),
          deadline: g.deadline,
          monthly_needed: r2(left / months)
        };
      });
    },
    get_portfolio() {
      const tot = invVal();
      const by = {};
      for (const h of D.holdings) by[h.cls] = (by[h.cls] || 0) + h.qty * h.price;
      const classes = Object.keys({ ...by, ...D.target }).map(k => ({
        asset_class: k,
        value: r2(by[k] || 0),
        weight_pct: r2(((by[k] || 0) / tot) * 100),
        target_pct: D.target[k] || 0,
        difference_pct: r2(((by[k] || 0) / tot) * 100 - (D.target[k] || 0))
      }));
      return {
        total_value: r2(tot),
        total_cost: r2(invCost()),
        gain: r2(tot - invCost()),
        rebalance_tolerance_pct: 5,
        by_asset_class: classes,
        positions: D.holdings
          .map(h => ({
            name: h.name,
            ticker: h.ticker,
            isin: h.isin,
            asset_class: h.cls,
            ter_pct: h.ter,
            value: r2(h.qty * h.price),
            weight_pct: r2(((h.qty * h.price) / tot) * 100),
            gain: r2(h.qty * (h.price - h.avg)),
            gain_pct: r2((h.price / h.avg - 1) * 100)
          }))
          .sort((a, b) => b.value - a.value)
      };
    },
    assets_and_debts() {
      return {
        assets: D.assets.map(a => ({ name: a.name, kind: a.kind, value: r2(a.value) })),
        debts: D.debts.map(d => ({
          name: d.name,
          kind: d.kind,
          residual: r2(loanResidual(d)),
          monthly_payment: r2(EN.loanPayment(d.principal, d.rate, d.months)),
          rate_pct: d.rate,
          ends: loanEnd(d)
        }))
      };
    },
    simulate_cashflow(a = {}) {
      const recipe = EN.sanitizeAdvice({
        events: a.events || [],
        target: a.target_index,
        emergencyMonths: a.emergency_months,
        checks: []
      });
      if (!recipe || !recipe.events.length) return { error: 'no valid events' };
      const x = EN.runAdvice(recipe, base());
      const V = x.vars,
        mon = m => (m == null ? null : EN.ymAdd(ym, m));
      const out = {
        months_simulated: V.horizon,
        monthly_cash_growth_used: r2(V.cash_growth),
        emergency_fund_target: r2(V.emergency_target),
        already_below_emergency_fund_today: V.cash < V.emergency_target,
        cash_lowest: r2(V.cash_min),
        cash_lowest_month: mon(V.cash_min_month),
        cash_at_end: r2(V.cash_end),
        first_month_in_red: mon(V.first_negative_month),
        months_below_emergency_fund: V.below_emergency_months,
        verdict:
          x.verdict === 'yes'
            ? 'safe'
            : x.verdict === 'careful'
              ? 'below emergency fund at some point'
              : 'goes into the red',
        cash_every_3_months: x.path
          .filter((_, i) => i % 3 === 0)
          .map((v, i) => ({ month: mon(i * 3), cash: r2(v) }))
      };
      if (recipe.target >= 0)
        Object.assign(out, {
          target_event: recipe.events[recipe.target].label,
          target_monthly_payment: r2(V.target_payment),
          cash_in_target_month_without_it: r2(V.cash_before_target),
          cash_in_target_month_with_it: r2(V.cash_after_target),
          payments_to_income_after_pct: V.dti_after == null ? null : r2(V.dti_after * 100),
          earliest_safe_month_for_target: mon(V.best_month)
        });
      return out;
    },
    loan_payment(a = {}) {
      const n = Math.max(1, Math.round(+a.months || 1));
      const p = EN.loanPayment(+a.amount || 0, +a.rate_pct || 0, n);
      return { monthly_payment: r2(p), total_paid: r2(p * n), total_interest: r2(p * n - (+a.amount || 0)) };
    }
  };
  function run(name, args) {
    try {
      if (!Object.prototype.hasOwnProperty.call(RUN, name)) return { error: 'unknown tool ' + name };
      return RUN[name](args && typeof args === 'object' ? args : {});
    } catch (e) {
      return { error: e.message };
    }
  }
  return { run, RUN, base, monthTot, catSpend, lastMonths, cash, D };
}

module.exports = { make };
