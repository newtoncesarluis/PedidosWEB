const { getPool } = require('./config/database');
async function run() {
  const pool = getPool();
  try {
    const [cols] = await pool.query("DESCRIBE receber");
    console.log(JSON.stringify(cols, null, 2));
  } catch (e) {
    console.error(e);
  }
  process.exit();
}
run();
