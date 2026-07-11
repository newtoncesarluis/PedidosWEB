'use strict';

const _tipoPedidosReady = new Set();

/** Garante colunas web em tipo_pedidos (bases Delphi legadas). */
async function ensureTipoPedidosColumns(pool) {
  const db = pool.pool?.config?.connectionConfig?.database || 'default';
  if (_tipoPedidosReady.has(db)) return;
  const cols = [
    ['excluido',         "CHAR(1) NOT NULL DEFAULT 'N'"],
    ['situacao',         "CHAR(1) NOT NULL DEFAULT 'A'"],
    ['obs',              'VARCHAR(255) DEFAULT NULL'],
    ['puxada',           "CHAR(1) NOT NULL DEFAULT 'N'"],
    ['gerafinanceiro',   "CHAR(1) NOT NULL DEFAULT 'S'"],
    ['permiteprocesso',  "CHAR(1) NOT NULL DEFAULT 'N'"],
    ['movimentaestoque', "CHAR(1) NOT NULL DEFAULT 'S'"],
    ['faturado',         "CHAR(1) NOT NULL DEFAULT 'N'"],
    ['importacao',       "CHAR(1) NOT NULL DEFAULT 'N'"],
    ['padrao_vitrine',   "CHAR(1) NOT NULL DEFAULT 'N'"],
    ['cod_planoconta',   'INT DEFAULT NULL'],
    ['tratamento',       'VARCHAR(50) DEFAULT NULL'],
    ['id_receitas',      'INT DEFAULT NULL'],
  ];
  for (const [col, type] of cols) {
    await pool.query(`ALTER TABLE tipo_pedidos ADD COLUMN ${col} ${type}`).catch(() => {});
  }
  _tipoPedidosReady.add(db);
}

/** JOIN tipo_pedidos ↔ pedidos (id_tipopedido). */
function tipoPedidosJoinSql(pAlias = 'p', tpAlias = 'tp') {
  return `LEFT JOIN tipo_pedidos ${tpAlias} ON ${tpAlias}.id = ${pAlias}.id_tipopedido AND (${tpAlias}.excluido = 'N' OR ${tpAlias}.excluido IS NULL)`;
}

/** Normaliza texto de tipo (cedilha/acentos) para comparar ORCAMENTO. */
function tipoPedidoNormSql(colExpr) {
  return `UPPER(REPLACE(REPLACE(REPLACE(COALESCE(${colExpr},''), 'Ç', 'C'), 'Ã', 'A'), ' ', ''))`;
}

/**
 * S/N se o pedido gera financeiro: prioridade tipo_pedidos.gerafinanceiro;
 * fallback legado pela descrição gravada em pedidos.tipo_pedido.
 */
function geraFinanceiroExprSql(pAlias = 'p', tpAlias = 'tp') {
  const pNorm = tipoPedidoNormSql(`${pAlias}.tipo_pedido`);
  return `COALESCE(
    NULLIF(${tpAlias}.gerafinanceiro, ''),
    CASE WHEN ${pNorm} LIKE '%ORCAMENTO%' OR ${pNorm} LIKE '%ORCA%' THEN 'N' ELSE 'S' END
  )`;
}

module.exports = {
  ensureTipoPedidosColumns,
  tipoPedidosJoinSql,
  tipoPedidoNormSql,
  geraFinanceiroExprSql,
};
