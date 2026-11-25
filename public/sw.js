/* EyeCash – service worker: keeps a copy of the app (not of the data) so it opens without network.
   Data stays in the browser database, encrypted with your password: it never passes through here. */
const CACHE = 'eyecash-shell-v7';
const SHELL = [
  '/',
  '/js/i18n.js',
  '/js/i18n-en.js',
  '/js/core.js',
  '/js/ui.js',
  '/js/state.js',
  '/js/sync.js',
  '/js/lock.js',
  '/js/finance.js',
  '/js/fire.js',
  '/js/afford.js',
  '/js/quotes.js',
  '/js/invest.js',
  '/js/history.js',
  '/js/views.js',
  '/js/settings.js',
  '/js/report.js',
  '/js/ai.js',
  '/js/advisor.js',
  '/js/forms.js',
  '/js/import.js',
  '/js/offline.js',
  '/js/events.js',
  '/js/main.js',
  '/engine.js',
  '/manifest.webmanifest?v=5',
  '/icon.svg?v=5',
  '/apple-touch-icon.png?v=5',
  '/icon-192.png?v=5',
  '/icon-512.png?v=5',
  '/logo.svg',
  '/fonts/inter-400.woff',
  '/fonts/inter-500.woff',
  '/fonts/inter-600.woff',
  '/fonts/inter-700.woff',
  '/fonts/inter-display-700.woff',
  '/fonts/inter-display-800.woff'
];
self.addEventListener('install', e => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches
      .keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  const req = e.request,
    url = new URL(req.url);
  if (
    req.method !== 'GET' ||
    url.origin !== location.origin ||
    url.pathname.startsWith('/api/') ||
    url.pathname === '/mcp'
  )
    return;
  const key = req.mode === 'navigate' ? '/' : req;
  e.respondWith(
    (async () => {
      const c = await caches.open(CACHE);
      try {
        // network first (so updates arrive immediately), then the cached copy
        const ctl = new AbortController(),
          t = setTimeout(() => ctl.abort(), 6000);
        const r = await fetch(req, { signal: ctl.signal });
        clearTimeout(t);
        if (r.ok && r.type === 'basic') c.put(key, r.clone());
        return r;
      } catch (err) {
        const hit = (await c.match(key)) || (await c.match(key, { ignoreSearch: true }));
        return hit || Response.error();
      }
    })()
  );
});
