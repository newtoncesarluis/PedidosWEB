'use strict';

/**
 * Baixa (arquivamento) de comissões em pagtocomissao — excluido='S'.
 * Não estorna status, não mexe em contas a pagar/receber.
 */

function buildBaixaLoteWhere(query, userFilter) {
  const parts = [`COALESCE(pc.excluido, 'N') = 'N'`];
  const params = [];

  const ate = String(query.ate_data || '').trim();
  if (ate) {
    parts.push('pc.data_lancamento <= ?');
    params.push(ate);
  }

  if (userFilter?.clause) {
    const clause = userFilter.clause.replace(/^\s*AND\s+/i, '');
    if (clause) {
      parts.push(clause);
      params.push(...(userFilter.params || []));
    }
  }

  if (query.id_fornecedor) {
    parts.push('ped.cod_fornecedor = ?');
    params.push(query.id_fornecedor);
  }

  const status = query.status;
  if (status && status !== 'T') {
    if (status === 'Q') parts.push(`pc.status IN ('R','C')`);
    else {
      parts.push('pc.status = ?');
      params.push(status);
    }
  }

  if (Array.isArray(query.ids) && query.ids.length) {
    const ids = query.ids.map((x) => parseInt(x, 10)).filter((n) => n > 0);
    if (ids.length) {
      parts.push(`pc.id IN (${ids.map(() => '?').join(',')})`);
      params.push(...ids);
    }
  }

  return { where: parts.join(' AND '), params };
}

const JOIN_PED = `LEFT JOIN pedidos ped ON pc.pedido = ped.numero`;

async function previewBaixaLote(pool, query, userFilter) {
  const { where, params } = buildBaixaLoteWhere(query, userFilter);
  const [[row]] = await pool.query(
    `SELECT
       COUNT(*) AS qtd,
       COALESCE(SUM(pc.vlr_pago), 0) AS total,
       COALESCE(SUM(CASE WHEN pc.status = 'P' THEN 1 ELSE 0 END), 0) AS qtd_pendente,
       COALESCE(SUM(CASE WHEN pc.status = 'C' THEN 1 ELSE 0 END), 0) AS qtd_conferida,
       COALESCE(SUM(CASE WHEN pc.status = 'R' THEN 1 ELSE 0 END), 0) AS qtd_paga,
       COALESCE(SUM(CASE WHEN pc.status = 'I' THEN 1 ELSE 0 END), 0) AS qtd_inadimplente
     FROM pagtocomissao pc
     ${JOIN_PED}
     WHERE ${where}`,
    params
  );
  return row || { qtd: 0, total: 0 };
}

async function executarBaixaLote(pool, query, userFilter, { motivo, userId }) {
  const { where, params } = buildBaixaLoteWhere(query, userFilter);
  const obs = ` | BAIXA ${new Date().toISOString().slice(0, 10)}: ${String(motivo || '').trim()} (usuário ${userId})`;

  const [result] = await pool.query(
    `UPDATE pagtocomissao pc
     ${JOIN_PED}
     SET pc.excluido = 'S',
         pc.observacao = CONCAT(COALESCE(pc.observacao, ''), ?)
     WHERE ${where}`,
    [obs, ...params]
  );

  return { afetadas: result.affectedRows || 0 };
}

module.exports = {
  buildBaixaLoteWhere,
  previewBaixaLote,
  executarBaixaLote,
};
