'use strict';

const assert = require('assert');
const {
  calcularPrecoPromocao,
  validarPayloadPromocao,
  escolherMelhorPromocao,
  filtrarPromocoesPorCliente,
  filtrarPromocoesPorContexto,
  parseTabelasPrecoLista,
  promocaoCombinaTabela,
} = require('./promocoes-produto');

function testCalcularPreco() {
  assert.strictEqual(calcularPrecoPromocao('PRECO_FIXO', 50, 100), 50);
  assert.strictEqual(calcularPrecoPromocao('DESCONTO_PERC', 10, 100), 90);
  assert.strictEqual(calcularPrecoPromocao('DESCONTO_PERC', 0, 80), 80);
}

function testValidarPayload() {
  const ok = validarPayloadPromocao({
    descricao: 'Promo teste',
    tipo: 'PRECO_FIXO',
    valor: 10,
    qtd_minima: 2,
    data_inicio: '2026-06-01',
    data_fim: '2026-06-30',
    id_regiao: 3,
    sync_precopromo: 'S',
  }, 100);
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.idRegiao, 3);
  assert.strictEqual(ok.syncPrecopromo, 'S');

  const multi = validarPayloadPromocao({
    descricao: 'Multi tab',
    tipo: 'PRECO_FIXO',
    valor: 10,
    qtd_minima: 1,
    tabelas_preco: [10, 11, 10],
  }, 100);
  assert.strictEqual(multi.ok, true);
  assert.deepStrictEqual(multi.tabelasPrecoLista, [10, 11]);
  assert.strictEqual(multi.tabelasPrecoStr, '10,11');
  assert.strictEqual(multi.idTabelaPreco, null);

  const bad = validarPayloadPromocao({
    descricao: '',
    tipo: 'PRECO_FIXO',
    valor: 0,
    data_inicio: '2026-06-10',
    data_fim: '2026-06-01',
  }, 100);
  assert.strictEqual(bad.ok, false);
  assert.ok(bad.erros.length >= 2);
}

function testFiltroCliente() {
  const rows = [
    { cod_cliente: null, descricao: 'Geral' },
    { cod_cliente: 5, descricao: 'Cli 5' },
    { cod_cliente: 9, descricao: 'Cli 9' },
  ];
  assert.strictEqual(filtrarPromocoesPorCliente(rows, null).length, 1);
  assert.strictEqual(filtrarPromocoesPorCliente(rows, 5).length, 2);
}

function testFiltroContexto() {
  const rows = [
    { cod_cliente: null, id_regiao: null, cod_fornecedor: null, id_tabela_preco: null, descricao: 'Geral' },
    { cod_cliente: 5, id_regiao: null, cod_fornecedor: null, id_tabela_preco: null, descricao: 'Cli5' },
    { cod_cliente: null, id_regiao: 2, cod_fornecedor: null, id_tabela_preco: null, descricao: 'Reg2' },
    { cod_cliente: null, id_regiao: null, cod_fornecedor: 7, id_tabela_preco: null, descricao: 'Forn7' },
    { cod_cliente: null, id_regiao: null, cod_fornecedor: null, id_tabela_preco: 4, descricao: 'Tab4' },
  ];

  assert.strictEqual(filtrarPromocoesPorContexto(rows, {}).length, 1);
  assert.strictEqual(filtrarPromocoesPorContexto(rows, { codCliente: 5 }).length, 2);
  assert.strictEqual(filtrarPromocoesPorContexto(rows, { idRegiao: 2 }).length, 2);
  assert.strictEqual(filtrarPromocoesPorContexto(rows, { codFornecedor: 7 }).length, 2);
  assert.strictEqual(filtrarPromocoesPorContexto(rows, { idTabelaPreco: 4 }).length, 2);
  assert.strictEqual(filtrarPromocoesPorContexto(rows, { codCliente: 5, idRegiao: 2 }).length, 3);

  const semCtx = filtrarPromocoesPorContexto(rows, {});
  assert.strictEqual(semCtx.length, 1);
  assert.strictEqual(semCtx[0].descricao, 'Geral');
}

function testTabelasMultiplas() {
  const rows = [
    { cod_cliente: null, id_regiao: null, cod_fornecedor: null, id_tabela_preco: null, tabelas_preco: '10,11', descricao: 'Tab10-11' },
    { cod_cliente: null, id_regiao: null, cod_fornecedor: null, id_tabela_preco: 12, tabelas_preco: null, descricao: 'Tab12' },
  ];
  assert.strictEqual(filtrarPromocoesPorContexto(rows, { idTabelaPreco: 10 }).length, 1);
  assert.strictEqual(filtrarPromocoesPorContexto(rows, { idTabelaPreco: 11 }).length, 1);
  assert.strictEqual(filtrarPromocoesPorContexto(rows, { idTabelaPreco: 12 }).length, 1);
  assert.strictEqual(filtrarPromocoesPorContexto(rows, { idTabelaPreco: 99 }).length, 0);
  assert.strictEqual(filtrarPromocoesPorContexto(rows, {}).length, 0);

  assert.strictEqual(promocaoCombinaTabela({ tabelas_preco: '10,11' }, 10), true);
  assert.strictEqual(promocaoCombinaTabela({ tabelas_preco: '10,11' }, 12), false);
  assert.strictEqual(promocaoCombinaTabela({ id_tabela_preco: 5 }, 5), true);
  assert.strictEqual(parseTabelasPrecoLista('10, 11;12').join(','), '10,11,12');
}

function testEscolherMelhor() {
  const rows = [
    { id: 1, cod_cliente: null, id_regiao: null, cod_fornecedor: null, id_tabela_preco: null, descricao: 'Geral 1un', tipo: 'PRECO_FIXO', valor: 90, qtd_minima: 1, destaque: 'N', ativo: 'S' },
    { id: 2, cod_cliente: null, id_regiao: null, cod_fornecedor: null, id_tabela_preco: null, descricao: 'Geral 3un', tipo: 'PRECO_FIXO', valor: 80, qtd_minima: 3, destaque: 'N', ativo: 'S' },
    { id: 3, cod_cliente: 10, id_regiao: null, cod_fornecedor: null, id_tabela_preco: null, descricao: 'Cli10', tipo: 'PRECO_FIXO', valor: 70, qtd_minima: 1, destaque: 'S', ativo: 'S' },
  ];

  const q1 = escolherMelhorPromocao(rows, 100, 1, { codCliente: null });
  assert.strictEqual(q1.preco_promo, 90);
  assert.strictEqual(q1.aplica_agora, true);

  const q3 = escolherMelhorPromocao(rows, 100, 3, {});
  assert.strictEqual(q3.preco_promo, 80);

  const qCli = escolherMelhorPromocao(rows, 100, 1, { codCliente: 10 });
  assert.strictEqual(qCli.preco_promo, 70);
  assert.strictEqual(qCli.cod_cliente, 10);

  const q2semPromo = escolherMelhorPromocao(rows, 100, 2, {});
  assert.strictEqual(q2semPromo.preco_promo, 90);
  assert.strictEqual(q2semPromo.aplica_agora, true);

  const overlap = [
    { id: 4, cod_cliente: null, id_regiao: null, cod_fornecedor: null, id_tabela_preco: null, descricao: 'Barato 1un', tipo: 'PRECO_FIXO', valor: 70, qtd_minima: 1, destaque: 'N', ativo: 'S' },
    { id: 5, cod_cliente: null, id_regiao: null, cod_fornecedor: null, id_tabela_preco: null, descricao: 'Caro 2un', tipo: 'PRECO_FIXO', valor: 75, qtd_minima: 2, destaque: 'N', ativo: 'S' },
  ];
  const melhor = escolherMelhorPromocao(overlap, 100, 5, {});
  assert.strictEqual(melhor.preco_promo, 70);

  const espec = [
    { id: 6, cod_cliente: null, id_regiao: 2, cod_fornecedor: null, id_tabela_preco: null, descricao: 'Reg2', tipo: 'PRECO_FIXO', valor: 65, qtd_minima: 1, destaque: 'N', ativo: 'S' },
    { id: 7, cod_cliente: null, id_regiao: null, cod_fornecedor: null, id_tabela_preco: null, descricao: 'Geral', tipo: 'PRECO_FIXO', valor: 90, qtd_minima: 1, destaque: 'N', ativo: 'S' },
  ];
  const reg = escolherMelhorPromocao(espec, 100, 1, { idRegiao: 2 });
  assert.strictEqual(reg.preco_promo, 65);
}

function run() {
  testCalcularPreco();
  testValidarPayload();
  testFiltroCliente();
  testFiltroContexto();
  testTabelasMultiplas();
  testEscolherMelhor();
  console.log('promocoes-produto.test.js: OK (6 suites)');
}

run();
