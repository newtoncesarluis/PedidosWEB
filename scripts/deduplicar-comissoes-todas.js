/**
 * Remove comissões duplicadas em todos os pedidos.
 * Uso: node scripts/deduplicar-comissoes-todas.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

async function main() {
  const { initCustomerDatabase, getPool } = require('../config/database');
  const { corrigirTodasDuplicatas } = require('../config/comissao-deduplicar');

  await initCustomerDatabase();
  const pool = getPool();
  const conn = await pool.getConnection();

  try {
    const data = await corrigirTodasDuplicatas(conn);
    console.log(`Pedidos processados: ${data.pedidos_processados}`);
    for (const r of data.detalhes) {
      console.log(`  ${r.pedido}: ${r.removidas} duplicata(s) removida(s)`);
    }
    console.log('---');
    console.log(`Total removidas: ${data.total_removidas} em ${data.pedidos_corrigidos} pedido(s)`);
    if (!data.total_removidas) console.log('Nenhuma duplicata encontrada.');
  } finally {
    conn.release();
    await pool.end().catch(() => {});
  }
}

main().catch((e) => {
  console.error('ERRO:', e.message);
  process.exit(1);
});
