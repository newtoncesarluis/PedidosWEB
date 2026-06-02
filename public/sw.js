// Service Worker — PedidosWeb PWA
const CACHE_NAME = 'pedidosweb-v2-__BUILD_ID__';
const STATIC = [
  '/login.html',
  '/home.html',
  '/mobile-shell.html',
  '/pages/pedidos.html',
  '/manifest.json',
  '/favicon.svg',
  '/assets/themes.css',
  '/assets/themes.js',
  '/assets/mobile-route.js',
  '/assets/mobile-app.js',
  '/assets/mobile-app.css',
  '/assets/pedidos-offline.js',
  '/assets/pedidos-offline-pack.js',
  '/assets/offline-db.js',
  '/assets/offline-sync.js',
  '/pages/ajuda-pedidos-offline.html',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(async (c) => {
      for (const path of STATIC) {
        try {
          await c.add(path);
        } catch (_) {
          /* arquivo opcional / servidor offline no install */
        }
      }
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' })))
  );
});

// ── Push notification ─────────────────────────────────────────────────────────
self.addEventListener('push', e => {
  let data = { title: 'SysPed WEB', body: 'Nova notificação', url: '/home.html' };
  try { data = { ...data, ...JSON.parse(e.data?.text() || '{}') }; } catch (_) {}
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/assets/icon-192.png',
      badge: '/assets/icon-192.png',
      data: { url: data.url },
      vibrate: [200, 100, 200],
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/home.html';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(url) && 'focus' in c);
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});

async function respondNetworkFirst(request, { cacheOk = true, offlineHtml = null } = {}) {
  try {
    const resp = await fetch(request);
    if (cacheOk && resp.ok) {
      const clone = resp.clone();
      caches.open(CACHE_NAME).then(c => c.put(request, clone)).catch(() => {});
    }
    return resp;
  } catch (_) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (offlineHtml) {
      return new Response(offlineHtml, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    return new Response('', { status: 503, statusText: 'Service Unavailable' });
  }
}

self.addEventListener('fetch', e => {
  try {
    if (e.request.method !== 'GET') return;

    const url = new URL(e.request.url);
    if (url.origin !== self.location.origin) return;

    // Páginas internas (iframe / abas): NUNCA interceptar
    if (url.pathname.startsWith('/pages/')) return;

    // Uploads: só rede
    if (url.pathname.startsWith('/uploads/')) return;

    const offlineShell =
      '<!doctype html><html><head><meta charset="utf-8"><title>Offline</title></head>' +
      '<body style="font-family:sans-serif;padding:40px;text-align:center">' +
      '<h2>Servidor indisponível</h2>' +
      '<p>Inicie o Node (SysRepWeb) e <a href="javascript:location.reload()">recarregue</a>.</p>' +
      '</body></html>';

    const safe = (p) =>
      Promise.resolve(p).catch(() => new Response('', { status: 503, statusText: 'Service Unavailable' }));

    if (url.pathname.startsWith('/api/')) {
      e.respondWith(
        safe(
          respondNetworkFirst(e.request, { cacheOk: false }).catch(() =>
            new Response(JSON.stringify({ error: 'offline', offline: true }), {
              status: 503,
              headers: { 'Content-Type': 'application/json' },
            })
          )
        )
      );
      return;
    }

    if (url.pathname.endsWith('.html') || url.pathname === '/') {
      e.respondWith(safe(respondNetworkFirst(e.request, { offlineHtml: offlineShell })));
      return;
    }

    e.respondWith(safe(respondNetworkFirst(e.request)));
  } catch (_) {
    /* sem respondWith: navegador trata o pedido */
  }
});
