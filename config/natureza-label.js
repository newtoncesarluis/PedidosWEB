/**
 * Bases legadas usam natureza.nome; bases novas usam natureza.descricao.
 */
let _col = null;

async function resolveNaturezaLabelColumn(pool) {
  if (_col) return _col;
  try {
    const [rows] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'natureza'
         AND COLUMN_NAME IN ('descricao', 'nome')`
    );
    const names = new Set(rows.map((r) => r.COLUMN_NAME));
    if (names.has('descricao')) _col = 'descricao';
    else if (names.has('nome')) _col = 'nome';
    else _col = 'descricao';
  } catch {
    _col = 'nome';
  }
  return _col;
}

function naturezaLabelExpr(alias = 'n') {
  const col = _col || 'nome';
  return `${alias}.\`${col}\``;
}

function naturezaLabelColumnName() {
  return _col || 'nome';
}

module.exports = { resolveNaturezaLabelColumn, naturezaLabelExpr, naturezaLabelColumnName };
