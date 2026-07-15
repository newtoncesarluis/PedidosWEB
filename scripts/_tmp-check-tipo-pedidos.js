require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
  try {
    const dbName = process.env.DB_NAME || 'sysrepweb';
    let c;
    try {
      c = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: dbName,
      });
    } catch (e) {
      console.log('Failed with DB_NAME, trying without database:', e.message);
      c = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
      });
      const [dbs] = await c.query("SHOW DATABASES LIKE '%ally%'");
      console.log('Matching DBs:', dbs);
      if (dbs.length) {
        await c.changeUser({ database: dbs[0]['Database (%ally%)'] || Object.values(dbs[0])[0] });
      }
    }
    const [dbs] = await c.query('SELECT DATABASE() AS db');
    console.log('DB:', dbs[0].db);

    const [cols] = await c.query('DESCRIBE tipo_pedidos');
    console.log('Columns:', cols.map((r) => r.Field).join(', '));

    const [rows] = await c.query(
      'SELECT id, descricao, excluido, situacao FROM tipo_pedidos LIMIT 20'
    );
    console.log('Rows:', JSON.stringify(rows, null, 2));

    const [cnt] = await c.query(`
      SELECT COUNT(*) AS total,
        SUM(excluido = 'N') AS excl_N,
        SUM(excluido IS NULL) AS excl_null,
        SUM(excluido = 'S') AS excl_S,
        SUM(situacao = 'A') AS sit_A,
        SUM(situacao IS NULL) AS sit_null,
        SUM(situacao <> 'A' OR (situacao IS NOT NULL AND situacao <> 'A')) AS sit_not_A
      FROM tipo_pedidos
    `);
    console.log('Stats:', cnt[0]);

    const [filtered] = await c.query(
      "SELECT COUNT(*) AS cnt FROM tipo_pedidos WHERE excluido = 'N' AND situacao = 'A'"
    );
    console.log("Filtered excluido='N' AND situacao='A':", filtered[0].cnt);

    await c.end();
  } catch (e) {
    console.error('ERR', e.message);
    process.exit(1);
  }
})();
