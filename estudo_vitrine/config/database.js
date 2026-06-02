'use strict';

const mysql = require('mysql2/promise');

let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306', 10),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'estudo_vitrine',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      timezone: '-03:00',
      dateStrings: ['DATE']
    });
  }
  return pool;
}

module.exports = { getPool };
