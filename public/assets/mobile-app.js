/**
 * Marca o documento quando a tela roda no app mobile-shell (iframe) ou com ?_ms=
 * NÃO marca iframes do home.html / abas desktop — só mobile-shell.
 */
(function () {
  'use strict';

  function isMobileShellEmbed() {
    try {
      if (new URLSearchParams(window.location.search).has('_ms')) return true;
    } catch (_) {}
    try {
      if (window.self !== window.top) {
        var parentPath = window.parent.location.pathname || '';
        return parentPath.indexOf('mobile-shell') >= 0;
      }
    } catch (_) {
      try {
        return new URLSearchParams(window.location.search).has('_ms');
      } catch (_) {}
    }
    return false;
  }

  window.sysrep = window.sysrep || {};
  window.sysrep.isMobileShellEmbed = isMobileShellEmbed;

  function isHomeEmbed() {
    try {
      if (window.self === window.top) return false;
      var parentPath = window.parent.location.pathname || '';
      return parentPath === '/' || parentPath.endsWith('/home.html');
    } catch (_) {
      return false;
    }
  }

  window.sysrep.isHomeEmbed = isHomeEmbed;

  /** Documento onde o modal está renderizado (iframe ou home.html pai). */
  window.sysrep.modalDoc = function (modalId) {
    try {
      if (isHomeEmbed()) {
        var pel = window.parent.document.getElementById(modalId);
        if (pel) return window.parent.document;
      }
    } catch (_) {}
    return document;
  };

  /**
   * Move modal para o body do home.html — centralização correta fora do iframe.
   * cssText: regras CSS necessárias no documento pai.
   */
  window.sysrep.teleportModalToHome = function (modalEl, styleId, cssText) {
    if (!isHomeEmbed() || !modalEl) return false;
    try {
      var pdoc = window.parent.document;
      if (styleId && cssText && !pdoc.getElementById(styleId)) {
        var st = pdoc.createElement('style');
        st.id = styleId;
        st.textContent = cssText;
        pdoc.head.appendChild(st);
      }
      if (modalEl.dataset.sysrepHomeTeleported === '1') return true;
      var ph = document.createComment('sysrep-ph-' + (modalEl.id || 'modal'));
      if (modalEl.parentNode) modalEl.parentNode.replaceChild(ph, modalEl);
      modalEl._sysrepPlaceholder = ph;
      modalEl.dataset.sysrepHomeTeleported = '1';
      pdoc.body.appendChild(modalEl);
      pdoc.body.style.overflow = 'hidden';
      return true;
    } catch (_) {
      return false;
    }
  };

  window.sysrep.restoreModalFromHome = function (modalEl) {
    if (!modalEl || modalEl.dataset.sysrepHomeTeleported !== '1') return;
    try {
      var ph = modalEl._sysrepPlaceholder;
      if (ph && ph.parentNode) ph.parentNode.replaceChild(modalEl, ph);
      else document.body.appendChild(modalEl);
      delete modalEl.dataset.sysrepHomeTeleported;
      delete modalEl._sysrepPlaceholder;
      var pdoc = window.parent.document;
      if (!pdoc.querySelector('[data-sysrep-home-teleported="1"]')) {
        pdoc.body.style.overflow = '';
      }
    } catch (_) {}
  };

  if (isMobileShellEmbed()) {
    document.documentElement.classList.add('sysrep-ms-embed');
  }
  if (isHomeEmbed()) {
    document.documentElement.classList.add('sysrep-home-embed');
  }
})();

/* ── Funcionalidades exclusivas do iframe mobile-shell ── */
if (window.self !== window.top) {
  (function () {
    'use strict';

    /* Pull-to-refresh: apenas o mobile-shell.html controla (evita reload duplo do iframe). */

    /* 2. Swipe-to-reveal em cards
       Uso: sysrep.initSwipeReveal(containerEl)
       O container deve ter cards com a estrutura:
         <div class="swipe-wrap">
           <div class="swipe-inner">…conteúdo…</div>
           <div class="swipe-action">…botão de ação…</div>
         </div>                                           */
    window.sysrep = window.sysrep || {};

    window.sysrep.initSwipeReveal = function (containerEl) {
      if (!containerEl) return;

      var activeWrap = null;
      var startX = 0, startY = 0, currentX = 0, dirLocked = null;

      function getInner(wrap) { return wrap && wrap.querySelector('.swipe-inner'); }
      function getAction(wrap) { return wrap && wrap.querySelector('.swipe-action'); }

      function snapBack(wrap) {
        var inner = getInner(wrap);
        if (!inner) return;
        inner.style.transition = 'transform .25s cubic-bezier(.22,1,.36,1)';
        inner.style.transform  = 'translateX(0)';
        wrap._swipeOpen = false;
      }

      function snapOpen(wrap) {
        var inner  = getInner(wrap);
        var action = getAction(wrap);
        if (!inner || !action) return;
        var w = action.offsetWidth || 90;
        inner.style.transition = 'transform .25s cubic-bezier(.22,1,.36,1)';
        inner.style.transform  = 'translateX(-' + w + 'px)';
        wrap._swipeOpen = true;
      }

      containerEl.addEventListener('touchstart', function (e) {
        var wrap = e.target.closest('.swipe-wrap');
        // Fecha qualquer card aberto que não seja este
        if (activeWrap && activeWrap !== wrap && activeWrap._swipeOpen) snapBack(activeWrap);
        if (!wrap || !getAction(wrap)) { activeWrap = null; return; }
        activeWrap = wrap;
        startX    = e.touches[0].clientX;
        startY    = e.touches[0].clientY;
        currentX  = startX;
        dirLocked = null;
        getInner(wrap).style.transition = 'none';
      }, { passive: true });

      containerEl.addEventListener('touchmove', function (e) {
        if (!activeWrap) return;
        currentX = e.touches[0].clientX;
        var dx = currentX - startX;
        var dy = e.touches[0].clientY - startY;

        if (dirLocked === null) {
          dirLocked = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
        }
        if (dirLocked !== 'h') return;

        var action = getAction(activeWrap);
        var w = action ? (action.offsetWidth || 90) : 90;
        var inner = getInner(activeWrap);
        if (!inner) return;

        var base  = activeWrap._swipeOpen ? -w : 0;
        var total = Math.min(0, Math.max(-(w + 10), base + dx));
        inner.style.transform = 'translateX(' + total + 'px)';
      }, { passive: true });

      containerEl.addEventListener('touchend', function () {
        if (!activeWrap) return;
        var dx = currentX - startX;
        var action = getAction(activeWrap);
        var w = action ? (action.offsetWidth || 90) : 90;

        if (activeWrap._swipeOpen) {
          if (dx > w * 0.4) snapBack(activeWrap);
          else snapOpen(activeWrap);
        } else {
          if (-dx > w * 0.45) snapOpen(activeWrap);
          else snapBack(activeWrap);
        }
      }, { passive: true });

      // Fecha ao tocar fora
      document.addEventListener('touchstart', function (e) {
        if (activeWrap && activeWrap._swipeOpen && !activeWrap.contains(e.target)) {
          snapBack(activeWrap);
        }
      }, { passive: true });
    };

  })();
}

/* ── Mobile: reduz barra de autofill do sistema (senha/cartão/local) acima do teclado ── */
(function () {
  'use strict';

  var SKIP_MATCH =
    '#loginusu, #senhausu, [data-allow-autofill], ' +
    'input[type="hidden"], input[type="file"], input[type="checkbox"], input[type="radio"], ' +
    'input[type="submit"], input[type="button"], input[type="reset"], input[type="range"], input[type="color"]';

  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function isMobileContext() {
    if (document.documentElement.classList.contains('sysrep-ms-embed')) return true;
    try {
      if (window.self !== window.top) return true;
    } catch (_) {
      return true;
    }
    return !!(window.matchMedia && window.matchMedia('(max-width: 899px)').matches);
  }

  function shouldSkip(el) {
    if (!el || el.nodeType !== 1) return true;
    if (el.matches(SKIP_MATCH)) return true;
    if (el.closest('[data-allow-autofill], #form_login')) return true;
    return el.id === 'loginusu' || el.id === 'senhausu';
  }

  function unlockReadonly(el) {
    if (el && el.hasAttribute('readonly')) el.removeAttribute('readonly');
  }

  function hardenField(el) {
    if (shouldSkip(el)) return;
    if (el.dataset.sysrepAutofillHardened === '1') return;
    el.dataset.sysrepAutofillHardened = '1';

    el.setAttribute('autocomplete', 'off');
    el.setAttribute('autocorrect', 'off');
    el.setAttribute('autocapitalize', 'off');
    el.setAttribute('spellcheck', 'false');

    if (el.tagName === 'SELECT') return;

    var type = (el.type || 'text').toLowerCase();

    if (type === 'email') {
      el.type = 'text';
      el.setAttribute('inputmode', 'email');
      type = 'text';
    } else if (type === 'tel') {
      el.setAttribute('inputmode', 'tel');
    } else if (type === 'password') {
      el.setAttribute('autocomplete', 'new-password');
    }

    if (!isIOS || el.disabled || el.readOnly) return;

    var textLike = el.tagName === 'TEXTAREA' ||
      type === 'text' || type === 'search' || type === 'number' || type === 'tel' || type === 'url';

    if (!textLike) return;

    el.setAttribute('readonly', 'readonly');
    el.addEventListener('touchstart', function () { unlockReadonly(el); }, { passive: true, once: true });
    el.addEventListener('focus', function () { unlockReadonly(el); }, { once: true });
  }

  function hardenRoot(root) {
    if (!isMobileContext()) return;
    root = root || document;

    root.querySelectorAll('form').forEach(function (form) {
      if (form.closest('#form_login') || form.dataset.allowAutofill === '1') return;
      if (form.querySelector('#loginusu')) return;
      form.setAttribute('autocomplete', 'off');
    });

    root.querySelectorAll('input, textarea, select').forEach(hardenField);
  }

  function injectMeta() {
    if (!isMobileContext()) return;
    if (document.querySelector('meta[name="format-detection"]')) return;
    var meta = document.createElement('meta');
    meta.name = 'format-detection';
    meta.content = 'telephone=no, address=no, email=no';
    document.head.appendChild(meta);
  }

  function initAutofillGuard() {
    if (!isMobileContext()) return;
    injectMeta();
    hardenRoot(document);

    if (!document.body) return;

    var obs = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (node.nodeType !== 1) return;
          if (node.matches && node.matches('input, textarea, select, form')) {
            if (node.matches('form')) {
              if (!node.closest('#form_login') && node.dataset.allowAutofill !== '1' && !node.querySelector('#loginusu')) {
                node.setAttribute('autocomplete', 'off');
              }
            } else {
              hardenField(node);
            }
          }
          if (node.querySelectorAll) hardenRoot(node);
        });
      });
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAutofillGuard);
  } else {
    initAutofillGuard();
  }

  window.sysrep = window.sysrep || {};
  window.sysrep.hardenAutofill = hardenRoot;
})();

/** Pedidos — rodapé da lista em uma linha (funciona mesmo com pedidos.html em cache). */
(function () {
  'use strict';

  if ((location.pathname || '').indexOf('/pages/pedidos.html') < 0) return;

  var STYLE_ID = 'sysrep-pedidos-footer-layout';
  var CSS = [
    '@media (min-width:769px){',
    '#listSection>.pagination-footer,#listSection>#pedidosPaginationFooter.pagination-footer{display:flex!important;flex-direction:column!important;padding:7px 12px!important;}',
    '#listSection .pagination-footer-row{display:flex!important;flex-direction:row!important;flex-wrap:nowrap!important;align-items:center!important;gap:10px!important;width:100%!important;min-width:0!important;}',
    '#listSection .pagination-footer .pag-info-text{flex:0 0 auto!important;width:auto!important;}',
    '#listSection #statusStripSlot{flex:1 1 auto!important;min-width:0!important;overflow-x:auto!important;overflow-y:hidden!important;}',
    '#listSection .pagination-footer .pag-controls{display:inline-flex!important;flex:0 0 auto!important;flex-wrap:nowrap!important;width:auto!important;min-width:max-content!important;align-items:center!important;gap:6px!important;}',
    '#listSection .pagination-footer .pag-numbers{display:inline-flex!important;flex:0 0 auto!important;flex-wrap:nowrap!important;}',
    '#listSection .pagination-footer .pag-select{flex:0 0 auto!important;width:auto!important;}',
    '#syncTimestampFooter,.pag-sync-ts{display:none!important;}',
    '}'
  ].join('');

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  function ensureFooterRow() {
    var footer = document.getElementById('pedidosPaginationFooter')
      || document.querySelector('#listSection .pagination-footer');
    if (!footer) return null;

    var sync = document.getElementById('syncTimestampFooter');
    if (sync) sync.remove();

    var row = footer.querySelector('.pagination-footer-row');
    if (!row) {
      row = document.createElement('div');
      row.className = 'pagination-footer-row';
      while (footer.firstChild) row.appendChild(footer.firstChild);
      footer.appendChild(row);
    }
    return footer;
  }

  function enforceLayout() {
    if (!window.matchMedia('(min-width:769px)').matches) return;
    var footer = ensureFooterRow();
    if (!footer || footer.style.display === 'none') return;

    var row = footer.querySelector('.pagination-footer-row') || footer;
    row.style.setProperty('display', 'flex', 'important');
    row.style.setProperty('flex-direction', 'row', 'important');
    row.style.setProperty('flex-wrap', 'nowrap', 'important');
    row.style.setProperty('align-items', 'center', 'important');
    row.style.setProperty('width', '100%', 'important');

    var slot = document.getElementById('statusStripSlot');
    if (slot) {
      slot.style.setProperty('flex', '1 1 auto', 'important');
      slot.style.setProperty('min-width', '0', 'important');
      slot.style.setProperty('overflow-x', 'auto', 'important');
    }

    var ctrl = footer.querySelector('.pag-controls');
    if (ctrl) {
      ctrl.style.setProperty('display', 'inline-flex', 'important');
      ctrl.style.setProperty('flex', '0 0 auto', 'important');
      ctrl.style.setProperty('flex-wrap', 'nowrap', 'important');
      ctrl.style.setProperty('width', 'auto', 'important');
      ctrl.style.setProperty('min-width', 'max-content', 'important');
    }

    var info = document.getElementById('pag-info-text');
    if (info) info.style.setProperty('flex', '0 0 auto', 'important');
  }

  function boot() {
    injectStyle();
    ensureFooterRow();
    enforceLayout();
  }

  function watchFooter() {
    var footer = document.querySelector('#listSection .pagination-footer');
    if (!footer || typeof MutationObserver === 'undefined') return;
    var obs = new MutationObserver(function () {
      ensureFooterRow();
      enforceLayout();
    });
    obs.observe(footer, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    var slot = document.getElementById('statusStripSlot');
    if (slot) obs.observe(slot, { childList: true, subtree: true });
    var nums = document.getElementById('pag-numbers');
    if (nums) obs.observe(nums, { childList: true, subtree: true });
  }

  function init() {
    boot();
    watchFooter();
    window.addEventListener('resize', enforceLayout, { passive: true });
    var n = 0;
    var tick = function () {
      enforceLayout();
      if (++n < 40) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.sysrep = window.sysrep || {};
  window.sysrep.enforcePedidosFooterLayout = enforceLayout;
})();
