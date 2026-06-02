const { getPool } = require('./config/database');
const fs = require('fs');

async function check() {
  const pool = getPool();
  try {
    const [cols] = await pool.query("SHOW COLUMNS FROM receber");
    const result = cols.map(c => c.Field).join('\n');
    fs.writeFileSync('./scratch/receber_cols.txt', result);
    process.exit(0);
  } catch (err) {
    fs.writeFileSync('./scratch/receber_error.txt', err.message);
    process.exit(1);
  }
}
check();
