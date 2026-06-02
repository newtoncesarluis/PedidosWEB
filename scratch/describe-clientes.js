require('dotenv').config();
const { createPoolFromLicenseBinding, getPool, getPoolForLicense, readLicenseBinding, runWithPool } = require('../config/database');

async function main() {
  await createPoolFromLicenseBinding();
  const chave = readLicenseBinding().chave_licenca;
  await runWithPool(getPoolForLicense(chave), async () => {
    const pool = getPool();
    const [cols] = await pool.query('DESCRIBE clientes');
    console.log(cols.map(c => c.Field).join(', '));
    const [u] = await pool.query('DESCRIBE usuarios');
    console.log(u.map(c => c.Field).slice(0, 20).join(', '));
  });
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
