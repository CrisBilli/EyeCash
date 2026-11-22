"""EyeCash – browser tests for the report: periods, financial-health indicators,
'summary only' detail level (no merchants, no transactions) and printing."""
import os
from playwright.sync_api import sync_playwright
B = os.environ.get('POC_URL', 'http://localhost:8091'); PW = 'Prova-Sicura-2026!'
res = []
def check(n, c, i=''): res.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n + (('  · ' + str(i)) if i else ''), flush=True)
def unlocked(pg): pg.wait_for_selector('#lock.hidden', state='attached', timeout=30000); pg.wait_for_timeout(400)
with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get('CHROME') or ('/usr/bin/google-chrome' if os.path.exists('/usr/bin/google-chrome') else None))
    pg = br.new_page(viewport={'width': 1280, 'height': 900})
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(B); pg.wait_for_selector('#pw1')
    if pg.locator('#pw2').count(): pg.fill('#pw1', PW); pg.fill('#pw2', PW)
    else: pg.fill('#pw1', PW)
    pg.click('#lockbtn'); unlocked(pg)
    # fictional sample data, saved as real data so balances are not masked
    pg.evaluate("(()=>{S=Object.assign(demoState(),{privacy:S.privacy});normState();processRecurring();S.demo=false;S.hideBal=false;balShown=true;save();applyBalMask();go('report')})()")
    pg.wait_for_timeout(700)
    v = pg.inner_text('#view')
    prev = pg.evaluate("EN.ymAdd(today().slice(0,7),-1)")
    check('Il report mensile parte dall\'ultimo mese completo', pg.evaluate("reportPeriod().key") == prev, pg.evaluate("reportPeriod().key"))
    for lbl in ['Tasso di risparmio', 'Fondo di emergenza', 'Rata su reddito', 'Rata aggiuntiva sostenibile', 'Debiti sul patrimonio', 'Costi annui dei fondi', 'Composizione del patrimonio']:
        check(f'Indicatore presente: {lbl}', lbl in v)
    check('Elenco completo dei movimenti nel report mensile', 'Tutti i movimenti' in v)
    # the indicators match the engine on the same inputs
    em = pg.evaluate("reportData(reportPeriod()).health.find(x=>x.k==='emergency').value")
    exp = pg.evaluate("(()=>{const m=lastMonths(13).slice(0,12).map(monthTot).filter(x=>x.inc>0||x.out>0);return cash()/(m.reduce((s,x)=>s+x.out,0)/m.length)})()")
    check('Fondo di emergenza = liquidità / spesa media mensile', abs(em - exp) < 1e-9, round(em, 2))
    pg.click('[data-act=rep-mode][data-k="12m"]'); pg.wait_for_timeout(400)
    v = pg.inner_text('#view')
    check('Report ultimi 12 mesi con tabella mese per mese', 'ULTIMI 12 MESI' in v and 'Entrate e uscite mese per mese' in v)
    pg.click('[data-act=rep-mode][data-k="year"]'); pg.wait_for_timeout(400)
    check('Report annuale', 'REPORT ANNUALE' in pg.inner_text('#view'))
    pg.click('[data-act=rep-mode][data-k="month"]'); pg.wait_for_timeout(300)
    pg.click('[data-act=rep-detail][data-k="summary"]'); pg.wait_for_timeout(400)
    v = pg.inner_text('.report')
    merchants = pg.evaluate("[...new Set(S.tx.map(t=>t.note).filter(n=>n&&!/^(Stipendio)$/.test(n)))]")
    leaked = [m for m in merchants if m in v]
    check('"Solo sintesi": nessun esercente né movimento nel report', 'Tutti i movimenti' not in v and not leaked, leaked[:3])
    pg.emulate_media(media='print'); pdf = pg.pdf(format='A4'); pg.emulate_media(media='screen')
    check('Stampa / PDF generato', len(pdf) > 20000, len(pdf))
    pg.set_viewport_size({'width': 390, 'height': 844})  # iPhone width, same session
    for mode in ['month', '12m', 'year']:
        pg.evaluate(f"REP.mode='{mode}';REP.detail='full';go('report')"); pg.wait_for_timeout(300)
        check(f'Report {mode} su iPhone senza scorrimento orizzontale', pg.evaluate("document.documentElement.scrollWidth") <= 392, pg.evaluate("document.documentElement.scrollWidth"))
    check('Nessun errore JavaScript', not errs, errs[:3])
    br.close()
print(f'\n{sum(res)}/{len(res)} superati')
