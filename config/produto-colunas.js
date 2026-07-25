/**
 * Garante colunas opcionais em produto/produtos por tenant (DATABASE()).
 * Se a coluna não existir, executa ALTER TABLE antes de gravar/ler.
 */

const _tabelaByDb = new Map();
const _colunasByDb = new Map();

const COLUNAS_PADRAO = [
  { column: 'multiplo_venda', type: 'INT NOT NULL DEFAULT 1' },
  { column: 'qtd_minima_pedido', type: 'INT NOT NULL DEFAULT 0' },
  { column: 'segmento', type: 'VARCHAR(100) NULL DEFAULT NULL' },
  { column: 'foto_principal', type: 'VARCHAR(500) NULL' },
  { column: 'comissao', type: 'DECIMAL(5,2) NULL DEFAULT 0' },
  { column: 'st', type: 'DECIMAL(5,2) NULL DEFAULT 0' },
  { column: 'valor_puxada', type: 'DECIMAL(15,4) NULL DEFAULT 0' },
  /** Opt-in: cor/variação aponta para o produto mãe (SKU continua pedível). */
  { column: 'id_referencia', type: 'INT NULL DEFAULT NULL' },
  /** Público-alvo: Masculino | Feminino | Infantil (ou texto livre). */
  { column: 'subfamilia', type: 'VARCHAR(40) NULL DEFAULT NULL' },
  /** Linha comercial (ex.: tênis jogger). */
  { column: 'linha_produto', type: 'VARCHAR(120) NULL DEFAULT NULL' },
  /** Campo livre para demandas específicas. */
  { column: 'campo_extra', type: 'VARCHAR(200) NULL DEFAULT NULL' },
  /** Mark-up líquido % após custo e comissão (calculado na tela). */
  { column: 'margem_liquida', type: 'DECIMAL(10,2) NULL DEFAULT NULL' },
];

async function dbKey(pool) {
  const [[r]] = await pool.query('SELECT DATABASE() AS db');
  return String(r?.db || 'default');
}

async function getProdTabela(pool) {
  const key = await dbKey(pool);
  if (_tabelaByDb.has(key)) return _tabelaByDb.get(key);
  const [rows] = await pool.query(`SHOW TABLES LIKE 'produto'`);
  const tb = rows.length ? 'produto' : 'produtos';
  _tabelaByDb.set(key, tb);
  return tb;
}

/**
 * @param {import('mysql2/promise').Pool} pool
 * @param {{ column: string, type: string }[]} [extras]
 */
async function ensureProdutoColunas(pool, extras = []) {
  const key = await dbKey(pool);
  const tb = await getProdTabela(pool);
  const needed = [...COLUNAS_PADRAO, ...extras];
  const neededNames = needed.map(({ column }) => String(column).toLowerCase());

  // Fast-path: após o 1º ensure bem-sucedido no tenant, evita DESCRIBE a cada request
  const cached = _colunasByDb.get(key);
  if (cached && neededNames.every((c) => cached.some((x) => String(x).toLowerCase() === c))) {
    return { names: new Set(cached.map((c) => String(c).toLowerCase())), changed: false };
  }

  const [cols] = await pool.query(`DESCRIBE ${tb}`);
  const fieldList = cols.map((c) => String(c.Field));
  const names = new Set(fieldList.map((c) => c.toLowerCase()));
  let changed = false;

  for (const { column, type } of needed) {
    const col = String(column).toLowerCase();
    if (names.has(col)) continue;
    try {
      await pool.query(`ALTER TABLE \`${tb}\` ADD COLUMN \`${column}\` ${type}`);
      names.add(col);
      fieldList.push(column);
      changed = true;
      console.log(`[produto-colunas] + ${tb}.${column}`);
    } catch (e) {
      const msg = String(e.message || '');
      if (msg.includes('Duplicate column')) {
        names.add(col);
        if (!fieldList.some((x) => String(x).toLowerCase() === col)) fieldList.push(column);
        continue;
      }
      throw e;
    }
  }

  _colunasByDb.set(key, fieldList);
  return { names, changed };
}

async function listProdutoColunas(pool) {
  const key = await dbKey(pool);
  await ensureProdutoColunas(pool);
  if (_colunasByDb.has(key)) return _colunasByDb.get(key);
  const tb = await getProdTabela(pool);
  const [rows] = await pool.query(`DESCRIBE ${tb}`);
  const list = rows.map((r) => r.Field);
  _colunasByDb.set(key, list);
  return list;
}

function resetProdutoColunasCache(dbName) {
  if (dbName) {
    _colunasByDb.delete(dbName);
    _tabelaByDb.delete(dbName);
  } else {
    _colunasByDb.clear();
    _tabelaByDb.clear();
  }
}

module.exports = {
  COLUNAS_PADRAO,
  dbKey,
  getProdTabela,
  ensureProdutoColunas,
  listProdutoColunas,
  resetProdutoColunasCache,
};
