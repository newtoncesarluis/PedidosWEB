/**
 * Showroom AFV — módulo independente (estilo vitrine / força de vendas).
 * Navegação visual → carrinho → pré-pedido (cliente, pagamento…) → grava pedido PENDENTE.
 * Expõe: window.abrirCatalogoAfv() / window.ShowroomAfv
 */
(function () {
  'use strict';

  const S = {
    view: 'colecoes', // inicio | colecoes | refs | detalhe | editar | carrinho | prepedido | pendentes | sucesso
    catalogos: [],
    fabricas: [],
    tabelas: [],
    fonte: null,
    itens: [],
    produto: null,
    variacoesCores: [],
    variacoesMae: null,
    imagens: [],
    imgIdx: 0,
    gradeItens: [],
    gradeQtd: {},
    gradesDisponiveis: [],
    gradeIdSelecionada: null,
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
    somaEmbalagem: 'N',
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
      data_entrega: '',
      ped_compras: '',
      id_tabela: '',
    },
    lastPedidos: [],
    pularInicio: false,
    cartFiltro: '',
    _cliTimer: null,
  };

  const PAGE = 40;
  const CORES = ['#1a1a1a', '#0f766e', '#1e3a5f', '#7f1d1d', '#312e81', '#14532d', '#422006'];
  const FORMAS = [
    { v: 'BOLETO', l: 'Boleto' },
    { v: 'PIX', l: 'PIX' },
    { v: 'DINHEIRO', l: 'Dinheiro' },
    { v: 'CARTAO', l: 'Cartão' },
    { v: 'DEPOSITO', l: 'Depósito' },
    { v: 'CHEQUE', l: 'Cheque' },
    { v: 'CHEQUE_PRED', l: 'Cheque Pré-datado' },
    { v: 'PRAZO', l: 'A Prazo / Carteira' },
    { v: 'OUTROS', l: 'Outros' },
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
  function resolveUserIdStr() {
    const a = String(sessionStorage.getItem('userId') || '').trim();
    const b = String(localStorage.getItem('userId') || '').trim();
    return a || b || 'u';
  }
  function cartKey() {
    return 'sysrep_afv_cart_' + resolveUserIdStr();
  }
  /** Todas as chaves sysrep_afv_cart_* no localStorage (qualquer userId antigo). */
  function allCartStorageKeys() {
    const keys = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf('sysrep_afv_cart_') === 0) keys.push(k);
      }
    } catch (_) {}
    return keys;
  }
  function cartKeysPossiveis() {
    const ids = new Set(['u']);
    const a = String(sessionStorage.getItem('userId') || '').trim();
    const b = String(localStorage.getItem('userId') || '').trim();
    if (a) ids.add(a);
    if (b) ids.add(b);
    ids.add(resolveUserIdStr());
    const fromIds = [...ids].map((id) => 'sysrep_afv_cart_' + id);
    return [...new Set([...fromIds, ...allCartStorageKeys()])];
  }
  function loadCart() {
    try {
      const primary = cartKey();
      let raw = localStorage.getItem(primary);
      // null = nunca gravou nesta chave → tenta migrar de chave antiga.
      // '[]' = limpeza intencional → NÃO ressuscita de outra chave.
      if (raw == null) {
        for (const k of allCartStorageKeys()) {
          if (k === primary) continue;
          const alt = localStorage.getItem(k);
          if (alt && alt !== '[]') {
            raw = alt;
            try { localStorage.setItem(primary, alt); } catch (_) {}
            break;
          }
        }
      }
      S.cart = JSON.parse(raw || '[]');
      if (!Array.isArray(S.cart)) S.cart = [];
    } catch (_) {
      S.cart = [];
    }
  }
  function saveCart() {
    const json = JSON.stringify(S.cart);
    const primary = cartKey();
    localStorage.setItem(primary, json);
    // Alias alinhados; se vazio, remove ghosts para não voltar no próximo load
    allCartStorageKeys().forEach((k) => {
      if (k === primary) return;
      try {
        if (!S.cart.length) localStorage.removeItem(k);
        else localStorage.setItem(k, json);
      } catch (_) {}
    });
    atualizarBadge();
  }
  function limparCarrinhoPersistido() {
    S.cart = [];
    // Apaga TODAS as chaves do carrinho neste aparelho (não só as do userId atual)
    allCartStorageKeys().forEach((k) => {
      try { localStorage.removeItem(k); } catch (_) {}
    });
    // Tombstone: loadCart não migra de ghost keys
    try { localStorage.setItem(cartKey(), '[]'); } catch (_) {}
    atualizarBadge();
  }
  function limparConfirmResiduais() {
    try {
      document.querySelectorAll('[data-sysrep-confirm]').forEach((n) => n.remove());
    } catch (_) {}
  }
  function cartQtd() {
    return S.cart.reduce((s, i) => s + (parseFloat(i.quantidade) || 0), 0);
  }

  /** Embalagem/peso do item — mesma lógica do pedido (produto + soma_embalagem do sistema). */
  function embalagemDoProduto(p) {
    const PP = window.PrecoPesoProduto;
    if (PP && PP.isPrecoPorPeso(p?.precopeso)) return PP.embalagemInicialProduto(p);
    if (String(S.somaEmbalagem || 'N').toUpperCase() === 'S') {
      const k = parseFloat(p?.kilo_embalagem) || 0;
      return k > 0 ? k : 1;
    }
    return 1;
  }

  /** Total da linha: Qtd × [peso/emb] × preço quando precopeso ou soma_embalagem. */
  function lineTotal(i) {
    const PP = window.PrecoPesoProduto;
    const q = parseFloat(i.quantidade) || 0;
    const vu = parseFloat(i.vlr_venda) || 0;
    if (!PP) return q * vu;
    return PP.calcBaseItemTotal({
      quantidade: q,
      valorUnitario: vu,
      embalagem: i.embalagem != null ? i.embalagem : embalagemDoProduto(i),
      kilo_embalagem: i.kilo_embalagem,
      precopeso: i.precopeso,
      somaEmbalagempedido: S.somaEmbalagem || 'N',
    });
  }

  function cartTotal() {
    return S.cart.reduce((s, i) => s + lineTotal(i), 0);
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

  // Iniciais para a marca d'agua do card sem capa
  // As variacoes costumam ter cor1 vazio; o que as diferencia esta na descricao
  // ("... 3,00 L", "... 7,00 L"). Tira o trecho comum e usa o resto como rotulo,
  // que e o que o vendedor precisa ler — nao o codigo interno.
  function rotulosDasVariacoes(lista) {
    const descs = (lista || []).map((c) => String(c.desc_produto || c.descricao || '').trim());
    let prefixo = 0;
    if (descs.length > 1 && descs.every(Boolean)) {
      const menor = Math.min(...descs.map((d) => d.length));
      while (prefixo < menor && descs.every((d) => d[prefixo] === descs[0][prefixo])) prefixo++;
      // volta ate o inicio da palavra, para nao cortar no meio
      while (prefixo > 0 && !/[\s,;/-]/.test(descs[0][prefixo - 1])) prefixo--;
    }
    return (lista || []).map((c, i) => {
      if (c.cor1) return String(c.cor1);
      const resto = (descs[i] || '').slice(prefixo).trim().replace(/^[-–,;/]+\s*/, '');
      return resto || c.cod_fabricante || ('#' + c.cod_produto);
    });
  }

  function iniciaisMarca(nome) {
    const palavras = String(nome || '').trim().split(/\s+/).filter(Boolean);
    if (!palavras.length) return '?';
    if (palavras.length === 1) return palavras[0].slice(0, 2).toUpperCase();
    return (palavras[0][0] + palavras[1][0]).toUpperCase();
  }

  const ICO_TIPO = {
    colecao: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.25v13m0-13C10.8 5.5 9.2 5 7.5 5S4.2 5.5 3 6.25v13C4.2 18.5 5.8 18 7.5 18s3.3.5 4.5 1.25m0-13C13.2 5.5 14.8 5 16.5 5S19.8 5.5 21 6.25v13C19.8 18.5 18.2 18 16.5 18s-3.3.5-4.5 1.25"/>',
    fabrica: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 21h18M4 21V10l5 3V10l5 3V7l6 4v10"/>',
    tabela:  '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L2 12V2h10l8.6 8.6a2 2 0 010 2.8z"/><circle cx="7" cy="7" r="1.2" fill="currentColor" stroke="none"/>',
  };

  function gradeChipsHtml(resumo) {
    const parts = String(resumo || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '';
    return `<div class="afv-cart-grades">${parts.map((p) => {
      const i = p.indexOf(':');
      const tam = i >= 0 ? p.slice(0, i) : p;
      const q = i >= 0 ? p.slice(i + 1) : '';
      return `<span class="afv-cart-gchip"><b>${esc(tam)}</b>${q !== '' ? `<i>×${esc(q)}</i>` : ''}</span>`;
    }).join('')}</div>`;
  }

  function cartRowHtml(it, idx) {
    const sku = it.cod_fabricante || it.cod_produto || '';
    const nome = it.desc_produto || '';
    const q = parseFloat(it.quantidade) || 0;
    const tot = lineTotal(it);
    const foto = String(it.foto_principal || '').trim();
    const thumb = foto
      ? `<div class="afv-cart-thumb"><img src="${esc(foto)}" alt="" loading="lazy" onerror="this.parentNode.innerHTML='<span class=\\'afv-cart-thumb-ph\\' aria-hidden=\\'true\\'>—</span>'"></div>`
      : `<div class="afv-cart-thumb"><span class="afv-cart-thumb-ph" aria-hidden="true"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 9"/></svg></span></div>`;
    return `<article class="afv-cart-row">
      ${thumb}
      <div class="afv-cart-meta">
        <div class="afv-cart-sku">${esc(sku)}</div>
        <div class="afv-cart-name">${esc(nome)}</div>
        <div class="afv-cart-price-row">
          <span class="afv-cart-price">${q} un. × ${money(it.vlr_venda)}</span>
          <span class="afv-cart-line">${money(tot)}</span>
        </div>
        ${gradeChipsHtml(it.grade_resumo)}
      </div>
      <button type="button" class="afv-cart-rm" data-idx="${idx}" title="Remover" aria-label="Remover item">
        ${ico('x')}
      </button>
    </article>`;
  }

  // Card compacto (sem foto de capa): iniciais coloridas + nome + seta
  function tileCard(tipo, { id, nome, sub, cor, extra }) {
    const rotulo = { colecao: 'Coleção', fabrica: 'Fábrica', tabela: 'Tabela de preço' }[tipo] || '';
    return `<div class="afv-tile" data-tipo="${tipo}" data-id="${esc(id)}"${extra || ''}>
      <span class="afv-tile-av" style="background:${esc(cor || '#1f2937')}">${esc(iniciaisMarca(nome))}</span>
      <span class="afv-tile-tx"><b>${esc(nome)}</b><small>${esc(sub || rotulo)}</small></span>
      <span class="afv-tile-go" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></span>
    </div>`;
  }

  // Card das secoes da home do Showroom (colecao / fabrica / tabela)
  function bannerCard(tipo, { id, nome, sub, capa, cor, extra }) {
    const temCapa = !!capa;
    const estilo = temCapa
      ? `background-image:url('${esc(capa)}')`
      : `background:${esc(cor || '#1f2937')}`;
    const marca = temCapa ? '' : `<span class="afv-banner-marca" aria-hidden="true">${esc(iniciaisMarca(nome))}</span>`;
    const icone = `<svg class="afv-banner-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">${ICO_TIPO[tipo] || ''}</svg>`;
    return `<div class="afv-banner${temCapa ? '' : ' afv-banner--sem-capa'}" data-tipo="${tipo}" data-id="${esc(id)}"${extra || ''} style="${estilo}">
      ${marca}${icone}
      <div class="afv-banner-lbl">${esc(nome)}${sub ? `<span class="afv-banner-sub">${esc(sub)}</span>` : ''}</div>
    </div>`;
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
.afv-overlay{--afv-accent:#0d9488;--afv-accent-h:#0f766e;--afv-soft:color-mix(in srgb,var(--afv-accent) 12%,transparent);display:none;position:fixed;inset:0;z-index:2147483600;background:var(--content-bg,#f1f5f9);color:var(--content-text,#0f172a);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.afv-overlay.show{display:flex;flex-direction:column}
.afv-overlay.afv-standalone{position:fixed}
.afv-main{flex:1;min-width:0;display:flex;flex-direction:column;background:var(--content-bg,#f1f5f9);color:var(--content-text,#0f172a);width:100%;min-height:0}
.afv-top{display:flex;align-items:center;gap:8px;padding:10px 14px;padding-top:max(10px,env(safe-area-inset-top));background:var(--card,#fff);border-bottom:1px solid var(--card-border,#e2e8f0);flex-shrink:0;flex-wrap:wrap;backdrop-filter:saturate(1.2) blur(8px)}
.afv-top-title{flex:1;font-size:17px;font-weight:800;letter-spacing:-.02em;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--content-text,#0f172a)}
.afv-top-sub{display:block;font-size:11px;font-weight:600;color:var(--text2,#64748b);margin-top:1px;overflow:hidden;text-overflow:ellipsis}
.afv-top-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.afv-top-btn{height:38px;padding:0 12px;border:1px solid var(--card-border,#e2e8f0);border-radius:12px;background:var(--card,#fff);color:var(--content-text,#334155);font:inherit;font-size:12px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;transition:border-color .15s,background .15s,transform .12s}
.afv-top-btn:hover{border-color:var(--afv-accent)}
.afv-top-btn:active{transform:scale(.98)}
.afv-top-btn.primary{background:var(--afv-accent);border-color:var(--afv-accent);color:#fff}
.afv-top-btn.primary:hover{background:var(--afv-accent-h)}
.afv-top-btn.cart{position:relative}
.afv-badge{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:#2563eb;color:#fff;font-size:10px;font-weight:800}
.afv-icon-btn{width:40px;height:40px;border:none;border-radius:12px;background:var(--content-bg,#f1f5f9);color:var(--content-text,#334155);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:background .15s}
.afv-icon-btn:hover{background:var(--afv-soft)}
.afv-tools{padding:10px 14px;background:var(--card,#fff);border-bottom:1px solid var(--card-border,#e2e8f0);flex-shrink:0;display:grid;gap:10px}
.afv-search{display:flex;align-items:center;gap:8px;height:44px;padding:0 14px;border:1.5px solid var(--card-border,#e2e8f0);border-radius:14px;background:var(--content-bg,#f8fafc);color:var(--text2,#64748b);transition:border-color .15s,box-shadow .15s}
.afv-search:focus-within{border-color:var(--afv-accent);box-shadow:0 0 0 3px var(--afv-soft);background:var(--card,#fff)}
.afv-search input{flex:1;border:none;outline:none;background:transparent;font:inherit;font-size:15px;color:var(--content-text,#0f172a)}
.afv-search input::placeholder{color:var(--text2,#94a3b8)}
.afv-tool-btns{display:flex;gap:8px;flex-wrap:wrap}
.afv-chip{height:36px;padding:0 14px;border:1px solid var(--card-border,#e2e8f0);border-radius:999px;background:var(--card,#fff);font:inherit;font-size:12px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:6px;color:var(--content-text,#334155);transition:border-color .15s,background .15s}
.afv-chip:hover{border-color:var(--afv-accent);background:var(--afv-soft)}
.afv-sort{display:flex;gap:4px;justify-content:flex-end;background:var(--content-bg,#f1f5f9);padding:3px;border-radius:10px;width:fit-content;margin-left:auto}
.afv-sort-lbl{align-self:center;font-size:11px;font-weight:700;color:var(--text2,#64748b);padding:0 6px 0 8px}
.afv-sort-btn{border:none;background:transparent;font:inherit;font-size:11px;font-weight:800;color:var(--text2,#94a3b8);cursor:pointer;letter-spacing:.02em;padding:6px 12px;border-radius:8px}
.afv-sort-btn.is-on{color:var(--content-text,#0f172a);background:var(--card,#fff);box-shadow:0 1px 3px rgba(15,23,42,.08)}
.afv-body{flex:1;overflow:auto;padding:14px max(14px,calc((100% - 1400px)/2)) calc(14px + env(safe-area-inset-bottom));min-height:0;scrollbar-width:thin}
.afv-overlay.has-dock .afv-body{padding-bottom:calc(88px + env(safe-area-inset-bottom))}
.afv-home-hero{
  position:relative;display:flex;align-items:center;gap:10px;
  margin:0 0 14px;padding:10px 40px 10px 14px;border-radius:12px;
  background:linear-gradient(135deg,var(--afv-accent),#115e59);color:#fff;
}
.afv-home-greet{font-size:13px;font-weight:800;letter-spacing:-.01em;flex-shrink:0}
.afv-home-hint{font-size:12px;opacity:.92;line-height:1.35}
.afv-hero-x{
  position:absolute;top:50%;right:8px;transform:translateY(-50%);
  width:26px;height:26px;border:none;border-radius:8px;padding:0;
  background:rgba(255,255,255,.16);color:#fff;cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;transition:background .15s;
}
.afv-hero-x:hover{background:rgba(255,255,255,.3)}
@media(max-width:640px){
  .afv-home-hero{flex-direction:column;align-items:flex-start;gap:2px}
}
/* Secoes lado a lado quando cabem: com uma colecao e uma fabrica, empilhar
   deixava duas linhas quase vazias. Secao com muitos cards pede 100% e fica
   sozinha na linha, senao viraria uma coluna estreita e comprida. */
.afv-secoes{display:flex;flex-wrap:wrap;align-items:flex-start;gap:0 22px}
.afv-sec{flex:0 1 auto;min-width:222px;max-width:100%;margin-bottom:18px}
.afv-sec-title{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text2,#64748b);margin:0 0 10px;padding-left:2px}
.afv-grid-col{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
.afv-banner{position:relative;min-height:148px;border-radius:16px;overflow:hidden;cursor:pointer;background:#1f2937;background-size:cover;background-position:center;box-shadow:0 2px 12px rgba(15,23,42,.1);transition:transform .18s ease,box-shadow .18s}
.afv-banner:hover{transform:translateY(-3px);box-shadow:0 10px 28px rgba(15,23,42,.16)}
.afv-banner:active{transform:translateY(-1px)}
.afv-banner::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,transparent 25%,rgba(0,0,0,.72))}
.afv-banner-lbl{position:absolute;left:14px;right:14px;bottom:12px;z-index:2;color:#fff;font-weight:800;font-size:14px;line-height:1.25;text-shadow:0 1px 4px rgba(0,0,0,.4)}
.afv-banner-sub{display:block;font-size:11px;font-weight:600;opacity:.9;margin-top:3px}
/* sem foto de capa, o card era um retangulo de cor chapada: a inicial da marca
   e o icone do tipo dao identidade e dizem o que e sem precisar ler */
.afv-banner--sem-capa{min-height:115px}
.afv-banner-marca{
  /* z-index acima do gradiente ::after, senao a marca some nos cards escuros */
  position:absolute;right:4px;bottom:-10px;z-index:1;
  font-size:62px;font-weight:900;line-height:1;letter-spacing:-.06em;
  color:rgba(255,255,255,.20);user-select:none;pointer-events:none;
}
.afv-banner-ico{
  position:absolute;top:11px;left:13px;z-index:2;
  width:17px;height:17px;color:rgba(255,255,255,.8);
}
.afv-grid-ref{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:14px}
.afv-ref{position:relative;background:var(--card,#fff);border:1px solid var(--card-border,#e2e8f0);border-radius:14px;overflow:hidden;cursor:pointer;display:flex;flex-direction:column;transition:border-color .15s,box-shadow .15s,transform .15s;text-align:left;font:inherit;color:inherit;padding:0;width:100%;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
.afv-ref:hover{border-color:var(--afv-accent);box-shadow:0 8px 20px rgba(15,23,42,.08);transform:translateY(-2px)}
.afv-ref:active{transform:scale(.98)}
.afv-ref:focus-visible{outline:2px solid var(--afv-accent);outline-offset:2px}
.afv-ref-img{position:relative;aspect-ratio:1;background:var(--content-bg,#f8fafc);display:flex;align-items:center;justify-content:center;overflow:hidden;padding:8px;box-sizing:border-box}
.afv-ref-img img,.afv-ref-empty,.afv-ref-badge{pointer-events:none;-webkit-user-drag:none;user-select:none}
.afv-ref.is-opening{opacity:.55;pointer-events:none}
.afv-ref-img img{max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;object-position:center}
.afv-ref-empty{width:36%;max-width:48px;height:auto;opacity:.35;color:var(--text2,#94a3b8)}
.afv-ref-body{padding:10px 10px 12px;display:flex;flex-direction:column;gap:3px;min-height:72px}
.afv-ref-code{font-size:11px;font-weight:800;color:var(--text2,#64748b);line-height:1.25;word-break:break-word}
.afv-ref-nome{font-size:12px;font-weight:600;color:var(--content-text,#0f172a);line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.afv-ref-preco{font-size:13px;font-weight:800;color:var(--afv-accent);margin-top:auto;padding-top:4px}
.afv-count{display:flex;align-items:center;gap:8px;margin:0 0 12px;font-size:12.5px;font-weight:700;color:var(--text2,#64748b)}
.afv-count b{color:var(--content-text,#0f172a)}
.afv-count-cart{padding:2px 10px;border-radius:999px;background:var(--afv-soft);color:var(--afv-accent);font-weight:800}
.afv-ref--cart{border-color:var(--afv-accent);box-shadow:0 0 0 1px var(--afv-accent)}
.afv-ref-incart{position:absolute;left:8px;bottom:8px;display:inline-flex;align-items:center;gap:4px;background:var(--afv-accent);color:#fff;font-size:10.5px;font-weight:800;padding:3px 9px;border-radius:999px;pointer-events:none}
.afv-ref-badge{position:absolute;top:8px;right:8px;background:rgba(15,23,42,.82);color:#fff;font-size:10px;font-weight:700;padding:3px 8px;border-radius:999px;backdrop-filter:blur(4px)}
.afv-empty{padding:56px 20px;text-align:center;color:var(--text2,#64748b);font-size:14px;line-height:1.5}
/* miniaturas embaixo da foto (padrao de loja) em vez de uma coluna lateral
   de 72px, que roubava largura do produto */
.afv-detalhe{display:flex;flex-direction:column;gap:12px;max-width:1000px;margin:0 auto;padding-bottom:8px}
.afv-cores{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 8px;padding:0;justify-content:center}
.afv-cor-chip{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;border:1.5px solid var(--card-border,#d1d5db);background:var(--card,#fff);color:var(--content-text,#111);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;transition:border-color .15s,background .15s}
.afv-cor-chip.is-on{border-color:var(--afv-accent);background:var(--afv-soft);color:var(--afv-accent-h);box-shadow:0 0 0 1px var(--afv-accent)}
.afv-cor-chip img{width:24px;height:24px;border-radius:50%;object-fit:cover;background:var(--content-bg,#e5e7eb)}
.afv-thumbs{order:2;display:flex;flex-direction:row;flex-wrap:wrap;gap:8px;align-items:center;justify-content:center}
.afv-stage{order:1}
.afv-thumbs .afv-icon-btn{width:34px;height:34px}
.afv-thumb{width:64px;height:64px;border:2px solid var(--card-border,#e2e8f0);border-radius:10px;overflow:hidden;cursor:pointer;background:var(--card,#fff);padding:0;transition:border-color .15s}
.afv-thumb.is-on{border-color:var(--afv-accent)}
.afv-thumb img{width:100%;height:100%;object-fit:contain;object-position:center;background:var(--card,#fff)}
.afv-stage{position:relative;background:var(--card,#fff);border-radius:16px;border:1px solid var(--card-border,#e2e8f0);display:flex;flex-direction:column;align-items:center;padding:18px;min-height:300px}
.afv-stage-nome{font-size:15px;font-weight:700;color:var(--content-text,#334155);margin-bottom:2px;text-align:center;line-height:1.35;max-width:36em}
.afv-stage-sku{font-size:11px;font-weight:700;color:var(--text2,#94a3b8);letter-spacing:.02em;margin-bottom:8px}
/* ficha do produto: estava escondida atras de um icone sem rotulo */
.afv-ficha{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;margin:10px 0 0}
.afv-ficha span{
  font-size:11px;font-weight:700;color:var(--text2,#64748b);
  background:var(--content-bg,#f1f5f9);border:1px solid var(--card-border,#e2e8f0);
  padding:3px 9px;border-radius:999px;
}
/* preco ausente nao pode parecer "de graca" */
.afv-cta-price.sem-preco{font-size:12px;font-weight:800;color:#b45309;line-height:1.25;white-space:normal;max-width:150px}
.afv-cor-chip small{display:block;font-size:9.5px;font-weight:700;opacity:.65;letter-spacing:.02em}
.afv-stage-img{max-width:100%;max-height:min(380px,44vh);object-fit:contain}
.afv-fabs{position:absolute;right:14px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:10px}
.afv-fab{width:48px;height:48px;border-radius:50%;border:none;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(15,23,42,.14);background:var(--card,#fff);color:var(--text2,#64748b);transition:transform .12s}
.afv-fab:active{transform:scale(.94)}
.afv-fab.heart.is-on{color:#ef4444}
/* a barra ocupava a largura toda e o botao pegava tudo que sobrava (~700px).
   Agora ela tem o tamanho do proprio conteudo e fica centralizada. */
/* a barra flutuava sobre a foto e podia cobrir o produto: agora fica no fluxo,
   logo abaixo da imagem, com o tamanho do proprio conteudo */
.afv-cta-bar{
  margin:16px auto 0;width:max-content;max-width:100%;
  display:flex;align-items:center;gap:16px;padding:8px 8px 8px 18px;border-radius:14px;
  background:var(--card,#fff);border:1px solid var(--card-border,#e2e8f0);
  box-shadow:0 6px 20px rgba(15,23,42,.12);
  box-sizing:border-box;
}
.afv-cta-price{font-size:16px;font-weight:800;color:var(--content-text,#0f172a);white-space:nowrap}
.afv-cta-bar .afv-save{flex:0 0 auto;height:44px;padding:0 30px;font-size:14px}
/* o card esticava ate o fim da tela (min-height 100%) e o rodape ficava
   sozinho la embaixo, com um vazio enorme no meio */
.afv-edit{max-width:560px;margin:0 auto;background:var(--card,#fff);border-radius:16px;border:1px solid var(--card-border,#e2e8f0);padding:18px;display:flex;flex-direction:column;gap:16px}
.afv-edit-top{display:flex;gap:14px;align-items:center}
.afv-edit-top img{width:88px;height:88px;flex-shrink:0;object-fit:contain;object-position:center;border-radius:12px;background:var(--content-bg,#f8fafc);padding:4px;box-sizing:border-box;border:1px solid var(--card-border,#e2e8f0)}
.afv-edit-semfoto{
  width:88px;height:88px;flex-shrink:0;border-radius:12px;border:1px solid var(--card-border,#e2e8f0);
  background:var(--content-bg,#f8fafc);display:flex;align-items:center;justify-content:center;
  color:var(--text2,#94a3b8);font-size:11px;font-weight:700;text-align:center;line-height:1.3;padding:6px;box-sizing:border-box;
}
.afv-edit-meta{min-width:0;display:flex;flex-direction:column;gap:3px}
.afv-edit-nome{font-size:15px;font-weight:800;line-height:1.3;color:var(--content-text,#0f172a)}
.afv-edit-ref{font-size:11.5px;font-weight:700;color:var(--text2,#64748b)}
.afv-edit-preco{font-size:14px;font-weight:800;color:var(--afv-accent);margin-top:2px}
.afv-edit-preco small{font-size:11px;font-weight:700;color:var(--text2,#94a3b8)}
.afv-edit-sec{display:flex;flex-direction:column;gap:8px;align-items:center;padding:14px 0;border-top:1px solid var(--card-border,#e2e8f0);border-bottom:1px solid var(--card-border,#e2e8f0)}
.afv-edit-lbl{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text2,#94a3b8)}
.afv-obs-wrap{display:flex;flex-direction:column;gap:6px}
.afv-grade{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin:8px 0 18px}
.afv-gcell{width:78px;background:var(--content-bg,#f8fafc);border:1px solid var(--card-border,#e2e8f0);border-radius:12px;padding:8px 4px;display:flex;flex-direction:column;align-items:center;gap:6px}
.afv-gbtn{width:36px;height:36px;border:none;border-radius:10px;font-size:18px;font-weight:800;cursor:pointer;line-height:1}
.afv-gbtn.plus{background:var(--afv-accent);color:#fff}
/* o menos era vermelho, cor de acao perigosa, para so tirar uma unidade */
.afv-gbtn.minus{background:var(--content-bg,#f1f5f9);color:var(--content-text,#334155);border:1px solid var(--card-border,#e2e8f0)}
.afv-gbtn.minus:hover{border-color:var(--afv-accent);color:var(--afv-accent)}
.afv-gqtd{font-size:18px;font-weight:900;min-height:24px;color:var(--content-text,#0f172a)}
.afv-gqtd-in{width:64px;height:34px;text-align:center;font-size:17px;font-weight:900;border:1.5px solid var(--card-border,#e2e8f0);border-radius:8px;background:var(--card,#fff);color:var(--content-text,#0f172a);-moz-appearance:textfield}
.afv-gqtd-in::-webkit-outer-spin-button,.afv-gqtd-in::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
.afv-tools{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.afv-tools .afv-search{flex:1 1 300px;min-width:0}
.afv-secoes{display:block}
.afv-sec{display:block;max-width:none;min-width:0;margin:0 0 26px}
.afv-sec-title{display:flex;align-items:center;gap:8px;font-size:13px;letter-spacing:.05em;margin:0 0 12px}
.afv-sec-count{font-size:11px;font-weight:800;padding:1px 8px;border-radius:999px;background:var(--content-bg,#f1f5f9);color:var(--text2,#64748b);letter-spacing:0}
.afv-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.afv-banners{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.afv-tile{display:flex;align-items:center;gap:14px;padding:14px 16px;border:1px solid var(--card-border,#e2e8f0);border-radius:16px;background:var(--card,#fff);cursor:pointer;transition:border-color .15s,box-shadow .15s,transform .15s;min-width:0}
.afv-tile:hover{border-color:var(--afv-accent);box-shadow:0 6px 20px rgba(15,23,42,.1);transform:translateY(-2px)}
.afv-tile:active{transform:translateY(0)}
.afv-tile-av{width:48px;height:48px;border-radius:14px;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:16px;letter-spacing:.02em}
.afv-tile-tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.afv-tile-tx b{font-size:14px;font-weight:800;line-height:1.25;color:var(--content-text,#0f172a);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.afv-tile-tx small{font-size:11.5px;font-weight:600;color:var(--text2,#64748b)}
.afv-tile-go{flex-shrink:0;color:var(--text2,#94a3b8);display:flex}
.afv-tile:hover .afv-tile-go{color:var(--afv-accent)}
.afv-ctx{display:flex;align-items:center;gap:10px;padding:8px 14px;background:var(--afv-soft);border-bottom:1px solid var(--card-border,#e2e8f0);flex-shrink:0;font-size:13px;color:var(--content-text,#0f172a)}
.afv-ctx[hidden]{display:none}
.afv-ctx-ico{display:flex;color:var(--afv-accent);flex-shrink:0}
.afv-ctx-txt{min-width:0;flex:1;display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 10px}
.afv-ctx-txt b{font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.afv-ctx-txt small{font-size:11.5px;font-weight:600;color:var(--text2,#64748b)}
.afv-ctx-btn{flex:0 0 auto;height:32px;padding:0 14px;border:1.5px solid var(--afv-accent);border-radius:10px;background:var(--card,#fff);color:var(--afv-accent);font:inherit;font-size:12px;font-weight:800;cursor:pointer}
.afv-ctx--vazio{background:#fef3c7;color:#92400e}
.afv-ctx--vazio .afv-ctx-ico{color:#b45309}
.afv-ctx--vazio .afv-ctx-btn{border-color:#b45309;color:#92400e}
.afv-abas{display:flex;gap:0;border-bottom:2px solid var(--card-border,#e2e8f0);margin:0 auto 14px;max-width:720px;width:100%}
.afv-aba{flex:1;padding:12px 8px;border:none;background:transparent;font-size:12px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--text2,#64748b);cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-2px}
.afv-abas--dados{max-width:880px}
.afv-dados{max-width:880px;padding:18px 20px 0;gap:16px}
.afv-dados-resumo{display:flex;align-items:center;justify-content:space-between;gap:12px}
.afv-dados-total{font-size:18px;font-weight:800;color:var(--afv-accent);letter-spacing:-.02em}
.afv-dados-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.afv-dados-full{grid-column:1/-1}
.afv-dados textarea{height:64px}
.afv-dados-bar{position:sticky;bottom:0;z-index:5;display:flex;justify-content:flex-end;gap:10px;margin:0 -20px;padding:12px 20px calc(12px + env(safe-area-inset-bottom));background:var(--card,#fff);border-top:1px solid var(--card-border,#e2e8f0);border-radius:0 0 16px 16px}
.afv-dados-back{flex:0 0 auto;min-width:160px}
.afv-dados-bar .afv-save{flex:0 0 auto;min-width:160px;height:42px}
@media(max-width:640px){.afv-dados-bar .afv-save{flex:1 1 auto}}
@media(max-width:640px){.afv-dados-grid{grid-template-columns:1fr}}
.afv-abas--wide{max-width:1100px}
.afv-cart--compact{max-width:1100px}
.afv-cart--compact .afv-cart-rows{grid-template-columns:repeat(auto-fill,minmax(400px,1fr));gap:8px}
.afv-cart--compact .afv-cart-row{grid-template-columns:52px 1fr auto;gap:10px;padding:8px 10px;border-radius:12px}
.afv-cart--compact .afv-cart-thumb{width:52px;height:52px;border-radius:10px}
.afv-cart--compact .afv-cart-name{font-size:12.5px;-webkit-line-clamp:1}
.afv-cart--compact .afv-cart-line{font-size:14px}
.afv-cart--compact .afv-cart-grades{margin-top:2px;gap:4px}
.afv-cart--compact .afv-cart-gchip{padding:2px 6px;font-size:10.5px}
.afv-cart--compact .afv-cart-rm{width:36px;height:36px;min-width:36px;min-height:36px;border-radius:10px}
.afv-cart-find{display:flex;align-items:center;gap:10px;margin:0 0 10px}
.afv-cart-find input{flex:1;height:40px;border:1.5px solid var(--card-border,#e2e8f0);border-radius:12px;padding:0 12px;font:inherit;font-size:14px;background:var(--card,#fff);color:var(--content-text,#0f172a);box-sizing:border-box}
.afv-cart-find span{font-size:12px;font-weight:700;color:var(--text2,#64748b);white-space:nowrap}
@media(max-width:820px){.afv-cart--compact .afv-cart-rows{grid-template-columns:1fr}}
.afv-aba.on{color:var(--afv-accent);border-bottom-color:var(--afv-accent)}
.afv-ini{margin-top:24px;padding:26px 24px}
.afv-ini-ico{width:56px;height:56px;margin:0 auto;border-radius:50%;background:var(--afv-soft);color:var(--afv-accent);display:flex;align-items:center;justify-content:center}
.afv-ini h3{text-align:center;font-size:18px}
.afv-ini-sub{margin:-6px 0 4px;text-align:center;font-size:12.5px;color:var(--text2,#64748b)}
.afv-ini label{font-size:11px}
.afv-ini-skip{background:none;border:none;color:var(--text2,#64748b);cursor:pointer;font:inherit;font-size:12.5px;font-weight:600;justify-self:center;padding:6px 10px}
.afv-ini-skip:hover{color:var(--afv-accent);text-decoration:underline}
.afv-ini .afv-save{justify-self:center;min-width:180px;height:42px}
.afv-mult{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;justify-content:center;margin:2px 0 4px}
.afv-mult-f{display:flex;flex-direction:column;gap:4px;min-width:110px}
.afv-mult-f input{height:40px;text-align:center;font-size:16px;font-weight:800;border:1.5px solid var(--card-border,#e2e8f0);border-radius:10px;background:var(--card,#fff);color:var(--content-text,#0f172a)}
.afv-mult-f input[readonly]{background:var(--content-bg,#f1f5f9)}
.afv-mult-btn{height:40px;padding:0 16px;border:1.5px solid var(--afv-accent);border-radius:10px;background:transparent;color:var(--afv-accent);font-weight:800;font-size:12px;letter-spacing:.04em;text-transform:uppercase;cursor:pointer}
.afv-glbl{font-size:11px;font-weight:700;color:var(--text2,#64748b)}
.afv-qtd-wrap{display:flex;align-items:center;justify-content:center;gap:14px;margin:0}
.afv-qtd-wrap .afv-gbtn{width:44px;height:44px;font-size:20px}
.afv-qtd-wrap input{width:96px;height:48px;text-align:center;font-size:20px;font-weight:800;border:1.5px solid var(--card-border,#e2e8f0);border-radius:12px;background:var(--card,#fff);color:var(--content-text,#0f172a)}
.afv-obs{width:100%;height:44px;border:1.5px solid var(--card-border,#e2e8f0);border-radius:12px;padding:0 12px;font:inherit;margin-top:6px;background:var(--card,#fff);color:var(--content-text,#0f172a);box-sizing:border-box}
.afv-foot-total{display:flex;flex-direction:column;gap:1px;line-height:1.2}
.afv-foot-total b{font-size:19px;font-weight:800;color:var(--content-text,#0f172a);letter-spacing:-.02em}
.afv-foot-total span{font-size:11px;font-weight:700;color:var(--text2,#94a3b8)}
.afv-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:auto;padding-top:16px;border-top:1px solid var(--card-border,#e2e8f0)}
.afv-save{height:42px;padding:0 22px;border:none;border-radius:12px;background:var(--afv-accent);color:#fff;font:inherit;font-weight:800;cursor:pointer;letter-spacing:.02em;transition:background .15s,transform .12s}
.afv-save:hover{background:var(--afv-accent-h)}
.afv-save:active{transform:scale(.98)}
.afv-save:disabled{opacity:.55;cursor:not-allowed}
.afv-more{display:block;margin:16px auto;height:40px;padding:0 20px;border-radius:12px;border:1.5px solid var(--card-border,#e2e8f0);background:var(--card,#fff);color:var(--content-text,#334155);font:inherit;font-weight:700;cursor:pointer}
.afv-cart-list{display:grid;gap:12px;max-width:720px;margin:0 auto;width:100%}
.afv-cart{display:flex;flex-direction:column;gap:0;max-width:720px;margin:0 auto;width:100%;min-height:min(100%,calc(100dvh - 120px))}
.afv-cart-rows{display:grid;gap:12px;flex:1 1 auto;align-content:start;padding-bottom:8px}
.afv-cart-row{display:grid;grid-template-columns:72px 1fr auto;gap:12px;align-items:start;background:var(--card,#fff);border:1px solid var(--card-border,#e2e8f0);border-radius:16px;padding:12px;box-shadow:0 1px 2px rgba(15,23,42,.04)}
.afv-cart-thumb{width:72px;height:72px;border-radius:12px;background:var(--content-bg,#f8fafc);border:1px solid var(--card-border,#e2e8f0);overflow:hidden;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.afv-cart-thumb img{width:100%;height:100%;object-fit:contain;object-position:center;padding:4px;box-sizing:border-box}
.afv-cart-thumb-ph{display:flex;opacity:.4;line-height:1;color:var(--text2,#64748b)}
.afv-cart-meta{min-width:0;display:flex;flex-direction:column;gap:4px;color:var(--content-text,#334155)}
.afv-cart-sku{font-size:11px;font-weight:700;color:var(--text2,#64748b);letter-spacing:.02em}
.afv-cart-name{font-size:13px;font-weight:800;line-height:1.35;color:var(--content-text,#0f172a);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.afv-cart-price-row{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 10px;margin-top:2px}
.afv-cart-price{font-size:12px;color:var(--text2,#64748b);font-weight:600}
.afv-cart-line{font-size:15px;font-weight:800;color:var(--content-text,#0f172a);letter-spacing:-.02em}
.afv-cart-grades{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.afv-cart-gchip{display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border-radius:8px;background:var(--content-bg,#f1f5f9);border:1px solid var(--card-border,#e2e8f0);font-size:11px;font-weight:700;color:var(--content-text,#334155);line-height:1.2}
.afv-cart-gchip i{font-style:normal;color:var(--afv-accent);font-weight:800}
.afv-cart-rm{width:44px;height:44px;min-width:44px;min-height:44px;border:none;border-radius:12px;background:#fee2e2;color:#b91c1c;font:inherit;font-size:12px;font-weight:800;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
.afv-cart-rm:active{transform:scale(.96)}
.afv-cart-rm svg{width:18px;height:18px;flex-shrink:0}
.afv-cart-bar{position:sticky;bottom:0;z-index:6;margin-top:auto;padding:12px 0 calc(10px + env(safe-area-inset-bottom));background:linear-gradient(180deg,transparent 0%,var(--content-bg,#f1f5f9) 18%);display:flex;flex-direction:column;gap:10px}
.afv-cart-summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-radius:14px;background:var(--card,#fff);border:1px solid var(--card-border,#e2e8f0);box-shadow:0 4px 16px rgba(15,23,42,.06)}
.afv-cart-summary-meta{display:flex;flex-direction:column;gap:2px;min-width:0}
.afv-cart-summary-meta span{font-size:12px;font-weight:600;color:var(--text2,#64748b)}
.afv-cart-summary-meta strong{font-size:13px;font-weight:800;color:var(--content-text,#0f172a)}
.afv-cart-summary-total{font-size:18px;font-weight:800;color:var(--afv-accent);letter-spacing:-.02em;white-space:nowrap}
.afv-cart-actions{display:flex;gap:10px;align-items:stretch;justify-content:flex-end}
.afv-cart-btn{min-height:42px;height:42px;border-radius:14px;font:inherit;font-size:14px;font-weight:800;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0 18px;-webkit-tap-highlight-color:transparent;touch-action:manipulation;transition:background .15s,transform .12s,border-color .15s}
.afv-cart-btn:active{transform:scale(.98)}
.afv-cart-btn-ghost{flex:0 0 auto;min-width:140px;border:1.5px solid var(--card-border,#e2e8f0);background:var(--card,#fff);color:var(--content-text,#334155)}
.afv-cart-btn-ghost:hover{border-color:color-mix(in srgb,var(--afv-accent) 45%,var(--card-border,#e2e8f0));color:var(--afv-accent)}
.afv-cart-btn-primary{flex:0 0 auto;min-width:140px;border:none;background:var(--afv-accent);color:#fff;box-shadow:0 6px 16px color-mix(in srgb,var(--afv-accent) 35%,transparent)}
.afv-cart-btn-primary:hover{background:var(--afv-accent-h)}
.afv-cart-foot{display:flex;flex-wrap:nowrap;align-items:center;gap:8px;margin-top:8px;padding-top:0;border:none}
.afv-cart-foot .afv-chip{flex:0 0 auto;height:40px;min-height:40px;padding:0 14px;width:auto}
.afv-cart-foot .afv-save{flex:1 1 auto;height:40px;min-height:40px;padding:0 14px;font-size:13px;letter-spacing:0}
.afv-pre{max-width:560px;margin:0 auto;background:var(--card,#fff);border:1px solid var(--card-border,#e2e8f0);border-radius:16px;padding:20px;display:grid;gap:14px}
.afv-pre h3{margin:0;font-size:17px;letter-spacing:-.02em;color:var(--content-text,#0f172a)}
.afv-pre label{font-size:10px;text-transform:uppercase;font-weight:800;color:var(--text2,#64748b);display:block;margin-bottom:4px}
.afv-pre input,.afv-pre select,.afv-pre textarea{width:100%;height:42px;border:1.5px solid var(--card-border,#e2e8f0);border-radius:12px;padding:0 12px;font:inherit;background:var(--card,#fff);color:var(--content-text,#0f172a);box-sizing:border-box}
.afv-pre textarea{height:72px;padding:10px 12px;resize:vertical}
.afv-pre select option{color:var(--content-text,#0f172a);background:var(--card,#fff)}
.afv-ac{position:relative}
.afv-ac-list{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:20;max-height:220px;overflow:auto;background:var(--card,#fff);border:1.5px solid var(--card-border,#e2e8f0);border-radius:12px;box-shadow:0 12px 32px rgba(15,23,42,.14);display:none}
.afv-ac-list.show{display:block}
.afv-ac-item{padding:12px 14px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--card-border,#f1f5f9);color:var(--content-text,#0f172a)}
.afv-ac-item:hover{background:var(--afv-soft)}
.afv-ac-item small{display:block;font-size:11px;color:var(--text2,#64748b);margin-top:2px}
.afv-cli-sel{display:flex;align-items:center;gap:8px;padding:12px 14px;border-radius:12px;background:var(--afv-soft);border:1px solid color-mix(in srgb,var(--afv-accent) 35%,transparent);font-size:13px;color:var(--content-text,#0f172a)}
.afv-cli-sel button{margin-left:auto;border:none;background:none;color:var(--afv-accent);font:inherit;font-weight:700;cursor:pointer}
.afv-resumo{font-size:13px;color:var(--content-text,#334155);background:var(--content-bg,#f8fafc);border-radius:12px;padding:12px 14px;line-height:1.5}
.afv-ok{max-width:480px;margin:40px auto;text-align:center;background:var(--card,#fff);border-radius:16px;border:1px solid var(--card-border,#e2e8f0);padding:32px 22px}
.afv-ok-ico{width:64px;height:64px;margin:0 auto 14px;border-radius:50%;background:rgba(22,163,74,.12);color:#16a34a;display:flex;align-items:center;justify-content:center}
.afv-ok-sub{margin:0 0 22px;font-size:14px;line-height:1.5;color:var(--text2,#475569)}
.afv-ok-num{display:inline-block;padding:1px 10px;border-radius:999px;background:var(--content-bg,#f1f5f9);color:var(--content-text,#0f172a);font-weight:800}
.afv-ok-btns{display:flex;flex-wrap:wrap;justify-content:center;gap:10px}
.afv-ok-main{flex:0 0 auto;min-width:160px;height:42px;font-size:13px}
.afv-ok-row{display:contents}
.afv-ok-sec{min-width:160px;padding:0 16px;height:42px;border:1.5px solid var(--card-border,#e2e8f0);border-radius:12px;background:var(--card,#fff);color:var(--content-text,#334155);font:inherit;font-size:13px;font-weight:700;cursor:pointer;transition:border-color .15s,color .15s}
.afv-ok-sec:hover{border-color:var(--afv-accent);color:var(--afv-accent)}
.afv-ok h3{margin:0 0 8px;color:#16a34a}
.afv-pend-list{display:grid;gap:10px;max-width:900px;margin:0 auto}
.afv-pend-row{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;background:var(--card,#fff);border:1px solid var(--card-border,#e2e8f0);border-radius:14px;padding:14px;cursor:pointer;flex-wrap:wrap;transition:border-color .15s}
.afv-pend-row:hover{border-color:var(--afv-accent)}
.afv-pend-meta{font-size:13px;line-height:1.45;min-width:0;flex:1;color:var(--content-text,#334155)}
.afv-pend-meta strong{display:block;font-size:14px}
.afv-pend-sub{font-size:11px;color:var(--text2,#64748b);margin-top:2px}
.afv-pend-val{font-size:15px;font-weight:800;color:var(--afv-accent);white-space:nowrap}
.afv-pend-badge{display:inline-block;font-size:10px;font-weight:800;padding:2px 8px;border-radius:999px;background:#fef3c7;color:#b45309;margin-left:6px}
.afv-dock{display:none;position:sticky;bottom:0;z-index:5;margin-top:auto;flex-shrink:0;padding:10px 14px calc(10px + env(safe-area-inset-bottom));background:var(--card,#fff);border-top:1px solid var(--card-border,#e2e8f0);box-shadow:0 -8px 28px rgba(15,23,42,.1)}
.afv-overlay.has-dock .afv-dock{display:flex;align-items:center;gap:12px}
.afv-dock-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.afv-dock-info span{font-size:12px;font-weight:600;color:var(--text2,#64748b)}
.afv-dock-info strong{font-size:17px;font-weight:800;color:var(--content-text,#0f172a);letter-spacing:-.02em}
.afv-dock-cta{height:48px;padding:0 20px;border:none;border-radius:12px;background:var(--afv-accent);color:#fff;font:inherit;font-size:13px;font-weight:800;cursor:pointer;white-space:nowrap;transition:background .15s}
.afv-dock-cta:hover{background:var(--afv-accent-h)}
.afv-toast{position:fixed;bottom:calc(24px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);z-index:2147483646;background:#0f172a;color:#fff;padding:12px 20px;border-radius:999px;font-size:13px;font-weight:700;box-shadow:0 8px 24px rgba(0,0,0,.25);max-width:min(92vw,420px);text-align:center}
.afv-overlay.has-dock .afv-toast{bottom:calc(96px + env(safe-area-inset-bottom))}
.afv-busy{display:none;position:absolute;inset:0;z-index:50;align-items:center;justify-content:center;background:rgba(15,23,42,.35);backdrop-filter:blur(2px)}
.afv-busy-card{display:flex;align-items:center;gap:12px;background:var(--card,#fff);color:var(--content-text,#0f172a);padding:14px 18px;border-radius:14px;box-shadow:0 12px 32px rgba(15,23,42,.2);font-size:13px;font-weight:700}
.afv-busy-spin{width:18px;height:18px;border:2.5px solid var(--card-border,#e2e8f0);border-top-color:var(--afv-accent);border-radius:50%;animation:afvSpin .7s linear infinite}
@keyframes afvSpin{to{transform:rotate(360deg)}}
.afv-toast-err{background:#b91c1c}.afv-toast-warn{background:#b45309}
@media(max-width:720px){
  .afv-thumbs{flex-direction:row;overflow:auto;padding-bottom:4px;-webkit-overflow-scrolling:touch}
  .afv-fabs{position:static;transform:none;flex-direction:row;justify-content:center;margin:12px 0 0}
  .afv-cta-bar{
    width:auto;max-width:100%;margin:12px auto 0;padding:6px 6px 6px 12px;gap:10px;
    border-radius:12px;box-shadow:0 4px 14px rgba(15,23,42,.1);
    position:sticky;bottom:0;left:auto;right:auto;z-index:2}
  .afv-cta-bar .afv-save{
    flex:0 0 auto !important;height:38px;min-height:38px;padding:0 14px;font-size:13px;
    width:auto !important;max-width:none;letter-spacing:0}
  .afv-cta-bar .afv-save .afv-lbl-desk{display:none}
  .afv-cta-bar .afv-save .afv-lbl-mob{display:inline !important}
  .afv-cta-price{font-size:14px}
  .afv-cta-price.sem-preco{font-size:11px;max-width:110px}
  .afv-stage{padding-bottom:12px}
  .afv-tool-btns{justify-content:stretch}
  .afv-chip{flex:1;justify-content:center}
  .afv-cart-row{grid-template-columns:64px 1fr 44px;gap:10px;padding:12px;border-radius:14px}
  .afv-cart-thumb{width:64px;height:64px;border-radius:10px}
  .afv-cart-name{font-size:13px}
  .afv-cart-line{font-size:16px}
  .afv-cart-btn{min-height:52px;height:52px;font-size:15px;border-radius:14px}
  .afv-cart-btn-ghost{min-width:96px}
  .afv-cart-btn-primary{flex:1 1 auto}
  .afv-cart-summary{padding:14px}
  .afv-cart-summary-total{font-size:20px}
  .afv-cart-bar{padding-bottom:calc(12px + env(safe-area-inset-bottom))}
  .afv-top-title{font-size:15px;min-width:100px}
  .afv-top-btn{font-size:11px;padding:0 10px;height:36px}
  .afv-top-btn .afv-lbl-desk{display:none}
  .afv-top-btn .afv-lbl-mob{display:inline !important}
  .afv-grid-ref{grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px}
  .afv-ref-img{padding:6px}
  .afv-home-hero{padding:14px 16px}
  .afv-grid-col{grid-template-columns:1fr}
  .afv-edit .afv-foot{gap:8px;padding-top:12px}
  .afv-edit .afv-foot .afv-save{height:40px;min-height:40px;font-size:13px;padding:0 14px;flex:1}
  .afv-edit .afv-foot .afv-save .afv-lbl-desk{display:none}
  .afv-edit .afv-foot .afv-save .afv-lbl-mob{display:inline !important}
  .afv-edit .afv-foot-total b{font-size:16px}
}
@media(min-width:900px){
  .afv-grid-ref{grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:14px}
  .afv-body{padding:18px 22px calc(18px + env(safe-area-inset-bottom))}
}
`;

  function ensure(opts) {
    let el = document.getElementById('catalogoAfvOverlay');
    // Recria se estrutura antiga (sem dock sticky)
    if (el && (el.querySelector('.afv-rail') || !el.querySelector('#afvDock'))) {
      el.remove();
      el = null;
    }
    // Sempre atualiza CSS (deploy / hot reload sem recriar o overlay)
    let stCss = document.getElementById('afvStyles');
    if (!stCss) {
      stCss = document.createElement('style');
      stCss.id = 'afvStyles';
      document.head.appendChild(stCss);
    }
    stCss.textContent = CSS;

    if (el) {
      el.dataset.msNativeModal = '1';
      return el;
    }
    el = document.createElement('div');
    el.id = 'catalogoAfvOverlay';
    el.className = 'afv-overlay' + (opts?.standalone ? ' afv-standalone' : '');
    el.dataset.msNativeModal = '1';
    el.innerHTML = `
      <div class="afv-main">
        <header class="afv-top">
          <button type="button" class="afv-icon-btn" id="afvBack" title="Voltar">${ico('back')}</button>
          <div style="flex:1;min-width:0">
            <div class="afv-top-title" id="afvTitle">Showroom</div>
            <span class="afv-top-sub" id="afvSub" hidden></span>
          </div>
          <div class="afv-top-actions">
            <button type="button" class="afv-top-btn cart" id="afvBtnCart" title="Carrinho">
              ${ico('bag')}<span class="afv-lbl-desk"> Carrinho</span> <span class="afv-badge" id="afvBadge">0</span>
            </button>
            <button type="button" class="afv-top-btn primary" id="afvBtnPendentes" title="Pedidos pendentes">
              <span class="afv-lbl-desk">Pendentes</span><span class="afv-lbl-mob" style="display:none">Pend.</span>
            </button>
            <button type="button" class="afv-icon-btn" id="afvClose" title="Fechar">${ico('x')}</button>
          </div>
        </header>
        <div class="afv-ctx" id="afvCtx" hidden></div>
        <div class="afv-tools" id="afvTools">
          <div class="afv-search">
            ${ico('search')}
            <input type="search" id="afvBusca" placeholder="Buscar coleção, fábrica ou referência…" autocomplete="off">
          </div>
          <div class="afv-tool-btns" id="afvToolBtns">
            <button type="button" class="afv-chip" data-acao="fav">${ico('heart')} Favoritos</button>
            <button type="button" class="afv-chip" data-acao="completo">${ico('grid')} Catálogo completo</button>
          </div>
          <div class="afv-sort" id="afvSort">
            <span class="afv-sort-lbl">Ordenar por</span>
            <button type="button" class="afv-sort-btn" data-sort="cadastro">Cadastro</button>
            <button type="button" class="afv-sort-btn is-on" data-sort="nome">Nome</button>
          </div>
        </div>
        <div class="afv-body" id="afvBody"></div>
        <div class="afv-dock" id="afvDock" aria-live="polite">
          <div class="afv-dock-info">
            <span id="afvDockQtd">0 itens</span>
            <strong id="afvDockTotal">R$&nbsp;0,00</strong>
          </div>
          <button type="button" class="afv-dock-cta" id="afvDockCta">Ver carrinho</button>
        </div>
      </div>`;
    document.body.appendChild(el);

    document.getElementById('afvClose').onclick = fechar;
    document.getElementById('afvBack').onclick = voltar;
    document.getElementById('afvBtnCart').onclick = () => { S.view = 'carrinho'; render(); };
    document.getElementById('afvDockCta').onclick = () => { S.view = 'carrinho'; render(); };
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
    // Delegação (capture): no celular é mais confiável que onclick por card
    document.getElementById('afvBody').addEventListener('click', (e) => {
      const ref = e.target.closest('.afv-ref');
      if (ref && document.getElementById('afvBody').contains(ref)) {
        e.preventDefault();
        e.stopPropagation();
        const id = parseInt(ref.dataset.id, 10);
        if (id) abrirDetalhe(id, ref);
        return;
      }
      const ban = e.target.closest('.afv-banner');
      if (ban && document.getElementById('afvBody').contains(ban)) {
        e.preventDefault();
        e.stopPropagation();
        if (ban.dataset.tipo === 'colecao') abrirColecao(ban.dataset.id);
        else if (ban.dataset.tipo === 'fabrica') abrirFabrica(ban.dataset.id, ban.dataset.nome);
        else if (ban.dataset.tipo === 'tabela') abrirTabela(ban.dataset.id, ban.dataset.nome);
      }
    }, true);
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
    if (S.view === 'inicio' && S._voltaDe) { S.view = S._voltaDe; S._voltaDe = null; render(); return; }
    if (S.view === 'sucesso') { S.view = 'colecoes'; render(); return; }
    if (S.view === 'pendentes') { S.view = 'colecoes'; render(); return; }
    if (S.view === 'prepedido') { S.view = 'carrinho'; render(); return; }
    if (S.view === 'carrinho') { S.view = 'colecoes'; render(); return; }
    if (S.view === 'editar') { S.view = 'detalhe'; render(); return; }
    if (S.view === 'detalhe') {
      S.view = 'refs';
      S.produto = null;
      S.variacoesCores = [];
      S.variacoesMae = null;
      render();
      return;
    }
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

  function setSub(txt) {
    const el = document.getElementById('afvSub');
    if (!el) return;
    if (txt) {
      el.textContent = txt;
      el.hidden = false;
    } else {
      el.textContent = '';
      el.hidden = true;
    }
  }

  function atualizarBadge() {
    const qtd = cartQtd();
    const nItens = S.cart.length;
    const b = document.getElementById('afvBadge');
    if (b) {
      const pcs = Math.round(qtd) || 0;
      if (!nItens || pcs <= 0) {
        b.textContent = '0';
        b.hidden = true;
        b.title = '';
      } else {
        b.hidden = false;
        b.textContent = String(pcs);
        b.title = nItens === 1
          ? `${pcs} unidade${pcs !== 1 ? 's' : ''} no carrinho`
          : `${nItens} produtos · ${pcs} unidades`;
      }
    }

    const ov = document.getElementById('catalogoAfvOverlay');
    const showDock = qtd > 0 && ['colecoes', 'refs', 'detalhe', 'editar'].includes(S.view);
    if (ov) ov.classList.toggle('has-dock', showDock);

    const dq = document.getElementById('afvDockQtd');
    const dt = document.getElementById('afvDockTotal');
    if (dq) {
      const pcs = Math.round(qtd);
      dq.textContent = nItens
        ? `${nItens} produto${nItens !== 1 ? 's' : ''} · ${pcs} un.`
        : 'Carrinho vazio';
    }
    if (dt) dt.textContent = money(cartTotal());
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
    if (!S.cart.length && !S.pre.cod_cliente && !S.pularInicio) S.view = 'inicio';
    render();
  }

  async function carregarConfig() {
    try {
      const d = await apiJson('/api/config/sistema');
      S.habilitaGrade = (d.habilitapedidograde || 'N') === 'S' ? 'S' : 'N';
      S.somaEmbalagem = d.soma_embalagempedido || 'N';
    } catch (_) {
      S.habilitaGrade = 'N';
      S.somaEmbalagem = 'N';
    }
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
      // showroom=1 → só fábricas com Preferências «Aparece no Showroom»
      const d = await apiJson('/api/fornecedores?limit=200&status=A&somente_fabricas=true&lean=1&showroom=1');
      S.fabricas = d.fornecedores || d.data || (Array.isArray(d) ? d : []);
    } catch (_) {
      S.fabricas = [];
    }
  }

  async function carregarTabelas() {
    const map = new Map();
    try {
      const d = await apiJson('/api/tabela-precos/disponiveis-para/0/0/' + (userId() || 0) + '?showroom=1');
      (d.tabelas || []).forEach((t) => {
        const id = t.id_tabela || t.id;
        if (id) map.set(String(id), { id, descricao: t.descricao || ('Tabela ' + id) });
      });
    } catch (_) {}
    try {
      // Só tabelas com «Aparece no Showroom? = Sim» (default N no cadastro)
      const d2 = await apiJson('/api/tabela-precos?limit=80&showroom=1');
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
      id_referencia: parseInt(p.id_referencia, 10) || null,
      cor1: p.cor1 || '',
      qtd_cores: parseInt(p.qtd_cores, 10) || 0,
    };
  }

  /** Mãe conta no badge de cores se tem Cor e está disponível (igual ao picker). */
  function maeContaComoCor(it) {
    if (!String(it.cor1 || '').trim()) return false;
    const disp = String(it.disponivel != null ? it.disponivel : 'S').toUpperCase();
    return disp !== 'N';
  }

  /** Coleção: 1 card por referência (prefere a mãe se estiver na lista). */
  function colapsarItensReferencia(itens) {
    const map = new Map();
    const order = [];
    for (const raw of itens || []) {
      const it = { ...raw };
      const cod = parseInt(it.cod_produto, 10) || 0;
      const idRef = parseInt(it.id_referencia, 10) || 0;
      const key = idRef > 0 ? idRef : cod;
      if (!key) continue;
      const isFilho = idRef > 0;
      const existing = map.get(key);
      if (!existing) {
        it.qtd_cores = isFilho ? 1 : (maeContaComoCor(it) ? 1 : 0);
        map.set(key, it);
        order.push(key);
      } else if (isFilho) {
        existing.qtd_cores = (existing.qtd_cores || 0) + 1;
      } else {
        it.qtd_cores = (existing.qtd_cores || 0) + (maeContaComoCor(it) ? 1 : 0);
        map.set(key, it);
      }
    }
    return order.map((k) => map.get(k));
  }

  async function abrirColecao(id) {
    document.getElementById('afvBody').innerHTML = '<div class="afv-empty">Carregando referências…</div>';
    try {
      const d = await apiJson('/api/catalogos/' + id);
      const fornCat = d.catalogo?.cod_fornecedor || null;
      S.fonte = { tipo: 'colecao', id, nome: d.catalogo?.nome || 'Coleção', cod_fornecedor: fornCat };
      S.itens = colapsarItensReferencia((d.itens || []).map((p) => normItem(p, fornCat)));
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
    try {
      const params = new URLSearchParams({
        catalogo: '1',
        showroom: '1',
        limit: '80',
        ids: ids.slice(0, 80).join(','),
      });
      const d = await apiJson('/api/pedidos/produtos/busca?' + params.toString());
      const byId = new Map((d.data || []).map((p) => [parseInt(p.cod_produto || p.id, 10), p]));
      S.itens = ids.slice(0, 80)
        .map((id) => byId.get(parseInt(id, 10)))
        .filter(Boolean)
        .map((p) => normItem(p));
      S.total = S.itens.length;
      render();
    } catch (e) {
      document.getElementById('afvBody').innerHTML = `<div class="afv-empty">${esc(e.message)}</div>`;
    }
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
        showroom: '1',
        agrupar_referencia: '1',
        limit: String(PAGE),
        offset: String(S.offset),
        q: S.busca || '',
      });
      // 2ª página em diante: não precisa recalcular COUNT
      if (!reset && S.total != null) params.set('skip_total', '1');
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
      if (d.total != null) S.total = d.total;
      else if (reset && rows.length < PAGE) S.total = rows.length;
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
    const norm = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const termos = norm(S.busca).split(/\s+/).filter(Boolean);
    if (!termos.length) return list;
    return list.filter((x) => {
      const h = norm(fields(x));
      return termos.every((t) => h.includes(t));
    });
  }

  function condOptsHtml() {
    return S.condicoes.map((c) => {
      const id = c.id || c.id_forma || c.id_condicao;
      const desc = c.descricao || c.nome || '';
      const sel = String(S.pre.id_condicaopagto || '') === String(id) || S.pre.condicao_pagto === desc ? ' selected' : '';
      return `<option value="${esc(desc)}" data-id="${id || ''}"${sel}>${esc(desc)}</option>`;
    }).join('');
  }

  function tipoOptsHtml() {
    return S.tiposPedido.length
      ? S.tiposPedido.map((t) => {
          const desc = String(t.tipo_pedido || t.descricao || t.nome || 'PEDIDO').toUpperCase();
          const sel = S.pre.tipo_pedido === desc || String(S.pre.id_tipopedido) === String(t.id) ? ' selected' : '';
          return `<option value="${esc(desc)}" data-id="${t.id}"${sel}>${esc(t.tipo_pedido || t.descricao || t.nome)}</option>`;
        }).join('')
      : `<option value="PEDIDO"${S.pre.tipo_pedido === 'PEDIDO' ? ' selected' : ''}>PEDIDO</option>
         <option value="ORCAMENTO"${S.pre.tipo_pedido === 'ORCAMENTO' || S.pre.tipo_pedido === 'ORÇAMENTO' ? ' selected' : ''}>ORÇAMENTO</option>`;
  }

  /** Abas do fechamento: Itens do pedido | Dados do pedido. */
  function abasHtml(ativa) {
    const cls = ativa === 'dados' ? ' afv-abas--dados' : (S.cart.length > 6 ? ' afv-abas--wide' : '');
    return `<div class="afv-abas${cls}">
      <button type="button" class="afv-aba${ativa === 'itens' ? ' on' : ''}" data-aba="carrinho">Itens do pedido (${S.cart.length})</button>
      <button type="button" class="afv-aba${ativa === 'dados' ? ' on' : ''}" data-aba="prepedido">Dados do pedido</button>
    </div>`;
  }

  function bindAbas(body) {
    body.querySelectorAll('.afv-aba').forEach((b) => {
      b.onclick = () => {
        if (b.dataset.aba === S.view) return;
        limparConfirmResiduais();
        S.view = b.dataset.aba;
        render();
      };
    });
  }

  /** Ao escolher o cliente, sugere a tabela de preço liberada para ele. */
  async function sugerirTabelaCliente() {
    if (!S.pre.cod_cliente || S.pre.id_tabela) return;
    try {
      const d = await apiJson('/api/tabela-precos/ativa-para/' + encodeURIComponent(S.pre.cod_cliente) + '/0/' + (userId() || 0));
      if (d && d.id_tabela && !S.pre.id_tabela) {
        S.pre.id_tabela = String(d.id_tabela);
        if (!S.tabelas.some((t) => String(t.id) === String(d.id_tabela))) {
          S.tabelas.push({ id: d.id_tabela, descricao: d.descricao || ('Tabela ' + d.id_tabela) });
        }
        if (S.view === 'inicio') render();
      }
    } catch (_) {}
  }

  function bindCliente() {
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

  /** Faixa fixa com cliente/tabela/condição durante toda a navegação. */
  function atualizarCtx() {
    const el = document.getElementById('afvCtx');
    if (!el) return;
    if (['inicio', 'prepedido', 'sucesso', 'pendentes'].includes(S.view)) { el.hidden = true; return; }
    const tab = S.tabelas.find((t) => String(t.id) === String(S.pre.id_tabela));
    const ico = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5"/></svg>';
    if (S.pre.cod_cliente) {
      const det = [tab ? 'Tabela: ' + tab.descricao : 'Preço de cadastro', S.pre.condicao_pagto ? 'Cond.: ' + S.pre.condicao_pagto : ''].filter(Boolean).join(' · ');
      el.className = 'afv-ctx';
      el.innerHTML = `<span class="afv-ctx-ico">${ico}</span><span class="afv-ctx-txt"><b>${esc(S.pre.nome_cliente)}</b><small>${esc(det)}</small></span><button type="button" class="afv-ctx-btn" id="afvCtxTrocar">Trocar</button>`;
    } else {
      el.className = 'afv-ctx afv-ctx--vazio';
      el.innerHTML = `<span class="afv-ctx-ico">${ico}</span><span class="afv-ctx-txt"><b>Nenhum cliente selecionado</b></span><button type="button" class="afv-ctx-btn" id="afvCtxTrocar">Escolher</button>`;
    }
    el.hidden = false;
    document.getElementById('afvCtxTrocar').onclick = () => {
      S._voltaDe = S.view;
      S.view = 'inicio';
      render();
    };
  }

  function render() {
    limparConfirmResiduais();
    const title = document.getElementById('afvTitle');
    const tools = document.getElementById('afvTools');
    const body = document.getElementById('afvBody');
    const sort = document.getElementById('afvSort');
    if (!body) return;
    // troca de tela (ex.: abas Itens/Dados) começa no topo, sem herdar a rolagem anterior
    if (S._lastView !== S.view) { body.scrollTop = 0; S._lastView = S.view; }
    atualizarBadge();
    atualizarCtx();

    if (S.view === 'colecoes') {
      title.textContent = 'Showroom';
      setSub(userNome() ? `Vendedor: ${userNome()}` : 'Escolha uma coleção para vender');
      tools.style.display = '';
      sort.style.display = 'none';
      const toolBtns = document.getElementById('afvToolBtns');
      if (toolBtns) toolBtns.style.display = '';
      const buscaInp = document.getElementById('afvBusca');
      if (buscaInp) buscaInp.placeholder = 'Buscar coleção, fábrica ou tabela…';

      const bindBanner = (el) => {
        el.onclick = () => {
          if (el.dataset.tipo === 'colecao') abrirColecao(el.dataset.id);
          else if (el.dataset.tipo === 'fabrica') abrirFabrica(el.dataset.id, el.dataset.nome);
          else abrirTabela(el.dataset.id, el.dataset.nome);
        };
      };

      const colCards = filtrarBusca(S.catalogos, (c) => `${c.nome} ${c.subtitulo || ''} ${c.nome_fornecedor || ''}`)
        .map((c) => (c.imagem_capa ? bannerCard : tileCard)('colecao', {
          id: c.id,
          nome: c.nome,
          sub: c.subtitulo || ((c.qtd_itens || 0) + ' referências'),
          capa: c.imagem_capa,
          cor: c.cor_fundo || '#1f2937',
        }));
      // o titulo da secao ja diz que sao fabricas: repetir isso em cada card so poluia
      const fabCards = filtrarBusca(S.fabricas, (f) => `${f.nome || ''} ${f.id}`).slice(0, 12)
        .map((f, i) => tileCard('fabrica', {
          id: f.id,
          nome: f.nome || ('#' + f.id),
          sub: '',
          cor: CORES[i % CORES.length],
          extra: ` data-nome="${esc(f.nome || '')}"`,
        }));
      const tabCards = filtrarBusca(S.tabelas, (t) => `${t.descricao || ''} ${t.id}`).slice(0, 8)
        .map((t, i) => tileCard('tabela', {
          id: t.id,
          nome: t.descricao || ('Tabela ' + t.id),
          sub: '',
          cor: CORES[(i + 3) % CORES.length],
          extra: ` data-nome="${esc(t.descricao || '')}"`,
        }));

      if (!colCards.length && !fabCards.length && !tabCards.length) {
        body.innerHTML = `<div class="afv-empty">Nenhuma coleção disponível.<br>Cadastre em Comercial → Catálogos Visuais<br>ou use <strong>Catálogo completo</strong> / uma fábrica.</div>`;
        return;
      }

      const nome = userNome();
      let heroOff = false;
      try { heroOff = localStorage.getItem('afv_hero_off') === '1'; } catch (_) {}
      const hero = '';
      const sec = (titulo, cards, tipoGrid) => {
        if (!cards.length) return '';
        return `<section class="afv-sec">
          <h2 class="afv-sec-title">${titulo}<span class="afv-sec-count">${cards.length}</span></h2>
          <div class="${tipoGrid === 'banner' ? 'afv-banners' : 'afv-tiles'}">${cards.join('')}</div>
        </section>`;
      };
      const colBanners = colCards.filter((h) => h.includes('afv-banner'));
      const colTiles = colCards.filter((h) => !h.includes('afv-banner'));
      body.innerHTML = hero + `<div class="afv-secoes">`
        + sec('Coleções', colBanners, 'banner') + sec(colBanners.length ? 'Outras coleções' : 'Coleções', colTiles) + sec('Fábricas', fabCards) + sec('Tabelas de preço', tabCards)
        + `</div>`;
      body.querySelectorAll('.afv-banner,.afv-tile').forEach(bindBanner);
      const heroX = document.getElementById('afvHeroX');
      if (heroX) heroX.onclick = () => {
        try { localStorage.setItem('afv_hero_off', '1'); } catch (_) {}
        heroX.closest('.afv-home-hero')?.remove();
      };
      return;
    }

    if (S.view === 'refs') {
      title.textContent = S.fonte?.nome || 'Referências';
      setSub(S.fonte?.tipo === 'favoritos' ? 'Seus favoritos' : 'Toque na referência para ver fotos e cores');
      tools.style.display = '';
      sort.style.display = '';
      const toolBtns = document.getElementById('afvToolBtns');
      if (toolBtns) toolBtns.style.display = '';
      const buscaInp = document.getElementById('afvBusca');
      if (buscaInp) buscaInp.placeholder = 'Buscar código ou descrição…';
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
      const emptyFoto = `<svg class="afv-ref-empty" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7a2 2 0 012-2h2.5l1.2-1.8A1 1 0 019.5 3h5a1 1 0 01.8.4L16.5 5H19a2 2 0 012 2v11a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/><circle cx="12" cy="13" r="3.5"/></svg>`;
      // quanto de cada referência (mãe + cores) já está no carrinho
      const noCart = new Map();
      S.cart.forEach((c) => {
        const q = parseFloat(c.quantidade) || 0;
        [c.cod_produto, c.id_referencia].forEach((k) => {
          const key = parseInt(k, 10);
          if (key) noCart.set(key, (noCart.get(key) || 0) + q);
        });
      });
      const nRefsCart = list.filter((it) => noCart.has(parseInt(it.cod_produto, 10))).length;
      const totRefs = (S.fonte?.tipo !== 'colecao' && S.fonte?.tipo !== 'favoritos' && S.total != null) ? S.total : list.length;
      const contador = `<div class="afv-count"><span><b>${totRefs}</b> referência${totRefs === 1 ? '' : 's'}</span>${nRefsCart ? `<span class="afv-count-cart">${nRefsCart} no carrinho</span>` : ''}</div>`;
      body.innerHTML = contador + `<div class="afv-grid-ref">${list.map((it) => {
        const qCart = noCart.get(parseInt(it.cod_produto, 10)) || 0;
        const fotoHtml = it.foto_principal
          ? `<img src="${esc(it.foto_principal)}" alt="" loading="lazy" decoding="async">`
          : emptyFoto;
        const badge = (it.qtd_cores > 0)
          ? `<span class="afv-ref-badge">${it.qtd_cores} cor${it.qtd_cores > 1 ? 'es' : ''}</span>`
          : '';
        const preco = (parseFloat(it.vlr_venda) || 0) > 0
          ? `<div class="afv-ref-preco">${money(it.vlr_venda)}</div>`
          : '';
        const nome = it.desc_produto
          ? `<div class="afv-ref-nome">${esc(it.desc_produto)}</div>`
          : '';
        const incart = qCart > 0 ? `<span class="afv-ref-incart">✓ ${Math.round(qCart)} un. no carrinho</span>` : '';
        return `<button type="button" class="afv-ref${qCart > 0 ? ' afv-ref--cart' : ''}" data-id="${it.cod_produto}" aria-label="Abrir ${esc(it.desc_produto || it.cod_fabricante || it.cod_produto)}">
          <div class="afv-ref-img">${fotoHtml}${badge}${incart}</div>
          <div class="afv-ref-body">
            <div class="afv-ref-code">${esc(it.cod_fabricante || it.cod_produto)}</div>
            ${nome}
            ${preco}
          </div>
        </button>`;
      }).join('')}</div>${more}`;
      body.querySelectorAll('.afv-ref-img img').forEach((img) => {
        img.onerror = () => { img.replaceWith(Object.assign(document.createElement('div'), { innerHTML: emptyFoto }).firstChild); };
      });
      // clique via delegação em #afvBody (capture) — evita listener duplicado no celular
      document.getElementById('afvMore')?.addEventListener('click', () => carregarProdutos({ reset: false }));
      return;
    }

    if (S.view === 'detalhe') {
      const p = S.produto;
      const maeCod = S.variacoesMae?.cod_fabricante || S.variacoesMae?.id || p.cod_fabricante || p.cod_produto;
      const nVar = (S.variacoesCores && S.variacoesCores.length) || 0;
      // o titulo mostrava so a referencia da mae, e o nome do produto ficava no
      // meio da tela com outro codigo ao lado: confundia quem estava vendendo
      title.textContent = p.desc_produto || ('Ref. ' + maeCod);
      setSub(nVar > 1
        ? `Ref. ${maeCod} · ${nVar} opções — escolha uma e adicione ao pedido`
        : `Ref. ${maeCod}`);
      tools.style.display = 'none';
      const imgs = S.imagens.length ? S.imagens : (p.foto_principal ? [p.foto_principal] : []);
      const src = imgs[S.imgIdx] || p.foto_principal || '';
      const favOn = S.favoritos.has(String(p.cod_produto));
      const rotulos = rotulosDasVariacoes(S.variacoesCores);
      const coresHtml = (S.variacoesCores && S.variacoesCores.length)
        ? `<div class="afv-cores" id="afvCores" aria-label="Opções deste produto">${S.variacoesCores.map((c, i) => {
            const on = parseInt(c.cod_produto, 10) === parseInt(p.cod_produto, 10) ? 'is-on' : '';
            const lbl = rotulos[i];
            const sku = c.cod_fabricante && String(c.cod_fabricante) !== String(lbl)
              ? `<small>${esc(c.cod_fabricante)}</small>` : '';
            const thumb = c.foto_principal ? `<img src="${esc(c.foto_principal)}" alt="">` : '';
            return `<button type="button" class="afv-cor-chip ${on}" data-cod="${c.cod_produto}" title="${esc(c.desc_produto || '')}">${thumb}<span>${esc(lbl)}${sku}</span></button>`;
          }).join('')}</div>`
        : '';
      const corLbl = p.cor1 ? ` · ${p.cor1}` : '';

      // ficha basica na tela: antes so aparecia num toast atras de um icone mudo
      const multi = parseInt(p.multiplo_venda, 10) || 1;
      const fichaItens = [];
      if (p.unidade) fichaItens.push(esc(p.unidade));
      if (multi > 1) fichaItens.push(`Embalagem: ${multi}`);
      if (p.cod_barras) fichaItens.push(esc(p.cod_barras));
      const fichaHtml = fichaItens.length
        ? `<div class="afv-ficha">${fichaItens.map((f) => `<span>${f}</span>`).join('')}</div>`
        : '';

      // preco 0 aparecia como "R$ 0,00", parecendo de graca. Quase sempre e a
      // tabela de preco que nao foi escolhida — o cadastro pode nao ter valor.
      const temPreco = (parseFloat(p.vlr_venda) || 0) > 0;
      const precoHtml = temPreco
        ? `<div class="afv-cta-price">${money(p.vlr_venda)}</div>`
        : `<div class="afv-cta-price sem-preco">Sem preço nesta tabela</div>`;

      body.innerHTML = `<div class="afv-detalhe">
        ${imgs.length > 1 ? `<div class="afv-thumbs">
          ${imgs.length > 5 ? `<button type="button" class="afv-icon-btn" id="afvThumbUp" title="Anterior">‹</button>` : ''}
          ${imgs.map((u, i) => `<button type="button" class="afv-thumb ${i === S.imgIdx ? 'is-on' : ''}" data-i="${i}">
            <img src="${esc(u)}" alt="">
          </button>`).join('')}
          ${imgs.length > 5 ? `<button type="button" class="afv-icon-btn" id="afvThumbDn" title="Próxima">›</button>` : ''}
        </div>` : ''}
        <div class="afv-stage">
          <div class="afv-stage-nome">${esc(p.desc_produto || '')}${esc(corLbl)}</div>
          <div class="afv-stage-sku">${esc(p.cod_fabricante || p.cod_produto)}</div>
          ${coresHtml}
          ${src ? `<img class="afv-stage-img" src="${esc(src)}" alt="">` : '<div class="afv-empty">Sem foto deste produto</div>'}
          ${fichaHtml}
          <div class="afv-fabs">
            <button type="button" class="afv-fab heart ${favOn ? 'is-on' : ''}" id="afvFav" title="${favOn ? 'Remover dos favoritos' : 'Favoritar'}">${ico('heart')}</button>
          </div>
          <div class="afv-cta-bar">
            ${precoHtml}
            <button type="button" class="afv-save" id="afvCart"><span class="afv-lbl-desk">Adicionar ao pedido</span><span class="afv-lbl-mob" style="display:none">Adicionar</span></button>
          </div>
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
      body.querySelectorAll('.afv-cor-chip').forEach((btn) => {
        btn.onclick = () => selecionarCorSku(parseInt(btn.dataset.cod, 10));
      });
      body.querySelectorAll('.afv-thumb').forEach((t) => {
        t.onclick = () => { S.imgIdx = parseInt(t.dataset.i, 10) || 0; render(); };
      });
      const thumbUp = document.getElementById('afvThumbUp');
      if (thumbUp) thumbUp.onclick = () => {
        if (imgs.length) { S.imgIdx = (S.imgIdx - 1 + imgs.length) % imgs.length; render(); }
      };
      const thumbDn = document.getElementById('afvThumbDn');
      if (thumbDn) thumbDn.onclick = () => {
        if (imgs.length) { S.imgIdx = (S.imgIdx + 1) % imgs.length; render(); }
      };
      return;
    }

    if (S.view === 'editar') {
      const p = S.produto;
      title.textContent = 'Quantidade';
      setSub(p.cod_fabricante || p.desc_produto || 'Defina a quantidade');
      tools.style.display = 'none';
      const temGrade = !!(S.habilitaGrade === 'S' && (S.gradeIdSelecionada || p.tipograde) && S.gradeItens.length);
      let mid = '';
      const multEmb = parseInt(p.multiplo_venda, 10) || 1;
      const multHtml = `<div class="afv-mult">
          <div class="afv-mult-f"><span class="afv-edit-lbl">Embalagem</span><input type="text" readonly value="${multEmb}"></div>
          <div class="afv-mult-f"><span class="afv-edit-lbl">Múltiplos (caixas)</span><input type="number" inputmode="numeric" min="1" id="afvMultCx" value="${S.multCx || 1}"></div>
          <button type="button" class="afv-mult-btn" id="afvMultGerar">Gerar múltiplos</button>
        </div>`;
      if (temGrade) {
        const escolhaHtml = (S.gradesDisponiveis.length > 1)
          ? `<div style="margin-bottom:10px">
              <span class="afv-edit-lbl">Escolher grade</span>
              <select id="afvEscolhaGrade" style="width:100%;height:34px;margin-top:4px;font-weight:700">
                ${S.gradesDisponiveis.map((g) => {
                  const lbl = (g.nome || ('Grade #' + g.id))
                    + (g.padrao ? ' (padrão)' : '')
                    + (g.modo_grade === 'F' ? ' · fechada' : '');
                  const sel = String(g.id) === String(S.gradeIdSelecionada) ? ' selected' : '';
                  return `<option value="${g.id}"${sel}>${esc(lbl)}</option>`;
                }).join('')}
              </select>
            </div>`
          : '';
        mid = escolhaHtml + `<div class="afv-grade">${S.gradeItens.map((g) => {
          const q = S.gradeQtd[g.id] || 0;
          return `<div class="afv-gcell">
            <button type="button" class="afv-gbtn plus" data-gid="${g.id}" data-d="1">+</button>
            <div class="afv-glbl">${esc(g.nome)}</div>
            <input type="number" inputmode="numeric" min="0" class="afv-gqtd-in" data-gid="${g.id}" value="${q || ''}" placeholder="0">
            <button type="button" class="afv-gbtn minus" data-gid="${g.id}" data-d="-1">−</button>
          </div>`;
        }).join('')}</div>` + multHtml;
      } else {
        mid = `<div class="afv-qtd-wrap">
          <button type="button" class="afv-gbtn minus" id="afvQMinus">−</button>
          <input type="number" id="afvQtd" min="0" value="${S.qtdSimples}">
          <button type="button" class="afv-gbtn plus" id="afvQPlus">+</button>
        </div>` + multHtml;
      }
      const totalQtd = temGrade
        ? S.gradeItens.reduce((s, g) => s + (parseFloat(S.gradeQtd[g.id]) || 0), 0)
        : (parseFloat(S.qtdSimples) || 0);
      const totalVlr = totalQtd * (parseFloat(p.vlr_venda) || 0);
      const un = p.unidade || 'un';
      const temPrecoEdit = (parseFloat(p.vlr_venda) || 0) > 0;
      const fotoEdit = p.foto_principal
        ? `<img src="${esc(p.foto_principal)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'afv-edit-semfoto',textContent:'sem foto'}))">`
        : `<div class="afv-edit-semfoto">sem foto</div>`;
      body.innerHTML = `<div class="afv-edit">
        <div class="afv-edit-top">
          ${fotoEdit}
          <div class="afv-edit-meta">
            <div class="afv-edit-nome">${esc(p.desc_produto || '')}</div>
            <div class="afv-edit-ref">Ref. ${esc(p.cod_fabricante || p.cod_produto)} · ${esc(un)}</div>
            <div class="afv-edit-preco">${temPrecoEdit
              ? `${money(p.vlr_venda)} <small>por ${esc(un)}</small>`
              : '<small style="color:#b45309">Sem preço nesta tabela</small>'}</div>
          </div>
        </div>
        <div class="afv-edit-sec">
          <span class="afv-edit-lbl">${temGrade ? 'Quantidade por tamanho' : 'Quantidade'}</span>
          ${mid}
        </div>
        <div class="afv-obs-wrap">
          <span class="afv-edit-lbl">Observação (opcional)</span>
          <input type="text" class="afv-obs" id="afvObs" maxlength="100" value="${esc(S.obsItem)}" placeholder="Ex.: entregar junto com o pedido anterior">
        </div>
        <div class="afv-foot">
          <div class="afv-foot-total">
            <b>${money(totalVlr)}</b>
            <span>${totalQtd} ${totalQtd === 1 ? 'item' : 'itens'}</span>
          </div>
          <button type="button" class="afv-save" id="afvSalvar"><span class="afv-lbl-desk">Adicionar ao pedido</span><span class="afv-lbl-mob" style="display:none">Adicionar</span></button>
        </div>
      </div>`;
      if (temGrade) {
        const selG = document.getElementById('afvEscolhaGrade');
        if (selG) {
          selG.onchange = async () => {
            const id = parseInt(selG.value, 10) || 0;
            if (id) await carregarGradeShowroom(id);
            render();
          };
        }
        body.querySelectorAll('.afv-gbtn[data-gid]').forEach((btn) => {
          btn.onclick = () => {
            const id = parseInt(btn.dataset.gid, 10);
            const d = parseInt(btn.dataset.d, 10);
            S.gradeQtd[id] = Math.max(0, (parseFloat(S.gradeQtd[id]) || 0) + d);
            S.gradeBase = null;
            render();
          };
        });
        body.querySelectorAll('.afv-gqtd-in').forEach((inp) => {
          inp.onfocus = () => inp.select();
          inp.onchange = () => {
            S.gradeQtd[parseInt(inp.dataset.gid, 10)] = Math.max(0, parseInt(inp.value, 10) || 0);
            S.gradeBase = null;
            // sem render(): redesenhar no blur engole o toque em "Adicionar"
            const tq = S.gradeItens.reduce((acc, g) => acc + (parseFloat(S.gradeQtd[g.id]) || 0), 0);
            const fb = body.querySelector('.afv-foot-total b');
            const fs = body.querySelector('.afv-foot-total span');
            if (fb) fb.textContent = money(tq * (parseFloat(p.vlr_venda) || 0));
            if (fs) fs.textContent = tq + (tq === 1 ? ' item' : ' itens');
          };
        });
      } else {
        document.getElementById('afvQMinus').onclick = () => { S.qtdSimples = Math.max(0, (parseFloat(S.qtdSimples) || 0) - 1); render(); };
        document.getElementById('afvQPlus').onclick = () => { S.qtdSimples = (parseFloat(S.qtdSimples) || 0) + 1; render(); };
        document.getElementById('afvQtd').onchange = (e) => { S.qtdSimples = Math.max(0, parseFloat(e.target.value) || 0); };
      }
      const cxInp = document.getElementById('afvMultCx');
      if (cxInp) cxInp.onchange = () => { S.multCx = Math.max(1, parseInt(cxInp.value, 10) || 1); };
      const gerarBtn = document.getElementById('afvMultGerar');
      if (gerarBtn) gerarBtn.onclick = () => {
        const cx = Math.max(1, parseInt(cxInp?.value, 10) || 1);
        S.multCx = cx;
        if (temGrade) {
          // base = grade digitada; "gerar" sempre multiplica a base (não acumula)
          if (!S.gradeBase) S.gradeBase = { ...S.gradeQtd };
          const tot = Object.values(S.gradeBase).reduce((a, v) => a + (parseFloat(v) || 0), 0);
          if (tot <= 0) { toast('Digite a grade primeiro', 'warn'); return; }
          S.gradeItens.forEach((g) => { S.gradeQtd[g.id] = (parseFloat(S.gradeBase[g.id]) || 0) * cx; });
        } else {
          S.qtdSimples = multEmb * cx;
        }
        render();
      };
      document.getElementById('afvObs').oninput = (e) => { S.obsItem = e.target.value; };
      document.getElementById('afvSalvar').onclick = adicionarAoCarrinho;
      return;
    }

    if (S.view === 'inicio') {
      title.textContent = 'Novo carrinho';
      setSub('Cliente, tabela e condição antes de abrir o catálogo');
      tools.style.display = 'none';
      const tabOpts = '<option value="">Preço de cadastro (sem tabela)</option>' + S.tabelas.map((t) =>
        `<option value="${esc(t.id)}"${String(S.pre.id_tabela) === String(t.id) ? ' selected' : ''}>${esc(t.descricao)}</option>`
      ).join('');
      const cliSel = S.pre.cod_cliente
        ? `<div class="afv-cli-sel" id="afvCliSel"><span>#${esc(S.pre.cod_cliente)} — ${esc(S.pre.nome_cliente)}</span>
            <button type="button" id="afvCliLimpar">Trocar</button></div>`
        : '';
      body.innerHTML = `<div class="afv-pre afv-ini">
        <div class="afv-ini-ico"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="7" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M19 8v6M16 11h6"/></svg></div>
        <h3>Selecione um cliente para iniciar o carrinho</h3>
        <p class="afv-ini-sub">A tabela de preço e as condições já entram prontas no catálogo.</p>
        <div>
          <label>Cliente *</label>
          <div class="afv-ac">
            <input type="search" id="afvCliBusca" placeholder="Buscar nome, apelido ou CPF/CNPJ…" autocomplete="off" ${S.pre.cod_cliente ? 'style="display:none"' : ''}>
            <div id="afvCliList" class="afv-ac-list"></div>
            ${cliSel}
          </div>
        </div>
        <div><label>Tabela de preço</label><select id="afvIniTab">${tabOpts}</select></div>
        <div><label>Condição de pagamento</label><select id="afvCond"><option value="">—</option>${condOptsHtml()}</select></div>
        <div><label>Tipo do pedido</label><select id="afvTipo">${tipoOptsHtml()}</select></div>
        ${S.cart.length ? '<p class="afv-ini-sub">Os itens que já estão no carrinho mantêm o preço em que foram adicionados.</p>' : ''}
        <button type="button" class="afv-save" id="afvCriarCarrinho">${S._voltaDe ? 'Confirmar' : 'Criar carrinho'}</button>
        <button type="button" class="afv-ini-skip" id="afvPularInicio">${S._voltaDe ? 'Voltar' : 'Só navegar no catálogo'}</button>
      </div>`;
      bindCliente();
      document.getElementById('afvIniTab').onchange = (e) => { S.pre.id_tabela = e.target.value; };
      document.getElementById('afvCond').onchange = (e) => {
        const opt = e.target.selectedOptions[0];
        S.pre.condicao_pagto = e.target.value;
        S.pre.id_condicaopagto = opt?.dataset?.id ? parseInt(opt.dataset.id, 10) : null;
      };
      document.getElementById('afvTipo').onchange = (e) => {
        const opt = e.target.selectedOptions[0];
        S.pre.tipo_pedido = e.target.value;
        S.pre.id_tipopedido = opt?.dataset?.id ? parseInt(opt.dataset.id, 10) : null;
      };
      const sairInicio = () => {
        S.pularInicio = true;
        S.view = S._voltaDe || 'colecoes';
        S._voltaDe = null;
        render();
      };
      document.getElementById('afvCriarCarrinho').onclick = () => {
        if (!S.pre.cod_cliente) { toast('Selecione o cliente', 'warn'); return; }
        sairInicio();
      };
      document.getElementById('afvPularInicio').onclick = sairInicio;
      return;
    }

    if (S.view === 'carrinho') {
      title.textContent = 'Carrinho';
      setSub('Revise os itens com o cliente antes de seguir');
      tools.style.display = 'none';
      if (!S.cart.length) {
        body.innerHTML = `<div class="afv-empty">Carrinho vazio.<br>Escolha uma coleção e adicione produtos.<br>
          <button type="button" class="afv-save" id="afvVoltarHome" style="margin-top:16px">Escolher coleção</button></div>`;
        document.getElementById('afvVoltarHome')?.addEventListener('click', () => { S.view = 'colecoes'; render(); });
        return;
      }
      const nItens = S.cart.length;
      const pcs = Math.round(cartQtd()) || 0;
      const compacto = nItens > 6;
      const comBusca = nItens > 8;
      const normC = (t) => String(t || '').normalize('NFD').replace(new RegExp('[' + String.fromCharCode(768) + '-' + String.fromCharCode(879) + ']', 'g'), '').toLowerCase();
      const rowsHtml = () => {
        const termos = normC(S.cartFiltro).split(/\s+/).filter(Boolean);
        const linhas = [];
        S.cart.forEach((it, idx) => {
          const h = normC(`${it.cod_fabricante || ''} ${it.cod_produto || ''} ${it.desc_produto || ''} ${it.cor1 || ''} ${it.nome_fornecedor || ''}`);
          if (termos.every((t) => h.includes(t))) linhas.push(cartRowHtml(it, idx));
        });
        return linhas.length ? linhas.join('') : '<div class="afv-empty" style="grid-column:1/-1">Nenhum item encontrado.</div>';
      };
      if (!comBusca) S.cartFiltro = '';
      body.innerHTML = abasHtml('itens') + `<div class="afv-cart${compacto ? ' afv-cart--compact' : ''}">
        ${comBusca ? `<div class="afv-cart-find"><input type="search" id="afvCartFind" placeholder="Buscar no carrinho (referência, descrição, cor)…" autocomplete="off" value="${esc(S.cartFiltro)}"><span>${nItens} itens</span></div>` : ''}
        <div class="afv-cart-rows" id="afvCartRows">
          ${rowsHtml()}
        </div>
        <div class="afv-cart-bar">
          <div class="afv-cart-summary">
            <div class="afv-cart-summary-meta">
              <span>${nItens} produto${nItens !== 1 ? 's' : ''} · ${pcs} un.</span>
              <strong>Total do carrinho</strong>
            </div>
            <div class="afv-cart-summary-total">${money(cartTotal())}</div>
          </div>
          <div class="afv-cart-actions">
            <button type="button" class="afv-cart-btn afv-cart-btn-ghost" id="afvLimparCart">Limpar</button>
            <button type="button" class="afv-cart-btn afv-cart-btn-primary" id="afvIrPre">Continuar</button>
          </div>
        </div>
      </div>`;
      bindAbas(body);
      const bindRm = () => body.querySelectorAll('.afv-cart-rm').forEach((btn) => {
        btn.onclick = () => {
          limparConfirmResiduais();
          S.cart.splice(parseInt(btn.dataset.idx, 10), 1);
          saveCart();
          render();
        };
      });
      bindRm();
      const findInp = document.getElementById('afvCartFind');
      if (findInp) {
        findInp.oninput = () => {
          S.cartFiltro = findInp.value;
          document.getElementById('afvCartRows').innerHTML = rowsHtml();
          bindRm();
        };
      }
      const limparBtn = document.getElementById('afvLimparCart');
      limparBtn.onclick = () => {
        limparConfirmResiduais();
        if (!S.cart.length) {
          toast('Carrinho já está vazio', 'ok');
          return;
        }
        limparCarrinhoPersistido();
        toast('Carrinho limpo', 'ok');
        render();
      };
      document.getElementById('afvIrPre').onclick = () => { limparConfirmResiduais(); S.view = 'prepedido'; render(); };
      return;
    }

    if (S.view === 'prepedido') {
      title.textContent = 'Pré-pedido';
      setSub('Cliente e condições — pedido fica PENDENTE');
      tools.style.display = 'none';
      const condOpts = condOptsHtml();
      const tipoOpts = tipoOptsHtml();
      const formaOpts = FORMAS.map((f) =>
        `<option value="${f.v}"${S.pre.forma_pagto === f.v ? ' selected' : ''}>${f.l}</option>`
      ).join('');
      const cliSel = S.pre.cod_cliente
        ? `<div class="afv-cli-sel" id="afvCliSel"><span>#${esc(S.pre.cod_cliente)} — ${esc(S.pre.nome_cliente)}</span>
            <button type="button" id="afvCliLimpar">Trocar</button></div>`
        : '';
      const pcsPre = Math.round(cartQtd()) || 0;
      body.innerHTML = abasHtml('dados') + `<div class="afv-pre afv-dados">
        <div class="afv-resumo afv-dados-resumo">
          <span><strong>${S.cart.length}</strong> ${S.cart.length === 1 ? 'item' : 'itens'} · <strong>${pcsPre}</strong> un.</span>
          <span class="afv-dados-total">${money(cartTotal())}</span>
        </div>
        <div>
          <label>Cliente *</label>
          <div class="afv-ac">
            <input type="search" id="afvCliBusca" placeholder="Buscar nome, apelido ou CPF/CNPJ…" autocomplete="off" ${S.pre.cod_cliente ? 'style="display:none"' : ''}>
            <div id="afvCliList" class="afv-ac-list"></div>
            ${cliSel}
          </div>
        </div>
        <div class="afv-dados-grid">
          <div>
            <label>Condição de pagamento</label>
            <select id="afvCond"><option value="">— Selecione —</option>${condOpts}</select>
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
            <label>Data de entrega</label>
            <input type="date" id="afvDataEntrega" value="${esc(S.pre.data_entrega || '')}">
          </div>
          <div class="afv-dados-full">
            <label>Ordem de compra</label>
            <input type="text" id="afvOrdemCompra" maxlength="100" autocomplete="off" placeholder="Opcional" value="${esc(S.pre.ped_compras || '')}">
          </div>
          <div class="afv-dados-full">
            <label>Observação</label>
            <textarea id="afvObsPed" placeholder="Opcional">${esc(S.pre.obs)}</textarea>
          </div>
        </div>
        <div class="afv-dados-bar">
          <button type="button" class="afv-ok-sec afv-dados-back" id="afvVoltarCart">← Itens</button>
          <button type="button" class="afv-save" id="afvFinalizar">Finalizar pedido pendente</button>
        </div>
      </div>`;
      bindAbas(body);
      bindPrePedido();
      return;
    }

    if (S.view === 'pendentes') {
      title.textContent = 'Pedidos pendentes';
      setSub('Mesma visibilidade da tela de Pedidos');
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
      setSub('Pronto — você pode acompanhar em Pendentes');
      tools.style.display = 'none';
      const nums = (S.lastPedidos || []).map((p) => '#' + (p.numero || p.id)).join(', ');
      const nPed = (S.lastPedidos || []).length;
      body.innerHTML = `<div class="afv-ok">
        <div class="afv-ok-ico"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
        <h3>Pré-pedido gravado!</h3>
        <p class="afv-ok-sub">${nPed > 1 ? 'Pedidos' : 'Pedido'} <span class="afv-ok-num">${esc(nums || 'criado')}</span> enviado${nPed > 1 ? 's' : ''} com status <strong>PENDENTE</strong></p>
        <div class="afv-ok-btns">
          <button type="button" class="afv-save afv-ok-main" id="afvVerPendentes">Ver pendentes</button>
          <div class="afv-ok-row">
            <button type="button" class="afv-ok-sec" id="afvVerPedidos">Abrir Pedidos</button>
            <button type="button" class="afv-ok-sec" id="afvNovoShow">Novo showroom</button>
          </div>
        </div>
      </div>`;
      document.getElementById('afvVerPendentes').onclick = () => abrirPendentes();
      document.getElementById('afvVerPedidos').onclick = () => irPedidos(true);
      document.getElementById('afvNovoShow').onclick = () => {
        S.lastPedidos = [];
        S.pre.cod_cliente = '';
        S.pre.nome_cliente = '';
        S.pre.cnpj = '';
        S.pre.id_tabela = '';
        S.pre.obs = '';
        S.pre.data_entrega = '';
        S.pre.ped_compras = '';
        S.pularInicio = false;
        S.view = 'inicio';
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
    document.getElementById('afvDataEntrega').onchange = (e) => { S.pre.data_entrega = e.target.value || ''; };
    document.getElementById('afvOrdemCompra').oninput = (e) => { S.pre.ped_compras = e.target.value; };
    bindCliente();
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
          sugerirTabelaCliente();
        };
      });
    } catch (e) {
      list.innerHTML = `<div class="afv-ac-item">${esc(e.message)}</div>`;
    }
  }

  async function carregarImagensProduto(cod) {
    S.imagens = S.produto?.foto_principal ? [S.produto.foto_principal] : [];
    S.imgIdx = 0;
    try {
      const d = await apiJson('/api/produtos/' + cod + '/imagens');
      const imgs = (d.imagens || d || []).map((x) => x.url || x.caminho || x.filename).filter(Boolean);
      if (imgs.length) {
        S.imagens = imgs.map((u) => (String(u).startsWith('/') || String(u).startsWith('http') ? u : '/uploads/produtos/' + cod + '/' + u));
      }
    } catch (_) {}
  }

  let _abrindoDetalhe = false;

  function setAfvBusy(on, msg) {
    const root = document.querySelector('.afv-overlay.show') || document.querySelector('.afv-overlay');
    if (!root) return;
    let busy = document.getElementById('afvBusy');
    if (on) {
      if (!busy) {
        busy = document.createElement('div');
        busy.id = 'afvBusy';
        busy.className = 'afv-busy';
        busy.innerHTML = '<div class="afv-busy-card"><div class="afv-busy-spin"></div><span id="afvBusyTxt">Abrindo…</span></div>';
        root.appendChild(busy);
      }
      const txt = document.getElementById('afvBusyTxt');
      if (txt) txt.textContent = msg || 'Abrindo…';
      busy.style.display = 'flex';
    } else if (busy) {
      busy.style.display = 'none';
    }
  }

  async function abrirDetalhe(cod, cardEl) {
    if (_abrindoDetalhe) return;
    _abrindoDetalhe = true;
    const limparUi = () => {
      _abrindoDetalhe = false;
      setAfvBusy(false);
      document.querySelectorAll('.afv-ref.is-opening').forEach((el) => el.classList.remove('is-opening'));
    };
    try {
      const p = S.itens.find((it) => parseInt(it.cod_produto, 10) === cod);
      if (!p) return;
      if (cardEl) cardEl.classList.add('is-opening');
      setAfvBusy(true, 'Abrindo cores…');

      // Referência com várias cores: abre o picker por cima do Showroom (sem piscar detalhe e voltar).
      const temCoresBadge = (parseInt(p.qtd_cores, 10) || 0) > 0
        || String(p.agrupa_cores || '').toUpperCase() === 'S';
      if (temCoresBadge && typeof ProdutoCoresPicker !== 'undefined') {
        try {
          const g = await Promise.race([
            apiJson('/api/produtos/' + cod + '/variacoes'),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout cores')), 12000)),
          ]);
          const cores = g.cores || [];
          const mae = g.mae || (g.papel === 'mae' ? g.eu : null) || p;
          if ((g.papel === 'mae' || cores.length > 0) && cores.length) {
            const coresNorm = cores.map((c) => normItem(c, p.cod_fornecedor));
            S.variacoesMae = mae;
            S.variacoesCores = coresNorm;
            setAfvBusy(false);
            const opened = await ProdutoCoresPicker.open({
              grupo: {
                papel: 'mae',
                mae: { ...normItem(mae, p.cod_fornecedor), id: mae.id || mae.cod_produto || mae.ID || cod },
                cores: coresNorm.map((c) => ({
                  ...c,
                  id: c.cod_produto,
                  descricao: c.desc_produto,
                })),
              },
              formatPreco: money,
              okTexto: 'Adicionar ao carrinho',
              titulo: 'Escolher cores',
              habilitaGrade: S.habilitaGrade,
              fetchGrade: async (idGrade) => apiJson('/api/pedidos/grade/' + idGrade),
              fetchGradesProduto: async (prodId) => apiJson('/api/produtos/' + prodId + '/grades'),
              onConfirm: async (selecoes) => {
                let adicionados = 0;
                setAfvBusy(true, 'Adicionando ao carrinho…');
                let lote = null;
                try {
                  lote = await precarregarPrecos(selecoes.map((x) => x.cod_produto));
                  let feitos = 0;
                  for (const s of selecoes) {
                  feitos += 1;
                  if (selecoes.length > 1) setAfvBusy(true, `Adicionando ao carrinho… ${feitos}/${selecoes.length}`);
                  const codCor = parseInt(s.cod_produto, 10);
                  await selecionarCorSku(codCor, { silent: true, lote });
                  // Garante o SKU da cor (no celular a busca de preço pode falhar e o add sumia)
                  if (!S.produto || parseInt(S.produto.cod_produto, 10) !== codCor) {
                    const fromVar = S.variacoesCores.find((c) => parseInt(c.cod_produto, 10) === codCor);
                    const fromSel = s.prod
                      ? normItem({ ...s.prod, cod_produto: codCor, id: codCor }, p.cod_fornecedor)
                      : null;
                    if (fromVar || fromSel) S.produto = fromVar || fromSel;
                  }
                  if (!S.produto || parseInt(S.produto.cod_produto, 10) !== codCor) continue;

                  if (s.grade_qtd && s.grade_qtd.length) {
                    S.gradeIdSelecionada = s.id_grade || null;
                    S.gradeItens = s.grade_qtd.map((g) => ({
                      id: g.id_descricao_grade,
                      sequencial: g.sequencial,
                      nome: g.nome_grade,
                    }));
                    S.gradeQtd = {};
                    s.grade_qtd.forEach((g) => {
                      S.gradeQtd[g.id_descricao_grade] = parseFloat(g.quantidade) || 0;
                    });
                    S.qtdSimples = s.qtd;
                    // força caminho de grade no add (mesmo se tipograde do SKU vier vazio)
                    if (s.id_grade) S.produto.tipograde = s.id_grade;
                  } else {
                    S.qtdSimples = s.qtd;
                    S.gradeQtd = {};
                    S.gradeItens = [];
                    S.gradeIdSelecionada = null;
                  }
                  S.obsItem = '';
                  const antes = S.cart.length;
                  adicionarAoCarrinho({ quiet: true });
                  if (S.cart.length > antes || S.cart.some((c) => parseInt(c.cod_produto, 10) === codCor)) {
                    adicionados += 1;
                  }
                }
                } finally {
                  setAfvBusy(false);
                }
                if (adicionados > 0) {
                  toast(adicionados === 1 ? '1 item adicionado' : `${adicionados} itens adicionados`, 'ok');
                } else {
                  toast('Não foi possível adicionar ao carrinho. Tente de novo.', 'err');
                }
                S.view = 'refs';
                S.produto = null;
                render();
              },
            });
            if (opened) return; // fica na lista de refs; picker por cima
          }
        } catch (err) {
          console.warn('[showroom] cores', err);
        }
      }

      setAfvBusy(false);
      S.produto = p;
      S.variacoesCores = [];
      S.variacoesMae = null;
      S.imgIdx = 0;
      S.imagens = p.foto_principal ? [p.foto_principal] : [];
      S.view = 'detalhe';
      render();
      await carregarImagensProduto(cod);
      if (S.view === 'detalhe') render();
      try {
        const g = await apiJson('/api/produtos/' + cod + '/variacoes');
        const cores = g.cores || [];
        if (cores.length) {
          S.variacoesMae = g.mae || null;
          S.variacoesCores = cores.map((c) => normItem(c, p.cod_fornecedor));
          if (g.papel === 'mae' && S.variacoesCores[0]) {
            await selecionarCorSku(S.variacoesCores[0].cod_produto, { silent: true });
          } else if (S.view === 'detalhe') {
            render();
          }
        }
      } catch (_) {}
    } finally {
      limparUi();
    }
  }

  /**
   * Troca o SKU ativo para a cor escolhida (pedido continua no filho).
   * Busca preço da tabela atual sem agrupar (para achar a cor).
   */
  /** Preço de várias cores numa só consulta (ids em lote) → Map cod_produto → linha. */
  async function precarregarPrecos(cods) {
    const mapa = new Map();
    const ids = [...new Set(cods.map((c) => parseInt(c, 10)).filter(Boolean))].slice(0, 80);
    if (!ids.length) return mapa;
    try {
      const params = new URLSearchParams({ catalogo: '1', ids: ids.join(','), limit: String(ids.length) });
      if (S.fonte?.tipo === 'fabrica') {
        params.set('id_fornecedor', S.fonte.id);
        if (S.pre.id_tabela) params.set('id_tabela', S.pre.id_tabela);
      } else if (S.fonte?.tipo === 'tabela') {
        params.set('id_tabela', S.fonte.id);
      } else if (S.pre.id_tabela) {
        params.set('id_tabela', S.pre.id_tabela);
      }
      const d = await apiJson('/api/pedidos/produtos/busca?' + params.toString());
      (d.data || []).forEach((r) => {
        const k = parseInt(r.cod_produto || r.id, 10);
        if (k) mapa.set(k, r);
      });
    } catch (_) { /* sem lote: cai no preço já carregado da variação */ }
    return mapa;
  }

  async function selecionarCorSku(codProduto, { silent, lote } = {}) {
    const cod = parseInt(codProduto, 10);
    if (!cod) return;
    let next = S.variacoesCores.find((c) => parseInt(c.cod_produto, 10) === cod);
    if (!next && S.variacoesMae && parseInt(S.variacoesMae.id, 10) === cod) {
      next = normItem(S.variacoesMae, S.produto?.cod_fornecedor);
    }
    if (!next) return;

    // Lote: preço já veio numa única consulta — sem busca nem imagens por cor
    if (lote) {
      const row = lote.get(cod);
      if (row) next = { ...next, ...normItem(row, next.cod_fornecedor) };
      S.produto = next;
      return;
    }

    // Preço da tabela / fábrica atual (sem agrupar_referencia para achar o filho)
    try {
      const params = new URLSearchParams({
        catalogo: '1',
        q: String(cod),
        limit: '8',
      });
      if (S.fonte?.tipo === 'fabrica') {
        params.set('id_fornecedor', S.fonte.id);
        if (S.pre.id_tabela) params.set('id_tabela', S.pre.id_tabela);
      } else if (S.fonte?.tipo === 'tabela') {
        params.set('id_tabela', S.fonte.id);
      } else if (S.pre.id_tabela) {
        params.set('id_tabela', S.pre.id_tabela);
      }
      const d = await apiJson('/api/pedidos/produtos/busca?' + params.toString());
      const row = (d.data || []).find((p) => parseInt(p.cod_produto || p.id, 10) === cod);
      if (row) next = { ...next, ...normItem(row, next.cod_fornecedor) };
    } catch (_) {}

    S.produto = next;
    await carregarImagensProduto(cod);
    if (S.view === 'detalhe') render();
    if (!silent) toast((next.cor1 || next.cod_fabricante || 'Cor') + ' selecionada', 'ok');
  }

  async function carregarGradeShowroom(idGrade) {
    S.gradeIdSelecionada = idGrade || null;
    S.gradeBase = null;
    S.gradeItens = [];
    S.gradeQtd = {};
    if (!idGrade) return;
    try {
      const d = await apiJson('/api/pedidos/grade/' + idGrade);
      S.gradeItens = d.itens || [];
      S.gradeItens.forEach((g) => { S.gradeQtd[g.id] = 0; });
      if (typeof SysRepGradePack !== 'undefined') {
        SysRepGradePack.aplicarSugestaoPackFechada(S.gradeItens, d.modo_grade, S.gradeQtd);
      }
    } catch (_) {
      S.gradeItens = [];
    }
  }

  async function abrirEditar() {
    const p = S.produto;
    if (!p) return;
    S.obsItem = '';
    S.gradeItens = [];
    S.gradeQtd = {};
    S.gradesDisponiveis = [];
    S.gradeIdSelecionada = null;
    S.gradeBase = null;
    S.multCx = 1;
    const mv = parseInt(p.multiplo_venda, 10) || 1;
    const qmin = parseInt(p.qtd_minima_pedido, 10) || 0;
    S.qtdSimples = Math.max(mv, qmin, 1);
    if (S.habilitaGrade === 'S' && p.tipograde) {
      try {
        const gd = await apiJson('/api/produtos/' + (p.cod_produto || p.id) + '/grades');
        S.gradesDisponiveis = gd.grades || [];
      } catch (_) {
        S.gradesDisponiveis = [];
      }
      if (!S.gradesDisponiveis.length) {
        S.gradesDisponiveis = [{ id: parseInt(p.tipograde, 10), nome: p.tipoprodutograde || '', padrao: true }];
      }
      const padrao = S.gradesDisponiveis.find((g) => g.padrao) || S.gradesDisponiveis[0];
      await carregarGradeShowroom(padrao?.id || p.tipograde);
    }
    S.view = 'editar';
    render();
  }

  function adicionarAoCarrinho(opts = {}) {
    const p = S.produto;
    if (!p) return;
    const idGradeUsar = S.gradeIdSelecionada || p.tipograde;
    const gradeLigada = S.habilitaGrade === true || String(S.habilitaGrade || '').toUpperCase() === 'S';
    const temGrade = !!(gradeLigada && idGradeUsar && S.gradeItens.length);
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
    const embIni = embalagemDoProduto(p);
    const maeFab = String(S.variacoesMae?.cod_fabricante || p.cod_fabricante_mae || '').trim();
    const line = {
      cod_produto: p.cod_produto,
      cod_fabricante: p.cod_fabricante,
      cod_fabricante_mae: maeFab,
      id_referencia: parseInt(p.id_referencia, 10) || null,
      desc_produto: p.desc_produto,
      unidade: p.unidade,
      tipograde: idGradeUsar,
      tipoprodutograde: p.tipoprodutograde,
      foto_principal: p.foto_principal,
      vlr_venda: p.vlr_venda,
      quantidade: qtd,
      grade_qtd,
      grade_resumo,
      id_grade: temGrade ? idGradeUsar : null,
      tipo_grade: temGrade ? String(idGradeUsar) : null,
      obsitem: (S.obsItem || '').slice(0, 100),
      cor1: p.cor1 || '',
      cores_qt: p.cor1 || '',
      cod_fornecedor: forn,
      nome_fornecedor: nomeForn,
      multiplo_venda: p.multiplo_venda,
      qtd_minima_pedido: p.qtd_minima_pedido,
      precopeso: p.precopeso,
      kilo_embalagem: p.kilo_embalagem,
      embalagem: embIni,
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
    if (!opts.quiet) toast('Adicionado ao carrinho', 'ok');
    if (!opts.quiet) {
      // volta ao detalhe da referência para o cliente escolher outra cor
      S.view = 'detalhe';
      render();
    }
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
        const vlrSub = itens.reduce((s, i) => s + lineTotal(i), 0);
        const vlrSubR = Math.round(vlrSub * 100) / 100;

        // Regras da fábrica (mesmas do pedido): mínimo de faturamento e mínimo de caixas
        try {
          const fDet = await apiJson('/api/fornecedores/' + codForn);
          const vlrMin = parseFloat(fDet.vlr_minimofaturamento) || 0;
          if (vlrMin > 0 && vlrSubR < vlrMin - 0.005) {
            const err = new Error(
              `${nomeForn || 'Fábrica'}: total ${money(vlrSubR)} abaixo do faturamento mínimo (${money(vlrMin)}).`
            );
            err._bloqueioFabrica = true;
            throw err;
          }
          const minCx = parseInt(fDet.min_cx_pedido, 10) || 0;
          if (minCx > 0) {
            const totalCx = itens.reduce((s, i) => {
              const mult = parseInt(i.multiplo_venda, 10) || 1;
              return s + ((parseFloat(i.quantidade) || 0) / mult);
            }, 0);
            if (totalCx < minCx) {
              const err = new Error(
                `${nomeForn || 'Fábrica'}: ${Math.floor(totalCx)} cx abaixo do mínimo de ${minCx} caixas.`
              );
              err._bloqueioFabrica = true;
              throw err;
            }
          }
        } catch (e) {
          if (e && e._bloqueioFabrica) throw e;
          // Se GET fornecedor falhar, não bloqueia — backend do pedido ainda valida o que puder
        }

        const itensBody = itens.map((i) => {
          const q = parseFloat(i.quantidade) || 0;
          const vu = parseFloat(i.vlr_venda) || 0;
          const tot = Math.round(lineTotal(i) * 100) / 100;
          const emb = i.embalagem != null ? i.embalagem : embalagemDoProduto(i);
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
            precopeso: i.precopeso || 'N',
            kilo_embalagem: i.kilo_embalagem,
            embalagem: emb,
            id_grade: i.id_grade || null,
            tipo_grade: i.tipo_grade || null,
            grade_qtd: i.grade_qtd || [],
            obsitem: i.obsitem || '',
            cores_qt: i.cores_qt || i.cor1 || '',
            cor1: i.cor1 || '',
            cod_fornecedor: codForn,
          };
        });

        const condicao = S.pre.condicao_pagto || '';
        const forma = S.pre.forma_pagto || 'BOLETO';
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
            condicao_pagto: condicao,
            forma_pagto: forma,
            prazo_pagto: condicao,
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
            data_entrega: S.pre.data_entrega || null,
            ped_compras: (S.pre.ped_compras || '').trim(),
          },
          itens: itensBody,
          parcelas: [{
            vencimento: hojeIso(),
            valor: vlrSubR,
            forma_pagto: forma,
            desconto: 0,
          }],
        };

        const r = await apiJson('/api/pedidos', { method: 'POST', body: JSON.stringify(body) });
        criados.push({ id: r.id, numero: r.numero });
      }

      S.lastPedidos = criados;
      S.cart = [];
      limparCarrinhoPersistido();
      S.view = 'sucesso';
      render();
      toast('Pedido(s) pendente(s) criado(s)', 'ok');
    } catch (e) {
      toast(e.message || 'Erro ao gravar pedido', 'err');
      if (btn) { btn.disabled = false; btn.textContent = 'Finalizar pedido pendente'; }
    }
  }

  window.abrirCatalogoAfv = abrir;
  window.fecharCatalogoAfv = fechar;
  window.ShowroomAfv = { abrir, fechar, irPedidos };
})();
