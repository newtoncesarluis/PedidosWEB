/**
 * UX vendedor — mobile-shell (busca global, offline, PWA, navegação legada)
 */
(function () {
  'use strict';

  var searchDebounce = null;

  function token() {
    return sessionStorage.getItem('token') || localStorage.getItem('token') || '';
  }

  function openPage(url, label) {
    if (typeof window.openUrl === 'function') {
      window.openUrl(url, label || 'SysRep');
      return;
    }
    window.location.href = url;
  }

  function initGlobalSearch() {
    var btn = document.getElementById('ms-btn-search');
    var overlay = document.getElementById('ms-search-overlay');
    var input = document.getElementById('ms-search-input');
    var results = document.getElementById('ms-search-results');
    if (!btn || !overlay || !input || !results) return;

    function close() {
      overlay.classList.remove('open');
      overlay.setAttribute('aria-hidden', 'true');
      input.value = '';
      results.innerHTML = '';
    }

    function open() {
      overlay.classList.add('open');
      overlay.setAttribute('aria-hidden', 'false');
      setTimeout(function () { input.focus(); }, 40);
    }

    btn.addEventListener('click', open);
    document.getElementById('ms-search-close')?.addEventListener('click', close);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });

    function renderEmpty(msg) {
      results.innerHTML = '<div class="ms-search-empty">' + msg + '</div>';
    }

    function row(icon, title, sub, onClick) {
      var el = document.createElement('button');
      el.type = 'button';
      el.className = 'ms-search-row';
      el.innerHTML =
        '<span class="ms-search-row-ico">' + icon + '</span>' +
        '<span class="ms-search-row-text"><strong>' + title + '</strong><small>' + sub + '</small></span>';
      el.addEventListener('click', function () {
        close();
        onClick();
      });
      return el;
    }

    async function runSearch(q) {
      var term = (q || '').trim();
      if (term.length < 2) {
        renderEmpty('Digite ao menos 2 caracteres (cliente ou nº do pedido).');
        return;
      }
      renderEmpty('Buscando…');
      var tkn = token();
      if (!tkn) {
        renderEmpty('Faça login novamente.');
        return;
      }
      var frag = document.createDocumentFragment();
      var found = 0;

      try {
        var rC = await fetch('/api/clientes?q=' + encodeURIComponent(term) + '&status=A&limit=12', {
          headers: { Authorization: 'Bearer ' + tkn }
        });
        if (rC.ok) {
          var dC = await rC.json();
          var list = dC.clientes || dC.rows || dC || [];
          if (!Array.isArray(list)) list = [];
          list.slice(0, 8).forEach(function (c) {
            found++;
            frag.appendChild(row('👤', c.nome || c.apelido || 'Cliente', [
              c.cidade, c.uf
            ].filter(Boolean).join('/') || 'Cliente ativo', function () {
              openPage('/pages/clientes.html?id=' + c.id, c.nome || 'Cliente');
            }));
          });
        }
      } catch (_) {}

      if (/^\d+$/.test(term)) {
        try {
          var rP = await fetch('/api/pedidos?page=1&limit=8&q=' + encodeURIComponent(term), {
            headers: { Authorization: 'Bearer ' + tkn }
          });
          if (rP.ok) {
            var dP = await rP.json();
            var pedidos = dP.pedidos || dP.rows || [];
            pedidos.slice(0, 5).forEach(function (p) {
              found++;
              var num = p.numero || p.id;
              frag.appendChild(row('📦', 'Pedido #' + num, (p.nome_cliente || '').slice(0, 48) || 'Abrir pedido', function () {
                openPage('/pages/pedidos.html?id=' + (p.id || num), 'Pedido #' + num);
              }));
            });
          }
        } catch (_) {}
      }

      results.innerHTML = '';
      if (!found) {
        renderEmpty('Nenhum cliente ou pedido encontrado.');
        return;
      }
      results.appendChild(frag);
    }

    input.addEventListener('input', function () {
      clearTimeout(searchDebounce);
      var v = input.value;
      searchDebounce = setTimeout(function () { runSearch(v); }, 320);
    });
  }

  function initOfflineHint() {
    var banner = document.getElementById('ms-pack-hint');
    if (!banner || !window.SysRepPedidosOfflinePack) return;

    function refresh() {
      var tkn = token();
      var uid = SysRepPedidosOfflinePack.userIdFromToken(tkn);
      var until = uid ? SysRepPedidosOfflinePack.getOfflineUntil(uid) : 0;
      var needs = !until || until < Date.now();
      var dismissed = false;
      try {
        dismissed = sessionStorage.getItem('ms_pack_hint_dismiss') === '1';
      } catch (_) {}
      if (needs && !dismissed) {
        banner.classList.add('show');
        document.body.classList.add('has-pack-hint');
      } else {
        banner.classList.remove('show');
        document.body.classList.remove('has-pack-hint');
      }
    }

    document.getElementById('ms-pack-hint-go')?.addEventListener('click', function () {
      document.getElementById('ms-btn-preparar-offline')?.click();
    });
    document.getElementById('ms-pack-hint-dismiss')?.addEventListener('click', function () {
      try { sessionStorage.setItem('ms_pack_hint_dismiss', '1'); } catch (_) {}
      banner.classList.remove('show');
      document.body.classList.remove('has-pack-hint');
    });

    refresh();
    window.addEventListener('online', refresh);
    setInterval(refresh, 60000);
  }

  function initPwaLoginCount() {
    var key = 'sysrep_mobile_logins';
    var n = 0;
    try { n = parseInt(localStorage.getItem(key) || '0', 10) || 0; } catch (_) {}
    n += 1;
    try { localStorage.setItem(key, String(n)); } catch (_) {}
    if (n >= 2 && typeof window.sysrepShowPwaBanner === 'function') {
      setTimeout(window.sysrepShowPwaBanner, 2500);
    }
  }

  function initVitrineSheet() {
    var btn = document.getElementById('ms-sheet-vitrine');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (typeof window._fecharSheet === 'function') window._fecharSheet();
      openPage('/pages/clientes.html?vitrine=1', 'Vitrine');
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initGlobalSearch();
    initOfflineHint();
    initPwaLoginCount();
    initVitrineSheet();
  });
})();
