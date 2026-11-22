"""EyeCash – test browser: FIRE Monte Carlo, allocazione/ribilanciamento, tasse e zainetto."""
import sys, os, re
from playwright.sync_api import sync_playwright
B = os.environ.get('POC_URL', 'http://localhost:8091'); PW = 'Prova-Sicura-2026!'
res = []; errs = []
def check(n, c, i=''): res.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n + (('  · ' + str(i)) if i else ''), flush=True)
def unlocked(pg): pg.wait_for_selector('#lock.hidden', state='attached', timeout=30000); pg.wait_for_timeout(400)
with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get('CHROME') or ('/usr/bin/google-chrome' if os.path.exists('/usr/bin/google-chrome') else None)); pg = br.new_page(viewport={'width': 1300, 'height': 950})
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'status of' not in m.text else None)
    pg.goto(B); pg.wait_for_selector('#pw1')
    if pg.locator('#pw2').count(): pg.fill('#pw1', PW); pg.fill('#pw2', PW)
    else: pg.fill('#pw1', PW)
    pg.click('#lockbtn'); unlocked(pg)
    pg.evaluate("""(()=>{S.accounts[0].balance0=20000;S.holdings=[
      {id:'h1',name:'ETF World',ticker:'SWDA',type:'ETF',qty:100,avg:80,price:100,ter:0.2},
      {id:'h2',name:'BTP 2030',ticker:'BTP',type:'Obbligazioni',qty:30,avg:103.33333333,price:100,taxClass:'stato',divYield:3},
      {id:'h3',name:'Bitcoin',ticker:'BTC',type:'Crypto',qty:0.04,avg:25000,price:50000}];S.zainetto=[];save()})()""")
    pg.wait_for_timeout(800)
    # ---- allocazione ----
    pg.goto(B + '/#investimenti'); unlocked(pg); pg.click('[data-act=inv-tab][data-k=alloc]')
    pg.click('[data-act=al-mode][data-k=class]'); pg.wait_for_timeout(200); pg.click('[data-act=tgt-preset][data-n="60/40 classico"]'); pg.click('[data-act=tgt-save]'); pg.wait_for_timeout(500)
    t = pg.inner_text('#view')
    check('Allocazione: obiettivo 60/40 salvato', pg.evaluate("JSON.stringify(S.target.weights)") == '{"azioni":60,"obbligazioni":40}')
    check('Allocazione: classi fuori soglia segnalate', 'fuori soglia' in t)
    exp = pg.evaluate("(()=>{const hs=hView();return {plan:EN.contributionPlan(hs,S.target.weights,0,1000),m:EN.monthsToRebalance(hs,S.target.weights,0,1000,5),full:EN.fullRebalance(hs,S.target.weights,0,[],2026)}})()")
    pg.fill('#tg-monthly', '1000'); pg.press('#tg-monthly', 'Tab'); pg.wait_for_timeout(500); t = pg.inner_text('#view')
    check('Versamenti: mesi per rientrare mostrati', f"{exp['m']} mesi" in t or f"{exp['m']} mese" in t, exp['m'])
    check('Ribilanciamento completo: vende Bitcoin e ETF, compra BTP', 'Vendi Bitcoin' in t and 'Compra BTP 2030' in t, [s['id'] for s in exp['full']['sells']])
    pg.screenshot(path='/tmp/f_alloc.png', full_page=True)
    # ---- tasse ----
    pg.click('[data-act=inv-tab][data-k=tax]'); pg.wait_for_timeout(300); t = pg.inner_text('#view')
    check('Tasse latenti: ETF 520 + BTC 330 = 850 € (BTP in perdita non compensa ETF né crypto)', '850' in t.split('Tasse se vendessi tutto oggi')[1][:40], t.split('Tasse se vendessi tutto oggi')[1][:40].replace('\n', ' '))
    check('Aliquota crypto 33% mostrata', '33%' in t)
    check('Costi: TER e bollo', 'TER ponderato' in t and 'Bollo 0,2%' in t)
    pg.click('[data-act=zain-new]'); pg.fill('#frm input[name=amount]', '1000'); pg.fill('#frm input[name=year]', '2022'); pg.click('#frm button[type=submit]'); pg.wait_for_timeout(400)
    t = pg.inner_text('#view')
    check('Zainetto 2022: scade il 31/12/2026 (avviso rosso)', 'scade il 31/12/2026' in t)
    pg.screenshot(path='/tmp/f_tax.png', full_page=True)
    # ---- FIRE ----
    pg.goto(B + '/#fire'); unlocked(pg)
    check('FIRE: chiede l\'età', 'Inserisci la tua età' in pg.inner_text('#view'))
    pg.fill('#fireform input[name=age]', '35'); pg.fill('#fireform input[name=spending]', '24000'); pg.fill('#fireform input[name=saving]', '1500')
    pg.click('#fireform button[type=submit]'); pg.wait_for_selector('text=Probabilità di successo', timeout=60000); pg.wait_for_timeout(500)
    t = pg.inner_text('#view'); r = pg.evaluate("({s:fireRes.main.success,fn:fireRes.main.fireNumber,age:fireRes.main.fireAge,safe:fireRes.safe})")
    check('FIRE: probabilità mostrata = motore', f"{round(r['s']*100)}%" in t, r['s'])
    check('FIRE: numero FIRE = 24.000 / 3,5%', abs(r['fn'] - 24000 / 0.035) < 1 and '685.714' in t)
    check('FIRE: età FIRE stimata plausibile', r['age'] and 35 < r['age']['p50'] < 70, r['age'])
    check('FIRE: grafico a ventaglio + stress test + Lean/Fat', pg.locator('svg path[opacity]').count() >= 2 and 'Decennio perduto' in t and 'Lean' in t and 'coast fire' in t.lower())
    det = pg.evaluate("(()=>{const {p}=fireInputs();return EN.simulate({...p,runs:2000}).success})()")
    check('FIRE: riproducibile (stessi input → stesso risultato)', det == r['s'])
    pg.fill('#fireform input[name=spending]', '48000'); pg.click('#fireform button[type=submit]'); pg.wait_for_timeout(200); pg.wait_for_selector('text=Probabilità di successo', timeout=60000); pg.wait_for_timeout(1500)
    s2 = pg.evaluate("fireRes.main.success")
    check('FIRE: spesa doppia → numero FIRE doppio, età più alta', pg.evaluate("fireRes.main.fireNumber") > r['fn'] * 1.9 and (pg.evaluate("fireRes.main.fireAge&&fireRes.main.fireAge.p50") or 99) > r['age']['p50'])
    pg.screenshot(path='/tmp/f_fire.png', full_page=True)
    # mobile
    m = br.new_context(viewport={'width': 390, 'height': 844}).new_page(); m.goto(B); m.wait_for_selector('#pw1'); m.fill('#pw1', PW); m.click('#lockbtn'); unlocked(m)
    m.click('#tabbar [data-act=more]'); m.click('[data-act=go-close][data-v=fire]'); m.wait_for_timeout(400)
    check('Mobile: Altro → FIRE', m.inner_text('#ttl') == 'Simulazione FIRE'); m.screenshot(path='/tmp/f_mob.png', full_page=True)
    br.close()
print('ERRORI CONSOLE:', errs[:8]); print(f'RISULTATO: {sum(res)}/{len(res)} superati')
sys.exit(0 if all(res) and not errs else 1)
