require('dotenv').config();
const { createPoolFromLicenseBinding, getPool, getPoolForLicense, readLicenseBinding, runWithPool } = require('../config/database');

(async () => {
  await createPoolFromLicenseBinding();
  const chave = readLicenseBinding()?.chave_licenca;
  const pool = getPoolForLicense(chave);
  await runWithPool(pool, async () => {
    const p = getPool();
    const [r1] = await p.query(`SELECT COUNT(*) n, COALESCE(SUM(vlrtotalpedido),0) v FROM pedidos WHERE excluido='N' AND MONTH(data_abertura)=MONTH(CURDATE()) AND YEAR(data_abertura)=YEAR(CURDATE())`);
    const [r2] = await p.query(`SELECT YEAR(data_abertura) y, MONTH(data_abertura) m, COUNT(*) n, COALESCE(SUM(vlrtotalpedido),0) v FROM pedidos WHERE excluido='N' GROUP BY y,m ORDER BY y DESC, m DESC LIMIT 6`);
    const [r3] = await p.query(`SELECT idusuario, loginusu FROM usuarios WHERE loginusu='LEONARDO' LIMIT 1`);
    const [itens] = await p.query(`SELECT * FROM tabela_preco_itens LIMIT 10`);
    console.log('mes_atual', r1);
    console.log('historico', r2);
    console.log('leonardo', r3);
    console.log('itens', itens);
  });
})().catch(e => console.error(e.message || e));
