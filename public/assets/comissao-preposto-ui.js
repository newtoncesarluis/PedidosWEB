/**
 * Filtro de vendedor — preposto, representante e permissões (acessartodosclientes / gerente).
 */
(function (global) {
  function _parseJwtPayload() {
    try {
      const raw = localStorage.getItem('token')
        || sessionStorage.getItem('sysrep_token')
        || document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('token='))?.split('=').slice(1).join('=')
        || '';
      if (!raw) return null;
      return JSON.parse(atob(raw.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    } catch (_) {
      return null;
    }
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
      || permissoes.acessartodosclientes === 'S'
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
      : 'Sem permissão para consultar outros vendedores';

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

  global.ComissaoPrepostoUi = {
    readJwtComissao,
    canSelectOtherVendors,
    resolveVendedorFilterId,
    applyVendedorSelectLock,
    applyPrepostoVendedorSelect,
    populateVendedorSelect,
  };
  global.VendedorFiltroUi = global.ComissaoPrepostoUi;
})(window);
