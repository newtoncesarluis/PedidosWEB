const mysql = require('mysql2/promise');
async function run() {
  try {
    const conn = await mysql.createConnection({ host: 'localhost', user: 'root', database: 'sysrepweb' });
    const [rows] = await conn.query('DESCRIBE visitas');
    console.log("VISITAS TABLE:");
    console.table(rows);
    const [rows2] = await conn.query('DESCRIBE motivo_visitas');
    console.log("MOTIVOS TABLE:");
    console.table(rows2);
    conn.end();
  } catch(e) { console.error(e.message); }
}
run();
