require('dotenv').config();
const mysql = require('mysql2/promise');

const SQL_EXCLUIDO = "(p.excluido = 'N' OR p.excluido IS NULL OR p.excluido = '')";
const SQL_ABERTO = "(p.status IN ('ABERTA','ABERTO') OR p.status IS NULL OR p.status = '')";
const SQL_STATUS_DISPLAY = `CASE
    WHEN p.status IN ('LIQUIDADO','PAGO','BAIXADO','QUITADO') THEN 'LIQUIDADO'
    WHEN (${SQL_ABERTO}) AND p.vencimento < CURDATE() THEN 'EM ATRASO'
    ELSE 'ABERTA'
  END`;

(async () => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sysrep',
  });
  try {
    const [rows] = await pool.query(`
      SELECT p.id, n.descricao AS nome_natureza, p.despesas AS nome_despesa,
        ${SQL_STATUS_DISPLAY} AS status_display
      FROM pagar p
      LEFT JOIN natureza n ON p.id_natureza = n.id
      WHERE ${SQL_EXCLUIDO}
      ORDER BY p.vencimento ASC LIMIT 3`);
    console.log('OK', rows.length, 'rows');
  } catch (e) {
    console.error('FAIL', e.message);
    process.exitCode = 1;
  }
  await pool.end();
})();
