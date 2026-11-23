"""EyeCash – browser tests for the advisor chat. Starts its own server with a LOCAL
model (Ollama, emulated by tests/mock_ai.js): the model calls tools, the device runs
them on the decrypted data and the answer uses their real results."""
import os, subprocess, tempfile, time, json, urllib.request
from playwright.sync_api import sync_playwright
PORT = 8095; B = f'http://localhost:{PORT}'; PW = 'Prova-Sicura-2026!'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
res = []; errs = []
def check(n, c, i=''): res.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n + (('  · ' + str(i)) if i else ''), flush=True)
def unlocked(pg): pg.wait_for_selector('#lock.hidden', state='attached', timeout=30000); pg.wait_for_timeout(400)
def mocklog():
    try: return open('/tmp/mockai.log').read()
    except OSError: return ''
data = tempfile.mkdtemp()
env = dict(os.environ, PORT=str(PORT), DATA_DIR=data, AI_PROVIDER='ollama', OLLAMA_URL='http://127.0.0.1:8099', AI_MODEL='qwen3:8b')
srv = subprocess.Popen(['node', 'server.js'], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(50):
        try: urllib.request.urlopen(B + '/api/status', timeout=1); break
        except Exception: time.sleep(0.2)
    st = json.loads(urllib.request.urlopen(B + '/api/status').read())
    check('Server con modello locale', st['ai_local'] and st['ai_model'] == 'qwen3:8b', st.get('ai_model'))
    with sync_playwright() as p:
        br = p.chromium.launch(executable_path=os.environ.get('CHROME') or ('/usr/bin/google-chrome' if os.path.exists('/usr/bin/google-chrome') else None))
        pg = br.new_page(viewport={'width': 1300, 'height': 950})
        pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'status of' not in m.text else None)
        pg.goto(B); pg.wait_for_selector('#pw1')
        if pg.locator('#pw2').count(): pg.fill('#pw1', PW); pg.fill('#pw2', PW)
        else: pg.fill('#pw1', PW)
        pg.click('#lockbtn'); unlocked(pg)
        pg.evaluate("(()=>{S=Object.assign(demoState(),{privacy:S.privacy});normState();processRecurring();S.demo=false;S.hideBal=false;balShown=true;save();applyBalMask();go('consulente')})()")
        pg.wait_for_timeout(500)
        t = pg.inner_text('#view')
        check('Vista Consulente con suggerimenti', 'Consulente' in t and pg.locator('[data-act=chat-suggest]').count() >= 4 and 'qwen3:8b' in t)
        before = len(mocklog())
        pg.fill('#chatq', 'Quanto riesco a risparmiare al mese?'); pg.click('#chatform button'); pg.wait_for_timeout(2500)
        exp = pg.evaluate("CHAT_RUN.get_overview()")
        t = pg.inner_text('#view')
        check('Risposta con i numeri veri calcolati sul dispositivo', str(exp['avg_monthly_saving']) in t and str(exp['cash']) in t, [exp['avg_monthly_saving'], exp['cash']])
        check('Grassetto ed elenco resi, ragionamento <think> nascosto', pg.locator('.chat-a b').count() >= 1 and pg.locator('.chat-md li').count() == 2 and 'calcolo' not in t)
        check('Passi mostrati: "Quadro generale"', 'Dati consultati: 1' in t)
        sent = mocklog()[before:]
        check('Il modello locale riceve il risultato dello strumento', '"role":"tool"' in sent and 'avg_monthly_saving' in sent)
        # tool with arguments, follow-up keeps the conversation
        pg.fill('#chatq', "Posso comprare un'auto da 20.000 € tra due mesi?"); pg.click('#chatform button'); pg.wait_for_timeout(2500)
        t = pg.inner_text('#view')
        sim = pg.evaluate("CHAT_RUN.simulate_cashflow({events:[{label:'Auto',amount:20000,month:2}],target_index:0})")
        check('Simulazione della liquidità con l\'evento', str(sim['cash_lowest']) in t, sim['cash_lowest'])
        sent = mocklog().split('\n')[-3]
        check('Seconda domanda con la conversazione precedente', 'Quanto riesco a risparmiare' in sent)
        pg.fill('#chatq', 'quanto spendo nei ristoranti?'); pg.click('#chatform button'); pg.wait_for_timeout(2500)
        n = pg.evaluate("CHAT_RUN.search_transactions({category:'Ristoranti',limit:5}).count")
        check('Ricerca nei movimenti', f'Ho trovato {n} movimenti' in pg.inner_text('#view'), n)
        check('Registro privacy: chat al modello locale', pg.evaluate("S.aiLog[0].k") == 'chat' and 'modello locale' in pg.evaluate("S.aiLog[0].p"))
        # stored encrypted, survives a reload
        pg.wait_for_timeout(800)
        pg.reload(); pg.wait_for_load_state('load'); unlocked(pg)
        pg.evaluate("go('consulente')"); pg.wait_for_timeout(400)
        check('Conversazione conservata (cifrata) dopo il riavvio', pg.locator('.chat-u').count() == 3)
        pg.click('[data-act=chat-new]'); pg.wait_for_timeout(300)
        check('Nuova chat', pg.locator('.chat-u').count() == 0)
        # privacy switch
        pg.evaluate("S.privacy.chat=false;renderView()")
        check('Disattivata nelle impostazioni di privacy', 'disattivata' in pg.inner_text('#view'))
        pg.evaluate("S.privacy.chat=true;renderView()")
        # mobile
        pg.set_viewport_size({'width': 390, 'height': 844})
        pg.click('[data-act=chat-suggest] >> nth=0'); pg.wait_for_timeout(2500)
        check('Mobile: suggerimento → risposta, niente scorrimento orizzontale', pg.locator('.chat-a').count() >= 1 and pg.evaluate("document.documentElement.scrollWidth") <= 392)
        pg.screenshot(path='/tmp/chat_mob.png', full_page=True)
        # English
        pg.set_viewport_size({'width': 1300, 'height': 950})
        pg.evaluate("setLang('en')"); pg.wait_for_load_state('load'); unlocked(pg)
        pg.evaluate("go('consulente')"); pg.wait_for_timeout(400)
        t = pg.inner_text('#view')
        check('Inglese: vista tradotta', 'Advisor' in t and 'New chat' in t and 'Nuova chat' not in t, t[:160])
        pg.screenshot(path='/tmp/chat_en.png', full_page=True)
        pg.evaluate("setLang('it')"); pg.wait_for_load_state('load')
        check('Nessun errore JavaScript', not errs, errs[:3])
        br.close()
finally:
    srv.terminate()
