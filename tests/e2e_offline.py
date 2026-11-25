"""EyeCash – test: modalità offline (copia cifrata sul dispositivo, coda delle modifiche, sincronizzazione al ritorno della rete)."""
import os, json
from playwright.sync_api import sync_playwright
B = os.environ.get('POC_URL', 'http://localhost:8091'); PW = 'Prova-Sicura-2026!'
res = []
def check(n, c, i=''): res.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n + (('  · ' + str(i)) if i else ''), flush=True)
def unlocked(pg, t=30000): pg.wait_for_selector('#lock.hidden', state='attached', timeout=t); pg.wait_for_timeout(500)
def login(pg, remember=True):
    pg.goto(B); pg.wait_for_selector('#pw1'); pg.wait_for_timeout(800)
    if pg.locator('#pw2').count(): pg.fill('#pw2', PW)
    pg.fill('#pw1', PW)
    if not remember: pg.uncheck('#remember')
    pg.click('#lockbtn'); unlocked(pg)
def add_tx(pg, note, amt):
    pg.evaluate("([n,a])=>{S.tx.push({id:uid(),date:today(),amount:a,cat:'Spesa',note:n,accountId:S.accounts[0].id});save();render()}", [note, amt])
def server_notes(br):
    ctx = br.new_context(); p2 = ctx.new_page(); login(p2, remember=False); notes = p2.evaluate("S.tx.map(t=>t.note)"); ctx.close(); return notes
errs = []
with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get('CHROME') or ('/usr/bin/google-chrome' if os.path.exists('/usr/bin/google-chrome') else None))
    A = br.new_context(viewport={'width': 390, 'height': 844}); pg = A.new_page()
    pg.on('pageerror', lambda e: errs.append(str(e)))
    login(pg)
    add_tx(pg, 'online prima', -10); pg.wait_for_timeout(1500)
    pg.evaluate("navigator.serviceWorker.ready"); pg.reload(); unlocked(pg); pg.wait_for_timeout(800)
    check('Service worker attivo', pg.evaluate("!!navigator.serviceWorker.controller"))
    check('Copia cifrata salvata sul dispositivo', pg.evaluate("idbGetK('off').then(o=>!!o&&o.blob.includes('\"ct\"')&&!o.blob.includes('online prima'))"))
    # --- senza rete
    A.set_offline(True); pg.reload(); unlocked(pg)
    check('Senza rete l\'app si apre (dispositivo ricordato)', pg.evaluate("OFFLINE===true") and pg.evaluate("S.tx.some(t=>t.note==='online prima')"))
    check('Indicatore offline visibile', 'Offline' in pg.inner_text('#offbar'))
    add_tx(pg, 'spesa offline', -7.5); pg.wait_for_timeout(700)
    check('Modifica in coda (cifrata)', pg.evaluate("idbGetK('pend').then(o=>!!o&&!o.blob.includes('spesa offline'))"))
    pg.evaluate("S.chat=[];go('occhio')"); pg.wait_for_timeout(200)
    check('Offline: Occhio sul dispositivo, domande rapide disponibili', 'Sul dispositivo' in pg.inner_text('#view') and pg.locator('[data-act=ask-quick]').count() >= 5)
    pg.click('[data-act=ask-quick][data-i="1"]'); pg.wait_for_timeout(200)
    check('Domanda rapida calcolata offline', 'hai speso' in pg.inner_text('#view'))
    pg.fill('#occq', 'quanto ho speso questo mese?'); pg.click('#occform button[type=submit]'); pg.wait_for_timeout(500)
    check('Offline: domanda scritta capita sul dispositivo', pg.evaluate("S.chat[S.chat.length-1].kind") == 'ask')
    pg.reload(); unlocked(pg)
    check('Dopo la riapertura offline la modifica c\'è ancora', pg.evaluate("S.tx.some(t=>t.note==='spesa offline')"))
    # --- intanto un altro dispositivo modifica online
    Bc = br.new_context(); pb = Bc.new_page(); login(pb, remember=False); add_tx(pb, 'altro dispositivo', -3); pb.wait_for_timeout(1500); Bc.close()
    # --- torna la rete
    A.set_offline(False); pg.evaluate("tryReconnect()"); pg.wait_for_timeout(3500)
    check('Tornata la rete: di nuovo online', pg.evaluate("OFFLINE===false") and not pg.evaluate("dirty"))
    notes = server_notes(br)
    check('Sul server ci sono le modifiche offline e quelle dell\'altro dispositivo', all(n in notes for n in ['online prima', 'spesa offline', 'altro dispositivo']), notes)
    check('Coda svuotata', pg.evaluate("idbGetK('pend').then(o=>!o)"))
    # --- sblocco offline con password (dispositivo non ricordato)
    pg.evaluate("idbSet(null)"); A.set_offline(True); pg.reload(); pg.wait_for_selector('#pw1', timeout=20000)
    check('Offline senza chiave ricordata: chiede la password', 'offline' in pg.inner_text('#lockbox').lower())
    pg.fill('#pw1', 'password-sbagliata-1'); pg.uncheck('#remember'); pg.click('#lockbtn'); pg.wait_for_timeout(2500)
    check('Password sbagliata: non si apre', 'errata' in pg.inner_text('#lockerr').lower() and not pg.evaluate("!!KEY"))
    pg.fill('#pw1', PW); pg.click('#lockbtn'); unlocked(pg)
    check('Password giusta: apre la copia offline', pg.evaluate("S.tx.some(t=>t.note==='altro dispositivo')"))
    A.set_offline(False); pg.evaluate("tryReconnect()"); pg.wait_for_timeout(2500)
    # --- esci da questo dispositivo: la copia offline viene cancellata
    pg.evaluate("lockNow(true)"); pg.wait_for_timeout(1200)
    check('Uscendo dal dispositivo la copia offline viene eliminata', pg.evaluate("Promise.all([idbGetK('off'),idbGetK('pend')]).then(a=>!a[0]&&!a[1])"))
    check('Nessun errore JavaScript', not errs, errs[:3])
    br.close()
print(f'\n{sum(res)}/{len(res)} superati'); raise SystemExit(0 if all(res) else 1)
