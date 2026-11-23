/*
 * EyeCash · public/js/events.js
 *
 * Event wiring: one delegated click handler (`data-act` attributes), form
 * submissions and inputs. This is where buttons are connected to actions.
 */
/* ---------- events ---------- */
/**
 * Every button or row with a `data-act="name"` attribute runs ACTIONS[name].
 * Handlers receive { el, id, e, a }: the clicked element, its data-id, the click
 * event and the action name.
 */
const ACTIONS = {
  go: ({ el }) => go(el.dataset.v),
  'aff-kind': ({ el }) => affSetKind(el.dataset.k),
  'add-tx': () => txForm(),
  'edit-tx': ({ id }) => txForm(S.tx.find(t => t.id === id)),
  'add-hold': () => holdForm(),
  'tr-add': () => trForm(),
  'tr-edit': ({ el }) => trForm((S.trades || []).find(t => t.id === el.dataset.id)),
  'tr-map': () => trMapForm(),
  'ph-load': () => loadPriceHistory(true),
  'tr-all': () => {
    trAll = !trAll;
    renderView();
  },
  'cat-tx': ({ el }) => {
    fC = el.dataset.c;
    fM = today().slice(0, 7);
    go('movimenti');
  },
  theme: ({ el }) => {
    try {
      localStorage.setItem(THEME_KEY, el.dataset.k);
    } catch (e) {}
    applyTheme();
    renderView();
  },
  'off-pref': () => {
    if (OFFLINE) return toast('Cambia questa impostazione quando sei online');
    const on = !offAllowed();
    try {
      localStorage.setItem('eyecash_offline', on ? '1' : '0');
    } catch (e) {}
    if (on) {
      api('GET', '/api/state')
        .then(r => r.blob && offSave(r.blob, r.ver))
        .catch(() => {});
    } else {
      idbSetK('off', null);
      idbSetK('pend', null);
    }
    renderView();
    toast(on ? 'Copia offline attiva' : 'Copia offline eliminata da questo dispositivo');
  },
  'ask-quick': ({ el }) => {
    const x = quickAsks()[+el.dataset.i];
    askCur = { q: x[0], spec: x[1], ai: false };
    renderView();
  },
  'chat-new': () => {
    S.chat = [];
    chatErr = '';
    save();
    renderView();
  },
  'chat-suggest': ({ el }) => chatSend(t(CHAT_SUGGEST[+el.dataset.i])),
  'adv-planner': () => askCur && affordAsk(askCur.q),
  'ask-hist': ({ el }) => {
    const h = (S.askHist || []).find(x => x.id === el.dataset.id);
    if (h) {
      askCur = h.advice ? { q: h.q, advice: h.advice, ai: true } : { q: h.q, spec: h.spec, ai: true };
      renderView();
    }
  },
  'pf-sel': ({ el }) => {
    invPf = el.dataset.k === 'all' ? null : el.dataset.k;
    renderView();
  },
  'pf-new': () => pfForm(false),
  'pf-edit': () => pfForm(true),
  'al-mode': ({ el }) => {
    S.target = { ...(S.target || {}), mode: el.dataset.k };
    save();
    renderView();
  },
  // shared by: aw-cur, aw-eq
  'aw-cur': ({ a }) => {
    const ins = [...document.querySelectorAll('[data-aw]')];
    if (!ins.length) return;
    let v = ins
      .map(i => (a === 'aw-eq' ? 100 / ins.length : +i.dataset.cur))
      .map(x => Math.round(x * 10) / 10);
    const k = v.indexOf(Math.max(...v));
    v[k] = Math.round((v[k] + 100 - v.reduce((s, x) => s + x, 0)) * 10) / 10;
    ins.forEach((i, n) => (i.value = String(v[n]).replace('.', DEC)));
    const s = $('#aw-sum');
    if (s) s.textContent = '100,0';
  },
  'aw-eq': (...args) => ACTIONS['aw-cur'](...args),
  'aw-save': () => {
    const w = {};
    let s = 0;
    document.querySelectorAll('[data-aw]').forEach(i => {
      const v = num(i.value);
      if (v > 0) {
        w[i.dataset.aw] = v;
        s += v;
      }
    });
    if (Math.abs(s - 100) > 0.5)
      return toast(
        'La somma deve essere 100% (ora ' + String(Math.round(s * 10) / 10).replace('.', DEC) + '%)'
      );
    const T = S.target || {};
    S.target = {
      ...T,
      mode: 'asset',
      tol: num($('#tg-tol').value) || 5,
      aw: { ...(T.aw || {}), [awKey()]: w }
    };
    save();
    renderView();
    toast('Obiettivo salvato');
  },
  'edit-hold': ({ id }) => holdForm(S.holdings.find(h => h.id === id)),
  'add-rec': () => recForm(),
  'edit-rec': ({ id, e }) => {
    if (e.target.closest('[data-act="post-rec"]')) return;
    recForm(S.recurring.find(r => r.id === id));
  },
  'post-rec': ({ id, e }) => {
    e.stopPropagation();
    const r = S.recurring.find(r => r.id === id);
    postRecurring(r);
    save();
    render();
    toast('Registrato');
  },
  'adopt-rec': ({ el }) => {
    const s = detectRecurring()[+el.dataset.i];
    if (s)
      recForm(null, { name: s.name, amount: s.amount, cat: s.cat, accountId: s.accountId, next: s.next });
  },
  'add-goal': () => goalForm(),
  'edit-goal': ({ id }) => goalForm(S.goals.find(g => g.id === id)),
  'fund-goal': ({ id }) => {
    const g = S.goals.find(x => x.id === id);
    openForm(
      'Versa su “' + esc(g.name) + '”',
      [{ k: 'v', label: 'Importo (€)', type: 'number', v: '' }],
      d => {
        const v = num(d.v);
        if (!v) return;
        g.saved = r2(g.saved + v);
        save();
        render();
        toast('Aggiunto ' + eur(v));
      }
    );
  },
  'add-acc': () => accForm(),
  'edit-acc': ({ id }) => accForm(S.accounts.find(x => x.id === id)),
  'save-bud': () => {
    document.querySelectorAll('[data-bud]').forEach(i => {
      const v = num(i.value);
      if (v > 0) S.budgets[i.dataset.bud] = v;
      else delete S.budgets[i.dataset.bud];
    });
    save();
    render();
    toast('Budget salvati');
  },
  close: () => closeForm(),
  'form-del': () => {
    const f = formDel;
    closeForm();
    f && f();
  },
  lock: () => {
    if (bioOn()) softLock();
    else lockNow(false);
  },
  'bio-pref': () => {
    (async () => {
      if (bioOn()) {
        bioDisable();
        renderView();
        toast('Sblocco con Face ID disattivato');
      } else if (!(await bioAvailable()))
        toast('Su questo dispositivo Face ID / impronta non è disponibile nel browser');
      else {
        try {
          await bioEnable();
          renderView();
          toast('Sblocco con Face ID attivo su questo dispositivo');
        } catch (e) {
          toast('Attivazione annullata');
        }
      }
    })();
  },
  quick: () => quickAdd(),
  'own-save': () => {
    S.ownerNames = $('#own-names')
      .value.split(/[;\n]/)
      .map(s => s.trim())
      .filter(Boolean);
    save();
    toast('Intestatari salvati');
  },
  recat: () => {
    let n = 0;
    for (const t of S.tx) {
      if (t.cat !== 'Altro' && t.cat !== 'Altre entrate') continue;
      const c = autoCat(t.note, t.amount);
      if (c !== t.cat) {
        t.cat = c;
        n++;
      }
    }
    save();
    render();
    toast(n + ' movimenti ricategorizzati');
  },
  'inv-tab': ({ el }) => {
    invTab = el.dataset.k;
    renderView();
  },
  'st-per': ({ el }) => {
    stPer = el.dataset.k;
    renderView();
  },
  bal: () => {
    if (balHidden()) askBal();
    else hideBal();
  },
  'bal-pref': () => {
    S.hideBal = S.hideBal === false;
    hideBal();
    save();
    renderView();
    toast(S.hideBal === false ? 'Saldi sempre visibili' : 'Saldi oscurati');
  },
  'tgt-preset': ({ el }) => {
    const w = PRESETS[el.dataset.n];
    document.querySelectorAll('[data-tw]').forEach(i => (i.value = w[i.dataset.tw] || ''));
  },
  'tgt-save': () => {
    const w = {};
    let s = 0;
    document.querySelectorAll('[data-tw]').forEach(i => {
      const v = num(i.value);
      if (v > 0) {
        w[i.dataset.tw] = v;
        s += v;
      }
    });
    if (Math.round(s) !== 100) return toast('La somma deve essere 100% (ora ' + Math.round(s) + '%)');
    S.target = {
      ...(S.target || {}),
      weights: w,
      tol: Math.max(1, num($('#tg-tol').value) || 5),
      cash: num($('#tg-cash').value)
    };
    save();
    renderView();
    toast('Obiettivo salvato');
  },
  'zain-new': () => zainForm(),
  'zain-edit': ({ id }) => {
    const z = (S.zainetto || []).find(x => x.id === id);
    if (z) zainForm(z);
  },
  'fire-reset': () => {
    const age = S.fire && S.fire.age;
    S.fire = { ...fireDefaults(), age: age || '' };
    fireRes = null;
    save();
    renderView();
  },
  more: () => moreSheet(),
  'go-close': ({ el }) => {
    closeForm();
    go(el.dataset.v);
  },
  'asset-new': () => kindPicker(),
  'asset-kind': ({ el }) => {
    closeForm();
    assetForm(null, el.dataset.k);
  },
  'asset-edit': ({ id }) => {
    const x = S.assets.find(z => z.id === id);
    if (x) assetForm(x);
  },
  'asset-estimate': ({ el }) => runEstimate(el.dataset.kind),
  'asset-use-est': () => {
    if (lastEst) {
      const i = document.querySelector('#frm input[name=value]');
      i.value = String(lastEst.mid);
      i.scrollIntoView({ block: 'center' });
      toast('Valore impostato: premi Salva');
    }
  },
  'debt-new': () => debtForm(),
  'debt-edit': ({ id }) => {
    const x = S.debts.find(z => z.id === id);
    if (x) debtForm(x);
  },
  'q-refresh': () => refreshQuotes(true),
  'q-search': () => quoteSearch(null, ''),
  'q-link': ({ id }) => {
    const h = S.holdings.find(x => x.id === id);
    closeForm();
    quoteSearch(id, h ? h.isin || h.ticker || h.name : '');
  },
  'q-unlink': ({ id }) => {
    const h = S.holdings.find(x => x.id === id);
    if (h) {
      Object.assign(h, {
        qSym: null,
        autoPrice: false,
        confirmed: false,
        pending: null,
        qErr: null,
        priceSrc: null,
        priceCheck: null,
        priceExch: null
      });
      save();
      closeForm();
      render();
      toast('Quotazione scollegata: prezzo manuale');
    }
  },
  'q-review': ({ id }) => reviewQuote(id),
  'q-accept': ({ id }) => {
    const h = S.holdings.find(x => x.id === id);
    if (h && h.pending) {
      const p = h.pending;
      Object.assign(h, {
        price: p.priceEur,
        priceAt: p.time,
        priceSrc: p.source,
        priceCheck: p.check,
        priceCur: p.currency,
        priceNative: p.native,
        priceExch: p.exchange || h.priceExch,
        pending: null,
        confirmed: true
      });
      save();
      closeForm();
      render();
      toast('Prezzo confermato');
    }
  },
  'q-reject': ({ id }) => {
    const h = S.holdings.find(x => x.id === id);
    if (h) {
      h.pending = null;
      save();
      closeForm();
      render();
    }
  },
  'q-pick': ({ el }) => pickQuote(+el.dataset.i),
  'q-confirm': ({ el }) => confirmQuote(+el.dataset.i),
  'q-back': () => {
    const q = ($('#qq') || {}).value || '';
    quoteSearch(qTarget, '');
    $('#qq').value = q;
    $('#qres').innerHTML = '';
    qResults.length && doQuoteSearch(q);
  },
  'manual-tx': () => {
    closeForm();
    txForm();
  },
  mic: () => startMic(),
  print: () => window.print(),
  priv: ({ el }) => {
    const k = el.dataset.k;
    S.privacy = { ...PRIV_DEF, ...(S.privacy || {}) };
    S.privacy[k] = !S.privacy[k];
    save();
    render();
  },
  'mcp-new': () => {
    api('POST', '/api/mcp-token')
      .then(r => {
        showMcpToken(r.token);
        refreshMcp();
      })
      .catch(e => toast(e.message));
  },
  'mcp-revoke': () => {
    api('DELETE', '/api/mcp-token').then(() => {
      toast('Token revocato: Claude non può più inserire');
      refreshMcp();
    });
  },
  logout: () => lockNow(true),
  'del-tpl': ({ el }) => {
    delete S.templates[el.dataset.k];
    save();
    render();
  },
  'reimport-ai': () => {
    closeForm();
    (async () => {
      NUMTYPED = lastTyped;
      try {
        showImport(await aiImportSheets(lastSheets));
      } catch (e) {
        toast(e.message);
      } finally {
        NUMTYPED = false;
      }
    })();
  },
  'ai-cat': () => aiCategorize(S.tx.filter(t => t.cat === 'Altro' || t.cat === 'Altre entrate')),
  'del-rule': ({ el }) => {
    delete S.rules[el.dataset.k];
    save();
    render();
  },
  export: () => {
    const j = JSON.stringify(S);
    openForm(
      'Copia leggibile',
      [
        {
          k: 'j',
          label: 'Attenzione: questa copia NON è cifrata. Conservala in un posto sicuro.',
          type: 'textarea',
          v: j
        }
      ],
      () => {},
      null,
      '<button type="button" class="btn" style="width:100%;justify-content:center" data-act="copy-json">Copia negli appunti</button>'
    );
  },
  'rep-mode': ({ el }) => {
    REP.mode = el.dataset.k;
    REP.key = '';
    renderView();
  },
  'rep-detail': ({ el }) => {
    REP.detail = el.dataset.k;
    renderView();
  },
  lang: ({ el }) => setLang(el.dataset.k),
  autolock: ({ el }) => {
    try {
      localStorage.setItem(AUTOLOCK_KEY, el.dataset.k);
    } catch (e) {}
    renderView();
  },
  'export-enc': async () => {
    // same format as the server's daily backups: restorable with `node server.js restore`
    // or from Settings → Ripristina, and readable only with the password
    if (OFFLINE) return toast('Serve la connessione al server');
    const r = await api('GET', '/api/state');
    const backup = {
      app: 'pointofcash',
      created: new Date().toISOString(),
      ver: r.ver,
      kdf_salt: STATUS.kdf_salt,
      kdf_iter: STATUS.kdf_iter,
      blob: r.blob
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
    const link = Object.assign(document.createElement('a'), {
      href: url,
      download: `eyecash-backup-${today()}.json`
    });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('Backup cifrato scaricato: senza la password è illeggibile');
  },
  'copy-json': () => {
    const t = document.querySelector('#frm textarea');
    try {
      navigator.clipboard.writeText(t.value).then(
        () => toast('Copiato'),
        () => {
          t.select();
          toast('Seleziona e copia il testo');
        }
      );
    } catch (_) {
      t.select();
    }
  },
  import: () => {
    openForm(
      'Ripristina backup',
      [
        {
          k: 'j',
          label: 'Incolla il JSON del backup (copia leggibile o backup cifrato)',
          type: 'textarea',
          v: ''
        }
      ],
      async d => {
        try {
          let o = JSON.parse(d.j);
          // encrypted backup made with this password: decrypt it here, on the device
          if (o.blob && o.kdf_salt) {
            if (o.kdf_salt !== STATUS.kdf_salt)
              return toast("Backup di un'altra installazione: ripristinalo dal server (docs/GUIDA.md)");
            o = await decState(o.blob);
          }
          if (!o.accounts || !o.tx) throw 0;
          S = o;
          S.demo = false;
          S.templates = S.templates || {};
          S.rules = S.rules || {};
          processRecurring();
          save();
          render();
          toast('Backup ripristinato');
        } catch (_) {
          toast('Backup non valido');
        }
      }
    );
  },
  // shared by: fresh, reset
  fresh: ({ a }) => {
    openForm(
      a === 'fresh' ? 'Inizia con i tuoi dati' : 'Cancellare tutto?',
      [],
      () => {
        const keep = {
          templates: S.templates,
          rules: S.rules,
          privacy: S.privacy,
          aiLog: S.aiLog,
          inboxPriv: S.inboxPriv,
          inboxPub: S.inboxPub
        };
        S = emptyState();
        if (a === 'fresh') Object.assign(S, keep);
        else {
          S.privacy = keep.privacy;
          S.inboxPriv = keep.inboxPriv;
          S.inboxPub = keep.inboxPub;
        }
        save();
        go('impostazioni');
        toast('Pronto: aggiungi i tuoi conti');
      },
      null,
      `<p class="hint" style="line-height:1.6">${a === 'fresh' ? 'I dati di esempio verranno rimossi. Partirai con un conto vuoto: imposta saldo iniziale, budget e ricorrenti.' : 'Tutti i movimenti, conti, investimenti e obiettivi verranno eliminati.'}</p>`
    );
  },
  reset: (...args) => ACTIONS['fresh'](...args),
  demo: () => {
    const keep = {
      templates: S.templates,
      rules: S.rules,
      privacy: S.privacy,
      aiLog: S.aiLog,
      inboxPriv: S.inboxPriv,
      inboxPub: S.inboxPub
    };
    S = Object.assign(demoState(), keep);
    processRecurring();
    go('home');
  }
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) {
    if (e.target.id === 'sheet') closeForm();
    return;
  }
  const a = el.dataset.act,
    id = el.dataset.id;
  const action = ACTIONS[a];
  if (action) action({ el, id, e, a });
});
document.addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.id === 'askform') {
    const q = ($('#askq').value || '').trim();
    if (q) askAI(q);
    return;
  }
  if (e.target.id === 'chatform') {
    const q = ($('#chatq').value || '').trim();
    if (q) chatSend(q);
    return;
  }
  if (e.target.id === 'affask') {
    const q = ($('#affq').value || '').trim();
    if (q) affordAsk(q);
    return;
  }
  if (e.target.id === 'fireform') {
    const d = Object.fromEntries(new FormData(e.target).entries());
    const n = k => num(d[k]);
    const F = { ...fireDefaults(), ...(S.fire || {}) };
    Object.assign(F, {
      age: Math.round(n('age')) || '',
      endAge: Math.round(n('endAge')) || 95,
      mode: d.mode,
      spending: n('spending'),
      saving: n('saving'),
      savingGrowth: n('savingGrowth'),
      swr: n('swr') || 3.5,
      pension: { amount: n('pension_amount'), fromAge: Math.round(n('pension_fromAge')) || 67 },
      side: { amount: n('side_amount'), untilAge: Math.round(n('side_untilAge')) },
      inclCash: d.inclCash === '1',
      emergencyMonths: n('emergencyMonths'),
      extraStart: n('extraStart'),
      flex: { on: d.flex_on === '1', drop: 20, cut: n('flex_cut') || 10 },
      weightsSrc: d.weightsSrc,
      infl: { mu: n('infl_mu'), sd: n('infl_sd') }
    });
    if (d.retireAge != null) F.retireAge = Math.round(n('retireAge')) || 60;
    if (d.maxWorkAge != null) F.maxWorkAge = Math.round(n('maxWorkAge')) || 70;
    F.ret = {};
    for (const c of EN.CLASSES) {
      const mu = n('mu_' + c.k),
        sd = n('sd_' + c.k);
      if (d['mu_' + c.k] !== undefined && (mu !== c.mu || sd !== c.sd)) F.ret[c.k] = { mu, sd };
    }
    if (!(F.age >= 16 && F.age < F.endAge)) return toast('Controlla età attuale e fine piano');
    if (!(F.spending > 0)) return toast('Inserisci la spesa annua');
    S.fire = F;
    save();
    runFire();
    return;
  }
  if (e.target.id === 'qform') {
    const q = $('#qq').value.trim();
    if (q) doQuoteSearch(q);
    return;
  }
  if (e.target.id === 'frm') {
    const d = Object.fromEntries(new FormData(e.target).entries());
    const f = formSave;
    closeForm();
    f && f(d);
  }
});
document.addEventListener('input', e => {
  if (e.target.form && e.target.form.id === 'affform' && e.target.tagName === 'INPUT') affFromForm(false);
  if (e.target.id === 'q') {
    fQ = e.target.value;
    $('#txlist').innerHTML = txListHTML();
  }
});
document.addEventListener('change', e => {
  if (e.target.form && e.target.form.id === 'affform' && e.target.tagName === 'SELECT') affFromForm(true);
  if (e.target.id === 'fm') {
    fM = e.target.value;
    $('#txlist').innerHTML = txListHTML();
  }
  if (e.target.id === 'fc') {
    fC = e.target.value;
    $('#txlist').innerHTML = txListHTML();
  }
  if (e.target.id === 'repm') {
    REP.key = e.target.value;
    renderView();
  }
  if (e.target.id === 'tg-monthly') {
    S.target = { ...(S.target || {}), monthly: num(e.target.value) };
    save();
    renderView();
  }
  if (e.target.id === 'csv' || e.target.id === 'pfcsv') {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) importFile(f);
  }
});
document.addEventListener('click', e => {
  const b = e.target.closest('.seg button');
  if (!b) return;
  const seg = b.parentElement;
  seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  const nx = seg.nextElementSibling;
  if (nx && nx.tagName === 'INPUT') nx.value = b.dataset.val;
  if (seg.dataset.seg === 'kind') {
    const f = $('#frm'),
      g = f && f.querySelector('.cgrid');
    if (f) f.dataset.kind = b.dataset.val;
    if (g) {
      g.dataset.kind = b.dataset.val;
      const cur = g.querySelector('button.on');
      if (!cur || cur.dataset.k !== b.dataset.val) {
        const first = g.querySelector(`button[data-k="${b.dataset.val}"]`);
        g.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === first));
        g.nextElementSibling.value = first.dataset.c;
      }
    }
  }
});
document.addEventListener('click', e => {
  const b = e.target.closest('.cgrid button');
  if (!b) return;
  const g = b.parentElement;
  g.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  g.nextElementSibling.value = b.dataset.c;
  if (navigator.vibrate) navigator.vibrate(6);
});
const tip = $('#tip');
function showTip(e) {
  const t = e.target.closest && e.target.closest('[data-tip]');
  if (!t) {
    tip.classList.remove('on');
    return;
  }
  tip.textContent = t.getAttribute('data-tip');
  tip.classList.add('on');
  const w = tip.offsetWidth,
    h = tip.offsetHeight;
  let x = e.clientX + 14,
    y = e.clientY - h - 10;
  if (x + w > innerWidth - 8) x = e.clientX - w - 14;
  if (y < 8) y = e.clientY + 16;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}
document.addEventListener('pointermove', showTip);
document.addEventListener('pointerdown', showTip);
document.addEventListener('scroll', () => tip.classList.remove('on'), true);
window.addEventListener('hashchange', () => {
  const h = location.hash.slice(1);
  if (TITLES[h] && h !== view) {
    view = h;
    render();
  }
});
