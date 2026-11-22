/*
 * EyeCash · public/js/forms.js
 *
 * Generic bottom-sheet form (`openForm`) and the forms built on it:
 * transaction, holding, recurring item, goal, account.
 */
/* ---------- forms ---------- */
let formSave = null,
  formDel = null;
/** Opens a bottom-sheet form from a list of field definitions. */
function openForm(title, fields, onSave, onDel, extra = '') {
  formSave = onSave;
  formDel = onDel;
  $('#sheetbox').innerHTML = `<div class="handle"></div><h2>${title}</h2><form id="frm">${fields
    .map(f => {
      if (f.type === 'seg')
        return `<div class="fld"><div class="seg" data-seg="${f.k}">${f.options.map(o => `<button type="button" data-val="${o[0]}" class="${o[0] === f.v ? 'on' : ''}">${o[1]}</button>`).join('')}</div><input type="hidden" name="${f.k}" value="${f.v}"></div>`;
      if (f.type === 'big')
        return `<div class="bigamt"><input class="num" name="${f.k}" inputmode="decimal" autocomplete="off" value="${esc(f.v ?? '')}" placeholder="0,00"><span>€</span></div>`;
      if (f.type === 'catgrid')
        return `<div class="cgrid" data-cg="${f.k}" data-kind="${f.kind || 'out'}">${f.groups.map(([g, cs]) => cs.map(c => `<button type="button" data-k="${g}" data-c="${esc(c)}" class="${c === f.v ? 'on' : ''}">${catAv(c).replace('class="av cico"', 'class="cico"')}<span>${esc(c)}</span></button>`).join('')).join('')}</div><input type="hidden" name="${f.k}" value="${esc(f.v)}">`;
      if (f.type === 'select')
        return `<div class="fld"><label>${f.label}</label><select class="inp" name="${f.k}">${f.options
          .map(o => {
            const [val, l] = Array.isArray(o) ? o : [o, o];
            return `<option value="${esc(val)}" ${val === f.v ? 'selected' : ''}>${esc(l)}</option>`;
          })
          .join('')}</select></div>`;
      if (f.type === 'textarea')
        return `<div class="fld"><label>${f.label}</label><textarea class="inp" name="${f.k}">${esc(f.v || '')}</textarea></div>`;
      return `<div class="fld"><label>${f.label}</label><input class="inp ${f.type === 'number' ? 'num' : ''}" name="${f.k}" type="${f.type === 'number' ? 'text' : f.type || 'text'}" ${f.type === 'number' ? 'inputmode="decimal"' : ''} value="${esc(f.v ?? '')}" ${f.ph ? `placeholder="${esc(f.ph)}"` : ''}></div>`;
    })
    .join('')}
    ${extra}
    <div class="btns">${onDel ? '<button type="button" class="btn danger" data-act="form-del">Elimina</button>' : ''}<button type="button" class="btn" data-act="close">Annulla</button><button type="submit" class="btn pri">Salva</button></div></form>`;
  $('#sheet').classList.remove('hidden');
  const kd = $('#frm input[name=kind]');
  if (kd) $('#frm').dataset.kind = kd.value;
  const first = $('#frm .bigamt input') || $('#frm .inp');
  if (first && window.innerWidth > 820) first.focus();
}
function closeForm() {
  $('#sheet').classList.add('hidden');
  formSave = formDel = null;
}
let NUMTYPED = false; // true while reading an Excel file with numeric cells: "25.435" means 25.435, not 25435
const num = v => {
  let s = String(v ?? '')
    .replace(/[€\s ]|EUR/gi, '')
    .replace(/−/g, '-');
  if (!s) return 0;
  if (NUMTYPED && /^-?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(s)) return parseFloat(s);
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (/^[^-]*\d-$/.test(s)) {
    neg = true;
    s = s.slice(0, -1);
  }
  if (/^\+/.test(s)) s = s.slice(1);
  if (s.includes(',') && s.includes('.')) {
    s =
      s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  else s = s.replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : neg ? -Math.abs(n) : n;
};
const accOpts = () => S.accounts.map(a => [a.id, a.name]);

/** New/edit transaction form (amount, category grid, account, date). */
function txForm(t, pre) {
  const isNew = !t;
  t =
    t ||
    Object.assign(
      { date: today(), amount: 0, cat: 'Spesa', accountId: S.accounts[0]?.id, note: '' },
      pre || {}
    );
  const kind = isNeutral(t.cat) ? 'tr' : t.amount > 0 ? 'in' : 'out';
  openForm(
    isNew ? 'Nuovo movimento' : 'Modifica movimento',
    [
      {
        k: 'kind',
        type: 'seg',
        v: kind,
        options: [
          ['out', 'Uscita'],
          ['in', 'Entrata'],
          ['tr', 'Trasferimento']
        ]
      },
      { k: 'amount', type: 'big', v: t.amount ? String(Math.abs(t.amount)).replace('.', ',') : '' },
      {
        k: 'cat',
        type: 'catgrid',
        v: t.cat,
        kind,
        groups: [
          ['out', OUT_CATS],
          ['in', IN_CATS],
          ['tr', NEUTRAL_CATS]
        ]
      },
      { k: 'note', label: 'Descrizione', v: t.note, ph: 'es. Esselunga' },
      { k: 'accountId', label: 'Conto', type: 'select', v: t.accountId, options: accOpts() },
      { k: 'date', label: 'Data', type: 'date', v: t.date }
    ],
    d => {
      const a = Math.abs(num(d.amount));
      if (!a) return toast('Inserisci un importo');
      let cat = d.cat;
      if (isNew && !pre && cat === 'Spesa' && d.note) {
        const ac = autoCat(d.note, d.kind === 'in' ? 1 : -1);
        if (ac !== 'Altro' && ac !== 'Altre entrate') cat = ac;
      }
      if (d.kind === 'tr' && !isNeutral(cat)) cat = 'Giroconti';
      if (d.kind !== 'tr' && isNeutral(cat)) cat = d.kind === 'in' ? 'Altre entrate' : 'Altro';
      if (d.kind === 'in' && !IN_CATS.includes(cat)) cat = 'Altre entrate';
      if (d.kind === 'out' && !OUT_CATS.includes(cat)) cat = 'Altro';
      const o = {
        amount: d.kind === 'in' ? a : -a,
        note: d.note.trim(),
        cat,
        accountId: d.accountId,
        date: d.date || today()
      };
      let learned = 0;
      if (isNew) S.tx.push({ id: uid(), ...o });
      else {
        const prevCat = t.cat;
        Object.assign(
          S.tx.find(x => x.id === t.id),
          o
        );
        const k = normKey(o.note);
        if (k && prevCat !== o.cat) {
          S.rules = S.rules || {};
          S.rules[k] = o.cat;
          for (const x of S.tx) {
            if (x.id !== t.id && normKey(x.note) === k && x.cat !== o.cat && x.amount > 0 === o.amount > 0) {
              x.cat = o.cat;
              learned++;
            }
          }
        }
      }
      save();
      render();
      toast(learned ? `Salvato · regola imparata, ${learned} movimenti simili aggiornati` : 'Salvato');
    },
    isNew
      ? null
      : () => {
          S.tx = S.tx.filter(x => x.id !== t.id);
          save();
          render();
          toast('Eliminato');
        }
  );
}
/** New/edit investment holding form. */
function holdForm(h, pre) {
  const isNew = !h;
  h =
    h ||
    Object.assign({ name: '', ticker: '', type: 'ETF', qty: '', avg: '', price: '', isin: '' }, pre || {});
  const f = v => (v === '' || v == null ? '' : String(v).replace('.', ','));
  const qx = h.qSym
    ? `<div class="bcard" style="margin:0 0 12px"><div class="k"><span>Quotazione automatica</span>${quoteBadge(h)}</div><div style="margin-top:6px;font-size:13px">${esc(h.qSym)}${h.priceExch ? ' · ' + esc(h.priceExch) : ''}${h.priceCur ? ' · ' + esc(h.priceCur) : ''}</div>${!isNew ? `<div style="display:flex;gap:6px;margin-top:8px"><button type="button" class="btn sm" data-act="q-link" data-id="${h.id}">Cambia listino</button><button type="button" class="btn sm ghost" data-act="q-unlink" data-id="${h.id}">Scollega</button></div>` : ''}</div>`
    : !isNew && perm('quotes')
      ? `<button type="button" class="btn" data-act="q-link" data-id="${h.id}" style="width:100%;justify-content:center;margin-bottom:12px">🔎 Collega quotazione automatica</button>`
      : '';
  openForm(
    isNew ? 'Nuova posizione' : esc(h.name),
    [
      { k: 'name', label: 'Nome', v: h.name, ph: 'es. ETF MSCI World' },
      { k: 'ticker', label: 'Ticker', v: h.ticker, ph: 'SWDA' },
      {
        k: 'isin',
        label: 'ISIN (facoltativo, per trovare il prezzo giusto)',
        v: h.isin || '',
        ph: 'es. IE00B4L5Y983'
      },
      {
        k: 'type',
        label: 'Tipo',
        type: 'select',
        v: h.type,
        options: ['ETF', 'Azioni', 'Obbligazioni', 'Crypto', 'Fondi', 'Altro']
      },
      ...(pfs().length
        ? [
            {
              k: 'pf',
              label: 'Portafoglio',
              type: 'select',
              v: h.pf || (isNew && invPf ? invPf : ''),
              options: [['', pfName('')], ...pfs().map(p => [p.id, p.name])]
            }
          ]
        : []),
      {
        k: 'cls',
        label: 'Classe di attivo (per allocazione e FIRE)',
        type: 'select',
        v: h.cls || '',
        options: [['', 'Automatica dal tipo'], ...EN.CLASSES.map(c => [c.k, c.label])]
      },
      {
        k: 'taxClass',
        label: 'Regime fiscale',
        type: 'select',
        v: h.taxClass || '',
        options: [
          ['', 'Automatico dal tipo'],
          ...Object.entries(EN.TAX).map(([k, t]) => [
            k,
            t.label + ' · ' + String(t.rate).replace('.', ',') + '%'
          ])
        ]
      },
      {
        k: 'ter',
        label: 'Costo annuo TER (%)',
        type: 'number',
        v: h.ter == null || h.ter === '' ? '' : String(h.ter).replace('.', ','),
        ph: 'es. 0,20'
      },
      {
        k: 'divYield',
        label: 'Rendimento da dividendi/cedole (% annuo, facoltativo)',
        type: 'number',
        v: h.divYield == null || h.divYield === '' ? '' : String(h.divYield).replace('.', ','),
        ph: '0 se ad accumulazione'
      },
      { k: 'qty', label: 'Quantità', type: 'number', v: f(h.qty) },
      { k: 'avg', label: 'Prezzo medio di carico (€)', type: 'number', v: f(h.avg) },
      {
        k: 'price',
        label: h.qSym ? 'Prezzo attuale (€) · aggiornato in automatico' : 'Prezzo attuale (€)',
        type: 'number',
        v: f(h.price)
      }
    ],
    d => {
      if (!d.name.trim()) return toast('Inserisci un nome');
      const isin = String(d.isin || '')
        .trim()
        .toUpperCase();
      if (isin && !/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin))
        return toast('ISIN non valido: 12 caratteri, es. IE00B4L5Y983');
      const o = {
        name: d.name.trim(),
        ticker: (d.ticker || d.name).trim().toUpperCase(),
        isin,
        type: d.type,
        qty: num(d.qty),
        avg: num(d.avg),
        price: num(d.price) || num(d.avg),
        cls: d.cls || null,
        taxClass: d.taxClass || null,
        ter: d.ter === '' ? null : num(d.ter),
        divYield: d.divYield === '' ? null : num(d.divYield)
      };
      if (pfs().length) o.pf = d.pf || '';
      if (isNew) {
        const link =
          pre && pre.qSym
            ? {
                qSym: pre.qSym,
                autoPrice: true,
                confirmed: true,
                priceExch: pre.priceExch,
                priceCur: pre.priceCur,
                priceAt: pre.priceAt,
                priceSrc: pre.priceSrc,
                priceCheck: pre.priceCheck
              }
            : {};
        S.holdings.push({ id: uid(), ...link, ...o });
      } else {
        const x = S.holdings.find(z => z.id === h.id);
        if (x.qSym && Math.abs(o.price - x.price) > 1e-9) {
          x.priceSrc = 'manuale';
          x.priceAt = Date.now();
        }
        Object.assign(x, o);
      }
      save();
      render();
      toast('Salvato');
    },
    isNew
      ? null
      : () => {
          S.holdings = S.holdings.filter(x => x.id !== h.id);
          save();
          render();
        },
    qx
  );
}
function recForm(r, prefill) {
  const isNew = !r;
  r =
    r ||
    Object.assign(
      {
        name: '',
        amount: '',
        cat: 'Abbonamenti',
        accountId: S.accounts[0]?.id,
        freq: 'mensile',
        type: 'out',
        auto: true,
        next: today()
      },
      prefill || {}
    );
  openForm(
    isNew ? 'Nuovo costo ricorrente' : 'Modifica ricorrente',
    [
      {
        k: 'type',
        type: 'seg',
        v: r.type,
        options: [
          ['out', 'Uscita'],
          ['in', 'Entrata']
        ]
      },
      { k: 'name', label: 'Nome', v: r.name, ph: 'es. Netflix' },
      {
        k: 'amount',
        label: 'Importo (€)',
        type: 'number',
        v: r.amount === '' ? '' : String(r.amount).replace('.', ',')
      },
      {
        k: 'freq',
        label: 'Frequenza',
        type: 'select',
        v: r.freq,
        options: [
          ['settimanale', 'Settimanale'],
          ['mensile', 'Mensile'],
          ['trimestrale', 'Trimestrale'],
          ['annuale', 'Annuale']
        ]
      },
      { k: 'next', label: 'Prossima scadenza', type: 'date', v: r.next },
      { k: 'cat', label: 'Categoria', type: 'select', v: r.cat, options: ALL_CATS() },
      { k: 'accountId', label: 'Conto', type: 'select', v: r.accountId, options: accOpts() },
      {
        k: 'auto',
        label: 'Registrazione',
        type: 'select',
        v: r.auto ? '1' : '0',
        options: [
          ['1', 'Automatica alla scadenza'],
          ['0', 'Manuale (ti avviso)']
        ]
      }
    ],
    d => {
      if (!d.name.trim() || !num(d.amount)) return toast('Nome e importo obbligatori');
      const o = {
        anchor: pd(d.next || today()).getDate(),
        name: d.name.trim(),
        amount: Math.abs(num(d.amount)),
        freq: d.freq,
        next: d.next || today(),
        cat: d.cat,
        accountId: d.accountId,
        type: d.type,
        auto: d.auto === '1'
      };
      if (isNew) S.recurring.push({ id: uid(), ...o });
      else
        Object.assign(
          S.recurring.find(x => x.id === r.id),
          o
        );
      const n = processRecurring();
      save();
      render();
      toast(n ? `Salvato · ${n} movimenti registrati` : 'Salvato');
    },
    isNew
      ? null
      : () => {
          S.recurring = S.recurring.filter(x => x.id !== r.id);
          save();
          render();
        }
  );
}
function goalForm(g) {
  const isNew = !g;
  g = g || { name: '', target: '', saved: 0, deadline: '' };
  openForm(
    isNew ? 'Nuovo obiettivo' : 'Modifica obiettivo',
    [
      { k: 'name', label: 'Nome', v: g.name, ph: 'es. Fondo emergenza' },
      { k: 'target', label: 'Obiettivo (€)', type: 'number', v: String(g.target).replace('.', ',') },
      { k: 'saved', label: 'Già messo da parte (€)', type: 'number', v: String(g.saved).replace('.', ',') },
      { k: 'deadline', label: 'Scadenza', type: 'date', v: g.deadline }
    ],
    d => {
      if (!d.name.trim() || !num(d.target)) return toast('Nome e obiettivo obbligatori');
      const o = { name: d.name.trim(), target: num(d.target), saved: num(d.saved), deadline: d.deadline };
      if (isNew) S.goals.push({ id: uid(), ...o });
      else
        Object.assign(
          S.goals.find(x => x.id === g.id),
          o
        );
      save();
      render();
    },
    isNew
      ? null
      : () => {
          S.goals = S.goals.filter(x => x.id !== g.id);
          save();
          render();
        }
  );
}
function accForm(a) {
  const isNew = !a;
  a = a || { name: '', type: 'Conto', balance0: 0 };
  openForm(
    isNew ? 'Nuovo conto' : 'Modifica conto',
    [
      { k: 'name', label: 'Nome', v: a.name, ph: 'es. Conto Intesa' },
      {
        k: 'type',
        label: 'Tipo',
        type: 'select',
        v: a.type,
        options: ['Conto', 'Carta', 'Risparmio', 'Contanti']
      },
      { k: 'balance0', label: 'Saldo iniziale (€)', type: 'number', v: String(a.balance0).replace('.', ',') }
    ],
    d => {
      if (!d.name.trim()) return toast('Inserisci un nome');
      const o = { name: d.name.trim(), type: d.type, balance0: num(d.balance0) };
      if (isNew) S.accounts.push({ id: uid(), ...o });
      else
        Object.assign(
          S.accounts.find(x => x.id === a.id),
          o
        );
      save();
      render();
    },
    isNew || S.accounts.length < 2
      ? null
      : () => {
          if (S.tx.some(t => t.accountId === a.id)) return toast('Il conto ha movimenti: spostali prima');
          S.accounts = S.accounts.filter(x => x.id !== a.id);
          save();
          render();
        }
  );
}
