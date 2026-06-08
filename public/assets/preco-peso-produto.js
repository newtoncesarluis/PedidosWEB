/**
 * Preço por peso — espelha config/preco-peso-produto.js no browser.
 */
(function (root) {
  function isPrecoPorPeso(v) {
    return String(v || 'N').toUpperCase() === 'S';
  }

  function usaMultiplicadorEmbalagem(opts) {
    opts = opts || {};
    if (isPrecoPorPeso(opts.precopeso)) return true;
    return String(opts.somaEmbalagempedido || 'N').toUpperCase() === 'S';
  }

  function embalagemEfetiva(opts) {
    opts = opts || {};
    const emb = parseFloat(opts.embalagem) || 0;
    const kilo = parseFloat(opts.kilo_embalagem) || 0;
    if (isPrecoPorPeso(opts.precopeso)) {
      return emb > 0 ? emb : (kilo > 0 ? kilo : 1);
    }
    return emb;
  }

  function embalagemInicialProduto(prod) {
    if (!isPrecoPorPeso(prod && prod.precopeso)) return 1;
    const kilo = parseFloat(prod && prod.kilo_embalagem) || 0;
    return kilo > 0 ? kilo : 1;
  }

  function calcBaseItemTotal(opts) {
    opts = opts || {};
    const q = parseFloat(opts.quantidade) || 0;
    const v = parseFloat(opts.valorUnitario) || 0;
    const desc = parseFloat(opts.descontoPct) || 0;
    const acr = parseFloat(opts.acrescimoPct) || 0;
    const vlrLiq = v * (1 + acr / 100) * (1 - desc / 100);
    if (usaMultiplicadorEmbalagem(opts)) {
      const emb = embalagemEfetiva(opts);
      return (emb > 0 ? emb * q : q) * vlrLiq;
    }
    return q * vlrLiq;
  }

  function calcPesoTotalExibir(opts) {
    opts = opts || {};
    const q = parseFloat(opts.quantidade) || 0;
    if (String(opts.exibirPeso || 'S').toUpperCase() !== 'S') return 0;
    if (isPrecoPorPeso(opts.precopeso)) {
      const emb = embalagemEfetiva(opts);
      return q * emb;
    }
    const kilo = parseFloat(opts.kilo_embalagem) || 0;
    return q * kilo;
  }

  root.PrecoPesoProduto = {
    isPrecoPorPeso,
    usaMultiplicadorEmbalagem,
    embalagemEfetiva,
    embalagemInicialProduto,
    calcBaseItemTotal,
    calcPesoTotalExibir,
  };
})(typeof window !== 'undefined' ? window : globalThis);
