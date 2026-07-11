/**
 * Filtro de vendedor — preposto, representante e permissões (acessar_vendastodos / gerente).
 */
(function (global) {
  function canAccessAllVendorsPerm(permissoes) {
    const v = permissoes.acessar_vendastodos;
    if (v === 'S') return true;
    if (v === 'N') return false;
    return permissoes.acessartodosclientes === 'S';
  }
  function readJwtComissao() {
    let tipo = 'REPRESENTANTE';
    let userId = null;
    let nome = '';
    let perfil = null;
    let role = '';
    let permissoes = {};
    const payload = _parseJwtPayload();
    if (payload) {
      tipo = payload.tipo_usuario || 'REPRESENTANTE';
      userId = payload.id || payload.idusuario || null;
      nome = payload.name || payload.nome || payload.nomeusu || '';
      perfil = payload.perfil;
      role = payload.role || '';
      permissoes = payload.permissoes || {};
    }
    try {
      const sess = JSON.parse(sessionStorage.getItem('user') || '{}');
      if (!nome) nome = sess.nome || sess.nomeusu || '';
      if (!userId) userId = sess.id || sess.idusuario || null;
      if (sess.permissoes && typeof sess.permissoes === 'object') {
        permissoes = { ...permissoes, ...sess.permissoes };
      }
    } catch (_) {}

    const isAdmin = role === 'admin' || perfil == 1;
    const canSelectOthers = isAdmin
      || canAccessAllVendorsPerm(permissoes)
      || permissoes.gerentecomercial === 'S';
    const isPreposto = tipo === 'PREPOSTO';
    const mustLockVendedorSelect = isPreposto || !canSelectOthers;

    return {
      tipo,
      userId,
      nome,
      perfil,
      role,
      permissoes,
      isAdmin,
      isPreposto,
      canSelectOthers,
      mustLockVendedorSelect,
    };
  }

  function canSelectOtherVendors(ctx) {
    const j = ctx || readJwtComissao();
    return !!j.canSelectOthers;
  }

  function resolveVendedorFilterId(selectEl, ctx) {
    const j = ctx || readJwtComissao();
    if (j.mustLockVendedorSelect && j.userId) return String(j.userId);
    if (!selectEl) return '';
    return selectEl.value || '';
  }

  /**
   * Trava combo no vendedor logado quando sem permissão (ou preposto).
   * opts: { wrapId, showWrap, removeEmptyOption }
   */
  function applyVendedorSelectLock(selectEl, opts) {
    const jwt = readJwtComissao();
    if (!selectEl) return jwt;

    if (opts && opts.wrapId) {
      const w = document.getElementById(opts.wrapId);
      if (w && (opts.showWrap !== false || jwt.mustLockVendedorSelect)) {
        w.style.display = '';
      }
    }

    if (!jwt.mustLockVendedorSelect) return jwt;

    const id = String(jwt.userId || '');
    if (!id) return jwt;

    if (opts && opts.removeEmptyOption !== false) {
      Array.from(selectEl.options).forEach(o => {
        if (o.value === '' || o.value === '0') o.remove();
      });
    }

    const hasOpt = Array.from(selectEl.options).some(o => String(o.value) === id);
    if (!hasOpt) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = jwt.nome || 'Eu';
      selectEl.appendChild(opt);
    }
    selectEl.value = id;
    selectEl.disabled = true;
    selectEl.title = jwt.isPreposto
      ? 'Preposto: extrato apenas do seu usuário'
      : 'Sem permissão para consultar vendas de outros vendedores';

    return jwt;
  }

  /** @deprecated use applyVendedorSelectLock */
  function applyPrepostoVendedorSelect(selectEl, opts) {
    return applyVendedorSelectLock(selectEl, opts);
  }

  /**
   * Popula select a partir de lista {id,nome|nome_vendedor} e aplica trava se necessário.
   */
  function populateVendedorSelect(selectEl, list, opts) {
    if (!selectEl) return readJwtComissao();
    const emptyLabel = (opts && opts.emptyLabel) != null ? opts.emptyLabel : 'Todos';
    const showEmpty = opts && opts.showEmpty === false ? false : true;
    let html = showEmpty ? `<option value="">${emptyLabel}</option>` : '';
    (list || []).forEach(v => {
      const nome = v.nome || v.nome_vendedor || v.nomeusu || ('#' + v.id);
      html += `<option value="${v.id}">${nome}</option>`;
    });
    selectEl.innerHTML = html;
    return applyVendedorSelectLock(selectEl, opts);
  }

  function authToken() {
    function readFrom(win) {
      try {
        const fromCookie = win.document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('token='));
        if (fromCookie) return decodeURIComponent(fromCookie.split('=').slice(1).join('='));
      } catch (_) {}
      try {
        return win.localStorage.getItem('token')
          || win.sessionStorage.getItem('token')
          || win.sessionStorage.getItem('sysrep_token')
          || '';
      } catch (_) {
        return '';
      }
    }
    let t = readFrom(global);
    if (!t) {
      try {
        if (global.top && global.top !== global) t = readFrom(global.top);
      } catch (_) {}
    }
    if (!t) {
      try {
        if (global.parent && global.parent !== global) t = readFrom(global.parent);
      } catch (_) {}
    }
    return t || '';
  }

  function _parseJwtPayload() {
    try {
      const raw = authToken();
      if (!raw) return null;
      return JSON.parse(atob(raw.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    } catch (_) {
      return null;
    }
  }

  async function apiFetch(url, opts = {}) {
    const token = authToken();
    const headers = { ...(opts.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (opts.body != null && !headers['Content-Type'] && !(opts.body instanceof FormData)) {
      if (opts.body instanceof URLSearchParams) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
      } else {
        headers['Content-Type'] = 'application/json';
      }
    }
    const r = await fetch(url, { ...opts, headers, credentials: 'include' });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401) {
      setTimeout(() => { (window.top || window).location.href = '/login.html'; }, 1200);
      throw new Error(data.error || 'Sessão expirada — faça login novamente');
    }
    if (!r.ok) throw new Error(data.error || `Erro ${r.status}`);
    return data;
  }

  global.ComissaoPrepostoUi = {
    authToken,
    apiFetch,
    readJwtComissao,
    canSelectOtherVendors,
    resolveVendedorFilterId,
    applyVendedorSelectLock,
    applyPrepostoVendedorSelect,
    populateVendedorSelect,
  };
  global.VendedorFiltroUi = global.ComissaoPrepostoUi;
})(window);
