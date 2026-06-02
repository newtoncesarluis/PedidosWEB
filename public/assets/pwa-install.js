/**
 * SysRepWeb — Banner de instalação PWA
 * Exibe prompt persistente até o usuário instalar o app.
 * Suporte: Chrome/Edge (beforeinstallprompt) + iOS (instruções manuais).
 */
(function () {
  'use strict';

  var LS_KEY = 'sysrep_pwa_dismiss';
  var DISMISS_HOURS = 12;

  function isStandalone() {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
    if (window.navigator.standalone === true) return true;
    if (document.referrer.includes('android-app://')) return true;
    if (new URLSearchParams(window.location.search).get('pwa') === '1' &&
        window.matchMedia('(display-mode: standalone)').matches) return true;
    return false;
  }

  if (isStandalone()) return;
  if (window.top !== window.self) return;

  var dismissed = null;
  try { dismissed = localStorage.getItem(LS_KEY); } catch (_) {}
  if (dismissed) {
    var ts = parseInt(dismissed, 10);
    if (!isNaN(ts) && (Date.now() - ts) < DISMISS_HOURS * 3600000) return;
  }

  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  var deferredPrompt = null;
  var banner = null;

  function injectStyles() {
    var s = document.createElement('style');
    s.textContent = [
      '#pwa-install-banner{',
      '  position:fixed;bottom:0;left:0;right:0;z-index:99999;',
      '  display:flex;align-items:center;gap:14px;',
      '  padding:14px 18px;margin:12px;border-radius:16px;',
      '  background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);',
      '  color:#f1f5f9;font-family:Inter,system-ui,sans-serif;',
      '  box-shadow:0 8px 32px rgba(0,0,0,.35);',
      '  animation:pwa-slide-up .35s ease;',
      '  max-width:520px;',
      '}',
      '@media(min-width:600px){#pwa-install-banner{left:50%;right:auto;transform:translateX(-50%);}}',
      '#pwa-install-banner .pwa-icon{',
      '  flex:0 0 44px;width:44px;height:44px;border-radius:12px;',
      '  background:#0ea5e9;display:flex;align-items:center;justify-content:center;',
      '}',
      '#pwa-install-banner .pwa-icon svg{width:24px;height:24px;color:#fff;}',
      '#pwa-install-banner .pwa-body{flex:1;min-width:0;}',
      '#pwa-install-banner .pwa-title{font-size:14px;font-weight:700;margin-bottom:2px;}',
      '#pwa-install-banner .pwa-desc{font-size:12px;opacity:.75;line-height:1.3;}',
      '#pwa-install-banner .pwa-actions{display:flex;gap:8px;flex-shrink:0;}',
      '#pwa-install-banner .pwa-btn{',
      '  border:none;border-radius:10px;padding:8px 16px;font-size:12px;',
      '  font-weight:700;cursor:pointer;transition:.15s;white-space:nowrap;',
      '}',
      '#pwa-install-banner .pwa-btn-install{background:#0ea5e9;color:#fff;}',
      '#pwa-install-banner .pwa-btn-install:active{transform:scale(.95);}',
      '#pwa-install-banner .pwa-btn-later{background:rgba(255,255,255,.1);color:#94a3b8;}',
      '#pwa-install-banner .pwa-btn-later:active{transform:scale(.95);}',
      '@keyframes pwa-slide-up{from{transform:translateY(100px);opacity:0}to{transform:translateY(0);opacity:1}}',
      '@media(min-width:600px){',
      '  @keyframes pwa-slide-up{from{transform:translateX(-50%) translateY(100px);opacity:0}to{transform:translateX(-50%) translateY(0);opacity:1}}',
      '}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function buildBanner(iosMode) {
    injectStyles();
    var el = document.createElement('div');
    el.id = 'pwa-install-banner';
    el.setAttribute('role', 'alert');

    var desc = iosMode
      ? 'Toque em <b>Compartilhar</b> <span style="font-size:16px">⎋</span> e depois <b>"Adicionar à Tela de Início"</b>'
      : 'Instale o app para acesso rápido e experiência completa';

    el.innerHTML =
      '<div class="pwa-icon">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M12 5v14M5 12l7-7 7 7"/>' +
          '<rect x="3" y="17" width="18" height="4" rx="1" fill="currentColor" stroke="none" opacity=".3"/>' +
        '</svg>' +
      '</div>' +
      '<div class="pwa-body">' +
        '<div class="pwa-title">Instalar PedidosWeb</div>' +
        '<div class="pwa-desc">' + desc + '</div>' +
      '</div>' +
      '<div class="pwa-actions">' +
        (iosMode ? '' : '<button class="pwa-btn pwa-btn-install" id="pwa-btn-install">Instalar</button>') +
        '<button class="pwa-btn pwa-btn-later" id="pwa-btn-later">Depois</button>' +
      '</div>';

    document.body.appendChild(el);
    banner = el;

    document.getElementById('pwa-btn-later').addEventListener('click', dismiss);

    if (!iosMode) {
      document.getElementById('pwa-btn-install').addEventListener('click', function () {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(function (choice) {
          if (choice.outcome === 'accepted') {
            removeBanner();
            try { localStorage.removeItem(LS_KEY); } catch (_) {}
          }
          deferredPrompt = null;
        });
      });
    }
  }

  function dismiss() {
    try { localStorage.setItem(LS_KEY, String(Date.now())); } catch (_) {}
    removeBanner();
  }

  function removeBanner() {
    if (banner && banner.parentNode) {
      banner.style.transition = 'transform .25s ease, opacity .25s ease';
      banner.style.transform = 'translateY(120px)';
      banner.style.opacity = '0';
      setTimeout(function () { if (banner.parentNode) banner.parentNode.removeChild(banner); }, 300);
    }
  }

  function show() {
    if (banner) return;
    if (isStandalone()) return;
    buildBanner(false);
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    setTimeout(show, 2500);
  });

  window.addEventListener('appinstalled', function () {
    removeBanner();
    try { localStorage.removeItem(LS_KEY); } catch (_) {}
  });

  if (isIOS) {
    setTimeout(function () {
      if (isStandalone()) return;
      if (banner) return;
      buildBanner(true);
    }, 3000);
  }
})();
