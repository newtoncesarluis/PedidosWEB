const { getPool } = require('./config/database');
async function checkTables() {
  const pool = getPool();
  try {
    const [rows] = await pool.query("SHOW TABLES");
    console.log('Tabelas no banco:');
    console.table(rows);
    
    // Verifica especificamente caixa, pagar, receber
    for(let table of ['caixa', 'pagar', 'receber', 'modulos']) {
        try {
            const [cols] = await pool.query(`DESCRIBE ${table}`);
            console.log(`Colunas de ${table}:`);
            console.table(cols);
        } catch(e) {
            console.log(`Tabela ${table} não existe ou erro ao descrever.`);
        }
    }
  } catch (err) {
    console.error('Erro ao consultar tabelas:', err);
  } finally {
    process.exit();
  }
}
checkTables();
