'use strict';
/*
 * EyeCash · server/estimate.js
 *
 * Optional market-value estimate for assets (car, home) through the AI.
 */
const { AI_MODEL, AI_PROVIDER, ANTHROPIC_KEY, localDate } = require('./config');
const { anon, parseJSONLoose } = require('./text');
const { callAI } = require('./ai');

/* ---------- ASSET ESTIMATE (car, home, other) ----------
 * Receives ONLY the characteristics of the asset (fields allowed below). Never addresses, names or account values.
 * With Anthropic it uses web search to read current listings/prices and returns the sources.        */
const AI_WEB_SEARCH = AI_PROVIDER === 'anthropic' && process.env.AI_WEB_SEARCH !== 'false';
const ANTHROPIC_BASE = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
const ASSET_FIELDS = {
  auto: ['marca', 'modello', 'versione', 'anno', 'km', 'alimentazione', 'cambio', 'condizioni', 'optional'],
  casa: [
    'comune',
    'zona',
    'cap',
    'mq',
    'tipologia',
    'piano',
    'ascensore',
    'stato',
    'anno_costruzione',
    'classe_energetica',
    'box',
    'giardino',
    'terrazzo'
  ],
  altro: ['categoria', 'descrizione', 'marca', 'modello', 'anno', 'condizioni']
};
const ASSET_DOMAINS = {
  auto: [
    'autoscout24.it',
    'automobile.it',
    'subito.it',
    'quattroruote.it',
    'alvolante.it',
    'autouncle.it',
    'motor1.com'
  ],
  casa: [
    'immobiliare.it',
    'idealista.it',
    'casa.it',
    'borsinoimmobiliare.it',
    'agenziaentrate.gov.it',
    'wikicasa.it'
  ],
  altro: null
};
function cleanAssetFields(kind, f) {
  const out = {};
  for (const k of ASSET_FIELDS[kind] || []) {
    let v = f && f[k];
    if (v === undefined || v === null || v === '') continue;
    v = anon(String(v))
      .replace(/[\r\n]+/g, ' ')
      .trim()
      .slice(0, k === 'descrizione' || k === 'optional' ? 300 : 60);
    if (/\b(via|viale|piazza|corso|vicolo|largo|strada)\s+\S+.*\d/i.test(v)) v = v.replace(/\d+/g, '').trim(); // no street numbers
    if (v) out[k] = v;
  }
  return out;
}
async function anthropicWithSearch({ system, prompt, domains, maxUses = 5, max_tokens = 2500 }) {
  const tools = [
    {
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: maxUses,
      user_location: { type: 'approximate', country: 'IT', timezone: 'Europe/Rome' },
      ...(domains ? { allowed_domains: domains } : {})
    }
  ];
  const messages = [{ role: 'user', content: prompt }];
  const sources = new Map();
  let text = '',
    searches = 0;
  for (let turn = 0; turn < 4; turn++) {
    const r = await fetch(ANTHROPIC_BASE + '/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({ model: AI_MODEL, max_tokens, system, messages, tools }),
      signal: AbortSignal.timeout(180000)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok)
      throw Object.assign(new Error((j.error && j.error.message) || 'Errore AI ' + r.status), { code: 502 });
    for (const b of j.content || []) {
      if (b.type === 'server_tool_use') searches++;
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content))
        for (const x of b.content)
          if (x.url) sources.set(x.url, { url: x.url, title: x.title || x.url, age: x.page_age || '' });
      if (b.type === 'text') {
        text += b.text;
        for (const c of b.citations || [])
          if (c.url) sources.set(c.url, { url: c.url, title: c.title || c.url, cited: true });
      }
    }
    if (j.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: j.content });
      continue;
    }
    break;
  }
  const list = [...sources.values()]
    .sort((a, b) => (b.cited ? 1 : 0) - (a.cited ? 1 : 0))
    .slice(0, 8)
    .map(({ url, title, age }) => ({ url, title: String(title).slice(0, 120), age }));
  return { text, sources: list, searches };
}
function validateEstimate(o, kind) {
  const n = v => (Number.isFinite(+v) && +v > 0 ? Math.round(+v) : null);
  let low = n(o.valore_min),
    mid = n(o.valore_centrale),
    high = n(o.valore_max);
  if (!mid && low && high) mid = Math.round((low + high) / 2);
  if (!mid) throw new Error('Stima non disponibile: dati insufficienti');
  if (!low) low = Math.round(mid * 0.9);
  if (!high) high = Math.round(mid * 1.1);
  [low, mid, high] = [low, mid, high].sort((a, b) => a - b);
  if (mid > 5e7) throw new Error('Stima fuori scala');
  const conf = ['alta', 'media', 'bassa'].includes(o.affidabilita) ? o.affidabilita : 'bassa';
  const out = {
    low,
    mid,
    high,
    confidence: high / low > 1.6 ? 'bassa' : conf,
    basis: String(o.motivazione || '').slice(0, 600)
  };
  if (kind === 'casa') {
    const a = n(o.euro_mq_min),
      b = n(o.euro_mq_max);
    if (a && b) out.perMq = { low: Math.min(a, b), high: Math.max(a, b) };
  }
  if (kind === 'auto') {
    const d = +o.deprezzamento_annuo_pct;
    out.deprec = Number.isFinite(d) && d >= 0 && d <= 40 ? Math.round(d * 10) / 10 : 12;
  }
  out.comparables = (Array.isArray(o.confronti) ? o.confronti : [])
    .slice(0, 5)
    .map(c => ({ desc: String((c && c.descrizione) || '').slice(0, 140), price: n(c && c.prezzo) }))
    .filter(c => c.desc && c.price);
  return out;
}
async function estimateAsset(kind, fields) {
  if (!ASSET_FIELDS[kind]) throw Object.assign(new Error('Tipo di bene non valido'), { code: 400 });
  const f = cleanAssetFields(kind, fields);
  const need = { auto: ['marca', 'modello', 'anno'], casa: ['comune', 'mq'], altro: ['descrizione'] }[kind];
  const miss = need.filter(k => !f[k]);
  if (miss.length) throw Object.assign(new Error('Mancano: ' + miss.join(', ')), { code: 400 });
  const today = localDate();
  const what = {
    auto: 'il valore di mercato attuale in Italia di questa auto usata (prezzo realistico di vendita tra privati / quotazione usato)',
    casa: 'il valore di mercato attuale di questo immobile in Italia, partendo dal prezzo al metro quadro della zona indicata',
    altro: 'il valore di mercato attuale in Italia di questo bene usato'
  }[kind];
  const schema = `{"valore_min": numero in euro, "valore_centrale": numero, "valore_max": numero, "affidabilita": "alta"|"media"|"bassa",
 ${kind === 'casa' ? '"euro_mq_min": numero, "euro_mq_max": numero,' : ''}${kind === 'auto' ? '"deprezzamento_annuo_pct": numero (perdita di valore stimata nei prossimi 12 mesi),' : ''}
 "motivazione": "2-3 frasi: su cosa si basa la stima",
 "confronti": [{"descrizione": "annuncio o dato simile", "prezzo": numero}] (max 5)}`;
  const prompt = `Oggi è ${today}. Stima ${what}.
Caratteristiche: ${JSON.stringify(f)}
${AI_WEB_SEARCH ? 'Cerca sul web annunci comparabili e prezzi attuali (stesso modello/anno/km, oppure €/m² della stessa zona). Basa la stima su dati reali trovati, non su ipotesi.' : 'Non hai accesso a dati aggiornati: dai una stima prudente e imposta affidabilita al massimo "media".'}
Se i dati sono pochi allarga la forchetta e abbassa l'affidabilità. Non inventare annunci.
Alla fine rispondi SOLO con questo JSON (nessun altro testo dopo):
${schema}`;
  const system =
    'Sei un perito estimatore italiano prudente. Usi solo dati verificabili. Rispondi con JSON valido alla fine.';
  let text,
    sources = [],
    searches = 0;
  let web = AI_WEB_SEARCH;
  if (web) {
    try {
      ({ text, sources, searches } = await anthropicWithSearch({
        system,
        prompt,
        domains: ASSET_DOMAINS[kind]
      }));
    } catch (err) {
      if (!/web.?search|tool/i.test(err.message)) throw err;
      web = false;
    } // web search disabled by the organisation → estimate without the web
  }
  if (!web)
    text = await callAI({
      system,
      messages: [{ role: 'user', content: prompt }],
      fast: false,
      max_tokens: 1500
    });
  const vi = text.lastIndexOf('"valore_min"');
  const st = vi >= 0 ? text.lastIndexOf('{', vi) : text.indexOf('{');
  const o = (st >= 0 && parseJSONLoose(text.slice(st), '{')) || parseJSONLoose(text, '{');
  if (!o) throw new Error('Risposta AI non valida');
  const est = validateEstimate(o, kind);
  if (!web && est.confidence === 'alta') est.confidence = 'media';
  return { ...est, sources, searches, web, sent: f, at: Date.now() };
}

module.exports = { AI_WEB_SEARCH, estimateAsset };
