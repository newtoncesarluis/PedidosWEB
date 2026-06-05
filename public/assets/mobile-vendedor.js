/**
 * UX vendedor — mobile-shell (busca global, offline, PWA, push, navegação)
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

  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(base64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function initPushSubscription() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    var tkn = token();
    if (!tkn) return;

    function registrar() {
      navigator.serviceWorker.ready.then(function (reg) {
        return reg.pushManager.getSubscription().then(function (sub) {
          if (sub) return sub;
          return fetch('/api/regiao-rota/rotas-vendedor/vapid-public', {
            headers: { Authorization: 'Bearer ' + tkn }
          }).then(function (r) {
            if (!r.ok) return null;
            return r.text();
          }).then(function (vapidKey) {
            if (!vapidKey || vapidKey.indexOf('{') >= 0) return null;
            return reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(vapidKey.trim())
            });
          });
        }).then(function (sub) {
          if (!sub) return;
          return fetch('/api/regiao-rota/rotas-vendedor/push-subscription', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + tkn, 'Content-Type': 'application/json' },
            body: JSON.stringify(sub)
          });
        });
      }).catch(function () {});
    }

    if (typeof window.sysrepInitServiceWorker === 'function') {
      window.sysrepInitServiceWorker().then(registrar).catch(registrar);
    } else {
      registrar();
    }
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
        renderEmpty('Digite ao menos 2 caracteres (cliente, pedido ou nº).');
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
      var headers = { Authorization: 'Bearer ' + tkn };

      try {
        var rC = await fetch('/api/clientes?q=' + encodeURIComponent(term) + '&status=A&limit=12', { headers: headers });
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

      try {
        var rP = await fetch('/api/pedidos?page=1&limit=8&q=' + encodeURIComponent(term), { headers: headers });
        if (rP.ok) {
          var dP = await rP.json();
          var pedidos = dP.pedidos || dP.rows || [];
          if (!Array.isArray(pedidos)) pedidos = [];
          pedidos.slice(0, 6).forEach(function (p) {
            found++;
            var num = p.numero || p.id;
            var sub = (p.nome_cliente || '').slice(0, 48) || 'Abrir pedido';
            frag.appendChild(row('📦', 'Pedido #' + num, sub, function () {
              openPage('/pages/pedidos.html?id=' + (p.id || num), 'Pedido #' + num);
            }));
          });
        }
      } catch (_) {}

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

  document.addEventListener('DOMContentLoaded', function () {
    initGlobalSearch();
    initOfflineHint();
    initPwaLoginCount();
    initPushSubscription();
  });
})();
