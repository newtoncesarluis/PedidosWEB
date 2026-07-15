require('dotenv').config();
const { getGlobalPool, createPoolFromLicenseBinding, getBoundChave } = require('../config/database');

(async () => {
  console.log('Bound chave:', getBoundChave());
  let pool = getGlobalPool();
  if (!pool) {
    const r = await createPoolFromLicenseBinding();
    console.log('createPoolFromLicenseBinding:', r.ok ? 'ok' : r.error);
    pool = getGlobalPool();
  }
  if (!pool) {
    console.error('No pool');
    process.exit(1);
  }
  const db = pool.pool?.config?.connectionConfig?.database;
  console.log('Connected DB:', db);

  const where = "excluido = 'N' AND situacao = 'A'";
  const [rows] = await pool.query(
    `SELECT id, descricao, excluido, situacao FROM tipo_pedidos WHERE ${where} ORDER BY descricao LIMIT 50`
  );
  console.log('Rows:', rows);

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM tipo_pedidos WHERE ${where}`
  );
  console.log('Total:', total);

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
