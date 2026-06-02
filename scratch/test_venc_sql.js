require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { SQL_VENCIMENTO_ISO, SQL_VENCIMENTO_BR, mapPagarRow } = require('../config/pagar-dates');
const mysql = require('mysql2/promise');

(async () => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS || process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const [rows] = await pool.query(
    `SELECT p.id, ${SQL_VENCIMENTO_ISO} AS vencimento, ${SQL_VENCIMENTO_BR} AS vencimento_br
     FROM pagar p WHERE (p.excluido='N' OR p.excluido IS NULL) LIMIT 5`
  );
  rows.map(mapPagarRow).forEach((x) => console.log(x.id, '|', x.vencimento, '|', x.vencimento_br));
  await pool.end();
})();
