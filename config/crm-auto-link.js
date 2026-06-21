/**
 * Auto-vínculo de pedido/orçamento com negócio do CRM Pipeline.
 * Non-blocking: qualquer falha aqui nunca deve impedir a criação do pedido.
 */
async function autoLinkNegocio({ conn, id_empresa, cod_cliente, id_usuario, vlrtotalpedido, id_pedido }) {
  if (!cod_cliente || !id_pedido) return;
  try {
    const [[negocioAberto]] = await conn.query(
      `SELECT n.id FROM negocios n
       LEFT JOIN leads l ON l.id = n.id_lead
       WHERE n.excluido='N' AND n.status='ABERTO' AND n.id_empresa=?
         AND (n.id_cliente=? OR l.convertido_cliente_id=?)
       ORDER BY n.id DESC LIMIT 1`,
      [id_empresa, cod_cliente, cod_cliente]
    );

    if (negocioAberto) {
      await conn.query(
        `INSERT IGNORE INTO negocio_pedidos (id_negocio, id_pedido) VALUES (?, ?)`,
        [negocioAberto.id, id_pedido]
      );
      return;
    }

    const [[pv]] = await conn.query(
      `SELECT id_pipeline FROM pipeline_vendedor WHERE id_usuario=? AND excluido='N' ORDER BY id LIMIT 1`,
      [id_usuario]
    );
    let idPipeline = pv?.id_pipeline;
    if (!idPipeline) {
      const [[pp]] = await conn.query(
        `SELECT id FROM pipelines WHERE id_empresa=? AND padrao='S' AND excluido='N' LIMIT 1`,
        [id_empresa]
      );
      idPipeline = pp?.id;
    }
    if (!idPipeline) return; // sem pipeline configurada — não cria negócio automático

    const [[primeiraEtapa]] = await conn.query(
      `SELECT id, probabilidade_padrao FROM pipeline_etapas
       WHERE id_pipeline=? AND tipo='ABERTA' AND excluido='N' ORDER BY ordem ASC LIMIT 1`,
      [idPipeline]
    );
    if (!primeiraEtapa) return;

    const [r] = await conn.query(
      `INSERT INTO negocios (id_empresa, id_cliente, id_pipeline, id_etapa, id_usuario,
         valor_previsto, probabilidade, status, origem)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ABERTO', 'AUTO_PEDIDO')`,
      [id_empresa, cod_cliente, idPipeline, primeiraEtapa.id, id_usuario,
       Number(vlrtotalpedido) || 0, primeiraEtapa.probabilidade_padrao || 0]
    );
    await conn.query(
      `INSERT INTO negocio_historico (id_negocio, id_etapa_origem, id_etapa_destino, id_usuario)
       VALUES (?, NULL, ?, ?)`,
      [r.insertId, primeiraEtapa.id, id_usuario]
    );
    await conn.query(
      `INSERT IGNORE INTO negocio_pedidos (id_negocio, id_pedido) VALUES (?, ?)`,
      [r.insertId, id_pedido]
    );
  } catch (_) {
    // best-effort — nunca propagar erro para a criação do pedido
  }
}

module.exports = { autoLinkNegocio };
