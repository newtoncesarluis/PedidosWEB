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

    // Localhost: SW desativado (evita tela branca em /pages/ durante o dev).
    // Exceção p/ teste do fluxo offline: localStorage.setItem('sysrep_sw_test','1').
    let _swTest = false;
    try { _swTest = localStorage.getItem('sysrep_sw_test') === '1'; } catch (_) {}
    if (IS_LOCAL && !_swTest) {
      try {
        await unregisterAll();
        await clearAppCaches();
      } catch (_) {}
      return null;
    }

    // Produção: SW REATIVADO — necessário para o PWA abrir sem internet (cold-start
    // offline na rua). O sw.js atual faz pass-through real para /api/* (sempre tenta
    // a rede, 20s de timeout; nunca curto-circuita por navigator.onLine), que era o
    // pré-requisito para reabilitar após o incidente do "offline falso".
    // KILL-SWITCH: este arquivo é servido com no-store — para desativar de novo,
    // basta voltar este bloco para unregisterAll() + clearAppCaches() e fazer deploy.
    try {
      sessionStorage.removeItem('sw_killed_reload');
      return await navigator.serviceWorker.register('/sw.js');
    } catch (_) {
      return null;
    }
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
