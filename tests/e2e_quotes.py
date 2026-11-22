"""EyeCash – test browser delle quotazioni (fonti simulate). Uso interno di sviluppo."""
import sys, os
from playwright.sync_api import sync_playwright
B = os.environ.get('POC_URL', 'http://localhost:8091'); PW = 'Prova-Sicura-2026!'
res = []; errs = []
def check(n, c, i=''): res.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n + (('  · ' + str(i)) if i else ''), flush=True)
def unlocked(pg): pg.wait_for_selector('#lock.hidden', state='attached', timeout=30000); pg.wait_for_timeout(400)
with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get('CHROME') or ('/usr/bin/google-chrome' if os.path.exists('/usr/bin/google-chrome') else None)); pg = br.new_page(viewport={'width': 1300, 'height': 950})
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'status of 4' not in m.text and 'status of 5' not in m.text else None)
    pg.goto(B); pg.wait_for_selector('#pw1')
    if pg.locator('#pw2').count(): pg.fill('#pw1', PW); pg.fill('#pw2', PW)
    else: pg.fill('#pw1', PW)
    pg.click('#lockbtn'); unlocked(pg)
    pg.goto(B + '/#investimenti'); unlocked(pg)
    check('Pulsanti quotazioni visibili', pg.is_visible('[data-act=q-search]') and pg.is_visible('[data-act=q-refresh]'))
    # ricerca per ISIN
    pg.click('[data-act=q-search]'); pg.fill('#qq', 'IE00B4L5Y983'); pg.click('#qform button[type=submit]')
    pg.wait_for_selector('#qres .row', timeout=10000)
    first = pg.locator('#qres .row').first.inner_text()
    check('Ricerca ISIN: primo risultato Milano EUR', 'SWDA.MI' in first and 'EUR' in first, first.replace('\n', ' '))
    check('Ricerca ISIN: mostra anche Londra in GBp', 'GBp' in pg.inner_text('#qres'))
    pg.screenshot(path='/tmp/q_search.png')
    pg.locator('#qres .row').first.click(); pg.wait_for_selector('[data-act=q-confirm]')
    check('Conferma listino mostra prezzo e borsa', '104,32' in pg.inner_text('#sheetbox') and 'milan' in pg.inner_text('#sheetbox').lower())
    pg.click('[data-act=q-confirm]'); pg.wait_for_selector('#frm input[name=qty]')
    check('Form precompilato', pg.input_value('#frm input[name=price]') == '104,32' and 'MSCI World' in pg.input_value('#frm input[name=name]'))
    pg.fill('#frm input[name=qty]', '10'); pg.fill('#frm input[name=avg]', '90'); pg.click('#frm button[type=submit]'); pg.wait_for_timeout(800)
    h = pg.evaluate("S.holdings.find(h=>h.qSym==='SWDA.MI')")
    check('Posizione collegata e confermata', h and h['confirmed'] and h['price'] == 104.32 and h['qty'] == 10, h and {k: h[k] for k in ['qSym', 'price', 'qty', 'confirmed']})
    # aggiornamento con salto anomalo
    pg.evaluate("(()=>{const h=S.holdings.find(h=>h.qSym==='SWDA.MI');h.price=50;save();render()})()")
    pg.click('[data-act=q-refresh]'); pg.wait_for_timeout(1500)
    h = pg.evaluate("S.holdings.find(h=>h.qSym==='SWDA.MI')")
    check('Salto >20%: NON applicato, da verificare', h['price'] == 50 and h['pending'] and any('Variazione' in r for r in h['pending']['reasons']), h['pending'] and h['pending']['reasons'])
    check('Avviso "da verificare" visibile', 'Da verificare' in pg.inner_text('#view'))
    pg.locator('.row', has_text='MSCI World').first.click(); pg.wait_for_selector('[data-act=q-accept]')
    pg.click('[data-act=q-accept]'); pg.wait_for_timeout(500)
    check('Conferma manuale applica il prezzo', pg.evaluate("S.holdings.find(h=>h.qSym==='SWDA.MI').price") == 104.32)
    # fonti discordanti + simbolo inesistente + crypto ok
    pg.evaluate("""(()=>{S.holdings.push({id:'bad',name:'Bad',ticker:'BADX',type:'Azioni',qty:1,avg:90,price:100,qSym:'BADX',autoPrice:true,confirmed:true});
      S.holdings.push({id:'none',name:'Nessuno',ticker:'NO',type:'ETF',qty:1,avg:1,price:1,qSym:'NONESISTE',autoPrice:true,confirmed:true});
      S.holdings.push({id:'btc',name:'Bitcoin',ticker:'BTC',type:'Crypto',qty:0.1,avg:50000,price:64000,qSym:'BTC',autoPrice:true,confirmed:true});
      S.holdings.push({id:'usd',name:'Apple',ticker:'AAPL',type:'Azioni',qty:2,avg:150,price:180,qSym:'AAPL',autoPrice:true,confirmed:true});save();render()})()""")
    pg.click('[data-act=q-refresh]'); pg.wait_for_timeout(1800)
    g = lambda i: pg.evaluate(f"S.holdings.find(h=>h.id==='{i}')")
    check('Fonti discordanti: NON applicato', g('bad')['price'] == 100 and g('bad')['pending'] and 'non concordano' in g('bad')['pending']['reasons'][0])
    check('Simbolo inesistente: errore, prezzo invariato', g('none')['qErr'] and g('none')['price'] == 1)
    check('Crypto: aggiornato da Kraken (2 fonti)', g('btc')['price'] == 66267.9 and g('btc')['priceCheck'] == 'two')
    check('USD: convertito in EUR con BCE', abs(g('usd')['price'] - 200 / 1.1193) < 0.001, g('usd')['price'])
    pg.screenshot(path='/tmp/q_inv.png', full_page=True)
    # privacy: registro e interruttore
    pg.goto(B + '/#impostazioni'); unlocked(pg)
    txt = pg.inner_text('#view')
    check('Registro: elenca i simboli inviati', 'Quotazioni' in txt and 'SWDA.MI' in txt)
    pg.click('[data-act=priv][data-k=quotes]'); pg.wait_for_timeout(400)
    pg.goto(B + '/#investimenti'); unlocked(pg)
    check('Interruttore spento: niente pulsanti quotazioni', not pg.is_visible('[data-act=q-refresh]'))
    n_before = pg.evaluate("S.aiLog.length"); pg.evaluate("refreshQuotes(true)"); pg.wait_for_timeout(800)
    check('Interruttore spento: nessuna richiesta', pg.evaluate("S.aiLog.length") == n_before)
    br.close()
print('ERRORI CONSOLE:', errs[:8]); print(f'RISULTATO: {sum(res)}/{len(res)} superati')
sys.exit(0 if all(res) and not errs else 1)
