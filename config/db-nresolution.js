const mysql = require('mysql2/promise');

let nrePool = null;

function createNREPool() {
  return mysql.createPool({
    host:                  process.env.LICENSE_DB_HOST     || process.env.DB_HOST || 'localhost',
    port:                  parseInt(process.env.LICENSE_DB_PORT || process.env.DB_PORT) || 3306,
    user:                  process.env.LICENSE_DB_USER     || process.env.DB_USER || 'root',
    password:              process.env.LICENSE_DB_PASSWORD || process.env.DB_PASSWORD || '',
    database:              'db_nresolutions',
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

function getNREPool() {
  if (!nrePool || nrePool.pool._closed) nrePool = createNREPool();
  return nrePool;
}

async function initNreConfigSchema() {
  // Cria o banco db_nresolutions se não existir (conecta sem database para poder rodar CREATE DATABASE)
  try {
    const bootstrap = mysql.createPool({
      host:             process.env.LICENSE_DB_HOST     || process.env.DB_HOST || 'localhost',
      port:             parseInt(process.env.LICENSE_DB_PORT || process.env.DB_PORT) || 3306,
      user:             process.env.LICENSE_DB_USER     || process.env.DB_USER || 'root',
      password:         process.env.LICENSE_DB_PASSWORD || process.env.DB_PASSWORD || '',
      connectionLimit:  1,
      connectTimeout:   10000,
    });
    await bootstrap.query('CREATE DATABASE IF NOT EXISTS db_nresolutions CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    await bootstrap.end();
  } catch (err) {
    console.error('[db-nresolution] Erro ao criar banco:', err.message);
    return;
  }

  const pool = getNREPool();
  try {
    // Config Evolution API / WhatsApp (solicitações ficam em nc_painel — config/db-painel.js)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS nre_config (
        chave       VARCHAR(100) NOT NULL PRIMARY KEY,
        valor       TEXT,
        descricao   VARCHAR(200),
        atualizado  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await pool.query(`
      INSERT IGNORE INTO nre_config (chave, descricao) VALUES
        ('wa_numero',    'Número WhatsApp destino — ex: 5514999999999'),
        ('wa_instancia', 'Nome da instância Evolution API'),
        ('wa_url',       'URL base da Evolution API — ex: https://api.example.com'),
        ('wa_apikey',    'API Key da Evolution API')
    `);
    console.log('[db-nresolution] Schema nre_config OK');
  } catch (err) {
    console.error('[db-nresolution] Erro ao inicializar schema:', err.message);
  }
}

/** @deprecated use initNreConfigSchema */
const initSolicitacoesSchema = initNreConfigSchema;

module.exports = { getNREPool, initNreConfigSchema, initSolicitacoesSchema };
