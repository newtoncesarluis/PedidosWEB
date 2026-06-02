const { getPool } = require('./config/database');

async function check() {
  const pool = getPool();
  try {
    const [colsReceber] = await pool.query("SHOW COLUMNS FROM receber");
    console.log("--- RECEBER ---");
    colsReceber.forEach(c => console.log(c.Field));

    const [colsPedidos] = await pool.query("SHOW COLUMNS FROM pedidos");
    console.log("--- PEDIDOS ---");
    colsPedidos.forEach(c => console.log(c.Field));
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

check();
