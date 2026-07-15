require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

(async () => {
  const binding = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/license-binding.json')));
  const licHost = process.env.LICENSE_DB_HOST || process.env.DB_HOST || 'localhost';
  const licUser = process.env.LICENSE_DB_USER || process.env.DB_USER || 'root';
  const licPass = process.env.LICENSE_DB_PASSWORD || process.env.DB_PASSWORD || '';
  const licDb = process.env.LICENSE_DB_NAME || 'nc_painel';
  const licPort = parseInt(process.env.LICENSE_DB_PORT || process.env.DB_PORT || '3306', 10);

  console.log('License DB:', licHost, licDb);

  try {
    const lc = await mysql.createConnection({
      host: licHost,
      user: licUser,
      password: licPass,
      database: licDb,
      port: licPort,
    });
    const [rows] = await lc.query(
      'SELECT chave_licenca, mysql_database, db_name, database_cliente, nome_banco FROM sistema_licencas WHERE chave_licenca = ?',
      [binding.chave_licenca]
    );
    console.log('License row:', rows[0]);
    await lc.end();
  } catch (e) {
    console.log('License query failed:', e.message);
  }

  // Check bdallyrepresentacoes
  const root = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
  });
  const [dbs] = await root.query("SHOW DATABASES LIKE 'bdally%'");
  console.log('Databases:', dbs);
  await root.end();
})();
