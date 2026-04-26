const mysql = require('mysql2/promise');

// Pool separado para a base de dados de licenças (servidor remoto/central MySQL)
let licensePool = null;

function getLicensePool() {
  if (!licensePool) {
    licensePool = mysql.createPool({
      host:             process.env.LICENSE_DB_HOST     || process.env.DB_HOST || 'localhost',
      port:             parseInt(process.env.LICENSE_DB_PORT || process.env.DB_PORT) || 3306,
      user:             process.env.LICENSE_DB_USER     || process.env.DB_USER || 'root',
      password:         process.env.LICENSE_DB_PASSWORD || process.env.DB_PASSWORD || '',
      database:         process.env.LICENSE_DB_NAME     || 'sistemas_licencas',
      waitForConnections: true,
      connectionLimit:  5,
      queueLimit:       0,
      timezone:         '-03:00',
      charset:          'utf8mb4',
      connectTimeout:   10000,
    });
  }
  return licensePool;
}

module.exports = { getLicensePool };
