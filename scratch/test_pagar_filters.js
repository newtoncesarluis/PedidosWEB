require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sysrep',
  });
  const q = async (w, p = []) => {
    const [r] = await pool.query(`SELECT COUNT(*) n FROM pagar p WHERE ${w}`, p);
    return r[0].n;
  };
  console.log('Todos excluido N:', await q("excluido='N'"));
  const SQL_ABERTO = "(p.status IN ('ABERTA','ABERTO') OR p.status IS NULL OR p.status = '')";
  console.log('ABERTA filtro API:', await q(`excluido='N' AND ${SQL_ABERTO}`));
  console.log('EM ATRASO:', await q("excluido='N' AND status='ABERTA' AND vencimento < CURDATE()"));
  console.log('LIQUIDADO:', await q("excluido='N' AND status='LIQUIDADO'"));
  console.log('Periodo 2026:', await q("excluido='N' AND vencimento BETWEEN ? AND ?", ['2026-01-01', '2026-12-31']));
  console.log('Periodo 2025:', await q("excluido='N' AND vencimento BETWEEN ? AND ?", ['2025-01-01', '2025-12-31']));
  const [v] = await pool.query("SELECT MIN(vencimento) mi, MAX(vencimento) ma FROM pagar WHERE excluido='N'");
  console.log('Range venc:', v[0]);
  try {
    const [join] = await pool.query(`
      SELECT p.id, n.nome as nome_natureza, d.descricao as nome_despesa
      FROM pagar p
      LEFT JOIN natureza n ON p.id_natureza = n.id
      LEFT JOIN despesas d ON p.id_despesas = d.id
      WHERE p.excluido='N' LIMIT 3
    `);
    console.log('JOIN OK:', join.length, 'rows');
  } catch (e) {
    console.log('JOIN ERRO:', e.message);
  }
  const [natNull] = await pool.query("SELECT COUNT(*) n FROM pagar WHERE excluido='N' AND (id_natureza IS NULL OR id_natureza=0)");
  console.log('Sem natureza:', natNull[0].n);
  console.log('2026+ABERTA API:', await q("excluido='N' AND vencimento BETWEEN ? AND ? AND status='ABERTA' AND vencimento >= CURDATE()", ['2026-01-01', '2026-12-31']));
  console.log('Com id_natureza=1:', await q("excluido='N' AND id_natureza = ?", [1]));
  const [sample] = await pool.query("SELECT id, despesas, id_despesas, id_natureza FROM pagar WHERE excluido='N' LIMIT 5");
  console.log('Amostra campos:', sample);
  await pool.end();
})();
