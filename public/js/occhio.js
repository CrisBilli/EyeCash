/*
 * EyeCash · public/js/occhio.js
 *
 * The Eye: one place to talk with your data. You ask anything about your money,
 * tell it an expense to record, or ask whether you can afford something.
 *
 * What the model sees depends on where it runs:
 * - local model (Ollama at home, `ai_local`): a real agent. It calls tools that
 *   run on this device on the decrypted data and reads their results; nothing
 *   leaves home. The server refuses this mode for external models.
 * - external API: blind. Only the question leaves (plus category names and
 *   account types). The AI answers with a recipe (queries, or events and rules)
 *   and the device computes every number. Amounts never leave.
 * - no AI, or offline: quick questions, the purchase simulator and expense
 *   entry, all understood on the device.
 */

const OCC_STEPS = 6; // tool rounds per question (local agent)
const OCC_KEEP = 40; // messages kept in the encrypted history

let occBusy = false,
  occStatus = '';

/** How the Eye answers right now: 'local' agent, 'blind' recipes, or 'device' only. */
function occMode() {
  if (!AI || OFFLINE) return 'device';
  if (STATUS && STATUS.ai_local && perm('chat')) return 'local';
  return perm('ask') ? 'blind' : 'device';
}
const OCC_MODE_TXT = {
  local: [
    'AI locale',
    'Il modello gira in casa tua e legge i tuoi dati per rispondere: nulla esce verso servizi esterni.'
  ],
  blind: [
    'AI esterna, alla cieca',
    "All'AI arriva solo la domanda: risponde con un calcolo che il dispositivo esegue sui tuoi dati. Importi e movimenti non escono."
  ],
  device: [
    'Sul dispositivo',
    'Senza AI capisco le domande rapide, le simulazioni di acquisto («posso permettermi un’auto da 20.000 €?») e le spese da registrare («ho speso 12 € al bar»).'
  ]
};

/* ---------- tools for the local agent: they run here, on the decrypted data ---------- */

/** Months YYYY-MM from either the last N complete months or a from/to range. */
function occMonths(a) {
  if (a && (a.from || a.to)) {
    const from = /^\d{4}-\d{2}/.test(a.from || '') ? a.from.slice(0, 7) : null;
    const to = /^\d{4}-\d{2}/.test(a.to || '') ? a.to.slice(0, 7) : ym(today());
    const out = [];
    let k = from || EN.ymAdd(to, -11);
    for (let i = 0; i < 120 && k <= to; i++, k = EN.ymAdd(k, 1)) out.push(k);
    return out;
  }
  const n = Math.min(60, Math.max(1, Math.round(+(a && a.months) || 12)));
  return lastMonths(n + 1).slice(0, n);
}
const OCC_RUN = {
  get_overview() {
    const b = adviceBase();
    return {
      today: today(),
      months_of_data: b.months,
      avg_monthly_income: r2(b.income),
      avg_monthly_spending: r2(b.spending),
      avg_monthly_saving: r2(b.income - b.spending),
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
      goals_missing: r2(b.goalsMissing),
      this_month_spending_so_far: r2(monthTot(ym(today())).out),
      this_month_income_so_far: r2(monthTot(ym(today())).inc)
    };
  },
  spending_by_category(a) {
    const ms = occMonths(a);
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
    return occMonths(a).map(k => {
      const x = monthTot(k);
      return { month: k, income: r2(x.inc), spending: r2(x.out), saving: r2(x.inc - x.out) };
    });
  },
  search_transactions(a = {}) {
    const txt = String(a.text || '').toLowerCase(),
      cat = String(a.category || '').toLowerCase();
    const lim = Math.min(50, Math.max(1, Math.round(+a.limit || 25)));
    const hit = S.tx
      .filter(t => {
        if (
          txt &&
          !String(t.note || '')
            .toLowerCase()
            .includes(txt)
        )
          return false;
        if (cat && String(t.cat || '').toLowerCase() !== cat) return false;
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
    return {
      count: hit.length,
      total: r2(hit.reduce((s, t) => s + t.amount, 0)),
      shown: Math.min(lim, hit.length),
      items: hit.slice(0, lim).map(t => ({
        date: t.date,
        description: t.note || '',
        amount: r2(t.amount),
        category: t.cat,
        account: accName(t.accountId)
      }))
    };
  },
  list_recurring() {
    return S.recurring.map(r => ({
      name: r.name,
      type: r.type === 'in' ? 'income' : 'cost',
      amount: r2(r.amount),
      frequency: r.freq,
      monthly: r2(r.amount * (FREQM[r.freq] || 1)),
      category: r.cat,
      next: r.next
    }));
  },
  list_goals() {
    return (S.goals || []).map(g => {
      const left = Math.max(0, (+g.target || 0) - (+g.saved || 0));
      const months = g.deadline
        ? Math.max(
            1,
            (+g.deadline.slice(0, 4) - +today().slice(0, 4)) * 12 +
              (+g.deadline.slice(5, 7) - +today().slice(5, 7))
          )
        : null;
      return {
        name: g.name,
        target: r2(g.target),
        saved: r2(g.saved),
        missing: r2(left),
        deadline: g.deadline || null,
        monthly_needed: months ? r2(left / months) : null
      };
    });
  },
  get_portfolio() {
    const tot = invVal();
    return {
      total_value: r2(tot),
      total_cost: r2(invCost()),
      gain: r2(tot - invCost()),
      positions: S.holdings
        .map(h => ({
          name: h.name,
          ticker: h.ticker || null,
          type: h.type || null,
          value: r2(h.qty * h.price),
          weight_pct: tot ? r2(((h.qty * h.price) / tot) * 100) : 0,
          gain_pct: h.avg ? r2((h.price / h.avg - 1) * 100) : null
        }))
        .sort((a, b) => b.value - a.value),
      target_allocation_pct: (S.target && S.target.weights) || null
    };
  },
  assets_and_debts() {
    return {
      assets: (S.assets || []).map(a => ({ name: a.name, kind: a.kind, value: r2(assetValue(a)) })),
      debts: (S.debts || []).map(d => ({
        name: d.name,
        kind: d.kind,
        residual: r2(loanResidual(d)),
        monthly_payment: r2(+d.payment || loanPayment(+d.principal, +d.rate, +d.months)),
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
    const x = EN.runAdvice(recipe, adviceBase());
    const V = x.vars,
      mon = m => (m == null ? null : EN.ymAdd(ym(today()), m));
    const out = {
      months_simulated: V.horizon,
      monthly_saving_used: r2(V.saving),
      emergency_fund_target: r2(V.emergency_target),
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
    const n = Math.max(1, Math.round(+a.months || 1)),
      p = loanPayment(+a.amount || 0, +a.rate_pct || 0, n);
    return { monthly_payment: r2(p), total_paid: r2(p * n), total_interest: r2(p * n - (+a.amount || 0)) };
  }
};
/** Runs one tool; errors become a short message for the model instead of breaking the chat. */
function occTool(name, args) {
  try {
    if (!Object.prototype.hasOwnProperty.call(OCC_RUN, name)) return { error: 'unknown tool ' + name };
    return OCC_RUN[name](args && typeof args === 'object' ? args : {});
  } catch (e) {
    return { error: e.message };
  }
}
const OCC_STEP = {
  get_overview: 'Quadro generale',
  spending_by_category: 'Spese per categoria',
  monthly_trend: 'Andamento mese per mese',
  search_transactions: 'Ricerca nei movimenti',
  list_recurring: 'Spese e entrate ricorrenti',
  list_goals: 'Obiettivi',
  get_portfolio: 'Portafoglio',
  assets_and_debts: 'Beni e debiti',
  simulate_cashflow: 'Simulazione della liquidità',
  loan_payment: 'Calcolo della rata'
};
function occStepLabel(s) {
  const a = s.args || {};
  const extra =
    s.name === 'search_transactions'
      ? [a.text && '«' + a.text + '»', a.category, a.from && a.from + (a.to ? ' → ' + a.to : '')]
          .filter(Boolean)
          .join(' · ')
      : (s.name === 'spending_by_category' || s.name === 'monthly_trend') && a.months
        ? t('ultimi {0} mesi', [a.months])
        : '';
  return t(OCC_STEP[s.name] || s.name) + (extra ? ' · ' + extra : '');
}

/* ---------- understanding a message ---------- */

/** "ho speso 12 € al bar", "ricevuto 300 rimborso", "segna 40 benzina": something to record. */
const isEntryQ = q =>
  !/\?\s*$/.test(q) &&
  /\d/.test(q) &&
  /^\s*(oggi |ieri |stamattina |stasera )?(ho |abbiamo )?(speso|pagato|comprato|preso|incassato|ricevuto|segna|aggiungi|registra|spent|paid|bought|received|log|add)\b/i.test(
    q
  );

/** Without AI: the closest quick question by shared words, if close enough. */
function occQuickMatch(q) {
  const words = s =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^\p{L}\d ]/gu, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3)
    );
  const W = words(q);
  let best = null,
    bs = 0;
  for (const x of quickAsks()) {
    const L = words(t(x[0]));
    let n = 0;
    for (const w of L) if (W.has(w)) n++;
    const sc = n / Math.max(3, L.size);
    if (sc > bs) {
      bs = sc;
      best = x;
    }
  }
  return bs >= 0.5 ? best : null;
}

/* words that point to a category, Italian and English */
const OCC_CAT_WORDS = [
  [/ristorant|pizzer|sushi|trattori|bar\b|caff|aperitiv|restaurant|takeaway/, 'Ristoranti'],
  [/supermercat|spesa alimentar|alimentari|grocer/, 'Spesa'],
  [
    /benzin|carburant|diesel|trasport|treno|autobus|metro|taxi|parchegg|autostrad|fuel|petrol|transport|train/,
    'Trasporti'
  ],
  [/bollett|utenz|luce|gas\b|acqua|internet|telefon|utilit|bill/, 'Utenze'],
  [/affitt|condomin|casa\b|rent\b|home\b/, 'Casa'],
  [/abbonament|subscript|streaming/, 'Abbonamenti'],
  [/farmaci|medic|salute|dentist|visita|health|pharma/, 'Salute'],
  [/vestit|abbigliament|shopping|scarpe|cloth/, 'Shopping'],
  [/viagg|vacanz|hotel|volo|voli|travel|holiday|flight/, 'Viaggi'],
  [/svago|cinema|concert|palestra|sport|hobby|leisure|gym/, 'Svago'],
  [/stipend|salary|paycheck/, 'Stipendio'],
  [/tasse|commission|imposte|tax|fee/, 'Tasse e commissioni']
];
const OCC_MONTHS = [
  ['gennaio', 'january'],
  ['febbraio', 'february'],
  ['marzo', 'march'],
  ['aprile', 'april'],
  ['maggio', 'may'],
  ['giugno', 'june'],
  ['luglio', 'july'],
  ['agosto', 'august'],
  ['settembre', 'september'],
  ['ottobre', 'october'],
  ['novembre', 'november'],
  ['dicembre', 'december']
];
/**
 * Without AI: "quanto ho speso in ristoranti quest'anno?", "how much on fuel last month?",
 * "entrate di ottobre", "spese da Esselunga". Category, merchant, period and direction are
 * recognised on the device; returns a recipe in the same format the AI writes, or null.
 */
function occLocalSpec(q) {
  const l = ' ' + q.toLowerCase().replace(/[’']/g, "'") + ' ';
  if (!/quant|how much|spes|speso|spent|spend|entrat|incass|guadagn|income|earn|uscit|totale|total/.test(l))
    return null;
  const inc = /entrat|incass|guadagn|income|earn|ricevut|stipend|salary/.test(l);
  let cat = ALL_CATS().find(c => l.includes(' ' + c.toLowerCase()) || l.includes(' ' + t(c).toLowerCase()));
  if (!cat) {
    const w = OCC_CAT_WORDS.find(([re]) => re.test(l));
    if (w) cat = w[1];
  }
  // a merchant: a word of the question found in the descriptions of the transactions
  let text = '';
  if (!cat) {
    const notes = S.tx.map(x => (x.note || '').toLowerCase());
    const STOP =
      /^(quanto|quanti|quante|speso|spesa|spese|spent|spend|ultimi|ultime|scorso|scorsa|anno|mese|mesi|questo|questa|quest|month|year|last|this|much|have|nel|negli|dall|alla|presso)$/;
    const w = (l.match(/[\p{L}\d]{4,}/gu) || []).find(x => !STOP.test(x) && notes.some(n => n.includes(x)));
    if (w) text = w;
  }
  const td = today(),
    cur = td.slice(0, 7),
    y = +td.slice(0, 4);
  const endOf = k => ds(new Date(+k.slice(0, 4), +k.slice(5), 0));
  let from, to, per;
  const mi = OCC_MONTHS.findIndex(ns => ns.some(n => l.includes(' ' + n)));
  const nm = l.match(/ultim[ie] (\d{1,2}) mesi|last (\d{1,2}) months/);
  if (/questo mese|this month/.test(l)) [from, to, per] = [cur + '-01', td, t('questo mese')];
  else if (/mese scorso|scorso mese|last month/.test(l)) {
    const k = EN.ymAdd(cur, -1);
    [from, to, per] = [k + '-01', endOf(k), t('il mese scorso')];
  } else if (/anno scorso|scorso anno|last year/.test(l))
    [from, to, per] = [y - 1 + '-01-01', y - 1 + '-12-31', String(y - 1)];
  else if (/quest'anno|questo anno|this year/.test(l)) [from, to, per] = [y + '-01-01', td, t("quest'anno")];
  else if (nm) {
    const n = Math.min(60, +(nm[1] || nm[2]));
    [from, to, per] = [EN.ymAdd(cur, -n) + '-01', endOf(EN.ymAdd(cur, -1)), t('negli ultimi {0} mesi', [n])];
  } else if (mi >= 0) {
    const k = (mi + 1 > +cur.slice(5) ? y - 1 : y) + '-' + pad(mi + 1);
    [from, to, per] = [k + '-01', k === cur ? td : endOf(k), MESIL[mi].toLowerCase()];
  } else [from, to, per] = [EN.ymAdd(cur, -12) + '-01', endOf(EN.ymAdd(cur, -1)), t('negli ultimi 12 mesi')];
  const Q = o => ({
    id: 'a',
    source: 'movimenti',
    measure: 'totale',
    type: inc ? 'entrate' : 'uscite',
    group: 'nessuno',
    categories: cat ? [cat] : [],
    accounts: [],
    text,
    from,
    to,
    limit: 12,
    order: 'desc',
    ...o
  });
  const what = cat ? t(cat) : text ? '«' + text + '»' : '';
  const months = (new Date(to) - new Date(from)) / 2.6e9;
  const queries = [Q({}), Q({ id: 'b', measure: 'conteggio' })];
  if (months > 2.5) queries.push(Q({ id: 'c', group: 'mese' }));
  else if (!cat && !text) queries.push(Q({ id: 'c', group: 'categoria', limit: 6 }));
  return {
    title: (inc ? t('Entrate') : t('Spese')) + (what ? ' · ' + what : '') + ' · ' + per,
    queries,
    answer:
      (inc ? t('Entrate') : t('Spese')) +
      (what ? ' ' + (inc ? t('da') : t('per')) + ' ' + what : '') +
      ' ' +
      per +
      ': {a} ' +
      t('in {0} movimenti.', ['{b}']),
    chart: queries[2] ? { query: 'c', kind: months > 2.5 ? 'linea' : 'barre' } : null
  };
}

/** The purchase simulator, from a sentence: returns a snapshot of its inputs and what was understood. */
async function occAfford(q) {
  let p = null,
    viaAI = false;
  if (perm('ask') && !OFFLINE) {
    try {
      logAI('afford', `Domanda: «${q.slice(0, 200)}». Nessun importo, saldo o movimento.`);
      p = await api('POST', '/api/ai/afford', { question: anon(q), lang: LANG });
      viaAI = true;
    } catch (e) {
      p = null;
    }
  }
  const loc = EN.parseAffordText(anon(q));
  if (!p || (!p.price && !p.loanAmount && (loc.price || loc.loanAmount))) {
    p = { ...(p || {}), ...loc };
    viaAI = false;
  }
  if (!affMine().months)
    return {
      kind: 'note',
      text: t(
        'Serve almeno un mese di movimenti per conoscere entrate e spese: importa un estratto conto o aggiungi i movimenti.'
      )
    };
  if (p.price || p.loanAmount) affApply(p, viaAI);
  else if (p.kind !== 'purchase' || /quant|qual|che |massim|how much|what|max/i.test(q)) affGeneral(p, viaAI);
  else
    return {
      kind: 'note',
      text: t('Non ho trovato un prezzo nella domanda: scrivilo, ad esempio «auto da 20.000 €».')
    };
  return { kind: 'afford', F: { ...S.afford }, note: affNote };
}

/** The local agent: the model calls the tools above and reads their results. */
async function occAgent(q) {
  const msgs = S.chat
    .filter(m => m.role === 'user' || m.kind === 'md')
    .slice(-12)
    .map(m => ({ role: m.role, content: m.role === 'user' ? m.content : m.text }));
  const steps = [];
  let answer = '';
  for (let i = 0; i <= OCC_STEPS && !answer; i++) {
    const r = await api('POST', '/api/ai/chat', { messages: msgs, lang: LANG, final: i === OCC_STEPS });
    if (r.tool_calls && r.tool_calls.length && i < OCC_STEPS) {
      msgs.push({ role: 'assistant', content: r.content || '', tool_calls: r.tool_calls });
      for (const c of r.tool_calls) {
        steps.push({ name: c.name, args: c.arguments });
        occStatus = occStepLabel(steps[steps.length - 1]) + '…';
        const el = $('#occstatus');
        if (el) el.textContent = occStatus;
        msgs.push({
          role: 'tool',
          tool_call_id: c.id,
          name: c.name,
          content: JSON.stringify(occTool(c.name, c.arguments))
        });
      }
    } else answer = (r.content || '').trim();
  }
  if (!answer) throw new Error(t('Il modello non ha dato una risposta: riprova o riformula la domanda.'));
  logAI(
    'chat',
    `Domanda: «${q.slice(0, 160)}» · con ${steps.length} risultati di calcolo, al modello locale (${STATUS.ai_model || 'Ollama'}). Nulla verso servizi esterni.`
  );
  return { kind: 'md', text: answer, steps };
}

/** Answers one message, choosing the path by what it is and by the mode. */
async function occAnswer(q) {
  if (isEntryQ(q)) return { kind: 'tx', tx: await entryFromText(q), state: 'new' };
  const mode = occMode();
  if (mode === 'local') return occAgent(q);
  if (mode === 'blind') {
    const prev = [...S.chat].reverse().find(m => m.role === 'assistant' && m.kind === 'advice');
    const r = await askCompute(q, prev ? { q: prev.q, advice: prev.advice } : null);
    return r.advice ? { kind: 'advice', q, advice: r.advice } : { kind: 'ask', q, spec: r.spec, ai: true };
  }
  // on the device only
  if (isAffordQ(q) || EN.parseAffordText(anon(q)).price) return occAfford(q);
  // a category or a merchant in the question: the local recipe; otherwise the closest quick question
  const sp = occLocalSpec(q);
  if (sp && (sp.queries[0].categories.length || sp.queries[0].text))
    return { kind: 'ask', q, spec: sp, ai: false };
  const m = occQuickMatch(q);
  if (m) return { kind: 'ask', q: m[0], spec: m[1], ai: false };
  if (sp) return { kind: 'ask', q, spec: sp, ai: false };
  return { kind: 'note', text: t(OCC_MODE_TXT.device[1]) };
}

/** Sends a message and shows the answer. */
async function occSend(text) {
  const q = String(text || '').trim();
  if (!q || occBusy) return;
  S.chat = S.chat || [];
  S.chat.push({ id: uid(), role: 'user', content: q, t: Date.now() });
  occBusy = true;
  occStatus = t('Sto pensando…');
  renderView();
  occScroll();
  let a;
  try {
    a = await occAnswer(q);
  } catch (e) {
    a = { kind: 'err', text: e.message };
  }
  S.chat.push({ id: uid(), role: 'assistant', t: Date.now(), ...a });
  S.chat = S.chat.slice(-OCC_KEEP);
  occBusy = false;
  occStatus = '';
  save();
  renderView();
  occScroll();
}
function occScroll() {
  const end = $('#occend');
  if (end) end.scrollIntoView({ block: 'end', behavior: 'smooth' });
}

/* ---------- rendering ---------- */

/** Minimal, safe markdown: escapes everything, then **bold**, *italic*, lists, headings. */
function occMd(s) {
  const lines = esc(String(s || '').replace(/<think>[\s\S]*?<\/think>/g, '')).split('\n');
  let html = '',
    list = null;
  const inline = x =>
    x
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<i>$2</i>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  const close = () => {
    if (list) html += `</${list}>`;
    list = null;
  };
  for (const raw of lines) {
    const l = raw.trimEnd();
    let m;
    if ((m = l.match(/^\s*[-*•]\s+(.*)/))) {
      if (list !== 'ul') {
        close();
        html += '<ul>';
        list = 'ul';
      }
      html += `<li>${inline(m[1])}</li>`;
    } else if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) {
      if (list !== 'ol') {
        close();
        html += '<ol>';
        list = 'ol';
      }
      html += `<li>${inline(m[1])}</li>`;
    } else {
      close();
      if ((m = l.match(/^#{1,4}\s+(.*)/))) html += `<p><b>${inline(m[1])}</b></p>`;
      else if (l.trim()) html += `<p>${inline(l)}</p>`;
    }
  }
  close();
  return html;
}

/** The simulator result, compact: verdict, payment, cash chart, a way to change the inputs. */
function occAffordCard(m) {
  const M = affMine(),
    F = m.F;
  if (!(+F.price > 0)) return `<div class="occ-a">${esc(m.note || '')}</div>`;
  const r = affCompute(F, M);
  const [cls, ic, title, sub] = AFF_VERDICT[r.verdict];
  const loan = r.loan > 0;
  return `<div class="card occ-card sens"><div class="aff-verdict ${cls}"><div class="aff-ic"><b>${ic}</b></div><div><h3>${title}</h3><div class="hint">${sub}</div></div></div>
    ${m.note ? `<div class="hint" style="margin-top:10px;line-height:1.5" translate="no">${esc(m.note)}</div>` : ''}
    <div class="grid g2k" style="margin-top:12px">
      <div class="kpi"><div class="lbl">${loan ? 'Rata mensile' : 'Pagamento'}</div><div class="val num" style="font-size:22px">${loan ? eur0(r.payment) : eur0(+F.price)}</div></div>
      <div class="kpi"><div class="lbl">Prezzo massimo consigliato</div><div class="val num" style="font-size:22px">${eur0(r.maxPrice)}</div></div>
    </div>
    <div style="margin-top:10px">${affChart(r)}</div>
    <button class="btn sm" style="margin-top:10px" data-act="occ-sim" data-id="${m.id}">Modifica nel simulatore</button></div>`;
}

/** An expense or income to record: confirm, edit or drop. */
function occTxCard(m) {
  const x = m.tx;
  if (m.state === 'saved')
    return `<div class="occ-a"><span class="chip c-good">✓</span> ${t('Registrato: {0} · {1}', [esc(x.note || x.cat), eur(x.amount)])}</div>`;
  if (m.state === 'dropped') return `<div class="occ-a hint">${t('Annullato')}</div>`;
  if (!x.amount)
    return `<div class="occ-a">${t('Non ho trovato l’importo: scrivilo, ad esempio «ho speso 12,50 € al bar».')}</div>`;
  return `<div class="card occ-card"><div class="hint" style="margin-bottom:8px">${t('Vuoi registrare questo movimento?')}</div>
    <div class="row" style="cursor:default;padding:4px 0">${catAv(x.cat)}<div class="main"><div class="t1">${esc(x.note || x.cat)}</div><div class="t2">${esc(t(x.cat))} · ${dLabel(x.date)} · ${esc(accName(x.accountId))}</div></div><div class="amt num ${x.amount < 0 ? 'down' : 'up'}">${eur(x.amount)}</div></div>
    <div style="display:flex;gap:8px;margin-top:10px"><button class="btn sm pri" data-act="occ-tx-ok" data-id="${m.id}">Registra</button><button class="btn sm" data-act="occ-tx-edit" data-id="${m.id}">Modifica</button><button class="btn sm ghost" data-act="occ-tx-no" data-id="${m.id}">Annulla</button></div></div>`;
}

function occMsg(m) {
  if (m.role === 'user') return `<div class="occ-u" translate="no">${esc(m.content)}</div>`;
  if (m.kind === 'ask') return `<div class="occ-card-w">${askRender(m)}</div>`;
  if (m.kind === 'advice') return `<div class="occ-card-w">${adviceRender(m)}</div>`;
  if (m.kind === 'afford') return occAffordCard(m);
  if (m.kind === 'tx') return occTxCard(m);
  if (m.kind === 'err') return `<div class="occ-a" style="color:var(--crit)">${esc(m.text)}</div>`;
  if (m.kind === 'md')
    return `<div class="occ-a sens"><div class="occ-md" translate="no">${occMd(m.text)}</div>${
      m.steps && m.steps.length
        ? `<details class="hint" style="margin-top:8px"><summary style="cursor:pointer">${t('Dati consultati: {0}', [m.steps.length])}</summary><ul style="margin:6px 0 0 18px;line-height:1.6">${m.steps.map(s => `<li>${esc(occStepLabel(s))}</li>`).join('')}</ul></details>`
        : ''
    }</div>`;
  return `<div class="occ-a">${esc(m.text || '')}</div>`;
}

const OCC_SUGGEST = [
  'Come sto andando questo mese?',
  'Dove posso risparmiare?',
  "Posso permettermi un'auto da 20.000 € a marzo?",
  'Ho speso 12,50 € al bar'
];

/** The message bar, fixed at the bottom while the Eye is open. */
function occBar() {
  return view === 'occhio' && S
    ? `<form id="occform" class="occ-in"><button type="button" class="icon-btn" data-act="mic" id="micbtn" aria-label="Detta">${svgI('mic')}<span class="sr">Detta</span></button><input class="inp" id="occq" maxlength="600" autocomplete="off" placeholder="${t('Chiedi o racconta una spesa…')}" ${occBusy ? 'disabled' : ''}><button class="btn pri" type="submit" ${occBusy ? 'disabled' : ''}>${t('Invia')}</button></form>`
    : '';
}
/** The Eye: what is new, then the conversation. */
function vOcchio() {
  const mode = occMode(),
    news = orbNews(),
    msgs = S.chat || [];
  const all = S ? insights() : [];
  const rest = all.filter(i => !news.some(n => n.t === i.t));
  const item = i =>
    `<div class="row" style="cursor:default">${tile(...i.ic)}<div class="main"><div class="t1" style="white-space:normal">${esc(i.t)}</div><div class="t2" style="white-space:normal">${esc(i.d)}</div></div></div>`;
  const quick = quickAsks();
  const chip = `<span class="chip ${mode === 'local' ? 'c-good' : mode === 'blind' ? 'c-info' : 'c-mut'}" data-tip="${esc(t(OCC_MODE_TXT[mode][1]))}">${svgI('lock')}${t(OCC_MODE_TXT[mode][0])}${mode === 'local' && STATUS.ai_model ? ' · ' + esc(STATUS.ai_model) : ''}</span>`;
  const head = msgs.length
    ? `<div class="occ-head small"><div class="orb-sm">${orbHTML()}</div><div class="occ-mode">${chip}</div></div>`
    : `<div class="occ-head"><div class="orb-big">${orbHTML()}</div><div class="occ-mode">${chip}</div>
    <div class="hint occ-modetxt">${t(OCC_MODE_TXT[mode][1])}</div></div>`;
  const reads =
    news.length || rest.length
      ? `<div class="card occ-news"><div class="card-h"><div><h3>${news.length ? 'Da leggere' : 'Spunti'}</h3><div class="hint">Calcolati sul dispositivo</div></div></div><div class="list">${[
          ...news,
          ...rest
        ]
          .slice(0, msgs.length ? 2 : 5)
          .map(item)
          .join('')}</div></div>`
      : '';
  const sugg = `<div class="occ-sugg">${OCC_SUGGEST.map((s, i) => `<button class="btn sm" data-act="occ-suggest" data-i="${i}">${esc(t(s))}</button>`).join('')}${quick
    .slice(0, msgs.length ? 0 : 6)
    .map(([l], i) => `<button class="btn sm" data-act="ask-quick" data-i="${i}">${esc(t(l))}</button>`)
    .join('')}</div>`;
  return `<div class="occ">
    ${head}
    ${reads}
    <div class="occ-log">${msgs.map(occMsg).join('')}
      ${occBusy ? `<div class="occ-a occ-busy"><span class="spin"></span> <span id="occstatus">${esc(occStatus)}</span></div>` : ''}
      <div id="occend"></div></div>
    ${msgs.length ? '' : sugg}

    <div class="occ-foot">${msgs.length ? `<button class="btn sm ghost" data-act="occ-new">${t('Nuova conversazione')}</button>` : ''}<span class="hint">${t('Strumento di supporto: non è una consulenza finanziaria.')}</span></div>
  </div>`;
}
