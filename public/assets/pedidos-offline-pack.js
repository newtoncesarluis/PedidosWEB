/**
 * Pacote offline para pedidos (v1 — pedido novo).
 * IndexedDB + interceptação de GETs usados no formulário.
 */
(function (global) {
  'use strict';

  const DB_NAME = 'sysrep_pedidos_offline_v1';
  const STORE = 'pack';
  const OFFLINE_DAYS = 7;

  let _packCache = null;
  let _packPromise = null;

  function token() {
    return sessionStorage.getItem('token') || localStorage.getItem('token') || '';
  }

  function decodeJwtPayload(t) {
    try {
      return JSON.parse(atob(t.split('.')[1]));
    } catch (_) {
      return null;
    }
  }

  function userIdFromToken(t) {
    const p = decodeJwtPayload(t);
    return p ? String(p.id || p.idusuario || '') : '';
  }

  function offlineUntilKey(uid) {
    return 'sysrep_offline_until_' + uid;
  }

  function setOfflineUntil(uid, days) {
    const until = Date.now() + (days || OFFLINE_DAYS) * 86400000;
    localStorage.setItem(offlineUntilKey(uid), String(until));
    return until;
  }

  function getOfflineUntil(uid) {
    const v = parseInt(localStorage.getItem(offlineUntilKey(uid)) || '0', 10);
    return Number.isFinite(v) ? v : 0;
  }

  function isTokenUsableOffline(t) {
    t = t || token();
    if (!t) return false;
    const uid = userIdFromToken(t);
    if (!uid) return false;
    const until = getOfflineUntil(uid);
    if (until > Date.now()) return true;
    const p = decodeJwtPayload(t);
    if (!p || !p.exp) return false;
    return p.exp * 1000 > Date.now();
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onerror = () => reject(req.error);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'userId' });
        }
      };
      req.onsuccess = () => resolve(req.result);
    });
  }

  async function savePack(pack) {
    const uid = String(pack.meta?.userId || userIdFromToken());
    if (!uid) throw new Error('Usuário não identificado');
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ userId: uid, pack, savedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    _packCache = pack;
    setOfflineUntil(uid, pack.meta?.offlineDays || OFFLINE_DAYS);
    db.close();
    updatePackBadge();
    return pack;
  }

  async function loadPack(force) {
    if (_packCache && !force) return _packCache;
    if (_packPromise && !force) return _packPromise;

    _packPromise = (async () => {
      const uid = userIdFromToken();
      if (!uid) return null;
      try {
        const db = await openDb();
        const row = await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, 'readonly');
          const req = tx.objectStore(STORE).get(uid);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
        });
        db.close();
        _packCache = row?.pack || null;
        return _packCache;
      } catch (_) {
        return null;
      } finally {
        _packPromise = null;
      }
    })();

    return _packPromise;
  }

  async function hasValidPack() {
    const p = await loadPack();
    if (!p) return false;
    const uid = userIdFromToken();
    return isTokenUsableOffline() && getOfflineUntil(uid) > Date.now() - 86400000;
  }

  function jsonResp(obj, status) {
    return Promise.resolve(new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json', 'X-Offline-Mock': '1' }
    }));
  }

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  }

  function searchClientes(pack, q, limit) {
    const qt = norm(q);
    const isNum = /^\d+$/.test(String(q || '').trim());
    let list = pack.clientes || [];
    if (qt) {
      list = list.filter(c => {
        const nome = norm(c.nome);
        const doc = norm(c.cpf_cnpj || c.cpf || c.cnpj);
        if (isNum && String(c.id) === String(q).trim()) return true;
        return nome.includes(qt) || doc.includes(qt);
      });
    }
    return list.slice(0, limit || 10).map(c => ({
      ...c,
      id: c.id,
      nome: c.nome,
      cpf_cnpj: c.cpf_cnpj || c.cpf || c.cnpj || ''
    }));
  }

  function searchFornecedores(pack, q, limit, somenteFabricas) {
    let list = pack.fornecedores || [];
    if (somenteFabricas) {
      list = list.filter(f => (f.tipo || 'FABRICA') === 'FABRICA');
    }
    const qt = norm(q);
    if (qt) {
      list = list.filter(f => norm(f.nome).includes(qt) || norm(f.apelido).includes(qt));
    }
    return list.slice(0, limit || 10).map(f => ({
      ...f,
      id: f.id,
      nome: f.nome,
      apelido: f.apelido || ''
    }));
  }

  function produtoPermitidoFornecedor(pack, prod, fId, itensForn) {
    if (!fId) return true;
    if (itensForn === 'S') {
      return String(prod.cod_fornecedorpadrao || '') === String(fId);
    }
    if (String(prod.cod_fornecedorpadrao || '') === String(fId)) return true;
    const pairs = pack.produtoFornecedor || [];
    const pid = prod.id || prod.cod_produto;
    return pairs.some(p => String(p.cod_produto) === String(pid) && String(p.cod_fornecedor) === String(fId));
  }

  function searchProdutos(pack, q, opts) {
    opts = opts || {};
    const limit = parseInt(opts.limit, 10) || 15;
    const fId = opts.id_fornecedor && opts.id_fornecedor !== 'null' ? parseInt(opts.id_fornecedor) : null;
    const tabelaId = opts.id_tabela && opts.id_tabela !== 'null' && opts.id_tabela !== '0'
      ? String(opts.id_tabela) : null;
    const itensForn = (pack.sistema || {}).itenspedidofornecedor || 'N';
    const qTrim = String(q || '').trim();
    const qt = norm(qTrim);
    const isBarcode = /^\d{8,}$/.test(qTrim);

    let pool = [];
    if (tabelaId && pack.produtosPorTabela?.[tabelaId]) {
      pool = pack.produtosPorTabela[tabelaId].slice();
    } else {
      const seen = new Set();
      Object.values(pack.produtosPorTabela || {}).forEach(arr => {
        (arr || []).forEach(p => {
          const k = String(p.id);
          if (!seen.has(k)) { seen.add(k); pool.push(p); }
        });
      });
    }

    if (itensForn === 'S' && !fId) return [];

    let list = pool.filter(p => produtoPermitidoFornecedor(pack, p, fId, itensForn));

    if (qTrim) {
      list = list.filter(p => {
        if (isBarcode) {
          return String(p.cod_barras) === qTrim || String(p.cod_fabricante) === qTrim
            || norm(p.descricao).includes(qt) || norm(p.cod_fabricante).includes(qt);
        }
        return norm(p.descricao).includes(qt) || norm(p.cod_fabricante).includes(qt)
          || norm(p.cod_barras).includes(qt) || String(p.id) === qTrim;
      });
      if (isBarcode) {
        list.sort((a, b) => {
          const ea = (String(a.cod_barras) === qTrim || String(a.cod_fabricante) === qTrim) ? 1 : 0;
          const eb = (String(b.cod_barras) === qTrim || String(b.cod_fabricante) === qTrim) ? 1 : 0;
          return eb - ea;
        });
      }
    }

    return list.slice(0, limit);
  }

  function tabelasDisponiveis(pack, cliId, forId, venId) {
    const vinc = pack.vinculosTabela || [];
    const priorities = [
      { id: cliId, tipo: 'CLIENTE' },
      { id: forId, tipo: 'FORNECEDOR' },
      { id: venId, tipo: 'VENDEDOR' }
    ];
    for (const p of priorities) {
      if (!p.id || p.id === 'null' || p.id === '0') continue;
      const rows = vinc.filter(v => String(v.tipo_entidade) === p.tipo && String(v.id_entidade) === String(p.id));
      if (rows.length) {
        return {
          tabelas: rows.map(r => ({ id_tabela: r.id_tabela, descricao: r.descricao })),
          origem: p.tipo
        };
      }
    }
    return { tabelas: [], origem: null };
  }

  function precoTabela(pack, tabelaId, prodId) {
    const arr = pack.produtosPorTabela?.[String(tabelaId)] || [];
    const p = arr.find(x => String(x.id) === String(prodId));
    if (p) {
      const val = parseFloat(p.valor_tabela ?? p.vlr_venda ?? 0);
      return { valor: val, is_fallback: false };
    }
    return { valor: 0, is_fallback: true };
  }

  async function fetchOffline(url, method) {
    if (method && method !== 'GET') return null;
    const pack = await loadPack();
    if (!pack || !isTokenUsableOffline()) return null;

    let u;
    try { u = new URL(url, global.location?.origin || 'http://localhost'); } catch (_) { return null; }
    const path = u.pathname;
    const q = u.searchParams;

    if (path === '/api/pedidos' || path.startsWith('/api/pedidos?')) {
      return jsonResp({
        pedidos: [],
        total: 0,
        pagination: { totalPages: 0, currentPage: 1, limit: 50 }
      });
    }

    if (path === '/api/auth/minhas-permissoes') {
      return jsonResp(pack.permissoes || {});
    }

    if (path === '/api/config/sistema') {
      return jsonResp(pack.sistema || {});
    }

    if (path === '/api/pedidos/lookup/vendedores') {
      return jsonResp({ vendedores: pack.vendedores || [] });
    }

    if (path === '/api/pedidos/lookup/tipos') {
      return jsonResp({ tipos: pack.tiposPedido || [] });
    }

    if (path === '/api/pedidos/lookup/tiposfrete') {
      return jsonResp({ tiposfrete: pack.tiposFrete || [] });
    }

    if (path === '/api/pedidos/lookup/empresas') {
      return jsonResp({ empresas: pack.empresas || [] });
    }

    if (path === '/api/prepostos/lookup') {
      return jsonResp({ prepostos: pack.prepostos || [] });
    }

    if (path === '/api/tabela-precos/condicoes-pagamento') {
      return jsonResp(pack.condicoesPagto || []);
    }

    if (path === '/api/transportadoras') {
      return jsonResp({ transportadoras: pack.transportadoras || [] });
    }

    if (path === '/api/pedidos/produtos/busca') {
      const data = searchProdutos(pack, q.get('q'), {
        limit: q.get('limit'),
        id_fornecedor: q.get('id_fornecedor'),
        id_tabela: q.get('id_tabela')
      });
      return jsonResp({ data });
    }

    if (path === '/api/clientes') {
      const items = searchClientes(pack, q.get('q'), parseInt(q.get('limit'), 10) || 10);
      if (q.get('padrao') === 'S') {
        return jsonResp({ clientes: items, total: items.length });
      }
      return jsonResp({ clientes: items, total: items.length });
    }

    if (path === '/api/fornecedores') {
      const items = searchFornecedores(pack, q.get('q'), parseInt(q.get('limit'), 10) || 10, q.get('somente_fabricas') === 'true');
      if (q.get('padrao') === 'S') {
        const pad = pack.fornecedorPadrao ? [pack.fornecedorPadrao] : items.slice(0, 1);
        return jsonResp({ fornecedores: pad, total: pad.length });
      }
      return jsonResp({ fornecedores: items, total: items.length });
    }

    const mCli = path.match(/^\/api\/clientes\/(\d+)$/);
    if (mCli) {
      const c = (pack.clientes || []).find(x => String(x.id) === mCli[1]);
      if (!c) return jsonResp({ error: 'Cliente não encontrado' }, 404);
      const inad = (pack.clienteInadimplente || {})[mCli[1]];
      return jsonResp(inad
        ? { ...c, tem_inadimplencia: true, valor_inadimplente: inad.valor_vencido || 0, qtd_parcelas_vencidas: inad.qtd_vencidas || 0 }
        : c);
    }

    const mForn = path.match(/^\/api\/fornecedores\/(\d+)$/);
    if (mForn) {
      const f = (pack.fornecedores || []).find(x => String(x.id) === mForn[1]);
      return f ? jsonResp(f) : jsonResp({ error: 'Fornecedor não encontrado' }, 404);
    }

    const mFornCond = path.match(/^\/api\/fornecedores\/(\d+)\/condicoes-pagamento$/);
    if (mFornCond) {
      const rows = pack.fornecedorCondicoes?.[mFornCond[1]] || [];
      return jsonResp(rows);
    }

    const mTab = path.match(/^\/api\/tabela-precos\/disponiveis-para\/([^/]+)\/([^/]+)\/([^/]+)$/);
    if (mTab) {
      return jsonResp(tabelasDisponiveis(pack, mTab[1], mTab[2], mTab[3]));
    }

    const mPreco = path.match(/^\/api\/tabela-precos\/vlr-venda\/(\d+)\/(\d+)$/);
    if (mPreco) {
      return jsonResp(precoTabela(pack, mPreco[1], mPreco[2]));
    }

    const mMult = path.match(/^\/api\/produtos\/(\d+)\/multiplos$/);
    if (mMult) {
      return jsonResp(pack.multiplosPorProduto?.[mMult[1]] || []);
    }

    const mGrade = path.match(/^\/api\/pedidos\/grade\/(\d+)$/);
    if (mGrade) {
      return jsonResp({ itens: pack.gradesPorGrade?.[mGrade[1]] || [] });
    }

    if (path === '/api/pedidos/config/grid') {
      return jsonResp({ config: null });
    }

    if (/^\/api\/pedidos\/grade-historico\//.test(path) || /^\/api\/pedidos\/grade-sugestao\//.test(path)) {
      return jsonResp({ itens: [], sugestao: [] });
    }

    return null;
  }

  async function preparePack(apiFn, onProgress) {
    if (typeof apiFn !== 'function') throw new Error('api indisponível');
    if (typeof onProgress === 'function') onProgress('Baixando dados…');
    const r = await apiFn('/api/pedidos/offline-pack');
    if (!r.ok) {
      let err = 'Erro ao preparar offline';
      try { const d = await r.json(); err = d.error || err; } catch (_) {}
      throw new Error(err);
    }
    const pack = await r.json();
    if (typeof onProgress === 'function') {
      const st = pack.meta?.stats || {};
      onProgress(`Salvando ${st.clientes || 0} clientes, ${st.produtos || 0} produtos…`);
    }
    await savePack(pack);
    if (typeof onProgress === 'function') onProgress('Pronto para uso offline');
    return pack;
  }

  function formatPackAge(pack) {
    if (!pack?.meta?.generatedAt) return '';
    const d = new Date(pack.meta.generatedAt);
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function updatePackBadge() {
    const el = document.getElementById('offlinePackBadge');
    if (!el) return;
    loadPack().then(pack => {
      const uid = userIdFromToken();
      const valid = pack && getOfflineUntil(uid) > Date.now();
      if (valid) {
        el.style.display = 'inline-flex';
        el.textContent = 'Offline OK · ' + formatPackAge(pack);
        el.title = 'Pacote offline válido até ' + new Date(getOfflineUntil(uid)).toLocaleString('pt-BR');
      } else if (pack) {
        el.style.display = 'inline-flex';
        el.textContent = 'Offline expirado';
        el.title = 'Prepare novamente com conexão';
      } else {
        el.style.display = 'none';
        el.textContent = '';
      }
    }).catch(() => {});
  }

  function bindPrepareButton(apiFn) {
    const btn = document.getElementById('btnPrepareOffline');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      if (!navigator.onLine) {
        if (typeof global.toast === 'function') global.toast('Conecte-se à internet para preparar o offline', 'warn');
        return;
      }
      btn.disabled = true;
      const lbl = btn.querySelector('.pm-prep-label') || btn;
      const orig = lbl.textContent;
      try {
        await preparePack(apiFn, (msg) => { lbl.textContent = msg; });
        if (typeof global.toast === 'function') global.toast('App preparado para uso offline (7 dias)', 'ok');
      } catch (e) {
        if (typeof global.toast === 'function') global.toast(e.message || 'Erro ao preparar offline', 'err');
      } finally {
        lbl.textContent = orig;
        btn.disabled = false;
        updatePackBadge();
      }
    });
    updatePackBadge();
  }

  function getHistoricoCliente(pack, cliId) {
    return (pack && pack.historicoClientes || {})[String(cliId)] || [];
  }

  function getClienteInadimplencia(pack, cliId) {
    return (pack && pack.clienteInadimplente || {})[String(cliId)] || null;
  }

  global.SysRepPedidosOfflinePack = {
    loadPack,
    savePack,
    hasValidPack,
    preparePack,
    fetchOffline,
    isTokenUsableOffline,
    userIdFromToken,
    getOfflineUntil,
    updatePackBadge,
    bindPrepareButton,
    searchClientes,
    searchFornecedores,
    searchProdutos,
    getHistoricoCliente,
    getClienteInadimplencia
  };
})(window);
