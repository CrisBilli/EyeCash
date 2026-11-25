/*
 * EyeCash · public/js/offline.js
 *
 * Offline mode: an encrypted copy of the data kept on this device so the
 * app opens and accepts new expenses without network; changes sync on reconnect.
 */
/* ---------- Offline mode: ENCRYPTED copy of the data on this device ---------- */
const offAllowed = () => {
  try {
    return localStorage.getItem('eyecash_offline') !== '0';
  } catch (e) {
    return true;
  }
};
async function offSave(blob, ver) {
  if (!offAllowed() || !STATUS || !STATUS.kdf_salt || OFFLINE) return;
  await idbSetK('off', { blob, ver, salt: STATUS.kdf_salt, iter: STATUS.kdf_iter, at: Date.now() });
}
async function pendSave() {
  if (!offAllowed() || !KEY || !S || S.demo) return;
  try {
    await idbSetK('pend', {
      blob: await encState(JSON.stringify(S)),
      base: BASE ? await encState(BASE) : null,
      ver: VER,
      at: Date.now()
    });
  } catch (e) {}
}
const offErr = () =>
  Object.assign(new Error('Sei offline: questa funzione richiede la connessione'), { offline: true });
let reconT = null,
  recBusy = false;
/** Switches to offline mode (local encrypted copy). */
function goOffline() {
  if (OFFLINE) return;
  OFFLINE = true;
  setSync('offline');
  clearInterval(reconT);
  reconT = setInterval(tryReconnect, 10000);
  if (KEY && S) {
    toast('Sei offline: puoi continuare, le modifiche restano sul dispositivo');
    if (['occhio', 'investimenti', 'impostazioni'].includes(view)) renderView();
  }
}
/** Checks whether the server is back and syncs pending changes. */
async function tryReconnect() {
  if (!OFFLINE || recBusy) return;
  recBusy = true;
  try {
    const r = await fetch('/api/status', {
      credentials: 'same-origin',
      headers: { 'X-PointofCash': '1' },
      cache: 'no-store',
      signal: AbortSignal.timeout(6000)
    });
    if (!r.ok) throw new Error('status');
    const st = await r.json();
    OFFLINE = false;
    clearInterval(reconT);
    STATUS = st;
    AI = st.ai;
    AIPDF = st.aipdf;
    if (!KEY) {
      location.reload();
      return;
    }
    if (!st.authed) {
      showLock(
        'login',
        'Connessione tornata: inserisci la password per sincronizzare le modifiche fatte offline.'
      );
      return;
    }
    const had = dirty;
    setSync('saving');
    if (had) await flush();
    else await pull(false);
    if (!OFFLINE) {
      setSync('ok');
      toast(had ? 'Di nuovo online: modifiche sincronizzate' : 'Di nuovo online');
      ensureInboxKey()
        .then(pullInbox)
        .catch(() => {});
      autoQuotes();
      renderView();
    }
  } catch (e) {
  } finally {
    recBusy = false;
  }
}
addEventListener('online', () => setTimeout(tryReconnect, 800));
async function offlineBoot() {
  const off = offAllowed() ? await idbGetK('off') : null;
  if (!off) return false;
  OFFLINE = true;
  STATUS = {
    kdf_salt: off.salt,
    kdf_iter: off.iter,
    setup: true,
    authed: false,
    ai: false,
    quotes: false,
    offline: true,
    version: ''
  };
  AI = false;
  AIPDF = false;
  clearInterval(reconT);
  reconT = setInterval(tryReconnect, 10000);
  const k = await idbGet();
  if (k && bioOn()) {
    HELD = k;
    showBioLock();
    bioUnlock();
    return true;
  }
  if (k) {
    KEY = k;
    try {
      await openApp();
    } catch (e) {
      showLock('login', e.message);
    }
    return true;
  }
  showLock('login', 'Sei offline: inserisci la password per aprire la copia salvata su questo dispositivo.');
  return true;
}
async function openOffline() {
  const off = await idbGetK('off'),
    pend = await idbGetK('pend');
  if (!off) throw new Error('Nessuna copia offline su questo dispositivo');
  let R;
  try {
    R = await decState(off.blob);
  } catch (e) {
    KEY = null;
    throw new Error(e.name === 'OperationError' ? 'Password errata.' : e.message);
  }
  S = R;
  BASE = JSON.stringify(R);
  VER = off.ver;
  dirty = false;
  if (pend) {
    try {
      const L = await decState(pend.blob),
        B = pend.base ? await decState(pend.base) : R;
      S = pend.ver === off.ver && pend.base ? L : mergeStates(B, R, L);
      if (pend.ver === off.ver && pend.base) BASE = JSON.stringify(B);
      dirty = true;
    } catch (e) {}
  }
  normState();
  render();
  $('#lock').classList.add('hidden');
  setSync('offline');
  toast(
    dirty
      ? 'Offline: copia del dispositivo con le modifiche in coda'
      : 'Offline: stai usando la copia salvata su questo dispositivo'
  );
}
if ('serviceWorker' in navigator && window.isSecureContext)
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
