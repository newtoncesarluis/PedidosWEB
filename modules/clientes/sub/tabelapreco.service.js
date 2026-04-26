'use strict';

const { getPool } = require('../../../config/database');

/**
 * Busca todas as novas tabelas de preço ativas no sistema.
 */
async function buscarTabelasPreco(pool) {
  const executor = pool || getPool();
  // Busca da nova tabela Protheus-style
  const [rows] = await executor.query(
    `SELECT id, Descricao as descricao, Tabela_Ativa 
     FROM tabela_preco_cabecalho 
     WHERE excluido = 'N' AND Tabela_Ativa = 'S' 
     ORDER BY Descricao`
  ).catch(() => [[]]);
  return rows;
}

/**
 * Busca tabelas de preço (Protheus) vinculadas ao cliente em tabela_preco_vinculo.
 * Retorna array de IDs das tabelas vinculadas.
 */
async function buscarTabelasCliente(idCliente, pool) {
  const executor = pool || getPool();
  try {
    const [rows] = await executor.query(
      `SELECT id_tabela FROM tabela_preco_vinculo
       WHERE id_entidade = ? AND tipo_entidade = 'CLIENTE' AND excluido = 'N'`,
      [idCliente]
    );
    return rows.map(r => r.id_tabela);
  } catch (e) {
    console.error('[tabelapreco/buscarTabelasCliente]', e.message);
    return [];
  }
}

/**
 * Salva tabelas de preço vinculadas ao cliente na nova estrutura.
 */
async function salvarTabelasPreco(idCliente, tabelas, conn) {
  if (!Array.isArray(tabelas)) return;

  const executor = conn || getPool();
  
  // Para cada tabela, verifica se deve incluir ou remover o vínculo
  for (const tabela of tabelas) {
    const check = tabela.check === true || tabela.check === 'true' || tabela.check === 1;
    const incluido = tabela.incluido || 'N';
    const idTabela = tabela.id_tabela || tabela.id;

    if (check && incluido === 'N') {
      // INSERT vínculo na tabela nova
      await executor.query(
        `INSERT INTO tabela_preco_vinculo (id_tabela, id_entidade, tipo_entidade, excluido)
         VALUES (?, ?, 'CLIENTE', 'N')`,
        [idTabela, idCliente]
      ).catch(e => console.error('[tabelapreco/insert]', e.message));

    } else if (!check && incluido === 'I') {
      // REMOVER vínculo (soft delete ou delete real conforme padrão do sistema)
      // Aqui usamos delete real para manter a tabela de junção limpa, ou UPDATE se preferir soft delete.
      // Vou usar DELETE real para evitar lixo na tabela_preco_vinculo.
      await executor.query(
        `DELETE FROM tabela_preco_vinculo
         WHERE id_entidade = ? AND id_tabela = ? AND tipo_entidade = 'CLIENTE'`,
        [idCliente, idTabela]
      ).catch(e => console.error('[tabelapreco/delete]', e.message));
    }
  }
}

module.exports = { buscarTabelasPreco, buscarTabelasCliente, salvarTabelasPreco };

