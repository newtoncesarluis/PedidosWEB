/**
 * Colunas opcionais + largura mínima em tipograde / descricao_grades.
 * Bases Delphi costumam ter nome/apelido curtos (ex. VARCHAR(10/20)) e
 * estouram «Data too long for column 'nome'» no cadastro web.
 */

const _colsByDb = new Map();

const COLUNAS = [
  /** A = aberta (qtd livre por tamanho) | F = fechada (pack / múltiplo). */
  { column: 'modo_grade', type: "CHAR(1) NOT NULL DEFAULT 'A'" },
  /** Múltiplo total da grade fechada (ex.: 12, 15, 18). 0 = sem regra. */
  { column: 'multiplo_grade', type: 'INT NOT NULL DEFAULT 0' },
];

/** Amplia colunas de texto se o legado estiver curto demais. */
const WIDEN = [
  { table: 'tipograde', column: 'nome', minLen: 100, type: 'VARCHAR(100) NULL' },
  { table: 'tipograde', column: 'apelido', minLen: 50, type: 'VARCHAR(50) NULL' },
  { table: 'descricao_grades', column: 'nome', minLen: 50, type: 'VARCHAR(50) NULL' },
];

async function dbKey(pool) {
  const [[r]] = await pool.query('SELECT DATABASE() AS db');
  return String(r?.db || 'default');
}

function parseVarcharLen(typeStr) {
  const m = String(typeStr || '').match(/^(?:var)?char\((\d+)\)/i);
  return m ? Number(m[1]) : null;
}

async function ensureWidenTextCols(pool) {
  for (const w of WIDEN) {
    try {
      const [cols] = await pool.query(`SHOW COLUMNS FROM \`${w.table}\` LIKE ?`, [w.column]);
      if (!cols.length) continue;
      const cur = cols[0];
      const len = parseVarcharLen(cur.Type);
      // CHAR/VARCHAR curto → amplia. Tipos não string (raro) também força VARCHAR.
      if (len != null && len >= w.minLen) continue;
      const nullSql = String(cur.Null || '').toUpperCase() === 'NO' ? 'NOT NULL' : 'NULL';
      await pool.query(
        `ALTER TABLE \`${w.table}\` MODIFY COLUMN \`${w.column}\` VARCHAR(${w.minLen}) ${nullSql}`
      );
      console.log(`[tipograde-colunas] widen ${w.table}.${w.column} → VARCHAR(${w.minLen})`);
    } catch (e) {
      console.warn(`[tipograde-colunas] widen ${w.table}.${w.column}:`, e.message);
    }
  }
}

async function ensureTipogradeColunas(pool) {
  const key = await dbKey(pool);
  if (_colsByDb.has(key)) return _colsByDb.get(key);

  await ensureWidenTextCols(pool);

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

/** Mensagem amigável p/ ER_DATA_TOO_LONG (1406). */
function msgErroGradeSql(err) {
  const msg = String(err?.message || err || '');
  if (err?.errno === 1406 || /Data too long for column/i.test(msg)) {
    const col = (msg.match(/column '([^']+)'/i) || [])[1] || 'nome';
    return (
      `Texto muito longo para o campo «${col}». ` +
      'Use descrição/apelido mais curtos ou tente salvar de novo (o sistema amplia a coluna automaticamente).'
    );
  }
  return msg;
}

module.exports = {
  COLUNAS,
  WIDEN,
  ensureTipogradeColunas,
  resetTipogradeColunasCache,
  msgErroGradeSql,
};
