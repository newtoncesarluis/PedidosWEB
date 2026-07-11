/**
 * Kit de pedido por fornecedor — espelha config/fornecedor-kit-pedido.js no browser.
 */
(function (root) {
  function parsePct(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function promoPrimeiraCompraExigeKit(cfg) {
    return String(cfg && cfg.promo_primeira_compra_exige_kit || 'N').toUpperCase() === 'S';
  }

  function parsePrazoPromoDias(prazoStr) {
    const s = String(prazoStr || '').trim();
    if (!s) return [];
    return s.split('/')
      .map((d) => parseInt(d.trim(), 10))
      .filter((d) => !Number.isNaN(d) && d >= 0);
  }

  function mapQtdPedidoPorProduto(itens) {
    const map = new Map();
    for (const it of itens || []) {
      if (it._delete) continue;
      const cod = parseInt(it.cod_produto, 10);
      if (!cod) continue;
      const q = parseFloat(it.quantidade) || 0;
      map.set(cod, (map.get(cod) || 0) + q);
    }
    return map;
  }

  function avaliarKitCompleto(kitItens, itensPedido, opts) {
    opts = opts || {};
    const map = mapQtdPedidoPorProduto(itensPedido);
    const regrasMap = opts.regrasPorProduto || {};
    const faltando = [];
    const PIR = root.PedidoItemRegras;
    let nExigidos = 0;
    for (const k of kitItens || []) {
      const cod = parseInt(k.cod_produto, 10);
      const qKit = parseFloat(k.quantidade) || 0;
      if (!cod || qKit <= 0) continue;
      nExigidos += 1;
      const raw = regrasMap[cod] || regrasMap[String(cod)] || k;
      const regras = PIR ? PIR.parseRegras(raw) : { multiplo: 1, qtdMinima: 0 };
      const qtdExigida = PIR ? PIR.quantidadeExigidaKit(qKit, regras) : qKit;
      const qPed = map.get(cod) || 0;
      if (qPed + 0.0001 < qtdExigida) {
        faltando.push({
          cod_produto: cod,
          desc_produto: k.desc_produto || k.nome_produto || '',
          quantidade_kit: qKit,
          quantidade_exigida: qtdExigida,
          quantidade_pedido: qPed,
        });
      }
    }
    const completo = nExigidos > 0 && faltando.length === 0;
    return { completo, faltando };
  }

  function calcularDescontoPctSugerido(cfg, opts) {
    opts = opts || {};
    const kitPct = parsePct(cfg && cfg.kit_desconto_pct);
    const primeiraPct = parsePct(cfg && cfg.desconto_primeira_compra_pct);
    const exigeAmbos = promoPrimeiraCompraExigeKit(cfg);
    const kitCompleto = !!opts.kitCompleto;
    const primeiraCompra = !!opts.primeiraCompra;

    if (exigeAmbos) {
      if (!kitCompleto || !primeiraCompra) {
        return { pct: 0, motivo: '', exigeAmbos: true, elegivel: false };
      }
      const pct = primeiraPct || kitPct;
      return {
        pct,
        motivo: 'promoção primeira compra (kit completo)',
        exigeAmbos: true,
        elegivel: pct > 0,
      };
    }

    let pct = 0;
    let motivo = '';

    if (kitCompleto && kitPct > 0) {
      pct = kitPct;
      motivo = 'kit completo';
    }
    if (primeiraCompra && primeiraPct > 0) {
      if (primeiraPct > pct) {
        pct = primeiraPct;
        motivo = 'primeira compra';
      } else if (primeiraPct === pct && primeiraPct > 0) {
        motivo = 'kit completo / primeira compra';
      }
    }
    return { pct, motivo, exigeAmbos: false, elegivel: pct > 0 };
  }

  function resumoPromoPrimeiraCompra(cfg, opts) {
    opts = opts || {};
    const desc = calcularDescontoPctSugerido(cfg, opts);
    if (!desc.elegivel || !desc.pct) return null;
    const subtotal = parseFloat(opts.subtotal) || 0;
    if (subtotal <= 0) return null;
    const vlrDesc = Math.round(subtotal * desc.pct / 100 * 100) / 100;
    const totalComDesc = Math.max(0, Math.round((subtotal - vlrDesc) * 100) / 100);
    const dias = parsePrazoPromoDias(cfg && cfg.promo_condicao_pagto);
    const nParc = dias.length;
    let vlrParc = 0;
    let vlrUltima = 0;
    if (nParc > 0) {
      vlrParc = parseFloat((totalComDesc / nParc).toFixed(2));
      const somaAntes = parseFloat((vlrParc * (nParc - 1)).toFixed(2));
      vlrUltima = parseFloat((totalComDesc - somaAntes).toFixed(2));
    }
    const textoBanner = String(cfg && cfg.promo_texto_banner || '').trim()
      || 'Promoção Primeira Compra';
    return {
      pct: desc.pct,
      motivo: desc.motivo,
      exigeAmbos: desc.exigeAmbos,
      elegivel: desc.elegivel,
      subtotal,
      vlrDesc,
      totalComDesc,
      dias,
      nParc,
      vlrParc,
      vlrUltima,
      textoBanner,
      condicaoPagto: String(cfg && cfg.promo_condicao_pagto || '').trim(),
    };
  }

  root.FornecedorKitPedido = {
    parsePct,
    promoPrimeiraCompraExigeKit,
    parsePrazoPromoDias,
    mapQtdPedidoPorProduto,
    avaliarKitCompleto,
    calcularDescontoPctSugerido,
    resumoPromoPrimeiraCompra,
  };
})(typeof window !== 'undefined' ? window : globalThis);
