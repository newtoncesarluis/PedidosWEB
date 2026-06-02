const mysql = require('mysql2/promise');
(async () => {
  try {
    const conn = await mysql.createConnection(process.env.DB_URL || 'mysql://root@localhost/sysrepweb');
    const [cols] = await conn.query('SHOW COLUMNS FROM pedidos');
    console.log('PEDIDOS COLS:', cols.map(c => c.Field));
    process.exit();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
