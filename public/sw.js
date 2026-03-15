// Service Worker — SysRepWeb Mobile
const CACHE_NAME = 'sysrepweb-v1';
const ASSETS = [
  '/mobile.html',
  '/assets/themes.css',
  '/assets/themes.js',
];

// Instala e faz cache dos assets estáticos
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Ativa e limpa caches antigos
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Estratégia: Network first para API, Cache first para assets
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API: sempre tenta rede, sem cache
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ error: 'offline', offline: true }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Assets: cache first, fallback rede
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(resp => {
      // Cacheia respostas bem sucedidas de assets estáticos
      if (resp.ok && (url.pathname.endsWith('.html') || url.pathname.endsWith('.css') || url.pathname.endsWith('.js'))) {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      }
      return resp;
    }))
  );
});
