require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
  const ports = [3308, 3306];
  for (const port of ports) {
    try {
      const c = await mysql.createConnection({
        host: port === 3308 ? '127.0.0.1' : process.env.DB_HOST || 'localhost',
        port,
        user: port === 3308 ? 'app_pedidosweb' : process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: port === 3308 ? 'db_pedidos' : 'bdallyrep',
        connectTimeout: 5000,
      });
      console.log('\n=== port', port, 'db', port === 3308 ? 'db_pedidos' : 'bdallyrep', '===');
      const [exists] = await c.query("SHOW TABLES LIKE 'tipo_pedidos'");
      console.log('table exists:', exists.length > 0);
      if (!exists.length) {
        await c.end();
        continue;
      }
      const [cols] = await c.query('DESCRIBE tipo_pedidos');
      console.log('cols:', cols.map((r) => `${r.Field}:${r.Type}`).join(', '));
      const [rows] = await c.query('SELECT id, descricao, excluido, situacao FROM tipo_pedidos LIMIT 20');
      console.log('rows:', JSON.stringify(rows, null, 2));
      const [stats] = await c.query(`
        SELECT COUNT(*) total,
          SUM(excluido='N' OR excluido IS NULL) ok_excl,
          SUM(situacao='A' OR situacao IS NULL) ok_sit,
          SUM((excluido='N' OR excluido IS NULL) AND situacao='A') filtered
        FROM tipo_pedidos
      `);
      console.log('stats:', stats[0]);
      await c.end();
    } catch (e) {
      console.log('port', port, 'ERR:', e.message);
    }
  }
})();
