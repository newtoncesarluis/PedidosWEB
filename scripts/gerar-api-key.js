/**
 * Gera uma nova API Key para um tenant
 *
 * Uso:
 *   node scripts/gerar-api-key.js <chave_licenca> <descricao>
 *
 * Exemplo:
 *   node scripts/gerar-api-key.js ABC-123-XYZ "ERP Cliente Poliitens"
 */
require('dotenv').config();
const crypto = require('crypto');
const { getLicensePool } = require('../config/db-license');
const { setupApiKeysTable } = require('../config/api-keys-setup');

async function main() {
  const chave_licenca = process.argv[2];
  const descricao     = process.argv[3] || 'API Key';

  if (!chave_licenca) {
    console.error('Uso: node scripts/gerar-api-key.js <chave_licenca> <descricao>');
    process.exit(1);
  }

  await setupApiKeysTable();

  const pool = getLicensePool();

  // Verifica se a licença existe
  const [[lic]] = await pool.query(
    'SELECT chave_licenca, empresa FROM sistema_licencas WHERE chave_licenca = ? AND ativo = 1 LIMIT 1',
    [chave_licenca]
  );
  if (!lic) {
    console.error(`Licença "${chave_licenca}" não encontrada ou inativa.`);
    process.exit(1);
  }

  // Gera chave segura
  const apiKey = 'sk_' + crypto.randomBytes(24).toString('hex');

  await pool.query(
    'INSERT INTO api_keys (chave, chave_licenca, descricao) VALUES (?, ?, ?)',
    [apiKey, chave_licenca, descricao]
  );

  console.log('\n✅ API Key gerada com sucesso!');
  console.log('─────────────────────────────────────────────────');
  console.log(`Empresa       : ${lic.empresa || chave_licenca}`);
  console.log(`Chave Licença : ${chave_licenca}`);
  console.log(`Descrição     : ${descricao}`);
  console.log(`\nAPI Key       : ${apiKey}`);
  console.log('─────────────────────────────────────────────────');
  console.log('⚠️  Guarde esta chave — ela não será exibida novamente.\n');

  process.exit(0);
}

main().catch(err => { console.error(err.message); process.exit(1); });
