/*
 * EyeCash · public/js/lock.js
 *
 * Lock screen, password setup and unlock, biometric unlock (Face ID /
 * Touch ID / Windows Hello through WebAuthn) and the "masked balances" privacy mode.
 */
/* ---------- lock screen ---------- */
function strength(p) {
  let s = 0;
  if (p.length >= 10) s++;
  if (p.length >= 14) s++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
  if (/\d/.test(p)) s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  return s;
}
/** Shows the lock screen in "setup" (create password) or "login" mode. */
function showLock(mode, msg = '') {
  KEY = null;
  $('#lock').classList.remove('hidden');
  const setup = mode === 'setup';
  $('#lockbox').innerHTML = `<div class="logo"><i></i>EyeCash</div>
  <p>${setup ? "Crea la password. Serve ad aprire l'app <b>e a cifrare i tuoi dati</b>: il server non la conosce." : 'I tuoi dati sono cifrati. Inserisci la password per aprirli.'}</p>
  ${setup ? '<div class="warn">⚠️ Se perdi la password, i dati <b>non si possono recuperare</b> da nessuno. Salvala in un password manager (es. Portachiavi iCloud).</div>' : ''}
  <form id="lockform" autocomplete="on">
    <input type="text" name="username" value="pointofcash" autocomplete="username" hidden>
    <div class="fld"><label>Password</label><input class="inp" type="password" id="pw1" autocomplete="${setup ? 'new-password' : 'current-password'}" required minlength="${setup ? 10 : 1}" autofocus></div>
    ${setup ? '<div class="meter"><i id="pwm"></i></div><div class="fld" style="margin-top:12px"><label>Ripeti la password</label><input class="inp" type="password" id="pw2" autocomplete="new-password" required></div>' : ''}
    <label class="chk"><input type="checkbox" id="remember" checked> Ricorda questo dispositivo per 30 giorni</label>
    <button class="btn pri" type="submit" id="lockbtn">${setup ? 'Crea e apri' : 'Sblocca'}</button>
    <div class="err" id="lockerr">${esc(msg)}</div>
  </form>`;
  $('#lockform').dataset.mode = mode;
}
document.addEventListener('input', e => {
  if (e.target.dataset && e.target.dataset.aw !== undefined && $('#aw-sum')) {
    let s = 0;
    document.querySelectorAll('[data-aw]').forEach(i => (s += num(i.value)));
    $('#aw-sum').textContent = (Math.round(s * 10) / 10).toFixed(1).replace('.', ',');
  }
});
document.addEventListener('input', e => {
  if (e.target.id === 'pw1' && $('#pwm')) {
    const s = strength(e.target.value);
    const c = ['#d03b3b', '#d03b3b', '#ec835a', '#fab219', '#0ca30c', '#0ca30c'][s];
    $('#pwm').style.width = (s / 5) * 100 + '%';
    $('#pwm').style.background = c;
  }
});
document.addEventListener(
  'submit',
  async e => {
    if (e.target.id !== 'lockform') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const mode = e.target.dataset.mode,
      pw = $('#pw1').value,
      remember = $('#remember').checked,
      err = $('#lockerr'),
      btn = $('#lockbtn');
    if (mode === 'setup') {
      if (pw.length < 10) return (err.textContent = 'Usa almeno 10 caratteri.');
      if (pw !== $('#pw2').value) return (err.textContent = 'Le password non coincidono.');
      if (strength(pw) < 3)
        return (err.textContent = 'Password troppo debole: aggiungi lunghezza, numeri o simboli.');
    }
    btn.disabled = true;
    btn.textContent = 'Verifica…';
    err.textContent = '';
    try {
      const { authKey, key } = await deriveKeys(pw);
      if (OFFLINE) {
        KEY = key;
        await openApp();
        if (remember) await idbSet(key);
        return;
      }
      await api('POST', mode === 'setup' ? '/api/setup' : '/api/login', { authKey, remember });
      KEY = key;
      await idbSet(remember ? key : null);
      await openApp();
    } catch (ex) {
      err.textContent = ex.message === 'Password errata' ? 'Password errata.' : ex.message;
      btn.disabled = false;
      btn.textContent = mode === 'setup' ? 'Crea e apri' : 'Sblocca';
    }
  },
  true
);
/** Unlocks with the password: derives keys, logs in, loads and decrypts the data. */
async function openApp() {
  if (OFFLINE) return openOffline();
  const pending = S && dirty && BASE && !S.demo ? { L: S, B: JSON.parse(BASE) } : null;
  await pull(true).catch(async ex => {
    if (ex.name === 'OperationError') {
      KEY = null;
      await idbSet(null);
      throw new Error('Chiave non valida: inserisci di nuovo la password.');
    }
    throw ex;
  });
  if (pending) {
    S = mergeStates(pending.B, S, pending.L);
    dirty = true;
    render();
    await flush();
    toast('Modifiche non salvate recuperate');
  }
  $('#lock').classList.add('hidden');
  ensureInboxKey()
    .then(pullInbox)
    .catch(() => {});
  autoQuotes();
}
async function lockNow(logout) {
  balShown = false;
  await flushNow();
  if (logout && OFFLINE && dirty) {
    toast('Sei offline con modifiche non sincronizzate: esci quando torni online');
    return;
  }
  KEY = null;
  S = null;
  BASE = null;
  dirty = false;
  await idbSet(null);
  if (logout) {
    await idbSetK('off', null);
    await idbSetK('pend', null);
  }
  if (logout) await api('POST', '/api/logout').catch(() => {});
  $('#view').innerHTML = '';
  showLock('login', logout ? 'Sei uscito da questo dispositivo.' : 'App bloccata.');
}

/* ---------- Biometric unlock: Face ID / Touch ID / Windows Hello (WebAuthn) ----------
   Per-device setting: never synced or sent to the server.
   The authenticator signature is verified here with the public key saved at enrolment.
   The password always remains an alternative. */
let HELD = null;
const BIO_LOCK_MIN = 5;
const wb64 = u => btoa(String.fromCharCode(...new Uint8Array(u))),
  wub64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const wb64url = u => wb64(u).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function bioCfg() {
  try {
    return JSON.parse(localStorage.getItem('poc_bio') || 'null');
  } catch (e) {
    return null;
  }
}
const bioOn = () => !!window.PublicKeyCredential && !!bioCfg();
async function bioAvailable() {
  try {
    return (
      !!window.PublicKeyCredential &&
      (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
    );
  } catch (e) {
    return false;
  }
}
/** Turns on biometric unlock for this device (WebAuthn credential + wrapped key). */
async function bioEnable() {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'EyeCash', id: location.hostname },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'pointofcash', displayName: 'EyeCash' },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 }
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'discouraged'
      },
      timeout: 60000,
      attestation: 'none'
    }
  });
  const r = cred.response;
  localStorage.setItem(
    'poc_bio',
    JSON.stringify({
      id: wb64(cred.rawId),
      pk: r.getPublicKey && r.getPublicKey() ? wb64(r.getPublicKey()) : null,
      alg: r.getPublicKeyAlgorithm ? r.getPublicKeyAlgorithm() : null
    })
  );
}
function bioDisable() {
  try {
    localStorage.removeItem('poc_bio');
  } catch (e) {}
}
function derToRaw(d) {
  let o = d[1] & 0x80 ? 2 + (d[1] & 0x7f) : 2;
  const rd = () => {
    const l = d[o + 1];
    let v = d.slice(o + 2, o + 2 + l);
    o += 2 + l;
    while (v.length > 32) v = v.slice(1);
    const out = new Uint8Array(32);
    out.set(v, 32 - v.length);
    return out;
  };
  const r = rd(),
    s = rd(),
    out = new Uint8Array(64);
  out.set(r);
  out.set(s, 32);
  return out;
}
async function bioVerify() {
  const c = bioCfg();
  if (!c) return false;
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const a = await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: location.hostname,
      allowCredentials: [{ type: 'public-key', id: wub64(c.id) }],
      userVerification: 'required',
      timeout: 60000
    }
  });
  const r = a.response,
    ad = new Uint8Array(r.authenticatorData);
  if (!(ad[32] & 4)) return false; // the user must have been verified (face, fingerprint or device PIN)
  const cd = JSON.parse(new TextDecoder().decode(r.clientDataJSON));
  if (cd.type !== 'webauthn.get' || cd.challenge !== wb64url(challenge)) return false;
  if (c.pk && (c.alg === -7 || c.alg === -257)) {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', r.clientDataJSON)),
      data = new Uint8Array(ad.length + 32);
    data.set(ad);
    data.set(h, ad.length);
    if (c.alg === -7) {
      const k = await crypto.subtle.importKey(
        'spki',
        wub64(c.pk),
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify']
      );
      return crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        k,
        derToRaw(new Uint8Array(r.signature)),
        data
      );
    }
    const k = await crypto.subtle.importKey(
      'spki',
      wub64(c.pk),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', k, r.signature, data);
  }
  return true;
}
function showBioLock(msg = '') {
  $('#lock').classList.remove('hidden');
  $('#lockbox').innerHTML =
    `<div class="logo"><i></i>EyeCash</div><p>App bloccata. Sblocca con Face ID, impronta o il PIN del dispositivo.</p>
    <button class="btn pri" type="button" id="biobtn">Sblocca con Face ID</button>
    <button class="btn" type="button" id="biopw" style="margin-top:10px">Usa la password</button>
    <div class="err" id="lockerr">${esc(msg)}</div>`;
}
/** Unlocks with Face ID / Touch ID / Windows Hello. */
async function bioUnlock() {
  const b = $('#biobtn'),
    err = $('#lockerr');
  if (!b || b.disabled) return;
  b.disabled = true;
  if (err) err.textContent = '';
  try {
    if (await bioVerify()) {
      KEY = HELD;
      HELD = null;
      try {
        await openApp();
      } catch (e) {
        showLock('login', e.message);
      }
      return;
    }
    if (err) err.textContent = 'Verifica non riuscita. Riprova o usa la password.';
  } catch (e) {
    if (err) err.textContent = 'Non riuscito. Tocca di nuovo o usa la password.';
  }
  if ($('#biobtn')) $('#biobtn').disabled = false;
}
async function softLock() {
  // "soft" lock: data stays encrypted on the device, Face ID or password needed to come back
  if (!KEY || !bioOn() || !S || S.demo) return;
  try {
    await flushNow();
  } catch (e) {}
  HELD = KEY;
  KEY = null;
  hideBal();
  showBioLock();
}
document.addEventListener('click', e => {
  const t = e.target.closest && e.target.closest('#biobtn,#biopw');
  if (!t) return;
  if (t.id === 'biobtn') bioUnlock();
  else {
    HELD = null;
    showLock('login');
  }
});
/* ---------- Masked balances: Face ID or password needed to reveal them, once per session ---------- */
let balShown = false,
  balT = null,
  balFails = 0;
const balHidden = () => !!S && S.hideBal !== false && !balShown;
/** Blurs balances when the masked-balances mode is on. */
function applyBalMask() {
  document.body.classList.toggle('hidebal', balHidden());
  const b = $('#balbtn');
  if (b) {
    b.innerHTML = balHidden() ? EYE_OFF : EYE_ON;
    b.setAttribute('aria-label', balHidden() ? 'Mostra saldi' : 'Nascondi saldi');
  }
}
const EYE_ON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.8 0 3.3-.5 4.6-1.2"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
function hideBal() {
  balShown = false;
  clearTimeout(balT);
  applyBalMask();
}
async function checkPw(pw) {
  // local check: the derived key must decrypt something encrypted with the current key
  const { key } = await deriveKeys(pw);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, KEY, te.encode('poc'));
  try {
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return true;
  } catch (e) {
    return false;
  }
}
async function askBal() {
  if (bioOn()) {
    try {
      if (await bioVerify()) {
        balFails = 0;
        balShown = true;
        applyBalMask();
        toast('Saldi visibili');
        return;
      }
    } catch (e) {}
    toast('Face ID non riuscito: usa la password');
  }
  openForm(
    'Mostra saldi',
    [{ k: 'pw', label: 'Password', type: 'password', ph: "La password dell'app" }],
    async d => {
      toast('Verifica…');
      if (await checkPw(d.pw || '')) {
        balFails = 0;
        balShown = true;
        applyBalMask();
        clearTimeout(balT);
        toast("Saldi visibili fino alla chiusura dell'app");
      } else {
        balFails++;
        if (balFails >= 5) {
          balFails = 0;
          toast('Troppi tentativi: app bloccata');
          lockNow(false);
        } else {
          toast('Password errata');
          askBal();
        }
      }
    },
    null,
    '<p class="hint" style="line-height:1.6">Per sicurezza i saldi restano oscurati: la password viene verificata sul dispositivo e restano visibili finché l\'app è aperta (si nascondono se la chiudi o ne esci per più di 10 minuti).</p>'
  );
  const i = $('#frm input[name=pw]');
  if (i) {
    i.setAttribute('autocomplete', 'current-password');
    setTimeout(() => i.focus(), 50);
  }
}
/* ---------- Auto-lock and app-switcher curtain ---------- */
const AUTOLOCK_KEY = 'eyecash_autolock';
const AUTOLOCK_OPTIONS = [
  [0, 'Mai'],
  [1, '1 min'],
  [5, '5 min'],
  [15, '15 min'],
  [60, '1 ora']
];
/** Minutes away from the app after which it locks on this device (0 = never). */
function autoLockMin() {
  try {
    const v = localStorage.getItem(AUTOLOCK_KEY);
    return v === null ? (bioOn() ? BIO_LOCK_MIN : 0) : +v;
  } catch (e) {
    return 0;
  }
}
/** Locks after being away: with biometrics a soft lock, otherwise a full lock (password). */
function autoLock() {
  if (!KEY || !S || S.demo) return;
  if (bioOn()) softLock();
  else lockNow(false);
}
// "session": balances stay visible while the app is open; hidden again after more than
// 10 minutes away, when the app locks, or when the page is closed/reloaded.
// While the app is in the background its content is blurred, so the phone's app switcher
// and screen sharing never show balances.
let balAway = 0;
document.addEventListener('visibilitychange', () => {
  const hidden = document.visibilityState === 'hidden';
  document.body.classList.toggle('curtain', hidden);
  if (hidden) balAway = Date.now();
  else if (balAway) {
    const away = Date.now() - balAway;
    if (away > 10 * 60e3) hideBal();
    const lockMin = autoLockMin();
    if (lockMin && away > lockMin * 60e3) autoLock();
  }
});
window.addEventListener('pagehide', e => {
  if (!e.persisted) hideBal();
});
let toastT;
function toast(m) {
  const t = $('#toast');
  t.textContent = m;
  t.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('on'), 2200);
}
