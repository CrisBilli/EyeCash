/*
 * EyeCash · public/js/advisor.js
 *
 * The advisor: any question about one's money ("tra un mese spendo 15.000 €, il
 * prossimo anno vorrei un PC da 3.000: conviene?"). The AI receives only the
 * question and returns a recipe (future events and rules written with named
 * variables); this file computes the variables on the real data, runs the
 * month-by-month simulation with EN.runAdvice and shows the verdict and the reasons.
 * No number about the user ever leaves the device.
 */

/** Questions that ask for a judgement rather than a figure. */
const isAdviceQ = q =>
  /convien|dovrei|devo |meglio|posso|riesco|ce la faccio|permett|consigli|come sto|sono messo|ha senso|vale la pena|rischio|should i|can i|could i|is it worth|better to|how am i doing|afford|advice|am i ok/i.test(
    q
  );
/** Short follow-ups to the previous advice ("e se lo prendo a rate?", "perché?"). */
const isFollowUp = q =>
  /^\s*(e se|e a |e con|e invece|perch|e tra|e nel|e dopo|and if|and what|what if|why)/i.test(q);

/** The user's real numbers the recipe variables are computed from. Never sent anywhere. */
function adviceBase() {
  const M = affMine();
  const months = lastMonths(13).slice(0, 12);
  const cats = {};
  let n = 0;
  for (const k of months) {
    const t0 = monthTot(k);
    if (!(t0.inc > 0 || t0.out > 0)) continue;
    n++;
    for (const [c, v] of Object.entries(catSpend(k))) cats[c] = (cats[c] || 0) + v;
  }
  for (const c in cats) cats[c] = cats[c] / Math.max(1, n);
  // regular investments (category Investimenti) leave the accounts without being spending
  const inv = S.tx
    .filter(t => t.cat === 'Investimenti' && t.amount < 0 && months.includes(String(t.date).slice(0, 7)))
    .reduce((s, t) => s - t.amount, 0);
  return {
    investing: inv / Math.max(1, n),
    income: M.income,
    spending: M.spending,
    cash: M.cash,
    investments: M.investments,
    invCost: invCost(),
    assets: assetsVal(),
    debtResidual: debtsVal(),
    debtPayments: M.payments,
    cardDebt: cardDebt(),
    fixedCosts: recMonthly(),
    goalsMissing: (S.goals || []).reduce((s, g) => s + Math.max(0, (+g.target || 0) - (+g.saved || 0)), 0),
    emergencyMonths: (S.afford && +S.afford.emergencyMonths) || 6,
    cats,
    months: M.months
  };
}

/** Formats a variable by its type, in the interface language. */
function adviceFmt(type, v) {
  if (v === null || v === undefined || (typeof v === 'number' && !isFinite(v)))
    return type === 'month' ? t('mai, nei mesi simulati') : '—';
  if (type === 'eur') return eur0(v);
  if (type === 'pct') return (Math.round(v * 1000) / 10).toLocaleString(LOCALE) + '%';
  if (type === 'months') return t('{0} mesi', [(Math.round(v * 10) / 10).toLocaleString(LOCALE)]);
  if (type === 'month')
    return v === 0
      ? t('questo mese')
      : (L => (LANG === 'it' ? L.toLowerCase() : L))(ymLabel(EN.ymAdd(ym(today()), v)));
  return Math.round(v).toLocaleString(LOCALE);
}

/** Sends the question (and, for a follow-up, the previous question and recipe); returns the recipe. */
async function adviseCompute(q, prev) {
  logAI(
    'advise',
    `Domanda: «${q.slice(0, 200)}»${prev ? ` · con la domanda precedente («${prev.q.slice(0, 60)}») e la sua ricetta` : ''}. Nessun importo, saldo o movimento.`
  );
  const recipe = await api('POST', '/api/ai/advise', {
    question: anon(q),
    lang: LANG,
    previous: prev ? { question: anon(prev.q), recipe: prev.advice } : null
  });
  return { q, advice: recipe, ai: true };
}

/** Short labels for the key numbers (the meanings in EN.ADV_VARS are written for the AI). */
const ADV_LABELS = {
  income: 'Entrate al mese',
  spending: 'Spese al mese',
  saving: 'Risparmio al mese',
  saving_rate: 'Tasso di risparmio',
  cash: 'Liquidità oggi',
  investments: 'Investimenti',
  invested_gain: 'Guadagno sugli investimenti',
  liquid: 'Liquidità e investimenti',
  net_worth: 'Patrimonio netto',
  assets: 'Beni',
  debt_residual: 'Debiti residui',
  debt_payments: 'Rate in corso',
  card_debt: 'Carte da addebitare',
  fixed_costs: 'Costi fissi al mese',
  dti: 'Rate sul reddito',
  emergency_months_setting: 'Fondo emergenza (mesi)',
  emergency_target: 'Fondo emergenza',
  emergency_months: 'Mesi coperti dalla liquidità',
  goals_missing: 'Mancano agli obiettivi',
  events_total: 'Totale delle spese',
  horizon: 'Mesi simulati',
  cash_min: 'Liquidità minima',
  cash_min_month: 'Mese più stretto',
  cash_end: 'Liquidità a fine periodo',
  first_negative_month: 'Primo mese in rosso',
  below_emergency_months: 'Mesi sotto il fondo',
  target_amount: 'Importo',
  target_month: 'Quando',
  target_payment: 'Costo mensile',
  cash_before_target: 'Liquidità senza la spesa',
  cash_after_target: 'Liquidità dopo la spesa',
  dti_after: 'Rate sul reddito dopo',
  saving_after: 'Risparmio al mese dopo',
  best_month: 'Mese consigliato',
  months_to_afford: 'Mesi da aspettare'
};

const ADV_VERDICT = {
  yes: ['c-good', '✓'],
  careful: ['c-warn', '!'],
  no: ['c-crit', '✕']
};

/** Cash over the simulated months, the emergency fund line and the events. */
function adviceChart(x, R) {
  const W = innerWidth < 820 ? 360 : 700,
    H = 210,
    pl = 52,
    pr = 10,
    pt = 14,
    pb = 26,
    iw = W - pl - pr,
    ih = H - pt - pb;
  const P = x.path,
    n = P.length,
    em = x.vars.emergency_target;
  const mn = Math.min(0, ...P),
    mx = Math.max(1, em, ...P);
  const lo = mn < 0 ? -niceTop(-mn) : 0,
    top = niceTop(mx);
  const X = i => pl + (i / (n - 1)) * iw,
    Y = v => pt + ih - (ih * (v - lo)) / (top - lo || 1);
  let g = '';
  for (let k = 0; k <= 4; k++) {
    const v = lo + ((top - lo) * k) / 4,
      y = Y(v);
    g += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" stroke="var(--line)"/><text x="${pl - 6}" y="${y + 4}" text-anchor="end">${kfmt(v)}</text>`;
  }
  if (lo < 0)
    g += `<line x1="${pl}" x2="${W - pr}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--crit)" stroke-dasharray="4 3"/>`;
  if (em > 0)
    g += `<line x1="${pl}" x2="${W - pr}" y1="${Y(em)}" y2="${Y(em)}" stroke="var(--warn)" stroke-dasharray="5 4"/><text x="${W - pr}" y="${Y(em) - 5}" text-anchor="end" style="fill:var(--warn)">${t('fondo emergenza')}</text>`;
  const step = n > 30 ? 12 : 6;
  for (let i = 0; i < n; i += step)
    g += `<text x="${X(i)}" y="${H - 6}" text-anchor="${i ? 'middle' : 'start'}">${i ? '+' + i + 'm' : t('oggi')}</text>`;
  // events: a dashed line each, labels stacked when they fall in the same month
  const seen = {};
  for (const e of R.events)
    if (e.month < n) {
      const k = (seen[e.month] = (seen[e.month] || 0) + 1);
      const right = X(e.month) > W - 90;
      g += `${k === 1 ? `<line x1="${X(e.month)}" x2="${X(e.month)}" y1="${pt}" y2="${pt + ih}" stroke="var(--mut)" stroke-dasharray="2 3"/>` : ''}<text x="${X(e.month) + (right ? -4 : 4)}" y="${pt + 10 * k}" text-anchor="${right ? 'end' : 'start'}" style="fill:var(--tx2)" translate="no">${esc(e.label)}</text>`;
    }
  // straight segments: cash moves in steps, a smooth curve would dip below the real values
  g += `<path d="${P.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join('')}" fill="none" stroke="var(--s-blue)" stroke-width="2.4" stroke-linejoin="round"/>`;
  for (let i = 0; i < n; i++)
    g += `<rect x="${X(i) - iw / (n - 1) / 2}" y="${pt}" width="${iw / (n - 1)}" height="${ih}" fill="transparent" data-tip="${adviceFmt('month', i)}\n${t('Liquidità')}: ${eur0(P[i])}"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">${g}</svg>`;
}

/** Describes one event of the recipe, for "how it was calculated". */
function adviceEventText(e) {
  const when = adviceFmt('month', e.month);
  if (e.amount < 0) return t('{0}: entrata di {1}, {2}', [e.label, eur0(-e.amount), when]);
  if (e.type === 'monthly')
    return t('{0}: {1} al mese per {2} mesi, da {3}', [e.label, eur0(e.amount), e.months, when]);
  if (e.financed)
    return t('{0}: {1} a rate in {2} mesi al {3}%, anticipo {4}, {5}', [
      e.label,
      eur0(e.amount),
      e.financed.months,
      String(e.financed.ratePct).replace('.', DEC),
      eur0(e.financed.down),
      when
    ]);
  return t('{0}: {1}, {2}', [e.label, eur0(e.amount), when]);
}

/** The advisor's answer: verdict, reasons, key numbers, cash chart and how it was worked out. */
function adviceRender(cur) {
  const R = cur.advice;
  if (!R.events.length && !R.checks.length)
    return `<div class="card" style="margin-top:14px"><b>Mi serve un chiarimento</b><div class="hint" style="margin-top:6px;line-height:1.6" translate="no">${esc(R.clarify || t('Riformula la domanda.'))}</div></div>`;
  const base = adviceBase();
  if (!base.months)
    return `<div class="card" style="margin-top:14px"><div class="hint">Serve almeno un mese di movimenti per conoscere entrate e spese: importa un estratto conto o aggiungi i movimenti.</div></div>`;
  const x = EN.runAdvice(R, base);
  const fill = s => EN.renderAdvice(s, x.vars, adviceFmt, x.cats);
  const head =
    x.verdict && R.answer[x.verdict]
      ? `<div class="card aff-verdict ${ADV_VERDICT[x.verdict][0]}" style="margin-top:10px"><div class="aff-ic"><b>${ADV_VERDICT[x.verdict][1]}</b></div><div translate="no"><h3>${esc(fill(R.answer[x.verdict]))}</h3></div></div>`
      : '';
  const reasons = x.checks
    .filter(c => c.ok !== null && c.text)
    .map(
      c =>
        `<li style="margin:6px 0;list-style:none;display:flex;gap:8px;align-items:flex-start"><span class="chip ${c.ok ? 'c-good' : c.soft ? 'c-warn' : 'c-crit'}">${c.ok ? '✓' : c.soft ? '!' : '✕'}</span><span translate="no">${esc(fill(c.text))}</span></li>`
    )
    .join('');
  const shows = (R.show.length ? R.show : ['cash_min', 'emergency_target', 'saving'])
    .map(
      k =>
        `<div class="card kpi"><div class="lbl">${esc(t(ADV_LABELS[k] || EN.ADV_VARS[k][1]))}</div><div class="val num" style="font-size:20px">${esc(adviceFmt(EN.ADV_VARS[k][0], x.vars[k]))}</div></div>`
    )
    .join('');
  const rules = R.checks
    .map(c => `<li><code>${esc(c.expr)}</code>${c.soft ? ' · ' + t('prudenza') : ''}</li>`)
    .join('');
  return `<div class="card sens" style="margin-top:14px"><div class="hint" style="margin-bottom:6px" translate="no">${esc(cur.q)}</div><h3 translate="no">${esc(R.title || t('Risposta'))}</h3>
    ${head}
    ${reasons ? `<ul style="margin:12px 0 0;padding:0;line-height:1.5">${reasons}</ul>` : ''}
    ${R.clarify ? `<div class="hint" style="margin-top:10px" translate="no">${esc(R.clarify)}</div>` : ''}
    <div class="grid g3" style="margin-top:14px">${shows}</div>
    ${R.events.length ? `<div style="margin-top:14px"><div class="hint" style="margin-bottom:6px">${t('Liquidità nei prossimi {0} mesi, risparmiando come oggi', [x.path.length - 1])}</div>${adviceChart(x, R)}</div>` : ''}
    <details style="margin-top:14px"><summary class="hint" style="cursor:pointer">Come è stato calcolato</summary>
      <div class="hint" style="margin-top:8px;line-height:1.6">${t('Punto di partenza: entrate {0}, spese {1} al mese (media degli ultimi {2} mesi), liquidità {3}.', [eur0(base.income), eur0(base.spending), base.months, eur0(base.cash)])}</div>
      ${R.events.length ? `<ul class="hint" style="margin:8px 0 0 18px;line-height:1.6">${R.events.map(e => `<li translate="no">${esc(adviceEventText(e))}</li>`).join('')}</ul>` : ''}
      ${rules ? `<div class="hint" style="margin-top:8px">Regole verificate:</div><ul class="hint" style="margin:4px 0 0 18px;line-height:1.6">${rules}</ul>` : ''}
      <p class="hint" style="margin-top:8px">All'AI è arrivata solo la domanda. Ha scritto eventi e regole; i numeri sono stati calcolati su questo dispositivo e non sono stati inviati.</p></details>
    ${isAffordQ(cur.q) || EN.parseAffordText(anon(cur.q)).price ? `<button class="btn sm" style="margin-top:12px" data-act="adv-planner" data-q="${esc(cur.q)}">Apri nel simulatore</button>` : ''}
    <div class="hint" style="margin-top:12px">Puoi continuare con «e se lo prendo a rate?» o «e tra sei mesi?». Simulazione orientativa, non una consulenza finanziaria.</div></div>`;
}
