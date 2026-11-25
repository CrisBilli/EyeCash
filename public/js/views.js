/*
 * EyeCash · public/js/views.js
 *
 * Main screens: Home, Transactions, Investments overview, Recurring,
 * Goals, Statistics and the printable report, plus `render()` / `go()` which
 * decide what is on screen.
 */
/* ---------- views ---------- */
function statusChip(used, limit) {
  const r = used / limit;
  if (r > 1) return '<span class="chip c-crit">✕ Sforato</span>';
  if (r >= 0.8) return '<span class="chip c-warn">! Attenzione</span>';
  return '<span class="chip c-good">✓ In linea</span>';
}
function txRow(t) {
  const pos = t.amount > 0 && !isNeutral(t.cat);
  return `<div class="row" data-act="edit-tx" data-id="${t.id}">${catAv(t.cat)}<div class="main"><div class="t1">${esc(t.note || t.cat)}</div><div class="t2">${esc(t.cat)} · ${esc(accName(t.accountId))}${t.recId ? ' · <span style="color:#8fb0ff">auto</span>' : ''}${t.src === 'claude' ? ' · <span style="color:#c4b5fd">da Claude</span>' : ''}</div></div><div class="amt num ${pos ? 'up' : isNeutral(t.cat) ? '' : 'down'}" ${isNeutral(t.cat) ? 'style="color:var(--mut)"' : ''}>${pos ? '+' : ''}${eur(t.amount)}</div></div>`;
}

const mLow = k => (LANG === 'it' ? ymLabel(k).toLowerCase() : ymLabel(k));
/** Home screen. */
function vHome() {
  const k = today().slice(0, 7),
    prev = lastMonths(2)[0];
  const cur = monthTot(k),
    pr = monthTot(prev);
  const iv = invVal(),
    ic = invCost(),
    net = cash() + iv + assetsVal() - debtsVal() - cardDebt();
  const incD = pr.inc ? (cur.inc - pr.inc) / pr.inc : 0;
  const spentPct = cur.inc ? cur.out / cur.inc : pr.out ? cur.out / pr.out : 0;
  const cs = catSpend(k);
  const cats = Object.entries(cs).sort((a, b) => b[1] - a[1]);
  const up = S.recurring
    .filter(r => daysTo(r.next) <= 30)
    .sort((a, b) => (a.next < b.next ? -1 : 1))
    .slice(0, 5);
  const recent = [...S.tx].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 6);
  const bud = Object.entries(S.budgets).filter(([, v]) => v > 0);
  const nets = lastMonths(6).map(netAt);
  const netD = nets[0] ? (net - nets[0]) / Math.abs(nets[0]) : 0;
  const dOut = daily(k, -1),
    dT = +today().slice(8) - 1;
  const sav = savingsBars(12);
  const pm = monthInText(MESIL[+prev.slice(5) - 1]);
  const cnt = {};
  for (const t of S.tx)
    if (ym(t.date) === k && t.amount < 0 && !isNeutral(t.cat)) cnt[t.cat] = (cnt[t.cat] || 0) + 1;
  let ov = cats.map(([c, v]) => ({ c, v, col: catCol(c) }));
  if (ov.length > 6) {
    const o = ov.slice(5).reduce((s, x) => s + x.v, 0);
    ov = [...ov.slice(0, 5), { c: 'Altro', v: o, col: catCol('Altro'), rest: true }];
  }
  const ff = funFact(),
    h12 = lastMonths(12),
    hv = h12.map(netAt);
  hv[hv.length - 1] = net;
  const avg3 =
      lastMonths(4)
        .slice(0, 3)
        .reduce((s, m) => s + monthTot(m).out, 0) / 3,
    news = orbNews();
  const ring = `<div class="card ringcard">
    <div class="card-h"><div><h3>Spese di ${mLow(k)}</h3><div class="hint">Tocca una categoria per i movimenti</div></div></div>
    ${
      ov.length
        ? `<div class="ringwrap">${spendRing(ov, cur.out)}<div class="ringmid"><div class="lbl">Uscite del mese</div><div class="big num">${eur0(cur.out)}</div>${avg3 ? `<span class="chip ${cur.out > avg3 ? 'c-crit' : 'c-good'}">${Math.round((cur.out / avg3) * 100)}% della media</span>` : ''}</div></div>
    <div class="list catlist">${ov.map(x => `<div class="row" ${x.rest ? 'style="cursor:default"' : `data-act="cat-tx" data-c="${esc(x.c)}"`}>${catAv(x.c)}<div class="main"><div class="t1">${esc(x.rest ? 'Altre categorie' : x.c)}${x.rest ? '' : ` <span class="cnt">${cnt[x.c]}</span>`}</div><div class="cbar"><i style="width:${Math.max(2, Math.round((x.v / ov[0].v) * 100))}%;background:${x.col}"></i></div></div><div class="amt"><div class="num">${eur(x.v)}</div><div class="t2">${Math.round((x.v / cur.out) * 100)}%</div></div></div>`).join('')}</div>`
        : '<div class="empty">Nessuna spesa questo mese</div>'
    }</div>`;
  return `
  <div class="grid g21 homegrid">
    ${ring}
    <div class="grid" style="gap:14px;align-content:start">
      ${news.length ? `<button class="orbcard" data-act="orb">${orbHTML()}<span class="main"><b>${esc(news[0].t)}</b><span>${esc(news[0].d)}${news.length > 1 ? ' · ' + t('altri {n}', { n: news.length - 1 }) : ''}</span></span>${svgI('chev')}</button>` : ''}
    <div class="card kpi sens hero"><div class="lbl">Patrimonio netto</div><div class="val num" data-to="${net}">${eur(net)}</div><div class="foot">${nets[0] ? `<span class="chip ${netD >= 0 ? 'c-good' : 'c-crit'}">${netD >= 0 ? '▲' : '▼'} ${pct(netD)}</span> in 6 mesi` : 'Liquidità ' + eur0(cash()) + ' · Investimenti ' + eur0(iv)}</div>${heroChart(
      hv,
      h12.map(x => MESI[+x.slice(5) - 1])
    )}</div>
      <div class="grid g2k">
        <div class="card kpi"><div class="lbl">${catIc('Stipendio')}Entrate del mese</div><div class="val num up">${eur(cur.inc)}</div><div class="foot">${cur.inc ? `<span class="${incD >= 0 ? 'up' : 'down'}">${pct(incD)}</span> vs ${pm}` : `Nessuna entrata ancora · ${pm}: ${eur0(pr.inc)}`}</div></div>
        <div class="card kpi"><div class="lbl">${catIc('Shopping')}Uscite del mese</div><div class="val num">${eur(cur.out)}</div><div class="foot">${cur.inc ? Math.round(spentPct * 100) + '% delle entrate spese' : pr.out ? Math.round((cur.out / pr.out) * 100) + '% di quanto speso a ' + pm : '—'}</div><div class="spk">${sparkBars(dOut, 'var(--s-orange)', 30, dT)}</div></div>
      </div>
    </div>
  </div>
  <div class="grid g21" style="margin-top:14px">
    <div class="card"><div class="card-h"><div><h3>Giorno per giorno</h3><div class="hint">Uscite di ${mLow(k)} · la linea è la media al giorno</div></div><div class="legend"><span class="num">${eur0(cur.out / Math.max(dT + 1, 1))}/giorno</span></div></div>${dayBars(dOut, { today: dT })}</div>
    <div class="grid" style="gap:14px;align-content:start">
      <div class="card kpi sens"><div class="lbl">${catIc('Investimenti')}Rendimento investimenti</div><div class="val num ${!ic ? '' : iv - ic >= 0 ? 'up' : 'down'}">${!ic ? '—' : (iv - ic >= 0 ? '+' : '') + eur(iv - ic)}</div><div class="foot">${ic ? pct((iv - ic) / ic) : '—'} su ${eur0(ic)} investiti</div></div>
      ${ff ? `<div class="card"><div class="fact"><div class="ill pop">${ff.ill}</div><div><div class="k">Lo sapevi?</div><b>${esc(ff.t)}</b><div class="hint" style="font-size:13px;line-height:1.45">${esc(ff.d)}</div></div></div></div>` : ''}
    </div>
  </div>
  <div class="grid g2" style="margin-top:14px">
    ${budgetCard(cs, k)}
    <div class="card"><div class="card-h"><div><h3>Calendario spese</h3><div class="hint">Ogni quadratino è un giorno · più scuro = più speso</div></div></div>${heatmap()}</div>
  </div>
  ${(() => {
    const fc = forecastEnd(),
      ins = insights();
    return `<div class="grid g2" style="margin-top:14px">
    <div class="card sens"><div class="card-h"><div><h3>Previsione a fine mese</h3><div class="hint">Liquidità stimata il ${dLabel(ds(new Date(+k.slice(0, 4), +k.slice(5), 0)))} · calcolata in locale</div></div></div>
      <div class="kpi"><div class="val num ${fc.end < 0 ? 'down' : ''}" style="margin-top:0">${eur0(fc.end)}</div></div>
      <div class="hbar" style="grid-template-columns:1fr auto"><span class="nm">Oggi</span><span class="num">${eur0(fc.now)}</span></div>
      ${fc.salary ? `<div class="hbar" style="grid-template-columns:1fr auto"><span class="nm">+ Stipendio atteso (media)</span><span class="num up">+${eur0(fc.salary)}</span></div>` : ''}
      ${fc.recIn ? `<div class="hbar" style="grid-template-columns:1fr auto"><span class="nm">+ Entrate ricorrenti</span><span class="num up">+${eur0(fc.recIn)}</span></div>` : ''}
      <div class="hbar" style="grid-template-columns:1fr auto"><span class="nm">− Costi fissi in scadenza</span><span class="num">−${eur0(fc.recOut)}</span></div>
      <div class="hbar" style="grid-template-columns:1fr auto"><span class="nm">− Spese variabili (${eur0(fc.daily)}/giorno × ${fc.dLeft} gg)</span><span class="num">−${eur0(fc.variable)}</span></div></div>
    <div class="card"><div class="card-h"><div><h3>Spunti</h3><div class="hint">Analisi automatiche · nessun dato esce dal server</div></div></div>
      <div class="list">${ins.length ? ins.map(i => `<div class="row" style="cursor:default">${tile(...i.ic)}<div class="main"><div class="t1" style="white-space:normal">${esc(i.t)}</div><div class="t2" style="white-space:normal">${esc(i.d)}</div></div></div>`).join('') : '<div class="empty">Servono un paio di mesi di dati</div>'}</div></div>
  </div>`;
  })()}
  <div class="grid g2" style="margin-top:14px">
    <div class="card"><div class="card-h"><div><h3>Spesa del mese</h3><div class="hint">Cumulata giorno per giorno · ${ymLabel(k)}</div></div><div class="legend"><span><i style="background:var(--s-orange)"></i>Questo mese</span><span><i style="background:none;border-top:2px dashed var(--mut);border-radius:0;height:0;width:12px"></i>${MESIL[+prev.slice(5) - 1]}</span></div></div>${monthArea()}</div>
    <div class="card"><div class="card-h"><div><h3>Risparmio mensile</h3><div class="hint">Entrate meno uscite · ultimi 12 mesi</div></div><div class="legend"><span><i style="background:var(--tx)"></i>Migliore ${sav.best ? MESI[+sav.best.k.slice(5) - 1] : ''}</span><span><i style="background:var(--crit)"></i>Peggiore ${sav.worst ? MESI[+sav.worst.k.slice(5) - 1] : ''}</span></div></div>${sav.svg}</div>
  </div>
  <div class="card" style="margin-top:14px"><div class="card-h"><div><h3>Budget per categoria</h3><div class="hint">Limiti per categoria · modificali in Impostazioni</div></div><button class="btn sm" data-act="go" data-v="impostazioni">Gestisci</button></div>
    ${
      bud.length
        ? `<div class="board">${bud
            .map(([c, lim]) => {
              const u = cs[c] || 0;
              const r = u / lim;
              return `<div class="bcard"><div class="k"><span>${catIc(c)} ${esc(c)}</span>${statusChip(u, lim)}</div><div class="v num">${eur(u)} <small>/ ${eur0(lim)}</small></div><div class="bar"><i style="width:${Math.min(100, r * 100)}%;background:${r > 1 ? 'var(--crit)' : r >= 0.8 ? 'var(--warn)' : 'var(--accent)'}"></i></div><div class="f"><span>${r > 1 ? 'Oltre di ' + eur0(u - lim) : 'Restano ' + eur0(lim - u)}</span><span>${Math.round(r * 100)}%</span></div></div>`;
            })
            .join('')}</div>`
        : '<div class="empty">Nessun budget impostato</div>'
    }
  </div>
  <div class="grid g3" style="margin-top:14px">
    <div class="card"><div class="card-h"><div><h3>In arrivo</h3><div class="hint">Addebiti automatici nei prossimi 30 giorni</div></div></div>
      <div class="list">${upcomingDeadlines(30)
        .map(
          x =>
            `<div class="row" data-act="asset-edit" data-id="${x.a.id}">${tile('clock', '#FB7185')}<div class="main"><div class="t1">${esc(x.label)} · ${esc(x.a.name)}</div><div class="t2">${dLabel(x.date)} · ${daysTo(x.date) <= 0 ? 'oggi o scaduta' : 'tra ' + daysTo(x.date) + ' gg'}</div></div></div>`
        )
        .join(
          ''
        )}${up.length || upcomingDeadlines(30).length ? up.map(r => `<div class="row" data-act="go" data-v="ricorrenti">${catAv(r.cat)}<div class="main"><div class="t1">${esc(r.name)}</div><div class="t2">${dLabel(r.next)} · ${daysTo(r.next) === 0 ? 'oggi' : 'tra ' + daysTo(r.next) + ' gg'}</div></div><div class="amt num">${eur(r.amount)}</div></div>`).join('') : '<div class="empty">Niente in scadenza</div>'}</div></div>
    <div class="card sens"><div class="card-h"><div><h3>Conti</h3><div class="hint">Liquidità <span class="num">${eur(cash())}</span>${cardDebt() ? ` · carte da addebitare <span class="num">${eur(cardDebt())}</span>` : ''}</div></div></div>
      <div class="list">${S.accounts
        .map(a => {
          const b = accBal(a);
          return `<div class="row" data-act="edit-acc" data-id="${a.id}">${accAv(a)}<div class="main"><div class="t1">${esc(a.name)}</div><div class="t2">${isCard(a) && b < 0 ? 'Da addebitare' + (cardDue(a) ? ' il ' + dLabel(cardDue(a)) : '') + ' · non conta nella liquidità' : esc(a.type)}</div></div><div class="amt num ${b < 0 ? 'down' : ''}">${eur(b)}</div></div>`;
        })
        .join('')}</div></div>
    <div class="card"><div class="card-h"><div><h3>Ultimi movimenti</h3></div><button class="btn sm" data-act="go" data-v="movimenti">Tutti</button></div>
      <div class="list">${recent.length ? recent.map(txRow).join('') : '<div class="empty">Nessun movimento</div>'}</div></div>
  </div>`;
}

let fQ = '',
  fM = '',
  fC = '';
function filteredTx() {
  const q = fQ.toLowerCase();
  return S.tx
    .filter(
      t =>
        (!fM || ym(t.date) === fM) &&
        (!fC || t.cat === fC) &&
        (!q || (t.note || '').toLowerCase().includes(q) || t.cat.toLowerCase().includes(q))
    )
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
/** Summary on top of the transactions list: totals and spending per day of the chosen month. */
function txSumHTML() {
  const k = fM || today().slice(0, 7),
    arr = filteredTx().filter(t => ym(t.date) === k && !isNeutral(t.cat));
  const out = arr.reduce((s, t) => s + (t.amount < 0 ? -t.amount : 0), 0),
    inc = arr.reduce((s, t) => s + (t.amount > 0 ? t.amount : 0), 0);
  const d = Array(daysIn(k)).fill(0);
  for (const t of arr) if (t.amount < 0) d[+t.date.slice(8) - 1] -= t.amount;
  const isCur = k === today().slice(0, 7);
  return `<div class="txsum-h"><div><div class="lbl">Uscite · ${ymLabel(k)}${fC ? ' · ' + esc(fC) : ''}</div><div class="big num">${eur(out)}</div></div><div class="txin"><div class="lbl">Entrate</div><div class="num up">+${eur0(inc)}</div></div></div>${dayBars(d, { today: isCur ? +today().slice(8) - 1 : -1, h: 96, c1: '#60A5FA', c2: '#2563EB' })}`;
}
function txRefresh() {
  $('#txlist').innerHTML = txListHTML();
  const s = $('#txsum');
  if (s) s.innerHTML = txSumHTML();
}
function txListHTML() {
  const arr = filteredTx();
  if (!arr.length) return '<div class="empty">Nessun movimento trovato</div>';
  let inc = 0,
    out = 0,
    neu = 0;
  arr.forEach(t => (isNeutral(t.cat) ? neu++ : t.amount > 0 ? (inc += t.amount) : (out -= t.amount)));
  let h = `<div class="hint" style="padding:0 4px 6px">${arr.length} movimenti · <span class="up">+${eur(inc)}</span> · <span>−${eur(out)}</span>${neu ? ` · ${neu} giroconti/investimenti esclusi dai totali` : ''}</div>`,
    last = '';
  const dayTot = {};
  for (const t of arr) if (!isNeutral(t.cat)) dayTot[t.date] = (dayTot[t.date] || 0) + t.amount;
  const yd = ds(new Date(Date.now() - 864e5));
  for (const t of arr.slice(0, 400)) {
    if (t.date !== last) {
      const v = dayTot[t.date] || 0;
      h += `<div class="dhead">${t.date === today() ? 'Oggi' : t.date === yd ? 'Ieri' : dLabel(t.date)}<span class="num ${v > 0 ? 'up' : ''}">${v ? (v > 0 ? '+' : '') + eur(v) : ''}</span></div>`;
      last = t.date;
    }
    h += txRow(t);
  }
  return h;
}
/** Transactions screen (grouped by day, with filters). */
function vTx() {
  const months = [...new Set(S.tx.map(t => ym(t.date)))].sort().reverse();
  return `<div class="card txsum" id="txsum">${txSumHTML()}</div>
  <div class="tools">
    <input class="inp" id="q" placeholder="Cerca movimenti…" value="${esc(fQ)}" style="flex:1;min-width:160px">
    <select class="inp" id="fm"><option value="">Tutti i mesi</option>${months.map(m => `<option value="${m}" ${m === fM ? 'selected' : ''}>${ymLabel(m)}</option>`).join('')}</select>
    <select class="inp" id="fc"><option value="">Tutte le categorie</option>${ALL_CATS()
      .map(c => `<option ${c === fC ? 'selected' : ''}>${c}</option>`)
      .join('')}</select>
    <label class="btn">${svgI('up')}Importa estratto conto<input type="file" id="csv" accept=".xlsx,.xls,.csv,.txt,.pdf,application/pdf" hidden></label>
    ${perm('categorize') && S.tx.some(t => t.cat === 'Altro' || t.cat === 'Altre entrate') ? '<button class="btn" data-act="ai-cat">Categorizza “Altro” con AI</button>' : ''}
  </div>
  <div class="hint" style="margin:-4px 0 12px">Excel, CSV o PDF della banca: se il formato è nuovo lo interpreta l'AI e lo memorizza. Quando correggi una categoria, l'app crea una regola per i prossimi import.</div>
  <div class="card"><div class="list" id="txlist">${txListHTML()}</div></div>`;
}

const INVCOL = ['#34D399', '#60A5FA', '#FBBF24', '#A78BFA', '#FB7185'];
function vInv() {
  if (invTab === 'hist') return invTabs() + vInvHist();
  if (invTab === 'alloc') return invTabs() + vAlloc();
  if (invTab === 'tax') return invTabs() + vTaxes();
  return invTabs() + vInvPos();
}
function vInvPos() {
  const HS = hsScope(),
    iv = HS.reduce((s, h) => s + h.qty * h.price, 0),
    ic = HS.reduce((s, h) => s + h.qty * h.avg, 0);
  const by = {};
  HS.forEach(h => (by[h.type] = (by[h.type] || 0) + h.qty * h.price));
  let parts = Object.entries(by).sort((a, b) => b[1] - a[1]);
  if (parts.length > 5) {
    const o = parts.slice(4).reduce((s, p) => s + p[1], 0);
    parts = [...parts.slice(0, 4), ['Altro', o]];
  }
  parts = parts.map(([n, v], i) => ({ n, v, c: INVCOL[i] }));
  const tc = Object.fromEntries(parts.map(p => [p.n, p.c]));
  const gain = iv - ic;
  const st = (ic2, c, l, d, v, cls = '') =>
    `<div class="row" style="cursor:default">${tile(ic2, c)}<div class="main"><div class="t1">${l}</div><div class="t2">${d}</div></div><div class="amt num ${cls}">${v}</div></div>`;
  return `<div class="grid g21 sens">
    <div class="card"><div class="card-h"><div><h3>Portafoglio</h3><div class="hint">${HS.length === 1 ? '1 posizione' : HS.length + ' posizioni'} · per tipo di strumento</div></div></div>
      ${
        parts.length
          ? `<div class="ringwrap">${spendRing(
              parts.map(p => ({ c: p.n, v: p.v, col: p.c })),
              iv
            )}<div class="ringmid"><div class="lbl">Valore portafoglio</div><div class="big num">${eur0(iv)}</div><span class="chip ${gain >= 0 ? 'c-good' : 'c-crit'}">${gain >= 0 ? '+' : '−'}${eur0(Math.abs(gain))} · ${ic ? pct(gain / ic) : '—'}</span></div></div>
      <div class="legrows">${parts.map(p => `<div><i style="background:${p.c}"></i><span>${esc(p.n)}</span><b class="num">${Math.round((p.v / iv) * 100)}%</b><span class="num t2">${eur0(p.v)}</span></div>`).join('')}</div>`
          : '<div class="empty">Aggiungi la tua prima posizione</div>'
      }</div>
    <div class="card"><div class="card-h"><div><h3>Rendimento</h3><div class="hint">Rispetto al prezzo medio di carico</div></div></div>
      <div class="list">
        ${st('coin', '#60A5FA', 'Capitale investito', 'Prezzo medio di carico', eur(ic))}
        ${st('trend', '#34D399', 'Valore attuale', S.quotesAt ? 'Prezzi aggiornati ' + fmtTime(S.quotesAt) : 'Prezzi inseriti a mano', eur(iv))}
        ${st(gain >= 0 ? 'up' : 'down', gain >= 0 ? '#4ADE80' : '#FB7185', 'Guadagno / perdita', ic ? pct(gain / ic) : '—', (gain >= 0 ? '+' : '') + eur(gain), gain >= 0 ? 'up' : 'down')}
      </div></div>
  </div>
  <div class="grid g21" style="margin-top:14px">
    <div class="card"><div class="card-h"><div><h3>Posizioni</h3><div class="hint">${S.quotesAt ? 'Prezzi aggiornati ' + fmtTime(S.quotesAt) : 'Tocca una posizione per modificarla'}</div></div><div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">${perm('quotes') ? '<button class="btn sm" data-act="q-refresh">↻ Prezzi</button><button class="btn sm" data-act="q-search">Cerca titolo</button>' : ''}<label class="btn sm">⇪ Importa<input type="file" id="pfcsv" accept=".xlsx,.xls,.csv,.txt" hidden></label><button class="btn sm pri" data-act="add-hold">+ Posizione</button></div></div>
      ${S.holdings.some(h => h.pending) ? `<div class="banner" style="margin:4px 0 10px;background:rgba(250,178,25,.08);border-color:rgba(250,178,25,.35)"><span>${(n => (n === 1 ? '1 prezzo da verificare' : n + ' prezzi da verificare'))(S.holdings.filter(h => h.pending).length)} prima di essere applicato. Tocca la posizione per controllarlo.</span></div>` : ''}
      <div class="list">${
        HS.length
          ? [...HS]
              .sort((a, b) => b.qty * b.price - a.qty * a.price)
              .map(h => {
                const v = h.qty * h.price,
                  c = h.qty * h.avg,
                  pl = c ? (v - c) / c : 0;
                return `<div class="row" data-act="${h.pending || h.qErr ? 'q-review' : 'edit-hold'}" data-id="${h.id}"><div class="av tick" style="--c:${tc[h.type] || tc.Altro || '#94A3B8'}">${esc(h.ticker.slice(0, 4))}</div><div class="main"><div class="t1">${esc(h.name)} ${quoteBadge(h)}</div><div class="t2 num">${String(h.qty).replace('.', DEC)} × ${eur(h.price)}</div><div class="t2">${quoteLine(h)}</div>${invPf == null && pfs().length ? `<div class="t2">📁 ${esc(pfName(h.pf || ''))}</div>` : ''}</div><div style="text-align:right"><div class="amt num">${eur(v)}</div><span class="chip ${pl >= 0 ? 'c-good' : 'c-crit'}" style="margin-top:3px">${pl >= 0 ? '▲' : '▼'} ${pct(pl)}</span></div></div>`;
              })
              .join('')
          : '<div class="empty">Aggiungi la tua prima posizione</div>'
      }</div></div>
    <div class="card"><div class="card-h"><div><h3>Prezzi</h3><div class="hint">Da dove arrivano</div></div></div>
      <div class="hint" style="margin-top:14px;line-height:1.55">${perm('quotes') ? "Prezzi automatici per i titoli collegati: ETF e azioni da Yahoo Finance con controllo su Stooq, crypto da Kraken con controllo su CoinGecko, cambi ufficiali BCE. Si aggiornano all'apertura dell'app (al massimo una volta l'ora) o con ↻ Prezzi." : 'Prezzi inseriti a mano. Le quotazioni automatiche si attivano in Impostazioni → Privacy.'}</div></div>
  </div>`;
}

function detectRecurring() {
  const g = {};
  for (const t of S.tx) {
    if (t.amount >= 0 || t.recId || isNeutral(t.cat)) continue;
    const k = (t.note || '')
      .toLowerCase()
      .replace(/[0-9#/.-]+/g, '')
      .trim();
    if (!k) continue;
    (g[k] = g[k] || []).push(t);
  }
  const out = [];
  for (const k in g) {
    const a = g[k];
    const months = new Set(a.map(t => ym(t.date)));
    if (months.size < 3 || months.size < a.length - 1) continue;
    const am = a.map(t => -t.amount);
    const avg = am.reduce((x, y) => x + y) / am.length;
    if (am.every(x => Math.abs(x - avg) / avg < 0.08) && !S.recurring.some(r => r.name.toLowerCase() === k)) {
      const lastd = a
        .map(t => t.date)
        .sort()
        .pop();
      out.push({
        key: k,
        name: a[0].note,
        amount: r2(avg),
        cat: a[0].cat,
        accountId: a[0].accountId,
        next: addPeriod(lastd, 'mensile')
      });
    }
  }
  return out;
}
function vRec() {
  const m = recMonthly();
  const nx = [...S.recurring].sort((a, b) => (a.next < b.next ? -1 : 1))[0];
  const sug = detectRecurring();
  const FL = {
    settimanale: 'Settimanale',
    mensile: 'Mensile',
    trimestrale: 'Trimestrale',
    annuale: 'Annuale'
  };
  return `<div class="grid g3">
    <div class="card kpi"><div class="lbl">Costi fissi al mese</div><div class="val num">${eur(m)}</div><div class="foot">Media mensile di tutti i ricorrenti</div></div>
    <div class="card kpi"><div class="lbl">All'anno</div><div class="val num">${eur(m * 12)}</div><div class="foot">${S.recurring.length} voci attive</div></div>
    <div class="card kpi"><div class="lbl">Prossimo addebito</div><div class="val" style="font-size:19px">${nx ? esc(nx.name) : '—'}</div><div class="foot">${nx ? eur(nx.amount) + ' · ' + dLabel(nx.next) : ''}</div></div>
  </div>
  ${sug.length ? `<div class="card" style="margin-top:14px;border-color:rgba(59,108,255,.4)"><div class="card-h"><div><h3>Ricorrenti rilevati</h3><div class="hint">Movimenti che si ripetono ogni mese con importo simile</div></div></div><div class="list">${sug.map((s, i) => `<div class="row" style="cursor:default">${catAv(s.cat)}<div class="main"><div class="t1">${esc(s.name)}</div><div class="t2">${esc(s.cat)} · circa ${eur(s.amount)}/mese</div></div><button class="btn sm pri" data-act="adopt-rec" data-i="${i}">Aggiungi</button></div>`).join('')}</div></div>` : ''}
  <div class="card" style="margin-top:14px"><div class="card-h"><div><h3>Costi ricorrenti</h3><div class="hint">Con “Auto” il movimento viene registrato da solo alla scadenza</div></div><button class="btn sm pri" data-act="add-rec">+ Ricorrente</button></div>
    <div class="list">${
      S.recurring.length
        ? [...S.recurring]
            .sort((a, b) => (a.next < b.next ? -1 : 1))
            .map(r => {
              const dt = daysTo(r.next);
              return `<div class="row" data-act="edit-rec" data-id="${r.id}">${catAv(r.cat)}<div class="main"><div class="t1">${esc(r.name)}</div><div class="t2">${FL[r.freq]} · ${esc(r.cat)} · ${dt <= 0 ? 'scade oggi' : 'tra ' + dt + ' gg'} (${dLabel(r.next)})</div></div><div style="text-align:right"><div class="amt num">${r.type === 'in' ? '+' : ''}${eur(r.amount)}</div>${r.auto ? '<span class="chip c-info" style="margin-top:3px">⟳ Auto</span>' : dt <= 0 ? `<button class="btn sm" data-act="post-rec" data-id="${r.id}" style="margin-top:3px">Registra</button>` : '<span class="chip c-mut" style="margin-top:3px">Manuale</span>'}</div></div>`;
            })
            .join('')
        : '<div class="empty">Aggiungi affitto, bollette, abbonamenti…</div>'
    }</div></div>`;
}

function vGoals() {
  const tot = S.goals.reduce((s, g) => s + g.saved, 0),
    tt = S.goals.reduce((s, g) => s + g.target, 0);
  return `<div class="card kpi" style="margin-bottom:14px"><div class="lbl">Risparmiato per gli obiettivi</div><div class="val num">${eur(tot)} <span style="font-size:14px;color:var(--mut);font-weight:400">/ ${eur0(tt)}</span></div><div class="bar"><i style="width:${tt ? (tot / tt) * 100 : 0}%;background:var(--s-aqua)"></i></div></div>
  <div class="tools"><button class="btn pri" data-act="add-goal">+ Nuovo obiettivo</button></div>
  <div class="board" style="grid-template-columns:repeat(auto-fill,minmax(250px,1fr))">${
    S.goals
      .map(g => {
        const r = g.target ? g.saved / g.target : 0;
        const dl = g.deadline ? daysTo(g.deadline) : null;
        const months = dl ? Math.max(1, dl / 30.4) : 0;
        const need = g.target - g.saved;
        return `<div class="bcard" style="padding:16px"><div class="k"><span>Obiettivo</span>${r >= 1 ? '<span class="chip c-good">✓ Raggiunto</span>' : r >= 0.85 ? '<span class="chip c-info">Quasi fatto</span>' : '<span class="chip c-mut">In corso</span>'}</div>
    <div style="font-weight:600;font-size:15px;margin-top:10px">${esc(g.name)}</div><div class="v num">${eur(g.saved)} <small>di ${eur0(g.target)}</small></div>
    <div class="bar"><i style="width:${Math.min(100, r * 100)}%;background:var(--s-aqua)"></i></div>
    <div class="f"><span>${g.deadline ? 'Entro ' + dLabel(g.deadline) : 'Senza scadenza'}</span><span>${Math.round(r * 100)}%</span></div>
    ${need > 0 && months ? `<div class="hint" style="margin-top:8px">Servono ~${eur0(need / months)}/mese</div>` : ''}
    <div style="display:flex;gap:6px;margin-top:12px"><button class="btn sm pri" data-act="fund-goal" data-id="${g.id}">+ Versa</button><button class="btn sm" data-act="edit-goal" data-id="${g.id}">Modifica</button></div></div>`;
      })
      .join('') || '<div class="empty">Nessun obiettivo</div>'
  }</div>`;
}

/* ---------- statistics (all computed locally) ---------- */
let stPer = '12m',
  stCat = '';
function addM(k, n) {
  const [y, m] = k.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return ds(d).slice(0, 7);
}
function mRange(a, b) {
  const r = [];
  for (let k = a; k <= b; k = addM(k, 1)) r.push(k);
  return r;
}
function statPeriod(p) {
  const cur = today().slice(0, 7),
    y = +cur.slice(0, 4),
    last = addM(cur, -1); // only complete months are used
  const first = S.tx.length ? S.tx.reduce((m, t) => (t.date < m ? t.date : m), '9999').slice(0, 7) : cur;
  let a, b, pa, pb, lbl;
  if (p === 'ytd') {
    a = y + '-01';
    b = last < a ? cur : last;
    pa = y - 1 + '-01';
    pb = addM(b, -12);
    lbl = 'Anno ' + y + (b === cur ? '' : ' (mesi chiusi)');
  } else if (p === 'py') {
    a = y - 1 + '-01';
    b = y - 1 + '-12';
    pa = y - 2 + '-01';
    pb = y - 2 + '-12';
    lbl = 'Anno ' + (y - 1);
  } else if (p === 'all') {
    a = first;
    b = first <= last ? last : cur;
    lbl = 'Tutto lo storico (mesi chiusi)';
  } else {
    b = last;
    a = addM(b, -11);
    pb = addM(a, -1);
    pa = addM(pb, -11);
    lbl = 'Ultimi 12 mesi chiusi';
  }
  if (a < first) a = first; // do not divide by months without data
  const prev = pa && pb && pa >= first && pa <= pb ? mRange(pa, pb) : null; // compare only when the previous period is complete
  return { months: a <= b ? mRange(a, b) : [], prev, lbl };
}
function statAgg(months) {
  const set = new Set(months),
    byM = {},
    cat = {},
    catM = {},
    merch = {},
    wd = Array(7).fill(0),
    big = [];
  let inc = 0,
    out = 0;
  for (const k of months) byM[k] = { inc: 0, out: 0 };
  for (const t of S.tx) {
    const k = ym(t.date);
    if (!set.has(k) || isNeutral(t.cat)) continue;
    if (t.amount > 0) {
      inc += t.amount;
      byM[k].inc += t.amount;
      continue;
    }
    const v = -t.amount;
    out += v;
    byM[k].out += v;
    cat[t.cat] = (cat[t.cat] || 0) + v;
    (catM[t.cat] = catM[t.cat] || {})[k] = (catM[t.cat][k] || 0) + v;
    const d = new Date(t.date + 'T12:00:00');
    wd[(d.getDay() + 6) % 7] += v;
    const nm =
      (t.note || t.cat)
        .split(' · ')[0]
        .replace(/^(pagamento|pag\.?|acquisto)\s+/i, '')
        .trim() || t.cat;
    const key = nm.toLowerCase();
    const m = (merch[key] = merch[key] || { n: nm, c: 0, v: 0, cat: t.cat });
    m.c++;
    m.v += v;
    big.push(t);
  }
  big.sort((a, b) => a.amount - b.amount);
  return { inc, out, byM, cat, catM, merch, wd, big: big.slice(0, 10), n: months.length || 1 };
}
const pctTxt = (a, b) => {
  if (!b) return '<span class="hint">—</span>';
  const p = ((a - b) / b) * 100;
  const up = p > 0;
  return `<span class="num ${up ? 'down' : 'up'}">${up ? '▲' : '▼'} ${Math.abs(p).toFixed(0)}%</span>`;
};
function catHeatmap(cats, months, catM) {
  const mx = Math.max(1, ...cats.flatMap(c => months.map(k => (catM[c] || {})[k] || 0)));
  return `<div style="overflow-x:auto"><table class="tbl heat"><thead><tr><th>Categoria</th>${months.map(k => `<th class="r">${MESI[+k.slice(5) - 1]}${k.slice(2, 4) !== today().slice(2, 4) ? " '" + k.slice(2, 4) : ''}</th>`).join('')}</tr></thead><tbody>${cats
    .map(
      c =>
        `<tr><td style="white-space:nowrap">${catIc(c)} ${esc(c)}</td>${months
          .map(k => {
            const v = (catM[c] || {})[k] || 0;
            return `<td class="r num" style="background:${v ? `rgba(255,140,60,${(0.12 + (0.6 * v) / mx).toFixed(2)})` : 'transparent'}" data-tip="${esc(c)} · ${ymLabel(k)}\n${eur(v)}">${v ? kfmt(v) : ''}</td>`;
          })
          .join('')}</tr>`
    )
    .join('')}</tbody></table></div>`;
}
function wdChart(wd, nWeeks) {
  const L = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'],
    vals = wd.map(v => v / Math.max(1, nWeeks));
  const W = 640,
    H = 170,
    pl = 44,
    pr = 6,
    pt = 10,
    pb = 24,
    iw = W - pl - pr,
    ih = H - pt - pb,
    top = niceTop(Math.max(...vals, 10)),
    gw = iw / 7,
    bw = Math.min(40, gw * 0.55);
  let g = axisY(top, pl, pt, ih, W, pr, kfmt);
  const hi = vals.indexOf(Math.max(...vals));
  vals.forEach((v, i) => {
    const h = (ih * v) / top,
      x = pl + gw * i + (gw - bw) / 2;
    g += `<g data-tip="${L[i]}\nMedia ${eur(v)} a settimana"><rect x="${pl + gw * i}" y="${pt}" width="${gw}" height="${ih}" fill="transparent"/><path d="${barPath(x, pt + ih - h, bw, h, 4)}" fill="var(--s-orange)" opacity="${i === hi ? 1 : 0.55}"/><text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${L[i]}</text></g>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">${g}</svg>`;
}
/** Statistics screen: averages, saving rate, category trends, all computed locally. */
function vStats() {
  const P = statPeriod(stPer),
    A = statAgg(P.months),
    B = P.prev ? statAgg(P.prev) : null,
    n = A.n;
  const seg = `<div class="seg noprint" style="max-width:560px;margin-bottom:14px">${[
    ['12m', '12 mesi'],
    ['ytd', 'Anno in corso'],
    ['py', 'Anno scorso'],
    ['all', 'Tutto']
  ]
    .map(
      ([k, l]) =>
        `<button type="button" class="${stPer === k ? 'on' : ''}" data-act="st-per" data-k="${k}">${l}</button>`
    )
    .join('')}</div>`;
  if (!P.months.length || (!A.inc && !A.out))
    return (
      seg +
      `<div class="card empty"><h3>Nessun dato nel periodo</h3><div class="hint">Importa un estratto conto o aggiungi movimenti per vedere le statistiche.</div></div>`
    );
  const sv = A.inc - A.out,
    rate = A.inc ? (sv / A.inc) * 100 : 0,
    bn = B ? B.n : 1;
  const cats = Object.entries(A.cat).sort((a, b) => b[1] - a[1]);
  const vals = P.months.map(k => A.byM[k].out),
    mxM = P.months[vals.indexOf(Math.max(...vals))],
    pos = vals.filter(v => v > 0),
    mnM = P.months[vals.indexOf(pos.length ? Math.min(...pos) : 0)];
  const freq = Object.values(A.merch)
    .sort((a, b) => b.c - a.c || b.v - a.v)
    .slice(0, 6);
  const nWeeks = P.months.reduce((s, k) => s + daysIn(k), 0) / 7;
  const years = {};
  for (const t of S.tx) {
    if (isNeutral(t.cat)) continue;
    const y = t.date.slice(0, 4);
    const o = (years[y] = years[y] || { inc: 0, out: 0, m: new Set() });
    o.m.add(ym(t.date));
    if (t.amount > 0) o.inc += t.amount;
    else o.out -= t.amount;
  }
  const ys = Object.keys(years).sort().reverse();
  const kpi = (l, v, prev, cls = '') =>
    `<div class="card kpi"><div class="lbl">${l}</div><div class="val num ${cls}">${eur0(v)}</div><div class="hint">${B ? 'vs periodo prec. ' + pctTxt(v, prev) : 'al mese'}</div></div>`;
  const cat = stCat && A.cat[stCat] ? stCat : '',
    mv = P.months.map(k => (cat ? (A.catM[cat] || {})[k] || 0 : A.byM[k].out)),
    tot = mv.reduce((x, y) => x + y, 0),
    prevAvg = B ? (cat ? B.cat[cat] || 0 : B.out) / bn : 0,
    mrows = Object.values(A.merch)
      .filter(m => !cat || m.cat === cat)
      .sort((a, b) => b.v - a.v)
      .slice(0, 5);
  const hero = `<div class="grid g21">
    <div class="card statshero">
      <div class="sh-top"><select class="inp catpick" id="stcat" aria-label="Categoria"><option value="">Tutte le spese</option>${cats.map(([c]) => `<option ${c === cat ? 'selected' : ''} value="${esc(c)}">${esc(c)}</option>`).join('')}</select>${cat ? catAv(cat) : tile('stats', '#8B5CF6')}</div>
      <div class="bh-top"><div class="lbl">Media al mese · ${P.lbl.toLowerCase()}</div><div class="big num">${eur0(tot / n)}</div>${prevAvg ? `<span class="chip ${tot / n > prevAvg ? 'c-warn' : 'c-good'}">${tot / n > prevAvg ? '+' : '−'}${Math.abs(Math.round((tot / n / prevAvg - 1) * 100))}% rispetto al periodo prima</span>` : ''}</div>
      ${monthBars(P.months, mv, cat ? { c1: catCol(cat), c2: `color-mix(in srgb,${catCol(cat)} 55%,#1E1B4B)` } : {})}
    </div>
    <div class="card"><div class="card-h"><div><h3>${cat ? 'Dove, in ' + esc(cat) : 'Dove spendi di più'}</h3><div class="hint">Esercenti e beneficiari del periodo</div></div></div>
      <div class="list">${mrows.length ? mrows.map(m => `<div class="row" style="cursor:default">${catAv(m.cat)}<div class="main"><div class="t1">${esc(m.n)}</div><div class="t2">${m.c === 1 ? '1 volta' : m.c + ' volte'} · media ${eur0(m.v / m.c)}</div></div><div class="amt num">${eur0(m.v)}</div></div>`).join('') : '<div class="empty">Nessun esercente riconosciuto</div>'}</div></div>
  </div>`;
  return (
    hero +
    `<div style="margin-top:14px">${seg}</div>` +
    `<div class="hint" style="margin:-4px 0 12px">${P.lbl} · ${P.months.length} mesi (${ymLabel(P.months[0])} – ${ymLabel(P.months[P.months.length - 1])}). Giroconti e investimenti esclusi.</div>
  <div class="grid g4">
    ${kpi('Entrate medie / mese', A.inc / n, B && B.inc / bn)}
    ${kpi('Uscite medie / mese', A.out / n, B && B.out / bn)}
    <div class="card kpi"><div class="lbl">Risparmio medio / mese</div><div class="val num ${sv >= 0 ? 'up' : 'down'}">${eur0(sv / n)}</div><div class="hint">${eur0((sv / n) * 12)} l'anno</div></div>
    <div class="card kpi"><div class="lbl">Tasso di risparmio</div><div class="val num">${A.inc ? Math.round(rate) + '%' : '—'}</div><div class="hint">${B && B.inc ? 'prima ' + Math.round(((B.inc - B.out) / B.inc) * 100) + '%' : 'del reddito'}</div></div>
  </div>
  <div class="grid g4" style="margin-top:14px">
    <div class="card kpi"><div class="lbl">Uscite annue stimate</div><div class="val num">${eur0((A.out / n) * 12)}</div><div class="hint">media × 12</div></div>
    <div class="card kpi"><div class="lbl">Spesa media al giorno</div><div class="val num">${eur(A.out / (nWeeks * 7))}</div><div class="hint">${eur0(A.out / nWeeks)} a settimana</div></div>
    <div class="card kpi"><div class="lbl">Mese più caro</div><div class="val num">${eur0(A.byM[mxM].out)}</div><div class="hint">${ymLabel(mxM)}</div></div>
    <div class="card kpi"><div class="lbl">Mese più leggero</div><div class="val num">${eur0(A.byM[mnM].out)}</div><div class="hint">${ymLabel(mnM)}</div></div>
  </div>
  <div class="card" style="margin-top:14px"><div class="card-h"><div><h3>Spese medie per categoria</h3><div class="hint">Media sui ${P.months.length} mesi del periodo, anche quelli senza spese in quella categoria</div></div></div>
    <div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Categoria</th><th class="r">Media / mese</th><th class="r">Annua</th><th class="r">Totale</th><th class="r">%</th>${B ? '<th class="r">vs prec.</th>' : ''}<th style="min-width:110px">Andamento</th></tr></thead><tbody>
    ${cats
      .map(([c, v]) => {
        const pv = B ? (B.cat[c] || 0) / bn : 0;
        return `<tr><td style="white-space:nowrap">${catIc(c)} ${esc(c)}</td><td class="r num"><b>${eur(v / n)}</b></td><td class="r num">${eur0((v / n) * 12)}</td><td class="r num hint">${eur0(v)}</td><td class="r num">${((v / A.out) * 100).toFixed(1).replace('.', DEC)}%</td>${B ? `<td class="r">${pctTxt(v / n, pv)}</td>` : ''}<td>${sparkBars(
          P.months.map(k => (A.catM[c] || {})[k] || 0),
          'var(--s-orange)',
          24
        )}</td></tr>`;
      })
      .join('')}
    </tbody><tfoot><tr><td><b>Totale</b></td><td class="r num"><b>${eur(A.out / n)}</b></td><td class="r num"><b>${eur0((A.out / n) * 12)}</b></td><td class="r num hint">${eur0(A.out)}</td><td class="r">100%</td>${B ? `<td class="r">${pctTxt(A.out / n, B.out / bn)}</td>` : ''}<td></td></tr></tfoot></table></div></div>
  <div class="card" style="margin-top:14px"><div class="card-h"><div><h3>Mappa di calore categorie × mesi</h3><div class="hint">Più è intenso il colore, più hai speso</div></div></div>${catHeatmap(
    cats.map(c => c[0]),
    P.months,
    A.catM
  )}</div>
  <div class="grid g2" style="margin-top:14px">
    <div class="card"><h3>Spesa per giorno della settimana</h3><div class="hint">Media settimanale</div>${wdChart(A.wd, nWeeks)}</div>
    <div class="card"><h3>Spese più alte</h3><table class="tbl"><tbody>${A.big.map(x => `<tr><td class="num hint" style="white-space:nowrap">${dLabel(x.date)}</td><td>${esc(x.note || x.cat)}<div class="hint">${esc(x.cat)}</div></td><td class="r num">${eur(x.amount)}</td></tr>`).join('')}</tbody></table></div>
  </div>
  <div class="grid g2" style="margin-top:14px">
    <div class="card"><h3>Abitudini</h3><table class="tbl"><thead><tr><th>Più frequenti</th><th class="r">Volte / mese</th><th class="r">Media</th></tr></thead><tbody>${freq.map(m => `<tr><td>${esc(m.n)}</td><td class="r num">${(m.c / n).toFixed(1).replace('.', DEC)}</td><td class="r num">${eur(m.v / m.c)}</td></tr>`).join('')}</tbody></table></div>
  </div>
  <div class="card" style="margin-top:14px"><h3>Anno per anno</h3><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Anno</th><th class="r">Mesi</th><th class="r">Entrate</th><th class="r">Uscite</th><th class="r">Uscite medie / mese</th><th class="r">Risparmio</th><th class="r">Tasso</th></tr></thead><tbody>${ys
    .map(y => {
      const o = years[y],
        s = o.inc - o.out;
      return `<tr><td><b>${y}</b></td><td class="r num">${o.m.size}</td><td class="r num">${eur0(o.inc)}</td><td class="r num">${eur0(o.out)}</td><td class="r num">${eur0(o.out / o.m.size)}</td><td class="r num ${s >= 0 ? 'up' : 'down'}">${eur0(s)}</td><td class="r num">${o.inc ? Math.round((s / o.inc) * 100) + '%' : '—'}</td></tr>`;
    })
    .join('')}</tbody></table></div></div>
  <div class="noprint" style="margin-top:14px"><button class="btn" data-act="print">${svgI('print')}Stampa / Salva PDF</button></div>`
  );
}

/* ---------- render ---------- */
const TITLES = {
  home: 'Panoramica',
  movimenti: 'Movimenti',
  investimenti: 'Investimenti',
  ricorrenti: 'Costi ricorrenti',
  obiettivi: 'Obiettivi',
  report: 'Report',
  statistiche: 'Statistiche',
  chiedi: 'Chiedi ai tuoi dati',
  permettermelo: 'Posso permettermelo?',
  patrimonio: 'Patrimonio',
  fire: 'Simulazione FIRE',
  impostazioni: 'Impostazioni'
};
let lastView = null;
/** Renders the current view into the page. */
function renderView() {
  const v =
    {
      home: vHome,
      movimenti: vTx,
      investimenti: vInv,
      ricorrenti: vRec,
      obiettivi: vGoals,
      report: vReport,
      statistiche: vStats,
      chiedi: vAsk,
      permettermelo: vAfford,
      patrimonio: vPat,
      fire: vFire,
      impostazioni: vSettings
    }[view] || vHome;
  const V = $('#view');
  document.body.dataset.view = view;
  V.innerHTML = v();
  if (lastView !== view) {
    V.classList.remove('vin');
    void V.offsetWidth;
    V.classList.add('vin');
    lastView = view;
    countUp(V.querySelector('[data-to]'));
  } else V.classList.remove('vin');
  $('#view').classList.toggle(
    'sensview',
    ['patrimonio', 'investimenti', 'fire', 'permettermelo'].includes(view)
  );
  applyBalMask();
}
/** Re-renders navigation, sync status and the current view. */
function render() {
  renderNav();
  renderSync();
  $('#ttl').textContent = TITLES[view];
  const d = new Date();
  $('#subttl').textContent = d.getDate() + ' ' + MESIL[d.getMonth()] + ' ' + d.getFullYear();
  $('#banner').innerHTML = S.demo
    ? `<div class="banner"><span>Questi sono <b>dati di esempio</b>. Esplora l'app, poi parti con i tuoi.</span><button class="btn sm pri" data-act="fresh">Inizia ora</button></div>`
    : '';
  renderView();
  if (view === 'impostazioni') refreshMcp();
}
/** Navigates to a view. */
function go(v) {
  view = v;
  try {
    if (location.hash !== '#' + v) history.replaceState(null, '', '#' + v);
  } catch (e) {
    location.hash = v;
  }
  render();
  window.scrollTo(0, 0);
}

function moreSheet() {
  openForm(
    'Altro',
    [],
    () => {},
    null,
    `<div class="list">${[
      ['investimenti', 'inv', 'Investimenti'],
      ['fire', 'fire', 'Simulazione FIRE'],
      ['ricorrenti', 'rec', 'Costi ricorrenti'],
      ['obiettivi', 'goal', 'Obiettivi'],
      ['statistiche', 'stats', 'Statistiche'],
      ['chiedi', 'ask', 'Chiedi'],
      ['permettermelo', 'afford', 'Posso permettermelo?'],
      ['report', 'print', 'Report'],
      ['impostazioni', 'set', 'Impostazioni']
    ]
      .map(
        ([v, i, l]) =>
          `<div class="row" data-act="go-close" data-v="${v}"><div class="av">${ico(i)}</div><div class="main"><div class="t1">${l}</div></div></div>`
      )
      .join('')}</div>`
  );
  document.querySelector('#frm .btns').style.display = 'none';
}
/** The consultant sheet, opened from the orb: what is new to read, then the ways to ask. */
function orbSheet() {
  const news = orbNews(),
    all = S ? insights() : [];
  const rest = all.filter(i => !news.some(n => n.t === i.t));
  const item = i =>
    `<div class="row" style="cursor:default">${tile(...i.ic)}<div class="main"><div class="t1" style="white-space:normal">${esc(i.t)}</div><div class="t2" style="white-space:normal">${esc(i.d)}</div></div></div>`;
  const go = (v, i, l, d) =>
    `<div class="row" data-act="go-close" data-v="${v}"><div class="av">${ico(i)}</div><div class="main"><div class="t1">${l}</div><div class="t2">${d}</div></div></div>`;
  openForm(
    'Consulente',
    [],
    () => {},
    null,
    `<div class="orb-big">${orbHTML()}</div>
    <div class="hint" style="text-align:center;margin:-4px 0 14px">Tutto calcolato sul dispositivo · nessun dato esce</div>
    ${news.length ? `<div class="navlbl" style="padding-left:4px">Da leggere</div><div class="list">${news.map(item).join('')}</div>` : ''}
    ${rest.length ? `<div class="navlbl" style="padding-left:4px">Spunti</div><div class="list">${rest.map(item).join('')}</div>` : ''}
    ${all.length ? '' : '<div class="empty">Niente di nuovo da segnalare</div>'}
    <div class="navlbl" style="padding-left:4px">Chiedi</div>
    <div class="list">${go('chiedi', 'ask', 'Chiedi ai tuoi dati', 'Domande libere su spese e patrimonio')}${go('permettermelo', 'afford', 'Posso permettermelo?', 'Una spesa futura, mese per mese')}${go('fire', 'fire', 'Simulazione FIRE', 'Quando potresti smettere di lavorare')}</div>`
  );
  document.querySelector('#frm .btns').style.display = 'none';
  orbMarkSeen();
}
