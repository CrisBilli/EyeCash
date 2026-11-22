'use strict';
/*
 * EyeCash · server/api.js
 *
 * REST API used by the web app: setup/login, encrypted state sync with optimistic
 * versioning and history, inbox, imports, quotes and the AI helpers. Every AI
 * helper receives only the minimum, already anonymised, data.
 */
const crypto = require('node:crypto');
const { AI_LOCAL, AI_ON, AI_PDF, AI_PROVIDER, KEEP_HISTORY, VERSION, localDate } = require('./config');
const { db, delMeta, getMeta, setMeta } = require('./db');
const {
  authed,
  cookies,
  fails,
  json,
  newSession,
  now,
  readBody,
  readJSON,
  sameOrigin,
  scryptHex,
  sha256,
  tooManyFails
} = require('./http');
const { dailyBackup } = require('./backup');
const { spreadsheetToSheets } = require('./sheets');
const { CATS, EN, IN_CATS, NEUTRAL_CATS, OUT_CATS, anon, parseJSONLoose } = require('./text');
const { QUOTES_ON, historyBatch, quoteBatch, quoteCalls, searchListings } = require('./quotes');
const { callAI } = require('./ai');
const { AI_WEB_SEARCH, estimateAsset } = require('./estimate');

/* ---------- API ---------- */
async function api(req, res, p) {
  const m = req.method;
  if (m !== 'GET' && !sameOrigin(req)) return json(res, 403, { error: 'Richiesta non consentita' });

  if (p === '/api/status' && m === 'GET') {
    return json(res, 200, {
      version: VERSION,
      setup: !!getMeta('auth_hash'),
      authed: authed(req),
      ai: AI_ON,
      aipdf: AI_PDF,
      ai_web: AI_WEB_SEARCH,
      quotes: QUOTES_ON,
      ai_provider: AI_ON ? AI_PROVIDER : null,
      ai_local: AI_ON && AI_LOCAL,
      kdf_salt: getMeta('kdf_salt'),
      kdf_iter: +getMeta('kdf_iter')
    });
  }
  if (p === '/api/setup' && m === 'POST') {
    if (getMeta('auth_hash')) return json(res, 409, { error: 'Password già impostata' });
    const b = await readJSON(req);
    if (!/^[0-9a-f]{64}$/.test(b.authKey || '')) return json(res, 400, { error: 'Dati non validi' });
    const salt = crypto.randomBytes(16).toString('hex');
    setMeta('auth_salt', salt);
    setMeta('auth_hash', scryptHex(b.authKey, salt));
    newSession(req, res, !!b.remember);
    return json(res, 200, { ok: true });
  }
  if (p === '/api/login' && m === 'POST') {
    if (tooManyFails()) return json(res, 429, { error: 'Troppi tentativi. Riprova tra 15 minuti.' });
    const b = await readJSON(req);
    const salt = getMeta('auth_salt'),
      hash = getMeta('auth_hash');
    if (!hash || !/^[0-9a-f]{64}$/.test(b.authKey || '')) return json(res, 400, { error: 'Dati non validi' });
    const ok = crypto.timingSafeEqual(
      Buffer.from(scryptHex(b.authKey, salt), 'hex'),
      Buffer.from(hash, 'hex')
    );
    if (!ok) {
      fails.push(now());
      await new Promise(r => setTimeout(r, 800));
      return json(res, 401, { error: 'Password errata' });
    }
    newSession(req, res, !!b.remember);
    return json(res, 200, { ok: true });
  }
  if (p === '/api/logout' && m === 'POST') {
    const t = cookies(req).sid;
    if (t) db.prepare('DELETE FROM sessions WHERE h=?').run(sha256(t));
    return json(
      res,
      200,
      { ok: true },
      { 'Set-Cookie': 'sid=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' }
    );
  }

  if (!authed(req)) return json(res, 401, { error: 'Accesso richiesto' });

  if (p === '/api/state' && m === 'GET') {
    const r = db.prepare('SELECT blob,ver,updated FROM state WHERE id=1').get();
    return json(res, 200, r ? { blob: r.blob, ver: r.ver, updated: r.updated } : { blob: null, ver: 0 });
  }
  if (p === '/api/state' && m === 'PUT') {
    const b = await readJSON(req, 30e6);
    if (typeof b.blob !== 'string' || !b.blob.startsWith('{"v":1,'))
      return json(res, 400, { error: 'Dati non validi' });
    const cur = db.prepare('SELECT ver FROM state WHERE id=1').get();
    const curVer = cur ? cur.ver : 0;
    if (+b.ver !== curVer) return json(res, 409, { error: 'Conflitto', ver: curVer });
    const ver = curVer + 1,
      t = now();
    db.prepare(
      'INSERT INTO state(id,blob,ver,updated) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET blob=excluded.blob, ver=excluded.ver, updated=excluded.updated'
    ).run(b.blob, ver, t);
    db.prepare('INSERT INTO history(blob,ver,created) VALUES(?,?,?)').run(b.blob, ver, t);
    db.prepare('DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT ?)').run(
      KEEP_HISTORY
    );
    dailyBackup(b.blob, ver);
    return json(res, 200, { ver, updated: t });
  }
  if (p === '/api/spreadsheet' && m === 'POST') {
    const buf = await readBody(req, 15e6);
    try {
      const typed =
        buf.length >= 4 && (buf.readUInt32LE(0) === 0x04034b50 || buf.readUInt32BE(0) === 0xd0cf11e0);
      return json(res, 200, { sheets: spreadsheetToSheets(buf), typed });
    } catch (e) {
      return json(res, e.code === 415 ? 415 : 400, { error: e.message || 'File non leggibile' });
    }
  }
  /* ---- AI: only dedicated DATA-ENTRY endpoints, with a strict format ---- */
  if (p.startsWith('/api/ai/') && !AI_ON) return json(res, 404, { error: 'AI non configurata sul server' });
  if (p === '/api/ai/parse-entry' && m === 'POST') {
    const b = await readJSON(req, 4000);
    const text = anon(String(b.text || ''))
      .slice(0, 300)
      .trim();
    if (!text) return json(res, 400, { error: 'Testo vuoto' });
    const today = localDate();
    const prompt = `Oggi è ${today}. Trasforma questa frase in un movimento da registrare.
Frase: «${text}»
Rispondi SOLO con JSON: {"type":"uscita"|"entrata","amount":numero positivo,"description":"esercente o descrizione breve","date":"AAAA-MM-GG","category":una tra [${CATS.join(', ')}],"account_hint":"carta"|"contanti"|"conto"|null}
Se la data non è indicata usa oggi. Se manca l'importo usa null.`;
    try {
      const out = parseJSONLoose(
        await callAI({
          system: 'Sei un parser di spese. Rispondi solo con JSON valido.',
          messages: [{ role: 'user', content: prompt }],
          fast: true,
          max_tokens: 300
        }),
        '{'
      );
      if (!out) throw new Error('Risposta non valida');
      return json(res, 200, {
        type: out.type === 'entrata' ? 'entrata' : 'uscita',
        amount: Number.isFinite(+out.amount) && +out.amount > 0 ? Math.round(+out.amount * 100) / 100 : null,
        description: String(out.description || '').slice(0, 90),
        date: /^\d{4}-\d{2}-\d{2}$/.test(out.date) ? out.date : today,
        category: CATS.includes(out.category) ? out.category : null,
        account_hint: ['carta', 'contanti', 'conto'].includes(out.account_hint) ? out.account_hint : null
      });
    } catch (e) {
      return json(res, 502, { error: e.message });
    }
  }
  if (p === '/api/ai/ask' && m === 'POST') {
    const b = await readJSON(req, 6000);
    const q = anon(String(b.question || ''))
      .replace(/[<>]/g, '')
      .slice(0, 300)
      .trim();
    if (!q) return json(res, 400, { error: 'Domanda vuota' });
    const accounts = (Array.isArray(b.accounts) ? b.accounts : [])
      .slice(0, 12)
      .map(a => ({
        alias: String(a.alias || '')
          .replace(/[^a-z0-9_]/g, '')
          .slice(0, 12),
        type: ['Conto', 'Carta', 'Risparmio', 'Contanti'].includes(a.type) ? a.type : 'Conto'
      }))
      .filter(a => a.alias);
    const today = localDate();
    const prompt = `Oggi è ${today}. Traduci la domanda dell'utente in una "ricetta" di calcolo.
NON hai accesso ai dati e non devi mai scrivere numeri o importi: i calcoli li fa il dispositivo dell'utente.

Dati che esistono SUL DISPOSITIVO (non a te):
- movimenti: data, importo (negativo = uscita), categoria, descrizione (nome esercente o beneficiario), conto
- investimenti: posizioni attuali con titolo, classe, portafoglio, valore e costo
Categorie: ${CATS.join(', ')}. Giroconti e Investimenti sono neutre: escluse salvo richiesta esplicita.
Conti: ${accounts.map(a => a.alias + ' (' + a.type + ')').join(', ') || 'conto_1 (Conto)'}.

Domanda: «${q}»

Rispondi SOLO con JSON:
{"title":"titolo breve",
 "queries":[{"id":"a","source":"movimenti"|"investimenti",
   "measure":"totale"|"media_mensile"|"conteggio"|"media"|"massimo"|"minimo" (investimenti: "valore"|"costo"|"guadagno"|"conteggio"),
   "type":"uscite"|"entrate"|"saldo"|"tutti",
   "categories":[...] o [], "text":"parola da cercare nella descrizione" o "", "accounts":[...] o [],
   "from":"AAAA-MM-GG" o null, "to":"AAAA-MM-GG" o null,
   "group":"nessuno"|"mese"|"anno"|"categoria"|"giorno_settimana"|"esercente"|"conto" (investimenti: "nessuno"|"titolo"|"classe"|"portafoglio"),
   "limit":10, "order":"desc"|"asc"}],
 "answer":"frase in italiano con i segnaposto",
 "chart":{"query":"a","kind":"barre"|"linea"|"torta"} o null,
 "clarify":""}
Segnaposto: {a} risultato della query a · {a.top} gruppo più alto · {a.top_value} il suo valore · {a.n} numero di movimenti · {diff:a-b} differenza · {pct:a/b} a in % di b · {change:a:b} variazione % di a rispetto a b.
Regole: nessun numero nella risposta, solo segnaposto. Per confrontare periodi usa più query (massimo 4). "Quest'anno" = dal 1 gennaio di quest'anno a oggi; "l'anno scorso" = anno solare precedente; "in media al mese" = media_mensile. Se la domanda non riguarda i dati finanziari o non si può calcolare, lascia "queries" vuoto e scrivi in "clarify" cosa chiedere.`;
    try {
      const raw = parseJSONLoose(
        await callAI({
          system:
            "Traduci domande in interrogazioni strutturate. Rispondi solo con JSON valido. Non conosci i dati dell'utente.",
          messages: [{ role: 'user', content: prompt }],
          fast: false,
          max_tokens: 1200
        }),
        '{'
      );
      const spec = EN.sanitizeSpec(raw, { categories: CATS, accounts: accounts.map(a => a.alias) });
      if (!spec) throw new Error('Non ho capito la domanda: prova a riformularla');
      return json(res, 200, spec);
    } catch (e) {
      return json(res, 502, { error: e.message });
    }
  }
  if (p === '/api/ai/categorize' && m === 'POST') {
    const b = await readJSON(req, 60000);
    const items = (Array.isArray(b.items) ? b.items : [])
      .slice(0, 150)
      .map(x => [
        anon(String((x || [])[0] || '')).slice(0, 90),
        Math.round((+(x || [])[1] || 0) * 100) / 100
      ]);
    if (!items.length) return json(res, 400, { error: 'Nessuna voce' });
    const prompt = `Categorizza questi movimenti. Categorie uscite: ${OUT_CATS.join(', ')}. Categorie entrate: ${IN_CATS.join(', ')}. Categorie neutre (non sono spese né entrate): ${NEUTRAL_CATS.join(', ')} = trasferimenti tra conti propri e acquisto/vendita di titoli. Importo negativo = uscita, positivo = entrata: usa solo categorie del tipo giusto (le neutre vanno bene per entrambi). Se non sei sicuro usa "Altro" o "Altre entrate".
Rispondi SOLO con un array JSON [{"i":indice,"cat":categoria}].
${items.map((x, i) => `${i}. ${x[0]} | ${x[1]}`).join('\n')}`;
    try {
      const arr =
        parseJSONLoose(
          await callAI({
            system: 'Rispondi solo con JSON valido.',
            messages: [{ role: 'user', content: prompt }],
            fast: true,
            max_tokens: 4000
          }),
          '['
        ) || [];
      return json(res, 200, { result: arr.filter(x => x && Number.isInteger(x.i) && CATS.includes(x.cat)) });
    } catch (e) {
      return json(res, 502, { error: e.message });
    }
  }
  if (p === '/api/ai/detect-format' && m === 'POST') {
    const b = await readJSON(req, 60000);
    const rows = (Array.isArray(b.rows) ? b.rows : [])
      .slice(0, 12)
      .map(r => (Array.isArray(r) ? r : []).slice(0, 30).map(c => anon(String(c ?? '')).slice(0, 40)));
    if (!rows.length) return json(res, 400, { error: 'Nessuna riga' });
    const prompt = `Queste sono le prime righe di un estratto conto bancario (righe numerate da 0, celle separate da " ¦ ", colonne numerate da 0). Le cifre degli importi sono mascherate per privacy: conta solo il loro formato.
Rispondi SOLO con JSON:
{"bank_name": nome banca/formato se riconoscibile, altrimenti "Formato banca",
 "header_row": indice della riga di intestazione (-1 se assente),
 "date_col": colonna data operazione (preferisci contabile/operazione alla valuta),
 "date_format": "DMY"|"MDY"|"YMD",
 "desc_cols": [colonne da unire come descrizione],
 "amount_col": colonna importo unico con segno oppure null,
 "debit_col": colonna uscite separate oppure null,
 "credit_col": colonna entrate separate oppure null,
 "decimal": ","|".",
 "expenses_positive": true se nell'importo unico le uscite sono positive}
${rows.map((r, i) => i + ': ' + r.join(' ¦ ')).join('\n')}`;
    try {
      const o = parseJSONLoose(
        await callAI({
          system: 'Sei un parser di estratti conto. Rispondi solo con JSON valido.',
          messages: [{ role: 'user', content: prompt }],
          fast: false,
          max_tokens: 600
        }),
        '{'
      );
      if (!o || !Number.isInteger(o.date_col)) throw new Error('Struttura non riconosciuta');
      const ci = v => (Number.isInteger(v) && v >= 0 && v < 30 ? v : null);
      return json(res, 200, {
        bank_name: String(o.bank_name || 'Formato banca').slice(0, 40),
        header_row: Number.isInteger(o.header_row) ? o.header_row : -1,
        date_col: ci(o.date_col),
        date_format: ['DMY', 'MDY', 'YMD'].includes(o.date_format) ? o.date_format : 'DMY',
        desc_cols: (Array.isArray(o.desc_cols) ? o.desc_cols : [])
          .map(ci)
          .filter(v => v !== null)
          .slice(0, 4),
        amount_col: ci(o.amount_col),
        debit_col: ci(o.debit_col),
        credit_col: ci(o.credit_col),
        decimal: o.decimal === '.' ? '.' : ',',
        expenses_positive: !!o.expenses_positive
      });
    } catch (e) {
      return json(res, 502, { error: e.message });
    }
  }

  if (p === '/api/ai/estimate-asset' && m === 'POST') {
    const b = await readJSON(req, 10000);
    try {
      return json(res, 200, await estimateAsset(String(b.kind || ''), b.fields || {}));
    } catch (e) {
      return json(res, e.code === 400 ? 400 : 502, { error: e.message });
    }
  }

  /* ---- inbox from Claude/MCP: encrypted with the app's public key ---- */
  if (p === '/api/inbox-key' && m === 'PUT') {
    const b = await readJSON(req, 10000);
    try {
      crypto.createPublicKey({ key: b.jwk, format: 'jwk' });
    } catch {
      return json(res, 400, { error: 'Chiave non valida' });
    }
    setMeta('inbox_pub', JSON.stringify({ kty: b.jwk.kty, n: b.jwk.n, e: b.jwk.e }));
    return json(res, 200, { ok: true });
  }
  if (p === '/api/inbox' && m === 'GET')
    return json(res, 200, { items: db.prepare('SELECT id, enc FROM inbox ORDER BY id').all() });
  if (p === '/api/inbox/ack' && m === 'POST') {
    const b = await readJSON(req, 100000);
    const del = db.prepare('DELETE FROM inbox WHERE id=?');
    for (const id of (b.ids || []).slice(0, 1000)) del.run(+id);
    return json(res, 200, { ok: true });
  }
  /* ---- quotazioni ---- */
  if (p.startsWith('/api/quotes') && !QUOTES_ON)
    return json(res, 404, { error: 'Quotazioni disattivate sul server' });
  if (p.startsWith('/api/quotes') && m === 'POST') {
    const t = now() - 6e4;
    while (quoteCalls.length && quoteCalls[0] < t) quoteCalls.shift();
    if (quoteCalls.length >= 30)
      return json(res, 429, { error: 'Troppe richieste di prezzi, riprova tra un minuto' });
    quoteCalls.push(now());
  }
  if (p === '/api/quotes' && m === 'POST') {
    const b = await readJSON(req, 50000);
    const items = (Array.isArray(b.items) ? b.items : [])
      .filter(x => x && typeof x.symbol === 'string')
      .map(x => ({
        id: String(x.id || '').slice(0, 40),
        symbol: x.symbol,
        type: String(x.type || ''),
        isin: String(x.isin || '').slice(0, 12)
      }));
    if (!items.length) return json(res, 400, { error: 'Nessun titolo' });
    try {
      return json(res, 200, await quoteBatch(items));
    } catch (e) {
      return json(res, 502, { error: 'Prezzi non disponibili: ' + e.message });
    }
  }
  if (p === '/api/quotes/history' && m === 'POST') {
    const b = await readJSON(req, 20000);
    const items = (Array.isArray(b.items) ? b.items : [])
      .filter(x => x && (typeof x.symbol === 'string' || typeof x.isin === 'string'))
      .map(x => ({
        id: String(x.id || '').slice(0, 40),
        symbol: String(x.symbol || '').slice(0, 20),
        isin: String(x.isin || '').slice(0, 12),
        type: String(x.type || '').slice(0, 20)
      }));
    if (!items.length) return json(res, 400, { error: 'Nessun titolo' });
    try {
      return json(res, 200, await historyBatch(items));
    } catch (e) {
      return json(res, 502, { error: 'Storico non disponibile: ' + e.message });
    }
  }
  if (p === '/api/quotes/search' && m === 'POST') {
    const b = await readJSON(req, 2000);
    try {
      return json(res, 200, { results: await searchListings(b.q) });
    } catch (e) {
      return json(res, 502, { error: 'Ricerca non disponibile: ' + e.message });
    }
  }
  if (p === '/api/mcp-token' && m === 'POST') {
    const token = 'poc_' + crypto.randomBytes(32).toString('base64url');
    setMeta('mcp_hash', sha256(token));
    setMeta('mcp_created', new Date().toISOString());
    return json(res, 200, { token });
  }
  if (p === '/api/mcp-token' && m === 'DELETE') {
    delMeta('mcp_hash');
    delMeta('mcp_created');
    return json(res, 200, { ok: true });
  }
  if (p === '/api/mcp-token' && m === 'GET')
    return json(res, 200, { active: !!getMeta('mcp_hash'), created: getMeta('mcp_created') });

  if (p === '/api/import-pdf' && m === 'POST') {
    if (!AI_PDF)
      return json(res, 404, {
        error: 'Lettura PDF non disponibile: serve AI_PROVIDER=anthropic con chiave API'
      });
    if (req.headers['x-consent'] !== 'pdf')
      return json(res, 403, { error: 'Invio PDF non autorizzato nelle impostazioni Privacy' });
    const buf = await readBody(req, 25e6);
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-')
      return json(res, 415, { error: 'Il file non è un PDF' });
    const prompt = `Estrai TUTTI i movimenti da questo estratto conto (o estratto della carta di credito).
Rispondi SOLO con un array JSON, un elemento per movimento: ["AAAA-MM-GG", "descrizione", importo]
- data: data dell'operazione (non la valuta), formato AAAA-MM-GG
- descrizione: esercente o causale, breve, senza IBAN né numeri di carta
- importo: numero con punto decimale, NEGATIVO per uscite/addebiti, POSITIVO per entrate/accrediti
Escludi saldi iniziali/finali, totali e righe riepilogative. Nessun altro testo.`;
    try {
      const text = await callAI({
        system: 'Sei un estrattore di dati da estratti conto. Rispondi solo con JSON valido.',
        fast: false,
        max_tokens: 16000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') }
              },
              { type: 'text', text: prompt }
            ]
          }
        ]
      });
      const i = text.indexOf('['),
        k = text.lastIndexOf(']');
      const items = i >= 0 && k > i ? JSON.parse(text.slice(i, k + 1)) : [];
      return json(res, 200, {
        items: Array.isArray(items) ? items.filter(x => Array.isArray(x) && x.length >= 3).slice(0, 5000) : []
      });
    } catch (e) {
      return json(res, 502, { error: 'Lettura PDF non riuscita: ' + e.message });
    }
  }
  return json(res, 404, { error: 'Non trovato' });
}

module.exports = { api };
