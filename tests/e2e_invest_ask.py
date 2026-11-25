"""EyeCash – test: storico investimenti ricostruito dall'estratto conto (dati finti) e "Chiedi ai tuoi dati"."""
import os, datetime as dt
import openpyxl
from playwright.sync_api import sync_playwright
B = os.environ.get('POC_URL', 'http://localhost:8091'); PW = 'Prova-Sicura-2026!'
HERE = os.path.dirname(os.path.abspath(__file__)); FX = os.path.join(HERE, 'fixtures', 'sample.xls')
res = []; errs = []
def check(n, c, i=''): res.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n + (('  · ' + str(i)) if i else ''), flush=True)
def unlocked(pg): pg.wait_for_selector('#lock.hidden', state='attached', timeout=30000); pg.wait_for_timeout(400)
os.makedirs('/tmp/fin', exist_ok=True); F = '/tmp/fin/banca_titoli.xlsx'
t = dt.date.today(); y = t.year
rows = [  # data, importo, descrizione breve, descrizione completa
    (dt.date(y - 1, 2, 3), -480.0, 'Compravendita Titoli', 'Compravendita Titoli ISHS CORE WLD USD-AC Qta/Val.nom. 6,000000'),
    (dt.date(y - 1, 5, 6), -321.23, 'Compravendita Titoli', 'Compravendita Titoli ISHS CORE WLD USD-AC Qta/Val.nom. 4,000000'),
    (dt.date(y - 1, 3, 1), -500.0, 'Compravendita Titoli', 'Compravendita Titoli VAN LIFE 60 EUR-AC Qta/Val.nom. 5,000000'),
    (dt.date(y - 1, 9, 1), 540.0, 'Compravendita Titoli', 'Compravendita Titoli VAN LIFE 60 EUR-AC Qta/Val.nom. 5,000000'),
    (dt.date(y - 1, 4, 10), -4925.0, 'Compravendita Titoli', 'Compravendita Titoli BTP FINTO 2035 Qta/Val.nom. 5.000,000000'),
    (dt.date(y - 1, 6, 5), -29.0, 'Pagamento Visa Debit', 'PIZZERIA DA GINO'),
    (dt.date(y, 1, 9), -38.0, 'Pagamento Visa Debit', 'PIZZERIA DA GINO'),
    (dt.date(y, 1, 12), -84.3, 'Pagamento Visa Debit', 'ESSELUNGA MILANO'),
]
wb = openpyxl.Workbook(); ws = wb.active
for line in ['Conto Corrente: 0000001', 'Intestazione Conto Corrente: ROSSI MARIO', None, 'Risultati Ricerca', None]: ws.append([line])
ws.append(['Data_Operazione', 'Data_Valuta', 'Entrate', 'Uscite', 'Descrizione', 'Descrizione_Completa', 'Stato'])
for d, a, de, full in rows: ws.append([dt.datetime(d.year, d.month, d.day), dt.datetime(d.year, d.month, d.day), a if a > 0 else None, a if a < 0 else None, de, full, 'Contabilizzato'])
wb.save(F)
with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get('CHROME') or ('/usr/bin/google-chrome' if os.path.exists('/usr/bin/google-chrome') else None)); pg = br.new_page(viewport={'width': 1300, 'height': 950})
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(B); pg.wait_for_selector('#pw1'); pg.wait_for_timeout(800)
    if pg.locator('#pw2').count(): pg.fill('#pw2', PW)
    pg.fill('#pw1', PW); pg.click('#lockbtn'); unlocked(pg)
    pg.evaluate("(()=>{S.tx=[];S.holdings=[];S.trades=[];S.trMap={};S.portfolios=[];save()})()")
    pg.evaluate("invPf=null;go('investimenti')"); pg.wait_for_timeout(300)
    pg.set_input_files('#pfcsv', FX); pg.wait_for_selector('#frm', timeout=15000); pg.click('#frm button[type=submit]'); pg.wait_for_timeout(800)
    pg.evaluate("go('movimenti')"); pg.wait_for_timeout(300)
    pg.set_input_files('#csv', F); pg.wait_for_selector('#frm', timeout=15000); pg.click('#frm button[type=submit]'); pg.wait_for_timeout(1000)
    check('Le compravendite diventano operazioni', pg.evaluate("S.trades.length") == 5, pg.evaluate("S.trades.length"))
    check('I movimenti restano nel conto (categoria Investimenti)', pg.evaluate("S.tx.filter(t=>t.cat==='Investimenti').length") == 5 and pg.evaluate("S.tx.every(t=>!t.trade)"))
    m = pg.evaluate("Object.fromEntries(Object.entries(S.trMap).map(([k,v])=>[k,(S.holdings.find(h=>h.id===v)||{}).isin||'']))")
    check('Abbinamento automatico dei nomi della banca', m.get('ISHS CORE WLD USD-AC') == 'IE00B4L5Y983' and m.get('BTP FINTO 2035') == 'IT0005544082' and not m.get('VAN LIFE 60 EUR-AC'), m)
    pg.evaluate("invTab='hist';invPf=null;go('investimenti')"); pg.wait_for_timeout(500); pg.evaluate("balShown=true;applyBalMask()")
    v = pg.inner_text('#view')
    check('Quadra con il portafoglio (anche il BTP, nominale convertito)', 'Quadra' in v and 'Da controllare' not in v, v[:300])
    check('Posizione chiusa con risultato +40', 'Posizioni chiuse' in v and 'VAN LIFE 60 EUR-AC' in v and pg.evaluate("eur(40)") in v)
    check('Plus realizzate per anno', str(y - 1) in v and 'Plus e minusvalenze realizzate' in v)
    k = pg.evaluate("(()=>{const T=histScope(),b=EN.tradeBook(T);return{open:Object.values(b.pos).filter(p=>!p.closed).length,cost:Object.values(b.pos).reduce((s,p)=>s+p.cost,0)}})()")
    check('Costo delle posizioni aperte = carico del portafoglio', k['open'] == 2 and abs(k['cost'] - (801.23 + 4925)) < 0.01, k)
    check('Rendimento annuo calcolato', '%' in pg.inner_text('.grid.g4 .kpi:nth-child(4) .val'))
    check('Grafico valore e versato', pg.locator('svg.chart path').count() >= 3)
    pg.click('[data-act=tr-map]'); pg.wait_for_selector('#frm')
    pg.select_option('#frm select >> nth=0', ''); pg.click('#frm button[type=submit]'); pg.wait_for_timeout(400)
    check('Togliendo un abbinamento compare l\'avviso', 'Da controllare' in pg.inner_text('#view'))
    pg.click('[data-act=tr-map] >> nth=0'); pg.wait_for_selector('#frm'); pg.evaluate("(()=>{const o=[...document.querySelectorAll('#frm select')];for(const s of o){const name=s.closest('.fld').querySelector('label').textContent;if(name.startsWith('ISHS'))s.value=S.holdings.find(h=>h.isin==='IE00B4L5Y983').id}})()")
    pg.click('#frm button[type=submit]'); pg.wait_for_timeout(400)
    check('Abbinamento a mano ripristinato', 'Quadra' in pg.inner_text('#view'))
    pg.click('[data-act=tr-add] >> nth=0'); pg.wait_for_selector('#frm')
    pg.select_option('#frm [name=hid]', pg.evaluate("S.holdings.find(h=>h.isin==='US0378331005').id")); pg.fill('#frm [name=date]', f'{y-1}-07-01'); pg.fill('#frm [name=qty]', '3'); pg.fill('#frm [name=amount]', '405'); pg.click('#frm button[type=submit]'); pg.wait_for_timeout(400)
    check('Operazione a mano: anche il titolo in dollari entra nello storico', 'senza operazioni' not in pg.inner_text('#view') and pg.evaluate("S.trades.length") == 6)
    pg.evaluate("go('movimenti')"); pg.set_input_files('#csv', F); pg.wait_for_selector('#frm', timeout=15000); pg.click('#frm button[type=submit]'); pg.wait_for_timeout(800)
    check('Reimport: nessuna operazione doppia', pg.evaluate("S.trades.length") == 6 and pg.evaluate("S.tx.length") == len(rows))
    # ---- movimenti del dossier titoli (con ISIN): completano le operazioni già ricavate dall'estratto conto
    FD = '/tmp/fin/dossier_titoli.xlsx'; wd = openpyxl.Workbook(); w = wd.active; w.title = 'Movimenti Dossier Titoli'
    for line in ['Dossier n.: 0000001', 'Intestazione Dossier: ROSSI MARIO', 'RISULTATO RICERCA MOVIMENTI']: w.append([line])
    w.append(['Operazione', 'Data valuta', 'Descrizione', 'Titolo', 'Isin', 'Segno', 'Quantita', 'Divisa', 'Prezzo', 'Cambio', 'Controvalore'])
    fmt = lambda d: d.strftime('%d/%m/%Y')
    for op, val, ttl, isin, sg, q, pr, cv in [
        (dt.date(y - 1, 1, 28), dt.date(y - 1, 2, 3), 'ISHS CORE WLD USD-AC', 'IE00B4L5Y983', 'A', 6, 80, 480),      # 6 giorni tra esecuzione e valuta
        (dt.date(y - 1, 5, 4), dt.date(y - 1, 5, 6), 'ISHS CORE WLD USD-AC', 'IE00B4L5Y983', 'A', 4, 80.3075, 321.23),
        (dt.date(y - 1, 2, 27), dt.date(y - 1, 3, 1), 'VAN LIFE 60 EUR-AC', 'IE00BMVB5R75', 'A', 5, 100, 500),
        (dt.date(y - 1, 8, 28), dt.date(y - 1, 9, 1), 'VAN LIFE 60 EUR-AC', 'IE00BMVB5R75', 'V', 5, 108, 540),
        (dt.date(y - 1, 4, 8), dt.date(y - 1, 4, 10), 'BTP FINTO 2035', 'IT0005544082', 'A', 5000, 98.5, 4925)]:
        w.append([fmt(op), fmt(val), 'Compravendita Titoli', ttl, isin, sg, q, 'EUR', pr, 1, cv])
    w.append(['02/01/' + str(y), '02/01/' + str(y), 'Stacco cedola', 'BTP FINTO 2035', 'IT0005544082', '', '', 'EUR', '', 1, 61.25])
    wd.save(FD)
    nh = pg.evaluate("S.holdings.length")
    pg.evaluate("invTab='hist';invPf=null;go('investimenti')"); pg.wait_for_timeout(300)
    pg.set_input_files('#pfcsv', FD); pg.wait_for_selector('#frm', timeout=15000)
    fv = pg.inner_text('#frm')
    check('Dossier riconosciuto come elenco di operazioni (non come portafoglio)', 'Movimenti dossier titoli' in fv and 'Portafoglio titoli riconosciuto' not in fv, fv[:200])
    check('Anteprima: 5 già ricavate dall\'estratto conto, riga cedola ignorata', '5 già ricavate' in fv and '1 righe non di compravendita' in fv, fv[:400])
    pg.click('#frm button[type=submit]'); pg.wait_for_timeout(700)
    check('Nessun doppione, operazioni completate con ISIN e data di esecuzione', pg.evaluate("S.trades.length") == 6 and pg.evaluate("S.trades.filter(t=>t.isin).length") == 5 and pg.evaluate(f"S.trades.some(t=>t.isin==='IE00B4L5Y983'&&t.date==='{y-1}-01-28')"))
    check('Il portafoglio non viene toccato', pg.evaluate("S.holdings.length") == nh)
    check('Dopo il dossier tutto quadra (abbinamento per ISIN)', 'Quadra' in pg.inner_text('#view'))
    pg.set_input_files('#pfcsv', FD); pg.wait_for_selector('#frm', timeout=15000); check('Dossier reimportato: già presenti', '5 già importate' in pg.inner_text('#frm')); pg.click('#frm button[type=submit]'); pg.wait_for_timeout(500)
    pg.evaluate("go('movimenti')"); pg.set_input_files('#csv', F); pg.wait_for_selector('#frm', timeout=15000); pg.click('#frm button[type=submit]'); pg.wait_for_timeout(700)
    check('Estratto conto dopo il dossier: nessuna operazione doppia', pg.evaluate("S.trades.length") == 6)
    # ---- chiedi ai tuoi dati
    pg.evaluate("S.chat=[];go('occhio')"); pg.wait_for_timeout(300); pg.evaluate("balShown=true;applyBalMask()")
    pg.click('[data-act=ask-quick][data-i="2"]'); pg.wait_for_timeout(200)
    check('Domanda rapida calcolata in locale', 'ESSELUNGA' in pg.inner_text('#view').upper() and 'senza AI' in pg.inner_html('#view'), pg.inner_text('#view')[400:700])
    pg.evaluate("S.chat=[];renderView()"); pg.click('[data-act=ask-quick][data-i="5"]'); pg.wait_for_timeout(200)
    check('Domanda rapida sul portafoglio (torta)', 'Il portafoglio vale' in pg.inner_text('#view') and pg.locator('#view svg circle').count() >= 2)
    if pg.locator('#occq').count():
        open('/tmp/mockai.log', 'a').close(); before = len(open('/tmp/mockai.log').read())
        pg.evaluate("S.chat=[];renderView()"); pg.fill('#occq', 'quanto ho speso in ristoranti quest\'anno rispetto all\'anno scorso?'); pg.click('#occform button[type=submit]'); pg.wait_for_timeout(1500)
        v = pg.inner_text('#view'); sent = open('/tmp/mockai.log').read()[before:]
        check('Domanda libera: risposta calcolata sul dispositivo', "l'anno scorso" in v and pg.evaluate("eur(29)") in v, v[:400])
        check('All\'AI non arrivano importi né esercenti', 'PIZZERIA' not in sent.upper() and 'ESSELUNGA' not in sent.upper() and '4925' not in sent and 'quanto ho speso in ristoranti' in sent)
        check('Registro privacy della domanda', 'Nessun importo' in pg.evaluate("S.aiLog[0].p"))
        check('Domanda salvata nella conversazione (cifrata)', pg.evaluate("S.chat.length") == 2 and pg.evaluate("S.chat[1].kind") == 'ask')
    else: check('AI attiva sul server di test', False)
    check('Nessun errore JavaScript', not errs, errs[:3])
    br.close()
print(f'\n{sum(res)}/{len(res)} superati'); raise SystemExit(0 if all(res) else 1)
