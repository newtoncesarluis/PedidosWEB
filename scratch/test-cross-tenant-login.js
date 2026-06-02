require('dotenv').config();
const {
  createPool,
  getPoolForLicense,
  runWithPool,
  getGlobalPool,
} = require('../config/database');
const { extractMysqlConfigFromLicenseRow } = require('../config/customer-db-from-license');

async function dbNameForChave(chave) {
  const p = getPoolForLicense(chave);
  if (!p) return { chave, erro: 'sem pool' };
  return runWithPool(p, async () => {
    const { getPool } = require('../config/database');
    const [[r]] = await getPool().query('SELECT DATABASE() AS db');
    return { chave, db: r.db };
  });
}

async function main() {
  const licPool = require('../config/db-license').getLicensePool();
  const [rows] = await licPool.query(
    `SELECT * FROM sistema_licencas
     WHERE ativo = 1 AND mysql_host IS NOT NULL AND mysql_database IS NOT NULL
     LIMIT 2`
  );
  if (rows.length < 2) {
    console.log('Precisa de 2 licencas com mysql');
    process.exit(0);
  }

  const chaveA = rows[0].chave_licenca;
  const chaveB = rows[1].chave_licenca;
  createPool(extractMysqlConfigFromLicenseRow(rows[0]), chaveA);
  createPool(extractMysqlConfigFromLicenseRow(rows[1]), chaveB);

  console.log('Global pool database (ultimo createPool):');
  try {
    const gp = getGlobalPool();
    const [[g]] = await gp.query('SELECT DATABASE() AS db');
    console.log(' ', g.db);
  } catch (e) {
    console.log(' ', e.message);
  }

  console.log('\nCenario CRITICO: empresas-usuario/login sem pool mas chave errada no body');
  // Simula auth.js: pool existe so para B, request vem com chave A mas pool A nao existe -> fallback
  const pBonly = getPoolForLicense(chaveB);
  // Remove pool A from map to simulate only B active
  const map = require('../config/database');
  // Actually both exist - simulate wrong chave: user sends chaveA but only global pool is B's

  // Simulate: only global pool (as if only B was activated last)
  const { _poolMapKeys } = require('../config/database');
  console.log('Pools ativos:', [..._poolMapKeys()]);

  // Wrong scenario from auth.js lines 310-314:
  async function authLoginSim(chave_licenca) {
    const p = getPoolForLicense(chave_licenca);
    if (p) {
      return runWithPool(p, async () => {
        const { getPool } = require('../config/database');
        const [[r]] = await getPool().query('SELECT DATABASE() AS db');
        return { ok: true, via: 'runWithPool', db: r.db, chave: chave_licenca };
      });
    }
    try {
      const { getPool } = require('../config/database');
      const [[r]] = await getPool().query('SELECT DATABASE() AS db');
      return { ok: true, via: 'FALLBACK_GLOBAL', db: r.db, chave: chave_licenca };
    } catch (e) {
      return { ok: false, via: 'erro', erro: e.message, chave: chave_licenca };
    }
  }

  console.log('\nLogin com chave correta A:', await authLoginSim(chaveA));
  console.log('Login com chave correta B:', await authLoginSim(chaveB));

  // Chave inventada / typo - pool nao existe
  console.log('Login chave INEXISTENTE (fallback global):', await authLoginSim('ZZZZ-ZZZZ-ZZZZ-ZZZZ'));

  // JWT mismatch: token diz A mas usaria pool errado?
  console.log('\n=== JWT nao valida chave vs pool ===');
  console.log('chave_licenca vem do body do cliente sem validar contra pool usado no login');

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
