const mysql = require('mysql2/promise');

let pool = null;

function createPool(config = null) {
  const cfg = config || {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sysrepweb',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: '-03:00'
  };

  pool = mysql.createPool(cfg);
  return pool;
}

function getPool() {
  if (!pool) createPool();
  return pool;
}

async function testConnection(config) {
  const testPool = mysql.createPool({ ...config, connectionLimit: 1 });
  try {
    const conn = await testPool.getConnection();
    conn.release();
    await testPool.end();
    return { ok: true };
  } catch (err) {
    try { await testPool.end(); } catch {}
    return { ok: false, error: err.message };
  }
}

module.exports = { createPool, getPool, testConnection };
