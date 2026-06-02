require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
(async () => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS || process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const [c] = await pool.query('SHOW COLUMNS FROM despesas');
  console.log(c.map((x) => x.Field + ' ' + x.Type).join('\n'));
  const [rows] = await pool.query(
    "SELECT d.id AS id_despesas, d.descricao AS nome FROM despesas d WHERE d.excluido = 'N' ORDER BY d.descricao LIMIT 5"
  );
  console.log('rows', rows.length, rows);
  await pool.end();
})().catch((e) => console.error(e.message));
