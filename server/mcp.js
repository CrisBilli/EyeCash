'use strict';
/*
 * EyeCash · server/mcp.js
 *
 * MCP endpoint (for Claude Desktop and other MCP clients). WRITE-ONLY by design:
 * tools can add an expense to an encrypted inbox but can never read balances,
 * accounts or transactions.
 */
const crypto = require('node:crypto');
const { VERSION, localDate } = require('./config');
const { db, getMeta } = require('./db');
const { json, now, readJSON, sha256 } = require('./http');
const { CATS, IN_CATS, OUT_CATS, anon, sealForApp } = require('./text');

/* ---------- MCP: WRITE-ONLY. No tool can read your data. ---------- */
const MCP_TOOLS = [
  {
    name: 'aggiungi_movimento',
    description:
      "Registra una spesa o un'entrata in EyeCash. Lo strumento può SOLO aggiungere: non legge né restituisce alcun dato dei conti.",
    inputSchema: {
      type: 'object',
      properties: {
        tipo: {
          type: 'string',
          enum: ['uscita', 'entrata'],
          description: 'uscita = spesa (predefinito), entrata = incasso'
        },
        importo: { type: 'number', description: 'Importo positivo in euro' },
        descrizione: { type: 'string', description: 'Esercente o descrizione breve, es. "Esselunga"' },
        data: { type: 'string', description: 'AAAA-MM-GG, predefinito oggi' },
        categoria: { type: 'string', enum: CATS, description: "Facoltativa: se assente la sceglie l'app" },
        conto: { type: 'string', description: 'Facoltativo: "carta", "contanti" o il nome del conto' }
      },
      required: ['importo', 'descrizione']
    }
  },
  {
    name: 'elenca_categorie',
    description: "Restituisce l'elenco fisso delle categorie disponibili (nessun dato personale).",
    inputSchema: { type: 'object', properties: {} }
  }
];
const mcpCalls = [];
function mcpAuthorized(req) {
  const h = getMeta('mcp_hash');
  const m = /^Bearer\s+(\S+)$/.exec(req.headers.authorization || '');
  if (!h || !m) return false;
  return crypto.timingSafeEqual(Buffer.from(sha256(m[1]), 'hex'), Buffer.from(h, 'hex'));
}
function mcpTool(name, a) {
  if (name === 'elenca_categorie') return `Uscite: ${OUT_CATS.join(', ')}\nEntrate: ${IN_CATS.join(', ')}`;
  if (name !== 'aggiungi_movimento') throw new Error('Strumento sconosciuto');
  const amount = Math.round(+a.importo * 100) / 100;
  if (!(amount > 0 && amount < 1e7)) throw new Error('Importo non valido');
  const desc = anon(String(a.descrizione || ''))
    .trim()
    .slice(0, 90);
  if (!desc) throw new Error('Descrizione mancante');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(a.data || '') && !isNaN(Date.parse(a.data)) ? a.data : localDate();
  const type = a.tipo === 'entrata' ? 'entrata' : 'uscita';
  const cat = CATS.includes(a.categoria) ? a.categoria : null;
  db.prepare('INSERT INTO inbox(enc, created) VALUES(?,?)').run(
    sealForApp({ type, amount, desc, date, cat, account: String(a.conto || '').slice(0, 40), src: 'mcp' }),
    now()
  );
  return `Registrato: ${type} di ${amount.toFixed(2).replace('.', ',')} € (${desc}, ${date}). Comparirà in EyeCash alla prossima apertura.`;
}
async function mcp(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'POST' });
    return res.end();
  }
  if (!mcpAuthorized(req)) return json(res, 401, { error: 'Token MCP non valido' });
  const t = now() - 6e4;
  while (mcpCalls.length && mcpCalls[0] < t) mcpCalls.shift();
  if (mcpCalls.length >= 60) return json(res, 429, { error: 'Troppe richieste' });
  mcpCalls.push(now());
  const msg = await readJSON(req, 50000);
  const one = async r => {
    if (!r || r.jsonrpc !== '2.0')
      return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Richiesta non valida' } };
    if (r.id === undefined) return null; // notifica
    const ok = result => ({ jsonrpc: '2.0', id: r.id, result });
    switch (r.method) {
      case 'initialize':
        return ok({
          protocolVersion: (r.params && r.params.protocolVersion) || '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'eyecash', version: VERSION },
          instructions:
            'Usa aggiungi_movimento per registrare spese o entrate. Il server è di sola scrittura: non può leggere saldi, conti o movimenti.'
        });
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({ tools: MCP_TOOLS });
      case 'tools/call':
        try {
          return ok({
            content: [
              {
                type: 'text',
                text: mcpTool(r.params && r.params.name, (r.params && r.params.arguments) || {})
              }
            ]
          });
        } catch (e) {
          return ok({ content: [{ type: 'text', text: 'Errore: ' + e.message }], isError: true });
        }
      default:
        return { jsonrpc: '2.0', id: r.id, error: { code: -32601, message: 'Metodo non supportato' } };
    }
  };
  const out = Array.isArray(msg)
    ? (await Promise.all(msg.slice(0, 20).map(one))).filter(Boolean)
    : await one(msg);
  if (!out || (Array.isArray(out) && !out.length)) {
    res.writeHead(202);
    return res.end();
  }
  return json(res, 200, out);
}

module.exports = { mcp };
