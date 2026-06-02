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
    const [cols] = await pool.query('SHOW COLUMNS FROM despesas');
    console.log('despesas cols:', cols.map((c) => c.Field).join(', '));
    const sql = `
      SELECT p.id, n.descricao as nome_natureza, d.descricao as nome_despesa,
        ${SQL_STATUS_DISPLAY} as status_display
      FROM pagar p
      LEFT JOIN natureza n ON p.id_natureza = n.id
      LEFT JOIN despesas d ON p.id_despesas = d.id
      WHERE ${SQL_EXCLUIDO}
      LIMIT 3`;
    const [rows] = await pool.query(sql);
    console.log('OK rows:', rows.length);
  } catch (e) {
    console.error('ERRO SQL:', e.message);
    try {
      const [cols] = await pool.query('SHOW COLUMNS FROM despesas');
      const names = cols.map((c) => c.Field);
      const descCol = names.includes('descricao') ? 'descricao' : names.includes('nome') ? 'nome' : names[0];
      const sql2 = `
        SELECT p.id, d.${descCol} as nome_despesa FROM pagar p
        LEFT JOIN despesas d ON p.id_despesas = d.id LIMIT 1`;
      await pool.query(sql2);
      console.log('despesas label col should be:', descCol);
    } catch (e2) {
      console.error('despesas table?', e2.message);
    }
  }
  await pool.end();
})();
