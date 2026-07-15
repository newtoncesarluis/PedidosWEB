/**
 * Showroom AFV — módulo independente (estilo vitrine / força de vendas).
 * Navegação visual → carrinho → pré-pedido (cliente, pagamento…) → grava pedido PENDENTE.
 * Expõe: window.abrirCatalogoAfv() / window.ShowroomAfv
 */
(function () {
  'use strict';

  const S = {
    view: 'colecoes', // colecoes | refs | detalhe | editar | carrinho | prepedido | pendentes | sucesso
    catalogos: [],
    fabricas: [],
    tabelas: [],
    fonte: null,
    itens: [],
    produto: null,
    imagens: [],
    imgIdx: 0,
    gradeItens: [],
    gradeQtd: {},
    qtdSimples: 1,
    obsItem: '',
    busca: '',
    sort: 'nome',
    offset: 0,
    total: null,
    loadingMore: false,
    favoritos: new Set(),
    cart: [],
    habilitaGrade: 'N',
    condicoes: [],
    tiposPedido: [],
    pendentes: [],
    pendentesLoading: false,
    pre: {
      cod_cliente: '',
      nome_cliente: '',
      cnpj: '',
      id_condicaopagto: null,
      condicao_pagto: '',
      forma_pagto: 'BOLETO',
      tipo_pedido: 'PEDIDO',
      id_tipopedido: null,
      obs: '',
      id_tabela: '',
    },
    lastPedidos: [],
    _cliTimer: null,
  };

  const PAGE = 40;
  const CORES = ['#1a1a1a', '#0f766e', '#1e3a5f', '#7f1d1d', '#312e81', '#14532d', '#422006'];
  const FORMAS = [
    { v: 'BOLETO', l: 'Boleto' },
    { v: 'PIX', l: 'PIX' },
    { v: 'CARTAO', l: 'Cartão' },
    { v: 'DEPOSITO', l: 'Depósito' },
    { v: 'DINHEIRO', l: 'Dinheiro' },
  ];

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function money(v) {
    return (parseFloat(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  function hojeIso() {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date());
    } catch (_) {
      const d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
  }
  function toast(msg, tipo) {
    if (typeof window.toast === 'function') return window.toast(msg, tipo);
    const t = document.createElement('div');
    t.className = 'afv-toast afv-toast-' + (tipo || 'ok');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }
  function favKey() {
    return 'sysrep_afv_fav_' + (sessionStorage.getItem('userId') || localStorage.getItem('userId') || 'u');
  }
  function loadFav() {
    try { S.favoritos = new Set(JSON.parse(localStorage.getItem(favKey()) || '[]')); }
    catch (_) { S.favoritos = new Set(); }
  }
  function saveFav() {
    localStorage.setItem(favKey(), JSON.stringify([...S.favoritos]));
  }
  function cartKey() {
    return 'sysrep_afv_cart_' + (sessionStorage.getItem('userId') || localStorage.getItem('userId') || 'u');
  }
  function loadCart() {
    try { S.cart = JSON.parse(localStorage.getItem(cartKey()) || '[]'); if (!Array.isArray(S.cart)) S.cart = []; }
    catch (_) { S.cart = []; }
  }
  function saveCart() {
    localStorage.setItem(cartKey(), JSON.stringify(S.cart));
    atualizarBadge();
  }
  function cartQtd() {
    return S.cart.reduce((s, i) => s + (parseFloat(i.quantidade) || 0), 0);
  }
  function cartTotal() {
    return S.cart.reduce((s, i) => s + (parseFloat(i.quantidade) || 0) * (parseFloat(i.vlr_venda) || 0), 0);
  }
  function userNome() {
    return sessionStorage.getItem('userName') || localStorage.getItem('userName')
      || sessionStorage.getItem('nome') || localStorage.getItem('nome') || '';
  }
  function userId() {
    return parseInt(sessionStorage.getItem('userId') || localStorage.getItem('userId') || '0', 10) || 0;
  }

  async function apiJson(url, opts) {
    if (typeof window.SysRepApi?.apiFetch === 'function') {
      return window.SysRepApi.apiFetch(url, opts);
    }
    if (typeof api === 'function' && (!opts || !opts.method || opts.method === 'GET')) {
      const r = await api(url, opts);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || d.erro || ('Erro ' + r.status));
      return d;
    }
    const token = sessionStorage.getItem('token') || localStorage.getItem('token') || '';
    const headers = { Authorization: 'Bearer ' + token, ...(opts?.headers || {}) };
    if (opts?.body != null && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const r = await fetch(url, { credentials: 'include', ...opts, headers });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || d.erro || ('Erro ' + r.status));
    return d;
  }

  function ico(name) {
    const paths = {
      home: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3m10-11v10a1 1 0 01-1 1h-3m-4 0v-4a1 1 0 011-1h2a1 1 0 011 1v4"/>',
      book: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>',
      bag: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/>',
      x: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>',
      back: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M15 19l-7-7 7-7"/>',
      search: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15z"/>',
      heart: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/>',
      grid: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"/>',
      list: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M4 6h16M4 12h16M4 18h10"/>',
      truck: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0zM13 16V6H3v10h2m8 0h2m4 0h2v-7l-3-3h-5v10"/>',
    };
    return `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="20" height="20">${paths[name] || ''}</svg>`;
  }

  const CSS = `
.afv-overlay{display:none;position:fixed;inset:0;z-index:2147483600;background:var(--content-bg,#f3f4f6);color:#111}
.afv-overlay.show{display:flex;flex-direction:column}
.afv-overlay.afv-standalone{position:fixed}
.afv-main{flex:1;min-width:0;display:flex;flex-direction:column;background:var(--content-bg,#f3f4f6);color:#111;width:100%}
.afv-top{display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--card,#fff);border-bottom:1px solid var(--card-border,#e5e7eb);flex-shrink:0;flex-wrap:wrap}
.afv-top-title{flex:1;font-size:18px;font-weight:800;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--content-text,#0f172a)}
.afv-top-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.afv-top-btn{height:36px;padding:0 12px;border:1.5px solid var(--card-border,#e5e7eb);border-radius:10px;background:var(--card,#fff);color:var(--content-text,#334155);font:inherit;font-size:12px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.afv-top-btn:hover{border-color:#94a3b8}
.afv-top-btn.primary{background:#0d9488;border-color:#0d9488;color:#fff}
.afv-top-btn.cart{position:relative}
.afv-badge{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:#3b82f6;color:#fff;font-size:10px;font-weight:800}
.afv-icon-btn{width:36px;height:36px;border:none;border-radius:10px;background:#f3f4f6;color:#334155;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.afv-tools{padding:10px 14px;background:#fff;border-bottom:1px solid #e5e7eb;flex-shrink:0;display:grid;gap:10px}
.afv-search{display:flex;align-items:center;gap:8px;height:42px;padding:0 12px;border:1px solid #e5e7eb;border-radius:10px;background:#fff;color:#64748b}
.afv-search input{flex:1;border:none;outline:none;background:transparent;font:inherit;font-size:14px;color:#111}
.afv-tool-btns{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.afv-chip{height:34px;padding:0 12px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;font:inherit;font-size:11px;font-weight:800;cursor:pointer;display:inline-flex;align-items:center;gap:6px;color:#334155}
.afv-chip:hover{border-color:#94a3b8}
.afv-sort{display:flex;gap:14px;justify-content:flex-end}
.afv-sort-btn{border:none;background:none;font:inherit;font-size:11px;font-weight:800;color:#94a3b8;cursor:pointer;letter-spacing:.04em}
.afv-sort-btn.is-on{color:#0f172a}
.afv-body{flex:1;overflow:auto;padding:14px;min-height:0}
.afv-grid-col{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
.afv-banner{position:relative;min-height:170px;border-radius:8px;overflow:hidden;cursor:pointer;background:#1f2937;background-size:cover;background-position:center;box-shadow:0 4px 16px rgba(0,0,0,.12);transition:transform .15s}
.afv-banner:hover{transform:translateY(-2px)}
.afv-banner::after{content:'';position:absolute;inset:0;background:linear-gradient(transparent 30%,rgba(0,0,0,.75))}
.afv-banner-lbl{position:absolute;left:14px;right:14px;bottom:12px;z-index:1;color:#fff;font-weight:800;font-size:16px;text-shadow:0 1px 4px rgba(0,0,0,.5)}
.afv-banner-sub{display:block;font-size:11px;font-weight:600;opacity:.9;margin-top:3px}
.afv-grid-ref{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px}
.afv-ref{background:#fff;border:1px solid #e5e7eb;border-radius:4px;overflow:hidden;cursor:pointer;display:flex;flex-direction:column}
.afv-ref:hover{border-color:#94a3b8}
.afv-ref-img{aspect-ratio:1;background:#f8fafc;display:flex;align-items:center;justify-content:center;overflow:hidden}
.afv-ref-img img{width:100%;height:100%;object-fit:cover}
.afv-ref-code{padding:8px 6px;text-align:center;font-size:11px;font-weight:700;color:#64748b}
.afv-empty{padding:48px 16px;text-align:center;color:#64748b;font-size:13px}
.afv-detalhe{display:grid;grid-template-columns:72px 1fr;gap:16px;max-width:900px;margin:0 auto;min-height:calc(100% - 20px)}
.afv-thumbs{display:flex;flex-direction:column;gap:8px;align-items:center}
.afv-thumb{width:64px;height:64px;border:2px solid #e5e7eb;border-radius:6px;overflow:hidden;cursor:pointer;background:#fff;padding:0}
.afv-thumb.is-on{border-color:#0d9488}
.afv-thumb img{width:100%;height:100%;object-fit:cover}
.afv-stage{position:relative;background:#fff;border-radius:8px;border:1px solid #e5e7eb;display:flex;flex-direction:column;align-items:center;padding:16px;min-height:420px}
.afv-stage-nome{font-size:13px;font-weight:700;color:#334155;margin-bottom:12px;text-align:center}
.afv-stage-img{max-width:100%;max-height:380px;object-fit:contain}
.afv-fabs{position:absolute;right:16px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:12px}
.afv-fab{width:52px;height:52px;border-radius:50%;border:none;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;box-shadow:0 6px 16px rgba(0,0,0,.18);background:#fff;color:#64748b}
.afv-fab.cart{background:#16a34a;color:#fff}
.afv-fab.heart.is-on{color:#ef4444}
.afv-preco-box{position:absolute;right:16px;bottom:16px;background:#fff;border:1px solid #e5e7eb;border-radius:6px;padding:8px 12px;font-weight:800;font-size:14px}
.afv-edit{max-width:720px;margin:0 auto;background:#fff;border-radius:10px;border:1px solid #e5e7eb;padding:18px;display:flex;flex-direction:column;min-height:calc(100% - 8px)}
.afv-edit-top{display:flex;gap:16px;align-items:flex-start;margin-bottom:18px}
.afv-edit-top img{width:110px;height:110px;object-fit:cover;border-radius:8px;background:#f1f5f9}
.afv-edit-meta{font-size:13px;line-height:1.55}
.afv-grade{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin:8px 0 18px}
.afv-gcell{width:78px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:8px 4px;display:flex;flex-direction:column;align-items:center;gap:6px}
.afv-gbtn{width:34px;height:34px;border:none;border-radius:8px;font-size:18px;font-weight:800;cursor:pointer;line-height:1}
.afv-gbtn.plus{background:#0d9488;color:#fff}
.afv-gbtn.minus{background:#fecaca;color:#b91c1c}
.afv-gqtd{font-size:18px;font-weight:900;min-height:24px}
.afv-glbl{font-size:11px;font-weight:700;color:#64748b}
.afv-qtd-wrap{display:flex;align-items:center;justify-content:center;gap:12px;margin:12px 0}
.afv-qtd-wrap input{width:84px;height:42px;text-align:center;font-size:18px;font-weight:800;border:1.5px solid #e5e7eb;border-radius:10px}
.afv-obs{width:100%;height:40px;border:1.5px solid #e5e7eb;border-radius:10px;padding:0 12px;font:inherit;margin-top:6px}
.afv-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:auto;padding-top:16px;border-top:1px solid #e5e7eb}
.afv-save{height:46px;padding:0 22px;border:none;border-radius:10px;background:#0d9488;color:#fff;font:inherit;font-weight:800;cursor:pointer;letter-spacing:.03em}
.afv-save:disabled{opacity:.55;cursor:not-allowed}
.afv-more{display:block;margin:16px auto;height:38px;padding:0 18px;border-radius:10px;border:1.5px solid #e5e7eb;background:#fff;font:inherit;font-weight:700;cursor:pointer}
.afv-cart-list{display:grid;gap:10px;max-width:820px;margin:0 auto}
.afv-cart-row{display:flex;gap:12px;align-items:center;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px}
.afv-cart-row img{width:64px;height:64px;object-fit:cover;border-radius:8px;background:#f1f5f9;flex-shrink:0}
.afv-cart-meta{flex:1;min-width:0;font-size:13px;line-height:1.45}
.afv-cart-meta strong{display:block;font-size:13px}
.afv-cart-rm{border:none;background:#fee2e2;color:#b91c1c;border-radius:8px;height:34px;padding:0 12px;font:inherit;font-weight:700;cursor:pointer}
.afv-pre{max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:18px;display:grid;gap:12px}
.afv-pre h3{margin:0;font-size:16px}
.afv-pre label{font-size:10px;text-transform:uppercase;font-weight:800;color:#64748b;display:block;margin-bottom:4px}
.afv-pre input,.afv-pre select,.afv-pre textarea{width:100%;height:40px;border:1.5px solid #e5e7eb;border-radius:10px;padding:0 12px;font:inherit;background:#fff;color:#111;box-sizing:border-box}
.afv-pre textarea{height:72px;padding:10px 12px;resize:vertical}
.afv-pre select option{color:#111;background:#fff}
.afv-ac{position:relative}
.afv-ac-list{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:20;max-height:220px;overflow:auto;background:#fff;border:1.5px solid #e5e7eb;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);display:none}
.afv-ac-list.show{display:block}
.afv-ac-item{padding:10px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #f1f5f9}
.afv-ac-item:hover{background:#f0fdfa}
.afv-ac-item small{display:block;font-size:11px;color:#64748b;margin-top:2px}
.afv-cli-sel{display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:10px;background:#f0fdfa;border:1px solid #99f6e4;font-size:13px}
.afv-cli-sel button{margin-left:auto;border:none;background:none;color:#0d9488;font:inherit;font-weight:700;cursor:pointer}
.afv-resumo{font-size:13px;color:#334155;background:#f8fafc;border-radius:10px;padding:10px 12px;line-height:1.5}
.afv-ok{max-width:480px;margin:40px auto;text-align:center;background:#fff;border-radius:12px;border:1px solid #e5e7eb;padding:28px 20px}
.afv-ok h3{margin:0 0 8px;color:#16a34a}
.afv-pend-list{display:grid;gap:10px;max-width:900px;margin:0 auto}
.afv-pend-row{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;background:var(--card,#fff);border:1px solid var(--card-border,#e5e7eb);border-radius:10px;padding:12px 14px;cursor:pointer;flex-wrap:wrap}
.afv-pend-row:hover{border-color:#0d9488}
.afv-pend-meta{font-size:13px;line-height:1.45;min-width:0;flex:1}
.afv-pend-meta strong{display:block;font-size:14px}
.afv-pend-sub{font-size:11px;color:#64748b;margin-top:2px}
.afv-pend-val{font-size:14px;font-weight:800;color:#0d9488;white-space:nowrap}
.afv-pend-badge{display:inline-block;font-size:10px;font-weight:800;padding:2px 8px;border-radius:999px;background:#fef3c7;color:#b45309;margin-left:6px}
.afv-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483646;background:#0f172a;color:#fff;padding:10px 18px;border-radius:999px;font-size:13px;font-weight:700;box-shadow:0 8px 24px rgba(0,0,0,.25)}
.afv-toast-err{background:#b91c1c}.afv-toast-warn{background:#b45309}
@media(max-width:720px){
  .afv-detalhe{grid-template-columns:1fr}
  .afv-thumbs{flex-direction:row;overflow:auto}
  .afv-fabs{position:static;transform:none;flex-direction:row;justify-content:center;margin-top:14px}
  .afv-preco-box{position:static;margin-top:12px}
  .afv-tool-btns{justify-content:stretch}
  .afv-chip{flex:1;justify-content:center}
  .afv-top-title{font-size:16px;min-width:120px}
  .afv-top-btn{font-size:11px;padding:0 10px}
  .afv-top-btn .afv-badge{margin-left:2px}
}
`;

  function ensure(opts) {
    let el = document.getElementById('catalogoAfvOverlay');
    if (el && el.querySelector('.afv-rail')) {
      el.remove();
      el = null;
    }
    if (el) return el;
    el = document.createElement('div');
    el.id = 'catalogoAfvOverlay';
    el.className = 'afv-overlay' + (opts?.standalone ? ' afv-standalone' : '');
    el.innerHTML = `
      <div class="afv-main">
        <header class="afv-top">
          <button type="button" class="afv-icon-btn" id="afvBack" title="Voltar">${ico('back')}</button>
          <div class="afv-top-title" id="afvTitle">Coleções</div>
          <div class="afv-top-actions">
            <button type="button" class="afv-top-btn cart" id="afvBtnCart" title="Carrinho">
              ${ico('bag')} Carrinho <span class="afv-badge" id="afvBadge">0</span>
            </button>
            <button type="button" class="afv-top-btn primary" id="afvBtnPendentes" title="Pedidos pendentes (mesma regra de visibilidade do sistema)">
              Pedidos pendentes
            </button>
            <button type="button" class="afv-icon-btn" id="afvClose" title="Fechar">${ico('x')}</button>
          </div>
        </header>
        <div class="afv-tools" id="afvTools">
          <div class="afv-search">
            ${ico('search')}
            <input type="search" id="afvBusca" placeholder="Pesquisar" autocomplete="off">
          </div>
          <div class="afv-tool-btns" id="afvToolBtns">
            <button type="button" class="afv-chip" data-acao="fav">${ico('heart')} Favoritos</button>
            <button type="button" class="afv-chip" data-acao="completo">${ico('grid')} Catálogo completo</button>
          </div>
          <div class="afv-sort" id="afvSort">
            <button type="button" class="afv-sort-btn" data-sort="cadastro">Cadastro ▾</button>
            <button type="button" class="afv-sort-btn is-on" data-sort="nome">Nome</button>
          </div>
        </div>
        <div class="afv-body" id="afvBody"></div>
      </div>`;
    document.body.appendChild(el);

    if (!document.getElementById('afvStyles')) {
      const st = document.createElement('style');
      st.id = 'afvStyles';
      st.textContent = CSS;
      document.head.appendChild(st);
    } else {
      document.getElementById('afvStyles').textContent = CSS;
    }

    document.getElementById('afvClose').onclick = fechar;
    document.getElementById('afvBack').onclick = voltar;
    document.getElementById('afvBtnCart').onclick = () => { S.view = 'carrinho'; render(); };
    document.getElementById('afvBtnPendentes').onclick = () => abrirPendentes();
    document.getElementById('afvBusca').oninput = (e) => {
      S.busca = e.target.value.trim();
      clearTimeout(S._t);
      S._t = setTimeout(() => {
        if (S.view === 'refs' && S.fonte && S.fonte.tipo !== 'colecao' && S.fonte.tipo !== 'favoritos') {
          carregarProdutos({ reset: true });
        } else if (S.view === 'pendentes') {
          carregarPendentes();
        } else render();
      }, 280);
    };
    document.getElementById('afvToolBtns').onclick = (e) => {
      const b = e.target.closest('[data-acao]');
      if (!b) return;
      if (b.dataset.acao === 'fav') abrirFavoritos();
      if (b.dataset.acao === 'completo') abrirCatalogoCompleto();
    };
    document.getElementById('afvSort').onclick = (e) => {
      const b = e.target.closest('[data-sort]');
      if (!b) return;
      S.sort = b.dataset.sort;
      document.querySelectorAll('.afv-sort-btn').forEach((x) => x.classList.toggle('is-on', x === b));
      render();
    };
    document.getElementById('afvBody').addEventListener('scroll', onScroll);
    return el;
  }

  function irPedidos(filtroPendentes) {
    const url = filtroPendentes
      ? '/pages/pedidos.html?status=PENDENTE'
      : '/pages/pedidos.html';
    const label = filtroPendentes ? 'Pedidos pendentes' : 'Pedidos';
    try {
      if (typeof parent?.openTab === 'function') {
        parent.openTab(url, label);
        return;
      }
    } catch (_) {}
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'ms-navigate', href: url, label }, '*');
        return;
      }
    } catch (_) {}
    location.href = url;
  }

  function abrirPedidoId(id, numero) {
    const url = '/pages/pedidos.html?id=' + encodeURIComponent(id);
    const label = 'Pedido #' + (numero || id);
    try {
      if (typeof parent?.openTab === 'function') {
        parent.openTab(url, label);
        return;
      }
    } catch (_) {}
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'ms-navigate', href: url, label }, '*');
        return;
      }
    } catch (_) {}
    location.href = url;
  }

  function fechar() {
    const el = document.getElementById('catalogoAfvOverlay');
    if (el?.classList.contains('afv-standalone')) {
      try {
        if (typeof parent?.closeActiveTab === 'function') { parent.closeActiveTab(); return; }
      } catch (_) {}
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: 'ms-navigate', href: '/home.html', label: 'Início' }, '*');
          return;
        }
      } catch (_) {}
      try {
        if (typeof parent?.openTab === 'function') { parent.openTab('/home.html', 'Início'); return; }
      } catch (_) {}
      location.href = '/home.html';
      return;
    }
    el?.classList.remove('show');
  }

  function voltar() {
    if (S.view === 'sucesso') { S.view = 'colecoes'; render(); return; }
    if (S.view === 'pendentes') { S.view = 'colecoes'; render(); return; }
    if (S.view === 'prepedido') { S.view = 'carrinho'; render(); return; }
    if (S.view === 'carrinho') { S.view = 'colecoes'; render(); return; }
    if (S.view === 'editar') { S.view = 'detalhe'; render(); return; }
    if (S.view === 'detalhe') { S.view = 'refs'; S.produto = null; render(); return; }
    if (S.view === 'refs') {
      S.view = 'colecoes';
      S.fonte = null;
      S.itens = [];
      S.busca = '';
      const inp = document.getElementById('afvBusca');
      if (inp) inp.value = '';
      render();
      return;
    }
    fechar();
  }

  function atualizarBadge() {
    const b = document.getElementById('afvBadge');
    if (b) b.textContent = String(Math.round(cartQtd()) || S.cart.length || 0);
  }

  async function abrirPendentes() {
    S.view = 'pendentes';
    S.busca = '';
    const inp = document.getElementById('afvBusca');
    if (inp) {
      inp.value = '';
      inp.placeholder = 'Buscar nº ou cliente…';
    }
    render();
    await carregarPendentes();
  }

  async function carregarPendentes() {
    S.pendentesLoading = true;
    const body = document.getElementById('afvBody');
    if (body && S.view === 'pendentes') {
      body.innerHTML = '<div class="afv-empty">Carregando pedidos pendentes…</div>';
    }
    try {
      const params = new URLSearchParams({
        status: 'PENDENTE',
        limit: '80',
        page: '1',
        sort: 'p.id',
        dir: 'DESC',
      });
      if (S.busca) params.set('q', S.busca);
      const d = await apiJson('/api/pedidos?' + params.toString());
      S.pendentes = d.pedidos || [];
    } catch (e) {
      S.pendentes = [];
      toast(e.message || 'Erro ao listar pendentes', 'err');
    } finally {
      S.pendentesLoading = false;
      if (S.view === 'pendentes') render();
    }
  }

  async function abrir(opts) {
    loadFav();
    loadCart();
    const el = ensure(opts);
    S.view = 'colecoes';
    S.fonte = null;
    S.itens = [];
    S.produto = null;
    S.busca = '';
    const inp = document.getElementById('afvBusca');
    if (inp) inp.value = '';
    el.classList.add('show');
    document.getElementById('afvBody').innerHTML = '<div class="afv-empty">Carregando coleções…</div>';
    atualizarBadge();
    await Promise.all([
      carregarColecoes(),
      carregarFabricas(),
      carregarTabelas(),
      carregarConfig(),
      carregarCondicoes(),
      carregarTiposPedido(),
    ]);
    render();
  }

  async function carregarConfig() {
    try {
      const d = await apiJson('/api/config/sistema');
      S.habilitaGrade = (d.habilitapedidograde || 'N') === 'S' ? 'S' : 'N';
    } catch (_) { S.habilitaGrade = 'N'; }
  }

  async function carregarCondicoes() {
    try {
      const d = await apiJson('/api/lookups/condicoes-pagamento');
      S.condicoes = Array.isArray(d) ? d : (d.data || []);
    } catch (_) {
      try {
        const d2 = await apiJson('/api/tabela-precos/condicoes-pagamento');
        S.condicoes = d2.condicoes || d2.data || [];
      } catch (e2) { S.condicoes = []; }
    }
  }

  async function carregarTiposPedido() {
    try {
      const d = await apiJson('/api/pedidos/lookup/tipos');
      S.tiposPedido = d.tipos || d.data || (Array.isArray(d) ? d : []);
    } catch (_) {
      try {
        const d2 = await apiJson('/api/cadastros/tipo-pedidos?limit=100');
        S.tiposPedido = d2.data || d2.tipos || [];
      } catch (e2) { S.tiposPedido = []; }
    }
  }

  async function carregarColecoes() {
    try {
      const d = await apiJson('/api/catalogos');
      S.catalogos = d.catalogos || [];
    } catch (_) { S.catalogos = []; }
  }

  async function carregarFabricas() {
    try {
      const d = await apiJson('/api/fornecedores?limit=500&status=A&somente_fabricas=true');
      S.fabricas = d.fornecedores || d.data || (Array.isArray(d) ? d : []);
    } catch (_) {
      try {
        const d2 = await apiJson('/api/lookups/fornecedores');
        S.fabricas = Array.isArray(d2) ? d2 : [];
      } catch (e2) { S.fabricas = []; }
    }
  }

  async function carregarTabelas() {
    const map = new Map();
    try {
      const d = await apiJson('/api/tabela-precos/disponiveis-para/0/0/' + (userId() || 0));
      (d.tabelas || []).forEach((t) => {
        const id = t.id_tabela || t.id;
        if (id) map.set(String(id), { id, descricao: t.descricao || ('Tabela ' + id) });
      });
    } catch (_) {}
    try {
      const d2 = await apiJson('/api/tabela-precos?limit=80');
      (d2.tabelas || []).forEach((t) => {
        if (!t.id || map.has(String(t.id))) return;
        const ativo = String(t.Tabela_Ativa || t.ativo || 'S').toUpperCase();
        if (ativo === 'N' || ativo === 'I') return;
        map.set(String(t.id), { id: t.id, descricao: t.Descricao || t.descricao || ('Tabela ' + t.id) });
      });
    } catch (_) {}
    S.tabelas = Array.from(map.values());
  }

  function normItem(p, fornFallback) {
    const forn = parseInt(p.cod_fornecedorpadrao || p.cod_fornecedor || fornFallback, 10) || null;
    return {
      cod_produto: parseInt(p.cod_produto || p.id || p.ID, 10),
      cod_fabricante: p.cod_fabricante || '',
      desc_produto: p.desc_produto || p.descricao || '',
      unidade: p.unidade || '',
      tipograde: parseInt(p.tipograde, 10) || 0,
      tipoprodutograde: p.tipoprodutograde || '',
      foto_principal: p.foto_principal || '',
      vlr_venda: parseFloat(p.vlr_venda ?? p.preco_da_tabela) || 0,
      multiplo_venda: p.multiplo_venda,
      qtd_minima_pedido: p.qtd_minima_pedido,
      precopeso: p.precopeso,
      kilo_embalagem: p.kilo_embalagem,
      disponivel: p.disponivel,
      cod_fornecedor: forn,
      nome_fornecedor: p.nome_fornecedor || '',
    };
  }

  async function abrirColecao(id) {
    document.getElementById('afvBody').innerHTML = '<div class="afv-empty">Carregando referências…</div>';
    try {
      const d = await apiJson('/api/catalogos/' + id);
      const fornCat = d.catalogo?.cod_fornecedor || null;
      S.fonte = { tipo: 'colecao', id, nome: d.catalogo?.nome || 'Coleção', cod_fornecedor: fornCat };
      S.itens = (d.itens || []).map((p) => normItem(p, fornCat));
      S.total = S.itens.length;
      S.offset = S.itens.length;
      S.view = 'refs';
      S.busca = '';
      const inp = document.getElementById('afvBusca');
      if (inp) inp.value = '';
      render();
    } catch (e) {
      toast(e.message || 'Erro', 'err');
    }
  }

  async function abrirFabrica(id, nome) {
    S.fonte = { tipo: 'fabrica', id, nome: nome || ('Fábrica #' + id), cod_fornecedor: id };
    S.view = 'refs';
    S.busca = '';
    const inp = document.getElementById('afvBusca');
    if (inp) inp.value = '';
    await carregarProdutos({ reset: true });
  }

  async function abrirTabela(id, nome) {
    S.fonte = { tipo: 'tabela', id, nome: nome || ('Tabela #' + id) };
    S.pre.id_tabela = String(id);
    S.view = 'refs';
    S.busca = '';
    const inp = document.getElementById('afvBusca');
    if (inp) inp.value = '';
    await carregarProdutos({ reset: true });
  }

  async function abrirCatalogoCompleto() {
    if (S.fabricas[0]) {
      await abrirFabrica(S.fabricas[0].id, S.fabricas[0].nome);
      return;
    }
    toast('Cadastre fábricas ou use uma coleção', 'warn');
  }

  async function abrirFavoritos() {
    const ids = [...S.favoritos];
    if (!ids.length) {
      toast('Nenhum favorito ainda — toque no coração no detalhe', 'ok');
      return;
    }
    S.fonte = { tipo: 'favoritos', id: 'fav', nome: 'Favoritos' };
    S.view = 'refs';
    document.getElementById('afvBody').innerHTML = '<div class="afv-empty">Carregando favoritos…</div>';
    const itens = [];
    for (const id of ids.slice(0, 80)) {
      try {
        const d = await apiJson('/api/pedidos/produtos/busca?catalogo=1&q=' + encodeURIComponent(String(id)) + '&limit=5');
        const row = (d.data || []).find((p) => parseInt(p.cod_produto || p.id, 10) === parseInt(id, 10));
        if (row) itens.push(normItem(row));
      } catch (_) {}
    }
    S.itens = itens;
    S.total = itens.length;
    render();
  }

  async function carregarProdutos({ reset = false } = {}) {
    if (!S.fonte || S.fonte.tipo === 'colecao' || S.fonte.tipo === 'favoritos') return;
    if (S.loadingMore) return;
    if (reset) {
      S.itens = [];
      S.offset = 0;
      S.total = null;
      document.getElementById('afvBody').innerHTML = '<div class="afv-empty">Carregando referências…</div>';
    }
    S.loadingMore = true;
    try {
      const params = new URLSearchParams({
        catalogo: '1',
        limit: String(PAGE),
        offset: String(S.offset),
        q: S.busca || '',
      });
      if (S.fonte.tipo === 'fabrica') {
        params.set('id_fornecedor', S.fonte.id);
        if (S.pre.id_tabela) params.set('id_tabela', S.pre.id_tabela);
      } else if (S.fonte.tipo === 'tabela') {
        params.set('id_tabela', S.fonte.id);
      }
      const d = await apiJson('/api/pedidos/produtos/busca?' + params.toString());
      const fornFb = S.fonte.tipo === 'fabrica' ? S.fonte.id : null;
      const rows = (d.data || []).map((p) => normItem(p, fornFb));
      S.itens = reset ? rows : S.itens.concat(rows);
      S.offset = S.itens.length;
      S.total = d.total != null ? d.total : null;
      render();
    } catch (e) {
      if (reset) document.getElementById('afvBody').innerHTML = `<div class="afv-empty">${esc(e.message)}</div>`;
    } finally {
      S.loadingMore = false;
    }
  }

  function onScroll() {
    if (S.view !== 'refs' || !S.fonte || S.fonte.tipo === 'colecao' || S.fonte.tipo === 'favoritos') return;
    if (S.loadingMore) return;
    if (S.total != null && S.itens.length >= S.total) return;
    const body = document.getElementById('afvBody');
    if (body && body.scrollTop + body.clientHeight > body.scrollHeight - 140) {
      carregarProdutos({ reset: false });
    }
  }

  function sortItens(list) {
    const arr = [...list];
    if (S.sort === 'cadastro') arr.sort((a, b) => (b.cod_produto || 0) - (a.cod_produto || 0));
    else arr.sort((a, b) => String(a.desc_produto || a.cod_fabricante || '').localeCompare(String(b.desc_produto || b.cod_fabricante || ''), 'pt-BR'));
    return arr;
  }

  function filtrarBusca(list, fields) {
    const q = (S.busca || '').toLowerCase();
    if (!q) return list;
    return list.filter((x) => fields(x).toLowerCase().includes(q));
  }

  function render() {
    const title = document.getElementById('afvTitle');
    const tools = document.getElementById('afvTools');
    const body = document.getElementById('afvBody');
    const sort = document.getElementById('afvSort');
    if (!body) return;
    atualizarBadge();

    if (S.view === 'colecoes') {
      title.textContent = 'Coleções';
      tools.style.display = '';
      sort.style.display = '';
      const toolBtns = document.getElementById('afvToolBtns');
      if (toolBtns) toolBtns.style.display = '';
      const buscaInp = document.getElementById('afvBusca');
      if (buscaInp) buscaInp.placeholder = 'Pesquisar';
      const cards = [];
      filtrarBusca(S.catalogos, (c) => `${c.nome} ${c.subtitulo || ''} ${c.nome_fornecedor || ''}`).forEach((c) => {
        const bg = c.imagem_capa
          ? `background-image:url('${esc(c.imagem_capa)}')`
          : `background:${esc(c.cor_fundo || '#1f2937')}`;
        cards.push(`<div class="afv-banner" data-tipo="colecao" data-id="${c.id}" style="${bg}">
          <div class="afv-banner-lbl">${esc(c.nome)}
            <span class="afv-banner-sub">${esc(c.subtitulo || (c.qtd_itens || 0) + ' referências')}</span>
          </div>
        </div>`);
      });
      filtrarBusca(S.fabricas, (f) => `${f.nome || ''} ${f.id}`).slice(0, 12).forEach((f, i) => {
        cards.push(`<div class="afv-banner" data-tipo="fabrica" data-id="${f.id}" data-nome="${esc(f.nome || '')}" style="background:${CORES[i % CORES.length]}">
          <div class="afv-banner-lbl">${esc(f.nome || ('#' + f.id))}
            <span class="afv-banner-sub">Catálogo completo da fábrica</span>
          </div>
        </div>`);
      });
      filtrarBusca(S.tabelas, (t) => `${t.descricao || ''} ${t.id}`).slice(0, 8).forEach((t, i) => {
        cards.push(`<div class="afv-banner" data-tipo="tabela" data-id="${t.id}" data-nome="${esc(t.descricao || '')}" style="background:${CORES[(i + 3) % CORES.length]}">
          <div class="afv-banner-lbl">${esc(t.descricao || ('Tabela ' + t.id))}
            <span class="afv-banner-sub">Tabela de preço</span>
          </div>
        </div>`);
      });
      if (!cards.length) {
        body.innerHTML = `<div class="afv-empty">Nenhuma coleção.<br>Cadastre em Comercial → Catálogos Visuais<br>ou use CATÁLOGO COMPLETO / uma fábrica.</div>`;
        return;
      }
      body.innerHTML = `<div class="afv-grid-col">${cards.join('')}</div>`;
      body.querySelectorAll('.afv-banner').forEach((el) => {
        el.onclick = () => {
          if (el.dataset.tipo === 'colecao') abrirColecao(el.dataset.id);
          else if (el.dataset.tipo === 'fabrica') abrirFabrica(el.dataset.id, el.dataset.nome);
          else abrirTabela(el.dataset.id, el.dataset.nome);
        };
      });
      return;
    }

    if (S.view === 'refs') {
      title.textContent = 'Referências';
      tools.style.display = '';
      sort.style.display = '';
      const toolBtns = document.getElementById('afvToolBtns');
      if (toolBtns) toolBtns.style.display = '';
      let list = S.fonte?.tipo === 'colecao' || S.fonte?.tipo === 'favoritos'
        ? filtrarBusca(S.itens, (it) => `${it.cod_fabricante} ${it.desc_produto} ${it.cod_produto}`)
        : S.itens;
      list = sortItens(list);
      if (!list.length) {
        body.innerHTML = `<div class="afv-empty">Nenhuma referência em «${esc(S.fonte?.nome || '')}».</div>`;
        return;
      }
      const more = (S.fonte?.tipo !== 'colecao' && S.fonte?.tipo !== 'favoritos' && (S.total == null || S.itens.length < S.total))
        ? `<button type="button" class="afv-more" id="afvMore">${S.loadingMore ? 'Carregando…' : 'Carregar mais'}</button>`
        : '';
      body.innerHTML = `<div class="afv-grid-ref">${list.map((it) => {
        const foto = it.foto_principal
          ? `<img src="${esc(it.foto_principal)}" alt="" loading="lazy" onerror="this.parentElement.textContent='📷'">`
          : '📷';
        return `<div class="afv-ref" data-id="${it.cod_produto}">
          <div class="afv-ref-img">${foto}</div>
          <div class="afv-ref-code">${esc(it.cod_fabricante || it.cod_produto)}</div>
        </div>`;
      }).join('')}</div>${more}`;
      body.querySelectorAll('.afv-ref').forEach((el) => {
        el.onclick = () => abrirDetalhe(parseInt(el.dataset.id, 10));
      });
      document.getElementById('afvMore')?.addEventListener('click', () => carregarProdutos({ reset: false }));
      return;
    }

    if (S.view === 'detalhe') {
      const p = S.produto;
      title.textContent = 'Ref.: ' + (p.cod_fabricante || p.cod_produto);
      tools.style.display = 'none';
      const imgs = S.imagens.length ? S.imagens : (p.foto_principal ? [p.foto_principal] : []);
      const src = imgs[S.imgIdx] || p.foto_principal || '';
      const favOn = S.favoritos.has(String(p.cod_produto));
      body.innerHTML = `<div class="afv-detalhe">
        <div class="afv-thumbs">
          <button type="button" class="afv-icon-btn" id="afvThumbUp" title="Anterior">▲</button>
          ${imgs.map((u, i) => `<button type="button" class="afv-thumb ${i === S.imgIdx ? 'is-on' : ''}" data-i="${i}">
            <img src="${esc(u)}" alt="">
          </button>`).join('') || '<div class="afv-empty" style="padding:8px">Sem foto</div>'}
          <button type="button" class="afv-icon-btn" id="afvThumbDn" title="Próxima">▼</button>
        </div>
        <div class="afv-stage">
          <div class="afv-stage-nome">${esc(p.cod_fabricante || p.cod_produto)} — ${esc(p.desc_produto || '')}</div>
          ${src ? `<img class="afv-stage-img" src="${esc(src)}" alt="">` : ''}
          <div class="afv-fabs">
            <button type="button" class="afv-fab heart ${favOn ? 'is-on' : ''}" id="afvFav" title="Favorito">${ico('heart')}</button>
            <button type="button" class="afv-fab" id="afvInfo" title="Detalhes">${ico('list')}</button>
            <button type="button" class="afv-fab cart" id="afvCart" title="Incluir no carrinho">${ico('bag')}</button>
          </div>
          <div class="afv-preco-box">${money(p.vlr_venda)}</div>
        </div>
      </div>`;
      document.getElementById('afvCart').onclick = () => abrirEditar();
      document.getElementById('afvFav').onclick = () => {
        const k = String(p.cod_produto);
        if (S.favoritos.has(k)) S.favoritos.delete(k);
        else S.favoritos.add(k);
        saveFav();
        render();
      };
      document.getElementById('afvInfo').onclick = () => toast((p.desc_produto || '') + ' · ' + money(p.vlr_venda), 'ok');
      body.querySelectorAll('.afv-thumb').forEach((t) => {
        t.onclick = () => { S.imgIdx = parseInt(t.dataset.i, 10) || 0; render(); };
      });
      document.getElementById('afvThumbUp').onclick = () => {
        if (imgs.length) { S.imgIdx = (S.imgIdx - 1 + imgs.length) % imgs.length; render(); }
      };
      document.getElementById('afvThumbDn').onclick = () => {
        if (imgs.length) { S.imgIdx = (S.imgIdx + 1) % imgs.length; render(); }
      };
      return;
    }

    if (S.view === 'editar') {
      const p = S.produto;
      title.textContent = 'Editar Produto';
      tools.style.display = 'none';
      const temGrade = !!(S.habilitaGrade === 'S' && p.tipograde && S.gradeItens.length);
      let mid = '';
      if (temGrade) {
        mid = `<div class="afv-grade">${S.gradeItens.map((g) => {
          const q = S.gradeQtd[g.id] || 0;
          return `<div class="afv-gcell">
            <button type="button" class="afv-gbtn plus" data-gid="${g.id}" data-d="1">+</button>
            <div class="afv-glbl">${esc(g.nome)}</div>
            <div class="afv-gqtd">${q}</div>
            <button type="button" class="afv-gbtn minus" data-gid="${g.id}" data-d="-1">−</button>
          </div>`;
        }).join('')}</div>`;
      } else {
        mid = `<div class="afv-qtd-wrap">
          <button type="button" class="afv-gbtn minus" id="afvQMinus">−</button>
          <input type="number" id="afvQtd" min="0" value="${S.qtdSimples}">
          <button type="button" class="afv-gbtn plus" id="afvQPlus">+</button>
        </div>`;
      }
      const totalQtd = temGrade
        ? S.gradeItens.reduce((s, g) => s + (parseFloat(S.gradeQtd[g.id]) || 0), 0)
        : (parseFloat(S.qtdSimples) || 0);
      const totalVlr = totalQtd * (parseFloat(p.vlr_venda) || 0);
      body.innerHTML = `<div class="afv-edit">
        <div class="afv-edit-top">
          <img src="${esc(p.foto_principal || '')}" alt="" onerror="this.style.display='none'">
          <div class="afv-edit-meta">
            <div><strong>Ref.:</strong> ${esc(p.cod_fabricante || p.cod_produto)}</div>
            <div>${esc(p.desc_produto || '')}</div>
            <div><strong>Preço:</strong> ${money(p.vlr_venda)}</div>
          </div>
        </div>
        ${mid}
        <label style="font-size:10px;font-weight:800;text-transform:uppercase;color:#64748b">Observação</label>
        <input type="text" class="afv-obs" id="afvObs" maxlength="100" value="${esc(S.obsItem)}" placeholder="Opcional">
        <div class="afv-foot">
          <div><strong>Total:</strong> ${money(totalVlr)} &nbsp;·&nbsp; <strong>Itens:</strong> ${totalQtd}</div>
          <button type="button" class="afv-save" id="afvSalvar">ADICIONAR AO CARRINHO</button>
        </div>
      </div>`;
      if (temGrade) {
        body.querySelectorAll('.afv-gbtn[data-gid]').forEach((btn) => {
          btn.onclick = () => {
            const id = parseInt(btn.dataset.gid, 10);
            const d = parseInt(btn.dataset.d, 10);
            S.gradeQtd[id] = Math.max(0, (parseFloat(S.gradeQtd[id]) || 0) + d);
            render();
          };
        });
      } else {
        document.getElementById('afvQMinus').onclick = () => { S.qtdSimples = Math.max(0, (parseFloat(S.qtdSimples) || 0) - 1); render(); };
        document.getElementById('afvQPlus').onclick = () => { S.qtdSimples = (parseFloat(S.qtdSimples) || 0) + 1; render(); };
        document.getElementById('afvQtd').onchange = (e) => { S.qtdSimples = Math.max(0, parseFloat(e.target.value) || 0); };
      }
      document.getElementById('afvObs').oninput = (e) => { S.obsItem = e.target.value; };
      document.getElementById('afvSalvar').onclick = adicionarAoCarrinho;
      return;
    }

    if (S.view === 'carrinho') {
      title.textContent = 'Carrinho';
      tools.style.display = 'none';
      if (!S.cart.length) {
        body.innerHTML = `<div class="afv-empty">Carrinho vazio.<br>Escolha uma coleção e adicione produtos.</div>`;
        return;
      }
      body.innerHTML = `<div class="afv-cart-list">
        ${S.cart.map((it, idx) => `
          <div class="afv-cart-row">
            <img src="${esc(it.foto_principal || '')}" alt="" onerror="this.style.display='none'">
            <div class="afv-cart-meta">
              <strong>${esc(it.cod_fabricante || it.cod_produto)} — ${esc(it.desc_produto || '')}</strong>
              <div>${it.quantidade} × ${money(it.vlr_venda)} = <strong>${money((it.quantidade || 0) * (it.vlr_venda || 0))}</strong></div>
              ${it.grade_resumo ? `<div style="font-size:11px;color:#64748b">${esc(it.grade_resumo)}</div>` : ''}
            </div>
            <button type="button" class="afv-cart-rm" data-idx="${idx}">Remover</button>
          </div>`).join('')}
        <div class="afv-resumo">
          <strong>${S.cart.length}</strong> produto(s) · Qtd total <strong>${cartQtd()}</strong> · Total <strong>${money(cartTotal())}</strong>
        </div>
        <div class="afv-foot" style="border:none;padding-top:0">
          <button type="button" class="afv-chip" id="afvLimparCart">Limpar carrinho</button>
          <button type="button" class="afv-save" id="afvIrPre">CONTINUAR → PRÉ-PEDIDO</button>
        </div>
      </div>`;
      body.querySelectorAll('.afv-cart-rm').forEach((btn) => {
        btn.onclick = () => {
          S.cart.splice(parseInt(btn.dataset.idx, 10), 1);
          saveCart();
          render();
        };
      });
      document.getElementById('afvLimparCart').onclick = () => {
        S.cart = [];
        saveCart();
        render();
      };
      document.getElementById('afvIrPre').onclick = () => { S.view = 'prepedido'; render(); };
      return;
    }

    if (S.view === 'prepedido') {
      title.textContent = 'Pré-pedido';
      tools.style.display = 'none';
      const condOpts = S.condicoes.map((c) => {
        const id = c.id || c.id_forma || c.id_condicao;
        const desc = c.descricao || c.nome || '';
        const sel = String(S.pre.id_condicaopagto || '') === String(id) || S.pre.condicao_pagto === desc ? ' selected' : '';
        return `<option value="${esc(desc)}" data-id="${id || ''}"${sel}>${esc(desc)}</option>`;
      }).join('');
      const tipoOpts = S.tiposPedido.length
        ? S.tiposPedido.map((t) => {
            const desc = String(t.tipo_pedido || t.descricao || t.nome || 'PEDIDO').toUpperCase();
            const sel = S.pre.tipo_pedido === desc || String(S.pre.id_tipopedido) === String(t.id) ? ' selected' : '';
            return `<option value="${esc(desc)}" data-id="${t.id}"${sel}>${esc(t.tipo_pedido || t.descricao || t.nome)}</option>`;
          }).join('')
        : `<option value="PEDIDO"${S.pre.tipo_pedido === 'PEDIDO' ? ' selected' : ''}>PEDIDO</option>
           <option value="ORCAMENTO"${S.pre.tipo_pedido === 'ORCAMENTO' || S.pre.tipo_pedido === 'ORÇAMENTO' ? ' selected' : ''}>ORÇAMENTO</option>`;
      const formaOpts = FORMAS.map((f) =>
        `<option value="${f.v}"${S.pre.forma_pagto === f.v ? ' selected' : ''}>${f.l}</option>`
      ).join('');
      const cliSel = S.pre.cod_cliente
        ? `<div class="afv-cli-sel" id="afvCliSel"><span>#${esc(S.pre.cod_cliente)} — ${esc(S.pre.nome_cliente)}</span>
            <button type="button" id="afvCliLimpar">Trocar</button></div>`
        : '';
      body.innerHTML = `<div class="afv-pre">
        <h3>Dados do pré-pedido</h3>
        <p style="margin:0;font-size:12px;color:#64748b">Informe o cliente e as condições. Ao finalizar, o pedido entra como <strong>PENDENTE</strong> na tela de Pedidos.</p>
        <div class="afv-resumo"><strong>${S.cart.length}</strong> itens · Total <strong>${money(cartTotal())}</strong></div>
        <div>
          <label>Cliente *</label>
          <div class="afv-ac">
            <input type="search" id="afvCliBusca" placeholder="Buscar nome, apelido ou CPF/CNPJ…" autocomplete="off" ${S.pre.cod_cliente ? 'style="display:none"' : ''}>
            <div id="afvCliList" class="afv-ac-list"></div>
            ${cliSel}
          </div>
        </div>
        <div>
          <label>Condição de pagamento</label>
          <select id="afvCond">${condOpts || '<option value="">—</option>'}</select>
        </div>
        <div>
          <label>Forma de pagamento</label>
          <select id="afvForma">${formaOpts}</select>
        </div>
        <div>
          <label>Tipo do pedido</label>
          <select id="afvTipo">${tipoOpts}</select>
        </div>
        <div>
          <label>Observação</label>
          <textarea id="afvObsPed" placeholder="Opcional">${esc(S.pre.obs)}</textarea>
        </div>
        <div class="afv-foot" style="border:none;padding-top:4px">
          <button type="button" class="afv-chip" id="afvVoltarCart">← Carrinho</button>
          <button type="button" class="afv-save" id="afvFinalizar">FINALIZAR → PEDIDO PENDENTE</button>
        </div>
      </div>`;
      bindPrePedido();
      return;
    }

    if (S.view === 'pendentes') {
      title.textContent = 'Pedidos pendentes';
      tools.style.display = '';
      sort.style.display = 'none';
      document.getElementById('afvToolBtns').style.display = 'none';
      const buscaInp = document.getElementById('afvBusca');
      if (buscaInp) buscaInp.placeholder = 'Buscar nº ou cliente…';
      if (S.pendentesLoading) {
        body.innerHTML = '<div class="afv-empty">Carregando…</div>';
        return;
      }
      if (!S.pendentes.length) {
        body.innerHTML = `<div class="afv-empty">Nenhum pedido pendente visível para o seu perfil.<br>
          <button type="button" class="afv-chip" id="afvAbrirListaPed" style="margin-top:12px">Abrir tela de Pedidos</button></div>`;
        document.getElementById('afvAbrirListaPed')?.addEventListener('click', () => irPedidos(true));
        return;
      }
      body.innerHTML = `<div class="afv-pend-list">
        <div class="afv-resumo">Lista com a mesma regra de visibilidade de Pedidos (vendedor, gerente, admin). Toque para abrir.</div>
        ${S.pendentes.map((p) => {
          const num = p.numero || p.id;
          const sit = (p.situacao_pedido || 'PENDENTE').toUpperCase();
          const dt = p.data_abertura ? String(p.data_abertura).slice(0, 10).split('-').reverse().join('/') : '';
          const vend = p.nome_vendedor || p.nomeusu || '';
          return `<div class="afv-pend-row" data-id="${p.id}" data-num="${esc(num)}">
            <div class="afv-pend-meta">
              <strong>#${esc(num)} <span class="afv-pend-badge">${esc(sit)}</span></strong>
              <div>${esc(p.nome_cliente || '—')}</div>
              <div class="afv-pend-sub">${esc(p.nome_fornecedor || '')}${vend ? ' · ' + esc(vend) : ''}${dt ? ' · ' + esc(dt) : ''}${p.origem ? ' · ' + esc(p.origem) : ''}</div>
            </div>
            <div class="afv-pend-val">${money(p.vlrtotalpedido || p.vlrsubtotal)}</div>
          </div>`;
        }).join('')}
        <div class="afv-foot" style="border:none;padding-top:4px">
          <button type="button" class="afv-chip" id="afvRefreshPend">Atualizar</button>
          <button type="button" class="afv-save" id="afvAbrirPedFull">Abrir Pedidos</button>
        </div>
      </div>`;
      body.querySelectorAll('.afv-pend-row').forEach((row) => {
        row.onclick = () => abrirPedidoId(row.dataset.id, row.dataset.num);
      });
      document.getElementById('afvRefreshPend').onclick = () => carregarPendentes();
      document.getElementById('afvAbrirPedFull').onclick = () => irPedidos(true);
      return;
    }

    // restaura chips ao sair de pendentes
    const toolBtns = document.getElementById('afvToolBtns');
    if (toolBtns) toolBtns.style.display = '';

    if (S.view === 'sucesso') {
      title.textContent = 'Pedido enviado';
      tools.style.display = 'none';
      const nums = (S.lastPedidos || []).map((p) => '#' + (p.numero || p.id)).join(', ');
      body.innerHTML = `<div class="afv-ok">
        <h3>Pré-pedido gravado!</h3>
        <p style="font-size:14px;color:#475569;line-height:1.5">Pedido(s) <strong>${esc(nums || 'criado')}</strong> com status <strong>PENDENTE</strong>.</p>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:18px">
          <button type="button" class="afv-save" id="afvVerPendentes">VER PENDENTES</button>
          <button type="button" class="afv-chip" id="afvVerPedidos">Abrir Pedidos</button>
          <button type="button" class="afv-chip" id="afvNovoShow">Novo showroom</button>
        </div>
      </div>`;
      document.getElementById('afvVerPendentes').onclick = () => abrirPendentes();
      document.getElementById('afvVerPedidos').onclick = () => irPedidos(true);
      document.getElementById('afvNovoShow').onclick = () => {
        S.view = 'colecoes';
        S.lastPedidos = [];
        render();
      };
    }
  }

  function bindPrePedido() {
    document.getElementById('afvVoltarCart').onclick = () => { S.view = 'carrinho'; render(); };
    document.getElementById('afvFinalizar').onclick = finalizarPrePedido;
    document.getElementById('afvCond').onchange = (e) => {
      const opt = e.target.selectedOptions[0];
      S.pre.condicao_pagto = e.target.value;
      S.pre.id_condicaopagto = opt?.dataset?.id ? parseInt(opt.dataset.id, 10) : null;
    };
    document.getElementById('afvForma').onchange = (e) => { S.pre.forma_pagto = e.target.value; };
    document.getElementById('afvTipo').onchange = (e) => {
      const opt = e.target.selectedOptions[0];
      S.pre.tipo_pedido = e.target.value;
      S.pre.id_tipopedido = opt?.dataset?.id ? parseInt(opt.dataset.id, 10) : null;
    };
    document.getElementById('afvObsPed').oninput = (e) => { S.pre.obs = e.target.value; };
    document.getElementById('afvCliLimpar')?.addEventListener('click', () => {
      S.pre.cod_cliente = '';
      S.pre.nome_cliente = '';
      S.pre.cnpj = '';
      render();
    });
    const busca = document.getElementById('afvCliBusca');
    if (busca) {
      busca.oninput = (e) => {
        clearTimeout(S._cliTimer);
        S._cliTimer = setTimeout(() => buscarClientes(e.target.value), 280);
      };
    }
  }

  async function buscarClientes(q) {
    const list = document.getElementById('afvCliList');
    if (!list) return;
    const termo = String(q || '').trim();
    if (termo.length < 2) {
      list.classList.remove('show');
      list.innerHTML = '';
      return;
    }
    list.classList.add('show');
    list.innerHTML = '<div class="afv-ac-item">Buscando…</div>';
    try {
      const d = await apiJson(`/api/clientes?q=${encodeURIComponent(termo)}&limit=12&status=A`);
      const rows = d.clientes || [];
      if (!rows.length) {
        list.innerHTML = '<div class="afv-ac-item">Nenhum cliente encontrado</div>';
        return;
      }
      list.innerHTML = rows.map((c) => {
        const sub = [c.cidade, c.uf, c.cpf].filter(Boolean).join(' · ');
        return `<div class="afv-ac-item" data-id="${c.id}" data-nome="${esc(c.nome || '')}" data-cnpj="${esc(c.cpf || '')}">
          ${esc(c.nome || c.apelido || '—')}<small>${esc(sub)}</small></div>`;
      }).join('');
      list.querySelectorAll('.afv-ac-item[data-id]').forEach((el) => {
        el.onclick = () => {
          S.pre.cod_cliente = el.dataset.id;
          S.pre.nome_cliente = el.dataset.nome;
          S.pre.cnpj = el.dataset.cnpj || '';
          list.classList.remove('show');
          render();
        };
      });
    } catch (e) {
      list.innerHTML = `<div class="afv-ac-item">${esc(e.message)}</div>`;
    }
  }

  async function abrirDetalhe(cod) {
    const p = S.itens.find((it) => parseInt(it.cod_produto, 10) === cod);
    if (!p) return;
    S.produto = p;
    S.imgIdx = 0;
    S.imagens = p.foto_principal ? [p.foto_principal] : [];
    S.view = 'detalhe';
    render();
    try {
      const d = await apiJson('/api/produtos/' + cod + '/imagens');
      const imgs = (d.imagens || d || []).map((x) => x.url || x.caminho || x.filename).filter(Boolean);
      if (imgs.length) {
        S.imagens = imgs.map((u) => (String(u).startsWith('/') || String(u).startsWith('http') ? u : '/uploads/produtos/' + cod + '/' + u));
        if (S.view === 'detalhe') render();
      }
    } catch (_) {}
  }

  async function abrirEditar() {
    const p = S.produto;
    if (!p) return;
    S.obsItem = '';
    S.gradeItens = [];
    S.gradeQtd = {};
    const mv = parseInt(p.multiplo_venda, 10) || 1;
    const qmin = parseInt(p.qtd_minima_pedido, 10) || 0;
    S.qtdSimples = Math.max(mv, qmin, 1);
    if (S.habilitaGrade === 'S' && p.tipograde) {
      try {
        const d = await apiJson('/api/pedidos/grade/' + p.tipograde);
        S.gradeItens = d.itens || [];
        S.gradeItens.forEach((g) => { S.gradeQtd[g.id] = 0; });
      } catch (_) { S.gradeItens = []; }
    }
    S.view = 'editar';
    render();
  }

  function adicionarAoCarrinho() {
    const p = S.produto;
    if (!p) return;
    const temGrade = !!(S.habilitaGrade === 'S' && p.tipograde && S.gradeItens.length);
    let qtd = 0;
    let grade_qtd = [];
    let grade_resumo = '';
    if (temGrade) {
      grade_qtd = S.gradeItens
        .filter((g) => (parseFloat(S.gradeQtd[g.id]) || 0) > 0)
        .map((g) => ({
          id_descricao_grade: g.id,
          sequencial: g.sequencial,
          nome_grade: g.nome,
          quantidade: parseFloat(S.gradeQtd[g.id]) || 0,
        }));
      qtd = grade_qtd.reduce((s, g) => s + (parseFloat(g.quantidade) || 0), 0);
      grade_resumo = grade_qtd.map((g) => `${g.nome_grade}:${g.quantidade}`).join(' ');
      if (qtd <= 0) { toast('Informe a quantidade em pelo menos um tamanho', 'warn'); return; }
    } else {
      qtd = parseFloat(S.qtdSimples) || 0;
      if (qtd <= 0) { toast('Informe a quantidade', 'warn'); return; }
    }
    let forn = p.cod_fornecedor || S.fonte?.cod_fornecedor || null;
    let nomeForn = p.nome_fornecedor || '';
    if (forn && !nomeForn) {
      const f = S.fabricas.find((x) => String(x.id) === String(forn));
      if (f) nomeForn = f.nome || '';
    }
    const line = {
      cod_produto: p.cod_produto,
      cod_fabricante: p.cod_fabricante,
      desc_produto: p.desc_produto,
      unidade: p.unidade,
      tipograde: p.tipograde,
      tipoprodutograde: p.tipoprodutograde,
      foto_principal: p.foto_principal,
      vlr_venda: p.vlr_venda,
      quantidade: qtd,
      grade_qtd,
      grade_resumo,
      id_grade: temGrade ? p.tipograde : null,
      tipo_grade: temGrade ? String(p.tipograde) : null,
      obsitem: (S.obsItem || '').slice(0, 100),
      cod_fornecedor: forn,
      nome_fornecedor: nomeForn,
      multiplo_venda: p.multiplo_venda,
      qtd_minima_pedido: p.qtd_minima_pedido,
      precopeso: p.precopeso,
      kilo_embalagem: p.kilo_embalagem,
    };
    const sameIdx = S.cart.findIndex((c) =>
      parseInt(c.cod_produto, 10) === parseInt(p.cod_produto, 10)
      && JSON.stringify(c.grade_qtd || []) === JSON.stringify(grade_qtd)
    );
    if (sameIdx >= 0 && !temGrade) {
      S.cart[sameIdx].quantidade = (parseFloat(S.cart[sameIdx].quantidade) || 0) + qtd;
    } else {
      S.cart.push(line);
    }
    saveCart();
    toast('Adicionado ao carrinho', 'ok');
    S.view = 'refs';
    S.produto = null;
    render();
  }

  async function resolverFornecedorItem(it) {
    if (it.cod_fornecedor) return it;
    try {
      const d = await apiJson('/api/pedidos/produtos/busca?catalogo=1&q=' + encodeURIComponent(String(it.cod_produto)) + '&limit=5');
      const row = (d.data || []).find((p) => parseInt(p.cod_produto || p.id, 10) === parseInt(it.cod_produto, 10));
      if (row) {
        it.cod_fornecedor = parseInt(row.cod_fornecedorpadrao || row.cod_fornecedor, 10) || null;
        it.nome_fornecedor = row.nome_fornecedor || it.nome_fornecedor || '';
        if (!it.vlr_venda && row.vlr_venda) it.vlr_venda = parseFloat(row.vlr_venda) || 0;
      }
    } catch (_) {}
    return it;
  }

  async function finalizarPrePedido() {
    if (!S.pre.cod_cliente) {
      toast('Selecione o cliente', 'warn');
      return;
    }
    if (!S.cart.length) {
      toast('Carrinho vazio', 'warn');
      return;
    }
    const btn = document.getElementById('afvFinalizar');
    if (btn) { btn.disabled = true; btn.textContent = 'Gravando…'; }

    try {
      for (const it of S.cart) await resolverFornecedorItem(it);

      const grupos = new Map();
      for (const it of S.cart) {
        const key = String(it.cod_fornecedor || '0');
        if (!grupos.has(key)) grupos.set(key, []);
        grupos.get(key).push(it);
      }

      const criados = [];
      for (const [fornKey, itens] of grupos) {
        const codForn = parseInt(fornKey, 10) || null;
        if (!codForn) {
          throw new Error('Há produtos sem fábrica vinculada. Use uma coleção/fábrica ou cadastre o fornecedor padrão no produto.');
        }
        let nomeForn = itens[0].nome_fornecedor || '';
        if (!nomeForn) {
          const f = S.fabricas.find((x) => String(x.id) === String(codForn));
          nomeForn = f?.nome || '';
        }
        const totalQt = itens.reduce((s, i) => s + (parseFloat(i.quantidade) || 0), 0);
        const vlrSub = itens.reduce((s, i) => s + (parseFloat(i.quantidade) || 0) * (parseFloat(i.vlr_venda) || 0), 0);
        const vlrSubR = Math.round(vlrSub * 100) / 100;

        const itensBody = itens.map((i) => {
          const q = parseFloat(i.quantidade) || 0;
          const vu = parseFloat(i.vlr_venda) || 0;
          const tot = Math.round(q * vu * 100) / 100;
          return {
            cod_produto: i.cod_produto,
            cod_fabricante: i.cod_fabricante,
            desc_prod: i.desc_produto,
            descricao: i.desc_produto,
            unidade: i.unidade,
            quantidade: q,
            valor_unitario: vu,
            vlr_padrao: vu,
            vlrtotal_itens: tot,
            id_grade: i.id_grade || null,
            tipo_grade: i.tipo_grade || null,
            grade_qtd: i.grade_qtd || [],
            obsitem: i.obsitem || '',
            cod_fornecedor: codForn,
          };
        });

        const body = {
          pedido: {
            data_abertura: hojeIso(),
            cod_cliente: parseInt(S.pre.cod_cliente, 10),
            nome_cliente: S.pre.nome_cliente,
            cnpj: S.pre.cnpj || '',
            cod_fornecedor: codForn,
            nome_fornecedor: nomeForn,
            id_usuario: userId() || null,
            nome_vendedor: userNome(),
            id_tipopedido: S.pre.id_tipopedido || null,
            tipo_pedido: S.pre.tipo_pedido || 'PEDIDO',
            id_condicaopagto: S.pre.id_condicaopagto || null,
            condicao_pagto: S.pre.condicao_pagto || '',
            forma_pagto: S.pre.forma_pagto || 'BOLETO',
            prazo_pagto: S.pre.condicao_pagto || '',
            situacao_pedido: 'PENDENTE',
            status: 'PENDENTE',
            vlrsubtotal: vlrSubR,
            vlrtotalitens: vlrSubR,
            vlrdesconto: 0,
            vlrtotalimposto: 0,
            vlrtotalbruto: vlrSubR,
            vlrfrete: 0,
            vlrjuros: 0,
            vlrtotalpedido: vlrSubR,
            qt_parcelas: 1,
            total_qt: totalQt,
            total_peso: 0,
            origem: 'SHOWROOM',
            obs: (S.pre.obs || '').trim() || 'Pré-pedido Showroom',
          },
          itens: itensBody,
          parcelas: [],
        };

        const r = await apiJson('/api/pedidos', { method: 'POST', body: JSON.stringify(body) });
        criados.push({ id: r.id, numero: r.numero });
      }

      S.lastPedidos = criados;
      S.cart = [];
      saveCart();
      S.view = 'sucesso';
      render();
      toast('Pedido(s) pendente(s) criado(s)', 'ok');
    } catch (e) {
      toast(e.message || 'Erro ao gravar pedido', 'err');
      if (btn) { btn.disabled = false; btn.textContent = 'FINALIZAR → PEDIDO PENDENTE'; }
    }
  }

  window.abrirCatalogoAfv = abrir;
  window.fecharCatalogoAfv = fechar;
  window.ShowroomAfv = { abrir, fechar, irPedidos };
})();
