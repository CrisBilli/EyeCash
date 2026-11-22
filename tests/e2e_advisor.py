"""EyeCash – browser tests for the advisor: any question about one's money, answered
with a verdict and reasons computed on the device; only the question reaches the AI."""
import os
from playwright.sync_api import sync_playwright
B = os.environ.get('POC_URL', 'http://localhost:8091'); PW = 'Prova-Sicura-2026!'
res = []; errs = []
def check(n, c, i=''): res.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n + (('  · ' + str(i)) if i else ''), flush=True)
def unlocked(pg): pg.wait_for_selector('#lock.hidden', state='attached', timeout=30000); pg.wait_for_timeout(400)
def mocklog():
    try: return open('/tmp/mockai.log').read()
    except OSError: return ''
def ask(pg, q):
    pg.fill('#askq', q); pg.click('#askform button'); pg.wait_for_timeout(1500)
with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get('CHROME') or ('/usr/bin/google-chrome' if os.path.exists('/usr/bin/google-chrome') else None))
    pg = br.new_page(viewport={'width': 1300, 'height': 950})
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'status of' not in m.text else None)
    pg.goto(B); pg.wait_for_selector('#pw1')
    if pg.locator('#pw2').count(): pg.fill('#pw1', PW); pg.fill('#pw2', PW)
    else: pg.fill('#pw1', PW)
    pg.click('#lockbtn'); unlocked(pg)
    pg.evaluate("(()=>{S=Object.assign(demoState(),{privacy:S.privacy});normState();processRecurring();S.demo=false;S.hideBal=false;balShown=true;save();applyBalMask();go('chiedi')})()")
    pg.wait_for_timeout(600)
    open('/tmp/mockai.log', 'a').close(); before = len(mocklog())
    ask(pg, 'Tra un mese dovrò spendere 15.000 €, il prossimo anno vorrei un PC da 3.000: conviene prendere il PC?')
    sent = mocklog()[before:]
    t = pg.inner_text('#view')
    x = pg.evaluate("(()=>{const x=EN.runAdvice(askCur.advice,adviceBase());return {v:x.verdict,after:eur0(x.vars.cash_after_target),em:eur0(x.vars.emergency_target),best:adviceFmt('month',x.vars.best_month),inc:Math.round(adviceBase().income),cash:Math.round(adviceBase().cash)}})()")
    check('Consulente: risposta con verdetto', pg.locator('#view .aff-verdict').count() == 1 and x['v'] in ('yes', 'careful', 'no'), x)
    check('Motivi con i numeri veri calcolati sul dispositivo', x['em'] in t and (x['after'] in t or 'Dopo il PC resti' in t), [x['after'], x['em']])
    if x['v'] == 'careful': check('Mese consigliato nella risposta', x['best'] in t.lower(), x['best'])
    check('Grafico della liquidità e "come è stato calcolato"', pg.locator('#view svg path').count() >= 1 and 'Come è stato calcolato' in t)
    check("All'AI solo la domanda: nessuna entrata o liquidità", 'conviene prendere il PC' in sent and str(x['inc']) not in sent and str(x['cash']) not in sent and 'RICETTA' in sent)
    check('Registro privacy: invio del consulente', pg.evaluate("S.aiLog[0].k") == 'advise' and 'Nessun importo' in pg.evaluate("S.aiLog[0].p"))
    # follow-up with context
    before = len(mocklog())
    ask(pg, 'e se lo prendo a rate?')
    sent = mocklog()[before:]
    check('Domanda di seguito: va con la domanda precedente e la sua ricetta', 'Domanda precedente' in sent and 'conviene prendere il PC' in sent)
    check('Domanda di seguito: PC a rate simulato', pg.evaluate("!!askCur.advice.events[1].financed") and 'a rate in 12 mesi' in pg.evaluate("document.querySelector('#view').textContent"))
    # history
    pg.evaluate("go('home')"); pg.evaluate("go('chiedi')"); pg.wait_for_timeout(300)
    pg.locator('[data-act=ask-hist]').first.click(); pg.wait_for_timeout(300)
    check('Domande recenti: il parere si ricalcola sui dati di oggi', pg.locator('#view .aff-verdict').count() == 1)
    # a question that is neither a figure nor a judgement
    ask(pg, 'che meteo fa domani?')
    check('Domanda fuori tema: chiede un chiarimento', 'Mi serve un chiarimento' in pg.inner_text('#view'))
    # figures still go to the query language
    ask(pg, "quanto ho speso in ristoranti quest'anno rispetto all'anno scorso?")
    check('Domande di cifre: restano a "Chiedi ai tuoi dati"', pg.evaluate("!!(askCur&&askCur.spec)"))
    # mobile
    pg.set_viewport_size({'width': 390, 'height': 844})
    ask(pg, 'Tra un mese dovrò spendere 15.000 €, il prossimo anno vorrei un PC da 3.000: conviene prendere il PC?')
    check('Mobile: niente scorrimento orizzontale', pg.evaluate("document.documentElement.scrollWidth") <= 392)
    pg.screenshot(path='/tmp/advisor_mob.png', full_page=True)
    # English
    pg.set_viewport_size({'width': 1300, 'height': 950})
    pg.evaluate("setLang('en')"); pg.wait_for_load_state('load'); unlocked(pg)
    pg.evaluate("go('chiedi')"); pg.wait_for_timeout(300)
    pg.locator('[data-act=ask-hist]').first.click(); pg.wait_for_timeout(400)
    t = pg.inner_text('#view')
    check('Inglese: parere tradotto', 'How it was calculated' in t and 'Come è stato calcolato' not in t and 'emergency fund' in t.lower(), t[:200])
    pg.screenshot(path='/tmp/advisor_en.png', full_page=True)
    pg.evaluate("setLang('it')"); pg.wait_for_load_state('load')
    check('Nessun errore JavaScript', not errs, errs[:3])
    br.close()
