/*
 * EyeCash · public/js/afford.js
 *
 * "Can I afford it?": a mortgage, a car or any big purchase simulated on the
 * user's real income, spending and savings. Everything is computed on the
 * device by EN.affordability; a question in plain words is turned into
 * parameters by the local parser or, if allowed, by the AI, which receives
 * only the sentence.
 */

/* ---------- defaults ---------- */

/** Typical values per kind, used when the user switches kind or leaves a field empty. */
const AFF_KINDS = {
  mortgage: {
    label: 'Casa (mutuo)',
    icon: '🏠',
    price: 250000,
    downPayment: 50000,
    extraCosts: 15000,
    ratePct: 3.2,
    years: 25,
    payCash: false,
    runningCosts: 0
  },
  car: {
    label: 'Auto',
    icon: '🚗',
    price: 25000,
    downPayment: 5000,
    extraCosts: 800,
    ratePct: 6.9,
    years: 5,
    payCash: false,
    runningCosts: 150
  },
  purchase: {
    label: 'Altro acquisto',
    icon: '🛍️',
    price: 5000,
    downPayment: 0,
    extraCosts: 0,
    ratePct: 7,
    years: 3,
    payCash: true,
    runningCosts: 0
  }
};

/** The typical values of a kind, without its label and icon. */
function affDef(k) {
  const { label: _l, icon: _i, ...d } = AFF_KINDS[k];
  return d;
}

let affBusy = false,
  affNote = null, // what was understood from the last question
  affSaveT = null;

/** Monthly rent found among the recurring costs (category Casa, name like "affitto"). */
function affRent() {
  return Math.round(
    S.recurring
      .filter(
        r =>
          r.type !== 'in' &&
          (r.cat === 'Casa' || /affitt|rent|canone|pigione/i.test(r.name)) &&
          /affitt|rent|canone|pigione/i.test(r.name)
      )
      .reduce((s, r) => s + r.amount * (FREQM[r.freq] || 1), 0)
  );
}

/** The user's real numbers: averages of the last 12 complete months with data, balances and payments. */
function affMine() {
  const ms = lastMonths(13)
    .slice(0, 12)
    .map(k => monthTot(k))
    .filter(x => x.inc > 0 || x.out > 0);
  const n = ms.length || 1;
  return {
    months: ms.length,
    income: ms.reduce((s, x) => s + x.inc, 0) / n,
    spending: ms.reduce((s, x) => s + x.out, 0) / n,
    cash: Math.max(0, cash()),
    investments: invVal(),
    payments: debtPaymentsMonthly()
  };
}

/** Saved inputs, completed with the defaults of their kind. */
function affInputs() {
  const A = S.afford || {};
  const kind = AFF_KINDS[A.kind] ? A.kind : 'mortgage';
  const F = { emergencyMonths: 6, useInvestments: false, ...affDef(kind), rentNow: affRent(), ...A, kind };
  if (kind === 'mortgage') F.payCash = false;
  return F;
}

/** Runs the engine with the inputs and the user's numbers. */
function affCompute(F, M) {
  return EN.affordability({
    kind: F.kind,
    price: +F.price || 0,
    downPayment: +F.downPayment || 0,
    extraCosts: +F.extraCosts || 0,
    ratePct: +F.ratePct || 0,
    months: Math.round((+F.years || 0) * 12),
    payCash: !!F.payCash,
    runningCosts: +F.runningCosts || 0,
    rentNow: F.kind === 'mortgage' ? +F.rentNow || 0 : 0,
    monthlyIncome: M.income,
    monthlySpending: M.spending,
    cash: M.cash,
    investments: M.investments,
    useInvestments: !!F.useInvestments,
    existingPayments: M.payments,
    emergencyMonths: +F.emergencyMonths || 6
  });
}

/* ---------- view ---------- */

const AFF_VERDICT = {
  yes: [
    'c-good',
    '✓',
    'Sì, te lo puoi permettere',
    'Tutti i controlli sono a posto con le tue entrate e spese reali.'
  ],
  careful: [
    'c-warn',
    '!',
    'Sì, ma con attenzione',
    'Si può fare, ma almeno un controllo è al limite: guarda i dettagli sotto.'
  ],
  no: ['c-crit', '✕', 'Non ancora', 'Con i numeri di oggi almeno un controllo non è superato.']
};
const AFF_CHIP = {
  good: '<span class="chip c-good">✓ Bene</span>',
  warn: '<span class="chip c-warn">! Al limite</span>',
  crit: '<span class="chip c-crit">✕ No</span>'
};

/** One line per check, with what it means. */
function affCheckRow(c, r, F) {
  const em = +F.emergencyMonths || 6;
  const L = {
    upfront: [
      'Soldi da versare subito',
      eur0(c.value),
      r.cashAfter >= 0 ? `dopo ti restano ${eur0(r.cashAfter)}` : `ti mancano ${eur0(-r.cashAfter)}`
    ],
    emergency: [
      'Fondo emergenza dopo l’acquisto',
      isFinite(c.value) ? (Math.round(c.value * 10) / 10).toLocaleString(LOCALE) + ' mesi' : '∞',
      `consigliati almeno ${em} mesi delle nuove spese`
    ],
    dti: [
      'Rate sul reddito',
      isFinite(c.value) ? (Math.round(c.value * 1000) / 10).toLocaleString(LOCALE) + '%' : '—',
      'le banche chiedono di solito meno del 33%'
    ],
    saving: [
      'Risparmio mensile dopo',
      eur0(c.value),
      r.savingBefore ? `oggi ${eur0(r.savingBefore)} al mese` : 'meglio restare sopra il 10% delle entrate'
    ],
    ltv: ['Mutuo sul prezzo', Math.round(c.value * 100) + '%', 'le banche finanziano di solito fino all’80%']
  }[c.k];
  return `<div class="hcell"><div class="hhead"><span>${L[0]}</span>${AFF_CHIP[c.status]}</div><div class="hval num">${L[1]}</div><div class="hint">${L[2]}</div></div>`;
}

/** Cash over the next 36 months, without and with the purchase. */
function affChart(r) {
  const W = innerWidth < 820 ? 360 : 700,
    H = 220,
    pl = 52,
    pr = 10,
    pt = 14,
    pb = 26,
    iw = W - pl - pr,
    ih = H - pt - pb;
  const P = r.projection,
    n = P.length;
  const vals = P.flatMap(p => [p.before, p.after]);
  // round axis ends, with zero always visible
  const mn = Math.min(0, ...vals),
    mx = Math.max(1, ...vals);
  const lo = mn < 0 ? -niceTop(-mn) : 0,
    top = mx > 0 ? niceTop(mx) : 0;
  const X = i => pl + (i / (n - 1)) * iw,
    Y = v => pt + ih - (ih * (v - lo)) / (top - lo || 1);
  let g = '';
  for (let k = 0; k <= 4; k++) {
    const v = lo + ((top - lo) * k) / 4,
      y = Y(v);
    g += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" stroke="var(--line)" stroke-width="1"/><text x="${pl - 6}" y="${y + 4}" text-anchor="end">${kfmt(v)}</text>`;
  }
  if (lo < 0)
    g += `<line x1="${pl}" x2="${W - pr}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--crit)" stroke-dasharray="4 3"/>`;
  for (let i = 0; i < n; i += 6)
    g += `<text x="${X(i)}" y="${H - 6}" text-anchor="${i === n - 1 ? 'end' : 'middle'}">${i ? '+' + i + 'm' : t('oggi')}</text>`;
  const pts = key => P.map((p, i) => [X(i), Y(p[key])]);
  g += `<path d="${smoothPath(pts('before'))}" fill="none" stroke="var(--mut)" stroke-width="2" stroke-dasharray="5 4"/>`;
  g += `<path d="${smoothPath(pts('after'))}" fill="none" stroke="var(--s-blue)" stroke-width="2.4"/>`;
  for (let i = 0; i < n; i++)
    g += `<rect x="${X(i) - iw / (n - 1) / 2}" y="${pt}" width="${iw / (n - 1)}" height="${ih}" fill="transparent" data-tip="${t('Tra {0} mesi', [i])}\n${t('Senza acquisto')}: ${eur0(P[i].before)}\n${t('Con acquisto')}: ${eur0(P[i].after)}"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">${g}</svg>
  <div class="hint" style="display:flex;gap:16px;margin-top:6px"><span><span class="dot" style="background:var(--s-blue)"></span>Con l’acquisto</span><span><span class="dot" style="background:var(--mut)"></span>Senza acquisto</span></div>`;
}

/** The result part, redrawn on every change without touching the form. */
function affResult(F, M) {
  if (!M.months)
    return `<div class="card" style="margin-top:14px"><div class="hint">Serve almeno un mese di movimenti per conoscere entrate e spese: importa un estratto conto o aggiungi i movimenti.</div></div>`;
  if (!(+F.price > 0))
    return `<div class="card" style="margin-top:14px"><div class="hint">Inserisci il prezzo per vedere la simulazione.</div></div>`;
  const r = affCompute(F, M);
  const [cls, ic, title, sub] = AFF_VERDICT[r.verdict];
  const loan = r.loan > 0;
  const mta =
    r.monthsToAfford === 0
      ? 'già oggi'
      : isFinite(r.monthsToAfford)
        ? t('tra circa {0} mesi', [r.monthsToAfford])
        : 'non con il risparmio attuale';
  return `<div class="card aff-verdict ${cls}" style="margin-top:14px"><div class="aff-ic"><b>${ic}</b></div><div><h3>${title}</h3><div class="hint">${sub}</div></div></div>
  <div class="grid g4" style="margin-top:14px">
    <div class="card kpi"><div class="lbl">${loan ? 'Rata mensile' : 'Pagamento'}</div><div class="val num">${loan ? eur0(r.payment) : eur0(+F.price)}</div><div class="foot">${loan ? t('{0} rate · interessi totali {1}', [r.months, eur0(r.totalInterest)]) : 'in un’unica soluzione'}</div></div>
    <div class="card kpi"><div class="lbl">Spese mensili dopo</div><div class="val num">${eur0(r.spendingAfter)}</div><div class="foot">${t('oggi {0}', [eur0(M.spending)])}</div></div>
    <div class="card kpi"><div class="lbl">Prezzo massimo consigliato</div><div class="val num">${eur0(r.maxPrice)}</div><div class="foot">${loan ? 'con lo stesso anticipo, tasso e durata' : 'tenendo il fondo emergenza'}</div></div>
    <div class="card kpi"><div class="lbl">Anticipo e fondo pronti</div><div class="val num" style="font-size:20px">${mta}</div><div class="foot">risparmiando come negli ultimi 12 mesi</div></div>
  </div>
  <div class="card" style="margin-top:14px"><h3>I controlli</h3><div class="hgrid">${r.checks.map(c => affCheckRow(c, r, F)).join('')}</div></div>
  <div class="card" style="margin-top:14px"><h3>Liquidità nei prossimi 3 anni</h3><div class="hint" style="margin-bottom:8px">${F.useInvestments ? 'Saldo dei conti, con gli investimenti usati per l’anticipo se serve, risparmiando come oggi' : 'Saldo dei conti, risparmiando come oggi'}</div>${affChart(r)}</div>
  <div class="hint" style="margin:14px 2px 0;line-height:1.5">Simulazione orientativa calcolata sul tuo dispositivo con i tuoi dati: non è una consulenza finanziaria né un'offerta di finanziamento. Tassi e condizioni reali dipendono dalla banca.</div>`;
}

/** The "Can I afford it?" view. */
function vAfford() {
  const F = affInputs(),
    M = affMine();
  const canAI = perm('ask') && !OFFLINE;
  const loanKind = F.kind === 'mortgage' || !F.payCash;
  const ask = `<div class="card"><h3>Chiedilo a parole</h3><div class="hint" style="margin:4px 0 12px;line-height:1.5">${canAI ? "L'AI riceve solo la frase e ne ricava prezzo, anticipo, tasso e durata: entrate, spese e saldi restano sul dispositivo." : 'Le frasi più comuni si capiscono anche senza AI, direttamente sul dispositivo.'}</div>
    <form id="affask" style="display:flex;gap:8px"><input class="inp" id="affq" maxlength="300" placeholder="es. posso permettermi una casa da 250.000 € con 50.000 di anticipo in 25 anni?" style="flex:1" autocomplete="off"><button class="btn pri" type="submit" ${affBusy ? 'disabled' : ''}>${affBusy ? '…' : 'Simula'}</button></form>
    ${affNote ? `<div class="hint" style="margin-top:10px">${esc(affNote)}</div>` : ''}</div>`;
  const kinds = `<div class="seg" style="margin:14px 0">${Object.entries(AFF_KINDS)
    .map(
      ([k, v]) =>
        `<button type="button" class="${k === F.kind ? 'on' : ''}" data-act="aff-kind" data-k="${k}">${v.icon} ${v.label}</button>`
    )
    .join('')}</div>`;
  const form = `<div class="card"><form id="affform"><div class="grid g4" style="gap:10px">
    ${fld('Prezzo (€)', 'price', F.price)}
    ${
      F.kind !== 'mortgage'
        ? fld('Come paghi', 'payCash', F.payCash ? '1' : '0', {
            select: [
              ['0', 'A rate'],
              ['1', 'In contanti']
            ]
          })
        : ''
    }
    ${loanKind ? fld('Anticipo (€)', 'downPayment', F.downPayment) : ''}
    ${fld(F.kind === 'mortgage' ? 'Notaio, tasse, agenzia (€)' : 'Costi extra una tantum (€)', 'extraCosts', F.extraCosts)}
    ${loanKind ? fld('Tasso annuo (%)', 'ratePct', String(F.ratePct).replace('.', DEC)) + fld('Durata (anni)', 'years', String(F.years).replace('.', DEC)) : ''}
    ${F.kind === 'mortgage' ? fld('Affitto che non pagheresti più (€/mese)', 'rentNow', F.rentNow) : ''}
    ${F.kind !== 'purchase' ? fld(F.kind === 'car' ? 'Assicurazione, bollo, carburante (€/mese)' : 'Spese di casa in più (€/mese)', 'runningCosts', F.runningCosts) : ''}
    ${fld('Usa anche gli investimenti', 'useInvestments', F.useInvestments ? '1' : '0', {
      select: [
        ['0', 'No'],
        ['1', 'Sì, se serve']
      ]
    })}
    ${fld('Fondo emergenza (mesi)', 'emergencyMonths', F.emergencyMonths)}
  </div></form></div>`;
  const mine = `<div class="card" style="margin-top:14px"><div class="card-h"><div><h3>I tuoi numeri</h3><div class="hint">${M.months ? t('Media degli ultimi {0} mesi completi', [M.months]) : 'Ancora nessun movimento'}</div></div></div>
    <div class="grid g4" style="gap:10px">
      <div><div class="hint">Entrate al mese</div><div class="num" style="font-weight:700">${eur0(M.income)}</div></div>
      <div><div class="hint">Spese al mese</div><div class="num" style="font-weight:700">${eur0(M.spending)}</div></div>
      <div><div class="hint">Liquidità</div><div class="num" style="font-weight:700">${eur0(M.cash)}</div></div>
      <div><div class="hint">Investimenti</div><div class="num" style="font-weight:700">${eur0(M.investments)}</div></div>
      ${M.payments ? `<div><div class="hint">Rate già in corso</div><div class="num" style="font-weight:700">${eur0(M.payments)} / mese</div></div>` : ''}
    </div></div>`;
  return `${ask}${kinds}${form}${mine}<div id="affres">${affResult(F, M)}</div>`;
}

/* ---------- input ---------- */

/** Reads the form and saves it (debounced); a changed choice redraws the form, a typed value only the result. */
function affFromForm(full) {
  const f = $('#affform');
  if (!f) return;
  const d = Object.fromEntries(new FormData(f).entries());
  const A = { ...affInputs() };
  for (const k of [
    'price',
    'downPayment',
    'extraCosts',
    'ratePct',
    'years',
    'rentNow',
    'runningCosts',
    'emergencyMonths'
  ])
    if (d[k] != null) A[k] = num(d[k]);
  if (d.payCash != null) A.payCash = d.payCash === '1';
  if (d.useInvestments != null) A.useInvestments = d.useInvestments === '1';
  S.afford = A;
  clearTimeout(affSaveT);
  affSaveT = setTimeout(save, 700);
  if (full) return renderView();
  $('#affres').innerHTML = affResult(A, affMine());
  applyBalMask();
}

/** Switches kind, starting from that kind's typical values. */
function affSetKind(k) {
  if (!AFF_KINDS[k]) return;
  const A = affInputs();
  S.afford = {
    kind: k,
    ...affDef(k),
    rentNow: A.rentNow,
    emergencyMonths: A.emergencyMonths,
    useInvestments: A.useInvestments
  };
  affNote = null;
  save();
  renderView();
}

/** Applies the parameters understood from a question. */
function affApply(p, viaAI) {
  const base = affDef(p.kind);
  const A = { ...affInputs(), ...base, kind: p.kind };
  for (const k of ['price', 'downPayment', 'extraCosts', 'ratePct', 'years', 'runningCosts'])
    if (p[k] != null) A[k] = p[k];
  if (p.payCash != null) A.payCash = p.payCash;
  if (p.useInvestments != null) A.useInvestments = p.useInvestments;
  // "a €200,000 mortgage" is the amount borrowed: the price is that plus the down payment
  if (p.loanAmount) {
    if (p.price) A.downPayment = Math.max(0, p.price - p.loanAmount);
    else {
      if (p.downPayment == null)
        A.downPayment = p.kind === 'mortgage' ? Math.round((p.loanAmount * 0.25) / 100) * 100 : 0;
      A.price = p.loanAmount + A.downPayment;
    }
    A.payCash = false;
  }
  // a price without a down payment: keep the typical share of the price
  if (p.price && !p.loanAmount && p.downPayment == null)
    A.downPayment = p.kind === 'purchase' ? 0 : Math.round((p.price * 0.2) / 100) * 100;
  if (A.price && p.extraCosts == null)
    A.extraCosts = p.kind === 'mortgage' ? Math.round((A.price * 0.06) / 100) * 100 : base.extraCosts;
  if (p.kind === 'mortgage') A.payCash = false;
  S.afford = A;
  const parts = [t(AFF_KINDS[p.kind].label) + (p.label ? ' · ' + p.label : '')];
  if (A.price) parts.push(t('prezzo {0}', [eur0(A.price)]));
  if (A.kind === 'mortgage' || !A.payCash)
    parts.push(
      t('anticipo {0}', [eur0(A.downPayment)]),
      t('mutuo {0}', [eur0(Math.max(0, A.price - A.downPayment))]),
      t('{0}% in {1} anni', [String(A.ratePct).replace('.', DEC), String(A.years).replace('.', DEC)])
    );
  else parts.push(t('in contanti'));
  affNote = t('Ho capito ({0}): {1}. Correggi i campi se serve.', [
    viaAI ? 'AI' : t('sul dispositivo'),
    parts.join(', ')
  ]);
  save();
}

/**
 * A general question without a price ("che mutuo posso permettermi?"): finds the highest
 * price that passes every check with the user's numbers, using the cash left after the
 * emergency fund as down payment (at most the typical share for a car).
 */
function affGeneral(p, viaAI) {
  const M = affMine();
  const A = { ...affInputs(), ...affDef(p.kind), kind: p.kind };
  for (const k of ['ratePct', 'years', 'runningCosts']) if (p[k] != null) A[k] = p[k];
  if (p.payCash != null && p.kind !== 'mortgage') A.payCash = p.payCash;
  if (p.useInvestments != null) A.useInvestments = p.useInvestments;
  const avail = Math.max(
    0,
    M.cash + (A.useInvestments ? M.investments : 0) - (+A.emergencyMonths || 6) * M.spending
  );
  // inputs for a given price: typical extra costs, down payment from the cash that is free
  const at = price => {
    const B = { ...A, price };
    if (B.kind === 'mortgage') B.extraCosts = Math.round((price * 0.06) / 100) * 100;
    if (B.kind === 'mortgage' || !B.payCash) {
      const room = Math.max(0, avail - (+B.extraCosts || 0));
      B.downPayment = Math.floor((B.kind === 'car' ? Math.min(room, price * 0.3) : room) / 100) * 100;
    }
    return B;
  };
  // the highest price whose verdict is not "no", by bisection
  let lo = 0,
    hi = 5e6;
  for (let i = 0; i < 40 && hi - lo > 100; i++) {
    const mid = (lo + hi) / 2;
    if (affCompute(at(mid), M).verdict !== 'no') lo = mid;
    else hi = mid;
  }
  Object.assign(A, at(Math.floor(lo / 1000) * 1000));
  S.afford = A;
  const what = { mortgage: 'una casa', car: "un'auto", purchase: 'un acquisto' }[A.kind];
  affNote = A.price
    ? t(
        'Con i tuoi numeri puoi puntare a {0} fino a circa {1}, usando come anticipo la liquidità oltre il fondo emergenza. Correggi i campi se serve.',
        [t(what), eur0(A.price)]
      )
    : t('Con i numeri di oggi non resta margine per questo acquisto: guarda i controlli sotto.');
  if (viaAI) affNote = 'AI · ' + affNote;
  save();
}

/** Turns a question into parameters: AI if allowed, otherwise (or on error) the local parser. */
async function affordAsk(q) {
  if (affBusy) return;
  if (view !== 'permettermelo') go('permettermelo');
  let p = null,
    viaAI = false;
  if (perm('ask') && !OFFLINE) {
    affBusy = true;
    renderView();
    try {
      logAI('afford', `Domanda: «${q.slice(0, 200)}». Nessun importo, saldo o movimento.`);
      p = await api('POST', '/api/ai/afford', { question: anon(q), lang: LANG });
      viaAI = true;
    } catch (e) {
      p = null;
    }
    affBusy = false;
  }
  const loc = EN.parseAffordText(anon(q)); // an IBAN or a card number is never a price
  // the local parser wins when the AI found no amount but the sentence has one
  if (!p || (!p.price && !p.loanAmount && (loc.price || loc.loanAmount))) {
    p = { ...(p || {}), ...loc };
    viaAI = false;
  }
  if (p.price || p.loanAmount) affApply(p, viaAI);
  else if (!affMine().months)
    affNote = t(
      'Serve almeno un mese di movimenti per conoscere entrate e spese: importa un estratto conto o aggiungi i movimenti.'
    );
  else if (p.kind !== 'purchase' || /quant|qual|che |massim|how much|what|max/i.test(q)) affGeneral(p, viaAI);
  else affNote = t('Non ho trovato un prezzo nella domanda: scrivilo, ad esempio «auto da 20.000 €».');
  renderView();
}

/** True for questions about buying something or taking a loan, which the planner answers. */
const isAffordQ = q =>
  /permetter|can i afford|could i afford|can i buy|afford a|afford an|posso (comprare|prendere|fare|chiedere|accendere|sostenere|ottenere)/i.test(
    q
  ) ||
  (/mutuo|finanziament|prestito|leasing|mortgage|\bloan\b/i.test(q) &&
    !/\b(ho speso|speso|spese|pagato|pago|rata|interessi|spent|paid|pay|payment)\b/i.test(q));
