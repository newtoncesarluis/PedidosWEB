/**
 * Tabela despesas: legado Delphi = `nome`; cadastro web antigo = `descricao`.
 * Cache por DATABASE() — evita coluna errada em multi-tenant.
 */
let _cache = null;

async function resolveDespesasLabelColumn(pool) {
  let dbKey = '';
  try {
    const [dbRow] = await pool.query('SELECT DATABASE() AS db');
    dbKey = String(dbRow[0]?.db || '');
  } catch {
    dbKey = '';
  }

  if (_cache && _cache.key === dbKey) return _cache.col;

  let col = 'nome';
  let hasNome = false;
  let hasDesc = false;
  try {
    const [rows] = await pool.query('SHOW COLUMNS FROM despesas');
    const names = new Set(rows.map((r) => r.Field));
    hasNome = names.has('nome');
    hasDesc = names.has('descricao');
    if (hasNome) col = 'nome';
    else if (hasDesc) col = 'descricao';
  } catch {
    col = 'nome';
  }

  _cache = { key: dbKey, col, hasNome, hasDesc };
  return col;
}

/** Expressão SQL do rótulo (funciona com nome, descricao ou ambos). */
function despesasLabelExpr(alias = 'd') {
  const a = alias;
  if (!_cache) return `${a}.\`nome\``;
  if (_cache.hasNome && _cache.hasDesc) {
    return `COALESCE(NULLIF(TRIM(${a}.\`nome\`), ''), ${a}.\`descricao\`)`;
  }
  const col = _cache.col || 'nome';
  return `${a}.\`${col}\``;
}

function despesasLabelColumnName() {
  return _cache?.col || 'nome';
}

function despesasOrderExpr(alias = 'd') {
  const a = alias;
  if (!_cache) return `${a}.\`nome\``;
  if (_cache.hasNome) return `${a}.\`nome\``;
  if (_cache.hasDesc) return `${a}.\`descricao\``;
  return `${a}.\`id\``;
}

function resetDespesasLabelCache() {
  _cache = null;
}

module.exports = {
  resolveDespesasLabelColumn,
  despesasLabelExpr,
  despesasLabelColumnName,
  despesasOrderExpr,
  resetDespesasLabelCache,
};
