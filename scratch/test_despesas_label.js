require('dotenv').config();
const { getPool } = require('../config/database');
const {
  resolveDespesasLabelColumn,
  despesasLabelExpr,
  despesasLabelColumnName,
} = require('../config/despesas-label');

(async () => {
  const pool = getPool();
  await resolveDespesasLabelColumn(pool);
  const col = despesasLabelColumnName();
  const expr = despesasLabelExpr('d');
  const [rows] = await pool.query(
    `SELECT d.id AS id_despesas, ${expr} AS nome FROM despesas d WHERE d.excluido = 'N' ORDER BY ${expr} LIMIT 3`
  );
  console.log('coluna detectada:', col);
  console.log('rows:', rows);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
