"""
EyeCash – test end-to-end nel browser (Playwright + Chrome).
Richiede un server avviato su B con AI finta. Uso interno di sviluppo.
"""
import json, time, sys, sqlite3, os
from playwright.sync_api import sync_playwright

B = os.environ.get('POC_URL', 'http://localhost:8091')
DB = os.environ.get('POC_DB', '/tmp/pocdata/pointofcash.db')
PW = 'Prova-Sicura-2026!'
results = []; errs = []

def check(name, cond, info=''):
    results.append((name, bool(cond), info)); print(('PASS ' if cond else 'FAIL ') + name + (('  · ' + str(info)) if info else ''), flush=True)

def unlocked(pg, t=30000):
    pg.wait_for_selector('#lock.hidden', state='attached', timeout=t); pg.wait_for_timeout(300)

def login(pg):
    pg.goto(B); pg.wait_for_selector('#pw1', timeout=15000)
    if pg.locator('#pw2').count(): pg.fill('#pw1', PW); pg.fill('#pw2', PW)
    else: pg.fill('#pw1', PW)
    pg.click('#lockbtn'); unlocked(pg)

def S(pg, expr): return pg.evaluate(expr)
def settle(pg, ms=1500):
    pg.wait_for_timeout(ms); pg.evaluate("flushNow()"); pg.wait_for_timeout(300)

with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get('CHROME') or ('/usr/bin/google-chrome' if os.path.exists('/usr/bin/google-chrome') else None))
    ctx = br.new_context(viewport={'width': 1300, 'height': 900})
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errs.append('A:' + str(e)))
    pg.on('console', lambda m: errs.append('A:' + m.text) if m.type == 'error' and 'status of 40' not in m.text else None)
    login(pg)
    check('setup + sblocco', S(pg, "!!S && !S.demo"))

    # ---- manual tx + XSS ----
    pg.click('[data-act=quick]'); pg.click('[data-act=manual-tx]')
    pg.fill('#frm input[name=amount]', '9,99'); pg.fill('#frm input[name=note]', '<img src=x onerror="window.__xss=1">Bar')
    pg.click('#frm button[type=submit]'); settle(pg)
    pg.goto(B + '/#movimenti'); unlocked(pg); pg.wait_for_timeout(500)
    check('XSS: nessuno script eseguito', S(pg, "window.__xss===undefined"))
    check('XSS: testo mostrato come testo', pg.locator('#txlist img').count() == 0 and '<img' in pg.inner_text('#txlist'))

    # ---- CSV strano ----
    csv = '﻿Estratto conto Rossi\r\n\r\nData operazione;Data valuta;Descrizione operazione;Importo\r\n' \
          '02/11/2026;02/11/2026;"PAGAMENTO POS; ESSELUNGA ""VIALE""";-1.234,56\r\n' \
          '3/11/26;3/11/26;Bonifico stipendio;2.450,00\r\n' \
          '04/11/2026;04/11/2026;Rimborso;(12,00)\r\n' \
          'Saldo finale;;;9.999,00\r\n'
    open('/tmp/strano.csv', 'w', encoding='utf-8').write(csv)
    pg.set_input_files('#csv', '/tmp/strano.csv'); pg.wait_for_selector('#frm', timeout=10000)
    dlg = pg.inner_text('#sheetbox')
    check('CSV: 3 movimenti (saldo ignorato)', 'Trovati 3' in dlg, dlg.split('\n')[4] if len(dlg.split('\n')) > 4 else dlg[:120])
    pg.click('#frm button[type=submit]'); settle(pg)
    tx = S(pg, "S.tx.map(t=>[t.date,t.amount,t.note])")
    check('CSV: virgolette e ; nella descrizione', any('esselunga "viale"' in t[2].lower() for t in tx), [t for t in tx if 'ESSELUNGA' in t[2]])
    check('CSV: 1.234,56 → -1234.56', any(t[1] == -1234.56 for t in tx))
    check('CSV: data 3/11/26 → 2026-11-03', any(t[0] == '2026-11-03' and t[1] == 2450 for t in tx))
    check('CSV: (12,00) → negativo', any(t[1] == -12 and t[2] == 'Rimborso' for t in tx), [t for t in tx if t[2] == 'Rimborso'])
    pg.set_input_files('#csv', '/tmp/strano.csv'); pg.wait_for_selector('#frm', timeout=10000); pg.click('#frm button[type=submit]'); settle(pg)
    check('CSV: reimport non crea duplicati', S(pg, "S.tx.length") == len(tx), S(pg, "S.tx.length"))

    # ---- ricorrenza al 31 ----
    S(pg, """(()=>{S.recurring.push({id:'rtest',name:'Mutuo31',amount:500,cat:'Casa',accountId:S.accounts[0].id,freq:'mensile',type:'out',auto:true,next:'2026-01-31'});processRecurring();save()})()""")
    dates = S(pg, "S.tx.filter(t=>t.recId==='rtest').map(t=>t.date).sort()")
    check('Ricorrenza 31: fine mese corretto', dates[:5] == ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31'], dates[:6])
    check('Ricorrenza: prossima dopo oggi', S(pg, "S.recurring.find(r=>r.id==='rtest').next > today()"))
    S(pg, "processRecurring()")
    check('Ricorrenza: nessun doppione se rielaborata', S(pg, "S.tx.filter(t=>t.recId==='rtest').length") == len(dates))
    settle(pg)

    # ---- secondo dispositivo: unione modifiche ----
    ctx2 = br.new_context(viewport={'width': 390, 'height': 844}); pg2 = ctx2.new_page()
    pg2.on('pageerror', lambda e: errs.append('B:' + str(e)))
    login(pg2)
    check('Dispositivo B vede i dati', S(pg2, "S.tx.length") == S(pg, "S.tx.length"))
    S(pg, "S.tx.push({id:'fromA',date:today(),amount:-1,cat:'Altro',accountId:S.accounts[0].id,note:'Da PC'});save()"); settle(pg)
    S(pg2, "S.tx.push({id:'fromB',date:today(),amount:-2,cat:'Altro',accountId:S.accounts[0].id,note:'Da iPhone'});S.tx=S.tx.filter(t=>t.note!=='Rimborso');save()"); settle(pg2, 2500)
    pg.reload(); unlocked(pg); pg.wait_for_timeout(500)
    ids = S(pg, "S.tx.map(t=>t.id)")
    check('Multi-dispositivo: modifica di A conservata', 'fromA' in ids)
    check('Multi-dispositivo: modifica di B conservata', 'fromB' in ids)
    check('Multi-dispositivo: cancellazione di B applicata', not S(pg, "S.tx.some(t=>t.note==='Rimborso')"))

    # ---- sessione scaduta con modifiche non salvate ----
    ctx.clear_cookies()
    S(pg, "S.tx.push({id:'unsaved',date:today(),amount:-3,cat:'Altro',accountId:S.accounts[0].id,note:'Non salvata'});save()")
    pg.wait_for_timeout(2000)
    check('Sessione scaduta → richiesta password', pg.is_visible('#pw1'))
    pg.fill('#pw1', PW); pg.click('#lockbtn'); unlocked(pg); settle(pg)
    pg.reload(); unlocked(pg)
    check('Sessione scaduta: modifica recuperata dopo login', S(pg, "S.tx.some(t=>t.id==='unsaved')"))

    # ---- password errata ----
    pg.click('#syncbox [data-act=lock]'); pg.wait_for_selector('#pw1')
    pg.fill('#pw1', 'sbagliata-123'); pg.click('#lockbtn'); pg.wait_for_timeout(2500)
    check('Password errata rifiutata', 'errata' in pg.inner_text('#lockerr').lower(), pg.inner_text('#lockerr'))
    pg.fill('#pw1', PW); pg.click('#lockbtn'); unlocked(pg)
    check('Blocco/sblocco ok', S(pg, "!!S"))

    # ---- export/import JSON ----
    exported = S(pg, "JSON.stringify(S)")
    S(pg, "S.tx=[];save()"); settle(pg)
    pg.goto(B + '/#impostazioni'); unlocked(pg)
    pg.click('[data-act=import]'); pg.fill('#frm textarea', exported); pg.click('#frm button[type=submit]'); settle(pg)
    check('Export → import JSON ripristina tutto', S(pg, "S.tx.length") == json.loads(exported)['tx'].__len__())

    # ---- STRESS: 20.000 movimenti ----
    t0 = time.time()
    S(pg, """(()=>{const cats=OUT_CATS,a=S.accounts[0].id;const now=new Date();for(let i=0;i<20000;i++){const d=new Date(now.getFullYear(),now.getMonth(),now.getDate()-Math.floor(i/30));const inc=i%40===0;S.tx.push({id:'s'+i,date:ds(d),amount:inc?2000:-(5+(i*37)%180),cat:inc?'Stipendio':cats[i%cats.length],accountId:a,note:'Negozio '+(i%500)})}save()})()""")
    settle(pg, 500)
    t_save = S(pg, """(async()=>{const t=performance.now();dirty=true;await flush();return Math.round(performance.now()-t)})()""")
    blob_kb = round(len(sqlite3.connect(DB).execute('select blob from state').fetchone()[0]) / 1024)
    check('Stress: salvataggio cifrato 20k movimenti', t_save < 4000, f'{t_save} ms, {blob_kb} KB')
    times = {}
    for v in ['home', 'movimenti', 'report', 'investimenti', 'ricorrenti', 'impostazioni']:
        times[v] = S(pg, f"(()=>{{const t=performance.now();go('{v}');return Math.round(performance.now()-t)}})()")
    check('Stress: tutte le viste < 1,5 s con 20k movimenti', max(times.values()) < 1500, times)
    t_search = S(pg, """(()=>{go('movimenti');const t=performance.now();fQ='negozio 42';document.querySelector('#txlist').innerHTML=txListHTML();return Math.round(performance.now()-t)})()""")
    check('Stress: ricerca movimenti veloce', t_search < 500, f'{t_search} ms')
    pg.reload(); t1 = time.time(); unlocked(pg, 60000)
    check('Stress: riapertura app (decifra 20k)', time.time() - t1 < 8, f'{round(time.time()-t1,1)} s')
    check('Stress: dati integri dopo riapertura', S(pg, "S.tx.filter(t=>/^s\\d+$/.test(t.id)).length") == 20000, S(pg, "S.tx.filter(t=>/^s\\d+$/.test(t.id)).length"))

    # ---- import grande: 5.000 righe ----
    rows = ['Data;Descrizione;Importo'] + [f'{(i%28)+1:02d}/10/2026;Esercente {i};-{(i%90)+1},50' for i in range(5000)]
    open('/tmp/grande.csv', 'w').write('\n'.join(rows))
    t1 = time.time(); pg.goto(B + '/#movimenti'); unlocked(pg)
    pg.set_input_files('#csv', '/tmp/grande.csv'); pg.wait_for_selector('#frm', timeout=20000)
    check('Stress: import 5.000 righe riconosciuto', 'Trovati 5000' in pg.inner_text('#sheetbox'), f'{round(time.time()-t1,1)} s')
    pg.select_option('#frm select[name=ai]', '0') if pg.locator('#frm select[name=ai]').count() else None
    pg.click('#frm button[type=submit]'); settle(pg, 1500)
    check('Stress: 5.000 righe importate', S(pg, "S.tx.filter(t=>t.note.startsWith('Esercente')).length") == 5000)

    # ---- stampa / mobile ----
    pg.goto(B + '/#report'); unlocked(pg); pg.emulate_media(media='print'); pg.screenshot(path='/tmp/t_print.png'); pg.emulate_media(media='screen')
    check('Report: tabella movimenti presente', pg.locator('.tbl').count() >= 3)
    pg2.goto(B + '/#home'); unlocked(pg2, 60000); pg2.screenshot(path='/tmp/t_mob.png')
    check('Mobile: barra in basso visibile', pg2.is_visible('#tabbar'))
    pg2.click('[data-act=quick]'); check('Mobile: tasto Detta presente', pg2.is_visible('#micbtn'))
    br.close()

print('\nERRORI CONSOLE:', errs[:10])
fails = [r for r in results if not r[1]]
print(f'\nRISULTATO: {len(results)-len(fails)}/{len(results)} superati')
sys.exit(1 if fails or errs else 0)
