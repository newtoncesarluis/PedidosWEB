'use strict';
/**
 * Motor de movimentação de estoque.
 * Todas as entradas/saídas/ajustes passam por aqui para garantir
 * que saldo_anterior e saldo_posterior sejam sempre consistentes.
 */

const { hojeIsoBrasil, horaBrasil } = require('./date-brasil');

/** Garante que a tabela movimento_estoque existe. */
async function ensureMovimentoEstoqueTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS movimento_estoque (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      cod_produto      INT NOT NULL,
      desc_produto     VARCHAR(200),
      tipo_movimento   VARCHAR(20) NOT NULL,
      quantidade       DECIMAL(15,4) NOT NULL,
      saldo_anterior   DECIMAL(15,4) DEFAULT 0,
      saldo_posterior  DECIMAL(15,4) DEFAULT 0,
      id_pedido        INT NULL,
      numero_pedido    VARCHAR(50) NULL,
      id_usuario       INT NULL,
      nome_usuario     VARCHAR(100) NULL,
      observacao       VARCHAR(500) NULL,
      nota_fiscal      VARCHAR(60) NULL,
      chave_nfe        VARCHAR(44) NULL,
      fornecedor_nome  VARCHAR(150) NULL,
      data_movimento   DATE NOT NULL,
      hora_movimento   TIME NOT NULL,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_me_produto  (cod_produto),
      INDEX idx_me_data     (data_movimento),
      INDEX idx_me_tipo     (tipo_movimento),
      INDEX idx_me_pedido   (id_pedido)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3
  `).catch(() => {});
}

/**
 * Detecta o nome da tabela de produtos (produto ou produtos) neste banco.
 */
async function _tabelaProduto(pool) {
  const [r] = await pool.query(`SHOW TABLES LIKE 'produto'`);
  return r.length ? 'produto' : 'produtos';
}

/**
 * Grava um movimento e atualiza estoque_atual do produto.
 * tipo: ENTRADA | SAIDA | AJUSTE | PEDIDO | XML
 * quantidade: sempre positivo; SAIDA e PEDIDO debitam, demais creditam (ou definem absoluto para AJUSTE)
 */
async function _gravarMovimento(pool, {
  cod_produto,
  tipo_movimento,
  quantidade,
  id_pedido    = null,
  numero_pedido = null,
  id_usuario   = null,
  nome_usuario = null,
  observacao   = null,
  nota_fiscal  = null,
  chave_nfe    = null,
  fornecedor_nome = null,
}) {
  const tabela = await _tabelaProduto(pool);
  const [[prod]] = await pool.query(
    `SELECT ID, descricao, IFNULL(estoque_atual,0) AS estoque_atual FROM ${tabela} WHERE ID = ? LIMIT 1`,
    [cod_produto]
  );
  if (!prod) throw new Error(`Produto ${cod_produto} não encontrado`);

  const saldo_ant = parseFloat(prod.estoque_atual) || 0;
  const qtd       = parseFloat(quantidade) || 0;
  let saldo_pos;

  if (tipo_movimento === 'AJUSTE') {
    saldo_pos = qtd; // ajuste define o valor absoluto
  } else if (tipo_movimento === 'SAIDA' || tipo_movimento === 'PEDIDO') {
    saldo_pos = saldo_ant - qtd;
  } else {
    // ENTRADA, XML e qualquer outro somam
    saldo_pos = saldo_ant + qtd;
  }

  const hoje = hojeIsoBrasil();
  const hora = horaBrasil();

  await pool.query(
    `UPDATE ${tabela} SET estoque_atual = ? WHERE ID = ?`,
    [saldo_pos, cod_produto]
  );

  await pool.query(
    `INSERT INTO movimento_estoque
       (cod_produto, desc_produto, tipo_movimento, quantidade,
        saldo_anterior, saldo_posterior,
        id_pedido, numero_pedido, id_usuario, nome_usuario,
        observacao, nota_fiscal, chave_nfe, fornecedor_nome,
        data_movimento, hora_movimento)
     VALUES (?,?,?,?, ?,?, ?,?,?,?, ?,?,?,?, ?,?)`,
    [
      cod_produto, prod.descricao, tipo_movimento, qtd,
      saldo_ant, saldo_pos,
      id_pedido, numero_pedido, id_usuario, nome_usuario,
      observacao, nota_fiscal, chave_nfe, fornecedor_nome,
      hoje, hora,
    ]
  );

  return { saldo_anterior: saldo_ant, saldo_posterior: saldo_pos };
}

/**
 * Debita estoque de todos os itens de um pedido ao faturar.
 * Só executa se gerenciaestoque=S e tipo de pedido movimentaestoque=S.
 */
async function debitarEstoquesPedido(pool, idPedido, idUsuario, nomeUsuario) {
  const [[cfg]] = await pool.query(
    `SELECT IFNULL(gerenciaestoque,'N') AS gerenciaestoque FROM sistema LIMIT 1`
  ).catch(() => [[{ gerenciaestoque: 'N' }]]);

  if ((cfg?.gerenciaestoque || 'N') !== 'S') return { ok: true, skipped: 'estoque desabilitado' };

  const [[ped]] = await pool.query(
    `SELECT p.id, p.numero, p.tipo_pedido,
            IFNULL(tp.movimentaestoque,'S') AS movimentaestoque
     FROM pedidos p
     LEFT JOIN tipo_pedidos tp ON tp.descricao = p.tipo_pedido AND tp.excluido='N'
     WHERE p.id = ? LIMIT 1`,
    [idPedido]
  );
  if (!ped || ped.movimentaestoque !== 'S') return { ok: true, skipped: 'tipo nao movimenta' };

  const [itens] = await pool.query(
    `SELECT cod_produto, SUM(quantidade) AS quantidade
     FROM itensped
     WHERE numpedido = ? AND (excluido IS NULL OR excluido='N')
     GROUP BY cod_produto`,
    [ped.numero]
  );

  await ensureMovimentoEstoqueTable(pool);

  for (const item of itens) {
    if (!item.cod_produto || !item.quantidade) continue;
    await _gravarMovimento(pool, {
      cod_produto:   item.cod_produto,
      tipo_movimento: 'PEDIDO',
      quantidade:    parseFloat(item.quantidade),
      id_pedido:     idPedido,
      numero_pedido: ped.numero,
      id_usuario:    idUsuario,
      nome_usuario:  nomeUsuario,
      observacao:    `Saída automática — pedido ${ped.numero}`,
    }).catch(e => console.warn(`[estoque] produto ${item.cod_produto}: ${e.message}`));
  }

  return { ok: true };
}

/**
 * Lançamento manual de entrada de mercadoria.
 */
async function entradaEstoque(pool, { cod_produto, quantidade, observacao, nota_fiscal, chave_nfe, fornecedor_nome, id_usuario, nome_usuario }) {
  await ensureMovimentoEstoqueTable(pool);
  return _gravarMovimento(pool, {
    cod_produto, tipo_movimento: 'ENTRADA', quantidade,
    observacao, nota_fiscal, chave_nfe, fornecedor_nome,
    id_usuario, nome_usuario,
  });
}

/**
 * Ajuste de inventário — define saldo absoluto.
 */
async function ajusteEstoque(pool, { cod_produto, quantidade_nova, observacao, id_usuario, nome_usuario }) {
  await ensureMovimentoEstoqueTable(pool);
  return _gravarMovimento(pool, {
    cod_produto, tipo_movimento: 'AJUSTE', quantidade: quantidade_nova,
    observacao: observacao || 'Ajuste de inventário',
    id_usuario, nome_usuario,
  });
}

/**
 * Processa uma NF-e XML e cria entradas de estoque para cada produto encontrado.
 * Tenta casar por cod_fabricante, depois por ID e por último por similaridade na descrição.
 */
async function entradaXml(pool, xmlString, { id_usuario, nome_usuario } = {}) {
  const { parseNFe } = require('../parsers/nfe-parser');
  const nfe = parseNFe(Buffer.from(xmlString, 'utf8'));

  await ensureMovimentoEstoqueTable(pool);

  const tabela = await _tabelaProduto(pool);
  const resultados = [];

  for (const item of nfe.items) {
    const qty = parseFloat(item.quantidade) || 0;
    if (qty <= 0) continue;

    // Busca produto: por cod_fabricante → por ID numérico → por descrição parcial
    let produto = null;

    if (item.cod_fabricante) {
      const [[p]] = await pool.query(
        `SELECT ID, descricao FROM ${tabela}
         WHERE (codfabricante = ? OR cod_barra = ?) AND (excluido IS NULL OR excluido='N') LIMIT 1`,
        [item.cod_fabricante, item.cod_barras || item.cod_fabricante]
      ).catch(() => [[null]]);
      produto = p || null;
    }

    if (!produto && /^\d+$/.test(item.cod_fabricante)) {
      const [[p]] = await pool.query(
        `SELECT ID, descricao FROM ${tabela}
         WHERE ID = ? AND (excluido IS NULL OR excluido='N') LIMIT 1`,
        [parseInt(item.cod_fabricante, 10)]
      ).catch(() => [[null]]);
      produto = p || null;
    }

    if (!produto && item.descricao) {
      const palavras = item.descricao.trim().split(/\s+/).slice(0, 3).join('%');
      const [[p]] = await pool.query(
        `SELECT ID, descricao FROM ${tabela}
         WHERE descricao LIKE ? AND (excluido IS NULL OR excluido='N') LIMIT 1`,
        [`%${palavras}%`]
      ).catch(() => [[null]]);
      produto = p || null;
    }

    resultados.push({
      cod_fabricante: item.cod_fabricante,
      descricao_nfe:  item.descricao,
      quantidade:     qty,
      cod_produto:    produto?.ID || null,
      descricao_sys:  produto?.descricao || null,
      status:         produto ? 'ok' : 'nao_encontrado',
      saldo_anterior: null,
      saldo_posterior: null,
    });

    if (produto) {
      const mov = await _gravarMovimento(pool, {
        cod_produto:    produto.ID,
        tipo_movimento: 'XML',
        quantidade:     qty,
        observacao:     `Entrada via XML — NF ${nfe.numero}/${nfe.serie}`,
        nota_fiscal:    nfe.numero,
        chave_nfe:      nfe.chave,
        id_usuario,
        nome_usuario,
      }).catch(e => ({ error: e.message }));
      const last = resultados[resultados.length - 1];
      if (mov.saldo_posterior !== undefined) {
        last.saldo_anterior  = mov.saldo_anterior;
        last.saldo_posterior = mov.saldo_posterior;
      } else {
        last.status = 'erro';
        last.erro   = mov.error;
      }
    }
  }

  return {
    numero:      nfe.numero,
    serie:       nfe.serie,
    chave:       nfe.chave,
    data_emissao: nfe.data_emissao,
    natureza:    nfe.natureza,
    itens:       resultados,
    ok:          resultados.filter(r => r.status === 'ok').length,
    nao_encontrado: resultados.filter(r => r.status === 'nao_encontrado').length,
    erro:        resultados.filter(r => r.status === 'erro').length,
  };
}

module.exports = {
  ensureMovimentoEstoqueTable,
  debitarEstoquesPedido,
  entradaEstoque,
  ajusteEstoque,
  entradaXml,
};
