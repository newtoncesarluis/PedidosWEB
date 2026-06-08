/**
 * Guard de acesso às telas de cadastro (tela_* → gtela_* no JWT) + CRUD (incluir/alterar/excluir).
 * Incluir antes do script principal: <script src="/assets/cadastros-permissao.js"></script>
 */
(function () {
  const PAGE_GTELA = {
    '/pages/clientes.html': { key: 'gtela_clientes', label: 'Clientes' },
    '/pages/transportadoras.html': { key: 'gtela_transportadoras', label: 'Transportadoras' },
    '/pages/comercial-promocoes.html': { key: 'gtela_promocoes', label: 'Promoções de Produtos' },
    '/pages/comercial-feirinha.html': { key: 'gtela_feirinha', label: 'Campanhas Feirinha' },
    '/pages/familia-produtos.html': { key: 'gtela_familia_produtos', label: 'Família de Produtos' },
    '/pages/grades.html': { key: 'gtela_grades', label: 'Grades' },
    '/pages/cores.html': { key: 'gtela_cores', label: 'Cores' },
    '/pages/tabela-precos.html': { key: 'gtela_tabela_precos', label: 'Tabela de Preços' },
    '/pages/importacao-precos.html': { key: 'gtela_importacao_precos', label: 'Importação de Preços' },
    '/pages/formas-pagamento.html': { key: 'gtela_formas_pagamento', label: 'Formas de Pagamento' },
    '/pages/bancos.html': { key: 'gtela_bancos', label: 'Bancos' },
    '/pages/despesas.html': { key: 'gtela_despesas', label: 'Despesas' },
    '/pages/segmentos.html': { key: 'gtela_segmentos', label: 'Segmento' },
    '/pages/regiao-rota.html': { key: 'gtela_regiao_rota', label: 'Regiões e Rotas' },
    '/pages/eventos-cidades.html': { key: 'gtela_eventos_cidades', label: 'Eventos / Cidades' },
    '/pages/importacao-clientes.html': { key: 'gtela_importacao_clientes', label: 'Importação de Clientes' },
    '/pages/importacao-fornecedores.html': { key: 'gtela_importacao_fornecedores', label: 'Importação de Fornecedores' },
    '/pages/campos-importacao.html': { key: 'gtela_campos_importacao', label: 'Configurar Campos de Importação' },
  };

  const PAGE_CRUD = {
    '/pages/transportadoras.html': { incluir: 'transportadora_incluir', alterar: 'transportadora_alterar', excluir: 'transportadora_excluir' },
    '/pages/familia-produtos.html': { incluir: 'incluir_familia_produtos', alterar: 'alterar_familia_produtos', excluir: 'excluir_familia_produtos' },
    '/pages/grades.html': { incluir: 'incluir_grades', alterar: 'alterar_grades', excluir: 'excluir_grades' },
    '/pages/cores.html': { incluir: 'incluir_cores', alterar: 'alterar_cores', excluir: 'excluir_cores' },
    '/pages/tabela-precos.html': { incluir: 'incluir_tabela_precos', alterar: 'alterar_tabela_precos', excluir: 'excluir_tabela_precos' },
    '/pages/formas-pagamento.html': { incluir: 'incluir_formas_pagamento', alterar: 'alterar_formas_pagamento', excluir: 'excluir_formas_pagamento' },
    '/pages/bancos.html': { incluir: 'incluir_bancos', alterar: 'alterar_bancos', excluir: 'excluir_bancos' },
    '/pages/despesas.html': { incluir: 'incluir_despesas', alterar: 'alterar_despesas', excluir: 'excluir_despesas' },
    '/pages/segmentos.html': { incluir: 'incluir_segmentos', alterar: 'alterar_segmentos', excluir: 'excluir_segmentos' },
    '/pages/regiao-rota.html': { incluir: 'incluir_regioes', alterar: 'alterar_regioes', excluir: 'excluir_regioes' },
    '/pages/eventos-cidades.html': { incluir: 'incluir_eventos_cidades', alterar: 'alterar_eventos_cidades', excluir: 'excluir_eventos_cidades' },
  };

  function token() {
    return sessionStorage.getItem('token') || localStorage.getItem('token') || '';
  }

  function parseJwt(t) {
    try {
      return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    } catch { return {}; }
  }

  function currentPath() {
    return (location.pathname || '').replace(/\\/g, '/');
  }

  function matchPage(map) {
    const path = currentPath();
    const key = Object.keys(map).find((p) => path.endsWith(p));
    return key ? map[key] : null;
  }

  function htmlRestrito(label) {
    return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;color:var(--text2,#6b7280);text-align:center;padding:20px">
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:64px;height:64px;margin-bottom:16px;opacity:0.5">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
      </svg>
      <h2 style="color:var(--text,#111827)">Acesso Restrito</h2>
      <p>Você não tem permissão para acessar ${label}.</p>
      <button class="btn btn-outline" style="margin-top:20px" onclick="window.parent.postMessage({type:'close-tab'}, '*')">Fechar Aba</button>
    </div>`;
  }

  function toastCadPerm(msg, tipo) {
    if (typeof toast === 'function') { toast(msg, tipo || 'err'); return; }
    if (typeof showToast === 'function') { showToast(msg, tipo === 'ok' ? 'success' : 'error'); return; }
    alert(msg);
  }

  async function guardCadastroTela() {
    const cfg = matchPage(PAGE_GTELA);
    if (!cfg) return true;

    const jwt = parseJwt(token());
    let perm = {};
    try { perm = JSON.parse(sessionStorage.getItem('user') || '{}').permissoes || {}; } catch {}
    if (jwt.permissoes) perm = { ...jwt.permissoes, ...perm };
    let isAdmin = jwt.perfil == 1 || jwt.role === 'admin';
    try {
      const r = await fetch('/api/auth/minhas-permissoes', { headers: { Authorization: 'Bearer ' + token() } });
      if (r.ok) {
        const d = await r.json();
        perm = { ...perm, ...d };
        if (d.isAdmin) isAdmin = true;
      }
    } catch {}

    window._cadPerm = perm;
    window._cadIsAdmin = isAdmin;
    window.permCadastro = function (k) {
      if (isAdmin) return 'S';
      return perm[k] || 'N';
    };

    initCadCrudPermissoes();

    if (!isAdmin && perm[cfg.key] !== 'S') {
      document.body.innerHTML = htmlRestrito(cfg.label);
      return false;
    }
    return true;
  }

  function initCadCrudPermissoes() {
    const crud = matchPage(PAGE_CRUD);
    window._cadCrud = crud || null;
    window.podeIncluirCad = function () {
      if (window._cadIsAdmin) return true;
      if (!crud) return true;
      return permCadastro(crud.incluir) === 'S';
    };
    window.podeAlterarCad = function () {
      if (window._cadIsAdmin) return true;
      if (!crud) return true;
      return permCadastro(crud.alterar) === 'S';
    };
    window.podeExcluirCad = function () {
      if (window._cadIsAdmin) return true;
      if (!crud) return true;
      return permCadastro(crud.excluir) === 'S';
    };
  }

  function guardCadIncluir(msg) {
    if (podeIncluirCad()) return true;
    toastCadPerm(msg || 'Sem permissão para incluir', 'err');
    return false;
  }

  function guardCadAlterar(msg) {
    if (podeAlterarCad()) return true;
    toastCadPerm(msg || 'Sem permissão para alterar', 'err');
    return false;
  }

  function guardCadExcluir(msg) {
    if (podeExcluirCad()) return true;
    toastCadPerm(msg || 'Sem permissão para excluir', 'err');
    return false;
  }

  function guardCadSalvar(isEdicao, msgIncluir, msgAlterar) {
    if (isEdicao) return guardCadAlterar(msgAlterar);
    return guardCadIncluir(msgIncluir);
  }

  function aplicarFormSomenteLeituraCad(root) {
    const el = root || document.getElementById('formSection') || document.getElementById('modalOverlay') || document.body;
    el.querySelectorAll('input:not([type=hidden]), select, textarea').forEach((inp) => {
      if (inp.type === 'checkbox' || inp.type === 'radio') inp.disabled = true;
      else { inp.readOnly = true; inp.disabled = inp.tagName === 'SELECT'; }
    });
    el.querySelectorAll('button.toggle-btn, .btn-nota, [onclick*="setNota"]').forEach((b) => { b.disabled = true; b.style.pointerEvents = 'none'; });
    const btnSalvar = document.getElementById('btnSalvar');
    if (btnSalvar) btnSalvar.style.display = 'none';
  }

  function aplicarUiPermissoesCad() {
    if (!window._cadCrud) return;
    const pi = podeIncluirCad();
    const pa = podeAlterarCad();
    const pe = podeExcluirCad();

    document.querySelectorAll(
      'button[onclick*="abrirNovo"], button[onclick*="abrirModal(null"], button[onclick*="abrirModal()"], button[onclick*="novoRegistro"], #btnNovaTabela, .btn-nova-tabela'
    ).forEach((btn) => {
      if (!pi) { btn.style.display = 'none'; btn.disabled = true; }
      else { btn.style.display = ''; btn.disabled = false; }
    });

    document.querySelectorAll(
      '[onclick*="excluir("], [onclick*="excluirAtual"], [onclick*="excluirLinha"], [onclick*="confirmarExclusao"], .btn-danger[onclick*="excluir"]'
    ).forEach((btn) => {
      if (!pe) { btn.style.display = 'none'; btn.disabled = true; }
    });

    const btnSalvar = document.getElementById('btnSalvar');
    if (btnSalvar && !pa && !pi) btnSalvar.style.display = 'none';

    document.body.dataset.cadAlterar = pa ? 'S' : 'N';
    document.body.dataset.cadIncluir = pi ? 'S' : 'N';
    document.body.dataset.cadExcluir = pe ? 'S' : 'N';
  }

  window.guardCadastroTela = guardCadastroTela;
  window.permCadastro = function (k) { return window._cadIsAdmin ? 'S' : ((window._cadPerm || {})[k] || 'N'); };
  window.guardCadIncluir = guardCadIncluir;
  window.guardCadAlterar = guardCadAlterar;
  window.guardCadExcluir = guardCadExcluir;
  window.guardCadSalvar = guardCadSalvar;
  window.aplicarUiPermissoesCad = aplicarUiPermissoesCad;
  window.aplicarFormSomenteLeituraCad = aplicarFormSomenteLeituraCad;

  async function bootCadPerm() {
    if (window._cadPermReady || window._cadPermBooting) return;
    window._cadPermBooting = true;
    const ok = await guardCadastroTela();
    if (!ok) { window._cadPermBooting = false; return; }
    window._cadPermReady = true;
    window._cadPermBooting = false;
    aplicarUiPermissoesCad();
    window.dispatchEvent(new CustomEvent('cad-perm-ready'));
    if (typeof buscar === 'function') { try { await buscar(); } catch {} aplicarUiPermissoesCad(); }
    else if (typeof carregar === 'function') { try { await carregar(); } catch {} aplicarUiPermissoesCad(); }
  }

  document.addEventListener('DOMContentLoaded', bootCadPerm);
  if (document.readyState !== 'loading') bootCadPerm();
})();
