/*
 * EyeCash · public/js/finance.js
 *
 * Money calculations on the device: balances, monthly totals, credit
 * cards, net worth, assets and debts (with loan amortisation), end-of-month
 * forecast and local insights. Also the Net worth view and its forms.
 */
/* ---------- computations ---------- */
/** Current balance of an account (opening balance + transactions). */
const accBal = a => a.balance0 + S.tx.reduce((s, t) => (t.accountId === a.id ? s + t.amount : s), 0);
const isCard = a => a.type === 'Carta';
const cash = () => S.accounts.reduce((s, a) => (isCard(a) ? s : s + accBal(a)), 0); // cash = accounts only, as the bank shows it
const cardDebt = () => S.accounts.reduce((s, a) => (isCard(a) ? s + Math.max(0, -accBal(a)) : s), 0); // cards: still to be debited
function cardDue(a) {
  // next debit: same day of month as the last recorded card payment
  const last = S.tx
    .filter(t => t.accountId === a.id && t.amount > 0 && t.cat === 'Giroconti')
    .map(t => t.date)
    .sort()
    .pop();
  if (!last) return '';
  let d = last;
  for (let g = 0; d <= today() && g < 24; g++) d = addPeriod(d, 'mensile', +last.slice(8));
  return d;
}
const invVal = () => S.holdings.reduce((s, h) => s + h.qty * h.price, 0);
const invCost = () => S.holdings.reduce((s, h) => s + h.qty * h.avg, 0);
/** Income, spending and saving for a month (YYYY-MM), excluding transfers. */
function monthTot(k) {
  let inc = 0,
    out = 0;
  for (const t of S.tx)
    if (ym(t.date) === k && !isNeutral(t.cat)) {
      if (t.amount > 0) inc += t.amount;
      else out -= t.amount;
    }
  return { inc, out };
}
function lastMonths(n) {
  const now = new Date(),
    a = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    a.push(ds(d).slice(0, 7));
  }
  return a;
}
function catSpend(k) {
  const m = {};
  for (const t of S.tx)
    if (ym(t.date) === k && t.amount < 0 && !isNeutral(t.cat)) m[t.cat] = (m[t.cat] || 0) - t.amount;
  return m;
}
const accName = id => (S.accounts.find(a => a.id === id) || {}).name || '—';
const recMonthly = () =>
  S.recurring.reduce((s, r) => s + (r.type === 'in' ? 0 : r.amount * FREQM[r.freq]), 0);

/* ---------- Assets, debts, net worth ---------- */
const AKIND = {
  auto: [['car', '#60A5FA'], 'Auto / moto'],
  casa: [['house', '#A78BFA'], 'Casa / immobile'],
  altro: [['gem', '#22D3EE'], 'Altro bene']
};
const DKIND = {
  mutuo: [['bank', '#F472B6'], 'Mutuo'],
  prestito: [['cash', '#FB7185'], 'Prestito personale'],
  auto: [['car', '#FB923C'], 'Finanziamento auto'],
  altro: [['doc', '#94A3B8'], 'Altro debito']
};
const yearsSince = t => (t ? (Date.now() - t) / (365.25 * 864e5) : 0);
function assetValue(a) {
  if (!a) return 0;
  let v = +a.value || 0;
  if (a.kind === 'auto' && a.valueAt && a.deprec > 0)
    v = v * Math.pow(1 - a.deprec / 100, yearsSince(a.valueAt));
  return Math.round(v);
}
const assetsVal = () => (S.assets || []).reduce((s, a) => s + assetValue(a), 0);
/* French amortisation: constant payment */
/** Monthly payment of a fixed-rate loan (French amortisation). */
function loanPayment(L, ratePct, n) {
  const r = ratePct / 1200;
  if (!(n > 0)) return 0;
  return r ? (L * r) / (1 - Math.pow(1 + r, -n)) : L / n;
}
function monthsPaid(start, at) {
  if (!start) return 0;
  const s = pd(start),
    d = at ? pd(at) : pd(today());
  let m = (d.getFullYear() - s.getFullYear()) * 12 + (d.getMonth() - s.getMonth());
  if (d.getDate() < s.getDate()) m--;
  return Math.max(0, m);
}
/** Outstanding debt of a loan today. */
function loanResidual(dbt, at) {
  const L = +dbt.principal || 0,
    n = +dbt.months || 0,
    r = (+dbt.rate || 0) / 1200,
    P = +dbt.payment || loanPayment(L, +dbt.rate || 0, n);
  const k = Math.min(n, monthsPaid(dbt.start, at));
  if (k >= n) return 0;
  const res = r ? L * Math.pow(1 + r, k) - (P * (Math.pow(1 + r, k) - 1)) / r : L - P * k;
  return Math.max(0, Math.round(res * 100) / 100);
}
function loanEnd(dbt) {
  const s = pd(dbt.start || today());
  return ds(new Date(s.getFullYear(), s.getMonth() + (+dbt.months || 0), s.getDate()));
}
const debtsVal = at => (S.debts || []).reduce((s, d) => s + loanResidual(d, at), 0);
/* asset deadlines (road tax, insurance, inspection, service…) */
const DEADLINES = {
  auto: [
    ['assicurazione', 'Assicurazione', 12],
    ['bollo', 'Bollo auto', 12],
    ['revisione', 'Revisione', 24],
    ['tagliando', 'Tagliando', 12]
  ],
  casa: [
    ['imu', 'IMU (acconto/saldo)', 6],
    ['assicurazione', 'Assicurazione casa', 12]
  ],
  altro: [['assicurazione', 'Assicurazione', 12]]
};
function upcomingDeadlines(days = 30) {
  const out = [];
  for (const a of S.assets || [])
    for (const [k, label] of DEADLINES[a.kind] || []) {
      const d = a.deadlines && a.deadlines[k];
      if (d && daysTo(d) <= days) out.push({ a, k, label, date: d });
    }
  return out.sort((x, y) => (x.date < y.date ? -1 : 1));
}
/* end-of-month cash forecast, all computed locally */
/** Expected balance at the end of the month from recurring items and average spending. */
function forecastEnd() {
  const k = today().slice(0, 7),
    [y, m] = k.split('-').map(Number),
    end = ds(new Date(y, m, 0)),
    dLeft = Math.max(0, daysTo(end));
  let recIn = 0,
    recOut = 0;
  for (const r of S.recurring) {
    let d = r.next,
      g = 0;
    while (d <= end && g++ < 40) {
      if (d > today() || (d === today() && !S.tx.some(t => t.recId === r.id && t.date === d))) {
        if (r.type === 'in') recIn += +r.amount;
        else recOut += +r.amount;
      }
      d = addPeriod(d, r.freq, r.freq === 'settimanale' ? null : r.anchor);
    }
  }
  const from = ds(new Date(Date.now() - 60 * 864e5));
  let varOut = 0;
  for (const t of S.tx)
    if (t.amount < 0 && !t.recId && !isNeutral(t.cat) && t.date >= from && t.date <= today())
      varOut -= t.amount;
  const daily = varOut / 60,
    variable = daily * dLeft;
  let salary = 0;
  const inc = lastMonths(3)
    .slice(0, 2)
    .map(mk =>
      S.tx.filter(t => ym(t.date) === mk && t.cat === 'Stipendio').reduce((s, t) => s + t.amount, 0)
    );
  if (inc.every(v => v > 0) && !S.tx.some(t => ym(t.date) === k && t.cat === 'Stipendio'))
    salary = (inc[0] + inc[1]) / 2;
  const now = cash();
  return {
    now,
    end: now + recIn + salary - recOut - variable,
    recIn,
    recOut,
    variable,
    salary,
    dLeft,
    daily
  };
}
/* local insights: no data leaves the server */
/** Short local observations about the month (nothing leaves the device). */
function insights() {
  const out = [],
    k = today().slice(0, 7),
    dom = +today().slice(8),
    dim = daysIn(k),
    prev = lastMonths(4).slice(0, 3);
  const cur = catSpend(k);
  const avg = {};
  for (const mk of prev) {
    const c = catSpend(mk);
    for (const x in c) avg[x] = (avg[x] || 0) + c[x] / 3;
  }
  for (const c of Object.keys({ ...cur, ...avg })) {
    const proj = ((cur[c] || 0) / Math.max(dom, 1)) * dim,
      a = avg[c] || 0;
    if (a >= 40 && proj > a * 1.25 && proj - a >= 30)
      out.push({
        ic: ['trend', '#FB923C'],
        news: true,
        t: `${c}: verso ${eur0(proj)} questo mese`,
        d: `+${Math.round((proj / a - 1) * 100)}% rispetto alla media (${eur0(a)}/mese)`,
        w: proj - a
      });
    else if (a >= 60 && dom >= 20 && proj < a * 0.7)
      out.push({
        ic: ['down', '#34D399'],
        t: `${c}: stai spendendo meno`,
        d: `${eur0(proj)} previsti contro ${eur0(a)} di media`,
        w: (a - proj) / 2
      });
  }
  const subs = S.recurring
    .filter(r => r.cat === 'Abbonamenti' && r.type !== 'in')
    .reduce((s, r) => s + r.amount * FREQM[r.freq], 0);
  if (subs > 0)
    out.push({
      ic: ['repeat', '#22D3EE'],
      t: `Abbonamenti: ${eur(subs)} al mese`,
      d: `${eur0(subs * 12)} all'anno · ${S.recurring.filter(r => r.cat === 'Abbonamenti').length} attivi`,
      w: subs / 3
    });
  const p = monthTot(lastMonths(2)[0]);
  if (p.inc > 0) {
    const rate = (p.inc - p.out) / p.inc;
    out.push({
      ic: rate >= 0.2 ? ['piggy', '#34D399'] : ['target', '#FBBF24'],
      t: `Tasso di risparmio di ${monthInText(MESIL[+lastMonths(2)[0].slice(5) - 1])}: ${Math.round(rate * 100)}%`,
      d: rate >= 0.2 ? 'Ottimo: sopra il 20%' : 'Obiettivo consigliato: almeno il 20% delle entrate',
      w: 10
    });
  }
  for (const dl of upcomingDeadlines(15))
    out.push({
      ic: ['clock', '#FB7185'],
      news: true,
      t: `${dl.label} · ${esc(dl.a.name)}`,
      d: `scade ${dLabel(dl.date)} (${daysTo(dl.date) <= 0 ? 'oggi o scaduta' : 'tra ' + daysTo(dl.date) + ' gg'})`,
      w: 999
    });
  return out.sort((a, b) => b.w - a.w).slice(0, 4);
}
function vPat() {
  const liq = cash(),
    inv = invVal(),
    ben = assetsVal(),
    cd = cardDebt(),
    deb = debtsVal() + cd,
    net = liq + inv + ben - deb,
    att = liq + inv + ben;
  const parts = [
    ['Liquidità', liq, '#60A5FA'],
    ['Investimenti', inv, '#34D399'],
    ['Beni', ben, '#A78BFA']
  ].filter(p => p[1] > 0);
  const A = S.assets || [],
    D = S.debts || [];
  const h12 = lastMonths(12),
    hv = h12.map(netAt);
  hv[hv.length - 1] = net;
  const d12 = net - hv[0],
    accs = S.accounts.filter(a => a.type !== 'Carta'),
    pos = (S.holdings || []).length;
  const srow = (ic, c, l, d, v, act) =>
    `<div class="row" ${act ? `data-act="go" data-v="${act}"` : 'style="cursor:default"'}>${tile(ic, c)}<div class="main"><div class="t1">${l}</div><div class="t2">${d}</div></div><div class="amt num ${v < 0 ? 'down' : ''}">${eur(v)}</div></div>`;
  return `<div class="grid g21">
    <div class="card bighero sens">
      <div class="bh-top"><div class="lbl">Patrimonio netto</div><div class="big num">${eur(net)}</div>${hv[0] ? `<span class="chip ${d12 >= 0 ? 'c-good' : 'c-crit'}">${d12 >= 0 ? '+' : '−'}${eur0(Math.abs(d12))} in 12 mesi</span>` : ''}</div>
      ${heroChart(
        hv,
        h12.map(m => MESI[+m.slice(5) - 1]),
        '#22D3EE'
      )}
    </div>
    <div class="card"><div class="card-h"><div><h3>Da cosa è fatto</h3><div class="hint">Attività ${eur0(att)} · debiti ${eur0(deb)}</div></div></div>
      ${att ? `<div class="compbar">${parts.map(p => `<i data-tip="${p[0]}: ${eur(p[1])} (${Math.round((p[1] / att) * 100)}%)" style="flex:${p[1]};background:${p[2]}"></i>`).join('')}</div>` : ''}
      <div class="list">
        ${srow('bank', '#60A5FA', 'Conti', accs.length === 1 ? '1 conto' : accs.length + ' conti', liq)}
        ${cd ? srow('card', '#818CF8', 'Carta di credito', 'Da addebitare', -cd) : ''}
        ${srow('trend', '#34D399', 'Investimenti', pos === 1 ? '1 posizione' : pos + ' posizioni', inv, 'investimenti')}
        ${srow('house', '#A78BFA', 'Beni', A.length === 1 ? '1 bene' : A.length + ' beni', ben)}
        ${D.length ? srow('doc', '#F472B6', 'Debiti residui', D.length === 1 ? '1 finanziamento' : D.length + ' finanziamenti', -debtsVal()) : ''}
      </div>
    </div>
  </div>
  <div class="grid g2" style="margin-top:14px">
    <div class="card"><div class="card-h"><div><h3>Beni</h3><div class="hint">Auto, casa e altri beni di valore</div></div><button class="btn sm pri" data-act="asset-new">+ Bene</button></div>
      <div class="list">${
        A.length
          ? A.map(a => {
              const v = assetValue(a),
                dl = (DEADLINES[a.kind] || [])
                  .map(([k, l]) => (a.deadlines && a.deadlines[k] ? { k, l, d: a.deadlines[k] } : null))
                  .filter(Boolean)
                  .sort((x, y) => (x.d < y.d ? -1 : 1))[0];
              const loan = D.find(d => d.assetId === a.id);
              return `<div class="row" data-act="asset-edit" data-id="${a.id}">${tile(...AKIND[a.kind][0])}<div class="main"><div class="t1">${esc(a.name)} ${a.est ? `<span class="chip ${a.est.confidence === 'alta' ? 'c-good' : a.est.confidence === 'media' ? 'c-info' : 'c-warn'}">stima ${esc(a.est.confidence)}</span>` : '<span class="chip c-mut">manuale</span>'}</div>
        <div class="t2">${a.est ? `forchetta ${eur0(a.est.low)}–${eur0(a.est.high)} · ${fmtTime(a.valueAt)}` : 'valore inserito a mano'}${a.kind === 'auto' && a.deprec ? ` · −${String(a.deprec).replace('.', DEC)}%/anno` : ''}</div>
        ${dl ? `<div class="t2">${daysTo(dl.d) <= 30 ? '<span class="chip c-warn">!</span> ' : ''}${esc(dl.l)}: ${dLabel(dl.d)}</div>` : ''}${loan ? `<div class="t2">Netto del debito: ${eur0(v - loanResidual(loan))}</div>` : ''}</div><div class="amt num">${eur0(v)}</div></div>`;
            }).join('')
          : '<div class="empty">Aggiungi la tua auto o la casa per avere il patrimonio completo</div>'
      }</div></div>
    <div class="card"><div class="card-h"><div><h3>Debiti</h3><div class="hint">Mutui e prestiti: il residuo si aggiorna da solo ogni mese</div></div><button class="btn sm pri" data-act="debt-new">+ Debito</button></div>
      <div class="list">${
        D.length
          ? D.map(d => {
              const res = loanResidual(d),
                paid = d.principal ? 1 - res / d.principal : 0,
                P = +d.payment || loanPayment(+d.principal, +d.rate, +d.months);
              return `<div class="row" data-act="debt-edit" data-id="${d.id}">${tile(...DKIND[d.kind][0])}<div class="main"><div class="t1">${esc(d.name)}</div><div class="t2">Rata ${eur(P)} · ${String(d.rate).replace('.', DEC)}% · fine ${dLabel(loanEnd(d))}</div><div class="bar" style="margin-top:6px"><i style="width:${Math.min(100, paid * 100)}%;background:var(--good)"></i></div><div class="t2">${Math.round(paid * 100)}% rimborsato · ${monthsPaid(d.start)}/${d.months} rate</div></div><div class="amt num down">${eur0(res)}</div></div>`;
            }).join('')
          : '<div class="empty">Nessun debito</div>'
      }</div></div>
  </div>`;
}
/* ---- asset form ---- */
const AFIELDS = {
  auto: [
    ['marca', 'Marca', 'es. Volkswagen'],
    ['modello', 'Modello', 'es. Golf'],
    ['versione', 'Versione/motore', 'es. 1.5 TSI Life'],
    ['anno', 'Anno immatricolazione', '2019'],
    ['km', 'Chilometri', '85000'],
    ['alimentazione', 'Alimentazione', 'benzina, diesel, ibrida…'],
    ['cambio', 'Cambio', 'manuale/automatico'],
    ['condizioni', 'Condizioni', 'ottime, buone, da sistemare']
  ],
  casa: [
    ['comune', 'Comune', 'es. Milano'],
    ['zona', 'Zona o quartiere (no indirizzo)', 'es. Città Studi'],
    ['cap', 'CAP', '20133'],
    ['mq', 'Superficie m²', '85'],
    ['tipologia', 'Tipologia', 'appartamento, villetta…'],
    ['piano', 'Piano', '3'],
    ['ascensore', 'Ascensore', 'sì/no'],
    ['stato', 'Stato', 'ristrutturato, buono, da ristrutturare'],
    ['anno_costruzione', 'Anno costruzione', '1970'],
    ['classe_energetica', 'Classe energetica', 'E'],
    ['box', 'Box/posto auto', 'sì/no']
  ],
  altro: [
    ['categoria', 'Categoria', 'orologio, bici, arte…'],
    ['descrizione', 'Descrizione', 'marca, modello, dettagli'],
    ['anno', 'Anno', '2021'],
    ['condizioni', 'Condizioni', 'come nuovo, buone…']
  ]
};
let lastEst = null;
function assetForm(a, kind) {
  const isNew = !a;
  kind = a ? a.kind : kind;
  a = a || { kind, name: '', value: '', details: {}, deadlines: {}, purchasePrice: '', purchaseDate: '' };
  lastEst = null;
  const f = v => (v === '' || v == null ? '' : String(v).replace('.', DEC));
  const d = a.details || {},
    dl = a.deadlines || {};
  const fields = [
    {
      k: 'name',
      label: 'Nome',
      v: a.name,
      ph: kind === 'auto' ? 'es. Golf di casa' : kind === 'casa' ? 'es. Casa Milano' : 'es. Rolex'
    },
    ...AFIELDS[kind].map(([k, l, ph]) => ({ k: 'd_' + k, label: l, v: d[k] || '', ph })),
    {
      k: 'value',
      label: 'Valore attuale (€)',
      type: 'number',
      v: f(a.value),
      ph: 'scrivilo tu o usa la stima AI'
    },
    {
      k: 'purchasePrice',
      label: "Prezzo d'acquisto (€, facoltativo)",
      type: 'number',
      v: f(a.purchasePrice)
    },
    { k: 'purchaseDate', label: "Data d'acquisto", type: 'date', v: a.purchaseDate || '' },
    ...(DEADLINES[kind] || []).map(([k, l]) => ({
      k: 'dl_' + k,
      label: 'Scadenza ' + l.toLowerCase(),
      type: 'date',
      v: dl[k] || ''
    }))
  ];
  const est = a.est ? estHTML(a.est, false) : '';
  const ai = perm('assets')
    ? `<button type="button" class="btn" data-act="asset-estimate" data-kind="${kind}" style="width:100%;justify-content:center">Stima il valore con AI${STATUS && STATUS.ai_web ? ' (cerca annunci reali)' : ''}</button><p class="hint" style="margin:6px 0 0;line-height:1.5">Invia solo le caratteristiche qui sopra${kind === 'casa' ? " (comune, zona, m²: mai l'indirizzo)" : ''}. Nessun dato dei conti.</p>`
    : AI
      ? '<p class="hint">Stima AI spenta in Impostazioni → Privacy.</p>'
      : '';
  openForm(
    isNew ? 'Nuovo bene · ' + AKIND[kind][1] : esc(a.name),
    fields,
    dd => {
      if (!dd.name.trim()) return toast('Inserisci un nome');
      const details = {},
        deadlines = {};
      for (const [k] of AFIELDS[kind]) if (dd['d_' + k]) details[k] = dd['d_' + k].trim();
      for (const [k] of DEADLINES[kind] || []) if (dd['dl_' + k]) deadlines[k] = dd['dl_' + k];
      const value = num(dd.value);
      if (!(value > 0)) return toast('Inserisci un valore o usa la stima AI');
      const o = {
        kind,
        name: dd.name.trim(),
        details,
        deadlines,
        purchasePrice: num(dd.purchasePrice) || null,
        purchaseDate: dd.purchaseDate || null
      };
      const x = isNew
        ? { id: uid(), ...o }
        : Object.assign(
            S.assets.find(z => z.id === a.id),
            o
          );
      if (lastEst && Math.round(value) === lastEst.mid) {
        x.value = lastEst.mid;
        x.valueAt = lastEst.at;
        x.est = lastEst;
        x.deprec = lastEst.deprec || 0;
        x.valueSrc = 'ai';
      } else if (isNew || Math.round(value) !== assetValue(x)) {
        x.value = value;
        x.valueAt = Date.now();
        x.valueSrc = 'manuale';
        if (!lastEst) {
          x.est = null;
          x.deprec = kind === 'auto' && x.deprec ? x.deprec : 0;
        }
      }
      if (isNew) S.assets.push(x);
      save();
      render();
      toast('Salvato');
    },
    isNew
      ? null
      : () => {
          S.assets = S.assets.filter(z => z.id !== a.id);
          S.debts.forEach(z => {
            if (z.assetId === a.id) z.assetId = null;
          });
          save();
          render();
        },
    `${ai}<div id="estbox" style="margin-top:10px">${est}</div>`
  );
}
function estHTML(e, fresh) {
  return `<div class="bcard"><div class="k"><span>${fresh ? 'Nuova stima' : 'Ultima stima'} · ${fmtTime(e.at)}</span><span class="chip ${e.confidence === 'alta' ? 'c-good' : e.confidence === 'media' ? 'c-info' : 'c-warn'}">affidabilità ${esc(e.confidence)}</span></div>
   <div class="v num">${eur0(e.mid)} <small>forchetta ${eur0(e.low)} – ${eur0(e.high)}</small></div>
   ${e.perMq ? `<div class="t2 hint">${eur0(e.perMq.low)} – ${eur0(e.perMq.high)} al m²</div>` : ''}${e.deprec ? `<div class="hint">Deprezzamento stimato: ${String(e.deprec).replace('.', DEC)}% all'anno (applicato in automatico)</div>` : ''}
   <p class="hint" style="line-height:1.5;margin-top:6px">${esc(e.basis)}</p>
   ${e.comparables && e.comparables.length ? `<div class="hint" style="margin-top:6px"><b style="color:var(--tx2)">Confronti</b>${e.comparables.map(c => `<div>· ${esc(c.desc)} — ${eur0(c.price)}</div>`).join('')}</div>` : ''}
   ${e.sources && e.sources.length ? `<div class="hint" style="margin-top:6px"><b style="color:var(--tx2)">Fonti consultate</b>${e.sources.map(s => `<div>· <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" style="color:#8fb0ff">${esc(s.title)}</a></div>`).join('')}</div>` : e.web === false ? '<div class="hint" style="margin-top:6px">Stima senza ricerca web: indicativa.</div>' : ''}
   ${fresh ? `<button type="button" class="btn pri" data-act="asset-use-est" style="width:100%;justify-content:center;margin-top:10px">Usa ${eur0(e.mid)} come valore</button>` : ''}</div>`;
}
async function runEstimate(kind) {
  const fd = Object.fromEntries(new FormData($('#frm')).entries());
  const fields = {};
  for (const [k] of AFIELDS[kind]) if (fd['d_' + k]) fields[k] = fd['d_' + k];
  const box = $('#estbox');
  box.innerHTML =
    '<div class="hint">Sto stimando… ' +
    (STATUS && STATUS.ai_web ? '(cerco annunci e prezzi reali, può richiedere 30–60 secondi)' : '') +
    '</div>';
  logAI(
    'Stima ' + AKIND[kind][1].toLowerCase(),
    Object.entries(fields)
      .map(([k, v]) => k + ': ' + v)
      .join(' · ')
  );
  try {
    const e = await api('POST', '/api/ai/estimate-asset', { kind, fields });
    lastEst = e;
    box.innerHTML = estHTML(e, true);
  } catch (e) {
    box.innerHTML = `<div class="hint" style="color:#ff7b7b">${esc(e.message)}</div>`;
  }
}
/* ---- debt form ---- */
function debtForm(dbt) {
  const isNew = !dbt;
  dbt = dbt || {
    name: '',
    kind: 'mutuo',
    principal: '',
    rate: '',
    months: '',
    start: today(),
    payment: '',
    assetId: ''
  };
  const f = v => (v === '' || v == null ? '' : String(v).replace('.', DEC));
  openForm(
    isNew ? 'Nuovo debito' : esc(dbt.name),
    [
      { k: 'name', label: 'Nome', v: dbt.name, ph: 'es. Mutuo casa' },
      {
        k: 'kind',
        label: 'Tipo',
        type: 'select',
        v: dbt.kind,
        options: Object.entries(DKIND).map(([k, v]) => [k, v[1]])
      },
      { k: 'principal', label: 'Importo finanziato (€)', type: 'number', v: f(dbt.principal) },
      { k: 'rate', label: 'Tasso annuo TAN (%)', type: 'number', v: f(dbt.rate), ph: 'es. 3,2' },
      { k: 'months', label: 'Durata in mesi', type: 'number', v: dbt.months, ph: 'es. 300 = 25 anni' },
      { k: 'start', label: 'Data prima erogazione', type: 'date', v: dbt.start },
      { k: 'payment', label: 'Rata mensile (€, vuoto = calcolata)', type: 'number', v: f(dbt.payment) },
      {
        k: 'assetId',
        label: 'Collegato a un bene (facoltativo)',
        type: 'select',
        v: dbt.assetId || '',
        options: [['', '—'], ...(S.assets || []).map(a => [a.id, a.name])]
      },
      ...(isNew
        ? [
            {
              k: 'rec',
              label: 'Rata nei costi ricorrenti',
              type: 'select',
              v: '1',
              options: [
                ['1', 'Sì, aggiungila (registrata ogni mese)'],
                ['0', 'No']
              ]
            }
          ]
        : [])
    ],
    d => {
      const o = {
        name: d.name.trim() || DKIND[d.kind][1],
        kind: d.kind,
        principal: num(d.principal),
        rate: num(d.rate),
        months: Math.round(num(d.months)),
        start: d.start || today(),
        payment: num(d.payment) || null,
        assetId: d.assetId || null
      };
      if (!(o.principal > 0 && o.months > 0)) return toast('Servono importo e durata');
      const P = o.payment || loanPayment(o.principal, o.rate, o.months);
      if (isNew) {
        const x = { id: uid(), ...o };
        S.debts.push(x);
        if (d.rec === '1') {
          const s = pd(o.start),
            nx = ds(new Date(s.getFullYear(), s.getMonth() + 1, s.getDate()));
          let next = nx;
          while (next < today()) next = addPeriod(next, 'mensile', s.getDate());
          const r = {
            id: uid(),
            name: 'Rata ' + o.name,
            amount: Math.round(P * 100) / 100,
            cat: o.kind === 'mutuo' ? 'Casa' : o.kind === 'auto' ? 'Trasporti' : 'Altro',
            accountId: S.accounts[0].id,
            freq: 'mensile',
            type: 'out',
            auto: true,
            next,
            anchor: s.getDate()
          };
          S.recurring.push(r);
          x.recId = r.id;
        }
      } else
        Object.assign(
          S.debts.find(z => z.id === dbt.id),
          o
        );
      save();
      render();
      toast(`Salvato · rata ${eur(P)}`);
    },
    isNew
      ? null
      : () => {
          S.debts = S.debts.filter(z => z.id !== dbt.id);
          save();
          render();
        },
    isNew
      ? ''
      : `<div class="bcard"><div class="k"><span>Situazione oggi</span></div><div class="v num">${eur(loanResidual(dbt))} <small>residuo</small></div><div class="f"><span>${monthsPaid(dbt.start)} rate pagate su ${dbt.months}</span><span>fine ${dLabel(loanEnd(dbt))}</span></div></div>`
  );
}
function kindPicker() {
  openForm(
    'Che bene vuoi aggiungere?',
    [],
    () => {},
    null,
    `<div class="list">${Object.entries(AKIND)
      .map(
        ([k, v]) =>
          `<div class="row" data-act="asset-kind" data-k="${k}">${tile(...v[0])}<div class="main"><div class="t1">${v[1]}</div><div class="t2">${k === 'auto' ? 'stima dal modello, deprezzamento, bollo e revisione' : k === 'casa' ? 'stima dalla zona e dai m², IMU e assicurazione' : 'orologi, bici, strumenti, arte…'}</div></div></div>`
      )
      .join('')}</div>`
  );
  document.querySelector('#frm .btns').style.display = 'none';
}

/* ---------- FIRE: Monte Carlo simulation (runs on the device) ---------- */
const EN = window.POC_ENGINE;
const DEF_CLS = {
  ETF: 'azioni',
  Azioni: 'azioni',
  Obbligazioni: 'obbligazioni',
  Crypto: 'crypto',
  Fondi: 'azioni',
  Altro: 'azioni'
};
const DEF_TAX = {
  ETF: 'etf',
  Fondi: 'etf',
  Azioni: 'azioni',
  Obbligazioni: 'azioni',
  Crypto: 'crypto',
  Altro: 'azioni'
};
let fireRes = null,
  fireBusy = false;
