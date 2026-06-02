require('dotenv').config();
const {
  createPool,
  getPool,
  getPoolForLicense,
  runWithPool,
  customerDbFromLicense,
} = require('../config/database');
const LicenseCache = require('../services/license-cache');
const { extractMysqlConfigFromLicenseRow } = require('../config/customer-db-from-license');
const LicenseService = require('../services/license-service');

async function simulateLoginFallback(chave) {
  const p = getPoolForLicense(chave);
  if (p) {
    return runWithPool(p, async () => {
      const pool = getPool();
      const [[db]] = await pool.query('SELECT DATABASE() AS db');
      return { path: 'runWithPool', db: db?.db };
    });
  }
  try {
    const pool = getPool();
    const [[db]] = await pool.query('SELECT DATABASE() AS db');
    return { path: 'fallback_global', db: db?.db };
  } catch (e) {
    return { path: 'fallback_erro', erro: e.message };
  }
}

async function main() {
  console.log('=== SIMULACAO LOGIN SEM POOL (pos-restart) ===');
  const cachedFiles = require('fs').readdirSync(require('path').join(__dirname, '..', 'data', 'licenses'))
    .filter((f) => f.endsWith('.enc'));
  console.log('Caches .enc:', cachedFiles);

  for (const f of cachedFiles.slice(0, 2)) {
    const chave = f.replace('.enc', '');
    console.log(`\nChave ${chave}:`);
    console.log('  pool em memoria:', getPoolForLicense(chave) ? 'SIM' : 'NAO');
    const cached = LicenseCache.read(chave);
    console.log('  cache arquivo:', cached ? cached.dados?.razao_social || cached.dados?.mysql_database : 'expirado/ausente');
    const sim = await simulateLoginFallback(chave);
    console.log('  login fallback:', sim);
  }

  console.log('\n=== SIMULACAO: ativar A depois login B com pool A global ===');
  if (!customerDbFromLicense()) {
    console.log('skip - nao multi-tenant');
    process.exit(0);
  }

  const licPool = require('../config/db-license').getLicensePool();
  const [rows] = await licPool.query(
    `SELECT chave_licenca, mysql_host, mysql_database, mysql_user, mysql_password, mysql_port
     FROM sistema_licencas
     WHERE ativo = 1 AND mysql_host IS NOT NULL AND mysql_database IS NOT NULL
     LIMIT 2`
  );
  console.log('Licencas com mysql cadastrado:', rows.length);
  if (rows.length >= 2) {
    const cfgA = extractMysqlConfigFromLicenseRow(rows[0]);
    const cfgB = extractMysqlConfigFromLicenseRow(rows[1]);
    createPool(cfgA, rows[0].chave_licenca);
    createPool(cfgB, rows[1].chave_licenca);
    const simWrong = await simulateLoginFallback(rows[0].chave_licenca);
    const simRight = await simulateLoginFallback(rows[1].chave_licenca);
    console.log('Login chave A (com pools A+B ativos):', simWrong);
    console.log('Login chave B (com pools A+B ativos):', simRight);
  } else {
    console.log('Poucas licencas com mysql_* preenchido para teste real de cross-db');
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
