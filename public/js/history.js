/*
 * EyeCash · public/js/history.js
 *
 * Investment history: trades rebuilt from bank statements or from the
 * broker's "securities movements" export, matched to holdings (by ISIN, quantity
 * or cost), price history, time-weighted chart and annual return (XIRR).
 */
/* ---------- Investment history: trades rebuilt from bank statements ---------- */
const parseQty = s => {
  s = String(s || '').trim();
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const v = parseFloat(s);
  return v > 0 ? v : 0;
};

/** Extracts name and quantity from a bank "buy/sell securities" description. */
function tradeFromText(full) {
  const m =
    full.match(/Compravendita Titoli\s+(.+?)\s+Qta\/Val\.?\s*nom\.?\s*([\d.,]+)/i) ||
    full.match(
      /\b(?:acquisto|vendita|compravendita)\s+(?:titoli\s+)?(.+?)\s+(?:n\.|qta\.?|quantit[àa]:?)\s*([\d.,]+)/i
    );
  if (!m) return null;
  const qty = parseQty(m[2]),
    name = m[1]
      .replace(/^.*compravendita titoli\s+/i, '')
      .replace(/^[·\s-]+/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);
  return qty && name ? { name, qty } : null;
}

function tradeId(it, k) {
  let h = 0;
  for (const c of it.trade.name) h = (h * 31 + c.charCodeAt(0)) | 0;
  return (
    'tb_' +
    it.date +
    '_' +
    Math.round(Math.abs(it.amount) * 100) +
    '_' +
    (h >>> 0).toString(36) +
    '_' +
    it.trade.qty +
    (k ? '_' + k : '')
  );
}

/** Adds trades found in imported bank rows, skipping ones already known. */
function addTradesFrom(items) {
  S.trades = S.trades || [];
  const have = new Set(S.trades.map(t => t.id)),
    seen = {},
    twin = new Set();
  let n = 0;
  for (const it of items) {
    if (!it.trade) continue;
    const base = tradeId(it, 0);
    seen[base] = (seen[base] || 0) + 1;
    const id = tradeId(it, seen[base] - 1);
    if (have.has(id)) continue;
    have.add(id);
    const cand = {
      date: it.date,
      side: it.amount < 0 ? 'buy' : 'sell',
      qty: it.trade.qty,
      amount: r2(Math.abs(it.amount))
    };
    const tw = S.trades.find(t => t.src === 'dossier' && !twin.has(t.id) && sameTrade(t, cand));
    if (tw) {
      twin.add(tw.id);
      continue;
    }
    S.trades.push({ id, ...cand, name: it.trade.name, src: 'bank' });
    n++;
  }
  if (n) autoMatchTrades();
  return n;
}

/** Links bank trade names to holdings by comparing quantities and costs. */
function autoMatchTrades() {
  S.trMap = S.trMap || {};
  const ids = new Set(S.holdings.map(h => h.id));
  const bank = S.trades.filter(
    t =>
      t.src !== 'manual' &&
      !t.isin &&
      !(t.name in S.trMap && (S.trMap[t.name] === '' || ids.has(S.trMap[t.name])))
  );
  if (!bank.length) return;
  const b = EN.tradeBook(bank.map(t => ({ ...t, key: t.name })));
  const taken = new Set(Object.values(S.trMap).filter(Boolean));
  const m = EN.matchTradeNames(
    Object.values(b.pos).map(p => ({ name: p.key, qty: p.qty, cost: p.cost })),
    S.holdings.filter(h => !taken.has(h.id)).map(h => ({ id: h.id, name: h.name, qty: h.qty, avg: h.avg }))
  );
  for (const k in m) S.trMap[k] = m[k];
}

/** Trades with their holding key, bond quantities normalised, filtered by `portfolio`
 *  (null = all portfolios; by default the one selected on the Investments screen). */
function histScope(portfolio = invPf) {
  const T = (S.trades || []).map(t => ({ ...t, key: trKey(t) }));
  // bonds: if the bank reports the nominal value (e.g. 5,000) and the position counts units of 100 (50), convert to the same unit
  const net = {};
  for (const t of T)
    if (t.src !== 'manual') net[t.key] = (net[t.key] || 0) + (t.side === 'buy' ? t.qty : -t.qty);
  for (const t of T) {
    const h = t.src !== 'manual' && keyHold(t.key);
    if (
      h &&
      h.type === 'Obbligazioni' &&
      h.qty > 0 &&
      Math.abs(net[t.key] / 100 - h.qty) < Math.abs(net[t.key] - h.qty)
    )
      t.qty = t.qty / 100;
  }
  if (portfolio == null) return T;
  return T.filter(t => {
    const h = keyHold(t.key);
    return h ? (h.pf || '') === portfolio : portfolio === '';
  });
}

/** Loads monthly price history for the holdings (cached in memory). */
async function loadPriceHistory(manual) {
  if (PHIST_BUSY) return;
  if (!perm('quotes')) {
    if (manual) toast('Attiva le automatic prices in Impostazioni → Privacy');
    return;
  }
  if (OFFLINE) {
    if (manual) toast('Serve la connessione');
    return;
  }
  const hs = S.holdings.filter(h => (h.isin && (h.type === 'ETF' || h.type === 'Fondi')) || h.qSym);
  if (!hs.length) {
    if (manual) toast('Nessun titolo con ISIN o simbolo collegato');
    return;
  }
  PHIST_BUSY = true;
  if (manual) toast('Scarico i prezzi storici…');
  try {
    const r = await api('POST', '/api/quotes/history', {
      items: hs.map(h => ({ id: h.id, symbol: h.qSym || '', isin: h.isin || '', type: h.type }))
    });
    logAI(
      'quotes',
      `Prezzi storici: ${hs.map(h => (h.isin && (h.type === 'ETF' || h.type === 'Fondi') ? h.isin : h.qSym)).join(', ')} (+ titoli di copertura). Nessuna quantità o valore.`
    );
    PHIST = {};
    let ok = 0;
    for (const x of r.results || [])
      if (x.ok) {
        PHIST['h:' + x.id] = x.months;
        ok++;
      }
    PHIST_AT = Date.now();
    if (manual) toast(`Prezzi storici: ${ok} su ${hs.length} titoli`);
    if (view === 'investimenti') renderView();
  } catch (e) {
    if (manual) toast(e.message);
  } finally {
    PHIST_BUSY = false;
  }
}

function histChart(series) {
  const W = innerWidth < 820 ? 420 : 760,
    H = innerWidth < 820 ? 230 : 240,
    pl = 48,
    pr = 10,
    pt = 12,
    pb = 26,
    iw = W - pl - pr,
    ih = H - pt - pb,
    n = series.length;
  if (n < 2) return '';
  const top = niceTop(Math.max(...series.map(s => Math.max(s.value, s.invested)), 10)),
    X = i => pl + (iw * i) / (n - 1),
    Y = v => pt + ih - (ih * Math.max(0, v)) / top;
  const pth = f =>
    series.map((s, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(f(s)).toFixed(1)).join('');
  let g = axisY(top, pl, pt, ih, W, pr, kfmt);
  const step = Math.max(1, Math.ceil(n / (innerWidth < 820 ? 5 : 8)));
  series.forEach((s, i) => {
    if (i % step === 0 || i === n - 1)
      g += `<text x="${X(i)}" y="${H - 6}" text-anchor="middle">${MESI[+s.m.slice(5) - 1]}${s.m.slice(5) === '01' || i === 0 ? ' ' + s.m.slice(2, 4) : ''}</text>`;
  });
  const hov = series
    .map(
      (s, i) =>
        `<rect x="${X(i) - iw / (n - 1) / 2}" y="${pt}" width="${iw / (n - 1)}" height="${ih}" fill="transparent" data-tip="${ymLabel(s.m)}\nValore ${eur0(s.value)}${s.approx ? ' (stimato)' : ''}\nVersato ${eur0(s.invested)}\n${s.value - s.invested >= 0 ? '+' : ''}${eur0(s.value - s.invested)}"/>`
    )
    .join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" class="chart" style="display:block"><defs><linearGradient id="hg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--s-blue)" stop-opacity=".35"/><stop offset="1" stop-color="var(--s-blue)" stop-opacity="0"/></linearGradient></defs>${g}
   <path d="${pth(s => s.value)}L${X(n - 1)},${pt + ih}L${X(0)},${pt + ih}Z" fill="url(#hg1)"/><path d="${pth(s => s.invested)}" fill="none" stroke="var(--tx2)" stroke-width="2" stroke-dasharray="5 5"/><path d="${pth(s => s.value)}" fill="none" stroke="var(--s-blue)" stroke-width="2.6" stroke-linejoin="round"/>${hov}</svg>`;
}

/**
 * Summary of a list of trades: open/closed positions valued at current prices,
 * money in and out, dividends and the annual return (XIRR).
 * Used by the history view and by the report.
 */
function histSummary(T, portfolio = invPf) {
  const b = EN.tradeBook(T),
    P = Object.values(b.pos),
    now = {};
  for (const p of P) {
    const h = keyHold(p.key);
    if (h && h.price > 0) now[p.key] = h.price;
  }
  const open = P.filter(p => !p.closed),
    closed = P.filter(p => p.closed);
  const val = open.reduce((s, p) => s + p.qty * (now[p.key] || p.avg), 0);
  const bought = P.reduce((s, p) => s + p.bought, 0),
    sold = P.reduce((s, p) => s + p.sold, 0),
    net = bought - sold;
  const divs =
    portfolio == null || portfolio === ''
      ? S.tx.filter(t => t.cat === 'Dividendi e cedole' && t.amount > 0)
      : [];
  const divTot = divs.reduce((s, t) => s + t.amount, 0);
  const gain = val + sold + divTot - bought;
  const flows = T.map(t => ({ date: t.date, amount: t.side === 'buy' ? -t.amount : t.amount })).concat(
    divs.map(t => ({ date: t.date, amount: t.amount })),
    [{ date: today(), amount: val }]
  );
  const irr = EN.xirr(flows);
  return { b, P, now, open, closed, val, bought, sold, net, divs, divTot, gain, irr };
}

/** Investment history view: value vs invested, XIRR, per-holding results. */
function vInvHist() {
  const T = histScope();
  if (!T.length)
    return `<div class="card"><div class="empty" style="line-height:1.7">Nessuna operazione ancora.<br>Il modo migliore: importa i <b>movimenti del dossier titoli</b> della banca (in Fineco: <i>Movimenti dossier titoli → Esporta</i>), che contengono anche gli ISIN.<br>In alternativa l'<b>estratto conto</b> da <i>Movimenti → Importa</i>: le righe di compravendita diventano operazioni da sole.<div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-top:10px"><label class="btn sm">⇪ Importa operazioni<input type="file" id="pfcsv" accept=".xlsx,.xls,.csv,.txt" hidden></label><button class="btn sm pri" data-act="tr-add">+ Operazione a mano</button></div></div></div>`;
  const { b, P, now, open, closed, val, bought, sold, net, divs, gain, irr } = histSummary(T);
  const yr = today().slice(0, 4);
  const realY = {};
  for (const r of b.realized) {
    const y = r.date.slice(0, 4);
    realY[y] = (realY[y] || 0) + r.gain;
  }
  const series = EN.historySeries(T, PHIST, now, today()),
    approx = series.some(s => s.approx);
  if (!PHIST_AT && perm('quotes') && !OFFLINE) setTimeout(() => loadPriceHistory(false), 50);
  const mism = open
    .map(p => ({ p, h: keyHold(p.key) }))
    .filter(x => x.h && Math.abs(x.h.qty - x.p.qty) > 1e-6);
  const unmapped = [
    ...new Set(
      T.filter(
        t => t.src !== 'manual' && !t.isin && !(S.trMap || {})[t.name] && b.pos[t.key] && !b.pos[t.key].closed
      ).map(t => t.name)
    )
  ];
  const noTrades = hsScope().filter(h => !P.some(p => p.key === 'h:' + h.id));
  const pct = v => (v >= 0 ? '+' : '') + v.toFixed(1).replace('.', ',') + '%';
  const kpi = (l, v, f, cls = '') =>
    `<div class="card kpi sens"><div class="lbl">${l}</div><div class="val num ${cls}">${v}</div><div class="hint">${f}</div></div>`;
  return `<div class="grid g4">
   ${kpi('Valore attuale', eur0(val), `${open.length} posizioni aperte`)}
   ${kpi('Versato netto', eur0(net), `comprato ${eur0(bought)} · venduto ${eur0(sold)}`)}
   ${kpi('Guadagno totale', (gain >= 0 ? '+' : '') + eur0(gain), net > 0 ? pct((gain / bought) * 100) + ' su quanto comprato' : '', gain >= 0 ? 'up' : 'down')}
   ${kpi('Rendimento annuo', irr == null ? '—' : pct(irr * 100), 'tiene conto di quando hai versato (XIRR)', irr >= 0 ? 'up' : 'down')}
  </div>
  ${
    mism.length || unmapped.length
      ? `<div class="card" style="margin-top:14px;border-color:var(--warn)"><b>Da controllare</b><div class="hint" style="line-height:1.6;margin-top:4px">${unmapped.length ? `${unmapped.length} titoli dell'estratto conto non sono abbinati a una posizione: ${unmapped.map(esc).join(', ')}. ` : ''}${mism.map(x => `${esc(x.h.name)}: le operazioni danno ${x.p.qty}, il portafoglio ${x.h.qty}.`).join(' ')}</div><button class="btn sm" data-act="tr-map" style="margin-top:8px">Abbina i titoli</button></div>`
      : `<div class="hint" style="margin:10px 2px 0"><span class="chip c-good">✓ Quadra</span> le quantità ricostruite dalle operazioni corrispondono al portafoglio.</div>`
  }
  <div class="card sens" style="margin-top:14px"><div class="card-h"><div><h3>Valore e capitale versato</h3><div class="hint">Linea piena: valore a fine mese · tratteggio: quanto hai versato${approx ? ' · alcuni mesi stimati al costo (prezzi storici mancanti)' : ''}</div></div><button class="btn sm" data-act="ph-load">↻ Prezzi storici</button></div>${histChart(series)}</div>
  <div class="grid g2" style="margin-top:14px">
   <div class="card sens"><h3>Per titolo</h3><table class="tbl"><thead><tr><th>Titolo</th><th class="r">Op.</th><th class="r">Q.tà</th><th class="r">PMC</th><th class="r">Risultato</th></tr></thead><tbody>${open
     .sort((a, c) => c.cost - a.cost)
     .map(p => {
       const v = p.qty * (now[p.key] || p.avg),
         g = v - p.cost + p.realized;
       return `<tr><td>${esc(keyName(p.key))}<div class="hint">dal ${dLabel(p.first)}</div></td><td class="r num">${p.buys + p.sells}</td><td class="r num">${String(+p.qty.toFixed(4)).replace('.', ',')}</td><td class="r num">${eur(p.avg)}</td><td class="r num ${g >= 0 ? 'up' : 'down'}">${g >= 0 ? '+' : ''}${eur0(g)}<div class="hint">${p.cost ? pct(((v - p.cost) / p.cost) * 100) : ''}</div></td></tr>`;
     })
     .join('')}</tbody></table></div>
   <div class="card sens"><h3>Plus e minusvalenze realizzate</h3>${
     Object.keys(realY).length
       ? `<table class="tbl"><tbody>${Object.entries(realY)
           .sort((a, c) => (c[0] < a[0] ? -1 : 1))
           .map(
             ([y, g]) =>
               `<tr><td><b>${y}</b></td><td class="r num ${g >= 0 ? 'up' : 'down'}">${g >= 0 ? '+' : ''}${eur(g)}</td></tr>`
           )
           .join(
             ''
           )}</tbody></table><p class="hint" style="margin-top:8px;line-height:1.5">Calcolate col costo medio ponderato, commissioni incluse. In regime amministrato le imposte le trattiene la banca; le minusvalenze da ETF finiscono nello zainetto.</p>`
       : '<div class="empty">Nessuna vendita ancora</div>'
   }
    ${closed.length ? `<h3 style="margin-top:16px">Posizioni chiuse</h3><table class="tbl"><tbody>${closed.map(p => `<tr><td>${esc(keyName(p.key))}<div class="hint">${dLabel(p.first)} → ${dLabel(p.last)}</div></td><td class="r num">${eur0(p.bought)} → ${eur0(p.sold)}</td><td class="r num ${p.realized >= 0 ? 'up' : 'down'}">${p.realized >= 0 ? '+' : ''}${eur(p.realized)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${
      divs.length
        ? `<h3 style="margin-top:16px">Dividendi e cedole incassati</h3><table class="tbl"><tbody>${Object.entries(
            divs.reduce((m, t) => {
              const y = t.date.slice(0, 4);
              m[y] = (m[y] || 0) + t.amount;
              return m;
            }, {})
          )
            .sort((a, c) => (c[0] < a[0] ? -1 : 1))
            .map(([y, v]) => `<tr><td><b>${y}</b></td><td class="r num up">+${eur(v)}</td></tr>`)
            .join('')}</tbody></table>`
        : ''
    }</div>
  </div>
  <div class="card sens" style="margin-top:14px"><div class="card-h"><div><h3>Operazioni</h3><div class="hint">${T.length} operazioni${realY[yr] != null ? ` · realizzato ${yr}: ${eur(realY[yr])}` : ''}${noTrades.length ? ` · ${noTrades.length} posizioni senza operazioni non sono incluse` : ''}</div></div><div style="display:flex;gap:6px;flex-wrap:wrap"><label class="btn sm">⇪ Importa operazioni<input type="file" id="pfcsv" accept=".xlsx,.xls,.csv,.txt" hidden></label><button class="btn sm" data-act="tr-map">Abbina</button><button class="btn sm pri" data-act="tr-add">+ Operazione</button></div></div>
   <div class="list">${[...T]
     .sort((a, c) => (c.date < a.date ? -1 : 1))
     .slice(0, trAll ? 1e4 : 10)
     .map(
       t =>
         `<div class="row" ${t.src === 'manual' ? `data-act="tr-edit" data-id="${t.id}"` : 'style="cursor:default"'}><div class="av">${t.side === 'buy' ? '↑' : '↓'}</div><div class="main"><div class="t1">${t.side === 'buy' ? 'Acquisto' : 'Vendita'} · ${esc(keyName(t.key))}</div><div class="t2">${dLabel(t.date)} · ${String(t.qty).replace('.', ',')} × ${eur(t.amount / t.qty)}${t.src === 'manual' ? ' · a mano' : ''}</div></div><div class="amt num ${t.side === 'sell' ? 'up' : ''}">${t.side === 'buy' ? '−' : '+'}${eur(t.amount)}</div></div>`
     )
     .join('')}</div>
   ${T.length > 10 ? `<button class="btn sm" data-act="tr-all" style="margin-top:10px">${trAll ? 'Mostra solo le ultime 10' : 'Mostra tutte (' + T.length + ')'}</button>` : ''}</div>`;
}

function trForm(t) {
  const isNew = !t;
  t = t || { date: today(), side: 'buy', qty: '', amount: '', hid: (S.holdings[0] || {}).id };
  if (!S.holdings.length) return toast('Aggiungi prima la posizione in Investimenti');
  openForm(
    isNew ? 'Nuova operazione' : 'Operazione',
    [
      {
        k: 'side',
        label: 'Tipo',
        type: 'select',
        v: t.side,
        options: [
          ['buy', 'Acquisto'],
          ['sell', 'Vendita']
        ]
      },
      { k: 'hid', label: 'Titolo', type: 'select', v: t.hid, options: S.holdings.map(h => [h.id, h.name]) },
      { k: 'date', label: 'Data', type: 'date', v: t.date },
      { k: 'qty', label: 'Quantità', v: t.qty, ph: 'es. 10' },
      { k: 'amount', label: 'Importo totale (€, commissioni incluse)', v: t.amount, ph: 'es. 1.002,95' }
    ],
    d => {
      const qty = num(d.qty),
        amount = Math.abs(num(d.amount));
      if (!(qty > 0) || !(amount > 0)) return toast('Quantità e importo devono essere maggiori di zero');
      const o = {
        id: isNew ? 'tm_' + uid() : t.id,
        date: d.date || today(),
        side: d.side,
        qty,
        amount: r2(amount),
        hid: d.hid,
        src: 'manual'
      };
      S.trades = S.trades || [];
      if (isNew) S.trades.push(o);
      else S.trades = S.trades.map(x => (x.id === o.id ? o : x));
      save();
      renderView();
      toast('Operazione salvata');
    },
    isNew
      ? null
      : () => {
          S.trades = S.trades.filter(x => x.id !== t.id);
          save();
          renderView();
          toast('Operazione eliminata');
        }
  );
}

function trMapForm() {
  const names = [...new Set((S.trades || []).filter(t => t.src !== 'manual' && !t.isin).map(t => t.name))];
  if (!names.length)
    return toast(
      (S.trades || []).length
        ? 'Tutte le operazioni sono abbinate per ISIN'
        : 'Nessuna operazione da abbinare'
    );
  const b = EN.tradeBook(
    S.trades.filter(t => t.src !== 'manual' && !t.isin).map(t => ({ ...t, key: t.name }))
  );
  openForm(
    'Abbina i titoli',
    names.map((n, i) => ({
      k: 'm' + i,
      label: `${n} · ${String(+b.pos[n].qty.toFixed(4)).replace('.', ',')} quote${b.pos[n].closed ? ' (chiusa)' : ''}`,
      type: 'select',
      v: (S.trMap || {})[n] || '',
      options: [
        ['', '— nessuna (posizione chiusa o di un altro conto)'],
        ...S.holdings.map(h => [h.id, h.name + ' · ' + h.qty])
      ]
    })),
    d => {
      S.trMap = S.trMap || {};
      names.forEach((n, i) => (S.trMap[n] = d['m' + i] || ''));
      save();
      renderView();
      toast('Abbinamenti salvati');
    },
    null,
    '<p class="hint" style="line-height:1.6">La banca usa nomi abbreviati: qui scegli a quale posizione corrisponde ciascuno. L\'app li abbina da sola confrontando quantità e costo; correggi solo se serve.</p>'
  );
}

/* ---------- Broker securities movements (e.g. Fineco "Movimenti Dossier Titoli"): trades with ISIN ---------- */
// same trade seen from two sources: the bank statement uses the value date, the broker export also the execution date
/** True when a bank trade and a broker trade are the same operation (±4 days). */
const sameTrade = (a, b) =>
  a.side === b.side &&
  Math.abs(a.qty - b.qty) < 1e-6 &&
  Math.abs(a.amount - b.amount) < 0.015 &&
  [a.date, a.vdate].some(x => x && [b.date, b.vdate].some(y => y && Math.abs(dDiff(x, y)) <= 4));

/** Recognises a broker "securities movements" export and reads its trades. */
function dossierRows(sheets) {
  for (const rows of sheets) {
    for (let i = 0; i < Math.min(rows.length, 40); i++) {
      const h = rows[i].map(x =>
        String(x || '')
          .toLowerCase()
          .trim()
      );
      const ci = h.findIndex(x => x === 'isin' || x === 'codice isin'),
        qi = h.findIndex(x => /^quantit|^q\.t[àa]|^nominale/.test(x)),
        si = h.findIndex(x => /^segno$|^tipo operazione$|^acquisto\/vendita$|^segno operazione$/.test(x)),
        vi = h.findIndex(x => /^controvalore|^importo/.test(x));
      if (ci < 0 || qi < 0 || si < 0 || vi < 0) continue;
      const f = re => h.findIndex(x => re.test(x));
      const col = {
        isin: ci,
        qty: qi,
        side: si,
        val: vi,
        date: f(/^(data )?operazione$|^data$|^data esecuzione/),
        vdate: f(/valuta/),
        name: f(/^titolo$|^descrizione titolo|^strumento$|^nome/),
        price: f(/^prezzo/),
        cur: f(/^divisa|^valuta titolo/),
        fx: f(/^cambio/)
      };
      if (col.date < 0) col.date = col.vdate;
      if (col.date < 0) continue;
      const out = [];
      let skip = 0;
      for (const r of rows.slice(i + 1)) {
        const isin = String(r[ci] || '')
            .trim()
            .toUpperCase(),
          sg = String(r[si] || '')
            .trim()
            .toUpperCase(),
          date = parseDate(r[col.date] || '');
        const side = /^(A|ACQ|ACQUISTO|BUY|B)$/.test(sg)
          ? 'buy'
          : /^(V|VEN|VENDITA|SELL|S)$/.test(sg)
            ? 'sell'
            : null;
        const qty = Math.abs(num(r[qi])),
          cv = Math.abs(num(r[vi]));
        if (!date || !side || !(qty > 0) || !(cv > 0) || !/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin)) {
          if (date) skip++;
          continue;
        }
        const cur =
            col.cur >= 0
              ? String(r[col.cur] || 'EUR')
                  .trim()
                  .toUpperCase()
              : 'EUR',
          fx = col.fx >= 0 ? num(r[col.fx]) : 1;
        const amount = cur !== 'EUR' && fx > 0 && fx !== 1 ? cv / fx : cv;
        out.push({
          date,
          vdate: col.vdate >= 0 ? parseDate(r[col.vdate] || '') || date : date,
          side,
          qty,
          amount: r2(amount),
          isin,
          name:
            (col.name >= 0 ? String(r[col.name] || '') : '').replace(/\s+/g, ' ').trim().slice(0, 60) || isin,
          price: col.price >= 0 ? num(r[col.price]) : 0,
          fxApprox: cur !== 'EUR' && fx !== 1
        });
      }
      if (out.length) return { items: out, skip };
    }
  }
  return null;
}

function dossierPlan(items) {
  const T = S.trades || [],
    used = new Set(),
    plan = items.map(() => ({ kind: 'new' }));
  items.forEach((d, i) => {
    const t = T.find(x => !used.has(x.id) && x.isin === d.isin && sameTrade(x, d));
    if (t) {
      used.add(t.id);
      plan[i] = { kind: 'have', t };
    }
  });
  items.forEach((d, i) => {
    if (plan[i].kind !== 'new') return;
    const t = T.find(x => !used.has(x.id) && !x.isin && x.src !== 'manual' && sameTrade(x, d));
    if (t) {
      used.add(t.id);
      plan[i] = { kind: 'enrich', t };
    }
  });
  return plan;
}

function showDossierImport(res) {
  pendingDossier = res.items;
  const plan = dossierPlan(res.items),
    n = k => plan.filter(p => p.kind === k).length;
  const dates = res.items.map(x => x.date).sort(),
    isins = new Set(res.items.map(x => x.isin));
  const inPf = [...isins].filter(i => S.holdings.some(h => h.isin === i)).length;
  openForm(
    'Importa operazioni titoli',
    [],
    () => {
      const pl = dossierPlan(pendingDossier);
      let a = 0,
        e = 0,
        k = 0;
      S.trades = S.trades || [];
      const seen = {};
      pendingDossier.forEach((d, i) => {
        const p = pl[i];
        if (p.kind === 'have') {
          k++;
          return;
        }
        if (p.kind === 'enrich') {
          Object.assign(p.t, { isin: d.isin, vdate: d.vdate, date: d.date, price: d.price || p.t.price });
          e++;
          return;
        }
        const base =
          'td_' + d.isin + '_' + d.date + '_' + d.side + '_' + d.qty + '_' + Math.round(d.amount * 100);
        seen[base] = (seen[base] || 0) + 1;
        S.trades.push({
          id: base + (seen[base] > 1 ? '_' + seen[base] : ''),
          date: d.date,
          vdate: d.vdate,
          side: d.side,
          qty: d.qty,
          amount: d.amount,
          name: d.name,
          isin: d.isin,
          price: d.price,
          src: 'dossier'
        });
        a++;
      });
      save();
      invTab = 'hist';
      go('investimenti');
      toast(
        `${a} operazioni aggiunte` +
          (e ? ` · ${e} completate con ISIN` : '') +
          (k ? ` · ${k} già presenti` : '')
      );
    },
    null,
    `<p class="hint" style="line-height:1.6;margin-bottom:8px"><span class="chip c-info">Movimenti dossier titoli</span><br>Trovate <b style="color:var(--tx)">${res.items.length}</b> operazioni (${res.items.filter(x => x.side === 'buy').length} acquisti, ${res.items.filter(x => x.side === 'sell').length} vendite) dal ${dLabel(dates[0])} al ${dLabel(dates[dates.length - 1])}, su ${isins.size} titoli (${inPf} nel portafoglio, abbinati per ISIN).<br>
   ${n('new') ? `<b style="color:var(--tx)">${n('new')}</b> nuove · ` : ''}${n('enrich') ? `<b style="color:var(--tx)">${n('enrich')}</b> già ricavate dall'estratto conto, verranno completate con ISIN e data di esecuzione · ` : ''}${n('have') ? `<b style="color:var(--tx)">${n('have')}</b> già importate · ` : ''}${res.skip ? `${res.skip} righe non di compravendita ignorate · ` : ''}i movimenti del conto non vengono toccati.${res.items.some(x => x.fxApprox) ? '<br>Alcuni importi in valuta estera sono convertiti con il cambio indicato nel file.' : ''}</p>`
  );
}
