require('dotenv').config();
const { getPool } = require('../config/database');
const { resolveEmpresaLogoRelatorio, sanitizeEmpresaRow } = require('../services/empresa-logo');
const fs = require('fs');
const path = require('path');

(async () => {
  const pool = getPool();
  const [rows] = await pool.query(
    "SELECT id_empresa, Razao_empresa, logo_relatorio FROM empresa WHERE excluido='N'"
  );
  console.log('Antes:', JSON.stringify(rows, null, 2));
  for (const row of rows) {
    await sanitizeEmpresaRow(pool, row);
  }
  const [after] = await pool.query(
    "SELECT id_empresa, Razao_empresa, logo_relatorio FROM empresa WHERE excluido='N'"
  );
  console.log('Depois:', JSON.stringify(after, null, 2));
  const d = path.join(__dirname, '..', 'public', 'uploads', 'empresas', '1');
  if (fs.existsSync(d)) console.log('dir1', fs.readdirSync(d));
  console.log('resolve test', resolveEmpresaLogoRelatorio(1, rows[0]?.logo_relatorio));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
