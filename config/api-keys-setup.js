/**
 * api-keys-setup.js
 * Cria a tabela api_keys no banco de licenças se não existir.
 * Chamado automaticamente no startup do servidor.
 */
const { getLicensePool } = require('./db-license');

async function setupApiKeysTable() {
  try {
    const pool = getLicensePool();

    await pool.query(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id             INT AUTO_INCREMENT PRIMARY KEY,
        chave          VARCHAR(64)  NOT NULL UNIQUE,
        chave_licenca  VARCHAR(100) NOT NULL,
        descricao      VARCHAR(200) NULL COMMENT 'Ex: ERP Cliente XYZ',
        ativa          TINYINT(1)   NOT NULL DEFAULT 1,
        criada_em      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_used      DATETIME     NULL,
        INDEX idx_ak_chave         (chave),
        INDEX idx_ak_chave_licenca (chave_licenca)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    console.log('[api-keys] tabela api_keys OK');
  } catch (err) {
    // Tabela já existe — ignora
    if (!err.message?.includes('already exists')) {
      console.warn('[api-keys] aviso ao criar tabela:', err.message);
    }
  }
}

module.exports = { setupApiKeysTable };
