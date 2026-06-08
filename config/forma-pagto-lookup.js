/**
 * Lookup de forma_pagto — compatível com bases legado Delphi/Web.
 * Não filtrar por status fixo (S/A): legado pode usar NULL, coluna inexistente ou excluido NULL.
 */

async function formaPagtoColumnSet(pool) {
  const [rows] = await pool.query(
    `SELECT LOWER(TRIM(COLUMN_NAME)) AS n FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'forma_pagto'`
  ).catch(() => [[]]);
  return new Set((rows || []).map((r) => String(r.n)));
}

async function listFormasPagamentoLookup(pool) {
  if (!pool?.query) return [];
  const cols = await formaPagtoColumnSet(pool);
  if (!cols.size) return [];

  const where = [];
  if (cols.has('excluido')) {
    where.push(`(excluido = 'N' OR excluido IS NULL)`);
  }

  let prazoExpr = 'NULL';
  if (cols.has('prazopadrao') && cols.has('prazo_padrao')) {
    prazoExpr = `COALESCE(NULLIF(TRIM(prazopadrao), ''), NULLIF(TRIM(prazo_padrao), ''))`;
  } else if (cols.has('prazopadrao')) {
    prazoExpr = 'prazopadrao';
  } else if (cols.has('prazo_padrao')) {
    prazoExpr = 'prazo_padrao';
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await pool.query(
    `SELECT id, descricao, ${prazoExpr} AS prazopadrao
     FROM forma_pagto ${whereSql}
     ORDER BY descricao`
  );
  return rows || [];
}

module.exports = { listFormasPagamentoLookup, formaPagtoColumnSet };
