"""EyeCash – browser tests for "Posso permettermelo?": the planner on the demo data,
live recalculation, questions via AI (only the sentence leaves) and via the local
parser, the links from "Chiedi" and the report, mobile layout and English."""
import os, json
from playwright.sync_api import sync_playwright
B = os.environ.get('POC_URL', 'http://localhost:8091'); PW = 'Prova-Sicura-2026!'
res = []; errs = []
def check(n, c, i=''): res.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n + (('  · ' + str(i)) if i else ''), flush=True)
def unlocked(pg): pg.wait_for_selector('#lock.hidden', state='attached', timeout=30000); pg.wait_for_timeout(400)
def mocklog():
    try: return open('/tmp/mockai.log').read()
    except OSError: return ''
with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get('CHROME') or ('/usr/bin/google-chrome' if os.path.exists('/usr/bin/google-chrome') else None))
    pg = br.new_page(viewport={'width': 1300, 'height': 950})
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'status of' not in m.text else None)
    pg.goto(B); pg.wait_for_selector('#pw1')
    if pg.locator('#pw2').count(): pg.fill('#pw1', PW); pg.fill('#pw2', PW)
    else: pg.fill('#pw1', PW)
    pg.click('#lockbtn'); unlocked(pg)
    pg.evaluate("(()=>{S=Object.assign(demoState(),{privacy:S.privacy});normState();processRecurring();S.demo=false;S.hideBal=false;balShown=true;save();applyBalMask()})()")
    pg.wait_for_timeout(600); pg.evaluate("go('permettermelo')"); pg.wait_for_timeout(400)
    t = pg.inner_text('#view')
    check('Vista aperta con verdetto e numeri reali', 'I tuoi numeri' in t and pg.locator('.aff-verdict').count() == 1 and 'Media degli ultimi' in t, t[:120])
    check('Affitto ricavato dai costi ricorrenti', pg.input_value('#affform [name=rentNow]') == '750')
    r = pg.evaluate("(()=>{const r=affCompute(affInputs(),affMine());return {pay:eur0(r.payment),max:eur0(r.maxPrice),v:r.verdict}})()")
    check('Rata e prezzo massimo = motore', r['pay'] in t and r['max'] in t, r)
    # live recalculation, focus stays in the field
    pg.fill('#affform [name=price]', '2000000'); pg.wait_for_timeout(300)
    check('Ricalcolo dal vivo: prezzo enorme → Non ancora', 'Non ancora' in pg.inner_text('#affres') and pg.evaluate("document.activeElement.name") == 'price')
    pg.wait_for_timeout(900)
    check('Dati salvati nello stato cifrato', pg.evaluate("S.afford.price") == 2000000)
    # kind switch
    pg.click('[data-act=aff-kind][data-k=car]'); pg.wait_for_timeout(300)
    check('Auto: valori tipici e costi di gestione', pg.input_value('#affform [name=price]') == '25000' and pg.locator('#affform [name=runningCosts]').count() == 1 and pg.locator('#affform [name=rentNow]').count() == 0)
    pg.select_option('#affform [name=payCash]', '1'); pg.wait_for_timeout(300)
    check('In contanti: niente tasso né durata', pg.locator('#affform [name=ratePct]').count() == 0 and 'Pagamento' in pg.inner_text('#affres'))
    # question via AI: only the sentence leaves
    open('/tmp/mockai.log', 'a').close(); before = len(mocklog())
    pg.fill('#affq', 'posso permettermi una casa da 260 mila? IBAN IT60X0542811101000000123456'); pg.click('#affask button'); pg.wait_for_timeout(1500)
    sent = mocklog()[before:]
    a = pg.evaluate("S.afford")
    check('AI: parametri applicati (casa, 260.000, tasso nei limiti)', a['kind'] == 'mortgage' and a['price'] == 260000 and a['ratePct'] == 30, a)
    inc = pg.evaluate("String(Math.round(affMine().income))")
    check("AI: esce solo la frase, niente IBAN, entrate o saldi", 'casa da 260 mila' in sent and 'IT60X0542811101000000123456' not in sent and inc not in sent and 'Affitto' not in sent, sent[:200])
    check('AI: nota con ciò che ha capito + registro privacy', 'Ho capito (AI)' in pg.inner_text('#view') and pg.evaluate("S.aiLog[0].k") == 'afford' and 'Nessun importo' in pg.evaluate("S.aiLog[0].p"))
    # local parser when the AI is not allowed
    pg.evaluate("S.privacy.ask=false;renderView()"); pg.wait_for_timeout(200)
    pg.fill('#affq', "posso comprare un'auto da 18.000 € in contanti?"); pg.click('#affask button'); pg.wait_for_timeout(500)
    a = pg.evaluate("S.afford")
    check('Senza AI: frase capita sul dispositivo', a['kind'] == 'car' and a['price'] == 18000 and a['payCash'] is True and 'sul dispositivo' in pg.inner_text('#view'), a)
    pg.fill('#affq', 'Posso fare un mutuo da 200k in 20?'); pg.click('#affask button'); pg.wait_for_timeout(400)
    a = pg.evaluate("S.afford")
    check('Mutuo da 200k = importo del mutuo: prezzo 250.000 con 50.000 di anticipo, 20 anni', a['kind'] == 'mortgage' and a['price'] == 250000 and a['downPayment'] == 50000 and a['years'] == 20, a)
    pg.fill('#affq', 'che mutuo posso permettermi?'); pg.click('#affask button'); pg.wait_for_timeout(400)
    a = pg.evaluate("S.afford"); txt = pg.inner_text('#view')
    v = pg.evaluate("affCompute(S.afford,affMine()).verdict")
    check('Domanda generale: trova il prezzo più alto che non è bocciato', a['kind'] == 'mortgage' and ((a['price'] > 0 and v != 'no' and 'fino a circa' in txt) or 'non resta margine' in txt), [a['price'], v])
    pg.fill('#affq', 'quanto posso spendere per una vacanza?'); pg.click('#affask button'); pg.wait_for_timeout(400)
    check('Domanda generale su un acquisto in contanti', pg.evaluate("S.afford.kind") == 'purchase' and ('fino a circa' in pg.inner_text('#view') or 'non resta margine' in pg.inner_text('#view')))
    pg.fill('#affq', 'cosa mi conviene fare?'); pg.click('#affask button'); pg.wait_for_timeout(300)
    check('Senza prezzo: lo chiede', 'Non ho trovato un prezzo' in pg.inner_text('#view'))
    # from "Chiedi ai tuoi dati"
    pg.evaluate("S.privacy.ask=true;go('chiedi')"); pg.wait_for_timeout(300)
    check('Chiedi: pulsante verso il simulatore', pg.locator('#view [data-act=go][data-v=permettermelo]').count() == 1)
    pg.fill('#askq', 'posso permettermi una macchina da 30000 a rate in 4 anni?'); pg.click('#askform button'); pg.wait_for_timeout(1500)
    a = pg.evaluate("S.afford")
    check('Chiedi: "posso permettermi…" apre il simulatore', pg.evaluate("view") == 'permettermelo' and a['kind'] == 'car' and a['price'] == 30000 and a['years'] == 4, a)
    pg.evaluate("go('chiedi')"); pg.wait_for_timeout(300)
    pg.fill('#askq', 'Posso fare un mutuo da 200k in 20 anni?'); pg.click('#askform button'); pg.wait_for_timeout(1500)
    a = pg.evaluate("S.afford")
    check('Chiedi: "posso fare un mutuo…" va al simulatore (AI: importo del mutuo)', pg.evaluate("view") == 'permettermelo' and a['price'] == 250000 and a['years'] == 20 and pg.evaluate("S.aiLog[0].k") == 'afford', a)
    pg.evaluate("go('chiedi')"); pg.wait_for_timeout(300)
    check('Chiedi: "quanto pago di rata del mutuo" resta in Chiedi', not pg.evaluate("isAffordQ('quanto pago di rata del mutuo al mese?')") and not pg.evaluate("isAffordQ('quanto ho speso in ristoranti?')"))
    # light theme: a switch that is on must look different from one that is off
    pg.evaluate("document.documentElement.dataset.theme='light';go('impostazioni')"); pg.wait_for_timeout(400)
    bg = pg.evaluate("[...document.querySelectorAll('.sw')].map(b=>[b.classList.contains('on'),getComputedStyle(b).backgroundColor])")
    on = {c for o, c in bg if o}; off = {c for o, c in bg if not o}
    check('Tema chiaro: interruttori accesi verdi, spenti grigi', on and off and not (on & off), bg[:4])
    pg.evaluate("delete document.documentElement.dataset.theme")
    # from the report
    pg.evaluate("go('report')"); pg.wait_for_timeout(500)
    btn = pg.locator('#view [data-act=go][data-v=permettermelo]')
    check('Report: "Simula un acquisto" accanto alla rata sostenibile', btn.count() == 1)
    btn.click(); pg.wait_for_timeout(300)
    check('Report → simulatore', pg.evaluate("view") == 'permettermelo')
    # mobile: nothing wider than the screen
    pg.set_viewport_size({'width': 390, 'height': 844}); pg.evaluate("renderView()"); pg.wait_for_timeout(400)
    over = pg.evaluate("document.documentElement.scrollWidth")
    check('Mobile: niente scorrimento orizzontale', over <= 392, over)
    pg.screenshot(path='/tmp/afford_mob.png', full_page=True)
    pg.click('#tabbar [data-act=more]'); pg.wait_for_timeout(300)
    check('Mobile: Altro → Posso permettermelo?', pg.locator('[data-act=go-close][data-v=permettermelo]').count() == 1)
    pg.keyboard.press('Escape')
    # English
    pg.set_viewport_size({'width': 1300, 'height': 950})
    pg.evaluate("setLang('en')"); pg.wait_for_load_state('load'); unlocked(pg)
    pg.evaluate("go('permettermelo')"); pg.wait_for_timeout(600)
    t = pg.inner_text('#view')
    check('Inglese: vista tradotta', 'Your numbers' in t and 'Ask in plain words' in t and 'I tuoi numeri' not in t, t[:160])
    pg.evaluate("S.privacy.ask=false"); pg.fill('#affq', 'Can I afford a €300,000 house over 30 years at 3.5%?'); pg.click('#affask button'); pg.wait_for_timeout(500)
    a = pg.evaluate("S.afford")
    check('Inglese: domanda capita', a['kind'] == 'mortgage' and a['price'] == 300000 and a['years'] == 30 and a['ratePct'] == 3.5, a)
    pg.screenshot(path='/tmp/afford_en.png', full_page=True)
    pg.evaluate("setLang('it')"); pg.wait_for_load_state('load')
    check('Nessun errore JavaScript', not errs, errs[:3])
    br.close()
