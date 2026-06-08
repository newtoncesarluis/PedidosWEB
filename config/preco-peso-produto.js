/**
 * Preço por peso (legado Gestão Pedidos / Delphi).
 * Produto com precopeso='S': preço cadastrado é R$/kg; total = Qtd × peso(kg) × preço.
 */

function isPrecoPorPeso(v) {
  return String(v || 'N').toUpperCase() === 'S';
}

function usaMultiplicadorEmbalagem({ precopeso, somaEmbalagempedido } = {}) {
  if (isPrecoPorPeso(precopeso)) return true;
  return String(somaEmbalagempedido || 'N').toUpperCase() === 'S';
}

function embalagemEfetiva({ embalagem, kilo_embalagem, precopeso } = {}) {
  const emb = parseFloat(embalagem) || 0;
  const kilo = parseFloat(kilo_embalagem) || 0;
  if (isPrecoPorPeso(precopeso)) {
    return emb > 0 ? emb : (kilo > 0 ? kilo : 1);
  }
  return emb;
}

function embalagemInicialProduto(prod) {
  if (!isPrecoPorPeso(prod?.precopeso)) return 1;
  const kilo = parseFloat(prod?.kilo_embalagem) || 0;
  return kilo > 0 ? kilo : 1;
}

function calcBaseItemTotal({
  quantidade,
  valorUnitario,
  descontoPct,
  acrescimoPct,
  embalagem,
  kilo_embalagem,
  precopeso,
  somaEmbalagempedido,
} = {}) {
  const q = parseFloat(quantidade) || 0;
  const v = parseFloat(valorUnitario) || 0;
  const desc = parseFloat(descontoPct) || 0;
  const acr = parseFloat(acrescimoPct) || 0;
  const vlrLiq = v * (1 + acr / 100) * (1 - desc / 100);
  if (usaMultiplicadorEmbalagem({ precopeso, somaEmbalagempedido })) {
    const emb = embalagemEfetiva({ embalagem, kilo_embalagem, precopeso });
    return (emb > 0 ? emb * q : q) * vlrLiq;
  }
  return q * vlrLiq;
}

/** Peso total do item para exibição (relatório / barra do pedido). */
function calcPesoTotalExibir({
  quantidade,
  embalagem,
  kilo_embalagem,
  precopeso,
  exibirPeso = 'S',
} = {}) {
  const q = parseFloat(quantidade) || 0;
  if (String(exibirPeso || 'S').toUpperCase() !== 'S') return 0;
  if (isPrecoPorPeso(precopeso)) {
    const emb = embalagemEfetiva({ embalagem, kilo_embalagem, precopeso });
    return q * emb;
  }
  const kilo = parseFloat(kilo_embalagem) || 0;
  return q * kilo;
}

module.exports = {
  isPrecoPorPeso,
  usaMultiplicadorEmbalagem,
  embalagemEfetiva,
  embalagemInicialProduto,
  calcBaseItemTotal,
  calcPesoTotalExibir,
};
