require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

(async () => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS || process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  try {
    await pool.query(
      `SELECT d.id AS id, d.id AS id_despesas, d.nome FROM despesas d WHERE d.excluido = 'N' ORDER BY d.nome`
    );
    console.log('nome OK');
  } catch (e) {
    console.log('nome fail:', e.message);
    const [rows] = await pool.query(
      `SELECT d.id AS id, d.id AS id_despesas, d.descricao AS nome FROM despesas d WHERE d.excluido = 'N' ORDER BY d.descricao`
    );
    console.log('descricao OK', rows.length, rows[0]);
  }
  const { normalizarCamposDocumentoPagar } = require('../routes/pagar');
  await pool.end();
})().catch((e) => console.error(e));
