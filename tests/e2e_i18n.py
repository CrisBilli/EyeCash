"""EyeCash – browser tests for the interface language: switch to English from
Settings, English texts and formats, data unchanged (categories are stored in
Italian), quick answers in English, and back to Italian."""
import os, re
from playwright.sync_api import sync_playwright
B = os.environ.get('POC_URL', 'http://localhost:8091'); PW = 'Prova-Sicura-2026!'
res = []
def check(n, c, i=''): res.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n + (('  · ' + str(i)) if i else ''), flush=True)
def unlocked(pg): pg.wait_for_selector('#lock.hidden', state='attached', timeout=30000); pg.wait_for_timeout(400)
ITALIAN = re.compile(r"\b(della|delle|degli|nessun|nessuna|questo|questa|movimenti|spese|entrate|uscite|patrimonio|risparmio|impostazioni|aggiungi|scadenza|giorni)\b", re.I)
def italian_left(pg):
    texts = pg.evaluate("""()=>{const o=[];const w=document.createTreeWalker(document.querySelector('.app'),NodeFilter.SHOW_TEXT);
      for(let n=w.nextNode();n;n=w.nextNode()){const s=n.nodeValue.trim();if(s&&!n.parentElement.closest('[translate=no]'))o.push(s)}return o}""")
    return [s for s in texts if ITALIAN.search(s)]
with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get('CHROME') or ('/usr/bin/google-chrome' if os.path.exists('/usr/bin/google-chrome') else None))
    pg = br.new_page(viewport={'width': 1280, 'height': 900})
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(B); pg.wait_for_selector('#pw1')
    if pg.locator('#pw2').count(): pg.fill('#pw1', PW); pg.fill('#pw2', PW)
    else: pg.fill('#pw1', PW)
    pg.click('#lockbtn'); unlocked(pg)
    check('Lingua predefinita nei test: italiano', pg.evaluate("LANG") == 'it' and 'Movimenti' in pg.inner_text('.side'))
    pg.evaluate("(()=>{S=Object.assign(demoState(),{privacy:S.privacy});normState();processRecurring();S.demo=false;S.hideBal=false;balShown=true;save();applyBalMask();go('impostazioni')})()")
    pg.wait_for_timeout(500)
    pg.click('[data-act=lang][data-k=en]'); pg.wait_for_load_state('load'); unlocked(pg)
    check('Dopo il cambio: interfaccia in inglese', pg.evaluate("LANG") == 'en' and 'Transactions' in pg.inner_text('.side'), pg.inner_text('.side')[:80])
    check('Importi in formato inglese (€1,234.56)', pg.evaluate("eur(1234.5)") == '€1,234.50', pg.evaluate("eur(1234.5)"))
    check('Mesi in inglese', pg.evaluate("ymLabel('2026-01')") == 'January 2026')
    left = {}
    for v in ['home', 'movimenti', 'patrimonio', 'investimenti', 'statistiche', 'report', 'impostazioni', 'occhio', 'ricorrenti', 'obiettivi', 'fire']:
        pg.evaluate(f"go('{v}')"); pg.wait_for_timeout(400)
        it = italian_left(pg)
        if it: left[v] = it[:3]
    check('Nessun testo rimasto in italiano nelle schermate principali', not left, left)
    pg.evaluate("S.chat=[];go('occhio')"); pg.click('[data-act=ask-quick][data-i="1"]'); pg.wait_for_timeout(500)
    check('Risposta rapida in inglese', 'This month you have spent' in pg.inner_text('#view'))
    # a new expense chosen from the English category grid is stored with the Italian key
    pg.evaluate("txForm()"); pg.wait_for_selector('#frm')
    pg.fill('#frm input[name=amount]', '12.50')
    pg.locator('.cgrid button', has_text='Restaurants').first.click()
    pg.fill('#frm input[name=note]', 'Test i18n'); pg.click('#frm button[type=submit]'); pg.wait_for_timeout(500)
    t = pg.evaluate("S.tx.find(x=>x.note==='Test i18n')")
    check('Categoria salvata con la chiave originale (Ristoranti) e importo 12.50', t and t['cat'] == 'Ristoranti' and t['amount'] == -12.5, t)
    pg.evaluate("go('impostazioni')"); pg.wait_for_timeout(300)
    pg.click('[data-act=lang][data-k=it]'); pg.wait_for_load_state('load'); unlocked(pg)
    check('Ritorno all\'italiano', pg.evaluate("LANG") == 'it' and 'Movimenti' in pg.inner_text('.side') and pg.evaluate("eur(1234.5)").startswith('1234,50') or pg.evaluate("eur(1234.5)").startswith('1.234,50'), pg.evaluate("eur(1234.5)"))
    check('Nessun errore JavaScript', not errs, errs[:3])
    br.close()
print(f'\n{sum(res)}/{len(res)} superati')
