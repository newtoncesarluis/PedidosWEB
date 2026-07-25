'use strict';

/**
 * Schema gerencial: plano_contas (hierárquico) + centro_custo + FKs em títulos.
 * Contabilidade formal (partida dobrada) fica fora deste módulo.
 */

async function addColIfMissing(pool, table, col, def) {
  try {
    const [rows] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, col]
    );
    if (!rows.length) await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${def}`);
  } catch (_) {}
}

/** Cache DESCRIBE por DATABASE() — bases legadas Delphi têm colunas extras (ex.: numero_pai). */
const _planoColsCache = new Map();

async function getPlanoContasColumns(pool) {
  if (!pool?.query) return new Map();
  let dbName = '';
  try {
    const [[row]] = await pool.query('SELECT DATABASE() AS db');
    dbName = row?.db || '';
  } catch (_) {}
  if (_planoColsCache.has(dbName)) return _planoColsCache.get(dbName);
  const map = new Map();
  try {
    const [cols] = await pool.query('SHOW COLUMNS FROM plano_contas');
    for (const c of cols) map.set(String(c.Field).toLowerCase(), c);
  } catch (_) {}
  _planoColsCache.set(dbName, map);
  return map;
}

function invalidatePlanoContasColumnsCache() {
  _planoColsCache.clear();
}

/**
 * Legado Delphi: numero_pai NOT NULL sem default → INSERT/UPDATE da web quebrava.
 * Soften para DEFAULT '' (não apaga dados) e devolve se a coluna existe.
 */
async function ensureNumeroPaiCompat(pool) {
  const cols = await getPlanoContasColumns(pool);
  const col = cols.get('numero_pai');
  if (!col) return false;
  const needsDefault = col.Null === 'NO' && (col.Default === null || col.Default === undefined);
  if (needsDefault) {
    const type = col.Type || 'VARCHAR(30)';
    try {
      await pool.query(`ALTER TABLE plano_contas MODIFY COLUMN numero_pai ${type} NOT NULL DEFAULT ''`);
    } catch (_) {
      try {
        await pool.query(`ALTER TABLE plano_contas MODIFY COLUMN numero_pai ${type} NULL DEFAULT NULL`);
      } catch (__) {}
    }
    invalidatePlanoContasColumnsCache();
  }
  return true;
}

/** Valor de numero_pai = número da conta pai (ou ''). */
async function resolveNumeroPai(pool, idPai) {
  if (!idPai) return '';
  const [rows] = await pool.query(
    `SELECT numero FROM plano_contas WHERE id = ? LIMIT 1`,
    [idPai]
  );
  return (rows[0]?.numero != null ? String(rows[0].numero) : '').trim();
}

/**
 * Monta fragmento SQL opcional para colunas legadas no INSERT/UPDATE.
 * @returns {{ setSql: string, insertCols: string, insertPlaceholders: string, values: any[] }}
 */
async function planoContasLegacyWriteFields(pool, idPai) {
  const hasNumeroPai = await ensureNumeroPaiCompat(pool);
  const values = [];
  let setSql = '';
  let insertCols = '';
  let insertPlaceholders = '';
  if (hasNumeroPai) {
    const numPai = await resolveNumeroPai(pool, idPai);
    values.push(numPai);
    setSql = ', numero_pai=?';
    insertCols = ', numero_pai';
    insertPlaceholders = ',?';
  }
  return { setSql, insertCols, insertPlaceholders, values };
}

async function ensurePlanoContasSchema(pool) {
  if (!pool?.query) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS plano_contas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      numero VARCHAR(30) DEFAULT NULL,
      descricao VARCHAR(150) NOT NULL,
      id_pai INT DEFAULT NULL,
      nivel INT DEFAULT 1,
      tipo VARCHAR(20) DEFAULT 'ANALITICA',
      grupo VARCHAR(20) DEFAULT 'DESPESA',
      aceita_lancamento CHAR(1) DEFAULT 'S',
      status CHAR(1) DEFAULT 'A',
      excluido CHAR(1) DEFAULT 'N',
      INDEX idx_pc_numero (numero),
      INDEX idx_pc_pai (id_pai),
      INDEX idx_pc_grupo (grupo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `).catch(() => {});

  await addColIfMissing(pool, 'plano_contas', 'id_pai', 'INT DEFAULT NULL');
  await addColIfMissing(pool, 'plano_contas', 'nivel', 'INT DEFAULT 1');
  await addColIfMissing(pool, 'plano_contas', 'tipo', "VARCHAR(20) DEFAULT 'ANALITICA'");
  await addColIfMissing(pool, 'plano_contas', 'grupo', "VARCHAR(20) DEFAULT 'DESPESA'");
  await addColIfMissing(pool, 'plano_contas', 'aceita_lancamento', "CHAR(1) DEFAULT 'S'");
  await addColIfMissing(pool, 'plano_contas', 'status', "CHAR(1) DEFAULT 'A'");
  await addColIfMissing(pool, 'plano_contas', 'excluido', "CHAR(1) DEFAULT 'N'");
  await addColIfMissing(pool, 'plano_contas', 'numero', 'VARCHAR(30) DEFAULT NULL');
  await ensureNumeroPaiCompat(pool);
}

async function ensureCentroCustoSchema(pool) {
  if (!pool?.query) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS centro_custo (
      id INT AUTO_INCREMENT PRIMARY KEY,
      codigo VARCHAR(30) DEFAULT NULL,
      descricao VARCHAR(150) NOT NULL,
      id_pai INT DEFAULT NULL,
      tipo VARCHAR(20) DEFAULT 'ANALITICA',
      status CHAR(1) DEFAULT 'A',
      excluido CHAR(1) DEFAULT 'N',
      INDEX idx_cc_codigo (codigo),
      INDEX idx_cc_pai (id_pai)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `).catch(() => {});
}

/** Evita INFORMATION_SCHEMA / ALTER em todo GET da listagem (multi-tenant por DATABASE()). */
const _finContabilDone = new Set();

async function ensureFinanceiroContabilCols(pool) {
  if (!pool?.query) return;
  let dbName = '';
  try {
    const [[row]] = await pool.query('SELECT DATABASE() AS db');
    dbName = row?.db || '';
  } catch (_) {}
  if (_finContabilDone.has(dbName)) return;

  await ensurePlanoContasSchema(pool);
  await ensureCentroCustoSchema(pool);
  await addColIfMissing(pool, 'despesas', 'id_planoconta', 'INT DEFAULT NULL');
  await addColIfMissing(pool, 'natureza', 'id_planoconta', 'INT DEFAULT NULL');
  await addColIfMissing(pool, 'pagar', 'id_planoconta', 'INT DEFAULT NULL');
  await addColIfMissing(pool, 'pagar', 'id_centrocusto', 'INT DEFAULT NULL');
  await addColIfMissing(pool, 'receber', 'id_planoconta', 'INT DEFAULT NULL');
  await addColIfMissing(pool, 'receber', 'id_centrocusto', 'INT DEFAULT NULL');
  _finContabilDone.add(dbName);
}

function normalizeTipoConta(tipo) {
  const t = String(tipo || 'ANALITICA').toUpperCase();
  return t === 'SINTETICA' || t === 'S' ? 'SINTETICA' : 'ANALITICA';
}

function normalizeGrupoConta(grupo) {
  const g = String(grupo || 'DESPESA').toUpperCase();
  const ok = ['ATIVO', 'PASSIVO', 'RECEITA', 'DESPESA', 'PATRIMONIO', 'OUTROS'];
  return ok.includes(g) ? g : 'OUTROS';
}

async function calcNivelPai(pool, idPai) {
  if (!idPai) return 1;
  const [rows] = await pool.query(
    `SELECT nivel FROM plano_contas WHERE id = ? AND (excluido='N' OR excluido IS NULL) LIMIT 1`,
    [idPai]
  );
  return (parseInt(rows[0]?.nivel, 10) || 1) + 1;
}

async function calcNivelPaiCc(pool, idPai) {
  if (!idPai) return 1;
  const [rows] = await pool.query(
    `SELECT 1 FROM centro_custo WHERE id = ? AND (excluido='N' OR excluido IS NULL) LIMIT 1`,
    [idPai]
  );
  return rows.length ? 2 : 1;
}

module.exports = {
  ensurePlanoContasSchema,
  ensureCentroCustoSchema,
  ensureFinanceiroContabilCols,
  normalizeTipoConta,
  normalizeGrupoConta,
  calcNivelPai,
  calcNivelPaiCc,
  addColIfMissing,
  getPlanoContasColumns,
  ensureNumeroPaiCompat,
  resolveNumeroPai,
  planoContasLegacyWriteFields,
};
