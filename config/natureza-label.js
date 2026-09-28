/**
 * Tabela natureza: legado Delphi = `nome`; cadastro web = `descricao`.
 * Cache por DATABASE() — evita coluna errada em multi-tenant.
 */
'use strict';

let _cache = null;
const _schemaDone = new Set();

async function dbKeyOf(pool) {
  try {
    const [[row]] = await pool.query('SELECT DATABASE() AS db');
    return String(row?.db || '');
  } catch {
    return '';
  }
}

async function addColIfMissing(pool, col, def) {
  try {
    const [rows] = await pool.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'natureza' AND COLUMN_NAME = ?`,
      [col]
    );
    if (!rows.length) await pool.query(`ALTER TABLE natureza ADD COLUMN \`${col}\` ${def}`);
  } catch (_) {}
}

/** Garante colunas usadas pela web em bases Delphi (CREATE IF NOT EXISTS não altera tabela existente). */
async function ensureNaturezaSchema(pool) {
  if (!pool?.query) return;
  const key = await dbKeyOf(pool);
  if (_schemaDone.has(key)) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS natureza (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nome VARCHAR(100) DEFAULT NULL,
      descricao VARCHAR(100) DEFAULT NULL,
      tipo VARCHAR(50) DEFAULT NULL,
      movimenta_estoque CHAR(1) DEFAULT 'N',
      status CHAR(1) DEFAULT 'A',
      excluido CHAR(1) DEFAULT 'N',
      id_planoconta INT DEFAULT NULL,
      dt_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3
  `).catch(() => {});
  await addColIfMissing(pool, 'nome', 'VARCHAR(100) DEFAULT NULL');
  await addColIfMissing(pool, 'descricao', 'VARCHAR(100) DEFAULT NULL');
  await addColIfMissing(pool, 'tipo', 'VARCHAR(50) DEFAULT NULL');
  await addColIfMissing(pool, 'movimenta_estoque', "CHAR(1) DEFAULT 'N'");
  await addColIfMissing(pool, 'status', "CHAR(1) DEFAULT 'A'");
  await addColIfMissing(pool, 'excluido', "CHAR(1) DEFAULT 'N'");
  await addColIfMissing(pool, 'id_planoconta', 'INT DEFAULT NULL');
  _cache = null;
  _schemaDone.add(key);
}

async function loadNaturezaCache(pool) {
  const key = await dbKeyOf(pool);
  if (_cache && _cache.key === key) return _cache;

  const cols = new Map();
  try {
    const [rows] = await pool.query('SHOW COLUMNS FROM natureza');
    for (const c of rows) cols.set(String(c.Field).toLowerCase(), c);
  } catch (_) {}

  const hasNome = cols.has('nome');
  const hasDesc = cols.has('descricao');
  let col = 'nome';
  if (hasNome) col = 'nome';
  else if (hasDesc) col = 'descricao';

  _cache = { key, col, hasNome, hasDesc, cols };
  return _cache;
}

async function resolveNaturezaLabelColumn(pool) {
  const c = await loadNaturezaCache(pool);
  return c.col;
}

function naturezaLabelExpr(alias = 'n') {
  const a = alias;
  if (!_cache) return `${a}.\`nome\``;
  if (_cache.hasNome && _cache.hasDesc) {
    return `COALESCE(NULLIF(TRIM(${a}.\`nome\`), ''), ${a}.\`descricao\`)`;
  }
  const col = _cache.col || 'nome';
  return `${a}.\`${col}\``;
}

function naturezaLabelColumnName() {
  return _cache?.col || 'nome';
}

function naturezaSqlAtiva(alias = 'n') {
  const p = alias ? `${alias}.` : '';
  return `(${p}excluido='N' OR ${p}excluido IS NULL OR ${p}excluido='')`;
}

/** CHAR(1) legado: E/S/O; web: ENTRADA/SAIDA/OUTROS. */
function tipoNaturezaParaGravar(tipo, cache) {
  const t = String(tipo || '').trim().toUpperCase();
  if (!t) return null;
  const spec = cache?.cols?.get('tipo');
  const def = String(spec?.Type || spec?.type || '');
  const m = def.match(/^(?:var)?char\((\d+)\)/i);
  const max = m ? parseInt(m[1], 10) : 50;
  if (max <= 1) {
    if (t.startsWith('E')) return 'E';
    if (t.startsWith('S')) return 'S';
    if (t.startsWith('O')) return 'O';
    return t.slice(0, 1);
  }
  const full = t === 'SAÍDA' ? 'SAIDA' : t;
  return full.slice(0, max);
}

function tipoNaturezaParaForm(tipo) {
  const t = String(tipo || '').trim().toUpperCase();
  if (t === 'E' || t === 'ENTRADA') return 'ENTRADA';
  if (t === 'S' || t === 'SAIDA' || t === 'SAÍDA') return 'SAIDA';
  if (t === 'O' || t === 'OUTROS') return 'OUTROS';
  return t;
}

function resetNaturezaLabelCache() {
  _cache = null;
}

module.exports = {
  ensureNaturezaSchema,
  resolveNaturezaLabelColumn,
  naturezaLabelExpr,
  naturezaLabelColumnName,
  naturezaSqlAtiva,
  tipoNaturezaParaGravar,
  tipoNaturezaParaForm,
  loadNaturezaCache,
  resetNaturezaLabelCache,
};
