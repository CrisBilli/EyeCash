/*
 * EyeCash · public/js/chat.js
 *
 * The advisor chat: you ask, it looks into your data and answers.
 * It only works with a LOCAL model (Ollama on your server or network): the server
 * refuses the chat otherwise, because here the model does see the results of the
 * calculations. The tools (EN.CHAT_TOOLS) run on this device: the model asks for
 * "spending by category" or "simulate this purchase", the device computes it on
 * the decrypted data and passes back only that result.
 */

const CHAT_MAX_STEPS = 6; // tool rounds per question
const CHAT_KEEP = 40; // messages kept in the encrypted history

let chatBusy = false,
  chatStatus = '', // what the advisor is doing right now
  chatErr = '';

/** True when the chat can run: AI configured, local, allowed and online. */
const chatReady = () => !!(STATUS && STATUS.ai_local && perm('chat'));

/* ---------- tools, run on the device ---------- */

/** Months YYYY-MM from either the last N complete months or a from/to range. */
function chatMonths(a) {
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
const CHAT_RUN = {
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
      goals_missing: r2(b.goalsMissing)
    };
  },
  spending_by_category(a) {
    const ms = chatMonths(a);
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
    return chatMonths(a).map(k => {
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
      category: r.cat
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
        monthly_payment: r2(loanPayment(d.principal, d.rate, d.months)),
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
    const p = loanPayment(+a.amount || 0, +a.rate_pct || 0, Math.max(1, Math.round(+a.months || 1)));
    return {
      monthly_payment: r2(p),
      total_paid: r2(p * Math.round(+a.months || 1)),
      total_interest: r2(p * Math.round(+a.months || 1) - (+a.amount || 0))
    };
  }
};
/** Runs one tool; errors become a short message for the model instead of breaking the chat. */
function chatTool(name, args) {
  try {
    if (!Object.prototype.hasOwnProperty.call(CHAT_RUN, name)) return { error: 'unknown tool ' + name };
    return CHAT_RUN[name](args && typeof args === 'object' ? args : {});
  } catch (e) {
    return { error: e.message };
  }
}

/** A step shown under the answer: what the advisor looked at. */
const CHAT_STEP = {
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
function stepLabel(s) {
  const a = s.args || {};
  const extra =
    s.name === 'search_transactions'
      ? [a.text && '«' + a.text + '»', a.category, a.from && a.from + (a.to ? ' → ' + a.to : '')]
          .filter(Boolean)
          .join(' · ')
      : s.name === 'spending_by_category' || s.name === 'monthly_trend'
        ? a.from
          ? a.from + ' → ' + (a.to || '')
          : a.months
            ? t('ultimi {0} mesi', [a.months])
            : ''
        : '';
  return t(CHAT_STEP[s.name] || s.name) + (extra ? ' · ' + extra : '');
}

/* ---------- the conversation ---------- */

/** Sends a question and runs the tool loop until the model answers. */
async function chatSend(text) {
  const q = String(text || '').trim();
  if (!q || chatBusy) return;
  if (!chatReady()) return;
  S.chat = S.chat || [];
  S.chat.push({ role: 'user', content: q, t: Date.now() });
  chatBusy = true;
  chatErr = '';
  chatStatus = t('Sto pensando…');
  renderView();
  // the model sees the earlier questions and answers (not their tool results) and this turn's steps
  const msgs = S.chat.slice(-12).map(m => ({ role: m.role, content: m.content }));
  const steps = [];
  let answer = '';
  try {
    for (let i = 0; i <= CHAT_MAX_STEPS && !answer; i++) {
      const r = await api('POST', '/api/ai/chat', {
        messages: msgs,
        lang: LANG,
        final: i === CHAT_MAX_STEPS
      });
      if (r.tool_calls && r.tool_calls.length && i < CHAT_MAX_STEPS) {
        msgs.push({ role: 'assistant', content: r.content || '', tool_calls: r.tool_calls });
        for (const c of r.tool_calls) {
          steps.push({ name: c.name, args: c.arguments });
          chatStatus = stepLabel(steps[steps.length - 1]) + '…';
          renderChatStatus();
          msgs.push({
            role: 'tool',
            tool_call_id: c.id,
            name: c.name,
            content: JSON.stringify(chatTool(c.name, c.arguments))
          });
        }
      } else answer = (r.content || '').trim();
    }
    if (!answer) throw new Error(t('Il modello non ha dato una risposta: riprova o riformula la domanda.'));
    S.chat.push({ role: 'assistant', content: answer, steps, t: Date.now() });
    logAI(
      'chat',
      `Domanda: «${q.slice(0, 160)}» · con ${steps.length} risultati di calcolo, al modello locale (${STATUS.ai_model || 'Ollama'}). Nulla verso servizi esterni.`
    );
  } catch (e) {
    chatErr = e.message;
  }
  S.chat = S.chat.slice(-CHAT_KEEP);
  chatBusy = false;
  chatStatus = '';
  save();
  renderView();
  const end = $('#chatend');
  if (end) end.scrollIntoView({ block: 'end' });
}
function renderChatStatus() {
  const el = $('#chatstatus');
  if (el) el.textContent = chatStatus;
}

/** Minimal, safe markdown: escapes everything, then **bold**, *italic*, bullet and numbered lists, headings. */
function chatMd(s) {
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

const CHAT_SUGGEST = [
  'Come sto messo questo mese?',
  'Dove posso risparmiare?',
  "Posso permettermi un'auto da 20.000 € l'anno prossimo?",
  'Il mio portafoglio è troppo rischioso?',
  'Quanto spendo in abbonamenti?',
  'Riesco a raggiungere i miei obiettivi?'
];

/** The chat view. */
function vChat() {
  if (!STATUS || !STATUS.ai)
    return `<div class="card"><h3>Consulente</h3><p class="hint" style="margin-top:8px;line-height:1.6">La chat del consulente usa un modello AI locale, che gira sul tuo server o in casa tua (Ollama): così può leggere i tuoi dati senza che escano di casa. Non è configurato nessun modello: trovi come fare in docs/AI.md.</p></div>`;
  if (!STATUS.ai_local)
    return `<div class="card"><h3>Consulente</h3><p class="hint" style="margin-top:8px;line-height:1.6">La chat del consulente legge i tuoi dati, quindi funziona solo con un modello AI locale (Ollama sul tuo server o in rete). Il modello configurato è esterno: per sicurezza la chat è disattivata. Puoi comunque chiedere un parere in Chiedi ai tuoi dati, dove all'AI esterna arriva solo la domanda.</p>
    <button class="btn sm" style="margin-top:12px" data-act="go" data-v="chiedi">Vai a Chiedi ai tuoi dati</button></div>`;
  if (!perm('chat'))
    return `<div class="card"><h3>Consulente</h3><p class="hint" style="margin-top:8px;line-height:1.6">La chat del consulente è disattivata nelle impostazioni di privacy.</p><button class="btn sm" style="margin-top:12px" data-act="go" data-v="impostazioni">Apri le impostazioni</button></div>`;
  const msgs = S.chat || [];
  const body = msgs.length
    ? msgs
        .map(m =>
          m.role === 'user'
            ? `<div class="chat-u" translate="no">${esc(m.content)}</div>`
            : `<div class="chat-a"><div class="chat-md" translate="no">${chatMd(m.content)}</div>${
                m.steps && m.steps.length
                  ? `<details class="hint" style="margin-top:8px"><summary style="cursor:pointer">${t('Dati consultati: {0}', [m.steps.length])}</summary><ul style="margin:6px 0 0 18px;line-height:1.6">${m.steps.map(s => `<li>${esc(stepLabel(s))}</li>`).join('')}</ul></details>`
                  : ''
              }</div>`
        )
        .join('')
    : `<div class="hint" style="margin:4px 2px 12px;line-height:1.6">${t('Chiedimi qualsiasi cosa sui tuoi soldi: cerco nei movimenti, faccio i conti e simulo le scelte. Gira tutto sul tuo modello locale: i dati non escono di casa.')}</div>
       <div style="display:flex;flex-wrap:wrap;gap:8px">${CHAT_SUGGEST.map((s, i) => `<button class="btn sm" data-act="chat-suggest" data-i="${i}">${esc(s)}</button>`).join('')}</div>`;
  return `<div class="card chat">
    <div class="card-h"><div><h3>Consulente</h3><div class="hint">🔒 ${t('Modello locale')}${STATUS.ai_model ? ' · ' + esc(STATUS.ai_model) : ''}</div></div>${msgs.length ? `<button class="btn sm" data-act="chat-new">${t('Nuova chat')}</button>` : ''}</div>
    <div class="chat-log">${body}
      ${chatBusy ? `<div class="chat-a chat-busy"><span class="spin"></span> <span id="chatstatus">${esc(chatStatus)}</span></div>` : ''}
      ${chatErr ? `<div class="chat-a" style="color:var(--crit)">${esc(chatErr)}</div>` : ''}
      <div id="chatend"></div></div>
    <form id="chatform" class="chat-in"><input class="inp" id="chatq" maxlength="600" autocomplete="off" placeholder="${t('Scrivi una domanda…')}" ${chatBusy ? 'disabled' : ''}><button class="btn pri" type="submit" ${chatBusy ? 'disabled' : ''}>${t('Invia')}</button></form>
    <div class="hint" style="margin-top:8px">${t('Strumento di supporto: non è una consulenza finanziaria.')}</div></div>`;
}
