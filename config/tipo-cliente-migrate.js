/**
 * Tabela de apoio `tipo_cliente` — alimenta o combo Tipo de Cliente.
 * `clientes.tipo_cliente` continua gravando o **codigo** (ex.: CONSUMIDOR).
 */

const DEFAULTS = [
  { codigo: 'CONSUMIDOR', descricao: 'CONSUMIDOR', ordem: 1 },
  { codigo: 'REVENDEDOR', descricao: 'REVENDEDOR', ordem: 2 },
  { codigo: 'ESPECIAL', descricao: 'ESPECIAL', ordem: 3 },
  { codigo: 'INDUSTRIA', descricao: 'INDÚSTRIA', ordem: 4 },
];

let _seededDbs = new Set();
let _upperDone = new Set();

function codigoFromDescricao(desc) {
  return String(desc || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 50);
}

async function ensureTipoClienteTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tipo_cliente (
      id INT AUTO_INCREMENT PRIMARY KEY,
      codigo VARCHAR(50) NOT NULL,
      descricao VARCHAR(100) NOT NULL,
      ordem INT NOT NULL DEFAULT 0,
      status CHAR(1) DEFAULT 'A',
      excluido CHAR(1) DEFAULT 'N',
      dt_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unq_tipo_cli_codigo (codigo),
      INDEX idx_tipo_cli_desc (descricao)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3
  `).catch(() => {});
}

async function _dbKey(pool) {
  try {
    const [[r]] = await pool.query('SELECT DATABASE() AS db');
    return r?.db || 'default';
  } catch {
    return 'default';
  }
}

/**
 * Insere padrões do combo antigo + valores já usados em clientes.tipo_cliente.
 * Idempotente (por codigo / descrição).
 */
async function seedTipoCliente(pool) {
  if (!pool) return { ok: false, reason: 'no-pool' };
  const dbKey = await _dbKey(pool);
  if (_seededDbs.has(dbKey)) return { ok: true, skipped: 'already' };

  try {
    await ensureTipoClienteTable(pool);

    for (const d of DEFAULTS) {
      const [ex] = await pool.query(
        `SELECT id FROM tipo_cliente
         WHERE UPPER(TRIM(codigo)) = ? AND COALESCE(excluido,'N')='N'
         LIMIT 1`,
        [d.codigo]
      );
      if (ex.length) continue;
      await pool.query(
        `INSERT INTO tipo_cliente (codigo, descricao, ordem, status, excluido)
         VALUES (?,?,?,'A','N')`,
        [d.codigo, d.descricao, d.ordem]
      );
    }

    // Valores já gravados em clientes que ainda não estão na tabela
    try {
      const [used] = await pool.query(`
        SELECT DISTINCT TRIM(tipo_cliente) AS v
        FROM clientes
        WHERE COALESCE(excluido,'N')='N'
          AND TRIM(COALESCE(tipo_cliente,'')) <> ''
      `);
      for (const row of used) {
        const raw = String(row.v || '').trim();
        if (!raw) continue;
        const codigo = codigoFromDescricao(raw) || raw.toUpperCase().slice(0, 50);
        const [ex] = await pool.query(
          `SELECT id FROM tipo_cliente
           WHERE (UPPER(TRIM(codigo)) = ? OR UPPER(TRIM(descricao)) = ?)
             AND COALESCE(excluido,'N')='N'
           LIMIT 1`,
          [codigo, raw.toUpperCase()]
        );
        if (ex.length) continue;
        // Se já existe o default pelo codigo, não cria duplicata
        const isDefault = DEFAULTS.some((d) => d.codigo === codigo);
        if (isDefault) continue;
        await pool.query(
          `INSERT INTO tipo_cliente (codigo, descricao, ordem, status, excluido)
           VALUES (?,?,0,'A','N')`,
          [codigo, raw.toUpperCase()]
        );
      }
    } catch { /* coluna/tabela ausente */ }

    _seededDbs.add(dbKey);
    await normalizeTipoClienteUppercase(pool);
    return { ok: true };
  } catch (e) {
    console.warn('[tipo-cliente] seed:', e.message);
    return { ok: false, error: e.message };
  }
}

async function normalizeTipoClienteUppercase(pool) {
  const dbKey = await _dbKey(pool);
  if (_upperDone.has(dbKey)) return;
  await pool.query(`
    UPDATE tipo_cliente
    SET descricao=UPPER(TRIM(descricao)), codigo=UPPER(TRIM(codigo))
    WHERE COALESCE(excluido,'N')='N'
      AND (descricao <> UPPER(TRIM(descricao)) OR codigo <> UPPER(TRIM(codigo)))
  `).catch(() => {});
  _upperDone.add(dbKey);
}

async function ensureTipoClienteReady(pool) {
  await ensureTipoClienteTable(pool);
  await seedTipoCliente(pool);
  await normalizeTipoClienteUppercase(pool);
}

module.exports = {
  DEFAULTS,
  codigoFromDescricao,
  ensureTipoClienteTable,
  seedTipoCliente,
  ensureTipoClienteReady,
};
