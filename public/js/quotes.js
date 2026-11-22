/*
 * EyeCash · public/js/quotes.js
 *
 * Automatic prices for investments. The server fetches prices from public
 * sources (only tickers/ISINs leave, mixed with decoys); this file asks for them,
 * shows their freshness and lets you link a holding to the right listing.
 */
/* ---------- automatic prices ---------- */
const fmtTime = t => {
  if (!t) return '';
  const d = new Date(t);
  const td = today() === ds(d);
  return (
    (td ? 'oggi' : d.getDate() + ' ' + MESI[d.getMonth()]) +
    ' ' +
    pad(d.getHours()) +
    ':' +
    pad(d.getMinutes())
  );
};

function autoQuotes() {
  if (S && !S.demo && perm('quotes') && (!S.quotesAt || Date.now() - S.quotesAt > 36e5)) refreshQuotes(false);
}

/** Asks the server for fresh prices of linked holdings and applies them. */
async function refreshQuotes(manual) {
  if (quotesBusy || !S || S.demo) return;
  if (!perm('quotes')) {
    if (manual) toast('Quotazioni spente: attivale in Impostazioni → Privacy');
    return;
  }
  const hs = S.holdings.filter(h => h.qSym && h.autoPrice !== false);
  if (!hs.length) {
    if (manual) toast('Nessun titolo collegato: usa “Collega quotazione” su una posizione');
    return;
  }
  quotesBusy = true;
  if (manual) toast('Aggiorno i prezzi…');
  const key = hs
    .map(h => h.qSym)
    .sort()
    .join(',');
  if (S.qLogKey !== key || !S.qLogDay || S.qLogDay !== today()) {
    logAI(
      'Quotazioni',
      `Simboli richiesti: ${key}${hs.some(h => h.isin && (h.type === 'ETF' || h.type === 'Fondi')) ? ' e ISIN degli ETF (seconda fonte justETF)' : ''} (+ titoli comuni di copertura). Nessuna quantità o valore.`
    );
    S.qLogKey = key;
    S.qLogDay = today();
  }
  try {
    const r = await api('POST', '/api/quotes', {
      items: hs.map(h => ({
        id: h.id,
        symbol: h.qSym,
        type: h.type,
        ...((h.type === 'ETF' || h.type === 'Fondi') && h.isin ? { isin: h.isin } : {})
      }))
    });
    let upd = 0,
      flag = 0,
      err = 0;
    for (const q of r.results || []) {
      const h = S.holdings.find(x => x.id === q.id);
      if (!h) continue;
      if (!q.ok) {
        h.qErr = q.error;
        h.qErrAt = Date.now();
        err++;
        continue;
      }
      h.qErr = null;
      const info = {
        priceEur: q.priceEur,
        time: q.time,
        source: q.source,
        check: q.check,
        check2: q.check2,
        exchange: q.exchange,
        currency: q.currency,
        native: q.priceNative,
        stale: q.stale,
        warn: q.warn
      };
      const jump = h.price > 0 ? Math.abs(q.priceEur - h.price) / h.price : 0,
        lim = h.type === 'Crypto' ? 0.4 : 0.2,
        reasons = [];
      if (q.check === 'mismatch')
        reasons.push(
          `Le fonti non concordano: ${q.source} ${eur(q.priceEur)} · ${q.check2.source} ${eur(q.check2.priceEur)}`
        );
      if (q.stale) reasons.push('Il prezzo non si aggiorna da giorni: titolo sospeso o simbolo sbagliato?');
      if (h.confirmed && jump > lim)
        reasons.push(`Variazione del ${Math.round(jump * 100)}% rispetto all'ultimo prezzo`);
      if (!h.confirmed) reasons.push('Primo prezzo: confrontalo con il tuo broker');
      if (reasons.length) {
        h.pending = { ...info, reasons };
        flag++;
      } else {
        Object.assign(h, {
          price: q.priceEur,
          priceAt: q.time,
          priceSrc: q.source,
          priceCheck: q.check,
          priceCur: q.currency,
          priceNative: q.priceNative,
          priceExch: q.exchange || h.priceExch,
          pending: null
        });
        upd++;
      }
    }
    S.quotesAt = Date.now();
    save();
    render();
    if (manual || flag || err)
      toast(
        `Prezzi: ${upd} aggiornati${flag ? ` · ${flag} da verificare` : ''}${err ? ` · ${err} non trovati` : ''}`
      );
  } catch (e) {
    if (manual) toast(e.message);
  } finally {
    quotesBusy = false;
  }
}

function quoteBadge(h) {
  if (h.pending) return `<span class="chip c-warn">! Da verificare</span>`;
  if (h.qErr) return `<span class="chip c-crit">✕ Prezzo non trovato</span>`;
  if (h.qSym && h.priceSrc)
    return `<span class="chip ${h.priceCheck === 'two' ? 'c-good' : 'c-info'}">${h.priceCheck === 'two' ? '✓ 2 fonti' : '✓ 1 fonte'}</span>`;
  if (h.qSym) return `<span class="chip c-mut">In attesa</span>`;
  return `<span class="chip c-mut">Manuale</span>`;
}

function quoteLine(h) {
  if (h.qSym)
    return `${esc(h.qSym)}${h.priceExch ? ' · ' + esc(h.priceExch) : ''}${h.priceAt ? ' · ' + fmtTime(h.priceAt) : ''}${h.priceSrc && h.priceSrc !== h.priceExch ? ' · ' + esc(h.priceSrc) : ''}`;
  return 'Prezzo inserito a mano';
}

function reviewQuote(id) {
  const h = S.holdings.find(x => x.id === id);
  if (!h) return;
  if (!h.pending) {
    if (h.qErr) {
      toast(h.qErr);
    }
    return holdForm(h);
  }
  const p = h.pending;
  openForm(
    'Verifica prezzo · ' + esc(h.name),
    [],
    () => {},
    null,
    `
   <div class="bcard" style="margin-bottom:12px"><div class="k"><span>${esc(h.qSym)} · ${esc(p.exchange || '')}</span><span class="chip c-info">${esc(p.currency || '')}</span></div>
     <div class="v num">${eur(p.priceEur)} <small>${p.currency && p.currency !== 'EUR' ? '(' + esc(String(p.native)) + ' ' + esc(p.currency) + ')' : ''}</small></div>
     <div class="f"><span>${esc(p.source)} · ${fmtTime(p.time)}</span><span>attuale ${eur(h.price)}</span></div></div>
   <ul class="hint" style="line-height:1.6;margin:0 0 10px 18px">${p.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
   ${p.check2 ? `<p class="hint">Controllo: ${esc(p.check2.source)} ${eur(p.check2.priceEur)}</p>` : ''}
   <p class="hint" style="line-height:1.6;margin:8px 0 4px">Confronta con il prezzo che vedi nel tuo broker. Se corrisponde, conferma: i prossimi aggiornamenti saranno automatici.</p>
   <div style="display:flex;gap:8px;margin-top:10px"><button type="button" class="btn pri" data-act="q-accept" data-id="${h.id}" style="flex:1;justify-content:center">✓ Corrisponde, usa questo prezzo</button></div>
   <div style="display:flex;gap:8px;margin-top:8px"><button type="button" class="btn" data-act="q-reject" data-id="${h.id}" style="flex:1;justify-content:center">Ignora</button><button type="button" class="btn" data-act="q-link" data-id="${h.id}" style="flex:1;justify-content:center">Scegli un altro listino</button></div>`
  );
  document.querySelector('#frm .btns').style.display = 'none';
}

/** Search sheet to link a holding to a listing (by ISIN, ticker or name). */
function quoteSearch(targetId, q) {
  qTarget = targetId || null;
  qResults = [];
  if (!perm('quotes')) return toast('Quotazioni spente: attivale in Impostazioni → Privacy');
  $('#sheetbox').innerHTML = `<h2>Collega quotazione</h2>
   <p class="hint" style="line-height:1.55;margin-bottom:10px">Cerca per <b style="color:var(--tx)">ISIN</b> (il modo più preciso, lo trovi nel tuo broker), ticker o nome. Poi scegli il listino nella <b style="color:var(--tx)">stessa borsa e valuta</b> del tuo broker.</p>
   <form id="qform" style="display:flex;gap:8px"><input class="inp" id="qq" value="${esc(q || '')}" placeholder="es. IE00B4L5Y983, SWDA, BTC" style="flex:1;font-size:16px" autocomplete="off"><button class="btn pri" type="submit">Cerca</button></form>
   <div id="qres" style="margin-top:12px"></div>
   <div class="btns"><button type="button" class="btn" data-act="close">Chiudi</button></div>`;
  $('#sheet').classList.remove('hidden');
  if (q) doQuoteSearch(q);
}

async function doQuoteSearch(q) {
  const box = $('#qres');
  if (!box) return;
  box.innerHTML = '<div class="hint">Cerco…</div>';
  logAI('Ricerca titolo', 'Testo cercato: ' + q);
  try {
    const r = await api('POST', '/api/quotes/search', { q });
    qResults = r.results || [];
    box.innerHTML = qResults.length
      ? `<div class="list">${qResults.map((x, i) => `<div class="row" data-act="q-pick" data-i="${i}"><div class="main"><div class="t1">${esc(x.symbol)} <span class="hint">· ${esc(x.exchange)}</span></div><div class="t2">${esc(x.name)} · ${esc(x.kind || x.type || '')}</div></div><div style="text-align:right"><div class="amt num">${eur(x.priceEur)}</div><span class="chip ${x.currency === 'EUR' ? 'c-good' : 'c-mut'}">${esc(x.currency || '?')}</span></div></div>`).join('')}</div>`
      : '<div class="empty">Nessun risultato. Prova con l\'ISIN.</div>';
  } catch (e) {
    box.innerHTML = `<div class="hint" style="color:#ff7b7b">${esc(e.message)}</div>`;
  }
}

function pickQuote(i) {
  const x = qResults[i];
  if (!x) return;
  $('#sheetbox').innerHTML = `<h2>Conferma listino</h2>
   <div class="bcard"><div class="k"><span>${esc(x.symbol)} · ${esc(x.exchange)}</span><span class="chip ${x.currency === 'EUR' ? 'c-good' : 'c-mut'}">${esc(x.currency)}</span></div>
   <div style="font-weight:500;margin-top:8px">${esc(x.name)}</div>
   <div class="v num">${eur(x.priceEur)} <small>${x.currency !== 'EUR' ? '(' + esc(String(x.priceNative)) + ' ' + esc(x.currency) + ', cambio BCE)' : ''}</small></div>
   <div class="f"><span>Ultimo prezzo ${fmtTime(x.time)}</span></div></div>
   <p class="hint" style="line-height:1.6;margin:12px 0">È lo stesso prezzo (circa) che vedi nel tuo broker per questo titolo? Se sì, il listino è quello giusto.</p>
   <div class="btns" style="flex-direction:column"><button type="button" class="btn pri" data-act="q-confirm" data-i="${i}">✓ Sì, collega questo</button><button type="button" class="btn" data-act="q-back">No, torna ai risultati</button></div>`;
}

function confirmQuote(i) {
  const x = qResults[i];
  if (!x) return;
  const link = {
    qSym: x.symbol,
    autoPrice: true,
    confirmed: true,
    priceExch: x.exchange,
    priceCur: x.currency,
    price: x.priceEur,
    priceAt: x.time,
    priceSrc: x.type === 'Crypto' ? 'Kraken' : 'Yahoo Finance',
    priceCheck: 'one',
    pending: null,
    qErr: null
  };
  if (qTarget) {
    const h = S.holdings.find(z => z.id === qTarget);
    if (h) {
      Object.assign(h, link);
      if (!h.isin && /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(($('#qq') || {}).value || '')) h.isin = $('#qq').value;
      save();
      closeForm();
      render();
      toast('Quotazione collegata');
      refreshQuotes(false);
      return;
    }
  }
  closeForm();
  holdForm(null, {
    name: x.name,
    ticker: x.symbol.split('.')[0],
    type: x.type || 'ETF',
    price: x.priceEur,
    ...link
  });
}

let quotesBusy = false;

/* listing search: ISIN, ticker or name */
let qResults = [],
  qTarget = null;
