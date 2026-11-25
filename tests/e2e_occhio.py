"""EyeCash – browser tests for the Eye, the one place to talk with your data.
Three modes:
- on the device (no AI allowed): quick questions, simple figures, purchase simulator, expenses;
- external AI, blind (the shared test server, fake OpenAI): only the question leaves;
- local AI (its own server, fake Ollama): the model calls tools that run on the device."""
import os, subprocess, tempfile, time, json, urllib.request
from playwright.sync_api import sync_playwright
B = os.environ.get('POC_URL', 'http://localhost:8091'); PW = 'Prova-Sicura-2026!'
LPORT = 8094; BL = f'http://localhost:{LPORT}'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
res = []; errs = []
def check(n, c, i=''): res.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n + (('  · ' + str(i)) if i else ''), flush=True)
def unlocked(pg): pg.wait_for_selector('#lock.hidden', state='attached', timeout=30000); pg.wait_for_timeout(400)
def mocklog():
    try: return open('/tmp/mockai.log').read()
    except OSError: return ''
def say(pg, q):
    pg.fill('#occq', q); pg.click('#occform button[type=submit]'); pg.wait_for_timeout(300)
    for _ in range(80):
        if not pg.evaluate('occBusy'): break
        pg.wait_for_timeout(200)
    pg.wait_for_timeout(300)
    return pg.evaluate("S.chat[S.chat.length-1]")
def login(pg, url):
    pg.goto(url); pg.wait_for_selector('#pw1')
    if pg.locator('#pw2').count(): pg.fill('#pw1', PW); pg.fill('#pw2', PW)
    else: pg.fill('#pw1', PW)
    pg.click('#lockbtn'); unlocked(pg)
    pg.evaluate("(()=>{S=Object.assign(demoState(),{privacy:S.privacy});normState();processRecurring();S.demo=false;S.hideBal=false;S.chat=[];balShown=true;save();applyBalMask();go('occhio')})()")
    pg.wait_for_timeout(500)
def watch(pg):
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'status of' not in m.text else None)

data = tempfile.mkdtemp()
env = dict(os.environ, PORT=str(LPORT), DATA_DIR=data, AI_PROVIDER='ollama', OLLAMA_URL='http://127.0.0.1:8099', AI_MODEL='qwen3:8b')
srv = subprocess.Popen(['node', 'server.js'], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(50):
        try: urllib.request.urlopen(BL + '/api/status', timeout=1); break
        except Exception: time.sleep(0.2)
    with sync_playwright() as p:
        br = p.chromium.launch(executable_path=os.environ.get('CHROME') or ('/usr/bin/google-chrome' if os.path.exists('/usr/bin/google-chrome') else None))
        pg = br.new_page(viewport={'width': 390, 'height': 844}); watch(pg)
        login(pg, B)
        # ---- navigation: the old pages are gone, the Eye is in the middle of the bar
        check('Menu: niente più "Chiedi" né "Posso permettermelo?"', pg.locator('#sidenav [data-v=chiedi], #sidenav [data-v=permettermelo]').count() == 0)
        pg.evaluate("go('home')"); pg.click('#tabbar [data-act=orb]'); pg.wait_for_timeout(300)
        check("L'occhio apre la conversazione", pg.evaluate('view') == 'occhio' and pg.locator('#occbar #occq').count() == 1)
        # ---- 1. on the device only
        pg.evaluate("S.privacy.ask=false;S.privacy.quick=false;renderView()"); pg.wait_for_timeout(200)
        t = pg.inner_text('#view')
        check('Senza AI: modalità "Sul dispositivo" spiegata', 'Sul dispositivo' in t and 'Senza AI capisco' in t)
        open('/tmp/mockai.log', 'a').close(); before = len(mocklog())
        m = say(pg, 'quanto ho speso in ristoranti negli ultimi 6 mesi?')
        exp = pg.evaluate("(()=>{let s=0;for(const k of lastMonths(7).slice(0,6))s+=(catSpend(k).Ristoranti||0);return eur(s)})()")
        check('Sul dispositivo: categoria e periodo capiti', m['kind'] == 'ask' and m['spec']['queries'][0]['categories'] == ['Ristoranti'], m.get('spec', {}).get('title'))
        check('Sul dispositivo: cifra giusta', exp in pg.inner_text('#view'), exp)
        m = say(pg, 'Ho speso 12,50 € al bar con la carta')
        check('Spesa raccontata: proposta da confermare', m['kind'] == 'tx' and m['tx']['amount'] == -12.5 and m['tx']['note'].lower() == 'bar' and m['tx']['cat'] == 'Ristoranti', m.get('tx'))
        n = pg.evaluate('S.tx.length'); pg.click('[data-act=occ-tx-ok]'); pg.wait_for_timeout(300)
        check('Registra: movimento aggiunto una volta', pg.evaluate('S.tx.length') == n + 1 and pg.evaluate("S.tx.some(t=>t.note==='Bar'&&t.amount===-12.5)") and 'Registrato' in pg.inner_text('#view'))
        check('Pulsante sparito dopo la conferma', pg.locator('[data-act=occ-tx-ok]').count() == 0)
        m = say(pg, "posso permettermi un'auto da 18.000 € in contanti?")
        check('Simulazione d\'acquisto dentro la conversazione', m['kind'] == 'afford' and m['F']['price'] == 18000 and pg.locator('#view .occ-card .aff-ic').count() == 1)
        check('Sul dispositivo: nulla verso l\'AI', len(mocklog()) == before)
        pg.click('[data-act=occ-sim]'); pg.wait_for_timeout(300)
        check('"Modifica nel simulatore" apre il simulatore con i dati', pg.evaluate('view') == 'permettermelo' and pg.input_value('#affform [name=price]') == '18000')
        pg.evaluate("go('occhio')"); pg.wait_for_timeout(200)
        m = say(pg, 'che tempo fa domani?')
        check('Domanda non capita: spiega cosa sa fare', m['kind'] == 'note')
        # ---- 2. external AI, blind
        pg.evaluate("S.privacy.ask=true;S.privacy.quick=true;S.chat=[];renderView()"); pg.wait_for_timeout(200)
        check('AI esterna: modalità "alla cieca"', 'alla cieca' in pg.inner_text('#view'))
        before = len(mocklog())
        m = say(pg, "quanto ho speso in ristoranti quest'anno rispetto all'anno scorso?")
        sent = mocklog()[before:]
        inc = pg.evaluate("String(Math.round(adviceBase().income))"); cash = pg.evaluate("String(Math.round(adviceBase().cash))")
        check('Cifre: ricetta dall\'AI, conti sul dispositivo', m['kind'] == 'ask' and m['ai'] is True)
        check("All'AI solo la domanda: niente importi, saldi o esercenti", 'quanto ho speso in ristoranti' in sent and inc not in sent and cash not in sent and 'ESSELUNGA' not in sent.upper(), sent[:160])
        before = len(mocklog())
        m = say(pg, 'Tra un mese dovrò spendere 15.000 €, il prossimo anno vorrei un PC da 3.000: conviene prendere il PC?')
        sent = mocklog()[before:]
        check('Parere: verdetto calcolato sul dispositivo', m['kind'] == 'advice' and pg.locator('#view .aff-verdict').count() >= 1)
        check('Parere: esce solo la frase', 'conviene prendere il PC' in sent and inc not in sent and cash not in sent)
        before = len(mocklog())
        m = say(pg, 'ho pagato 40 benzina')
        check('Spesa con AI: esce solo la frase', m['kind'] == 'tx' and abs(m['tx']['amount']) > 0 and 'ho pagato 40 benzina' in mocklog()[before:])
        check('Registro privacy: niente importi dichiarati', 'Nessun importo' in pg.evaluate("S.aiLog.find(x=>x.k==='advise').p"))
        # the external server refuses the local agent
        r = pg.evaluate("api('POST','/api/ai/chat',{messages:[{role:'user',content:'saldo?'}]}).then(()=>'ok',e=>e.message)")
        check('Server con AI esterna: agente con i dati rifiutato', r != 'ok' and 'locale' in r, r)
        # conversation kept, encrypted with the rest
        pg.evaluate("go('home')"); pg.evaluate("go('occhio')"); pg.wait_for_timeout(300)
        check('Conversazione conservata tornando nell\'Occhio', pg.evaluate('S.chat.length') == 6 and pg.locator('#view .occ-u').count() == 3)
        pg.click('[data-act=occ-new]'); pg.wait_for_timeout(200)
        check('Nuova conversazione', pg.evaluate('S.chat.length') == 0)
        # ---- 3. local AI: a real agent on the device data
        lp = br.new_page(viewport={'width': 1300, 'height': 950}); watch(lp)
        login(lp, BL)
        check('AI locale: modalità e modello mostrati', 'AI locale' in lp.inner_text('#view') and 'qwen3:8b' in lp.inner_text('#view'))
        before = len(mocklog())
        m = say(lp, 'Quanto riesco a risparmiare al mese?')
        exp = lp.evaluate("OCC_RUN.get_overview()")
        t = lp.inner_text('#view')
        check('Agente: risposta con i numeri veri calcolati sul dispositivo', m['kind'] == 'md' and str(exp['avg_monthly_saving']) in t and str(exp['cash']) in t, [exp['avg_monthly_saving'], exp['cash']])
        check('Agente: strumento usato e mostrato, <think> nascosto', m['steps'][0]['name'] == 'get_overview' and 'Dati consultati: 1' in t and 'calcolo' not in t)
        check('Agente: i risultati vanno solo al modello locale', 'avg_monthly_saving' in mocklog()[before:] and lp.evaluate("S.aiLog[0].k") == 'chat')
        m = say(lp, "Posso comprare un'auto da 20.000 € tra due mesi?")
        check('Agente: simulazione della liquidità', m['steps'][0]['name'] == 'simulate_cashflow' and ('Sì' in m['text'] or 'Non ancora' in m['text']), m.get('text'))
        m = say(lp, 'ho speso 9 € pranzo')
        check('Agente: anche con l\'AI locale le spese diventano proposte', m['kind'] == 'tx' and m['tx']['amount'] < 0)
        lp.screenshot(path='/tmp/occhio_local.png', full_page=True)
        # ---- mobile layout and English
        pg.evaluate("S.chat=[];renderView()"); say(pg, 'quanto ho speso questo mese?')
        check('Mobile: niente scorrimento orizzontale', pg.evaluate("document.documentElement.scrollWidth") <= 392)
        bar = pg.evaluate("(()=>{const a=document.querySelector('#occform').getBoundingClientRect(),b=document.querySelector('#tabbar').getBoundingClientRect();return a.bottom<=b.top+2&&a.top>innerHeight-220})()")
        check('Mobile: la casella resta sopra la barra in basso', bar)
        pg.screenshot(path='/tmp/occhio_mob.png')
        pg.evaluate("setLang('en')"); pg.wait_for_load_state('load'); unlocked(pg); pg.evaluate("go('occhio')"); pg.wait_for_timeout(300)
        t = pg.inner_text('#view') + pg.inner_text('#occbar')
        check('Inglese: Occhio tradotto', 'Thinking' not in t and ('External AI' in t or 'On the device' in t) and 'Send' in t, t[:160])
        pg.evaluate("setLang('it')"); pg.wait_for_load_state('load')
        check('Nessun errore JavaScript', not errs, errs[:3])
        br.close()
finally:
    srv.terminate()
print(f'RISULTATO: {sum(res)}/{len(res)} superati')
