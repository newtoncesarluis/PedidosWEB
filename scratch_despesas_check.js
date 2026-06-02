const { getPool } = require('./config/database');
async function check() {
  const pool = getPool();
  try {
    console.log('--- DESCRIBE despesas ---');
    const [cols] = await pool.query('DESCRIBE despesas');
    console.log(JSON.stringify(cols.map(c => c.Field + ' ' + c.Type), null, 2));
  } catch (e) { console.error('despesas table error:', e.message); }
  try {
    console.log('--- DESCRIBE plano_contas ---');
    const [cols2] = await pool.query('DESCRIBE plano_contas');
    console.log(JSON.stringify(cols2.map(c => c.Field + ' ' + c.Type), null, 2));
  } catch (e) { console.error('plano_contas table error:', e.message); }
  try {
    console.log('--- TEST QUERY ---');
    const [rows] = await pool.query(
      `SELECT d.id, d.descricao, d.status, d.excluido, d.id_planoconta,
              p.descricao as planoconta_nome
       FROM despesas d
       LEFT JOIN plano_contas p ON p.id = d.id_planoconta
       WHERE d.excluido='N' ORDER BY d.descricao LIMIT 3`
    );
    console.log('OK, rows:', rows.length);
  } catch (e) { console.error('QUERY ERROR:', e.message); }
  process.exit();
}
check();
