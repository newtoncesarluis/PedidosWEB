const mysql = require('mysql2/promise');

let licensePool = null;

function createLicensePool() {
  return mysql.createPool({
    host:                  process.env.LICENSE_DB_HOST     || process.env.DB_HOST || 'localhost',
    port:                  parseInt(process.env.LICENSE_DB_PORT || process.env.DB_PORT) || 3306,
    user:                  process.env.LICENSE_DB_USER     || process.env.DB_USER || 'root',
    password:              process.env.LICENSE_DB_PASSWORD || process.env.DB_PASSWORD || '',
    database:              process.env.LICENSE_DB_NAME     || 'sistema_licencas',
    waitForConnections:    true,
    connectionLimit:       3,
    queueLimit:            0,
    timezone:              '-03:00',
    charset:               'utf8mb4',
    connectTimeout:        10000,
    enableKeepAlive:       true,
    keepAliveInitialDelay: 30000,
  });
}

function getLicensePool() {
  // pool.pool._closed é true quando pool.end() foi chamado (ex: wait_timeout do MySQL)
  if (!licensePool || licensePool.pool._closed) licensePool = createLicensePool();
  return licensePool;
}

// Recria o pool se ele for fechado inesperadamente (ex: wait_timeout do MySQL)
function resetLicensePool() {
  licensePool = null;
}

module.exports = { getLicensePool, resetLicensePool };
