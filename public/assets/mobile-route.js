/**
 * SysRepWeb — roteamento automático mobile (viewport + UA + touch)
 * - Redireciona home → mobile-shell no celular
 * - Bloqueia páginas /pages/* fora da lista permitida (somente janela top)
 * - Exposto em window.SysRepMobile para login / botão “versão completa”
 */
(function () {
  'use strict';

  if (window.SysRepMobile) return;

  var LS_PREF = 'sysrep_mobile_desktop_pref';
  var MAX_NARROW_PX = 920;

  function prefersDesktop() {
    try { return localStorage.getItem(LS_PREF) === '1'; }
    catch (_) { return false; }
  }

  function setPrefersDesktop(on) {
    try {
      if (on) localStorage.setItem(LS_PREF, '1');
      else localStorage.removeItem(LS_PREF);
    } catch (_) {}
  }

  function isMobileUa() {
    var ua = navigator.userAgent || '';
    if (/Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return true;
    if (typeof navigator.platform === 'string' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true;
    return false;
  }

  function isNarrowViewport() {
    try {
      if (window.matchMedia('(max-width: ' + MAX_NARROW_PX + 'px)').matches) return true;
    } catch (_) {}
    return typeof window.innerWidth === 'number' && window.innerWidth <= MAX_NARROW_PX;
  }

  function isCoarseTablet() {
    try {
      if (!window.matchMedia('(pointer: coarse)').matches) return false;
      return typeof window.innerWidth === 'number' && window.innerWidth <= 1100;
    } catch (_) { return false; }
  }

  /** Fluxo touch-first: só se o usuário NÃO pediu “versão completa”. */
  function isMobileShellMode() {
    if (prefersDesktop()) return false;
    return isNarrowViewport() || isMobileUa() || isCoarseTablet();
  }

  /** Desktop com janela larga: pode sair do mobile-shell (não força em celular real). */
  function shouldLeaveMobileShell() {
    if (prefersDesktop()) return true;
    if (isMobileUa()) return false;
    return !isNarrowViewport();
  }

  var _viewportTimer = null;

  function onViewportChange() {
    if (window.top !== window.self) return;
    var p = pathnameOnly();
    if (shouldLeaveMobileShell()) {
      if (p === '/mobile-shell.html') {
        window.location.replace('/home.html?_=' + Date.now());
      }
      return;
    }
    enforceTopWindow();
  }

  function bindViewportListener() {
    function schedule() {
      clearTimeout(_viewportTimer);
      _viewportTimer = setTimeout(onViewportChange, 220);
    }
    try {
      var mql = window.matchMedia('(max-width: ' + MAX_NARROW_PX + 'px)');
      if (mql.addEventListener) mql.addEventListener('change', schedule);
      else if (mql.addListener) mql.addListener(schedule);
    } catch (_) {}
    window.addEventListener('resize', schedule, { passive: true });
    window.addEventListener('orientationchange', function () { setTimeout(onViewportChange, 320); });
  }

  function pathnameOnly() {
    var p = window.location.pathname || '/';
    p = p.replace(/\\/g, '/');
    if (!p.startsWith('/')) p = '/' + p;
    return p;
  }

  var ALLOW_TOP = {
    '/login.html': 1,
    '/setup.html': 1,
    '/mobile-shell.html': 1,
    '/home.html': 1,
    '/index.html': 1
  };

  var ALLOW_PAGES = {
    '/pages/clientes.html': 1,
    '/pages/pedidos.html': 1,
    '/pages/mapa-clientes.html': 1,
    '/pages/mapa-operacoes.html': 1,
    '/pages/visitas.html': 1,
    '/pages/comercial-dashboards.html': 1,
    '/pages/comercial-relatorios-padrao.html': 1,
    '/pages/consulta-precos.html': 1
  };

  function enforceTopWindow() {
    if (window.top !== window.self) return;
    var p = pathnameOnly();
    if (!isMobileShellMode()) return;
    if (p === '/login.html' || p === '/setup.html') return;
    if (p === '/mobile-shell.html') return;

    if (p === '/home.html') {
      window.location.replace('/mobile-shell.html' + (window.location.search || ''));
      return;
    }

    if (p.startsWith('/pages/')) {
      if (!ALLOW_PAGES[p]) {
        window.location.replace('/mobile-shell.html?blocked=1');
      }
      return;
    }

    if (!ALLOW_TOP[p] && /\.html$/i.test(p)) {
      window.location.replace('/mobile-shell.html?blocked=1');
    }
  }

  /** Após login: mobile → shell desktop → home */
  function postLoginTarget() {
    var suf = '?_=' + Date.now();
    return isMobileShellMode() ? ('/mobile-shell.html' + suf) : ('/home.html' + suf);
  }

  window.SysRepMobile = {
    prefersDesktop: prefersDesktop,
    setPrefersDesktop: setPrefersDesktop,
    isMobileShellMode: isMobileShellMode,
    shouldLeaveMobileShell: shouldLeaveMobileShell,
    postLoginTarget: postLoginTarget,
    allowedPages: Object.keys(ALLOW_PAGES),
    enforceTopWindow: enforceTopWindow
  };

  enforceTopWindow();
  bindViewportListener();
  onViewportChange();
})();
