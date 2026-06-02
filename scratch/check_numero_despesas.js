require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

(async () => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS || process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const [c] = await pool.query("SHOW COLUMNS FROM pagar WHERE Field IN ('numero','numeronf','doc')");
  console.log('pagar cols:', c.map((x) => ({ Field: x.Field, Type: x.Type })));
  const [d] = await pool.query(
    "SELECT d.id AS id_despesas, d.nome FROM despesas d WHERE d.excluido = 'N' ORDER BY d.nome LIMIT 5"
  );
  console.log('despesas count:', d.length, d[0]);
  await pool.end();
})().catch((e) => console.error(e.message));
