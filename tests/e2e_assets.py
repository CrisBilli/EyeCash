"""EyeCash – test browser: beni, debiti, patrimonio, previsione, spunti, menu mobile."""
import sys, os
from playwright.sync_api import sync_playwright
B = os.environ.get('POC_URL', 'http://localhost:8091'); PW = 'Prova-Sicura-2026!'
res = []; errs = []
def check(n, c, i=''): res.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n + (('  · ' + str(i)) if i else ''), flush=True)
def unlocked(pg): pg.wait_for_selector('#lock.hidden', state='attached', timeout=30000); pg.wait_for_timeout(400)
with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get('CHROME') or ('/usr/bin/google-chrome' if os.path.exists('/usr/bin/google-chrome') else None)); ctx = br.new_context(viewport={'width': 1300, 'height': 950}); pg = ctx.new_page()
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'status of' not in m.text else None)
    pg.goto(B); pg.wait_for_selector('#pw1')
    if pg.locator('#pw2').count(): pg.fill('#pw1', PW); pg.fill('#pw2', PW)
    else: pg.fill('#pw1', PW)
    pg.click('#lockbtn'); unlocked(pg)
    pg.evaluate("(()=>{S.accounts[0].balance0=5000;S.tx.push({id:'sal1',date:ds(new Date(new Date().getFullYear(),new Date().getMonth()-1,27)),amount:2400,cat:'Stipendio',accountId:S.accounts[0].id,note:'Stipendio'},{id:'sal2',date:ds(new Date(new Date().getFullYear(),new Date().getMonth()-2,27)),amount:2400,cat:'Stipendio',accountId:S.accounts[0].id,note:'Stipendio'});save()})()")
    pg.goto(B + '/#patrimonio'); unlocked(pg)
    check('Vista Patrimonio', 'Patrimonio netto' in pg.inner_text('#view'))
    # auto con stima
    pg.click('[data-act=asset-new]'); pg.click('[data-act=asset-kind][data-k=auto]'); pg.wait_for_selector('#frm input[name=d_marca]')
    pg.fill('#frm input[name=name]', 'Golf'); pg.fill('#frm input[name=d_marca]', 'Volkswagen'); pg.fill('#frm input[name=d_modello]', 'Golf'); pg.fill('#frm input[name=d_anno]', '2020'); pg.fill('#frm input[name=d_km]', '62000')
    pg.fill('#frm input[name=dl_assicurazione]', pg.evaluate("ds(new Date(Date.now()+10*864e5))"))
    pg.click('[data-act=asset-estimate]'); pg.wait_for_selector('[data-act=asset-use-est]', timeout=15000)
    t = pg.inner_text('#estbox'); check('Stima mostrata con forchetta e affidabilità', '16.500' in t and '15.000' in t and 'media' in t.lower(), t[:90].replace('\n', ' '))
    pg.click('[data-act=asset-use-est]'); pg.click('#frm button[type=submit]'); pg.wait_for_timeout(600)
    a = pg.evaluate("S.assets.find(a=>a.name==='Golf')")
    check('Auto salvata con stima AI e deprezzamento', a and a['value'] == 16500 and a['valueSrc'] == 'ai' and a['deprec'] == 11 and a['est']['mid'] == 16500)
    check('Registro privacy: solo caratteristiche auto', 'marca: Volkswagen' in pg.evaluate("S.aiLog[0].p") and 'saldo' not in pg.evaluate("S.aiLog[0].p").lower())
    pg.evaluate("(()=>{const a=S.assets.find(a=>a.name==='Golf');a.valueAt=Date.now()-365.25*864e5})()")
    check('Deprezzamento automatico dopo 1 anno (−11%)', pg.evaluate("assetValue(S.assets.find(a=>a.name==='Golf'))") == round(16500 * 0.89))
    # casa manuale
    pg.click('[data-act=asset-new]'); pg.click('[data-act=asset-kind][data-k=casa]'); pg.wait_for_selector('#frm input[name=d_comune]')
    pg.fill('#frm input[name=name]', 'Casa'); pg.fill('#frm input[name=d_comune]', 'Milano'); pg.fill('#frm input[name=d_mq]', '85'); pg.fill('#frm input[name=value]', '285.000')
    pg.click('#frm button[type=submit]'); pg.wait_for_timeout(500)
    check('Casa salvata con valore manuale (285.000)', pg.evaluate("S.assets.find(a=>a.name==='Casa').value") == 285000)
    # mutuo
    pg.click('[data-act=debt-new]'); pg.wait_for_selector('#frm input[name=principal]')
    pg.fill('#frm input[name=name]', 'Mutuo casa'); pg.fill('#frm input[name=principal]', '200000'); pg.fill('#frm input[name=rate]', '3,1'); pg.fill('#frm input[name=months]', '300'); pg.fill('#frm input[name=start]', '2021-03-15')
    pg.select_option('#frm select[name=assetId]', label='Casa'); pg.click('#frm button[type=submit]'); pg.wait_for_timeout(600)
    sim = pg.evaluate("""(()=>{const d=S.debts[0];const r=0.031/12,n=300;const P=200000*r/(1-Math.pow(1+r,-n));let bal=200000;const k=monthsPaid(d.start);for(let i=0;i<k;i++){bal=bal*(1+r)-P}return{sim:Math.round(bal),app:Math.round(loanResidual(d)),P:Math.round(P*100)/100,k}})()""")
    check('Mutuo: residuo = simulazione rata per rata', abs(sim['sim'] - sim['app']) <= 1, sim)
    check('Mutuo: rata classica 200k/3,1%/25 anni ≈ 958–960 €', 958 <= sim['P'] <= 960, sim['P'])
    rec = pg.evaluate("S.recurring.find(r=>r.name==='Rata Mutuo casa')")
    check('Rata aggiunta ai ricorrenti, senza arretrati', rec and abs(rec['amount'] - sim['P']) < 0.01 and rec['next'] > pg.evaluate("today()") and not pg.evaluate("S.tx.some(t=>t.recId===S.recurring.find(r=>r.name==='Rata Mutuo casa').id)"))
    nw = pg.evaluate("Math.round(cash()+invVal()+assetsVal()-debtsVal())")
    pg.goto(B + '/#patrimonio'); unlocked(pg)
    check('Patrimonio netto = liquidità + investimenti + beni − debiti', pg.evaluate("Math.round(cash()+invVal()+assetsVal()-debtsVal())") == nw and 'Netto del debito' in pg.inner_text('#view'))
    pg.screenshot(path='/tmp/a_pat.png', full_page=True)
    # home: previsione, spunti, scadenza
    pg.goto(B + '/#home'); unlocked(pg); t = pg.inner_text('#view')
    check('Home: previsione fine mese con stipendio atteso', 'Previsione a fine mese' in t and 'Stipendio atteso' in t)
    check('Home: scadenza assicurazione in "In arrivo"', 'Assicurazione · Golf' in t)
    check('Home: spunti presenti', 'Spunti' in t and ('Tasso di risparmio' in t or 'Assicurazione' in t))
    pg.screenshot(path='/tmp/a_home.png')
    check('Home: anello delle spese (o nessuna spesa) e barre per giorno', (pg.locator('.ringwrap svg.ring circle[data-tip]').count() >= 1 or 'Nessuna spesa questo mese' in t) and pg.locator('.daybars rect').count() >= 28)
    ov = pg.evaluate("""(()=>{const rows=[1601.9,87.11,37.59,3.95].map((v,i)=>({c:'c'+i,v,col:'#fff'}));
      const d=new DOMParser().parseFromString(spendRing(rows,1730.55),'image/svg+xml');
      const a=[...d.querySelectorAll('.ringarcs circle')].map(c=>({dash:+c.getAttribute('stroke-dasharray').split(' ')[0],off:-c.getAttribute('stroke-dashoffset')}));
      const C=2*Math.PI*98,w=18;let ok=true;
      for(let i=0;i<a.length;i++){const end=a[i].off+a[i].dash+w/2,next=i+1<a.length?a[i+1].off-w/2:C+a[0].off-w/2;if(end>next+0.01||a[i].dash<=0)ok=false}
      return ok})()""")
    check('Anello: le fette piccole restano visibili e non si sovrappongono', ov)
    check('Home: avviso del consulente in cima', pg.locator('.orbcard').count() == 1 and 'Assicurazione' in pg.inner_text('.orbcard'))
    pg.goto(B + '/#movimenti'); unlocked(pg)
    check('Movimenti: riepilogo con uscite del mese e barre', 'Uscite' in pg.inner_text('#txsum') and pg.locator('#txsum .daybars rect').count() >= 28)
    pg.select_option('#fc', 'Stipendio'); pg.wait_for_timeout(200)
    check('Movimenti: il riepilogo segue i filtri', 'Stipendio' in pg.inner_text('#txsum'))
    pg.select_option('#fc', ''); pg.goto(B + '/#home'); unlocked(pg)
    # privacy toggle
    pg.goto(B + '/#impostazioni'); unlocked(pg); pg.click('[data-act=priv][data-k=assets]'); pg.wait_for_timeout(300)
    pg.goto(B + '/#patrimonio'); unlocked(pg); pg.locator('.row', has_text='Golf').first.click(); pg.wait_for_selector('#frm')
    check('Stima AI spenta: pulsante nascosto', pg.locator('[data-act=asset-estimate]').count() == 0); pg.click('[data-act=close]')
    # mobile
    m = br.new_context(viewport={'width': 390, 'height': 844}); mp = m.new_page(); mp.goto(B); mp.wait_for_selector('#pw1'); mp.fill('#pw1', PW); mp.click('#lockbtn'); unlocked(mp)
    check('Mobile: 5 pulsanti in basso, l\'occhio al centro', mp.locator('#tabbar button').count() == 5 and 'Investimenti' in mp.inner_text('#tabbar') and mp.evaluate("(()=>{const b=document.querySelector('#tabbar .orbtab').getBoundingClientRect(),t=document.querySelector('#tabbar').getBoundingClientRect();return Math.abs((b.left+b.width/2)-(t.left+t.width/2))<3})()"))
    check('Mobile: "Altro" in alto al posto dell\'ingranaggio', mp.locator('.top [data-act=more]').is_visible() and not mp.locator('.top .desk-only').is_visible())
    ob = mp.evaluate("document.querySelector('#tabbar .orb').getBoundingClientRect().width")
    check('Mobile: occhio più piccolo', 44 <= ob <= 56, ob)
    mp.click('.top [data-act=more]'); mp.click('[data-act=go-close][data-v=ricorrenti]'); mp.wait_for_timeout(300)
    check('Mobile: Altro → Ricorrenti funziona', mp.inner_text('#ttl') == 'Costi ricorrenti')
    # the consultant orb: alert while something is unread (insurance deadline), cleared once opened; thinks during AI calls
    mp.evaluate("localStorage.removeItem('eyecash_orb_seen');orbRefresh()")
    check('Occhio: avviso acceso con una scadenza da leggere', mp.evaluate("document.body.classList.contains('orb-alert')"))
    check('Occhio: nel localStorage solo un hash, nessun testo', mp.evaluate("localStorage.getItem('eyecash_orb_seen')") is None)
    mp.click('#tabbar [data-act=orb]'); mp.wait_for_selector('#view .occ'); mp.wait_for_timeout(200)
    t = mp.inner_text('#view'); check('Occhio: si apre con cosa leggere e la casella per chiedere', 'DA LEGGERE' in t.upper() and 'Assicurazione' in t and mp.locator('#occq').count() == 1, t[:160].replace('\n', ' '))
    seen = mp.evaluate("localStorage.getItem('eyecash_orb_seen')")
    check('Occhio: dopo la lettura l\'avviso si spegne', not mp.evaluate("document.body.classList.contains('orb-alert')") and seen and seen.isdigit())
    check('Occhio: pensa durante una richiesta AI', mp.evaluate("(async()=>{const p=api('POST','/api/ai/parse-entry',{text:'caffè 2'}).catch(()=>0);const on=document.body.classList.contains('orb-think');await p;return on&&!document.body.classList.contains('orb-think')})()"))
    mp.goto(B + '/#patrimonio'); unlocked(mp); mp.screenshot(path='/tmp/a_mob.png', full_page=True)
    br.close()
print('ERRORI CONSOLE:', errs[:8]); print(f'RISULTATO: {sum(res)}/{len(res)} superati')
sys.exit(0 if all(res) and not errs else 1)
