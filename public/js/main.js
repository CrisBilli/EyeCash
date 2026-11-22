/*
 * EyeCash · public/js/main.js
 *
 * Start-up: routing from the URL hash, service worker registration, first
 * unlock and periodic background tasks.
 */
/* ---------- start-up ---------- */
{
  const h = location.hash.slice(1);
  if (TITLES[h]) view = h;
  if (h === 'ai') view = 'report';
}
(async () => {
  if (!window.isSecureContext || !crypto.subtle) {
    $('#lock').classList.remove('hidden');
    $('#lockbox').innerHTML =
      '<div class="logo"><i></i>EyeCash</div><p>Apri l\'app tramite <b>https://</b> (indirizzo Tailscale) oppure da localhost: la cifratura del browser non funziona su http.</p>';
    return;
  }
  try {
    STATUS = await api('GET', '/api/status');
    AI = STATUS.ai;
    AIPDF = STATUS.aipdf;
    if (!STATUS.setup) return showLock('setup');
    if (STATUS.authed) {
      const k = await idbGet();
      if (k && bioOn()) {
        HELD = k;
        showBioLock();
        bioUnlock();
        return;
      }
      if (k) {
        KEY = k;
        try {
          await openApp();
          return;
        } catch (e) {
          return showLock('login', e.message);
        }
      }
    }
    showLock('login');
  } catch (e) {
    if (e.offline && (await offlineBoot())) return;
    $('#lock').classList.remove('hidden');
    $('#lockbox').innerHTML =
      `<div class="logo"><i></i>EyeCash</div><p>Server non raggiungibile. Controlla di essere connesso alla VPN (Tailscale).</p><button class="btn pri" onclick="location.reload()">Riprova</button>`;
  }
})();
setInterval(() => {
  if (document.visibilityState === 'visible' && KEY && S && !S.demo && !OFFLINE) pullInbox();
}, 30000);
{
  let wasM = innerWidth < 820,
    rt;
  addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      const m = innerWidth < 820;
      if (m !== wasM && S && KEY) {
        wasM = m;
        renderView();
      }
    }, 200);
  });
}
