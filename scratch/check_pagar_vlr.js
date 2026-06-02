require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
(async () => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS || process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const [cols] = await pool.query("SHOW COLUMNS FROM pagar LIKE '%vlr%'");
  console.log(cols.map((c) => c.Field + ' ' + c.Type));
  const [cols2] = await pool.query("SHOW COLUMNS FROM pagar LIKE '%com%'");
  console.log('com:', cols2.map((c) => c.Field));
  await pool.end();
})().catch((e) => console.error(e.message));
