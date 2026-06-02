/**
 * Marca o documento quando a tela roda dentro do mobile-shell (iframe) ou com ?_ms=
 * (mesmo parâmetro que o shell adiciona). CSS em mobile-app.css usa .sysrep-ms-embed.
 */
(function () {
  'use strict';
  try {
    if (window.self !== window.top) {
      document.documentElement.classList.add('sysrep-ms-embed');
      return;
    }
    if (new URLSearchParams(window.location.search).has('_ms')) {
      document.documentElement.classList.add('sysrep-ms-embed');
    }
  } catch (_) {
    if (window.self !== window.top) document.documentElement.classList.add('sysrep-ms-embed');
  }
})();

/* ── Funcionalidades exclusivas do iframe mobile-shell ── */
if (window.self !== window.top) {
  (function () {
    'use strict';

    /* 1. Pull-to-refresh
       Detecta arraste pra baixo quando a página já está no topo e envia postMessage ao shell. */
    var ptr_startY = 0, ptr_pulling = false, ptr_triggered = false;
    var PTR_THRESHOLD = 72;

    function _scrollTop() {
      return window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
    }

    document.addEventListener('touchstart', function (e) {
      ptr_startY    = e.touches[0].clientY;
      ptr_pulling   = _scrollTop() <= 2;
      ptr_triggered = false;
    }, { passive: true });

    document.addEventListener('touchmove', function (e) {
      if (!ptr_pulling || ptr_triggered) return;
      var dy = e.touches[0].clientY - ptr_startY;
      if (dy > PTR_THRESHOLD) {
        ptr_triggered = true;
        window.parent.postMessage({ type: 'ms-pull-refresh' }, '*');
      }
    }, { passive: true });

    document.addEventListener('touchend', function () {
      ptr_pulling = false;
    }, { passive: true });

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
