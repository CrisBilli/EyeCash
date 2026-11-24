/*
 * EyeCash · public/js/invest.js
 *
 * Investments: multiple portfolios, target allocation (by asset class or
 * per holding), rebalancing suggestions, taxes and costs.
 */
/* ---------- Investments: allocation, rebalancing, taxes, costs, dividends ---------- */
let invTab = 'pos';
const PRESETS = {
  '60/40 classico': { azioni: 60, obbligazioni: 40 },
  '80/20 crescita': { azioni: 80, obbligazioni: 20 },
  '100% azionario': { azioni: 100 },
  'Permanente semplice': { azioni: 40, obbligazioni: 40, oro: 10, liquidita: 10 }
};
/* ---------- Multiple portfolios (different banks/brokers) ---------- */
let invPf = null; // null = all · '' = main portfolio · otherwise the portfolio id
const pfs = () => S.portfolios || [];
const pfName = k =>
  k === '' || k == null
    ? S.pfMain || 'Principale'
    : (pfs().find(p => p.id === k) || {}).name || 'Portafoglio';
/** Holdings of the selected portfolio (or all of them). */
function hsScope() {
  if (invPf != null && invPf !== '' && !pfs().some(p => p.id === invPf)) invPf = null;
  return invPf == null ? S.holdings : S.holdings.filter(h => (h.pf || '') === invPf);
}
function pfBar() {
  if (!pfs().length)
    return `<div class="noprint" style="margin:-4px 0 12px"><button class="btn sm" data-act="pf-new">＋ Aggiungi un altro portafoglio (altra banca o broker)</button></div>`;
  const tot = k =>
    S.holdings.filter(h => k == null || (h.pf || '') === k).reduce((s, h) => s + h.qty * h.price, 0);
  const chip = (k, l) =>
    `<button class="btn sm ${invPf === k ? 'pri' : ''}" data-act="pf-sel" data-k="${k == null ? 'all' : k}">${esc(l)} <span class="num sensnum" style="opacity:.75">${eur0(tot(k))}</span></button>`;
  return `<div class="sens" style="display:flex;gap:6px;flex-wrap:wrap;margin:-4px 0 12px">${chip(null, 'Tutti')}${S.holdings.some(h => !h.pf) ? chip('', pfName('')) : ''}${pfs()
    .map(p => chip(p.id, p.name))
    .join(
      ''
    )}<button class="btn sm" data-act="pf-new">＋</button>${invPf != null ? `<button class="btn sm" data-act="pf-edit">✎ Rinomina</button>` : ''}</div>`;
}
function pfForm(edit) {
  const cur = edit ? invPf : null,
    isMain = cur === '';
  openForm(
    edit ? 'Portafoglio' : 'Nuovo portafoglio',
    [
      {
        k: 'name',
        label: 'Nome (es. la banca o il broker)',
        v: edit ? pfName(cur) : '',
        ph: 'es. Fineco, Directa, Trade Republic'
      }
    ],
    d => {
      const n = (d.name || '').trim().slice(0, 30);
      if (!n) return toast('Inserisci un nome');
      if (edit) {
        if (isMain) S.pfMain = n;
        else pfs().find(p => p.id === cur).name = n;
      } else {
        S.portfolios = pfs();
        const p = { id: 'pf' + uid(), name: n };
        S.portfolios.push(p);
        invPf = p.id;
      }
      save();
      render();
      toast('Salvato');
    },
    edit && !isMain
      ? () => {
          S.holdings.forEach(h => {
            if (h.pf === cur) delete h.pf;
          });
          S.portfolios = pfs().filter(p => p.id !== cur);
          invPf = null;
          save();
          render();
          toast('Portafoglio rimosso: le posizioni sono in ' + pfName(''));
        }
      : null,
    edit
      ? ''
      : '<p class="hint" style="line-height:1.6">Ogni portafoglio ha le sue posizioni e la sua allocazione obiettivo. Quando importi il file di un broker scegli in quale portafoglio metterlo.</p>'
  );
}
/* ---------- Target allocation per holding ---------- */
const allocMode = () => {
  const T = S.target || {};
  return T.mode || (Object.values(T.weights || {}).some(v => v > 0) ? 'class' : 'asset');
};
const awKey = () => (invPf == null ? 'all' : invPf || 'main');
function allocSeg() {
  return `<div class="seg" style="max-width:420px;margin-bottom:12px">${[
    ['asset', 'Per titolo'],
    ['class', 'Per classe di attivo']
  ]
    .map(
      ([k, l]) =>
        `<button type="button" class="${allocMode() === k ? 'on' : ''}" data-act="al-mode" data-k="${k}">${l}</button>`
    )
    .join('')}</div>`;
}
function vAllocAsset() {
  const T = S.target || {},
    hs = hView()
      .filter(h => h.value > 0)
      .sort((a, b) => b.value - a.value),
    W = (T.aw || {})[awKey()] || {},
    tol = +T.tol || 5;
  const tot = hs.reduce((s, h) => s + h.value, 0),
    sum = hs.reduce((s, h) => s + (+W[h.id] || 0), 0),
    has = sum > 0;
  const f1 = v => v.toFixed(1).replace('.', DEC);
  if (!hs.length)
    return `<div class="card"><div class="empty">Aggiungi o importa le tue posizioni per impostare l'allocazione.</div></div>`;
  const editor = `<div class="card"><div class="card-h"><div><h3>Allocazione obiettivo · ${esc(invPf == null ? 'tutti i portafogli' : pfName(invPf))}</h3><div class="hint">Che peso vuoi dare a ogni titolo. La somma deve fare 100%.</div></div></div>
   <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px"><button class="btn sm" data-act="aw-cur">Usa i pesi attuali</button><button class="btn sm" data-act="aw-eq">Pesi uguali</button></div>
   ${hs.map(h => `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-top:1px solid var(--line)"><div style="flex:1;min-width:0"><div style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(h.name)}</div><div class="hint">ora <span class="num">${f1((h.value / tot) * 100)}%</span> · ${clsLabel(h.cls)}</div></div><input class="inp num" data-aw="${h.id}" data-cur="${((h.value / tot) * 100).toFixed(4)}" value="${W[h.id] ? String(W[h.id]).replace('.', DEC) : ''}" inputmode="decimal" placeholder="0" style="width:84px;font-size:15px;text-align:right"><span class="hint">%</span></div>`).join('')}
   <div class="grid g2" style="gap:10px;margin-top:10px"><div class="fld" style="margin:0"><label>Tolleranza (punti %)</label><input class="inp num" id="tg-tol" value="${T.tol ?? 5}" style="font-size:15px"></div>
    <div class="fld" style="margin:0"><label>&nbsp;</label><button class="btn pri" data-act="aw-save" style="justify-content:center">Salva obiettivo · totale <span id="aw-sum">${f1(sum)}</span>%</button></div></div></div>`;
  if (!has)
    return (
      editor +
      `<div class="card" style="margin-top:14px"><div class="empty">Imposta i pesi obiettivo per vedere scostamenti e ribilanciamento.</div></div>`
    );
  const nm = id => (hs.find(h => h.id === id) || {}).name || '',
    d = EN.assetDrift(hs, W, tol),
    outN = d.filter(x => x.out).length;
  const monthly = +T.monthly || avgSaveMonth(),
    plan = EN.assetContribution(hs, W, monthly),
    months = EN.assetMonths(hs, W, monthly, tol);
  const full = EN.assetRebalance(hs, W, S.zainetto || [], new Date().getFullYear());
  return (
    editor +
    `
  <div class="card" style="margin-top:14px"><div class="card-h"><div><h3>Attuale vs obiettivo</h3><div class="hint">Tolleranza ±${tol} punti</div></div>${outN ? `<span class="chip c-warn">! ${outN} ${outN === 1 ? 'titolo fuori' : 'titoli fuori'} soglia</span>` : '<span class="chip c-good">✓ In equilibrio</span>'}</div>
   ${d
     .map(
       x => `<div style="padding:8px 0;border-top:1px solid var(--line)"><div style="display:flex;justify-content:space-between;gap:8px;font-size:13px"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(nm(x.id))}</span><span class="num" style="flex:none">${eur0(x.value)} · <b>${f1(x.cur)}%</b> <span class="hint">/ ${f1(x.tgt)}%</span> ${x.out ? `<span class="chip ${x.diff > 0 ? 'c-warn' : 'c-info'}">${x.diff > 0 ? '▲ +' : '▼ '}${f1(x.diff)}</span>` : ''}</span></div>
     <div style="position:relative;height:8px;background:var(--line);border-radius:4px;margin-top:6px"><div style="height:100%;width:${Math.min(100, x.cur)}%;background:${x.out ? 'var(--warn)' : 'var(--s-blue)'};border-radius:4px"></div><div style="position:absolute;top:-3px;left:${Math.min(100, x.tgt)}%;width:2px;height:14px;background:var(--tx)" data-tip="Obiettivo ${f1(x.tgt)}%"></div></div></div>`
     )
     .join('')}</div>
  <div class="grid g2" style="margin-top:14px">
   <div class="card"><div class="card-h"><div><h3>Con i nuovi versamenti</h3><div class="hint">Il modo più efficiente: non vendi, non paghi tasse</div></div></div>
    <div class="fld"><label>Quanto investi questo mese (€)</label><input class="inp num" id="tg-monthly" value="${monthly}" style="font-size:15px"></div>
    <div class="list">${Object.entries(plan)
      .filter(([, v]) => v >= 1)
      .sort((a, b) => b[1] - a[1])
      .map(
        ([k, v]) =>
          `<div class="row" style="cursor:default"><div class="av">↑</div><div class="main"><div class="t1">${esc(nm(k))}</div><div class="t2">compra</div></div><div class="amt num">${eur0(v)}</div></div>`
      )
      .join('')}</div>
    <p class="hint" style="margin-top:8px">${months === 0 ? 'Sei già in equilibrio.' : months ? `Con ${eur0(monthly)} al mese rientri nella tolleranza in circa <b style="color:var(--tx)">${months} ${months === 1 ? 'mese' : 'mesi'}</b> (a prezzi costanti).` : 'Con questo importo non rientri entro 20 anni: valuta il ribilanciamento completo.'}</p></div>
   <div class="card"><div class="card-h"><div><h3>Ribilanciamento completo</h3><div class="hint">Vendi i titoli in eccesso e compra quelli sotto peso</div></div></div>
    ${
      full.sells.length || full.buys.length
        ? `<div class="list">${full.sells.map(s => `<div class="row" style="cursor:default"><div class="av">↓</div><div class="main"><div class="t1">Vendi ${esc(nm(s.id))}</div><div class="t2">${s.gain >= 0 ? 'plusvalenza' : 'minusvalenza'} ${eur0(Math.abs(s.gain))}</div></div><div class="amt num down">−${eur0(s.amount)}</div></div>`).join('')}
     ${full.buys.map(b => `<div class="row" style="cursor:default"><div class="av">↑</div><div class="main"><div class="t1">Compra ${esc(nm(b.id))}</div></div><div class="amt num up">+${eur0(b.amount)}</div></div>`).join('')}</div>
     <div class="bcard" style="margin-top:10px"><div class="k"><span>Tasse stimate</span></div><div class="v num">${eur(full.tax)}</div><div class="f"><span>${full.zainettoUsed ? `zainetto usato ${eur0(full.zainettoUsed)} · ` : ''}${full.zainettoGenerated.diversi ? `nuove minus ${eur0(full.zainettoGenerated.diversi)}` : ''}</span></div></div>`
        : '<div class="empty">Nessuna operazione necessaria</div>'
    }
    <p class="hint" style="margin-top:8px;line-height:1.5">Calcolo informativo con le regole fiscali italiane 2026. Non è consulenza finanziaria o fiscale.</p></div>
  </div>`
  );
}
function hView() {
  return hsScope().map(h => ({
    id: h.id,
    name: h.name,
    cls: hCls(h),
    taxClass: hTax(h),
    value: h.qty * h.price,
    cost: h.qty * h.avg
  }));
}
function invTabs() {
  return (
    pfBar() +
    `<div class="seg" style="max-width:560px;margin-bottom:14px">${[
      ['pos', 'Posizioni'],
      ['hist', 'Storico'],
      ['alloc', 'Ribilanciamento'],
      ['tax', 'Tasse e costi']
    ]
      .map(
        ([k, l]) =>
          `<button type="button" class="${invTab === k ? 'on' : ''}" data-act="inv-tab" data-k="${k}">${l}</button>`
      )
      .join('')}</div>`
  );
}
/** Rebalancing view: target vs current weights and what to buy/sell. */
function vAlloc() {
  if (allocMode() === 'asset') return allocSeg() + vAllocAsset();
  const T = S.target || { weights: {}, tol: 5, cash: 0, monthly: '' };
  const has = Object.values(T.weights || {}).some(v => v > 0);
  const hs = hView();
  const cashC = +T.cash || 0;
  const sum = EN.CK.reduce((s, k) => s + (+(T.weights || {})[k] || 0), 0);
  const editor =
    allocSeg() +
    `<div class="card"><div class="card-h"><div><h3>Allocazione obiettivo</h3><div class="hint">Come vuoi dividere il portafoglio tra le classi di attivo</div></div></div>
   <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">${Object.keys(PRESETS)
     .map(n => `<button class="btn sm" data-act="tgt-preset" data-n="${esc(n)}">${n}</button>`)
     .join('')}</div>
   <div class="grid g3" style="gap:10px">${EN.CLASSES.map(c => `<div class="fld" style="margin:0"><label>${c.label} (%)</label><input class="inp num" data-tw="${c.k}" value="${(T.weights || {})[c.k] || ''}" inputmode="decimal" placeholder="0" style="font-size:15px"></div>`).join('')}</div>
   <div class="grid g3" style="gap:10px;margin-top:10px"><div class="fld" style="margin:0"><label>Tolleranza (punti %)</label><input class="inp num" id="tg-tol" value="${T.tol ?? 5}" style="font-size:15px"></div>
    <div class="fld" style="margin:0"><label>Liquidità da contare nel portafoglio (€)</label><input class="inp num" id="tg-cash" value="${T.cash || ''}" placeholder="0" style="font-size:15px"></div>
    <div class="fld" style="margin:0"><label>&nbsp;</label><button class="btn pri" data-act="tgt-save" style="justify-content:center">Salva obiettivo · totale ${sum}%</button></div></div></div>`;
  if (!has || !hs.length)
    return (
      editor +
      `<div class="card" style="margin-top:14px"><div class="empty">${hs.length ? "Imposta l'allocazione obiettivo per vedere scostamenti e ribilanciamento." : "Aggiungi le tue posizioni per vedere l'allocazione."}</div></div>`
    );
  const d = EN.drift(hs, T.weights, cashC, +T.tol || 5);
  const outN = d.filter(x => x.out).length;
  const monthly = +T.monthly || avgSaveMonth();
  const plan = EN.contributionPlan(hs, T.weights, cashC, monthly);
  const months = EN.monthsToRebalance(hs, T.weights, cashC, monthly, +T.tol || 5);
  const full = EN.fullRebalance(hs, T.weights, cashC, S.zainetto || [], new Date().getFullYear());
  const nm = id => (S.holdings.find(h => h.id === id) || {}).name || '';
  const biggest = k => {
    const x = hs.filter(h => h.cls === k).sort((a, b) => b.value - a.value)[0];
    return x ? x.name : null;
  };
  return (
    editor +
    `
  <div class="card" style="margin-top:14px"><div class="card-h"><div><h3>Attuale vs obiettivo</h3><div class="hint">Tolleranza ±${T.tol || 5} punti</div></div>${outN ? `<span class="chip c-warn">! ${outN} ${outN === 1 ? 'classe fuori' : 'classi fuori'} soglia</span>` : '<span class="chip c-good">✓ In equilibrio</span>'}</div>
   ${d
     .map(
       x => `<div style="padding:8px 0;border-top:1px solid var(--line)"><div style="display:flex;justify-content:space-between;font-size:13px"><span>${clsLabel(x.k)}</span><span class="num">${eur0(x.value)} · <b>${x.cur.toFixed(1).replace('.', DEC)}%</b> <span class="hint">/ ${x.tgt.toFixed(0)}%</span> ${x.out ? `<span class="chip ${x.diff > 0 ? 'c-warn' : 'c-info'}">${x.diff > 0 ? '▲ +' : '▼ '}${x.diff.toFixed(1).replace('.', DEC)}</span>` : ''}</span></div>
     <div style="position:relative;height:8px;background:var(--line);border-radius:4px;margin-top:6px"><div style="height:100%;width:${Math.min(100, x.cur)}%;background:${x.out ? 'var(--warn)' : 'var(--s-blue)'};border-radius:4px"></div><div style="position:absolute;top:-3px;left:${Math.min(100, x.tgt)}%;width:2px;height:14px;background:var(--tx)" data-tip="Obiettivo ${x.tgt.toFixed(0)}%"></div></div></div>`
     )
     .join('')}</div>
  <div class="grid g2" style="margin-top:14px">
   <div class="card"><div class="card-h"><div><h3>Con i nuovi versamenti</h3><div class="hint">Il modo più efficiente: non vendi, non paghi tasse</div></div></div>
    <div class="fld"><label>Quanto investi questo mese (€)</label><input class="inp num" id="tg-monthly" value="${monthly}" style="font-size:15px"></div>
    <div class="list">${Object.entries(plan)
      .filter(([, v]) => v >= 1)
      .map(
        ([k, v]) =>
          `<div class="row" style="cursor:default"><div class="main"><div class="t1">${clsLabel(k)}</div><div class="t2">${biggest(k) ? 'es. su ' + esc(biggest(k)) : k === 'liquidita' ? 'lascia sul conto/deposito' : 'nuovo strumento da scegliere'}</div></div><div class="amt num">${eur0(v)}</div></div>`
      )
      .join('')}</div>
    <p class="hint" style="margin-top:8px">${months === 0 ? 'Sei già in equilibrio.' : months ? `Con ${eur0(monthly)} al mese rientri nella tolleranza in circa <b style="color:var(--tx)">${months} ${months === 1 ? 'mese' : 'mesi'}</b> (a prezzi costanti).` : 'Con questo importo non rientri entro 20 anni: valuta il ribilanciamento completo.'}</p></div>
   <div class="card"><div class="card-h"><div><h3>Ribilanciamento completo</h3><div class="hint">Vende prima le posizioni in perdita o con meno guadagno</div></div></div>
    ${
      full.sells.length || full.buys.length
        ? `<div class="list">${full.sells.map(s => `<div class="row" style="cursor:default"><div class="av">↓</div><div class="main"><div class="t1">Vendi ${s.id ? esc(nm(s.id)) : 'liquidità'}</div><div class="t2">${clsLabel(s.cls)}${s.id ? ` · ${s.gain >= 0 ? 'plusvalenza' : 'minusvalenza'} ${eur0(Math.abs(s.gain))}` : ''}</div></div><div class="amt num down">−${eur0(s.amount)}</div></div>`).join('')}
     ${full.buys.map(b => `<div class="row" style="cursor:default"><div class="av">↑</div><div class="main"><div class="t1">Compra ${b.id ? esc(nm(b.id)) : b.cls === 'liquidita' ? 'liquidità' : 'nuovo strumento'}</div><div class="t2">${clsLabel(b.cls)}</div></div><div class="amt num up">+${eur0(b.amount)}</div></div>`).join('')}</div>
     <div class="bcard" style="margin-top:10px"><div class="k"><span>Tasse stimate</span></div><div class="v num">${eur(full.tax)}</div><div class="f"><span>${full.zainettoUsed ? `zainetto usato ${eur0(full.zainettoUsed)} · ` : ''}${full.zainettoGenerated.diversi ? `nuove minus ${eur0(full.zainettoGenerated.diversi)}` : ''}</span></div></div>`
        : '<div class="empty">Nessuna operazione necessaria</div>'
    }
    <p class="hint" style="margin-top:8px;line-height:1.5">Calcolo informativo con le regole fiscali italiane 2026 (ETF 26% senza compensazione delle plusvalenze, titoli di Stato 12,5%, crypto 33%). Non è consulenza finanziaria o fiscale.</p></div>
  </div>`
  );
}
/** Taxes and costs view (Italian tax rules, loss carry-forward). */
function vTaxes() {
  const yr = new Date().getFullYear();
  const rows = S.holdings.map(h => {
    const v = h.qty * h.price,
      c = h.qty * h.avg,
      g = v - c,
      tc = hTax(h);
    return { h, v, c, g, tc, t: EN.TAX[tc] };
  });
  const all = EN.taxOnSales(
    rows.map(r => ({ taxClass: r.tc, gain: r.g })),
    S.zainetto || [],
    yr
  );
  const plus = rows.filter(r => r.g > 0).reduce((s, r) => s + r.g, 0),
    minus = rows.filter(r => r.g < 0).reduce((s, r) => s - r.g, 0),
    iv = invVal();
  const terW = rows.reduce((s, r) => s + r.v * (+r.h.ter || 0), 0),
    ter = iv ? terW / iv : 0,
    bollo = rows.filter(r => r.tc !== 'esente').reduce((s, r) => s + r.v, 0) * EN.BOLLO;
  const divG = rows.reduce((s, r) => s + (r.v * (+r.h.divYield || 0)) / 100, 0),
    divN = rows.reduce(
      (s, r) => s + ((r.v * (+r.h.divYield || 0)) / 100) * (1 - (r.tc === 'stato' ? 0.125 : 0.26)),
      0
    );
  const from = ds(new Date(Date.now() - 365 * 864e5)),
    got = S.tx
      .filter(t => t.cat === 'Dividendi e cedole' && t.date >= from)
      .reduce((s, t) => s + t.amount, 0);
  const Z = [...(S.zainetto || [])].sort((a, b) => a.year - b.year);
  const zAvail = Z.filter(z => EN.zainettoExpiry(z.year) >= yr);
  return `<div class="grid g4">
    <div class="card kpi"><div class="lbl">Plusvalenze latenti</div><div class="val num up">${eur0(plus)}</div><div class="foot">minus latenti ${eur0(minus)}</div></div>
    <div class="card kpi"><div class="lbl">Tasse se vendessi tutto oggi</div><div class="val num">${eur0(all.tax)}</div><div class="foot">${all.zainettoUsed ? 'usando ' + eur0(all.zainettoUsed) + ' di zainetto' : 'zainetto non utilizzabile'}</div></div>
    <div class="card kpi"><div class="lbl">Valore netto liquidabile</div><div class="val num">${eur0(iv - all.tax)}</div><div class="foot">valore ${eur0(iv)} − tasse</div></div>
    <div class="card kpi"><div class="lbl">Costi annui</div><div class="val num">${eur0((iv * ter) / 100 + bollo)}</div><div class="foot">TER ${ter.toFixed(2).replace('.', DEC)}% · bollo ${eur0(bollo)}</div></div>
  </div>
  <div class="card" style="margin-top:14px"><h3>Fiscalità per posizione</h3><p class="hint" style="margin:4px 0 6px">Tocca una posizione per cambiare tipo fiscale, classe, TER o dividendi.</p>
   <table class="tbl"><thead><tr><th>Posizione</th><th class="hide-m">Regime</th><th class="r">Valore</th><th class="r">Plus/minus</th><th class="r">Aliquota</th><th class="r">Tassa stimata</th></tr></thead><tbody>
   ${rows.map(r => `<tr data-act="edit-hold" data-id="${r.h.id}" style="cursor:pointer"><td>${esc(r.h.name)}<div class="hint">${clsLabel(hCls(r.h))}${r.h.ter ? ' · TER ' + String(r.h.ter).replace('.', DEC) + '%' : ''}</div></td><td class="hide-m hint">${esc(r.t.label)}</td><td class="r num">${eur0(r.v)}</td><td class="r num ${r.g >= 0 ? 'up' : 'down'}">${r.g >= 0 ? '+' : ''}${eur0(r.g)}</td><td class="r num">${String(r.t.rate).replace('.', DEC)}%</td><td class="r num">${r.g > 0 ? eur0(EN.taxOnSales([{ taxClass: r.tc, gain: r.g }], S.zainetto || [], yr).tax) : '—'}</td></tr>`).join('') || '<tr><td colspan="6" class="hint">Nessuna posizione</td></tr>'}
   </tbody></table>
   <p class="hint" style="margin-top:8px;line-height:1.5">Le plusvalenze di ETF e fondi armonizzati sono redditi di capitale: lo zainetto non le riduce. Le loro minusvalenze però entrano nello zainetto e si usano su azioni, ETC, obbligazioni (titoli di Stato al 48,08%). Le crypto hanno uno zainetto a parte.</p></div>
  <div class="grid g2" style="margin-top:14px">
   <div class="card"><div class="card-h"><div><h3>Zainetto fiscale</h3><div class="hint">Minusvalenze da recuperare · scadono il 31/12 del 4° anno successivo</div></div><button class="btn sm pri" data-act="zain-new">+ Minusvalenza</button></div>
    <div class="list">${
      Z.map(z => {
        const ex = EN.zainettoExpiry(z.year),
          left = ex - yr;
        return `<div class="row" data-act="zain-edit" data-id="${z.id}"><div class="main"><div class="t1">${eur(z.amount)} <span class="hint">· ${z.bucket === 'crypto' ? 'crypto' : 'redditi diversi'}</span></div><div class="t2">realizzata nel ${z.year}${z.note ? ' · ' + esc(z.note) : ''}</div></div>${left < 0 ? '<span class="chip c-mut">scaduta</span>' : left === 0 ? `<span class="chip c-crit">✕ scade il 31/12/${ex}</span>` : left === 1 ? `<span class="chip c-warn">! scade nel ${ex}</span>` : `<span class="chip c-good">fino al ${ex}</span>`}</div>`;
      }).join('') ||
      '<div class="empty">Nessuna minusvalenza registrata. La trovi nel resoconto fiscale del tuo broker.</div>'
    }</div>
    ${zAvail.length ? `<p class="hint" style="margin-top:8px">Disponibile: ${eur0(zAvail.filter(z => z.bucket !== 'crypto').reduce((s, z) => s + z.amount, 0))} redditi diversi · ${eur0(zAvail.filter(z => z.bucket === 'crypto').reduce((s, z) => s + z.amount, 0))} crypto</p>` : ''}</div>
   <div class="card"><h3>Costi e dividendi</h3>
    <div class="hbar" style="grid-template-columns:1fr auto"><span class="nm">Costo medio dei fondi (TER ponderato)</span><span class="num">${ter.toFixed(2).replace('.', DEC)}%</span></div>
    <div class="hbar" style="grid-template-columns:1fr auto"><span class="nm">Commissioni annue stimate</span><span class="num">${eur0((iv * ter) / 100)}</span></div>
    <div class="hbar" style="grid-template-columns:1fr auto"><span class="nm">Bollo 0,2% annuo</span><span class="num">${eur0(bollo)}</span></div>
    <div class="hbar" style="grid-template-columns:1fr auto"><span class="nm">Costo delle commissioni in 20 anni*</span><span class="num down">${eur0(EN.feeDrag(iv, ter, 20))}</span></div>
    ${rows
      .filter(r => +r.h.ter > 0.5)
      .map(
        r =>
          `<div class="hint" style="margin-top:4px">${esc(r.h.name)}: TER ${String(r.h.ter).replace('.', DEC)}%, alto rispetto agli ETF indicizzati (spesso sotto 0,3%)</div>`
      )
      .join('')}
    <div style="height:10px"></div>
    <div class="hbar" style="grid-template-columns:1fr auto"><span class="nm">Dividendi/cedole attesi (lordi/netti)</span><span class="num">${eur0(divG)} / ${eur0(divN)}</span></div>
    <div class="hbar" style="grid-template-columns:1fr auto"><span class="nm">Incassati negli ultimi 12 mesi</span><span class="num up">${eur0(got)}</span></div>
    <p class="hint" style="margin-top:8px;line-height:1.5">*mancato guadagno rispetto a costi zero, ipotizzando il 5% annuo. Registra i dividendi come entrate di categoria "Dividendi e cedole".</p></div>
  </div>`;
}
function zainForm(z) {
  const isNew = !z;
  z = z || { year: new Date().getFullYear() - 1, amount: '', bucket: 'diversi', note: '' };
  openForm(
    isNew ? 'Nuova minusvalenza' : 'Minusvalenza',
    [
      {
        k: 'amount',
        label: 'Importo residuo (€)',
        type: 'number',
        v: z.amount === '' ? '' : String(z.amount).replace('.', DEC)
      },
      { k: 'year', label: 'Anno di realizzo', type: 'number', v: String(z.year) },
      {
        k: 'bucket',
        label: 'Tipo',
        type: 'select',
        v: z.bucket,
        options: [
          ['diversi', 'Redditi diversi (azioni, ETF in perdita, obbligazioni…)'],
          ['crypto', 'Cripto-attività']
        ]
      },
      { k: 'note', label: 'Nota', v: z.note, ph: 'es. broker' }
    ],
    d => {
      const o = {
        amount: num(d.amount),
        year: Math.round(num(d.year)),
        bucket: d.bucket,
        note: d.note.trim()
      };
      if (!(o.amount > 0) || o.year < 2000) return toast('Importo e anno validi');
      S.zainetto = S.zainetto || [];
      if (isNew) S.zainetto.push({ id: uid(), ...o });
      else
        Object.assign(
          S.zainetto.find(x => x.id === z.id),
          o
        );
      save();
      render();
    },
    isNew
      ? null
      : () => {
          S.zainetto = S.zainetto.filter(x => x.id !== z.id);
          save();
          render();
        }
  );
}
const trKey = t => {
  if (t.src === 'manual') return 'h:' + t.hid;
  if (t.isin) {
    const h = S.holdings.find(x => x.isin === t.isin);
    return h ? 'h:' + h.id : 'i:' + t.isin;
  }
  return S.trMap && S.trMap[t.name] ? 'h:' + S.trMap[t.name] : 'n:' + t.name;
};
const keyHold = k => (k.startsWith('h:') ? S.holdings.find(h => h.id === k.slice(2)) : null);
const keyName = k => {
  const h = keyHold(k);
  if (h) return h.name;
  if (k.startsWith('n:')) return k.slice(2);
  if (k.startsWith('i:')) {
    const t = (S.trades || []).find(x => x.isin === k.slice(2));
    return t ? t.name : k.slice(2);
  }
  return 'Titolo rimosso';
};
let PHIST = {},
  PHIST_AT = 0,
  PHIST_BUSY = false,
  trAll = false;
let pendingDossier = null;
let pendingImport = null;
