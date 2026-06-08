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

async function initSolicitacoesSchema() {
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

    // Tabela de configurações do servidor NRE (Evolution API, etc.)
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
    console.log('[db-nresolution] Schema solicitacoes OK');
  } catch (err) {
    console.error('[db-nresolution] Erro ao inicializar schema:', err.message);
  }
}

module.exports = { getNREPool, initSolicitacoesSchema };
