/**
 * db-painel.js — pool MySQL do Painel NC central (banco nc_painel na Hostinger).
 * Solicitações de suporte/melhoria gravam aqui (não em db_nresolutions).
 *
 * .env:
 *   PAINEL_DB_HOST, PAINEL_DB_PORT, PAINEL_DB_USER, PAINEL_DB_PASSWORD, PAINEL_DB_NAME=nc_painel
 * Dev local: túnel Hostinger (tunnel-dev.bat [2]) → PAINEL_DB_HOST=127.0.0.1 PAINEL_DB_PORT=3308
 * Produção na VPS: PAINEL_DB_HOST=127.0.0.1 PAINEL_DB_PORT=3306
 */
const mysql = require('mysql2/promise');

let painelPool = null;

function painelDbName() {
  return process.env.PAINEL_DB_NAME || 'nc_painel';
}

function createPainelPool() {
  return mysql.createPool({
    host:                  process.env.PAINEL_DB_HOST     || '127.0.0.1',
    port:                  parseInt(process.env.PAINEL_DB_PORT || '3306', 10),
    user:                  process.env.PAINEL_DB_USER     || 'app_pedidosweb',
    password:              process.env.PAINEL_DB_PASSWORD || '',
    database:              painelDbName(),
    waitForConnections:    true,
    connectionLimit:       5,
    queueLimit:            0,
    timezone:              '-03:00',
    charset:               'utf8mb4',
    connectTimeout:        10000,
    enableKeepAlive:       true,
    keepAliveInitialDelay: 30000,
  });
}

function getPainelPool() {
  if (!painelPool || painelPool.pool._closed) painelPool = createPainelPool();
  return painelPool;
}

async function initPainelSolicitacoesSchema() {
  const dbName = painelDbName();
  try {
    const bootstrap = mysql.createPool({
      host:             process.env.PAINEL_DB_HOST     || '127.0.0.1',
      port:             parseInt(process.env.PAINEL_DB_PORT || '3306', 10),
      user:             process.env.PAINEL_DB_USER     || 'app_pedidosweb',
      password:         process.env.PAINEL_DB_PASSWORD || '',
      connectionLimit:  1,
      connectTimeout:   10000,
    });
    await bootstrap.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await bootstrap.end();
  } catch (err) {
    console.error('[db-painel] Erro ao criar banco:', err.message);
    return;
  }

  const pool = getPainelPool();
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS solicitacoes (
        id            INT PRIMARY KEY AUTO_INCREMENT,
        chave_licenca VARCHAR(50)  NOT NULL,
        titulo        VARCHAR(200) NOT NULL,
        descricao     TEXT         NOT NULL,
        tipo          ENUM('ideia','bug','melhoria','duvida') DEFAULT 'melhoria',
        origem        ENUM('desktop','mobile') NOT NULL,
        status        ENUM('pendente','em_analise','em_desenvolvimento','concluido','recusado') DEFAULT 'pendente',
        resposta_dev  TEXT,
        data_criacao      DATETIME DEFAULT CURRENT_TIMESTAMP,
        data_atualizacao  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_chave  (chave_licenca),
        INDEX idx_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS solicitacoes_anexos (
        id               INT PRIMARY KEY AUTO_INCREMENT,
        id_solicitacao   INT          NOT NULL,
        tipo             ENUM('imagem','video','audio') NOT NULL,
        caminho          VARCHAR(500) NOT NULL,
        nome_original    VARCHAR(255),
        tamanho          INT,
        data_upload      DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (id_solicitacao) REFERENCES solicitacoes(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    const [colsWa] = await pool.query(`SHOW COLUMNS FROM solicitacoes LIKE 'notificado_wa'`);
    if (!colsWa.length) {
      await pool.query(`ALTER TABLE solicitacoes ADD COLUMN notificado_wa TINYINT DEFAULT 0`);
    }
    const [idxWa] = await pool.query(`SHOW INDEX FROM solicitacoes WHERE Key_name = 'idx_notificado'`);
    if (!idxWa.length) {
      await pool.query(`ALTER TABLE solicitacoes ADD INDEX idx_notificado (notificado_wa)`);
    }
    console.log(`[db-painel] Schema solicitacoes OK (${dbName})`);
  } catch (err) {
    console.error('[db-painel] Erro ao inicializar schema:', err.message);
  }
}

module.exports = { getPainelPool, initPainelSolicitacoesSchema, painelDbName };
