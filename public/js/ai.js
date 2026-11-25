/*
 * EyeCash · public/js/ai.js
 *
 * Optional AI features, all privacy-first:
 * - quick entry ("12 euro pizza") parsed locally first, AI only as a fallback;
 * - the inbox of expenses added from Claude via MCP (end-to-end encrypted);
 * - "Ask your data": the AI only writes a small query recipe, the device runs it
 *   on the real numbers, so amounts and merchants never leave the device.
 */
/* ---------- Privacy: what may be sent to the AI ---------- */
const PRIV_DEF = {
  quick: true,
  categorize: true,
  ask: true,
  chat: true,
  format: true,
  assets: true,
  pdf: false,
  quotes: true
};
const PRIV_INFO = {
  quick: ['Inserimento rapido', 'Invia solo la frase che scrivi o detti (es. “23 € pizzeria ieri”).'],
  ask: [
    'Occhio con AI esterna',
    "Invia solo la domanda che scrivi, i nomi delle categorie e il tipo dei conti (non i nomi). L'AI restituisce un calcolo che il dispositivo esegue: importi e risultati non escono mai. Vale anche per le simulazioni d'acquisto, dove esce solo la frase."
  ],
  chat: [
    'Occhio con AI locale',
    "Solo con un modello AI locale (Ollama sul tuo server o in rete): invia la conversazione e i risultati dei calcoli sui tuoi dati, che restano in casa. Con un'AI esterna il server la rifiuta."
  ],
  categorize: [
    'Categorizzazione spese',
    'Invia solo descrizione e importo dei movimenti appena importati senza categoria.'
  ],
  format: [
    'Riconoscimento formato banca',
    'Invia le intestazioni e poche righe del file, con le cifre degli importi mascherate. Una volta per banca.'
  ],
  assets: [
    'Stima valore dei beni',
    "Invia solo le caratteristiche del bene: modello/anno/km dell'auto, comune/zona/m² della casa (mai l'indirizzo). Con Anthropic l'AI consulta annunci reali sul web."
  ],
  quotes: [
    'Quotazioni automatiche',
    'Invia solo i simboli dei titoli collegati (es. SWDA.MI), mescolati a 3 titoli comuni. Mai quantità, valori o conti.'
  ],
  pdf: [
    'Lettura PDF',
    "Invia l'intero PDF dell'estratto conto (contiene anche saldo e intestatario). Sconsigliato: usa Excel/CSV."
  ]
};
/** True when the user allowed a given privacy permission. */
const perm = k =>
  OFFLINE
    ? false
    : k === 'quotes'
      ? !!(STATUS && STATUS.quotes && S && S.privacy && S.privacy.quotes !== false)
      : !!(AI && S && S.privacy && S.privacy[k] && (k !== 'pdf' || AIPDF));
function logAI(kind, preview) {
  S.aiLog = S.aiLog || [];
  S.aiLog.unshift({ t: Date.now(), k: kind, p: String(preview).slice(0, 300) });
  S.aiLog = S.aiLog.slice(0, 50);
  save();
}

/* ---------- Inbox: expenses added from Claude (encrypted for this app) ---------- */
async function ensureInboxKey() {
  if (!S || S.demo) return;
  if (!S.inboxPriv) {
    const kp = await crypto.subtle.generateKey(
      { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['encrypt', 'decrypt']
    );
    S.inboxPriv = await crypto.subtle.exportKey('jwk', kp.privateKey);
    S.inboxPub = await crypto.subtle.exportKey('jwk', kp.publicKey);
    save();
    clearTimeout(saveT);
    await flushNow();
  }
  await api('PUT', '/api/inbox-key', { jwk: S.inboxPub }).catch(() => {});
}
function matchAccount(h) {
  h = String(h || '')
    .toLowerCase()
    .trim();
  const A = S.accounts;
  if (!h) return A[0].id;
  const byName = A.find(a => a.name.toLowerCase().includes(h) || h.includes(a.name.toLowerCase()));
  if (byName) return byName.id;
  const ty = /carta|card/.test(h)
    ? 'Carta'
    : /contant|cash/.test(h)
      ? 'Contanti'
      : /rispar|deposit/.test(h)
        ? 'Risparmio'
        : 'Conto';
  return (A.find(a => a.type === ty) || A[0]).id;
}
let inboxBusy = false;
/** Fetches expenses added from Claude (MCP), decrypts them and adds them. */
async function pullInbox() {
  if (inboxBusy || !S || S.demo || !S.inboxPriv || OFFLINE) return;
  inboxBusy = true;
  try {
    const r = await api('GET', '/api/inbox');
    if (!r.items.length) return;
    const pk = await crypto.subtle.importKey(
      'jwk',
      S.inboxPriv,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['decrypt']
    );
    const ids = [];
    let n = 0;
    S.inboxSeen = S.inboxSeen || [];
    for (const it of r.items) {
      ids.push(it.id);
      if (S.inboxSeen.includes(it.id)) continue;
      try {
        const o = JSON.parse(it.enc);
        const raw = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, pk, unb64(o.ek));
        const k = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
        const x = JSON.parse(
          td.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv) }, k, unb64(o.ct)))
        );
        const amt = x.type === 'entrata' ? Math.abs(x.amount) : -Math.abs(x.amount);
        const okCat = x.cat && signOk(x.cat, amt);
        if (!S.tx.some(t => t.id === 'm_' + it.id))
          S.tx.push({
            id: 'm_' + it.id,
            date: x.date,
            amount: r2(amt),
            note: x.desc,
            cat: okCat ? x.cat : autoCat(x.desc, amt),
            accountId: matchAccount(x.account),
            src: 'claude'
          });
        n++;
      } catch (e) {}
      S.inboxSeen.push(it.id);
    }
    S.inboxSeen = S.inboxSeen.slice(-500);
    if (n) {
      render();
      toast(`${n} ${n === 1 ? 'movimento aggiunto' : 'movimenti aggiunti'} da Claude`);
    }
    save();
    clearTimeout(saveT);
    await flushNow();
    if (dirty) return;
    await api('POST', '/api/inbox/ack', { ids });
  } catch (e) {
  } finally {
    inboxBusy = false;
  }
}

/* ---------- Quick entry (voice or text) ---------- */
/** Parses a quick entry like "12,50 pizza carta" without any AI. */
function localParse(s) {
  const t = ' ' + s.toLowerCase().replace(/€/g, ' euro ') + ' ';
  const m =
    t.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:€|euro|eur)\b/) || t.match(/(?:^|\s)(\d+(?:[.,]\d{1,2})?)(?=\s)/);
  const amount = m ? num(m[1]) : 0;
  // Italian and English words are both understood, whatever the interface language
  const inc =
    /\b(incassat|ricevut|entrat|stipendio|rimborso|guadagnat|accredit|received|salary|refund|earned|income)/.test(
      t
    );
  const d = new Date();
  if (/altro ?ieri|day before yesterday/.test(t)) d.setDate(d.getDate() - 2);
  else if (/\bieri\b|\byesterday\b/.test(t)) d.setDate(d.getDate() - 1);
  let date = ds(d);
  const dm = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (dm) {
    const y = dm[3] ? (dm[3].length === 2 ? '20' + dm[3] : dm[3]) : String(new Date().getFullYear());
    date = `${y}-${pad(dm[2])}-${pad(dm[1])}`;
  }
  const hint = /\bcarta\b|bancomat|\bcard\b/.test(t) ? 'carta' : /contant|cash/.test(t) ? 'contanti' : null;
  let desc = t
    .replace(m ? m[0] : '', ' ')
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/, ' ')
    .replace(
      /\b(ho|abbiamo)\s+(speso|pagato|comprato|preso|incassato|ricevuto)\b|\b(speso|pagato|pagata|comprato|incassato|ricevuto|segna|aggiungi|registra|spent|paid|bought|received|log|add)\b/g,
      ' '
    )
    .replace(
      /\b(oggi|ieri|altro ?ieri|l'altro ieri|euro|eur|€|con la carta|con carta|col bancomat|bancomat|in contanti|contanti|carta|today|day before yesterday|yesterday|with (the |my )?card|by card|card|in cash|cash)\b/g,
      ' '
    )
    .replace(
      /(^|\s)(da|dal|dalla|al|alla|allo|per|di|il|la|lo|un|una|in|con|a|e|at|for|on|the|of|with|i|we)(?=\s)/g,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();
  desc = desc ? desc.charAt(0).toUpperCase() + desc.slice(1) : '';
  return {
    type: inc ? 'entrata' : 'uscita',
    amount,
    description: desc,
    date,
    category: null,
    account_hint: hint
  };
}
/** A transaction from a sentence: the AI reads only the sentence (if allowed), the device fills the gaps. */
async function entryFromText(q, noAI) {
  let r = null;
  if (!noAI && perm('quick') && !OFFLINE) {
    try {
      logAI('Inserimento rapido', q);
      r = await api('POST', '/api/ai/parse-entry', { text: q });
    } catch (e) {
      r = null;
    }
  }
  const L = localParse(q);
  if (!r) r = L;
  if (!r.amount && L.amount) r.amount = L.amount;
  if (!r.account_hint) r.account_hint = L.account_hint;
  const sign = r.type === 'entrata' ? 1 : -1;
  const note = r.description || L.description;
  return {
    amount: sign * (r.amount || 0),
    note,
    date: r.date || today(),
    cat: r.category && signOk(r.category, sign) ? r.category : autoCat(note, sign),
    accountId: matchAccount(r.account_hint)
  };
}
/** Quick entry: local parsing first, AI only if allowed and needed. */
function quickAdd() {
  const useAI = perm('quick') && !OFFLINE;
  openForm(
    'Aggiungi movimento',
    [
      {
        k: 'q',
        label: 'Scrivi o detta (es. “ieri 23,50 pizzeria con la carta”)',
        v: '',
        ph: 'Cosa hai speso?'
      }
    ],
    async d => {
      const q = (d.q || '').trim();
      if (!q) return txForm();
      txForm(null, await entryFromText(q));
    },
    null,
    `<div style="display:flex;gap:8px;margin:-4px 0 6px"><button type="button" class="btn" data-act="mic" id="micbtn">${svgI('mic')}<span>Detta</span></button><button type="button" class="btn ghost" data-act="manual-tx">Inserimento manuale</button></div>
  <p class="hint" style="line-height:1.5">${useAI ? "La frase viene interpretata dall'AI (solo la frase, nient'altro). Controlli tutto prima di salvare." : 'Riconoscimento locale: nessun dato esce dal server.'} Puoi anche usare il microfono della tastiera dell'iPhone.</p>`
  );
}
let rec = null;
/** Dictation into the quick entry, or into the Eye when its input is on screen. */
function startMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const occ = document.querySelector('#occq');
  const inp = occ || document.querySelector('#frm input[name=q]');
  if (!SR) {
    toast("Usa il tasto microfono della tastiera dell'iPhone");
    inp && inp.focus();
    return;
  }
  if (rec) {
    rec.stop();
    return;
  }
  rec = new SR();
  rec.lang = LANG === 'en' ? 'en-US' : 'it-IT';
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  const b = $('#micbtn');
  if (b) b.lastChild.textContent = 'In ascolto…';
  document.body.classList.add('orb-listen');
  rec.onresult = e => {
    let s = '';
    for (const r of e.results) s += r[0].transcript;
    if (inp) inp.value = s;
  };
  rec.onend = () => {
    rec = null;
    document.body.classList.remove('orb-listen');
    const b = $('#micbtn');
    if (b) b.lastChild.textContent = 'Detta';
    if (inp && inp.value.trim())
      document.querySelector(occ ? '#occform button[type=submit]' : '#frm button[type=submit]').click();
  };
  rec.onerror = () => {
    toast('Microfono non disponibile: usa quello della tastiera');
  };
  try {
    rec.start();
  } catch (e) {
    rec = null;
  }
}

/* ---------- Ask your data: the AI writes only the recipe, the device does the maths ---------- */
const accAliases = () =>
  S.accounts.map((a, i) => ({ alias: 'conto_' + (i + 1), type: a.type || 'Conto', id: a.id }));
function askCtx() {
  const al = {},
    nm = {};
  accAliases().forEach(a => {
    al[a.alias] = a.id;
  });
  S.accounts.forEach(a => (nm[a.id] = a.name));
  const pf = k => pfName(k || '');
  return {
    tx: S.tx,
    neutral: NEUTRAL_CATS,
    accAlias: al,
    accName: nm,
    today: today(),
    holdings: S.holdings.map(h => ({
      name: h.name,
      cls: hCls(h),
      clsLabel: clsLabel(hCls(h)),
      pfName: pf(h.pf),
      value: h.qty * h.price,
      cost: h.qty * h.avg
    }))
  };
}
const ASK_FMT = {
  eur: v => eur(v),
  signed: v => (v >= 0 ? '+' : '−') + eur(Math.abs(v)),
  pct: v => v.toFixed(1).replace('.', DEC) + '%',
  signedPct: v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1).replace('.', DEC) + '%',
  n: v => String(Math.round(v * 10) / 10).replace('.', DEC)
};
/** Ready-made questions for "Ask your data", computed without AI. */
function quickAsks() {
  const t = today(),
    y = t.slice(0, 4),
    cur = t.slice(0, 7),
    last = EN.ymAdd(cur, -1),
    first12 = EN.ymAdd(cur, -12) + '-01';
  const endOf = k => {
    const d = new Date(+k.slice(0, 4), +k.slice(5), 0);
    return ds(d);
  };
  const Q = o =>
    Object.assign(
      {
        id: 'a',
        source: 'movimenti',
        measure: 'totale',
        type: 'uscite',
        group: 'nessuno',
        categories: [],
        accounts: [],
        text: '',
        from: null,
        to: null,
        limit: 10,
        order: 'desc'
      },
      o
    );
  return [
    [
      'Quanto spendo in media al mese per categoria?',
      {
        title: 'Spesa media mensile per categoria',
        queries: [
          Q({ measure: 'media_mensile', group: 'categoria', from: first12, to: endOf(last), limit: 12 })
        ],
        answer:
          'Negli ultimi 12 mesi chiusi spendi in media {a} al mese; la voce più pesante è {a.top} ({a.top_value} al mese).',
        chart: { query: 'a', kind: 'barre' }
      }
    ],
    [
      'Questo mese rispetto al mese scorso',
      {
        title: 'Questo mese e il mese scorso',
        queries: [
          Q({ from: cur + '-01', to: t }),
          Q({ id: 'b', from: last + '-01', to: endOf(last) }),
          Q({ id: 'c', from: cur + '-01', to: t, group: 'categoria', limit: 6 })
        ],
        answer:
          'Questo mese hai speso finora {a}; il mese scorso in tutto {b} ({change:a:b}). La voce principale di questo mese è {c.top} ({c.top_value}).',
        chart: { query: 'c', kind: 'barre' }
      }
    ],
    [
      "Dove spendo di più quest'anno?",
      {
        title: 'Esercenti principali ' + y,
        queries: [Q({ group: 'esercente', from: y + '-01-01', to: t, limit: 10 })],
        answer: "Quest'anno il primo è {a.top} con {a.top_value}; in totale hai speso {a}.",
        chart: { query: 'a', kind: 'barre' }
      }
    ],
    [
      'Entrate e uscite mese per mese',
      {
        title: 'Ultimi 12 mesi',
        queries: [
          Q({ group: 'mese', from: first12, to: endOf(last) }),
          Q({ id: 'b', type: 'entrate', group: 'mese', from: first12, to: endOf(last) })
        ],
        answer:
          'Negli ultimi 12 mesi chiusi: entrate {b}, uscite {a}, risparmio {diff:b-a} ({pct:a/b} delle entrate è andato in spese).',
        chart: { query: 'a', kind: 'linea' }
      }
    ],
    [
      'In che giorno della settimana spendo di più?',
      {
        title: 'Spesa per giorno della settimana',
        queries: [Q({ group: 'giorno_settimana', from: first12, to: t })],
        answer: 'Il giorno più caro è il {a.top}: {a.top_value} negli ultimi 12 mesi.',
        chart: { query: 'a', kind: 'barre' }
      }
    ],
    [
      'Come è diviso il mio portafoglio?',
      {
        title: 'Portafoglio per classe',
        queries: [Q({ source: 'investimenti', measure: 'valore', group: 'classe' })],
        answer: 'Il portafoglio vale {a}; la classe principale è {a.top} con {a.top_value}.',
        chart: { query: 'a', kind: 'torta' }
      }
    ]
  ];
}
const Q_MEASURES = {
  totale: 'Totale',
  media_mensile: 'Media al mese',
  conteggio: 'Numero',
  media: 'Media per movimento',
  massimo: 'Massimo',
  minimo: 'Minimo'
};
const Q_HOLD_MEASURES = { valore: 'Valore', costo: 'Costo', guadagno: 'Guadagno', conteggio: 'Numero' };
const Q_TYPES = {
  entrate: 'entrate',
  saldo: 'entrate meno uscite',
  tutti: 'entrate e uscite',
  uscite: 'uscite'
};
/** One-line description of a query, shown under "Come è stato calcolato". */
function describeQ(q) {
  const by = q.group !== 'nessuno' ? ' · ' + t('per {g}', { g: t(q.group.replace('_', ' ')) }) : '';
  if (q.source === 'investimenti') return t('{m} delle posizioni', { m: t(Q_HOLD_MEASURES[q.measure]) }) + by;
  const parts = [
    t('{m} delle {type}', { m: t(Q_MEASURES[q.measure]), type: t(Q_TYPES[q.type] || 'uscite') })
  ];
  if (q.categories.length)
    parts.push(t('categorie: {list}', { list: q.categories.map(c => t(c)).join(', ') }));
  if (q.text) parts.push(t('con «{0}» nella descrizione', { 0: q.text }));
  if (q.accounts.length) parts.push(t('sui conti {list}', { list: q.accounts.join(', ') }));
  parts.push(
    q.from || q.to
      ? t('dal {a} al {b}', {
          a: q.from ? dLabel(q.from) : t('primo movimento'),
          b: q.to ? dLabel(q.to) : t('oggi')
        })
      : t('su tutto lo storico')
  );
  return parts.join(' ') + by;
}
function askChart(r, kind) {
  const rows = r.rows.filter(x => x.value > 0 || kind === 'linea');
  if (!rows.length) return '';
  if (kind === 'torta') {
    const tot = rows.reduce((s, x) => s + x.value, 0),
      C = 2 * Math.PI * 70,
      cols = [
        'var(--s-blue)',
        'var(--s-aqua)',
        'var(--s-orange)',
        'var(--s-violet)',
        'var(--s-yellow)',
        'var(--tx2)'
      ];
    let acc = 0;
    return `<div style="display:flex;gap:22px;align-items:center;flex-wrap:wrap"><svg viewBox="0 0 180 180" width="150" height="150">${rows
      .map((x, i) => {
        const L = (x.value / tot) * C,
          s = `<circle cx="90" cy="90" r="70" fill="none" stroke="${cols[i % cols.length]}" stroke-width="30" stroke-dasharray="${Math.max(0, L - 2)} ${C}" stroke-dashoffset="${-acc}" transform="rotate(-90 90 90)" data-tip="${esc(x.label)}\n${r.isCount ? x.value : eur(x.value)}"/>`;
        acc += L;
        return s;
      })
      .join('')}</svg>
     <div style="flex:1;min-width:180px">${rows.map((x, i) => `<div style="display:flex;gap:8px;align-items:center;padding:3px 0"><i style="width:10px;height:10px;border-radius:3px;background:${cols[i % cols.length]}"></i><span style="flex:1">${esc(x.label)}</span><span class="num hint">${((x.value / tot) * 100).toFixed(0)}%</span></div>`).join('')}</div></div>`;
  }
  if (kind === 'linea' && rows.length > 1) {
    const W = innerWidth < 820 ? 420 : 720,
      H = 200,
      pl = 48,
      pr = 10,
      pt = 10,
      pb = 26,
      iw = W - pl - pr,
      ih = H - pt - pb,
      mx = niceTop(Math.max(...rows.map(x => x.value), 1)),
      X = i => pl + (iw * i) / (rows.length - 1),
      Y = v => pt + ih - (ih * Math.max(0, v)) / mx;
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" class="chart">${axisY(mx, pl, pt, ih, W, pr, kfmt)}<path d="${rows.map((x, i) => (i ? 'L' : 'M') + X(i) + ',' + Y(x.value)).join('')}" fill="none" stroke="var(--s-blue)" stroke-width="2.6"/>${rows.map((x, i) => `<circle cx="${X(i)}" cy="${Y(x.value)}" r="4" fill="var(--s-blue)" data-tip="${esc(x.label)}\n${eur(x.value)}"/><text x="${X(i)}" y="${H - 6}" text-anchor="middle">${esc(x.label.split(' ')[0])}</text>`).join('')}</svg>`;
  }
  const mx = Math.max(...rows.map(x => x.value), 1);
  return rows
    .map(
      x =>
        `<div class="hbar" data-tip="${esc(x.label)}: ${r.isCount ? x.value : eur(x.value)}"><span class="nm">${catIc(x.label)} ${esc(x.label)}</span><span class="track"><i style="width:${(x.value / mx) * 100}%"></i></span><span class="num">${r.isCount ? ASK_FMT.n(x.value) : eur0(x.value)}</span></div>`
    )
    .join('');
}
/** A figures answer: the recipe from the AI (or a quick question) computed on today's data. */
function askRender(cur) {
  if (!cur) return '';
  if (cur.err)
    return `<div class="card" style="margin-top:14px"><b>Non sono riuscito a rispondere</b><div class="hint" style="margin-top:6px">${esc(cur.err)}</div></div>`;
  if (cur.advice) return adviceRender(cur);
  const sp = cur.spec;
  if (sp.clarify && !sp.queries.length)
    return `<div class="card" style="margin-top:14px"><b>Mi serve un chiarimento</b><div class="hint" style="margin-top:6px;line-height:1.6">${esc(sp.clarify)}</div></div>`;
  const ctx = askCtx(),
    R = {};
  for (const q of sp.queries) {
    R[q.id] = EN.runQuery(q, ctx);
    // group labels (categories, weekdays, asset classes) go into the answer sentence: translate them
    for (const row of R[q.id].rows) row.label = t(row.label);
    if (R[q.id].top) R[q.id].top.label = t(R[q.id].top.label);
  }
  // built-in answers are written in Italian: translate the template before filling it in
  const ans = EN.renderAnswer(cur.ai ? sp.answer || '' : t(sp.answer || ''), R, ASK_FMT),
    ch = sp.chart && R[sp.chart.query];
  const tables = sp.queries.filter(
    q => R[q.id].rows.length && (!sp.chart || sp.chart.query !== q.id || sp.chart.kind === 'linea')
  );
  return `<div class="card sens" style="margin-top:14px"><div class="hint" style="margin-bottom:6px">${esc(cur.q)}</div><h3 style="margin-bottom:10px">${esc(sp.title || 'Risposta')}</h3>
    <p style="font-size:17px;line-height:1.55">${esc(ans) || '—'}</p>
    ${ch ? `<div style="margin-top:14px">${askChart(ch, sp.chart.kind)}</div>` : ''}
    ${tables.map(q => `<table class="tbl" style="margin-top:14px"><tbody>${R[q.id].rows.map(x => `<tr><td>${esc(x.label)}</td><td class="r num">${R[q.id].isCount ? ASK_FMT.n(x.value) : eur(x.value)}</td></tr>`).join('')}</tbody></table>`).join('')}
    <details style="margin-top:14px"><summary class="hint" style="cursor:pointer">Come è stato calcolato</summary><ul class="hint" style="margin:8px 0 0 18px;line-height:1.6">${sp.queries.map(q => `<li><b>${q.id}</b>: ${esc(describeQ(q))} — ${t(q.source === 'investimenti' ? '{n} posizioni' : '{n} movimenti', { n: R[q.id].n })}</li>`).join('')}</ul>
     <p class="hint" style="margin-top:8px">${cur.ai ? "All'AI è arrivata solo la domanda, con l'elenco delle categorie e il tipo dei conti. I numeri sono stati calcolati su questo dispositivo e non sono stati inviati." : 'Domanda rapida: calcolata interamente su questo dispositivo, senza AI.'}</p></details></div>`;
}
/**
 * A question to an external AI, blind: only the question, the category names and the account
 * types leave. Figures questions come back as queries, judgements as an advisor recipe; both
 * are computed on this device. Returns the message to show.
 */
async function askCompute(q, prev) {
  if (isAdviceQ(q) || isAffordQ(q) || (prev && isFollowUp(q)))
    return adviseCompute(q, prev && isFollowUp(q) ? prev : null);
  const accounts = accAliases().map(({ alias, type }) => ({ alias, type }));
  logAI(
    'ask',
    `Domanda: «${q.slice(0, 200)}» · più l'elenco delle categorie e i tipi dei conti (${accounts.map(a => a.alias + ' ' + a.type).join(', ')}). Nessun importo o movimento.`
  );
  const spec = await api('POST', '/api/ai/ask', { question: q, accounts, lang: LANG });
  // not a question about figures: let the advisor try
  if (!(spec.queries && spec.queries.length)) return adviseCompute(q, null);
  return { q, spec, ai: true };
}
