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

    // SW DESATIVADO (produção e local). O Service Worker estava devolvendo "offline"
    // falso (navigator.onLine não-confiável no contexto do SW logo após reativação),
    // o que cortava /api/modulos, /api/dashboard etc. e quebrava a home em todos os DNS.
    // Sem SW a página usa a rede direto — igual ao ambiente local, que sempre funcionou.
    // Reabilitar só depois de reescrever o SW com pass-through real para /api/*.
    try {
      const hadController = !!navigator.serviceWorker.controller;
      await unregisterAll();
      await clearAppCaches();
      // A página atual ainda está sob o SW antigo neste load: recarrega 1x (sem SW agora).
      if (hadController && !sessionStorage.getItem('sw_killed_reload')) {
        sessionStorage.setItem('sw_killed_reload', '1');
        location.reload();
      }
    } catch (_) {}
    return null;
  };

  window.sysrepAttachSwReload = function (onReload) {
    if (IS_LOCAL || typeof onReload !== 'function') return;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      onReload();
    });
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'SW_UPDATED') {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        onReload();
      }
    });
  };
})();
