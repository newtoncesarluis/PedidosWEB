require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

(async () => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sysrep',
  });
  const [cols] = await pool.query('SHOW COLUMNS FROM pagar');
  console.log('COLUNAS:', cols.map((c) => c.Field).join(', '));
  const [sample] = await pool.query(
    "SELECT * FROM pagar WHERE (excluido='N' OR excluido IS NULL OR excluido='') LIMIT 2"
  );
  const [rows] = await pool.query(
    "SELECT id, vencimento, prazo, numero, numeronf, data_lanc FROM pagar WHERE (excluido='N' OR excluido IS NULL) LIMIT 8"
  );
  console.table(rows.map((x) => ({
    id: x.id,
    venc: x.vencimento,
    prazo: x.prazo,
    numeronf: x.numeronf,
  })));
  const nullVenc = await pool.query(
    "SELECT COUNT(*) n FROM pagar WHERE (excluido='N' OR excluido IS NULL) AND (vencimento IS NULL OR vencimento='0000-00-00')"
  );
  console.log('Sem vencimento:', nullVenc[0][0].n);
  await pool.end();
})().catch((e) => console.error(e.message));
