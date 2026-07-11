/**
 * Migração única: db_nresolutions.solicitacoes → nc_painel.solicitacoes (+ anexos)
 * Uso: node scripts/migrar-solicitacoes-nc-painel.js
 */
const { getNREPool } = require('../config/db-nresolution');
const { getPainelPool, initPainelSolicitacoesSchema } = require('../config/db-painel');

async function main() {
  await initPainelSolicitacoesSchema();

  const src = getNREPool();
  const dst = getPainelPool();

  const [solicitacoes] = await src.query(
    `SELECT id, chave_licenca, titulo, descricao, tipo, origem, status, resposta_dev,
            notificado_wa, data_criacao, data_atualizacao
     FROM solicitacoes ORDER BY id`
  );

  if (!solicitacoes.length) {
    console.log('Nenhum registro em db_nresolutions.solicitacoes.');
    process.exit(0);
  }

  console.log(`Encontrados ${solicitacoes.length} registro(s) na origem.`);

  let migrados = 0;
  let ignorados = 0;

  for (const s of solicitacoes) {
    const [[exists]] = await dst.query(
      `SELECT id FROM solicitacoes WHERE id = ? OR (chave_licenca = ? AND titulo = ? AND data_criacao = ?) LIMIT 1`,
      [s.id, s.chave_licenca, s.titulo, s.data_criacao]
    );
    if (exists) {
      console.log(`  #${s.id} "${s.titulo}" — já existe (id ${exists.id}), ignorado`);
      ignorados++;
      continue;
    }

    await dst.query(
      `INSERT INTO solicitacoes
         (id, chave_licenca, titulo, descricao, tipo, origem, status, resposta_dev,
          notificado_wa, data_criacao, data_atualizacao)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        s.id, s.chave_licenca, s.titulo, s.descricao, s.tipo, s.origem, s.status,
        s.resposta_dev, s.notificado_wa ?? 0, s.data_criacao, s.data_atualizacao,
      ]
    );

    const [anexos] = await src.query(
      `SELECT id, id_solicitacao, tipo, caminho, nome_original, tamanho, data_upload
       FROM solicitacoes_anexos WHERE id_solicitacao = ? ORDER BY id`,
      [s.id]
    );

    for (const a of anexos) {
      const [[ax]] = await dst.query(
        `SELECT id FROM solicitacoes_anexos WHERE id = ? OR (id_solicitacao = ? AND caminho = ?) LIMIT 1`,
        [a.id, a.id_solicitacao, a.caminho]
      );
      if (ax) continue;
      await dst.query(
        `INSERT INTO solicitacoes_anexos
           (id, id_solicitacao, tipo, caminho, nome_original, tamanho, data_upload)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [a.id, a.id_solicitacao, a.tipo, a.caminho, a.nome_original, a.tamanho, a.data_upload]
      );
    }

    console.log(`  #${s.id} "${s.titulo}" — migrado (${anexos.length} anexo(s))`);
    migrados++;
  }

  // Ajusta AUTO_INCREMENT para não colidir com ids migrados
  const [[maxRow]] = await dst.query(`SELECT COALESCE(MAX(id), 0) AS m FROM solicitacoes`);
  const nextId = Math.max(Number(maxRow.m) + 1, 1);
  await dst.query(`ALTER TABLE solicitacoes AUTO_INCREMENT = ?`, [nextId]);

  const [[maxAx]] = await dst.query(`SELECT COALESCE(MAX(id), 0) AS m FROM solicitacoes_anexos`);
  await dst.query(`ALTER TABLE solicitacoes_anexos AUTO_INCREMENT = ?`, [Math.max(Number(maxAx.m) + 1, 1)]);

  const [[total]] = await dst.query(`SELECT COUNT(*) AS n FROM solicitacoes`);
  console.log(`\nConcluído: ${migrados} migrado(s), ${ignorados} ignorado(s). Total nc_painel: ${total.n}`);
  process.exit(0);
}

main().catch(err => {
  console.error('Erro na migração:', err.message);
  process.exit(1);
});
