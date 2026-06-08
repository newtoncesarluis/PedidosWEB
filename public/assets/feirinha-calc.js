/**
 * Kit Feirinha — cálculos no browser (espelha config/feirinha-calc.js).
 */
(function (global) {
  'use strict';

  const FAIXAS_FEIRINHA = [
    { max: 3.99, codigo: 'R5', label: 'Feirinha R$ 5', precoSugerido: 5, emoji: '🟢', nivel: 'ok' },
    { max: 7.99, codigo: 'R10', label: 'Feirinha R$ 10', precoSugerido: 10, emoji: '🟢', nivel: 'ok' },
    { max: 12.99, codigo: 'R15', label: 'Feirinha R$ 15', precoSugerido: 15, emoji: '🟡', nivel: 'med' },
    { max: 17.99, codigo: 'R20', label: 'Feirinha R$ 20', precoSugerido: 20, emoji: '🟡', nivel: 'med' },
    { max: Infinity, codigo: 'PREMIUM', label: 'Feirinha Premium', precoSugerido: null, emoji: '🔴', nivel: 'high' },
  ];

  function roundMoney(n) {
    return Math.round((parseFloat(n) || 0) * 100) / 100;
  }

  function roundPct(n) {
    return Math.round((parseFloat(n) || 0) * 100) / 100;
  }

  function agregarItensFeirinha(itens) {
    const ativos = (itens || []).filter((i) => !i._delete && (parseFloat(i.quantidade) || 0) > 0);
    let valorTotal = 0;
    let qtdTotal = 0;
    for (const i of ativos) {
      const q = parseFloat(i.quantidade) || 0;
      valorTotal += parseFloat(i.vlrtotal_itens) || 0;
      qtdTotal += q;
    }
    valorTotal = roundMoney(valorTotal);
    qtdTotal = roundMoney(qtdTotal);
    const precoMedio = qtdTotal > 0 ? roundMoney(valorTotal / qtdTotal) : 0;
    return { qtdTotal, valorTotal, precoMedio, qtdItens: ativos.length };
  }

  function classificarFaixaFeirinha(precoMedio) {
    const p = parseFloat(precoMedio) || 0;
    for (const faixa of FAIXAS_FEIRINHA) {
      if (p <= faixa.max) return { ...faixa, precoMedio: p };
    }
    return { ...FAIXAS_FEIRINHA[FAIXAS_FEIRINHA.length - 1], precoMedio: p };
  }

  function calcMargemRevenda(precoMedio, precoRevenda, qtdTotal) {
    const custo = parseFloat(precoMedio) || 0;
    const venda = parseFloat(precoRevenda) || 0;
    const qtd = parseFloat(qtdTotal) || 0;
    if (venda <= 0) {
      return { precoRevenda: 0, margemPct: null, lucroUnitario: null, lucroTotal: null };
    }
    const lucroUnitario = roundMoney(venda - custo);
    const margemPct = roundPct(((venda - custo) / venda) * 100);
    const lucroTotal = roundMoney(lucroUnitario * qtd);
    return { precoRevenda: venda, margemPct, lucroUnitario, lucroTotal };
  }

  function getFaixaByCodigo(codigo) {
    const c = String(codigo || '').toUpperCase();
    return FAIXAS_FEIRINHA.find((f) => f.codigo === c)
      || FAIXAS_FEIRINHA.find((f) => f.codigo === 'R10')
      || FAIXAS_FEIRINHA[0];
  }

  function getPrecoMedioMaxFaixa(faixaCodigo) {
    const faixa = getFaixaByCodigo(faixaCodigo);
    return faixa.max === Infinity ? null : faixa.max;
  }

  function calcQtdParaAtingirMedia(valorTotal, qtdTotal, precoUnitNovo, metaMedia) {
    const p = parseFloat(precoUnitNovo) || 0;
    const meta = parseFloat(metaMedia) || 0;
    const V = parseFloat(valorTotal) || 0;
    const Q = parseFloat(qtdTotal) || 0;
    if (meta <= 0 || p <= 0 || p >= meta - 0.0001) return null;
    if (Q <= 0) return null;
    if (V / Q <= meta + 0.0001) return { qtd: 0, alreadyOk: true };
    const q = (meta * Q - V) / (p - meta);
    if (!Number.isFinite(q) || q <= 0) return null;
    return { qtd: Math.ceil(q), alreadyOk: false };
  }

  function calcFeirinhaResumo(itens, opts) {
    opts = opts || {};
    const agg = agregarItensFeirinha(itens);
    let faixa = classificarFaixaFeirinha(agg.precoMedio);
    if (opts.faixaCodigo) {
      faixa = Object.assign({}, getFaixaByCodigo(opts.faixaCodigo), { precoMedio: agg.precoMedio });
    }
    const metaMedia = opts.precoMedioMeta != null
      ? parseFloat(opts.precoMedioMeta)
      : (faixa.max === Infinity ? null : faixa.max);
    let precoRevenda = parseFloat(opts.precoRevenda);
    if (!Number.isFinite(precoRevenda) || precoRevenda <= 0) {
      precoRevenda = parseFloat(opts.precoRevendaAlvo) || faixa.precoSugerido || 0;
    }
    const margem = calcMargemRevenda(agg.precoMedio, precoRevenda, agg.qtdTotal);
    const dentroMeta = metaMedia != null && agg.qtdTotal > 0 && agg.precoMedio <= metaMedia + 0.0001;
    return Object.assign({}, agg, {
      faixa,
      precoMedioMeta: metaMedia,
      dentroMeta,
      precoRevendaSugerido: faixa.precoSugerido,
      temItens: agg.qtdTotal > 0,
    }, margem);
  }

  global.FeirinhaCalc = {
    FAIXAS_FEIRINHA,
    agregarItensFeirinha,
    classificarFaixaFeirinha,
    getFaixaByCodigo,
    getPrecoMedioMaxFaixa,
    calcQtdParaAtingirMedia,
    calcMargemRevenda,
    calcFeirinhaResumo,
  };
})(typeof window !== 'undefined' ? window : globalThis);
