const { getPool } = require('./config/database');
async function check() {
  const pool = getPool();
  try {
    const [rows] = await pool.query('DESCRIBE receber');
    console.log(JSON.stringify(rows, null, 2));
    process.exit(0);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
check();
