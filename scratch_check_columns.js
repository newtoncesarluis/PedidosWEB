const { getPool } = require('./config/database');
async function check() {
  const pool = getPool();
  try {
    const [rows] = await pool.query('DESCRIBE clientes');
    console.log(JSON.stringify(rows, null, 2));
  } catch (e) {
    console.error(e);
  }
  process.exit();
}
check();
