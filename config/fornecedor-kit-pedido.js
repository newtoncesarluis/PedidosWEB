/**
 * Kit de pedido por fornecedor — itens sugeridos + desconto quando kit completo.
 * Quantidade do kit é sugestão; regras do produto (mín./múltiplo) refinam o exigido.
 */

const { parseRegras, quantidadeExigidaKit } = require('./pedido-item-regras');

function parsePct(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function promoPrimeiraCompraExigeKit(cfg) {
  return String(cfg?.promo_primeira_compra_exige_kit || 'N').toUpperCase() === 'S';
}

/** Dias do prazo promo (ex.: "0/21/42" → [0, 21, 42]). Aceita 0 = entrada na data base. */
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

/**
 * @param {object} [opts]
 * @param {Record<string, object>} [opts.regrasPorProduto] — cod → { multiplo_venda, qtd_minima_pedido }
 */
function avaliarKitCompleto(kitItens, itensPedido, opts = {}) {
  const map = mapQtdPedidoPorProduto(itensPedido);
  const regrasMap = opts.regrasPorProduto || {};
  const faltando = [];
  let nExigidos = 0;
  for (const k of kitItens || []) {
    const cod = parseInt(k.cod_produto, 10);
    const qKit = parseFloat(k.quantidade) || 0;
    if (!cod || qKit <= 0) continue;
    nExigidos += 1;
    const regras = parseRegras(regrasMap[cod] || regrasMap[String(cod)] || k);
    const qtdExigida = quantidadeExigidaKit(qKit, regras);
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

function calcularDescontoPctSugerido(cfg, opts = {}) {
  const kitPct = parsePct(cfg?.kit_desconto_pct);
  const primeiraPct = parsePct(cfg?.desconto_primeira_compra_pct);
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

/** Resumo financeiro da promo (banner no pedido). */
function resumoPromoPrimeiraCompra(cfg, opts = {}) {
  const desc = calcularDescontoPctSugerido(cfg, opts);
  if (!desc.elegivel || !desc.pct) return null;
  const subtotal = parseFloat(opts.subtotal) || 0;
  if (subtotal <= 0) return null;
  const vlrDesc = Math.round(subtotal * desc.pct / 100 * 100) / 100;
  const totalComDesc = Math.max(0, Math.round((subtotal - vlrDesc) * 100) / 100);
  const dias = parsePrazoPromoDias(cfg?.promo_condicao_pagto);
  const nParc = dias.length;
  let vlrParc = 0;
  let vlrUltima = 0;
  if (nParc > 0) {
    vlrParc = parseFloat((totalComDesc / nParc).toFixed(2));
    const somaAntes = parseFloat((vlrParc * (nParc - 1)).toFixed(2));
    vlrUltima = parseFloat((totalComDesc - somaAntes).toFixed(2));
  }
  const textoBanner = String(cfg?.promo_texto_banner || '').trim()
    || 'Promoção Primeira Compra';
  return {
    ...desc,
    subtotal,
    vlrDesc,
    totalComDesc,
    dias,
    nParc,
    vlrParc,
    vlrUltima,
    textoBanner,
    condicaoPagto: String(cfg?.promo_condicao_pagto || '').trim(),
  };
}

module.exports = {
  parsePct,
  promoPrimeiraCompraExigeKit,
  parsePrazoPromoDias,
  mapQtdPedidoPorProduto,
  avaliarKitCompleto,
  calcularDescontoPctSugerido,
  resumoPromoPrimeiraCompra,
};
