const mysql = require('mysql2/promise');
(async () => {
  try {
    const conn = await mysql.createConnection(process.env.DB_URL || 'mysql://root@localhost/sysrepweb');
    const [cols] = await conn.query('SHOW COLUMNS FROM clientes');
    console.log('CLIENTES COLS:', cols.map(c => c.Field));
    const [sample] = await conn.query('SELECT id, latitude, longitude FROM clientes WHERE latitude IS NOT NULL LIMIT 5');
    console.log('CLIENTES LAT/LNG SAMPLE:', sample);
    const [pSample] = await conn.query('SELECT id, cod_cliente, nome_cliente FROM pedidos LIMIT 5');
    console.log('PEDIDOS SAMPLE:', pSample);
    process.exit();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
