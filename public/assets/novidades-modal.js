/**
 * Modal interativo de novidades — exibe entradas de sistema_changelog não vistas pelo usuário.
 * Marca como visto em localStorage (por usuário + tenant).
 */
(function () {
  'use strict';

  var TIPO = {
    NOVO: { icon: '✨', label: 'Novidade' },
    MELHORIA: { icon: '⚡', label: 'Melhoria' },
    BUG: { icon: '🐛', label: 'Correção' },
  };

  var state = {
    itens: [],
    idx: 0,
    userId: '',
    tenant: '',
    open: false,
    pendingCount: 0,
  };

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtData(iso) {
    if (!iso) return '';
    var p = String(iso).substring(0, 10).split('-');
    if (p.length !== 3) return iso;
    return p[2] + '/' + p[1] + '/' + p[0];
  }

  function storageKey() {
    return 'SysRepNovidades_' + (state.tenant || 'default') + '_' + (state.userId || '0');
  }

  function readWatermark() {
    try {
      var raw = localStorage.getItem(storageKey());
      if (!raw) return { id: 0, date: '' };
      var o = JSON.parse(raw);
      return { id: +o.id || 0, date: o.date || '' };
    } catch (_) {
      return { id: 0, date: '' };
    }
  }

  function writeWatermark(maxId) {
    try {
      localStorage.setItem(storageKey(), JSON.stringify({
        id: maxId,
        date: new Date().toISOString().substring(0, 10),
      }));
    } catch (_) {}
    state.pendingCount = 0;
    updateBadge();
  }

  function daysAgoIso(n) {
    var d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().substring(0, 10);
  }

  function filterNovos(itens, wm) {
    if (!itens || !itens.length) return [];
    if (wm.id > 0) {
      return itens.filter(function (i) { return i.id > wm.id; });
    }
    var limite = daysAgoIso(14);
    return itens.filter(function (i) {
      return String(i.data_lancamento || '').substring(0, 10) >= limite;
    });
  }

  function wireModalEvents() {
    if (document.documentElement.dataset.novModalWired === '1') return;
    document.documentElement.dataset.novModalWired = '1';

    document.addEventListener('click', function (e) {
      if (!state.open) return;
      var closeBtn = e.target.closest('#nov-close, .nov-close');
      if (closeBtn) {
        e.preventDefault();
        e.stopPropagation();
        closeModal(true);
        return;
      }
      var bd = document.getElementById('nov-backdrop');
      if (bd && e.target === bd) closeModal(true);
    }, true);

    document.addEventListener('keydown', function (e) {
      if (!state.open) return;
      if (e.key === 'Escape') closeModal(true);
      if (e.key === 'ArrowRight') onNext();
      if (e.key === 'ArrowLeft') go(-1);
    });
  }

  function ensureDom() {
    if (document.getElementById('nov-backdrop')) {
      wireModalEvents();
      return;
    }

    if (!document.getElementById('nov-critical-css')) {
      var st = document.createElement('style');
      st.id = 'nov-critical-css';
      st.textContent =
        '#nov-backdrop{position:fixed;inset:0;z-index:100002;display:none;align-items:center;justify-content:center;padding:16px}' +
        '#nov-backdrop.is-open{display:flex!important}' +
        '#nov-backdrop[hidden]{display:none!important}' +
        '.nov-panel{width:min(560px,100%);max-height:min(88vh,720px);display:flex;flex-direction:column;border-radius:22px;overflow:hidden;background:var(--card-bg,#fff);color:var(--content-text,#0f172a)}' +
        '.nov-card{display:none}.nov-card.is-active{display:block}' +
        '.nov-close{position:absolute;top:14px;right:14px;z-index:5;pointer-events:auto}';
      document.head.appendChild(st);
    }

    var wrap = document.createElement('div');
    wrap.id = 'nov-backdrop';
    wrap.className = 'nov-backdrop';
    wrap.setAttribute('hidden', 'hidden');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:100002;display:none;align-items:center;justify-content:center;padding:16px';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'nov-title');
    wrap.innerHTML =
      '<div class="nov-panel">' +
        '<div class="nov-hero">' +
          '<button type="button" class="nov-close" id="nov-close" aria-label="Fechar">&times;</button>' +
          '<div class="nov-hero-kicker">Atualizações do sistema</div>' +
          '<h2 id="nov-title">O que há de novo</h2>' +
          '<p id="nov-sub">Melhorias e correções para você aproveitar no dia a dia.</p>' +
        '</div>' +
        '<div class="nov-progress" id="nov-progress"></div>' +
        '<div class="nov-body" id="nov-body"></div>' +
        '<div class="nov-foot">' +
          '<button type="button" class="nov-btn" id="nov-hist">Ver histórico</button>' +
          '<span class="nov-foot-spacer"></span>' +
          '<button type="button" class="nov-btn" id="nov-prev" style="display:none">Anterior</button>' +
          '<button type="button" class="nov-btn nov-btn-primary" id="nov-next">Próxima</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);

    var prevBtn = document.getElementById('nov-prev');
    var nextBtn = document.getElementById('nov-next');
    var histBtn = document.getElementById('nov-hist');
    if (prevBtn) prevBtn.addEventListener('click', function () { go(-1); });
    if (nextBtn) nextBtn.addEventListener('click', onNext);
    if (histBtn) histBtn.addEventListener('click', openHistorico);
    wireModalEvents();
  }

  function renderCard() {
    var body = document.getElementById('nov-body');
    var prog = document.getElementById('nov-progress');
    if (!body || !state.itens.length) return;

    body.innerHTML = state.itens.map(function (it, i) {
      var meta = TIPO[it.tipo] || TIPO.MELHORIA;
      return (
        '<article class="nov-card' + (i === state.idx ? ' is-active' : '') + '" data-idx="' + i + '">' +
          '<span class="nov-tag nov-tag-' + esc(it.tipo) + '">' + meta.icon + ' ' + meta.label + '</span>' +
          '<h3>' + esc(it.titulo) + '</h3>' +
          (it.descricao ? '<p>' + esc(it.descricao) + '</p>' : '') +
          '<div class="nov-meta">v' + esc(it.versao) + ' · ' + fmtData(it.data_lancamento) + '</div>' +
        '</article>'
      );
    }).join('');

    prog.innerHTML = state.itens.map(function (_, i) {
      return '<span class="nov-dot' + (i === state.idx ? ' is-active' : '') + '"></span>';
    }).join('');

    var sub = document.getElementById('nov-sub');
    if (sub) {
      sub.textContent = state.itens.length > 1
        ? (state.idx + 1) + ' de ' + state.itens.length + ' atualizações'
        : 'Uma nova atualização desde seu último acesso.';
    }

    var prev = document.getElementById('nov-prev');
    var next = document.getElementById('nov-next');
    if (prev) prev.style.display = state.idx > 0 ? '' : 'none';
    if (next) {
      next.textContent = state.idx < state.itens.length - 1 ? 'Próxima' : 'Entendi';
    }
  }

  function go(delta) {
    var n = state.idx + delta;
    if (n < 0 || n >= state.itens.length) return;
    state.idx = n;
    renderCard();
  }

  function onNext() {
    if (state.idx < state.itens.length - 1) {
      go(1);
      return;
    }
    finish();
  }

  function maxId() {
    return state.itens.reduce(function (m, it) { return Math.max(m, +it.id || 0); }, 0);
  }

  function finish() {
    writeWatermark(maxId());
    closeModal();
  }

  function openModal(itens) {
    if (!itens || !itens.length) return;
    ensureDom();
    state.itens = itens.slice().sort(function (a, b) { return (+a.id || 0) - (+b.id || 0); });
    state.idx = 0;
    state.open = true;
    renderCard();
    var bd = document.getElementById('nov-backdrop');
    if (bd) {
      bd.removeAttribute('hidden');
      bd.classList.add('is-open');
      bd.style.display = 'flex';
      document.body.classList.add('nov-modal-open');
      document.body.style.overflow = 'hidden';
    }
  }

  function closeModal(markSeen) {
    if (markSeen && typeof markSeen === 'object' && typeof markSeen.preventDefault === 'function') {
      markSeen = false;
    }
    state.open = false;
    var bd = document.getElementById('nov-backdrop');
    if (bd) {
      bd.classList.remove('is-open');
      bd.setAttribute('hidden', 'hidden');
      bd.style.removeProperty('display');
    }
    document.body.classList.remove('nov-modal-open');
    document.body.style.overflow = '';
    if (markSeen === true && state.itens.length) writeWatermark(maxId());
  }

  function openHistorico() {
    var page = '/pages/novidades.html';
    if (typeof window.openTab === 'function') {
      window.openTab(page, 'Novidades');
    } else if (window.parent && typeof window.parent.openTab === 'function') {
      window.parent.openTab(page, 'Novidades');
    } else {
      window.location.href = page;
    }
    closeModal();
  }

  function updateBadge() {
    var n = state.pendingCount;
    var dot = document.getElementById('sb-nov-badge');
    if (dot) dot.hidden = n <= 0;
    var ms = document.getElementById('ms-nov-badge');
    if (ms) {
      if (n > 0) {
        ms.textContent = n > 9 ? '9+' : String(n);
        ms.style.display = '';
      } else {
        ms.textContent = '';
        ms.style.display = 'none';
      }
    }
    var el = document.getElementById('home-version');
    if (!el) return;
    var verDot = el.parentElement && el.parentElement.querySelector('.nov-badge-dot:not(#sb-nov-badge)');
    if (n > 0) {
      if (!verDot) {
        verDot = document.createElement('span');
        verDot.className = 'nov-badge-dot';
        verDot.title = n + ' novidade(s) não vista(s)';
        if (el.parentElement) el.parentElement.appendChild(verDot);
      }
    } else if (verDot) {
      verDot.remove();
    }
  }

  function abrirNovidades(opts) {
    opts = opts || {};
    return fetchAll().then(function (all) {
      if (!all.length) {
        if (opts.alertEmpty) alert('Nenhuma novidade publicada ainda.');
        return all;
      }
      var wm = readWatermark();
      var novos = filterNovos(all, wm);
      var bag;
      if (opts.somenteNovas && novos.length) bag = novos;
      else if (opts.somenteNovas) bag = all.slice(0, Math.min(5, all.length));
      else bag = all;
      openModal(bag);
      return all;
    });
  }

  function wireAcessoNovidades() {
    var open = function (e) {
      if (e) e.preventDefault();
      abrirNovidades({ somenteNovas: false });
    };
    var sb = document.getElementById('btn-sb-novidades');
    if (sb && !sb.dataset.novWired) {
      sb.dataset.novWired = '1';
      sb.addEventListener('click', open);
    }
  }

  function wireVersionButton() {
    var el = document.getElementById('home-version');
    if (!el || el.dataset.novWired) return;
    el.dataset.novWired = '1';
    el.style.cursor = 'pointer';
    el.title = 'Ver novidades do sistema';
    var seg = el.closest('.sb-version');
    if (seg) {
      seg.style.cursor = 'pointer';
      seg.title = 'Ver novidades do sistema';
    }
    var open = function (e) {
      if (e) e.preventDefault();
      abrirNovidades({ somenteNovas: false });
    };
    el.addEventListener('click', function (e) {
      e.stopPropagation();
      open(e);
    });
    if (seg) seg.addEventListener('click', open);
  }

  function fetchAll() {
    return fetch('/api/changelog', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : { itens: [] }; })
      .then(function (d) { return d.itens || []; })
      .catch(function () { return []; });
  }

  function checkAndShow(opts) {
    opts = opts || {};
    state.userId = String(opts.userId || opts.idusuario || '0');
    state.tenant = String(opts.tenant || localStorage.getItem('sysrep_tenant') || localStorage.getItem('chave_licenca') || 'default');

    return fetchAll().then(function (all) {
      var wm = readWatermark();
      var novos = filterNovos(all, wm);
      state.pendingCount = novos.length;
      updateBadge();
      wireVersionButton();
      wireAcessoNovidades();

      if (opts.autoShow !== false && novos.length) {
        setTimeout(function () { openModal(novos); }, opts.delayMs || 900);
      }
      return novos;
    });
  }

  window.SysRepNovidadesInit = checkAndShow;
  window.SysRepNovidadesAbrir = function (opts) {
    return abrirNovidades(Object.assign({ somenteNovas: false }, opts || {}));
  };
})();
