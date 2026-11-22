/*
 * EyeCash · public/js/sync.js
 *
 * Talking to the server and keeping data encrypted.
 * - `api()` is the only way the client calls the server.
 * - The password is stretched with PBKDF2 into two keys: one proves who you are to
 *   the server, the other (AES-GCM, never sent) encrypts the whole state.
 * - `save()`/`flush()` upload the encrypted state with optimistic versioning; on a
 *   conflict `mergeStates()` does a three-way merge so no device loses changes.
 */
/* ---------- server, encryption, sync ---------- */
/** Calls the server API. Throws an error with `.status`; switches to offline mode on network failure. */
async function api(method, url, body) {
  if (OFFLINE && url !== '/api/status') throw offErr();
  let r;
  try {
    r = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { 'X-PointofCash': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      ...(url === '/api/status' ? { signal: AbortSignal.timeout(7000) } : {})
    });
  } catch (e) {
    if (url !== '/api/status' && S && KEY) goOffline();
    throw offErr();
  }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && !/login|setup/.test(url)) {
    showLock('login', 'Sessione scaduta: inserisci di nuovo la password.');
  }
  if (!r.ok) throw Object.assign(new Error(j.error || 'Errore ' + r.status), { status: r.status, data: j });
  return j;
}
/** Masks IBANs, card numbers and long digit runs before any text is sent to the AI. */
const anon = s =>
  String(s || '')
    .replace(/\bIT\s?\d{2}\s?[A-Z]\s?(?:[0-9A-Z]\s?){22}\b/gi, '[IBAN]')
    .replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g, '[IBAN]')
    .replace(/\d[\d ]{11,}\d/g, '[NUM]')
    .replace(/\*{2,}\d{2,4}/g, '[CARTA]');
const te = new TextEncoder(),
  td = new TextDecoder();
const b64 = u => {
  u = new Uint8Array(u);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
let KEY = null,
  STATUS = null;
/** Derives the login key and the encryption key from the password (PBKDF2-SHA256). */
async function deriveKeys(pw) {
  const base = await crypto.subtle.importKey('raw', te.encode(pw.normalize('NFKC')), 'PBKDF2', false, [
    'deriveBits'
  ]);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: unb64(STATUS.kdf_salt), iterations: STATUS.kdf_iter },
      base,
      512
    )
  );
  const authKey = Array.from(bits.slice(0, 32), b => b.toString(16).padStart(2, '0')).join('');
  const key = await crypto.subtle.importKey('raw', bits.slice(32), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt'
  ]);
  bits.fill(0);
  return { authKey, key };
}
/** Encrypts the state (AES-GCM, random IV) into the blob stored on the server. */
// The plaintext is padded with spaces to a multiple of 16 KB before encryption, so the
// stored size shows only a rough bucket instead of every change. JSON.parse ignores them.
const PAD_BYTES = 16384;
function padded(bytes) {
  const out = new Uint8Array(Math.ceil((bytes.length + 1) / PAD_BYTES) * PAD_BYTES).fill(32);
  out.set(bytes);
  return out;
}
async function encState(str) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    KEY,
    padded(te.encode(str || JSON.stringify(S)))
  );
  return JSON.stringify({ v: 1, iv: b64(iv), ct: b64(ct) });
}
/** Decrypts a blob produced by `encState`. */
async function decState(blob) {
  const o = JSON.parse(blob);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv) }, KEY, unb64(o.ct));
  return JSON.parse(td.decode(pt));
}
/* key remembered on the device: a NON-extractable CryptoKey in IndexedDB */
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('pointofcash', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('k');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGetK(n) {
  try {
    const d = await idb();
    return await new Promise(res => {
      const q = d.transaction('k').objectStore('k').get(n);
      q.onsuccess = () => res(q.result || null);
      q.onerror = () => res(null);
    });
  } catch (e) {
    return null;
  }
}
async function idbSetK(n, v) {
  try {
    const d = await idb();
    await new Promise(res => {
      const t = d.transaction('k', 'readwrite');
      v ? t.objectStore('k').put(v, n) : t.objectStore('k').delete(n);
      t.oncomplete = res;
      t.onerror = res;
    });
  } catch (e) {}
}
const idbGet = () => idbGetK('key'),
  idbSet = v => idbSetK('key', v);

let saveT = null,
  saving = false,
  dirty = false,
  BASE = null;
/* three-way merge: base (last synced version), remote, local */
/** Three-way merge of base, remote and local states (by record id) after a sync conflict. */
function mergeStates(B, R, L) {
  const out = JSON.parse(JSON.stringify(R));
  for (const k of [
    'tx',
    'recurring',
    'holdings',
    'goals',
    'accounts',
    'assets',
    'debts',
    'zainetto',
    'trades',
    'askHist'
  ]) {
    const b = new Map((B[k] || []).map(x => [x.id, JSON.stringify(x)])),
      l = new Map((L[k] || []).map(x => [x.id, x])),
      r = new Map((out[k] || []).map(x => [x.id, x]));
    for (const [id, x] of l) {
      const bx = b.get(id);
      if (bx === undefined || bx !== JSON.stringify(x)) r.set(id, x);
    }
    for (const id of b.keys()) if (!l.has(id)) r.delete(id);
    out[k] = [...r.values()];
  }
  if (!out.accounts.length) out.accounts = L.accounts && L.accounts.length ? L.accounts : R.accounts;
  for (const k of ['budgets', 'rules', 'templates', 'privacy', 'trMap']) {
    const b = B[k] || {},
      l = L[k] || {},
      o = (out[k] = out[k] || {});
    for (const key of new Set([...Object.keys(b), ...Object.keys(l)])) {
      if (JSON.stringify(l[key]) !== JSON.stringify(b[key])) {
        if (l[key] === undefined) delete o[key];
        else o[key] = l[key];
      }
    }
  }
  for (const k of ['target', 'fire', 'afford'])
    if (JSON.stringify(L[k]) !== JSON.stringify(B[k])) out[k] = L[k];
  out.aiLog = [...(L.aiLog || []), ...(out.aiLog || [])]
    .filter((x, i, a) => a.findIndex(y => y.t === x.t && y.k === x.k) === i)
    .sort((a, b) => b.t - a.t)
    .slice(0, 50);
  out.inboxSeen = [...new Set([...(out.inboxSeen || []), ...(L.inboxSeen || [])])].slice(-500);
  for (const k of ['inboxPriv', 'inboxPub']) if (!out[k] && L[k]) out[k] = L[k];
  out.demo = false;
  return out;
}
/** Marks the state as changed and schedules an encrypted upload. */
function save() {
  S.updated = Date.now();
  dirty = true;
  if (S.demo) return;
  clearTimeout(saveT);
  if (OFFLINE) {
    saveT = setTimeout(pendSave, 300);
    renderSync();
    return;
  }
  saveT = setTimeout(flush, 500);
}
/** Uploads the encrypted state now (optimistic versioning, merge on conflict). */
async function flush() {
  if (saving || !KEY) {
    if (saving) saveT = setTimeout(flush, 400);
    return;
  }
  if (!S || S.demo) {
    dirty = false;
    return;
  }
  saving = true;
  dirty = false;
  setSync('saving');
  let again = false;
  try {
    const snap = JSON.stringify(S);
    const blob = await encState(snap);
    const r = await api('PUT', '/api/state', { blob, ver: VER });
    VER = r.ver;
    BASE = snap;
    lastSaved = new Date();
    setSync('ok');
    offSave(blob, r.ver).then(() => (dirty ? null : idbSetK('pend', null)));
    if (!S.inboxPriv && !S.demo) setTimeout(() => ensureInboxKey().catch(() => {}), 0);
  } catch (e) {
    if (e.status === 409) {
      try {
        const B = BASE ? JSON.parse(BASE) : emptyState();
        const r = await api('GET', '/api/state');
        const R = r.blob ? await decState(r.blob) : emptyState();
        VER = r.ver;
        BASE = JSON.stringify(R);
        S = mergeStates(B, R, S);
        again = true;
        render();
        toast('Modifiche unite con quelle di un altro dispositivo');
      } catch (e2) {
        setSync('errore');
        dirty = true;
        saveT = setTimeout(flush, 8000);
      }
    } else if (e.offline) {
      dirty = true;
      setSync('offline');
      await pendSave();
    } else {
      setSync('errore');
      dirty = true;
      if (e.status !== 401) saveT = setTimeout(flush, 8000);
    }
  }
  saving = false;
  if (again) {
    dirty = true;
    await flush();
  }
}
async function flushNow() {
  for (let i = 0; i < 100 && saving; i++) await new Promise(r => setTimeout(r, 100));
  if (dirty) await flush();
}
/** Downloads and decrypts the latest state from the server. */
async function pull(force) {
  const r = await api('GET', '/api/state');
  if (!force && r.ver === VER) return;
  if (r.blob) {
    S = await decState(r.blob);
    VER = r.ver;
    offSave(r.blob, r.ver);
  } else {
    S = emptyState();
    VER = 0;
  }
  BASE = JSON.stringify(S);
  normState();
  if (processRecurring()) save();
  render();
}
function normState() {
  S.templates = S.templates || {};
  S.rules = S.rules || {};
  S.privacy = { ...PRIV_DEF, ...(S.privacy || {}) };
  S.aiLog = S.aiLog || [];
  S.assets = S.assets || [];
  S.debts = S.debts || [];
  S.zainetto = S.zainetto || [];
  S.trades = S.trades || [];
  S.trMap = S.trMap || {};
  S.askHist = S.askHist || [];
}
function setSync(s) {
  sync = s;
  renderSync();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && KEY && !dirty && !saving && !OFFLINE)
    pull(false)
      .then(pullInbox)
      .then(autoQuotes)
      .catch(() => {});
});
window.addEventListener('pagehide', () => {
  if (dirty && KEY && !S.demo) flush();
});
