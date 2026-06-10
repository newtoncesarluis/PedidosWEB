/**
 * Pacote offline para pedidos (v1 — pedido novo).
 * IndexedDB + interceptação de GETs usados no formulário.
 */
(function (global) {
  'use strict';

  const DB_NAME = 'sysrep_pedidos_offline_v1';
  const DB_VERSION = 2;
  const STORE = 'pack';
  const SHELL_STORE = 'shell';
  const OFFLINE_DAYS = 7;

  const SHELL_PAGES = [
    '/pages/pedidos.html',
    '/mobile-shell.html',
    '/login.html',
  ];

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
    if (uid && getOfflineUntil(uid) > Date.now()) return true;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf('sysrep_offline_until_') === 0) {
          const v = parseInt(localStorage.getItem(k) || '0', 10);
          if (v > Date.now()) return true;
        }
      }
    } catch (_) {}
    if (localStorage.getItem('sysrep_offline_ready') === '1') {
      const n = parseInt(localStorage.getItem('sysrep_offline_clientes_count') || '0', 10);
      if (n > 0) return true;
    }
    const p = decodeJwtPayload(t);
    if (!p || !p.exp) return false;
    return p.exp * 1000 > Date.now();
  }

  function normProdutoDesc(p) {
    const desc = String(p.descricao || p.desc_produto || p.desc_prod || p.nome || '').trim();
    return Object.assign({}, p, {
      descricao: desc,
      desc_produto: desc,
      desc_prod: desc,
      nome: desc,
      referencia: p.cod_fabricante || p.referencia || '',
      preco_venda: p.vlr_venda != null ? p.vlr_venda : (p.preco_venda != null ? p.preco_venda : 0)
    });
  }

  async function syncPackToOfflineDb(pack) {
    if (!global.OfflineDB || !pack) return 0;
    const clientes = pack.clientes || [];
    let produtos = [];
    Object.values(pack.produtosPorTabela || {}).forEach((arr) => {
      (arr || []).forEach((p) => {
        const norm = normProdutoDesc(p);
        if (!produtos.some((x) => String(x.id) === String(norm.id))) produtos.push(norm);
      });
    });
    await global.OfflineDB.salvarClientes(clientes);
    if (produtos.length) await global.OfflineDB.salvarProdutos(produtos);
    await global.OfflineDB.setMeta('last_sync', pack.meta?.generatedAt || new Date().toISOString());
    await global.OfflineDB.setMeta('pack_user_id', pack.meta?.userId || userIdFromToken());
    await global.OfflineDB.setMeta('total_clientes', clientes.length);
    await global.OfflineDB.setMeta('total_produtos', produtos.length);
    return clientes.length;
  }

  async function loadPackFromOfflineDb() {
    if (!global.OfflineDB) return null;
    try {
      const n = await global.OfflineDB.contarClientes();
      if (!n) return null;
      const clientes = await global.OfflineDB.getAllClientes();
      return {
        meta: {
          version: 1,
          generatedAt: (await global.OfflineDB.getMeta('last_sync')) || new Date().toISOString(),
          userId: userIdFromToken(),
          offlineDays: OFFLINE_DAYS,
          stats: { clientes: clientes.length }
        },
        clientes,
        fornecedores: [],
        produtosPorTabela: {},
        sistema: {},
        permissoes: {}
      };
    } catch (_) {
      return null;
    }
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'userId' });
        }
        if (!db.objectStoreNames.contains(SHELL_STORE)) {
          db.createObjectStore(SHELL_STORE, { keyPath: 'path' });
        }
      };
      req.onsuccess = () => resolve(req.result);
    });
  }

  async function saveShellPage(path, html) {
    if (!path || !html) return;
    let db;
    try {
      db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(SHELL_STORE, 'readwrite');
        tx.objectStore(SHELL_STORE).put({ path, html, savedAt: Date.now() });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (_) {
    } finally {
      if (db) db.close();
    }
  }

  async function loadShellPage(path) {
    if (!path) return null;
    let db;
    try {
      db = await openDb();
      const row = await new Promise((resolve, reject) => {
        const tx = db.transaction(SHELL_STORE, 'readonly');
        const req = tx.objectStore(SHELL_STORE).get(path);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
      return row?.html || null;
    } catch (_) {
      return null;
    } finally {
      if (db) db.close();
    }
  }

  async function cacheShellPages() {
    if (!navigator.onLine) return;
    try { localStorage.setItem('sysrep_app_origin', location.origin); } catch (_) {}
    for (const path of SHELL_PAGES) {
      try {
        const r = await fetch(path, { credentials: 'same-origin', cache: 'force-cache' });
        if (!r.ok) continue;
        const html = await r.text();
        if (html && html.length > 500) await saveShellPage(path, html);
      } catch (_) {}
    }
  }

  const WARM_CACHE_URLS = [
    '/mobile-shell.html',
    '/home.html',
    '/login.html',
    '/pages/pedidos.html',
    '/pages/clientes.html',
    '/pages/mapa-operacoes.html',
    '/pages/visitas.html',
    '/assets/mobile-vendedor.js',
    '/assets/feirinha-calc.js',
    '/assets/preco-peso-produto.js',
    '/assets/comissao-preposto-ui.js',
    '/assets/ajuda-tour.css',
    '/assets/ajuda-tour.js',
    '/assets/ajuda-tours.js',
    '/vendor/leaflet/leaflet.css',
    '/vendor/leaflet/leaflet.js',
  ];

  function warmAppShellCache() {
    if (!navigator.onLine) return;
    WARM_CACHE_URLS.forEach((url) => {
      fetch(url, { credentials: 'same-origin' }).catch(() => {});
    });
    if (!('serviceWorker' in navigator)) return;
    const post = (sw) => {
      if (!sw) return;
      sw.postMessage({ type: 'CACHE_URLS', urls: WARM_CACHE_URLS });
    };
    if (navigator.serviceWorker.controller) {
      post(navigator.serviceWorker.controller);
      return;
    }
    navigator.serviceWorker.ready.then((reg) => post(reg.active)).catch(() => {});
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
    const nCli = (pack.clientes || []).length;
    localStorage.setItem('sysrep_offline_ready', '1');
    localStorage.setItem('sysrep_offline_clientes_count', String(nCli));
    try { await syncPackToOfflineDb(pack); } catch (_) {}
    updatePackBadge();
    warmAppShellCache();
    try { await cacheShellPages(); } catch (_) {}
    return pack;
  }

  async function loadPack(force) {
    if (_packCache && !force) return _packCache;
    if (_packPromise && !force) return _packPromise;

    _packPromise = (async () => {
      const uid = userIdFromToken();
      try {
        const db = await openDb();
        let row = null;
        if (uid) {
          row = await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const req = tx.objectStore(STORE).get(uid);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
          });
        }
        if (!row?.pack) {
          const rows = await new Promise((resolve, reject) => {
            const acc = [];
            const tx = db.transaction(STORE, 'readonly');
            const req = tx.objectStore(STORE).openCursor();
            req.onsuccess = () => {
              const c = req.result;
              if (!c) return resolve(acc);
              acc.push(c.value);
              c.continue();
            };
            req.onerror = () => reject(req.error);
          });
          rows.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
          row = rows[0] || null;
        }
        db.close();
        _packCache = row?.pack || null;
        if (!_packCache) _packCache = await loadPackFromOfflineDb();
        return _packCache;
      } catch (_) {
        _packCache = await loadPackFromOfflineDb();
        return _packCache;
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

  function distKmKm(lat1, lng1, lat2, lng2) {
    const r = Math.PI / 180;
    const a = 0.5 - Math.cos((lat2 - lat1) * r) / 2
      + Math.cos(lat1 * r) * Math.cos(lat2 * r) * (1 - Math.cos((lng2 - lng1) * r)) / 2;
    return 12742 * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  function listClientesScreen(pack, opts) {
    opts = opts || {};
    const statusRaw = String(opts.status || 'A').toLowerCase();
    const status = statusRaw === 'todos' ? 'TODOS' : String(opts.status || 'A').toUpperCase();
    const qRaw = String(opts.q || '').trim();
    const qt = norm(qRaw);
    const limit = Math.max(1, parseInt(opts.limit, 10) || 50);
    const offset = Math.max(0, parseInt(opts.offset, 10) || 0);

    let list = (pack.clientes || []).filter((c) => {
      const excl = String(c.excluido || 'N').toUpperCase();
      if (excl === 'S') return false;
      const st = String(c.status || 'A').toUpperCase();
      if (status === 'TODOS') return true;
      if (status === 'A') return st === 'A' || st === '' || c.status == null;
      if (status === 'I') return st === 'I';
      return true;
    });

    if (qt) {
      const isNum = /^\d+$/.test(qRaw);
      list = list.filter((c) => {
        if (isNum && String(c.id) === qRaw) return true;
        return norm(c.nome).includes(qt)
          || norm(c.apelido).includes(qt)
          || norm(c.cpf || c.cpf_cnpj).includes(qt)
          || norm(c.foneprincipal || c.fone).includes(qt)
          || norm(c.cidade).includes(qt)
          || norm(c.bairro).includes(qt);
      });
    }

    if (opts.tipo_cliente) {
      const t = norm(opts.tipo_cliente);
      list = list.filter((c) => norm(c.tipo_cliente).includes(t));
    }
    if (opts.cidade) {
      const t = norm(opts.cidade);
      list = list.filter((c) => norm(c.cidade).includes(t));
    }
    if (opts.suspensa === 'S') {
      list = list.filter((c) => String(c.venda_suspensa || '').toUpperCase() === 'S');
    }
    if (opts.sem_compra_dias && parseInt(opts.sem_compra_dias, 10) > 0) {
      const lim = Date.now() - parseInt(opts.sem_compra_dias, 10) * 86400000;
      list = list.filter((c) => {
        if (!c.dtultimacompra) return true;
        const t = new Date(c.dtultimacompra).getTime();
        return !Number.isFinite(t) || t < lim;
      });
    }

    const lat = parseFloat(opts.lat);
    const lng = parseFloat(opts.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const raio = parseFloat(opts.raio || 50);
      list = list
        .map((c) => {
          const clat = parseFloat(c.latitude);
          const clng = parseFloat(c.longitude);
          const distancia = Number.isFinite(clat) && Number.isFinite(clng)
            ? distKmKm(lat, lng, clat, clng) : null;
          return { c, distancia };
        })
        .filter((row) => row.distancia != null && row.distancia <= raio)
        .sort((a, b) => a.distancia - b.distancia)
        .map((row) => ({ ...row.c, distancia: row.distancia }));
    } else {
      list.sort((a, b) => norm(a.nome).localeCompare(norm(b.nome), 'pt-BR'));
    }

    const total = list.length;
    const page = list.slice(offset, offset + limit).map((c) => ({
      ...c,
      foneprincipal: c.foneprincipal || c.fone || c.celularcomprador || '',
      cpf: c.cpf || c.cpf_cnpj || '',
      total_pedidos: c.total_pedidos || 0
    }));

    return { clientes: page, total };
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
        const seg = norm(p.segmento);
        if (isBarcode) {
          return String(p.cod_barras) === qTrim || String(p.cod_fabricante) === qTrim
            || norm(p.descricao).includes(qt) || norm(p.cod_fabricante).includes(qt)
            || norm(p.cod_barras).includes(qt) || seg.includes(qt);
        }
        return norm(p.descricao).includes(qt) || norm(p.cod_fabricante).includes(qt)
          || norm(p.cod_barras).includes(qt) || seg.includes(qt) || String(p.id) === qTrim;
      });
      if (isBarcode) {
        list.sort((a, b) => {
          const ea = (String(a.cod_barras) === qTrim || String(a.cod_fabricante) === qTrim) ? 1 : 0;
          const eb = (String(b.cod_barras) === qTrim || String(b.cod_fabricante) === qTrim) ? 1 : 0;
          return eb - ea;
        });
      }
    }

    return list.slice(0, limit).map((p) => normProdutoDesc(p));
  }

  function matchesTipoPack(tipoPedido, filterTipo) {
    const f = String(filterTipo || '').trim().toUpperCase();
    if (!f || f === 'ALL' || f === 'TODOS' || f === 'TODAS') return true;
    const t = String(tipoPedido || '').toUpperCase();
    if (f === 'ORÇAMENTO' || f === 'ORCAMENTO') {
      return t.includes('ORC') || t.includes('ORÇ');
    }
    if (f === 'PEDIDO') return !t.includes('ORC') && !t.includes('ORÇ');
    return t.includes(f);
  }

  function filterPedidosPack(pack, filtros) {
    filtros = filtros || {};
    let rows = (pack.pedidosRecentes || []).slice();
    const q = String(filtros.q || '').trim().toLowerCase();
    const status = String(filtros.status || '').trim().toUpperCase();
    if (status && status !== 'TODOS' && status !== 'TODAS' && status !== 'TODO') {
      rows = rows.filter((r) => {
        const sit = String(r.situacao_pedido || '').toUpperCase();
        const st = String(r.status || '').toUpperCase();
        return sit === status || st === status;
      });
    }
    const tipo = filtros.tipo || '';
    if (tipo && tipo !== 'ALL') {
      rows = rows.filter((r) => matchesTipoPack(r.tipo_pedido, tipo));
    }
    const origem = String(filtros.origem || '').trim().toUpperCase();
    if (origem) {
      rows = rows.filter((r) => String(r.origem || '').toUpperCase() === origem);
    }
    if (filtros.dt_ini) {
      rows = rows.filter((r) => !r.data_abertura || r.data_abertura >= filtros.dt_ini);
    }
    if (filtros.dt_fim) {
      rows = rows.filter((r) => !r.data_abertura || r.data_abertura <= filtros.dt_fim);
    }
    const idVend = String(filtros.id_vendedor || '').trim();
    if (idVend && idVend !== '0' && idVend !== 'TODOS' && idVend !== 'TODAS') {
      rows = rows.filter((r) => String(r.id_usuario || '') === idVend);
    }
    if (q) {
      rows = rows.filter((r) => {
        const hay = [r.numero, r.nome_cliente, r.nome_fornecedor, r.nomeusu, r.nome_vendedor]
          .join(' ').toLowerCase();
        return hay.includes(q);
      });
    }
    return rows;
  }

  function loadQueueRowsDirect(filtros) {
    try {
      if (global.SysRepPedidosOffline && typeof global.SysRepPedidosOffline.queueAsPedidoRows === 'function') {
        return global.SysRepPedidosOffline.queueAsPedidoRows(filtros) || [];
      }
      const raw = localStorage.getItem('sysrep_pedidos_offline_v1');
      const queue = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(queue)) return [];
      return queue.map((entry) => {
        const p = entry.body?.pedido || {};
        const itens = (entry.body?.itens || []).filter((i) => !i._delete);
        return {
          id: entry.localId,
          _offlineLocal: true,
          numero: p.numero_off || '—',
          data_abertura: p.data_abertura || (entry.createdAt ? entry.createdAt.slice(0, 10) : ''),
          nome_cliente: p.nome_cliente || '',
          id_usuario: p.id_usuario,
          nome_fornecedor: p.nome_fornecedor || '',
          nomeusu: p.nome_vendedor || '',
          vlrtotalpedido: parseFloat(p.vlrtotalpedido) || 0,
          total_qt: p.total_qt || itens.length,
          tipo_pedido: p.tipo_pedido || 'PEDIDO',
          situacao_pedido: 'OFFLINE',
          origem: p.origem || 'MOBILE'
        };
      });
    } catch (_) {
      return [];
    }
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
    if (!isTokenUsableOffline()) return null;
    let pack = _packCache;
    if (!pack) pack = await loadPack();
    if (!pack) pack = await loadPackFromOfflineDb();
    if (!pack) return null;

    let u;
    try { u = new URL(url, global.location?.origin || 'http://localhost'); } catch (_) { return null; }
    const path = u.pathname;
    const q = u.searchParams;

    if (method && method !== 'GET') {
      // edit-lock: offline não tem concorrência — simular sucesso para permitir abrir pedidos existentes
      if (/^\/api\/pedidos\/\d+\/edit-lock$/.test(path)) {
        return jsonResp({ acquired: true, ok: true });
      }
      if (path === '/api/clientes' || /^\/api\/clientes\//.test(path)) {
        return jsonResp({
          error: 'Sem internet. Cadastro de cliente só sincroniza online. Para pedido offline, use o menu Pedidos.',
          offline: true
        }, 503);
      }
      return null;
    }

    // GET /api/pedidos/:id — abre pedido existente do pack (apenas cabeçalho, itens vazios offline)
    const mPedidoDetalhe = path.match(/^\/api\/pedidos\/(\d+)$/);
    if (mPedidoDetalhe) {
      const pedido = (pack.pedidosRecentes || []).find(p => String(p.id) === mPedidoDetalhe[1]);
      if (!pedido) return jsonResp({ error: 'Pedido não disponível offline' }, 404);
      return jsonResp({ pedido, itens: [], parcelas: [], logs: [], offline: true });
    }

    if (path === '/api/pedidos' || path.startsWith('/api/pedidos?')) {
      const filtros = {
        q: q.get('q') || '',
        status: q.get('status') || '',
        tipo: q.get('tipo') || '',
        origem: q.get('origem') || '',
        dt_ini: q.get('dt_ini') || '',
        dt_fim: q.get('dt_fim') || '',
        id_vendedor: q.get('id_vendedor') || ''
      };
      const queueRows = loadQueueRowsDirect(filtros);
      const packRows = filterPedidosPack(pack, filtros);
      const queueIds = new Set(queueRows.map((r) => String(r.id)));
      const merged = [...queueRows, ...packRows.filter((r) => !queueIds.has(String(r.id)))];
      const limit = parseInt(q.get('limit'), 10) || 50;
      const page = parseInt(q.get('page'), 10) || 1;
      const offset = (page - 1) * limit;
      const pageRows = merged.slice(offset, offset + limit);
      const total = merged.length;
      return jsonResp({
        pedidos: pageRows,
        total,
        pagination: {
          totalItems: total,
          totalPages: total > 0 ? Math.ceil(total / limit) : 0,
          currentPage: page,
          limit
        }
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
      if (global.OfflineDB && (!pack.clientes || !pack.clientes.length)) {
        try {
          const fromDb = await global.OfflineDB.listarClientes({
            q: q.get('q'),
            status: q.get('status') || 'A',
            limit: q.get('limit'),
            offset: q.get('offset'),
            cidade: q.get('cidade')
          });
          if (fromDb.total > 0) {
            if (q.get('padrao') === 'S') {
              const items = fromDb.clientes.slice(0, parseInt(q.get('limit'), 10) || 10);
              return jsonResp({ clientes: items, total: items.length });
            }
            return jsonResp(fromDb);
          }
        } catch (_) {}
      }
      const listed = listClientesScreen(pack, {
        q: q.get('q'),
        status: q.get('status') || 'A',
        limit: q.get('limit'),
        offset: q.get('offset'),
        tipo_cliente: q.get('tipo_cliente'),
        cidade: q.get('cidade'),
        sem_compra_dias: q.get('sem_compra_dias'),
        suspensa: q.get('suspensa'),
        lat: q.get('lat'),
        lng: q.get('lng'),
        raio: q.get('raio')
      });
      if (q.get('padrao') === 'S') {
        const items = listed.clientes.slice(0, parseInt(q.get('limit'), 10) || 10);
        return jsonResp({ clientes: items, total: items.length });
      }
      return jsonResp(listed);
    }

    if (path === '/api/config/flags') {
      return jsonResp({});
    }

    if (path === '/api/categorias') {
      return jsonResp({ categorias: [] });
    }

    if (path === '/api/clientes/auxiliares/vendedores') {
      const vendedores = (pack.vendedores || []).map((v) => ({
        id: v.id,
        nome: v.nome || v.nome_vendedor || ''
      }));
      return jsonResp({ vendedores });
    }

    if (path === '/api/clientes/auxiliares/ramo-atividades') {
      return jsonResp({ ramos: [] });
    }

    if (path.startsWith('/api/clientes/auxiliares/clientes-principais')) {
      const items = searchClientes(pack, q.get('q'), parseInt(q.get('limit'), 10) || 20);
      return jsonResp({ clientes: items });
    }

    if (path === '/api/clientes/auxiliares/campos-cadastro') {
      return jsonResp({ campos: [] });
    }

    if (path === '/api/clientes/auxiliares/cores') {
      return jsonResp({ cores: [] });
    }

    if (path === '/api/clientes/auxiliares/racas') {
      return jsonResp({ racas: [] });
    }

    if (path === '/api/lookups/regioes') {
      return jsonResp([]);
    }

    if (path === '/api/tabela-precos/ativas') {
      return jsonResp({ tabelas: [] });
    }

    if (path === '/api/teleatendimento/clientes-com-ligacoes') {
      return jsonResp({ clientes: [] });
    }

    if (path === '/api/regiao-rota/rotas-vendedor/clientes-em-rota') {
      return jsonResp({ items: [] });
    }

    if (/^\/api\/visitas\/hoje\/\d+$/.test(path)) {
      return jsonResp([]);
    }

    const mCliLig = path.match(/^\/api\/clientes\/(\d+)\/ligacoes$/);
    if (mCliLig) {
      return jsonResp({ ligacoes: [] });
    }

    const mCliFotos = path.match(/^\/api\/clientes\/(\d+)\/fotos$/);
    if (mCliFotos) {
      return jsonResp({ fotos: [] });
    }

    const mCliCheck = path.match(/^\/api\/clientes\/check-cnpj$/);
    if (mCliCheck || path === '/api/clientes/check-cnpj') {
      return jsonResp({ duplicado: false, clientes: [] });
    }

    const mTabVinc = path.match(/^\/api\/tabela-precos\/vinculos\/CLIENTE\/(\d+)$/);
    if (mTabVinc) {
      return jsonResp({ vinculos: [] });
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

    if (path === '/api/pedidos/config/grid' || path === '/api/pedidos/config/itens-colunas') {
      return jsonResp({ config: null });
    }

    if (path === '/api/feirinha/campanhas' || path.startsWith('/api/feirinha/campanhas?')) {
      return jsonResp({ campanhas: [], total: 0 });
    }

    const mFeirinhaKit = path.match(/^\/api\/feirinha\/campanhas\/(\d+)\/kit$/);
    if (mFeirinhaKit) {
      return jsonResp({ itens: [], campanha: null });
    }

    if (path.startsWith('/api/pedidos/produtos/promocoes-resumo')) {
      return jsonResp({ promocoes: [], total: 0 });
    }

    if (path.startsWith('/api/pedidos/ultimo-por-cliente/')) {
      return jsonResp({ pedido: null });
    }

    if (path.startsWith('/api/pedidos/comissoes-faturamento/')) {
      return jsonResp({ comissoes: [] });
    }

    if (path.startsWith('/api/tabela-precos/opcoes-item/')) {
      return jsonResp({ opcoes: [] });
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
    const n = (pack.clientes || []).length;
    if (typeof onProgress === 'function') {
      onProgress('Pronto — ' + n + ' clientes no banco local');
    }
    return pack;
  }

  function formatPrepareSummary(pack) {
    const st = pack?.meta?.stats || {};
    const nCli = st.clientes != null ? st.clientes : (pack?.clientes || []).length;
    const nProd = st.produtos != null ? st.produtos : 0;
    const nTab = st.tabelas != null ? st.tabelas : 0;
    if (!nCli) {
      return 'Offline gravado, porém 0 clientes na carteira — confira vínculo vendedor no cadastro de clientes.';
    }
    const nPed = st.pedidos != null ? st.pedidos : (pack?.pedidosRecentes || []).length;
    return 'Banco local: ' + nCli + ' clientes · ' + nProd + ' produtos · ' + nPed + ' pedidos · válido 7 dias ✓';
  }

  function formatPrepareDetailLines(pack) {
    const st = pack?.meta?.stats || {};
    const nCli = st.clientes != null ? st.clientes : (pack?.clientes || []).length;
    const nProd = st.produtos != null ? st.produtos : 0;
    const nTab = st.tabelas != null ? st.tabelas : 0;
    const nPed = st.pedidos != null ? st.pedidos : (pack?.pedidosRecentes || []).length;
    const nForn = st.fornecedores != null ? st.fornecedores : (pack?.fornecedores || []).length;
    const lines = [
      'Será gravado neste aparelho para uso sem internet:',
      '• ' + nCli + ' clientes da sua carteira',
      '• ' + nProd + ' produtos em ' + nTab + ' tabelas de preço',
      '• ' + nForn + ' fábricas / fornecedores',
      '• ' + nPed + ' pedidos recentes (consulta na lista offline)',
      '• Condições, grades e vínculos de tabela',
      'Pedidos novos criados offline ficam na fila e são enviados quando você tocar em sincronizar.'
    ];
    if (!nCli) {
      lines.push('⚠ Nenhum cliente na carteira — verifique vínculo do vendedor no cadastro.');
    }
    return lines;
  }

  function formatPackAge(pack) {
    if (!pack?.meta?.generatedAt) return '';
    const d = new Date(pack.meta.generatedAt);
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function updatePackBadge() {
    const el = document.getElementById('offlinePackBadge');
    if (!el) return;
    if (document.documentElement.classList.contains('sysrep-ms-embed')) {
      el.style.display = 'none';
      el.textContent = '';
      return;
    }
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
        const pack = await preparePack(apiFn, (msg) => { lbl.textContent = msg; });
        if (typeof global.toast === 'function' && !document.documentElement.classList.contains('sysrep-ms-embed')) {
          const sum = formatPrepareSummary(pack);
          global.toast(sum, (pack?.meta?.stats?.clientes || (pack?.clientes || []).length) > 0 ? 'ok' : 'warn');
        }
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
    formatPrepareSummary,
    formatPrepareDetailLines,
    fetchOffline,
    isTokenUsableOffline,
    userIdFromToken,
    getOfflineUntil,
    updatePackBadge,
    bindPrepareButton,
    warmAppShellCache,
    cacheShellPages,
    loadShellPage,
    syncPackToOfflineDb,
    searchClientes,
    listClientesScreen,
    searchFornecedores,
    searchProdutos,
    getHistoricoCliente,
    getClienteInadimplencia
  };
})(window);
