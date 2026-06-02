/**
 * PedidosWeb — Transições de Página e Skeleton Loading
 * Inclua este script em qualquer tela que queira animações suaves.
 *
 * Uso básico:
 *   <script src="/assets/page-transitions.js"></script>
 *
 * Skeleton manual:
 *   PageTransitions.skeleton(containerEl, rows)  → exibe linhas skeleton
 *   PageTransitions.unskeleton(containerEl)       → remove skeleton
 */
(function () {
  'use strict';

  // ── Evita conflito de declaração se o script for carregado múltiplas vezes
  if (window.PageTransitions) return;

  // ── CSS injetado uma única vez ──────────────────────────────────────────────
  const CSS = `
    /* Fade-in ao carregar a página */
    @keyframes _ptFadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    .pt-page-enter { animation: _ptFadeIn .35s cubic-bezier(.23,1,.32,1) both; }

    /* Skeleton shimmer (complementa o que já existe em themes.css) */
    .pt-skeleton-row {
      display: flex; flex-direction: column; gap: 8px; padding: 0 4px;
    }
    .pt-sk-line {
      height: 14px; border-radius: 4px;
      background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
      background-size: 200% 100%;
      animation: _ptSkLoading 1.5s infinite;
    }
    html[data-theme="dark"] .pt-sk-line,
    html[data-theme="charcoal"] .pt-sk-line {
      background: linear-gradient(90deg, #2a2a2a 25%, #3a3a3a 50%, #2a2a2a 75%);
      background-size: 200% 100%;
    }
    @keyframes _ptSkLoading { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

    /* NProgress-style top bar */
    #_pt-bar {
      position: fixed; top: 0; left: 0; z-index: 99999;
      height: 3px; width: 0%; background: var(--accent, #0ea5e9);
      transition: width .4s ease, opacity .3s ease;
      box-shadow: 0 0 8px rgba(14,165,233,.6);
      pointer-events: none;
    }
    #_pt-bar.done { width: 100% !important; opacity: 0; }

    /* Overlay de carregamento global */
    #_pt-overlay {
      display: none; position: fixed; inset: 0; z-index: 9990;
      background: rgba(255,255,255,.6); backdrop-filter: blur(2px);
      align-items: center; justify-content: center;
    }
    html[data-theme="dark"] #_pt-overlay,
    html[data-theme="charcoal"] #_pt-overlay {
      background: rgba(0,0,0,.4);
    }
    #_pt-overlay.active { display: flex; }
    ._pt-spinner {
      width: 36px; height: 36px; border-radius: 50%;
      border: 3px solid rgba(14,165,233,.2);
      border-top-color: var(--accent, #0ea5e9);
      animation: _ptSpin .7s linear infinite;
    }
    @keyframes _ptSpin { to { transform: rotate(360deg); } }

    /* Toast de feedback */
    #_pt-toast-wrap {
      position: fixed; bottom: 24px; right: 24px; z-index: 99999;
      display: flex; flex-direction: column; gap: 8px; pointer-events: none;
    }
    ._pt-toast {
      padding: 10px 18px; border-radius: 10px; font-family: inherit;
      font-size: 13px; font-weight: 600; color: #fff;
      box-shadow: 0 4px 20px rgba(0,0,0,.2);
      animation: _ptToastIn .3s cubic-bezier(.23,1,.32,1);
      pointer-events: auto; cursor: pointer;
      max-width: 320px; line-height: 1.5;
    }
    @keyframes _ptToastIn { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: translateX(0); } }
    ._pt-toast.success { background: #16a34a; }
    ._pt-toast.error   { background: #dc2626; }
    ._pt-toast.info    { background: #0369a1; }
    ._pt-toast.warning { background: #d97706; }
  `;

  function injectCSS() {
    if (document.getElementById('_pt-css')) return;
    const s = document.createElement('style');
    s.id = '_pt-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function createProgressBar() {
    if (document.getElementById('_pt-bar') || !document.body) return;
    const bar = document.createElement('div');
    bar.id = '_pt-bar';
    document.body.appendChild(bar);
  }

  function createOverlay() {
    if (document.getElementById('_pt-overlay') || !document.body) return;
    const el = document.createElement('div');
    el.id = '_pt-overlay';
    el.innerHTML = '<div class="_pt-spinner"></div>';
    document.body.appendChild(el);
  }

  function createToastWrap() {
    if (document.getElementById('_pt-toast-wrap') || !document.body) return;
    const el = document.createElement('div');
    el.id = '_pt-toast-wrap';
    document.body.appendChild(el);
  }

  // ── Progress bar ──────────────────────────────────────────────────────────
  let _pct = 0, _ptTimer = null;

  function startProgress() {
    const bar = document.getElementById('_pt-bar');
    if (!bar) return;
    bar.classList.remove('done');
    _pct = 0;
    bar.style.opacity = '1';
    bar.style.width = '0%';
    clearInterval(_ptTimer);
    _ptTimer = setInterval(() => {
      _pct = _pct < 80 ? _pct + Math.random() * 12 : _pct + Math.random() * 2;
      if (_pct > 94) { _pct = 94; clearInterval(_ptTimer); }
      bar.style.width = _pct + '%';
    }, 200);
  }

  function doneProgress() {
    const bar = document.getElementById('_pt-bar');
    if (!bar) return;
    clearInterval(_ptTimer);
    bar.style.width = '100%';
    setTimeout(() => bar.classList.add('done'), 400);
  }

  // ── Overlay spinner ──────────────────────────────────────────────────────
  function showOverlay() {
    document.getElementById('_pt-overlay')?.classList.add('active');
  }
  function hideOverlay() {
    document.getElementById('_pt-overlay')?.classList.remove('active');
  }

  // ── Toast ────────────────────────────────────────────────────────────────
  function toast(msg, type, ms) {
    type = type || 'info';
    ms   = ms   || 3500;
    const wrap = document.getElementById('_pt-toast-wrap');
    if (!wrap) return;
    const el = document.createElement('div');
    el.className = '_pt-toast ' + type;
    el.textContent = msg;
    el.addEventListener('click', () => el.remove());
    wrap.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .3s, transform .3s';
      el.style.opacity = '0';
      el.style.transform = 'translateX(24px)';
      setTimeout(() => el.remove(), 320);
    }, ms);
  }

  // ── Skeleton rows ────────────────────────────────────────────────────────
  function skeleton(container, rows) {
    rows = rows || 5;
    if (!container) return;
    container.dataset.ptOriginal = container.innerHTML;
    const wrap = document.createElement('div');
    wrap.className = 'pt-skeleton-row';
    for (let i = 0; i < rows; i++) {
      const line = document.createElement('div');
      line.className = 'pt-sk-line';
      line.style.width = (55 + Math.random() * 45) + '%';
      wrap.appendChild(line);
    }
    container.innerHTML = '';
    container.appendChild(wrap);
  }

  function unskeleton(container) {
    if (!container) return;
    if (container.dataset.ptOriginal !== undefined) {
      container.innerHTML = container.dataset.ptOriginal;
      delete container.dataset.ptOriginal;
    }
  }

  // ── Auto-transição de links internos ─────────────────────────────────────
  function interceptLinks() {
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href]');
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('javascript')
        || href.startsWith('mailto') || href.startsWith('tel')
        || a.target === '_blank' || a.hasAttribute('data-no-transition')
        || e.ctrlKey || e.metaKey || e.shiftKey) return;
      // Apenas links internos da mesma origem
      try {
        const url = new URL(href, location.href);
        if (url.origin !== location.origin) return;
      } catch { return; }
      startProgress();
    });
    // Completa barra quando a nova página carrega
    window.addEventListener('pageshow', doneProgress);
  }

  // ── Fade-in automático do body ────────────────────────────────────────────
  function fadeInBody() {
    const main = document.querySelector('.content-area, main, #content, .page-content, body');
    if (main) main.classList.add('pt-page-enter');
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  function init() {
    if (!document.body) return;
    injectCSS();
    createProgressBar();
    createOverlay();
    createToastWrap();
    interceptLinks();
    // Fade-in da página atual
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        fadeInBody();
        doneProgress();
      });
    } else {
      fadeInBody();
      doneProgress();
    }
  }

  if (document.body) {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  }

  // ── API pública ───────────────────────────────────────────────────────────
  window.PageTransitions = {
    start:       startProgress,
    done:        doneProgress,
    showOverlay, hideOverlay,
    toast,
    skeleton,
    unskeleton,
  };

  // Aliases curtos globais (não conflitam — nomes únicos com prefixo PT)
  window.PTToast     = toast;
  window.PTOverlay   = { show: showOverlay, hide: hideOverlay };
  window.PTProgress  = { start: startProgress, done: doneProgress };

})();
