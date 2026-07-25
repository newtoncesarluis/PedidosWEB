'use strict';

/**
 * Carteira de cheques de terceiros (on-demand por tenant).
 * Bases com tabela legado incompleta: CREATE IF NOT EXISTS não adiciona colunas —
 * após criar, DESCRIBE + ADD COLUMN das faltantes.
 */

const _ok = new Map();

const COLUNAS = [
  { name: 'tipo', type: "CHAR(1) NOT NULL DEFAULT 'T'" },
  { name: 'numero', type: "VARCHAR(30) NOT NULL DEFAULT ''" },
  { name: 'banco_nome', type: 'VARCHAR(80) NULL' },
  { name: 'agencia', type: 'VARCHAR(20) NULL' },
  { name: 'conta', type: 'VARCHAR(20) NULL' },
  { name: 'emitente', type: 'VARCHAR(150) NULL' },
  { name: 'cpf_cnpj', type: 'VARCHAR(20) NULL' },
  { name: 'valor', type: 'DECIMAL(15,2) NOT NULL DEFAULT 0' },
  { name: 'bom_para', type: 'DATE NULL' },
  { name: 'data_recebimento', type: 'DATE NULL' },
  { name: 'id_receber', type: 'INT NULL' },
  { name: 'id_cliente', type: 'INT NULL' },
  { name: 'id_pagar', type: 'INT NULL' },
  { name: 'id_fornecedor', type: 'INT NULL' },
  { name: 'status', type: "VARCHAR(20) NOT NULL DEFAULT 'EM_CARTEIRA'" },
  { name: 'id_banco_deposito', type: 'INT NULL' },
  { name: 'obs', type: 'VARCHAR(255) NULL' },
  { name: 'excluido', type: "CHAR(1) NOT NULL DEFAULT 'N'" },
  { name: 'dt_cadastro', type: 'DATETIME DEFAULT CURRENT_TIMESTAMP' },
];

async function dbKey(pool) {
  const [[r]] = await pool.query('SELECT DATABASE() AS db');
  return String(r?.db || 'default');
}

async function ensureChequesSchema(pool) {
  const key = await dbKey(pool);
  if (_ok.has(key)) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cheques (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tipo CHAR(1) NOT NULL DEFAULT 'T',
      numero VARCHAR(30) NOT NULL,
      banco_nome VARCHAR(80) NULL,
      agencia VARCHAR(20) NULL,
      conta VARCHAR(20) NULL,
      emitente VARCHAR(150) NULL,
      cpf_cnpj VARCHAR(20) NULL,
      valor DECIMAL(15,2) NOT NULL,
      bom_para DATE NOT NULL,
      data_recebimento DATE NULL,
      id_receber INT NULL,
      id_cliente INT NULL,
      id_pagar INT NULL,
      id_fornecedor INT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'EM_CARTEIRA',
      id_banco_deposito INT NULL,
      obs VARCHAR(255) NULL,
      excluido CHAR(1) NOT NULL DEFAULT 'N',
      dt_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP,
      KEY idx_ch_status (status, bom_para),
      KEY idx_ch_cliente (id_cliente),
      KEY idx_ch_receber (id_receber),
      KEY idx_ch_pagar (id_pagar)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const [cols] = await pool.query('DESCRIBE cheques');
  const exist = new Set(cols.map((c) => String(c.Field).toLowerCase()));
  for (const col of COLUNAS) {
    if (exist.has(col.name.toLowerCase())) continue;
    try {
      await pool.query(`ALTER TABLE cheques ADD COLUMN \`${col.name}\` ${col.type}`);
    } catch (_) { /* coluna já criada em paralelo / permissão */ }
  }

  // Índices úteis (ignora se já existem)
  for (const idx of [
    'CREATE INDEX idx_ch_status ON cheques (status, bom_para)',
    'CREATE INDEX idx_ch_cliente ON cheques (id_cliente)',
    'CREATE INDEX idx_ch_receber ON cheques (id_receber)',
    'CREATE INDEX idx_ch_pagar ON cheques (id_pagar)',
  ]) {
    try { await pool.query(idx); } catch (_) {}
  }

  _ok.set(key, true);
}

function resetChequesSchemaCache(db) {
  if (db) _ok.delete(db);
  else _ok.clear();
}

module.exports = {
  ensureChequesSchema,
  resetChequesSchemaCache,
};
