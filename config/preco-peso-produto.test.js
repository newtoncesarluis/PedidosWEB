/**
 * Validação dos cálculos de preço por peso (rodar: node config/preco-peso-produto.test.js)
 */
const P = require('./preco-peso-produto');

function assertEq(actual, expected, label) {
  const a = Math.round(actual * 1000) / 1000;
  const e = Math.round(expected * 1000) / 1000;
  if (a !== e) {
    throw new Error(`${label}: esperado ${e}, obteve ${a}`);
  }
}

// Preço normal: 3 × 10 = 30
assertEq(P.calcBaseItemTotal({
  quantidade: 3, valorUnitario: 10, precopeso: 'N', somaEmbalagempedido: 'N',
}), 30, 'normal sem embalagem');

// Preço por peso: 2 cx × 18 kg × 75,90/kg = 2732,40
assertEq(P.calcBaseItemTotal({
  quantidade: 2, valorUnitario: 75.9, precopeso: 'S', embalagem: 18, kilo_embalagem: 18,
}), 2732.4, 'precopeso 2cx 18kg');

// 1 cx exemplo ajuda
assertEq(P.calcBaseItemTotal({
  quantidade: 1, valorUnitario: 75.9, precopeso: 'S', embalagem: 18,
}), 1366.2, 'precopeso 1cx 18kg');

// Peso editado no pedido (20 kg) prevalece sobre catálogo (18)
assertEq(P.calcBaseItemTotal({
  quantidade: 1, valorUnitario: 75.9, precopeso: 'S', embalagem: 20, kilo_embalagem: 18,
}), 1518, 'precopeso peso manual 20kg');

// Com desconto 10%
assertEq(P.calcBaseItemTotal({
  quantidade: 1, valorUnitario: 75.9, descontoPct: 10, precopeso: 'S', embalagem: 18,
}), 1229.58, 'precopeso com 10% desc');

// Soma embalagem legado (sem precopeso): 2 × 6 emb × 5 = 60
assertEq(P.calcBaseItemTotal({
  quantidade: 2, valorUnitario: 5, precopeso: 'N', somaEmbalagempedido: 'S', embalagem: 6,
}), 60, 'soma_embalagem legado');

// Peso exibir — precopeso usa embalagem do item
assertEq(P.calcPesoTotalExibir({
  quantidade: 2, precopeso: 'S', embalagem: 18, exibirPeso: 'S',
}), 36, 'peso total precopeso');

// Peso exibir — legado usa kilo_embalagem catálogo
assertEq(P.calcPesoTotalExibir({
  quantidade: 3, precopeso: 'N', kilo_embalagem: 2.5, exibirPeso: 'S',
}), 7.5, 'peso total legado');

console.log('OK — todos os cenários de preço por peso passaram.');
