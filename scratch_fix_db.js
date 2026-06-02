const { getPool } = require('./config/database');
async function fix() {
  const pool = getPool();
  try {
    console.log("Checking columns...");
    const [rows] = await pool.query('DESCRIBE clientes');
    const cols = rows.map(r => r.Field);
    
    if (!cols.includes('latitude')) {
      console.log("Adding latitude...");
      await pool.query('ALTER TABLE clientes ADD COLUMN latitude VARCHAR(50) DEFAULT NULL');
    }
    if (!cols.includes('longitude')) {
      console.log("Adding longitude...");
      await pool.query('ALTER TABLE clientes ADD COLUMN longitude VARCHAR(50) DEFAULT NULL');
    }
    
    console.log("Updating tipo_pessoa values...");
    await pool.query("UPDATE clientes SET tipo_pessoa = 'JURIDICA' WHERE tipo_pessoa = 'J' OR tipo_pessoa = 'Juridica'");
    await pool.query("UPDATE clientes SET tipo_pessoa = 'FISICA' WHERE tipo_pessoa = 'F' OR tipo_pessoa = 'Fisica'");
    
    console.log("Success.");
  } catch (e) {
    console.error(e);
  }
  process.exit();
}
fix();
