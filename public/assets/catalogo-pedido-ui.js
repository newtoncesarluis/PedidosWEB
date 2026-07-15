/**
 * Catálogo visual no pedido — overlay (coleções / fábrica / tabela → refs → detalhe → grade/qtd).
 * Usa APIs já existentes. Expõe: window.abrirCatalogoPedido()
 */
(function () {
  'use strict';

  const STATE = {
    view: 'home', // home | lista | refs | detalhe | editar
    modo: 'colecoes', // colecoes | fabrica | tabela
    catalogos: [],
    fabricas: [],
    tabelas: [],
    fonte: null, // { tipo, id, nome }
    itens: [],
    produto: null,
    gradeItens: [],
    gradeQtd: {},
    qtdSimples: 1,
    obs: '',
    busca: '',
    offset: 0,
    total: null,
    loadingMore: false,
    buscaTimer: null,
  };

  const PAGE = 48;
  const CORES_FAB = ['#1e3a5f', '#0f766e', '#7c2d12', '#4c1d95', '#1e40af', '#334155', '#9f1239', '#065f46'];

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function money(v) {
    const n = parseFloat(v) || 0;
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function pedidoCtx() {
    return {
      cliente: document.getElementById('f_cod_cliente')?.value || '0',
      fornecedor: document.getElementById('f_cod_fornecedor')?.value || '0',
      vendedor: document.getElementById('f_id_usuario')?.value || '0',
      tabelaAtual: (typeof _tabelaPrecoAtual !== 'undefined' && _tabelaPrecoAtual)
        ? String(_tabelaPrecoAtual)
        : (document.getElementById('f_id_tabela_preco')?.value || ''),
    };
  }

  function ensureOverlay() {
    let el = document.getElementById('catalogoPedidoOverlay');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'catalogoPedidoOverlay';
    el.className = 'cpo-overlay';
    el.innerHTML = `
      <div class="cpo-shell">
        <header class="cpo-header">
          <button type="button" class="cpo-back" id="cpoBack" title="Voltar" aria-label="Voltar">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="20" height="20"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div class="cpo-title" id="cpoTitle">Catálogos</div>
          <button type="button" class="cpo-close" id="cpoClose" title="Fechar" aria-label="Fechar">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="20" height="20"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </header>
        <div class="cpo-modes" id="cpoModes">
          <button type="button" class="cpo-mode is-active" data-modo="colecoes">Coleções</button>
          <button type="button" class="cpo-mode" data-modo="fabrica">Fábricas</button>
          <button type="button" class="cpo-mode" data-modo="tabela">Tabelas de preço</button>
        </div>
        <div class="cpo-toolbar" id="cpoToolbar">
          <div class="cpo-search-wrap">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15z"/></svg>
            <input type="search" id="cpoBusca" placeholder="Pesquisar" autocomplete="off">
          </div>
        </div>
        <div class="cpo-body" id="cpoBody"></div>
      </div>`;
    document.body.appendChild(el);

    if (!document.getElementById('cpoStyles')) {
      const st = document.createElement('style');
      st.id = 'cpoStyles';
      st.textContent = `
.cpo-overlay{display:none;position:fixed;inset:0;z-index:2147483600;background:rgba(15,23,42,.55);backdrop-filter:blur(3px);align-items:stretch;justify-content:center;padding:0}
.cpo-overlay.show{display:flex}
.cpo-shell{width:100%;height:100%;max-width:1100px;margin:0 auto;background:var(--content-bg,var(--bg,#f8fafc));color:var(--content-text,var(--text,#111));display:flex;flex-direction:column;box-shadow:0 0 40px rgba(0,0,0,.25)}
.cpo-header{display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--card,var(--card-bg,#fff));border-bottom:1px solid var(--card-border,var(--border,#e5e7eb));flex-shrink:0}
.cpo-title{flex:1;font-weight:800;font-size:16px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cpo-back,.cpo-close{width:36px;height:36px;border:none;border-radius:10px;background:var(--bg,var(--content-bg,#f1f5f9));color:var(--text,var(--content-text));cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.cpo-modes{display:flex;gap:6px;padding:10px 14px 0;background:var(--card,var(--card-bg,#fff));flex-shrink:0;flex-wrap:wrap}
.cpo-mode{height:34px;padding:0 12px;border-radius:999px;border:1.5px solid var(--card-border,var(--border,#e5e7eb));background:var(--bg,var(--content-bg,#f1f5f9));font:inherit;font-size:12px;font-weight:800;cursor:pointer;color:var(--text2,#64748b)}
.cpo-mode.is-active{border-color:var(--accent,#0d9488);background:var(--accent-soft,rgba(13,148,136,.12));color:var(--accent,#0d9488)}
.cpo-toolbar{padding:10px 14px;background:var(--card,var(--card-bg,#fff));border-bottom:1px solid var(--card-border,var(--border,#e5e7eb));flex-shrink:0}
.cpo-search-wrap{display:flex;align-items:center;gap:8px;height:40px;padding:0 12px;border:1.5px solid var(--card-border,var(--border,#e5e7eb));border-radius:12px;background:var(--card,var(--card-bg,#fff));color:var(--text2,#64748b)}
.cpo-search-wrap input{flex:1;border:none;outline:none;background:transparent;color:var(--content-text,var(--text));font:inherit;font-size:14px}
.cpo-body{flex:1;overflow:auto;padding:14px;min-height:0}
.cpo-grid-cat{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
.cpo-cat{border-radius:14px;overflow:hidden;cursor:pointer;min-height:140px;position:relative;border:1px solid var(--card-border,var(--border,#e5e7eb));background:#1f2937;background-size:cover;background-position:center;box-shadow:0 8px 24px rgba(0,0,0,.12);transition:transform .15s}
.cpo-cat:hover{transform:translateY(-2px)}
.cpo-cat::after{content:'';position:absolute;inset:0;background:linear-gradient(transparent 35%,rgba(0,0,0,.72))}
.cpo-cat-lbl{position:absolute;left:12px;right:12px;bottom:12px;z-index:1;color:#fff;font-weight:800;font-size:15px;text-shadow:0 1px 4px rgba(0,0,0,.5)}
.cpo-cat-meta{display:block;font-size:11px;font-weight:600;opacity:.9;margin-top:2px}
.cpo-grid-ref{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px}
.cpo-ref{background:var(--card,var(--card-bg,#fff));border:1px solid var(--card-border,var(--border,#e5e7eb));border-radius:12px;overflow:hidden;cursor:pointer;display:flex;flex-direction:column;transition:border-color .15s}
.cpo-ref:hover{border-color:var(--accent,#0d9488)}
.cpo-ref-img{aspect-ratio:1;background:var(--bg,#f1f5f9);display:flex;align-items:center;justify-content:center;overflow:hidden}
.cpo-ref-img img{width:100%;height:100%;object-fit:cover}
.cpo-ref-code{padding:8px;text-align:center;font-size:11px;font-weight:700;color:var(--text2,#64748b)}
.cpo-ref-preco{padding:0 8px 8px;text-align:center;font-size:11px;font-weight:800;color:var(--accent,#0d9488)}
.cpo-empty{padding:40px 16px;text-align:center;color:var(--text2,#64748b);font-size:13px}
.cpo-more{display:block;margin:16px auto 8px;height:38px;padding:0 18px;border-radius:10px;border:1.5px solid var(--card-border,var(--border));background:var(--card);color:var(--text);font:inherit;font-weight:700;cursor:pointer}
.cpo-detalhe{display:grid;grid-template-columns:1fr;gap:16px;max-width:720px;margin:0 auto}
.cpo-detalhe-img{width:100%;aspect-ratio:1;max-height:420px;object-fit:contain;background:var(--card,var(--card-bg,#fff));border-radius:16px;border:1px solid var(--card-border,var(--border,#e5e7eb))}
.cpo-detalhe-info{text-align:center}
.cpo-detalhe-nome{font-size:15px;font-weight:800;margin-bottom:6px}
.cpo-detalhe-preco{font-size:18px;font-weight:900;color:var(--accent,#0d9488);margin:8px 0 16px}
.cpo-fab{display:flex;justify-content:center;gap:12px;flex-wrap:wrap}
.cpo-fab-btn{width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;box-shadow:0 6px 16px rgba(0,0,0,.15)}
.cpo-fab-cart{background:#10b981;color:#fff}
.cpo-fab-fav{background:var(--card,var(--card-bg,#fff));color:#ef4444;border:1.5px solid var(--card-border,var(--border))}
.cpo-edit{max-width:640px;margin:0 auto}
.cpo-edit-top{display:flex;gap:14px;align-items:flex-start;margin-bottom:16px}
.cpo-edit-top img{width:100px;height:100px;object-fit:cover;border-radius:12px;background:var(--bg)}
.cpo-edit-meta{flex:1;font-size:13px;line-height:1.5}
.cpo-grade{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin:16px 0}
.cpo-gcell{width:72px;background:var(--card,var(--card-bg,#fff));border:1px solid var(--card-border,var(--border,#e5e7eb));border-radius:12px;padding:8px 4px;display:flex;flex-direction:column;align-items:center;gap:6px}
.cpo-gbtn{width:32px;height:32px;border:none;border-radius:8px;font-size:18px;font-weight:800;cursor:pointer;line-height:1}
.cpo-gbtn.plus{background:#0d9488;color:#fff}
.cpo-gbtn.minus{background:#fecaca;color:#b91c1c}
.cpo-gqtd{font-size:16px;font-weight:900;min-height:22px}
.cpo-glbl{font-size:11px;font-weight:700;color:var(--text2)}
.cpo-qtd-wrap{display:flex;align-items:center;justify-content:center;gap:12px;margin:16px 0}
.cpo-qtd-wrap input{width:80px;height:40px;text-align:center;font-size:18px;font-weight:800;border:1.5px solid var(--card-border,var(--border));border-radius:10px;background:var(--card);color:var(--text)}
.cpo-obs{width:100%;height:40px;border:1.5px solid var(--card-border,var(--border));border-radius:10px;padding:0 12px;background:var(--card);color:var(--text);font:inherit;margin-top:8px}
.cpo-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:18px;padding-top:14px;border-top:1px solid var(--card-border,var(--border))}
.cpo-foot-tot{font-size:13px;font-weight:700}
.cpo-save{height:44px;padding:0 20px;border:none;border-radius:12px;background:#0d9488;color:#fff;font:inherit;font-weight:800;cursor:pointer}
.cpo-chip{display:inline-block;font-size:10px;font-weight:800;padding:2px 8px;border-radius:999px;background:var(--accent-soft,rgba(13,148,136,.12));color:var(--accent,#0d9488);margin-left:6px}
@media(max-width:640px){.cpo-grid-ref{grid-template-columns:repeat(auto-fill,minmax(110px,1fr))}.cpo-edit-top{flex-direction:column;align-items:center;text-align:center}}
`;
      document.head.appendChild(st);
    }

    document.getElementById('cpoClose').onclick = fechar;
    document.getElementById('cpoBack').onclick = voltar;
    document.getElementById('cpoBusca').oninput = (e) => {
      STATE.busca = e.target.value.trim();
      clearTimeout(STATE.buscaTimer);
      STATE.buscaTimer = setTimeout(() => {
        if (STATE.view === 'refs' && STATE.fonte && STATE.fonte.tipo !== 'colecao') {
          carregarProdutosFonte({ reset: true });
        } else {
          render();
        }
      }, 280);
    };
    document.getElementById('cpoModes').onclick = (e) => {
      const btn = e.target.closest('.cpo-mode');
      if (!btn) return;
      mudarModo(btn.dataset.modo);
    };
    document.getElementById('cpoBody').addEventListener('scroll', onBodyScroll);
    return el;
  }

  function syncModesUI() {
    document.querySelectorAll('.cpo-mode').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.modo === STATE.modo);
    });
    const modes = document.getElementById('cpoModes');
    if (modes) modes.style.display = (STATE.view === 'home' || STATE.view === 'lista') ? '' : 'none';
  }

  function fechar() {
    const el = document.getElementById('catalogoPedidoOverlay');
    if (el) el.classList.remove('show');
  }

  function voltar() {
    if (STATE.view === 'editar') {
      STATE.view = 'detalhe';
      render();
      return;
    }
    if (STATE.view === 'detalhe') {
      STATE.view = 'refs';
      STATE.produto = null;
      render();
      return;
    }
    if (STATE.view === 'refs') {
      STATE.view = 'lista';
      STATE.fonte = null;
      STATE.itens = [];
      STATE.busca = '';
      const inp = document.getElementById('cpoBusca');
      if (inp) inp.value = '';
      render();
      return;
    }
    fechar();
  }

  async function apiJson(url) {
    if (typeof api === 'function') {
      const r = await api(url);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || ('Erro ' + r.status));
      return d;
    }
    const token = sessionStorage.getItem('token') || localStorage.getItem('token') || '';
    const r = await fetch(url, {
      credentials: 'include',
      headers: { Authorization: 'Bearer ' + token },
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || ('Erro ' + r.status));
    return d;
  }

  async function abrir() {
    const overlay = ensureOverlay();
    STATE.view = 'lista';
    STATE.fonte = null;
    STATE.itens = [];
    STATE.produto = null;
    STATE.busca = '';
    STATE.offset = 0;
    const inp = document.getElementById('cpoBusca');
    if (inp) inp.value = '';
    overlay.classList.add('show');
    await mudarModo(STATE.modo || 'colecoes');
  }

  async function mudarModo(modo) {
    STATE.modo = modo || 'colecoes';
    STATE.view = 'lista';
    STATE.fonte = null;
    STATE.itens = [];
    STATE.busca = '';
    const inp = document.getElementById('cpoBusca');
    if (inp) inp.value = '';
    syncModesUI();
    document.getElementById('cpoBody').innerHTML = '<div class="cpo-empty">Carregando…</div>';
    try {
      if (STATE.modo === 'colecoes') await carregarColecoes();
      else if (STATE.modo === 'fabrica') await carregarFabricas();
      else await carregarTabelas();
      render();
    } catch (e) {
      document.getElementById('cpoBody').innerHTML =
        `<div class="cpo-empty">${esc(e.message || 'Erro ao carregar')}</div>`;
    }
  }

  async function carregarColecoes() {
    const ctx = pedidoCtx();
    const params = new URLSearchParams();
    if (ctx.fornecedor && ctx.fornecedor !== '0') params.set('cod_fornecedor', ctx.fornecedor);
    try {
      const d = await apiJson('/api/catalogos?' + params.toString());
      STATE.catalogos = d.catalogos || [];
    } catch (_) {
      STATE.catalogos = [];
    }
  }

  async function carregarFabricas() {
    try {
      const r = typeof api === 'function'
        ? await api('/api/fornecedores?limit=1000&status=A&somente_fabricas=true')
        : await fetch('/api/fornecedores?limit=1000&status=A&somente_fabricas=true', {
            credentials: 'include',
            headers: { Authorization: 'Bearer ' + (sessionStorage.getItem('token') || localStorage.getItem('token') || '') },
          });
      const d = await r.json();
      const list = d.fornecedores || d.data || d || [];
      STATE.fabricas = Array.isArray(list) ? list : [];
    } catch (_) {
      try {
        const d = await apiJson('/api/lookups/fornecedores');
        STATE.fabricas = Array.isArray(d) ? d : [];
      } catch (e2) {
        STATE.fabricas = [];
      }
    }
  }

  async function carregarTabelas() {
    const ctx = pedidoCtx();
    const map = new Map();
    try {
      const d = await apiJson(`/api/tabela-precos/disponiveis-para/${ctx.cliente || 0}/${ctx.fornecedor || 0}/${ctx.vendedor || 0}`);
      (d.tabelas || []).forEach((t) => {
        const id = t.id_tabela || t.id;
        if (id) map.set(String(id), { id, descricao: t.descricao || ('Tabela ' + id), origem: d.origem || '' });
      });
    } catch (_) { /* ignore */ }
    try {
      const d2 = await apiJson('/api/tabela-precos?limit=100');
      (d2.tabelas || []).forEach((t) => {
        const id = t.id;
        if (!id) return;
        const ativo = String(t.Ativo || t.ativo || 'S').toUpperCase();
        if (ativo === 'N' || ativo === 'I') return;
        if (!map.has(String(id))) {
          map.set(String(id), {
            id,
            descricao: t.Descricao || t.descricao || ('Tabela ' + id),
            origem: '',
          });
        }
      });
    } catch (_) { /* ignore */ }
    STATE.tabelas = Array.from(map.values());
    if (ctx.tabelaAtual && !STATE.tabelas.some((t) => String(t.id) === String(ctx.tabelaAtual))) {
      STATE.tabelas.unshift({ id: ctx.tabelaAtual, descricao: 'Tabela do pedido #' + ctx.tabelaAtual, origem: 'PEDIDO' });
    }
  }

  async function abrirColecao(id) {
    document.getElementById('cpoBody').innerHTML = '<div class="cpo-empty">Carregando referências…</div>';
    try {
      const d = await apiJson('/api/catalogos/' + id);
      STATE.fonte = { tipo: 'colecao', id, nome: d.catalogo?.nome || 'Coleção' };
      STATE.itens = (d.itens || []).map(normItem);
      STATE.total = STATE.itens.length;
      STATE.offset = STATE.itens.length;
      STATE.view = 'refs';
      STATE.busca = '';
      const inp = document.getElementById('cpoBusca');
      if (inp) inp.value = '';
      syncModesUI();
      render();
    } catch (e) {
      if (typeof toast === 'function') toast(e.message || 'Erro', 'err');
    }
  }

  async function abrirFabrica(id, nome) {
    STATE.fonte = { tipo: 'fabrica', id, nome: nome || ('Fábrica #' + id) };
    STATE.view = 'refs';
    STATE.busca = '';
    const inp = document.getElementById('cpoBusca');
    if (inp) inp.value = '';
    syncModesUI();
    await carregarProdutosFonte({ reset: true });
  }

  async function abrirTabela(id, nome) {
    STATE.fonte = { tipo: 'tabela', id, nome: nome || ('Tabela #' + id) };
    STATE.view = 'refs';
    STATE.busca = '';
    const inp = document.getElementById('cpoBusca');
    if (inp) inp.value = '';
    syncModesUI();
    await carregarProdutosFonte({ reset: true });
  }

  function normItem(p) {
    return {
      cod_produto: parseInt(p.cod_produto || p.id || p.ID, 10),
      cod_fabricante: p.cod_fabricante || '',
      desc_produto: p.desc_produto || p.descricao || '',
      unidade: p.unidade || '',
      tipograde: parseInt(p.tipograde, 10) || 0,
      foto_principal: p.foto_principal || '',
      vlr_venda: parseFloat(p.vlr_venda ?? p.preco_da_tabela) || 0,
      multiplo_venda: p.multiplo_venda,
      qtd_minima_pedido: p.qtd_minima_pedido,
      precopeso: p.precopeso,
      kilo_embalagem: p.kilo_embalagem,
      disponivel: p.disponivel,
      tipoprodutograde: p.tipoprodutograde || '',
    };
  }

  async function carregarProdutosFonte({ reset = false } = {}) {
    if (!STATE.fonte || STATE.fonte.tipo === 'colecao') return;
    if (STATE.loadingMore) return;
    if (reset) {
      STATE.itens = [];
      STATE.offset = 0;
      STATE.total = null;
      document.getElementById('cpoBody').innerHTML = '<div class="cpo-empty">Carregando referências…</div>';
    }
    STATE.loadingMore = true;
    try {
      const ctx = pedidoCtx();
      const params = new URLSearchParams({
        catalogo: '1',
        limit: String(PAGE),
        offset: String(STATE.offset),
        q: STATE.busca || '',
      });
      if (STATE.fonte.tipo === 'fabrica') {
        params.set('id_fornecedor', STATE.fonte.id);
        if (ctx.tabelaAtual) params.set('id_tabela', ctx.tabelaAtual);
      } else if (STATE.fonte.tipo === 'tabela') {
        params.set('id_tabela', STATE.fonte.id);
        if (ctx.fornecedor && ctx.fornecedor !== '0') params.set('id_fornecedor', ctx.fornecedor);
      }
      const d = await apiJson('/api/pedidos/produtos/busca?' + params.toString());
      const rows = (d.data || d.produtos || []).map(normItem);
      STATE.itens = reset ? rows : STATE.itens.concat(rows);
      STATE.offset = STATE.itens.length;
      STATE.total = d.total != null ? d.total : null;
      render();
    } catch (e) {
      if (reset) {
        document.getElementById('cpoBody').innerHTML =
          `<div class="cpo-empty">${esc(e.message || 'Erro ao carregar produtos')}</div>`;
      } else if (typeof toast === 'function') {
        toast(e.message || 'Erro', 'err');
      }
    } finally {
      STATE.loadingMore = false;
    }
  }

  function onBodyScroll() {
    if (STATE.view !== 'refs' || !STATE.fonte || STATE.fonte.tipo === 'colecao') return;
    if (STATE.loadingMore) return;
    if (STATE.total != null && STATE.itens.length >= STATE.total) return;
    const body = document.getElementById('cpoBody');
    if (!body) return;
    if (body.scrollTop + body.clientHeight > body.scrollHeight - 120) {
      carregarProdutosFonte({ reset: false });
    }
  }

  function filtrarListaCards() {
    const q = (STATE.busca || '').toLowerCase();
    if (STATE.modo === 'colecoes') {
      if (!q) return STATE.catalogos;
      return STATE.catalogos.filter((c) =>
        `${c.nome || ''} ${c.subtitulo || ''} ${c.nome_fornecedor || ''}`.toLowerCase().includes(q)
      );
    }
    if (STATE.modo === 'fabrica') {
      if (!q) return STATE.fabricas;
      return STATE.fabricas.filter((f) =>
        `${f.nome || ''} ${f.apelido || ''} ${f.id || ''}`.toLowerCase().includes(q)
      );
    }
    if (!q) return STATE.tabelas;
    return STATE.tabelas.filter((t) =>
      `${t.descricao || ''} ${t.id || ''} ${t.origem || ''}`.toLowerCase().includes(q)
    );
  }

  function filtrarItensLocal() {
    if (STATE.fonte && STATE.fonte.tipo !== 'colecao') return STATE.itens;
    const q = (STATE.busca || '').toLowerCase();
    if (!q) return STATE.itens;
    return STATE.itens.filter((it) =>
      `${it.cod_fabricante || ''} ${it.desc_produto || ''} ${it.cod_produto || ''}`.toLowerCase().includes(q)
    );
  }

  function render() {
    const title = document.getElementById('cpoTitle');
    const toolbar = document.getElementById('cpoToolbar');
    const body = document.getElementById('cpoBody');
    if (!body || !title) return;
    syncModesUI();

    if (STATE.view === 'lista') {
      toolbar.style.display = '';
      if (STATE.modo === 'colecoes') {
        title.textContent = 'Coleções';
        const list = filtrarListaCards();
        if (!list.length) {
          body.innerHTML = `<div class="cpo-empty">Nenhuma coleção ativa.<br>Cadastre em Comercial → Catálogos Visuais<br>ou use as abas <strong>Fábricas</strong> / <strong>Tabelas de preço</strong>.</div>`;
          return;
        }
        body.innerHTML = `<div class="cpo-grid-cat">${list.map((c) => {
          const bg = c.imagem_capa
            ? `background-image:url('${esc(c.imagem_capa)}')`
            : `background:${esc(c.cor_fundo || '#1f2937')}`;
          return `<div class="cpo-cat" data-tipo="colecao" data-id="${c.id}" style="${bg}">
            <div class="cpo-cat-lbl">${esc(c.nome)}
              <span class="cpo-cat-meta">${esc(c.subtitulo || (c.qtd_itens || 0) + ' produtos')}</span>
            </div>
          </div>`;
        }).join('')}</div>`;
      } else if (STATE.modo === 'fabrica') {
        title.textContent = 'Fábricas';
        const list = filtrarListaCards();
        const ctx = pedidoCtx();
        if (!list.length) {
          body.innerHTML = `<div class="cpo-empty">Nenhuma fábrica encontrada.</div>`;
          return;
        }
        // Destaca a fábrica do pedido no topo
        const sorted = [...list].sort((a, b) => {
          const aPed = String(a.id) === String(ctx.fornecedor) ? 0 : 1;
          const bPed = String(b.id) === String(ctx.fornecedor) ? 0 : 1;
          return aPed - bPed || String(a.nome || '').localeCompare(String(b.nome || ''));
        });
        body.innerHTML = `<div class="cpo-grid-cat">${sorted.map((f, i) => {
          const cor = CORES_FAB[i % CORES_FAB.length];
          const ped = String(f.id) === String(ctx.fornecedor);
          return `<div class="cpo-cat" data-tipo="fabrica" data-id="${f.id}" data-nome="${esc(f.nome || '')}" style="background:${cor}">
            <div class="cpo-cat-lbl">${esc(f.nome || ('#' + f.id))}
              <span class="cpo-cat-meta">${ped ? 'Fábrica do pedido' : 'Catálogo completo da fábrica'}</span>
            </div>
          </div>`;
        }).join('')}</div>`;
      } else {
        title.textContent = 'Tabelas de preço';
        const list = filtrarListaCards();
        if (!list.length) {
          body.innerHTML = `<div class="cpo-empty">Nenhuma tabela de preço disponível neste contexto.</div>`;
          return;
        }
        body.innerHTML = `<div class="cpo-grid-cat">${list.map((t, i) => {
          const cor = CORES_FAB[(i + 3) % CORES_FAB.length];
          return `<div class="cpo-cat" data-tipo="tabela" data-id="${t.id}" data-nome="${esc(t.descricao || '')}" style="background:${cor}">
            <div class="cpo-cat-lbl">${esc(t.descricao || ('Tabela ' + t.id))}
              <span class="cpo-cat-meta">${esc(t.origem ? 'Origem: ' + t.origem : 'Produtos com preço nesta tabela')}</span>
            </div>
          </div>`;
        }).join('')}</div>`;
      }
      body.querySelectorAll('.cpo-cat').forEach((el) => {
        el.onclick = () => {
          const tipo = el.dataset.tipo;
          const id = el.dataset.id;
          if (tipo === 'colecao') abrirColecao(id);
          else if (tipo === 'fabrica') abrirFabrica(id, el.dataset.nome);
          else abrirTabela(id, el.dataset.nome);
        };
      });
      return;
    }

    if (STATE.view === 'refs') {
      title.textContent = 'Referências — ' + (STATE.fonte?.nome || '');
      toolbar.style.display = '';
      const list = filtrarItensLocal();
      if (!list.length) {
        body.innerHTML = `<div class="cpo-empty">Nenhuma referência encontrada.</div>`;
        return;
      }
      const more = (STATE.fonte?.tipo !== 'colecao' && (STATE.total == null || STATE.itens.length < STATE.total))
        ? `<button type="button" class="cpo-more" id="cpoMore">${STATE.loadingMore ? 'Carregando…' : 'Carregar mais'}</button>`
        : '';
      body.innerHTML = `<div class="cpo-grid-ref">${list.map((it) => {
        const foto = it.foto_principal
          ? `<img src="${esc(it.foto_principal)}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='📷'">`
          : '📷';
        const grade = it.tipograde ? '<span class="cpo-chip">Grade</span>' : '';
        return `<div class="cpo-ref" data-id="${it.cod_produto}">
          <div class="cpo-ref-img">${foto}</div>
          <div class="cpo-ref-code">${esc(it.cod_fabricante || it.cod_produto)}${grade}</div>
          <div class="cpo-ref-preco">${money(it.vlr_venda)}</div>
        </div>`;
      }).join('')}</div>${more}`;
      body.querySelectorAll('.cpo-ref').forEach((el) => {
        el.onclick = () => abrirDetalhe(parseInt(el.dataset.id, 10));
      });
      const btnMore = document.getElementById('cpoMore');
      if (btnMore) btnMore.onclick = () => carregarProdutosFonte({ reset: false });
      return;
    }

    if (STATE.view === 'detalhe') {
      const p = STATE.produto;
      title.textContent = 'Ref.: ' + (p.cod_fabricante || p.cod_produto);
      toolbar.style.display = 'none';
      const foto = p.foto_principal || '';
      body.innerHTML = `<div class="cpo-detalhe">
        <img class="cpo-detalhe-img" src="${esc(foto)}" alt="" onerror="this.style.display='none'">
        <div class="cpo-detalhe-info">
          <div class="cpo-detalhe-nome">${esc(p.cod_fabricante || p.cod_produto)} — ${esc(p.desc_produto || '')}</div>
          <div class="cpo-detalhe-preco">${money(p.vlr_venda)}</div>
          <div class="cpo-fab">
            <button type="button" class="cpo-fab-btn cpo-fab-fav" id="cpoFav" title="Favorito" aria-label="Favorito">♥</button>
            <button type="button" class="cpo-fab-btn cpo-fab-cart" id="cpoCart" title="Incluir no pedido" aria-label="Carrinho">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="24" height="24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/></svg>
            </button>
          </div>
        </div>
      </div>`;
      document.getElementById('cpoCart').onclick = () => abrirEditar();
      document.getElementById('cpoFav').onclick = () => {
        if (typeof toast === 'function') toast('Use a lista de favoritos do pedido, se disponível', 'ok');
      };
      return;
    }

    if (STATE.view === 'editar') {
      const p = STATE.produto;
      title.textContent = 'Editar Produto';
      toolbar.style.display = 'none';
      const temGrade = !!(typeof _habilitaGrades !== 'undefined' && _habilitaGrades === 'S' && p.tipograde && STATE.gradeItens.length);
      let mid = '';
      if (temGrade) {
        mid = `<div class="cpo-grade">${STATE.gradeItens.map((g) => {
          const q = STATE.gradeQtd[g.id] || 0;
          return `<div class="cpo-gcell">
            <button type="button" class="cpo-gbtn plus" data-gid="${g.id}" data-d="1">+</button>
            <div class="cpo-glbl">${esc(g.nome)}</div>
            <div class="cpo-gqtd" id="cpoGq_${g.id}">${q}</div>
            <button type="button" class="cpo-gbtn minus" data-gid="${g.id}" data-d="-1">−</button>
          </div>`;
        }).join('')}</div>`;
      } else {
        mid = `<div class="cpo-qtd-wrap">
          <button type="button" class="cpo-gbtn minus" id="cpoQMinus">−</button>
          <input type="number" id="cpoQtd" min="0" step="1" value="${STATE.qtdSimples}">
          <button type="button" class="cpo-gbtn plus" id="cpoQPlus">+</button>
        </div>`;
      }
      const totalQtd = temGrade
        ? STATE.gradeItens.reduce((s, g) => s + (parseFloat(STATE.gradeQtd[g.id]) || 0), 0)
        : (parseFloat(STATE.qtdSimples) || 0);
      const totalVlr = totalQtd * (parseFloat(p.vlr_venda) || 0);
      body.innerHTML = `<div class="cpo-edit">
        <div class="cpo-edit-top">
          <img src="${esc(p.foto_principal || '')}" alt="" onerror="this.style.display='none'">
          <div class="cpo-edit-meta">
            <div><strong>Ref.:</strong> ${esc(p.cod_fabricante || p.cod_produto)}</div>
            <div>${esc(p.desc_produto || '')}</div>
            <div><strong>Preço:</strong> ${money(p.vlr_venda)}</div>
          </div>
        </div>
        ${mid}
        <label style="font-size:10px;font-weight:800;text-transform:uppercase;color:var(--text2)">Observação</label>
        <input type="text" class="cpo-obs" id="cpoObs" maxlength="100" value="${esc(STATE.obs)}" placeholder="Opcional">
        <div class="cpo-foot">
          <div class="cpo-foot-tot">Total: ${money(totalVlr)} · Itens: ${totalQtd}</div>
          <button type="button" class="cpo-save" id="cpoSalvar">SALVAR NO PEDIDO</button>
        </div>
      </div>`;

      if (temGrade) {
        body.querySelectorAll('.cpo-gbtn[data-gid]').forEach((btn) => {
          btn.onclick = () => {
            const id = parseInt(btn.dataset.gid, 10);
            const d = parseInt(btn.dataset.d, 10);
            const cur = parseFloat(STATE.gradeQtd[id]) || 0;
            STATE.gradeQtd[id] = Math.max(0, cur + d);
            render();
          };
        });
      } else {
        const inp = document.getElementById('cpoQtd');
        document.getElementById('cpoQMinus').onclick = () => {
          STATE.qtdSimples = Math.max(0, (parseFloat(STATE.qtdSimples) || 0) - 1);
          render();
        };
        document.getElementById('cpoQPlus').onclick = () => {
          STATE.qtdSimples = (parseFloat(STATE.qtdSimples) || 0) + 1;
          render();
        };
        inp.onchange = () => { STATE.qtdSimples = Math.max(0, parseFloat(inp.value) || 0); };
      }
      document.getElementById('cpoObs').oninput = (e) => { STATE.obs = e.target.value; };
      document.getElementById('cpoSalvar').onclick = salvarNoPedido;
    }
  }

  function abrirDetalhe(codProduto) {
    const p = STATE.itens.find((it) => parseInt(it.cod_produto, 10) === codProduto);
    if (!p) return;
    STATE.produto = p;
    STATE.view = 'detalhe';
    syncModesUI();
    render();
  }

  async function abrirEditar() {
    const p = STATE.produto;
    if (!p) return;
    STATE.obs = '';
    STATE.gradeItens = [];
    STATE.gradeQtd = {};
    const mv = parseInt(p.multiplo_venda, 10) || 1;
    const qmin = parseInt(p.qtd_minima_pedido, 10) || 0;
    STATE.qtdSimples = Math.max(mv, qmin, 1);

    const gradesOn = typeof _habilitaGrades !== 'undefined' && _habilitaGrades === 'S';
    if (gradesOn && p.tipograde) {
      try {
        const d = await apiJson('/api/pedidos/grade/' + p.tipograde);
        STATE.gradeItens = d.itens || [];
        STATE.gradeItens.forEach((g) => { STATE.gradeQtd[g.id] = 0; });
      } catch (_) {
        STATE.gradeItens = [];
      }
    }
    STATE.view = 'editar';
    syncModesUI();
    render();
  }

  async function salvarNoPedido() {
    const p = STATE.produto;
    if (!p) return;
    if (typeof incluirOuAtualizarMercosItem !== 'function' || typeof buildMercosItemFromProd !== 'function') {
      if (typeof toast === 'function') toast('Função de inclusão do pedido indisponível', 'err');
      return;
    }

    const temGrade = !!(typeof _habilitaGrades !== 'undefined' && _habilitaGrades === 'S' && p.tipograde && STATE.gradeItens.length);
    let qtd = 0;
    let grade_qtd = [];

    if (temGrade) {
      grade_qtd = STATE.gradeItens
        .filter((g) => (parseFloat(STATE.gradeQtd[g.id]) || 0) > 0)
        .map((g) => ({
          id_descricao_grade: g.id,
          sequencial: g.sequencial,
          nome_grade: g.nome,
          quantidade: parseFloat(STATE.gradeQtd[g.id]) || 0,
        }));
      qtd = grade_qtd.reduce((s, g) => s + (parseFloat(g.quantidade) || 0), 0);
      if (qtd <= 0) {
        if (typeof toast === 'function') toast('Informe a quantidade em pelo menos um tamanho', 'warn');
        return;
      }
    } else {
      qtd = parseFloat(STATE.qtdSimples) || 0;
      if (qtd <= 0) {
        if (typeof toast === 'function') toast('Informe a quantidade', 'warn');
        return;
      }
    }

    const prod = {
      cod_produto: p.cod_produto,
      id: p.cod_produto,
      cod_fabricante: p.cod_fabricante,
      descricao: p.desc_produto,
      desc_produto: p.desc_produto,
      unidade: p.unidade,
      tipograde: p.tipograde,
      tipoprodutograde: p.tipoprodutograde,
      foto_principal: p.foto_principal,
      vlr_venda: p.vlr_venda,
      multiplo_venda: p.multiplo_venda,
      qtd_minima_pedido: p.qtd_minima_pedido,
      precopeso: p.precopeso,
      kilo_embalagem: p.kilo_embalagem,
      disponivel: p.disponivel,
    };

    const ok = await incluirOuAtualizarMercosItem(prod, qtd, {
      silent: true,
      somar: true,
      grade_qtd: temGrade ? grade_qtd : undefined,
      id_grade: temGrade ? p.tipograde : undefined,
      tipo_grade: temGrade ? String(p.tipograde) : undefined,
      obsitem: STATE.obs || undefined,
    });
    if (!ok) return;

    if (typeof toast === 'function') toast('Produto adicionado ao pedido', 'ok');
    STATE.view = 'refs';
    STATE.produto = null;
    syncModesUI();
    render();
  }

  window.abrirCatalogoPedido = abrir;
  window.fecharCatalogoPedido = fechar;
})();
