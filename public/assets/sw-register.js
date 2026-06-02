/**
 * Registro do Service Worker — em localhost remove SW antigo (evita tela branca em /pages/).
 */
(function () {
  'use strict';

  const IS_LOCAL = /^(localhost|127\.0\.0\.1)$/i.test(location.hostname);

  async function clearAppCaches() {
    if (!('caches' in window)) return;
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('pedidosweb-')).map((k) => caches.delete(k)));
  }

  async function unregisterAll() {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  }

  window.sysrepIsLocalDev = function () {
    return IS_LOCAL;
  };

  window.sysrepInitServiceWorker = async function () {
    if (!('serviceWorker' in navigator)) return null;

    await unregisterAll();

    if (IS_LOCAL) {
      await clearAppCaches();
      return null;
    }

    const reg = await navigator.serviceWorker.register('/sw-v3.js', { updateViaCache: 'none' });
    try {
      await reg.update();
    } catch (_) {}
    return reg;
  };

  window.sysrepAttachSwReload = function (onReload) {
    if (IS_LOCAL || typeof onReload !== 'function') return;
    navigator.serviceWorker.addEventListener('controllerchange', onReload);
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'SW_UPDATED') onReload();
    });
  };
})();
