/**
 * Grade fechada (pack): sugere qtd inicial a partir de descricao_grades.qtd_minima
 * e escala para um total desejado (ex.: 24 = 2× pack de 12).
 */
(function (root) {
  'use strict';

  /**
   * @param {Array<{id:number,qtd_minima?:number}>} itens
   * @param {string} modo 'A' | 'F'
   * @param {Record<string|number, number>} [qtdAtual]
   * @returns {Record<number, number>|null} mapa id→qtd, ou null se não aplicar
   */
  function sugerirQtdPackFechada(itens, modo, qtdAtual) {
    if (String(modo || 'A').toUpperCase() !== 'F') return null;
    const lista = Array.isArray(itens) ? itens : [];
    if (!lista.length) return null;

    const atual = qtdAtual || {};
    const jaTemQtd = Object.keys(atual).some((k) => (parseFloat(atual[k]) || 0) > 0);
    if (jaTemQtd) return null;

    const temMin = lista.some((g) => (parseInt(g.qtd_minima, 10) || 0) > 0);
    if (!temMin) return null;

    const out = {};
    lista.forEach((g) => {
      if (g == null || g.id == null) return;
      out[g.id] = parseInt(g.qtd_minima, 10) || 0;
    });
    return out;
  }

  /**
   * Aplica sugestão in-place em um mapa de quantidades (ex.: STATE.gradeQtd).
   * @returns {boolean} true se preencheu algo
   */
  function aplicarSugestaoPackFechada(itens, modo, qtdMap) {
    const sug = sugerirQtdPackFechada(itens, modo, qtdMap);
    if (!sug || !qtdMap) return false;
    Object.keys(sug).forEach((id) => { qtdMap[id] = sug[id]; });
    return true;
  }

  /** Pack base (1× qtd_minima), mesmo se já houver qtd. */
  function packBaseFechada(itens, modo) {
    if (String(modo || 'A').toUpperCase() !== 'F') return null;
    const lista = Array.isArray(itens) ? itens : [];
    if (!lista.length) return null;
    if (!lista.some((g) => (parseInt(g.qtd_minima, 10) || 0) > 0)) return null;
    const out = {};
    lista.forEach((g) => {
      if (g == null || g.id == null) return;
      out[g.id] = parseInt(g.qtd_minima, 10) || 0;
    });
    return out;
  }

  /**
   * Distribui um total desejado (ex. 24) proporcional ao pack (qtd_minima).
   * Se o total for múltiplo do pack base, multiplica em inteiro (12→24 = ×2).
   * @returns {Record<number, number>|null}
   */
  function distribuirTotalPackFechada(itens, modo, totalDesejado, multiplo) {
    if (String(modo || 'A').toUpperCase() !== 'F') return null;
    let target = parseInt(totalDesejado, 10) || 0;
    if (target <= 0) return null;

    const mult = parseInt(multiplo, 10) || 0;
    if (mult >= 2) {
      // Ajusta para o múltiplo mais próximo (mínimo = 1 pack)
      const packs = Math.max(1, Math.round(target / mult));
      target = packs * mult;
    }

    const base = packBaseFechada(itens, 'F');
    if (!base) return null;
    const baseSum = Object.values(base).reduce((s, v) => s + (parseInt(v, 10) || 0), 0);
    if (baseSum <= 0) return null;

    // Packs inteiros: 24 / 12 = 2 → multiplica cada tamanho
    if (target % baseSum === 0) {
      const f = target / baseSum;
      const out = {};
      Object.keys(base).forEach((id) => { out[id] = (parseInt(base[id], 10) || 0) * f; });
      return out;
    }

    // Proporcional com inteiros + ajuste no maior tamanho
    const out = {};
    let soma = 0;
    const ids = Object.keys(base);
    ids.forEach((id) => {
      const v = Math.round(target * (base[id] / baseSum));
      out[id] = Math.max(0, v);
      soma += out[id];
    });
    const diff = target - soma;
    if (diff !== 0 && ids.length) {
      let maior = ids[0];
      ids.forEach((id) => {
        if ((base[id] || 0) > (base[maior] || 0)) maior = id;
      });
      out[maior] = Math.max(0, (out[maior] || 0) + diff);
    }
    return out;
  }

  root.SysRepGradePack = {
    sugerirQtdPackFechada,
    aplicarSugestaoPackFechada,
    packBaseFechada,
    distribuirTotalPackFechada,
  };
})(typeof window !== 'undefined' ? window : globalThis);
