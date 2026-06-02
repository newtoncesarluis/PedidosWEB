require('dotenv').config();
const LicenseCache = require('../services/license-cache');
const { getLicensePool } = require('../config/db-license');
const LicenseService = require('../services/license-service');
const {
  createPool,
  getPoolForLicense,
  getGlobalPool,
  runWithPool,
  customerDbFromLicense,
} = require('../config/database');

async function main() {
  console.log('=== CONFIG ===');
  console.log('CUSTOMER_DB_FROM_LICENSE:', process.env.CUSTOMER_DB_FROM_LICENSE);
  console.log('LICENSE_DB_HOST:', process.env.LICENSE_DB_HOST || process.env.DB_HOST || '(localhost)');
  console.log('LICENSE_DB_NAME:', process.env.LICENSE_DB_NAME || 'sistema_licencas');

  let sampleKeys = [];

  console.log('\n=== PING SERVIDOR CENTRAL ===');
  try {
    const licPool = getLicensePool();
    const [[row]] = await licPool.query('SELECT COUNT(*) as total FROM sistema_licencas');
    console.log('OK - total licencas:', row.total);
    const [keys] = await licPool.query(
      `SELECT chave_licenca, razao_social,
              COALESCE(mysql_database, db_name, '(sem mysql_database)') AS db_name
       FROM sistema_licencas WHERE ativo = 1 LIMIT 5`
    );
    sampleKeys = keys;
    keys.forEach((k) => {
      console.log(`  ${k.chave_licenca} | ${String(k.razao_social).slice(0, 40)} | ${k.db_name}`);
    });
  } catch (e) {
    console.log('FALHA conexao:', e.message);
  }

  console.log('\n=== TESTE CACHE POR CHAVE ===');
  const chaveA = 'AAAA-BBBB-CCCC-DDDD';
  const chaveB = 'EEEE-FFFF-GGGG-HHHH';
  LicenseCache.write(chaveA, {
    valid: true,
    status: 'ativo',
    dados: { razao_social: 'Cliente A Teste', mysql_database: 'db_a' },
  });
  LicenseCache.write(chaveB, {
    valid: true,
    status: 'ativo',
    dados: { razao_social: 'Cliente B Teste', mysql_database: 'db_b' },
  });
  const readA = LicenseCache.read(chaveA);
  const readB = LicenseCache.read(chaveB);
  console.log('Cache A:', readA?.dados?.razao_social, '| db:', readA?.dados?.mysql_database);
  console.log('Cache B:', readB?.dados?.razao_social, '| db:', readB?.dados?.mysql_database);
  console.log('Isolamento OK:', readA?.dados?.mysql_database === 'db_a' && readB?.dados?.mysql_database === 'db_b');
  LicenseCache.clear(chaveA);
  LicenseCache.clear(chaveB);

  console.log('\n=== TESTE checkByKey (vazamento de info entre chaves) ===');
  if (sampleKeys.length >= 2) {
    const k1 = sampleKeys[0].chave_licenca;
    const k2 = sampleKeys[1].chave_licenca;
    const r1 = await LicenseService.checkByKey(k1);
    const r2 = await LicenseService.checkByKey(k2);
    console.log(`${k1} -> ${r1.dados?.razao_social}`);
    console.log(`${k2} -> ${r2.dados?.razao_social}`);
    console.log('Retornos distintos por chave:', r1.dados?.razao_social !== r2.dados?.razao_social);
    console.log('RISCO: endpoint publico /api/license/check?chave=X expoe razao_social de qualquer chave valida');
  } else {
    const fs = require('fs');
    const dir = require('path').join(__dirname, '..', 'data', 'licenses');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.enc')) : [];
    console.log('Arquivos .enc em data/licenses:', files.length);
    for (const f of files.slice(0, 3)) {
      const chave = f.replace('.enc', '');
      const r = await LicenseService.checkByKey(chave);
      console.log(`${chave} -> valid=${r.valid} razao=${r.dados?.razao_social || r.mensagem}`);
    }
  }

  console.log('\n=== TESTE POOL GLOBAL vs MAP (multi-tenant) ===');
  if (customerDbFromLicense()) {
    const fakeCfgA = {
      host: '127.0.0.1',
      port: 3306,
      user: 'u_a',
      password: 'p_a',
      database: 'tenant_a',
      waitForConnections: true,
      connectionLimit: 1,
      queueLimit: 0,
      timezone: '-03:00',
    };
    const fakeCfgB = {
      ...fakeCfgA,
      user: 'u_b',
      password: 'p_b',
      database: 'tenant_b',
    };
    const poolA = createPool(fakeCfgA, 'KEY-A-TEST');
    createPool(fakeCfgB, 'KEY-B-TEST');
    const globalAfterB = getGlobalPool();
    const mapA = getPoolForLicense('KEY-A-TEST');
    const mapB = getPoolForLicense('KEY-B-TEST');
    console.log('Pool global aponta para ultimo tenant criado (B):', globalAfterB === mapB);
    console.log('Pool map A ainda existe:', mapA !== null && mapA !== mapB);
    console.log('RISCO: getPool() sem ALS usa pool global = ultimo tenant ativado');
    try {
      poolA.end();
      mapB?.end?.();
    } catch (_) {}
  } else {
    console.log('Modo single-tenant (CUSTOMER_DB_FROM_LICENSE nao ativo) - teste de pool map ignorado');
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
