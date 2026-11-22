/*
 * EyeCash · public/js/report.js
 *
 * Printable report for a month, a calendar year or the last 12 months: summary,
 * financial-health indicators an advisor would look at, net worth composition,
 * income and spending, categories, investments and (optionally) every transaction.
 * Everything is computed on the device; "Stampa / Salva PDF" uses the browser.
 * The "summary only" detail level leaves out merchants and single transactions,
 * so the report can be shared with an advisor without exposing them.
 */

/** Report settings chosen on screen: period type, period key and detail level. */
const REP = { mode: 'month', key: '', detail: 'full' };

/* ---------- periods ---------- */

/** Months (YYYY-MM) that have at least one transaction, plus the current month, newest first. */
function monthsWithData() {
  return [...new Set(S.tx.map(t => ym(t.date)).concat(today().slice(0, 7)))].sort().reverse();
}

/** The months covered by the chosen period, oldest first, with labels for the header. */
function reportPeriod() {
  const cur = today().slice(0, 7);
  if (REP.mode === 'year') {
    const years = [...new Set(monthsWithData().map(m => m.slice(0, 4)))];
    const y = years.includes(REP.key) ? REP.key : years[0];
    const months = [];
    for (let k = y + '-01'; k <= y + '-12' && k <= cur; k = EN.ymAdd(k, 1)) months.push(k);
    return {
      mode: 'year',
      key: y,
      months,
      title: 'Anno ' + y,
      kind: 'REPORT ANNUALE',
      options: years.map(x => [x, x])
    };
  }
  if (REP.mode === '12m') {
    const last = EN.ymAdd(cur, -1);
    const months = [];
    for (let i = 11; i >= 0; i--) months.push(EN.ymAdd(last, -i));
    return {
      mode: '12m',
      key: last,
      months,
      title: `${ymLabel(months[0])} – ${ymLabel(last)}`,
      kind: 'ULTIMI 12 MESI',
      options: []
    };
  }
  const all = monthsWithData();
  // by default the last complete month: the current one is still partial
  const lastComplete = all.find(m => m < cur);
  const k = all.includes(REP.key) ? REP.key : lastComplete || all[0];
  return {
    mode: 'month',
    key: k,
    months: [k],
    title: ymLabel(k),
    kind: 'REPORT MENSILE',
    options: all.map(m => [m, ymLabel(m)])
  };
}

/* ---------- data ---------- */

/** Monthly loan payments still running today. */
function debtPaymentsMonthly() {
  return (S.debts || []).reduce((s, d) => {
    if (loanResidual(d, today()) <= 0) return s;
    return s + (+d.payment || loanPayment(+d.principal || 0, +d.rate || 0, +d.months || 0));
  }, 0);
}

/** Everything the report shows, computed once. */
function reportData(P) {
  const tot = P.months.map(k => ({ k, ...monthTot(k) }));
  const inc = tot.reduce((s, x) => s + x.inc, 0),
    out = tot.reduce((s, x) => s + x.out, 0);
  const cats = {};
  for (const k of P.months) for (const [c, v] of Object.entries(catSpend(k))) cats[c] = (cats[c] || 0) + v;
  // reference for the indicators: the last 12 complete months, so a single month is not misleading
  const ref = lastMonths(13)
    .slice(0, 12)
    .map(k => monthTot(k));
  const refCats = {};
  const refMonths = lastMonths(13).slice(0, 12);
  for (const k of refMonths)
    for (const [c, v] of Object.entries(catSpend(k))) refCats[c] = (refCats[c] || 0) + v;
  const refN = Math.max(1, ref.filter(x => x.inc > 0 || x.out > 0).length);

  const investments = invVal(),
    hs = S.holdings.filter(h => h.qty * h.price > 0);
  const topWeight = investments ? Math.max(0, ...hs.map(h => h.qty * h.price)) / investments : 0;
  const terCost = S.holdings.reduce((s, h) => s + (h.qty * h.price * (+h.ter || 0)) / 100, 0);
  const trades = histScope(null);
  const irr = trades.length ? histSummary(trades, null).irr : null;
  const first = P.months[0],
    last = P.months[P.months.length - 1];
  const health = EN.healthIndicators({
    months: ref,
    cash: cash(),
    cardDebt: cardDebt(),
    investments,
    invCost: invCost(),
    assets: assetsVal(),
    debts: debtsVal(),
    fixedMonthly: recMonthly(),
    debtPayments: debtPaymentsMonthly(),
    terCost,
    topWeight,
    xirr: irr,
    netStart: netAt(EN.ymAdd(first, -1)),
    netEnd: netAt(last)
  });
  const tx = S.tx
    .filter(t => P.months.includes(ym(t.date)))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { tot, inc, out, cats, refCats, refN, health, tx, hs, investments };
}

/* ---------- formatting ---------- */

const HEALTH_CHIP = {
  good: '<span class="chip c-good">✓ Bene</span>',
  warn: '<span class="chip c-warn">! Da migliorare</span>',
  crit: '<span class="chip c-crit">✕ Attenzione</span>',
  info: ''
};

/** Formats an indicator value by its unit. */
function healthValue(x) {
  if (x.unit === 'pct') return (Math.round(x.value * 1000) / 10).toLocaleString(LOCALE) + '%';
  if (x.unit === 'months') return (Math.round(x.value * 10) / 10).toLocaleString(LOCALE) + ' mesi';
  if (x.unit === 'eurm') return eur0(x.value) + ' / mese';
  return (x.value > 0 ? '+' : '') + eur0(x.value);
}

/* ---------- sections ---------- */

function repControls(P) {
  const modes = [
    ['month', 'Mese'],
    ['year', 'Anno'],
    ['12m', 'Ultimi 12 mesi']
  ];
  const select = P.options.length
    ? `<select class="inp" id="repm">${P.options.map(([v, l]) => `<option value="${v}" ${v === P.key ? 'selected' : ''}>${l}</option>`).join('')}</select>`
    : '';
  return `<div class="tools noprint rep-tools">
    ${segmented('rep-mode', modes, P.mode, 300)}${select}
    ${segmented(
      'rep-detail',
      [
        ['full', 'Completo'],
        ['summary', 'Solo sintesi']
      ],
      REP.detail,
      200
    )}
    <button class="btn pri" data-act="print">🖨 Stampa / Salva PDF</button>
    <span class="hint">“Solo sintesi” toglie esercenti e singoli movimenti: utile da condividere con un consulente.</span></div>`;
}

function repSummary(D) {
  const sv = D.inc - D.out;
  const net = D.health.find(x => x.k === 'networth');
  const kpi = (lbl, val, cls = '') =>
    `<div class="card kpi"><div class="lbl">${lbl}</div><div class="val num ${cls}">${val}</div></div>`;
  return `<div class="grid g4 rep-kpi">
    ${kpi('Entrate', eur(D.inc))}
    ${kpi('Uscite', eur(D.out))}
    ${kpi('Risparmio', eur(sv), sv >= 0 ? 'up' : 'down')}
    ${kpi('Tasso di risparmio', D.inc ? Math.round((sv / D.inc) * 100) + '%' : '—')}
  </div>
  <div class="grid g4 rep-kpi" style="margin-top:10px">
    ${kpi('Patrimonio netto', eur0(cash() + D.investments + assetsVal() - debtsVal() - cardDebt()))}
    ${kpi('Variazione nel periodo', net ? healthValue(net) : '—', net && net.value < 0 ? 'down' : 'up')}
    ${kpi('Liquidità', eur0(cash()))}
    ${kpi('Investimenti', eur0(D.investments))}
  </div>`;
}

function repHealth(D) {
  if (!D.health.length) return '';
  const rows = D.health
    .filter(x => x.k !== 'networth')
    .map(
      x => `<div class="hcell"><div class="hhead"><span>${x.label}</span>${HEALTH_CHIP[x.status]}</div>
        <div class="hval num">${healthValue(x)}</div>
        <div class="hint">${x.note}${x.target ? ' · <i>' + x.target + '</i>' : ''}</div>${x.k === 'afford' ? '<button class="btn sm noprint" style="margin-top:8px" data-act="go" data-v="permettermelo">Simula un acquisto</button>' : ''}</div>`
    )
    .join('');
  return `<div class="card rep-sec"><div class="card-h"><div><h3>Indicatori di salute finanziaria</h3><div class="hint">Calcolati sugli ultimi 12 mesi completi · riferimenti usati dai consulenti, solo orientativi</div></div></div>
    <div class="hgrid">${rows}</div></div>`;
}

function repWealth(D) {
  const parts = [
    ['Liquidità', cash(), 'var(--s-blue)'],
    ['Investimenti', D.investments, 'var(--s-aqua)'],
    ['Beni (casa, auto…)', assetsVal(), 'var(--s-orange)']
  ];
  const debts = debtsVal() + cardDebt();
  const total = parts.reduce((s, p) => s + Math.max(0, p[1]), 0) || 1;
  const bar = parts
    .map(
      ([l, v, c]) => `<i style="width:${(Math.max(0, v) / total) * 100}%;background:${c}" title="${l}"></i>`
    )
    .join('');
  const rows = parts
    .map(
      ([l, v, c]) =>
        `<tr><td><span class="dot" style="background:${c}"></span>${l}</td><td class="r num">${eur0(v)}</td><td class="r num">${Math.round((Math.max(0, v) / total) * 100)}%</td></tr>`
    )
    .join('');
  return `<div class="card rep-sec"><h3>Composizione del patrimonio</h3>
    <div class="stackbar">${bar}</div>
    <table class="tbl"><tbody>${rows}
      <tr><td><span class="dot" style="background:var(--crit)"></span>Debiti (mutui, prestiti, carte)</td><td class="r num down">−${eur0(debts)}</td><td></td></tr>
    </tbody><tfoot><tr><td><b>Patrimonio netto</b></td><td class="r num"><b>${eur0(total - debts)}</b></td><td></td></tr></tfoot></table></div>`;
}

function repMonths(P, D) {
  if (P.mode === 'month') {
    const sav = savingsBars(12, P.key);
    return `<div class="card rep-sec"><div class="card-h"><div><h3>Risparmio mensile</h3><div class="hint">Ultimi 12 mesi fino a ${monthInText(ymLabel(P.key))}</div></div><div class="legend"><span><i style="background:var(--tx)"></i>Migliore</span><span><i style="background:var(--crit)"></i>Peggiore</span></div></div>${sav.svg}</div>`;
  }
  const rows = D.tot
    .filter(x => x.inc > 0 || x.out > 0)
    .map(x => {
      const s = x.inc - x.out;
      return `<tr><td>${ymLabel(x.k)}</td><td class="r num">${eur0(x.inc)}</td><td class="r num">${eur0(x.out)}</td><td class="r num ${s >= 0 ? 'up' : 'down'}">${eur0(s)}</td><td class="r num">${x.inc ? Math.round((s / x.inc) * 100) + '%' : '—'}</td></tr>`;
    })
    .join('');
  return `<div class="card rep-sec"><h3>Entrate e uscite mese per mese</h3>
    <table class="tbl"><thead><tr><th>Mese</th><th class="r">Entrate</th><th class="r">Uscite</th><th class="r">Risparmio</th><th class="r">Tasso</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td><b>Totale</b></td><td class="r num"><b>${eur0(D.inc)}</b></td><td class="r num"><b>${eur0(D.out)}</b></td><td class="r num"><b>${eur0(D.inc - D.out)}</b></td><td class="r num"><b>${D.inc ? Math.round(((D.inc - D.out) / D.inc) * 100) + '%' : '—'}</b></td></tr></tfoot></table></div>`;
}

function repCategories(P, D) {
  // months of the period that have data: empty months before the first import are not counted
  const n = Math.max(1, D.tot.filter(x => x.inc > 0 || x.out > 0).length);
  const rows = Object.entries(D.cats)
    .sort((a, b) => b[1] - a[1])
    .map(([c, v]) => {
      const perMonth = v / n,
        avg = (D.refCats[c] || 0) / D.refN;
      const diff = avg ? (perMonth - avg) / avg : 0;
      const b = S.budgets[c];
      const budget = b
        ? statusChip(perMonth, b) + ' <span class="num hint">' + eur0(b) + '</span>'
        : '<span class="hint">—</span>';
      const trend =
        avg && Math.abs(diff) >= 0.1
          ? `<span class="num ${diff > 0 ? 'down' : 'up'}">${diff > 0 ? '+' : ''}${Math.round(diff * 100)}%</span>`
          : '<span class="hint">=</span>';
      return `<tr><td>${catIc(c)} ${esc(c)}</td><td class="r num">${eur(v)}</td><td class="r num hide-m">${D.out ? Math.round((v / D.out) * 100) : 0}%</td><td class="r">${trend}</td><td class="r">${budget}</td></tr>`;
    })
    .join('');
  return `<div class="card rep-sec"><h3>Spese per categoria</h3><div class="hint" style="margin-bottom:6px">“vs media”: confronto con la media mensile degli ultimi 12 mesi${n > 1 ? ' · budget e confronto sono al mese' : ''}</div>
    <table class="tbl"><thead><tr><th>Categoria</th><th class="r">Speso</th><th class="r hide-m">%</th><th class="r">vs media</th><th class="r">Budget</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5" class="hint">Nessuna spesa</td></tr>'}</tbody></table></div>`;
}

function repTopExpenses(D) {
  const top = D.tx
    .filter(x => x.amount < 0 && !isNeutral(x.cat))
    .sort((a, b) => a.amount - b.amount)
    .slice(0, 8)
    .map(
      x =>
        `<tr><td class="num hint">${x.date.slice(8)}/${x.date.slice(5, 7)}</td><td>${esc(x.note || x.cat)}<div class="hint">${esc(x.cat)}</div></td><td class="r num">${eur(x.amount)}</td></tr>`
    )
    .join('');
  return `<div class="card rep-sec"><h3>Spese più alte</h3><table class="tbl"><tbody>${top || '<tr><td class="hint">Nessuna spesa</td></tr>'}</tbody></table></div>`;
}

function repInvestments(D) {
  if (!D.investments) return '';
  const by = {};
  for (const h of D.hs) by[hCls(h)] = (by[hCls(h)] || 0) + h.qty * h.price;
  const cost = invCost(),
    gain = D.investments - cost;
  const rows = Object.entries(by)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([k, v]) =>
        `<tr><td>${esc(clsLabel(k))}</td><td class="r num">${eur0(v)}</td><td class="r num">${Math.round((v / D.investments) * 100)}%</td></tr>`
    )
    .join('');
  return `<div class="card rep-sec"><h3>Investimenti</h3>
    <div class="hint" style="margin-bottom:8px">Valore ${eur0(D.investments)} · prezzo di carico ${eur0(cost)} · <span class="${gain >= 0 ? 'up' : 'down'}">${gain >= 0 ? '+' : ''}${eur0(gain)}</span></div>
    <table class="tbl"><thead><tr><th>Classe</th><th class="r">Valore</th><th class="r">Peso</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function repTransactions(D) {
  const rows = D.tx
    .map(
      x =>
        `<tr><td class="num">${x.date.slice(8)}/${x.date.slice(5, 7)}</td><td>${esc(x.note || '')}</td><td>${esc(x.cat)}</td><td class="hide-m">${esc(accName(x.accountId))}</td><td class="r num ${x.amount > 0 ? 'up' : ''}">${x.amount > 0 ? '+' : ''}${eur(x.amount)}</td></tr>`
    )
    .join('');
  return `<div class="card rep-sec"><h3>Tutti i movimenti (${D.tx.length})</h3>
    <table class="tbl"><thead><tr><th>Data</th><th>Descrizione</th><th>Categoria</th><th class="hide-m">Conto</th><th class="r">Importo</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5" class="hint">Nessun movimento</td></tr>'}</tbody>
    <tfoot><tr><td colspan="3"><b>Saldo del periodo</b></td><td class="hide-m"></td><td class="r num"><b>${eur(D.inc - D.out)}</b></td></tr></tfoot></table></div>`;
}

/** Report screen. */
function vReport() {
  const P = reportPeriod(),
    D = reportData(P),
    full = REP.detail === 'full';
  return `${repControls(P)}
  <div class="report">
    <div class="rep-h"><div><div class="hint" style="font-weight:600;letter-spacing:.04em">EYECASH · ${P.kind}</div><h2>${P.title}</h2></div>
      <div class="hint" style="text-align:right">Generato il ${dLabel(today())}<br>Calcolato sul tuo dispositivo</div></div>
    ${repSummary(D)}
    ${repHealth(D)}
    <div class="grid g2">${repWealth(D)}${repInvestments(D) || (full ? repTopExpenses(D) : '')}</div>
    ${repMonths(P, D)}
    ${repCategories(P, D)}
    ${full && D.investments ? repTopExpenses(D) : ''}
    ${full && P.mode === 'month' ? repTransactions(D) : ''}
    <p class="hint rep-foot">Indicatori calcolati da EyeCash sui dati inseriti, come riferimento orientativo: non sono una consulenza finanziaria.</p>
  </div>`;
}
