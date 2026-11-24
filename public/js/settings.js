/*
 * EyeCash · public/js/settings.js
 *
 * Settings screen: appearance, privacy switches (what may be sent to the
 * AI), Claude/MCP connection, offline copy, export/import of a readable backup.
 */
/** Privacy switches: each one decides what may be sent to the AI. */
function privacyCard() {
  const P = S.privacy || PRIV_DEF;
  return `<div class="card"><h3>Privacy · cosa può uscire</h3>
  <p class="hint" style="margin:6px 0 10px;line-height:1.6"><b style="color:var(--tx)">Regola fissa:</b> saldi, conti, investimenti, obiettivi e lo storico non vengono mai inviati. L'AI serve solo a inserire dati e riceve solo ciò che stai inserendo. ${AI ? `Servizio AI configurato: <b style="color:var(--tx)">${esc(STATUS.ai_provider)}</b>${STATUS.ai_local ? ' · modello locale sul tuo server: le richieste non escono dalla tua rete' : ''}.` : '<b style="color:var(--tx)">Nessuna AI configurata.</b>'} Ogni invio verso l'esterno è elencato nel registro qui sotto.</p>
  ${Object.keys(PRIV_DEF)
    .filter(k => (k === 'quotes' ? STATUS && STATUS.quotes : AI))
    .map(
      k =>
        `<div class="prow"><div class="main"><div class="t1">${PRIV_INFO[k][0]}${k === 'pdf' && !AIPDF ? ' <span class="chip c-mut">solo Anthropic</span>' : ''}</div><div class="t2">${PRIV_INFO[k][1]}</div></div><button class="sw ${P[k] ? 'on' : ''}" data-act="priv" data-k="${k}" aria-label="${PRIV_INFO[k][0]}" ${k === 'pdf' && !AIPDF ? 'disabled' : ''}><i></i></button></div>`
    )
    .join('')}
  <div style="margin-top:14px;font-size:12px;color:var(--tx2);font-weight:600">Registro di ciò che è uscito</div>
  <div class="list">${
    (S.aiLog || [])
      .slice(0, 15)
      .map(l => {
        const d = new Date(l.t);
        return `<div class="row" style="cursor:default;padding:8px 2px;align-items:flex-start"><div class="main"><div class="t1" style="font-size:12.5px">${esc(l.k)} <span class="hint">· ${d.getDate()} ${MESI[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}</span></div><div class="t2" style="white-space:pre-wrap">${esc(l.p)}</div></div></div>`;
      })
      .join('') || '<div class="hint" style="padding:8px 0">Nessun invio finora.</div>'
  }</div></div>`;
}

function mcpCard() {
  return `<div class="card"><h3>Claude via MCP · solo inserimento</h3>
  <p class="hint" style="margin:6px 0 10px;line-height:1.6">Collega Claude Desktop per aggiungere spese a voce o a parole (“segna 12 euro di benzina”). Il collegamento è di <b style="color:var(--tx)">sola scrittura</b>: Claude non può leggere saldi né movimenti. Le spese arrivano cifrate e solo quest'app può aprirle.</p>
  <div id="mcpbox"><div class="hint">Caricamento…</div></div></div>`;
}

async function refreshMcp() {
  const box = $('#mcpbox');
  if (!box) return;
  try {
    const r = await api('GET', '/api/mcp-token');
    box.innerHTML = r.active
      ? `<div class="prow"><div class="main"><div class="t1"><span class="chip c-good">● Attivo</span></div><div class="t2">Token creato il ${dLabel(r.created.slice(0, 10))}</div></div><button class="btn sm danger" data-act="mcp-revoke">Revoca</button></div><button class="btn sm" data-act="mcp-new" style="margin-top:8px">Genera nuovo token</button>`
      : `<button class="btn pri" data-act="mcp-new">Attiva e genera token</button>`;
  } catch (e) {
    box.innerHTML = '<div class="hint">Non disponibile.</div>';
  }
}

function showMcpToken(token) {
  const url = location.origin + '/mcp';
  const cfg = JSON.stringify(
    {
      mcpServers: {
        eyecash: {
          command: 'node',
          args: ['/PERCORSO/eyecash-mcp.js'],
          env: { EYECASH_URL: url, EYECASH_TOKEN: token }
        }
      }
    },
    null,
    2
  );
  openForm(
    'Token MCP',
    [
      {
        k: 'cfg',
        label:
          'Copialo ora: non verrà più mostrato. Incolla in Claude Desktop → Impostazioni → Sviluppatore → Modifica configurazione (vedi docs/GUIDA.md, sezione 6).',
        type: 'textarea',
        v: cfg
      }
    ],
    () => {},
    null,
    '<button type="button" class="btn" style="width:100%;justify-content:center" data-act="copy-json">Copia negli appunti</button>'
  );
}

/* ---------- Settings screen, built from small cards ---------- */

/** One setting: icon + title + explanation on the left, a control on the right. */
const settingRow = (title, hint, control) =>
  `<div class="hbar" style="grid-template-columns:1fr auto;margin-bottom:12px"><span class="nm">${title}<div class="hint">${hint}</div></span>${control}</div>`;

/** Segmented control: options = [[value, label]], `act` is the data-act of each button. */
const segmented = (act, options, current, minWidth = 220) =>
  `<div class="seg" style="min-width:${minWidth}px">${options
    .map(
      ([k, l]) =>
        `<button type="button" data-act="${act}" data-k="${k}" class="${String(current) === String(k) ? 'on' : ''}">${l}</button>`
    )
    .join('')}</div>`;

/** On/off button for a setting. */
const toggleBtn = (act, on, onLabel = 'Attivo', offLabel = 'Attiva') =>
  `<button class="btn sm ${on ? 'pri' : ''}" data-act="${act}">${on ? onLabel : offLabel}</button>`;

function accountsCard() {
  const rows = S.accounts
    .map(
      a =>
        `<div class="row" data-act="edit-acc" data-id="${a.id}"><div class="main"><div class="t1">${esc(a.name)}</div><div class="t2">${esc(a.type)} · saldo iniziale ${eur(a.balance0)}</div></div><div class="amt num">${eur(accBal(a))}</div></div>`
    )
    .join('');
  return `<div class="card"><div class="card-h"><div><h3>Conti</h3><div class="hint">Il saldo iniziale è il saldo prima dei movimenti registrati</div></div><button class="btn sm pri" data-act="add-acc">+ Conto</button></div>
    <div class="list sens">${rows}</div></div>`;
}

function budgetsCard() {
  const rows = OUT_CATS.map(
    c =>
      `<div style="display:flex;align-items:center;gap:10px;padding:5px 0"><span style="flex:1;color:var(--tx2)">${catIc(c)} ${c}</span><input class="inp num" data-bud="${c}" inputmode="decimal" value="${S.budgets[c] || ''}" placeholder="—" style="width:110px;text-align:right"></div>`
  ).join('');
  return `<div class="card"><div class="card-h"><div><h3>Budget mensili</h3><div class="hint">Lascia vuoto per nessun limite</div></div><button class="btn sm pri" data-act="save-bud">Salva</button></div>${rows}</div>`;
}

/** Data, security and privacy of this device. */
function securityCard() {
  const language = settingRow(
    'Lingua',
    "Lingua dell'interfaccia su questo dispositivo. Di partenza è quella del telefono.",
    segmented('lang', LANGS, LANG, 220)
  );
  const theme = settingRow(
    'Aspetto',
    'Chiaro, scuro o come il telefono. Vale per questo dispositivo.',
    segmented(
      'theme',
      [
        ['light', 'Chiaro'],
        ['dark', 'Scuro'],
        ['auto', 'Auto']
      ],
      themePref()
    )
  );
  const autoLock = settingRow(
    'Blocco automatico',
    `Dopo quanto tempo fuori dall'app serve di nuovo ${bioOn() ? 'Face ID o la password' : 'la password'}. Vale per questo dispositivo. Nel multitasking del telefono il contenuto è sempre nascosto.`,
    segmented('autolock', AUTOLOCK_OPTIONS, autoLockMin(), 250)
  );
  const offline = settingRow(
    'Copia offline',
    "Tiene sul dispositivo una copia dei dati, cifrata con la tua password, per aprire l'app e segnare spese anche senza rete. Le modifiche si sincronizzano da sole al ritorno della connessione.",
    toggleBtn('off-pref', offAllowed(), 'Attiva', 'Disattivata')
  );
  const bio = window.PublicKeyCredential
    ? settingRow(
        'Sblocco con Face ID / impronta',
        "Su questo dispositivo: l'app si apre e mostra i saldi con Face ID, impronta o PIN del dispositivo, senza scrivere la password. La password funziona sempre.",
        toggleBtn('bio-pref', bioOn())
      )
    : '';
  const masked = settingRow(
    'Saldi oscurati',
    "Saldi, patrimonio e investimenti restano sfocati: per vederli tocca l'occhio in alto e inserisci la password. Tornano nascosti dopo 2 minuti o quando chiudi l'app.",
    toggleBtn('bal-pref', S.hideBal !== false, 'Attivo', 'Disattivato')
  );
  const backup = `<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-act="export-enc">⬇️ Scarica backup cifrato</button><button class="btn" data-act="export">Esporta copia leggibile (JSON)</button><button class="btn" data-act="import">Ripristina da JSON</button>${S.demo ? '<button class="btn pri" data-act="fresh">Inizia con i miei dati</button>' : '<button class="btn" data-act="demo">Carica dati di esempio</button>'}</div>`;
  const session = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn" data-act="lock">${svgI('lock')}Blocca ora</button><button class="btn" data-act="logout">Esci da questo dispositivo</button><button class="btn danger" data-act="reset">Cancella tutti i dati</button></div>`;
  return `<div class="card"><h3>Dati e sicurezza</h3><div class="hint" style="margin:4px 0 12px;line-height:1.55">I dati sono cifrati sul dispositivo con la tua password prima di arrivare al server. Il server tiene la cronologia delle ultime 200 versioni e un backup cifrato al giorno.</div>
    ${language}${theme}${autoLock}${offline}${bio}${masked}${backup}${session}</div>`;
}

function templatesCard() {
  const rows =
    Object.entries(S.templates || {})
      .map(
        ([k, t]) =>
          `<div class="row" style="cursor:default;padding:8px 2px"><div class="main"><div class="t1">${esc(t.name || 'Formato')}</div><div class="t2">Usato ${t.uses || 0} volte · ${esc(t.created || '')}</div></div><button class="btn sm ghost" data-act="del-tpl" data-k="${esc(k)}">✕</button></div>`
      )
      .join('') || '<div class="hint" style="padding:6px 0">Nessuno ancora.</div>';
  return `<div class="card"><h3>Formati banca memorizzati</h3><p class="hint" style="margin:6px 0 10px;line-height:1.6">Quando importi un report di una banca nuova, l'AI ne capisce la struttura una volta sola. Il formato viene salvato qui e i prossimi import della stessa banca avvengono senza AI.</p>
    <div class="list">${rows}</div></div>`;
}

function aboutCard() {
  return `<div class="card"><h3>Informazioni</h3><p class="hint" style="margin-top:6px;line-height:1.6">EyeCash versione <b style="color:var(--tx)">${esc((STATUS && STATUS.version) || '')}</b> · server di casa · dati cifrati end-to-end.<br>Creata da <b style="color:var(--tx)">0xCris</b> (github.com/CrisBilli) · software libero con licenza Apache 2.0.</p></div>`;
}

function importSettingsCard() {
  const rules =
    Object.entries(S.rules || {})
      .slice(0, 60)
      .map(
        ([k, c]) =>
          `<div class="row" style="cursor:default;padding:7px 2px"><div class="main"><div class="t1" style="font-size:13px">“${esc(k)}” → ${catIc(c)} ${esc(c)}</div></div><button class="btn sm ghost" data-act="del-rule" data-k="${esc(k)}">✕</button></div>`
      )
      .join('') ||
    '<div class="hint" style="padding:8px 0">Nessuna ancora: correggi una categoria in Movimenti.</div>';
  return `<div class="card"><h3>Import automatico</h3><p class="hint" style="margin-top:6px;line-height:1.6">Scarica l'estratto conto in Excel o CSV dall'home banking e importalo in Movimenti. Formati sconosciuti e PDF vengono interpretati dall'AI, se attiva. Le categorie vengono dalle regole (e dall'AI) e i duplicati vengono saltati.</p>
    <div class="fld" style="margin-top:12px"><label>Intestatari dei tuoi conti (per riconoscere i giroconti)</label><div style="display:flex;gap:8px"><input class="inp" id="own-names" value="${esc((S.ownerNames || []).join('; '))}" placeholder="es. Rossi Mario; Mario Rossi" style="flex:1"><button class="btn sm" data-act="own-save">Salva</button></div></div>
    <button class="btn sm" data-act="recat">↻ Ricategorizza i movimenti in “Altro”</button>
    <div style="margin-top:12px;font-size:12px;color:var(--tx2)">Regole imparate (${Object.keys(S.rules || {}).length})</div>
    <div class="list">${rules}</div></div>`;
}

/** Settings screen. */
function vSettings() {
  return `<div class="grid g2">
  ${accountsCard()}
  ${budgetsCard()}
  ${securityCard()}
  ${privacyCard()}
  ${mcpCard()}
  ${templatesCard()}
  ${aboutCard()}
  ${importSettingsCard()}
  </div>`;
}
