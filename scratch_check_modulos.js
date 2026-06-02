const { getPool } = require('./config/database');
async function checkModulos() {
  const pool = getPool();
  try {
    const [rows] = await pool.query("SELECT id, descricao, liberado, excluido FROM modulos");
    console.log('Tabela MODULOS:');
    console.table(rows);
  } catch (err) {
    console.error('Erro ao consultar modulos:', err);
  } finally {
    process.exit();
  }
}
checkModulos();
