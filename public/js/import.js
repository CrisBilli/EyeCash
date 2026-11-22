/*
 * EyeCash · public/js/import.js
 *
 * Importing bank statements (CSV, Excel, PDF): column detection, saved
 * formats per bank, automatic categorisation rules, duplicate detection against
 * manual entries, credit-card handling, and portfolio snapshots from the broker.
 * Tested on Fineco exports; other banks work through the generic column mapping.
 */
/* ---------- CSV import ---------- */
/** Parses CSV text, guessing the delimiter. */
function parseCSV(text) {
  const head = text.split(/\r?\n/).slice(0, 20).join('\n');
  const delim = [';', ',', '\t'].sort((a, b) => head.split(b).length - head.split(a).length)[0];
  const rows = [];
  let row = [],
    f = '',
    q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          f += '"';
          i++;
        } else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      row.push(f);
      f = '';
    } else if (c === '\n') {
      row.push(f);
      rows.push(row);
      row = [];
      f = '';
    } else if (c !== '\r') f += c;
  }
  if (f || row.length) {
    row.push(f);
    rows.push(row);
  }
  return rows.filter(r => r.some(x => x.trim()));
}
function parseDate(s) {
  s = String(s).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (m) {
    let y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${pad(m[2])}-${pad(m[1])}`;
  }
  return null;
}
/* ---------- Bank statement import: rules → saved formats → AI ---------- */
function cleanCell(c) {
  return String(c ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}
const fingerprint = row => row.map(c => cleanCell(c).toLowerCase()).join('|');
function numDec(v, dec) {
  let s = String(v ?? '').replace(/[€\s ]|EUR/gi, '');
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (/-$/.test(s)) {
    neg = true;
    s = s.slice(0, -1);
  }
  if (dec === ',') s = s.replace(/\./g, '').replace(',', '.');
  else if (dec === '.') s = s.replace(/,/g, '');
  else return num(v);
  const n = parseFloat(s);
  return isNaN(n) ? NaN : neg ? -Math.abs(n) : n;
}
function parseDateFmt(v, fmt) {
  const s = cleanCell(v);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  const p = s.split(/[^0-9]+/).filter(Boolean);
  if (p.length < 3) return null;
  let d, mo, y;
  if (fmt === 'YMD') {
    [y, mo, d] = p;
  } else if (fmt === 'MDY') {
    [mo, d, y] = p;
  } else {
    [d, mo, y] = p;
  }
  if (y.length === 2) y = '20' + y;
  d = +d;
  mo = +mo;
  if (!(d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y.length === 4)) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}
function applyMapping(rows, m) {
  const out = [];
  const start = (m.header_row ?? -1) + 1;
  const descs = Array.isArray(m.desc_cols) ? m.desc_cols : [];
  for (const r of rows.slice(start)) {
    const date = parseDateFmt(r[m.date_col], m.date_format);
    if (!date) continue;
    let amt;
    if (m.amount_col != null && cleanCell(r[m.amount_col])) {
      amt = numDec(r[m.amount_col], m.decimal);
      if (m.expenses_positive) amt = -amt;
    } else {
      const o = m.debit_col != null ? Math.abs(numDec(r[m.debit_col], m.decimal) || 0) : 0,
        i = m.credit_col != null ? Math.abs(numDec(r[m.credit_col], m.decimal) || 0) : 0;
      amt = i - o;
    }
    if (!amt || isNaN(amt)) continue;
    const note =
      descs
        .map(i => cleanCell(r[i]))
        .filter(Boolean)
        .join(' · ')
        .slice(0, 90) || 'Movimento';
    out.push({ date, amount: r2(amt), note, cat: autoCat(note, amt) });
  }
  return out;
}
/** Finds a saved column mapping for a known bank format. */
function matchTemplate(sheets) {
  const T = S.templates || {};
  for (const rows of sheets)
    for (let i = 0; i < Math.min(rows.length, 60); i++) {
      const k = fingerprint(rows[i]);
      if (T[k]) {
        const t = T[k];
        const items = applyMapping(rows, { ...t.map, header_row: i });
        if (items.length) {
          t.uses = (t.uses || 0) + 1;
          return { items, source: t.name };
        }
      }
    }
  return null;
}
const bigSheet = sheets => sheets.reduce((a, b) => (b.length > a.length ? b : a), []);
function maskRows(rows) {
  const start = rows.findIndex(r => r.filter(c => cleanCell(c)).length >= 3);
  if (start < 0) return { start: 0, rows: [] };
  const isDate = c => /^\d{1,4}[\/.\-]\d{1,2}[\/.\-]\d{1,4}$/.test(c);
  return {
    start,
    rows: rows.slice(start, start + 12).map(r =>
      r.slice(0, 30).map(c => {
        c = anon(cleanCell(c)).slice(0, 40);
        return isDate(c) ? c : c.replace(/\d/g, () => String(1 + Math.floor(Math.random() * 9)));
      })
    )
  };
}
/** Asks the AI which column is which, sending only masked sample rows. */
async function aiMapping(rows) {
  const mk = maskRows(rows);
  if (!mk.rows.length) throw new Error('File vuoto');
  logAI(
    'Riconoscimento formato banca',
    mk.rows
      .slice(0, 3)
      .map(r => r.filter(Boolean).join(' ¦ '))
      .join('\n')
  );
  const m = await api('POST', '/api/ai/detect-format', { rows: mk.rows });
  m.header_row = m.header_row >= 0 ? m.header_row + mk.start : mk.start - 1;
  return m;
}
async function aiImportSheets(sheets) {
  const rows = bigSheet(sheets);
  if (!rows.length) throw new Error('File vuoto');
  toast("L'AI sta studiando il formato della banca…");
  const m = await aiMapping(rows);
  const items = applyMapping(rows, m);
  if (!items.length) throw new Error('Nessun movimento trovato con il formato rilevato');
  if (m.header_row >= 0 && rows[m.header_row]) {
    S.templates = S.templates || {};
    const { header_row: _headerRow, bank_name, ...map } = m;
    S.templates[fingerprint(rows[m.header_row])] = {
      name: bank_name || 'Formato banca',
      map,
      created: dLabel(today()),
      uses: 1
    };
  }
  return { items, source: (m.bank_name || 'Formato nuovo') + " · interpretato dall'AI" };
}
/** Entry point for any imported file: detects its type and routes it. */
async function importFile(file) {
  try {
    let sheets,
      typed = false;
    if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
      if (!perm('pdf'))
        throw new Error(
          "La lettura dei PDF è spenta (Impostazioni → Privacy): invierebbe il documento intero. Meglio scaricare l'estratto in Excel o CSV."
        );
      logAI('Lettura PDF', 'File: ' + file.name);
      toast("L'AI sta leggendo il PDF… (può richiedere un minuto)");
      const r = await fetch('/api/import-pdf', {
        method: 'POST',
        headers: { 'X-PointofCash': '1', 'X-Consent': 'pdf', 'Content-Type': 'application/pdf' },
        body: file,
        credentials: 'same-origin'
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'PDF non leggibile');
      const items = (j.items || [])
        .map(x => ({
          date: parseDateFmt(x[0], 'YMD'),
          amount: r2(+x[2]),
          note: cleanCell(x[1]).slice(0, 90) || 'Movimento'
        }))
        .filter(x => x.date && x.amount)
        .map(x => ({ ...x, cat: autoCat(x.note, x.amount) }));
      return showImport({ items, source: "PDF · letto dall'AI" });
    }
    if (/\.(xlsx|xls)$/i.test(file.name)) {
      toast('Leggo il file…');
      const r = await fetch('/api/spreadsheet', {
        method: 'POST',
        headers: { 'X-PointofCash': '1', 'Content-Type': 'application/octet-stream' },
        body: file,
        credentials: 'same-origin'
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'File non leggibile');
      sheets = (j.sheets || []).map(rows => rows.map(r => r.map(c => String(c ?? ''))));
      typed = !!j.typed;
    } else {
      const buf = await file.arrayBuffer();
      let t = new TextDecoder('utf-8').decode(buf);
      if (t.includes(String.fromCharCode(0xfffd))) t = new TextDecoder('windows-1252').decode(buf);
      sheets = [parseCSV(t)];
    }
    lastSheets = sheets;
    lastTyped = typed;
    NUMTYPED = typed;
    const dz = dossierRows(sheets);
    if (dz) return showDossierImport(dz);
    const pf = portfolioRows(sheets);
    if (pf) return showPortfolioImport(pf);
    const tpl = matchTemplate(sheets);
    if (tpl) return showImport(tpl);
    let best = null;
    for (const rows of sheets) {
      const res = importRows(rows);
      if (!res.err && (!best || res.items.length > best.items.length)) best = res;
    }
    if (best && best.items.length) return showImport({ ...best, source: 'Riconosciuto automaticamente' });
    if (perm('format')) return showImport(await aiImportSheets(sheets));
    throw new Error(
      AI
        ? 'Formato non riconosciuto. Attiva “Riconoscimento formato banca” in Impostazioni → Privacy.'
        : "Formato non riconosciuto: scarica l'estratto in un altro formato o attiva l'AI sul server."
    );
  } catch (e) {
    toast(e.message);
  } finally {
    NUMTYPED = false;
  }
}
/* ---------- Broker portfolio snapshot import (e.g. Fineco "Portafoglio di sintesi") ---------- */
/** Recognises a broker portfolio snapshot and reads its positions. */
function portfolioRows(sheets) {
  for (const rows of sheets) {
    for (let i = 0; i < Math.min(rows.length, 40); i++) {
      const h = rows[i].map(x =>
        String(x || '')
          .toLowerCase()
          .trim()
      );
      const ci = h.findIndex(x => x === 'isin' || x === 'codice isin'),
        qi = h.findIndex(x => /^quantit|^q\.t[àa]|^nominale/.test(x));
      if (ci < 0 || qi < 0) continue;
      const f = (re, not) => h.findIndex(x => re.test(x) && !(not && not.test(x)));
      const col = {
        isin: ci,
        qty: qi,
        name: f(/^titolo|^descrizione|^nome|^denominazione/),
        sym: f(/^simbolo|^ticker/),
        kind: f(/^strumento|^tipo/),
        cur: f(/^valuta|^divisa/),
        avg: f(/medio di carico|prezzo medio|p\.?zo medio|pmc/),
        cost: f(/valore di carico|controvalore di carico/),
        price: f(/(p\.?zo|prezzo) di mercato|ultimo prezzo|prezzo attuale/),
        val: f(/valore di mercato|controvalore/, /carico/),
        fx0: f(/cambio di carico/),
        fx1: f(/cambio di mercato/)
      };
      const out = [];
      for (const r of rows.slice(i + 1)) {
        const isin = String(r[ci] || '')
          .trim()
          .toUpperCase();
        if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin)) {
          if (out.length) break;
          continue;
        }
        let qty = num(r[qi]);
        if (!(qty > 0)) continue;
        const g = k => (col[k] >= 0 ? num(r[col[k]]) : 0),
          s = k =>
            col[k] >= 0
              ? String(r[col[k]] || '')
                  .replace(/\s+/g, ' ')
                  .trim()
              : '';
        const name = s('name') || isin,
          kind = s('kind').toLowerCase(),
          cur = (s('cur') || 'EUR').toUpperCase(),
          sym = s('sym').toUpperCase();
        let avg = g('avg'),
          price = g('price');
        const cost = g('cost'),
          val = g('val');
        const bond =
          /obblig|bond|titoli? di stato/.test(kind) ||
          (!/etf|etc|etn|fond|azion/.test(kind) && /\b(btp|bot|cct|ctz|bund|oat)\b/i.test(name));
        if (bond && val > 0 && price > 0 && Math.abs(val - (qty * price) / 100) < Math.max(1, val * 0.03))
          qty = qty / 100; // bonds: nominal and price on a base of 100
        else {
          if (val > 0) price = val / qty;
          else if (cur !== 'EUR' && g('fx1') > 0) price = price * g('fx1'); // valori sempre in €
          if (cost > 0) avg = cost / qty;
          else if (cur !== 'EUR' && g('fx0') > 0) avg = avg * g('fx0');
        }
        if (bond && cost > 0 && Math.abs(cost - qty * avg) > Math.max(1, cost * 0.03)) avg = cost / qty;
        const type = bond
          ? 'Obbligazioni'
          : /etf|etc|etn/.test(kind)
            ? 'ETF'
            : /azion|stock|equity/.test(kind)
              ? 'Azioni'
              : /fond|sicav/.test(kind)
                ? 'Fondi'
                : /crypto/.test(kind)
                  ? 'Crypto'
                  : 'Altro';
        let cls = null;
        const n = name.toLowerCase();
        if (type === 'ETF' || type === 'Fondi') {
          if (/overnight|money market|monetar|€str|estr\b|liquidity/.test(n)) cls = 'liquidita';
          else if (
            /\bbond|govt|government|treasur|obblig|aggregate|corporate|\bbtp|high yield|inflation/.test(n)
          )
            cls = 'obbligazioni';
          else if (/\bgold\b|\boro\b/.test(n)) cls = 'oro';
          else if (/reit|real estate|immobil|property/.test(n)) cls = 'immobiliare';
        }
        out.push({
          name: name.slice(0, 80),
          isin,
          sym,
          ticker: (sym.split('.')[0] || isin).slice(0, 12),
          type,
          cls,
          cur,
          qty: +qty.toFixed(6),
          avg: +(avg || price).toFixed(5),
          price: +(price || avg).toFixed(5)
        });
      }
      if (out.length) return out;
    }
  }
  return null;
}
let pendingPf = null;
function showPortfolioImport(items) {
  pendingPf = items;
  let PF = invPf || '';
  const find = it =>
    S.holdings.find(
      h =>
        (h.pf || '') === PF &&
        ((h.isin && h.isin === it.isin) || (!h.isin && h.ticker && h.ticker === it.ticker))
    );
  const demo = S.demo,
    nNew = demo ? items.length : items.filter(it => !find(it)).length,
    nUpd = items.length - nNew;
  const goneOf = () => S.holdings.filter(h => (h.pf || '') === PF && !pendingPf.some(it => find(it) === h));
  const gone = demo ? [] : goneOf();
  const cost = items.reduce((s, i) => s + i.qty * i.avg, 0),
    val = items.reduce((s, i) => s + i.qty * i.price, 0);
  const fields = [];
  if (!demo && (pfs().length || S.holdings.length))
    fields.push(
      {
        k: 'pf',
        label: 'In quale portafoglio?',
        type: 'select',
        v: PF,
        options: [['', pfName('')], ...pfs().map(p => [p.id, p.name]), ['__new', '➕ Nuovo portafoglio…']]
      },
      { k: 'pfname', label: 'Nome del nuovo portafoglio (solo se ne crei uno)', v: '', ph: 'es. Fineco' }
    );
  if (gone.length)
    fields.push({
      k: 'gone',
      label: `${gone.length} posizioni che hai nell'app non sono nel file`,
      type: 'select',
      v: 'keep',
      options: [
        ['keep', 'Lasciale (es. altro broker)'],
        ['del', 'Rimuovile (vendute)']
      ]
    });
  const list = items
    .map(
      i =>
        `<div style="display:flex;gap:8px;font-size:12px;padding:5px 0;border-top:1px solid var(--line)"><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.name)}</span><span class="num" style="color:var(--mut);flex:none">${String(i.qty).replace('.', ',')} ×</span><span class="num" style="flex:none">${eur(i.qty * i.price)}</span></div>`
    )
    .join('');
  openForm(
    'Importa portafoglio',
    fields,
    d => {
      if (S.demo) {
        const keep = {
          templates: S.templates,
          rules: S.rules,
          privacy: S.privacy,
          aiLog: S.aiLog,
          inboxPriv: S.inboxPriv,
          inboxPub: S.inboxPub
        };
        S = Object.assign(emptyState(), keep);
      }
      if (d.pf === '__new') {
        const n = (d.pfname || '').trim().slice(0, 30);
        if (!n) return toast('Scrivi il nome del nuovo portafoglio');
        S.portfolios = pfs();
        const p = { id: 'pf' + uid(), name: n };
        S.portfolios.push(p);
        PF = p.id;
      } else if (d.pf !== undefined) PF = d.pf;
      const goneNow = d.gone === 'del' ? goneOf() : [];
      let a = 0,
        u = 0;
      const linkable = s => /^[A-Z0-9-]{1,12}\.[A-Z]{1,3}$/.test(s);
      for (const it of pendingPf) {
        const h = find(it);
        if (h) {
          Object.assign(h, { qty: it.qty, avg: it.avg, isin: it.isin });
          h.price = it.price;
          h.pending = null;
          if (!h.qSym && linkable(it.sym))
            Object.assign(h, { qSym: it.sym, autoPrice: true, confirmed: true });
          if (!h.cls && it.cls) h.cls = it.cls;
          u++;
        } else {
          const link = linkable(it.sym) ? { qSym: it.sym, autoPrice: true, confirmed: true } : {};
          S.holdings.push({
            id: uid(),
            name: it.name,
            ticker: it.ticker,
            isin: it.isin,
            type: it.type,
            cls: it.cls,
            qty: it.qty,
            avg: it.avg,
            price: it.price,
            priceSrc: 'broker',
            priceAt: Date.now(),
            ...(PF ? { pf: PF } : {}),
            ...link
          });
          a++;
        }
      }
      let r = 0;
      if (d.gone === 'del') {
        const ids = new Set(goneNow.map(h => h.id));
        r = ids.size;
        S.holdings = S.holdings.filter(h => !ids.has(h.id));
      }
      if (pfs().length) invPf = PF;
      S.trades = S.trades || [];
      if (S.trades.length) autoMatchTrades();
      save();
      invTab = 'pos';
      go('investimenti');
      toast(`${a} posizioni aggiunte` + (u ? ` · ${u} aggiornate` : '') + (r ? ` · ${r} rimosse` : ''));
      if (perm('quotes')) setTimeout(() => refreshQuotes(false), 800);
    },
    null,
    `<p class="hint" style="line-height:1.6;margin-bottom:8px"><span class="chip c-info">Portafoglio titoli riconosciuto</span><br>Trovate <b style="color:var(--tx)">${items.length}</b> posizioni: <b style="color:var(--tx)">${nNew}</b> nuove${nUpd ? `, <b style="color:var(--tx)">${nUpd}</b> da aggiornare (quantità e prezzo di carico)` : ''}.<br>Valore di carico <b class="num" style="color:var(--tx)">${eur(cost)}</b> · valore di mercato <b class="num" style="color:var(--tx)">${eur(val)}</b>: confrontali con i totali del broker.</p><div style="margin-bottom:10px">${list}</div>`
  );
}
let lastSheets = null,
  lastTyped = false;
const titleCase = s =>
  String(s)
    .toLowerCase()
    .replace(/(^|[\s'’(.-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
function buildNote(parts, amt) {
  const full = parts.join(' ').replace(/\s+/g, ' ');
  const label = parts[0] || '';
  const party = partyOf(full, amt);
  if (party && /bonific|stipend|sepa|giroconto|accredito|pensione/i.test(full)) {
    const cm = full.match(/causale\s*:\s*(.+?)(?=\s+(?:trn|canale|data|iban|ins)\b|$)/i);
    const lab = /bonific/i.test(label) || !label ? 'Bonifico' : label.slice(0, 30);
    return `${lab} ${amt < 0 ? 'a' : 'da'} ${titleCase(party).slice(0, 45)}${cm ? ' · ' + cm[1].trim().slice(0, 30) : ''}`;
  }
  const clean = s =>
    s
      .replace(/\d{4}\s?\*{2,}[\s*\d]*/g, ' ')
      .replace(/\*{2,}[\s*]*\d{2,4}/g, ' ')
      .replace(/\b(posizione|mand(ato)?|qta\/val|ndg|dossier|addebito sdd|data inserimento|trn)\b.*$/i, '')
      .replace(/\s+[A-Z]{3}$/, '')
      .replace(/\s+/g, ' ')
      .trim();
  const generic =
    /^(monofunzione|contactless|pagamento (pos|carta|contactless)|pos |utilizzo carta|operazione carta|sepa direct debit|addebito diretto|pagamento)/i;
  const info = parts.map(clean).filter(Boolean);
  const best = info.find((p, i) => !(generic.test(parts[i]) && info.length > 1)) || info[0] || '';
  let pick = info.length > 1 && generic.test(parts[0]) ? info.slice(1).join(' · ') : best;
  if (info.length > 1 && info[1].toLowerCase().startsWith(info[0].toLowerCase().slice(0, 15))) pick = info[1];
  return titleCase(pick).slice(0, 80);
}
function importRows(rows) {
  let hi = -1,
    col = {},
    owner = null;
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const raw = rows[i].map(x => String(x ?? '').trim()),
      h = raw.map(x => x.toLowerCase());
    const ne = raw.filter(Boolean);
    if (ne.length < 3 || ne.some(x => x.length > 40)) continue;
    const di = h.findIndex(x => /data|date|valuta|contabil/.test(x));
    if (di < 0) continue;
    const ai = h.findIndex((x, j) => j !== di && /importo|amount|ammontare|valore/.test(x));
    const oi = h.findIndex((x, j) => j !== di && /uscit|addebit|\bdare\b|debit/.test(x));
    const ii = h.findIndex((x, j) => j !== di && /entrat|accredit|avere|credit/.test(x));
    if (ai < 0 && oi < 0 && ii < 0) continue;
    const used = new Set([di, ai, oi, ii]);
    const des = h
      .map((x, j) => j)
      .filter(
        j =>
          !used.has(j) &&
          /descri|causale|dettagl|operazion|beneficiar|memo|esercente|merchant|controparte|note/.test(h[j]) &&
          !/data|date|valuta/.test(h[j])
      );
    const vi = h.findIndex((x, j) => j !== di && /valuta/.test(x));
    hi = i;
    col = { di, vi, ai, oi, ii, des };
    break;
  }
  if (hi < 0) return { err: 'Non trovo le colonne Data e Importo nel file.' };
  for (const r of rows.slice(0, hi)) {
    for (const c of r) {
      const m = String(c || '').match(/(?:intestazione|intestatario|titolare)[^:]*:\s*(.+)/i);
      if (m) {
        owner = m[1].replace(/\s+/g, ' ').trim().slice(0, 60);
        break;
      }
    }
    if (owner) break;
  }
  if (owner && S) {
    S.ownerNames = S.ownerNames || [];
    if (!S.ownerNames.some(o => o.toLowerCase() === owner.toLowerCase())) S.ownerNames.push(owner);
  }
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    const date = parseDate(r[col.di] || '');
    if (!date) continue;
    let amt = 0;
    if (col.ai >= 0 && String(r[col.ai] || '').trim()) amt = num(r[col.ai]);
    else {
      const o = col.oi >= 0 ? Math.abs(num(r[col.oi])) : 0,
        i = col.ii >= 0 ? Math.abs(num(r[col.ii])) : 0;
      amt = i - o;
    }
    if (!amt) continue;
    const parts = col.des.map(j => cleanCell(r[j])).filter(Boolean);
    const full = parts.join(' · ');
    const it = { date, amount: r2(amt), note: buildNote(parts, amt) || 'Movimento', cat: autoCat(full, amt) };
    const vd = col.vi >= 0 ? parseDate(r[col.vi] || '') : '';
    if (vd) it.vd = vd;
    const tr = tradeFromText(full);
    if (tr) it.trade = tr;
    if (
      /utilizzo carta di credito|addebito (?:estratto )?carta di credito|saldo carta di credito|estratto conto carta/i.test(
        full
      )
    )
      it.settle = true;
    else if (
      amt < 0 &&
      /\*{4}/.test(full) &&
      /contactless|monofunzione|carta|card|visa|mastercard/i.test(full)
    )
      it.cardTx = true;
    out.push(it);
  }
  detectCreditCard(out);
  return { items: out, owner };
}

const normKey = s =>
  String(s || '')
    .toLowerCase()
    .replace(/[0-9*#\/.,:;\-_()]+/g, ' ')
    .replace(
      /\b(pagamento|pos|carta|acquisto|presso|del|il|su|n|op|addebito|sdd|bonifico|a favore di|vs|da)\b/g,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 3)
    .join(' ');

function partyOf(text, amt) {
  const re =
    amt < 0
      ? /(?:beneficiario|\bben)\s*:\s*(.+?)(?=\s+(?:iban|ins|dt-ord|data|banca|causale|trn|canale|da|ord)\b\s*:|$)/i
      : /(?:ordinante|\bord)\s*:\s*(.+?)(?=\s+(?:ben|beneficiario|iban|dt-ord|data|banca|causale)\b\s*:|$)/i;
  const m = String(text).match(re);
  return m ? m[1].trim() : '';
}

function isSelfTransfer(text, amt) {
  const owners = (S && S.ownerNames) || [];
  if (!owners.length) return false;
  const p = partyOf(text, amt)
    .toLowerCase()
    .replace(/[^a-zà-ú]/g, '');
  if (!p) return false;
  return owners.some(o => {
    const tk = o
      .toLowerCase()
      .split(/[^a-zà-ú]+/)
      .filter(w => w.length >= 3);
    return tk.length >= 2 && tk.every(w => p.includes(w));
  });
}

/** Automatic category from rules, learned merchants and the description. */
function autoCat(desc, amt) {
  const s = ' ' + String(desc).toLowerCase() + ' ';
  const k = normKey(desc);
  const ur = (S && S.rules) || {};
  if (k && ur[k] && signOk(ur[k], amt)) return ur[k];
  if (isSelfTransfer(desc, amt)) return 'Giroconti';
  for (const [re, c] of RULES) {
    if (re.test(s)) {
      if (isNeutral(c)) return c;
      if (amt > 0 && OUT_CATS.includes(c)) continue;
      if (amt < 0 && IN_CATS.includes(c)) continue;
      return c;
    }
  }
  return amt > 0 ? 'Altre entrate' : 'Altro';
}

/* Credit cards: the bank lists every purchase AND then the monthly debit on the account.
   If the purchases of a month (by value date) add up to a debit, it is a credit card:
   purchases go to the "Carta di credito" account (counted once in spending, with their
   category) and the debit becomes a transfer. */
function detectCreditCard(items) {
  const card = items.filter(i => i.cardTx),
    settle = items.filter(i => i.settle);
  for (const i of items) {
    delete i.acc;
  }
  if (!card.length || !settle.length) return false;
  const byM = {};
  for (const c of card) {
    const k = (c.vd || c.date).slice(0, 7);
    byM[k] = (byM[k] || 0) + c.amount;
  }
  const sums = Object.values(byM).map(v => Math.round(v * 100));
  if (!settle.some(s => sums.includes(Math.round(s.amount * 100)))) return false;
  for (const c of card) c.acc = 'card';
  for (const s of settle) {
    s.cat = 'Giroconti';
    s.acc = 'main';
  }
  return true;
}

function cardAccount() {
  let a = S.accounts.find(x => x.type === 'Carta');
  if (!a) {
    a = { id: 'cc' + uid(), name: 'Carta di credito', type: 'Carta', balance0: 0 };
    S.accounts.push(a);
  }
  return a;
}

/* Recognises what is already there: 1) the same row already imported (date+amount+description);
   2) an entry typed by hand / by voice / from a recurring item: same amount, same account,
   bank date between 2 days before and 5 after (cards post late).
   On a tie the same category wins, then the closest date. Each entry can be matched
   only once. All local, no AI. */
const dDiff = (a, b) => Math.round((pd(a) - pd(b)) / 864e5);

/** Finds a manual entry that matches an imported row (smart dedupe). */
function matchExisting(items, accountId) {
  const accOf = it => it.accountId || accountId;
  const pool = S.tx.filter(t => items.some(it => accOf(it) === t.accountId));
  const used = new Set(),
    res = items.map(() => null);
  const byKey = {};
  for (const t of pool) {
    const k = t.date + '|' + t.amount + '|' + t.note;
    (byKey[k] = byKey[k] || []).push(t);
  }
  items.forEach((it, i) => {
    const l = byKey[it.date + '|' + it.amount + '|' + it.note];
    const t = l && l.find(x => !used.has(x.id) && x.accountId === accOf(it));
    if (t) {
      used.add(t.id);
      res[i] = { t, exact: true };
    }
  });
  const manual = pool.filter(t => t.src !== 'imp' && !used.has(t.id));
  items.forEach((it, i) => {
    if (res[i]) return;
    let best = null,
      score = -1e9;
    for (const t of manual) {
      if (
        used.has(t.id) ||
        t.accountId !== accOf(it) ||
        Math.round(t.amount * 100) !== Math.round(it.amount * 100)
      )
        continue;
      const dd = dDiff(it.date, t.date);
      if (dd < -2 || dd > 5) continue;
      const s = (t.cat === it.cat ? 10 : 0) - Math.abs(dd);
      if (s > score) {
        score = s;
        best = t;
      }
    }
    if (best) {
      used.add(best.id);
      res[i] = { t: best, exact: false };
    }
  });
  return res;
}

/** Import preview: new, duplicate and merged rows before confirming. */
function showImport(res) {
  if (res.err) {
    toast(res.err);
    return;
  }
  const items = res.items;
  if (!items.length) {
    toast('Nessun movimento trovato nel file');
    return;
  }
  const auto = items.filter(i => i.cat !== 'Altro' && i.cat !== 'Altre entrate').length;
  pendingImport = items;
  const rest = items.length - auto;
  const dates = items.map(i => i.date).sort();
  const m0 = matchExisting(items, S.accounts[0]?.id),
    nEx = m0.filter(x => x && x.exact).length,
    nMan = m0.filter(x => x && !x.exact).length;
  const fields = [
    { k: 'accountId', label: 'Su quale conto?', type: 'select', v: S.accounts[0]?.id, options: accOpts() }
  ];
  const nCard = items.filter(i => i.acc === 'card').length,
    nSet = items.filter(i => i.settle && i.acc).length;
  if (nMan)
    fields.push({
      k: 'dup',
      label: `${nMan} movimenti sembrano già inseriti a mano`,
      type: 'select',
      v: 'skip',
      options: [
        ['skip', 'Saltali (consigliato)'],
        ['add', 'Importali comunque']
      ]
    });
  if (perm('categorize') && rest)
    fields.push({
      k: 'ai',
      label: `Le altre ${rest} voci`,
      type: 'select',
      v: '1',
      options: [
        ['1', "Falle categorizzare all'AI"],
        ['0', 'Lasciale in “Altro”']
      ]
    });
  const prev = items
    .slice(0, 5)
    .map(
      i =>
        `<div style="display:flex;gap:8px;font-size:12px;padding:4px 0;border-top:1px solid var(--line)"><span class="num" style="color:var(--mut);flex:none">${i.date.slice(8)}/${i.date.slice(5, 7)}</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.note)}</span><span class="num ${i.amount > 0 ? 'up' : ''}">${eur(i.amount)}</span></div>`
    )
    .join('');
  openForm(
    'Importa estratto conto',
    fields,
    async d => {
      if (S.demo) {
        const keep = {
          templates: S.templates,
          rules: S.rules,
          privacy: S.privacy,
          aiLog: S.aiLog,
          inboxPriv: S.inboxPriv,
          inboxPub: S.inboxPub
        };
        S = Object.assign(emptyState(), keep);
        d.accountId = S.accounts[0].id;
      }
      let fixed = 0;
      if (pendingImport.some(i => i.acc === 'card')) {
        const cc = cardAccount(),
          main = d.accountId,
          list = [];
        for (const it of pendingImport) {
          if (it.acc === 'card') {
            // repair: purchases imported earlier on the main account → moved to the card
            const old = S.tx.find(
              t => t.accountId === main && t.date === it.date && t.amount === it.amount && t.note === it.note
            );
            if (old) {
              old.accountId = cc.id;
              fixed++;
            }
            list.push({ ...it, accountId: cc.id });
          } else if (it.settle) {
            const old = S.tx.find(
              t => t.accountId === main && t.date === it.date && t.amount === it.amount && t.note === it.note
            );
            if (old && old.cat !== 'Giroconti') {
              old.cat = 'Giroconti';
              fixed++;
            }
            list.push({ ...it, accountId: main });
            list.push({
              date: it.date,
              amount: -it.amount,
              note: 'Pagamento carta di credito dal conto',
              cat: 'Giroconti',
              accountId: cc.id
            });
          } else list.push({ ...it, accountId: main });
        }
        pendingImport = list;
      }
      const mt = matchExisting(pendingImport, d.accountId);
      const added = [];
      let skE = 0,
        skM = 0;
      pendingImport.forEach((it, i) => {
        const m = mt[i];
        if (m && m.exact) {
          skE++;
          return;
        }
        if (m && d.dup !== 'add') {
          skM++;
          if (!m.t.bankNote) m.t.bankNote = it.note;
          return;
        } // keep the user's entry and attach the bank's description
        const t = { id: uid(), ...it, src: 'imp', accountId: it.accountId || d.accountId };
        delete t.acc;
        delete t.cardTx;
        delete t.settle;
        delete t.vd;
        delete t.trade;
        S.tx.push(t);
        added.push(t);
      });
      const nTr = addTradesFrom(pendingImport);
      save();
      go('movimenti');
      toast(
        `${added.length} importati` +
          (skE ? ` · ${skE} già presenti` : '') +
          (skM ? ` · ${skM} già inseriti a mano` : '') +
          (fixed ? ` · ${fixed} corretti (carta di credito)` : '') +
          (nTr ? ` · ${nTr} operazioni titoli` : '')
      );
      if (d.ai === '1') await aiCategorize(added.filter(t => t.cat === 'Altro' || t.cat === 'Altre entrate'));
    },
    null,
    `<p class="hint" style="line-height:1.6;margin-bottom:8px"><span class="chip c-info">${esc(res.source || '')}</span><br>Trovati <b style="color:var(--tx)">${items.length}</b> movimenti dal ${dLabel(dates[0])} al ${dLabel(dates[dates.length - 1])}, <b style="color:var(--tx)">${auto}</b> già categorizzati.${nCard ? ` <br><b style="color:var(--tx)">💳 Carta di credito riconosciuta:</b> ${nCard} acquisti vanno sul conto “Carta di credito” e i ${nSet} addebiti mensili diventano giroconti, così ogni spesa conta una volta sola.` : ''}${nEx ? ` <b style="color:var(--tx)">${nEx}</b> erano già stati importati e verranno saltati.` : ''}${nMan ? ` <b style="color:var(--tx)">${nMan}</b> corrispondono a spese che hai inserito a mano (stesso importo, data vicina).` : ''}${S.demo ? ' I dati di esempio verranno sostituiti.' : ''}</p>
    <div style="margin-bottom:10px">${prev}</div>
    ${perm('format') && lastSheets && !/AI/.test(res.source || '') ? '<button type="button" class="btn sm" data-act="reimport-ai" style="margin-bottom:8px">Non torna? Fai interpretare il file all\'AI</button>' : ''}`
  );
}

async function aiCategorize(list) {
  if (!perm('categorize') || !list.length) return;
  const keys = [...new Map(list.map(t => [normKey(t.note) || t.note.toLowerCase(), t])).values()].slice(
    0,
    150
  );
  toast(`L'AI sta categorizzando ${keys.length} voci…`);
  logAI(
    'Categorizzazione spese',
    `${keys.length} voci: ` +
      keys
        .slice(0, 6)
        .map(t => anon(t.note) + ' ' + t.amount)
        .join(', ') +
      (keys.length > 6 ? '…' : '')
  );
  try {
    const r = await api('POST', '/api/ai/categorize', { items: keys.map(t => [anon(t.note), t.amount]) });
    S.rules = S.rules || {};
    let n = 0;
    for (const x of r.result || []) {
      const t = keys[x.i];
      if (!t || x.cat === 'Altro' || x.cat === 'Altre entrate') continue;
      if (!signOk(x.cat, t.amount)) continue;
      const k = normKey(t.note);
      if (k) S.rules[k] = x.cat;
      for (const y of list) {
        if (
          (normKey(y.note) || y.note.toLowerCase()) === (k || t.note.toLowerCase()) &&
          y.amount > 0 === t.amount > 0
        ) {
          y.cat = x.cat;
          n++;
        }
      }
    }
    save();
    render();
    toast(`L'AI ha categorizzato ${n} movimenti`);
  } catch (e) {
    toast('Categorizzazione AI non riuscita: ' + e.message);
  }
}

const RULES = [
  [/giroconto|trasferimento tra (i )?(miei )?conti/, 'Giroconti'],
  [
    /compravendita titoli|acquisto titoli|vendita titoli|interactive brokers|degiro|directa sim|trade republic|scalable capital|sottoscrizione fond|versamento pac/,
    'Investimenti'
  ],
  [/estratto conto .*carta di credito|saldo carta di credito|addebito carta di credito/, 'Carta di credito'],
  [
    /riten|imposta|\bbollo\b|f24|delega i24|canone mensile|commission|spese tenuta|competenze|cbill|pagopa|agenzia (delle )?entrate/,
    'Tasse e commissioni'
  ],
  [
    /findomestic|\bagos\b|compass|cofidis|santander consumer|younited|finanziament|rata prestito|prestito personale/,
    'Rate e finanziamenti'
  ],
  [/autolavaggio|parchegg|carrozzeri|gommist|officina|revisione auto|telepass/, 'Trasporti'],
  [
    /rent ?a ?car|autonoleggio|hertz|europcar|\bavis\b|\bsixt\b|booking\.com|airbnb|ryanair|easyjet|wizz/,
    'Viaggi'
  ],
  [/\basl\b|asltc|distretto sanit|ospedal|farmaci|dentist|ottica|poliambulat/, 'Salute'],
  [/\bagip\b|\besso\b|\bshell\b|\bip\b|\bapi\b|tamoil|carburant|benzin|distributore|enilive/, 'Trasporti'],
  [
    /cervesia|vinai|angolo del gusto|bierst|birreria|\bpub\b|osteria|enoteca|gelateri|pasticceri|panifici|\bforno\b|bistrot|kebab|ristor|pizz|caff[eè]|\bbar\b|trattoria/,
    'Ristoranti'
  ],
  [/affitto|mutuo|condominio/, 'Casa'],
  [
    /enel|a2a|hera|iren|plenitude|edison|acea|sorgenia|\btim\b|vodafone|fastweb|iliad|windtre|bolletta/,
    'Utenze'
  ],
  [/netflix|spotify|disney|prime video|icloud|apple\.com|youtube|dazn|now tv|chatgpt|claude/, 'Abbonamenti'],
  [/esselunga|conad|coop|lidl|carrefour|eurospin|pam |aldi|penny|supermerc|iper/, 'Spesa'],
  [
    /\beni\b|q8|tamoil|carburant|benzin|trenitalia|italo|\batm\b|uber|telepass|autostrad|parcheggio|taxi/,
    'Trasporti'
  ],
  [/ristorant|pizzeri|trattoria|sushi|mcdonald|burger|deliveroo|glovo|just eat|\bbar\b|caff/, 'Ristoranti'],
  [/farmacia|medic|ospedal|dentist|ticket sanit/, 'Salute'],
  [/amazon|zalando|ikea|decathlon|mediaworld|unieuro/, 'Shopping'],
  [/cinema|palestra|teatro|concert|steam|playstation/, 'Svago'],
  [/ryanair|easyjet|ita airways|booking|airbnb|hotel/, 'Viaggi'],
  [/stipendio|emolument|retribuz|salary/, 'Stipendio'],
  [/dividend|cedol|coupon|stacco/, 'Dividendi e cedole'],
  [/fattura|compenso|freelance/, 'Freelance']
];
