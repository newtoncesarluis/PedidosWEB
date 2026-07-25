/**
 * Mark-up líquido % = o que sobra após custo e comissão do vendedor,
 * em relação ao custo final.
 *
 * lucro_liquido = venda - custo - (venda × comissão%/100)
 * mark-up líquido % = (lucro_liquido / custo) × 100
 */

function calcMarkupLiquidoPct(custo, venda, comissaoPct) {
  const c = Number(custo) || 0;
  const v = Number(venda) || 0;
  const com = Number(comissaoPct) || 0;
  if (c <= 0 || v <= 0) return null;
  const comissaoVlr = v * (com / 100);
  const lucroLiq = v - c - comissaoVlr;
  return Math.round((lucroLiq / c) * 10000) / 100;
}

function calcLucroLiquido(custo, venda, comissaoPct) {
  const c = Number(custo) || 0;
  const v = Number(venda) || 0;
  const com = Number(comissaoPct) || 0;
  if (v <= 0) return null;
  return Math.round((v - c - v * (com / 100)) * 100) / 100;
}

module.exports = { calcMarkupLiquidoPct, calcLucroLiquido };
