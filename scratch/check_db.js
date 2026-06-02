const { getPool } = require('./config/database');
require('dotenv').config();

async function checkStructure() {
  const pool = getPool();
  try {
    const [colsCli] = await pool.query("SHOW COLUMNS FROM clientes");
    console.log("--- CLIENTES ---");
    console.log(colsCli.map(c => c.Field).join(', '));

    const [colsPed] = await pool.query("SHOW COLUMNS FROM pedidos");
    console.log("--- PEDIDOS ---");
    console.log(colsPed.map(c => c.Field).join(', '));
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}

checkStructure();
