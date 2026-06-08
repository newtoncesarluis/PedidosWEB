// Service Worker — PedidosWeb PWA
const CACHE_NAME = 'pedidosweb-v2-__BUILD_ID__';

const MOBILE_PAGES = [
  '/pages/pedidos.html',
  '/pages/clientes.html',
  '/pages/mapa-clientes.html',
  '/pages/mapa-operacoes.html',
  '/pages/visitas.html',
  '/pages/comercial-dashboards.html',
  '/pages/comercial-relatorios-padrao.html',
  '/pages/ajuda-pedidos-offline.html',
];

const STATIC = [
  '/login.html',
  '/home.html',
  '/mobile-shell.html',
  '/manifest.json',
  '/favicon.svg',
  '/assets/themes.css',
  '/assets/themes.js',
  '/assets/mobile-route.js',
  '/assets/mobile-app.js',
  '/assets/mobile-app.css',
  '/assets/mobile-vendedor.js',
  '/assets/mobile-client-log.js',
  '/assets/pedidos-offline.js',
  '/assets/pedidos-offline-pack.js',
  '/assets/offline-db.js',
  '/assets/offline-sync.js',
  '/assets/feirinha-calc.js',
  '/assets/preco-peso-produto.js',
  '/assets/comissao-preposto-ui.js',
  '/assets/ajuda-tour.css',
  '/assets/ajuda-tour.js',
  '/assets/ajuda-tours.js',
  '/assets/icon-192.png',
  '/vendor/leaflet/leaflet.css',
  '/vendor/leaflet/leaflet.js',
  ...MOBILE_PAGES,
];

const APP_SHELL = new Set(
  STATIC.filter((p) => p.endsWith('.html')).map((p) => p)
);

const OFFLINE_HTML =
  '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Sem conexão</title></head>' +
  '<body style="font-family:system-ui,sans-serif;padding:32px 20px;text-align:center;color:#19324d">' +
  '<h2 style="margin:0 0 12px">Sem conexão</h2>' +
  '<p style="line-height:1.5;color:#4b5563">Conecte-se uma vez, abra o app e toque em <strong>Mais → Preparar offline</strong>. ' +
  'Depois feche o app e abra de novo pelo ícone.</p>' +
  '<p style="margin-top:20px"><a href="javascript:location.reload()" style="color:#2563eb">Tentar novamente</a></p>' +
  '</body></html>';

function pathnameOnly(url) {
  return url.origin + url.pathname;
}

function cachePutPathname(pathnameUrl, response) {
  return caches.open(CACHE_NAME).then((c) => c.put(pathnameUrl, response)).catch(() => {});
}

async function matchCached(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const bare = new Request(pathnameOnly(new URL(request.url)));
  const bareHit = await caches.match(bare);
  if (bareHit) return bareHit;
  const keys = await caches.keys();
  for (let i = keys.length - 1; i >= 0; i--) {
    const k = keys[i];
    if (!k.startsWith('pedidosweb-')) continue;
    const c = await caches.open(k);
    let m = await c.match(request, { ignoreSearch: true });
    if (!m) m = await c.match(bare);
    if (m) return m;
  }
  return null;
}

async function fetchWithTimeout(request, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms || 3500);
  try {
    return await fetch(request, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function respondAsset(request) {
  const cached = await matchCached(request);
  try {
    const resp = await fetchWithTimeout(request, 3500);
    if (resp.ok) {
      cachePutPathname(pathnameOnly(new URL(request.url)), resp.clone());
    }
    return resp;
  } catch (_) {
    if (cached) return cached;
    return new Response('', { status: 503, statusText: 'Service Unavailable' });
  }
}

/** Telas HTML: cache-first (ignora ?query) — essencial para iframe ?_ms= e ?novo=1 */
async function respondAppShell(request, offlineHtml) {
  const cached = await matchCached(request);
  const url = new URL(request.url);
  const pathname = url.pathname;
  const isShell = APP_SHELL.has(pathname) || pathname.endsWith('.html');

  if (cached && isShell) {
    fetchWithTimeout(request, 3500).then((resp) => {
      if (resp && resp.ok) cachePutPathname(pathnameOnly(url), resp.clone());
    }).catch(() => {});
    return cached;
  }

  try {
    const resp = await fetchWithTimeout(request, 3500);
    if (resp.ok && isShell) {
      cachePutPathname(pathnameOnly(url), resp.clone());
    }
    return resp;
  } catch (_) {
    const again = await matchCached(request);
    if (again) return again;
    if (offlineHtml && isShell) {
      return new Response(offlineHtml, {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    return new Response('', { status: 503, statusText: 'Service Unavailable' });
  }
}

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
    (async () => {
      const newCache = await caches.open(CACHE_NAME);
      const newKeys = await newCache.keys();
      const newHasContent = newKeys.length > 0;
      const allKeys = await caches.keys();
      await Promise.all(allKeys.filter((k) => {
        if (k === CACHE_NAME) return false;
        if (!newHasContent && k.startsWith('pedidosweb-')) return false;
        return true;
      }).map((k) => caches.delete(k)));
      await self.clients.claim();
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((c) => c.postMessage({ type: 'SW_UPDATED' }));
    })()
  );
});

self.addEventListener('message', e => {
  const data = e.data || {};
  if (data.type === 'CACHE_URLS' && Array.isArray(data.urls) && data.urls.length) {
    e.waitUntil(
      caches.open(CACHE_NAME).then(c =>
        Promise.all(data.urls.map(u => c.add(u).catch(() => {})))
      )
    );
  }
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

self.addEventListener('fetch', e => {
  try {
    if (e.request.method !== 'GET') return;

    const url = new URL(e.request.url);
    if (url.origin !== self.location.origin) return;

    if (url.pathname.startsWith('/uploads/')) return;

    const safe = (p) =>
      Promise.resolve(p).catch(() => new Response('', { status: 503, statusText: 'Service Unavailable' }));

    if (url.pathname.startsWith('/api/')) {
      e.respondWith(
        safe((async () => {
          if (self.navigator && self.navigator.onLine === false) {
            return new Response(JSON.stringify({ error: 'offline', offline: true }), {
              status: 503,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          try {
            return await fetchWithTimeout(e.request, 3500);
          } catch (_) {
            return new Response(JSON.stringify({ error: 'offline', offline: true }), {
              status: 503,
              headers: { 'Content-Type': 'application/json' },
            });
          }
        })())
      );
      return;
    }

    const isHtml = url.pathname.endsWith('.html') || url.pathname === '/';

    if (isHtml) {
      e.respondWith(safe(respondAppShell(e.request, OFFLINE_HTML)));
      return;
    }

    e.respondWith(safe(respondAsset(e.request)));
  } catch (_) {
    /* sem respondWith: navegador trata o pedido */
  }
});
