/**
 * Colunas opcionais em tipograde (grade aberta/fechada + múltiplo de pack).
 * Criadas on-demand por tenant — não quebra bases legadas.
 */

const _colsByDb = new Map();

const COLUNAS = [
  /** A = aberta (qtd livre por tamanho) | F = fechada (pack / múltiplo). */
  { column: 'modo_grade', type: "CHAR(1) NOT NULL DEFAULT 'A'" },
  /** Múltiplo total da grade fechada (ex.: 12, 15, 18). 0 = sem regra. */
  { column: 'multiplo_grade', type: 'INT NOT NULL DEFAULT 0' },
];

async function dbKey(pool) {
  const [[r]] = await pool.query('SELECT DATABASE() AS db');
  return String(r?.db || 'default');
}

async function ensureTipogradeColunas(pool) {
  const key = await dbKey(pool);
  if (_colsByDb.has(key)) return _colsByDb.get(key);

  const [cols] = await pool.query('DESCRIBE tipograde');
  const names = new Set(cols.map((c) => String(c.Field).toLowerCase()));

  for (const { column, type } of COLUNAS) {
    const col = column.toLowerCase();
    if (names.has(col)) continue;
    try {
      await pool.query(`ALTER TABLE \`tipograde\` ADD COLUMN \`${column}\` ${type}`);
      names.add(col);
      console.log(`[tipograde-colunas] + tipograde.${column}`);
    } catch (e) {
      const msg = String(e.message || '');
      if (msg.includes('Duplicate column')) {
        names.add(col);
        continue;
      }
      throw e;
    }
  }

  const list = [...names];
  _colsByDb.set(key, list);
  return list;
}

function resetTipogradeColunasCache(dbName) {
  if (dbName) _colsByDb.delete(dbName);
  else _colsByDb.clear();
}

module.exports = {
  COLUNAS,
  ensureTipogradeColunas,
  resetTipogradeColunasCache,
};
