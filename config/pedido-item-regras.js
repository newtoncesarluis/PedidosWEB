/**
 * Regras de quantidade por item no pedido:
 * - multiplo_venda: quantidade deve ser múltipla (0/1 = sem restrição)
 * - qtd_minima_pedido: quantidade mínima flexível (0 = sem restrição)
 *
 * Hierarquia (regra pai por item): cadastro do PRODUTO sempre vence na validação.
 * Kit do fornecedor só sugere quantidade inicial; não relaxa mínimo/múltiplo do produto.
 */
function parseRegras(prod = {}) {
  return {
    multiplo: parseInt(prod.multiplo_venda ?? prod.multiplo_venda_produto, 10) || 1,
    qtdMinima: parseInt(prod.qtd_minima_pedido ?? prod.qtd_minima_pedido_produto, 10) || 0,
  };
}

/** Mescla item do pedido + catálogo para validação (snapshot cobre cache vazio). */
function parseRegrasFromSources(item = {}, produto = {}) {
  return parseRegras({
    multiplo_venda: produto.multiplo_venda ?? produto.multiplo_venda_produto
      ?? item.multiplo_venda_produto,
    qtd_minima_pedido: produto.qtd_minima_pedido ?? produto.qtd_minima_pedido_produto
      ?? item.qtd_minima_pedido_produto,
  });
}

function validarQuantidade(qtd, regras, descProd) {
  const erros = [];
  const q = parseFloat(qtd) || 0;
  if (q <= 0) return erros;
  const mv = regras.multiplo > 1 ? regras.multiplo : 1;
  const qmin = regras.qtdMinima > 0 ? regras.qtdMinima : 0;
  const nome = descProd || 'Produto';

  if (mv > 1 && Math.abs(q % mv) > 0.0001) {
    erros.push(`Quantidade inválida para «${nome}». Deve ser múltiplo de ${mv} (ex.: ${mv}, ${mv * 2}…).`);
  }
  if (qmin > 0 && q < qmin - 0.0001) {
    erros.push(`Quantidade de «${nome}» abaixo do mínimo (${qmin} un.).`);
  }
  return erros;
}

function hintRegras(regras) {
  const parts = [];
  const mv = regras.multiplo > 1 ? regras.multiplo : 0;
  const qmin = regras.qtdMinima > 0 ? regras.qtdMinima : 0;
  if (qmin > 0) parts.push(`Mín. ${qmin} un.`);
  if (mv > 1) parts.push(`Múltiplo de ${mv}`);
  return parts.join(' · ');
}

function ajustarQuantidade(qtd, regras) {
  let q = parseFloat(qtd) || 0;
  if (q <= 0) return q;
  const mv = regras.multiplo > 1 ? regras.multiplo : 1;
  const qmin = regras.qtdMinima > 0 ? regras.qtdMinima : 0;
  if (mv > 1) q = Math.ceil(q / mv) * mv;
  if (qmin > 0 && q < qmin) q = Math.ceil(qmin / mv) * mv;
  return q;
}

/** Primeira inclusão no pedido (catálogo +/- ou kit). */
function quantidadeInicial(regras) {
  return ajustarQuantidade(1, regras);
}

/** Passo do botão +/- no mobile quando há múltiplo de venda. */
function passoIncremento(regras) {
  const mv = regras.multiplo > 1 ? regras.multiplo : 1;
  return mv;
}

/**
 * Quantidade exigida para considerar kit completo: max(qtd kit, regras do produto).
 * Produto é pai — se kit pede 3 e produto exige mín. 12, exige 12.
 */
function quantidadeExigidaKit(qtdKit, regras) {
  const qKit = parseFloat(qtdKit) || 0;
  if (qKit <= 0) return 0;
  return ajustarQuantidade(qKit, regras);
}

module.exports = {
  parseRegras,
  parseRegrasFromSources,
  validarQuantidade,
  hintRegras,
  ajustarQuantidade,
  quantidadeInicial,
  passoIncremento,
  quantidadeExigidaKit,
};
