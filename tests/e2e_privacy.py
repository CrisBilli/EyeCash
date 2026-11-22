"""EyeCash – browser tests for privacy features: app-switcher curtain, auto-lock,
size padding of the encrypted state, encrypted backup download and restore."""
import os, json, base64
from playwright.sync_api import sync_playwright
B = os.environ.get('POC_URL', 'http://localhost:8091'); PW = 'Prova-Sicura-2026!'
res = []
def check(n, c, i=''): res.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n + (('  · ' + str(i)) if i else ''), flush=True)
def unlocked(pg): pg.wait_for_selector('#lock.hidden', state='attached', timeout=30000); pg.wait_for_timeout(400)
def set_visibility(pg, state):
    pg.evaluate("s => { Object.defineProperty(document, 'visibilityState', { value: s, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }", state)
with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get('CHROME') or ('/usr/bin/google-chrome' if os.path.exists('/usr/bin/google-chrome') else None))
    ctx = br.new_context(viewport={'width': 1200, 'height': 900}, accept_downloads=True); pg = ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(B); pg.wait_for_selector('#pw1')
    if pg.locator('#pw2').count(): pg.fill('#pw1', PW); pg.fill('#pw2', PW)
    else: pg.fill('#pw1', PW)
    pg.click('#lockbtn'); unlocked(pg)
    pg.evaluate("(()=>{S.accounts[0].name='Conto Segreto Privato';S.tx.push({id:uid(),date:today(),amount:-42,cat:'Spesa',note:'Supermercato Riservato',accountId:S.accounts[0].id});save()})()")
    pg.evaluate("flushNow()"); pg.wait_for_timeout(600)

    # curtain
    set_visibility(pg, 'hidden')
    check('Nel multitasking il contenuto è sfocato', pg.evaluate("document.body.classList.contains('curtain')"))
    set_visibility(pg, 'visible')
    check('Al ritorno il contenuto torna visibile', not pg.evaluate("document.body.classList.contains('curtain')"))

    # padding: stored ciphertext is a multiple of 16 KB (+16 bytes GCM tag)
    blob = pg.evaluate("api('GET','/api/state').then(r=>r.blob)")
    ct = base64.b64decode(json.loads(blob)['ct'])
    check('Dimensione dei dati cifrati arrotondata a blocchi di 16 KB', (len(ct) - 16) % 16384 == 0, len(ct))

    # encrypted backup download
    pg.evaluate("go('impostazioni')"); pg.wait_for_timeout(400)
    with pg.expect_download() as dl: pg.click('[data-act=export-enc]')
    txt = open(dl.value.path(), encoding='utf-8').read(); bk = json.loads(txt)
    check('Backup cifrato scaricato con blob e parametri della chiave', bk.get('blob') and bk.get('kdf_salt') and bk.get('kdf_iter'))
    check('Il backup cifrato non contiene testo leggibile', 'Segreto' not in txt and 'Riservato' not in txt)

    # restore from the encrypted backup
    pg.evaluate("(()=>{S.tx=[];save()})()")
    pg.click('[data-act=import]'); pg.wait_for_selector('#frm textarea')
    pg.fill('#frm textarea', txt); pg.click('#frm button[type=submit]'); pg.wait_for_timeout(800)
    check('Ripristino dal backup cifrato', pg.evaluate("S.tx.some(t=>t.note==='Supermercato Riservato')"))

    # auto-lock after the chosen time away
    pg.click('[data-act=autolock][data-k="1"]'); pg.wait_for_timeout(300)
    check('Blocco automatico impostato a 1 minuto', pg.evaluate("autoLockMin()") == 1)
    set_visibility(pg, 'hidden'); pg.evaluate("balAway = Date.now() - 2 * 60e3"); set_visibility(pg, 'visible'); pg.wait_for_timeout(1200)
    check('Dopo 2 minuti fuori dall\'app serve di nuovo la password', pg.is_visible('#lock') and pg.evaluate("KEY === null"))
    pg.fill('#pw1', PW); pg.click('#lockbtn'); unlocked(pg)
    check('Si rientra con la password e i dati ci sono', pg.evaluate("S.tx.some(t=>t.note==='Supermercato Riservato')"))
    pg.click('[data-act=autolock][data-k="0"]') if pg.evaluate("go('impostazioni'),true") else None
    pg.wait_for_timeout(300)
    set_visibility(pg, 'hidden'); pg.evaluate("balAway = Date.now() - 120 * 60e3"); set_visibility(pg, 'visible'); pg.wait_for_timeout(600)
    check('Con "Mai" l\'app non si blocca', pg.evaluate("KEY !== null"))
    check('Nessun errore JavaScript', not errs, errs[:3])
    br.close()
print(f'\n{sum(res)}/{len(res)} superati')
